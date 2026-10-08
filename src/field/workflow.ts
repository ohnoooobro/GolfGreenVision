import type { FieldHoleTee, FieldSample, FieldTestState, TeeCategory } from './types'

export const TEE_CATEGORY_LABELS: Record<TeeCategory, string> = {
  black: '黑 T', gold: '金 T', blue: '蓝 T', white: '白 T', red: '红 T', other: '其他', unknown: '不确定',
}
export function isTeeCategory(value: unknown): value is TeeCategory {
  return typeof value === 'string' && Object.hasOwn(TEE_CATEGORY_LABELS, value)
}
export function getHoleTee(state: FieldTestState, hole: number | null): FieldHoleTee {
  return (hole === null ? undefined : state.holeTees?.[hole]) ?? { teeCategory: 'unknown', selectionStatus: 'unknown' }
}
export function selectFieldHole(state: FieldTestState, hole: number | null): FieldTestState {
  if (hole === null || state.holeTees?.[hole]) return { ...state, currentActualHole: hole }
  const previous = getHoleTee(state, state.currentActualHole)
  const tee: FieldHoleTee = { teeCategory: previous.teeCategory, selectionStatus: previous.teeCategory === 'unknown' ? 'unknown' : 'inherited' }
  return { ...state, currentActualHole: hole, holeTees: { ...(state.holeTees ?? {}), [hole]: tee } }
}
export function selectFieldTee(state: FieldTestState, hole: number, teeCategory: TeeCategory): FieldTestState {
  return { ...state, holeTees: { ...(state.holeTees ?? {}), [hole]: { teeCategory, selectionStatus: teeCategory === 'unknown' ? 'unknown' : 'confirmed' } } }
}
export function getFieldProgress(samples: FieldSample[]) {
  const holes = Array.from({ length: 18 }, (_, index) => {
    const hole = index + 1
    return { hole, tee: samples.some((s) => s.actualHole === hole && s.sampleType === 'tee'), green: samples.some((s) => s.actualHole === hole && s.sampleType === 'green') }
  })
  return {
    holes, teeCount: holes.filter((h) => h.tee).length, greenCount: holes.filter((h) => h.green).length,
    completedHoles: holes.filter((h) => h.tee && h.green).map((h) => h.hole),
    partialHoles: holes.filter((h) => h.tee !== h.green),
    unrecordedHoles: holes.filter((h) => !h.tee && !h.green).map((h) => h.hole),
  }
}
