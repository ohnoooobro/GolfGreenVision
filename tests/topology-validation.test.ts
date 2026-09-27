import { describe, expect, it } from 'vitest'
import {
  validateCourseTopology,
  validateGlobalHoleSolutionSet,
} from '../src/course'

function topologyFixture() {
  return {
    schemaVersion: 1,
    courseId: 'fixture',
    coordinateSystem: 'EPSG:4326 / WGS84',
    teeZones: [{
      id: 'TZ01',
      center: { type: 'Point', coordinates: [116.4, 40.1] },
      sourceObjectId: 'T01',
    }],
    greens: [{ id: 'G01', classification: 'unknown', sourceObjectId: 'G01' }],
    corridors: [{
      id: 'C01',
      teeZoneId: 'TZ01',
      greenId: 'G01',
      centerline: { type: 'LineString', coordinates: [[116.4, 40.1], [116.401, 40.101]] },
      approximateLengthMetres: 140,
    }],
    transitions: [{
      id: 'C01->C01',
      fromCorridorId: 'C01',
      toCorridorId: 'C01',
      transitionCostMetres: 0,
    }],
    warnings: [],
  }
}

function solutionFixture() {
  return {
    schemaVersion: 1,
    courseId: 'fixture',
    coordinateSystem: 'EPSG:4326 / WGS84',
    solutions: [{
      id: 'S01',
      rankingScore: 0.2,
      scoreMeaning: 'candidate ranking score, not probability',
      featureMatchScore: 0.4,
      transitionCostMetres: 0,
      conflictCount: 0,
      unresolvedHoleCount: 17,
      status: 'candidate',
      evidence: ['Deterministic global search'],
      transitions: [],
      assignments: [
        {
          hole: 1,
          status: 'candidate',
          teeZoneId: 'TZ01',
          greenId: 'G01',
          corridorId: 'C01',
          candidate: { green: 'G01', corridor: 'C01', score: 0.4 },
          evidence: ['spatial candidate'],
          conflicts: [],
        },
        ...Array.from({ length: 17 }, (_, index) => ({
          hole: index + 2,
          status: 'unknown',
          teeZoneId: null,
          greenId: null,
          corridorId: null,
          candidate: null,
          evidence: ['unresolved'],
          conflicts: ['not forced'],
        })),
      ],
    }],
  }
}

describe('全局拓扑数据校验', () => {
  it('接受合法的 WGS84 topology 与未强行补齐的全局方案', () => {
    const topology = topologyFixture()
    expect(validateCourseTopology(topology)).toEqual([])
    expect(validateGlobalHoleSolutionSet(solutionFixture(), topology)).toEqual([])
  })

  it('拒绝单一方案重复使用 Green 或 corridor', () => {
    const topology = topologyFixture()
    const result = solutionFixture()
    const second = result.solutions[0].assignments[1]
    second.status = 'candidate'
    second.teeZoneId = 'TZ01'
    second.greenId = 'G01'
    second.corridorId = 'C01'
    second.candidate = { green: 'G01', corridor: 'C01', score: 0.3 }
    result.solutions[0].unresolvedHoleCount = 16
    const issues = validateGlobalHoleSolutionSet(result, topology)
    expect(issues.some((item) => item.code === 'duplicate-global-green')).toBe(true)
    expect(issues.some((item) => item.code === 'duplicate-global-corridor')).toBe(true)
  })

  it('拒绝没有两类独立来源的 high-confidence-inferred 映射', () => {
    const topology = topologyFixture()
    const result = solutionFixture()
    const assignment = result.solutions[0].assignments[0]
    assignment.status = 'high-confidence-inferred'
    assignment.mappingIndependentEvidence = false
    result.solutions[0].unresolvedHoleCount = 17
    const issues = validateGlobalHoleSolutionSet(result, topology)
    expect(issues.some((item) => item.code === 'missing-independent-evidence' && item.hole === 1)).toBe(true)
  })

  it('拒绝把 ranking score 写成概率语义', () => {
    const result = solutionFixture()
    result.solutions[0].scoreMeaning = 'probability'
    const issues = validateGlobalHoleSolutionSet(result, topologyFixture())
    expect(issues.some((item) => item.code === 'invalid-score-meaning')).toBe(true)
  })
})
