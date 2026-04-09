/**
 * NodeClickSystem.tsx — NW18: Clickable 3D nodes with floating info panels.
 *
 * Creates invisible sphere hit-meshes at all known node positions.
 * On click:
 *   - Raycasts against hit spheres
 *   - Highlights selected node with emissive glow ring
 *   - Shows React overlay info panel (positioned at screen projection of 3D point)
 *   - Only one panel open at a time
 *   - Dismiss via X button or clicking elsewhere
 *
 * Nodes registered:
 *   - West admin: VAULT, LEDGER, OHM, CHRONO, BLUEPRINT
 *   - East admin: SPARK, SCOUT, ECHO, ATLAS, NEXUS
 *   - MTZ Solar Plateau
 *   - NDA Gate, IP Fortress
 *   - MRR Mountain (east)
 *   - Dynamic project mountains (from DataBridge)
 *   - Dynamic subscription towers (from DataBridge)
 */

import React, { useEffect, useRef, useState, useCallback } from 'react'
import * as THREE from 'three'
import { useWorldContext } from './WorldContext'
import { getNodePosition } from './NodePositionStore'
import {
  subscribeWorldData,
  seededPosition,
  contractValueToHeight,
  type NWWorldData,
  type NWProject,
} from './DataBridge'

// ── Node metadata ──────────────────────────────────────────────────────────────

export interface ClickableNode {
  id: string
  name: string
  type: string
  description: string
  connections: string[]
  metrics: Record<string, string | number>
  worldPos: THREE.Vector3
  accentColor: string
}

// ── Static node definitions ───────────────────────────────────────────────────

const STATIC_NODES: Omit<ClickableNode, 'worldPos'>[] = [
  {
    id: 'VAULT',
    name: 'VAULT',
    type: 'Agent — Project Intelligence',
    description: 'Monitors all project health signals, budget overruns, and schedule deviations. Fires alerts when projects breach thresholds.',
    connections: ['All project mountains', 'LEDGER', 'CHRONO'],
    metrics: { Role: 'Project Health Monitor', Coverage: 'All active projects', Status: 'Watching' },
    accentColor: '#ff8040',
  },
  {
    id: 'LEDGER',
    name: 'LEDGER',
    type: 'Agent — Accounts Receivable',
    description: 'Tracks all invoices, payment aging, and collection flow. Connects to AR stalactites above project mountains.',
    connections: ['AR stalactites', 'VAULT', 'OHM'],
    metrics: { Role: 'AR + Collections', Tracks: 'All invoices', Status: 'Active' },
    accentColor: '#00aaff',
  },
  {
    id: 'OHM',
    name: 'OHM',
    type: 'Agent — Overhead Monitor',
    description: 'Watches overhead ratios, labor costs, and profitability margins across all projects.',
    connections: ['VAULT', 'LEDGER', 'CHRONO'],
    metrics: { Role: 'Cost + Overhead', Tracks: 'Labor, materials, margins', Status: 'Active' },
    accentColor: '#00ff88',
  },
  {
    id: 'CHRONO',
    name: 'CHRONO',
    type: 'Agent — Schedule Intelligence',
    description: 'Manages project timelines, deadline detection, and crew scheduling conflicts.',
    connections: ['All project mountains', 'VAULT', 'BLUEPRINT'],
    metrics: { Role: 'Schedule Monitor', Tracks: 'Deadlines + crew calendar', Status: 'Active' },
    accentColor: '#cc88ff',
  },
  {
    id: 'BLUEPRINT',
    name: 'BLUEPRINT',
    type: 'Agent — Estimating AI',
    description: 'Generates project estimates, scope analysis, and cost modeling using AI-driven price book.',
    connections: ['VAULT', 'OHM', 'SPARK'],
    metrics: { Role: 'Estimating + Proposals', Tracks: 'Bids + price book', Status: 'Active' },
    accentColor: '#00ffdd',
  },
  {
    id: 'SPARK',
    name: 'SPARK',
    type: 'Agent — Lead Intelligence (East)',
    description: 'Broadcasting tower for live call intelligence and lead pipeline. Lead flow radiates outward from this tower.',
    connections: ['Lead pipeline', 'NEXUS', 'ATLAS'],
    metrics: { Role: 'Live Calls + Leads', Broadcasts: 'Lead flow outward', Status: 'Broadcasting' },
    accentColor: '#ff6600',
  },
  {
    id: 'SCOUT',
    name: 'SCOUT',
    type: 'Agent — Market Scout (East)',
    description: 'Surveys market signals, new opportunities, and service area expansion prospects.',
    connections: ['SPARK', 'ATLAS', 'NEXUS'],
    metrics: { Role: 'Market Intelligence', Tracks: 'Territory signals', Status: 'Scanning' },
    accentColor: '#00ccff',
  },
  {
    id: 'ECHO',
    name: 'ECHO',
    type: 'Agent — Context Memory (East)',
    description: 'Maintains conversation context and business memory across all agent interactions.',
    connections: ['NEXUS', 'All agents'],
    metrics: { Role: 'Context + Memory', Stores: 'Business history', Status: 'Active' },
    accentColor: '#6600ff',
  },
  {
    id: 'ATLAS',
    name: 'ATLAS',
    type: 'Agent — Territory Map (East)',
    description: 'Maps client territories, service areas, and geographic revenue concentration.',
    connections: ['SPARK', 'SCOUT', 'NEXUS'],
    metrics: { Role: 'Territory Intelligence', Covers: 'All service zones', Status: 'Active' },
    accentColor: '#00ff88',
  },
  {
    id: 'NEXUS',
    name: 'NEXUS',
    type: 'Agent — Orchestration Brain (East)',
    description: 'Central routing engine for all AI queries. Classifies intent and routes to the right agent with full context injection.',
    connections: ['All agents', 'ECHO', 'BLUEPRINT'],
    metrics: { Role: 'AI Orchestration Hub', Routes: 'All agent queries', Status: 'Active' },
    accentColor: '#ff00ff',
  },
  {
    id: 'MTZ_PLATEAU',
    name: 'MTZ Solar Plateau',
    type: 'Revenue Zone — Solar Income',
    description: 'Elevated plateau representing solar project revenue. Platform size scales with total solar income.',
    connections: ['OHM', 'VAULT'],
    metrics: { Type: 'Solar Income Platform', Source: 'Solar project revenue', Location: 'SW West Continent' },
    accentColor: '#ffee00',
  },
  {
    id: 'NDA_GATE',
    name: 'NDA Gate',
    type: 'Access Control — Subscriber Entry',
    description: 'Entry gate to the PowerOn Hub east continent. Subscribers pass through here and travel to their subscription towers.',
    connections: ['Subscription towers', 'SPARK'],
    metrics: { Type: 'Subscriber Entry', Controls: 'Hub access', Location: 'East entry x=25' },
    accentColor: '#00ffff',
  },
  {
    id: 'IP_FORTRESS',
    name: 'IP Fortress',
    type: 'Defense Structure — IP Protection',
    description: 'Fortress wall on east edge representing intellectual property filings. Height increases with each IP filing.',
    connections: ['NEXUS', 'ECHO'],
    metrics: { Type: 'IP Protection', Location: 'East edge x=190', Status: 'Guarding' },
    accentColor: '#ff4444',
  },
  {
    id: 'MRR_MOUNTAIN',
    name: 'MRR Mountain',
    type: 'Revenue Terrain — Monthly Recurring Revenue',
    description: 'Central peak on east continent representing total monthly recurring revenue from Hub subscribers. Height = MRR ÷ 500.',
    connections: ['Subscription towers', 'LEDGER'],
    metrics: { Type: 'MRR Visualizer', Location: 'East continent center', Scale: 'Height = MRR/500' },
    accentColor: '#4488ff',
  },
]

// NW24: default positions — actual positions resolved at runtime via NodePositionStore
const STATIC_POSITION_DEFAULTS: Record<string, { x: number; y: number; z: number }> = {
  VAULT:        { x: -172, y: 6,  z:   80 },
  LEDGER:       { x:  -30, y: 6,  z:   25 },
  OHM:          { x: -165, y: 6,  z: -110 },
  CHRONO:       { x: -105, y: 6,  z:    0 },
  BLUEPRINT:    { x: -130, y: 6,  z:  -70 },
  SPARK:        { x:   60, y: 10, z: -120 },
  SCOUT:        { x:  160, y: 6,  z:    0 },
  ECHO:         { x:  110, y: 6,  z:  130 },
  ATLAS:        { x:   75, y: 6,  z:   80 },
  NEXUS:        { x:  110, y: 6,  z:  -60 },
  MTZ_PLATEAU:  { x: -175, y: 5,  z:  160 },
  NDA_GATE:     { x:   25, y: 5,  z:    0 },
  IP_FORTRESS:  { x:  190, y: 8,  z:    0 },
  MRR_MOUNTAIN: { x:  100, y: 8,  z:    0 },
}

function resolveStaticPositions(): Record<string, THREE.Vector3> {
  const result: Record<string, THREE.Vector3> = {}
  for (const [id, def] of Object.entries(STATIC_POSITION_DEFAULTS)) {
    const pos = getNodePosition(id, def.x, def.z)
    result[id] = new THREE.Vector3(pos.x, def.y, pos.z)
  }
  return result
}

// ── NW27: Scrollable body — captures wheel events natively to prevent camera zoom ─

function ScrollBody({ children }: { children: React.ReactNode }) {
  const divRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = divRef.current
    if (!el) return
    // NW27: Stop wheel events from bubbling to document/canvas handlers
    // so panel content scrolls without affecting camera zoom or browser scroll
    const handler = (e: WheelEvent) => { e.stopPropagation() }
    el.addEventListener('wheel', handler)
    return () => el.removeEventListener('wheel', handler)
  }, [])
  return (
    <div
      ref={divRef}
      style={{
        overflowY: 'auto',
        maxHeight: 340,
        // Thin scrollbar styling
        scrollbarWidth: 'thin',
        scrollbarColor: 'rgba(46,232,154,0.35) transparent',
      } as React.CSSProperties}
    >
      {children}
    </div>
  )
}

// ── Info panel component ───────────────────────────────────────────────────────

interface InfoPanelProps {
  node: ClickableNode
  screenX: number
  screenY: number
  onClose: () => void
  /** NW27: Distance-based scale factor (1.0 near, up to 3.0 far) */
  scale: number
}

function InfoPanel({ node, screenX, screenY, onClose, scale }: InfoPanelProps) {
  // NW27: min 320px, max 450px — 380px fits nicely
  const panelWidth = 380
  const margin = 12

  // Account for scale when clamping to viewport (transform-origin: top left)
  const scaledW = panelWidth * scale
  const scaledH = 480 * scale   // approx max panel height × scale

  const x = Math.max(margin, Math.min(window.innerWidth  - scaledW - margin, screenX + 18))
  const y = Math.max(margin, Math.min(window.innerHeight - scaledH - margin, screenY - 80))

  return (
    <div
      onClick={e => e.stopPropagation()}
      style={{
        position: 'fixed',
        left: x,
        top: y,
        width: panelWidth,
        zIndex: 60,
        // NW27: high-contrast dark background
        background: 'rgba(10,10,16,0.95)',
        // NW27: green accent border
        border: '1px solid rgba(46,232,154,0.3)',
        borderRadius: 12,
        backdropFilter: 'blur(16px)',
        boxShadow: `0 0 32px ${node.accentColor}1a, 0 6px 32px rgba(0,0,0,0.8)`,
        fontFamily: 'monospace',
        animation: 'nw-node-panel-in 0.18s ease',
        // NW27: distance-based scale (billboard behavior for 2D overlay)
        transform: `scale(${scale})`,
        transformOrigin: 'top left',
      }}
    >
      {/* Header */}
      <div style={{
        padding: '14px 16px 10px',
        borderBottom: `1px solid ${node.accentColor}33`,
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: 8,
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* NW27: title font 16px */}
          <div style={{
            fontSize: 16,
            fontWeight: 700,
            color: node.accentColor,
            letterSpacing: 1.5,
            textShadow: `0 0 10px ${node.accentColor}60`,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}>
            {node.name}
          </div>
          <div style={{
            fontSize: 11,
            color: 'rgba(255,255,255,0.55)',
            letterSpacing: 1,
            marginTop: 3,
          }}>
            {node.type}
          </div>
        </div>
        <button
          onClick={onClose}
          style={{
            background: 'none',
            border: '1px solid rgba(255,255,255,0.2)',
            color: 'rgba(255,255,255,0.65)',
            fontSize: 14,
            cursor: 'pointer',
            borderRadius: 4,
            padding: '2px 8px',
            lineHeight: 1.4,
            flexShrink: 0,
            transition: 'all 0.12s',
          }}
        >
          ✕
        </button>
      </div>

      {/* Scrollable body — NW27: scroll captures here, doesn't propagate to camera */}
      <ScrollBody>
        {/* Description — NW27: body font 13px minimum */}
        <div style={{ padding: '12px 16px', borderBottom: `1px solid rgba(255,255,255,0.07)` }}>
          <div style={{
            fontSize: 13,
            color: 'rgba(255,255,255,0.82)',
            lineHeight: 1.65,
            letterSpacing: 0.3,
          }}>
            {node.description}
          </div>
        </div>

        {/* Connections */}
        {node.connections.length > 0 && (
          <div style={{ padding: '10px 16px', borderBottom: `1px solid rgba(255,255,255,0.07)` }}>
            <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.35)', letterSpacing: 1.5, marginBottom: 6 }}>
              CONNECTIONS
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {node.connections.map((c, i) => (
                <span key={i} style={{
                  fontSize: 11,
                  color: node.accentColor,
                  background: `${node.accentColor}18`,
                  border: `1px solid ${node.accentColor}44`,
                  borderRadius: 3,
                  padding: '2px 7px',
                  letterSpacing: 0.5,
                }}>
                  {c}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Metrics */}
        <div style={{ padding: '10px 16px 14px' }}>
          <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.35)', letterSpacing: 1.5, marginBottom: 8 }}>
            KEY METRICS
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {Object.entries(node.metrics).map(([key, val]) => (
              <div key={key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', letterSpacing: 0.5 }}>{key}</span>
                <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.88)', fontWeight: 600, letterSpacing: 0.5, textAlign: 'right', maxWidth: 180 }}>
                  {typeof val === 'number' ? val.toLocaleString() : val}
                </span>
              </div>
            ))}
          </div>
        </div>
      </ScrollBody>
    </div>
  )
}

// ── CSS animation injection (runs once) ───────────────────────────────────────

let _cssInjected = false
function injectCSS() {
  if (_cssInjected) return
  _cssInjected = true
  const style = document.createElement('style')
  style.textContent = `
    @keyframes nw-node-panel-in {
      from { opacity: 0; transform: scale(0.92) translateY(6px); }
      to   { opacity: 1; transform: scale(1)    translateY(0); }
    }
    @keyframes nw-glow-pulse {
      0%,100% { opacity: 0.6; transform: scale(1.0); }
      50%      { opacity: 1.0; transform: scale(1.15); }
    }
  `
  document.head.appendChild(style)
}

// ── Main component ─────────────────────────────────────────────────────────────

export function NodeClickSystem() {
  const { scene, camera, renderer } = useWorldContext()

  // Hit spheres: id → mesh
  const hitMeshesRef = useRef<Map<string, THREE.Mesh>>(new Map())
  // Glow rings: id → mesh (visible highlight)
  const glowMeshesRef = useRef<Map<string, THREE.Mesh>>(new Map())
  // Current highlighted node id
  const selectedIdRef = useRef<string | null>(null)

  // Info panel state
  const [selectedNode, setSelectedNode] = useState<ClickableNode | null>(null)
  const [panelScreenPos, setPanelScreenPos] = useState({ x: 0, y: 0 })
  // NW27: Distance-based panel scale (1.0 near → 3.0 far)
  const [panelScale, setPanelScale] = useState(1.0)
  const panelScaleRef = useRef(1.0)

  // All node metadata by id
  const nodesRef = useRef<Map<string, ClickableNode>>(new Map())

  // Raycaster
  const raycasterRef = useRef(new THREE.Raycaster())

  injectCSS()

  // ── Project node color by status ────────────────────────────────────────────

  function projectColor(p: NWProject): string {
    if (p.status === 'completed') return '#00ff88'
    if (p.status === 'in_progress') return '#00aaff'
    if (p.status === 'on_hold') return '#ff8800'
    if (p.status === 'cancelled') return '#ff4444'
    if (p.status === 'lead') return '#ffee00'
    return '#00e5cc'
  }

  // ── Register a node (create hit sphere + glow mesh) ─────────────────────────

  const registerNode = useCallback((node: ClickableNode) => {
    // Remove old mesh if re-registering
    const old = hitMeshesRef.current.get(node.id)
    if (old) {
      scene.remove(old)
      old.geometry.dispose()
    }
    const oldGlow = glowMeshesRef.current.get(node.id)
    if (oldGlow) {
      scene.remove(oldGlow)
      oldGlow.geometry.dispose()
      ;(oldGlow.material as THREE.Material).dispose()
    }

    // Hit sphere (invisible)
    const hitGeo = new THREE.SphereGeometry(5, 8, 6)
    const hitMat = new THREE.MeshBasicMaterial({ visible: false, side: THREE.FrontSide })
    const hitMesh = new THREE.Mesh(hitGeo, hitMat)
    hitMesh.position.copy(node.worldPos)
    hitMesh.userData = { nodeId: node.id }
    scene.add(hitMesh)
    hitMeshesRef.current.set(node.id, hitMesh)

    // Glow ring (initially invisible, shown on selection)
    const glowGeo = new THREE.TorusGeometry(5.5, 0.35, 8, 32)
    const color = new THREE.Color(node.accentColor)
    const glowMat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    })
    const glowMesh = new THREE.Mesh(glowGeo, glowMat)
    glowMesh.position.copy(node.worldPos)
    glowMesh.rotation.x = Math.PI / 2  // lay flat around node
    scene.add(glowMesh)
    glowMeshesRef.current.set(node.id, glowMesh)

    nodesRef.current.set(node.id, node)
  }, [scene])

  // ── Register static nodes ───────────────────────────────────────────────────

  // NW24: suppress click handling when EDIT LAYOUT is active
  const isEditModeRef = useRef(false)

  useEffect(() => {
    // NW24: resolve positions (with overrides) and register static nodes
    const STATIC_POSITIONS = resolveStaticPositions()

    STATIC_NODES.forEach(nodeDef => {
      const pos = STATIC_POSITIONS[nodeDef.id]
      if (!pos) return
      const node: ClickableNode = { ...nodeDef, worldPos: pos.clone() }
      registerNode(node)
    })

    // NW24: Edit layout mode toggle — suppress clicks during drag
    function onEditLayout(e: Event) {
      const ev = e as CustomEvent<{ active: boolean }>
      isEditModeRef.current = !!ev.detail?.active
    }

    // NW24: Update hit mesh position when a node is moved
    function onNodeMoved(e: Event) {
      const ev = e as CustomEvent<{ id: string; x: number; z: number }>
      if (!ev.detail) return
      const { id, x, z } = ev.detail
      const hitMesh = hitMeshesRef.current.get(id)
      const glowMesh = glowMeshesRef.current.get(id)
      if (hitMesh) { hitMesh.position.x = x; hitMesh.position.z = z }
      if (glowMesh) { glowMesh.position.x = x; glowMesh.position.z = z }
      const nodeData = nodesRef.current.get(id)
      if (nodeData) { nodeData.worldPos.x = x; nodeData.worldPos.z = z }
    }

    // NW24: Reset hit meshes to default positions
    function onPositionsReset() {
      const defaults = resolveStaticPositions()
      for (const [id, vec] of Object.entries(defaults)) {
        const hitMesh = hitMeshesRef.current.get(id)
        const glowMesh = glowMeshesRef.current.get(id)
        if (hitMesh) { hitMesh.position.x = vec.x; hitMesh.position.z = vec.z }
        if (glowMesh) { glowMesh.position.x = vec.x; glowMesh.position.z = vec.z }
      }
    }

    window.addEventListener('nw:edit-layout-active', onEditLayout)
    window.addEventListener('nw:node-moved', onNodeMoved)
    window.addEventListener('nw:positions-reset', onPositionsReset)

    return () => {
      window.removeEventListener('nw:edit-layout-active', onEditLayout)
      window.removeEventListener('nw:node-moved', onNodeMoved)
      window.removeEventListener('nw:positions-reset', onPositionsReset)
      hitMeshesRef.current.forEach(m => {
        scene.remove(m)
        m.geometry.dispose()
        ;(m.material as THREE.Material).dispose()
      })
      glowMeshesRef.current.forEach(m => {
        scene.remove(m)
        m.geometry.dispose()
        ;(m.material as THREE.Material).dispose()
      })
      hitMeshesRef.current.clear()
      glowMeshesRef.current.clear()
      nodesRef.current.clear()
    }
  }, [scene, registerNode])

  // ── Subscribe to world data for dynamic project/subscription nodes ──────────

  useEffect(() => {
    const unsub = subscribeWorldData((data: NWWorldData) => {
      // Register project mountains
      data.projects.forEach((p: NWProject) => {
        const seed = seededPosition(p.id)
        const overridePos = getNodePosition(`P_${p.id}`, seed.x, seed.z)
        const height = contractValueToHeight(p.contract_value)
        const pos = new THREE.Vector3(overridePos.x, height + 2, overridePos.z)

        const unpaidInvoices = data.invoices.filter(
          inv => inv.project_id === p.id && inv.status !== 'paid'
        )
        const paidInvoices = data.invoices.filter(
          inv => inv.project_id === p.id && inv.status === 'paid'
        )
        const totalRevenue = paidInvoices.reduce((s, inv) => s + inv.amount, 0)
        const crewIds = [...new Set(
          data.fieldLogs
            .filter(fl => fl.project_id === p.id)
            .map(fl => fl.crew_id)
            .filter(Boolean)
        )]

        const node: ClickableNode = {
          id: `project_${p.id}`,
          name: p.name,
          type: `Project Mountain — ${p.status.replace('_', ' ').toUpperCase()}`,
          description: `Active project on the west continent. Mountain height reflects contract value. Connected to VAULT monitoring, LEDGER invoicing, and assigned crew via labor ridges.`,
          connections: [
            'VAULT (health monitor)',
            unpaidInvoices.length > 0 ? `${unpaidInvoices.length} unpaid invoice(s)` : 'LEDGER (invoices clear)',
            crewIds.length > 0 ? `${crewIds.length} crew member(s)` : 'No crew assigned',
          ],
          metrics: {
            'Contract Value': `$${p.contract_value.toLocaleString()}`,
            'Health Score':   `${Math.round(p.health_score)}%`,
            'Phase':          `${Math.round(p.phase_completion)}% complete`,
            'Revenue In':     `$${Math.round(totalRevenue).toLocaleString()}`,
            'Open Invoices':  unpaidInvoices.length,
            'Status':         p.status.replace('_', ' '),
          },
          worldPos: pos,
          accentColor: projectColor(p),
        }
        registerNode(node)
      })

      // Register subscription towers (approximated positions on east continent)
      const tiers = ['solo', 'growth', 'pro', 'proplus', 'enterprise']
      const tierColors: Record<string, string> = {
        solo: '#00ff88', growth: '#0088ff', pro: '#8800ff', proplus: '#ff8800', enterprise: '#4488ff'
      }
      const tierPrices: Record<string, string> = {
        solo: '$49/mo', growth: '$129/mo', pro: '$299/mo', proplus: '$499/mo', enterprise: '$800+/mo'
      }
      const hubSubs = data.accountingSignals.hubSubscriberCount
      const perTier = Math.max(1, Math.floor(hubSubs / 5))

      tiers.forEach((tier, i) => {
        const x = 40 + i * 30
        const z = -80 + i * 40
        const node: ClickableNode = {
          id: `sub_tower_${tier}`,
          name: `${tier.toUpperCase()} Tower`,
          type: `Subscription Tier — Hub Software`,
          description: `Subscription tower for the ${tier.charAt(0).toUpperCase() + tier.slice(1)} tier. Tower count = subscriber count per tier. Subscribers flow from the NDA Gate to these towers.`,
          connections: ['NDA Gate', 'MRR Mountain', 'SPARK'],
          metrics: {
            'Tier': tier.charAt(0).toUpperCase() + tier.slice(1),
            'Price': tierPrices[tier],
            'Est. Subscribers': perTier,
            'MRR Contribution': `$${(perTier * parseInt(tierPrices[tier].replace(/[^0-9]/g,''), 10)).toLocaleString()}`,
          },
          worldPos: new THREE.Vector3(x, 8 + i * 2, z),
          accentColor: tierColors[tier],
        }
        registerNode(node)
      })
    })
    return unsub
  }, [registerNode])

  // ── Glow pulse animation via nw:frame ───────────────────────────────────────

  useEffect(() => {
    function onFrame() {
      const t = Date.now() * 0.003
      const selId = selectedIdRef.current
      glowMeshesRef.current.forEach((mesh, id) => {
        const mat = mesh.material as THREE.MeshBasicMaterial
        if (id === selId) {
          mat.opacity = 0.55 + 0.45 * Math.sin(t * 2)
          mesh.rotation.z = t * 0.6
        } else {
          mat.opacity = 0
        }
      })
    }
    window.addEventListener('nw:frame', onFrame)
    return () => window.removeEventListener('nw:frame', onFrame)
  }, [])

  // ── Click handler ────────────────────────────────────────────────────────────

  useEffect(() => {
    const canvas = renderer.domElement

    function onClick(event: MouseEvent) {
      // NW24: Suppress node clicks in edit layout mode
      if (isEditModeRef.current || window.__nwEditLayoutActive) return

      const rect = canvas.getBoundingClientRect()
      const mouse = new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width)  * 2 - 1,
        -((event.clientY - rect.top)  / rect.height) * 2 + 1,
      )

      raycasterRef.current.setFromCamera(mouse, camera)
      const hitMeshes = Array.from(hitMeshesRef.current.values())
      const intersects = raycasterRef.current.intersectObjects(hitMeshes, false)

      if (intersects.length > 0) {
        const nodeId = intersects[0].object.userData.nodeId as string
        const node = nodesRef.current.get(nodeId)
        if (!node) return

        // Deselect old
        if (selectedIdRef.current) {
          const oldGlow = glowMeshesRef.current.get(selectedIdRef.current)
          if (oldGlow) (oldGlow.material as THREE.MeshBasicMaterial).opacity = 0
        }

        selectedIdRef.current = nodeId

        // Project world position to screen
        const worldPos3 = node.worldPos.clone()
        const projected = worldPos3.project(camera)
        const sx = (projected.x + 1) / 2 * canvas.clientWidth
        const sy = (-projected.y + 1) / 2 * canvas.clientHeight

        setPanelScreenPos({ x: event.clientX, y: event.clientY })
        setSelectedNode(node)

        // Dispatch event for other systems
        window.dispatchEvent(new CustomEvent('nw:node-selected', {
          detail: { nodeId, worldPos: { x: node.worldPos.x, y: node.worldPos.y, z: node.worldPos.z }, sx, sy },
        }))

        event.stopPropagation()
      } else {
        // Click on empty space — dismiss panel
        if (selectedIdRef.current) {
          const oldGlow = glowMeshesRef.current.get(selectedIdRef.current)
          if (oldGlow) (oldGlow.material as THREE.MeshBasicMaterial).opacity = 0
          selectedIdRef.current = null
          setSelectedNode(null)
        }
      }
    }

    canvas.addEventListener('click', onClick)
    return () => canvas.removeEventListener('click', onClick)
  }, [camera, renderer])

  // ── Dismiss handler ──────────────────────────────────────────────────────────

  const handleClose = useCallback(() => {
    if (selectedIdRef.current) {
      const glow = glowMeshesRef.current.get(selectedIdRef.current)
      if (glow) (glow.material as THREE.MeshBasicMaterial).opacity = 0
      selectedIdRef.current = null
    }
    setSelectedNode(null)
    setPanelScale(1.0)
    panelScaleRef.current = 1.0
  }, [])

  // NW27: Broadcast panel open/close state so NeuralWorldView can gate its ESC handler
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('nw:panel-state', { detail: { open: !!selectedNode } }))
  }, [selectedNode])

  // NW27: ESC key closes panel (priority over fullscreen exit)
  useEffect(() => {
    if (!selectedNode) return
    function onKeyDown(e: KeyboardEvent) {
      if (e.code === 'Escape') {
        handleClose()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [selectedNode, handleClose])

  // NW27: Dynamic panel scale — updates each frame based on camera-to-node distance
  // distance < 10  → scale 1.0 (1:1 screen size)
  // distance 10-150 → linear interpolation 1.0 → 3.0
  // distance > 150  → scale 3.0 (maximum)
  useEffect(() => {
    if (!selectedNode) return
    function onFrame() {
      const dist = camera.position.distanceTo(selectedNode!.worldPos)
      let raw: number
      if (dist < 10)       raw = 1.0
      else if (dist > 150) raw = 3.0
      else                 raw = 1.0 + ((dist - 10) / 140) * 2.0
      // Round to 1dp to avoid excessive re-renders
      const rounded = Math.round(raw * 10) / 10
      if (Math.abs(rounded - panelScaleRef.current) >= 0.1) {
        panelScaleRef.current = rounded
        setPanelScale(rounded)
      }
    }
    window.addEventListener('nw:frame', onFrame)
    return () => window.removeEventListener('nw:frame', onFrame)
  }, [selectedNode, camera])

  if (!selectedNode) return null

  return (
    <InfoPanel
      node={selectedNode}
      screenX={panelScreenPos.x}
      screenY={panelScreenPos.y}
      onClose={handleClose}
      scale={panelScale}
    />
  )
}
