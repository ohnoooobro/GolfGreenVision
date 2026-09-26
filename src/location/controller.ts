import type {
  LocationEvent,
  LocationListener,
  LocationMode,
  LocationSource,
  LocationState,
} from './types'
import type { SimulatedLocationSource, SimulatedPositionInput } from './sources'

export class LocationController {
  private mode: LocationMode = 'real'
  private state: LocationState = {
    mode: 'real',
    status: 'waiting',
    location: null,
    errorMessage: null,
  }
  private readonly listeners = new Set<(state: LocationState) => void>()
  private active = false
  private activeSource: LocationSource

  constructor(
    private readonly realSource: LocationSource,
    private readonly simulatedSource: SimulatedLocationSource,
  ) {
    this.activeSource = realSource
  }

  subscribe(listener: (state: LocationState) => void): () => void {
    this.listeners.add(listener)
    listener(this.state)
    return () => this.listeners.delete(listener)
  }

  start(): void {
    if (this.active) return
    this.active = true
    this.activeSource.start((event) => this.handle(event))
  }

  stop(): void {
    if (!this.active) return
    this.activeSource.stop()
    this.active = false
  }

  setMode(mode: LocationMode): void {
    if (mode === this.mode) return
    this.activeSource.stop()
    this.mode = mode
    this.activeSource = mode === 'real' ? this.realSource : this.simulatedSource
    this.state = { mode, status: 'waiting', location: null, errorMessage: null }
    this.emit()
    if (this.active) this.activeSource.start((event) => this.handle(event))
  }

  setSimulatedPosition(input: SimulatedPositionInput): void {
    this.simulatedSource.setPosition(input)
  }

  getState(): LocationState {
    return this.state
  }

  private handle(event: LocationEvent): void {
    if (event.type === 'location') {
      this.state = { ...this.state, status: 'success', location: event.location, errorMessage: null }
    } else {
      this.state = { ...this.state, status: event.status, errorMessage: event.message ?? null }
    }
    this.emit()
  }

  private emit(): void {
    for (const listener of this.listeners) listener(this.state)
  }
}

export type { LocationListener }
