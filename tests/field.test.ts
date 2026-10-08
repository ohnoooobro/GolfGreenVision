import { describe, expect, it } from 'vitest'
import { createFieldConfirmationEvent } from '../src/course/fieldConfirmation'
import {
  FIELD_STORAGE_KEY,
  clearFieldTestState,
  checkFieldReadiness,
  createEmptyFieldTestState,
  createFieldExportDocument,
  createFieldSample,
  createFieldSession,
  createFieldTrackPoint,
  distanceMetres,
  endFieldSession,
  fieldExportFilename,
  getFieldCandidateMapping,
  isFieldStateRecoverable,
  isValidFieldExportDocument,
  isStorageAvailable,
  loadFieldTestState,
  saveFieldTestState,
  serializeFieldExport,
  shouldRecordTrackPoint,
  undoLastFieldSample,
  updateFieldSessionStats,
  validateFieldExportDocument,
  getFieldProgress,
  getHoleTee,
  readFieldExportDocument,
  selectFieldHole,
  selectFieldTee,
} from '../src/field'
import type { FieldLocationSnapshot, FieldTestState } from '../src/field'
import type { StorageLike } from '../src/field/persistence'

const BASE_TIME = Date.parse('2026-09-27T08:00:00.000Z')

function location(timestamp = BASE_TIME, latitude = 40.1842613, longitude = 116.4317627, accuracy = 8): FieldLocationSnapshot {
  return {
    latitude,
    longitude,
    accuracy,
    altitude: 40,
    heading: null,
    speed: null,
    timestamp,
  }
}

function memoryStorage(): StorageLike {
  const values = new Map<string, string>()
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  }
}

function sampleInput(sessionId: string, sampleType: 'tee' | 'green' = 'tee', actualHole: number | null = 3) {
  return {
    sessionId,
    actualHole,
    predictedHole: 2,
    location: location(),
    sampleType,
    candidateMapping: getFieldCandidateMapping(actualHole),
  }
}

describe('现场 Session 与样本', () => {
  it('创建 Session 时保存版本、设备信息和备注，并可由样本/轨迹更新统计', () => {
    const session = createFieldSession({
      now: new Date(BASE_TIME),
      notes: '白 tee，上午测试',
      device: { userAgent: 'test-agent', platform: 'test-platform', language: 'zh-CN' },
      locationMode: 'simulated',
    })
    const tee = createFieldSample(sampleInput(session.sessionId, 'tee', 3))
    const green = createFieldSample(sampleInput(session.sessionId, 'green', 3))
    const trackPoint = createFieldTrackPoint({
      sessionId: session.sessionId,
      actualHole: 3,
      predictedHole: 2,
      location: location(),
    })

    expect(session).toMatchObject({
      schemaVersion: 1,
      startTime: '2026-09-27T08:00:00.000Z',
      endTime: null,
      locationMode: 'simulated',
      courseId: 'jingshanhu',
      notes: '白 tee，上午测试',
      completedHoles: [],
      sampleCounts: { tee: 0, green: 0 },
      trackPointCount: 0,
    })
    expect(session.sessionId).toMatch(/^jingshanhu-/)
    expect(updateFieldSessionStats(session, [tee, green], [trackPoint])).toMatchObject({
      completedHoles: [3],
      sampleCounts: { tee: 1, green: 1 },
      trackPointCount: 1,
    })
  })

  it('未选择实际洞号时拒绝样本，且保留 actualHole 与 predictedHole 的独立性', () => {
    const session = createFieldSession({ now: new Date(BASE_TIME) })
    expect(() => createFieldSample(sampleInput(session.sessionId, 'tee', null))).toThrow('必须先选择实际洞号')

    const sample = createFieldSample(sampleInput(session.sessionId, 'green', 8))
    expect(sample.actualHole).toBe(8)
    expect(sample.predictedHole).toBe(2)
    expect(sample.sampleType).toBe('green')
    expect(sample.source).toBe('field')
    expect(sample.candidateMapping?.scoreMeaning).toBe('candidate ranking score, not probability')
    expect(sample.timestamp).toBe('2026-09-27T08:00:00.000Z')
  })

  it('支持多次采样、撤销最后一条，并同步结束 Session 统计', () => {
    const session = createFieldSession({ now: new Date(BASE_TIME) })
    const first = createFieldSample(sampleInput(session.sessionId, 'tee', 1))
    const second = createFieldSample(sampleInput(session.sessionId, 'green', 2))
    const samples = [first, second]
    const undone = undoLastFieldSample(samples)
    expect(undone.removed).toBe(second)
    expect(undone.samples).toEqual([first])
    expect(undoLastFieldSample([])).toEqual({ removed: null, samples: [] })

    const ended = endFieldSession(session, samples, [], new Date(BASE_TIME + 60_000))
    expect(ended.endTime).toBe('2026-09-27T08:01:00.000Z')
    expect(ended.completedHoles).toEqual([1, 2])
    expect(ended.sampleCounts).toEqual({ tee: 1, green: 1 })
    expect(ended.trackPointCount).toBe(0)
    expect(isFieldStateRecoverable({ session: ended, samples, confirmationEvents: [], trackPoints: [] })).toBe(false)
  })
})

describe('现场确认事件', () => {
  it('分别记录正确、实际是其他洞和暂不确定三种现场结果', () => {
    const correct = createFieldConfirmationEvent({ predictedHole: 4, actualHole: 4, confirmationSource: 'field' })
    const other = createFieldConfirmationEvent({ predictedHole: 4, actualHole: 7, confirmationSource: 'field', note: '球洞牌确认' })
    const uncertain = createFieldConfirmationEvent({ predictedHole: null, actualHole: 'uncertain', confirmationSource: 'field' })

    expect(correct).toMatchObject({ predictedHole: 4, actualHole: 4, confirmationSource: 'field' })
    expect(other).toMatchObject({ predictedHole: 4, actualHole: 7, note: '球洞牌确认' })
    expect(uncertain).toMatchObject({ predictedHole: null, actualHole: 'uncertain' })
    expect([correct, other, uncertain].every((event) => event.schemaVersion === 1)).toBe(true)
  })
})

describe('现场轨迹过滤', () => {
  it('首次立即记录，达到时间或距离阈值时记录，两个阈值都未达到时跳过', () => {
    const sessionId = 'session-track'
    const first = createFieldTrackPoint({ sessionId, actualHole: 1, predictedHole: 1, location: location(BASE_TIME) })
    expect(shouldRecordTrackPoint(null, location(BASE_TIME))).toBe(true)
    expect(shouldRecordTrackPoint(first, location(BASE_TIME + 9_999))).toBe(false)
    expect(shouldRecordTrackPoint(first, location(BASE_TIME + 10_000))).toBe(true)

    const nearby = location(BASE_TIME + 1_000, 40.1842613, 116.4317627 + 0.0002)
    expect(distanceMetres(first, nearby)).toBeGreaterThan(0)
    expect(shouldRecordTrackPoint(first, nearby, { minIntervalMs: 60_000, minDistanceMetres: 10 })).toBe(true)
    expect(shouldRecordTrackPoint(first, location(BASE_TIME + 1_000, 40.1842613, 116.4317627 + 0.000001), { minIntervalMs: 60_000, minDistanceMetres: 10 })).toBe(false)
  })

  it('轨迹点保留实际洞号、预测洞号、accuracy 和 ISO 时间', () => {
    const trackPoint = createFieldTrackPoint({
      sessionId: 'session-track',
      actualHole: null,
      predictedHole: 9,
      location: location(BASE_TIME, 40, 116, 18),
    })
    expect(trackPoint).toMatchObject({
      schemaVersion: 1,
      sessionId: 'session-track',
      actualHole: null,
      predictedHole: 9,
      latitude: 40,
      longitude: 116,
      accuracy: 18,
      timestamp: '2026-09-27T08:00:00.000Z',
    })
  })
})

describe('现场状态持久化与导出', () => {
  it('使用 localStorage 形状的接口保存、恢复和清空现场状态', () => {
    const storage = memoryStorage()
    const session = createFieldSession({ now: new Date(BASE_TIME) })
    const state: FieldTestState = {
      ...createEmptyFieldTestState(),
      session,
      samples: [createFieldSample(sampleInput(session.sessionId, 'tee', 1))],
    }

    expect(saveFieldTestState(state, storage)).toBe(true)
    expect(storage.getItem(FIELD_STORAGE_KEY)).toContain(session.sessionId)
    expect(loadFieldTestState(storage)).toEqual(state)

    clearFieldTestState(storage)
    expect(storage.getItem(FIELD_STORAGE_KEY)).toBeNull()
    expect(loadFieldTestState(storage)).toEqual(createEmptyFieldTestState())

    storage.setItem(FIELD_STORAGE_KEY, '{not-json')
    expect(loadFieldTestState(storage)).toEqual(createEmptyFieldTestState())
    storage.setItem(FIELD_STORAGE_KEY, JSON.stringify({ session, samples: 'invalid' }))
    expect(loadFieldTestState(storage)).toEqual({ session, currentActualHole: null, samples: [], confirmationEvents: [], trackPoints: [] })
  })

  it('导出文档可序列化并通过 validator，损坏样本会被报告', () => {
    const session = createFieldSession({ now: new Date(BASE_TIME) })
    const sample = createFieldSample(sampleInput(session.sessionId, 'green', 3))
    const state: FieldTestState = {
      ...createEmptyFieldTestState(),
      session,
      samples: [sample],
    }
    const document = createFieldExportDocument(state, new Date(BASE_TIME + 1234))

    expect(document.metadata).toMatchObject({
      generatedAt: '2026-09-27T08:00:01.234Z',
      exportedAt: '2026-09-27T08:00:01.234Z',
      courseId: 'jingshanhu',
      locationMode: 'real',
      exportSource: 'browser-local-storage',
    })
    expect(document.metadata.buildId).toBeTruthy()
    expect(document.track).toEqual([])
    expect(isValidFieldExportDocument(document)).toBe(true)
    expect(JSON.parse(serializeFieldExport(state, new Date(BASE_TIME + 1234)))).toEqual(document)
    expect(fieldExportFilename(new Date(BASE_TIME))).toBe('jingshanhu-field-2026-09-27.json')

    const invalid = { ...document, samples: [{ ...sample, actualHole: 19 }] }
    expect(isValidFieldExportDocument(invalid)).toBe(false)
    expect(validateFieldExportDocument(invalid)).toContain('samples[0] 结构无效。')
    const invalidTrack = { ...document, track: [{ ...document.track[0], latitude: 91 }] }
    expect(validateFieldExportDocument(invalidTrack)).toContain('track[0] 结构无效。')
    expect(() => createFieldExportDocument({ ...state, session: null })).toThrow('没有可导出的现场测试 Session')
  })

  it('候选数据缺失时仍可创建现场采样，导出不会自动清除 Session', () => {
    const session = createFieldSession({ now: new Date(BASE_TIME) })
    const state: FieldTestState = { ...createEmptyFieldTestState(), session, samples: [createFieldSample({ ...sampleInput(session.sessionId, 'tee', 1), candidateMapping: null })] }
    expect(state.samples).toHaveLength(1)
    expect(createFieldExportDocument(state).session.sessionId).toBe(session.sessionId)
  })

  it('未结束 Session 可恢复，结束后不再标记为可恢复', () => {
    const session = createFieldSession({ now: new Date(BASE_TIME) })
    const active: FieldTestState = { ...createEmptyFieldTestState(), session }
    expect(isFieldStateRecoverable(active)).toBe(true)
    const ended: FieldTestState = { ...active, session: endFieldSession(session, [], [], new Date(BASE_TIME + 1_000)) }
    expect(isFieldStateRecoverable(ended)).toBe(false)
    expect(isFieldStateRecoverable(createEmptyFieldTestState())).toBe(false)
  })
})

describe('现场出发前检查', () => {
  it('能够识别 localStorage 写入失败和权限拒绝', () => {
    const blockedStorage: StorageLike = { getItem: () => null, setItem: () => { throw new Error('blocked') }, removeItem: () => undefined }
    expect(isStorageAvailable(blockedStorage)).toBe(false)
    const checks = checkFieldReadiness({ storage: blockedStorage, geolocationPermission: 'denied', candidateDatasetLoaded: false, locationState: { mode: 'real', status: 'waiting', location: null, errorMessage: null } })
    expect(checks.find((check) => check.key === 'permission')).toMatchObject({ ok: false })
    expect(checks.find((check) => check.key === 'storage')).toMatchObject({ ok: false })
    expect(checks.find((check) => check.key === 'candidate')).toMatchObject({ ok: false })
  })

  it('安全上下文失败时明确提示手机定位可能不可用', () => {
    const original = window.isSecureContext
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: false })
    const check = checkFieldReadiness({ storage: memoryStorage() }).find((item) => item.key === 'secure-context')
    expect(check).toMatchObject({ ok: false, detail: '当前页面不是安全连接，手机定位可能不可用。' })
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: original })
  })
})

describe('现场采集流程优化', () => {
  it('每洞独立 T 台，下一洞继承但标记未确认，仍可修改', () => {
    const initial = createEmptyFieldTestState()
    const hole1 = selectFieldTee(selectFieldHole(initial, 1), 1, 'white')
    expect(getHoleTee(hole1, 1)).toEqual({ teeCategory: 'white', selectionStatus: 'confirmed' })
    const hole2 = selectFieldHole(hole1, 2)
    expect(getHoleTee(hole2, 2)).toEqual({ teeCategory: 'white', selectionStatus: 'inherited' })
    const changed = selectFieldTee(hole2, 2, 'blue')
    expect(getHoleTee(changed, 1).teeCategory).toBe('white')
    expect(getHoleTee(changed, 2)).toEqual({ teeCategory: 'blue', selectionStatus: 'confirmed' })
  })

  it('未知 T 台可以继续采集并在旧导出读取时补为 unknown', () => {
    const session = createFieldSession({ now: new Date(BASE_TIME) })
    const sample = createFieldSample({ ...sampleInput(session.sessionId, 'tee', 3), teeCategory: 'unknown' })
    expect(sample.teeCategory).toBe('unknown')
    const legacy = JSON.stringify({ schemaVersion: 1, session, samples: [{ ...sample, teeCategory: undefined, teeSelectionStatus: undefined }], confirmationEvents: [], track: [], metadata: { generatedAt: new Date(BASE_TIME).toISOString(), exportedAt: new Date(BASE_TIME).toISOString(), appVersion: '1.0.0', buildId: 'x', courseId: 'jingshanhu', dataVersion: 'jingshanhu-v0.5', candidateDatasetVersion: 'spatial-candidates-schema-2', locationMode: 'real', exportSource: 'browser-local-storage' } })
    expect(readFieldExportDocument(legacy).samples[0].teeCategory).toBe('unknown')
  })

  it('分别统计 Tee、Green、完整洞和漏采，不追填其他洞', () => {
    const session = createFieldSession({ now: new Date(BASE_TIME) })
    const tee = createFieldSample(sampleInput(session.sessionId, 'tee', 1))
    const green = createFieldSample(sampleInput(session.sessionId, 'green', 2))
    const progress = getFieldProgress([tee, green])
    expect(progress.teeCount).toBe(1)
    expect(progress.greenCount).toBe(1)
    expect(progress.completedHoles).toEqual([])
    expect(progress.partialHoles.map((item) => item.hole)).toEqual([1, 2])
  })
})
