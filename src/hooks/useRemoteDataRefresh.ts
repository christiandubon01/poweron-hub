import { useEffect } from 'react'
import { setDirtyScope } from '@/services/liveCloudRefreshService'

export interface UseRemoteDataRefreshOptions {
  scopeId: string
  label?: string
  isDirty?: boolean
  onRemoteDataApplied?: () => void
  onRemoteDataAvailable?: () => void
}

/**
 * Phase 6T — register a dirty scope and react to live cloud refresh events.
 */
export function useRemoteDataRefresh({
  scopeId,
  label,
  isDirty = false,
  onRemoteDataApplied,
  onRemoteDataAvailable,
}: UseRemoteDataRefreshOptions): void {
  useEffect(() => {
    setDirtyScope(scopeId, isDirty, label)
    return () => unregisterOnUnmount(scopeId)
  }, [scopeId, label, isDirty])

  useEffect(() => {
    const handleApplied = () => {
      if (isDirty) return
      onRemoteDataApplied?.()
    }
    const handleAvailable = () => {
      if (!isDirty) return
      onRemoteDataAvailable?.()
    }
    window.addEventListener('poweron-remote-data-refreshed', handleApplied)
    window.addEventListener('poweron-remote-data-available', handleAvailable)
    return () => {
      window.removeEventListener('poweron-remote-data-refreshed', handleApplied)
      window.removeEventListener('poweron-remote-data-available', handleAvailable)
    }
  }, [isDirty, onRemoteDataApplied, onRemoteDataAvailable])
}

function unregisterOnUnmount(scopeId: string): void {
  setDirtyScope(scopeId, false)
}
