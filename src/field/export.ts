import { FIELD_APP_VERSION, FIELD_BUILD_ID, FIELD_CANDIDATE_DATASET_VERSION, FIELD_DATA_VERSION } from './session'
import type { FieldExportDocument, FieldTestState } from './types'

export function createFieldExportDocument(state: FieldTestState, generatedAt = new Date()): FieldExportDocument {
  if (!state.session) throw new Error('没有可导出的现场测试 Session。')
  return {
    schemaVersion: 1,
    session: state.session,
    samples: state.samples,
    confirmationEvents: state.confirmationEvents,
    track: state.trackPoints,
    metadata: {
      generatedAt: generatedAt.toISOString(),
      exportedAt: generatedAt.toISOString(),
      appVersion: FIELD_APP_VERSION,
      buildId: FIELD_BUILD_ID,
      courseId: state.session.courseId,
      dataVersion: FIELD_DATA_VERSION,
      candidateDatasetVersion: FIELD_CANDIDATE_DATASET_VERSION,
      locationMode: state.session.locationMode ?? 'real',
      exportSource: 'browser-local-storage',
    },
  }
}

export function serializeFieldExport(state: FieldTestState, generatedAt = new Date()): string {
  return JSON.stringify(createFieldExportDocument(state, generatedAt), null, 2)
}

export function fieldExportFilename(date = new Date()): string {
  const iso = date.toISOString().slice(0, 10)
  return `jingshanhu-field-${iso}.json`
}

export function downloadFieldExport(state: FieldTestState, date = new Date()): string {
  const json = serializeFieldExport(state, date)
  if (typeof document === 'undefined' || typeof URL === 'undefined' || typeof Blob === 'undefined') return json
  const blob = new Blob([json], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fieldExportFilename(date)
  anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
  return json
}
