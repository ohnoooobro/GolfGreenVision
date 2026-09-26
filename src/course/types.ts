import type { LocationData } from '../location/types'

/** GeoJSON 坐标使用 [经度, 纬度] 顺序，内部语义为 WGS84。 */
export type GeoJSONPosition = [longitude: number, latitude: number]

export interface GeoJSONPoint {
  type: 'Point'
  coordinates: GeoJSONPosition
}

export interface GeoJSONLineString {
  type: 'LineString'
  coordinates: GeoJSONPosition[]
}

export interface GeoJSONPolygon {
  type: 'Polygon'
  /** 第一个环为外环，后续环为需要排除的内环。 */
  coordinates: GeoJSONPosition[][]
}

export type VerificationStatus = 'verified' | 'estimated' | 'unverified' | 'unknown'
export type SpatialConfidence = 'high' | 'medium' | 'low' | 'none'
export type SpatialDigitization = 'none' | 'manual' | 'imported' | 'field-survey'

export interface TeeYardages {
  gold?: number
  blue?: number
  white?: number
  red?: number
}

export interface GolfHoleProperties {
  hole: number
  par: number | null
  teeYardages?: TeeYardages
  teeCenter?: GeoJSONPoint | null
  greenCenter: GeoJSONPoint | null
  centerline?: GeoJSONLineString | null
  spatialConfidence?: SpatialConfidence
  spatialVerified?: boolean
  spatialDigitization?: SpatialDigitization
  spatialEstimated?: boolean
  source: string
  provenance?: {
    hole?: string[]
    par?: string[]
    teeYardages?: string[]
    teeCenter?: string[]
    polygon?: string[]
    greenCenter?: string[]
    centerline?: string[]
  }
  holeNumberVerified?: boolean
  parStatus?: VerificationStatus
  teeCenterStatus?: VerificationStatus
  polygonStatus?: VerificationStatus
  greenCenterStatus?: VerificationStatus
  centerlineStatus?: VerificationStatus
  verified: boolean
}

export interface GolfHoleFeature {
  type: 'Feature'
  geometry: GeoJSONPolygon | null
  properties: GolfHoleProperties
}

export interface GolfCourseProperties {
  id: string
  name: string
  source: string
  coordinateSystem: 'WGS84'
  verified: boolean
  demo: boolean
  dataStatus?: VerificationStatus
  provenance?: string[]
}

/** 以球洞区域 Polygon 为主几何的球场 GeoJSON FeatureCollection。 */
export interface GolfCourseGeoJSON {
  type: 'FeatureCollection'
  properties: GolfCourseProperties
  features: GolfHoleFeature[]
}

/** 洞号识别直接消费 Thread 01 的统一位置数据，不关心其来源。 */
export type HoleLocation = Pick<LocationData, 'latitude' | 'longitude'>
