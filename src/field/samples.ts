import type { FieldCandidateMapping } from './candidateMapping'
import type { FieldLocationSnapshot, FieldSample, FieldSampleType } from './types'

function createId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return `${prefix}-${crypto.randomUUID()}`
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

export interface CreateFieldSampleInput {
  sessionId: string
  actualHole: number | null
  predictedHole: number | null
  location: FieldLocationSnapshot
  sampleType: FieldSampleType
  candidateMapping: FieldCandidateMapping | null
  id?: string
}

export function createFieldSample(input: CreateFieldSampleInput): FieldSample {
  const actualHole = input.actualHole
  if (typeof actualHole !== 'number' || !Number.isInteger(actualHole) || actualHole < 1 || actualHole > 18) throw new Error('保存采样前必须先选择实际洞号。')
  if (!Number.isFinite(input.location.latitude) || !Number.isFinite(input.location.longitude) || !Number.isFinite(input.location.accuracy) || input.location.accuracy < 0) throw new Error('定位数据无效，无法保存采样。')
  return {
    schemaVersion: 1,
    id: input.id ?? createId(input.sampleType),
    sessionId: input.sessionId,
    timestamp: new Date(input.location.timestamp).toISOString(),
    actualHole,
    predictedHole: input.predictedHole,
    latitude: input.location.latitude,
    longitude: input.location.longitude,
    accuracy: input.location.accuracy,
    altitude: input.location.altitude,
    heading: input.location.heading,
    speed: input.location.speed,
    candidateMapping: input.candidateMapping,
    sampleType: input.sampleType,
    source: 'field',
  }
}

export function undoLastFieldSample(samples: FieldSample[]): { removed: FieldSample | null; samples: FieldSample[] } {
  if (samples.length === 0) return { removed: null, samples }
  return { removed: samples[samples.length - 1], samples: samples.slice(0, -1) }
}
