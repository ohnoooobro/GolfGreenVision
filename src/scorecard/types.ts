import type { GolfCourseGeoJSON } from '../course'

export const SCORECARD_STORAGE_KEY = 'golf-green-vision.scorecard.v1'
export const MAX_PLAYERS = 4
export const MIN_STROKES = 1
export const MAX_STROKES = 99

export type Tee = 'gold' | 'blue' | 'white' | 'red'

export interface ScorecardPlayer {
  playerId: string
  name: string
  avatar: string
  tee: Tee
  scores: Array<number | null>
}

export interface ScorecardSession {
  id: string
  createdAt: string
  courseId: string
  players: ScorecardPlayer[]
}

export interface ScorecardStats {
  completedHoles: number
  strokes: number | null
  par: number | null
  relative: number | null
  outStrokes: number | null
  outPar: number | null
  outRelative: number | null
  inStrokes: number | null
  inPar: number | null
  inRelative: number | null
  totalStrokes: number | null
  totalPar: number | null
  totalRelative: number | null
}

export interface ScorecardHole {
  hole: number
  par: number | null
  yardage: number | null
}

export type ScorecardStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export function createEmptyScores(): Array<number | null> {
  return Array.from({ length: 18 }, () => null)
}

export function createPlayer(index: number, tee: Tee = 'blue'): ScorecardPlayer {
  return { playerId: `player-${Date.now()}-${index}`, name: `球员 ${index}`, avatar: ['🙂', '🧢', '😎', '⛳'][index - 1] ?? '🏌️', tee, scores: createEmptyScores() }
}

export function getCourseHoles(course: GolfCourseGeoJSON): ScorecardHole[] {
  return course.features
    .map((feature) => ({
      hole: feature.properties.hole,
      par: feature.properties.par,
      yardage: null,
    }))
    .sort((left, right) => left.hole - right.hole)
    .map((hole) => {
      const feature = course.features.find((item) => item.properties.hole === hole.hole)
      return { ...hole, yardage: feature?.properties.teeYardages?.blue ?? null }
    })
}
