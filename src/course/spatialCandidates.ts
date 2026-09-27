import type { GeoJSONLineString, GeoJSONPoint, GeoJSONPolygon, GeoJSONPosition } from './types'

export type SpatialCandidateStatus = 'unknown' | 'candidate' | 'high-confidence-inferred' | 'field-confirmed'

export interface SpatialObject {
  id: string
  kind: string
  sourceType: string
  osmWayId: number
  osmTags: Record<string, string>
  geometry: GeoJSONPolygon | GeoJSONLineString
  center: GeoJSONPoint
  imagePixels: { geometry: unknown; center: [number, number]; bounds: Record<string, number> }
  wgs84Bounds: Record<string, number>
  inOrthophotoBounds: boolean
  estimated: boolean
  digitization: 'imported' | 'manual' | 'field-survey'
  provenance: Record<string, string>
}

export interface SpatialCorridor {
  id: string
  kind: 'hole-corridor-proxy'
  tee: string
  green: string
  geometry: GeoJSONLineString
  imagePixels: { geometry: unknown; bounds: Record<string, number> }
  lengthMetres: number
  nearbyWater: string[]
  nearbyBunkers: string[]
  geometryRole: string
  centerline: false
  estimated: true
  provenance: Record<string, string>
}

export interface HoleCandidateMatch {
  tee: string
  green: string
  corridor: string
  score: number
  matchedTeeVariant: string
  matchedYardage: number
  targetMetres: number
  lineLengthMetres: number
  relativeLengthError: number
  evidence: string[]
  conflicts: string[]
}

export interface HoleSpatialCandidate {
  hole: number
  par: number
  teeYardages: Record<string, number>
  status: SpatialCandidateStatus
  bestCandidate: HoleCandidateMatch | null
  alternatives: HoleCandidateMatch[]
  evidence: string[]
  conflicts: string[]
  fieldConfirmed: boolean
  mappingIndependentEvidence: boolean
  spatialVerified: boolean
  spatialEstimated: boolean
  limitations: string[]
  provenance: Record<string, string>
}

export interface SpatialCandidatesDocument {
  schemaVersion: number
  courseId: string
  coordinateSystem: string
  sourceCrs: string
  orthophoto: {
    metadataFile: string
    width: number
    height: number
    pixelSizeMetres: { x: number; y: number; unit: string }
    wgs84Bounds: Record<string, number>
    pixelSemantics: string
  }
  source: Record<string, string>
  objectIdSemantics: string
  objects: SpatialObject[]
  corridors: SpatialCorridor[]
  holes: HoleSpatialCandidate[]
  transitions: Array<Record<string, unknown>>
  summary: { objectCounts: Record<string, number>; corridorCount: number; holeStatusCounts: Record<string, number>; fieldConfirmedCount: number }
  warnings: string[]
}

export interface SpatialValidationIssue {
  code: string
  hole?: number
  message: string
}

function validPosition(position: unknown): position is GeoJSONPosition {
  return Array.isArray(position) && position.length === 2 && position.every((value) => typeof value === 'number' && Number.isFinite(value)) &&
    position[0] >= -180 && position[0] <= 180 && position[1] >= -90 && position[1] <= 90
}

function validPixel(position: unknown, width: number, height: number): position is [number, number] {
  return Array.isArray(position) && position.length === 2 && position.every((value) => typeof value === 'number' && Number.isFinite(value)) &&
    position[0] >= 0 && position[0] <= width && position[1] >= 0 && position[1] <= height
}

function validPixelBounds(bounds: unknown, width: number, height: number): boolean {
  if (!bounds || typeof bounds !== 'object') return false
  const value = bounds as Record<string, unknown>
  const minColumn = value.minColumn
  const minRow = value.minRow
  const maxColumn = value.maxColumn
  const maxRow = value.maxRow
  if (![minColumn, minRow, maxColumn, maxRow].every((item) => typeof item === 'number' && Number.isFinite(item))) return false
  const minColumnNumber = minColumn as number
  const minRowNumber = minRow as number
  const maxColumnNumber = maxColumn as number
  const maxRowNumber = maxRow as number
  return minColumnNumber >= 0 && minColumnNumber <= maxColumnNumber && maxColumnNumber <= width &&
    minRowNumber >= 0 && minRowNumber <= maxRowNumber && maxRowNumber <= height
}

function validGeometryCoordinates(value: unknown): boolean {
  if (!Array.isArray(value) || value.length === 0) return false
  if (value.length === 2 && value.every((item) => typeof item === 'number' && Number.isFinite(item))) return validPosition(value)
  return value.every((child) => validGeometryCoordinates(child))
}

function hasText(values: unknown): values is string[] {
  return Array.isArray(values) && values.length > 0 && values.every((value) => typeof value === 'string' && value.length > 0)
}

function validMatch(match: HoleCandidateMatch | null, corridorById: Map<string, SpatialCorridor>, objectIds: Set<string>): boolean {
  return match !== null && objectIds.has(match.tee) && objectIds.has(match.green) && corridorById.has(match.corridor) &&
    corridorById.get(match.corridor)?.tee === match.tee && corridorById.get(match.corridor)?.green === match.green &&
    Number.isFinite(match.score) && match.score >= 0 && match.score <= 1 && hasText(match.evidence) && hasText(match.conflicts)
}

/** Validate the independent candidate layer without promoting it to runtime hole geometry. */
export function validateSpatialCandidates(document: SpatialCandidatesDocument): SpatialValidationIssue[] {
  const issues: SpatialValidationIssue[] = []
  if (document.schemaVersion !== 1) issues.push({ code: 'invalid-candidate-schema', message: '空间候选 schemaVersion 必须为 1。' })
  if (!document.coordinateSystem.includes('WGS84')) issues.push({ code: 'invalid-candidate-crs', message: '空间候选运行时坐标系必须声明 WGS84。' })
  const imageWidth = document.orthophoto?.width
  const imageHeight = document.orthophoto?.height
  if (!Number.isFinite(imageWidth) || !Number.isFinite(imageHeight) || imageWidth <= 0 || imageHeight <= 0) {
    issues.push({ code: 'invalid-orthophoto-metadata', message: '正射影像宽高必须为正数。' })
  }
  const objectIds = new Set<string>()
  for (const object of document.objects ?? []) {
    if (objectIds.has(object.id)) issues.push({ code: 'duplicate-candidate-id', message: `空间对象 ID ${object.id} 重复。` })
    objectIds.add(object.id)
    if (!validPosition(object.center?.coordinates)) issues.push({ code: 'invalid-candidate-coordinate', message: `空间对象 ${object.id} 的中心坐标非法。` })
    if (!validPixel(object.imagePixels?.center, imageWidth, imageHeight) || !validPixelBounds(object.imagePixels?.bounds, imageWidth, imageHeight)) {
      issues.push({ code: 'invalid-candidate-pixel', message: `空间对象 ${object.id} 的像素中心或范围超出正射影像边界。` })
    }
    if (!validGeometryCoordinates(object.geometry?.coordinates)) issues.push({ code: 'invalid-candidate-geometry', message: `空间对象 ${object.id} 含非法经纬度或几何坐标结构。` })
    if (!object.provenance?.sourceFile || !object.provenance?.coordinateSystem) issues.push({ code: 'missing-candidate-provenance', message: `空间对象 ${object.id} 缺少来源或坐标系记录。` })
  }
  const corridorIds = new Set<string>()
  const corridors = new Map<string, SpatialCorridor>()
  for (const corridor of document.corridors ?? []) {
    if (corridorIds.has(corridor.id)) issues.push({ code: 'duplicate-corridor-id', message: `corridor ID ${corridor.id} 重复。` })
    corridorIds.add(corridor.id)
    corridors.set(corridor.id, corridor)
    if (!objectIds.has(corridor.tee) || !objectIds.has(corridor.green)) issues.push({ code: 'unknown-corridor-object', message: `${corridor.id} 引用了不存在的 Tee/Green。` })
    if (corridor.geometry?.type !== 'LineString' || corridor.geometry.coordinates.length < 2 || corridor.geometry.coordinates.some((position) => !validPosition(position))) issues.push({ code: 'invalid-corridor-geometry', message: `${corridor.id} 必须是至少两个合法坐标点的 LineString。` })
    if (!validPixelBounds(corridor.imagePixels?.bounds, imageWidth, imageHeight)) issues.push({ code: 'invalid-candidate-pixel', message: `${corridor.id} 的像素范围超出正射影像边界。` })
    if (!Number.isFinite(corridor.lengthMetres) || corridor.lengthMetres <= 0) issues.push({ code: 'invalid-corridor-length', message: `${corridor.id} 的长度必须为正数。` })
    if (!corridor.provenance?.sourceFile || !corridor.provenance?.coordinateSystem) issues.push({ code: 'missing-candidate-provenance', message: `${corridor.id} 缺少来源或坐标系记录。` })
  }
  const holesByNumber = new Map<number, HoleSpatialCandidate>()
  for (const hole of document.holes ?? []) {
    if (holesByNumber.has(hole.hole)) issues.push({ code: 'duplicate-candidate-hole', hole: hole.hole, message: `候选洞号 ${hole.hole} 重复。` })
    holesByNumber.set(hole.hole, hole)
    if (!Number.isInteger(hole.hole) || hole.hole < 1 || hole.hole > 18) issues.push({ code: 'candidate-hole-out-of-range', hole: hole.hole, message: `候选洞号 ${hole.hole} 不在 1-18 范围内。` })
    if (!['unknown', 'candidate', 'high-confidence-inferred', 'field-confirmed'].includes(hole.status)) issues.push({ code: 'invalid-candidate-status', hole: hole.hole, message: `洞 ${hole.hole} 的候选状态非法。` })
    if (hole.status === 'unknown' && (hole.bestCandidate !== null || hole.alternatives.length > 0)) issues.push({ code: 'unknown-has-candidate', hole: hole.hole, message: `unknown 洞不能带正式候选。` })
    if (hole.status !== 'unknown' && !validMatch(hole.bestCandidate, corridors, objectIds)) issues.push({ code: 'missing-best-candidate', hole: hole.hole, message: `洞 ${hole.hole} 的非 unknown 状态必须引用有效 bestCandidate。` })
    if (hole.status === 'high-confidence-inferred' && !hasText(hole.evidence)) issues.push({ code: 'missing-candidate-evidence', hole: hole.hole, message: `high-confidence-inferred 洞必须有 evidence。` })
    if (hole.fieldConfirmed && hole.status !== 'field-confirmed') issues.push({ code: 'confirmation-status-mismatch', hole: hole.hole, message: `fieldConfirmed=true 时状态必须为 field-confirmed。` })
    if (hole.status === 'field-confirmed' && (!hole.fieldConfirmed || !hole.mappingIndependentEvidence)) issues.push({ code: 'missing-confirmation-source', hole: hole.hole, message: `field-confirmed 洞必须包含独立确认标记。` })
    if (!hole.provenance?.holeParDistance || !hole.provenance?.candidateMethod) issues.push({ code: 'missing-candidate-provenance', hole: hole.hole, message: `洞 ${hole.hole} 缺少候选来源引用。` })
    for (const alternative of hole.alternatives ?? []) {
      if (!validMatch(alternative, corridors, objectIds)) issues.push({ code: 'invalid-alternative-candidate', hole: hole.hole, message: `洞 ${hole.hole} 的替代候选引用无效。` })
    }
  }
  const bestObjectHoles = new Map<string, number[]>()
  for (const hole of document.holes ?? []) {
    if (!hole.bestCandidate) continue
    for (const id of [hole.bestCandidate.tee, hole.bestCandidate.green]) bestObjectHoles.set(id, [...(bestObjectHoles.get(id) ?? []), hole.hole])
  }
  for (const [id, holes] of bestObjectHoles) {
    if (holes.length > 1 && !holes.every((hole) => (holesByNumber.get(hole)?.conflicts ?? []).some((conflict) => conflict.includes('没有 Hole/ref') || conflict.includes('未编号')))) {
      issues.push({ code: 'duplicate-best-object-without-conflict', message: `${id} 被多个洞作为最佳候选，但没有冲突说明。` })
    }
  }
  if (holesByNumber.size !== 18) issues.push({ code: 'candidate-hole-count', message: `空间候选应覆盖 18 洞，当前为 ${holesByNumber.size} 洞。` })
  return issues
}
