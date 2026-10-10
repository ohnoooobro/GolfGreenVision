import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { downloadFieldExport } = vi.hoisted(() => ({ downloadFieldExport: vi.fn(() => '{}') }))
const locationState = {
  mode: 'simulated' as const,
  status: 'success' as const,
  location: { latitude: 40.1842613, longitude: 116.4317627, accuracy: 8, altitude: null, heading: null, speed: null, timestamp: Date.parse('2026-09-27T08:00:00.000Z') },
  errorMessage: null,
}

vi.mock('../src/location/useLocation', () => ({
  useLocation: () => ({ state: locationState, setMode: vi.fn(), setSimulatedPosition: vi.fn() }),
}))
vi.mock('../src/field/export', async () => {
  const actual = await vi.importActual<typeof import('../src/field/export')>('../src/field/export')
  return { ...actual, downloadFieldExport }
})

import App from '../src/App'
import { createEmptyFieldTestState, createFieldSession, FIELD_STORAGE_KEY, FIELD_HISTORY_STORAGE_KEY, loadFieldSessionHistory, loadFieldTestState } from '../src/field'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('production Field Test smoke flow', () => {
  beforeEach(() => {
    window.localStorage.clear()
    downloadFieldExport.mockClear()
    locationState.location.timestamp = Date.parse('2026-09-27T08:00:00.000Z')
  })

  it('结束后保留 Session，可重复导出，清除必须显式触发', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: '开始现场测试' }))
    fireEvent.change(screen.getByRole('combobox', { name: '当前实际球洞' }), { target: { value: '1' } })
    fireEvent.click(screen.getByRole('button', { name: '到达发球台' }))
    fireEvent.click(screen.getByRole('button', { name: '结束现场测试' }))

    expect(screen.getAllByText(/数据仍保存在本机/).length).toBeGreaterThan(0)
    expect(window.localStorage.getItem(FIELD_STORAGE_KEY)).toContain('"endTime"')
    fireEvent.click(screen.getByRole('button', { name: '导出本场数据' }))
    fireEvent.click(screen.getByRole('button', { name: '导出本场数据' }))
    expect(downloadFieldExport).toHaveBeenCalledTimes(2)
    expect(window.localStorage.getItem(FIELD_STORAGE_KEY)).not.toBeNull()

    vi.spyOn(window, 'confirm').mockReturnValue(true)
    fireEvent.click(screen.getByText('删除本机当前球局（危险操作）'))
    fireEvent.click(screen.getByRole('button', { name: '删除当前球局' }))
    expect(window.localStorage.getItem(FIELD_STORAGE_KEY)).toBeNull()
  })

  it('Hole 12 蓝 T Tee → 下一场 Hole 13 Green → 刷新 → 两场独立导出', () => {
    const view = render(<App />)
    fireEvent.click(screen.getByRole('button', { name: '开始现场测试' }))
    const firstId = loadFieldTestState().session!.sessionId
    fireEvent.change(screen.getByLabelText('当前实际球洞'), { target: { value: '12' } })
    fireEvent.change(screen.getByLabelText('本洞 T 台类别'), { target: { value: 'blue' } })
    locationState.location.timestamp += 11_000
    view.rerender(<App />)
    fireEvent.click(screen.getByRole('button', { name: '到达发球台' }))
    fireEvent.click(screen.getByText('系统预测与校验（调试，可选）'))
    fireEvent.click(screen.getByRole('button', { name: '暂不确定' }))
    fireEvent.click(screen.getByRole('button', { name: '结束现场测试' }))
    const first = loadFieldTestState()
    expect(first.samples).toHaveLength(1)
    expect(first.samples[0]).toMatchObject({ actualHole: 12, teeCategory: 'blue', sampleType: 'tee' })
    expect(first.confirmationEvents).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: '开始下一场球局' }))
    expect(screen.getByLabelText('当前实际球洞')).toHaveValue('')
    expect(screen.getByLabelText('本洞 T 台类别')).toHaveValue('unknown')
    const secondId = loadFieldTestState().session!.sessionId
    expect(secondId).not.toBe(firstId)
    expect(loadFieldTestState()).toMatchObject({ samples: [], trackPoints: [], confirmationEvents: [], currentActualHole: null, holeTees: {} })
    fireEvent.change(screen.getByLabelText('当前实际球洞'), { target: { value: '13' } })
    expect(screen.getByLabelText('本洞 T 台类别')).toHaveValue('unknown')
    locationState.location.timestamp += 11_000
    view.rerender(<App />)
    fireEvent.click(screen.getByRole('button', { name: '到达果岭' }))
    const second = loadFieldTestState()
    expect(second.samples).toHaveLength(1)
    expect(second.samples[0]).toMatchObject({ actualHole: 13, sampleType: 'green', sessionId: secondId, teeCategory: 'unknown' })
    expect(second.trackPoints.every((p) => p.sessionId === secondId)).toBe(true)
    expect(loadFieldSessionHistory()[0].state).toEqual(first)
    view.unmount()
    render(<App />)
    expect(loadFieldTestState().session!.sessionId).toBe(secondId)
    expect(screen.getByLabelText('当前实际球洞')).toHaveValue('13')
    fireEvent.click(screen.getByRole('button', { name: '导出现场数据' }))
    fireEvent.click(screen.getByText('查看历史球局（1）'))
    fireEvent.click(screen.getByRole('button', { name: '导出 JSON' }))
    expect(downloadFieldExport.mock.calls.map((args) => (args[0] as typeof first).session!.sessionId)).toEqual([secondId, firstId])
    expect(window.localStorage.getItem(FIELD_HISTORY_STORAGE_KEY)).not.toBeNull()
  })

  it('首次打开合成旧版已结束 Session 不写回原件，也不自动归档', () => {
    const session = { ...createFieldSession({ locationMode: 'simulated' }), endTime: '2026-10-08T00:00:00.000Z' }
    const raw = JSON.stringify({ ...createEmptyFieldTestState(), session, legacyField: 'synthetic-original' })
    window.localStorage.setItem(FIELD_STORAGE_KEY, raw)
    render(<App />)
    expect(window.localStorage.getItem(FIELD_STORAGE_KEY)).toBe(raw)
    expect(window.localStorage.getItem(FIELD_HISTORY_STORAGE_KEY)).toBeNull()
    expect(screen.getByRole('button', { name: '开始下一场球局' })).toBeEnabled()
  })
})
