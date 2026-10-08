import { isValidFieldConfirmationEvent } from '../course/fieldConfirmation'
import type { FieldExportDocument, FieldSample, FieldTestState, FieldTrackPoint } from './types'
import { isTeeCategory } from './workflow'

function validHole(value: unknown, allowNull = false): boolean {
  return (allowNull && value === null) || (typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 18)
}

function validSample(sample: unknown): sample is FieldSample {
  if (!sample || typeof sample !== 'object') return false
  const value = sample as Partial<FieldSample>
  return value.schemaVersion === 1 && typeof value.id === 'string' && typeof value.sessionId === 'string' && typeof value.timestamp === 'string' && !Number.isNaN(Date.parse(value.timestamp)) &&
    validHole(value.actualHole) && validHole(value.predictedHole, true) && typeof value.latitude === 'number' && Number.isFinite(value.latitude) && value.latitude >= -90 && value.latitude <= 90 &&
    typeof value.longitude === 'number' && Number.isFinite(value.longitude) && value.longitude >= -180 && value.longitude <= 180 && typeof value.accuracy === 'number' && Number.isFinite(value.accuracy) && value.accuracy >= 0 &&
    (value.altitude === null || typeof value.altitude === 'number') && (value.heading === null || typeof value.heading === 'number') && (value.speed === null || typeof value.speed === 'number') &&
    (value.sampleType === 'tee' || value.sampleType === 'green') && value.source === 'field' &&
    (value.teeCategory === undefined || isTeeCategory(value.teeCategory)) &&
    (value.teeSelectionStatus === undefined || ['confirmed', 'inherited', 'unknown'].includes(value.teeSelectionStatus))
}

function validTrackPoint(point: unknown): point is FieldTrackPoint {
  if (!point || typeof point !== 'object') return false
  const value = point as Partial<FieldTrackPoint>
  return value.schemaVersion === 1 && typeof value.id === 'string' && typeof value.sessionId === 'string' &&
    typeof value.timestamp === 'string' && !Number.isNaN(Date.parse(value.timestamp)) &&
    validHole(value.actualHole, true) && validHole(value.predictedHole, true) &&
    typeof value.latitude === 'number' && Number.isFinite(value.latitude) && value.latitude >= -90 && value.latitude <= 90 &&
    typeof value.longitude === 'number' && Number.isFinite(value.longitude) && value.longitude >= -180 && value.longitude <= 180 &&
    typeof value.accuracy === 'number' && Number.isFinite(value.accuracy) && value.accuracy >= 0
}

export function validateFieldExportDocument(value: unknown): string[] {
  const issues: string[] = []
  if (!value || typeof value !== 'object') return ['导出内容必须是对象。']
  const document = value as Partial<FieldExportDocument>
  if (document.schemaVersion !== 1) issues.push('schemaVersion 必须为 1。')
  if (!document.session || typeof document.session !== 'object') issues.push('缺少 session。')
  else {
    if (document.session.schemaVersion !== 1 || typeof document.session.sessionId !== 'string' || !['real', 'simulated'].includes(document.session.locationMode)) issues.push('session 结构无效。')
    if (document.session.courseId !== 'jingshanhu') issues.push('session.courseId 必须为 jingshanhu。')
  }
  if (!Array.isArray(document.samples)) issues.push('samples 必须是数组。')
  else document.samples.forEach((sample, index) => { if (!validSample(sample)) issues.push(`samples[${index}] 结构无效。`) })
  if (document.holeTees !== undefined) {
    if (!document.holeTees || typeof document.holeTees !== 'object' || Array.isArray(document.holeTees)) issues.push('holeTees 必须是对象。')
    else Object.entries(document.holeTees).forEach(([hole, tee]) => {
      if (!validHole(Number(hole)) || !tee || !isTeeCategory(tee.teeCategory) || !['confirmed', 'inherited', 'unknown'].includes(tee.selectionStatus)) issues.push(`holeTees[${hole}] 结构无效。`)
    })
  }
  if (!Array.isArray(document.confirmationEvents)) issues.push('confirmationEvents 必须是数组。')
  else document.confirmationEvents.forEach((event, index) => {
    if (!event || typeof event !== 'object' || !isValidFieldConfirmationEvent(event)) issues.push(`confirmationEvents[${index}] 结构无效。`)
  })
  if (!Array.isArray(document.track)) issues.push('track 必须是数组。')
  else document.track.forEach((point, index) => { if (!validTrackPoint(point)) issues.push(`track[${index}] 结构无效。`) })
  if (!document.metadata || typeof document.metadata !== 'object') issues.push('缺少 metadata。')
  else {
    if (!['real', 'simulated'].includes(document.metadata.locationMode)) issues.push('metadata.locationMode 无效。')
    if (document.metadata.courseId !== 'jingshanhu') issues.push('metadata.courseId 必须为 jingshanhu。')
    if (typeof document.metadata.appVersion !== 'string' || typeof document.metadata.buildId !== 'string') issues.push('metadata 版本信息无效。')
    if (typeof document.metadata.exportedAt !== 'string' || Number.isNaN(Date.parse(document.metadata.exportedAt))) issues.push('metadata.exportedAt 无效。')
  }
  return issues
}

export function isValidFieldExportDocument(value: unknown): value is FieldExportDocument {
  return validateFieldExportDocument(value).length === 0
}

export function isFieldStateRecoverable(state: Pick<FieldTestState, 'session'>): boolean {
  return state.session !== null && state.session.endTime === null
}
