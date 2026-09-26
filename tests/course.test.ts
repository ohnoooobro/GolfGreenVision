import { describe, expect, it } from 'vitest'
import { mockDemoCourseFixture as mockDemoCourse } from './fixtures/mock-course'
import { inferHole } from '../src/course/inference'
import {
  clearCorrectedHole,
  createHoleSelectionState,
  getEffectiveHole,
  setCorrectedHole,
  updateInferredHole,
} from '../src/course/selection'
import { isPointInPolygon } from '../src/course/geometry'
import type { GolfCourseGeoJSON, GeoJSONLineString, GeoJSONPolygon } from '../src/course/types'
import { isHoleAvailable } from '../src/course/selection'
import { validateGolfCourse } from '../src/course/validation'

describe('Mock / Demo 球场数据', () => {
  it('包含至少三个明确标记为演示数据的相邻球洞', () => {
    expect(mockDemoCourse.properties.demo).toBe(true)
    expect(mockDemoCourse.properties.verified).toBe(false)
    expect(mockDemoCourse.features).toHaveLength(3)
    expect(mockDemoCourse.features.every((feature) => feature.properties.source.includes('Mock / Demo'))).toBe(true)
    expect(mockDemoCourse.features.every((feature) => feature.geometry.type === 'Polygon')).toBe(true)
    expect(mockDemoCourse.features.every((feature) => feature.properties.greenCenter.type === 'Point')).toBe(true)
  })
})

describe('球洞 Polygon containment 与识别', () => {
  it('识别明显位于单一 Polygon 内的点', () => {
    const location = { latitude: 30.0005, longitude: 120.0003 }
    expect(isPointInPolygon(location, mockDemoCourse.features[0].geometry)).toBe(true)
    expect(inferHole(location, mockDemoCourse)).toEqual({
      inferredHole: 1,
      candidates: [1],
      reason: 'single-match',
    })
  })

  it('点位于所有 Polygon 外时返回无法确定', () => {
    expect(inferHole({ latitude: 31, longitude: 121 }, mockDemoCourse)).toEqual({
      inferredHole: null,
      candidates: [],
      reason: 'outside',
    })
  })

  it('将外环边界与顶点按命中处理', () => {
    const polygon = mockDemoCourse.features[0].geometry
    expect(isPointInPolygon({ latitude: 30.0005, longitude: 120 }, polygon)).toBe(true)
    expect(isPointInPolygon({ latitude: 30, longitude: 120 }, polygon)).toBe(true)
  })

  it('共享边界同时保留两个候选洞', () => {
    const sharedBoundaryCourse: GolfCourseGeoJSON = {
      ...mockDemoCourse,
      features: [
        { ...mockDemoCourse.features[0], properties: { ...mockDemoCourse.features[0].properties, hole: 1 }, geometry: { type: 'Polygon', coordinates: [[[120, 30], [120.001, 30], [120.001, 30.001], [120, 30.001], [120, 30]]] } },
        { ...mockDemoCourse.features[1], properties: { ...mockDemoCourse.features[1].properties, hole: 2 }, geometry: { type: 'Polygon', coordinates: [[[120.001, 30], [120.002, 30], [120.002, 30.001], [120.001, 30.001], [120.001, 30]]] } },
      ],
    }
    expect(inferHole({ latitude: 30.0005, longitude: 120.001 }, sharedBoundaryCourse)).toEqual({
      inferredHole: 1, candidates: [1, 2], reason: 'multiple-match',
    })
  })

  it('将内环边界排除在球洞区域之外', () => {
    const polygonWithInnerRing: GeoJSONPolygon = {
      type: 'Polygon',
      coordinates: [
        [[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]],
        [[1, 1], [3, 1], [3, 3], [1, 3], [1, 1]],
      ],
    }
    expect(isPointInPolygon({ latitude: 2, longitude: 2 }, polygonWithInnerRing)).toBe(false)
    expect(isPointInPolygon({ latitude: 1, longitude: 2 }, polygonWithInnerRing)).toBe(false)
  })

  it('相邻重叠候选按最小洞号确定并保留候选列表', () => {
    const result = inferHole({ latitude: 30.0005, longitude: 120.0009 }, mockDemoCourse)
    expect(result).toEqual({ inferredHole: 1, candidates: [1, 2], reason: 'multiple-match' })
  })

  it('模拟定位变化后自动判断结果随位置更新', () => {
    const first = inferHole({ latitude: 30.0005, longitude: 120.0003 }, mockDemoCourse)
    const second = inferHole({ latitude: 30.0005, longitude: 120.0023 }, mockDemoCourse)
    expect(first.inferredHole).toBe(1)
    expect(second.inferredHole).toBe(3)
  })
})

describe('自动洞号与手动修正状态', () => {
  it('correctedHole 只能选择当前球场存在的洞号', () => {
    expect(isHoleAvailable(3, [1, 2, 3])).toBe(true)
    expect(isHoleAvailable(18, [1, 2, 3])).toBe(false)
    expect(setCorrectedHole(createHoleSelectionState(2), 18, [1, 2, 3])).toEqual({
      inferredHole: 2, correctedHole: null, effectiveHole: 2,
    })
  })
  it('没有修正时 effectiveHole 使用 inferredHole', () => {
    const state = createHoleSelectionState(2)
    expect(state).toEqual({ inferredHole: 2, correctedHole: null, effectiveHole: 2 })
    expect(getEffectiveHole(state)).toBe(2)
  })

  it('correctedHole 存在时优先使用手动洞号', () => {
    const state = setCorrectedHole(createHoleSelectionState(2), 5)
    expect(state).toEqual({ inferredHole: 2, correctedHole: 5, effectiveHole: 5 })
    expect(getEffectiveHole(state)).toBe(5)
  })

  it('定位更新不会覆盖手动修正，清除修正后恢复自动判断', () => {
    const corrected = setCorrectedHole(createHoleSelectionState(1), 5)
    const updated = updateInferredHole(corrected, 3)
    expect(updated).toEqual({ inferredHole: 3, correctedHole: 5, effectiveHole: 5 })

    const cleared = clearCorrectedHole(updated)
    expect(cleared).toEqual({ inferredHole: 3, correctedHole: null, effectiveHole: 3 })
  })

  it('自动判断无法确定时 effectiveHole 为空（除非有手动修正）', () => {
    expect(createHoleSelectionState(null)).toEqual({ inferredHole: null, correctedHole: null, effectiveHole: null })
    expect(setCorrectedHole(createHoleSelectionState(null), 2).effectiveHole).toBe(2)
  })
})

describe('球场数据结构校验', () => {
  it('能发现重复洞号、非法范围、非法 CRS 和自交 Polygon', () => {
    const malformed: GolfCourseGeoJSON = {
      ...mockDemoCourse,
      properties: { ...mockDemoCourse.properties, coordinateSystem: 'WGS84' },
      features: [
        { ...mockDemoCourse.features[0], properties: { ...mockDemoCourse.features[0].properties, hole: 19 } },
        { ...mockDemoCourse.features[1], properties: { ...mockDemoCourse.features[1].properties, hole: 19 }, geometry: {
          type: 'Polygon', coordinates: [[[0, 0], [2, 2], [0, 2], [2, 0], [0, 0]]],
        } },
      ],
    }
    const issues = validateGolfCourse(malformed)
    expect(issues.map((issue) => issue.code)).toContain('duplicate-hole')
    expect(issues.map((issue) => issue.code)).toContain('hole-out-of-range')
    expect(issues.map((issue) => issue.code)).toContain('self-intersection')
  })

  it('发现非法经纬度、外环外的内环和 Polygon 外的果岭中心', () => {
    const malformed = {
      ...mockDemoCourse,
      features: [{
        ...mockDemoCourse.features[0],
        geometry: { type: 'Polygon' as const, coordinates: [
          [[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]],
          [[5, 5], [6, 5], [6, 6], [5, 6], [5, 5]],
        ] },
        properties: {
          ...mockDemoCourse.features[0].properties,
          greenCenter: { type: 'Point' as const, coordinates: [181, 2] as [number, number] },
        },
      }],
    } as GolfCourseGeoJSON
    const issues = validateGolfCourse(malformed)
    expect(issues.map((issue) => issue.code)).toContain('invalid-ring')
    expect(issues.map((issue) => issue.code)).toContain('invalid-coordinate')
  })

  it('校验 Tee/Green 不重合以及 centerline 的 Tee→Green 方向', () => {
    const malformed = {
      ...mockDemoCourse,
      features: [{
        ...mockDemoCourse.features[0],
        properties: {
          ...mockDemoCourse.features[0].properties,
          teeCenter: { type: 'Point' as const, coordinates: [120.0007, 30.0005] as [number, number] },
          greenCenter: { type: 'Point' as const, coordinates: [120.0007, 30.0005] as [number, number] },
          centerline: { type: 'LineString' as const, coordinates: [[120.0007, 30.0005], [120.0008, 30.0005]] } as GeoJSONLineString,
          teeYardages: { blue: 400 },
        },
      }],
    } as GolfCourseGeoJSON
    const issues = validateGolfCourse(malformed)
    expect(issues.map((issue) => issue.code)).toContain('tee-green-overlap')
    expect(issues.map((issue) => issue.code)).toContain('spatial-distance-mismatch')
  })
})
