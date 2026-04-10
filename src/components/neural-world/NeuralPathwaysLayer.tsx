/**
 * NeuralPathwaysLayer.tsx — NW53: Decision history trail visualization.
 *
 * VIDEO GAME UX LAW: Every significant business decision leaves a visible trail
 * etched into the landscape. Over time, frequently-used decision paths become
 * deeply worn roads while rare paths fade.
 *
 * DECISION TYPES:
 *   gold  (#FFD700) = revenue  — invoices sent to projects   (LEDGER → project mountain)
 *   teal  (#00E5CC) = project  — work logged, job started    (BLUEPRINT → project mountain)
 *   amber (#FF9A00) = crew     — crew dispatched to site     (crew domain → project mountain)
 *   blue  (#40A0FF) = lead     — lead pipeline events        (SPARK → HQ)
 *
 * TRAIL DEPTH:
 *   1 use     → hairline trace   (tube r = 0.04)
 *   2–3 uses  → thin trail       (tube r = 0.08)
 *   4–6 uses  → worn path        (tube r = 0.12)
 *   7–9 uses  → deep road        (tube r = 0.17)
 *   10+ uses  → major highway    (tube r = 0.22)
 *
 *   < 30 days since last use  → 100% opacity + pulsing glow
 *   30–90 days                → opacity fades to 20%
 *   > 90 days                 → 20% opacity (faint historical trace)
 *
 * INTERACTION:
 *   Hover → tooltip: use count + path description
 *   Click → detail panel: all instances, dates, outcomes + NEXUS pattern analysis
 *
 * LAYERS PANEL: "Neural Pathways" toggle — off by default.
 * NEXUS INSIGHTS PANEL: bottom-right overlay, visible when layer is ON.
 */

import React, { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { useWorldContext } from './WorldContext'
import {
  subscribeWorldData,
  seededPosition,
  type NWWorldData,
  type NWProject,
  type NWInvoice,
  type NWFieldLog,
  type NWCrewMember,
  type NWHubEvent,
} from './DataBridge'

// ── Constants ──────────────────────────────────────────────────────────────────

/** Y position of all pathway tubes — etched into ground surface */
const PATH_Y = 0.06

/** Performance guards — max pathways per type */
const MAX_REVENUE_PATHS = 30
const MAX_PROJECT_PATHS = 30
const MAX_CREW_PATHS    = 25

/** Milliseconds per day */
const MS_DAY = 24 * 60 * 60 * 1000

/** Well-known agent node world positions (must match terrain layer lore) */
const LEDGER_POS    = { x:  55, z:  80 }   // accounting / revenue domain — east
const BLUEPRINT_POS = { x: -20, z: -80 }   // project planning domain — west-center
const CREW_POS      = { x: -130, z:  0 }   // labor ridges — west
const SPARK_POS     = { x:  60, z: -120 }  // SPARK lead tower — north-east
const HQ_POS        = { x:   0, z:  10 }   // Founders Valley HQ — center

// ── Types ─────────────────────────────────────────────────────────────────────

type DecisionType = 'revenue' | 'project' | 'crew' | 'lead'

interface PathwayInstance {
  date: string
  description: string
  outcome: string
  amount?: number
}

interface PathwayDef {
  key: string
  type: DecisionType
  label: string
  sourceLabel: string
  targetLabel: string
  useCount: number
  instances: PathwayInstance[]
  sourcePos: { x: number; z: number }
  targetPos: { x: number; z: number }
  lastUsedMs: number
  oldestMs: number
  colorHex: number
}

interface NexusInsight {
  kind: 'strong' | 'weak' | 'missing'
  text: string
  color: string
}

interface HoverInfo {
  def: PathwayDef
  screenX: number
  screenY: number
}

interface PathMesh {
  key: string
  coreMesh: THREE.Mesh
  glowMesh: THREE.Mesh
  coreGeo: THREE.TubeGeometry
  glowGeo: THREE.TubeGeometry
  coreMat: THREE.MeshBasicMaterial
  glowMat: THREE.MeshBasicMaterial
  baseOpacity: number
  isRecent: boolean
  phaseOffset: number
}

// ── Pure Helpers ───────────────────────────────────────────────────────────────

/** Tube radius based on use count — 1px to 4px aesthetic, world-unit scale */
function tubeRadius(count: number): number {
  if (count >= 10) return 0.22
  if (count >= 7)  return 0.17
  if (count >= 4)  return 0.12
  if (count >= 2)  return 0.08
  return 0.04
}

/** Trail opacity based on age of most recent use */
function pathOpacity(lastUsedMs: number): number {
  const ageDays = (Date.now() - lastUsedMs) / MS_DAY
  if (ageDays <= 30) return 1.0
  if (ageDays <= 90) return 0.2 + 0.8 * (1.0 - (ageDays - 30) / 60)
  return 0.2
}

/** Deterministic lateral midpoint offset — same key always yields same curve bow */
function deterministicOffset(key: string): { dx: number; dz: number } {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < key.length; i++) {
    const c = key.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 2654435761)
    h2 = Math.imul(h2 ^ c, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  const n1 = ((h1 >>> 0) / 0xffffffff) * 2 - 1
  const n2 = ((h2 >>> 0) / 0xffffffff) * 2 - 1
  return { dx: n1 * 14, dz: n2 * 14 }
}

/** Build a smooth ground-level CatmullRomCurve3 with deterministic lateral bow */
function buildCurve(
  sx: number, sz: number,
  tx: number, tz: number,
  key: string,
): THREE.CatmullRomCurve3 {
  const { dx, dz } = deterministicOffset(key)
  const midX = (sx + tx) / 2 + dx
  const midZ = (sz + tz) / 2 + dz
  return new THREE.CatmullRomCurve3([
    new THREE.Vector3(sx,   PATH_Y, sz),
    new THREE.Vector3(midX, PATH_Y, midZ),
    new THREE.Vector3(tx,   PATH_Y, tz),
  ])
}

/** Parse date string → ms; fallback to 180 days ago if null/invalid */
function toMs(d: string | null | undefined): number {
  if (!d) return Date.now() - 180 * MS_DAY
  const t = new Date(d).getTime()
  return isNaN(t) ? Date.now() - 180 * MS_DAY : t
}

// ── Data Derivation ────────────────────────────────────────────────────────────

function buildPathways(data: NWWorldData): PathwayDef[] {
  const paths: PathwayDef[] = []

  // Build project name index
  const projMap = new Map<string, NWProject>()
  for (const p of data.projects) projMap.set(p.id, p)

  // ── REVENUE (gold): invoices → LEDGER → project mountain ──────────────────
  const invoicesByProject = new Map<string, NWInvoice[]>()
  for (const inv of data.invoices) {
    if (!inv.project_id) continue
    const arr = invoicesByProject.get(inv.project_id) ?? []
    arr.push(inv)
    invoicesByProject.set(inv.project_id, arr)
  }

  let rCount = 0
  for (const [projId, invs] of invoicesByProject) {
    if (rCount >= MAX_REVENUE_PATHS) break
    const proj     = projMap.get(projId)
    const projName = proj?.name ?? `Project ${projId.slice(0, 8)}`
    const tgt      = seededPosition(projId)
    const sorted   = [...invs].sort((a, b) => toMs(b.created_at) - toMs(a.created_at))
    const lastUsedMs = toMs(sorted[0]?.created_at)
    const oldestMs   = toMs(sorted[sorted.length - 1]?.created_at)
    paths.push({
      key:         `revenue_ledger_${projId}`,
      type:        'revenue',
      label:       `Send invoice to ${projName}`,
      sourceLabel: 'LEDGER',
      targetLabel: projName,
      useCount:    invs.length,
      instances:   sorted.slice(0, 10).map(inv => ({
        date:        inv.created_at?.split('T')[0] ?? '—',
        description: `Invoice — $${inv.amount.toLocaleString()}`,
        outcome:
          inv.status === 'paid'      ? 'Collected'  :
          inv.status === 'cancelled' ? 'Cancelled'  : 'Pending',
        amount: inv.amount,
      })),
      sourcePos:   LEDGER_POS,
      targetPos:   tgt,
      lastUsedMs,
      oldestMs,
      colorHex:    0xFFD700,
    })
    rCount++
  }

  // ── PROJECT (teal): field logs → BLUEPRINT → project mountain ─────────────
  const logsByProject = new Map<string, NWFieldLog[]>()
  for (const fl of data.fieldLogs) {
    if (!fl.project_id) continue
    const arr = logsByProject.get(fl.project_id) ?? []
    arr.push(fl)
    logsByProject.set(fl.project_id, arr)
  }

  let pCount = 0
  for (const [projId, logs] of logsByProject) {
    if (pCount >= MAX_PROJECT_PATHS) break
    const proj      = projMap.get(projId)
    const projName  = proj?.name ?? `Project ${projId.slice(0, 8)}`
    const tgt       = seededPosition(projId)
    const sorted    = [...logs].sort((a, b) => toMs(b.log_date) - toMs(a.log_date))
    const lastUsedMs  = toMs(sorted[0]?.log_date)
    const oldestMs    = toMs(sorted[sorted.length - 1]?.log_date)
    const totalHrs    = logs.reduce((s, l) => s + l.hours, 0)
    paths.push({
      key:         `project_bp_${projId}`,
      type:        'project',
      label:       `Log work on ${projName}`,
      sourceLabel: 'BLUEPRINT',
      targetLabel: projName,
      useCount:    logs.length,
      instances:   sorted.slice(0, 10).map(l => ({
        date:        l.log_date?.split('T')[0] ?? '—',
        description: `${l.hours}h field log`,
        outcome:     `${totalHrs.toFixed(1)}h total on project`,
      })),
      sourcePos:   BLUEPRINT_POS,
      targetPos:   tgt,
      lastUsedMs,
      oldestMs,
      colorHex:    0x00E5CC,
    })
    pCount++
  }

  // ── CREW (amber): crew dispatch → crew domain → project mountain ───────────
  const crewProjMap = new Map<string, NWFieldLog[]>()
  for (const fl of data.fieldLogs) {
    if (!fl.project_id || !fl.crew_id) continue
    const k   = `${fl.crew_id}__${fl.project_id}`
    const arr = crewProjMap.get(k) ?? []
    arr.push(fl)
    crewProjMap.set(k, arr)
  }
  const crewEntries = [...crewProjMap.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, MAX_CREW_PATHS)

  for (const [ck, logs] of crewEntries) {
    const sep      = ck.indexOf('__')
    const crewId   = ck.slice(0, sep)
    const projId   = ck.slice(sep + 2)
    const proj     = projMap.get(projId)
    const projName = proj?.name ?? `Project ${projId.slice(0, 8)}`
    const crew     = data.crewMembers.find((c: NWCrewMember) => c.id === crewId)
    const crewName = crew?.name ?? `Crew ${crewId.slice(0, 8)}`
    const tgt      = seededPosition(projId)
    const sorted   = [...logs].sort((a, b) => toMs(b.log_date) - toMs(a.log_date))
    const lastUsedMs = toMs(sorted[0]?.log_date)
    const oldestMs   = toMs(sorted[sorted.length - 1]?.log_date)
    const totalHrs   = logs.reduce((s, l) => s + l.hours, 0)
    paths.push({
      key:         `crew_${ck}`,
      type:        'crew',
      label:       `Assign ${crewName} to ${projName}`,
      sourceLabel: crewName,
      targetLabel: projName,
      useCount:    logs.length,
      instances:   sorted.slice(0, 10).map(l => ({
        date:        l.log_date?.split('T')[0] ?? '—',
        description: `${crewName} — ${l.hours}h dispatched`,
        outcome:     `${totalHrs.toFixed(1)}h total`,
      })),
      sourcePos:   CREW_POS,
      targetPos:   tgt,
      lastUsedMs,
      oldestMs,
      colorHex:    0xFF9A00,
    })
  }

  // ── LEAD (blue): hub events → SPARK → HQ ──────────────────────────────────
  const leadEvents = data.hubEvents.filter((e: NWHubEvent) =>
    e.event_type === 'subscriber_joined'   ||
    e.event_type === 'subscriber_cancelled'||
    e.event_type === 'service_area_added'
  )
  if (leadEvents.length > 0) {
    const sorted     = [...leadEvents].sort((a, b) => toMs(b.created_at) - toMs(a.created_at))
    const lastUsedMs = toMs(sorted[0]?.created_at)
    const oldestMs   = toMs(sorted[sorted.length - 1]?.created_at)
    paths.push({
      key:         'lead_spark_hq',
      type:        'lead',
      label:       'Lead pipeline activity',
      sourceLabel: 'SPARK Tower',
      targetLabel: 'Founders Valley HQ',
      useCount:    leadEvents.length,
      instances:   sorted.slice(0, 10).map(e => ({
        date:        e.created_at?.split('T')[0] ?? '—',
        description: e.event_type.replace(/_/g, ' '),
        outcome:
          e.event_type === 'subscriber_joined'   ? 'Lead converted'   :
          e.event_type === 'service_area_added'  ? 'Territory added'  : 'Pipeline updated',
      })),
      sourcePos:   SPARK_POS,
      targetPos:   HQ_POS,
      lastUsedMs,
      oldestMs,
      colorHex:    0x40A0FF,
    })
  }

  // ── Project-start fallback (teal, 1 use) for projects with no field logs ───
  for (const proj of data.projects) {
    if (paths.some(p => p.key === `project_bp_${proj.id}`)) continue
    if (proj.status === 'cancelled') continue
    const tgt       = seededPosition(proj.id)
    const createdMs = toMs(proj.created_at)
    paths.push({
      key:         `project_start_${proj.id}`,
      type:        'project',
      label:       `Project started: ${proj.name}`,
      sourceLabel: 'VAULT',
      targetLabel: proj.name,
      useCount:    1,
      instances:   [{
        date:        proj.created_at?.split('T')[0] ?? '—',
        description: `${proj.name} initiated`,
        outcome:     proj.status.replace(/_/g, ' '),
      }],
      sourcePos:   BLUEPRINT_POS,
      targetPos:   tgt,
      lastUsedMs:  createdMs,
      oldestMs:    createdMs,
      colorHex:    0x00E5CC,
    })
  }

  return paths
}

// ── NEXUS Insights ─────────────────────────────────────────────────────────────

function deriveInsights(paths: PathwayDef[]): NexusInsight[] {
  const now      = Date.now()
  const insights: NexusInsight[] = []
  if (paths.length === 0) return insights

  // Strongest pathway (highest use count)
  const strongest = [...paths].sort((a, b) => b.useCount - a.useCount)[0]
  insights.push({
    kind:  'strong',
    text:  `Your strongest pathway: "${strongest.label}" — used ${strongest.useCount}× (${strongest.sourceLabel} → ${strongest.targetLabel})`,
    color: '#00E5CC',
  })

  // Invoice collection rate
  const revPaths = paths.filter(p => p.type === 'revenue')
  if (revPaths.length > 0) {
    const total     = revPaths.reduce((s, p) => s + p.instances.length, 0)
    const collected = revPaths.reduce((s, p) =>
      s + p.instances.filter(i => i.outcome === 'Collected').length, 0)
    const rate      = total > 0 ? Math.round((collected / total) * 100) : 0
    insights.push({
      kind:  rate >= 70 ? 'strong' : 'weak',
      text:  `Invoice collection rate: ${rate}% across ${revPaths.length} revenue path${revPaths.length !== 1 ? 's' : ''}`,
      color: rate >= 70 ? '#00E5CC' : '#FF9A00',
    })
  }

  // Fading pathway (low use, not touched recently)
  const fading = paths.filter(p =>
    p.useCount <= 2 && (now - p.lastUsedMs) > 14 * MS_DAY
  )
  if (fading.length > 0) {
    const wp      = fading[0]
    const ageDays = Math.round((now - wp.lastUsedMs) / MS_DAY)
    insights.push({
      kind:  'weak',
      text:  `Weak pathway: "${wp.label}" — ${wp.useCount}× use, last activity ${ageDays}d ago`,
      color: '#FF9A00',
    })
  }

  // Missing lead pathway
  if (!paths.some(p => p.type === 'lead')) {
    insights.push({
      kind:  'missing',
      text:  'Missing pathway: no lead follow-up trail — log pipeline activity in SPARK to build this road',
      color: '#FF5060',
    })
  }

  // Missing crew pathway
  if (!paths.some(p => p.type === 'crew')) {
    insights.push({
      kind:  'missing',
      text:  'Missing pathway: no crew dispatch trail — log field crew assignments to carve this connection',
      color: '#FF5060',
    })
  }

  return insights.slice(0, 5)
}

// ── Component ─────────────────────────────────────────────────────────────────

export function NeuralPathwaysLayer({ visible = true }: { visible?: boolean }) {
  const { scene, camera, renderer } = useWorldContext()

  // ── Refs ────────────────────────────────────────────────────────────────────
  const pathMeshesRef = useRef<PathMesh[]>([])
  const pathDefsRef   = useRef<PathwayDef[]>([])
  const rafRef        = useRef<number>(0)
  const clockRef      = useRef({ elapsed: 0, lastTime: 0 })
  const visibleRef    = useRef(visible)
  const hoveredKeyRef = useRef<string | null>(null)
  const cursorSetRef  = useRef(false)
  const raycasterRef  = useRef(new THREE.Raycaster())

  // ── React state ─────────────────────────────────────────────────────────────
  const [hovered,          setHovered]          = useState<HoverInfo | null>(null)
  const [selected,         setSelected]         = useState<PathwayDef | null>(null)
  const [insights,         setInsights]         = useState<NexusInsight[]>([])
  const [insightsPanelOpen, setInsightsPanelOpen] = useState(true)

  // ── Visibility sync ─────────────────────────────────────────────────────────
  useEffect(() => {
    visibleRef.current = visible
    for (const pm of pathMeshesRef.current) {
      pm.coreMesh.visible = visible
      pm.glowMesh.visible = visible
    }
    if (!visible) {
      setHovered(null)
      setSelected(null)
      if (cursorSetRef.current) {
        renderer.domElement.style.cursor = ''
        cursorSetRef.current = false
      }
    }
  }, [visible, renderer])

  // ── Main effect (Three.js + events) ────────────────────────────────────────
  useEffect(() => {
    // ── Inner helpers ────────────────────────────────────────────────────────

    function clearMeshes(): void {
      for (const pm of pathMeshesRef.current) {
        scene.remove(pm.coreMesh)
        scene.remove(pm.glowMesh)
        pm.coreGeo.dispose()
        pm.glowGeo.dispose()
        pm.coreMat.dispose()
        pm.glowMat.dispose()
      }
      pathMeshesRef.current = []
    }

    function buildMeshes(defs: PathwayDef[]): void {
      clearMeshes()
      const meshes: PathMesh[] = []

      for (const def of defs) {
        const { x: sx, z: sz } = def.sourcePos
        const { x: tx, z: tz } = def.targetPos

        // Skip degenerate (source ≈ target)
        if (Math.abs(sx - tx) < 1 && Math.abs(sz - tz) < 1) continue

        const curve   = buildCurve(sx, sz, tx, tz, def.key)
        const r       = tubeRadius(def.useCount)
        const opacity = pathOpacity(def.lastUsedMs)
        const isRecent = (Date.now() - def.lastUsedMs) <= 30 * MS_DAY
        const color   = new THREE.Color(def.colorHex)

        // Core tube — the etched trail itself
        const coreGeo = new THREE.TubeGeometry(curve, 24, r, 6, false)
        const coreMat = new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity,
          depthWrite: false,
        })
        const coreMesh = new THREE.Mesh(coreGeo, coreMat)
        coreMesh.visible    = visibleRef.current
        coreMesh.renderOrder = 1

        // Glow tube — wider, semi-transparent outer layer for luminance
        const glowGeo = new THREE.TubeGeometry(curve, 24, r * 2.5, 6, false)
        const glowMat = new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: opacity * 0.18,
          depthWrite: false,
          side: THREE.BackSide,
        })
        const glowMesh = new THREE.Mesh(glowGeo, glowMat)
        glowMesh.visible    = visibleRef.current
        glowMesh.renderOrder = 0

        // Deterministic phase offset so paths don't all pulse in sync
        let phaseHash = 0
        for (let i = 0; i < def.key.length; i++) {
          phaseHash = ((phaseHash * 31) + def.key.charCodeAt(i)) & 0x7fffffff
        }
        const phaseOffset = (phaseHash % 628) / 100  // 0 – ~6.28

        scene.add(coreMesh)
        scene.add(glowMesh)

        meshes.push({
          key:         def.key,
          coreMesh,
          glowMesh,
          coreGeo,
          glowGeo,
          coreMat,
          glowMat,
          baseOpacity: opacity,
          isRecent,
          phaseOffset,
        })
      }

      pathMeshesRef.current = meshes
    }

    // ── Animation loop ───────────────────────────────────────────────────────

    function animate(): void {
      rafRef.current = requestAnimationFrame(animate)
      if (!visibleRef.current) return

      const now = performance.now()
      const dt  = Math.min((now - clockRef.current.lastTime) / 1000, 0.05)
      clockRef.current.lastTime = now
      clockRef.current.elapsed += dt
      const t = clockRef.current.elapsed

      for (const pm of pathMeshesRef.current) {
        const isHov = hoveredKeyRef.current === pm.key

        // Pulse glow on recent paths
        if (pm.isRecent) {
          const pulse = 0.15 + Math.sin(t * 1.8 + pm.phaseOffset) * 0.07
          pm.glowMat.opacity = pm.baseOpacity * pulse
        }

        // Hover brightening
        if (isHov) {
          pm.coreMat.opacity = Math.min(1.0, pm.baseOpacity * 1.4)
          pm.glowMat.opacity = Math.min(0.6, pm.baseOpacity * 0.4)
        } else if (!pm.isRecent) {
          pm.coreMat.opacity = pm.baseOpacity
          pm.glowMat.opacity = pm.baseOpacity * 0.10
        } else {
          pm.coreMat.opacity = pm.baseOpacity
          // glowMat already set by pulse branch above
        }
      }
    }

    // ── Raycaster helpers ────────────────────────────────────────────────────

    function pickPathway(clientX: number, clientY: number): PathMesh | null {
      const rect = renderer.domElement.getBoundingClientRect()
      const mx   =  ((clientX - rect.left) / rect.width)  * 2 - 1
      const my   = -((clientY - rect.top)  / rect.height) * 2 + 1
      raycasterRef.current.setFromCamera(new THREE.Vector2(mx, my), camera)
      const allMeshes = pathMeshesRef.current.flatMap(pm => [pm.coreMesh, pm.glowMesh])
      const hits      = raycasterRef.current.intersectObjects(allMeshes, false)
      if (hits.length === 0) return null
      const hitObj = hits[0].object as THREE.Mesh
      return pathMeshesRef.current.find(pm =>
        pm.coreMesh === hitObj || pm.glowMesh === hitObj
      ) ?? null
    }

    // ── Event handlers ───────────────────────────────────────────────────────

    function onMouseMove(e: MouseEvent): void {
      if (!visibleRef.current) return
      const pm = pickPathway(e.clientX, e.clientY)
      if (pm) {
        const def = pathDefsRef.current.find(d => d.key === pm.key)
        if (def) {
          hoveredKeyRef.current = pm.key
          setHovered({ def, screenX: e.clientX, screenY: e.clientY })
          if (!cursorSetRef.current) {
            renderer.domElement.style.cursor = 'pointer'
            cursorSetRef.current = true
          }
          return
        }
      }
      hoveredKeyRef.current = null
      setHovered(null)
      if (cursorSetRef.current) {
        renderer.domElement.style.cursor = ''
        cursorSetRef.current = false
      }
    }

    function onClick(e: MouseEvent): void {
      if (!visibleRef.current) return
      const pm = pickPathway(e.clientX, e.clientY)
      if (pm) {
        const def = pathDefsRef.current.find(d => d.key === pm.key)
        if (def) {
          setSelected(def)
          setHovered(null)
          hoveredKeyRef.current = null
          window.dispatchEvent(
            new CustomEvent('nw:panel-state', { detail: { open: true } })
          )
        }
      }
    }

    // ── Data subscription ────────────────────────────────────────────────────

    const unsub = subscribeWorldData((data: NWWorldData) => {
      const defs = buildPathways(data)
      pathDefsRef.current = defs
      buildMeshes(defs)
      setInsights(deriveInsights(defs))
    })

    // ── Start ────────────────────────────────────────────────────────────────
    clockRef.current.lastTime = performance.now()
    rafRef.current = requestAnimationFrame(animate)
    renderer.domElement.addEventListener('mousemove', onMouseMove)
    renderer.domElement.addEventListener('click',     onClick)

    return () => {
      cancelAnimationFrame(rafRef.current)
      renderer.domElement.removeEventListener('mousemove', onMouseMove)
      renderer.domElement.removeEventListener('click',     onClick)
      unsub()
      clearMeshes()
      if (cursorSetRef.current) {
        renderer.domElement.style.cursor = ''
        cursorSetRef.current = false
      }
    }
  }, [scene, camera, renderer]) // stable WorldContext refs — effect runs once

  // ── UI Helpers ─────────────────────────────────────────────────────────────

  const TYPE_LABEL: Record<DecisionType, string> = {
    revenue: '◈ REVENUE',
    project: '◈ PROJECT',
    crew:    '◈ CREW',
    lead:    '◈ LEAD',
  }

  const TYPE_COLOR: Record<DecisionType, string> = {
    revenue: '#FFD700',
    project: '#00E5CC',
    crew:    '#FF9A00',
    lead:    '#40A0FF',
  }

  const KIND_ICON: Record<NexusInsight['kind'], string> = {
    strong:  '▲',
    weak:    '▼',
    missing: '○',
  }

  const DEPTH_LABEL = (count: number): string => {
    if (count >= 10) return 'MAJOR HIGHWAY'
    if (count >= 7)  return 'DEEP ROAD'
    if (count >= 4)  return 'WORN PATH'
    if (count >= 2)  return 'TRAIL'
    return 'FAINT TRACE'
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <>
      {/* ── Hover Tooltip ── */}
      {hovered && visible && (
        <div
          style={{
            position:      'fixed',
            left:          hovered.screenX + 16,
            top:           hovered.screenY - 12,
            zIndex:        55,
            pointerEvents: 'none',
            fontFamily:    'monospace',
          }}
        >
          <div style={{
            background:    'rgba(5,6,10,0.95)',
            border:        `1px solid ${TYPE_COLOR[hovered.def.type]}44`,
            borderRadius:  5,
            padding:       '7px 11px',
            backdropFilter: 'blur(12px)',
            boxShadow:     `0 2px 16px rgba(0,0,0,0.75), 0 0 10px ${TYPE_COLOR[hovered.def.type]}1a`,
            maxWidth:      240,
          }}>
            <div style={{
              fontSize:    9,
              fontWeight:  700,
              letterSpacing: 1.5,
              color:       TYPE_COLOR[hovered.def.type],
              marginBottom: 3,
            }}>
              {TYPE_LABEL[hovered.def.type]}
            </div>
            <div style={{
              fontSize:    11,
              color:       'rgba(255,255,255,0.88)',
              marginBottom: 5,
              lineHeight:  1.4,
            }}>
              {hovered.def.label}
            </div>
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.45)', lineHeight: 1.6 }}>
              <span style={{ color: TYPE_COLOR[hovered.def.type], fontWeight: 700 }}>
                {hovered.def.useCount}×
              </span>
              {' '}used in last 90 days
            </div>
            <div style={{
              fontSize:   9,
              color:      'rgba(255,255,255,0.28)',
              marginTop:  2,
            }}>
              {hovered.def.sourceLabel} → {hovered.def.targetLabel}
            </div>
            <div style={{
              fontSize:     8,
              color:        'rgba(255,255,255,0.20)',
              marginTop:    5,
              letterSpacing: 0.8,
              borderTop:    '1px solid rgba(255,255,255,0.06)',
              paddingTop:   4,
            }}>
              CLICK FOR FULL ANALYSIS
            </div>
          </div>
        </div>
      )}

      {/* ── Pathway Detail Panel (click) ── */}
      {selected && visible && (
        <div style={{
          position:       'fixed',
          top:            0,
          right:          0,
          bottom:         0,
          width:          340,
          zIndex:         50,
          background:     'rgba(4,5,9,0.97)',
          borderLeft:     `1px solid ${TYPE_COLOR[selected.type]}2a`,
          backdropFilter: 'blur(18px)',
          display:        'flex',
          flexDirection:  'column',
          fontFamily:     'monospace',
          overflowY:      'auto',
        }}>
          {/* ── Panel header ── */}
          <div style={{
            padding:    '14px 16px 10px',
            borderBottom: `1px solid ${TYPE_COLOR[selected.type]}1a`,
            position:   'sticky',
            top:        0,
            background: 'rgba(4,5,9,0.99)',
            zIndex:     1,
          }}>
            <div style={{
              display:        'flex',
              alignItems:     'center',
              justifyContent: 'space-between',
              marginBottom:   6,
            }}>
              <div style={{
                fontSize:      9,
                fontWeight:    700,
                letterSpacing: 2,
                color:         TYPE_COLOR[selected.type],
              }}>
                {TYPE_LABEL[selected.type]} PATHWAY
              </div>
              <button
                onClick={() => {
                  setSelected(null)
                  window.dispatchEvent(
                    new CustomEvent('nw:panel-state', { detail: { open: false } })
                  )
                }}
                style={{
                  background:    'none',
                  border:        '1px solid rgba(255,255,255,0.14)',
                  borderRadius:  3,
                  color:         'rgba(255,255,255,0.45)',
                  fontSize:      11,
                  cursor:        'pointer',
                  padding:       '2px 8px',
                  fontFamily:    'monospace',
                }}
              >
                ✕
              </button>
            </div>

            {/* Path label */}
            <div style={{
              fontSize:    13,
              fontWeight:  700,
              color:       'rgba(255,255,255,0.92)',
              lineHeight:  1.4,
              marginBottom: 10,
            }}>
              {selected.label}
            </div>

            {/* Stats pills */}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {[
                { label: 'USES',  value: `${selected.useCount}×` },
                {
                  label: 'LAST',
                  value: `${Math.round((Date.now() - selected.lastUsedMs) / MS_DAY)}d ago`,
                },
                { label: 'DEPTH', value: DEPTH_LABEL(selected.useCount) },
              ].map(s => (
                <div key={s.label} style={{
                  background:   `${TYPE_COLOR[selected.type]}10`,
                  border:       `1px solid ${TYPE_COLOR[selected.type]}30`,
                  borderRadius: 3,
                  padding:      '3px 8px',
                }}>
                  <div style={{
                    fontSize:      8,
                    color:         `${TYPE_COLOR[selected.type]}88`,
                    letterSpacing: 1,
                  }}>
                    {s.label}
                  </div>
                  <div style={{
                    fontSize:   11,
                    color:      TYPE_COLOR[selected.type],
                    fontWeight: 700,
                  }}>
                    {s.value}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* ── NEXUS Pattern Analysis ── */}
          <div style={{ padding: '12px 16px 8px' }}>
            <div style={{
              fontSize:      9,
              fontWeight:    700,
              letterSpacing: 1.5,
              color:         'rgba(0,229,204,0.65)',
              marginBottom:  7,
            }}>
              ◈ NEXUS PATTERN ANALYSIS
            </div>
            <div style={{
              background:   'rgba(0,229,204,0.04)',
              border:       '1px solid rgba(0,229,204,0.10)',
              borderRadius: 4,
              padding:      '9px 11px',
              fontSize:     11,
              color:        'rgba(255,255,255,0.58)',
              lineHeight:   1.65,
            }}>
              {selected.useCount >= 10 ? (
                <>
                  This is a <span style={{ color: '#00E5CC', fontWeight: 700 }}>deeply carved highway</span> — 
                  one of your most practiced decision habits. {selected.useCount} repetitions have built 
                  operational muscle memory. Consistency here drives predictable outcomes.
                </>
              ) : selected.useCount >= 7 ? (
                <>
                  A <span style={{ color: '#00E5CC' }}>deep road</span> with strong repeat signal. 
                  {selected.useCount} decisions along this path. Approaching highway depth — 
                  {10 - selected.useCount} more cycles to reach full habit strength.
                </>
              ) : selected.useCount >= 4 ? (
                <>
                  A <span style={{ color: '#FF9A00' }}>worn path</span> forming. 
                  {selected.useCount} repetitions visible. Not yet fully habitual but the 
                  terrain is shifting. Keep repeating to deepen this road.
                </>
              ) : selected.useCount >= 2 ? (
                <>
                  A <span style={{ color: '#FF9A00' }}>faint trail</span> — early signal of a 
                  recurring pattern. {selected.useCount} decisions logged. Repeat this path 
                  to begin carving it into operational routine.
                </>
              ) : (
                <>
                  A <span style={{ color: 'rgba(255,255,255,0.4)' }}>single trace</span>. 
                  This decision happened once. No pattern has formed yet. If repeated, 
                  a pathway will emerge.
                </>
              )}
              {(Date.now() - selected.lastUsedMs) > 30 * MS_DAY && (
                <span style={{ color: '#FF9A00', display: 'block', marginTop: 6 }}>
                  ⚠ Path fading — {Math.round((Date.now() - selected.lastUsedMs) / MS_DAY)}d since 
                  last use. Inactivity erodes the trail.
                </span>
              )}
            </div>
          </div>

          {/* ── Decision history ── */}
          <div style={{ padding: '4px 16px 20px', flex: 1 }}>
            <div style={{
              fontSize:      9,
              fontWeight:    700,
              letterSpacing: 1.5,
              color:         'rgba(255,255,255,0.3)',
              marginBottom:  7,
              marginTop:     4,
            }}>
              DECISION HISTORY ({selected.instances.length} SHOWN)
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {selected.instances.map((inst, i) => (
                <div key={i} style={{
                  background:   'rgba(255,255,255,0.025)',
                  border:       '1px solid rgba(255,255,255,0.06)',
                  borderRadius: 3,
                  padding:      '6px 9px',
                  display:      'flex',
                  justifyContent: 'space-between',
                  alignItems:   'flex-start',
                  gap:          8,
                }}>
                  <div>
                    <div style={{
                      fontSize:  10,
                      color:     'rgba(255,255,255,0.72)',
                      lineHeight: 1.4,
                    }}>
                      {inst.description}
                    </div>
                    <div style={{
                      fontSize:  9,
                      color:     'rgba(255,255,255,0.28)',
                      marginTop: 2,
                    }}>
                      {inst.date}
                    </div>
                  </div>
                  <div style={{
                    fontSize:      9,
                    color:
                      inst.outcome === 'Collected'       ? '#00E5CC' :
                      inst.outcome === 'Pending'         ? '#FF9A00' :
                      inst.outcome === 'Cancelled'       ? '#FF5060' :
                      inst.outcome === 'Lead converted'  ? '#40A0FF' :
                                                           'rgba(255,255,255,0.38)',
                    whiteSpace:    'nowrap',
                    letterSpacing: 0.5,
                    fontWeight:    700,
                    paddingTop:    1,
                    flexShrink:    0,
                  }}>
                    {inst.outcome}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── NEXUS Pathway Insights Panel ── */}
      {visible && insights.length > 0 && (
        <div style={{
          position:   'fixed',
          bottom:     14,
          right:      selected ? 358 : 14,
          zIndex:     35,
          width:      296,
          transition: 'right 0.22s ease',
          fontFamily: 'monospace',
        }}>
          {/* Toggle header */}
          <button
            onClick={() => setInsightsPanelOpen(prev => !prev)}
            style={{
              width:        '100%',
              background:   'rgba(0,229,204,0.09)',
              border:       '1px solid rgba(0,229,204,0.28)',
              borderBottom: insightsPanelOpen
                ? '1px solid rgba(0,229,204,0.10)'
                : '1px solid rgba(0,229,204,0.28)',
              borderRadius: insightsPanelOpen ? '5px 5px 0 0' : 5,
              color:        '#00E5CC',
              fontSize:     9,
              fontFamily:   'monospace',
              fontWeight:   700,
              letterSpacing: 1.8,
              padding:      '6px 10px',
              cursor:       'pointer',
              display:      'flex',
              alignItems:   'center',
              gap:          6,
              backdropFilter: 'blur(8px)',
            }}
          >
            <span>≋</span>
            <span style={{ flex: 1, textAlign: 'left' }}>NEXUS PATHWAY INSIGHTS</span>
            <span style={{ fontSize: 10, opacity: 0.7 }}>
              {insightsPanelOpen ? '▾' : '▸'}
            </span>
          </button>

          {/* Insights list */}
          {insightsPanelOpen && (
            <div style={{
              background:    'rgba(4,5,9,0.95)',
              border:        '1px solid rgba(0,229,204,0.16)',
              borderTop:     'none',
              borderRadius:  '0 0 5px 5px',
              backdropFilter: 'blur(14px)',
              boxShadow:     '0 4px 22px rgba(0,0,0,0.65)',
            }}>
              {insights.map((ins, i) => (
                <div key={i} style={{
                  display:      'flex',
                  gap:          8,
                  padding:      '8px 11px',
                  borderBottom: i < insights.length - 1
                    ? '1px solid rgba(255,255,255,0.045)'
                    : 'none',
                  alignItems:   'flex-start',
                }}>
                  <div style={{
                    fontSize:   11,
                    color:      ins.color,
                    flexShrink: 0,
                    marginTop:  1,
                    lineHeight: 1,
                    width:      12,
                    textAlign:  'center',
                  }}>
                    {KIND_ICON[ins.kind]}
                  </div>
                  <div style={{
                    fontSize:      10,
                    color:         'rgba(255,255,255,0.62)',
                    lineHeight:    1.55,
                    letterSpacing: 0.15,
                  }}>
                    {ins.text}
                  </div>
                </div>
              ))}

              {/* Color legend */}
              <div style={{
                padding:    '5px 11px 8px',
                borderTop:  '1px solid rgba(255,255,255,0.05)',
                display:    'flex',
                gap:        12,
                flexWrap:   'wrap',
              }}>
                {[
                  { color: '#FFD700', label: 'Revenue' },
                  { color: '#00E5CC', label: 'Project' },
                  { color: '#FF9A00', label: 'Crew'    },
                  { color: '#40A0FF', label: 'Lead'    },
                ].map(l => (
                  <div key={l.label} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <div style={{
                      width:        22,
                      height:       2,
                      borderRadius: 1,
                      background:   l.color,
                      boxShadow:    `0 0 5px ${l.color}88`,
                    }} />
                    <span style={{
                      fontSize:      8,
                      color:         'rgba(255,255,255,0.33)',
                      letterSpacing: 0.5,
                    }}>
                      {l.label}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </>
  )
}
