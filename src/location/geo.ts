import type { LocationData, LocationStatus } from './types'

/** 将浏览器原始位置转换为应用内部使用的统一结构。 */
export function toLocationData(position: GeolocationPosition): LocationData {
  const { coords } = position
  return {
    latitude: coords.latitude,
    longitude: coords.longitude,
    accuracy: coords.accuracy,
    altitude: coords.altitude ?? null,
    heading: coords.heading ?? null,
    speed: coords.speed ?? null,
    timestamp: position.timestamp,
  }
}

export interface MappedGeolocationError {
  status: Exclude<LocationStatus, 'waiting' | 'success'>
  message: string
}

export function mapGeolocationError(error: GeolocationPositionError): MappedGeolocationError {
  switch (error.code) {
    case error.PERMISSION_DENIED:
      return {
        status: 'permission-denied',
        message: '定位权限被拒绝，请在浏览器设置中允许定位权限。',
      }
    case error.POSITION_UNAVAILABLE:
      return {
        status: 'unavailable',
        message: '定位不可用，请检查设备定位服务或网络连接。',
      }
    case error.TIMEOUT:
      return {
        status: 'error',
        message: '定位请求超时，请稍后重试。',
      }
    default:
      return {
        status: 'error',
        message: error.message || '发生未知定位错误，请稍后重试。',
      }
  }
}
