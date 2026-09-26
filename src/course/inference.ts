import { isPointInPolygon } from './geometry'
import type { GolfCourseGeoJSON, GolfHoleFeature, HoleLocation } from './types'

export type HoleInferenceReason = 'outside' | 'single-match' | 'multiple-match'

export interface HoleInferenceResult {
  /** 自动判断的洞号；无法确定时为 null。 */
  inferredHole: number | null
  /** 所有命中的候选洞号，按洞号升序排列。 */
  candidates: number[]
  reason: HoleInferenceReason
}

export type HoleRecognitionResult = HoleInferenceResult

/** 返回当前位置命中的球洞，保留所有候选便于调试和后续连续性策略。 */
export function findContainingHoles(
  location: HoleLocation,
  course: GolfCourseGeoJSON,
): GolfHoleFeature[] {
  return course.features
    .filter((feature) => feature.geometry !== null && isPointInPolygon(location, feature.geometry))
    .sort((left, right) => left.properties.hole - right.properties.hole)
}

/**
 * 第一版洞号识别：单命中直接返回，多命中选择最小洞号，未命中返回 null。
 * 多命中规则保持确定且可解释，后续可在这里接入连续性或距离等策略。
 */
export function inferHole(location: HoleLocation, course: GolfCourseGeoJSON): HoleInferenceResult {
  const candidates = findContainingHoles(location, course).map((feature) => feature.properties.hole)
  if (candidates.length === 0) {
    return { inferredHole: null, candidates, reason: 'outside' }
  }
  if (candidates.length === 1) {
    return { inferredHole: candidates[0], candidates, reason: 'single-match' }
  }
  return { inferredHole: candidates[0], candidates, reason: 'multiple-match' }
}

/**
 * 面向页面/业务层的语义化入口。
 * 支持 `identifyHole(course, location)` 与底层函数相同的
 * `identifyHole(location, course)` 两种顺序，便于不同调用层直接使用。
 */
export function identifyHole(course: GolfCourseGeoJSON, location: HoleLocation): HoleInferenceResult
export function identifyHole(location: HoleLocation, course: GolfCourseGeoJSON): HoleInferenceResult
export function identifyHole(
  first: GolfCourseGeoJSON | HoleLocation,
  second: GolfCourseGeoJSON | HoleLocation,
): HoleInferenceResult {
  if ('features' in first) return inferHole(second as HoleLocation, first)
  return inferHole(first, second as GolfCourseGeoJSON)
}
