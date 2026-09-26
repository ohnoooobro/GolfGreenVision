import type { GeoJSONPosition, GolfCourseGeoJSON, GolfHoleFeature } from './types'
import { isPointInPolygon, pointToLocation } from './geometry'

export type CourseValidationCode =
  | 'invalid-crs'
  | 'duplicate-hole'
  | 'hole-out-of-range'
  | 'invalid-coordinate'
  | 'missing-required-field'
  | 'invalid-ring'
  | 'self-intersection'
  | 'duplicate-feature'
  | 'green-outside-polygon'
  | 'invalid-par'
  | 'tee-green-overlap'
  | 'invalid-centerline'
  | 'spatial-distance-mismatch'
  | 'suspicious-adjacent-holes'
  | 'missing-provenance'

export interface CourseValidationIssue {
  code: CourseValidationCode
  hole?: number
  message: string
}

const EPSILON = 1e-10
const METERS_PER_DEGREE_LATITUDE = 111_320
const METERS_PER_YARD = 0.9144

function validCoordinate(position: GeoJSONPosition): boolean {
  return position.length === 2 && Number.isFinite(position[0]) && Number.isFinite(position[1]) &&
    position[0] >= -180 && position[0] <= 180 && position[1] >= -90 && position[1] <= 90
}

function distanceMeters(left: GeoJSONPosition, right: GeoJSONPosition): number {
  const latitudeRadians = ((left[1] + right[1]) / 2) * Math.PI / 180
  const x = (right[0] - left[0]) * METERS_PER_DEGREE_LATITUDE * Math.cos(latitudeRadians)
  const y = (right[1] - left[1]) * METERS_PER_DEGREE_LATITUDE
  return Math.hypot(x, y)
}

function lineStringLengthMeters(coordinates: GeoJSONPosition[]): number {
  return coordinates.slice(1).reduce((length, point, index) => length + distanceMeters(coordinates[index], point), 0)
}

function orientation(a: GeoJSONPosition, b: GeoJSONPosition, c: GeoJSONPosition): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
}

function segmentsIntersect(a: GeoJSONPosition, b: GeoJSONPosition, c: GeoJSONPosition, d: GeoJSONPosition): boolean {
  const abC = orientation(a, b, c)
  const abD = orientation(a, b, d)
  const cdA = orientation(c, d, a)
  const cdB = orientation(c, d, b)
  const collinear = (value: number) => Math.abs(value) <= EPSILON
  const on = (p: GeoJSONPosition, start: GeoJSONPosition, end: GeoJSONPosition) =>
    p[0] >= Math.min(start[0], end[0]) - EPSILON && p[0] <= Math.max(start[0], end[0]) + EPSILON &&
    p[1] >= Math.min(start[1], end[1]) - EPSILON && p[1] <= Math.max(start[1], end[1]) + EPSILON
  return (abC * abD < -EPSILON && cdA * cdB < -EPSILON) ||
    (collinear(abC) && on(c, a, b)) || (collinear(abD) && on(d, a, b)) ||
    (collinear(cdA) && on(a, c, d)) || (collinear(cdB) && on(b, c, d))
}

function ringHasSelfIntersection(ring: GeoJSONPosition[]): boolean {
  const edgeCount = ring.length - 1
  for (let i = 0; i < edgeCount; i += 1) {
    for (let j = i + 1; j < edgeCount; j += 1) {
      if (j === i + 1 || (i === 0 && j === edgeCount - 1)) continue
      if (segmentsIntersect(ring[i], ring[i + 1], ring[j], ring[j + 1])) return true
    }
  }
  return false
}

function ringsIntersect(left: GeoJSONPosition[], right: GeoJSONPosition[]): boolean {
  for (let i = 0; i < left.length - 1; i += 1) {
    for (let j = 0; j < right.length - 1; j += 1) {
      if (segmentsIntersect(left[i], left[i + 1], right[j], right[j + 1])) return true
    }
  }
  return false
}

function validateFeature(feature: GolfHoleFeature): CourseValidationIssue[] {
  const issues: CourseValidationIssue[] = []
  const hole = feature.properties.hole
  if (!Number.isInteger(hole) || hole < 1 || hole > 18) {
    issues.push({ code: 'hole-out-of-range', hole, message: `洞号 ${hole} 不在 1-18 范围内。` })
  }
  if (!feature.properties.source || feature.properties.verified === undefined) {
    issues.push({ code: 'missing-required-field', hole, message: `洞 ${hole} 缺少 source 或 verified 字段。` })
  }
  if (feature.properties.par !== null && (!Number.isInteger(feature.properties.par) || feature.properties.par < 3 || feature.properties.par > 6)) {
    issues.push({ code: 'invalid-par', hole, message: `洞 ${hole} 的 Par 不合法。` })
  }
  if (feature.properties.provenance && Object.entries(feature.properties.provenance).some(([field, sources]) =>
    (field === 'polygon' && feature.geometry !== null ||
      field === 'greenCenter' && feature.properties.greenCenter !== null ||
      field === 'teeCenter' && feature.properties.teeCenter != null ||
      field === 'centerline' && feature.properties.centerline != null) && sources.length === 0,
  )) {
    issues.push({ code: 'missing-provenance', hole, message: `洞 ${hole} 的已提供几何缺少来源引用。` })
  }
  if (feature.geometry) {
    const rings = feature.geometry.coordinates
    for (const ring of rings) {
      if (ring.length < 4 || !ring[0] || !ring[ring.length - 1] || ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1]) {
        issues.push({ code: 'invalid-ring', hole, message: `洞 ${hole} 存在未闭合或退化 Polygon 环。` })
      }
      if (Math.abs(ring.slice(0, -1).reduce((sum, position, index, points) => {
        const next = points[(index + 1) % points.length]
        return sum + position[0] * next[1] - next[0] * position[1]
      }, 0)) <= EPSILON) {
        issues.push({ code: 'invalid-ring', hole, message: `洞 ${hole} Polygon 环面积为零。` })
      }
      if (ring.some((position) => !validCoordinate(position))) {
        issues.push({ code: 'invalid-coordinate', hole, message: `洞 ${hole} Polygon 含非法经纬度。` })
      }
      if (ringHasSelfIntersection(ring)) {
        issues.push({ code: 'self-intersection', hole, message: `洞 ${hole} Polygon 存在明显自交。` })
      }
    }
    const outerRing = rings[0]
    for (const innerRing of rings.slice(1)) {
      if (outerRing && innerRing[0] && (ringsIntersect(outerRing, innerRing) || !isPointInPolygon(
        { longitude: innerRing[0][0], latitude: innerRing[0][1] },
        { type: 'Polygon', coordinates: [outerRing] },
      ))) {
        issues.push({ code: 'invalid-ring', hole, message: `洞 ${hole} 的内环未完整位于外环内部。` })
      }
    }
  }
  if (feature.properties.greenCenter && !validCoordinate(feature.properties.greenCenter.coordinates)) {
    issues.push({ code: 'invalid-coordinate', hole, message: `洞 ${hole} 果岭中心含非法经纬度。` })
  }
  if (feature.properties.teeCenter && !validCoordinate(feature.properties.teeCenter.coordinates)) {
    issues.push({ code: 'invalid-coordinate', hole, message: `洞 ${hole} Tee 中心含非法经纬度。` })
  }
  if (feature.properties.centerline) {
    const { coordinates } = feature.properties.centerline
    if (coordinates.length < 2 || coordinates.some((position) => !validCoordinate(position))) {
      issues.push({ code: 'invalid-centerline', hole, message: `洞 ${hole} centerline 至少需要两个合法坐标点。` })
    }
  }
  const teeCenter = feature.properties.teeCenter?.coordinates
  const greenCenter = feature.properties.greenCenter?.coordinates
  if (teeCenter && greenCenter && validCoordinate(teeCenter) && validCoordinate(greenCenter)) {
    const teeToGreenMeters = distanceMeters(teeCenter, greenCenter)
    if (teeToGreenMeters < 1) {
      issues.push({ code: 'tee-green-overlap', hole, message: `洞 ${hole} Tee 与 Green 中心重合或相距不足 1 米。` })
    }
    const centerline = feature.properties.centerline?.coordinates
    if (centerline && centerline.length >= 2 && centerline.every(validCoordinate)) {
      const first = centerline[0]
      const last = centerline[centerline.length - 1]
      if (distanceMeters(first, teeCenter) > 50 || distanceMeters(last, greenCenter) > 50) {
        issues.push({ code: 'invalid-centerline', hole, message: `洞 ${hole} centerline 首尾没有按 Tee→Green 方向落在端点附近（50 米容差）。` })
      }
      const lineLength = lineStringLengthMeters(centerline)
      const yardageRange = feature.properties.teeYardages ? Object.values(feature.properties.teeYardages) : []
      const referenceMeters = yardageRange.length ? Math.max(...yardageRange) * METERS_PER_YARD : null
      if (referenceMeters && (lineLength < referenceMeters * 0.25 || lineLength > referenceMeters * 1.8)) {
        issues.push({ code: 'spatial-distance-mismatch', hole, message: `洞 ${hole} centerline 长度与公开码数数量级差异过大；dogleg 的直线距离可短于码数。` })
      }
    } else {
      const yardageRange = feature.properties.teeYardages ? Object.values(feature.properties.teeYardages) : []
      const referenceMeters = yardageRange.length ? Math.max(...yardageRange) * METERS_PER_YARD : null
      if (referenceMeters && (teeToGreenMeters < referenceMeters * 0.15 || teeToGreenMeters > referenceMeters * 1.8)) {
        issues.push({ code: 'spatial-distance-mismatch', hole, message: `洞 ${hole} Tee→Green 直线距离与公开码数数量级差异过大。` })
      }
    }
  }
  if (feature.geometry && feature.properties.greenCenter && validCoordinate(feature.properties.greenCenter.coordinates) &&
      !isPointInPolygon(pointToLocation(feature.properties.greenCenter), feature.geometry)) {
    issues.push({ code: 'green-outside-polygon', hole, message: `洞 ${hole} 果岭中心不在球洞 Polygon 内。` })
  }
  return issues
}

export function validateGolfCourse(course: GolfCourseGeoJSON): CourseValidationIssue[] {
  const issues: CourseValidationIssue[] = []
  if (course.properties.coordinateSystem !== 'WGS84') {
    issues.push({ code: 'invalid-crs', message: '运行时球场坐标系声明必须为 WGS84。' })
  }
  const seen = new Set<number>()
  const fingerprints = new Set<string>()
  const spatialFeatures: GolfHoleFeature[] = []
  for (const feature of course.features) {
    const hole = feature.properties.hole
    if (seen.has(hole)) issues.push({ code: 'duplicate-hole', hole, message: `洞号 ${hole} 重复。` })
    seen.add(hole)
    if (feature.geometry) {
      const fingerprint = JSON.stringify(feature.geometry)
      if (fingerprints.has(fingerprint)) issues.push({ code: 'duplicate-feature', hole, message: `洞 ${hole} 与其他洞重复几何。` })
      fingerprints.add(fingerprint)
    }
    issues.push(...validateFeature(feature))
    if (feature.properties.teeCenter || feature.properties.greenCenter || feature.properties.centerline) spatialFeatures.push(feature)
  }
  for (let leftIndex = 0; leftIndex < spatialFeatures.length; leftIndex += 1) {
    const left = spatialFeatures[leftIndex]
    const leftCoordinates = [left.properties.teeCenter?.coordinates, left.properties.greenCenter?.coordinates].filter(
      (position): position is GeoJSONPosition => position !== undefined && validCoordinate(position),
    )
    for (const right of spatialFeatures.slice(leftIndex + 1)) {
      if (Math.abs(left.properties.hole - right.properties.hole) !== 1) continue
      const rightCoordinates = [right.properties.teeCenter?.coordinates, right.properties.greenCenter?.coordinates].filter(
        (position): position is GeoJSONPosition => position !== undefined && validCoordinate(position),
      )
      if (leftCoordinates.length && rightCoordinates.length && Math.min(...leftCoordinates.flatMap((a) =>
        rightCoordinates.map((b) => distanceMeters(a, b)),
      )) > 1800) {
        issues.push({
          code: 'suspicious-adjacent-holes',
          hole: right.properties.hole,
          message: `相邻洞 ${left.properties.hole} 与 ${right.properties.hole} 的 Tee/Green 位置相距均超过 1.8 公里，请复核。`,
        })
      }
    }
  }
  return issues
}
