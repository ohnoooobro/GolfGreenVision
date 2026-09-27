import type { FieldLocationSnapshot, FieldTrackPoint } from './types'

const EARTH_RADIUS_METRES = 6_371_000

function createId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return `track-${crypto.randomUUID()}`
  return `track-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

export function distanceMetres(first: Pick<FieldLocationSnapshot, 'latitude' | 'longitude'>, second: Pick<FieldLocationSnapshot, 'latitude' | 'longitude'>): number {
  const toRadians = (value: number) => value * Math.PI / 180
  const dLat = toRadians(second.latitude - first.latitude)
  const dLon = toRadians(second.longitude - first.longitude)
  const lat1 = toRadians(first.latitude)
  const lat2 = toRadians(second.latitude)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2
  return EARTH_RADIUS_METRES * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

export interface TrackFilterOptions {
  minIntervalMs?: number
  minDistanceMetres?: number
}

export function shouldRecordTrackPoint(previous: FieldTrackPoint | null, location: FieldLocationSnapshot, options: TrackFilterOptions = {}): boolean {
  if (!previous) return true
  const minIntervalMs = options.minIntervalMs ?? 10_000
  const minDistance = options.minDistanceMetres ?? 10
  return location.timestamp - Date.parse(previous.timestamp) >= minIntervalMs || distanceMetres(previous, location) >= minDistance
}

export function createFieldTrackPoint(input: {
  sessionId: string
  actualHole: number | null
  predictedHole: number | null
  location: FieldLocationSnapshot
  id?: string
}): FieldTrackPoint {
  return {
    schemaVersion: 1,
    id: input.id ?? createId(),
    sessionId: input.sessionId,
    timestamp: new Date(input.location.timestamp).toISOString(),
    latitude: input.location.latitude,
    longitude: input.location.longitude,
    accuracy: input.location.accuracy,
    actualHole: input.actualHole,
    predictedHole: input.predictedHole,
  }
}
