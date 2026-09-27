import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  buildCourseTopology,
  jingshanhuV05Course,
  solveGlobalHoleMatches,
  validateCourseTopology,
  validateGlobalHoleSolutionSet,
  validateGlobalMatchingResult,
} from '../src/course'
import type { SpatialCandidatesDocument } from '../src/course/spatialCandidates'

const candidates = JSON.parse(
  readFileSync(resolve(process.cwd(), 'data/derived/jingshanhu/spatial-candidates.json'), 'utf8'),
) as SpatialCandidatesDocument

describe('净山湖 Thread 03D topology/global matching', () => {
  it('从空间候选稳定生成 Tee zone、Green 分类、corridor 和转场图', () => {
    const topology = buildCourseTopology(candidates)

    expect(topology.teeZones).toHaveLength(18)
    expect(topology.teeZones.filter((zone) => zone.source === 'osm')).toHaveLength(2)
    expect(topology.teeZones.every((zone) => zone.status === 'candidate')).toBe(true)
    expect(topology.greens).toHaveLength(26)
    expect(topology.greens.filter((green) => green.classification === 'primary-course')).toHaveLength(18)
    expect(topology.greens.filter((green) => green.classification === 'practice')).toHaveLength(4)
    expect(topology.corridors).toHaveLength(468)
    expect(topology.corridors.every((corridor) => !corridor.isProxy && corridor.centerline.coordinates.length >= 3)).toBe(true)
    expect(topology.transitions).toHaveLength(468 * 467)
    expect(topology.transitions.every((transition) => transition.transitionCostMetres >= transition.straightDistanceMetres)).toBe(true)
  })

  it('输出确定性的 Top 3 全局方案，并保持 Green/corridor 一对一', () => {
    const first = solveGlobalHoleMatches(candidates, jingshanhuV05Course)
    const second = solveGlobalHoleMatches(candidates, jingshanhuV05Course)

    expect(first.solutions).toHaveLength(3)
    expect(first.solutions.map((solution) => solution.id)).toEqual(['S01', 'S02', 'S03'])
    expect(first.solutions.map((solution) => solution.rankingScore)).toEqual(second.solutions.map((solution) => solution.rankingScore))
    expect(first.solutions.map((solution) => solution.entries.map((entry) => entry.corridorId))).toEqual(
      second.solutions.map((solution) => solution.entries.map((entry) => entry.corridorId)),
    )
    expect(first.scoreMeaning).toBe('candidate ranking score, not probability')

    for (const solution of first.solutions) {
      expect(solution.entries).toHaveLength(18)
      const mapped = solution.entries.filter((entry) => entry.corridorId !== null)
      expect(new Set(mapped.map((entry) => entry.greenId)).size).toBe(mapped.length)
      expect(new Set(mapped.map((entry) => entry.corridorId)).size).toBe(mapped.length)
      expect(solution.entries.every((entry) => entry.status === 'candidate' || entry.status === 'unknown')).toBe(true)
      expect(solution.evidence.some((line) => line.includes('不是概率'))).toBe(true)
    }
    expect(validateGlobalMatchingResult(first)).toEqual([])
    expect(validateCourseTopology(first.topology)).toEqual([])
    expect(validateGlobalHoleSolutionSet(first, first.topology, jingshanhuV05Course)).toEqual([])
  })
})
