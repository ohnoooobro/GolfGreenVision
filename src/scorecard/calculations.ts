import type { GolfCourseGeoJSON } from '../course'
import type { ScorecardPlayer, ScorecardStats, Tee } from './types'

export function getTeeOptions(course: GolfCourseGeoJSON): Tee[] {
  const first = course.features[0]?.properties.teeYardages
  if (!first) return []
  return (['gold', 'blue', 'white', 'red'] as Tee[]).filter((tee) => typeof first[tee] === 'number')
}

export function getYardage(course: GolfCourseGeoJSON, hole: number, tee: Tee): number | null {
  const feature = course.features.find((item) => item.properties.hole === hole)
  const value = feature?.properties.teeYardages?.[tee]
  return typeof value === 'number' ? value : null
}

function sumCompleted(scores: Array<number | null>, pars: Array<number | null>, start: number, end: number): { strokes: number | null; par: number | null; relative: number | null; completed: number } {
  let strokes = 0
  let par = 0
  let completed = 0
  for (let index = start; index < end; index += 1) {
    const score = scores[index]
    const holePar = pars[index]
    if (typeof score !== 'number' || typeof holePar !== 'number') continue
    strokes += score
    par += holePar
    completed += 1
  }
  return { strokes: completed ? strokes : null, par: completed ? par : null, relative: completed ? strokes - par : null, completed }
}

export function calculateStats(player: ScorecardPlayer, course: GolfCourseGeoJSON): ScorecardStats {
  const pars = Array.from({ length: 18 }, (_, index) => course.features.find((feature) => feature.properties.hole === index + 1)?.properties.par ?? null)
  const out = sumCompleted(player.scores, pars, 0, 9)
  const back = sumCompleted(player.scores, pars, 9, 18)
  const total = sumCompleted(player.scores, pars, 0, 18)
  return {
    completedHoles: total.completed,
    strokes: total.strokes,
    par: total.par,
    relative: total.relative,
    outStrokes: out.strokes,
    outPar: out.par,
    outRelative: out.relative,
    inStrokes: back.strokes,
    inPar: back.par,
    inRelative: back.relative,
    totalStrokes: total.strokes,
    totalPar: total.par,
    totalRelative: total.relative,
  }
}

export function formatRelative(relative: number | null): string {
  if (relative === null) return '—'
  if (relative === 0) return 'E'
  return relative > 0 ? `+${relative}` : `${relative}`
}

export function formatScore(strokes: number | null): string {
  return strokes === null ? '—' : String(strokes)
}
