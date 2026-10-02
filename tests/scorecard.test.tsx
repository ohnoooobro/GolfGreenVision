import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { jingshanhuV05Course } from '../src/course'
import { calculateStats, formatRelative, getTeeOptions } from '../src/scorecard/calculations'
import { createScorecardSession, loadScorecardSession, saveScorecardSession } from '../src/scorecard/persistence'
import { SCORECARD_STORAGE_KEY, createPlayer } from '../src/scorecard/types'
import ScorecardView from '../src/scorecard/ScorecardView'

afterEach(() => cleanup())

function memoryStorage(): Storage {
  const values = new Map<string, string>()
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value) },
    removeItem: (key) => { values.delete(key) },
    clear: () => { values.clear() },
    key: (index) => [...values.keys()][index] ?? null,
    get length() { return values.size },
  }
}

describe('多人记分卡计算与存储', () => {
  it('只使用已填写洞计算 OUT、IN、TOTAL 和相对 Par', () => {
    const player = createPlayer(1)
    player.scores[0] = 5
    player.scores[1] = 4
    player.scores[5] = 3
    const stats = calculateStats(player, jingshanhuV05Course)
    expect(stats.strokes).toBe(12)
    expect(stats.par).toBe(11)
    expect(stats.relative).toBe(1)
    expect(stats.completedHoles).toBe(3)
    expect(stats.inStrokes).toBeNull()
    expect(formatRelative(stats.relative)).toBe('+1')
  })

  it('支持 82 (+10)、低于标准杆和 Even', () => {
    const player = createPlayer(1)
    player.scores = [5, 5, 6, 5, 5, 4, 6, 5, 4, 6, 5, 4, 5, 5, 6, 5, 4, 5]
    const stats = calculateStats(player, jingshanhuV05Course)
    expect(stats.totalStrokes).toBe(90)
    expect(stats.totalRelative).toBe(18)
    const eightTwo = createPlayer(2)
    eightTwo.scores = jingshanhuV05Course.features.map((feature, index) => (feature.properties.par ?? 4) + (index < 10 ? 1 : 0))
    expect(calculateStats(eightTwo, jingshanhuV05Course).totalStrokes).toBe(82)
    expect(calculateStats(eightTwo, jingshanhuV05Course).totalRelative).toBe(10)
    const under = createPlayer(3)
    under.scores = jingshanhuV05Course.features.map((feature, index) => (feature.properties.par ?? 4) - (index < 4 ? 1 : 0))
    expect(formatRelative(calculateStats(under, jingshanhuV05Course).totalRelative)).toBe('-4')
    const even = createPlayer(4)
    even.scores = jingshanhuV05Course.features.map((feature) => feature.properties.par)
    expect(formatRelative(calculateStats(even, jingshanhuV05Course).totalRelative)).toBe('E')
  })

  it('仅使用球场数据中的 Tee，并独立保存每位玩家的 Tee', () => {
    expect(getTeeOptions(jingshanhuV05Course)).toEqual(['gold', 'blue', 'white', 'red'])
    const session = createScorecardSession()
    session.players[0].tee = 'blue'
    session.players.push({ ...createPlayer(2), tee: 'white' })
    const storage = memoryStorage()
    expect(saveScorecardSession(session, storage)).toBe(true)
    expect(loadScorecardSession(storage)?.players.map((player) => player.tee)).toEqual(['blue', 'white'])
  })

  it('记分卡使用独立 localStorage namespace，不触碰 Field Test key', () => {
    const storage = memoryStorage()
    storage.setItem('golf-green-vision.field-test.v1', '{"keep":true}')
    saveScorecardSession(createScorecardSession(), storage)
    expect(storage.getItem(SCORECARD_STORAGE_KEY)).toBeTruthy()
    expect(storage.getItem('golf-green-vision.field-test.v1')).toBe('{"keep":true}')
  })
})

describe('记分卡界面', () => {
  it('支持 4 人同屏、第五人禁止添加、改名、改 Tee、加减杆和总览', () => {
    window.localStorage.clear()
    render(<ScorecardView />)
    const addButton = screen.getByRole('button', { name: /添加玩家/ })
    fireEvent.click(addButton)
    fireEvent.click(addButton)
    fireEvent.click(addButton)
    expect(screen.getByText('添加玩家 4/4')).toBeDisabled()
    expect(screen.getAllByLabelText(/姓名$/)).toHaveLength(4)
    fireEvent.change(screen.getAllByLabelText(/姓名$/)[0], { target: { value: '张三' } })
    fireEvent.change(screen.getAllByLabelText(/Tee$/)[1], { target: { value: 'white' } })
    fireEvent.click(screen.getByRole('button', { name: '张三增加杆数' }))
    expect(screen.getByLabelText('张三第1洞杆数')).toHaveValue('1')
    fireEvent.click(screen.getByRole('button', { name: '张三减少杆数' }))
    expect(screen.getByLabelText('张三第1洞杆数')).toHaveValue('1')
    fireEvent.click(screen.getByRole('button', { name: '记分卡总览' }))
    expect(screen.getByRole('table')).toBeInTheDocument()
    expect(screen.getByText('TOTAL')).toBeInTheDocument()
  })

  it('删除玩家时至少保留一名玩家，新建记分卡需要确认', () => {
    window.localStorage.clear()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<ScorecardView />)
    fireEvent.click(screen.getByRole('button', { name: /删除 球员 1/ }))
    expect(screen.getByLabelText('球员 1姓名')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '新建记分卡' }))
    expect(confirm).toHaveBeenCalled()
    confirm.mockRestore()
  })
})
