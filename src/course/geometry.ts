import type { GeoJSONPoint, GeoJSONPolygon, GeoJSONPosition, HoleLocation } from './types'

const EPSILON = 1e-10

function pointOnSegment(point: GeoJSONPosition, start: GeoJSONPosition, end: GeoJSONPosition): boolean {
  const [px, py] = point
  const [sx, sy] = start
  const [ex, ey] = end
  const cross = (px - sx) * (ey - sy) - (py - sy) * (ex - sx)
  if (Math.abs(cross) > EPSILON) return false
  return (
    px >= Math.min(sx, ex) - EPSILON &&
    px <= Math.max(sx, ex) + EPSILON &&
    py >= Math.min(sy, ey) - EPSILON &&
    py <= Math.max(sy, ey) + EPSILON
  )
}

/** 判断点是否在一个环内，边界点按“在内”处理。 */
function isPointInRing(point: GeoJSONPosition, ring: GeoJSONPosition[]): boolean {
  if (ring.length < 3) return false

  let inside = false
  for (let index = 0; index < ring.length; index += 1) {
    const start = ring[index]
    const end = ring[(index + 1) % ring.length]
    if (pointOnSegment(point, start, end)) return true

    const crossesHorizontalRay = (start[1] > point[1]) !== (end[1] > point[1])
    if (!crossesHorizontalRay) continue
    const intersectionLongitude =
      ((end[0] - start[0]) * (point[1] - start[1])) / (end[1] - start[1]) + start[0]
    if (point[0] < intersectionLongitude) inside = !inside
  }
  return inside
}

function toGeoJSONPosition(location: HoleLocation): GeoJSONPosition {
  return [location.longitude, location.latitude]
}

/** 判断统一定位数据中的点是否位于 GeoJSON Polygon 内。 */
export function isPointInPolygon(location: HoleLocation, polygon: GeoJSONPolygon): boolean {
  const point = toGeoJSONPosition(location)
  const [outerRing, ...innerRings] = polygon.coordinates
  if (!outerRing || !isPointInRing(point, outerRing)) return false
  return !innerRings.some((ring) => isPointInRing(point, ring))
}

/** 读取 GeoJSON Point 的经纬度，供后续距离计算等模块复用。 */
export function pointToLocation(point: GeoJSONPoint): HoleLocation {
  return { longitude: point.coordinates[0], latitude: point.coordinates[1] }
}

