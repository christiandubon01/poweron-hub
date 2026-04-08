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

const STATIC_POSITIONS: Record<string, THREE.Vector3> = {
  VAULT:        new THREE.Vector3(-172, 6,   80),
  LEDGER:       new THREE.Vector3(-30,  6,   25),
  OHM:          new THREE.Vector3(-165, 6,  -110),
  CHRONO:       new THREE.Vector3(-105, 6,    0),
  BLUEPRINT:    new THREE.Vector3(-130, 6,  -70),
  SPARK:        new THREE.Vector3( 60,  10, -120),
  SCOUT:        new THREE.Vector3( 160, 6,    0),
  ECHO:         new THREE.Vector3( 110, 6,  130),
  ATLAS:        new THREE.Vector3( 75,  6,   80),
  NEXUS:        new THREE.Vector3( 110, 6,  -60),
  MTZ_PLATEAU:  new THREE.Vector3(-175, 5,  160),
  NDA_GATE:     new THREE.Vector3( 25,  5,    0),
  IP_FORTRESS:  new THREE.Vector3( 190, 8,    0),
  MRR_MOUNTAIN: new THREE.Vector3( 100, 8,    0),
}

// ── Info panel component ───────────────────────────────────────────────────────

interface InfoPanelProps {
  node: ClickableNode
  screenX: number
  screenY: number
  onClose: () => void
}

function InfoPanel({ node, screenX, screenY, onClose }: InfoPanelProps) {
  const panelWidth = 280
  const panelHeight = 320
  const margin = 12

  // Clamp to viewport
  const x = Math.min(Math.max(screenX + 18, margin), window.innerWidth  - panelWidth  - margin)
  const y = Math.min(Math.max(screenY - 80,  margin), window.innerHeight - panelHeight - margin)

  return (
    <div
      onClick={e => e.stopPropagation()}
      style={{
        position: 'fixed',
        left: x,
        top: y,
        width: panelWidth,
        zIndex: 60,
        background: 'rgba(5, 5, 15, 0.92)',
        border: `1px solid ${node.accentColor}55`,
        borderRadius: 8,
        backdropFilter: 'blur(14px)',
        boxShadow: `0 0 28px ${node.accentColor}22, 0 4px 24px rgba(0,0,0,0.7)`,
        fontFamily: 'monospace',
        animation: 'nw-node-panel-in 0.18s ease',
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div style={{
        padding: '10px 12px 8px',
        borderBottom: `1px solid ${node.accentColor}33`,
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: 8,
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 14,
            fontWeight: 700,
            color: node.accentColor,
            letterSpacing: 1.5,
            textShadow: `0 0 8px ${node.accentColor}60`,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}>
            {node.name}
          </div>
          <div style={{
            fontSize: 9,
            color: 'rgba(255,255,255,0.45)',
            letterSpacing: 1,
            marginTop: 2,
          }}>
            {node.type}
          </div>
        </div>
        <button
          onClick={onClose}
          style={{
            background: 'none',
            border: `1px solid rgba(255,255,255,0.15)`,
            color: 'rgba(255,255,255,0.5)',
            fontSize: 13,
            cursor: 'pointer',
            borderRadius: 3,
            padding: '1px 6px',
            lineHeight: 1.4,
            flexShrink: 0,
          }}
        >
          ✕
        </button>
      </div>

      {/* Description */}
      <div style={{ padding: '8px 12px', borderBottom: `1px solid rgba(255,255,255,0.06)` }}>
        <div style={{
          fontSize: 10,
          color: 'rgba(255,255,255,0.68)',
          lineHeight: 1.55,
          letterSpacing: 0.3,
        }}>
          {node.description}
        </div>
      </div>

      {/* Connections */}
      {node.connections.length > 0 && (
        <div style={{ padding: '6px 12px', borderBottom: `1px solid rgba(255,255,255,0.06)` }}>
          <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.3)', letterSpacing: 1.5, marginBottom: 5 }}>
            CONNECTIONS
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {node.connections.map((c, i) => (
              <span key={i} style={{
                fontSize: 9,
                color: node.accentColor,
                background: `${node.accentColor}18`,
                border: `1px solid ${node.accentColor}44`,
                borderRadius: 3,
                padding: '1px 6px',
                letterSpacing: 0.5,
              }}>
                {c}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Metrics */}
      <div style={{ padding: '6px 12px 10px' }}>
        <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.3)', letterSpacing: 1.5, marginBottom: 6 }}>
          KEY METRICS
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {Object.entries(node.metrics).map(([key, val]) => (
            <div key={key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.38)', letterSpacing: 0.5 }}>{key}</span>
              <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.75)', fontWeight: 600, letterSpacing: 0.5, textAlign: 'right', maxWidth: 150 }}>
                {typeof val === 'number' ? val.toLocaleString() : val}
              </span>
            </div>
          ))}
        </div>
      </div>
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

  useEffect(() => {
    STATIC_NODES.forEach(nodeDef => {
      const pos = STATIC_POSITIONS[nodeDef.id]
      if (!pos) return
      const node: ClickableNode = { ...nodeDef, worldPos: pos.clone() }
      registerNode(node)
    })

    return () => {
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
        const pos2d = seededPosition(p.id)
        const height = contractValueToHeight(p.contract_value)
        const pos = new THREE.Vector3(pos2d.x, height + 2, pos2d.z)

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
  }, [])

  if (!selectedNode) return null

  return (
    <InfoPanel
      node={selectedNode}
      screenX={panelScreenPos.x}
      screenY={panelScreenPos.y}
      onClose={handleClose}
    />
  )
}
