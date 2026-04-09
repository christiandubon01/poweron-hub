/**
 * RiverSystemLayer.tsx — NW23: Central river cash flow visualization.
 *
 * THE RIVER = master cash flow. Money flows FROM project mountains (west)
 * THROUGH the river TOWARD Founders Valley (center).
 *
 * Features:
 * 1. River width scales with total monthly revenue
 * 2. River flow speed scales with payment velocity
 * 3. River color: healthy = bright teal/cyan, strained = amber/red
 * 4. Tributaries: each project mountain → river entry; MTZ Solar also feeds in
 * 5. Gold particles for high-margin project payments
 * 6. Payment drop animation: green sphere drops into river when a payment particle hits
 * 7. Cost drain: momentary transparent disc shows material purchases exiting river
 * 8. Overhead drain: steady small drain pulse near Founders Valley center
 * 9. Net cash flow floating indicator above river center
 * 10. Click anywhere on river → React summary panel
 *
 * River coordinates: central channel x=-20 to x=20, z=-200 to z=200, y≈0.4
 * All Three.js objects are disposed on unmount.
 */

import React, { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { useWorldContext } from '../WorldContext'
import {
  subscribeWorldData,
  seededPosition,
  contractValueToHeight,
  type NWWorldData,
  type NWProject,
} from '../DataBridge'

// ── Constants ──────────────────────────────────────────────────────────────────

const RIVER_X       = 0          // center x of river
const RIVER_Y       = 0.45       // water surface height
const RIVER_Z_MIN   = -190
const RIVER_Z_MAX   =  190
const RIVER_Z_LEN   = RIVER_Z_MAX - RIVER_Z_MIN   // 380 units
const RIVER_Z_SEGS  = 120

const MIN_RIVER_WIDTH  = 6        // units (low revenue)
const MAX_RIVER_WIDTH  = 34       // units (high revenue)
const REVENUE_SCALE    = 200000   // dollars → max width

const TRIBUTARY_RADIUS = 0.12
const TRIBUTARY_SEGS   = 8

// MTZ Solar plateau position (matches WestContinentLayer)
const MTZ_X  = -160
const MTZ_Z  = -130
const MTZ_Y  = 5.0   // slightly above plateau

// Colors
const COLOR_HEALTHY_TEAL   = new THREE.Color(0x00e5cc)
const COLOR_STRAINED_AMBER = new THREE.Color(0xff8800)
const COLOR_NEGATIVE_RED   = new THREE.Color(0xff2244)
const COLOR_GOLD           = new THREE.Color(0xffd700)
const COLOR_PAYMENT_GREEN  = new THREE.Color(0x00ff66)
const COLOR_DRAIN_ORANGE   = new THREE.Color(0xff6600)
const COLOR_OVERHEAD_RED   = new THREE.Color(0xff3344)

// ── Helpers ────────────────────────────────────────────────────────────────────

function lerpColor(a: THREE.Color, b: THREE.Color, t: number): THREE.Color {
  return a.clone().lerp(b, Math.max(0, Math.min(1, t)))
}

/** Compute cash-flow color: 0=negative(red), 0.5=strained(amber), 1=healthy(teal) */
function cashFlowColor(health: number): THREE.Color {
  if (health >= 0.5) {
    return lerpColor(COLOR_STRAINED_AMBER, COLOR_HEALTHY_TEAL, (health - 0.5) * 2)
  }
  return lerpColor(COLOR_NEGATIVE_RED, COLOR_STRAINED_AMBER, health * 2)
}

/** Derive financial summary from world data */
interface RiverFinancials {
  totalMonthlyRevenue: number   // sum of contract_value for active projects (proxy)
  recentPaidAmount: number      // last 30 days paid
  overheadMonthly: number       // estimated monthly overhead
  materialCostMonthly: number   // sum of material_cost for in_progress projects
  netCashFlow: number           // recentPaidAmount - overhead - materialCostMonthly
  cashFlowHealth: number        // 0–1
  paymentVelocity: number       // 0–1 (relative speed)
  topProjects: NWProject[]      // top 3 by contract_value
  topCostProjects: NWProject[]  // top 3 by material_cost
  solarIncome: number
}

function deriveFinancials(data: NWWorldData): RiverFinancials {
  const activeProjects = data.projects.filter(
    p => p.status === 'in_progress' || p.status === 'approved'
  )
  const totalMonthlyRevenue = activeProjects.reduce((s, p) => s + p.contract_value, 0)
  const recentPaidAmount    = data.accountingSignals.recentPaidAmount
  const overheadMonthly     = data.accountingSignals.overheadMonthly
  const materialCostMonthly = activeProjects.reduce((s, p) => s + p.material_cost, 0)
  const netCashFlow         = recentPaidAmount - overheadMonthly - materialCostMonthly
  const maxExpected         = Math.max(totalMonthlyRevenue * 0.4, overheadMonthly * 2, 10000)
  const cashFlowHealth      = Math.max(0, Math.min(1, (netCashFlow + maxExpected) / (maxExpected * 2)))
  const paymentVelocity     = Math.max(0.05, Math.min(1, recentPaidAmount / Math.max(overheadMonthly * 3, 1)))

  const sorted = [...activeProjects].sort((a, b) => b.contract_value - a.contract_value)
  const topProjects = sorted.slice(0, 3)
  const byCost = [...activeProjects].sort((a, b) => b.material_cost - a.material_cost)
  const topCostProjects = byCost.slice(0, 3)

  return {
    totalMonthlyRevenue,
    recentPaidAmount,
    overheadMonthly,
    materialCostMonthly,
    netCashFlow,
    cashFlowHealth,
    paymentVelocity,
    topProjects,
    topCostProjects,
    solarIncome: data.solarIncome,
  }
}

function fmtDollars(v: number): string {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`
  if (v >= 1_000)     return `$${Math.round(v / 1000)}k`
  return `$${Math.round(v)}`
}

// ── Text sprite ────────────────────────────────────────────────────────────────

function makeTextSprite(
  text: string,
  opts?: { fontSize?: number; color?: string; bgColor?: string }
): THREE.Sprite {
  const fontSize = opts?.fontSize ?? 24
  const color    = opts?.color    ?? '#00e5cc'
  const bgColor  = opts?.bgColor  ?? 'rgba(0,0,0,0.65)'

  const canvas = document.createElement('canvas')
  const ctx    = canvas.getContext('2d')!
  ctx.font     = `bold ${fontSize}px monospace`
  const tw     = Math.ceil(ctx.measureText(text).width) + 16
  const th     = fontSize + 12
  canvas.width  = tw
  canvas.height = th

  ctx.font      = `bold ${fontSize}px monospace`
  ctx.fillStyle = bgColor
  ctx.fillRect(0, 0, tw, th)
  ctx.fillStyle = color
  ctx.textBaseline = 'middle'
  ctx.fillText(text, 8, th / 2)

  const tex  = new THREE.CanvasTexture(canvas)
  const mat  = new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 0.95, depthWrite: false })
  const sp   = new THREE.Sprite(mat)
  sp.scale.set((tw / th) * 2.5, 2.5, 1)
  return sp
}

// ── River click summary panel ──────────────────────────────────────────────────

interface RiverPanelProps {
  fin: RiverFinancials
  screenX: number
  screenY: number
  onClose: () => void
}

function RiverPanel({ fin, screenX, screenY, onClose }: RiverPanelProps) {
  const W = 320
  const H = 380
  const mg = 16
  const x = Math.min(Math.max(screenX + 18, mg), window.innerWidth  - W - mg)
  const y = Math.min(Math.max(screenY - 80,  mg), window.innerHeight - H - mg)

  const healthPct = Math.round(fin.cashFlowHealth * 100)
  const healthColor = fin.cashFlowHealth >= 0.7 ? '#00e5cc' : fin.cashFlowHealth >= 0.4 ? '#ff8800' : '#ff2244'
  const netArrow    = fin.netCashFlow >= 0 ? '▲' : '▼'
  const netColor    = fin.netCashFlow >= 0 ? '#00ff88' : '#ff4444'

  return (
    <div
      onClick={e => e.stopPropagation()}
      style={{
        position: 'fixed',
        left: x,
        top: y,
        width: W,
        zIndex: 70,
        background: 'rgba(3, 10, 20, 0.95)',
        border: '1px solid rgba(0,229,204,0.4)',
        borderRadius: 8,
        backdropFilter: 'blur(16px)',
        boxShadow: '0 0 32px rgba(0,229,204,0.18), 0 4px 28px rgba(0,0,0,0.8)',
        fontFamily: 'monospace',
        overflow: 'hidden',
        animation: 'nw-node-panel-in 0.18s ease',
      }}
    >
      {/* Header */}
      <div style={{
        padding: '10px 14px 9px',
        borderBottom: '1px solid rgba(0,229,204,0.2)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <div>
          <div style={{ fontSize: 10, color: 'rgba(0,229,204,0.5)', letterSpacing: 2, marginBottom: 2 }}>
            CENTRAL RIVER
          </div>
          <div style={{ fontSize: 14, color: '#00e5cc', letterSpacing: 1.5, fontWeight: 700 }}>
            MASTER CASH FLOW
          </div>
        </div>
        <button
          onClick={onClose}
          style={{
            background: 'none',
            border: 'none',
            color: 'rgba(0,229,204,0.5)',
            fontSize: 16,
            cursor: 'pointer',
            padding: '2px 6px',
          }}
        >
          ✕
        </button>
      </div>

      {/* Net flow hero */}
      <div style={{ padding: '12px 14px 10px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', letterSpacing: 1.5, marginBottom: 4 }}>
          NET CASH FLOW THIS MONTH
        </div>
        <div style={{ fontSize: 22, color: netColor, fontWeight: 700, letterSpacing: 1 }}>
          {netArrow} {fmtDollars(Math.abs(fin.netCashFlow))}
        </div>
        <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.35)', letterSpacing: 1 }}>CASH IN</div>
            <div style={{ fontSize: 13, color: '#00ff88' }}>{fmtDollars(fin.recentPaidAmount)}</div>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.35)', letterSpacing: 1 }}>CASH OUT</div>
            <div style={{ fontSize: 13, color: '#ff6644' }}>
              {fmtDollars(fin.overheadMonthly + fin.materialCostMonthly)}
            </div>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.35)', letterSpacing: 1 }}>HEALTH</div>
            <div style={{ fontSize: 13, color: healthColor }}>{healthPct}%</div>
          </div>
        </div>
      </div>

      {/* Top contributing projects */}
      <div style={{ padding: '10px 14px 8px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <div style={{ fontSize: 9, color: 'rgba(0,229,204,0.5)', letterSpacing: 2, marginBottom: 8 }}>
          TOP REVENUE STREAMS
        </div>
        {fin.topProjects.length === 0 && (
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)' }}>No active projects</div>
        )}
        {fin.topProjects.map((p, i) => (
          <div key={p.id} style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 5,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 0 }}>
              <span style={{ color: i === 0 ? '#ffd700' : 'rgba(0,229,204,0.5)', fontSize: 10 }}>
                {i === 0 ? '●' : '○'}
              </span>
              <span style={{
                fontSize: 11,
                color: 'rgba(255,255,255,0.8)',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                maxWidth: 160,
              }}>
                {p.name}
              </span>
            </div>
            <span style={{ fontSize: 11, color: '#00e5cc', marginLeft: 8 }}>
              {fmtDollars(p.contract_value)}
            </span>
          </div>
        ))}
      </div>

      {/* Top cost drains */}
      <div style={{ padding: '10px 14px 10px' }}>
        <div style={{ fontSize: 9, color: 'rgba(255,100,0,0.6)', letterSpacing: 2, marginBottom: 8 }}>
          TOP COST DRAINS
        </div>
        {fin.topCostProjects.filter(p => p.material_cost > 0).length === 0 && (
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)' }}>No material costs tracked</div>
        )}
        {fin.topCostProjects.filter(p => p.material_cost > 0).map((p, i) => (
          <div key={p.id} style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 5,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 0 }}>
              <span style={{ color: i === 0 ? '#ff4400' : 'rgba(255,100,0,0.5)', fontSize: 10 }}>▼</span>
              <span style={{
                fontSize: 11,
                color: 'rgba(255,255,255,0.7)',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                maxWidth: 160,
              }}>
                {p.name}
              </span>
            </div>
            <span style={{ fontSize: 11, color: '#ff8844', marginLeft: 8 }}>
              {fmtDollars(p.material_cost)}
            </span>
          </div>
        ))}
        {/* Solar income */}
        {fin.solarIncome > 0 && (
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            marginTop: 4,
            paddingTop: 6,
            borderTop: '1px solid rgba(255,255,255,0.06)',
          }}>
            <span style={{ fontSize: 11, color: '#ffcc44' }}>☀ MTZ Solar Tributary</span>
            <span style={{ fontSize: 11, color: '#ffcc44' }}>{fmtDollars(fin.solarIncome)}</span>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Component ──────────────────────────────────────────────────────────────────

export function RiverSystemLayer() {
  const { scene, camera, renderer } = useWorldContext()

  // ── Refs for Three.js objects ──────────────────────────────────────────────
  const riverMeshRef       = useRef<THREE.Mesh | null>(null)
  const riverSurfaceRef    = useRef<THREE.Mesh | null>(null)   // animated overlay
  const tributaryLinesRef  = useRef<THREE.Line[]>([])
  const flowParticlesRef   = useRef<Array<{
    mesh: THREE.Mesh
    t: number
    speed: number
    active: boolean
    countdown: number
    isGold: boolean
    dropTriggered: boolean
  }>>([])
  const drainPulsesRef     = useRef<Array<{
    mesh: THREE.Mesh
    t: number
    active: boolean
    baseZ: number
  }>>([])
  const netFlowSpriteRef   = useRef<THREE.Sprite | null>(null)
  const overheadDrainRef   = useRef<THREE.Mesh | null>(null)
  const clickHitMeshRef    = useRef<THREE.Mesh | null>(null)

  // Time accumulator for animations
  const elapsedRef         = useRef<number>(0)
  const finRef             = useRef<RiverFinancials | null>(null)

  // ── React state for click panel ───────────────────────────────────────────
  const [panelOpen, setPanelOpen] = useState(false)
  const [panelPos,  setPanelPos]  = useState({ x: 0, y: 0 })

  // ── Dispose helpers ────────────────────────────────────────────────────────

  function disposeMesh(m: THREE.Object3D | null) {
    if (!m) return
    scene.remove(m)
    if ((m as THREE.Mesh).geometry)       (m as THREE.Mesh).geometry.dispose()
    const mat = (m as THREE.Mesh).material
    if (mat) {
      if (Array.isArray(mat)) mat.forEach(x => x.dispose())
      else mat.dispose()
    }
    if ((m as THREE.Sprite).material) {
      const sm = (m as THREE.Sprite).material as THREE.SpriteMaterial
      sm.map?.dispose()
      sm.dispose()
    }
  }

  function disposeAll() {
    disposeMesh(riverMeshRef.current);      riverMeshRef.current    = null
    disposeMesh(riverSurfaceRef.current);   riverSurfaceRef.current = null
    disposeMesh(netFlowSpriteRef.current);  netFlowSpriteRef.current = null
    disposeMesh(overheadDrainRef.current);  overheadDrainRef.current = null
    disposeMesh(clickHitMeshRef.current);   clickHitMeshRef.current = null
    tributaryLinesRef.current.forEach(l => disposeMesh(l))
    tributaryLinesRef.current = []
    flowParticlesRef.current.forEach(p => disposeMesh(p.mesh))
    flowParticlesRef.current = []
    drainPulsesRef.current.forEach(d => disposeMesh(d.mesh))
    drainPulsesRef.current = []
  }

  // ── Build river surface mesh ───────────────────────────────────────────────

  function buildRiver(fin: RiverFinancials) {
    // Remove old
    disposeMesh(riverMeshRef.current)
    riverMeshRef.current = null
    disposeMesh(riverSurfaceRef.current)
    riverSurfaceRef.current = null

    const baseWidth = MIN_RIVER_WIDTH + (fin.totalMonthlyRevenue / REVENUE_SCALE) * (MAX_RIVER_WIDTH - MIN_RIVER_WIDTH)
    const width = Math.max(MIN_RIVER_WIDTH, Math.min(MAX_RIVER_WIDTH, baseWidth))
    const col   = cashFlowColor(fin.cashFlowHealth)

    // Slightly recessed river bed
    const bedGeo = new THREE.PlaneGeometry(width, RIVER_Z_LEN, 4, RIVER_Z_SEGS)
    const bedMat = new THREE.MeshLambertMaterial({
      color:    new THREE.Color(0x020810),
      emissive: col.clone().multiplyScalar(0.06),
    })
    const bed = new THREE.Mesh(bedGeo, bedMat)
    bed.rotation.x = -Math.PI / 2
    bed.position.set(RIVER_X, RIVER_Y - 0.05, (RIVER_Z_MIN + RIVER_Z_MAX) / 2)
    bed.receiveShadow = true
    scene.add(bed)
    riverMeshRef.current = bed

    // Animated shimmering surface layer
    const surfGeo = new THREE.PlaneGeometry(width * 0.85, RIVER_Z_LEN, 4, RIVER_Z_SEGS)
    const surfMat = new THREE.MeshLambertMaterial({
      color:    col.clone().multiplyScalar(0.15),
      emissive: col.clone().multiplyScalar(0.22),
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
    })
    const surf = new THREE.Mesh(surfGeo, surfMat)
    surf.rotation.x = -Math.PI / 2
    surf.position.set(RIVER_X, RIVER_Y + 0.02, (RIVER_Z_MIN + RIVER_Z_MAX) / 2)
    scene.add(surf)
    riverSurfaceRef.current = surf
  }

  // ── Build tributaries ──────────────────────────────────────────────────────

  function buildTributaries(projects: NWProject[], solarIncome: number) {
    tributaryLinesRef.current.forEach(l => disposeMesh(l))
    tributaryLinesRef.current = []

    const activeProjects = projects.filter(
      p => p.status === 'in_progress' || p.status === 'approved' || p.status === 'completed'
    ).slice(0, 14)

    for (const p of activeProjects) {
      const pos2d  = seededPosition(p.id)
      const h      = contractValueToHeight(p.contract_value)
      const projX  = pos2d.x
      const projZ  = pos2d.z
      const projY  = h + 1.0

      // Entry to river west bank (x = -MIN_RIVER_WIDTH/2 adjusted)
      const riverEntryX = -(MIN_RIVER_WIDTH / 2 + 1)
      const riverEntryZ = projZ
      const riverEntryY = RIVER_Y + 0.1

      // Tributary width proportional to project revenue
      const ratio = Math.max(0.3, Math.min(2.5, p.contract_value / 30000))
      const color = p.contract_value > 100000 ? 0x00ddaa : 0x009977

      const points: THREE.Vector3[] = [
        new THREE.Vector3(projX, projY, projZ),
        new THREE.Vector3(projX * 0.5 - 8, projY * 0.5 + 0.5, projZ),
        new THREE.Vector3(riverEntryX, riverEntryY, riverEntryZ),
      ]
      const curve  = new THREE.CatmullRomCurve3(points)
      const geo    = new THREE.TubeGeometry(curve, 12, TRIBUTARY_RADIUS * ratio, TRIBUTARY_SEGS, false)
      const mat    = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.45,
        depthWrite: false,
      })
      const tube = new THREE.Mesh(geo, mat) as unknown as THREE.Line
      scene.add(tube)
      tributaryLinesRef.current.push(tube)
    }

    // MTZ Solar tributary
    if (solarIncome > 0) {
      const mtzRatio = Math.max(0.4, Math.min(2.8, solarIncome / 50000))
      const points: THREE.Vector3[] = [
        new THREE.Vector3(MTZ_X, MTZ_Y, MTZ_Z),
        new THREE.Vector3(MTZ_X * 0.5 - 5, MTZ_Y * 0.4 + 0.5, MTZ_Z * 0.5),
        new THREE.Vector3(-18, RIVER_Y + 0.1, MTZ_Z * 0.15),
        new THREE.Vector3(-12, RIVER_Y + 0.1, 0),
      ]
      const curve = new THREE.CatmullRomCurve3(points)
      const geo   = new THREE.TubeGeometry(curve, 16, TRIBUTARY_RADIUS * mtzRatio * 1.2, TRIBUTARY_SEGS, false)
      const mat   = new THREE.MeshBasicMaterial({
        color: 0xffaa00,
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
      })
      const tube = new THREE.Mesh(geo, mat) as unknown as THREE.Line
      scene.add(tube)
      tributaryLinesRef.current.push(tube)
    }
  }

  // ── Build flow particles ───────────────────────────────────────────────────

  function buildFlowParticles(fin: RiverFinancials, projects: NWProject[]) {
    flowParticlesRef.current.forEach(p => disposeMesh(p.mesh))
    flowParticlesRef.current = []

    const activeProjects = projects.filter(
      p => p.status === 'in_progress' || p.status === 'approved'
    ).slice(0, 10)

    const baseSpeed = 0.0025 + fin.paymentVelocity * 0.004   // faster with payment velocity

    // Regular payment flow particles (green)
    const count = Math.max(3, Math.min(12, activeProjects.length + 2))
    for (let i = 0; i < count; i++) {
      const startZ = RIVER_Z_MIN + Math.random() * RIVER_Z_LEN
      const isNorth = startZ < 0
      // Flows toward z=0 (Founders Valley center)
      const geo = new THREE.SphereGeometry(0.35, 5, 4)
      const mat = new THREE.MeshBasicMaterial({
        color: COLOR_PAYMENT_GREEN,
        transparent: true,
        opacity: 0.85,
      })
      const mesh = new THREE.Mesh(geo, mat)
      const xOffset = (Math.random() - 0.5) * 6
      mesh.position.set(RIVER_X + xOffset, RIVER_Y + 0.25, startZ)
      scene.add(mesh)

      flowParticlesRef.current.push({
        mesh,
        t: Math.random(),
        speed: baseSpeed * (0.7 + Math.random() * 0.6),
        active: true,
        countdown: 0,
        isGold: false,
        dropTriggered: false,
      })
    }

    // Gold particles for high-margin projects
    const highMarginProjects = activeProjects.filter(
      p => p.contract_value > 0 && p.material_cost > 0
        ? (p.contract_value - p.material_cost) / p.contract_value > 0.55
        : p.contract_value > 80000
    ).slice(0, 4)

    for (const _p of highMarginProjects) {
      const geo = new THREE.SphereGeometry(0.42, 6, 5)
      const mat = new THREE.MeshBasicMaterial({
        color: COLOR_GOLD,
        transparent: true,
        opacity: 0.9,
      })
      const mesh = new THREE.Mesh(geo, mat)
      const startZ = RIVER_Z_MIN + Math.random() * RIVER_Z_LEN
      const xOffset = (Math.random() - 0.5) * 8
      mesh.position.set(RIVER_X + xOffset, RIVER_Y + 0.38, startZ)
      scene.add(mesh)

      // Add small glow point light for gold particles
      const glow = new THREE.PointLight(0xffd700, 0.6, 8)
      glow.position.copy(mesh.position)
      scene.add(glow)
      ;(mesh as THREE.Mesh & { _glow?: THREE.PointLight })._glow = glow

      flowParticlesRef.current.push({
        mesh,
        t: Math.random(),
        speed: baseSpeed * 1.3,
        active: true,
        countdown: 0,
        isGold: true,
        dropTriggered: false,
      })
    }
  }

  // ── Build drain pulses (material costs) ───────────────────────────────────

  function buildDrainPulses(projects: NWProject[]) {
    drainPulsesRef.current.forEach(d => disposeMesh(d.mesh))
    drainPulsesRef.current = []

    const costProjects = projects.filter(
      p => p.material_cost > 0 && (p.status === 'in_progress' || p.status === 'approved')
    ).slice(0, 5)

    for (const p of costProjects) {
      const pos2d = seededPosition(p.id)
      // Drain appears on river at same z-position as the project
      const drainZ = pos2d.z

      const geo = new THREE.CircleGeometry(1.8 * Math.min(2, p.material_cost / 20000 + 0.5), 12)
      const mat = new THREE.MeshBasicMaterial({
        color:       COLOR_DRAIN_ORANGE,
        transparent: true,
        opacity:     0,
        depthWrite:  false,
      })
      const mesh = new THREE.Mesh(geo, mat)
      mesh.rotation.x = -Math.PI / 2
      mesh.position.set(RIVER_X, RIVER_Y + 0.08, drainZ)
      scene.add(mesh)

      drainPulsesRef.current.push({
        mesh,
        t: Math.random() * Math.PI * 2,
        active: true,
        baseZ: drainZ,
      })
    }
  }

  // ── Build overhead drain (near Founders Valley) ────────────────────────────

  function buildOverheadDrain() {
    disposeMesh(overheadDrainRef.current)
    overheadDrainRef.current = null

    const geo = new THREE.TorusGeometry(3.5, 0.22, 8, 24)
    const mat = new THREE.MeshBasicMaterial({
      color:       COLOR_OVERHEAD_RED,
      transparent: true,
      opacity:     0.4,
      depthWrite:  false,
    })
    const mesh = new THREE.Mesh(geo, mat)
    mesh.rotation.x = -Math.PI / 2
    mesh.position.set(RIVER_X, RIVER_Y + 0.12, 30)   // near valley center, slightly south
    scene.add(mesh)
    overheadDrainRef.current = mesh
  }

  // ── Build net cash flow indicator ─────────────────────────────────────────

  function buildNetFlowIndicator(fin: RiverFinancials) {
    disposeMesh(netFlowSpriteRef.current)
    netFlowSpriteRef.current = null

    const arrow   = fin.netCashFlow >= 0 ? '▲' : '▼'
    const color   = fin.netCashFlow >= 0 ? '#00ff88' : '#ff4444'
    const amount  = fmtDollars(Math.abs(fin.netCashFlow))
    const label   = `NET ${arrow} ${amount}/mo`

    const sprite  = makeTextSprite(label, { fontSize: 20, color, bgColor: 'rgba(0,0,0,0.7)' })
    sprite.position.set(RIVER_X, 7.0, 0)   // floating above river center
    scene.add(sprite)
    netFlowSpriteRef.current = sprite
  }

  // ── Build click hit mesh ───────────────────────────────────────────────────

  function buildClickHit() {
    disposeMesh(clickHitMeshRef.current)
    clickHitMeshRef.current = null

    const geo = new THREE.PlaneGeometry(40, RIVER_Z_LEN)
    const mat = new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide })
    const mesh = new THREE.Mesh(geo, mat)
    mesh.rotation.x = -Math.PI / 2
    mesh.position.set(RIVER_X, RIVER_Y + 0.1, (RIVER_Z_MIN + RIVER_Z_MAX) / 2)
    mesh.name = 'river-click-hit'
    scene.add(mesh)
    clickHitMeshRef.current = mesh
  }

  // ── Full build ─────────────────────────────────────────────────────────────

  function buildAll(data: NWWorldData) {
    const fin = deriveFinancials(data)
    finRef.current = fin
    buildRiver(fin)
    buildTributaries(data.projects, data.solarIncome)
    buildFlowParticles(fin, data.projects)
    buildDrainPulses(data.projects)
    buildOverheadDrain()
    buildNetFlowIndicator(fin)
    buildClickHit()
  }

  // ── Subscribe to world data ────────────────────────────────────────────────

  useEffect(() => {
    const unsub = subscribeWorldData((data: NWWorldData) => {
      buildAll(data)
    })
    return () => {
      unsub()
      disposeAll()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene])

  // ── Animation loop ─────────────────────────────────────────────────────────

  useEffect(() => {
    const raycaster = new THREE.Raycaster()
    const mouse     = new THREE.Vector2()

    function onFrame() {
      elapsedRef.current += 0.016   // ~60fps

      const t   = elapsedRef.current
      const fin = finRef.current

      // ── Animate river surface shimmer ──────────────────────────────────────
      if (riverSurfaceRef.current) {
        const mat = riverSurfaceRef.current.material as THREE.MeshLambertMaterial
        const col = cashFlowColor(fin?.cashFlowHealth ?? 0.7)
        const shimmer = 0.18 + Math.sin(t * 1.8) * 0.06
        mat.emissive.copy(col).multiplyScalar(shimmer)
        mat.opacity = 0.65 + Math.sin(t * 2.3) * 0.07
        mat.needsUpdate = true

        // Gently pulse river width (breathing effect)
        const breathe = 1.0 + Math.sin(t * 0.9) * 0.015
        riverSurfaceRef.current.scale.x = breathe
        if (riverMeshRef.current) riverMeshRef.current.scale.x = breathe
      }

      // ── Animate flow particles ─────────────────────────────────────────────
      for (const fp of flowParticlesRef.current) {
        if (!fp.active) {
          fp.countdown--
          if (fp.countdown <= 0) {
            fp.active = true
            fp.t = 0
            fp.dropTriggered = false
          }
          continue
        }

        // Move toward z=0 (Founders Valley)
        const dir = fp.mesh.position.z > 0 ? -1 : fp.mesh.position.z < -10 ? 1 : 0
        fp.mesh.position.z += dir * fp.speed * 60   // scale to per-frame

        // Check arrival near center
        if (Math.abs(fp.mesh.position.z) < 8 && !fp.dropTriggered) {
          fp.dropTriggered = true
          // Payment arrives — grow slightly
          fp.mesh.scale.setScalar(1.6)
          setTimeout(() => {
            if (fp.mesh) fp.mesh.scale.setScalar(1.0)
          }, 300)
        }

        // Respawn at far end
        if (Math.abs(fp.mesh.position.z) > RIVER_Z_LEN / 2 + 10) {
          const newZ = (Math.random() > 0.5 ? 1 : -1) * (80 + Math.random() * 100)
          fp.mesh.position.z = newZ
          fp.dropTriggered = false
        }

        // Gold glow follows particle
        const meshWithGlow = fp.mesh as THREE.Mesh & { _glow?: THREE.PointLight }
        if (meshWithGlow._glow) {
          meshWithGlow._glow.position.copy(fp.mesh.position)
          meshWithGlow._glow.intensity = 0.5 + Math.sin(t * 4) * 0.25
        }

        // Gentle bob
        fp.mesh.position.y = RIVER_Y + (fp.isGold ? 0.42 : 0.28) + Math.sin(t * 3 + fp.t * 10) * 0.06
      }

      // ── Animate drain pulses ───────────────────────────────────────────────
      for (const dp of drainPulsesRef.current) {
        if (!dp.active) continue
        dp.t += 0.025
        const pulse = (Math.sin(dp.t) * 0.5 + 0.5)
        const mat   = dp.mesh.material as THREE.MeshBasicMaterial
        mat.opacity = pulse * 0.55
        dp.mesh.scale.setScalar(0.8 + pulse * 0.4)
      }

      // ── Animate overhead drain (steady pulse) ─────────────────────────────
      if (overheadDrainRef.current) {
        const mat = overheadDrainRef.current.material as THREE.MeshBasicMaterial
        mat.opacity = 0.25 + Math.sin(t * 1.2) * 0.18
        overheadDrainRef.current.rotation.z = t * 0.4
      }

      // ── Pulse net flow sprite (gentle bob) ────────────────────────────────
      if (netFlowSpriteRef.current) {
        netFlowSpriteRef.current.position.y = 7.0 + Math.sin(t * 1.1) * 0.18
      }
    }

    // ── Click handler ──────────────────────────────────────────────────────

    function onPointerDown(e: MouseEvent) {
      if (!clickHitMeshRef.current || !camera || !renderer) return

      const canvas = renderer.domElement
      const rect   = canvas.getBoundingClientRect()
      mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
      mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1

      raycaster.setFromCamera(mouse, camera)
      const hits = raycaster.intersectObject(clickHitMeshRef.current)
      if (hits.length > 0) {
        setPanelPos({ x: e.clientX, y: e.clientY })
        setPanelOpen(true)
      }
    }

    window.addEventListener('nw:frame', onFrame)
    window.addEventListener('pointerdown', onPointerDown)
    return () => {
      window.removeEventListener('nw:frame', onFrame)
      window.removeEventListener('pointerdown', onPointerDown)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera, renderer])

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <>
      {panelOpen && finRef.current && (
        <RiverPanel
          fin={finRef.current}
          screenX={panelPos.x}
          screenY={panelPos.y}
          onClose={() => setPanelOpen(false)}
        />
      )}
    </>
  )
}
