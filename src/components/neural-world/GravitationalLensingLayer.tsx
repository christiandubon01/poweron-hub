/**
 * GravitationalLensingLayer.tsx — NW51: Gravitational lensing around high-value nodes.
 *
 * HIGH-MASS NODES distort the space around them like gravitational lensing.
 * Top 20% by value get visible influence fields with a custom ShaderMaterial
 * that creates a Fresnel rim / heat-haze shimmer effect.
 *
 * MASS RULES:
 *   - Project mountains:        mass = contract_value (positive — attracts)
 *   - Subscription towers:      mass = monthly_recurring × 12 (positive — attracts)
 *   - AR stalactites (invoices): mass = amount_owed (NEGATIVE — repels)
 *   - Revenue river sections:   mass ∝ monthly throughput
 *
 * TOP-20% NODES GET:
 *   - Transparent SphereGeometry with custom ShaderMaterial (Fresnel + shimmer)
 *   - Sphere radius ∝ mass  (larger value → wider field)
 *   - Ground depression ring  (darker circle radiating outward)
 *   - Edge shimmer ring  (heat-haze at influence boundary)
 *   - Particles nearby deflect toward mass center (fires nw:gravity-deflect event)
 *   - Interference rings where two high-mass fields overlap
 *
 * LAYER TOGGLE: "Gravity Fields" — off by default.
 *
 * INTERACTION:
 *   - Hover inside field → tooltip  "Gravitational influence: $value | Radius: X units"
 *   - Click → side panel showing what this node pulls (crew, cash, attention)
 */

import React, { useEffect, useRef, useState, useCallback } from 'react'
import * as THREE from 'three'
import { useWorldContext } from './WorldContext'
import {
  subscribeWorldData,
  seededPosition,
  type NWWorldData,
  type NWProject,
  type NWInvoice,
} from './DataBridge'

// ── Constants ─────────────────────────────────────────────────────────────────

const TOP_PERCENTILE       = 0.20   // top 20%
const MIN_SPHERE_RADIUS    = 6
const MAX_SPHERE_RADIUS    = 40
const DISTORTION_INTENSITY = 0.04   // 0.02–0.05 per spec
const GROUND_RING_SEGMENTS = 64
const SPHERE_SEGMENTS      = 32
const DEFLECT_RADIUS_MULT  = 1.1    // particle deflects within 110% of sphere radius
const SUBSCRIPTION_MRR     = 500    // fallback MRR per hub-event subscriber (estimated)

// Colors
const COLOR_ATTRACT   = new THREE.Color(0x00e5cc)  // teal — positive mass (projects)
const COLOR_REPEL     = new THREE.Color(0xff3344)  // red  — negative mass (AR)
const COLOR_INTERFER  = new THREE.Color(0xffd700)  // gold — interference pattern
const COLOR_GROUND_OK = new THREE.Color(0x002233)  // dark ring under attractor
const COLOR_GROUND_AR = new THREE.Color(0x330011)  // dark ring under repeller

// ── Vertex & Fragment Shaders ─────────────────────────────────────────────────

const VERT_SHADER = /* glsl */`
  varying vec3 vNormal;
  varying vec3 vViewDir;
  void main() {
    vNormal  = normalize(normalMatrix * normal);
    vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
    vViewDir = normalize(-mvPos.xyz);
    gl_Position = projectionMatrix * mvPos;
  }
`

const FRAG_SHADER = /* glsl */`
  uniform float uTime;
  uniform float uDistortion;
  uniform vec3  uColor;
  uniform float uRepel;
  varying vec3  vNormal;
  varying vec3  vViewDir;
  void main() {
    float fresnel = pow(1.0 - max(dot(vNormal, vViewDir), 0.0), 2.5);
    // shimmer: time-based sine on edge bands
    float shimmer = 0.55 + 0.45 * sin(uTime * 2.8 + fresnel * 14.0);
    // slight radial pulse for repellers
    float pulse = uRepel > 0.5
      ? 0.7 + 0.3 * sin(uTime * 4.5 - fresnel * 6.0)
      : 1.0;
    float alpha = fresnel * uDistortion * shimmer * pulse;
    // brighten edge band
    vec3 col = mix(uColor * 0.6, uColor * 1.3, fresnel);
    gl_FragColor = vec4(col, clamp(alpha, 0.0, 0.75));
  }
`

// ── Types ─────────────────────────────────────────────────────────────────────

export type MassType = 'project' | 'subscription' | 'ar_stalactite' | 'revenue_river'

export interface MassNode {
  id:          string
  label:       string
  massType:    MassType
  mass:        number          // positive = attract, negative = repel
  x:           number
  z:           number
  /** Derived: what this node's gravity pulls (listed in panel) */
  pullTargets: string[]
}

interface InfluenceEntry {
  node:         MassNode
  sphere:       THREE.Mesh
  groundRing:   THREE.Mesh
  edgeRing:     THREE.LineLoop
  radius:       number
  uid:          number
  /** shader uniform refs */
  uniforms:     { uTime: { value: number }; uDistortion: { value: number }; uColor: { value: THREE.Color }; uRepel: { value: number } }
}

interface InterferenceRing {
  mesh: THREE.Mesh
  t:    number  // creation timestamp for fade
}

let _uid = 0

// ── Helpers ───────────────────────────────────────────────────────────────────

function massToRadius(mass: number): number {
  const abs = Math.abs(mass)
  if (abs <= 0) return MIN_SPHERE_RADIUS
  const t = Math.min(abs / 200000, 1)  // normalize to 200k
  return MIN_SPHERE_RADIUS + t * (MAX_SPHERE_RADIUS - MIN_SPHERE_RADIUS)
}

function formatMoney(v: number): string {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`
  if (v >= 1_000)     return `$${(v / 1_000).toFixed(1)}K`
  return `$${v.toFixed(0)}`
}

function buildMassNodes(data: NWWorldData): MassNode[] {
  const nodes: MassNode[] = []

  // 1. Project mountains — positive mass
  for (const p of data.projects) {
    if ((p.contract_value ?? 0) <= 0) continue
    const pos = seededPosition(p.id)
    nodes.push({
      id:       `project:${p.id}`,
      label:    p.name ?? 'Project',
      massType: 'project',
      mass:     p.contract_value,
      x:        pos.x,
      z:        pos.z,
      pullTargets: [
        'Crew attention',
        'Cash flow',
        'Material orders',
        `VAULT agent oversight`,
      ],
    })
  }

  // 2. Subscription towers — estimated monthly × 12
  //    Use hub events (subscriber_joined) as a proxy if available
  const subCount = data.hubEvents.filter(e => e.event_type === 'subscriber_joined').length
  if (subCount > 0) {
    const annualSub = subCount * SUBSCRIPTION_MRR * 12
    nodes.push({
      id:       'subscription:hub',
      label:    'Hub Subscriptions',
      massType: 'subscription',
      mass:     annualSub,
      x:        90,
      z:        0,
      pullTargets: [
        'Recurring client attention',
        'Support bandwidth',
        'Platform revenue stream',
      ],
    })
  }

  // 3. AR stalactites — negative mass (unpaid invoices)
  const unpaid = data.invoices.filter(inv => inv.status !== 'paid' && (inv.amount ?? 0) > 0)
  const arByProject = new Map<string, { amount: number; count: number }>()
  for (const inv of unpaid) {
    const pid = inv.project_id ?? '__ar_pool__'
    const prev = arByProject.get(pid) ?? { amount: 0, count: 0 }
    arByProject.set(pid, { amount: prev.amount + inv.amount, count: prev.count + 1 })
  }
  for (const [pid, agg] of arByProject.entries()) {
    let pos = { x: 60, z: 80 }
    if (pid !== '__ar_pool__') {
      const pp = seededPosition(pid)
      pos = { x: pp.x + 4, z: pp.z + 4 }
    }
    nodes.push({
      id:       `ar:${pid}`,
      label:    pid === '__ar_pool__' ? 'Open AR Pool' : `AR: ${agg.count} invoice${agg.count > 1 ? 's' : ''}`,
      massType: 'ar_stalactite',
      mass:     -agg.amount,   // negative → repels
      x:        pos.x,
      z:        pos.z,
      pullTargets: [
        'Collection calls',
        'LEDGER agent focus',
        `Accounts receivable queue`,
      ],
    })
  }

  // 4. Revenue river section — approximate monthly throughput from paid invoices
  const paidTotal = data.invoices
    .filter(inv => inv.status === 'paid')
    .reduce((s, inv) => s + (inv.amount ?? 0), 0)
  const monthlyThroughput = paidTotal / 12  // rough annualized → monthly
  if (monthlyThroughput > 0) {
    nodes.push({
      id:       'river:throughput',
      label:    'Revenue River',
      massType: 'revenue_river',
      mass:     monthlyThroughput,
      x:        0,
      z:        0,
      pullTargets: [
        'Overhead drain',
        'Payroll commitment',
        'Reinvestment pool',
      ],
    })
  }

  return nodes
}

function selectTopNodes(nodes: MassNode[]): MassNode[] {
  if (nodes.length === 0) return []
  const sorted = [...nodes].sort((a, b) => Math.abs(b.mass) - Math.abs(a.mass))
  const cutoff  = Math.max(1, Math.ceil(sorted.length * TOP_PERCENTILE))
  return sorted.slice(0, cutoff)
}

// ── Main Component ────────────────────────────────────────────────────────────

interface Props {
  visible?: boolean
}

export function GravitationalLensingLayer({ visible = false }: Props) {
  const { scene, camera, renderer } = useWorldContext()

  const groupRef        = useRef<THREE.Group | null>(null)
  const entriesRef      = useRef<InfluenceEntry[]>([])
  const interRingsRef   = useRef<InterferenceRing[]>([])
  const visibleRef      = useRef(visible)
  const raycasterRef    = useRef(new THREE.Raycaster())
  const mouseRef        = useRef(new THREE.Vector2(-99, -99))

  // React UI state
  const [hoveredEntry, setHoveredEntry] = useState<InfluenceEntry | null>(null)
  const [clickedNode,  setClickedNode]  = useState<MassNode | null>(null)
  const [panelXY,      setPanelXY]      = useState<{ x: number; y: number }>({ x: 0, y: 0 })

  // ── Build / rebuild ─────────────────────────────────────────────────────────
  useEffect(() => {
    const group = new THREE.Group()
    group.name    = 'GravitationalLensingLayer'
    group.visible = visible
    scene.add(group)
    groupRef.current = group

    function disposeEntries() {
      for (const e of entriesRef.current) {
        e.sphere.geometry.dispose()
        ;(e.sphere.material as THREE.Material).dispose()
        e.groundRing.geometry.dispose()
        ;(e.groundRing.material as THREE.Material).dispose()
        e.edgeRing.geometry.dispose()
        ;(e.edgeRing.material as THREE.Material).dispose()
        group.remove(e.sphere)
        group.remove(e.groundRing)
        group.remove(e.edgeRing)
      }
      entriesRef.current = []
    }

    function disposeInterRings() {
      for (const ir of interRingsRef.current) {
        ir.mesh.geometry.dispose()
        ;(ir.mesh.material as THREE.Material).dispose()
        group.remove(ir.mesh)
      }
      interRingsRef.current = []
    }

    const unsub = subscribeWorldData((data: NWWorldData) => {
      disposeEntries()
      disposeInterRings()

      const allNodes  = buildMassNodes(data)
      const topNodes  = selectTopNodes(allNodes)

      for (const node of topNodes) {
        const radius = massToRadius(Math.abs(node.mass))
        const isAR   = node.mass < 0
        const color  = isAR ? COLOR_REPEL.clone() : COLOR_ATTRACT.clone()

        // ── Influence sphere ────────────────────────────────────────────────
        const uniforms = {
          uTime:       { value: 0 },
          uDistortion: { value: DISTORTION_INTENSITY },
          uColor:      { value: color },
          uRepel:      { value: isAR ? 1.0 : 0.0 },
        }
        const sphereMat = new THREE.ShaderMaterial({
          vertexShader:   VERT_SHADER,
          fragmentShader: FRAG_SHADER,
          uniforms,
          transparent:    true,
          side:           THREE.DoubleSide,
          depthWrite:     false,
          blending:       THREE.AdditiveBlending,
        })
        const sphereGeo = new THREE.SphereGeometry(radius, SPHERE_SEGMENTS, SPHERE_SEGMENTS)
        const sphere    = new THREE.Mesh(sphereGeo, sphereMat)
        sphere.position.set(node.x, radius * 0.6, node.z)
        sphere.renderOrder = 10
        group.add(sphere)

        // ── Ground depression ring ──────────────────────────────────────────
        const ringGeo = new THREE.RingGeometry(radius * 0.35, radius * 1.05, GROUND_RING_SEGMENTS)
        const ringMat = new THREE.MeshBasicMaterial({
          color:       isAR ? COLOR_GROUND_AR : COLOR_GROUND_OK,
          transparent: true,
          opacity:     0.55,
          side:        THREE.DoubleSide,
          depthWrite:  false,
          blending:    THREE.NormalBlending,
        })
        const groundRing = new THREE.Mesh(ringGeo, ringMat)
        groundRing.position.set(node.x, 0.02, node.z)
        groundRing.rotation.x = -Math.PI / 2
        groundRing.renderOrder = 5
        group.add(groundRing)

        // ── Edge shimmer ring (LineLoop at equator of sphere) ───────────────
        const edgePts: THREE.Vector3[] = []
        const edgeSegs = 80
        for (let i = 0; i <= edgeSegs; i++) {
          const theta = (i / edgeSegs) * Math.PI * 2
          edgePts.push(new THREE.Vector3(Math.cos(theta) * radius, 0, Math.sin(theta) * radius))
        }
        const edgeGeo = new THREE.BufferGeometry().setFromPoints(edgePts)
        const edgeMat = new THREE.LineBasicMaterial({
          color:       isAR ? 0xff6677 : 0x44ffee,
          transparent: true,
          opacity:     0.55,
          depthWrite:  false,
          blending:    THREE.AdditiveBlending,
        })
        const edgeRing = new THREE.LineLoop(edgeGeo, edgeMat)
        edgeRing.position.set(node.x, 0.15, node.z)
        edgeRing.renderOrder = 8
        group.add(edgeRing)

        entriesRef.current.push({
          node, sphere, groundRing, edgeRing, radius, uniforms,
          uid: ++_uid,
        })
      }

      // ── Interference rings for overlapping fields ───────────────────────
      const entries = entriesRef.current
      for (let i = 0; i < entries.length; i++) {
        for (let j = i + 1; j < entries.length; j++) {
          const a = entries[i]
          const b = entries[j]
          const dx = a.node.x - b.node.x
          const dz = a.node.z - b.node.z
          const dist = Math.sqrt(dx * dx + dz * dz)
          if (dist < a.radius + b.radius) {
            // Mid-point interference ring
            const mx = (a.node.x + b.node.x) / 2
            const mz = (a.node.z + b.node.z) / 2
            const interRadius = (a.radius + b.radius - dist) * 0.5
            const iGeo = new THREE.RingGeometry(interRadius * 0.8, interRadius * 1.0, 64)
            const iMat = new THREE.MeshBasicMaterial({
              color:       COLOR_INTERFER,
              transparent: true,
              opacity:     0.35,
              side:        THREE.DoubleSide,
              depthWrite:  false,
              blending:    THREE.AdditiveBlending,
            })
            const iMesh = new THREE.Mesh(iGeo, iMat)
            iMesh.position.set(mx, 0.08, mz)
            iMesh.rotation.x = -Math.PI / 2
            iMesh.renderOrder = 6
            group.add(iMesh)
            interRingsRef.current.push({ mesh: iMesh, t: performance.now() })
          }
        }
      }
    })

    return () => {
      unsub()
      disposeEntries()
      disposeInterRings()
      scene.remove(group)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene])

  // ── Sync visibility ─────────────────────────────────────────────────────────
  useEffect(() => {
    visibleRef.current = visible
    if (groupRef.current) groupRef.current.visible = visible
  }, [visible])

  // ── Animation frame ─────────────────────────────────────────────────────────
  useEffect(() => {
    function onFrame() {
      if (!visibleRef.current) return
      const t = performance.now() / 1000

      // Update sphere shaders
      for (const e of entriesRef.current) {
        e.uniforms.uTime.value = t

        // Edge ring shimmer
        const edgeMat = e.edgeRing.material as THREE.LineBasicMaterial
        edgeMat.opacity = 0.3 + 0.35 * Math.sin(t * 1.8 + e.uid * 1.3)

        // Ground ring slow pulse
        const gMat = e.groundRing.material as THREE.MeshBasicMaterial
        gMat.opacity = 0.35 + 0.25 * Math.sin(t * 0.6 + e.uid * 0.9)
      }

      // Interference ring breathe
      for (const ir of interRingsRef.current) {
        const age = (t * 1000 - ir.t) / 1000
        const iMat = ir.mesh.material as THREE.MeshBasicMaterial
        iMat.opacity = 0.15 + 0.25 * Math.abs(Math.sin(t * 1.2 + age))
      }

      // Gravity particle deflection event
      if (entriesRef.current.length > 0) {
        window.dispatchEvent(
          new CustomEvent('nw:gravity-deflect', {
            detail: entriesRef.current.map(e => ({
              x:      e.node.x,
              z:      e.node.z,
              radius: e.radius * DEFLECT_RADIUS_MULT,
              mass:   e.node.mass,
            })),
          })
        )
      }

      // Raycast for hover
      if (visibleRef.current && entriesRef.current.length > 0) {
        raycasterRef.current.setFromCamera(mouseRef.current, camera)
        const sphereMeshes = entriesRef.current.map(e => e.sphere)
        const hits = raycasterRef.current.intersectObjects(sphereMeshes, false)
        if (hits.length > 0) {
          const hitMesh = hits[0].object as THREE.Mesh
          const found   = entriesRef.current.find(e => e.sphere === hitMesh) ?? null
          setHoveredEntry(found)
        } else {
          setHoveredEntry(null)
        }
      }
    }

    window.addEventListener('nw:frame', onFrame)
    return () => window.removeEventListener('nw:frame', onFrame)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera])

  // ── Mouse tracking ──────────────────────────────────────────────────────────
  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      if (!renderer?.domElement) return
      const rect = renderer.domElement.getBoundingClientRect()
      mouseRef.current.x =  ((e.clientX - rect.left) / rect.width)  * 2 - 1
      mouseRef.current.y = -((e.clientY - rect.top)  / rect.height) * 2 + 1
    }
    window.addEventListener('mousemove', onMouseMove)
    return () => window.removeEventListener('mousemove', onMouseMove)
  }, [renderer])

  // ── Click handler ────────────────────────────────────────────────────────────
  const onCanvasClick = useCallback((e: MouseEvent) => {
    if (!visible) return
    if (!renderer?.domElement) return
    const rect = renderer.domElement.getBoundingClientRect()
    const mx =  ((e.clientX - rect.left) / rect.width)  * 2 - 1
    const my = -((e.clientY - rect.top)  / rect.height) * 2 + 1
    const r  = new THREE.Raycaster()
    r.setFromCamera(new THREE.Vector2(mx, my), camera)
    const hits = r.intersectObjects(entriesRef.current.map(e => e.sphere), false)
    if (hits.length > 0) {
      const hitMesh = hits[0].object as THREE.Mesh
      const found   = entriesRef.current.find(e => e.sphere === hitMesh)
      if (found) {
        setClickedNode(found.node)
        setPanelXY({ x: e.clientX, y: e.clientY })
      }
    }
  }, [visible, camera, renderer])

  useEffect(() => {
    window.addEventListener('click', onCanvasClick)
    return () => window.removeEventListener('click', onCanvasClick)
  }, [onCanvasClick])

  // ── Render ───────────────────────────────────────────────────────────────────
  if (!visible) return null

  return (
    <>
      {/* Hover tooltip */}
      {hoveredEntry && !clickedNode && (
        <div
          style={{
            position:        'fixed',
            bottom:          24,
            left:            '50%',
            transform:       'translateX(-50%)',
            background:      'rgba(0,10,20,0.88)',
            border:          `1px solid ${hoveredEntry.node.mass < 0 ? '#ff3344' : '#00e5cc'}`,
            color:           hoveredEntry.node.mass < 0 ? '#ff8090' : '#00e5cc',
            fontFamily:      'monospace',
            fontSize:        11,
            letterSpacing:   1.5,
            padding:         '7px 16px',
            borderRadius:    4,
            pointerEvents:   'none',
            zIndex:          9100,
            whiteSpace:      'nowrap',
          }}
        >
          {hoveredEntry.node.mass < 0 ? '⊖ REPULSION' : '⊕ GRAVITATIONAL INFLUENCE'}
          {' '}
          <span style={{ color: '#fff', fontWeight: 700 }}>
            {formatMoney(Math.abs(hoveredEntry.node.mass))}
          </span>
          {'  '}|{'  '}
          Radius: <span style={{ color: '#fff' }}>{hoveredEntry.radius.toFixed(1)} units</span>
          {'  '}|{'  '}
          {hoveredEntry.node.label}
        </div>
      )}

      {/* Click panel */}
      {clickedNode && (
        <div
          style={{
            position:     'fixed',
            top:          Math.min(panelXY.y, window.innerHeight - 320),
            left:         Math.min(panelXY.x + 12, window.innerWidth - 300),
            width:        280,
            background:   'rgba(4,12,24,0.96)',
            border:       `1px solid ${clickedNode.mass < 0 ? '#ff3344' : '#00e5cc'}`,
            borderRadius: 6,
            fontFamily:   'monospace',
            color:        '#cce',
            fontSize:     11,
            zIndex:       9200,
            boxShadow:    `0 0 24px ${clickedNode.mass < 0 ? 'rgba(255,51,68,0.4)' : 'rgba(0,229,204,0.35)'}`,
          }}
        >
          {/* Header */}
          <div style={{
            display:         'flex',
            alignItems:      'center',
            justifyContent:  'space-between',
            padding:         '10px 14px 8px',
            borderBottom:    `1px solid rgba(0,229,204,0.15)`,
          }}>
            <span style={{
              color:         clickedNode.mass < 0 ? '#ff8090' : '#00e5cc',
              fontWeight:    700,
              fontSize:      12,
              letterSpacing: 1.5,
            }}>
              {clickedNode.mass < 0 ? '⊖ REPULSION FIELD' : '⊕ GRAVITY FIELD'}
            </span>
            <button
              onClick={() => setClickedNode(null)}
              style={{
                background:   'none',
                border:       'none',
                color:        '#aaa',
                cursor:       'pointer',
                fontSize:     16,
                padding:      '0 4px',
                lineHeight:   1,
              }}
            >
              ×
            </button>
          </div>

          <div style={{ padding: '10px 14px' }}>
            {/* Node info */}
            <div style={{ marginBottom: 10 }}>
              <div style={{ color: '#fff', fontWeight: 700, marginBottom: 3 }}>
                {clickedNode.label}
              </div>
              <div style={{ color: '#778', fontSize: 10, letterSpacing: 1 }}>
                {clickedNode.massType.replace('_', ' ').toUpperCase()}
              </div>
            </div>

            {/* Mass value */}
            <div style={{
              background:    'rgba(0,229,204,0.07)',
              border:        '1px solid rgba(0,229,204,0.15)',
              borderRadius:  4,
              padding:       '6px 10px',
              marginBottom:  10,
              display:       'flex',
              justifyContent:'space-between',
            }}>
              <span style={{ color: '#778' }}>Mass Value</span>
              <span style={{
                color:      clickedNode.mass < 0 ? '#ff8090' : '#00ff99',
                fontWeight: 700,
              }}>
                {clickedNode.mass < 0 ? '−' : '+'}{formatMoney(Math.abs(clickedNode.mass))}
              </span>
            </div>

            {/* Influence radius */}
            <div style={{
              background:   'rgba(0,0,0,0.3)',
              border:       '1px solid rgba(255,255,255,0.06)',
              borderRadius: 4,
              padding:      '6px 10px',
              marginBottom: 12,
              display:      'flex',
              justifyContent:'space-between',
            }}>
              <span style={{ color: '#778' }}>Influence Radius</span>
              <span style={{ color: '#ccd' }}>
                {massToRadius(Math.abs(clickedNode.mass)).toFixed(1)} units
              </span>
            </div>

            {/* Pull targets */}
            <div>
              <div style={{
                color:         '#778',
                fontSize:      10,
                letterSpacing: 1.5,
                marginBottom:  6,
              }}>
                {clickedNode.mass < 0 ? 'CONSUMING →' : 'PULLING TOWARD IT →'}
              </div>
              {clickedNode.pullTargets.map((t, i) => (
                <div
                  key={i}
                  style={{
                    display:      'flex',
                    alignItems:   'center',
                    gap:          8,
                    padding:      '4px 0',
                    borderBottom: '1px solid rgba(255,255,255,0.04)',
                    color:        '#aac',
                  }}
                >
                  <span style={{ color: clickedNode.mass < 0 ? '#ff6677' : '#00e5cc', fontSize: 10 }}>
                    {clickedNode.mass < 0 ? '▸' : '◆'}
                  </span>
                  {t}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
