import { createPlayer, SCORECARD_STORAGE_KEY } from './types'
import type { ScorecardSession, ScorecardStorage, Tee } from './types'

function storageOrNull(storage?: ScorecardStorage | null): ScorecardStorage | null {
  if (storage) return storage
  if (typeof window === 'undefined') return null
  try { return window.localStorage } catch { return null }
}

export function createScorecardSession(now = new Date()): ScorecardSession {
  return { id: `scorecard-${now.getTime()}`, createdAt: now.toISOString(), courseId: 'jingshanhu', players: [createPlayer(1)] }
}

function isTee(value: unknown): value is Tee { return value === 'gold' || value === 'blue' || value === 'white' || value === 'red' }

function normalizeSession(value: unknown): ScorecardSession | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Partial<ScorecardSession>
  if (typeof raw.id !== 'string' || typeof raw.createdAt !== 'string' || !Array.isArray(raw.players)) return null
  const players = raw.players.slice(0, 4).flatMap((rawPlayer, index) => {
    if (!rawPlayer || typeof rawPlayer !== 'object') return []
    const player = rawPlayer as Partial<ReturnType<typeof createPlayer>>
    const scores = Array.from({ length: 18 }, (_, scoreIndex) => {
      const score = Array.isArray(player.scores) ? player.scores[scoreIndex] : null
      return typeof score === 'number' && Number.isInteger(score) && score >= 1 && score <= 99 ? score : null
    })
    return [{ playerId: typeof player.playerId === 'string' ? player.playerId : `player-${index + 1}`, name: typeof player.name === 'string' && player.name.trim() ? player.name : `球员 ${index + 1}`, avatar: typeof player.avatar === 'string' && player.avatar ? player.avatar : createPlayer(index + 1).avatar, tee: isTee(player.tee) ? player.tee : 'blue', scores }]
  })
  return { id: raw.id, createdAt: raw.createdAt, courseId: typeof raw.courseId === 'string' ? raw.courseId : 'jingshanhu', players }
}

export function saveScorecardSession(session: ScorecardSession, storage?: ScorecardStorage | null): boolean {
  const target = storageOrNull(storage)
  if (!target) return false
  try { target.setItem(SCORECARD_STORAGE_KEY, JSON.stringify(session)); return true } catch { return false }
}

export function loadScorecardSession(storage?: ScorecardStorage | null): ScorecardSession | null {
  const target = storageOrNull(storage)
  if (!target) return null
  try { return normalizeSession(JSON.parse(target.getItem(SCORECARD_STORAGE_KEY) ?? 'null')) } catch { return null }
}

export function clearScorecardSession(storage?: ScorecardStorage | null): void { storageOrNull(storage)?.removeItem(SCORECARD_STORAGE_KEY) }
