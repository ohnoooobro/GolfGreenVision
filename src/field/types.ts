import type { FieldConfirmationEvent } from '../course/fieldConfirmation'
import type { LocationData } from '../location/types'
import type { FieldCandidateMapping } from './candidateMapping'

export type FieldSampleType = 'tee' | 'green'

export interface FieldDeviceInfo {
  userAgent: string
  platform: string
  language: string
}

export interface FieldSample {
  schemaVersion: 1
  id: string
  sessionId: string
  timestamp: string
  actualHole: number
  predictedHole: number | null
  latitude: number
  longitude: number
  accuracy: number
  altitude: number | null
  heading: number | null
  speed: number | null
  candidateMapping: FieldCandidateMapping | null
  sampleType: FieldSampleType
  source: 'field'
}

export interface FieldTrackPoint {
  schemaVersion: 1
  id: string
  sessionId: string
  timestamp: string
  latitude: number
  longitude: number
  accuracy: number
  actualHole: number | null
  predictedHole: number | null
}

export interface FieldSession {
  schemaVersion: 1
  sessionId: string
  startTime: string
  endTime: string | null
  locationMode: 'real' | 'simulated'
  courseId: 'jingshanhu'
  appVersion: string
  buildId: string
  dataVersion: string
  candidateDatasetVersion: string
  device: FieldDeviceInfo
  notes: string
  completedHoles: number[]
  sampleCounts: { tee: number; green: number }
  trackPointCount: number
}

export type FieldConfirmationRecord = FieldConfirmationEvent & { sessionId: string }

export interface FieldTestState {
  session: FieldSession | null
  /** 当前现场人员选择的实际洞号；用于刷新/恢复，不代表系统预测。 */
  currentActualHole: number | null
  samples: FieldSample[]
  confirmationEvents: FieldConfirmationRecord[]
  trackPoints: FieldTrackPoint[]
}

export interface FieldExportDocument {
  schemaVersion: 1
  session: FieldSession
  samples: FieldSample[]
  confirmationEvents: FieldConfirmationRecord[]
  track: FieldTrackPoint[]
  metadata: {
    generatedAt: string
    exportedAt: string
    appVersion: string
    buildId: string
    courseId: 'jingshanhu'
    dataVersion: string
    candidateDatasetVersion: string
    locationMode: 'real' | 'simulated'
    exportSource: 'browser-local-storage'
  }
}

export type FieldLocationSnapshot = Pick<LocationData, 'latitude' | 'longitude' | 'accuracy' | 'altitude' | 'heading' | 'speed' | 'timestamp'>
