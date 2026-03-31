/**
 * ReadOnlyContext — provides a read-only/audit mode flag throughout the app.
 *
 * When isReadOnly is true the app is running in Audit Mode:
 *   • Passcode screen was bypassed via a valid ?audit=TOKEN URL param
 *   • A yellow persistent banner is shown in AppShell
 *   • Write/save/delete actions should be disabled
 */

import { createContext, useContext } from 'react'

export interface ReadOnlyContextValue {
  isReadOnly: boolean
}

export const ReadOnlyContext = createContext<ReadOnlyContextValue>({ isReadOnly: false })

export function useReadOnly(): ReadOnlyContextValue {
  return useContext(ReadOnlyContext)
}
