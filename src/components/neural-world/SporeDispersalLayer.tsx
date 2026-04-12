/**
 * SporeDispersalLayer.tsx — NW66: Lead generation spread as spore dispersal.
 *
 * Leads spread like spores from completed projects and marketing efforts.
 * Each lead source emits glowing 2px spore particles that float upward,
 * drift with a sine wave, then land and grow into lead nodes.
 *
 * SPORE COLORS:
 *   Teal  (0x00e5cc) — organic / referral / google listing
 *   Gold  (0xf5c518) — paid / ad campaign
 *   Amber (0xf59e0b) — repeat client
 *
 * SPORE LIFECYCLE:
 *   floating → landing → seedling (5s grow) → lead node → converted | dead
 *
 * DORMANT LEADS (7+ days no contact): spore dims, motion stops
 * DEAD / LOST LEADS: dissolves into dust particles
 *
 * Data: leads table via Supabase
 *   columns: id, source, status, estimated_value, created_at, last_contact
 *
 * Export: named export SporeDispersalLayer
 */

import { useEffect, useRef, useCallback } from 'react'
import * as THREE from 'three'
import { useWorldContext } from './WorldContext'
import { subscribeWorldData, seededPosition, type NWWorldData } from './DataBridge'
import { supabase } from '@/lib/supabase'

// ── Constants ─────────────────────────────────────────────────────────────────

const MAX_SPORES          = 60
const SPORE_RADIUS        = 0.06    // world-unit radius; renders as ~2px at distance
const SEEDLING_HEIGHT     = 0.35
const SEEDLING_GROW_TIME  = 5.0     // seconds to grow from sprout to node
const FLOAT_SPEED         = 0.9     // upward speed (world units / second)
const FLOAT_MAX_HEIGHT    = 6.0     // peak height before starting drift phase
const LAND_THRESHOLD      = 12.0    // horizontal distance from source at which spore lands
const DORMANT_DAYS        = 7       // days without contact → dormant
const DUST_COUNT          = 12      // dust particles per death event
const REFRESH_MS          = 60_000  // lead data refresh interval

// ── Colors ────────────────────────────────────────────────────────────────────

const COLOR_TEAL  = new THREE.Color(0x00e5cc)  // organic / referral
const COLOR_GOLD  = new THREE.Color(0xf5c518)  // paid / ad
const COLOR_AMBER = new THREE.Color(0xf59e0b)  // repeat client

const COLOR_SEEDLING    = new THREE.Color(0x22c55e)  // green sprout
const COLOR_NODE_BASE   = new THREE.Color(0x00e5cc)
const COLOR_CONVERTED   = new THREE.Color(0x4ade80)  // bright green when won
const COLOR_DORMANT_DIM = 0.18                        // opacity multiplier

// ── Types ─────────────────────────────────────────────────────────────────────

type SporeColor  = 'teal' | 'gold' | 'amber'
type SporePhase  = 'floating' | 'drifting' | 'landing' | 'seedling' | 'node' | 'converted' | 'dying' | 'dead'

interface NWLead {
  id:              string
  source:          string
  status:          string
  estimated_value: number
  created_at:      string | null
  last_contact:    string | null
}

interface SporeSource {
  x: number
  z: number
  color: SporeColor
}

interface DustParticle {
  vx: number
  vy: number
  vz: number
  life: number   // 0–1, decreasing
}

interface Spore {
  id:        string
  leadId:    string
  phase:     SporePhase
  color:     SporeColor

  // World position
  x: number
  y: number
  z: number

  // Source (emitter) position
  srcX: number
  srcZ: number

  // Target landing position (seeded from lead id, offset from source)
  tgtX: number
  tgtZ: number

  // Motion
  vy:        number   // vertical velocity
  sineAmp:   number   // horizontal sine amplitude
  sineFreq:  number   // sine frequency
  sinePhase: number   // sine phase offset per axis
  sinePhaseZ: number

  // Lifecycle timing
  age:       number   // total seconds alive
  phaseTime: number   // seconds in current phase

  // Lead properties
  estimatedValue: number
  isDormant:      boolean

  // Three.js objects (created on demand)
  sporeMesh:    THREE.Mesh | null
  seedlingMesh: THREE.Mesh | null
  nodeMesh:     THREE.Mesh | null
  vineLine:     THREE.Line | null
  dustMeshes:   THREE.Mesh[]
  dustData:     DustParticle[]
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Deterministic hash → 0-1 float from a string. */
function _hash(s: string, salt = 0): number {
  let h = 0x811c9dc5 ^ salt
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return ((h >>> 0) / 0xffffffff)
}

/** Determine spore color from lead source string. */
function _sporeColor(source: string): SporeColor {
  const s = source.toLowerCase()
  if (s.includes('repeat') || s.includes('returning') || s.includes('existing')) return 'amber'
  if (s.includes('ad') || s.includes('paid') || s.includes('campaign') || s.includes('ppc') || s.includes('google_ads')) return 'gold'
  return 'teal'  // organic, referral, google listing, word of mouth, etc.
}

/** Get THREE.Color for a spore color key. */
function _threeColor(c: SporeColor): THREE.Color {
  if (c === 'gold')  return COLOR_GOLD.clone()
  if (c === 'amber') return COLOR_AMBER.clone()
  return COLOR_TEAL.clone()
}

/** Check if lead is dormant (no contact for 7+ days). */
function _isDormant(lead: NWLead): boolean {
  const ref = lead.last_contact ?? lead.created_at
  if (!ref) return false
  const ms = Date.now() - new Date(ref).getTime()
  return ms > DORMANT_DAYS * 24 * 60 * 60 * 1000
}

/** Determine initial phase from lead status. */
function _initialPhase(status: string): SporePhase {
  const s = status.toLowerCase()
  if (s === 'converted' || s === 'won' || s === 'closed_won') return 'converted'
  if (s === 'lost'      || s === 'dead' || s === 'closed_lost' || s === 'disqualified') return 'dying'
  if (s === 'qualified' || s === 'proposal' || s === 'contacted') return 'node'
  if (s === 'new'       || s === 'open') return 'floating'
  return 'floating'
}

/** Node sphere radius from estimated value. */
function _nodeRadius(value: number): number {
  if (value <= 0)       return 0.25
  if (value >= 100000)  return 1.8
  if (value >= 50000)   return 1.2 + (value - 50000) / 50000 * 0.6
  if (value >= 10000)   return 0.6 + (value - 10000) / 40000 * 0.6
  if (value >= 1000)    return 0.3 + (value - 1000)  / 9000  * 0.3
  return 0.25 + (value / 1000) * 0.05
}

/** Seeded landing target: offset from source with deterministic scatter. */
function _landingTarget(leadId: string, srcX: number, srcZ: number): { tgtX: number; tgtZ: number } {
  const angle = _hash(leadId, 1) * Math.PI * 2
  const dist  = 8 + _hash(leadId, 2) * 14  // 8–22 units from source
  return {
    tgtX: srcX + Math.cos(angle) * dist,
    tgtZ: srcZ + Math.sin(angle) * dist,
  }
}

/** Build a spore source position for a given lead. Project-sourced leads
 *  use the parent project's seeded position; others use a seeded global position. */
function _sporeSource(lead: NWLead, projectPositions: Map<string, { x: number; z: number }>): SporeSource {
  // Try to match by source = project id or name keyword
  for (const [projId, pos] of projectPositions) {
    if (lead.source?.includes(projId)) {
      return { x: pos.x, z: pos.z, color: _sporeColor(lead.source) }
    }
  }

  // Fallback: deterministic global position for campaign / referral sources
  const n1 = _hash(lead.source ?? lead.id, 3)
  const n2 = _hash(lead.source ?? lead.id, 4)
  // Place sources in east continent area (x = 20 to 180) to distinguish from west projects
  const x = 20 + n1 * 160
  const z = (n2 - 0.5) * 360
  return { x, z, color: _sporeColor(lead.source ?? '') }
}

// ── Geometry factories ────────────────────────────────────────────────────────

function _makeSporeGeo(): THREE.SphereGeometry {
  return new THREE.SphereGeometry(SPORE_RADIUS, 4, 4)
}

function _makeSporeMat(color: SporeColor): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color:       _threeColor(color),
    transparent: true,
    opacity:     0.9,
    depthWrite:  false,
    blending:    THREE.AdditiveBlending,
  })
}

function _makeSeedlingMesh(color: SporeColor): THREE.Mesh {
  // Tiny upward cone representing a sprout
  const geo = new THREE.ConeGeometry(0.04, SEEDLING_HEIGHT, 5)
  const mat = new THREE.MeshStandardMaterial({
    color:             COLOR_SEEDLING,
    emissive:          COLOR_SEEDLING,
    emissiveIntensity: 0.6,
    transparent:       true,
    opacity:           0.85,
    roughness:         0.6,
    metalness:         0.1,
  })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.scale.setScalar(0.01)  // starts invisible, grows up
  void color  // color determines connection line but seedling is always green
  return mesh
}

function _makeNodeMesh(color: SporeColor, value: number): THREE.Mesh {
  const radius = _nodeRadius(value)
  const geo    = new THREE.SphereGeometry(radius, 10, 8)
  const c      = _threeColor(color)
  const mat    = new THREE.MeshStandardMaterial({
    color:             c,
    emissive:          c,
    emissiveIntensity: 0.3,
    transparent:       true,
    opacity:           0.38,
    roughness:         0.3,
    metalness:         0.4,
    depthWrite:        false,
  })
  return new THREE.Mesh(geo, mat)
}

function _makeVineLine(
  srcX: number, srcY: number, srcZ: number,
  tgtX: number, tgtY: number, tgtZ: number,
  color: SporeColor,
): THREE.Line {
  const points = [
    new THREE.Vector3(srcX, srcY, srcZ),
    new THREE.Vector3(tgtX, tgtY, tgtZ),
  ]
  const geo = new THREE.BufferGeometry().setFromPoints(points)
  const mat = new THREE.LineBasicMaterial({
    color:       _threeColor(color),
    transparent: true,
    opacity:     0.28,
    depthWrite:  false,
  })
  return new THREE.Line(geo, mat)
}

function _makeDustMesh(color: SporeColor): THREE.Mesh {
  const geo = new THREE.SphereGeometry(0.03, 3, 3)
  const mat = new THREE.MeshBasicMaterial({
    color:       _threeColor(color),
    transparent: true,
    opacity:     0.7,
    depthWrite:  false,
    blending:    THREE.AdditiveBlending,
  })
  return new THREE.Mesh(geo, mat)
}

// ── Component ─────────────────────────────────────────────────────────────────

interface SporeDispersalLayerProps {
  visible: boolean
}

export function SporeDispersalLayer({ visible }: SporeDispersalLayerProps) {
  const { scene } = useWorldContext()

  // Three.js group
  const groupRef       = useRef<THREE.Group | null>(null)
  const sporesRef      = useRef<Spore[]>([])
  const visibleRef     = useRef(visible)
  visibleRef.current   = visible

  // Live data refs
  const leadsRef          = useRef<NWLead[]>([])
  const projectPositions  = useRef<Map<string, { x: number; z: number }>>(new Map())
  const refreshTimerRef   = useRef<ReturnType<typeof setInterval> | null>(null)

  // ── Dispose a single spore's Three.js objects ────────────────────────────────
  const disposeSpore = useCallback((spore: Spore, group: THREE.Group) => {
    if (spore.sporeMesh) {
      spore.sporeMesh.geometry.dispose()
      ;(spore.sporeMesh.material as THREE.Material).dispose()
      group.remove(spore.sporeMesh)
      spore.sporeMesh = null
    }
    if (spore.seedlingMesh) {
      spore.seedlingMesh.geometry.dispose()
      ;(spore.seedlingMesh.material as THREE.Material).dispose()
      group.remove(spore.seedlingMesh)
      spore.seedlingMesh = null
    }
    if (spore.nodeMesh) {
      spore.nodeMesh.geometry.dispose()
      ;(spore.nodeMesh.material as THREE.Material).dispose()
      group.remove(spore.nodeMesh)
      spore.nodeMesh = null
    }
    if (spore.vineLine) {
      spore.vineLine.geometry.dispose()
      ;(spore.vineLine.material as THREE.Material).dispose()
      group.remove(spore.vineLine)
      spore.vineLine = null
    }
    spore.dustMeshes.forEach(dm => {
      dm.geometry.dispose()
      ;(dm.material as THREE.Material).dispose()
      group.remove(dm)
    })
    spore.dustMeshes = []
    spore.dustData   = []
  }, [])

  // ── Build spores from lead data ───────────────────────────────────────────────
  const rebuildSpores = useCallback((leads: NWLead[]) => {
    const group = groupRef.current
    if (!group) return

    // Dispose all existing spores
    for (const s of sporesRef.current) {
      disposeSpore(s, group)
    }
    sporesRef.current = []

    // Limit to MAX_SPORES by recency
    const sorted = [...leads]
      .sort((a, b) => {
        const ta = a.created_at ? new Date(a.created_at).getTime() : 0
        const tb = b.created_at ? new Date(b.created_at).getTime() : 0
        return tb - ta  // newest first
      })
      .slice(0, MAX_SPORES)

    const newSpores: Spore[] = []

    for (const lead of sorted) {
      const src         = _sporeSource(lead, projectPositions.current)
      const dormant     = _isDormant(lead)
      const initialPhase = _initialPhase(lead.status)
      const { tgtX, tgtZ } = _landingTarget(lead.id, src.x, src.z)

      // Start y: on the ground at source, or at node height if already qualified
      const startY = (initialPhase === 'node' || initialPhase === 'converted') ? 0.5 : 0.1

      const spore: Spore = {
        id:             lead.id,
        leadId:         lead.id,
        phase:          initialPhase,
        color:          src.color,
        x:              src.x + (_hash(lead.id, 5) - 0.5) * 2,
        y:              startY,
        z:              src.z + (_hash(lead.id, 6) - 0.5) * 2,
        srcX:           src.x,
        srcZ:           src.z,
        tgtX,
        tgtZ,
        vy:             FLOAT_SPEED * (0.7 + _hash(lead.id, 7) * 0.6),
        sineAmp:        0.8 + _hash(lead.id, 8) * 1.8,
        sineFreq:       0.4 + _hash(lead.id, 9) * 0.8,
        sinePhase:      _hash(lead.id, 10) * Math.PI * 2,
        sinePhaseZ:     _hash(lead.id, 11) * Math.PI * 2,
        age:            0,
        phaseTime:      0,
        estimatedValue: lead.estimated_value ?? 0,
        isDormant:      dormant,
        sporeMesh:      null,
        seedlingMesh:   null,
        nodeMesh:       null,
        vineLine:       null,
        dustMeshes:     [],
        dustData:       [],
      }

      // If already at node/converted phase, position at target
      if (initialPhase === 'node' || initialPhase === 'converted') {
        spore.x = tgtX
        spore.z = tgtZ
        spore.y = 0.1
      }

      // If dying/dead, skip — will show brief dust on first frame
      if (initialPhase === 'dying') {
        spore.phase = 'dying'
        spore.x     = tgtX
        spore.z     = tgtZ
        spore.y     = 0.1
      }

      newSpores.push(spore)
    }

    sporesRef.current = newSpores
  }, [disposeSpore])

  // ── Fetch leads from Supabase ─────────────────────────────────────────────────
  const fetchLeads = useCallback(async () => {
    try {
      const result = await (supabase as any)
        .from('leads')
        .select('id, source, status, estimated_value, created_at, last_contact')
        .order('created_at', { ascending: false })
        .limit(MAX_SPORES * 2)

      const raw: NWLead[] = (result.data ?? []).map((r: any) => ({
        id:              r.id              ?? '',
        source:          r.source          ?? 'organic',
        status:          r.status          ?? 'new',
        estimated_value: typeof r.estimated_value === 'number' ? r.estimated_value : 0,
        created_at:      r.created_at      ?? null,
        last_contact:    r.last_contact    ?? null,
      }))

      leadsRef.current = raw
      rebuildSpores(raw)
    } catch {
      // Non-fatal: leads table may not exist yet
    }
  }, [rebuildSpores])

  // ── Subscribe to world data for project positions ────────────────────────────
  useEffect(() => {
    const unsub = subscribeWorldData((data: NWWorldData) => {
      const map = new Map<string, { x: number; z: number }>()
      for (const p of data.projects) {
        if (p.status === 'completed') {
          map.set(p.id, seededPosition(p.id))
        }
      }
      projectPositions.current = map
      // Re-seed spores when project positions change
      if (leadsRef.current.length > 0) {
        rebuildSpores(leadsRef.current)
      }
    })
    return unsub
  }, [rebuildSpores])

  // ── Setup scene group + initial fetch + refresh loop ─────────────────────────
  useEffect(() => {
    const group = new THREE.Group()
    group.name    = 'SporeDispersalLayer'
    group.visible = visible
    scene.add(group)
    groupRef.current = group

    // Initial fetch
    fetchLeads()

    // Refresh every 60s
    refreshTimerRef.current = setInterval(fetchLeads, REFRESH_MS)

    return () => {
      if (refreshTimerRef.current) {
        clearInterval(refreshTimerRef.current)
        refreshTimerRef.current = null
      }
      cancelAnimationFrame(0)
      const currentGroup = groupRef.current
      if (currentGroup) {
        for (const s of sporesRef.current) {
          disposeSpore(s, currentGroup)
        }
        sporesRef.current = []
        scene.remove(currentGroup)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene])

  // ── Animation via nw:frame event ─────────────────────────────────────────────
  useEffect(() => {
    let lastTime = performance.now()

    function onFrame() {
      const group = groupRef.current
      if (!group || !visibleRef.current) return

      const now   = performance.now()
      const delta = Math.min((now - lastTime) / 1000, 0.1)
      lastTime    = now

      const t = now / 1000

      for (const spore of sporesRef.current) {
        spore.age       += delta
        spore.phaseTime += delta

        // Dormant override: dim spore, freeze motion (but still render node/seedling)
        if (spore.isDormant && spore.phase === 'floating') {
          spore.phase = 'floating'  // stays floating but dim
          _animateSporeFloat(spore, group, delta, t, true)
          continue
        }

        switch (spore.phase) {
          case 'floating':
            _animateSporeFloat(spore, group, delta, t, false)
            break
          case 'drifting':
            _animateSporeFloat(spore, group, delta, t, false)
            break
          case 'landing':
            _animateLanding(spore, group, delta)
            break
          case 'seedling':
            _animateSeedling(spore, group, delta, t)
            break
          case 'node':
            _animateNode(spore, group, t)
            break
          case 'converted':
            _animateConverted(spore, group, t)
            break
          case 'dying':
            _animateDying(spore, group, delta)
            break
          case 'dead':
            // Nothing to animate; mesh was removed during dying transition
            break
        }
      }
    }

    window.addEventListener('nw:frame', onFrame)
    return () => window.removeEventListener('nw:frame', onFrame)
  }, [])

  // ── Visibility sync ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (groupRef.current) groupRef.current.visible = visible
  }, [visible])

  return null
}

// ── Phase animation helpers (module-scope for perf) ─────────────────────────

function _ensureSporeMesh(spore: Spore, group: THREE.Group): THREE.Mesh {
  if (!spore.sporeMesh) {
    const geo  = _makeSporeGeo()
    const mat  = _makeSporeMat(spore.color)
    const mesh = new THREE.Mesh(geo, mat)
    mesh.position.set(spore.x, spore.y, spore.z)
    group.add(mesh)
    spore.sporeMesh = mesh
  }
  return spore.sporeMesh
}

function _animateSporeFloat(
  spore: Spore,
  group: THREE.Group,
  delta: number,
  t: number,
  dormant: boolean,
) {
  const mesh = _ensureSporeMesh(spore, group)
  const mat  = mesh.material as THREE.MeshBasicMaterial

  if (!dormant) {
    // Move upward
    spore.y += spore.vy * delta

    // Gentle sine drift in x and z
    const sineX = spore.sineAmp * Math.sin(t * spore.sineFreq + spore.sinePhase)
    const sineZ = spore.sineAmp * Math.cos(t * spore.sineFreq + spore.sinePhaseZ)
    spore.x = spore.srcX + sineX
    spore.z = spore.srcZ + sineZ

    // Transition to drifting phase once peak reached
    if (spore.y >= FLOAT_MAX_HEIGHT && spore.phase === 'floating') {
      spore.phase     = 'drifting'
      spore.phaseTime = 0
    }

    // Transition to landing once horizontal distance exceeds threshold
    if (spore.phase === 'drifting') {
      const dx   = spore.x - spore.srcX
      const dz   = spore.z - spore.srcZ
      const dist = Math.sqrt(dx * dx + dz * dz)
      if (dist >= LAND_THRESHOLD) {
        spore.phase     = 'landing'
        spore.phaseTime = 0
      }
    }
  }

  mesh.position.set(spore.x, spore.y, spore.z)

  // Twinkle opacity
  const twinkle = dormant
    ? COLOR_DORMANT_DIM * (0.8 + 0.2 * Math.sin(t * 0.5 + spore.sinePhase))
    : 0.7 + 0.3 * Math.sin(t * 3.0 + spore.sinePhase)
  mat.opacity  = twinkle
  mat.color.copy(_threeColor(spore.color))
  if (dormant) mat.color.multiplyScalar(0.4)
}

function _animateLanding(spore: Spore, group: THREE.Group, delta: number) {
  const mesh = _ensureSporeMesh(spore, group)
  const mat  = mesh.material as THREE.MeshBasicMaterial

  // Drift toward landing target while falling
  spore.x += (spore.tgtX - spore.x) * delta * 2.0
  spore.z += (spore.tgtZ - spore.z) * delta * 2.0
  spore.y  = Math.max(0.05, spore.y - delta * 2.5)

  mesh.position.set(spore.x, spore.y, spore.z)

  // Fade out spore as it approaches ground
  const fade  = Math.max(0, spore.y / FLOAT_MAX_HEIGHT)
  mat.opacity = fade * 0.85

  // Once near ground: transition to seedling or fades (lead lost)
  if (spore.y <= 0.12) {
    // Remove spore mesh — replaced by seedling/node
    if (spore.sporeMesh) {
      spore.sporeMesh.geometry.dispose()
      ;(spore.sporeMesh.material as THREE.Material).dispose()
      group.remove(spore.sporeMesh)
      spore.sporeMesh = null
    }

    // Qualified lead → seedling phase; new/unknown → coin flip seeded by id
    const qualifies = _hash(spore.leadId, 12) > 0.4
    if (qualifies) {
      spore.phase     = 'seedling'
      spore.phaseTime = 0
      spore.x         = spore.tgtX
      spore.z         = spore.tgtZ
      spore.y         = 0.0
      _spawnSeedling(spore, group)
    } else {
      // Lead lost — skip straight to dying
      spore.phase     = 'dying'
      spore.phaseTime = 0
      _spawnDust(spore, group)
    }
  }
}

function _spawnSeedling(spore: Spore, group: THREE.Group) {
  if (spore.seedlingMesh) return
  const mesh = _makeSeedlingMesh(spore.color)
  mesh.position.set(spore.tgtX, SEEDLING_HEIGHT / 2, spore.tgtZ)
  mesh.scale.setScalar(0.01)
  group.add(mesh)
  spore.seedlingMesh = mesh

  // Add vine from source to seedling landing point
  const vine = _makeVineLine(
    spore.srcX, 0.05, spore.srcZ,
    spore.tgtX, 0.05, spore.tgtZ,
    spore.color,
  )
  group.add(vine)
  spore.vineLine = vine
}

function _animateSeedling(spore: Spore, group: THREE.Group, delta: number, t: number) {
  if (!spore.seedlingMesh) {
    _spawnSeedling(spore, group)
    return
  }

  const progress = Math.min(spore.phaseTime / SEEDLING_GROW_TIME, 1.0)
  // Ease-out cubic grow
  const scale    = 0.01 + 0.99 * (1 - Math.pow(1 - progress, 3))
  spore.seedlingMesh.scale.setScalar(scale)

  // Gentle sway while growing
  spore.seedlingMesh.rotation.z = Math.sin(t * 1.5 + spore.sinePhase) * 0.08 * (1 - progress)

  const mat = spore.seedlingMesh.material as THREE.MeshStandardMaterial
  mat.opacity = 0.5 + 0.35 * progress

  // Vine pulses — opacity grows with seedling
  if (spore.vineLine) {
    const lineMat = spore.vineLine.material as THREE.LineBasicMaterial
    lineMat.opacity = 0.1 + 0.2 * progress * (0.8 + 0.2 * Math.sin(t * 2 + spore.sinePhase))
  }

  // Once fully grown → transition to node sphere
  if (progress >= 1.0) {
    // Dispose seedling mesh
    if (spore.seedlingMesh) {
      spore.seedlingMesh.geometry.dispose()
      ;(spore.seedlingMesh.material as THREE.Material).dispose()
      group.remove(spore.seedlingMesh)
      spore.seedlingMesh = null
    }
    // Spawn node
    const node = _makeNodeMesh(spore.color, spore.estimatedValue)
    const nodeY = _nodeRadius(spore.estimatedValue)
    node.position.set(spore.tgtX, nodeY, spore.tgtZ)
    group.add(node)
    spore.nodeMesh  = node
    spore.phase     = 'node'
    spore.phaseTime = 0
  }
}

function _animateNode(spore: Spore, group: THREE.Group, t: number) {
  if (!spore.nodeMesh) {
    // Lazy-create for leads already in node phase at load time
    const node  = _makeNodeMesh(spore.color, spore.estimatedValue)
    const nodeY = _nodeRadius(spore.estimatedValue)
    node.position.set(spore.tgtX, nodeY, spore.tgtZ)
    group.add(node)
    spore.nodeMesh = node

    // Add vine if not present
    if (!spore.vineLine) {
      const vine = _makeVineLine(
        spore.srcX, 0.05, spore.srcZ,
        spore.tgtX, 0.05, spore.tgtZ,
        spore.color,
      )
      group.add(vine)
      spore.vineLine = vine
    }
  }

  const mat    = spore.nodeMesh.material as THREE.MeshStandardMaterial
  const pulse  = 0.28 + 0.10 * Math.sin(t * 1.8 + spore.sinePhase)
  mat.opacity  = spore.isDormant ? pulse * 0.25 : pulse
  mat.emissiveIntensity = spore.isDormant ? 0.05 : 0.25 + 0.15 * Math.sin(t * 2.2 + spore.sinePhase)

  // Gentle float
  const baseY = _nodeRadius(spore.estimatedValue)
  spore.nodeMesh.position.y = baseY + Math.sin(t * 0.7 + spore.sinePhase) * 0.12

  // Vine trace pulse
  if (spore.vineLine) {
    const lineMat = spore.vineLine.material as THREE.LineBasicMaterial
    lineMat.opacity = spore.isDormant
      ? 0.05
      : 0.15 + 0.13 * Math.sin(t * 1.4 + spore.sinePhase)
  }
}

function _animateConverted(spore: Spore, group: THREE.Group, t: number) {
  if (!spore.nodeMesh) {
    const node  = _makeNodeMesh(spore.color, spore.estimatedValue)
    const nodeY = _nodeRadius(spore.estimatedValue)
    node.position.set(spore.tgtX, nodeY, spore.tgtZ)
    group.add(node)
    spore.nodeMesh = node

    if (!spore.vineLine) {
      const vine = _makeVineLine(
        spore.srcX, 0.05, spore.srcZ,
        spore.tgtX, 0.05, spore.tgtZ,
        spore.color,
      )
      group.add(vine)
      spore.vineLine = vine
    }
  }

  // Converted: glowing green, grows larger over time (becomes mountain base)
  const growScale = 1.0 + Math.min(spore.phaseTime * 0.04, 0.8)  // grows slowly
  spore.nodeMesh.scale.setScalar(growScale)

  const mat = spore.nodeMesh.material as THREE.MeshStandardMaterial
  mat.color.copy(COLOR_CONVERTED)
  mat.emissive.copy(COLOR_CONVERTED)
  mat.opacity           = 0.45 + 0.15 * Math.sin(t * 1.2 + spore.sinePhase)
  mat.emissiveIntensity = 0.4  + 0.2  * Math.sin(t * 1.8 + spore.sinePhase)

  // Position: rise slightly as it grows
  const baseY = _nodeRadius(spore.estimatedValue) * growScale
  spore.nodeMesh.position.y = baseY + Math.sin(t * 0.5 + spore.sinePhase) * 0.08

  // Vine brightens on conversion
  if (spore.vineLine) {
    const lineMat = spore.vineLine.material as THREE.LineBasicMaterial
    lineMat.color.copy(COLOR_CONVERTED)
    lineMat.opacity = 0.35 + 0.1 * Math.sin(t * 1.6 + spore.sinePhase)
  }
}

function _spawnDust(spore: Spore, group: THREE.Group) {
  if (spore.dustMeshes.length > 0) return
  for (let i = 0; i < DUST_COUNT; i++) {
    const mesh = _makeDustMesh(spore.color)
    mesh.position.set(spore.x, spore.y, spore.z)
    group.add(mesh)
    spore.dustMeshes.push(mesh)

    const angle = (i / DUST_COUNT) * Math.PI * 2 + Math.random() * 0.4
    const speed = 1.0 + Math.random() * 2.0
    spore.dustData.push({
      vx:   Math.cos(angle) * speed,
      vy:   0.5 + Math.random() * 1.5,
      vz:   Math.sin(angle) * speed,
      life: 1.0,
    })
  }
}

function _animateDying(spore: Spore, group: THREE.Group, delta: number) {
  // Ensure dust particles exist
  if (spore.dustMeshes.length === 0) {
    _spawnDust(spore, group)
  }

  // Animate dust outward + fade
  for (let i = 0; i < spore.dustMeshes.length; i++) {
    const dm   = spore.dustMeshes[i]
    const dd   = spore.dustData[i]
    dd.life    = Math.max(0, dd.life - delta * 1.2)
    dm.position.x += dd.vx * delta
    dm.position.y += dd.vy * delta
    dm.position.z += dd.vz * delta
    dd.vy          -= 2.5 * delta  // gravity
    const mat      = dm.material as THREE.MeshBasicMaterial
    mat.opacity    = dd.life * 0.7
    dm.visible     = dd.life > 0.02
  }

  // Once all dust faded, remove meshes and mark dead
  const allFaded = spore.dustData.every(dd => dd.life <= 0.02)
  if (allFaded) {
    for (const dm of spore.dustMeshes) {
      dm.geometry.dispose()
      ;(dm.material as THREE.Material).dispose()
      group.remove(dm)
    }
    spore.dustMeshes = []
    spore.dustData   = []
    spore.phase      = 'dead'
  }
}
