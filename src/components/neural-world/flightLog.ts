/**
 * flightLog.ts — NW29: Shared in-memory flight log for agent state tracking.
 *
 * Used by AgentFlightLayer (writes) and FlightAnalyticsPanel (reads).
 * Rolling buffer — max 500 entries.
 */

export type AgentFlightState = 'IDLE' | 'TASKED' | 'RETURNING'

export interface FlightLogEntry {
  agent:     string
  state:     AgentFlightState
  target:    string | null   // domain id or null
  timestamp: number          // performance.now() / 1000
}

const MAX_ENTRIES = 500

export const flightLog: FlightLogEntry[] = []

export function appendFlightLog(entry: FlightLogEntry): void {
  flightLog.push(entry)
  if (flightLog.length > MAX_ENTRIES) {
    flightLog.splice(0, flightLog.length - MAX_ENTRIES)
  }
}
