/**
 * HomeBaseSettings — HUNTER home base address configuration
 *
 * Allows the operator to set their shop address. All HUNTER leads will
 * display distance from this location. On save, geocodes the address
 * server-side (no API key in browser) and triggers backfill for existing leads.
 *
 * HUNTER-GEOCODING-DISTANCE-CARDS-APR25-2026-1
 */

import React, { useState, useEffect } from 'react'
import { MapPin, Save, Edit2, RotateCcw, CheckCircle, AlertCircle, Loader } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { geocodeAddressViaEdge, triggerGeocodingBackfill } from '@/services/geocoding/GeocodingClient'

interface HomeBaseData {
  address: string
  lat: number
  lng: number
  formatted_address: string
  geocoded_at: string
}

type SaveState =
  | { type: 'idle' }
  | { type: 'geocoding' }
  | { type: 'saving' }
  | { type: 'backfilling'; processed: number; total: number }
  | { type: 'success'; message: string }
  | { type: 'error'; message: string }

async function getCurrentTenantId(): Promise<string | null> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data, error } = await (supabase as any)
    .from('user_tenants')
    .select('tenant_id')
    .eq('user_id', user.id)
    .limit(1)
    .single()
  if (error || !data) return null
  return data.tenant_id
}

async function loadHomeBase(tenantId: string): Promise<HomeBaseData | null> {
  const { data, error } = await (supabase as any)
    .from('tenant_settings')
    .select('setting_value')
    .eq('tenant_id', tenantId)
    .eq('setting_key', 'home_base_address')
    .maybeSingle()

  if (error || !data) return null
  return data.setting_value as HomeBaseData
}

async function saveHomeBase(
  tenantId: string,
  userId: string,
  homeBase: HomeBaseData
): Promise<void> {
  const { error } = await (supabase as any)
    .from('tenant_settings')
    .upsert(
      {
        tenant_id: tenantId,
        setting_key: 'home_base_address',
        setting_value: homeBase,
        updated_at: new Date().toISOString(),
        updated_by: userId,
      },
      { onConflict: 'tenant_id,setting_key' }
    )

  if (error) throw new Error(error.message)
}

export function HomeBaseSettings() {
  const [tenantId, setTenantId] = useState<string | null>(null)
  const [userId, setUserId] = useState<string | null>(null)
  const [savedHomeBase, setSavedHomeBase] = useState<HomeBaseData | null>(null)
  const [addressInput, setAddressInput] = useState('')
  const [isEditing, setIsEditing] = useState(false)
  const [saveState, setSaveState] = useState<SaveState>({ type: 'idle' })
  const [isLoadingData, setIsLoadingData] = useState(true)

  // Load current home base on mount
  useEffect(() => {
    async function init() {
      setIsLoadingData(true)
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return
        setUserId(user.id)

        const tid = await getCurrentTenantId()
        if (!tid) return
        setTenantId(tid)

        const existing = await loadHomeBase(tid)
        if (existing) {
          setSavedHomeBase(existing)
          setAddressInput(existing.address)
        }
      } catch (err) {
        console.error('[HomeBaseSettings] init error:', err)
      } finally {
        setIsLoadingData(false)
      }
    }
    init()
  }, [])

  const handleSave = async () => {
    if (!addressInput.trim()) return
    if (!tenantId || !userId) {
      setSaveState({ type: 'error', message: 'Not authenticated. Please refresh and try again.' })
      return
    }

    // Step 1: Geocode
    setSaveState({ type: 'geocoding' })
    const geocodeResult = await geocodeAddressViaEdge(addressInput.trim())

    if (!geocodeResult) {
      setSaveState({
        type: 'error',
        message: 'Could not find that address. Check spelling and try again.',
      })
      return
    }

    // Step 2: Save to tenant_settings
    setSaveState({ type: 'saving' })
    const homeBaseData: HomeBaseData = {
      address: addressInput.trim(),
      lat: geocodeResult.lat,
      lng: geocodeResult.lng,
      formatted_address: geocodeResult.formatted_address,
      geocoded_at: new Date().toISOString(),
    }

    try {
      await saveHomeBase(tenantId, userId, homeBaseData)
      setSavedHomeBase(homeBaseData)
      setIsEditing(false)
    } catch (err: any) {
      setSaveState({ type: 'error', message: err.message || 'Failed to save home base.' })
      return
    }

    // Step 3: Trigger backfill
    setSaveState({ type: 'backfilling', processed: 0, total: 99 })
    try {
      const backfillResult = await triggerGeocodingBackfill(tenantId)
      const msg =
        backfillResult.remaining > 0
          ? `Geocoded ${backfillResult.succeeded} leads. ${backfillResult.remaining} remaining — re-run geocoding to process them.`
          : `All ${backfillResult.succeeded} leads geocoded successfully. Distance now available.`
      setSaveState({ type: 'success', message: msg })
    } catch {
      setSaveState({
        type: 'success',
        message: 'Home base saved. Run "Re-run geocoding" to update distances.',
      })
    }
  }

  const handleRerunGeocoding = async () => {
    if (!tenantId) return
    setSaveState({ type: 'backfilling', processed: 0, total: 99 })
    try {
      const result = await triggerGeocodingBackfill(tenantId)
      const msg =
        result.remaining > 0
          ? `Processed ${result.processed} leads (${result.succeeded} succeeded). ${result.remaining} remaining.`
          : `Done! ${result.succeeded} leads geocoded.`
      setSaveState({ type: 'success', message: msg })
    } catch (err: any) {
      setSaveState({ type: 'error', message: err.message || 'Backfill failed.' })
    }
  }

  const inputClass =
    'w-full px-3 py-2 bg-gray-800 text-gray-100 text-sm rounded border border-gray-700 ' +
    'focus:outline-none focus:border-emerald-500 placeholder-gray-500'

  const isBusy =
    saveState.type === 'geocoding' ||
    saveState.type === 'saving' ||
    saveState.type === 'backfilling'

  if (isLoadingData) {
    return (
      <div className="flex items-center gap-2 text-gray-500 text-sm py-4">
        <Loader size={14} className="animate-spin" />
        Loading home base...
      </div>
    )
  }

  return (
    <div
      className="rounded-xl border overflow-hidden"
      style={{ borderColor: '#1e2128', backgroundColor: '#0d0e14' }}
    >
      {/* Card header */}
      <div
        className="flex items-center gap-2 px-5 py-3 border-b"
        style={{ borderColor: '#1e2128', backgroundColor: '#11121a' }}
      >
        <MapPin size={14} className="text-emerald-500" />
        <span className="text-sm font-semibold text-gray-200">HUNTER Home Base</span>
      </div>

      <div className="px-5 py-5 flex flex-col gap-4">
        {/* Description */}
        <p className="text-xs text-gray-500 leading-relaxed">
          Set your shop address. All HUNTER leads will display distance from this location.
          Distance is calculated via the Haversine formula (straight line) — drive times are
          estimated using a 35 mph average for the Coachella Valley.
        </p>

        {/* Current saved address display */}
        {savedHomeBase && !isEditing && (
          <div
            className="flex items-start justify-between gap-3 p-3 rounded-lg"
            style={{ backgroundColor: '#0f1018', border: '1px solid #1e2128' }}
          >
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <CheckCircle size={13} className="text-emerald-500 shrink-0" />
                <span className="text-sm font-medium text-gray-200 leading-tight">
                  {savedHomeBase.formatted_address || savedHomeBase.address}
                </span>
              </div>
              <div className="flex items-center gap-3 ml-5 text-xs text-gray-600">
                <span>{savedHomeBase.lat.toFixed(5)}°N</span>
                <span>{savedHomeBase.lng.toFixed(5)}°W</span>
              </div>
              {savedHomeBase.geocoded_at && (
                <div className="ml-5 text-xs text-gray-600">
                  Last geocoded:{' '}
                  {new Date(savedHomeBase.geocoded_at).toLocaleString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    hour: 'numeric',
                    minute: '2-digit',
                  })}
                </div>
              )}
            </div>
            <button
              onClick={() => {
                setIsEditing(true)
                setSaveState({ type: 'idle' })
              }}
              className="shrink-0 p-1.5 text-gray-500 hover:text-gray-200 transition-colors"
              title="Edit home base address"
            >
              <Edit2 size={14} />
            </button>
          </div>
        )}

        {/* Address input form */}
        {(!savedHomeBase || isEditing) && (
          <div className="flex flex-col gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-300 mb-1">
                Shop Address
              </label>
              <input
                type="text"
                value={addressInput}
                onChange={(e) => setAddressInput(e.target.value)}
                placeholder="e.g. 1234 Monroe St, Indio, CA 92201"
                className={inputClass}
                disabled={isBusy}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !isBusy && addressInput.trim()) {
                    handleSave()
                  }
                }}
              />
              <p className="mt-1 text-xs text-gray-600">
                Enter your full business address including city and ZIP for best accuracy.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={handleSave}
                disabled={isBusy || !addressInput.trim()}
                className={
                  'flex items-center gap-2 px-4 py-2 text-sm rounded transition-colors ' +
                  (isBusy || !addressInput.trim()
                    ? 'bg-emerald-900 text-gray-500 cursor-not-allowed'
                    : 'bg-emerald-600 hover:bg-emerald-700 text-white')
                }
              >
                {isBusy ? (
                  <Loader size={14} className="animate-spin" />
                ) : (
                  <Save size={14} />
                )}
                {saveState.type === 'geocoding' && 'Finding address...'}
                {saveState.type === 'saving' && 'Saving...'}
                {saveState.type === 'backfilling' && 'Geocoding leads...'}
                {saveState.type === 'idle' && 'Save & Geocode Leads'}
                {saveState.type === 'success' && 'Save & Geocode Leads'}
                {saveState.type === 'error' && 'Retry'}
              </button>

              {isEditing && (
                <button
                  onClick={() => {
                    setIsEditing(false)
                    setAddressInput(savedHomeBase?.address || '')
                    setSaveState({ type: 'idle' })
                  }}
                  disabled={isBusy}
                  className="px-3 py-2 text-sm text-gray-400 hover:text-gray-200 transition-colors"
                >
                  Cancel
                </button>
              )}
            </div>
          </div>
        )}

        {/* Status messages */}
        {saveState.type === 'success' && (
          <div className="flex items-start gap-2 p-3 bg-emerald-950 border border-emerald-800 rounded text-xs text-emerald-200">
            <CheckCircle size={13} className="shrink-0 mt-0.5" />
            <span>{saveState.message}</span>
          </div>
        )}

        {saveState.type === 'error' && (
          <div className="flex items-start gap-2 p-3 bg-red-950 border border-red-800 rounded text-xs text-red-200">
            <AlertCircle size={13} className="shrink-0 mt-0.5" />
            <span>{saveState.message}</span>
          </div>
        )}

        {saveState.type === 'backfilling' && (
          <div className="flex items-center gap-2 text-xs text-blue-300">
            <Loader size={12} className="animate-spin" />
            Processing existing leads...
          </div>
        )}

        {/* Re-run geocoding button (shown when home base is saved) */}
        {savedHomeBase && !isEditing && (
          <div className="flex items-center justify-between pt-1 border-t border-gray-800">
            <div className="flex flex-col gap-0.5">
              <span className="text-xs font-medium text-gray-300">Re-run geocoding</span>
              <span className="text-xs text-gray-600">
                Geocode all pending/failed leads using current home base.
              </span>
            </div>
            <button
              onClick={handleRerunGeocoding}
              disabled={isBusy}
              className={
                'flex items-center gap-2 px-3 py-1.5 text-xs rounded transition-colors shrink-0 ' +
                (isBusy
                  ? 'bg-gray-800 text-gray-600 cursor-not-allowed'
                  : 'bg-gray-800 hover:bg-gray-700 text-gray-300 border border-gray-700')
              }
            >
              {isBusy ? (
                <Loader size={12} className="animate-spin" />
              ) : (
                <RotateCcw size={12} />
              )}
              {isBusy ? 'Running...' : 'Re-run Geocoding'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

export default HomeBaseSettings
