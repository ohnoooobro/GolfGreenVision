import { describe, expect, it } from 'vitest'
import { createFieldConfirmationEvent, isValidFieldConfirmationEvent } from '../src/course/fieldConfirmation'

describe('现场确认事件', () => {
  it('保留预测洞、实际洞、WGS84 位置和来源，不改变候选状态', () => {
    const event = createFieldConfirmationEvent({
      predictedHole: 7,
      actualHole: 8,
      confirmationSource: 'field',
      position: { latitude: 40.18, longitude: 116.43, accuracy: 8 },
      note: '现场发球台标牌确认。',
      timestamp: '2026-09-27T08:00:00.000Z',
    })
    expect(event).toEqual({
      schemaVersion: 1,
      timestamp: '2026-09-27T08:00:00.000Z',
      predictedHole: 7,
      actualHole: 8,
      confirmationSource: 'field',
      position: { latitude: 40.18, longitude: 116.43, accuracy: 8 },
      note: '现场发球台标牌确认。',
    })
    expect(isValidFieldConfirmationEvent(event)).toBe(true)
  })

  it('允许实际洞号不确定，但拒绝越界坐标', () => {
    const event = createFieldConfirmationEvent({
      predictedHole: null,
      actualHole: 'uncertain',
      confirmationSource: 'field',
      position: { latitude: 40.18, longitude: 116.43 },
    })
    expect(event.actualHole).toBe('uncertain')
    expect(isValidFieldConfirmationEvent({ ...event, position: { latitude: 91, longitude: 116.43 } })).toBe(false)
  })
})
