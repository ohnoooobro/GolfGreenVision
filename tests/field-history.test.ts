import { describe, expect, it } from 'vitest'
import { archiveFieldSession, clearFieldTestState, createEmptyFieldTestState, createFieldExportDocument, createFieldSample, createFieldSession, createFieldTrackPoint, endFieldSession, FIELD_BACKUP_KEY_PREFIX, FIELD_HISTORY_STORAGE_KEY, FIELD_STORAGE_KEY, FIELD_SWITCH_STORAGE_KEY, fieldExportFilename, getHoleTee, loadFieldSessionHistory, loadFieldTestState, readFieldExportDocument, saveFieldTestState, selectFieldHole, selectFieldTee, serializeFieldExport, startNextFieldSession } from '../src/field'
import type { FieldTestState, StorageLike } from '../src/field'
import { createFieldConfirmationEvent as confirmation } from '../src/course/fieldConfirmation'
import { SCORECARD_STORAGE_KEY } from '../src/scorecard/types'

function storage(): StorageLike {
  const values = new Map<string, string>()
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value) }, removeItem: (key) => { values.delete(key) } }
}
function ended(): FieldTestState {
  const session = createFieldSession({ now: new Date('2026-10-06T00:00:00Z'), notes: '合成测试，非实测 GPS', locationMode: 'simulated' })
  const location = { latitude: 30, longitude: 120, accuracy: 8, timestamp: Date.parse(session.startTime), altitude: null, heading: null, speed: null }
  const samples = [createFieldSample({ sessionId: session.sessionId, actualHole: 12, predictedHole: null, location, sampleType: 'tee', teeCategory: 'blue', teeSelectionStatus: 'confirmed' })]
  const trackPoints = [createFieldTrackPoint({ sessionId: session.sessionId, actualHole: 12, predictedHole: null, location })]
  return { ...selectFieldTee(selectFieldHole(createEmptyFieldTestState(), 12), 12, 'blue'), session: endFieldSession(session, samples, trackPoints, new Date('2026-10-08T00:00:00Z')), samples, trackPoints, confirmationEvents: [{ ...confirmation({ predictedHole: null, actualHole: 12, confirmationSource: 'field' }), sessionId: session.sessionId }] }
}

describe('球局归档的写入、恢复与兼容性', () => {
  it('第一场、结束归档、第二场与刷新，样本轨迹确认和洞号 T 台完全独立', () => {
    const db = storage()
    const old = ended()
    expect(saveFieldTestState(old, db)).toBe(true)
    const result = startNextFieldSession(old, { now: new Date('2026-10-11T00:00:00Z'), locationMode: 'simulated' }, db)
    expect(result.ok).toBe(true)
    expect(result.state!.session!.sessionId).not.toBe(old.session!.sessionId)
    expect(result.state!.session!.startTime).toBe('2026-10-11T00:00:00.000Z')
    expect(result.state).toMatchObject({ samples: [], trackPoints: [], confirmationEvents: [], currentActualHole: null, holeTees: {} })
    expect(getHoleTee(selectFieldHole(result.state!, 13), 13)).toEqual({ teeCategory: 'unknown', selectionStatus: 'unknown' })
    expect(loadFieldTestState(db)).toEqual(result.state)
    const archived = loadFieldSessionHistory(db)[0].state
    expect(archived).toEqual(old)
    expect(readFieldExportDocument(serializeFieldExport(archived)).session).toEqual(old.session)
    expect(createFieldExportDocument(archived).track).toEqual(old.trackPoints)
    expect(startNextFieldSession(old, {}, db).ok).toBe(false)
    expect(loadFieldTestState(db)).toEqual(result.state)
    expect(loadFieldSessionHistory(db)).toHaveLength(1)
  })

  it.each([57, 66])('合成旧版 %i 条记录保留日期洞号、扩展元数据和旧备份，不自动拆分', (count) => {
    const db = storage()
    const old = ended()
    const legacy = { ...old, customMetadata: { source: 'synthetic' }, samples: Array.from({ length: count }, (_, i) => { const { teeCategory: _tee, teeSelectionStatus: _status, ...sample } = old.samples[0]; return { ...sample, id: `synthetic-${i}`, timestamp: i < 30 ? '2026-10-06T00:00:00.000Z' : '2026-10-08T00:00:00.000Z' } }) }
    const raw = JSON.stringify(legacy)
    db.setItem(FIELD_STORAGE_KEY, raw)
    db.setItem(`${FIELD_BACKUP_KEY_PREFIX}${old.session!.sessionId}`, 'historical-export-backup')
    const loaded = loadFieldTestState(db)
    expect(db.getItem(FIELD_STORAGE_KEY)).toBe(raw)
    expect(loaded.samples).toEqual(legacy.samples)
    expect(startNextFieldSession(loaded, {}, db).ok).toBe(true)
    expect(loadFieldSessionHistory(db)[0].state).toEqual(legacy)
    const doc = JSON.parse(serializeFieldExport(loadFieldSessionHistory(db)[0].state))
    expect(doc.schemaVersion).toBe(1)
    expect(readFieldExportDocument(JSON.stringify(doc)).samples).toHaveLength(count)
    expect(doc.samples.map((s: {timestamp: string}) => s.timestamp)).toEqual(legacy.samples.map((s) => s.timestamp))
    expect(db.getItem(`${FIELD_BACKUP_KEY_PREFIX}${old.session!.sessionId}`)).toBe('historical-export-backup')
  })

  it('损坏历史、归档内容冲突均阻止切换，不覆盖任何原件', () => {
    const db = storage(); const old = ended(); saveFieldTestState(old, db)
    db.setItem(FIELD_HISTORY_STORAGE_KEY, '{broken')
    expect(startNextFieldSession(old, {}, db).ok).toBe(false)
    expect(db.getItem(FIELD_HISTORY_STORAGE_KEY)).toBe('{broken')
    expect(loadFieldTestState(db)).toEqual(old)
    db.removeItem(FIELD_HISTORY_STORAGE_KEY)
    expect(archiveFieldSession(old, db).ok).toBe(true)
    const raw = db.getItem(FIELD_HISTORY_STORAGE_KEY)
    expect(archiveFieldSession(old, db).ok).toBe(true)
    expect(archiveFieldSession({ ...old, samples: [] }, db).ok).toBe(false)
    expect(db.getItem(FIELD_HISTORY_STORAGE_KEY)).toBe(raw)
  })

  it.each([FIELD_HISTORY_STORAGE_KEY, FIELD_SWITCH_STORAGE_KEY, FIELD_STORAGE_KEY])('模拟 %s 配额耗尽时保留旧当前球局，能够重试', (blockedKey) => {
    const base = storage(); const old = ended(); saveFieldTestState(old, base)
    let blocked = true
    const db: StorageLike = { ...base, setItem: (key, value) => { if (blocked && key === blockedKey) throw new Error('QuotaExceededError'); base.setItem(key, value) } }
    expect(startNextFieldSession(old, {}, db).ok).toBe(false)
    expect(loadFieldTestState(db)).toEqual(old)
    blocked = false
    expect(startNextFieldSession(old, {}, db).ok).toBe(true)
    expect(loadFieldSessionHistory(db)).toHaveLength(1)
  })

  it('写入后回读失败且回滚写入失败时，刷新仍从切换保护键读取旧球局', () => {
    const base = storage(); const old = ended(); saveFieldTestState(old, base)
    let newWritten = false; let broken = true
    const db: StorageLike = { ...base,
      setItem: (key, value) => { if (broken && key === FIELD_STORAGE_KEY && newWritten) throw new Error('rollback blocked'); base.setItem(key, value); if (key === FIELD_STORAGE_KEY && JSON.parse(value).session.sessionId !== old.session!.sessionId) newWritten = true },
      getItem: (key) => { if (broken && key === FIELD_STORAGE_KEY && newWritten) throw new Error('read blocked'); return base.getItem(key) },
    }
    expect(startNextFieldSession(old, {}, db).ok).toBe(false)
    expect(base.getItem(FIELD_SWITCH_STORAGE_KEY)).toBeTruthy()
    expect(loadFieldTestState(db)).toEqual(old)
    broken = false
    expect(startNextFieldSession(loadFieldTestState(db), {}, db).ok).toBe(true)
    expect(base.getItem(FIELD_SWITCH_STORAGE_KEY)).toBeNull()
    expect(loadFieldSessionHistory(db)).toHaveLength(1)
  })

  it('历史归档后自动保存不能跨 Session 写回旧状态；删除本场只影响当前及其备份', () => {
    const db = storage(); const old = ended(); saveFieldTestState(old, db)
    db.setItem(SCORECARD_STORAGE_KEY, 'private-scorecard-synthetic')
    const result = startNextFieldSession(old, {}, db)
    const historyRaw = db.getItem(FIELD_HISTORY_STORAGE_KEY)
    expect(saveFieldTestState(old, db)).toBe(false)
    expect(loadFieldTestState(db)).toEqual(result.state)
    clearFieldTestState(db)
    expect(db.getItem(FIELD_STORAGE_KEY)).toBeNull()
    expect(db.getItem(FIELD_HISTORY_STORAGE_KEY)).toBe(historyRaw)
    expect(db.getItem(SCORECARD_STORAGE_KEY)).toBe('private-scorecard-synthetic')
    expect(db.getItem(`${FIELD_BACKUP_KEY_PREFIX}${old.session!.sessionId}`)).toBeTruthy()
  })

  it('文件名同日不同球局可区分，非法字符安全过滤', () => {
    const date = new Date('2026-10-11T00:00:00Z')
    expect(fieldExportFilename(date, 'jingshanhu-first-round')).not.toBe(fieldExportFilename(date, 'jingshanhu-second-round'))
    expect(fieldExportFilename(date, '../../bad:*?id', '../course')).toMatch(/^[a-zA-Z0-9_-]+\.json$/)
  })
})
