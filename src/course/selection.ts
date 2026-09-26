export interface HoleSelectionState {
  /** 当前定位自动判断的洞号。 */
  inferredHole: number | null
  /** 用户手动修正的洞号；null 表示没有修正。 */
  correctedHole: number | null
  /** 界面和后续业务实际使用的洞号。 */
  effectiveHole: number | null
}

/** 判断洞号是否存在于当前球场，供手动修正和输入校验共用。 */
export function isHoleAvailable(hole: number | null, availableHoles?: readonly number[]): boolean {
  return hole === null || availableHoles === undefined || availableHoles.includes(hole)
}

export function getEffectiveHole(state: Pick<HoleSelectionState, 'inferredHole' | 'correctedHole'>): number | null {
  return state.correctedHole ?? state.inferredHole
}

export function createHoleSelectionState(
  inferredHole: number | null = null,
  correctedHole: number | null = null,
): HoleSelectionState {
  return {
    inferredHole,
    correctedHole,
    effectiveHole: getEffectiveHole({ inferredHole, correctedHole }),
  }
}

/** 定位更新时只改变自动判断；已有手动修正继续优先。 */
export function updateInferredHole(state: HoleSelectionState, inferredHole: number | null): HoleSelectionState {
  return {
    ...state,
    inferredHole,
    effectiveHole: getEffectiveHole({ inferredHole, correctedHole: state.correctedHole }),
  }
}

export function setCorrectedHole(
  state: HoleSelectionState,
  correctedHole: number | null,
  availableHoles?: readonly number[],
): HoleSelectionState {
  const nextCorrectedHole = isHoleAvailable(correctedHole, availableHoles) ? correctedHole : null
  return {
    ...state,
    correctedHole: nextCorrectedHole,
    effectiveHole: getEffectiveHole({ inferredHole: state.inferredHole, correctedHole: nextCorrectedHole }),
  }
}

export function clearCorrectedHole(state: HoleSelectionState): HoleSelectionState {
  return setCorrectedHole(state, null)
}
