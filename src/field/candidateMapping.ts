import type { SpatialCandidateStatus } from '../course/spatialCandidates'

/**
 * 净山湖 schema 2 的轻量现场快照。
 * 这些值只用于现场记录上下文，不会把 candidate 提升为已验证洞号。
 */
export interface FieldCandidateMapping {
  status: SpatialCandidateStatus
  score: number | null
  scoreMeaning: 'candidate ranking score, not probability'
  teeZoneId: string | null
  greenId: string | null
  corridorId: string | null
}

const CANDIDATES: Record<number, Omit<FieldCandidateMapping, 'scoreMeaning'>> = {
  1: { status: 'candidate', score: 0.74, teeZoneId: 'TZ05', greenId: 'G02', corridorId: 'TC106' },
  2: { status: 'candidate', score: 0.74, teeZoneId: 'TZ08', greenId: 'G03', corridorId: 'TC185' },
  3: { status: 'candidate', score: 0.74, teeZoneId: 'TZ05', greenId: 'G01', corridorId: 'TC105' },
  4: { status: 'candidate', score: 0.74, teeZoneId: 'TZ08', greenId: 'G06', corridorId: 'TC188' },
  5: { status: 'candidate', score: 0.74, teeZoneId: 'TZ12', greenId: 'G08', corridorId: 'TC294' },
  6: { status: 'candidate', score: 0.74, teeZoneId: 'TZ04', greenId: 'G11', corridorId: 'TC089' },
  7: { status: 'candidate', score: 0.74, teeZoneId: 'TZ04', greenId: 'G04', corridorId: 'TC082' },
  8: { status: 'candidate', score: 0.74, teeZoneId: 'TZ07', greenId: 'G09', corridorId: 'TC165' },
  9: { status: 'candidate', score: 0.74, teeZoneId: 'TZ04', greenId: 'G13', corridorId: 'TC091' },
  10: { status: 'candidate', score: 0.74, teeZoneId: 'TZ07', greenId: 'G05', corridorId: 'TC083' },
  11: { status: 'candidate', score: 0.74, teeZoneId: 'TZ11', greenId: 'G10', corridorId: 'TC218' },
  12: { status: 'candidate', score: 0.74, teeZoneId: 'TZ11', greenId: 'G14', corridorId: 'TC326' },
  17: { status: 'candidate', score: 0.74, teeZoneId: 'TZ02', greenId: 'G19', corridorId: 'TC045' },
}

export function getFieldCandidateMapping(hole: number | null): FieldCandidateMapping | null {
  if (hole === null || !Number.isInteger(hole) || hole < 1 || hole > 18) return null
  const candidate = CANDIDATES[hole]
  return candidate ? { ...candidate, scoreMeaning: 'candidate ranking score, not probability' } : {
    status: 'unknown',
    score: null,
    scoreMeaning: 'candidate ranking score, not probability',
    teeZoneId: null,
    greenId: null,
    corridorId: null,
  }
}
