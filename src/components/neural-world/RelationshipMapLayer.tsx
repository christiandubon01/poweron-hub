/**
 * RelationshipMapLayer.tsx — NW77: Orbital relationship map around the user's position.
 *
 * Visualises key business and personal contacts as an orbital system centred on
 * the player avatar:
 *
 *   User avatar    — small glowing orb that follows the player position.
 *   Orbit rings    — three concentric rings (inner 5u, middle 15u, outer 30u)
 *                    drawn as THREE.LineLoop in a soft white-blue.
 *   Contact sphere — SphereGeometry sized by business value (0.4–1.8 radius).
 *                    Orbits at its ring distance; orbit speed proportional to
 *                    contact activity (active=fast, dormant=slow).
 *   Sphere color   — gold   #f0c040  clients
 *                    teal   #00c8b8  partners
 *                    amber  #f08030  mentors
 *                    gray   #808090  prospects
 *   Health glow    — PointLight above each sphere:
 *                      green  #40ff80  interaction < 7 days
 *                      amber  #f0a020  interaction 7–30 days
 *                      red    #ff3030  interaction > 30 days
 *   Strength line  — LineSegments from user to each contact;
 *                    line opacity encodes interaction frequency.
 *   Label sprite   — contact name drawn via makeLabel above sphere.
 *   Click panel    — React overlay showing name, role, last interaction,
 *                    total business value, notes.
 *
 * Data:
 *   Stored in localStorage key 'nw77_contacts_v1'.
 *   Attempts to read/write Supabase table 'contacts' when available.
 *
 * Events listened:
 *   'nw:contact-add'  — CustomEvent<{name,category,value}>  — adds a contact.
 *   'nw:frame'        — dispatched each animation tick by WorldEngine.
 *
 * Events dispatched:
 *   'nw:contact-add'  — can also be dispatched externally.
 *
 * Export: named export RelationshipMapLayer.
 */

import React, { useEffect, useRef, useState, useCallback } from 'react'
import * as THREE from 'three'
import { useWorldContext } from './WorldContext'
import { makeLabel, disposeLabel, type NWLabel } from './utils/makeLabel'

// ── Types ──────────────────────────────────────────────────────────────────────

export type ContactCategory = 'client' | 'partner' | 'mentor' | 'prospect'
export type ContactOrbit     = 'inner' | 'middle' | 'outer'

export interface RelContact {
  id:            string
  name:          string
  role:          string
  category:      ContactCategory
  /** Orbit closeness — inner = closest business partners */
  orbit:         ContactOrbit
  /** Business value in USD (used for sphere sizing) */
  value:         number
  /** Interaction frequency per month (used for line opacity + orbit speed) */
  frequency:     number
  /** ISO date string of last interaction */
  lastContact:   string
  /** Free-form notes */
  notes:         string
}

// ── Constants ──────────────────────────────────────────────────────────────────

const LS_KEY = 'nw77_contacts_v1'

const ORBIT_RADII: Record<ContactOrbit, number> = {
  inner:  5,
  middle: 15,
  outer:  30,
}

/** Base orbit angular speed (rad/s) — multiplied by frequency factor */
const BASE_SPEED: Record<ContactOrbit, number> = {
  inner:  0.60,
  middle: 0.35,
  outer:  0.18,
}

const CATEGORY_COLORS: Record<ContactCategory, number> = {
  client:   0xf0c040,
  partner:  0x00c8b8,
  mentor:   0xf08030,
  prospect: 0x808090,
}

const CATEGORY_HEX: Record<ContactCategory, string> = {
  client:   '#f0c040',
  partner:  '#00c8b8',
  mentor:   '#f08030',
  prospect: '#808090',
}

/** Avatar (user) orb constants */
const AVATAR_RADIUS  = 0.55
const AVATAR_COLOR   = 0x60b0ff
const AVATAR_EMISSIVE = 0x1040a0
const AVATAR_LIGHT_COLOR = 0x80c0ff
const AVATAR_LIGHT_INTENSITY = 3.5

/** Min / max contact sphere radius (scales with business value) */
const SPHERE_R_MIN = 0.30
const SPHERE_R_MAX = 1.60

/** Interaction-health thresholds (days) */
const HEALTH_GREEN_DAYS = 7
const HEALTH_AMBER_DAYS = 30

const HEALTH_COLORS = {
  green: { hex: 0x40ff80, str: '#40ff80' },
  amber: { hex: 0xf0a020, str: '#f0a020' },
  red:   { hex: 0xff3030, str: '#ff3030' },
}

const RING_COLOR  = 0x4080c0
const RING_OPACITY = 0.30

const LINE_OPACITY_BASE = 0.15
const LINE_OPACITY_MAX  = 0.80

const AVATAR_Y_OFFSET   = 1.2   // above ground
const CONTACT_Y_BASE    = 1.5   // contact float height
const LABEL_Y_ABOVE     = 2.8   // label above sphere centre

// ── Default seed contacts ──────────────────────────────────────────────────────

const DEFAULT_CONTACTS: RelContact[] = [
  {
    id: 'c1',
    name: 'Marcus Rivera',
    role: 'GC Partner',
    category: 'partner',
    orbit: 'inner',
    value: 85000,
    frequency: 12,
    lastContact: new Date(Date.now() - 2 * 86400_000).toISOString(),
    notes: 'Key subcontracting relationship. Refers commercial work.',
  },
  {
    id: 'c2',
    name: 'Diane Lowe',
    role: 'Key Client',
    category: 'client',
    orbit: 'inner',
    value: 120000,
    frequency: 8,
    lastContact: new Date(Date.now() - 10 * 86400_000).toISOString(),
    notes: 'Multi-property portfolio. Annual service agreement.',
  },
  {
    id: 'c3',
    name: 'James Kato',
    role: 'Mentor / Advisor',
    category: 'mentor',
    orbit: 'inner',
    value: 0,
    frequency: 4,
    lastContact: new Date(Date.now() - 18 * 86400_000).toISOString(),
    notes: 'Business strategy advisor. Monthly check-in.',
  },
  {
    id: 'c4',
    name: 'Coastal Electric',
    role: 'Subcontractor',
    category: 'partner',
    orbit: 'middle',
    value: 45000,
    frequency: 6,
    lastContact: new Date(Date.now() - 5 * 86400_000).toISOString(),
    notes: 'Solar panel wiring crew. Reliable for overflow.',
  },
  {
    id: 'c5',
    name: 'SunPath Solar',
    role: 'Vendor',
    category: 'partner',
    orbit: 'middle',
    value: 30000,
    frequency: 3,
    lastContact: new Date(Date.now() - 35 * 86400_000).toISOString(),
    notes: 'Panel supply. Long lead times — order early.',
  },
  {
    id: 'c6',
    name: 'Roberto Fuentes',
    role: 'Regular Client',
    category: 'client',
    orbit: 'middle',
    value: 22000,
    frequency: 5,
    lastContact: new Date(Date.now() - 14 * 86400_000).toISOString(),
    notes: 'Residential remodel work.',
  },
  {
    id: 'c7',
    name: 'Harbor View HOA',
    role: 'Prospect',
    category: 'prospect',
    orbit: 'outer',
    value: 8000,
    frequency: 1,
    lastContact: new Date(Date.now() - 70 * 86400_000).toISOString(),
    notes: 'Cold lead. Common area lighting project.',
  },
  {
    id: 'c8',
    name: 'Pacific Build Co',
    role: 'Cold Contact',
    category: 'prospect',
    orbit: 'outer',
    value: 0,
    frequency: 0,
    lastContact: new Date(Date.now() - 90 * 86400_000).toISOString(),
    notes: 'Met at trade show. No active conversation.',
  },
]

// ── localStorage helpers ───────────────────────────────────────────────────────

function loadContacts(): RelContact[] {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as RelContact[]
      if (Array.isArray(parsed) && parsed.length > 0) return parsed
    }
  } catch { /* ignore */ }
  return DEFAULT_CONTACTS
}

function saveContacts(contacts: RelContact[]): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(contacts))
  } catch { /* ignore — quota */ }
}

// ── Supabase sync (best-effort, silent on error) ──────────────────────────────

async function trySupabasePull(): Promise<RelContact[] | null> {
  try {
    const { supabase } = await import('@/lib/supabase')
    const { data, error } = await (supabase as any)
      .from('contacts')
      .select('id,name,role,category,orbit,value,frequency,last_contact,notes')
      .order('created_at', { ascending: false })
    if (error || !data) return null
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (data as any[]).map((r: any): RelContact => ({
      id:          String(r.id),
      name:        r.name ?? 'Unknown',
      role:        r.role ?? '',
      category:    (r.category as ContactCategory) ?? 'prospect',
      orbit:       (r.orbit   as ContactOrbit)    ?? 'outer',
      value:       Number(r.value)     || 0,
      frequency:   Number(r.frequency) || 0,
      lastContact: r.last_contact ?? new Date().toISOString(),
      notes:       r.notes ?? '',
    }))
  } catch {
    return null
  }
}

async function trySupabasePush(contact: RelContact): Promise<void> {
  try {
    const { supabase } = await import('@/lib/supabase')
    await (supabase as any).from('contacts').upsert({
      id:           contact.id,
      name:         contact.name,
      role:         contact.role,
      category:     contact.category,
      orbit:        contact.orbit,
      value:        contact.value,
      frequency:    contact.frequency,
      last_contact: contact.lastContact,
      notes:        contact.notes,
    })
  } catch { /* silent */ }
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function uid(): string {
  return `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

function healthColor(lastContactISO: string): { hex: number; str: string } {
  const days = (Date.now() - new Date(lastContactISO).getTime()) / 86400_000
  if (days < HEALTH_GREEN_DAYS) return HEALTH_COLORS.green
  if (days < HEALTH_AMBER_DAYS) return HEALTH_COLORS.amber
  return HEALTH_COLORS.red
}

function daysSince(iso: string): number {
  return Math.round((Date.now() - new Date(iso).getTime()) / 86400_000)
}

function sphereRadius(value: number, allValues: number[]): number {
  const maxV = Math.max(...allValues, 1)
  const t    = Math.sqrt(value / maxV)           // square-root scale feels natural
  return SPHERE_R_MIN + t * (SPHERE_R_MAX - SPHERE_R_MIN)
}

function orbitSpeed(c: RelContact): number {
  // frequency 0 → 0.2× base, frequency 12+ → 1.5× base
  const factor = 0.2 + Math.min(c.frequency / 12, 1) * 1.3
  return BASE_SPEED[c.orbit] * factor
}

function lineOpacity(c: RelContact): number {
  const f = Math.min(c.frequency / 12, 1)
  return LINE_OPACITY_BASE + f * (LINE_OPACITY_MAX - LINE_OPACITY_BASE)
}

function fmt(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `$${(n / 1_000).toFixed(0)}k`
  return `$${n}`
}

/** Build a flat orbit ring (LineLoop) at radius r and y-height */
function makeRing(radius: number, y: number, segments = 128): THREE.LineLoop {
  const pts: number[] = []
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2
    pts.push(Math.cos(a) * radius, 0, Math.sin(a) * radius)
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
  const mat = new THREE.LineBasicMaterial({
    color:       RING_COLOR,
    transparent: true,
    opacity:     RING_OPACITY,
    depthWrite:  false,
  })
  const ring = new THREE.LineLoop(geo, mat)
  ring.position.y = y
  return ring
}

// ── Per-contact 3D entry ───────────────────────────────────────────────────────

interface ContactEntry {
  contact:    RelContact
  mesh:       THREE.Mesh
  light:      THREE.PointLight
  label:      NWLabel
  lineMat:    THREE.LineBasicMaterial
  lineGeo:    THREE.BufferGeometry
  line:       THREE.LineSegments
  angleRad:   number            // current orbit angle
  speed:      number            // rad/s
  orbitR:     number
}

// ── Dispose helper ─────────────────────────────────────────────────────────────

function disposeEntry(scene: THREE.Scene, e: ContactEntry): void {
  scene.remove(e.mesh)
  scene.remove(e.line)
  e.mesh.remove(e.light)
  ;(e.mesh.geometry as THREE.BufferGeometry).dispose()
  ;(e.mesh.material as THREE.MeshStandardMaterial).dispose()
  e.lineGeo.dispose()
  e.lineMat.dispose()
  disposeLabel(e.label)
  scene.remove(e.label)
}

// ── Panel component ────────────────────────────────────────────────────────────

interface ContactPanelProps {
  contact:  RelContact
  screenX:  number
  screenY:  number
  onClose:  () => void
}

function ContactPanel({ contact, screenX, screenY, onClose }: ContactPanelProps) {
  const hc   = healthColor(contact.lastContact)
  const days = daysSince(contact.lastContact)

  const healthLabel =
    days < HEALTH_GREEN_DAYS ? 'Recent'
    : days < HEALTH_AMBER_DAYS ? 'Stale'
    : 'Cold'

  return (
    <div
      style={{
        position:   'fixed',
        left:       Math.min(screenX + 16, window.innerWidth  - 320),
        top:        Math.min(screenY - 80,  window.innerHeight - 320),
        width:      300,
        background: 'rgba(6,8,16,0.94)',
        border:     `1px solid ${CATEGORY_HEX[contact.category]}55`,
        borderRadius: 10,
        padding:    '14px 16px',
        color:      '#e0e8ff',
        fontFamily: 'monospace',
        fontSize:   13,
        zIndex:     9999,
        backdropFilter: 'blur(8px)',
        boxShadow:  `0 0 24px ${CATEGORY_HEX[contact.category]}33`,
        userSelect: 'none',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: CATEGORY_HEX[contact.category] }}>
            {contact.name}
          </div>
          <div style={{ fontSize: 11, opacity: 0.65, marginTop: 2 }}>{contact.role}</div>
        </div>
        <button
          onClick={onClose}
          style={{
            background: 'none', border: 'none', color: '#8090b0',
            fontSize: 18, cursor: 'pointer', lineHeight: 1, padding: '0 4px',
          }}
          aria-label="Close"
        >×</button>
      </div>

      {/* Health badge */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
        <span style={{
          display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
          background: hc.str, boxShadow: `0 0 6px ${hc.str}`,
        }} />
        <span style={{ fontSize: 11, color: hc.str }}>{healthLabel} — {days === 0 ? 'Today' : `${days}d ago`}</span>
      </div>

      {/* Metrics */}
      <div style={{ borderTop: '1px solid #202840', paddingTop: 8, marginBottom: 8 }}>
        {[
          ['Category',       contact.category.charAt(0).toUpperCase() + contact.category.slice(1)],
          ['Orbit',          contact.orbit.charAt(0).toUpperCase() + contact.orbit.slice(1)],
          ['Business Value', fmt(contact.value)],
          ['Frequency',      `${contact.frequency}×/mo`],
          ['Last Interaction', days === 0 ? 'Today' : `${days} days ago`],
        ].map(([k, v]) => (
          <div key={k} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
            <span style={{ opacity: 0.55 }}>{k}</span>
            <span style={{ color: '#c8d8ff' }}>{v}</span>
          </div>
        ))}
      </div>

      {/* Notes */}
      {contact.notes && (
        <div style={{
          borderTop: '1px solid #202840', paddingTop: 8,
          fontSize: 11, color: '#8090b0', lineHeight: 1.5,
        }}>
          {contact.notes}
        </div>
      )}
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

export function RelationshipMapLayer() {
  const { scene, camera, renderer, playerPosition } = useWorldContext()

  const contactsRef = useRef<RelContact[]>(loadContacts())
  const entriesRef  = useRef<Map<string, ContactEntry>>(new Map())
  const frameRef    = useRef<((e: Event) => void) | null>(null)
  const elapsedRef  = useRef(0)
  const lastTsRef   = useRef<number>(performance.now())

  // Avatar refs
  const avatarMeshRef  = useRef<THREE.Mesh | null>(null)
  const avatarLightRef = useRef<THREE.PointLight | null>(null)

  // Orbit ring refs
  const ringsRef = useRef<THREE.LineLoop[]>([])

  // Hit-test meshes for click detection (invisible)
  const hitMeshesRef = useRef<Map<string, THREE.Mesh>>(new Map())

  // Click panel state
  const [panel, setPanel] = useState<{
    contact: RelContact
    screenX: number
    screenY: number
  } | null>(null)

  // ── Build / rebuild all contact 3D objects ───────────────────────────────

  const buildEntries = useCallback((contacts: RelContact[]) => {
    // Dispose existing entries
    entriesRef.current.forEach(e => disposeEntry(scene, e))
    entriesRef.current.clear()
    hitMeshesRef.current.forEach(h => {
      scene.remove(h)
      h.geometry.dispose()
      ;(h.material as THREE.MeshBasicMaterial).dispose()
    })
    hitMeshesRef.current.clear()

    const allValues = contacts.map(c => c.value)
    const now       = Date.now()

    contacts.forEach((c, i) => {
      // Spread contacts around the orbit ring deterministically
      const startAngle = (i / contacts.length) * Math.PI * 2
      const orbitR     = ORBIT_RADII[c.orbit]
      const spd        = orbitSpeed(c)
      const hc         = healthColor(c.lastContact)
      const catColor   = CATEGORY_COLORS[c.category]
      const r          = sphereRadius(c.value, allValues)

      // Sphere mesh
      const geo  = new THREE.SphereGeometry(r, 16, 12)
      const mat  = new THREE.MeshStandardMaterial({
        color:          catColor,
        emissive:       new THREE.Color(catColor).multiplyScalar(0.25),
        emissiveIntensity: 0.6,
        roughness:      0.4,
        metalness:      0.3,
      })
      const mesh = new THREE.Mesh(geo, mat)
      mesh.position.set(
        Math.cos(startAngle) * orbitR,
        CONTACT_Y_BASE,
        Math.sin(startAngle) * orbitR,
      )
      scene.add(mesh)

      // Health glow light
      const light = new THREE.PointLight(hc.hex, 2.5, orbitR * 0.9 + 4)
      mesh.add(light)

      // Label sprite
      const label = makeLabel(c.name, CATEGORY_HEX[c.category], { labelType: 'agent' })
      label.position.copy(mesh.position)
      label.position.y += LABEL_Y_ABOVE
      scene.add(label)

      // Relationship line (from origin; we'll update positions per frame)
      const lineGeo = new THREE.BufferGeometry()
      const linePts = new Float32Array(6) // 2 pts × 3 floats
      lineGeo.setAttribute('position', new THREE.BufferAttribute(linePts, 3))
      const lineMat = new THREE.LineBasicMaterial({
        color:       catColor,
        transparent: true,
        opacity:     lineOpacity(c),
        depthWrite:  false,
      })
      const line = new THREE.LineSegments(lineGeo, lineMat)
      scene.add(line)

      // Invisible hit sphere for click detection (larger than visual sphere)
      const hitGeo = new THREE.SphereGeometry(Math.max(r + 0.8, 1.2), 8, 6)
      const hitMat = new THREE.MeshBasicMaterial({ visible: false })
      const hitMesh = new THREE.Mesh(hitGeo, hitMat)
      hitMesh.userData.contactId = c.id
      hitMesh.position.copy(mesh.position)
      scene.add(hitMesh)
      hitMeshesRef.current.set(c.id, hitMesh)

      // Random orbit phase offset to avoid contacts stacking on init
      const _ = now // suppress lint

      const entry: ContactEntry = {
        contact:  c,
        mesh,
        light,
        label,
        lineMat,
        lineGeo,
        line,
        angleRad: startAngle,
        speed:    spd,
        orbitR,
      }
      entriesRef.current.set(c.id, entry)
    })
  }, [scene])

  // ── Build avatar orb ─────────────────────────────────────────────────────

  const buildAvatar = useCallback(() => {
    // Dispose previous
    if (avatarMeshRef.current) {
      scene.remove(avatarMeshRef.current)
      avatarMeshRef.current.geometry.dispose()
      ;(avatarMeshRef.current.material as THREE.MeshStandardMaterial).dispose()
    }

    const geo = new THREE.SphereGeometry(AVATAR_RADIUS, 20, 16)
    const mat = new THREE.MeshStandardMaterial({
      color:             AVATAR_COLOR,
      emissive:          new THREE.Color(AVATAR_EMISSIVE),
      emissiveIntensity: 1.2,
      roughness:         0.2,
      metalness:         0.5,
      transparent:       true,
      opacity:           0.92,
    })
    const mesh = new THREE.Mesh(geo, mat)
    scene.add(mesh)
    avatarMeshRef.current = mesh

    const light = new THREE.PointLight(AVATAR_LIGHT_COLOR, AVATAR_LIGHT_INTENSITY, 12)
    mesh.add(light)
    avatarLightRef.current = light
  }, [scene])

  // ── Build orbit rings ────────────────────────────────────────────────────

  const buildRings = useCallback((avatarPos: THREE.Vector3) => {
    ringsRef.current.forEach(r => {
      scene.remove(r)
      r.geometry.dispose()
      ;(r.material as THREE.Material).dispose()
    })
    ringsRef.current = []

    Object.values(ORBIT_RADII).forEach(radius => {
      const ring = makeRing(radius, avatarPos.y)
      ring.position.x = avatarPos.x
      ring.position.z = avatarPos.z
      scene.add(ring)
      ringsRef.current.push(ring)
    })
  }, [scene])

  // ── Click handler ────────────────────────────────────────────────────────

  useEffect(() => {
    const canvas = renderer.domElement

    const onClick = (e: MouseEvent) => {
      const rect   = canvas.getBoundingClientRect()
      const mouse  = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width)  *  2 - 1,
        ((e.clientY - rect.top)  / rect.height) * -2 + 1,
      )
      const raycaster = new THREE.Raycaster()
      raycaster.setFromCamera(mouse, camera)

      const hits = raycaster.intersectObjects(
        Array.from(hitMeshesRef.current.values()),
        false,
      )
      if (hits.length === 0) {
        setPanel(null)
        return
      }

      const contactId = hits[0].object.userData.contactId as string
      const contact   = contactsRef.current.find(c => c.id === contactId)
      if (!contact) return

      // Project 3D world pos to screen
      const entry = entriesRef.current.get(contactId)
      if (!entry) return
      const wp = entry.mesh.position.clone()
      wp.project(camera)
      const sx = ((wp.x + 1) / 2) * rect.width  + rect.left
      const sy = ((-wp.y + 1) / 2) * rect.height + rect.top

      setPanel({ contact, screenX: sx, screenY: sy })
    }

    canvas.addEventListener('click', onClick)
    return () => canvas.removeEventListener('click', onClick)
  }, [camera, renderer])

  // ── nw:contact-add event ─────────────────────────────────────────────────

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ name: string; category: ContactCategory; value: number }>).detail
      if (!detail?.name) return

      const newContact: RelContact = {
        id:          uid(),
        name:        detail.name,
        role:        detail.category.charAt(0).toUpperCase() + detail.category.slice(1),
        category:    detail.category ?? 'prospect',
        orbit:       'outer',
        value:       detail.value ?? 0,
        frequency:   1,
        lastContact: new Date().toISOString(),
        notes:       '',
      }

      contactsRef.current = [...contactsRef.current, newContact]
      saveContacts(contactsRef.current)
      trySupabasePush(newContact)
      buildEntries(contactsRef.current)
    }

    window.addEventListener('nw:contact-add', handler)
    return () => window.removeEventListener('nw:contact-add', handler)
  }, [buildEntries])

  // ── Mount: build scene objects, wire frame loop ──────────────────────────

  useEffect(() => {
    // Attempt Supabase pull (async, non-blocking)
    trySupabasePull().then(remote => {
      if (remote && remote.length > 0) {
        contactsRef.current = remote
        saveContacts(remote)
        buildEntries(remote)
      }
    })

    const avatarPos = playerPosition.current.clone()
    avatarPos.y += AVATAR_Y_OFFSET

    buildAvatar()
    buildRings(avatarPos)
    buildEntries(contactsRef.current)

    // ── Per-frame update ─────────────────────────────────────────────────

    const onFrame = () => {
      const now = performance.now()
      const dt  = Math.min((now - lastTsRef.current) / 1000, 0.1)
      lastTsRef.current = now
      elapsedRef.current += dt

      // Update avatar position to follow player
      const ap = playerPosition.current
      if (avatarMeshRef.current) {
        avatarMeshRef.current.position.set(ap.x, ap.y + AVATAR_Y_OFFSET, ap.z)

        // Gentle pulse on avatar light
        if (avatarLightRef.current) {
          avatarLightRef.current.intensity =
            AVATAR_LIGHT_INTENSITY + Math.sin(elapsedRef.current * 2.1) * 0.6
        }

        // Keep rings centred on avatar
        ringsRef.current.forEach(ring => {
          ring.position.x = ap.x
          ring.position.y = ap.y + AVATAR_Y_OFFSET
          ring.position.z = ap.z
        })
      }

      // Update each contact entry
      const avatarWorldPos = avatarMeshRef.current?.position ?? new THREE.Vector3()

      entriesRef.current.forEach(entry => {
        // Advance orbit angle
        entry.angleRad += entry.speed * dt

        const cx = avatarWorldPos.x + Math.cos(entry.angleRad) * entry.orbitR
        const cz = avatarWorldPos.z + Math.sin(entry.angleRad) * entry.orbitR
        const cy  = avatarWorldPos.y + (CONTACT_Y_BASE - AVATAR_Y_OFFSET)
                    + Math.sin(elapsedRef.current * 0.7 + entry.angleRad) * 0.18

        entry.mesh.position.set(cx, cy, cz)

        // Y-axis rotation for subtle spin
        entry.mesh.rotation.y += dt * 0.4

        // Update hit sphere position
        const hitMesh = hitMeshesRef.current.get(entry.contact.id)
        if (hitMesh) hitMesh.position.copy(entry.mesh.position)

        // Update label position
        entry.label.position.set(cx, cy + LABEL_Y_ABOVE, cz)
        const wp = new THREE.Vector3()
        entry.label.getWorldPosition(wp)
        entry.label.updateVisibility(camera, wp)

        // Update relationship line
        const linePts = entry.lineGeo.attributes['position'] as THREE.BufferAttribute
        linePts.setXYZ(0, avatarWorldPos.x, avatarWorldPos.y, avatarWorldPos.z)
        linePts.setXYZ(1, cx, cy, cz)
        linePts.needsUpdate = true
        entry.lineGeo.computeBoundingSphere()

        // Pulse light intensity slightly
        entry.light.intensity = 2.5 + Math.sin(elapsedRef.current * 1.8 + entry.angleRad) * 0.5
      })
    }

    frameRef.current = onFrame
    window.addEventListener('nw:frame', onFrame)

    return () => {
      if (frameRef.current) window.removeEventListener('nw:frame', frameRef.current)

      // Dispose avatar
      if (avatarMeshRef.current) {
        scene.remove(avatarMeshRef.current)
        avatarMeshRef.current.geometry.dispose()
        ;(avatarMeshRef.current.material as THREE.MeshStandardMaterial).dispose()
        avatarMeshRef.current = null
      }

      // Dispose rings
      ringsRef.current.forEach(r => {
        scene.remove(r)
        r.geometry.dispose()
        ;(r.material as THREE.Material).dispose()
      })
      ringsRef.current = []

      // Dispose contact entries
      entriesRef.current.forEach(e => disposeEntry(scene, e))
      entriesRef.current.clear()

      hitMeshesRef.current.forEach(h => {
        scene.remove(h)
        h.geometry.dispose()
        ;(h.material as THREE.MeshBasicMaterial).dispose()
      })
      hitMeshesRef.current.clear()
    }
  }, [scene, camera, playerPosition, buildAvatar, buildRings, buildEntries])

  // ── Render panel overlay ─────────────────────────────────────────────────

  return panel ? (
    <ContactPanel
      contact={panel.contact}
      screenX={panel.screenX}
      screenY={panel.screenY}
      onClose={() => setPanel(null)}
    />
  ) : null
}
