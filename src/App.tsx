import { useEffect, useMemo, useRef, useState } from 'react'
import { createFieldConfirmationEvent, createHoleSelectionState, inferHole, jingshanhuV0Course, mockDemoCourse, setCorrectedHole, updateInferredHole } from './course'
import type { GolfCourseGeoJSON } from './course'
import { useLocation } from './location/useLocation'
import type { LocationStatus } from './location/types'
import { checkFieldReadiness, createEmptyFieldTestState, createFieldSample, createFieldSession, createFieldTrackPoint, downloadFieldExport, endFieldSession, getFieldCandidateMapping, isFieldStateRecoverable, loadFieldTestState, saveFieldTestState, shouldRecordTrackPoint, undoLastFieldSample, updateFieldSessionStats } from './field'
import type { FieldTestState } from './field'

const STATUS_LABELS: Record<LocationStatus, string> = { waiting: '等待定位', success: '定位成功', 'permission-denied': '权限被拒绝', unavailable: '定位不可用', error: '定位错误' }
const GPS_ACCURACY_WARNING_METRES = 25
function formatCoordinate(value: number | undefined): string { return value === undefined ? '—' : value.toFixed(6) }
function formatTimestamp(timestamp: number | undefined): string { return timestamp === undefined ? '—' : new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'medium' }).format(timestamp) }
function formatHole(hole: number | null): string { return hole === null ? '未选择' : `Hole ${hole}` }
function formatQuality(accuracy: number | undefined, status: LocationStatus): { label: string; className: string } { if (status !== 'success' || accuracy === undefined) return { label: '无定位', className: 'quality-none' }; if (accuracy <= 10) return { label: '良好', className: 'quality-good' }; if (accuracy <= GPS_ACCURACY_WARNING_METRES) return { label: '一般', className: 'quality-fair' }; return { label: '较差', className: 'quality-poor' } }
function nextHole(current: number | null, direction: -1 | 1): number | null { if (current === null) return direction === 1 ? 1 : 18; const next = current + direction; return next >= 1 && next <= 18 ? next : current }

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
  const [showDebug, setShowDebug] = useState(false)
  const [showReadiness, setShowReadiness] = useState(false)
  const [showSamples, setShowSamples] = useState(false)
  const [confirmationMode, setConfirmationMode] = useState<'other' | null>(null)
  const [confirmationHole, setConfirmationHole] = useState(1)
  const lastTrackPoint = useRef(fieldData.trackPoints.at(-1) ?? null)
  const activeSession = fieldData.session?.endTime === null && fieldData.session !== null
  const quality = formatQuality(location?.accuracy, state.status)
  const currentCandidate = getFieldCandidateMapping(actualHole)
  const currentHoleSamples = fieldData.samples.filter((sample) => sample.actualHole === actualHole)
  const readiness = useMemo(() => checkFieldReadiness({ locationState: state, candidateDatasetLoaded: true }), [state])

  useEffect(() => { saveFieldTestState(fieldData) }, [fieldData])
  useEffect(() => { setHoleSelection((current) => updateInferredHole(current, holeInference.inferredHole)) }, [holeInference.inferredHole])
  useEffect(() => {
    if (!activeSession || !location || state.status !== 'success' || !fieldData.session) return
    if (!shouldRecordTrackPoint(lastTrackPoint.current, location)) return
    const trackPoint = createFieldTrackPoint({ sessionId: fieldData.session.sessionId, actualHole, predictedHole: holeInference.inferredHole, location })
    lastTrackPoint.current = trackPoint
    setFieldData((current) => { const trackPoints = [...current.trackPoints, trackPoint]; return { ...current, trackPoints, session: current.session ? updateFieldSessionStats(current.session, current.samples, trackPoints) : null } })
  }, [activeSession, actualHole, fieldData.session, holeInference.inferredHole, location, state.status])

  function selectCourse(course: GolfCourseGeoJSON) { setActiveCourse(course); setHoleSelection(createHoleSelectionState()) }
  function applySimulation(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); const nextLatitude = Number(latitude); const nextLongitude = Number(longitude); const nextAccuracy = Number(simulationAccuracy)
    if (!Number.isFinite(nextLatitude) || !Number.isFinite(nextLongitude)) { setSimulationError('请输入有效的纬度和经度。'); return }
    if (!Number.isFinite(nextAccuracy) || nextAccuracy < 0) { setSimulationError('请输入非负的 GPS accuracy。'); return }
    try { setSimulatedPosition({ latitude: nextLatitude, longitude: nextLongitude, accuracy: nextAccuracy }); setSimulationError(null) } catch (error) { setSimulationError(error instanceof Error ? error.message : '模拟位置无效。') }
  }
  function changeActualHole(next: number | null) { setActualHole(next); setFieldData((current) => current.currentActualHole === next ? current : { ...current, currentActualHole: next }) }
  function startSession() { const session = createFieldSession({ notes: sessionNotes, locationMode: state.mode }); setFieldData({ ...createEmptyFieldTestState(), session }); setActualHole(null); setNotice('现场测试已开始。请先选择当前实际 Hole，再记录 Tee 或 Green。'); lastTrackPoint.current = null }
  function restoreSession() { const recovered = loadFieldTestState(); setFieldData(recovered); setActualHole(recovered.currentActualHole); lastTrackPoint.current = recovered.trackPoints.at(-1) ?? null; setNotice('已恢复未完成测试。实际 Hole 仍由你确认。') }
  function stopAndExport() { if (!fieldData.session) return; const session = endFieldSession(fieldData.session, fieldData.samples, fieldData.trackPoints); const next = { ...fieldData, session }; setFieldData(next); downloadFieldExport(next); setNotice('测试已结束，JSON 已导出。') }
  function exportCurrent() { if (!fieldData.session) { setNotice('还没有可导出的现场测试。'); return }; downloadFieldExport(fieldData); setNotice('现场 JSON 已导出。') }
  function recordSample(sampleType: 'tee' | 'green') {
    if (!activeSession || !fieldData.session) { setNotice('请先点击“开始现场测试”。'); return }
    if (actualHole === null) { setNotice('请先选择当前实际 Hole，才能保存 Tee / Green。'); return }
    if (!location || state.status !== 'success') { setNotice('尚未收到 GPS 位置，暂不能保存采样。'); return }
    try {
      const sample = createFieldSample({ sessionId: fieldData.session.sessionId, actualHole, predictedHole: holeInference.inferredHole, location, sampleType, candidateMapping: currentCandidate })
      const samples = [...fieldData.samples, sample]
      setFieldData((current) => ({ ...current, samples, session: current.session ? updateFieldSessionStats(current.session, samples, current.trackPoints) : null }))
      setNotice(location.accuracy > GPS_ACCURACY_WARNING_METRES ? `当前 GPS accuracy ±${location.accuracy.toFixed(1)}m，仍已记录 ${sampleType === 'tee' ? 'Tee' : 'Green'}。` : `${sampleType === 'tee' ? 'Tee' : 'Green'} 已记录（${formatHole(actualHole)}）。`)
    } catch (error) { setNotice(error instanceof Error ? error.message : '保存采样失败。') }
  }
  function undoSample() { const result = undoLastFieldSample(fieldData.samples); if (!result.removed) { setNotice('没有可撤销的采样。'); return }; setFieldData((current) => ({ ...current, samples: result.samples, session: current.session ? updateFieldSessionStats(current.session, result.samples, current.trackPoints) : null })); setNotice(`已撤销 ${result.removed.sampleType === 'tee' ? 'Tee' : 'Green'} 采样。`) }
  function deleteSample(id: string) { const sample = fieldData.samples.find((item) => item.id === id); if (!sample) return; const samples = fieldData.samples.filter((item) => item.id !== id); setFieldData((current) => ({ ...current, samples, session: current.session ? updateFieldSessionStats(current.session, samples, current.trackPoints) : null })); setNotice(`已删除 ${sample.sampleType === 'tee' ? 'Tee' : 'Green'} 采样。`) }
  function recordConfirmation(actual: number | 'uncertain') {
    if (!activeSession || !fieldData.session) { setNotice('请先开始现场测试。'); return }
    const event = createFieldConfirmationEvent({ predictedHole: holeInference.inferredHole, actualHole: actual, confirmationSource: 'field', position: location ? { latitude: location.latitude, longitude: location.longitude, accuracy: location.accuracy } : undefined })
    setFieldData((current) => ({ ...current, confirmationEvents: [...current.confirmationEvents, { ...event, sessionId: current.session?.sessionId ?? '' }] })); setConfirmationMode(null); setNotice('现场确认事件已记录。')
  }

  return <main className="shell"><section className="status-card" aria-labelledby="app-title">
    <p className="eyebrow">移动端现场测试 · Thread 04</p><h1 id="app-title">Golf Green Vision</h1><p className="subtitle">现场测试模式</p>
    <section className="location-hero" aria-label="定位状态"><div className={`location-status status-${state.status}`} role="status" aria-live="polite"><span className="status-dot" aria-hidden="true" />{STATUS_LABELS[state.status]}</div><div className={`quality-badge ${quality.className}`}>定位：{quality.label}</div><strong className="accuracy-value">accuracy ±{location ? location.accuracy.toFixed(1) : '—'}m</strong></section>
    {state.errorMessage && <p className="error-message">{state.errorMessage}</p>}{notice && <p className="field-notice" role="status">{notice}</p>}
    <dl className="location-grid compact-location-grid"><div><dt>GPS accuracy</dt><dd>{location ? `±${location.accuracy.toFixed(1)} m` : '—'}</dd></div><div><dt>最后更新时间</dt><dd>{formatTimestamp(location?.timestamp)}</dd></div><div><dt>定位来源</dt><dd>{state.mode === 'simulated' ? '模拟模式' : '真实定位'}</dd></div><div><dt>状态</dt><dd>{STATUS_LABELS[state.status]}</dd></div></dl>
    <p className="accuracy-note">accuracy 是浏览器提供的水平精度估计值，不代表球的位置精度。代码阈值：≤10m 良好，10–25m 一般，&gt;25m 较差。</p>
    <details className="debug-details" open={showDebug} onToggle={(event) => setShowDebug((event.currentTarget as HTMLDetailsElement).open)}><summary>调试信息</summary><dl className="location-grid debug-grid"><div><dt>纬度</dt><dd>{formatCoordinate(location?.latitude)}</dd></div><div><dt>经度</dt><dd>{formatCoordinate(location?.longitude)}</dd></div><div><dt>海拔</dt><dd>{location?.altitude === null || location?.altitude === undefined ? '—' : `${location.altitude.toFixed(1)} m`}</dd></div><div><dt>速度 / 航向</dt><dd>{location?.speed === null || location?.speed === undefined ? '—' : `${location.speed.toFixed(1)} m/s`}</dd></div></dl></details>
    <div className="mode-switch" aria-label="定位来源"><button type="button" className={state.mode === 'real' ? 'active' : ''} onClick={() => setMode('real')}>真实定位</button><button type="button" className={state.mode === 'simulated' ? 'active' : ''} onClick={() => setMode('simulated')}>模拟定位</button></div><p className="mode-label">当前处于{state.mode === 'simulated' ? '模拟' : '真实'}模式</p>
    <section className="field-panel" aria-labelledby="field-panel-title"><div className="section-heading"><div><p className="panel-eyebrow">Field Test Mode</p><h2 id="field-panel-title">现场采集</h2></div><span className={`session-badge ${activeSession ? 'session-live' : ''}`}>{activeSession ? '进行中' : fieldData.session ? '已结束' : '未开始'}</span></div>
      {!activeSession && !fieldData.session && <div className="start-session-block"><label className="notes-field"><span>本轮备注（可选）</span><textarea value={sessionNotes} onChange={(event) => setSessionNotes(event.target.value)} rows={2} placeholder="例如：白 tee，上午 8:00" /></label><button type="button" className="primary-action" onClick={startSession}>开始现场测试</button></div>}
      {!activeSession && isFieldStateRecoverable(fieldData) && <button type="button" className="secondary-action full-action" onClick={restoreSession}>恢复未完成测试</button>}
      {activeSession && <p className="session-meta">Session {fieldData.session?.sessionId}<br />开始于 {fieldData.session ? new Date(fieldData.session.startTime).toLocaleString('zh-CN') : '—'}</p>}
      <div className="actual-hole-block"><div className="section-label">当前实际球洞</div><div className="hole-stepper"><button type="button" aria-label="上一洞" onClick={() => changeActualHole(nextHole(actualHole, -1))}>上一洞</button><select aria-label="当前实际球洞" value={actualHole ?? ''} onChange={(event) => changeActualHole(event.target.value ? Number(event.target.value) : null)}><option value="">请选择 Hole</option>{Array.from({ length: 18 }, (_, index) => index + 1).map((hole) => <option key={hole} value={hole}>Hole {hole}</option>)}</select><button type="button" aria-label="下一洞" onClick={() => changeActualHole(nextHole(actualHole, 1))}>下一洞</button></div><p className="hole-control-note">实际 Hole 由你确认；系统预测不会自动切换或覆盖。</p></div>
      <div className="prediction-row"><div><span className="section-label">系统预测</span><strong>{formatHole(holeInference.inferredHole)}</strong></div><div><span className="section-label">候选状态</span><strong>{currentCandidate?.status ?? 'unknown'}</strong></div><div><span className="section-label">排序分</span><strong>{currentCandidate?.score === null || currentCandidate?.score === undefined ? '—' : currentCandidate.score.toFixed(2)}</strong></div></div><p className="candidate-note">候选排序分只是排序依据，不是正确概率。当前实际 Hole 的候选会随样本保存。</p>
      <div className="sample-actions"><button type="button" className="sample-button tee-button" onClick={() => recordSample('tee')}>到达发球台</button><button type="button" className="sample-button green-button" onClick={() => recordSample('green')}>到达果岭</button></div><p className="sample-meaning">Green 采样表示到达果岭区域时的位置，不代表旗杆、果岭几何中心或官方 Green Center。</p>
      <section className="confirmation-panel" aria-labelledby="confirmation-title"><h3 id="confirmation-title">系统判断</h3><div className="confirmation-actions"><button type="button" onClick={() => recordConfirmation(holeInference.inferredHole ?? 'uncertain')} disabled={holeInference.inferredHole === null}>正确</button><button type="button" onClick={() => setConfirmationMode('other')}>实际是其他洞</button><button type="button" onClick={() => recordConfirmation('uncertain')}>暂不确定</button></div>{actualHole !== null && holeInference.inferredHole !== null && <button type="button" className="quick-confirm" onClick={() => recordConfirmation(actualHole)}>用当前实际 Hole 校验系统预测</button>}{confirmationMode === 'other' && <div className="confirmation-select"><label>实际洞号<select aria-label="确认实际洞号" value={confirmationHole} onChange={(event) => setConfirmationHole(Number(event.target.value))}>{Array.from({ length: 18 }, (_, index) => index + 1).map((hole) => <option key={hole} value={hole}>Hole {hole}</option>)}</select></label><button type="button" onClick={() => recordConfirmation(confirmationHole)}>保存确认</button></div>}</section>
      <div className="sample-summary"><span>本轮 Tee {fieldData.session?.sampleCounts.tee ?? 0}</span><span>Green {fieldData.session?.sampleCounts.green ?? 0}</span><span>轨迹点 {fieldData.trackPoints.length}</span><span>确认 {fieldData.confirmationEvents.length}</span></div><div className="field-toolbar"><button type="button" className="secondary-action" onClick={undoSample}>撤销上一条采样</button><button type="button" className="secondary-action" onClick={() => setShowSamples((value) => !value)}>{showSamples ? '收起本洞样本' : '查看本洞样本'}</button></div>
      {showSamples && <div className="sample-list">{currentHoleSamples.length === 0 ? <p>当前 Hole 暂无采样。</p> : currentHoleSamples.map((sample) => <div className="sample-row" key={sample.id}><span>{sample.sampleType === 'tee' ? 'Tee' : 'Green'} · {new Date(sample.timestamp).toLocaleTimeString('zh-CN')} · ±{sample.accuracy.toFixed(1)}m</span><button type="button" aria-label={`删除${sample.sampleType === 'tee' ? ' Tee' : ' Green'}采样`} onClick={() => deleteSample(sample.id)}>删除</button></div>)}</div>}
      {fieldData.session && <div className="session-actions"><button type="button" className="secondary-action" onClick={exportCurrent}>导出现场数据</button>{activeSession && <button type="button" className="primary-action" onClick={stopAndExport}>结束并导出</button>}</div>}
    </section>
    <details className="readiness-panel" open={showReadiness} onToggle={(event) => setShowReadiness((event.currentTarget as HTMLDetailsElement).open)}><summary>测试准备检查</summary><div className="readiness-list">{readiness.map((check) => <div className={check.ok ? 'readiness-item ok' : 'readiness-item'} key={check.key}><span aria-hidden="true">{check.ok ? '✓' : '!'}</span><span><strong>{check.label}</strong><small>{check.detail}</small></span></div>)}</div><p className="readiness-result">{readiness.every((check) => check.ok) ? '准备完成' : '请先处理标记为 ! 的项目；定位权限和 GPS 返回可能需要在现场等待。'}</p></details>
    {state.mode === 'simulated' && <><form className="simulation-panel" onSubmit={applySimulation}><h2>桌面模拟定位</h2><p>修改经纬度或 accuracy 后点击应用，页面会使用统一定位接口更新位置。</p><div className="simulation-fields"><label>纬度<input aria-label="模拟纬度" inputMode="decimal" value={latitude} onChange={(event) => setLatitude(event.target.value)} /></label><label>经度<input aria-label="模拟经度" inputMode="decimal" value={longitude} onChange={(event) => setLongitude(event.target.value)} /></label><label>accuracy（米）<input aria-label="模拟 accuracy" inputMode="decimal" value={simulationAccuracy} onChange={(event) => setSimulationAccuracy(event.target.value)} /></label></div><button className="apply-button" type="submit">应用模拟位置</button>{simulationError && <p className="error-message">{simulationError}</p>}</form><section className="hole-debug-panel" aria-labelledby="hole-debug-title"><div className="hole-debug-heading"><div><p className="panel-eyebrow">Mock / Demo</p><h2 id="hole-debug-title">洞号识别调试</h2></div><span className="demo-badge">{activeCourse.properties.demo ? '模拟球场' : '真实资料 V0.5'}</span></div><label className="correction-field"><span>调试球场</span><select aria-label="调试球场" value={activeCourse.properties.id} onChange={(event) => selectCourse(event.target.value === jingshanhuV0Course.properties.id ? jingshanhuV0Course : mockDemoCourse)}><option value={mockDemoCourse.properties.id}>Mock / Demo（3 洞）</option><option value={jingshanhuV0Course.properties.id}>净山湖 V0.5（18 洞，空间待配准）</option></select></label><dl className="hole-debug-grid"><div><dt>自动判断洞号</dt><dd>{holeInference.inferredHole === null ? '无法确定' : `${holeInference.inferredHole} 洞`}</dd></div><div><dt>当前实际使用洞号</dt><dd>{holeSelection.effectiveHole === null ? '无法确定' : `${holeSelection.effectiveHole} 洞`}</dd></div><div><dt>候选洞号</dt><dd>{holeInference.candidates.length ? holeInference.candidates.map((hole) => `${hole} 洞`).join('、') : '无'}</dd></div></dl><label className="correction-field"><span>手动修正洞号</span><select aria-label="手动修正洞号" value={holeSelection.correctedHole ?? ''} onChange={(event) => setHoleSelection((current) => setCorrectedHole(current, event.target.value ? Number(event.target.value) : null, activeCourse.features.map((feature) => feature.properties.hole)))}><option value="">不修正（使用自动判断）</option>{activeCourse.features.map((feature) => <option key={feature.properties.hole} value={feature.properties.hole}>{feature.properties.hole} 洞</option>)}</select></label>{!activeCourse.properties.demo && <p className="hole-hint">净山湖 V0.5 当前有 {activeCourse.features.length} 洞的 Par/距离表；Tee、Green 与 centerline 尚未取得可复核坐标，因此自动洞号暂不可用。</p>}{holeInference.reason === 'outside' && <p className="hole-hint">当前点位不在任何模拟球洞区域内，无法确定洞号。</p>}{holeInference.reason === 'multiple-match' && <p className="hole-hint">当前位置命中多个相邻区域，按最小洞号规则暂定为 {holeInference.inferredHole} 洞。</p>}{holeSelection.correctedHole !== null && <p className="hole-hint">已使用手动修正：界面当前显示 {holeSelection.effectiveHole} 洞。</p>}</section></>}
  </section></main>
}
