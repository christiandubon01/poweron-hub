/**
 * SettingsPanel.tsx — NW17: Collapsible settings panel (gear icon) in the HUD.
 *
 * Settings persisted to localStorage via NWSettings.
 * Changes dispatched via 'nw:settings-change' CustomEvent so CameraController
 * picks them up without a prop chain.
 *
 * Panel contents:
 *   - Movement sensitivity slider (0.1 – 3.0, default 1.0)
 *   - Mouse / look sensitivity slider (0.1 – 3.0, default 1.0)
 *   - Invert mouse Y toggle (default off)
 *   - Travel speed range slider (0.5 – 10.0, default 2.0)
 *   - Current speed display (read-only)
 *   - Camera mode selector
 *   - Third person distance selector
 *   - NW17: Touch sensitivity multiplier (0.1 – 3.0, default 1.5) — touch only
 *   - NW17: Touch dead zone (5% – 25%, default 15%) — touch only
 */

import React, { useState, useEffect, useCallback, useRef } from 'react'
import {
  NWCameraSettings,
  loadNWCameraSettings,
  saveNWCameraSettings,
} from './NWSettings'
import { CameraMode } from './CameraController'

interface SettingsPanelProps {
  cameraMode: CameraMode
  onCameraModeChange: (mode: CameraMode) => void
}

const PANEL_W = 260

// NW17: Detect touch device to show touch-specific settings
const isTouchDevice = typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0

export function SettingsPanel({ cameraMode, onCameraModeChange }: SettingsPanelProps) {
  const [open, setOpen]       = useState(false)
  const [settings, setSettings] = useState<NWCameraSettings>(() => loadNWCameraSettings())
  const [liveSpeed, setLiveSpeed] = useState(settings.travelSpeed)
  // NW27b: Live FPS for render distance tuning
  const [liveFps, setLiveFps] = useState(60)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Track live travel speed from CameraController scroll events
  useEffect(() => {
    function onTravelSpeed(e: Event) {
      const ev = e as CustomEvent<{ speed: number }>
      if (ev.detail?.speed !== undefined) {
        setLiveSpeed(ev.detail.speed)
        setSettings(prev => ({ ...prev, travelSpeed: ev.detail.speed }))
      }
    }
    function onTpDist(e: Event) {
      const ev = e as CustomEvent<{ key: 'CLOSE' | 'MEDIUM' | 'FAR' }>
      if (ev.detail?.key) {
        setSettings(prev => ({ ...prev, tpDistance: ev.detail.key }))
      }
    }
    // NW27b: Track FPS from nw:frame events for render distance display
    let fpsCount = 0
    let fpsLast = performance.now()
    function onFrame() {
      fpsCount++
      const now = performance.now()
      if (now - fpsLast >= 1000) {
        setLiveFps(Math.round(fpsCount * 1000 / (now - fpsLast)))
        fpsCount = 0
        fpsLast = now
      }
    }
    window.addEventListener('nw:travel-speed', onTravelSpeed)
    window.addEventListener('nw:tp-distance', onTpDist)
    window.addEventListener('nw:frame', onFrame)
    return () => {
      window.removeEventListener('nw:travel-speed', onTravelSpeed)
      window.removeEventListener('nw:tp-distance', onTpDist)
      window.removeEventListener('nw:frame', onFrame)
    }
  }, [])

  const applyChange = useCallback((patch: Partial<NWCameraSettings>) => {
    setSettings(prev => {
      const next = { ...prev, ...patch }
      // Debounced save
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
      saveTimerRef.current = setTimeout(() => saveNWCameraSettings(next), 400)
      // Broadcast to CameraController
      window.dispatchEvent(new CustomEvent('nw:settings-change', { detail: patch }))
      return next
    })
    if (patch.travelSpeed !== undefined) setLiveSpeed(patch.travelSpeed)
  }, [])

  const s = settings

  return (
    <div style={{
      position: 'absolute',
      bottom: 60,
      right: 14,
      zIndex: 28,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'flex-end',
      gap: 4,
    }}>
      {/* Gear toggle button — NW17: min 44×44px for Apple HIG touch target */}
      <button
        onClick={() => setOpen(o => !o)}
        title="Camera Settings"
        style={{
          width: isTouchDevice ? 48 : 34,
          height: isTouchDevice ? 48 : 34,
          minWidth: 44,
          minHeight: 44,
          borderRadius: 8,
          border: `1px solid ${open ? 'rgba(0,229,204,0.6)' : 'rgba(255,255,255,0.15)'}`,
          background: open ? 'rgba(0,229,204,0.15)' : 'rgba(0,0,0,0.6)',
          color: open ? '#00e5cc' : 'rgba(255,255,255,0.55)',
          fontSize: isTouchDevice ? 20 : 17,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backdropFilter: 'blur(6px)',
          transition: 'all 0.15s',
          lineHeight: 1,
          touchAction: 'none',
          userSelect: 'none',
        }}
      >
        ⚙
      </button>

      {/* Settings panel */}
      {open && (
        <div style={{
          background: 'rgba(5,5,15,0.92)',
          border: '1px solid rgba(0,229,204,0.25)',
          borderRadius: 8,
          padding: '12px 14px',
          width: PANEL_W,
          backdropFilter: 'blur(10px)',
          fontFamily: 'monospace',
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
        }}>
          {/* Header */}
          <div style={{
            color: '#00e5cc',
            fontSize: 9,
            letterSpacing: 2,
            marginBottom: 2,
            fontWeight: 700,
          }}>
            ◈ CAMERA SETTINGS
          </div>

          {/* Movement Sensitivity */}
          <SliderRow
            label="MOVE SENSITIVITY"
            value={s.moveSensitivity}
            min={0.1} max={3.0} step={0.05}
            display={s.moveSensitivity.toFixed(2)}
            onChange={v => applyChange({ moveSensitivity: v })}
          />

          {/* Mouse Sensitivity */}
          <SliderRow
            label="LOOK SENSITIVITY"
            value={s.lookSensitivity}
            min={0.1} max={3.0} step={0.05}
            display={s.lookSensitivity.toFixed(2)}
            onChange={v => applyChange({ lookSensitivity: v })}
          />

          {/* Invert Y */}
          <ToggleRow
            label="INVERT MOUSE Y"
            value={s.invertY}
            onChange={v => applyChange({ invertY: v })}
          />

          {/* NW20: Invert View Y — separate from movement invert */}
          <ToggleRow
            label="INVERT VIEW (VERTICAL)"
            value={s.invertViewY ?? false}
            onChange={v => applyChange({ invertViewY: v })}
          />

          {/* Travel Speed (NW19: max raised to 15.0) */}
          <SliderRow
            label="TRAVEL SPEED"
            value={s.travelSpeed}
            min={0.5} max={15.0} step={0.5}
            display={`${s.travelSpeed.toFixed(1)} u/s`}
            onChange={v => applyChange({ travelSpeed: v })}
          />

          {/* Current Speed (read-only) */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ color: 'rgba(255,255,255,0.45)', fontSize: 9, letterSpacing: 1 }}>
              CURRENT SPEED
            </span>
            <span style={{ color: '#00e5cc', fontSize: 10, letterSpacing: 1 }}>
              {liveSpeed.toFixed(1)} u/s
            </span>
          </div>

          <Divider />

          {/* Camera Mode */}
          <div>
            <div style={{ color: 'rgba(255,255,255,0.45)', fontSize: 9, letterSpacing: 1, marginBottom: 5 }}>
              CAMERA MODE
            </div>
            <div style={{ display: 'flex', gap: 4 }}>
              {([CameraMode.ORBIT, CameraMode.FIRST_PERSON, CameraMode.THIRD_PERSON] as const).map(m => {
                const labels: Record<string, string> = {
                  ORBIT: 'ORBIT', FIRST_PERSON: '1P', THIRD_PERSON: '3P',
                }
                const active = cameraMode === m
                return (
                  <button key={m} onClick={() => onCameraModeChange(m)} style={{
                    flex: 1,
                    padding: '4px 0',
                    fontSize: 9,
                    letterSpacing: 1,
                    borderRadius: 4,
                    border: `1px solid ${active ? 'rgba(0,229,204,0.6)' : 'rgba(255,255,255,0.15)'}`,
                    background: active ? 'rgba(0,229,204,0.2)' : 'transparent',
                    color: active ? '#00e5cc' : 'rgba(255,255,255,0.45)',
                    cursor: 'pointer',
                    transition: 'all 0.12s',
                  }}>
                    {labels[m]}
                  </button>
                )
              })}
            </div>
          </div>

          {/* 3P Distance */}
          <div>
            <div style={{ color: 'rgba(255,255,255,0.45)', fontSize: 9, letterSpacing: 1, marginBottom: 5 }}>
              3P DISTANCE
            </div>
            <div style={{ display: 'flex', gap: 4 }}>
              {(['CLOSE', 'MEDIUM', 'FAR'] as const).map(d => {
                const labels = { CLOSE: 'CLOSE (10)', MEDIUM: 'MED (25)', FAR: 'FAR (100)' }
                const active = s.tpDistance === d
                return (
                  <button key={d} onClick={() => applyChange({ tpDistance: d })} style={{
                    flex: 1,
                    padding: '4px 0',
                    fontSize: 8,
                    letterSpacing: 0.8,
                    borderRadius: 4,
                    border: `1px solid ${active ? 'rgba(0,229,204,0.6)' : 'rgba(255,255,255,0.15)'}`,
                    background: active ? 'rgba(0,229,204,0.2)' : 'transparent',
                    color: active ? '#00e5cc' : 'rgba(255,255,255,0.45)',
                    cursor: 'pointer',
                    transition: 'all 0.12s',
                  }}>
                    {labels[d]}
                  </button>
                )
              })}
            </div>
          </div>

          {/* ── NW17: Touch-specific settings ── */}
          {isTouchDevice && (
            <>
              <Divider />

              <div style={{
                color: '#ff8840',
                fontSize: 9,
                letterSpacing: 2,
                marginBottom: 2,
                fontWeight: 700,
              }}>
                ◈ TOUCH CONTROLS
              </div>

              {/* Touch Sensitivity Multiplier */}
              <SliderRow
                label="TOUCH SENSITIVITY"
                value={s.touchSensitivity ?? 1.5}
                min={0.1} max={3.0} step={0.05}
                display={(s.touchSensitivity ?? 1.5).toFixed(2) + 'x'}
                onChange={v => applyChange({ touchSensitivity: v })}
                touchFriendly
              />

              {/* Touch Dead Zone */}
              <SliderRow
                label="DEAD ZONE"
                value={s.touchDeadZone ?? 0.15}
                min={0.05} max={0.25} step={0.01}
                display={Math.round((s.touchDeadZone ?? 0.15) * 100) + '%'}
                onChange={v => applyChange({ touchDeadZone: v })}
                touchFriendly
              />
            </>
          )}

          <Divider />

          {/* ── NW27b: Render Distance ── */}
          <div style={{
            color: '#00e5cc',
            fontSize: 9,
            letterSpacing: 2,
            marginBottom: 2,
            fontWeight: 700,
          }}>
            ◈ RENDER DISTANCE
          </div>

          {/* Render Distance slider */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ color: 'rgba(255,255,255,0.45)', fontSize: 9, letterSpacing: 1 }}>RENDER DIST</span>
              <span style={{ color: '#00e5cc', fontSize: 9, letterSpacing: 1 }}>
                {(s.renderDistance ?? 300).toFixed(0)} u
                <span style={{
                  marginLeft: 6,
                  color: liveFps < 30 ? '#ff4444' : liveFps < 50 ? '#ffaa00' : 'rgba(255,255,255,0.35)',
                  fontSize: 8,
                }}>
                  {liveFps} FPS
                </span>
              </span>
            </div>
            <input
              type="range"
              min={50}
              max={500}
              step={25}
              value={s.renderDistance ?? 300}
              onChange={e => applyChange({ renderDistance: parseFloat(e.target.value) })}
              style={{ width: '100%', accentColor: '#00e5cc', cursor: 'pointer' }}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 3 }}>
              <span style={{ color: 'rgba(255,255,255,0.2)', fontSize: 7, letterSpacing: 0.5 }}>50 (fast)</span>
              <span style={{ color: 'rgba(255,255,255,0.2)', fontSize: 7, letterSpacing: 0.5 }}>500 (full world)</span>
            </div>
          </div>

          {/* Hint */}
          <div style={{ color: 'rgba(255,255,255,0.25)', fontSize: 8, letterSpacing: 0.8, lineHeight: 1.5, marginTop: 2 }}>
            1P/3P: Scroll = speed · Shift = toggle sprint<br/>
            3P: 1/2/3 = distance preset · Max speed: 15
            {isTouchDevice && (
              <><br/>Touch: ↑↓ ascend/descend · SPRINT toggle</>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

function SliderRow({
  label, value, min, max, step, display, onChange, touchFriendly = false,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  display: string
  onChange: (v: number) => void
  touchFriendly?: boolean
}) {
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
        <span style={{ color: 'rgba(255,255,255,0.45)', fontSize: 9, letterSpacing: 1 }}>{label}</span>
        <span style={{ color: '#00e5cc', fontSize: 9, letterSpacing: 1 }}>{display}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        style={{
          width: '100%',
          accentColor: '#00e5cc',
          cursor: 'pointer',
          height: touchFriendly ? 24 : undefined,
        }}
      />
    </div>
  )
}

function ToggleRow({
  label, value, onChange,
}: {
  label: string
  value: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <span style={{ color: 'rgba(255,255,255,0.45)', fontSize: 9, letterSpacing: 1 }}>{label}</span>
      <button
        onClick={() => onChange(!value)}
        style={{
          width: 38,
          height: 18,
          borderRadius: 9,
          border: 'none',
          background: value ? '#00e5cc' : 'rgba(255,255,255,0.15)',
          position: 'relative',
          cursor: 'pointer',
          transition: 'background 0.2s',
        }}
      >
        <div style={{
          position: 'absolute',
          top: 2,
          left: value ? 20 : 2,
          width: 14,
          height: 14,
          borderRadius: '50%',
          background: value ? '#050508' : 'rgba(255,255,255,0.5)',
          transition: 'left 0.2s',
        }} />
      </button>
    </div>
  )
}

function Divider() {
  return (
    <div style={{ height: 1, background: 'rgba(255,255,255,0.08)', margin: '2px 0' }} />
  )
}
