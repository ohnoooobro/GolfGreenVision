/**
 * Validation for the topology and global matching layers.
 *
 * These records are deliberately accepted as `unknown`: the topology files are
 * derived artifacts and are also consumed by the browser workbench. Keeping
 * the validator at the JSON boundary means malformed data is reported instead
 * of being hidden by an overly permissive cast.
 */

export interface GlobalTopologyValidationIssue {
  code: string
  solutionId?: string
  hole?: number
  message: string
}

type JsonRecord = Record<string, unknown>

const SOLUTION_STATUSES = new Set(['candidate', 'high-confidence-inferred', 'field-confirmed'])
const HOLE_STATUSES = new Set(['unknown', 'candidate', 'high-confidence-inferred', 'field-confirmed'])
const SCORE_MEANING = 'candidate ranking score, not probability'

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isNonNegativeNumber(value: unknown): boolean {
  return isFiniteNumber(value) && value >= 0
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function getString(record: JsonRecord, ...keys: string[]): string | null {
  for (const key of keys) {
    if (isNonEmptyString(record[key])) return record[key]
  }
  return null
}

function coordinatePair(value: unknown): value is [number, number] {
  return Array.isArray(value) && value.length === 2 &&
    value.every((part) => isFiniteNumber(part)) &&
    value[0] >= -180 && value[0] <= 180 && value[1] >= -90 && value[1] <= 90
}

function issue(
  issues: GlobalTopologyValidationIssue[],
  code: string,
  message: string,
  context: Partial<Pick<GlobalTopologyValidationIssue, 'solutionId' | 'hole'>> = {},
): void {
  issues.push({ code, message, ...context })
}

function validateCoordinates(value: unknown, path: string, issues: GlobalTopologyValidationIssue[]): boolean {
  if (coordinatePair(value)) return true
  if (!Array.isArray(value)) {
    issue(issues, 'invalid-wgs84-coordinate', `${path} 必须是合法的 WGS84 [经度, 纬度] 坐标。`)
    return false
  }
  if (value.length === 0 || value.some((child) => !validateCoordinates(child, path, issues))) return false
  return true
}

function validateGeometry(value: unknown, path: string, issues: GlobalTopologyValidationIssue[]): boolean {
  if (!isRecord(value)) {
    issue(issues, 'invalid-geometry', `${path} 必须是 GeoJSON geometry 对象。`)
    return false
  }
  const type = value.type
  if (!isNonEmptyString(type)) {
    issue(issues, 'invalid-geometry', `${path} 缺少 geometry type。`)
    return false
  }
  if (!['Point', 'LineString', 'Polygon', 'MultiPoint', 'MultiLineString', 'MultiPolygon'].includes(type)) {
    issue(issues, 'invalid-geometry', `${path} 使用了不支持的 geometry type ${type}。`)
    return false
  }
  return validateCoordinates(value.coordinates, `${path}.coordinates`, issues)
}

function lineCoordinates(value: unknown): unknown[] | null {
  if (Array.isArray(value)) return value
  if (isRecord(value) && value.type === 'LineString' && Array.isArray(value.coordinates)) return value.coordinates
  return null
}

function validateLine(value: unknown, path: string, issues: GlobalTopologyValidationIssue[]): void {
  const coordinates = lineCoordinates(value)
  if (!coordinates || coordinates.length < 2) {
    issue(issues, 'invalid-corridor-centerline', `${path} 必须包含至少两个 WGS84 坐标点。`)
    return
  }
  validateCoordinates(coordinates, `${path}.coordinates`, issues)
  if (isRecord(value) && value.type !== 'LineString') {
    issue(issues, 'invalid-corridor-centerline', `${path} 必须是 LineString。`)
  }
}

function validateIdList(
  values: unknown,
  path: string,
  issues: GlobalTopologyValidationIssue[],
): Map<string, JsonRecord> {
  const result = new Map<string, JsonRecord>()
  if (!Array.isArray(values)) {
    issue(issues, 'invalid-topology-array', `${path} 必须是数组。`)
    return result
  }
  values.forEach((value, index) => {
    if (!isRecord(value) || !isNonEmptyString(value.id)) {
      issue(issues, 'missing-topology-id', `${path}[${index}] 缺少稳定 id。`)
      return
    }
    if (result.has(value.id)) issue(issues, 'duplicate-topology-id', `${path} 中 id ${value.id} 重复。`)
    result.set(value.id, value)
  })
  return result
}

function validateObjectGeometry(
  record: JsonRecord,
  path: string,
  issues: GlobalTopologyValidationIssue[],
  required = true,
): void {
  const geometry = record.geometry
  const center = record.center
  if (geometry !== undefined) validateGeometry(geometry, `${path}.geometry`, issues)
  if (center !== undefined) {
    if (isRecord(center) && center.type !== undefined) validateGeometry(center, `${path}.center`, issues)
    else if (isRecord(center) && center.coordinates !== undefined) validateCoordinates(center.coordinates, `${path}.center.coordinates`, issues)
    else validateCoordinates(center, `${path}.center`, issues)
  }
  if (required && geometry === undefined && center === undefined && record.coordinates === undefined) {
    issue(issues, 'missing-topology-geometry', `${path} 缺少 geometry、center 或 coordinates。`)
  }
  if (record.coordinates !== undefined) validateCoordinates(record.coordinates, `${path}.coordinates`, issues)
}

function validateReference(
  record: JsonRecord,
  keys: string[],
  ids: Map<string, JsonRecord>,
  path: string,
  issues: GlobalTopologyValidationIssue[],
  required: boolean,
): string | null {
  const value = getString(record, ...keys)
  if (!value) {
    if (required) issue(issues, 'missing-topology-reference', `${path} 缺少 ${keys.join(' / ')} 引用。`)
    return null
  }
  if (!ids.has(value)) issue(issues, 'unknown-topology-reference', `${path} 引用了不存在的对象 ${value}。`)
  return value
}

/** Validate the full spatial topology graph independently from hole numbering. */
export function validateCourseTopology(document: unknown): GlobalTopologyValidationIssue[] {
  const issues: GlobalTopologyValidationIssue[] = []
  if (!isRecord(document)) {
    issue(issues, 'invalid-topology-document', 'CourseTopology 必须是对象。')
    return issues
  }
  if (document.schemaVersion !== 1) issue(issues, 'invalid-topology-schema', 'CourseTopology schemaVersion 必须为 1。')
  if (!isNonEmptyString(document.courseId)) issue(issues, 'missing-topology-course-id', 'CourseTopology 缺少 courseId。')
  if (!isNonEmptyString(document.coordinateSystem) || !document.coordinateSystem.includes('WGS84')) {
    issue(issues, 'invalid-topology-crs', 'CourseTopology 必须明确声明 WGS84。')
  }

  const teeZones = validateIdList(document.teeZones, 'teeZones', issues)
  const greens = validateIdList(document.greens, 'greens', issues)
  const corridors = validateIdList(document.corridors, 'corridors', issues)

  for (const [id, teeZone] of teeZones) validateObjectGeometry(teeZone, `teeZones.${id}`, issues)
  // Green classification may intentionally reference the source spatial object
  // without duplicating its polygon; the source candidate file remains the
  // authoritative geometry record.
  for (const [id, green] of greens) validateObjectGeometry(green, `greens.${id}`, issues, false)

  if (Array.isArray(document.corridors)) {
    document.corridors.forEach((value, index) => {
      if (!isRecord(value)) return
      const id = getString(value, 'id') ?? String(index)
      const centerline = value.centerline ?? value.geometry
      if (centerline === undefined) issue(issues, 'invalid-corridor-centerline', `corridors.${id} 缺少 centerline/geometry。`)
      else validateLine(centerline, `corridors.${id}.centerline`, issues)
      validateReference(value, ['teeZoneId', 'tee'], teeZones, `corridors.${id}`, issues, true)
      validateReference(value, ['greenId', 'green'], greens, `corridors.${id}`, issues, true)
      const length = value.lengthMetres ?? value.approximateLengthMetres ?? value.approximateLength
      if (length !== undefined && !isNonNegativeNumber(length)) issue(issues, 'invalid-corridor-length', `corridors.${id} 的长度必须为非负有限数。`)
      if (value.bearingSequence !== undefined && (!Array.isArray(value.bearingSequence) || value.bearingSequence.some((bearing) => !isFiniteNumber(bearing)))) {
        issue(issues, 'invalid-corridor-bearing', `corridors.${id} 的 bearingSequence 含非法数值。`)
      }
    })
  }

  if (!Array.isArray(document.transitions)) {
    issue(issues, 'invalid-transition-data', 'CourseTopology transitions 必须是数组。')
  } else {
    document.transitions.forEach((value, index) => {
      if (!isRecord(value)) {
        issue(issues, 'invalid-transition-data', `transitions[${index}] 必须是对象。`)
        return
      }
      const path = `transitions[${index}]`
      const fromCorridor = validateReference(value, ['fromCorridor', 'fromCorridorId'], corridors, path, issues, false)
      const toCorridor = validateReference(value, ['toCorridor', 'toCorridorId'], corridors, path, issues, false)
      validateReference(value, ['fromGreen', 'fromGreenId'], greens, path, issues, false)
      const toTeeZone = validateReference(value, ['toTeeZone', 'toTeeZoneId'], teeZones, path, issues, false)
      if (!toCorridor && !toTeeZone) issue(issues, 'missing-transition-target', `${path} 必须引用 toCorridor 或 toTeeZone。`)
      if (!fromCorridor && !getString(value, 'fromGreen', 'fromGreenId')) issue(issues, 'missing-transition-source', `${path} 必须引用 fromCorridor 或 fromGreen。`)
      const cost = value.costMetres ?? value.transitionCostMetres ?? value.straightTransitionMetres ?? value.cost
      if (!isNonNegativeNumber(cost)) issue(issues, 'invalid-transition-cost', `${path} 缺少合法的非负 transition cost。`)
    })
  }
  return issues
}

function independentSources(record: JsonRecord, candidate: JsonRecord | null): unknown[] {
  const values = record.independentEvidenceSources ?? record.independentEvidence ?? candidate?.independentEvidenceSources
  return Array.isArray(values) ? values.filter((value) => isNonEmptyString(value)) : []
}

function assignmentReference(record: JsonRecord, ...keys: string[]): string | null {
  return getString(record, ...keys)
}

function validateAssignment(
  value: unknown,
  index: number,
  solutionId: string,
  topology: JsonRecord | null,
  usedGreens: Map<string, number>,
  usedCorridors: Map<string, number>,
  issues: GlobalTopologyValidationIssue[],
): number | null {
  if (!isRecord(value)) {
    issue(issues, 'invalid-global-assignment', `方案 ${solutionId} 的 assignments[${index}] 必须是对象。`, { solutionId })
    return null
  }
  const rawHole = value.hole
  const hole = isFiniteNumber(rawHole) ? rawHole : null
  if (hole === null || !Number.isInteger(hole) || hole < 1 || hole > 18) {
    issue(issues, 'global-hole-out-of-range', `方案 ${solutionId} 的洞号 ${String(rawHole)} 不在 1-18 范围内。`, { solutionId })
  }
  const validHole = hole !== null && Number.isInteger(hole) && hole >= 1 && hole <= 18 ? hole : null
  const status = value.status
  if (!isNonEmptyString(status) || !HOLE_STATUSES.has(status)) issue(issues, 'invalid-global-assignment-status', `方案 ${solutionId} 洞 ${String(rawHole)} 的状态非法。`, { solutionId, hole: validHole ?? undefined })

  const green = assignmentReference(value, 'greenId', 'green')
  const corridor = assignmentReference(value, 'corridorId', 'corridor')
  const tee = assignmentReference(value, 'teeZoneId', 'tee')
  if (green) {
    if (usedGreens.has(green)) issue(issues, 'duplicate-global-green', `方案 ${solutionId} 中 Green ${green} 被洞 ${usedGreens.get(green)} 和洞 ${String(rawHole)} 重复分配。`, { solutionId, hole: validHole ?? undefined })
    else usedGreens.set(green, validHole ?? -1)
  }
  if (corridor) {
    if (usedCorridors.has(corridor)) issue(issues, 'duplicate-global-corridor', `方案 ${solutionId} 中 corridor ${corridor} 被洞 ${usedCorridors.get(corridor)} 和洞 ${String(rawHole)} 重复分配。`, { solutionId, hole: validHole ?? undefined })
    else usedCorridors.set(corridor, validHole ?? -1)
  }

  const candidateValue = value.candidate ?? value.match
  const candidate = isRecord(candidateValue) ? candidateValue : null
  const unknown = status === 'unknown'
  if (unknown && candidateValue != null) issue(issues, 'unknown-has-global-candidate', `方案 ${solutionId} 洞 ${String(rawHole)} 为 unknown 时不能带 candidate。`, { solutionId, hole: validHole ?? undefined })
  if (!unknown && (!green || !corridor || !tee)) issue(issues, 'missing-global-assignment-reference', `方案 ${solutionId} 洞 ${String(rawHole)} 的非 unknown assignment 缺少 Tee/Green/corridor 引用。`, { solutionId, hole: validHole ?? undefined })
  if (!unknown && candidateValue == null) issue(issues, 'missing-global-candidate', `方案 ${solutionId} 洞 ${String(rawHole)} 的非 unknown assignment 缺少 candidate/match。`, { solutionId, hole: validHole ?? undefined })

  const candidateScore = value.candidateScore ?? value.score ?? candidate?.score
  if (candidateScore !== undefined && !isFiniteNumber(candidateScore)) issue(issues, 'invalid-global-candidate-score', `方案 ${solutionId} 洞 ${String(rawHole)} 的候选排序分必须为有限数。`, { solutionId, hole: validHole ?? undefined })
  if (candidate && green && getString(candidate, 'greenId', 'green') && getString(candidate, 'greenId', 'green') !== green) issue(issues, 'global-candidate-reference-mismatch', `方案 ${solutionId} 洞 ${String(rawHole)} 的 candidate Green 与 assignment 不一致。`, { solutionId, hole: validHole ?? undefined })
  if (candidate && corridor && getString(candidate, 'corridorId', 'corridor') && getString(candidate, 'corridorId', 'corridor') !== corridor) issue(issues, 'global-candidate-reference-mismatch', `方案 ${solutionId} 洞 ${String(rawHole)} 的 candidate corridor 与 assignment 不一致。`, { solutionId, hole: validHole ?? undefined })

  const sources = independentSources(value, candidate)
  const independentFlag = value.mappingIndependentEvidence ?? candidate?.mappingIndependentEvidence
  if (status === 'high-confidence-inferred' && (independentFlag !== true || sources.length < 2)) {
    issue(issues, 'missing-independent-evidence', `方案 ${solutionId} 洞 ${String(rawHole)} 进入 high-confidence-inferred 前必须有至少两个独立证据来源，并声明 mappingIndependentEvidence=true。`, { solutionId, hole: validHole ?? undefined })
  }
  if (status === 'field-confirmed' && (sources.length < 2 || (value.fieldConfirmed !== undefined && value.fieldConfirmed !== true))) {
    issue(issues, 'missing-confirmation-source', `方案 ${solutionId} 洞 ${String(rawHole)} 的 field-confirmed 状态缺少独立现场确认来源。`, { solutionId, hole: validHole ?? undefined })
  }

  if (topology) {
    const topologyCorridors = new Set(asArray(topology.corridors).filter(isRecord).map((item) => item.id).filter(isNonEmptyString))
    const topologyGreens = new Set(asArray(topology.greens).filter(isRecord).map((item) => item.id).filter(isNonEmptyString))
    const topologyTees = new Set(asArray(topology.teeZones).filter(isRecord).map((item) => item.id).filter(isNonEmptyString))
    if (green && !topologyGreens.has(green)) issue(issues, 'unknown-global-green', `方案 ${solutionId} 洞 ${String(rawHole)} 引用了 topology 中不存在的 Green ${green}。`, { solutionId, hole: validHole ?? undefined })
    if (corridor && !topologyCorridors.has(corridor)) issue(issues, 'unknown-global-corridor', `方案 ${solutionId} 洞 ${String(rawHole)} 引用了 topology 中不存在的 corridor ${corridor}。`, { solutionId, hole: validHole ?? undefined })
    if (tee && !topologyTees.has(tee)) issue(issues, 'unknown-global-tee', `方案 ${solutionId} 洞 ${String(rawHole)} 引用了 topology 中不存在的 Tee zone ${tee}。`, { solutionId, hole: validHole ?? undefined })
  }
  return validHole
}

function validateSolutionTransitions(
  transitions: unknown,
  solutionId: string,
  topology: JsonRecord | null,
  issues: GlobalTopologyValidationIssue[],
): void {
  if (!Array.isArray(transitions)) {
    issue(issues, 'invalid-global-transitions', `方案 ${solutionId} 的 transitions 必须是数组。`, { solutionId })
    return
  }
  transitions.forEach((value, index) => {
    if (!isRecord(value)) {
      issue(issues, 'invalid-global-transition', `方案 ${solutionId} 的 transition ${index} 必须是对象。`, { solutionId })
      return
    }
    const path = `方案 ${solutionId} transition ${index}`
    const cost = value.costMetres ?? value.transitionCostMetres ?? value.straightTransitionMetres ?? value.cost
    if (!isNonNegativeNumber(cost)) issue(issues, 'invalid-global-transition-cost', `${path} 缺少合法的非负 transition cost。`, { solutionId })
    const from = getString(value, 'fromCorridor', 'fromCorridorId')
    const to = getString(value, 'toCorridor', 'toCorridorId')
    if (topology && from) {
      const ids = new Set(asArray(topology.corridors).filter(isRecord).map((item) => item.id).filter(isNonEmptyString))
      if (!ids.has(from)) issue(issues, 'unknown-global-transition-reference', `${path} 引用了不存在的起点 corridor ${from}。`, { solutionId })
    }
    if (topology && to) {
      const ids = new Set(asArray(topology.corridors).filter(isRecord).map((item) => item.id).filter(isNonEmptyString))
      if (!ids.has(to)) issue(issues, 'unknown-global-transition-reference', `${path} 引用了不存在的终点 corridor ${to}。`, { solutionId })
    }
  })
}

/** Validate one global Hole 1-18 solution. */
export function validateGlobalHoleSolution(
  solution: unknown,
  topology: unknown = null,
): GlobalTopologyValidationIssue[] {
  const issues: GlobalTopologyValidationIssue[] = []
  if (!isRecord(solution)) {
    issue(issues, 'invalid-global-solution', 'GlobalHoleSolution 必须是对象。')
    return issues
  }
  const solutionId = getString(solution, 'id', 'solutionId') ?? '<unknown>'
  if (!getString(solution, 'id', 'solutionId')) issue(issues, 'missing-global-solution-id', 'GlobalHoleSolution 缺少唯一 id。', { solutionId })
  if (!isFiniteNumber(solution.rankingScore)) issue(issues, 'invalid-ranking-score', `方案 ${solutionId} 的 rankingScore 必须为有限数。`, { solutionId })
  if (solution.scoreMeaning !== SCORE_MEANING && solution.scoreMeaning !== 'candidate-ranking-score-not-probability' && !(isNonEmptyString(solution.scoreMeaning) && solution.scoreMeaning.toLowerCase().includes('candidate') && solution.scoreMeaning.toLowerCase().includes('not probability'))) {
    issue(issues, 'invalid-score-meaning', `方案 ${solutionId} 必须明确声明候选排序分不是概率。`, { solutionId })
  }
  const scoreFields: Array<[string, number]> = [['featureMatchScore', 0], ['transitionCostMetres', 0], ['transitionPenalty', 0], ['conflictCount', 0], ['unresolvedHoleCount', 0]]
  for (const [field, minimum] of scoreFields) {
    const value = solution[field]
    if (value !== undefined && (!isFiniteNumber(value) || value < minimum)) issue(issues, 'invalid-global-score-field', `方案 ${solutionId} 的 ${field} 必须为合法非负数。`, { solutionId })
  }
  if (solution.conflictCount !== undefined && (!isFiniteNumber(solution.conflictCount) || !Number.isInteger(solution.conflictCount))) issue(issues, 'invalid-global-conflict-count', `方案 ${solutionId} 的 conflictCount 必须为整数。`, { solutionId })
  if (solution.unresolvedHoleCount !== undefined && (!isFiniteNumber(solution.unresolvedHoleCount) || !Number.isInteger(solution.unresolvedHoleCount) || solution.unresolvedHoleCount > 18)) issue(issues, 'invalid-global-unresolved-count', `方案 ${solutionId} 的 unresolvedHoleCount 必须是 0-18 整数。`, { solutionId })
  if (!isNonEmptyString(solution.status) || !SOLUTION_STATUSES.has(solution.status)) issue(issues, 'invalid-global-solution-status', `方案 ${solutionId} 的 status 非法。`, { solutionId })
  if (solution.status !== 'candidate' && (!Array.isArray(solution.evidence) || solution.evidence.filter(isNonEmptyString).length === 0)) issue(issues, 'missing-global-solution-evidence', `方案 ${solutionId} 的非 candidate 状态必须有 evidence。`, { solutionId })

  const assignments = solution.assignments ?? solution.entries
  if (!Array.isArray(assignments)) {
    issue(issues, 'invalid-global-assignments', `方案 ${solutionId} 的 assignments 必须是数组。`, { solutionId })
  } else {
    const holes = new Set<number>()
    const usedGreens = new Map<string, number>()
    const usedCorridors = new Map<string, number>()
    assignments.forEach((assignment, index) => {
      const hole = validateAssignment(assignment, index, solutionId, isRecord(topology) ? topology : null, usedGreens, usedCorridors, issues)
      if (hole !== null) {
        if (holes.has(hole)) issue(issues, 'duplicate-global-hole', `方案 ${solutionId} 中洞号 ${hole} 重复。`, { solutionId, hole })
        holes.add(hole)
      }
    })
    if (assignments.length !== 18) issue(issues, 'global-hole-count', `方案 ${solutionId} 应包含 18 个洞 assignment，当前为 ${assignments.length}。`, { solutionId })
    for (let hole = 1; hole <= 18; hole += 1) if (!holes.has(hole)) issue(issues, 'missing-global-hole', `方案 ${solutionId} 缺少洞 ${hole} assignment。`, { solutionId, hole })
    if (isFiniteNumber(solution.unresolvedHoleCount)) {
      const unresolved = assignments.filter((assignment) => isRecord(assignment) && assignment.status === 'unknown').length
      if (unresolved !== solution.unresolvedHoleCount) issue(issues, 'unresolved-count-mismatch', `方案 ${solutionId} 声明 unresolvedHoleCount=${solution.unresolvedHoleCount}，但实际有 ${unresolved} 个 unknown assignment。`, { solutionId })
    }
  }
  validateSolutionTransitions(solution.transitions, solutionId, isRecord(topology) ? topology : null, issues)
  return issues
}

/** Validate a Top-N global matching document and its solution-level uniqueness. */
export function validateGlobalHoleSolutionSet(
  document: unknown,
  topology: unknown = null,
  formalCourse: unknown = null,
): GlobalTopologyValidationIssue[] {
  const issues: GlobalTopologyValidationIssue[] = []
  if (!isRecord(document)) {
    issue(issues, 'invalid-global-document', 'GlobalHoleSolutionSet 必须是对象。')
    return issues
  }
  if (document.schemaVersion !== 1) issue(issues, 'invalid-global-schema', 'GlobalHoleSolutionSet schemaVersion 必须为 1。')
  if (!isNonEmptyString(document.courseId)) issue(issues, 'missing-global-course-id', 'GlobalHoleSolutionSet 缺少 courseId。')
  if (!isNonEmptyString(document.coordinateSystem) || !document.coordinateSystem.includes('WGS84')) issue(issues, 'invalid-global-crs', 'GlobalHoleSolutionSet 必须声明 WGS84。')
  if (!Array.isArray(document.solutions)) {
    issue(issues, 'invalid-global-solutions', 'GlobalHoleSolutionSet solutions 必须是数组。')
    return issues
  }
  const ids = new Set<string>()
  document.solutions.forEach((solution, index) => {
    const solutionId = isRecord(solution) ? getString(solution, 'id', 'solutionId') : null
    if (solutionId && ids.has(solutionId)) issue(issues, 'duplicate-global-solution-id', `solution id ${solutionId} 重复。`, { solutionId })
    if (solutionId) ids.add(solutionId)
    if (!solutionId && isRecord(solution)) issue(issues, 'missing-global-solution-id', `solutions[${index}] 缺少唯一 id。`)
    issues.push(...validateGlobalHoleSolution(solution, topology))
  })

  // A candidate mapping must not silently appear as verified spatial data in
  // the formal GeoJSON. Field-confirmed data may be promoted explicitly.
  if (isRecord(formalCourse) && Array.isArray(formalCourse.features)) {
    const featureByHole = new Map<number, JsonRecord>()
    for (const feature of formalCourse.features) {
      if (!isRecord(feature) || !isRecord(feature.properties)) continue
      const hole = feature.properties.hole
      if (isFiniteNumber(hole) && Number.isInteger(hole)) featureByHole.set(hole, feature.properties)
    }
    for (const solution of document.solutions) {
      if (!isRecord(solution)) continue
      const assignments = solution.assignments ?? solution.entries
      if (!Array.isArray(assignments)) continue
      for (const assignment of assignments) {
        if (!isRecord(assignment) || !isFiniteNumber(assignment.hole) || !Number.isInteger(assignment.hole)) continue
        if (assignment.status !== 'candidate') continue
        const feature = featureByHole.get(assignment.hole)
        if (!feature) continue
        const populated = feature.teeCenter != null || feature.greenCenter != null || feature.centerline != null || feature.spatialVerified === true || (feature.spatialConfidence !== undefined && feature.spatialConfidence !== 'none')
        if (populated) issue(issues, 'candidate-formal-status-mismatch', `洞 ${assignment.hole} 仍是 candidate，但正式 course 数据已经填入空间映射。`, { solutionId: getString(solution, 'id', 'solutionId') ?? undefined, hole: assignment.hole })
      }
    }
  }
  return issues
}

/** Backwards-friendly alias used by data validation scripts. */
export const validateGlobalMatching = validateGlobalHoleSolutionSet

/** Score semantics are intentionally exposed for generators and workbench labels. */
export const candidateRankingScoreMeaning = SCORE_MEANING
