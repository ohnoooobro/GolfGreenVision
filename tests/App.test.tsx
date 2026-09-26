import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '../src/App'

afterEach(cleanup)

describe('定位页面', () => {
  it('显示定位字段并支持切换、修改模拟位置', async () => {
    const watchPosition = vi.fn((_success: PositionCallback) => 1)
    const clearWatch = vi.fn()
    Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { watchPosition, clearWatch } })
    render(<App />)
    expect(screen.getByRole('status')).toHaveTextContent('等待定位')
    fireEvent.click(screen.getByRole('button', { name: '模拟定位' }))
    expect(screen.getByText('桌面模拟定位')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('模拟纬度'), { target: { value: '31.2304' } })
    fireEvent.change(screen.getByLabelText('模拟经度'), { target: { value: '121.4737' } })
    fireEvent.click(screen.getByRole('button', { name: '应用模拟位置' }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('定位成功'))
    expect(screen.getByText('31.230400')).toBeInTheDocument()
    expect(screen.getByText('121.473700')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '真实定位' }))
    expect(watchPosition).toHaveBeenCalledTimes(2)
    expect(clearWatch).toHaveBeenCalled()
  })

  it('随模拟位置更新洞号，并支持手动修正后恢复自动判断', async () => {
    const watchPosition = vi.fn((_success: PositionCallback) => 1)
    const clearWatch = vi.fn()
    Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { watchPosition, clearWatch } })
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: '模拟定位' }))

    const automaticHole = () => screen.getByText('自动判断洞号').parentElement as HTMLElement
    const effectiveHole = () => screen.getByText('当前实际使用洞号').parentElement as HTMLElement
    fireEvent.change(screen.getByLabelText('模拟纬度'), { target: { value: '30.0005' } })
    fireEvent.change(screen.getByLabelText('模拟经度'), { target: { value: '120.0003' } })
    fireEvent.click(screen.getByRole('button', { name: '应用模拟位置' }))
    await waitFor(() => expect(automaticHole()).toHaveTextContent('1 洞'))
    expect(effectiveHole()).toHaveTextContent('1 洞')

    fireEvent.change(screen.getByLabelText('手动修正洞号'), { target: { value: '2' } })
    expect(effectiveHole()).toHaveTextContent('2 洞')

    fireEvent.change(screen.getByLabelText('模拟经度'), { target: { value: '120.0023' } })
    fireEvent.click(screen.getByRole('button', { name: '应用模拟位置' }))
    await waitFor(() => expect(automaticHole()).toHaveTextContent('3 洞'))
    expect(effectiveHole()).toHaveTextContent('2 洞')

    fireEvent.change(screen.getByLabelText('手动修正洞号'), { target: { value: '' } })
    expect(effectiveHole()).toHaveTextContent('3 洞')
  })

  it('可切换到净山湖 V0 并展示当前缺少几何的识别状态', async () => {
    const watchPosition = vi.fn((_success: PositionCallback) => 1)
    const clearWatch = vi.fn()
    Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { watchPosition, clearWatch } })
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: '模拟定位' }))
    fireEvent.change(screen.getByLabelText('调试球场'), { target: { value: 'jingshanhu-v0.5' } })
    expect(screen.getByText('净山湖 V0.5 当前有 18 洞的 Par/距离表；Tee、Green 与 centerline 尚未取得可复核坐标，因此自动洞号暂不可用。')).toBeInTheDocument()
    expect(screen.getByLabelText('手动修正洞号').querySelectorAll('option')).toHaveLength(19)
  })
})
