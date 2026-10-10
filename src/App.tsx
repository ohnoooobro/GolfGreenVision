import { useEffect, useMemo, useRef, useState } from 'react'
import { createFieldConfirmationEvent, createHoleSelectionState, inferHole, jingshanhuV0Course, mockDemoCourse, setCorrectedHole, updateInferredHole } from './course'
import type { GolfCourseGeoJSON } from './course'
import { useLocation } from './location/useLocation'
import type { LocationStatus } from './location/types'
import { checkFieldReadiness, createEmptyFieldTestState, createFieldSample, createFieldSession, createFieldTrackPoint, downloadFieldExport, endFieldSession, getFieldCandidateMapping, isFieldCandidateDatasetLoaded, isFieldStateRecoverable, loadFieldSessionHistory, loadFieldTestState, removeCurrentFieldTestState, saveFieldTestState, shouldRecordTrackPoint, startNextFieldSession, undoLastFieldSample, updateFieldSessionStats } from './field'
import { getFieldProgress, getHoleTee, selectFieldHole, selectFieldTee, TEE_CATEGORY_LABELS } from './field'
import type { FieldTestState, TeeCategory } from './field'
import ScorecardView from './scorecard/ScorecardView'

const STATUS_LABELS: Record<LocationStatus, string> = { waiting: '等待定位', success: '定位成功', 'permission-denied': '权限被拒绝', unavailable: '定位不可用', error: '定位错误' }
const GPS_ACCURACY_WARNING_METRES = 25
function formatCoordinate(value: number | undefined): string { return value === undefined ? '—' : value.toFixed(6) }
function formatTimestamp(timestamp: number | undefined): string { return timestamp === undefined ? '—' : new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'medium' }).format(timestamp) }
function formatHole(hole: number | null): string { return hole === null ? '未选择' : `Hole ${hole}` }
function readHistory() { try { return { entries: loadFieldSessionHistory(), error: null as string | null } } catch { return { entries: [], error: '历史球局读取失败，已阻止覆盖历史。请保留本机数据并先导出当前球局。' } } }
function formatQuality(accuracy: number | undefined, status: LocationStatus): { label: string; className: string } { if (status !== 'success' || accuracy === undefined) return { label: '无定位', className: 'quality-none' }; if (accuracy <= 10) return { label: '良好', className: 'quality-good' }; if (accuracy <= GPS_ACCURACY_WARNING_METRES) return { label: '一般', className: 'quality-fair' }; return { label: '较差', className: 'quality-poor' } }
function nextHole(current: number | null, direction: -1 | 1): number | null { if (current === null) return direction === 1 ? 1 : 18; const next = current + direction; return next >= 1 && next <= 18 ? next : current }
function AppNavigation({ activeView, onChange }: { activeView: 'field' | 'scorecard'; onChange: (view: 'field' | 'scorecard') => void }) {
  return <nav className="app-navigation" aria-label="功能模式"><button type="button" className={activeView === 'field' ? 'active' : ''} onClick={() => onChange('field')}>现场测试</button><button type="button" className={activeView === 'scorecard' ? 'active' : ''} onClick={() => onChange('scorecard')}>记分卡</button></nav>
}

export default function App() {
  const { state, setMode, setSimulatedPosition } = useLocation()
  const [latitude, setLatitude] = useState('39.904200')
  const [longitude, setLongitude] = useState('116.407400')
  const [simulationAccuracy, setSimulationAccuracy] = useState('5')
  const [simulationError, setSimulationError] = useState<string | null>(null)
  const [activeCourse, setActiveCourse] = useState<GolfCourseGeoJSON>(mockDemoCourse)
  const location = state.location
  const holeInference = useMemo(() => location ? inferHole(location, activeCourse) : { inferredHole: null, candidates: [], reason: 'outside' as const }, [activeCourse, location])
  const [holeSelection, setHoleSelection] = useState(() => createHoleSelectionState())
  const [fieldData, setFieldData] = useState<FieldTestState>(() => loadFieldTestState())
  const [actualHole, setActualHole] = useState<number | null>(() => fieldData.currentActualHole)
  const [sessionNotes, setSessionNotes] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
  const [storageFailed, setStorageFailed] = useState(false)
  const [showDebug, setShowDebug] = useState(false)
  const [showReadiness, setShowReadiness] = useState(false)
  const [showSamples, setShowSamples] = useState(false)
  const [activeView, setActiveView] = useState<'field' | 'scorecard'>('field')
  const [confirmationMode, setConfirmationMode] = useState<'other' | null>(null)
  const [confirmationHole, setConfirmationHole] = useState(1)
  const [geolocationPermission, setGeolocationPermission] = useState<'granted' | 'prompt' | 'denied' | 'unknown' | 'unsupported'>('unknown')
  const [history, setHistory] = useState(readHistory)
  const sessionHistory = history.entries
  const savedFieldData = useRef(fieldData)
  const sessionActionPending = useRef(false)
  const nextPositionAfter = useRef<number | null>(null)
  const lastTrackPoint = useRef(fieldData.trackPoints.at(-1) ?? null)
  const holeSwitchTimestamp = useRef<number | null>(location?.timestamp ?? null)
  const activeSession = fieldData.session?.endTime === null && fieldData.session !== null
  const quality = formatQuality(location?.accuracy, state.status)
  const currentCandidate = getFieldCandidateMapping(actualHole)
  const currentHoleSamples = fieldData.samples.filter((sample) => sample.actualHole === actualHole)
  const currentTee = getHoleTee(fieldData, actualHole)
  const progress = getFieldProgress(fieldData.samples)
  const currentProgress = progress.holes.find((hole) => hole.hole === actualHole)
  const readiness = useMemo(() => checkFieldReadiness({ locationState: state, candidateDatasetLoaded: isFieldCandidateDatasetLoaded(), geolocationPermission }), [geolocationPermission, state])

  useEffect(() => {
    // 首次读取不能将兼容读取的结果自动写回旧版原件。
    if (fieldData === savedFieldData.current) return
    const hasFieldData = fieldData.session !== null || fieldData.currentActualHole !== null || fieldData.samples.length > 0 || fieldData.confirmationEvents.length > 0 || fieldData.trackPoints.length > 0
    if (hasFieldData) { const saved = saveFieldTestState(fieldData); setStorageFailed(!saved); if (saved) savedFieldData.current = fieldData }
  }, [fieldData])
  useEffect(() => { setHistory(readHistory()) }, [fieldData.session?.sessionId])
  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.permissions?.query) { setGeolocationPermission('unsupported'); return }
    let disposed = false
    navigator.permissions.query({ name: 'geolocation' }).then((permission) => {
      if (disposed) return
      setGeolocationPermission(permission.state)
      permission.addEventListener?.('change', () => setGeolocationPermission(permission.state))
    }).catch(() => { if (!disposed) setGeolocationPermission('unknown') })
    return () => { disposed = true }
  }, [])
  useEffect(() => { setHoleSelection((current) => updateInferredHole(current, holeInference.inferredHole)) }, [holeInference.inferredHole])
  useEffect(() => {
    if (!activeSession || !location || state.status !== 'success' || !fieldData.session) return
    if (nextPositionAfter.current !== null && location.timestamp <= nextPositionAfter.current) return
    if (!shouldRecordTrackPoint(lastTrackPoint.current, location)) return
    const trackPoint = createFieldTrackPoint({ sessionId: fieldData.session.sessionId, actualHole, predictedHole: holeInference.inferredHole, location })
    lastTrackPoint.current = trackPoint
    setFieldData((current) => { if (current.session?.sessionId !== trackPoint.sessionId || current.session.endTime !== null) return current; const trackPoints = [...current.trackPoints, trackPoint]; return { ...current, trackPoints, session: updateFieldSessionStats(current.session, current.samples, trackPoints) } })
  }, [activeSession, actualHole, fieldData.session, holeInference.inferredHole, location, state.status])

  function selectCourse(course: GolfCourseGeoJSON) { setActiveCourse(course); setHoleSelection(createHoleSelectionState()) }
  function applySimulation(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); const nextLatitude = Number(latitude); const nextLongitude = Number(longitude); const nextAccuracy = Number(simulationAccuracy)
    if (!Number.isFinite(nextLatitude) || !Number.isFinite(nextLongitude)) { setSimulationError('请输入有效的纬度和经度。'); return }
    if (!Number.isFinite(nextAccuracy) || nextAccuracy < 0) { setSimulationError('请输入非负的 GPS accuracy。'); return }
    try { setSimulatedPosition({ latitude: nextLatitude, longitude: nextLongitude, accuracy: nextAccuracy }); setSimulationError(null) } catch (error) { setSimulationError(error instanceof Error ? error.message : '模拟位置无效。') }
  }
  function changeActualHole(next: number | null) {
    if (!activeSession) return
    if (next === actualHole) return
    holeSwitchTimestamp.current = location?.timestamp ?? null
    setActualHole(next); setFieldData((current) => selectFieldHole(current, next))
    setNotice('已切换实际洞号。只在当前洞现场采样，漏采无需补齐；请等待本洞的新定位。')
  }
  function startSession() { if (fieldData.session) return; const session = createFieldSession({ notes: sessionNotes, locationMode: state.mode }); const next = { ...createEmptyFieldTestState(), session }; if (!saveFieldTestState(next)) { setNotice('新球局写入失败，未改变本机数据。'); return }; setFieldData(next); setActualHole(null); setNotice('现场测试已开始：选实际洞号 → 选 T 台（不确定也可以）→ 记录 Tee → 记录 Green → 下一洞。'); lastTrackPoint.current = null }
  function restoreSession() { const recovered = loadFieldTestState(); setFieldData(recovered); setActualHole(recovered.currentActualHole); lastTrackPoint.current = recovered.trackPoints.at(-1) ?? null; setNotice('已恢复未完成测试。实际 Hole 仍由你确认。') }
  function stopSession() { if (!activeSession || !fieldData.session) return; const session = endFieldSession(fieldData.session, fieldData.samples, fieldData.trackPoints); setFieldData((current) => ({ ...current, session })); setNotice('测试已结束，数据仍保存在本机。可导出本场数据，或开始下一场安全归档。') }
  function exportCurrent() { if (!fieldData.session) { setNotice('还没有可导出的现场测试。'); return }; downloadFieldExport(fieldData); setNotice('现场 JSON 已导出。请在手机“文件”或分享界面确认文件仍然存在。') }
  function exportHistory(entry: typeof sessionHistory[number]) { downloadFieldExport(entry.state); setNotice(`已导出历史球局 ${entry.state.session?.sessionId.slice(-8) ?? ''}。`) }
  function startNextSession() {
    if (sessionActionPending.current) return
    sessionActionPending.current = true
    const result = startNextFieldSession(fieldData, { locationMode: state.mode })
    setHistory(readHistory())
    if (!result.ok || !result.state) { sessionActionPending.current = false; setNotice(result.error ?? '归档失败，未开始新球局。'); return }
    savedFieldData.current = result.state
    setFieldData(result.state); setActualHole(null); lastTrackPoint.current = null
    nextPositionAfter.current = location?.timestamp ?? null; holeSwitchTimestamp.current = location?.timestamp ?? null
    setConfirmationMode(null); setConfirmationHole(1); setShowSamples(false); setSessionNotes(''); setStorageFailed(false)
    setNotice('上一场已归档，新的现场球局已开始。请重新选洞号和 T 台，并等待新定位。')
  }
  useEffect(() => { sessionActionPending.current = false }, [fieldData.session?.sessionId])
  function clearSession() { if (!window.confirm('仅删除当前球局的样本、轨迹、确认事件、洞号、T 台和关联旧版备份？历史球局和记分卡不会删除。请先确认 JSON 已另存，删除后无法恢复。')) return; try { removeCurrentFieldTestState(); const empty = createEmptyFieldTestState(); savedFieldData.current = empty; setFieldData(empty); setActualHole(null); lastTrackPoint.current = null; setStorageFailed(false); setHistory(readHistory()); setNotice('当前球局及其备份已删除；历史球局仍保留。') } catch { setNotice('删除未完成，请保留页面并先导出当前球局。') } }
  function recordSample(sampleType: 'tee' | 'green') {
    if (!activeSession || !fieldData.session) { setNotice('请先点击“开始现场测试”。'); return }
    if (actualHole === null) { setNotice('请先选择当前实际 Hole，才能保存 Tee / Green。'); return }
    if (!location || state.status !== 'success') { setNotice('尚未收到 GPS 位置，暂不能保存采样。'); return }
    if (state.mode !== fieldData.session.locationMode) { setNotice('定位来源与本轮不一致，请切回本轮定位模式后继续。'); return }
    if ((holeSwitchTimestamp.current !== null && location.timestamp <= holeSwitchTimestamp.current) || (state.mode === 'real' && Date.now() - location.timestamp > 60_000)) { setNotice('请等待切换洞号后的新 GPS 定位；模拟模式请点击“应用模拟位置”。不会将其他洞的旧位置保存到本洞。'); return }
    try {
      const sample = createFieldSample({ sessionId: fieldData.session.sessionId, actualHole, predictedHole: holeInference.inferredHole, location, sampleType, candidateMapping: currentCandidate, teeCategory: currentTee.teeCategory, teeSelectionStatus: currentTee.selectionStatus })
      const samples = [...fieldData.samples, sample]
      setFieldData((current) => ({ ...current, samples, session: current.session ? updateFieldSessionStats(current.session, samples, current.trackPoints) : null }))
      setNotice(location.accuracy > GPS_ACCURACY_WARNING_METRES ? `当前 GPS accuracy ±${location.accuracy.toFixed(1)}m，仍已记录 ${sampleType === 'tee' ? 'Tee' : 'Green'}。` : `${sampleType === 'tee' ? 'Tee' : 'Green'} 已记录（${formatHole(actualHole)}）。`)
    } catch (error) { setNotice(error instanceof Error ? error.message : '保存采样失败。') }
  }
  function undoSample() { if (!activeSession) return; const result = undoLastFieldSample(fieldData.samples); if (!result.removed) { setNotice('没有可撤销的采样。'); return }; setFieldData((current) => ({ ...current, samples: result.samples, session: current.session ? updateFieldSessionStats(current.session, result.samples, current.trackPoints) : null })); setNotice(`已撤销 Hole ${result.removed.actualHole} 的 ${result.removed.sampleType === 'tee' ? 'Tee' : 'Green'} 采样。`) }
  function deleteSample(id: string) { if (!activeSession) return; const sample = fieldData.samples.find((item) => item.id === id); if (!sample) return; const samples = fieldData.samples.filter((item) => item.id !== id); setFieldData((current) => ({ ...current, samples, session: current.session ? updateFieldSessionStats(current.session, samples, current.trackPoints) : null })); setNotice(`已删除 ${sample.sampleType === 'tee' ? 'Tee' : 'Green'} 采样。`) }
  function recordConfirmation(actual: number | 'uncertain') {
    if (!activeSession || !fieldData.session) { setNotice('请先开始现场测试。'); return }
    const event = createFieldConfirmationEvent({ predictedHole: holeInference.inferredHole, actualHole: actual, confirmationSource: 'field', position: location ? { latitude: location.latitude, longitude: location.longitude, accuracy: location.accuracy } : undefined })
    setFieldData((current) => ({ ...current, confirmationEvents: [...current.confirmationEvents, { ...event, sessionId: current.session?.sessionId ?? '' }] })); setConfirmationMode(null); setNotice('现场确认事件已记录。')
  }

  if (activeView === 'scorecard') return <main className="shell"><AppNavigation activeView={activeView} onChange={setActiveView} /><ScorecardView /></main>

  return <main className="shell"><AppNavigation activeView={activeView} onChange={setActiveView} /><section className="status-card" aria-labelledby="app-title">
    <p className="eyebrow">移动端现场测试 · Thread 04.5</p><h1 id="app-title">Golf Green Vision</h1><p className="subtitle">选洞号 → 选 T 台 → 记录 Tee → 记录 Green → 下一洞</p>
    <section className="location-hero" aria-label="定位状态"><div className={`location-status status-${state.status}`} role="status" aria-live="polite"><span className="status-dot" aria-hidden="true" />{STATUS_LABELS[state.status]}</div><div className={`quality-badge ${quality.className}`}>定位：{quality.label}</div><strong className="accuracy-value">accuracy ±{location ? location.accuracy.toFixed(1) : '—'}m</strong></section>
    {state.errorMessage && <p className="error-message">{state.errorMessage}</p>}{notice && <p className="field-notice" role="status">{notice}</p>}
    {storageFailed && <p className="error-message" role="alert">本机自动保存失败，旧备份仍保留。请立即导出当前数据，刷新可能丢失未保存的记录。</p>}
    <dl className="location-grid compact-location-grid"><div><dt>GPS accuracy</dt><dd>{location ? `±${location.accuracy.toFixed(1)} m` : '—'}</dd></div><div><dt>最后更新时间</dt><dd>{formatTimestamp(location?.timestamp)}</dd></div><div><dt>定位来源</dt><dd>{state.mode === 'simulated' ? '模拟模式' : '真实定位'}</dd></div><div><dt>状态</dt><dd>{STATUS_LABELS[state.status]}</dd></div></dl>
    <p className="accuracy-note">accuracy 是浏览器提供的水平精度估计值，不代表球的位置精度。代码阈值：≤10m 良好，10–25m 一般，&gt;25m 较差。</p>
    <details className="debug-details" open={showDebug} onToggle={(event) => setShowDebug((event.currentTarget as HTMLDetailsElement).open)}><summary>调试信息</summary><dl className="location-grid debug-grid"><div><dt>纬度</dt><dd>{formatCoordinate(location?.latitude)}</dd></div><div><dt>经度</dt><dd>{formatCoordinate(location?.longitude)}</dd></div><div><dt>海拔</dt><dd>{location?.altitude === null || location?.altitude === undefined ? '—' : `${location.altitude.toFixed(1)} m`}</dd></div><div><dt>速度 / 航向</dt><dd>{location?.speed === null || location?.speed === undefined ? '—' : `${location.speed.toFixed(1)} m/s`}</dd></div></dl></details>
    <div className="mode-switch" aria-label="定位来源"><button type="button" className={state.mode === 'real' ? 'active' : ''} onClick={() => setMode('real')}>真实定位</button><button type="button" className={state.mode === 'simulated' ? 'active' : ''} onClick={() => setMode('simulated')}>模拟定位</button></div><p className="mode-label">当前处于{state.mode === 'simulated' ? '模拟' : '真实'}模式</p>
    <section className="field-panel" aria-labelledby="field-panel-title"><div className="section-heading"><div><p className="panel-eyebrow">Field Test Mode</p><h2 id="field-panel-title">现场采集</h2></div><span className={`session-badge ${activeSession ? 'session-live' : ''}`}>{activeSession ? '进行中' : fieldData.session ? '已结束' : '未开始'}</span></div>
      <details className="quick-guide"><summary>第一次怎么测？</summary><div className="quick-guide-content"><ol><li>允许位置权限，检查 GPS，开始现场测试。</li><li>选实际洞号，再选本洞 T 台。不知道颜色就选“不确定”。</li><li>在发球台点“到达发球台”，在果岭点“到达果岭”。每洞两次主要采样。</li><li>点“下一洞”。继承的 T 台标为未确认，可直接改色或点确认。</li><li>漏采可以直接跳过，不必补齐，也不要离开后用别处位置追填。</li><li>随时导出，只打部分洞也可以；结束后仍能导出。</li></ol><div className="quick-guide-reminders"><p><strong>不要为了配合软件改变正常打球路线。</strong></p><p><strong>结束后点击“开始下一场球局”即可归档；JSON 请另行保存。</strong></p></div></div></details>
      {!activeSession && !fieldData.session && <div className="start-session-block"><label className="notes-field"><span>本轮备注（可选）</span><textarea value={sessionNotes} onChange={(event) => setSessionNotes(event.target.value)} rows={2} placeholder="例如：白 tee，上午 8:00" /></label><button type="button" className="primary-action" onClick={startSession}>开始现场测试</button></div>}
      {!activeSession && isFieldStateRecoverable(fieldData) && <button type="button" className="secondary-action full-action" onClick={restoreSession}>恢复未完成测试</button>}
      {fieldData.session && <p className="session-meta">Session {fieldData.session?.sessionId}<br />开始于 {fieldData.session ? new Date(fieldData.session.startTime).toLocaleString('zh-CN') : '—'}</p>}
      <div className="actual-hole-block"><div className="section-label">当前实际球洞</div><div className="hole-stepper"><button type="button" aria-label="上一洞" disabled={!activeSession || actualHole === 1} onClick={() => changeActualHole(nextHole(actualHole, -1))}>上一洞</button><select aria-label="当前实际球洞" disabled={!activeSession} value={actualHole ?? ''} onChange={(event) => changeActualHole(event.target.value ? Number(event.target.value) : null)}><option value="">请选择 Hole</option>{Array.from({ length: 18 }, (_, index) => index + 1).map((hole) => <option key={hole} value={hole}>Hole {hole}</option>)}</select><button type="button" aria-label="下一洞" disabled={!activeSession || actualHole === 18} onClick={() => changeActualHole(nextHole(actualHole, 1))}>下一洞</button></div><p className="hole-control-note">只记录当前洞现场的位置，漏采可跳过，不要离开后追填。</p></div>
      <div className="tee-selection-block"><label htmlFor="field-tee">本洞 T 台类别</label><select id="field-tee" disabled={actualHole === null || !activeSession} value={currentTee.teeCategory} onChange={(event) => actualHole !== null && setFieldData((current) => selectFieldTee(current, actualHole, event.target.value as TeeCategory))}>{Object.entries(TEE_CATEGORY_LABELS).map(([category, label]) => <option key={category} value={category}>{label}</option>)}</select><p>{actualHole === null ? '请先选择实际洞号。' : currentTee.selectionStatus === 'inherited' ? '沿用上一洞，尚未确认；可修改，或保持未确认采集。' : currentTee.teeCategory === 'unknown' ? '类别不确定，可以继续采集，保存为 unknown。' : '本洞类别已明确选择。更改类别不会改写以前的样本。'}</p>{currentTee.selectionStatus === 'inherited' && activeSession && actualHole !== null && <button type="button" className="secondary-action" onClick={() => setFieldData((current) => selectFieldTee(current, actualHole, currentTee.teeCategory))}>确认本洞 T 台</button>}</div>
      <div className="hole-collection-status" aria-label="本洞采集状态"><strong>{formatHole(actualHole)} · {TEE_CATEGORY_LABELS[currentTee.teeCategory]}{currentTee.selectionStatus === 'inherited' ? '（沿用，未确认）' : ''}</strong><span>Tee：{currentProgress?.tee ? '已记录' : '未记录'} · Green：{currentProgress?.green ? '已记录' : '未记录'}</span><span>{currentProgress?.tee && currentProgress?.green ? '本洞完成' : '本洞未完整采集，可直接下一洞'}</span><span>GPS：{quality.label} · ±{location?.accuracy.toFixed(1) ?? '—'} m</span></div>
      <details className="debug-details prediction-debug"><summary>系统预测与校验（调试，可选）</summary>
      <div className="prediction-row"><div><span className="section-label">系统预测</span><strong>{formatHole(holeInference.inferredHole)}</strong></div><div><span className="section-label">候选状态</span><strong>{currentCandidate?.status ?? 'unknown'}</strong></div><div><span className="section-label">排序分</span><strong>{currentCandidate?.score === null || currentCandidate?.score === undefined ? '—' : currentCandidate.score.toFixed(2)}</strong></div></div><p className="candidate-note">候选排序分只是排序依据，不是正确概率。当前实际 Hole 的候选会随样本保存。</p>
      <section className="confirmation-panel" aria-labelledby="confirmation-title"><h3 id="confirmation-title">系统判断</h3><div className="confirmation-actions"><button type="button" onClick={() => recordConfirmation(holeInference.inferredHole ?? 'uncertain')} disabled={holeInference.inferredHole === null}>正确</button><button type="button" onClick={() => setConfirmationMode('other')}>实际是其他洞</button><button type="button" onClick={() => recordConfirmation('uncertain')}>暂不确定</button></div>{actualHole !== null && holeInference.inferredHole !== null && <button type="button" className="quick-confirm" onClick={() => recordConfirmation(actualHole)}>用当前实际 Hole 校验系统预测</button>}{confirmationMode === 'other' && <div className="confirmation-select"><label>实际洞号<select aria-label="确认实际洞号" value={confirmationHole} onChange={(event) => setConfirmationHole(Number(event.target.value))}>{Array.from({ length: 18 }, (_, index) => index + 1).map((hole) => <option key={hole} value={hole}>Hole {hole}</option>)}</select></label><button type="button" onClick={() => recordConfirmation(confirmationHole)}>保存确认</button></div>}</section>
      </details>
      <div className="sample-actions"><button type="button" className="sample-button tee-button" disabled={!activeSession || actualHole === null} onClick={() => recordSample('tee')}>到达发球台</button><button type="button" className="sample-button green-button" disabled={!activeSession || actualHole === null} onClick={() => recordSample('green')}>到达果岭</button></div>
      {quality.label === '较差' && <p className="error-message">GPS 精度较差，仍可一键记录；样本会保留此精度。</p>}
      <p className="sample-meaning">Green 是到达果岭区域的位置，不代表旗杆或官方果岭中心。每次点击独立保存，不覆盖旧样本。</p>
      <div className="sample-summary" aria-label="全场采集进度"><span>已记录 Tee：{progress.teeCount}/18</span><span>已记录 Green：{progress.greenCount}/18</span><span>完整采集：{progress.completedHoles.length}/18</span></div>
      <details className="missing-holes"><summary>漏采：{18 - progress.completedHoles.length} 洞（可不补齐）</summary><p>部分采集：{progress.partialHoles.map((h) => `Hole ${h.hole} 缺 ${h.tee ? 'Green' : 'Tee'}`).join('；') || '无'}</p><p>整洞未记录：{progress.unrecordedHoles.join('、') || '无'}</p></details>
      <div className="field-toolbar"><button type="button" className="secondary-action" onClick={undoSample} disabled={!activeSession || fieldData.samples.length === 0}>撤销上一条采样</button><button type="button" className="secondary-action" onClick={() => setShowSamples((value) => !value)}>{showSamples ? '收起本洞样本' : '查看本洞样本'}</button></div>
      {showSamples && <div className="sample-list">{currentHoleSamples.length === 0 ? <p>当前 Hole 暂无采样。</p> : currentHoleSamples.map((sample) => <div className="sample-row" key={sample.id}><span>{sample.sampleType === 'tee' ? 'Tee' : 'Green'} · {TEE_CATEGORY_LABELS[sample.teeCategory ?? 'unknown']}{sample.teeSelectionStatus === 'inherited' ? '（未确认）' : ''} · {new Date(sample.timestamp).toLocaleTimeString('zh-CN')} · ±{sample.accuracy.toFixed(1)}m</span><button type="button" disabled={!activeSession} aria-label={`删除${sample.sampleType === 'tee' ? ' Tee' : ' Green'}采样`} onClick={() => deleteSample(sample.id)}>删除</button></div>)}</div>}
      {fieldData.session && <><p className="session-retention-note">只打部分洞也可随时导出。结束后数据仍保存在本机；开始下一场会先归档旧球局，不需要删除数据。</p><div className="session-actions"><button type="button" className="secondary-action" onClick={exportCurrent}>{activeSession ? '导出现场数据' : '导出本场数据'}</button>{activeSession ? <button type="button" className="primary-action" onClick={stopSession}>结束现场测试</button> : <><button type="button" className="primary-action" onClick={startNextSession}>开始下一场球局</button></>}</div></>}
      {history.error && <p className="error-message" role="alert">{history.error}</p>}
      {fieldData.session && !activeSession && <details className="debug-details"><summary>删除本机当前球局（危险操作）</summary><p>仅删除当前球局及其关联备份，不删除本机历史或记分卡。开始下一场无需删除。</p><button type="button" className="danger-action" onClick={clearSession}>删除当前球局</button></details>}
      {sessionHistory.length > 0 && <details className="history-panel"><summary>查看历史球局（{sessionHistory.length}）</summary><p className="session-retention-note">历史只保存在当前浏览器本地，不是永久备份；请另行保存导出的 JSON。</p><div className="history-list">{sessionHistory.slice().reverse().map((entry) => { const session = entry.state.session; if (!session) return null; return <div className="history-row" key={session.sessionId}><div><strong>{new Date(session.startTime).toLocaleDateString('zh-CN')} · {session.sessionId.slice(-8)}</strong><span>Tee {entry.state.samples.filter((s) => s.sampleType === 'tee').length} · Green {entry.state.samples.filter((s) => s.sampleType === 'green').length} · {session.endTime ? '已结束' : '进行中'}</span></div><button type="button" className="secondary-action" onClick={() => exportHistory(entry)}>导出 JSON</button></div> })}</div></details>}
    </section>
    <details className="readiness-panel" open={showReadiness} onToggle={(event) => setShowReadiness((event.currentTarget as HTMLDetailsElement).open)}><summary>测试准备检查</summary><div className="readiness-list">{readiness.map((check) => <div className={check.ok ? 'readiness-item ok' : 'readiness-item'} key={check.key}><span aria-hidden="true">{check.ok ? '✓' : '!'}</span><span><strong>{check.label}</strong><small>{check.detail}</small></span></div>)}</div><p className="readiness-result">{readiness.every((check) => check.ok) ? '准备完成' : '请先处理标记为 ! 的项目；定位权限和 GPS 返回可能需要在现场等待。'}</p></details>
    {state.mode === 'simulated' && <><form className="simulation-panel" onSubmit={applySimulation}><h2>桌面模拟定位</h2><p>修改经纬度或 accuracy 后点击应用，页面会使用统一定位接口更新位置。</p><div className="simulation-fields"><label>纬度<input aria-label="模拟纬度" inputMode="decimal" value={latitude} onChange={(event) => setLatitude(event.target.value)} /></label><label>经度<input aria-label="模拟经度" inputMode="decimal" value={longitude} onChange={(event) => setLongitude(event.target.value)} /></label><label>accuracy（米）<input aria-label="模拟 accuracy" inputMode="decimal" value={simulationAccuracy} onChange={(event) => setSimulationAccuracy(event.target.value)} /></label></div><button className="apply-button" type="submit">应用模拟位置</button>{simulationError && <p className="error-message">{simulationError}</p>}</form><section className="hole-debug-panel" aria-labelledby="hole-debug-title"><div className="hole-debug-heading"><div><p className="panel-eyebrow">Mock / Demo</p><h2 id="hole-debug-title">洞号识别调试</h2></div><span className="demo-badge">{activeCourse.properties.demo ? '模拟球场' : '真实资料 V0.5'}</span></div><label className="correction-field"><span>调试球场</span><select aria-label="调试球场" value={activeCourse.properties.id} onChange={(event) => selectCourse(event.target.value === jingshanhuV0Course.properties.id ? jingshanhuV0Course : mockDemoCourse)}><option value={mockDemoCourse.properties.id}>Mock / Demo（3 洞）</option><option value={jingshanhuV0Course.properties.id}>净山湖 V0.5（18 洞，空间待配准）</option></select></label><dl className="hole-debug-grid"><div><dt>自动判断洞号</dt><dd>{holeInference.inferredHole === null ? '无法确定' : `${holeInference.inferredHole} 洞`}</dd></div><div><dt>当前实际使用洞号</dt><dd>{holeSelection.effectiveHole === null ? '无法确定' : `${holeSelection.effectiveHole} 洞`}</dd></div><div><dt>候选洞号</dt><dd>{holeInference.candidates.length ? holeInference.candidates.map((hole) => `${hole} 洞`).join('、') : '无'}</dd></div></dl><label className="correction-field"><span>手动修正洞号</span><select aria-label="手动修正洞号" value={holeSelection.correctedHole ?? ''} onChange={(event) => setHoleSelection((current) => setCorrectedHole(current, event.target.value ? Number(event.target.value) : null, activeCourse.features.map((feature) => feature.properties.hole)))}><option value="">不修正（使用自动判断）</option>{activeCourse.features.map((feature) => <option key={feature.properties.hole} value={feature.properties.hole}>{feature.properties.hole} 洞</option>)}</select></label>{!activeCourse.properties.demo && <p className="hole-hint">净山湖 V0.5 当前有 {activeCourse.features.length} 洞的 Par/距离表；Tee、Green 与 centerline 尚未取得可复核坐标，因此自动洞号暂不可用。</p>}{holeInference.reason === 'outside' && <p className="hole-hint">当前点位不在任何模拟球洞区域内，无法确定洞号。</p>}{holeInference.reason === 'multiple-match' && <p className="hole-hint">当前位置命中多个相邻区域，按最小洞号规则暂定为 {holeInference.inferredHole} 洞。</p>}{holeSelection.correctedHole !== null && <p className="hole-hint">已使用手动修正：界面当前显示 {holeSelection.effectiveHole} 洞。</p>}</section></>}
  </section></main>
}
