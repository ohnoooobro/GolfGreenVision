import { useEffect, useMemo, useState } from 'react'
import { LocationController } from './controller'
import { BrowserLocationSource, SimulatedLocationSource } from './sources'
import type { LocationMode, LocationState } from './types'

export function useLocation(): {
  state: LocationState
  setMode: (mode: LocationMode) => void
  setSimulatedPosition: typeof LocationController.prototype.setSimulatedPosition
} {
  const controller = useMemo(
    () => new LocationController(new BrowserLocationSource(), new SimulatedLocationSource()),
    [],
  )
  const [state, setState] = useState(controller.getState())

  useEffect(() => {
    const unsubscribe = controller.subscribe(setState)
    controller.start()
    return () => {
      unsubscribe()
      controller.stop()
    }
  }, [controller])

  return {
    state,
    setMode: (mode) => controller.setMode(mode),
    setSimulatedPosition: (input) => controller.setSimulatedPosition(input),
  }
}
