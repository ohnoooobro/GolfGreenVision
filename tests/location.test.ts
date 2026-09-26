import { describe, expect, it, vi } from 'vitest'
import { LocationController } from '../src/location/controller'
import { mapGeolocationError, toLocationData } from '../src/location/geo'
import { SimulatedLocationSource } from '../src/location/sources'
import type { LocationEvent, LocationSource } from '../src/location/types'

function sourceStub(): { source: LocationSource; emit: (event: LocationEvent) => void; start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> } {
  let emitEvent: (event: LocationEvent) => void = () => undefined
  const start = vi.fn((listener: (event: LocationEvent) => void) => { emitEvent = listener })
  const stop = vi.fn()
  return { source: { start, stop }, emit: (event) => emitEvent(event), start, stop }
}

describe('定位数据转换', () => {
  it('将原始 GeolocationPosition 转换为统一结构并保留可为空字段', () => {
    const position = { coords: { latitude: 30.1, longitude: 120.2, accuracy: 4.5, altitude: null, heading: null, speed: null }, timestamp: 123 } as GeolocationPosition
    expect(toLocationData(position)).toEqual({ latitude: 30.1, longitude: 120.2, accuracy: 4.5, altitude: null, heading: null, speed: null, timestamp: 123 })
  })

  it.each([
    [1, 'permission-denied', '定位权限被拒绝，请在浏览器设置中允许定位权限。'],
    [2, 'unavailable', '定位不可用，请检查设备定位服务或网络连接。'],
    [3, 'error', '定位请求超时，请稍后重试。'],
  ])('映射浏览器错误 %s', (code, status, message) => {
    const error = { code, message: '' , PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 } as GeolocationPositionError
    expect(mapGeolocationError(error)).toEqual({ status, message })
  })
})

describe('定位控制器', () => {
  it('防止重复 watcher，并在停止时释放来源', () => {
    const real = sourceStub(); const simulated = new SimulatedLocationSource(); const controller = new LocationController(real.source, simulated)
    controller.start(); controller.start(); expect(real.start).toHaveBeenCalledTimes(1); controller.stop(); expect(real.stop).toHaveBeenCalledTimes(1)
  })

  it('将等待、成功和错误事件转换为统一状态', () => {
    const real = sourceStub(); const controller = new LocationController(real.source, new SimulatedLocationSource()); const states = [] as ReturnType<typeof controller.getState>[]
    controller.subscribe((state) => states.push(state)); controller.start()
    real.emit({ type: 'location', location: { latitude: 1, longitude: 2, accuracy: 3, altitude: null, heading: null, speed: null, timestamp: 4 } })
    real.emit({ type: 'status', status: 'error', message: '超时' })
    expect(states.map((state) => state.status)).toEqual(['waiting', 'success', 'error']); expect(states.at(-1)?.errorMessage).toBe('超时')
  })
})

describe('模拟定位', () => {
  it('启动时提供位置，更新时通知统一事件，并校验坐标范围', () => {
    const source = new SimulatedLocationSource({ latitude: 30, longitude: 120 }); const events: LocationEvent[] = []
    source.start((event) => events.push(event)); source.setPosition({ latitude: 31, longitude: 121, accuracy: 8 })
    expect(events.at(-1)).toMatchObject({ type: 'location', location: { latitude: 31, longitude: 121, accuracy: 8 } })
    expect(() => source.setPosition({ latitude: 91, longitude: 121 })).toThrow('纬度')
  })
})
