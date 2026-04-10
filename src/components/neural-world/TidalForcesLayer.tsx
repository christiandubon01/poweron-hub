/**
 * TidalForcesLayer.tsx — NW57: Cash flow ocean tide simulation.
 *
 * Money coming in = tide rising. Money going out = tide receding.
 * The rhythm of payments creates a visible tide pattern over the river beach zone.
 *
 * Features:
 * 1. Water plane mesh that expands/contracts based on cumulative cash position
 * 2. Sine wave animation on water surface (natural movement)
 * 3. Wet ground shader — darker texture with subtle reflections where water recently was
 * 4. Foam particles at the tide line (white particle strip)
 * 5. Tide calendar — 7-day prediction bar at bottom of screen
 * 6. Spring Tide event — surge + particles + notification
 * 7. Neap Tide warning — recession + amber warning + cracked ground effect
 *
 * Layer ID: 'tides' — OFF by default.
 * Position: overlays the river area (x ≈ 0, y ≈ 0.32, z ≈ -190 to 190).
 */

import React, { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { useWorldContext } from './WorldContext'
import {
  subscribeWorldData,
  type NWWorldData,
  type NWInvoice,
} from './DataBridge'

// ── Constants ─────────────────────────────────────────────────────────────────

const RIVER_X         = 0
const RIVER_Y         = 0.32     // just below river surface at 0.45
const RIVER_Z_MIN     = -190
const RIVER_Z_MAX     =  190
const RIVER_Z_LEN     = RIVER_Z_MAX - RIVER_Z_MIN

/** Min/max tidal water half-width (beach zone) */
const TIDE_MIN_WIDTH  = 4        // low tide — narrow channel
const TIDE_MAX_WIDTH  = 38       // high tide — spreads across beach
const TIDE_MAX_CASH   = 80000    // dollar amount → full high tide

/** Foam particle count at tide line */
const FOAM_COUNT      = 60
/** Surge particle count for spring tide */
const SURGE_COUNT     = 80

// Colors
const COLOR_HIGH_TIDE   = new THREE.Color(0x00ddcc)   // blue-green
const COLOR_MID_TIDE    = new THREE.Color(0x0077aa)   // deeper blue
const COLOR_LOW_TIDE    = new THREE.Color(0x004466)   // dark teal
const COLOR_WET_GROUND  = new THREE.Color(0x0a1a20)   // dark wet sand
const COLOR_FOAM        = new THREE.Color(0xffffff)
const COLOR_SURGE       = new THREE.Color(0x00ffee)
const COLOR_NEAP_AMBER  = new THREE.Color(0xff8800)

// ── Data types ────────────────────────────────────────────────────────────────

interface TideDay {
  date: Date
  dateStr: string
  label: string      // Mon/Tue/etc
  inflows: number
  outflows: number
  tideLevel: 'HIGH' | 'MID' | 'LOW'
  isToday: boolean
}

interface SpringTideEvent {
  active: boolean
  amount: number
  sources: string[]
  expiresAt: number   // Date.now() ms
}

interface NeapTideWarning {
  active: boolean
  weekLabel: string
  expiresAt: number
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmtDollars(v: number): string {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`
  if (v >= 1_000)     return `$${Math.round(v / 1000)}k`
  return `$${Math.round(v)}`
}

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** Derive 7-day tide forecast from world data */
function deriveTideForecast(data: NWWorldData): TideDay[] {
  const today      = new Date()
  const daily      = data.accountingSignals.overheadMonthly / 30
  const days: TideDay[] = []

  for (let i = 0; i < 7; i++) {
    const d = new Date(today)
    d.setDate(today.getDate() + i)
    const dateStr = d.toISOString().split('T')[0]
    const dow     = d.getDay()

    // Inflows: invoices due on this date
    const inflows = data.invoices
      .filter((inv: NWInvoice) => {
        if (inv.status === 'paid') return false
        if (!inv.due_date)        return false
        return inv.due_date.startsWith(dateStr)
      })
      .reduce((sum: number, inv: NWInvoice) => sum + inv.amount, 0)

    // Payroll every other Friday (approximated)
    const weekInMonth = Math.floor(d.getDate() / 7)
    const isPayroll   = dow === 5 && weekInMonth % 2 === 0
    const outflows    = daily + (isPayroll ? data.accountingSignals.overheadMonthly * 0.35 : 0)

    const ratio      = inflows / Math.max(outflows, 1)
    const tideLevel  = ratio >= 1.8 ? 'HIGH' : ratio >= 0.9 ? 'MID' : 'LOW'

    days.push({
      date:      d,
      dateStr,
      label:     DAY_LABELS[dow],
      inflows,
      outflows,
      tideLevel,
      isToday:   i === 0,
    })
  }
  return days
}

/** Derive current tide width from cumulative cash position */
function deriveTideWidth(data: NWWorldData): number {
  const net = data.accountingSignals.recentPaidAmount - data.accountingSignals.overheadMonthly
  const clamped = Math.max(-TIDE_MAX_CASH, Math.min(TIDE_MAX_CASH, net))
  // Map -TIDE_MAX_CASH→TIDE_MIN_WIDTH and TIDE_MAX_CASH→TIDE_MAX_WIDTH
  const t = (clamped + TIDE_MAX_CASH) / (TIDE_MAX_CASH * 2)
  return TIDE_MIN_WIDTH + t * (TIDE_MAX_WIDTH - TIDE_MIN_WIDTH)
}

/** Derive tide health 0=low 1=high */
function deriveTideHealth(data: NWWorldData): number {
  const net     = data.accountingSignals.recentPaidAmount - data.accountingSignals.overheadMonthly
  const clamped = Math.max(-TIDE_MAX_CASH, Math.min(TIDE_MAX_CASH, net))
  return (clamped + TIDE_MAX_CASH) / (TIDE_MAX_CASH * 2)
}

function tideColor(health: number): THREE.Color {
  if (health >= 0.6) return COLOR_HIGH_TIDE.clone().lerp(new THREE.Color(0x00aaee), (1 - health))
  if (health >= 0.35) return COLOR_MID_TIDE.clone()
  return COLOR_LOW_TIDE.clone()
}

/** Check for spring tide conditions (large inflow surge day) */
function checkSpringTide(forecast: TideDay[]): SpringTideEvent | null {
  const today = forecast[0]
  if (!today) return null
  // Spring tide: today's inflows > 3× outflows and > $5k
  if (today.inflows >= today.outflows * 3 && today.inflows >= 5000) {
    return {
      active: true,
      amount: today.inflows,
      sources: ['Invoice payments due today'],
      expiresAt: Date.now() + 12_000,
    }
  }
  // Also check if 2+ days in next 7 are HIGH
  const highDays = forecast.filter(d => d.tideLevel === 'HIGH')
  if (highDays.length >= 3) {
    const total = highDays.reduce((s, d) => s + d.inflows, 0)
    if (total >= 10000) {
      return {
        active: true,
        amount: total,
        sources: [`${highDays.length} high-inflow days this week`],
        expiresAt: Date.now() + 10_000,
      }
    }
  }
  return null
}

/** Check for neap tide warning (high outflows, low inflows across the week) */
function checkNeapTide(forecast: TideDay[]): NeapTideWarning | null {
  const lowDays   = forecast.filter(d => d.tideLevel === 'LOW').length
  const totalIn   = forecast.reduce((s, d) => s + d.inflows, 0)
  const totalOut  = forecast.reduce((s, d) => s + d.outflows, 0)
  if (lowDays >= 5 && totalOut > totalIn * 1.8) {
    const startLabel = forecast[0]?.label ?? 'This'
    return {
      active:    true,
      weekLabel: `Week of ${forecast[0]?.dateStr ?? 'this week'}`,
      expiresAt: Date.now() + 15_000,
    }
    void startLabel // suppress unused warning
  }
  return null
}

// ── Component ──────────────────────────────────────────────────────────────────

interface TidalForcesLayerProps {
  visible: boolean
}

export function TidalForcesLayer({ visible }: TidalForcesLayerProps) {
  const { scene } = useWorldContext()

  // ── THREE.js refs ──────────────────────────────────────────────────────────
  const groupRef        = useRef<THREE.Group | null>(null)
  const waterMeshRef    = useRef<THREE.Mesh | null>(null)
  const wetGroundRef    = useRef<THREE.Mesh | null>(null)
  const foamParticlesRef = useRef<THREE.Mesh[]>([])
  const surgeParticlesRef = useRef<Array<{
    mesh: THREE.Mesh
    vx: number
    vy: number
    vz: number
    life: number
  }>>([])
  const crackMeshRef    = useRef<THREE.Mesh | null>(null)

  const elapsedRef      = useRef(0)
  const tideWidthRef    = useRef(TIDE_MIN_WIDTH)
  const tideHealthRef   = useRef(0.5)
  const targetWidthRef  = useRef(TIDE_MIN_WIDTH)
  const surgingRef      = useRef(false)

  // ── React state for overlays ────────────────────────────────────────────────
  const [forecast,       setForecast]       = useState<TideDay[]>([])
  const [springEvent,    setSpringEvent]    = useState<SpringTideEvent | null>(null)
  const [neapWarning,    setNeapWarning]    = useState<NeapTideWarning | null>(null)
  const [neapActive,     setNeapActive]     = useState(false)

  // ── Dispose helper ─────────────────────────────────────────────────────────

  function disposeGeomMat(mesh: THREE.Mesh) {
    mesh.geometry?.dispose()
    const m = mesh.material
    if (Array.isArray(m)) m.forEach(x => x.dispose())
    else m?.dispose()
  }

  // ── Build water plane ──────────────────────────────────────────────────────

  function buildWater(group: THREE.Group, width: number, health: number) {
    if (waterMeshRef.current) {
      group.remove(waterMeshRef.current)
      disposeGeomMat(waterMeshRef.current)
    }
    const col     = tideColor(health)
    const geo     = new THREE.PlaneGeometry(width, RIVER_Z_LEN, 8, 80)
    const mat     = new THREE.MeshLambertMaterial({
      color:       col.clone().multiplyScalar(0.2),
      emissive:    col.clone().multiplyScalar(0.25),
      transparent: true,
      opacity:     0.68,
      depthWrite:  false,
    })
    const mesh    = new THREE.Mesh(geo, mat)
    mesh.rotation.x = -Math.PI / 2
    mesh.position.set(RIVER_X, RIVER_Y, (RIVER_Z_MIN + RIVER_Z_MAX) / 2)
    group.add(mesh)
    waterMeshRef.current = mesh
  }

  // ── Build wet ground (beach zone) ──────────────────────────────────────────

  function buildWetGround(group: THREE.Group, tideW: number) {
    if (wetGroundRef.current) {
      group.remove(wetGroundRef.current)
      disposeGeomMat(wetGroundRef.current)
    }
    // Wet ground extends slightly beyond current water line
    const beachWidth = tideW + 6
    const geo = new THREE.PlaneGeometry(beachWidth, RIVER_Z_LEN, 2, 4)
    const mat = new THREE.MeshLambertMaterial({
      color:       COLOR_WET_GROUND,
      emissive:    new THREE.Color(0x001122),
      transparent: true,
      opacity:     0.55,
      depthWrite:  false,
    })
    const mesh = new THREE.Mesh(geo, mat)
    mesh.rotation.x = -Math.PI / 2
    mesh.position.set(RIVER_X, RIVER_Y - 0.03, (RIVER_Z_MIN + RIVER_Z_MAX) / 2)
    group.add(mesh)
    wetGroundRef.current = mesh
  }

  // ── Build foam particles at tide line ─────────────────────────────────────

  function buildFoam(group: THREE.Group, tideW: number) {
    foamParticlesRef.current.forEach(m => { group.remove(m); disposeGeomMat(m) })
    foamParticlesRef.current = []

    for (let i = 0; i < FOAM_COUNT; i++) {
      const side    = Math.random() > 0.5 ? 1 : -1
      const xPos    = side * (tideW / 2) + (Math.random() - 0.5) * 2.5
      const zPos    = RIVER_Z_MIN + Math.random() * RIVER_Z_LEN
      const radius  = 0.15 + Math.random() * 0.25

      const geo = new THREE.SphereGeometry(radius, 4, 3)
      const mat = new THREE.MeshBasicMaterial({
        color:       COLOR_FOAM,
        transparent: true,
        opacity:     0.7,
        depthWrite:  false,
      })
      const mesh = new THREE.Mesh(geo, mat)
      mesh.position.set(xPos, RIVER_Y + 0.15 + Math.random() * 0.1, zPos)
      group.add(mesh)
      foamParticlesRef.current.push(mesh)
    }
  }

  // ── Build cracked ground overlay (neap tide) ───────────────────────────────

  function buildCrackOverlay(group: THREE.Group) {
    if (crackMeshRef.current) {
      group.remove(crackMeshRef.current)
      disposeGeomMat(crackMeshRef.current)
    }
    const geo = new THREE.PlaneGeometry(TIDE_MAX_WIDTH + 12, RIVER_Z_LEN, 2, 4)
    const mat = new THREE.MeshLambertMaterial({
      color:       new THREE.Color(0x2a1500),
      emissive:    COLOR_NEAP_AMBER.clone().multiplyScalar(0.04),
      transparent: true,
      opacity:     0,    // animated in
      depthWrite:  false,
    })
    const mesh = new THREE.Mesh(geo, mat)
    mesh.rotation.x = -Math.PI / 2
    mesh.position.set(RIVER_X, RIVER_Y - 0.01, (RIVER_Z_MIN + RIVER_Z_MAX) / 2)
    group.add(mesh)
    crackMeshRef.current = mesh
  }

  // ── Trigger spring tide surge ──────────────────────────────────────────────

  function triggerSurge(group: THREE.Group, tideW: number) {
    if (surgingRef.current) return
    surgingRef.current = true

    // Spawn upward spray particles
    surgeParticlesRef.current.forEach(p => { group.remove(p.mesh); disposeGeomMat(p.mesh) })
    surgeParticlesRef.current = []

    for (let i = 0; i < SURGE_COUNT; i++) {
      const geo = new THREE.SphereGeometry(0.2 + Math.random() * 0.3, 4, 3)
      const mat = new THREE.MeshBasicMaterial({
        color:       COLOR_SURGE,
        transparent: true,
        opacity:     0.9,
        depthWrite:  false,
      })
      const mesh = new THREE.Mesh(geo, mat)
      const xOff = (Math.random() - 0.5) * tideW
      const zOff = RIVER_Z_MIN + Math.random() * RIVER_Z_LEN
      mesh.position.set(RIVER_X + xOff, RIVER_Y + 0.2, zOff)
      group.add(mesh)
      surgeParticlesRef.current.push({
        mesh,
        vx: (Math.random() - 0.5) * 0.08,
        vy: 0.04 + Math.random() * 0.1,
        vz: (Math.random() - 0.5) * 0.08,
        life: 1.0,
      })
    }

    setTimeout(() => { surgingRef.current = false }, 5000)
  }

  // ── Full build ─────────────────────────────────────────────────────────────

  function buildAll(group: THREE.Group, data: NWWorldData) {
    const tideW  = deriveTideWidth(data)
    const health = deriveTideHealth(data)
    tideWidthRef.current   = tideW
    tideHealthRef.current  = health
    targetWidthRef.current = tideW

    buildWater(group, tideW, health)
    buildWetGround(group, tideW)
    buildFoam(group, tideW)
    buildCrackOverlay(group)

    const fc = deriveTideForecast(data)
    setForecast(fc)

    const spring = checkSpringTide(fc)
    const neap   = checkNeapTide(fc)

    if (spring && !surgingRef.current) {
      setSpringEvent(spring)
      triggerSurge(group, tideW)
      setTimeout(() => setSpringEvent(null), 12_000)
    }

    if (neap) {
      setNeapWarning(neap)
      setNeapActive(true)
      setTimeout(() => { setNeapWarning(null); setNeapActive(false) }, 15_000)
    }
  }

  // ── Setup group + data subscription ───────────────────────────────────────

  useEffect(() => {
    const group = new THREE.Group()
    group.visible = visible
    scene.add(group)
    groupRef.current = group

    const unsub = subscribeWorldData((data: NWWorldData) => {
      buildAll(group, data)
    })

    return () => {
      unsub()
      // Dispose all objects
      foamParticlesRef.current.forEach(m => { group.remove(m); disposeGeomMat(m) })
      foamParticlesRef.current = []
      surgeParticlesRef.current.forEach(p => { group.remove(p.mesh); disposeGeomMat(p.mesh) })
      surgeParticlesRef.current = []
      if (waterMeshRef.current)    { group.remove(waterMeshRef.current);    disposeGeomMat(waterMeshRef.current) }
      if (wetGroundRef.current)    { group.remove(wetGroundRef.current);    disposeGeomMat(wetGroundRef.current) }
      if (crackMeshRef.current)    { group.remove(crackMeshRef.current);    disposeGeomMat(crackMeshRef.current) }
      waterMeshRef.current  = null
      wetGroundRef.current  = null
      crackMeshRef.current  = null
      scene.remove(group)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene])

  // ── Sync visibility ────────────────────────────────────────────────────────
  useEffect(() => {
    if (groupRef.current) groupRef.current.visible = visible
  }, [visible])

  // ── Animation loop ─────────────────────────────────────────────────────────
  useEffect(() => {
    function onFrame() {
      if (!groupRef.current?.visible) return
      elapsedRef.current += 0.016

      const t      = elapsedRef.current
      const health = tideHealthRef.current

      // ── Smooth tide width interpolation ────────────────────────────────────
      const target = targetWidthRef.current
      const curr   = tideWidthRef.current
      const lerped = curr + (target - curr) * 0.008
      tideWidthRef.current = lerped

      // ── Animate water surface (sine wave + color) ──────────────────────────
      if (waterMeshRef.current) {
        const mat = waterMeshRef.current.material as THREE.MeshLambertMaterial
        const col = tideColor(health)

        // Breathing shimmer
        const shimmer = 0.22 + Math.sin(t * 1.6) * 0.07
        mat.emissive.copy(col).multiplyScalar(shimmer)
        mat.opacity   = 0.60 + Math.sin(t * 2.1) * 0.08
        mat.needsUpdate = true

        // Scale to animated tide width
        const tideBreath = 1.0 + Math.sin(t * 0.7) * 0.018
        waterMeshRef.current.scale.x = (lerped / TIDE_MIN_WIDTH) * tideBreath

        // Sine wave on vertices — warp Y positions
        const pos = waterMeshRef.current.geometry.attributes.position as THREE.BufferAttribute
        for (let i = 0; i < pos.count; i++) {
          const z   = pos.getZ(i)
          const xOld = pos.getX(i)
          const wave = Math.sin(z * 0.04 + t * 2.2) * 0.12
                     + Math.sin(z * 0.09 + t * 1.4 + 1.1) * 0.06
          // In PlaneGeometry rotated -PI/2, Y → Z in world, X stays X
          // Store wave in local Y (becomes world Z offset, minor visual lift)
          pos.setY(i, wave)
          void xOld
        }
        pos.needsUpdate = true
        waterMeshRef.current.geometry.computeVertexNormals()
      }

      // ── Animate wet ground (reflective flicker) ─────────────────────────────
      if (wetGroundRef.current) {
        const mat = wetGroundRef.current.material as THREE.MeshLambertMaterial
        mat.opacity = 0.48 + Math.sin(t * 0.9 + 0.5) * 0.08
        mat.needsUpdate = true
        // Scale wet ground slightly wider than water, follows tide
        wetGroundRef.current.scale.x = (lerped / TIDE_MIN_WIDTH) + 0.3
      }

      // ── Animate foam particles ──────────────────────────────────────────────
      foamParticlesRef.current.forEach((mesh, i) => {
        const wobble = Math.sin(t * 2.5 + i * 0.7) * 0.06
        mesh.position.y = RIVER_Y + 0.15 + wobble
        const mat = mesh.material as THREE.MeshBasicMaterial
        mat.opacity = 0.5 + Math.sin(t * 3 + i * 1.3) * 0.25
      })

      // ── Animate surge particles ─────────────────────────────────────────────
      surgeParticlesRef.current = surgeParticlesRef.current.filter(p => {
        p.life -= 0.012
        if (p.life <= 0) {
          groupRef.current?.remove(p.mesh)
          disposeGeomMat(p.mesh)
          return false
        }
        p.mesh.position.x += p.vx
        p.mesh.position.y += p.vy
        p.mesh.position.z += p.vz
        p.vy -= 0.003   // gravity
        const mat = p.mesh.material as THREE.MeshBasicMaterial
        mat.opacity = p.life * 0.9
        return true
      })

      // ── Animate neap crack overlay ──────────────────────────────────────────
      if (crackMeshRef.current) {
        const mat    = crackMeshRef.current.material as THREE.MeshLambertMaterial
        const target = neapActive ? 0.45 : 0
        mat.opacity  = mat.opacity + (target - mat.opacity) * 0.03
        if (neapActive) {
          const pulse = 0.04 + Math.sin(t * 1.8) * 0.03
          mat.emissive.copy(COLOR_NEAP_AMBER).multiplyScalar(pulse)
        }
        mat.needsUpdate = true
      }
    }

    window.addEventListener('nw:frame', onFrame)
    return () => window.removeEventListener('nw:frame', onFrame)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [neapActive])

  // ── Render overlays ────────────────────────────────────────────────────────
  if (!visible) return null

  return (
    <>
      {/* Tide Calendar — 7-day prediction bar at bottom */}
      <TideCalendar forecast={forecast} />

      {/* Spring Tide notification */}
      {springEvent && springEvent.active && (
        <SpringTideNotification event={springEvent} />
      )}

      {/* Neap Tide warning */}
      {neapWarning && neapWarning.active && (
        <NeapTideNotification warning={neapWarning} />
      )}
    </>
  )
}

// ── Tide Calendar overlay ─────────────────────────────────────────────────────

function TideCalendar({ forecast }: { forecast: TideDay[] }) {
  if (forecast.length === 0) return null

  const maxFlow = Math.max(
    ...forecast.map(d => Math.max(d.inflows, d.outflows, 1)),
    1,
  )

  return (
    <div
      style={{
        position:      'fixed',
        bottom:        56,
        left:          '50%',
        transform:     'translateX(-50%)',
        zIndex:        40,
        background:    'rgba(2, 8, 16, 0.88)',
        border:        '1px solid rgba(0, 180, 160, 0.3)',
        borderRadius:  6,
        backdropFilter:'blur(12px)',
        padding:       '8px 12px 6px',
        fontFamily:    'monospace',
        pointerEvents: 'none',
        minWidth:      340,
      }}
    >
      {/* Header */}
      <div style={{
        fontSize:     9,
        color:        'rgba(0,220,200,0.55)',
        letterSpacing: 2.5,
        marginBottom:  6,
        textAlign:    'center',
      }}>
        TIDAL FORECAST — NEXT 7 DAYS
      </div>

      {/* Day columns */}
      <div style={{ display: 'flex', gap: 4, alignItems: 'flex-end' }}>
        {forecast.map((day, i) => {
          const inH   = Math.max(4, (day.inflows / maxFlow) * 44)
          const outH  = Math.max(4, (day.outflows / maxFlow) * 44)
          const tideColor_ =
            day.tideLevel === 'HIGH' ? '#00ddcc' :
            day.tideLevel === 'MID'  ? '#0099cc' : '#445566'

          return (
            <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, flex: 1 }}>
              {/* Tide level badge */}
              <div style={{
                fontSize:      7,
                color:         tideColor_,
                letterSpacing: 0.5,
                fontWeight:    700,
                marginBottom:  2,
              }}>
                {day.tideLevel}
              </div>

              {/* Stacked bars */}
              <div style={{ display: 'flex', gap: 1, alignItems: 'flex-end', height: 48 }}>
                {/* Inflow bar (green) */}
                <div style={{
                  width:        7,
                  height:       inH,
                  background:   'rgba(0, 220, 140, 0.75)',
                  borderRadius: '1px 1px 0 0',
                }} />
                {/* Outflow bar (red-orange) */}
                <div style={{
                  width:        7,
                  height:       outH,
                  background:   'rgba(255, 90, 50, 0.65)',
                  borderRadius: '1px 1px 0 0',
                }} />
              </div>

              {/* Day label + today marker */}
              <div style={{
                fontSize:      8,
                color:         day.isToday ? '#ffd700' : 'rgba(255,255,255,0.4)',
                letterSpacing: 0.5,
                fontWeight:    day.isToday ? 700 : 400,
                borderTop:     day.isToday ? '2px solid #ffd700' : '2px solid transparent',
                paddingTop:    2,
                width:         '100%',
                textAlign:     'center',
              }}>
                {day.label}
              </div>
            </div>
          )
        })}
      </div>

      {/* Legend */}
      <div style={{
        display:       'flex',
        gap:           12,
        justifyContent:'center',
        marginTop:     5,
        fontSize:      7,
        color:         'rgba(255,255,255,0.3)',
        letterSpacing: 1,
      }}>
        <span style={{ color: 'rgba(0,220,140,0.7)' }}>▬ INFLOW</span>
        <span style={{ color: 'rgba(255,90,50,0.7)' }}>▬ OUTFLOW</span>
        <span style={{ color: '#ffd700' }}>│ TODAY</span>
      </div>
    </div>
  )
}

// ── Spring Tide notification ───────────────────────────────────────────────────

function SpringTideNotification({ event }: { event: SpringTideEvent }) {
  return (
    <div
      style={{
        position:      'fixed',
        top:           80,
        left:          '50%',
        transform:     'translateX(-50%)',
        zIndex:        55,
        pointerEvents: 'none',
        animation:     'nw-spring-tide-in 0.4s ease',
      }}
    >
      <div style={{
        background:    'rgba(0, 30, 28, 0.95)',
        border:        '1px solid rgba(0, 230, 210, 0.7)',
        borderRadius:  8,
        padding:       '12px 22px',
        fontFamily:    'monospace',
        textAlign:     'center',
        backdropFilter:'blur(16px)',
        boxShadow:     '0 0 40px rgba(0,230,210,0.35), 0 4px 24px rgba(0,0,0,0.8)',
        minWidth:      280,
      }}>
        <div style={{ fontSize: 16, marginBottom: 4 }}>🌊</div>
        <div style={{
          fontSize:      11,
          color:         '#00ddcc',
          letterSpacing: 2.5,
          fontWeight:    700,
          marginBottom:  4,
        }}>
          SPRING TIDE
        </div>
        <div style={{
          fontSize:      18,
          color:         '#00ffee',
          fontWeight:    700,
          letterSpacing: 1,
          marginBottom:  6,
        }}>
          {fmtDollars(event.amount)}
        </div>
        <div style={{
          fontSize:      9,
          color:         'rgba(0,220,200,0.6)',
          letterSpacing: 1,
          lineHeight:    1.5,
        }}>
          {event.sources.join(' · ')}
        </div>
      </div>
    </div>
  )
}

// ── Neap Tide warning ─────────────────────────────────────────────────────────

function NeapTideNotification({ warning }: { warning: NeapTideWarning }) {
  return (
    <div
      style={{
        position:      'fixed',
        top:           80,
        left:          '50%',
        transform:     'translateX(-50%)',
        zIndex:        55,
        pointerEvents: 'none',
        animation:     'nw-neap-tide-in 0.4s ease',
      }}
    >
      <div style={{
        background:    'rgba(22, 10, 0, 0.96)',
        border:        '1px solid rgba(255, 136, 0, 0.65)',
        borderRadius:  8,
        padding:       '12px 22px',
        fontFamily:    'monospace',
        textAlign:     'center',
        backdropFilter:'blur(16px)',
        boxShadow:     '0 0 32px rgba(255,136,0,0.25), 0 4px 20px rgba(0,0,0,0.85)',
        minWidth:      280,
      }}>
        <div style={{ fontSize: 16, marginBottom: 4 }}>⚠️</div>
        <div style={{
          fontSize:      11,
          color:         '#ff8800',
          letterSpacing: 2.5,
          fontWeight:    700,
          marginBottom:  4,
        }}>
          NEAP TIDE WARNING
        </div>
        <div style={{
          fontSize:      12,
          color:         'rgba(255,160,60,0.9)',
          letterSpacing: 1,
          marginBottom:  4,
        }}>
          {warning.weekLabel}
        </div>
        <div style={{
          fontSize:      9,
          color:         'rgba(255,140,40,0.6)',
          letterSpacing: 1,
          lineHeight:    1.5,
        }}>
          Expect tight cash — high outflows, low inflows scheduled
        </div>
      </div>
    </div>
  )
}
