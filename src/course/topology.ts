import type {
  GeoJSONLineString,
  GeoJSONPoint,
  GeoJSONPolygon,
  GeoJSONPosition,
  GolfCourseGeoJSON,
} from './types'
import type {
  HoleCandidateMatch,
  HoleSpatialCandidate,
  SpatialCandidatesDocument,
  SpatialObject,
  SpatialCandidateStatus,
} from './spatialCandidates'

/** Tee-zone 来源；这些值描述证据来源，不代表洞号。 */
export type TeeZoneSource = 'osm' | 'orthophoto-inferred' | 'topology-inferred' | 'unknown'

export type TeeZoneDetectionMethod =
  | 'osm-feature'
  | 'corridor-endpoint'
  | 'orthophoto-review'
  | 'unknown'

export type GreenClassification = 'primary-course' | 'practice' | 'training' | 'unknown'

export type CorridorShape = 'straight' | 'left-dogleg' | 'right-dogleg' | 'uncertain'

export type TopologyRouteSection = 'front-nine' | 'back-nine' | 'nine-boundary' | 'unknown'

export interface TeeZoneCandidate {
  /** 稳定的审查 ID，例如 TZ01；不编码 Hole 编号。 */
  id: string
  sourceObjectId: string
  center: GeoJSONPoint
  geometry: GeoJSONPolygon | null
  source: TeeZoneSource
  detectionMethod: TeeZoneDetectionMethod
  confidence: SpatialCandidateStatus
  evidence: string[]
  isOsm: boolean
  isImageInferred: boolean
  status: SpatialCandidateStatus
  provenance: Record<string, string>
}

export interface GreenCandidateClassification {
  id: string
  classification: GreenClassification
  status: SpatialCandidateStatus
  center: GeoJSONPoint
  geometry: GeoJSONPolygon | null
  evidence: string[]
  sourceObjectId: string
  provenance: Record<string, string>
}

export interface HoleCorridorCandidate {
  /** 保留现有 Cxx ID，便于与 spatial-candidates.json 交叉复查。 */
  id: string
  sourceCorridorId: string
  teeZoneId: string
  teeObjectId: string
  greenId: string
  centerline: GeoJSONLineString
  approximateLengthMetres: number
  bearingSequence: number[]
  shape: CorridorShape
  nearbyBunkerIds: string[]
  nearbyWaterIds: string[]
  geometryRole: string
  isProxy: boolean
  estimated: boolean
  status: SpatialCandidateStatus
  evidence: string[]
  provenance: Record<string, string>
}

export interface TopologyTransition {
  id: string
  fromCorridorId: string
  toCorridorId: string
  fromGreenId: string
  toTeeZoneId: string
  toTeeObjectId: string
  straightDistanceMetres: number
  /** No cart-path network is present in the current input; null is explicit. */
  cartPathDistanceMetres: number | null
  crossingPenalty: number
  transitionCostMetres: number
  routeSection: TopologyRouteSection
  evidence: string[]
}

export interface CourseTopology {
  schemaVersion: 1
  courseId: string
  coordinateSystem: string
  teeZones: TeeZoneCandidate[]
  greens: GreenCandidateClassification[]
  corridors: HoleCorridorCandidate[]
  transitions: TopologyTransition[]
  warnings: string[]
  provenance: Record<string, string>
}

export interface GlobalSolutionEntry {
  hole: number
  par: number | null
  section: 'front-nine' | 'back-nine'
  status: SpatialCandidateStatus
  teeZoneId: string | null
  teeObjectId: string | null
  greenId: string | null
  corridorId: string | null
  candidate: HoleCandidateMatch | null
  featureMatchScore: number
  transitionFromPreviousMetres: number | null
  candidateScore: number
  mappingIndependentEvidence: boolean
  independentEvidenceSources: string[]
  fieldConfirmed: boolean
  evidence: string[]
  conflicts: string[]
}

export interface GlobalSolutionTransition {
  fromHole: number
  toHole: number
  fromCorridorId: string | null
  toCorridorId: string | null
  costMetres: number
  transitionCostMetres: number
}

export interface GlobalHoleSolution {
  id: string
  rankingScore: number
  scoreMeaning: 'candidate ranking score, not probability'
  featureMatchScore: number
  transitionCostMetres: number
  conflictCount: number
  unresolvedHoleCount: number
  entries: GlobalSolutionEntry[]
  /** Alias used by data validators and the workbench JSON boundary. */
  assignments: GlobalSolutionEntry[]
  transitions: GlobalSolutionTransition[]
  differences: string[]
  status: SpatialCandidateStatus
  evidence: string[]
  warnings: string[]
}

export interface GlobalMatchingResult {
  schemaVersion: 1
  courseId: string
  coordinateSystem: string
  topology: CourseTopology
  solutions: GlobalHoleSolution[]
  scoreMeaning: 'candidate ranking score, not probability'
  warnings: string[]
}

export interface GlobalMatchingOptions {
  /** Beam width bounds runtime while retaining deterministic top-ranked paths. */
  beamWidth?: number
  topN?: number
  /** Optional WGS84 clubhouse/starter coordinate used only as a soft start cost. */
  clubhouse?: GeoJSONPosition
}

type EnrichedTeeZoneInput = Omit<TeeZoneCandidate, 'center' | 'geometry'> & {
  center: GeoJSONPoint
  geometry?: GeoJSONPolygon | null
}

type EnrichedGreenInput = Partial<GreenCandidateClassification> & {
  id: string
  sourceObjectId?: string
  center?: GeoJSONPoint
  geometry?: GeoJSONPolygon | null
}

type EnrichedCorridorInput = Partial<SpatialCorridorLike> & {
  id: string
  tee?: string
  teeZone?: string
  green: string
  geometry?: GeoJSONLineString
  centerline?: GeoJSONLineString
}

interface SpatialCorridorLike {
  kind: string
  lengthMetres: number
  approximateLengthMetres: number
  nearbyWater: string[]
  nearbyWaterIds: string[]
  nearbyBunkers: string[]
  nearbyBunkerIds: string[]
  geometryRole: string
  isProxy: boolean
  centerline: boolean | GeoJSONLineString
  estimated: boolean
  status: SpatialCandidateStatus
  provenance: Record<string, string>
}

interface EnrichedCandidateDocument extends SpatialCandidatesDocument {
  teeZones?: EnrichedTeeZoneInput[]
  greenClassifications?: EnrichedGreenInput[]
  topologyCorridors?: EnrichedCorridorInput[]
  globalSolutions?: Array<Record<string, unknown>>
}

interface SearchState {
  entries: GlobalSolutionEntry[]
  usedGreens: Set<string>
  usedCorridors: Set<string>
  featureSum: number
  transitionCost: number
  unresolved: number
  conflictCount: number
  key: string
}

interface HoleInput {
  hole: number
  par: number | null
  teeYardages: Record<string, number>
  source: HoleSpatialCandidate | null
}

const DEFAULT_BEAM_WIDTH = 512
const DEFAULT_TOP_N = 3
const UNKNOWN_MATCH_PENALTY = 0.32
const TRANSITION_WEIGHT = 0.15

function round(value: number, digits = 2): number {
  const scale = 10 ** digits
  return Math.round(value * scale) / scale
}

function haversineMetres(left: GeoJSONPosition, right: GeoJSONPosition): number {
  const earthRadius = 6371008.8
  const toRadians = (value: number) => value * Math.PI / 180
  const latitudeDelta = toRadians(right[1] - left[1])
  const longitudeDelta = toRadians(right[0] - left[0])
  const latitudeOne = toRadians(left[1])
  const latitudeTwo = toRadians(right[1])
  const a = Math.sin(latitudeDelta / 2) ** 2 + Math.cos(latitudeOne) * Math.cos(latitudeTwo) * Math.sin(longitudeDelta / 2) ** 2
  return earthRadius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function bearingDegrees(left: GeoJSONPosition, right: GeoJSONPosition): number {
  const latitudeOne = left[1] * Math.PI / 180
  const latitudeTwo = right[1] * Math.PI / 180
  const deltaLongitude = (right[0] - left[0]) * Math.PI / 180
  const y = Math.sin(deltaLongitude) * Math.cos(latitudeTwo)
  const x = Math.cos(latitudeOne) * Math.sin(latitudeTwo) - Math.sin(latitudeOne) * Math.cos(latitudeTwo) * Math.cos(deltaLongitude)
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360
}

function circularDifference(left: number, right: number): number {
  const absolute = Math.abs(left - right) % 360
  return absolute > 180 ? 360 - absolute : absolute
}

function objectById(document: SpatialCandidatesDocument): Map<string, SpatialObject> {
  return new Map((document.objects ?? []).map((object) => [object.id, object]))
}

function stableSourceObjects(document: SpatialCandidatesDocument): SpatialObject[] {
  return (document.objects ?? []).filter((object) => object.kind === 'tee').sort((left, right) => left.id.localeCompare(right.id))
}

function teeZoneId(index: number): string {
  return `TZ${String(index + 1).padStart(2, '0')}`
}

function makeTeeZones(document: SpatialCandidatesDocument): TeeZoneCandidate[] {
  const enriched = (document as EnrichedCandidateDocument).teeZones
  if (enriched && enriched.length > 0) {
    return enriched
      .slice()
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((zone) => ({
        ...zone,
        geometry: zone.geometry ?? null,
        source: zone.source ?? 'unknown',
        detectionMethod: zone.detectionMethod ?? 'unknown',
        confidence: zone.confidence ?? 'candidate',
        evidence: zone.evidence ?? ['拓扑脚本提供的 Tee zone 候选，仍未绑定洞号。'],
        isOsm: zone.isOsm ?? false,
        isImageInferred: zone.isImageInferred ?? false,
        status: zone.status ?? 'candidate',
        provenance: zone.provenance ?? {},
      }))
  }
  const tees = stableSourceObjects(document)
  return tees.map((object, index) => {
    return {
      id: teeZoneId(index),
      sourceObjectId: object.id,
      center: object.center,
      geometry: object.geometry.type === 'Polygon' ? object.geometry : null,
      source: 'osm' as const,
      detectionMethod: 'osm-feature' as const,
      confidence: 'candidate' as const,
      evidence: [
        `OSM 未编号 Tee 对象 ${object.id}，仅作为空间起点候选。`,
        '没有独立 Hole/ref 编号证据，不把 Tee zone 解释为某一洞。',
      ],
      isOsm: true,
      isImageInferred: false,
      status: 'candidate' as const,
      provenance: {
        source: object.provenance?.source ?? 'OpenStreetMap Overpass extract',
        sourceFile: object.provenance?.sourceFile ?? 'data/raw/osm-jingshanhu-golf.json',
        coordinateSystem: object.provenance?.coordinateSystem ?? 'EPSG:4326 / WGS84',
        detectionMethod: 'OSM golf=tee object',
      },
    }
  })
}

function classifyGreenObjects(document: SpatialCandidatesDocument): GreenCandidateClassification[] {
  const enriched = (document as EnrichedCandidateDocument).greenClassifications
  if (enriched && enriched.length > 0) {
    const objects = objectById(document)
    return enriched
      .slice()
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((green) => ({
        id: green.id,
        classification: green.classification ?? 'unknown',
        status: green.status ?? 'candidate',
        center: green.center ?? objects.get(green.sourceObjectId ?? green.id)?.center ?? { type: 'Point', coordinates: [0, 0] },
        geometry: green.geometry ?? (objects.get(green.sourceObjectId ?? green.id)?.geometry.type === 'Polygon' ? objects.get(green.sourceObjectId ?? green.id)?.geometry as GeoJSONPolygon : null),
        sourceObjectId: green.sourceObjectId ?? green.id,
        evidence: green.evidence ?? ['Green 分类来自候选脚本，不能独立确认正式 18 洞。'],
        provenance: green.provenance ?? {},
      }))
  }
  return (document.objects ?? [])
    .filter((object) => object.kind === 'green')
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((object) => ({
      id: object.id,
      classification: 'unknown',
      status: 'candidate',
      center: object.center,
      geometry: object.geometry.type === 'Polygon' ? object.geometry : null,
      sourceObjectId: object.id,
      evidence: [
        'OSM Green 未带 Hole/ref 编号，无法仅凭空间对象区分正式 18 洞、练习区或误识别。',
      ],
      provenance: {
        source: object.provenance?.source ?? 'OpenStreetMap Overpass extract',
        sourceFile: object.provenance?.sourceFile ?? 'data/raw/osm-jingshanhu-golf.json',
        coordinateSystem: object.provenance?.coordinateSystem ?? 'EPSG:4326 / WGS84',
      },
    }))
}

function shapeFromGeometry(geometry: GeoJSONLineString, isProxy: boolean): { shape: CorridorShape; bearings: number[] } {
  const bearings = geometry.coordinates.slice(0, -1).map((point, index) => bearingDegrees(point, geometry.coordinates[index + 1]))
  if (isProxy || bearings.length < 2) return { shape: bearings.length > 0 ? 'straight' : 'uncertain', bearings }
  const turns = bearings.slice(1).map((bearing, index) => {
    const previous = bearings[index]
    const signed = ((bearing - previous + 540) % 360) - 180
    return signed
  })
  const significant = turns.filter((turn) => Math.abs(turn) >= 25)
  if (significant.length === 0) return { shape: 'straight', bearings }
  const sum = significant.reduce((total, turn) => total + turn, 0)
  return { shape: sum < 0 ? 'left-dogleg' : 'right-dogleg', bearings }
}

function makeCorridors(document: SpatialCandidatesDocument, teeZones: TeeZoneCandidate[]): HoleCorridorCandidate[] {
  const teeZoneByObject = new Map(teeZones.map((zone) => [zone.sourceObjectId, zone.id]))
  const sourceCorridors = ((document as EnrichedCandidateDocument).topologyCorridors ?? document.corridors ?? []) as EnrichedCorridorInput[]
  return sourceCorridors
    .filter((corridor) => Boolean(corridor.tee ?? corridor.teeZone) && Boolean(corridor.green))
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((corridor): HoleCorridorCandidate | null => {
      const teeObjectId = corridor.tee ?? ''
      const geometry = corridor.centerline && typeof corridor.centerline !== 'boolean' ? corridor.centerline : corridor.geometry
      if (!geometry) return null
      const isProxy = corridor.centerline === false || corridor.isProxy === true || (corridor.geometryRole ?? '').toLowerCase().includes('proxy')
      const shape = shapeFromGeometry(geometry, isProxy)
      const teeZone = corridor.teeZone ?? teeZoneByObject.get(teeObjectId) ?? `TZ-UNKNOWN-${teeObjectId}`
      const nearbyWater = corridor.nearbyWater ?? corridor.nearbyWaterIds ?? []
      const nearbyBunkers = corridor.nearbyBunkers ?? corridor.nearbyBunkerIds ?? []
      return {
        id: corridor.id,
        sourceCorridorId: corridor.id,
        teeZoneId: teeZone ?? `TZ-UNKNOWN-${corridor.tee}`,
        teeObjectId,
        greenId: corridor.green,
        centerline: geometry,
        approximateLengthMetres: round(corridor.approximateLengthMetres ?? corridor.lengthMetres ?? 0),
        bearingSequence: shape.bearings.map((bearing) => round(bearing, 1)),
        shape: shape.shape,
        nearbyBunkerIds: [...nearbyBunkers].sort(),
        nearbyWaterIds: [...nearbyWater].sort(),
        geometryRole: corridor.geometryRole ?? 'candidate corridor',
        isProxy,
        estimated: corridor.estimated ?? true,
        status: corridor.status ?? 'candidate',
        evidence: [
          `沿用空间候选 ${corridor.id} 的 Tee→Green 几何和长度。`,
          isProxy ? '该几何是直线长度 proxy，不是经影像复核的实际球道 centerline。' : 'centerline 几何来自候选输入，仍需独立洞号证据。',
          ...nearbyWater.map((id) => `附近水体 ${id} 仅作复查提示。`),
          ...nearbyBunkers.map((id) => `附近沙坑 ${id} 仅作复查提示。`),
        ],
        provenance: {
          ...(corridor.provenance ?? {}),
          sourceCorridorId: corridor.id,
          coordinateSystem: corridor.provenance?.coordinateSystem ?? 'EPSG:4326 / WGS84',
        },
      }
    })
    .filter((corridor): corridor is HoleCorridorCandidate => corridor !== null)
}

function transitionRouteSection(fromIndex: number, toIndex: number): TopologyRouteSection {
  if (fromIndex < 9 && toIndex < 9) return 'front-nine'
  if (fromIndex >= 9 && toIndex >= 9) return 'back-nine'
  return 'nine-boundary'
}

function makeTransitionsWithObjects(
  corridors: HoleCorridorCandidate[],
  teeZones: TeeZoneCandidate[],
  objects: Map<string, SpatialObject>,
): TopologyTransition[] {
  const teeById = new Map(teeZones.map((zone) => [zone.id, zone]))
  const transitions: TopologyTransition[] = []
  for (const from of corridors) {
    const fromGreen = objects.get(from.greenId)?.center.coordinates
    if (!fromGreen) continue
    for (const to of corridors) {
      if (from.id === to.id) continue
      const tee = teeById.get(to.teeZoneId)
      if (!tee) continue
      const distance = round(haversineMetres(fromGreen, tee.center.coordinates))
      const sameGreenPenalty = from.greenId === to.greenId ? 180 : 0
      const teeReusePenalty = from.teeZoneId === to.teeZoneId ? 0 : 0
      const crossingPenalty = sameGreenPenalty + teeReusePenalty
      const routeSection: TopologyRouteSection = 'unknown'
      transitions.push({
        id: `${from.id}->${to.id}`,
        fromCorridorId: from.id,
        toCorridorId: to.id,
        fromGreenId: from.greenId,
        toTeeZoneId: to.teeZoneId,
        toTeeObjectId: to.teeObjectId,
        straightDistanceMetres: distance,
        cartPathDistanceMetres: null,
        crossingPenalty,
        transitionCostMetres: round(distance + crossingPenalty),
        routeSection,
        evidence: [
          'Green→下一 Tee 采用 WGS84 欧氏近似距离，作为软约束。',
          '当前没有可路由的 cart path 网络，因此 cartPathDistanceMetres 保持 null。',
        ],
      })
    }
  }
  return transitions
}

/** Build stable spatial topology from the existing unnumbered candidate layer. */
export function buildCourseTopology(document: SpatialCandidatesDocument): CourseTopology {
  const objects = objectById(document)
  const teeZones = makeTeeZones(document)
  const greens = classifyGreenObjects(document)
  const corridors = makeCorridors(document, teeZones)
  const transitions = makeTransitionsWithObjects(corridors, teeZones, objects)
  const warnings = [
    'Tee zone、Green 和 corridor 均为未编号候选；本图不产生 Hole 1-18 事实。',
    '当前 corridor 主要是 Tee→Green 直线 proxy，不能当作实测球道中心线。',
    '转场距离是软约束；没有 cart path 路网或穿越球道的独立判定。',
  ]
  if (teeZones.length < 3) warnings.push(`当前只发现 ${teeZones.length} 个 OSM Tee zone，未据此让少数 Tee 伪装为 18 洞起点。`)
  return {
    schemaVersion: 1,
    courseId: document.courseId,
    coordinateSystem: document.coordinateSystem,
    teeZones,
    greens,
    corridors,
    transitions,
    warnings,
    provenance: {
      spatialCandidates: 'data/derived/jingshanhu/spatial-candidates.json',
      coordinateSystem: document.coordinateSystem,
      method: 'Deterministic conversion of spatial candidates; no ML and no hole-number promotion',
    },
  }
}

function metadataInputs(document: SpatialCandidatesDocument, course?: GolfCourseGeoJSON): HoleInput[] {
  const courseByHole = new Map((course?.features ?? []).map((feature) => [feature.properties.hole, feature.properties]))
  const sourceByHole = new Map((document.holes ?? []).map((hole) => [hole.hole, hole]))
  return Array.from({ length: 18 }, (_, index) => {
    const hole = index + 1
    const source = sourceByHole.get(hole) ?? null
    const properties = courseByHole.get(hole)
    return {
      hole,
      par: properties?.par ?? source?.par ?? null,
      teeYardages: { ...(properties?.teeYardages ?? source?.teeYardages ?? {}) },
      source,
    }
  })
}

function rawString(record: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.length > 0) return value
  }
  return null
}

function rawNumber(record: Record<string, unknown>, ...keys: string[]): number | null {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'number' && Number.isFinite(value)) return value
  }
  return null
}

/** Normalize the Python-generated schema-2 solutions for runtime consumers. */
function normalizeGeneratedSolutions(
  document: SpatialCandidatesDocument,
  topology: CourseTopology,
  course: GolfCourseGeoJSON | undefined,
  topN: number,
): GlobalHoleSolution[] | null {
  const rawSolutions = (document as EnrichedCandidateDocument).globalSolutions
  if (!Array.isArray(rawSolutions) || rawSolutions.length === 0) return null
  const holeInputs = new Map(metadataInputs(document, course).map((hole) => [hole.hole, hole]))
  const solutions: GlobalHoleSolution[] = []
  for (const [solutionIndex, rawValue] of rawSolutions.slice(0, topN).entries()) {
    const raw = rawValue && typeof rawValue === 'object' && !Array.isArray(rawValue) ? rawValue : {}
    const rawAssignments = Array.isArray(raw.assignments) ? raw.assignments : raw.entries
    if (!Array.isArray(rawAssignments)) continue
    const entries: GlobalSolutionEntry[] = rawAssignments.map((value): GlobalSolutionEntry => {
      const item = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
      const holeValue = rawNumber(item, 'hole') ?? 0
      const hole = Math.trunc(holeValue)
      const candidateValue = item.candidate
      const candidateRecord = candidateValue && typeof candidateValue === 'object' && !Array.isArray(candidateValue)
        ? candidateValue as Record<string, unknown>
        : null
      const corridorId = rawString(item, 'corridorId', 'corridor')
      const greenId = rawString(item, 'greenId', 'green')
      const teeZoneId = rawString(item, 'teeZoneId', 'teeZone')
      const teeObjectId = rawString(item, 'teeObjectId') ?? (candidateRecord ? rawString(candidateRecord, 'tee') : null)
      const candidate = candidateRecord && rawString(candidateRecord, 'tee') && rawString(candidateRecord, 'green') && rawString(candidateRecord, 'corridor')
        ? {
          tee: rawString(candidateRecord, 'tee') as string,
          green: rawString(candidateRecord, 'green') as string,
          corridor: rawString(candidateRecord, 'corridor') as string,
          score: rawNumber(candidateRecord, 'score') ?? rawNumber(item, 'candidateScore', 'featureMatchScore') ?? 0,
          matchedTeeVariant: rawString(candidateRecord, 'matchedTeeVariant') ?? 'unknown',
          matchedYardage: rawNumber(candidateRecord, 'matchedYardage') ?? 0,
          targetMetres: rawNumber(candidateRecord, 'targetMetres') ?? 0,
          lineLengthMetres: rawNumber(candidateRecord, 'lineLengthMetres') ?? 0,
          relativeLengthError: rawNumber(candidateRecord, 'relativeLengthError') ?? 0,
          evidence: Array.isArray(candidateRecord.evidence) ? candidateRecord.evidence.filter((line): line is string => typeof line === 'string') : [],
          conflicts: Array.isArray(candidateRecord.conflicts) ? candidateRecord.conflicts.filter((line): line is string => typeof line === 'string') : [],
        } satisfies HoleCandidateMatch
        : null
      const source = holeInputs.get(hole)
      const statusValue = rawString(item, 'status')
      const status: SpatialCandidateStatus = statusValue === 'unknown' || statusValue === 'high-confidence-inferred' || statusValue === 'field-confirmed'
        ? statusValue
        : (corridorId ? 'candidate' : 'unknown')
      const listOfStrings = (field: unknown): string[] => Array.isArray(field) ? field.filter((line): line is string => typeof line === 'string') : []
      return {
        hole,
        par: rawNumber(item, 'par') ?? source?.par ?? null,
        section: hole <= 9 ? 'front-nine' : 'back-nine',
        status,
        teeZoneId,
        teeObjectId,
        greenId,
        corridorId,
        candidate,
        featureMatchScore: rawNumber(item, 'featureMatchScore') ?? candidate?.score ?? 0,
        transitionFromPreviousMetres: rawNumber(item, 'transitionFromPreviousMetres'),
        candidateScore: rawNumber(item, 'candidateScore') ?? candidate?.score ?? 0,
        mappingIndependentEvidence: item.mappingIndependentEvidence === true,
        independentEvidenceSources: listOfStrings(item.independentEvidenceSources),
        fieldConfirmed: item.fieldConfirmed === true,
        evidence: listOfStrings(item.evidence),
        conflicts: listOfStrings(item.conflicts),
      }
    })
    const rawTransitions = Array.isArray(raw.transitions) ? raw.transitions : []
    const transitions: GlobalSolutionTransition[] = rawTransitions.map((value) => {
      const item = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
      return {
        fromHole: Math.trunc(rawNumber(item, 'fromHole') ?? 0),
        toHole: Math.trunc(rawNumber(item, 'toHole') ?? 0),
        fromCorridorId: rawString(item, 'fromCorridorId', 'fromCorridor'),
        toCorridorId: rawString(item, 'toCorridorId', 'toCorridor'),
        costMetres: rawNumber(item, 'costMetres', 'transitionCostMetres') ?? 0,
        transitionCostMetres: rawNumber(item, 'transitionCostMetres', 'costMetres') ?? 0,
      }
    })
    const statusValue = rawString(raw, 'status')
    const status: SpatialCandidateStatus = statusValue === 'high-confidence-inferred' || statusValue === 'field-confirmed' ? statusValue : 'candidate'
    solutions.push({
      id: rawString(raw, 'id', 'solutionId') ?? `S${String(solutionIndex + 1).padStart(2, '0')}`,
      rankingScore: rawNumber(raw, 'rankingScore') ?? 0,
      scoreMeaning: 'candidate ranking score, not probability',
      featureMatchScore: rawNumber(raw, 'featureMatchScore') ?? 0,
      transitionCostMetres: rawNumber(raw, 'transitionCostMetres') ?? 0,
      conflictCount: Math.trunc(rawNumber(raw, 'conflictCount') ?? 0),
      unresolvedHoleCount: Math.trunc(rawNumber(raw, 'unresolvedHoleCount') ?? entries.filter((entry) => entry.status === 'unknown').length),
      entries,
      assignments: entries,
      transitions,
      differences: Array.isArray(raw.differences) ? raw.differences.filter((line): line is string => typeof line === 'string') : [],
      status,
      evidence: Array.isArray(raw.evidence) ? raw.evidence.filter((line): line is string => typeof line === 'string') : [],
      warnings: Array.isArray(raw.warnings) ? raw.warnings.filter((line): line is string => typeof line === 'string') : [],
    })
  }
  return solutions.length > 0 ? solutions : null
}

function uniqueMatches(hole: HoleInput, corridorsById: Map<string, HoleCorridorCandidate>): HoleCandidateMatch[] {
  const source = hole.source
  if (!source) return []
  const matches = [source.bestCandidate, ...(source.alternatives ?? [])].filter((candidate): candidate is HoleCandidateMatch => candidate !== null)
  const seen = new Set<string>()
  return matches
    .filter((match) => {
      if (!corridorsById.has(match.corridor)) return false
      const corridor = corridorsById.get(match.corridor)
      if (!corridor || corridor.greenId !== match.green || corridor.teeObjectId !== match.tee) return false
      if (seen.has(match.corridor)) return false
      seen.add(match.corridor)
      return true
    })
    .sort((left, right) => right.score - left.score || left.corridor.localeCompare(right.corridor))
}

function independentEvidenceCount(hole: HoleSpatialCandidate | null): number {
  if (!hole?.mappingIndependentEvidence) return 0
  const value = hole as HoleSpatialCandidate & { independentEvidenceSources?: unknown }
  if (Array.isArray(value.independentEvidenceSources)) {
    return new Set(value.independentEvidenceSources.filter((source): source is string => typeof source === 'string' && source.length > 0)).size
  }
  // Existing candidate JSON has only free-text evidence. Treat distinct lines as evidence
  // only when the producer explicitly set mappingIndependentEvidence=true.
  return new Set((hole.evidence ?? []).filter((line) => line.trim().length > 0)).size
}

/** Enforce the candidate → inferred → field-confirmed gate for a selected mapping. */
export function getMappingStatus(hole: HoleSpatialCandidate | null): SpatialCandidateStatus {
  if (!hole) return 'unknown'
  if (hole.fieldConfirmed && hole.mappingIndependentEvidence && independentEvidenceCount(hole) >= 2) return 'field-confirmed'
  if (hole.status === 'high-confidence-inferred' && hole.mappingIndependentEvidence && independentEvidenceCount(hole) >= 2) return 'high-confidence-inferred'
  return 'candidate'
}

function matchEvidence(hole: HoleInput, match: HoleCandidateMatch): string[] {
  return [
    ...match.evidence,
    `Hole ${hole.hole} 的匹配来自全局方案搜索；排序分不是概率。`,
  ]
}

function makeUnknownEntry(hole: HoleInput): GlobalSolutionEntry {
  return {
    hole: hole.hole,
    par: hole.par,
    section: hole.hole <= 9 ? 'front-nine' : 'back-nine',
    status: 'unknown',
    teeZoneId: null,
    teeObjectId: null,
    greenId: null,
    corridorId: null,
    candidate: null,
    featureMatchScore: 0,
    candidateScore: 0,
    mappingIndependentEvidence: false,
    independentEvidenceSources: [],
    fieldConfirmed: false,
    transitionFromPreviousMetres: null,
    evidence: ['没有可用且未与前序方案冲突的 corridor 候选，保持 unknown。'],
    conflicts: ['未强行补齐全局方案。'],
  }
}

function makeEntry(
  hole: HoleInput,
  match: HoleCandidateMatch,
  corridor: HoleCorridorCandidate,
  topology: CourseTopology,
  previous: GlobalSolutionEntry | undefined,
): GlobalSolutionEntry {
  const transition = previous?.corridorId
    ? topology.transitions.find((item) => item.fromCorridorId === previous.corridorId && item.toCorridorId === corridor.id)
    : undefined
  const status = getMappingStatus(hole.source)
  const sourceWithEvidence = hole.source as (HoleSpatialCandidate & { independentEvidenceSources?: unknown }) | null
  const independentSources = Array.isArray(sourceWithEvidence?.independentEvidenceSources)
    ? sourceWithEvidence.independentEvidenceSources.filter((source): source is string => typeof source === 'string' && source.length > 0)
    : []
  return {
    hole: hole.hole,
    par: hole.par,
    section: hole.hole <= 9 ? 'front-nine' : 'back-nine',
    status,
    teeZoneId: corridor.teeZoneId,
    teeObjectId: corridor.teeObjectId,
    greenId: corridor.greenId,
    corridorId: corridor.id,
    candidate: match,
    featureMatchScore: match.score,
    candidateScore: match.score,
    mappingIndependentEvidence: hole.source?.mappingIndependentEvidence === true,
    independentEvidenceSources: independentSources,
    fieldConfirmed: hole.source?.fieldConfirmed === true,
    transitionFromPreviousMetres: transition?.transitionCostMetres ?? null,
    evidence: matchEvidence(hole, match),
    conflicts: [...match.conflicts, ...corridor.evidence.filter((line) => line.includes('proxy'))],
  }
}

function compareStates(left: SearchState, right: SearchState): number {
  const leftScore = left.featureSum / 18 - TRANSITION_WEIGHT * left.transitionCost / 1000 - (left.unresolved * UNKNOWN_MATCH_PENALTY)
  const rightScore = right.featureSum / 18 - TRANSITION_WEIGHT * right.transitionCost / 1000 - (right.unresolved * UNKNOWN_MATCH_PENALTY)
  return rightScore - leftScore || left.key.localeCompare(right.key)
}

function stateScore(state: SearchState): number {
  return state.featureSum / 18 - TRANSITION_WEIGHT * state.transitionCost / 1000 - state.unresolved * UNKNOWN_MATCH_PENALTY
}

function transitionCost(topology: CourseTopology, from: string | null, to: string): number {
  if (!from) return 0
  return topology.transitions.find((item) => item.fromCorridorId === from && item.toCorridorId === to)?.transitionCostMetres ?? 0
}

function initialState(options: GlobalMatchingOptions, first: HoleInput, firstEntry: GlobalSolutionEntry): SearchState {
  const clubhouseCost = options.clubhouse && firstEntry.teeObjectId ? 0 : 0
  void clubhouseCost
  return {
    entries: [firstEntry],
    usedGreens: firstEntry.greenId ? new Set([firstEntry.greenId]) : new Set(),
    usedCorridors: firstEntry.corridorId ? new Set([firstEntry.corridorId]) : new Set(),
    featureSum: firstEntry.featureMatchScore,
    transitionCost: 0,
    unresolved: firstEntry.status === 'unknown' ? 1 : 0,
    conflictCount: firstEntry.conflicts.length,
    key: `${first.hole}:${firstEntry.corridorId ?? 'unknown'}`,
  }
}

function sortedUniqueStates(states: SearchState[], beamWidth: number): SearchState[] {
  const byKey = new Map<string, SearchState>()
  for (const state of states) {
    const existing = byKey.get(state.key)
    if (!existing || compareStates(state, existing) < 0) byKey.set(state.key, state)
  }
  return [...byKey.values()].sort(compareStates).slice(0, beamWidth)
}

function describeDifferences(entries: GlobalSolutionEntry[], other: GlobalSolutionEntry[] | undefined): string[] {
  if (!other) return ['这是排序最高的全局方案；没有前一套方案可比较。']
  const differences = entries
    .filter((entry, index) => entry.corridorId !== other[index]?.corridorId)
    .map((entry) => `Hole ${entry.hole}: ${entry.corridorId ?? 'unknown'}（与上一方案不同）`)
  return differences.length > 0 ? differences : ['与上一方案的 Hole→corridor 分配一致。']
}

function solutionFromState(state: SearchState, index: number, previous: GlobalHoleSolution | undefined): GlobalHoleSolution {
  const featureMatchScore = round(state.featureSum / 18, 4)
  const rankingScore = round(stateScore(state), 4)
  const transitions: GlobalSolutionTransition[] = state.entries.slice(1).map((entry, offset) => ({
    fromHole: state.entries[offset].hole,
    toHole: entry.hole,
    fromCorridorId: state.entries[offset].corridorId,
    toCorridorId: entry.corridorId,
    costMetres: entry.transitionFromPreviousMetres ?? 0,
    transitionCostMetres: entry.transitionFromPreviousMetres ?? 0,
  }))
  return {
    id: `S${String(index + 1).padStart(2, '0')}`,
    rankingScore,
    scoreMeaning: 'candidate ranking score, not probability',
    featureMatchScore,
    transitionCostMetres: round(state.transitionCost),
    conflictCount: state.conflictCount,
    unresolvedHoleCount: state.unresolved,
    entries: state.entries,
    assignments: state.entries,
    transitions,
    differences: describeDifferences(state.entries, previous?.entries),
    status: state.entries.some((entry) => entry.status === 'field-confirmed') ? 'field-confirmed' :
      state.entries.some((entry) => entry.status === 'high-confidence-inferred') ? 'high-confidence-inferred' : 'candidate',
    evidence: [
      '采用 Hole 1→18 顺序的全局 beam search，而不是 18 次独立 argmax。',
      '每套方案强制 corridor 和 Green 一对一；Tee zone 可在候选输入允许时复用。',
      'rankingScore 只用于候选排序，不是概率或验证置信度。',
    ],
    warnings: state.unresolved > 0 ? ['存在未确定 Hole；算法没有为了凑齐 18/18 而强行分配。'] : [],
  }
}

/** Generate deterministic Top-N globally consistent solutions. */
export function solveGlobalHoleMatches(
  document: SpatialCandidatesDocument,
  course?: GolfCourseGeoJSON,
  options: GlobalMatchingOptions = {},
): GlobalMatchingResult {
  const topology = buildCourseTopology(document)
  const beamWidth = Math.max(32, Math.floor(options.beamWidth ?? DEFAULT_BEAM_WIDTH))
  const topN = Math.max(1, Math.min(10, Math.floor(options.topN ?? DEFAULT_TOP_N)))

  // Schema 2 already contains an audited Python beam-search result. Reuse it
  // at the runtime boundary so the app and TypeScript validator see the same
  // 468-corridor global candidates that the workbench displays.
  const generatedSolutions = normalizeGeneratedSolutions(document, topology, course, topN)
  if (generatedSolutions) {
    return {
      schemaVersion: 1,
      courseId: document.courseId,
      coordinateSystem: document.coordinateSystem,
      topology,
      solutions: generatedSolutions,
      scoreMeaning: 'candidate ranking score, not probability',
      warnings: [...topology.warnings, '全局方案来自 schema 2 派生候选；状态保持 candidate/unknown，不自动升级。'],
    }
  }

  const holes = metadataInputs(document, course)
  const corridorsById = new Map(topology.corridors.map((corridor) => [corridor.id, corridor]))
  const candidateLists = holes.map((hole) => uniqueMatches(hole, corridorsById))
  let states: SearchState[] = []

  for (const [index, hole] of holes.entries()) {
    const nextStates: SearchState[] = []
    const matches = candidateLists[index]
    if (states.length === 0) {
      const firstChoices = [...matches.map((match) => ({ match, corridor: corridorsById.get(match.corridor)! })), { match: null, corridor: null }]
      for (const choice of firstChoices) {
        const entry = choice.match && choice.corridor ? makeEntry(hole, choice.match, choice.corridor, topology, undefined) : makeUnknownEntry(hole)
        nextStates.push(initialState(options, hole, entry))
      }
    } else {
      for (const state of states) {
        for (const match of matches) {
          const corridor = corridorsById.get(match.corridor)
          if (!corridor || state.usedGreens.has(corridor.greenId) || state.usedCorridors.has(corridor.id)) continue
          const previous = state.entries[state.entries.length - 1]
          const entry = makeEntry(hole, match, corridor, topology, previous)
          const nextTransition = transitionCost(topology, previous.corridorId, corridor.id)
          nextStates.push({
            entries: [...state.entries, entry],
            usedGreens: new Set([...state.usedGreens, corridor.greenId]),
            usedCorridors: new Set([...state.usedCorridors, corridor.id]),
            featureSum: state.featureSum + match.score,
            transitionCost: state.transitionCost + nextTransition,
            unresolved: state.unresolved,
            conflictCount: state.conflictCount + entry.conflicts.length,
            key: `${state.key}|${hole.hole}:${corridor.id}`,
          })
        }
        const previous = state.entries[state.entries.length - 1]
        const unknown = makeUnknownEntry(hole)
        nextStates.push({
          entries: [...state.entries, unknown],
          usedGreens: new Set(state.usedGreens),
          usedCorridors: new Set(state.usedCorridors),
          featureSum: state.featureSum,
          transitionCost: state.transitionCost,
          unresolved: state.unresolved + 1,
          conflictCount: state.conflictCount + unknown.conflicts.length,
          key: `${state.key}|${hole.hole}:unknown`,
        })
        void previous
      }
    }
    states = sortedUniqueStates(nextStates, beamWidth)
  }

  const selected: SearchState[] = []
  const signatures = new Set<string>()
  for (const state of [...states].sort(compareStates)) {
    const signature = state.entries.map((entry) => entry.corridorId ?? 'unknown').join('|')
    if (signatures.has(signature)) continue
    signatures.add(signature)
    selected.push(state)
    if (selected.length >= topN) break
  }
  const solutions = selected.map((state, index) => solutionFromState(state, index, undefined))
  for (let index = 1; index < solutions.length; index += 1) {
    solutions[index] = { ...solutions[index], differences: describeDifferences(solutions[index].entries, solutions[index - 1].entries) }
  }
  return {
    schemaVersion: 1,
    courseId: document.courseId,
    coordinateSystem: document.coordinateSystem,
    topology,
    solutions,
    scoreMeaning: 'candidate ranking score, not probability',
    warnings: [...topology.warnings, '全局方案状态由输入候选证据决定；算法排序不会自动升级 candidate。'],
  }
}

export interface TopologyValidationIssue {
  code: string
  solutionId?: string
  hole?: number
  message: string
}

/** Validate one result before a UI or data exporter consumes it. */
export function validateGlobalMatchingResult(result: GlobalMatchingResult): TopologyValidationIssue[] {
  const issues: TopologyValidationIssue[] = []
  if (result.scoreMeaning !== 'candidate ranking score, not probability') issues.push({ code: 'invalid-score-meaning', message: '全局方案必须明确声明排序分不是概率。' })
  const solutionIds = new Set<string>()
  for (const solution of result.solutions) {
    if (solutionIds.has(solution.id)) issues.push({ code: 'duplicate-solution-id', solutionId: solution.id, message: `solution ID ${solution.id} 重复。` })
    solutionIds.add(solution.id)
    if (solution.scoreMeaning !== result.scoreMeaning) issues.push({ code: 'solution-score-meaning-mismatch', solutionId: solution.id, message: `方案 ${solution.id} 的 scoreMeaning 不一致。` })
    const holes = new Set<number>()
    const greens = new Set<string>()
    const corridors = new Set<string>()
    for (const entry of solution.entries) {
      if (holes.has(entry.hole)) issues.push({ code: 'duplicate-solution-hole', solutionId: solution.id, hole: entry.hole, message: `方案 ${solution.id} 重复分配 Hole ${entry.hole}。` })
      holes.add(entry.hole)
      if (entry.greenId && greens.has(entry.greenId)) issues.push({ code: 'duplicate-solution-green', solutionId: solution.id, hole: entry.hole, message: `方案 ${solution.id} 重复分配 Green ${entry.greenId}。` })
      if (entry.greenId) greens.add(entry.greenId)
      if (entry.corridorId && corridors.has(entry.corridorId)) issues.push({ code: 'duplicate-solution-corridor', solutionId: solution.id, hole: entry.hole, message: `方案 ${solution.id} 重复分配 corridor ${entry.corridorId}。` })
      if (entry.corridorId) corridors.add(entry.corridorId)
      if (entry.status === 'high-confidence-inferred' && !entry.evidence.some((line) => line.includes('全局方案'))) issues.push({ code: 'missing-solution-evidence', solutionId: solution.id, hole: entry.hole, message: `Hole ${entry.hole} 缺少可复查证据。` })
    }
    if (solution.entries.length !== 18) issues.push({ code: 'solution-hole-count', solutionId: solution.id, message: `方案 ${solution.id} 应包含 18 个 Hole 条目。` })
  }
  return issues
}
