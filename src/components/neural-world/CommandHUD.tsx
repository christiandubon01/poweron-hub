/**
 * CommandHUD.tsx — NW7: Full command surface HUD for Neural World.
 *
 * Layout:
 *   top-left    : "PowerOn Neural World" title + LIVE DATA badge
 *   top-right   : Atmosphere mode switcher (6 buttons) + FPS counter
 *   bottom-center: Camera mode (1P / 3P / CIN) buttons + speed indicator
 *   left-side   : Layer toggle panel — 10 layers with icon + label + on/off state
 *
 * Also renders:
 *   - Crosshair overlay in first-person mode
 *   - Letterbox bars in cinematic mode
 *   - Data shadow floating panel near player (fades after 2 s)
 *
 * Layer defaults: Pressure + Risk Surface ON, all others OFF.
 * Active layer state persisted to neural_world_settings on change.
 * FPS counter: top-right, dim, small. Graceful degradation hint at <30 fps.
 */

import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
} from 'react'
import { supabase } from '@/lib/supabase'
import { subscribeWorldData, type NWWorldData, type NWProject } from './DataBridge'

// ── Enum mirrors (must match AtmosphereManager / CameraController) ────────────

export enum AtmosphereMode {
  MOJAVE            = 'MOJAVE',
  OCEAN             = 'OCEAN',
  COASTAL_FOG       = 'COASTAL_FOG',
  SCIFI_V1          = 'SCIFI_V1',
  SCIFI_V2_SUBSTRATE = 'SCIFI_V2_SUBSTRATE',
  RESERVED          = 'RESERVED',
}

export enum CameraMode {
  FIRST_PERSON = 'FIRST_PERSON',
  THIRD_PERSON = 'THIRD_PERSON',
  CINEMATIC    = 'CINEMATIC',
}

// ── Layer Definitions ─────────────────────────────────────────────────────────

interface LayerDef {
  id:    string
  label: string
  icon:  string
  r: number; g: number; b: number
}

const LAYERS: LayerDef[] = [
  { id: 'pulse',           label: 'Pulse',           icon: '◎',  r: 0,   g: 200, b: 255 },
  { id: 'pressure',        label: 'Pressure',        icon: '▣',  r: 255, g: 120, b: 0   },
  { id: 'critical-path',   label: 'Critical Path',   icon: '◈',  r: 64,  g: 192, b: 160 },
  { id: 'agents',          label: 'Agents',          icon: '◆',  r: 192, g: 160, b: 32  },
  { id: 'decision-gravity',label: 'Decision Gravity',icon: '◉',  r: 160, g: 120, b: 220 },
  { id: 'velocity',        label: 'Velocity',        icon: '▷',  r: 0,   g: 255, b: 120 },
  { id: 'risk-surface',    label: 'Risk Surface',    icon: '⬡',  r: 255, g: 60,  b: 60  },
  { id: 'signal',          label: 'Signal',          icon: '∿',  r: 80,  g: 200, b: 255 },
  { id: 'forecast',        label: 'Forecast',        icon: '◐',  r: 200, g: 160, b: 255 },
  { id: 'command',         label: 'Command',         icon: '⊕',  r: 255, g: 238, b: 0   },
]

// Default on: pressure + risk-surface
const DEFAULT_LAYER_STATES: Record<string, boolean> = Object.fromEntries(
  LAYERS.map(l => [l.id, l.id === 'pressure' || l.id === 'risk-surface'])
)

const ATMO_LABELS: Record<AtmosphereMode, string> = {
  [AtmosphereMode.MOJAVE]:             'MOJAVE',
  [AtmosphereMode.OCEAN]:              'OCEAN',
  [AtmosphereMode.COASTAL_FOG]:        'COASTAL FOG',
  [AtmosphereMode.SCIFI_V1]:           'SCI-FI V1',
  [AtmosphereMode.SCIFI_V2_SUBSTRATE]: 'SCI-FI V2',
  [AtmosphereMode.RESERVED]:          'ALT',
}

// ── Exported state type for parent to consume ─────────────────────────────────

export type LayerStates = Record<string, boolean>

interface DataShadowEntry {
  project: NWProject
  x: number
  y: number
  expiresAt: number
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface CommandHUDProps {
  layerStates: LayerStates
  onLayerToggle: (id: string, value: boolean) => void
  cameraMode: CameraMode
  onCameraModeChange: (mode: CameraMode) => void
  atmosphereMode: AtmosphereMode
  onAtmosphereModeChange: (mode: AtmosphereMode) => void
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function CommandHUD({
  layerStates,
  onLayerToggle,
  cameraMode,
  onCameraModeChange,
  atmosphereMode,
  onAtmosphereModeChange,
}: CommandHUDProps) {

  // FPS counter
  const [fps, setFps] = useState<number>(60)
  const fpsFrameCountRef = useRef<number>(0)
  const fpsLastTimeRef   = useRef<number>(performance.now())

  // Speed indicator
  const [speed, setSpeed] = useState<number>(0)

  // Data shadow
  const [dataShadow, setDataShadow] = useState<DataShadowEntry | null>(null)
  const shadowTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const worldDataRef   = useRef<NWWorldData | null>(null)

  // ── FPS counter via nw:frame events ────────────────────────────────────────
  useEffect(() => {
    function onFrame() {
      fpsFrameCountRef.current += 1
      const now = performance.now()
      const elapsed = now - fpsLastTimeRef.current
      if (elapsed >= 1000) {
        setFps(Math.round(fpsFrameCountRef.current * 1000 / elapsed))
        fpsFrameCountRef.current = 0
        fpsLastTimeRef.current = now
      }
    }
    window.addEventListener('nw:frame', onFrame)
    return () => window.removeEventListener('nw:frame', onFrame)
  }, [])

  // ── Speed from CameraController ────────────────────────────────────────────
  useEffect(() => {
    function onSpeed(e: Event) {
      const ev = e as CustomEvent<{ speed: number }>
      setSpeed(ev.detail?.speed ?? 0)
    }
    window.addEventListener('nw:player-speed', onSpeed)
    return () => window.removeEventListener('nw:player-speed', onSpeed)
  }, [])

  // ── Sync atmosphere/camera modes from WorldEngine init load ───────────────
  useEffect(() => {
    function onModeInit(e: Event) {
      const ev = e as CustomEvent<{ atmosphereMode: string; cameraMode: string }>
      if (ev.detail?.atmosphereMode &&
          Object.values(AtmosphereMode).includes(ev.detail.atmosphereMode as AtmosphereMode)) {
        onAtmosphereModeChange(ev.detail.atmosphereMode as AtmosphereMode)
      }
      if (ev.detail?.cameraMode &&
          Object.values(CameraMode).includes(ev.detail.cameraMode as CameraMode)) {
        onCameraModeChange(ev.detail.cameraMode as CameraMode)
      }
    }
    window.addEventListener('nw:mode-init', onModeInit)
    return () => window.removeEventListener('nw:mode-init', onModeInit)
  }, [onAtmosphereModeChange, onCameraModeChange])

  // ── Subscribe to world data for data shadow ────────────────────────────────
  useEffect(() => {
    const unsub = subscribeWorldData((data: NWWorldData) => {
      worldDataRef.current = data
    })
    return unsub
  }, [])

  // ── Data shadow: mouse move over canvas ────────────────────────────────────
  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const data = worldDataRef.current
    if (!data || data.projects.length === 0) return

    // Show data for a random nearby project (simplified — no raycasting)
    const now = Date.now()
    if (dataShadow && dataShadow.expiresAt > now + 1800) return  // throttle

    const project = data.projects[Math.floor(Math.random() * Math.min(data.projects.length, 8))]
    if (shadowTimerRef.current) clearTimeout(shadowTimerRef.current)

    setDataShadow({ project, x: e.clientX, y: e.clientY, expiresAt: now + 2000 })
    shadowTimerRef.current = setTimeout(() => setDataShadow(null), 2000)
  }, [dataShadow])

  // ── Persist layer state to Supabase ───────────────────────────────────────
  const saveLayerStateRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (saveLayerStateRef.current) clearTimeout(saveLayerStateRef.current)
    saveLayerStateRef.current = setTimeout(async () => {
      try {
        const { data: { user } } = await (supabase as any).auth.getUser()
        if (!user) return
        const { data: profile } = await (supabase as any)
          .from('profiles')
          .select('org_id')
          .eq('id', user.id)
          .maybeSingle()
        const orgId: string | null = profile?.org_id ?? null
        if (!orgId) return
        await (supabase as any)
          .from('neural_world_settings')
          .upsert(
            { org_id: orgId, active_layers: layerStates },
            { onConflict: 'org_id' }
          )
      } catch {
        // Non-blocking
      }
    }, 1200)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(layerStates)])

  // ── Helpers ────────────────────────────────────────────────────────────────

  const fpsColor = fps < 30
    ? '#ff4444'
    : fps < 50
    ? '#ffaa00'
    : 'rgba(255,255,255,0.25)'

  const activeLayerCount = Object.values(layerStates).filter(Boolean).length

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <>
      {/* ── CINEMATIC LETTERBOX BARS ────────────────────────────────────── */}
      {cameraMode === CameraMode.CINEMATIC && (
        <>
          <div style={{
            position: 'absolute', top: 0, left: 0, right: 0,
            height: 60,
            background: 'rgba(0,0,0,0.88)',
            zIndex: 30,
            pointerEvents: 'none',
          }} />
          <div style={{
            position: 'absolute', bottom: 0, left: 0, right: 0,
            height: 60,
            background: 'rgba(0,0,0,0.88)',
            zIndex: 30,
            pointerEvents: 'none',
          }} />
        </>
      )}

      {/* ── CROSSHAIR (first-person) ────────────────────────────────────── */}
      {cameraMode === CameraMode.FIRST_PERSON && (
        <div
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            zIndex: 20,
            pointerEvents: 'none',
          }}
        >
          {/* Horizontal bar */}
          <div style={{
            position: 'absolute',
            width: 14,
            height: 1.5,
            background: 'rgba(255,255,255,0.55)',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
          }} />
          {/* Vertical bar */}
          <div style={{
            position: 'absolute',
            width: 1.5,
            height: 14,
            background: 'rgba(255,255,255,0.55)',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
          }} />
          {/* Center dot */}
          <div style={{
            position: 'absolute',
            width: 3,
            height: 3,
            background: '#00ff88',
            borderRadius: '50%',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
          }} />
        </div>
      )}

      {/* ── TOP-LEFT: TITLE + LIVE BADGE ──────────────────────────────────── */}
      <div
        style={{
          position: 'absolute',
          top: 14,
          left: 14,
          zIndex: 25,
          pointerEvents: 'none',
        }}
      >
        <div style={{
          color: '#00ff88',
          fontSize: 13,
          fontFamily: 'monospace',
          fontWeight: 700,
          letterSpacing: 2.5,
          textTransform: 'uppercase',
          textShadow: '0 0 8px rgba(0,255,136,0.4)',
        }}>
          PowerOn Neural World
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
          <div style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: '#00ff88',
            boxShadow: '0 0 6px #00ff88',
            animation: 'nw-blink 1.8s ease infinite',
          }} />
          <span style={{
            color: '#00ff88',
            fontSize: 9,
            fontFamily: 'monospace',
            letterSpacing: 2,
            opacity: 0.75,
          }}>
            LIVE DATA
          </span>
          {activeLayerCount > 0 && (
            <span style={{
              color: 'rgba(255,255,255,0.35)',
              fontSize: 9,
              fontFamily: 'monospace',
              letterSpacing: 1,
            }}>
              · {activeLayerCount} LAYER{activeLayerCount !== 1 ? 'S' : ''} ACTIVE
            </span>
          )}
        </div>
      </div>

      {/* ── TOP-RIGHT: ATMOSPHERE SWITCHER + FPS ─────────────────────────── */}
      <div
        style={{
          position: 'absolute',
          top: 12,
          right: 12,
          zIndex: 25,
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
          alignItems: 'flex-end',
        }}
      >
        {/* FPS counter */}
        <div style={{
          color: fpsColor,
          fontSize: 9,
          fontFamily: 'monospace',
          letterSpacing: 1,
          marginBottom: 2,
          transition: 'color 0.4s',
        }}>
          {fps} FPS
          {fps < 30 && (
            <span style={{ marginLeft: 6, opacity: 0.7 }}>⚠ DEGRADED</span>
          )}
        </div>

        {/* Atmosphere panel */}
        <div style={{
          background: 'rgba(0,0,0,0.65)',
          border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: 6,
          padding: '7px 8px',
          backdropFilter: 'blur(6px)',
          display: 'flex',
          flexDirection: 'column',
          gap: 3,
          minWidth: 120,
        }}>
          <div style={{
            color: 'rgba(255,255,255,0.4)',
            fontSize: 8,
            letterSpacing: 1.5,
            fontFamily: 'monospace',
            marginBottom: 2,
          }}>
            ATMOSPHERE
          </div>
          {(Object.values(AtmosphereMode) as AtmosphereMode[]).map(mode => {
            const isActive = mode === atmosphereMode
            return (
              <button
                key={mode}
                onClick={() => {
                  onAtmosphereModeChange(mode)
                  window.dispatchEvent(new CustomEvent('nw:request-atmosphere-mode', { detail: { mode } }))
                }}
                style={{
                  padding: '3px 9px',
                  fontSize: 9,
                  fontWeight: isActive ? 700 : 400,
                  letterSpacing: 0.5,
                  borderRadius: 3,
                  border: isActive
                    ? '1px solid rgba(0,255,136,0.8)'
                    : '1px solid rgba(255,255,255,0.08)',
                  background: isActive
                    ? 'rgba(0,255,136,0.12)'
                    : 'rgba(255,255,255,0.03)',
                  color: isActive ? '#00ff88' : 'rgba(255,255,255,0.45)',
                  cursor: 'pointer',
                  textAlign: 'left',
                  transition: 'all 0.12s',
                  fontFamily: 'monospace',
                  whiteSpace: 'nowrap',
                }}
              >
                {ATMO_LABELS[mode]}
              </button>
            )
          })}
        </div>
      </div>

      {/* ── LEFT-SIDE: LAYER TOGGLE PANEL ─────────────────────────────────── */}
      <div
        style={{
          position: 'absolute',
          top: '50%',
          left: 12,
          transform: 'translateY(-50%)',
          zIndex: 25,
          display: 'flex',
          flexDirection: 'column',
          gap: 3,
          background: 'rgba(0,0,0,0.6)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 8,
          padding: '10px 8px',
          backdropFilter: 'blur(8px)',
          minWidth: 148,
        }}
      >
        <div style={{
          color: 'rgba(255,255,255,0.35)',
          fontSize: 8,
          letterSpacing: 1.5,
          fontFamily: 'monospace',
          marginBottom: 4,
          textAlign: 'center',
        }}>
          LAYERS
        </div>

        {LAYERS.map(layer => {
          const isOn = !!layerStates[layer.id]
          const { r, g, b } = layer
          return (
            <button
              key={layer.id}
              onClick={() => onLayerToggle(layer.id, !isOn)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 7,
                padding: '5px 8px',
                borderRadius: 4,
                border: `1px solid ${isOn ? `rgba(${r},${g},${b},0.7)` : 'rgba(255,255,255,0.07)'}`,
                background: isOn
                  ? `rgba(${r},${g},${b},0.12)`
                  : 'rgba(255,255,255,0.02)',
                color: isOn ? `rgb(${r},${g},${b})` : 'rgba(255,255,255,0.28)',
                cursor: 'pointer',
                transition: 'all 0.15s',
                fontFamily: 'monospace',
                fontSize: 10,
                textAlign: 'left',
                width: '100%',
                letterSpacing: 0.3,
              }}
            >
              <span style={{ fontSize: 12, lineHeight: 1, minWidth: 14 }}>{layer.icon}</span>
              <span style={{ flex: 1 }}>{layer.label}</span>
              <span style={{
                fontSize: 8,
                letterSpacing: 0.5,
                opacity: 0.7,
                color: isOn ? `rgb(${r},${g},${b})` : 'rgba(255,255,255,0.2)',
              }}>
                {isOn ? 'ON' : 'OFF'}
              </span>
            </button>
          )
        })}
      </div>

      {/* ── BOTTOM-CENTER: CAMERA MODE + SPEED ───────────────────────────── */}
      <div
        style={{
          position: 'absolute',
          bottom: 14,
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 25,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 5,
        }}
      >
        {/* Speed indicator */}
        <div style={{
          color: 'rgba(255,255,255,0.3)',
          fontSize: 9,
          fontFamily: 'monospace',
          letterSpacing: 1.5,
          display: speed > 0.01 ? 'block' : 'none',
        }}>
          {speed > 0.4 ? 'SPRINT' : speed > 0.05 ? 'WALK' : ''} ·{' '}
          {(speed * 10).toFixed(1)} U/S
        </div>

        {/* Camera mode buttons */}
        <div style={{
          display: 'flex',
          gap: 3,
          background: 'rgba(0,0,0,0.6)',
          border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: 20,
          padding: '5px 8px',
          backdropFilter: 'blur(6px)',
        }}>
          {([
            [CameraMode.FIRST_PERSON, '1P'],
            [CameraMode.THIRD_PERSON, '3P'],
            [CameraMode.CINEMATIC,    'CIN'],
          ] as [CameraMode, string][]).map(([mode, label]) => {
            const isActive = cameraMode === mode
            return (
              <button
                key={mode}
                onClick={() => {
                  onCameraModeChange(mode)
                  window.dispatchEvent(new CustomEvent('nw:request-camera-mode', { detail: { mode } }))
                }}
                style={{
                  padding: '4px 14px',
                  fontSize: 11,
                  fontWeight: isActive ? 700 : 400,
                  letterSpacing: 0.8,
                  borderRadius: 14,
                  border: 'none',
                  background: isActive ? 'rgba(0,255,136,0.2)' : 'transparent',
                  color: isActive ? '#00ff88' : 'rgba(255,255,255,0.4)',
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                  fontFamily: 'monospace',
                }}
              >
                {label}
              </button>
            )
          })}
        </div>

        {/* Controls hint */}
        <div style={{
          color: 'rgba(255,255,255,0.18)',
          fontSize: 9,
          fontFamily: 'monospace',
          letterSpacing: 0.5,
          pointerEvents: 'none',
          whiteSpace: 'nowrap',
        }}>
          WASD · drag to look · QE up/down · Shift sprint
        </div>
      </div>

      {/* ── DATA SHADOW PANEL ─────────────────────────────────────────────── */}
      {dataShadow && (
        <div
          style={{
            position: 'fixed',
            left: Math.min(dataShadow.x + 18, window.innerWidth - 200),
            top: Math.min(dataShadow.y - 10, window.innerHeight - 140),
            zIndex: 40,
            pointerEvents: 'none',
            background: 'rgba(0,0,0,0.82)',
            border: '1px solid rgba(0,255,136,0.35)',
            borderRadius: 6,
            padding: '8px 12px',
            backdropFilter: 'blur(8px)',
            minWidth: 170,
            animation: 'nw-shadow-in 0.15s ease',
          }}
        >
          <div style={{
            color: '#00ff88',
            fontSize: 9,
            fontFamily: 'monospace',
            letterSpacing: 1.5,
            marginBottom: 5,
            fontWeight: 700,
          }}>
            ◈ NODE METRICS
          </div>
          <DataShadowRow label="Name"   value={dataShadow.project.name} />
          <DataShadowRow label="Status" value={dataShadow.project.status.toUpperCase()} />
          <DataShadowRow
            label="Value"
            value={`$${dataShadow.project.contract_value.toLocaleString()}`}
          />
          <DataShadowRow
            label="Health"
            value={`${dataShadow.project.health_score ?? 'N/A'}%`}
            highlight={(dataShadow.project.health_score ?? 80) < 60}
          />
        </div>
      )}

      {/* ── Canvas hover capture for data shadow ──────────────────────────── */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          zIndex: 5,
          pointerEvents: 'none',
        }}
        onMouseMove={handleMouseMove}
      />

      {/* ── CSS keyframes injected once ───────────────────────────────────── */}
      <style>{`
        @keyframes nw-blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
        @keyframes nw-shadow-in {
          from { opacity: 0; transform: translateY(-4px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </>
  )
}

// ── Small helper ──────────────────────────────────────────────────────────────

function DataShadowRow({
  label,
  value,
  highlight = false,
}: {
  label: string
  value: string
  highlight?: boolean
}) {
  return (
    <div style={{
      display: 'flex',
      justifyContent: 'space-between',
      gap: 12,
      marginBottom: 3,
    }}>
      <span style={{
        color: 'rgba(255,255,255,0.35)',
        fontSize: 9,
        fontFamily: 'monospace',
        letterSpacing: 0.5,
      }}>
        {label}
      </span>
      <span style={{
        color: highlight ? '#ff4444' : 'rgba(255,255,255,0.7)',
        fontSize: 9,
        fontFamily: 'monospace',
        letterSpacing: 0.3,
        maxWidth: 100,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}>
        {value}
      </span>
    </div>
  )
}
