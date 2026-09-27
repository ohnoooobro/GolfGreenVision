import type { FieldDeviceInfo, FieldSession, FieldTestState } from './types'

export const FIELD_APP_VERSION = '1.0.0'
export const FIELD_DATA_VERSION = 'jingshanhu-v0.5'
export const FIELD_CANDIDATE_DATASET_VERSION = 'spatial-candidates-schema-2'

function createId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

function deviceInfo(): FieldDeviceInfo {
  if (typeof navigator === 'undefined') return { userAgent: 'unknown', platform: 'unknown', language: 'unknown' }
  return {
    userAgent: navigator.userAgent || 'unknown',
    platform: navigator.platform || 'unknown',
    language: navigator.language || 'unknown',
  }
}

export interface CreateSessionOptions {
  now?: Date
  notes?: string
  device?: FieldDeviceInfo
  locationMode?: 'real' | 'simulated'
}

export function createFieldSession(options: CreateSessionOptions = {}): FieldSession {
  return {
    schemaVersion: 1,
    sessionId: `jingshanhu-${createId()}`,
    startTime: (options.now ?? new Date()).toISOString(),
    endTime: null,
    locationMode: options.locationMode ?? 'real',
    courseId: 'jingshanhu',
    appVersion: FIELD_APP_VERSION,
    dataVersion: FIELD_DATA_VERSION,
    candidateDatasetVersion: FIELD_CANDIDATE_DATASET_VERSION,
    device: options.device ?? deviceInfo(),
    notes: options.notes ?? '',
    completedHoles: [],
    sampleCounts: { tee: 0, green: 0 },
    trackPointCount: 0,
  }
}

export function createEmptyFieldTestState(): FieldTestState {
  return { session: null, currentActualHole: null, samples: [], confirmationEvents: [], trackPoints: [] }
}

export function updateFieldSessionStats(session: FieldSession, samples: FieldTestState['samples'], trackPoints: FieldTestState['trackPoints']): FieldSession {
  const holes = [...new Set(samples.map((sample) => sample.actualHole))].sort((a, b) => a - b)
  return {
    ...session,
    completedHoles: holes,
    sampleCounts: {
      tee: samples.filter((sample) => sample.sampleType === 'tee').length,
      green: samples.filter((sample) => sample.sampleType === 'green').length,
    },
    trackPointCount: trackPoints.length,
  }
}

export function endFieldSession(session: FieldSession, samples: FieldTestState['samples'], trackPoints: FieldTestState['trackPoints'], now = new Date()): FieldSession {
  return { ...updateFieldSessionStats(session, samples, trackPoints), endTime: now.toISOString() }
}
