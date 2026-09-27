import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { jingshanhuV0Course, validateGolfCourse, validateSpatialCandidates } from '../src/course'
import type { SpatialCandidatesDocument } from '../src/course/spatialCandidates'
import type { GolfCourseGeoJSON } from '../src/course/types'

const geojsonPath = resolve(process.cwd(), 'data/derived/jingshanhu/course.geojson')
const fileCourse = JSON.parse(readFileSync(geojsonPath, 'utf8')) as GolfCourseGeoJSON
const candidatesPath = resolve(process.cwd(), 'data/derived/jingshanhu/spatial-candidates.json')
const spatialCandidates = JSON.parse(readFileSync(candidatesPath, 'utf8')) as SpatialCandidatesDocument
const orthophotoMetadataPath = resolve(process.cwd(), 'data/derived/jingshanhu/orthophoto_2023_metadata.json')
const orthophotoMetadata = JSON.parse(readFileSync(orthophotoMetadataPath, 'utf8')) as {
  raster: { width: number; height: number; sourceCrs: { epsg: number }; wgs84Bounds: Record<string, number> }
  validation: Record<string, boolean>
}

describe('净山湖 V0 数据集', () => {
  it('GeoJSON 文件和运行时数据均声明 WGS84 并通过结构校验', () => {
    expect(fileCourse.properties.coordinateSystem).toBe('WGS84')
    expect(validateGolfCourse(fileCourse)).toEqual([])
    expect(validateGolfCourse(jingshanhuV0Course)).toEqual([])
  })

  it('18 洞顺序唯一，逐洞 Par/距离存在，未编号空间几何保持缺失', () => {
    expect(fileCourse.features.map((feature) => feature.properties.hole)).toEqual(
      Array.from({ length: 18 }, (_, index) => index + 1),
    )
    expect(fileCourse.features.reduce((sum, feature) => sum + (feature.properties.par ?? 0), 0)).toBe(72)
    expect(fileCourse.features.every((feature) =>
      feature.geometry === null && feature.properties.teeCenter === null &&
      feature.properties.greenCenter === null && feature.properties.centerline === null,
    )).toBe(true)
    expect(fileCourse.features.every((feature) =>
      feature.properties.spatialConfidence === 'none' && feature.properties.spatialVerified === false &&
      feature.properties.spatialDigitization === 'none' && feature.properties.spatialEstimated === false &&
      feature.properties.teeCenterStatus === 'unknown' && feature.properties.polygonStatus === 'unknown' &&
      feature.properties.greenCenterStatus === 'unknown' && feature.properties.centerlineStatus === 'unknown',
    )).toBe(true)
    expect(fileCourse.features.every((feature) => feature.properties.teeYardages && Object.values(feature.properties.teeYardages).length === 4)).toBe(true)
    expect(fileCourse.features.map(({ properties }) => [properties.hole, properties.par, properties.teeYardages])).toEqual(
      jingshanhuV0Course.features.map(({ properties }) => [properties.hole, properties.par, properties.teeYardages]),
    )
  })

  it('正射影像空间候选保留对象编号、解释和保守状态', () => {
    expect(validateSpatialCandidates(spatialCandidates)).toEqual([])
    expect(spatialCandidates.coordinateSystem).toContain('WGS84')
    expect(spatialCandidates.objects.filter((object) => object.kind === 'green')).toHaveLength(26)
    expect(spatialCandidates.objects.filter((object) => object.kind === 'tee')).toHaveLength(2)
    expect(spatialCandidates.corridors).toHaveLength(52)
    expect(spatialCandidates.holes).toHaveLength(18)
    expect(spatialCandidates.holes.every((hole) => hole.status === 'candidate' && !hole.fieldConfirmed && hole.bestCandidate !== null)).toBe(true)
    expect(spatialCandidates.holes.every((hole) => hole.evidence.length > 0 && hole.conflicts.length > 0)).toBe(true)
  })

  it('正射影像 metadata 保留实际 CRS、范围和 round-trip 校验结果', () => {
    expect(orthophotoMetadata.raster.width).toBe(5852)
    expect(orthophotoMetadata.raster.height).toBe(6063)
    expect(orthophotoMetadata.raster.sourceCrs.epsg).toBe(4548)
    expect(orthophotoMetadata.raster.wgs84Bounds.west).toBeLessThan(orthophotoMetadata.raster.wgs84Bounds.east)
    expect(orthophotoMetadata.raster.wgs84Bounds.south).toBeLessThan(orthophotoMetadata.raster.wgs84Bounds.north)
    expect(orthophotoMetadata.validation.pixelToSourceToWgs84AndBackPassed).toBe(true)
    expect(orthophotoMetadata.validation.rasterAndPrjEpsgMatch).toBe(true)
    expect(orthophotoMetadata.validation.worldFilePixelSizeAndRotationMatch).toBe(true)
  })

  it('没有独立证据时拒绝 high-confidence-inferred 映射', () => {
    const promoted = structuredClone(spatialCandidates)
    promoted.holes[0].status = 'high-confidence-inferred'
    promoted.holes[0].mappingIndependentEvidence = false
    const issues = validateSpatialCandidates(promoted)
    expect(issues.some((issue) => issue.code === 'missing-independent-evidence' && issue.hole === 1)).toBe(true)
  })

  it('明确独立证据后才允许 high-confidence-inferred 状态通过该校验', () => {
    const promoted = structuredClone(spatialCandidates)
    promoted.holes[0].status = 'high-confidence-inferred'
    promoted.holes[0].mappingIndependentEvidence = true
    const issues = validateSpatialCandidates(promoted)
    expect(issues.some((issue) => issue.code === 'missing-independent-evidence' && issue.hole === 1)).toBe(false)
  })
})
