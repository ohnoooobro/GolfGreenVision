import { createEmptyFieldTestState, FIELD_BUILD_ID } from './session'
import type { FieldTestState } from './types'
import { isTeeCategory } from './workflow'

export const FIELD_STORAGE_KEY = 'golf-green-vision.field-test.v1'
export const FIELD_BACKUP_KEY_PREFIX = `${FIELD_STORAGE_KEY}.backup.`

export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

function defaultStorage(): StorageLike | null {
  if (typeof window === 'undefined') return null
  try { return window.localStorage ?? null } catch { return null }
}

export function isStorageAvailable(storage: StorageLike | null = defaultStorage()): boolean {
  if (!storage) return false
  const probeKey = `${FIELD_STORAGE_KEY}.probe`
  try { storage.setItem(probeKey, '1'); storage.removeItem(probeKey); return true } catch { return false }
}

export function saveFieldTestState(state: FieldTestState, storage: StorageLike | null = defaultStorage()): boolean {
  if (!storage) return false
  try {
    // 首次写入新版前原样保留每个旧 Session；备份成功后才允许写主键。
    const raw = storage.getItem(FIELD_STORAGE_KEY)
    if (raw) {
      let sessionId = 'unreadable'
      try { sessionId = JSON.parse(raw)?.session?.sessionId ?? 'no-session' } catch { /* 原文仍备份 */ }
      const backupKey = `${FIELD_BACKUP_KEY_PREFIX}${sessionId}`
      if (!storage.getItem(backupKey)) storage.setItem(backupKey, raw)
    }
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
    const samples = Array.isArray(value.samples) ? value.samples.map((sample) => ({ ...sample, teeCategory: sample.teeCategory ?? 'unknown' as const, teeSelectionStatus: sample.teeSelectionStatus ?? 'unknown' as const })) : []
    const hasCurrentActualHole = Object.prototype.hasOwnProperty.call(value, 'currentActualHole')
    const currentActualHole = hasCurrentActualHole
      ? (value.currentActualHole === null || (typeof value.currentActualHole === 'number' && Number.isInteger(value.currentActualHole) && value.currentActualHole >= 1 && value.currentActualHole <= 18) ? value.currentActualHole : null)
      : (samples.at(-1)?.actualHole ?? null)
    const session = value.session && typeof value.session === 'object'
      ? { ...value.session, buildId: typeof value.session.buildId === 'string' ? value.session.buildId : FIELD_BUILD_ID, locationMode: value.session.locationMode === 'simulated' ? 'simulated' as const : 'real' as const }
      : null
    return {
      ...(Object.prototype.hasOwnProperty.call(value, 'holeTees') ? { holeTees: Object.fromEntries(Object.entries(value.holeTees ?? {}).filter(([hole, tee]) => Number.isInteger(Number(hole)) && Number(hole) >= 1 && Number(hole) <= 18 && tee && isTeeCategory(tee.teeCategory) && ['confirmed', 'inherited', 'unknown'].includes(tee.selectionStatus))) } : {}),
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
  if (!storage) return
  const raw = storage.getItem(FIELD_STORAGE_KEY)
  let sessionId: string | undefined
  try { sessionId = raw ? JSON.parse(raw)?.session?.sessionId : undefined } catch { /* 不删除损坏数据的备份 */ }
  storage.removeItem(FIELD_STORAGE_KEY)
  if (sessionId) storage.removeItem(`${FIELD_BACKUP_KEY_PREFIX}${sessionId}`)
}
