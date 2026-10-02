import { useEffect, useMemo, useState } from 'react'
import { jingshanhuV05Course } from '../course'
import { calculateStats, formatRelative, formatScore, getTeeOptions, getYardage } from './calculations'
import { clearScorecardSession, createScorecardSession, loadScorecardSession, saveScorecardSession } from './persistence'
import { MAX_PLAYERS, MAX_STROKES, MIN_STROKES, createPlayer } from './types'
import type { ScorecardPlayer, ScorecardSession, Tee } from './types'

const TEE_LABELS: Record<Tee, string> = { gold: 'Gold', blue: 'Blue', white: 'White', red: 'Red' }
const AVATARS = ['🙂', '🧢', '😎', '⛳', '🏌️', '🌿', '⭐', '🦅']

function summaryText(strokes: number | null, relative: number | null): string {
  return `${formatScore(strokes)} (${formatRelative(relative)})`
}

export default function ScorecardView() {
  const [session, setSession] = useState<ScorecardSession>(() => loadScorecardSession() ?? createScorecardSession())
  const [mode, setMode] = useState<'play' | 'overview'>('play')
  const [nine, setNine] = useState<'out' | 'in'>('out')
  const [currentHole, setCurrentHole] = useState(1)
  const [notice, setNotice] = useState<string | null>(null)
  const teeOptions = useMemo(() => getTeeOptions(jingshanhuV05Course), [])
  const holes = jingshanhuV05Course.features
    .map((feature) => feature.properties)
    .sort((left, right) => left.hole - right.hole)
  const outPar = holes.slice(0, 9).reduce<number>((sum, hole) => sum + (hole.par ?? 0), 0)
  const inPar = holes.slice(9, 18).reduce<number>((sum, hole) => sum + (hole.par ?? 0), 0)

  useEffect(() => { saveScorecardSession(session) }, [session])

  function updatePlayer(playerId: string, patch: Partial<ScorecardPlayer>) {
    setSession((current) => ({ ...current, players: current.players.map((player) => player.playerId === playerId ? { ...player, ...patch } : player) }))
  }

  function setScore(playerId: string, hole: number, value: number | null) {
    const score = value === null ? null : Math.max(MIN_STROKES, Math.min(MAX_STROKES, Math.trunc(value)))
    setSession((current) => ({ ...current, players: current.players.map((player) => {
      if (player.playerId !== playerId) return player
      const scores = [...player.scores]
      scores[hole - 1] = score
      return { ...player, scores }
    }) }))
  }

  function adjustScore(player: ScorecardPlayer, delta: -1 | 1) {
    const current = player.scores[currentHole - 1]
    if (current === null && delta < 0) return
    setScore(player.playerId, currentHole, (current ?? 0) + delta)
  }

  function addPlayer() {
    if (session.players.length >= MAX_PLAYERS) { setNotice('同组最多支持 4 名玩家。'); return }
    setSession((current) => ({ ...current, players: [...current.players, createPlayer(current.players.length + 1, teeOptions.includes('blue') ? 'blue' : teeOptions[0] ?? 'blue')] }))
    setNotice(null)
  }

  function removePlayer(playerId: string) {
    if (session.players.length <= 1) { setNotice('至少保留 1 名玩家才能继续记分。'); return }
    setSession((current) => ({ ...current, players: current.players.filter((player) => player.playerId !== playerId) }))
  }

  function cycleAvatar(player: ScorecardPlayer) {
    const index = AVATARS.indexOf(player.avatar)
    updatePlayer(player.playerId, { avatar: AVATARS[(index + 1) % AVATARS.length] })
  }

  function newScorecard() {
    if (window.confirm('确定新建记分卡吗？当前本地成绩会被清空。')) {
      clearScorecardSession()
      setSession(createScorecardSession())
      setCurrentHole(1)
      setNine('out')
      setMode('play')
      setNotice('已新建记分卡。')
    }
  }

  function setNineAndHole(nextNine: 'out' | 'in') {
    setNine(nextNine)
    setCurrentHole(nextNine === 'out' ? 1 : 10)
  }

  return <section className="scorecard-card" aria-labelledby="scorecard-title">
    <div className="scorecard-heading">
      <div><p className="panel-eyebrow">Scorecard Mode</p><h1 id="scorecard-title">高尔夫记分卡</h1><p className="scorecard-subtitle">净山湖 · 记录每位球员的实际总杆数</p></div>
      <button type="button" className="secondary-action" onClick={newScorecard}>新建记分卡</button>
    </div>
    {notice && <p className="scorecard-notice" role="status">{notice}</p>}
    <div className="scorecard-toolbar" aria-label="记分卡视图">
      <div className="segmented-control"><button type="button" className={mode === 'play' ? 'active' : ''} onClick={() => setMode('play')}>当前记分</button><button type="button" className={mode === 'overview' ? 'active' : ''} onClick={() => setMode('overview')}>记分卡总览</button></div>
      <div className="segmented-control"><button type="button" className={nine === 'out' ? 'active' : ''} onClick={() => setNineAndHole('out')}>前九 · OUT</button><button type="button" className={nine === 'in' ? 'active' : ''} onClick={() => setNineAndHole('in')}>后九 · IN</button></div>
    </div>
    {mode === 'play' ? <>
      <div className="hole-picker" aria-label="选择洞号">{Array.from({ length: nine === 'out' ? 9 : 9 }, (_, index) => (nine === 'out' ? index + 1 : index + 10)).map((hole) => <button type="button" key={hole} className={currentHole === hole ? 'active' : ''} onClick={() => setCurrentHole(hole)}>{hole}</button>)}</div>
      <section className="current-hole" aria-labelledby="current-hole-title"><div className="current-hole-heading"><div><p className="panel-eyebrow">{currentHole <= 9 ? 'OUT · 前九' : 'IN · 后九'}</p><h2 id="current-hole-title">Hole {currentHole}</h2></div><strong>Par {holes[currentHole - 1]?.par ?? '—'}</strong></div>
        <div className="player-score-list">{session.players.map((player) => {
          const score = player.scores[currentHole - 1]
          const yardage = getYardage(jingshanhuV05Course, currentHole, player.tee)
          return <article className="player-score-row" key={player.playerId}>
            <div className="player-identity"><button type="button" className="avatar-button" aria-label={`更换${player.name}头像`} onClick={() => cycleAvatar(player)}>{player.avatar}</button><div className="player-fields"><input aria-label={`${player.name}姓名`} value={player.name} onChange={(event) => updatePlayer(player.playerId, { name: event.target.value })} /><select aria-label={`${player.name} Tee`} value={player.tee} onChange={(event) => updatePlayer(player.playerId, { tee: event.target.value as Tee })}>{teeOptions.map((tee) => <option value={tee} key={tee}>{TEE_LABELS[tee]} Tee</option>)}</select>{yardage !== null && <small>{TEE_LABELS[player.tee]} · {yardage} yd</small>}</div></div>
            <div className="score-controls"><button type="button" aria-label={`${player.name}减少杆数`} onClick={() => adjustScore(player, -1)} disabled={score === null || score <= MIN_STROKES}>−</button><input aria-label={`${player.name}第${currentHole}洞杆数`} inputMode="numeric" min={MIN_STROKES} max={MAX_STROKES} value={score ?? ''} placeholder="—" onChange={(event) => setScore(player.playerId, currentHole, event.target.value === '' ? null : Number(event.target.value))} /><button type="button" aria-label={`${player.name}增加杆数`} onClick={() => adjustScore(player, 1)}>+</button></div>
          </article>
        })}</div>
      </section>
      <div className="player-management"><button type="button" className="primary-action" onClick={addPlayer} disabled={session.players.length >= MAX_PLAYERS}>添加玩家 {session.players.length}/{MAX_PLAYERS}</button><div className="player-delete-list">{session.players.map((player) => <button type="button" key={player.playerId} className="text-action" onClick={() => removePlayer(player.playerId)}>删除 {player.name || '玩家'}</button>)}</div></div>
      <div className="score-summary-grid">{session.players.map((player) => { const stats = calculateStats(player, jingshanhuV05Course); return <div className="score-summary" key={player.playerId}><span>{player.avatar} {player.name || '未命名'}</span><strong>{summaryText(stats.strokes, stats.relative)}</strong><small>已完成 {stats.completedHoles}/18 洞</small></div> })}</div>
    </> : <div className="overview-table-wrap"><table className="scorecard-table"><thead><tr><th>Hole</th><th>Par</th>{session.players.map((player) => <th key={player.playerId}>{player.avatar} {player.name || '未命名'}</th>)}</tr></thead><tbody>{holes.map((hole) => <tr key={hole.hole}><th>Hole {hole.hole}</th><td>{hole.par ?? '—'}</td>{session.players.map((player) => <td key={player.playerId}>{formatScore(player.scores[hole.hole - 1])}</td>)}</tr>)}<tr className="summary-row"><th>OUT</th><td>{outPar}</td>{session.players.map((player) => { const stats = calculateStats(player, jingshanhuV05Course); return <td key={player.playerId}>{summaryText(stats.outStrokes, stats.outRelative)}</td> })}</tr><tr className="summary-row"><th>IN</th><td>{inPar}</td>{session.players.map((player) => { const stats = calculateStats(player, jingshanhuV05Course); return <td key={player.playerId}>{summaryText(stats.inStrokes, stats.inRelative)}</td> })}</tr><tr className="summary-row total-row"><th>TOTAL</th><td>{outPar + inPar}</td>{session.players.map((player) => { const stats = calculateStats(player, jingshanhuV05Course); return <td key={player.playerId}>{summaryText(stats.totalStrokes, stats.totalRelative)}</td> })}</tr></tbody></table></div>}
    <p className="scorecard-footnote">未填写的洞显示为 —，只用已完成洞的实际杆数与对应 Par 计算相对成绩。</p>
  </section>
}
