import type { HoleLocation } from './types'

export type FieldConfirmationActualHole = number | 'uncertain'
export type FieldConfirmationSource = 'field' | 'familiar-player' | 'official'

export interface FieldConfirmationEvent {
  schemaVersion: 1
  timestamp: string
  predictedHole: number | null
  actualHole: FieldConfirmationActualHole
  confirmationSource: FieldConfirmationSource
  position: HoleLocation & { accuracy?: number }
  note?: string
}

export type FieldConfirmationEventInput = Omit<FieldConfirmationEvent, 'schemaVersion' | 'timestamp'> & {
  timestamp?: string
}

function validHole(hole: number | null): boolean {
  return hole === null || (Number.isInteger(hole) && hole >= 1 && hole <= 18)
}

function validActualHole(hole: FieldConfirmationActualHole): boolean {
  return hole === 'uncertain' || validHole(hole)
}

function validPosition(position: FieldConfirmationEvent['position']): boolean {
  return Number.isFinite(position.latitude) && position.latitude >= -90 && position.latitude <= 90 &&
    Number.isFinite(position.longitude) && position.longitude >= -180 && position.longitude <= 180 &&
    (position.accuracy === undefined || (Number.isFinite(position.accuracy) && position.accuracy >= 0))
}

/** 创建现场确认事件；事件只记录现场证据，不提升空间候选的状态。 */
export function createFieldConfirmationEvent(input: FieldConfirmationEventInput): FieldConfirmationEvent {
  const event: FieldConfirmationEvent = {
    schemaVersion: 1,
    timestamp: input.timestamp ?? new Date().toISOString(),
    predictedHole: input.predictedHole ?? null,
    actualHole: input.actualHole,
    confirmationSource: input.confirmationSource,
    position: input.position,
    ...(input.note ? { note: input.note } : {}),
  }
  if (!isValidFieldConfirmationEvent(event)) throw new Error('现场确认事件包含非法洞号、坐标或来源。')
  return event
}

export function isValidFieldConfirmationEvent(value: unknown): value is FieldConfirmationEvent {
  if (!value || typeof value !== 'object') return false
  const event = value as Partial<FieldConfirmationEvent>
  return event.schemaVersion === 1 && typeof event.timestamp === 'string' && !Number.isNaN(Date.parse(event.timestamp)) &&
    validHole(event.predictedHole ?? null) && validActualHole(event.actualHole as FieldConfirmationActualHole) &&
    ['field', 'familiar-player', 'official'].includes(event.confirmationSource ?? '') &&
    !!event.position && validPosition(event.position) && (event.note === undefined || typeof event.note === 'string')
}
