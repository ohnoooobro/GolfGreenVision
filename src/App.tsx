import { useEffect, useMemo, useState } from 'react'
import {
  createHoleSelectionState,
  inferHole,
  jingshanhuV0Course,
  mockDemoCourse,
  setCorrectedHole,
  updateInferredHole,
} from './course'
import type { GolfCourseGeoJSON } from './course'
import { useLocation } from './location/useLocation'
import type { LocationStatus } from './location/types'

const STATUS_LABELS: Record<LocationStatus, string> = {
  waiting: '等待定位',
  success: '定位成功',
  'permission-denied': '权限被拒绝',
  unavailable: '定位不可用',
  error: '定位错误',
}

function formatCoordinate(value: number | undefined): string { return value === undefined ? '—' : value.toFixed(6) }
function formatTimestamp(timestamp: number | undefined): string {
  return timestamp === undefined ? '—' : new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'medium' }).format(timestamp)
}

function formatHole(hole: number | null): string { return hole === null ? '无法确定' : `${hole} 洞` }

export default function App() {
  const { state, setMode, setSimulatedPosition } = useLocation()
  const [latitude, setLatitude] = useState('39.904200')
  const [longitude, setLongitude] = useState('116.407400')
  const [simulationError, setSimulationError] = useState<string | null>(null)
  const [activeCourse, setActiveCourse] = useState<GolfCourseGeoJSON>(mockDemoCourse)
  const location = state.location
  const holeInference = useMemo(
    () => location ? inferHole(location, activeCourse) : { inferredHole: null, candidates: [], reason: 'outside' as const },
    [activeCourse, location],
  )
  const [holeSelection, setHoleSelection] = useState(() => createHoleSelectionState())

  useEffect(() => {
    setHoleSelection((current) => updateInferredHole(current, holeInference.inferredHole))
  }, [holeInference.inferredHole])

  function selectCourse(course: GolfCourseGeoJSON) {
    setActiveCourse(course)
    setHoleSelection(createHoleSelectionState())
  }

  function applySimulation(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const nextLatitude = Number(latitude)
    const nextLongitude = Number(longitude)
    if (!Number.isFinite(nextLatitude) || !Number.isFinite(nextLongitude)) { setSimulationError('请输入有效的纬度和经度。'); return }
    try { setSimulatedPosition({ latitude: nextLatitude, longitude: nextLongitude }); setSimulationError(null) }
    catch (error) { setSimulationError(error instanceof Error ? error.message : '模拟位置无效。') }
  }

  return (
    <main className="shell">
      <section className="status-card" aria-labelledby="app-title">
        <p className="eyebrow">移动端现场测试 · Thread 01</p>
        <h1 id="app-title">Golf Green Vision</h1>
        <p className="subtitle">定位基础设施</p>
        <div className={`location-status status-${state.status}`} role="status" aria-live="polite"><span className="status-dot" aria-hidden="true" />{STATUS_LABELS[state.status]}</div>
        {state.errorMessage && <p className="error-message">{state.errorMessage}</p>}
        <dl className="location-grid">
          <div><dt>纬度</dt><dd>{formatCoordinate(location?.latitude)}</dd></div>
          <div><dt>经度</dt><dd>{formatCoordinate(location?.longitude)}</dd></div>
          <div><dt>GPS accuracy</dt><dd>{location ? `${location.accuracy.toFixed(1)} 米` : '—'}</dd></div>
          <div><dt>最后更新时间</dt><dd>{formatTimestamp(location?.timestamp)}</dd></div>
        </dl>
        <p className="accuracy-note">accuracy 是浏览器提供的水平精度估计值，不代表球的位置精度。</p>
        <div className="mode-switch" aria-label="定位来源">
          <button type="button" className={state.mode === 'real' ? 'active' : ''} onClick={() => setMode('real')}>真实定位</button>
          <button type="button" className={state.mode === 'simulated' ? 'active' : ''} onClick={() => setMode('simulated')}>模拟定位</button>
        </div>
        <p className="mode-label">当前处于{state.mode === 'simulated' ? '模拟' : '真实'}模式</p>
        {state.mode === 'simulated' && (
          <>
            <form className="simulation-panel" onSubmit={applySimulation}>
              <h2>桌面模拟定位</h2><p>修改经纬度后点击应用，页面会使用统一定位接口更新位置。</p>
              <div className="simulation-fields">
                <label>纬度<input aria-label="模拟纬度" inputMode="decimal" value={latitude} onChange={(event) => setLatitude(event.target.value)} /></label>
                <label>经度<input aria-label="模拟经度" inputMode="decimal" value={longitude} onChange={(event) => setLongitude(event.target.value)} /></label>
              </div>
              <button className="apply-button" type="submit">应用模拟位置</button>
              {simulationError && <p className="error-message">{simulationError}</p>}
            </form>
            <section className="hole-debug-panel" aria-labelledby="hole-debug-title">
              <div className="hole-debug-heading">
                <div>
                  <p className="panel-eyebrow">Mock / Demo</p>
                  <h2 id="hole-debug-title">洞号识别调试</h2>
                </div>
                <span className="demo-badge">{activeCourse.properties.demo ? '模拟球场' : '真实资料 V0.5'}</span>
              </div>
              <label className="correction-field">
                <span>调试球场</span>
                <select
                  aria-label="调试球场"
                  value={activeCourse.properties.id}
                  onChange={(event) => selectCourse(event.target.value === jingshanhuV0Course.properties.id ? jingshanhuV0Course : mockDemoCourse)}
                >
                  <option value={mockDemoCourse.properties.id}>Mock / Demo（3 洞）</option>
                  <option value={jingshanhuV0Course.properties.id}>净山湖 V0.5（18 洞，空间待配准）</option>
                </select>
              </label>
              <dl className="hole-debug-grid">
                <div><dt>自动判断洞号</dt><dd>{formatHole(holeSelection.inferredHole)}</dd></div>
                <div><dt>当前实际使用洞号</dt><dd>{formatHole(holeSelection.effectiveHole)}</dd></div>
                <div><dt>候选洞号</dt><dd>{holeInference.candidates.length ? holeInference.candidates.map((hole) => `${hole} 洞`).join('、') : '无'}</dd></div>
              </dl>
              <label className="correction-field">
                <span>手动修正洞号</span>
                <select
                  aria-label="手动修正洞号"
                  value={holeSelection.correctedHole ?? ''}
                  onChange={(event) => setHoleSelection((current) => setCorrectedHole(
                    current,
                    event.target.value ? Number(event.target.value) : null,
                    activeCourse.features.map((feature) => feature.properties.hole),
                  ))}
                >
                  <option value="">不修正（使用自动判断）</option>
                  {activeCourse.features.map((feature) => <option key={feature.properties.hole} value={feature.properties.hole}>{feature.properties.hole} 洞</option>)}
                </select>
              </label>
              {!activeCourse.properties.demo && (
                <p className="hole-hint">净山湖 V0.5 当前有 {activeCourse.features.length} 洞的 Par/距离表；Tee、Green 与 centerline 尚未取得可复核坐标，因此自动洞号暂不可用。</p>
              )}
              {holeInference.reason === 'outside' && (
                <p className="hole-hint">当前点位不在任何模拟球洞区域内，无法确定洞号。</p>
              )}
              {holeInference.reason === 'multiple-match' && (
                <p className="hole-hint">当前位置命中多个相邻区域，按最小洞号规则暂定为 {formatHole(holeInference.inferredHole)}。</p>
              )}
              {holeSelection.correctedHole !== null && (
                <p className="hole-hint">已使用手动修正：界面当前显示 {formatHole(holeSelection.effectiveHole)}。</p>
              )}
            </section>
          </>
        )}
      </section>
    </main>
  )
}
