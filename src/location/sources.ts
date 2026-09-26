import { mapGeolocationError, toLocationData } from './geo'
import type { LocationData, LocationListener, LocationSource } from './types'

export class BrowserLocationSource implements LocationSource {
  private watchId: number | null = null

  start(listener: LocationListener): void {
    if (this.watchId !== null) return

    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      listener({
        type: 'status',
        status: 'unavailable',
        message: '当前浏览器不支持 Geolocation 定位。',
      })
      return
    }

    listener({ type: 'status', status: 'waiting' })
    this.watchId = navigator.geolocation.watchPosition(
      (position) => listener({ type: 'location', location: toLocationData(position) }),
      (error) => {
        const mapped = mapGeolocationError(error)
        listener({ type: 'status', status: mapped.status, message: mapped.message })
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15_000 },
    )
  }

  stop(): void {
    if (this.watchId === null) return
    navigator.geolocation.clearWatch(this.watchId)
    this.watchId = null
  }
}

export interface SimulatedPositionInput {
  latitude: number
  longitude: number
  accuracy?: number
  altitude?: number | null
  heading?: number | null
  speed?: number | null
  timestamp?: number
}

const DEFAULT_SIMULATED_POSITION: LocationData = {
  latitude: 39.9042,
  longitude: 116.4074,
  accuracy: 5,
  altitude: null,
  heading: null,
  speed: null,
  timestamp: Date.now(),
}

export class SimulatedLocationSource implements LocationSource {
  private listener: LocationListener | null = null
  private current: LocationData

  constructor(initial: SimulatedPositionInput = DEFAULT_SIMULATED_POSITION) {
    this.current = this.toLocationData(initial)
  }

  start(listener: LocationListener): void {
    this.listener = listener
    listener({ type: 'status', status: 'waiting' })
    listener({ type: 'location', location: this.current })
  }

  stop(): void {
    this.listener = null
  }

  setPosition(input: SimulatedPositionInput): void {
    this.current = this.toLocationData(input)
    this.listener?.({ type: 'location', location: this.current })
  }

  getPosition(): LocationData {
    return this.current
  }

  private toLocationData(input: SimulatedPositionInput): LocationData {
    if (!Number.isFinite(input.latitude) || input.latitude < -90 || input.latitude > 90) {
      throw new RangeError('纬度必须在 -90 到 90 之间。')
    }
    if (!Number.isFinite(input.longitude) || input.longitude < -180 || input.longitude > 180) {
      throw new RangeError('经度必须在 -180 到 180 之间。')
    }
    const accuracy = input.accuracy ?? 5
    if (!Number.isFinite(accuracy) || accuracy < 0) {
      throw new RangeError('accuracy 必须是非负数。')
    }
    return {
      latitude: input.latitude,
      longitude: input.longitude,
      accuracy,
      altitude: input.altitude ?? null,
      heading: input.heading ?? null,
      speed: input.speed ?? null,
      timestamp: input.timestamp ?? Date.now(),
    }
  }
}
