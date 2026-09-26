import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { jingshanhuV0Course, validateGolfCourse } from '../src/course'
import type { GolfCourseGeoJSON } from '../src/course/types'

const geojsonPath = resolve(process.cwd(), 'data/derived/jingshanhu/course.geojson')
const fileCourse = JSON.parse(readFileSync(geojsonPath, 'utf8')) as GolfCourseGeoJSON

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
})
