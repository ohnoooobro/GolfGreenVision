import { createEmptyFieldTestState } from './session'
import type { FieldTestState } from './types'

export const FIELD_STORAGE_KEY = 'golf-green-vision.field-test.v1'

export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

function defaultStorage(): StorageLike | null {
  if (typeof window === 'undefined' || !window.localStorage) return null
  return window.localStorage
}

export function saveFieldTestState(state: FieldTestState, storage: StorageLike | null = defaultStorage()): boolean {
  if (!storage) return false
  try {
    storage.setItem(FIELD_STORAGE_KEY, JSON.stringify(state))
    return true
  } catch {
    return false
  }
}

export function loadFieldTestState(storage: StorageLike | null = defaultStorage()): FieldTestState {
  if (!storage) return createEmptyFieldTestState()
  try {
    const raw = storage.getItem(FIELD_STORAGE_KEY)
    if (!raw) return createEmptyFieldTestState()
    const value = JSON.parse(raw) as Partial<FieldTestState>
    if (!value || typeof value !== 'object') return createEmptyFieldTestState()
    const samples = Array.isArray(value.samples) ? value.samples : []
    const hasCurrentActualHole = Object.prototype.hasOwnProperty.call(value, 'currentActualHole')
    const currentActualHole = hasCurrentActualHole
      ? (value.currentActualHole === null || (typeof value.currentActualHole === 'number' && Number.isInteger(value.currentActualHole) && value.currentActualHole >= 1 && value.currentActualHole <= 18) ? value.currentActualHole : null)
      : (samples.at(-1)?.actualHole ?? null)
    const session = value.session && typeof value.session === 'object'
      ? { ...value.session, locationMode: value.session.locationMode === 'simulated' ? 'simulated' as const : 'real' as const }
      : null
    return {
      session,
      currentActualHole,
      samples,
      confirmationEvents: Array.isArray(value.confirmationEvents) ? value.confirmationEvents : [],
      trackPoints: Array.isArray(value.trackPoints) ? value.trackPoints : [],
    }
  } catch {
    return createEmptyFieldTestState()
  }
}

export function clearFieldTestState(storage: StorageLike | null = defaultStorage()): void {
  storage?.removeItem(FIELD_STORAGE_KEY)
}
