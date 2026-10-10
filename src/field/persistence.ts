import { createEmptyFieldTestState, createFieldSession, FIELD_BUILD_ID } from './session'
import type { FieldSessionHistoryEntry, FieldTestState } from './types'
import { isTeeCategory } from './workflow'

export const FIELD_STORAGE_KEY = 'golf-green-vision.field-test.v1'
export const FIELD_BACKUP_KEY_PREFIX = `${FIELD_STORAGE_KEY}.backup.`
export const FIELD_HISTORY_STORAGE_KEY = 'golf-green-vision.field-session-history.v1'
export const FIELD_SWITCH_STORAGE_KEY = `${FIELD_STORAGE_KEY}.pending-switch`

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
    if (!recoverPendingSwitch(storage)) return false
    // 首次写入新版前原样保留每个旧 Session；备份成功后才允许写主键。
    const raw = storage.getItem(FIELD_STORAGE_KEY)
    if (raw) {
      let sessionId = 'unreadable'
      try { sessionId = JSON.parse(raw)?.session?.sessionId ?? 'no-session' } catch { /* 原文仍备份 */ }
      // 不允许自动保存或过期页面跨 Session 覆盖主键。
      if (sessionId !== state.session?.sessionId) return false
      const backupKey = `${FIELD_BACKUP_KEY_PREFIX}${sessionId}`
      if (!storage.getItem(backupKey) && !writeVerified(storage, backupKey, raw)) return false
    }
    return writeVerified(storage, FIELD_STORAGE_KEY, JSON.stringify(state))
  } catch {
    return false
  }
}

function recoverPendingSwitch(storage: StorageLike): boolean {
  const pending = storage.getItem(FIELD_SWITCH_STORAGE_KEY)
  if (!pending) return true
  const { previousRaw } = JSON.parse(pending) as { previousRaw: string }
  if (typeof previousRaw !== 'string' || !writeVerified(storage, FIELD_STORAGE_KEY, previousRaw)) return false
  storage.removeItem(FIELD_SWITCH_STORAGE_KEY)
  return storage.getItem(FIELD_SWITCH_STORAGE_KEY) === null
}

function writeVerified(storage: StorageLike, key: string, value: string): boolean {
  try {
    storage.setItem(key, value)
    return storage.getItem(key) === value
  } catch {
    return false
  }
}

export function loadFieldSessionHistory(storage: StorageLike | null = defaultStorage()): FieldSessionHistoryEntry[] {
  if (!storage) return []
  const raw = storage.getItem(FIELD_HISTORY_STORAGE_KEY)
  if (!raw) return []
  const value = JSON.parse(raw)
  if (!Array.isArray(value) || value.some((entry) => !entry || typeof entry.archivedAt !== 'string' || !entry.state?.session?.sessionId || !Array.isArray(entry.state.samples) || !Array.isArray(entry.state.trackPoints) || !Array.isArray(entry.state.confirmationEvents))) throw new Error('历史球局存储损坏，已阻止覆盖。请保留本机数据。')
  return value
}

export function archiveFieldSession(state: FieldTestState, storage: StorageLike | null = defaultStorage(), archivedAt = new Date()): { ok: boolean; error?: string } {
  if (!state.session || state.session.endTime === null) return { ok: false, error: '只有已结束的球局可以归档。' }
  if (!storage) return { ok: false, error: '本机存储不可用，无法归档旧球局。' }
  try {
  const history = loadFieldSessionHistory(storage)
  const existing = history.find((entry) => entry.state.session?.sessionId === state.session?.sessionId)
  if (existing) return JSON.stringify(existing.state) === JSON.stringify(state) ? { ok: true } : { ok: false, error: '本场与已有归档内容不一致，已阻止切换；请先导出本场数据。' }
  const next = [...history, { archivedAt: archivedAt.toISOString(), state }]
  if (!writeVerified(storage, FIELD_HISTORY_STORAGE_KEY, JSON.stringify(next))) return { ok: false, error: '归档写入失败，旧球局仍保留，未开始新球局。' }
  const verified = loadFieldSessionHistory(storage)
  if (!verified.some((entry) => entry.state.session?.sessionId === state.session?.sessionId)) return { ok: false, error: '归档校验失败，未开始新球局。' }
  return { ok: true }
  } catch { return { ok: false, error: '历史球局读取或写入失败，未覆盖历史，未开始新球局。' } }
}

export function startNextFieldSession(previous: FieldTestState, options: Parameters<typeof createFieldSession>[0] = {}, storage: StorageLike | null = defaultStorage()): { ok: boolean; state?: FieldTestState; error?: string } {
  if (!previous.session || previous.session.endTime === null) return { ok: false, error: '请先结束当前球局。' }
  if (!storage) return { ok: false, error: '本机存储不可用，新球局未创建。' }
  try {
  if (!recoverPendingSwitch(storage)) return { ok: false, error: '旧球局恢复写入失败，请先导出并重试。' }
  const stored = loadFieldTestState(storage)
  if (stored.session?.sessionId !== previous.session.sessionId) return { ok: false, error: '当前球局已在其他页面改变，请刷新后重试。' }
  const archived = archiveFieldSession(previous, storage)
  if (!archived.ok) return archived
  const nextState: FieldTestState = { ...createEmptyFieldTestState(), session: createFieldSession(options) }
  const previousRaw = JSON.stringify(previous)
  // 保护最新已结束状态，恢复记录写入并回读后才切换主键。
  if (!saveFieldTestState(previous, storage) || !writeVerified(storage, FIELD_SWITCH_STORAGE_KEY, JSON.stringify({ previousRaw }))) return { ok: false, error: '切换保护记录写入失败，旧球局仍保留，请重试。' }
  const serialized = JSON.stringify(nextState)
  if (!writeVerified(storage, FIELD_STORAGE_KEY, serialized)) {
    writeVerified(storage, FIELD_STORAGE_KEY, previousRaw)
    return { ok: false, error: '新球局写入失败，旧球局仍保留，请重试。' }
  }
  try { storage.removeItem(FIELD_SWITCH_STORAGE_KEY); if (storage.getItem(FIELD_SWITCH_STORAGE_KEY) !== null) throw new Error('未完成切换') } catch { writeVerified(storage, FIELD_STORAGE_KEY, previousRaw); return { ok: false, error: '切换提交失败，旧球局有恢复记录，请重试。' } }
  return { ok: true, state: nextState }
  } catch { return { ok: false, error: '本机存储读取失败，旧球局及归档保留，未开始新球局。' } }
}


export function loadFieldTestState(storage: StorageLike | null = defaultStorage()): FieldTestState {
  if (!storage) return createEmptyFieldTestState()
  try {
    const pending = storage.getItem(FIELD_SWITCH_STORAGE_KEY)
    const raw = pending ? (JSON.parse(pending) as { previousRaw: string }).previousRaw : storage.getItem(FIELD_STORAGE_KEY)
    if (!raw) return createEmptyFieldTestState()
    const value = JSON.parse(raw) as Partial<FieldTestState>
    if (!value || typeof value !== 'object') return createEmptyFieldTestState()
    const samples = Array.isArray(value.samples) ? value.samples : []
    const hasCurrentActualHole = Object.prototype.hasOwnProperty.call(value, 'currentActualHole')
    const currentActualHole = hasCurrentActualHole
      ? (value.currentActualHole === null || (typeof value.currentActualHole === 'number' && Number.isInteger(value.currentActualHole) && value.currentActualHole >= 1 && value.currentActualHole <= 18) ? value.currentActualHole : null)
      : (samples.at(-1)?.actualHole ?? null)
    const session = value.session && typeof value.session === 'object'
      ? { ...value.session, buildId: typeof value.session.buildId === 'string' ? value.session.buildId : FIELD_BUILD_ID, locationMode: value.session.locationMode === 'simulated' ? 'simulated' as const : 'real' as const }
      : null
    return {
      ...value,
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
  if (!storage) throw new Error('本机存储不可用。')
  if (!recoverPendingSwitch(storage)) throw new Error('请先恢复旧球局。')
  const raw = storage.getItem(FIELD_STORAGE_KEY)
  let sessionId: string | undefined
  try { sessionId = raw ? JSON.parse(raw)?.session?.sessionId : undefined } catch { /* 不删除损坏数据的备份 */ }
  storage.removeItem(FIELD_STORAGE_KEY)
  if (storage.getItem(FIELD_STORAGE_KEY) !== null) throw new Error('当前球局删除失败。')
  if (sessionId) storage.removeItem(`${FIELD_BACKUP_KEY_PREFIX}${sessionId}`)
}

export function removeCurrentFieldTestState(storage: StorageLike | null = defaultStorage()): void {
  clearFieldTestState(storage)
}
