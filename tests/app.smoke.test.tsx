import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

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
import { FIELD_STORAGE_KEY } from '../src/field'

describe('production Field Test smoke flow', () => {
  beforeEach(() => {
    window.localStorage.clear()
    downloadFieldExport.mockClear()
  })

  it('结束后保留 Session，可重复导出，清除必须显式触发', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: '开始现场测试' }))
    fireEvent.change(screen.getByRole('combobox', { name: '当前实际球洞' }), { target: { value: '1' } })
    fireEvent.click(screen.getByRole('button', { name: '到达发球台' }))
    fireEvent.click(screen.getByRole('button', { name: '结束现场测试' }))

    expect(screen.getAllByText(/数据仍保存在本机/).length).toBeGreaterThan(0)
    expect(window.localStorage.getItem(FIELD_STORAGE_KEY)).toContain('"endTime"')
    fireEvent.click(screen.getByRole('button', { name: '导出现场数据' }))
    fireEvent.click(screen.getByRole('button', { name: '导出现场数据' }))
    expect(downloadFieldExport).toHaveBeenCalledTimes(2)
    expect(window.localStorage.getItem(FIELD_STORAGE_KEY)).not.toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '确认已保存后清除' }))
    expect(window.localStorage.getItem(FIELD_STORAGE_KEY)).toBeNull()
  })
})
