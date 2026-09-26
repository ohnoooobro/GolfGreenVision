export type LocationMode = 'real' | 'simulated'

export type LocationStatus =
  | 'waiting'
  | 'success'
  | 'permission-denied'
  | 'unavailable'
  | 'error'

export interface LocationData {
  latitude: number
  longitude: number
  accuracy: number
  altitude: number | null
  heading: number | null
  speed: number | null
  timestamp: number
}

export interface LocationState {
  mode: LocationMode
  status: LocationStatus
  location: LocationData | null
  errorMessage: string | null
}

export type LocationEvent =
  | { type: 'location'; location: LocationData }
  | { type: 'status'; status: Exclude<LocationStatus, 'success'>; message?: string }

export type LocationListener = (event: LocationEvent) => void

export interface LocationSource {
  start(listener: LocationListener): void
  stop(): void
}
