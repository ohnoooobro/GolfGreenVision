const DATA_URL = '../../data/derived/jingshanhu/spatial-candidates.json'
const METADATA_URL = '../../data/derived/jingshanhu/orthophoto_2023_metadata.json'
const PREVIEW_URL = '../../data/derived/jingshanhu/orthophoto_2023_preview_small.jpg'
const REVIEW_STORAGE_KEY = 'jingshanhu-digitizer-review-v1'
const EVENTS_STORAGE_KEY = 'jingshanhu-field-confirmation-events-v1'

const state = {
  document: null,
  metadata: null,
  image: null,
  selectedHole: 1,
  selectedCandidateIndex: 0,
  view: { scale: 1, offsetX: 0, offsetY: 0, fitted: false },
  dragging: false,
  dragStart: null,
  hitTargets: [],
  review: loadJson(REVIEW_STORAGE_KEY, {}),
  events: loadJson(EVENTS_STORAGE_KEY, []),
}

const elements = {
  canvas: document.querySelector('#mapCanvas'),
  mapLoading: document.querySelector('#mapLoading'),
  mapReadout: document.querySelector('#mapReadout'),
  datasetMeta: document.querySelector('#datasetMeta'),
  loadError: document.querySelector('#loadError'),
  holeSelect: document.querySelector('#holeSelect'),
  holeStatus: document.querySelector('#holeStatus'),
  holeSummary: document.querySelector('#holeSummary'),
  candidateTitle: document.querySelector('#candidateTitle'),
  candidateScore: document.querySelector('#candidateScore'),
  candidateSummary: document.querySelector('#candidateSummary'),
  candidateLinks: document.querySelector('#candidateLinks'),
  alternativeList: document.querySelector('#alternativeList'),
  evidenceList: document.querySelector('#evidenceList'),
  conflictList: document.querySelector('#conflictList'),
  coordinateGrid: document.querySelector('#coordinateGrid'),
  pendingBadge: document.querySelector('#pendingBadge'),
  pendingButton: document.querySelector('#pendingButton'),
  reviewNote: document.querySelector('#reviewNote'),
  saveNoteButton: document.querySelector('#saveNoteButton'),
  reviewSaved: document.querySelector('#reviewSaved'),
  eventLatitude: document.querySelector('#eventLatitude'),
  eventLongitude: document.querySelector('#eventLongitude'),
  capturePositionButton: document.querySelector('#capturePositionButton'),
  eventSaved: document.querySelector('#eventSaved'),
}

function loadJson(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback } catch { return fallback }
}

function saveJson(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* storage may be disabled */ }
}

function currentHole() { return state.document?.holes.find((hole) => hole.hole === state.selectedHole) || null }
function objectById(id) { return state.document?.objects.find((object) => object.id === id) || null }
function corridorById(id) { return state.document?.corridors.find((corridor) => corridor.id === id) || null }
function currentCandidate() {
  const hole = currentHole()
  if (!hole?.bestCandidate) return null
  return state.selectedCandidateIndex === 0 ? hole.bestCandidate : hole.alternatives[state.selectedCandidateIndex - 1] || hole.bestCandidate
}

function formatScore(value) { return Number.isFinite(value) ? value.toFixed(3) : '—' }
function formatMeters(value) { return Number.isFinite(value) ? `${value.toFixed(1)} m` : '—' }
function formatCoordinate(point) {
  if (!point?.coordinates) return '—'
  return `${point.coordinates[1].toFixed(7)}°N, ${point.coordinates[0].toFixed(7)}°E`
}
function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]))
}
function renderList(element, values) {
  const list = Array.isArray(values) && values.length ? values : ['—']
  element.innerHTML = list.map((value) => `<li>${escapeHtml(value)}</li>`).join('')
}

function renderPanel() {
  const hole = currentHole()
  const candidate = currentCandidate()
  if (!hole) return
  elements.holeStatus.textContent = hole.status
  elements.holeSummary.innerHTML = `<span>Par ${escapeHtml(hole.par)}</span><span>Gold ${escapeHtml(hole.teeYardages.gold)} yd</span><span>Blue ${escapeHtml(hole.teeYardages.blue)} yd</span><span>White ${escapeHtml(hole.teeYardages.white)} yd</span><span>Red ${escapeHtml(hole.teeYardages.red)} yd</span>`
  elements.candidateTitle.textContent = candidate ? `${candidate.tee} → ${candidate.green} · ${candidate.corridor}` : '没有可用候选'
  elements.candidateScore.textContent = candidate ? `score ${formatScore(candidate.score)}` : '—'
  if (candidate) {
    elements.candidateSummary.innerHTML = [
      ['Tee', candidate.tee], ['Green', candidate.green], ['直线 proxy', formatMeters(candidate.lineLengthMetres)],
      ['匹配档位', `${candidate.matchedTeeVariant} · ${candidate.matchedYardage} yd`],
      ['目标长度', formatMeters(candidate.targetMetres)], ['相对误差', `${(candidate.relativeLengthError * 100).toFixed(1)}%`],
    ].map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join('')
    const tee = objectById(candidate.tee); const green = objectById(candidate.green)
    elements.coordinateGrid.innerHTML = `<div><dt>Tee ${escapeHtml(candidate.tee)}</dt><dd>${escapeHtml(formatCoordinate(tee?.center))}</dd></div><div><dt>Green ${escapeHtml(candidate.green)}</dt><dd>${escapeHtml(formatCoordinate(green?.center))}</dd></div>`
  } else {
    elements.candidateSummary.innerHTML = '<div><dt>状态</dt><dd>unknown</dd></div>'
    elements.coordinateGrid.innerHTML = '<div><dt>Tee</dt><dd>—</dd></div><div><dt>Green</dt><dd>—</dd></div>'
  }
  elements.candidateLinks.innerHTML = ''
  const matches = hole.bestCandidate ? [hole.bestCandidate, ...hole.alternatives] : []
  matches.forEach((match, index) => {
    const button = document.createElement('button'); button.type = 'button'; button.className = `candidate-link${index === state.selectedCandidateIndex ? ' active' : ''}`
    button.textContent = index === 0 ? 'Top candidate' : `候选 ${index + 1}`
    button.addEventListener('click', () => { state.selectedCandidateIndex = index; renderPanel(); drawMap() }); elements.candidateLinks.append(button)
  })
  elements.alternativeList.innerHTML = hole.alternatives.length
    ? hole.alternatives.map((match, index) => `<button type="button" class="alternative-card${index + 1 === state.selectedCandidateIndex ? ' active' : ''}" data-alternative-index="${index + 1}"><strong>${escapeHtml(match.tee)} → ${escapeHtml(match.green)} · ${escapeHtml(match.corridor)}</strong><small>score ${formatScore(match.score)} · ${formatMeters(match.lineLengthMetres)} · ${escapeHtml(match.matchedTeeVariant)} ${escapeHtml(match.matchedYardage)} yd</small></button>`).join('')
    : '<p class="field-note">暂无替代候选。</p>'
  elements.alternativeList.querySelectorAll('[data-alternative-index]').forEach((button) => button.addEventListener('click', () => { state.selectedCandidateIndex = Number(button.dataset.alternativeIndex); renderPanel(); drawMap() }))
  renderList(elements.evidenceList, candidate?.evidence || hole.evidence)
  renderList(elements.conflictList, candidate?.conflicts || hole.conflicts)
  const review = state.review[String(hole.hole)] || { pending: false, note: '' }
  elements.reviewNote.value = review.note || ''
  elements.pendingBadge.hidden = !review.pending
  elements.pendingButton.classList.toggle('pending', review.pending)
  elements.pendingButton.textContent = review.pending ? '已标记待现场确认' : '标记待现场确认'
  elements.reviewSaved.textContent = review.updatedAt ? `最近保存：${new Date(review.updatedAt).toLocaleString('zh-CN')}` : ''
}

function renderEventLog() {
  const latest = state.events[0]
  if (!latest) { elements.eventSaved.textContent = '尚未记录现场事件。'; return }
  const labels = { correct: '正确', 'not-this-hole': '不是这个洞', uncertain: '暂不确定' }
  elements.eventSaved.textContent = `最近事件：预测 Hole ${latest.predictedHole ?? '—'} · ${labels[latest.outcome] || latest.outcome} · ${new Date(latest.timestamp).toLocaleString('zh-CN')}`
}

function saveReview(patch) {
  const hole = currentHole(); if (!hole) return
  const key = String(hole.hole)
  state.review[key] = { ...(state.review[key] || { pending: false, note: '' }), ...patch, updatedAt: new Date().toISOString() }
  saveJson(REVIEW_STORAGE_KEY, state.review); renderPanel()
}

function recordEvent(outcome) {
  const latitude = Number(elements.eventLatitude.value)
  const longitude = Number(elements.eventLongitude.value)
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    elements.eventSaved.textContent = '请先填写现场 WGS84 纬度和经度，或点击“读取当前 GPS”。'
    return
  }
  const event = {
    schemaVersion: 1,
    timestamp: new Date().toISOString(),
    predictedHole: currentHole()?.hole ?? null,
    actualHole: outcome === 'correct' ? currentHole()?.hole ?? null : 'uncertain',
    outcome,
    confirmationSource: 'field',
    position: { latitude, longitude },
    note: state.review[String(state.selectedHole)]?.note || undefined,
  }
  state.events = [event, ...state.events].slice(0, 50)
  saveJson(EVENTS_STORAGE_KEY, state.events); renderEventLog()
}

function drawGeometry(ctx, geometry, style) {
  if (!geometry?.coordinates) return
  const rings = geometry.type === 'Polygon' ? geometry.coordinates : [geometry.coordinates]
  ctx.save(); ctx.strokeStyle = style.stroke; ctx.fillStyle = style.fill || 'transparent'; ctx.lineWidth = style.width || 1; ctx.setLineDash(style.dash || [])
  rings.forEach((ring) => {
    if (!ring?.length) return
    ctx.beginPath()
    ring.forEach((point, index) => { const [x, y] = worldToScreen(point); index ? ctx.lineTo(x, y) : ctx.moveTo(x, y) })
    if (geometry.type === 'Polygon') ctx.closePath()
    if (style.fill) ctx.fill(); ctx.stroke()
  })
  ctx.restore()
}

function worldToScreen([x, y]) { return [state.view.offsetX + x * state.view.scale, state.view.offsetY + y * state.view.scale] }
function screenToWorld(x, y) { return [(x - state.view.offsetX) / state.view.scale, (y - state.view.offsetY) / state.view.scale] }

function drawMap() {
  const canvas = elements.canvas
  if (!state.document || !state.metadata || !state.image?.complete) return
  const rect = canvas.getBoundingClientRect(); const dpr = window.devicePixelRatio || 1
  if (canvas.width !== Math.round(rect.width * dpr) || canvas.height !== Math.round(rect.height * dpr)) { canvas.width = Math.round(rect.width * dpr); canvas.height = Math.round(rect.height * dpr) }
  const ctx = canvas.getContext('2d'); if (!ctx) return
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, rect.width, rect.height); ctx.fillStyle = '#0c1711'; ctx.fillRect(0, 0, rect.width, rect.height)
  const imageWidth = state.metadata.raster.width; const imageHeight = state.metadata.raster.height
  ctx.drawImage(state.image, state.view.offsetX, state.view.offsetY, imageWidth * state.view.scale, imageHeight * state.view.scale)
  const styles = {
    water: { stroke: 'rgba(90,170,230,.78)', fill: 'rgba(90,170,230,.22)', width: 2 },
    bunker: { stroke: 'rgba(230,195,121,.9)', fill: 'rgba(230,195,121,.25)', width: 1 },
    rough: { stroke: 'rgba(133,190,120,.5)', fill: 'rgba(133,190,120,.08)', width: 1 },
    cartpath: { stroke: 'rgba(232,232,220,.48)', width: 1 },
    green: { stroke: 'rgba(95,241,199,.92)', fill: 'rgba(95,241,199,.25)', width: 2 },
    tee: { stroke: 'rgba(242,133,220,.95)', fill: 'rgba(242,133,220,.28)', width: 2 },
  }
  ;(state.document.objects || []).forEach((object) => drawGeometry(ctx, object.imagePixels?.geometry, styles[object.kind] || { stroke: 'rgba(255,255,255,.4)', width: 1 }))
  ;(state.document.corridors || []).forEach((corridor) => drawGeometry(ctx, corridor.imagePixels?.geometry, { stroke: 'rgba(255,198,100,.16)', width: 1, dash: [7, 6] }))
  const hole = currentHole(); state.hitTargets = []
  if (hole) {
    const matches = hole.bestCandidate ? [hole.bestCandidate, ...hole.alternatives] : []
    matches.forEach((match, index) => {
      const corridor = corridorById(match.corridor); if (!corridor) return
      const active = index === state.selectedCandidateIndex
      drawGeometry(ctx, corridor.imagePixels?.geometry, { stroke: active ? '#fff3a1' : '#ffbb5f', width: active ? 5 : 2.5, dash: active ? [] : [10, 7] })
      ;[objectById(match.tee), objectById(match.green)].forEach((object) => { if (object) drawGeometry(ctx, object.imagePixels?.geometry, { stroke: active ? '#fff3a1' : '#ffbb5f', fill: active ? 'rgba(255,243,161,.35)' : 'rgba(255,187,95,.16)', width: active ? 3 : 1.5 }) })
      if (active) {
        const coordinates = corridor.imagePixels.geometry.coordinates; const [x1, y1] = worldToScreen(coordinates[0]); const [x2, y2] = worldToScreen(coordinates[coordinates.length - 1])
        ctx.save(); ctx.fillStyle = '#fff3a1'; ctx.font = '700 13px sans-serif'; ctx.fillText(`${match.tee} → ${match.green}`, x1 + 7, y1 - 7); ctx.fillText(`Hole ${hole.hole} · ${match.corridor}`, x2 + 7, y2 - 7); ctx.restore()
      }
      state.hitTargets.push({ index, coordinates: corridor.imagePixels.geometry.coordinates })
    })
  }
  elements.mapReadout.textContent = `缩放 ${(state.view.scale * 100).toFixed(0)}% · ${state.document.objects.length} 个空间对象 · ${state.document.corridors.length} 条 corridor proxy`
}

function fitView() {
  const rect = elements.canvas.getBoundingClientRect(); if (!state.metadata || !rect.width || !rect.height) return
  state.view.scale = Math.min(rect.width / state.metadata.raster.width, rect.height / state.metadata.raster.height) * .96
  state.view.offsetX = (rect.width - state.metadata.raster.width * state.view.scale) / 2; state.view.offsetY = (rect.height - state.metadata.raster.height * state.view.scale) / 2; state.view.fitted = true; drawMap()
}

function zoomAt(factor, screenX, screenY) {
  const [worldX, worldY] = screenToWorld(screenX, screenY); state.view.scale = Math.max(.035, Math.min(1.6, state.view.scale * factor)); state.view.offsetX = screenX - worldX * state.view.scale; state.view.offsetY = screenY - worldY * state.view.scale; drawMap()
}

function pointerPosition(event) { const rect = elements.canvas.getBoundingClientRect(); return [event.clientX - rect.left, event.clientY - rect.top] }
function distanceToSegment(point, start, end) {
  const [px, py] = point; const [x1, y1] = start; const [x2, y2] = end; const dx = x2 - x1; const dy = y2 - y1; const lengthSquared = dx * dx + dy * dy; if (!lengthSquared) return Math.hypot(px - x1, py - y1)
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lengthSquared)); return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy))
}
function distanceToLine(point, coordinates) { let distance = Infinity; for (let index = 1; index < coordinates.length; index += 1) distance = Math.min(distance, distanceToSegment(point, coordinates[index - 1], coordinates[index])); return distance }

elements.holeSelect.addEventListener('change', () => { state.selectedHole = Number(elements.holeSelect.value); state.selectedCandidateIndex = 0; renderPanel(); drawMap() })
elements.pendingButton.addEventListener('click', () => { const current = state.review[String(state.selectedHole)]?.pending; saveReview({ pending: !current }) })
elements.saveNoteButton.addEventListener('click', () => { saveReview({ note: elements.reviewNote.value.trim() }); elements.reviewSaved.textContent = `已保存：${new Date().toLocaleString('zh-CN')}` })
document.querySelectorAll('[data-event-outcome]').forEach((button) => button.addEventListener('click', () => recordEvent(button.dataset.eventOutcome)))
document.querySelector('#fitButton').addEventListener('click', fitView)
document.querySelector('#resetButton').addEventListener('click', fitView)
document.querySelector('#zoomInButton').addEventListener('click', () => zoomAt(1.25, elements.canvas.clientWidth / 2, elements.canvas.clientHeight / 2))
document.querySelector('#zoomOutButton').addEventListener('click', () => zoomAt(.8, elements.canvas.clientWidth / 2, elements.canvas.clientHeight / 2))
elements.canvas.addEventListener('wheel', (event) => { event.preventDefault(); const [x, y] = pointerPosition(event); zoomAt(event.deltaY < 0 ? 1.12 : .89, x, y) }, { passive: false })
elements.canvas.addEventListener('pointerdown', (event) => { state.dragging = true; state.dragStart = { x: event.clientX, y: event.clientY, offsetX: state.view.offsetX, offsetY: state.view.offsetY }; elements.canvas.classList.add('dragging'); elements.canvas.setPointerCapture(event.pointerId) })
elements.canvas.addEventListener('pointermove', (event) => { if (!state.dragging || !state.dragStart) return; state.view.offsetX = state.dragStart.offsetX + event.clientX - state.dragStart.x; state.view.offsetY = state.dragStart.offsetY + event.clientY - state.dragStart.y; drawMap() })
elements.canvas.addEventListener('pointerup', (event) => {
  const moved = state.dragStart && Math.hypot(event.clientX - state.dragStart.x, event.clientY - state.dragStart.y) > 5
  state.dragging = false; elements.canvas.classList.remove('dragging'); if (elements.canvas.hasPointerCapture(event.pointerId)) elements.canvas.releasePointerCapture(event.pointerId); if (moved) return
  const [x, y] = pointerPosition(event); const world = screenToWorld(x, y)
  const target = state.hitTargets.map((candidate) => ({ ...candidate, distance: distanceToLine(world, candidate.coordinates) })).sort((a, b) => a.distance - b.distance)[0]
  if (target && target.distance < 22 / state.view.scale) { state.selectedCandidateIndex = target.index; renderPanel(); drawMap() }
})
elements.canvas.addEventListener('pointercancel', () => { state.dragging = false; elements.canvas.classList.remove('dragging') })
window.addEventListener('resize', () => { if (state.view.fitted) fitView(); else drawMap() })
elements.capturePositionButton.addEventListener('click', () => {
  if (!navigator.geolocation) { elements.eventSaved.textContent = '当前浏览器不支持 GPS，请手动填写 WGS84 坐标。'; return }
  elements.eventSaved.textContent = '正在请求当前 GPS…'
  navigator.geolocation.getCurrentPosition((position) => {
    elements.eventLatitude.value = position.coords.latitude.toFixed(7)
    elements.eventLongitude.value = position.coords.longitude.toFixed(7)
    elements.eventSaved.textContent = `已读取 GPS（精度约 ${Number.isFinite(position.coords.accuracy) ? position.coords.accuracy.toFixed(1) : '—'} m）。`
  }, () => { elements.eventSaved.textContent = '无法读取 GPS，请检查浏览器权限或手动填写 WGS84 坐标。' }, { enableHighAccuracy: true, timeout: 10000 })
})

async function initialize() {
  try {
    const [documentResponse, metadataResponse] = await Promise.all([fetch(DATA_URL), fetch(METADATA_URL)])
    if (!documentResponse.ok || !metadataResponse.ok) throw new Error('候选 JSON 或影像 metadata 无法读取，请通过 Vite 或静态 HTTP 服务打开此目录。')
    state.document = await documentResponse.json(); state.metadata = await metadataResponse.json()
    state.image = new Image(); state.image.src = PREVIEW_URL
    await new Promise((resolve, reject) => { state.image.addEventListener('load', resolve, { once: true }); state.image.addEventListener('error', reject, { once: true }) })
    state.document.holes.forEach((hole) => { const option = document.createElement('option'); option.value = hole.hole; option.textContent = `Hole ${hole.hole} · Par ${hole.par} · ${hole.status}`; elements.holeSelect.append(option) })
    elements.holeSelect.value = String(state.selectedHole)
    elements.datasetMeta.textContent = `2023 正射影像 · EPSG:${state.metadata.raster.sourceCrs.epsg} → EPSG:4326 · ${state.metadata.raster.width} × ${state.metadata.raster.height} · ${state.document.summary.objectCounts.green} Green / ${state.document.summary.objectCounts.tee} Tee / ${state.document.summary.corridorCount} corridor`
    elements.mapLoading.hidden = true; renderPanel(); renderEventLog(); requestAnimationFrame(fitView)
  } catch (error) {
    elements.mapLoading.hidden = true; elements.loadError.hidden = false; elements.loadError.textContent = error instanceof Error ? error.message : String(error)
  }
}

initialize()
