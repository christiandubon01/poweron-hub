/**
 * GhostUniverseLayer.tsx — NW49: Ghost Universe parallel timeline overlay.
 *
 * Shows a ghost overlay of what the business WOULD look like if different
 * decisions had been made: declined leads as ghost mountains, ghost revenue
 * river showing full-conversion potential, ghost crew positions.
 *
 * TOGGLE: "Ghost Universe" entry in the layers panel (off by default).
 *
 * GHOST ELEMENTS:
 *   - Ghost mountains: white-blue, 25% opacity, shimmer/static pulse effect
 *     → sized to the estimated contract value of declined/lost leads
 *   - Ghost revenue river: shows width as if all leads converted
 *   - Ghost crew: wireframe worker orbs at alternate assignment positions
 *
 * DATA: supabase.from('leads') where status IN ('declined','lost')
 *       + proposals sent but not accepted
 *       + quotes expired
 *       Uses callNexus to estimate "what would this have been worth?" context
 *
 * COMPARISON HUD: horizontal bar at top of viewport (separate React portal)
 *   REALITY $X | MISSED $Y | GHOST $Z | capturing X% of potential
 *
 * INTERACTION:
 *   Hover ghost mountain → tooltip: lead name, date, reason, est. value
 *   Click ghost mountain → detail panel with REVIVE LEAD button
 *   REVIVE LEAD → inserts new lead row in supabase with status='reopened'
 *
 * VISUAL UX:
 *   Ghost pulse animation: opacity cycles 0.18 – 0.30 at ~0.3 Hz (memory trying to solidify)
 *   Shimmer: UV offset on a noise-like emissive map simulated via opacity flicker
 */

import React, { useEffect, useRef, useState, useCallback } from 'react'
import * as THREE from 'three'
import { useWorldContext } from './WorldContext'
import { subscribeWorldData, seededPosition, contractValueToHeight, type NWWorldData } from './DataBridge'
import { supabase } from '@/lib/supabase'
import { callNexus } from '@/services/claudeProxy'

// ── Types ─────────────────────────────────────────────────────────────────────

/** A declined / lost lead fetched from Supabase */
interface GhostLead {
  id: string
  name: string
  status: string          // 'declined' | 'lost' | 'expired' | 'rejected'
  estimated_value: number // explicitly stored value or estimated via NEXUS
  date: string | null
  reason: string | null
  contact_name: string | null
  org_id: string
  /** computed: estimated project value after NEXUS enrichment */
  projectedValue: number
}

/** A Three.js ghost mountain node */
interface GhostNode {
  group: THREE.Group
  lead: GhostLead
  baseY: number
  phaseOffset: number
}

// ── Constants ─────────────────────────────────────────────────────────────────

const GHOST_COLOR     = new THREE.Color(0xaaddff)
const GHOST_EMISSIVE  = new THREE.Color(0x5599ee)
const BASE_OPACITY    = 0.22
const PULSE_AMP       = 0.10
const PULSE_HZ        = 0.28      // cycles per second — slow memory pulse
const RIVER_OFFSET_X  = 3.5      // ghost river positioned slightly to the side
const GHOST_CREW_CLR  = new THREE.Color(0xbbccff)

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Seed a deterministic offset position for a ghost lead (slightly offset from real pos) */
function ghostPosition(leadId: string): { x: number; z: number } {
  const real = seededPosition(leadId)
  // Shift the ghost 8–14 units east so it doesn't overlap real mountains perfectly
  const hash = leadId.split('').reduce((a, c) => a + c.charCodeAt(0), 0)
  return {
    x: real.x + 8 + (hash % 7),
    z: real.z + 4 - (hash % 9),
  }
}

/** Estimate contract value from available lead data (fallback when no explicit value) */
function estimateLeadValue(lead: any): number {
  if (typeof lead.estimated_value === 'number' && lead.estimated_value > 0) return lead.estimated_value
  if (typeof lead.contract_value  === 'number' && lead.contract_value  > 0) return lead.contract_value
  if (typeof lead.quote_value     === 'number' && lead.quote_value     > 0) return lead.quote_value
  if (typeof lead.proposal_value  === 'number' && lead.proposal_value  > 0) return lead.proposal_value
  // Generic fallback
  return 15000
}

// ── Main Component ────────────────────────────────────────────────────────────

interface GhostUniverseLayerProps {
  visible: boolean
}

export function GhostUniverseLayer({ visible }: GhostUniverseLayerProps) {
  const { scene } = useWorldContext()

  // Three.js refs
  const groupRef      = useRef<THREE.Group | null>(null)
  const nodesRef      = useRef<GhostNode[]>([])
  const riverMeshRef  = useRef<THREE.Mesh | null>(null)
  const crewGroupRef  = useRef<THREE.Group | null>(null)

  // React state for interaction panel
  const [ghostLeads,    setGhostLeads]   = useState<GhostLead[]>([])
  const [hoveredLead,   setHoveredLead]  = useState<{ lead: GhostLead; x: number; y: number } | null>(null)
  const [selectedLead,  setSelectedLead] = useState<GhostLead | null>(null)
  const [reviving,      setReviving]     = useState(false)
  const [reviveStatus,  setReviveStatus] = useState<string | null>(null)

  // Comparison HUD data
  const [realRevenue,   setRealRevenue]  = useState(0)
  const [ghostRevenue,  setGhostRevenue] = useState(0)

  // ── Fetch ghost leads from Supabase ─────────────────────────────────────────

  const fetchGhostLeads = useCallback(async () => {
    try {
      // Pull from the 'leads' table — statuses that represent declined / lost work
      const { data, error } = await (supabase as any)
        .from('leads')
        .select('id, name, status, estimated_value, contract_value, quote_value, proposal_value, date, reason, contact_name, org_id, created_at, notes')
        .in('status', ['declined', 'lost', 'expired', 'rejected', 'closed_lost'])
        .order('created_at', { ascending: false })
        .limit(30)

      if (error || !data) return

      const enriched: GhostLead[] = data.map((row: any) => ({
        id:              row.id   ?? String(Math.random()),
        name:            row.name ?? 'Unnamed Lead',
        status:          row.status ?? 'declined',
        estimated_value: estimateLeadValue(row),
        date:            row.date ?? row.created_at ?? null,
        reason:          row.reason ?? row.notes ?? null,
        contact_name:    row.contact_name ?? null,
        org_id:          row.org_id ?? '',
        projectedValue:  estimateLeadValue(row),
      }))

      setGhostLeads(enriched)

      // Request NEXUS enrichment in background (non-blocking)
      if (enriched.length > 0) {
        _enrichWithNexus(enriched).catch(() => { /* silent — enrichment is optional */ })
      }
    } catch { /* non-fatal */ }
  }, [])

  /** Non-blocking NEXUS enrichment — asks Claude to estimate project values */
  const _enrichWithNexus = useCallback(async (leads: GhostLead[]) => {
    if (leads.length === 0) return
    const summary = leads.slice(0, 5).map(l =>
      `Lead: "${l.name}", stated value: $${l.estimated_value}, reason declined: ${l.reason ?? 'unknown'}`
    ).join('\n')

    try {
      const resp = await callNexus({
        query: `Based on these declined leads for an electrical contractor, estimate what each project would have been worth if they had converted, comparing to completed projects of similar scope:\n${summary}\n\nRespond with a JSON array: [{"id": "...", "estimated_value": number}]. Provide the lead name as the id field since we don't have project IDs.`,
        agentMode: 'executive',
      })

      // Parse and silently update projected values
      try {
        const match = (resp.speak ?? '').match(/\[[\s\S]*\]/)
        if (match) {
          const parsed: Array<{ id: string; estimated_value: number }> = JSON.parse(match[0])
          setGhostLeads(prev => prev.map(lead => {
            const nexusEntry = parsed.find(p => p.id === lead.name || p.id === lead.id)
            if (nexusEntry && typeof nexusEntry.estimated_value === 'number' && nexusEntry.estimated_value > 0) {
              return { ...lead, projectedValue: nexusEntry.estimated_value }
            }
            return lead
          }))
        }
      } catch { /* JSON parse failed — keep original values */ }
    } catch { /* callNexus failed — ghost values remain unchanged */ }
  }, [])

  // ── Build / update Three.js ghost scene ─────────────────────────────────────

  useEffect(() => {
    const group = new THREE.Group()
    group.visible = visible
    scene.add(group)
    groupRef.current = group

    const crewGroup = new THREE.Group()
    group.add(crewGroup)
    crewGroupRef.current = crewGroup

    // World data subscription — get real revenue + build ghost river
    const unsub = subscribeWorldData((data: NWWorldData) => {
      // Real monthly revenue = sum of active in_progress project contract values / 12
      const realRev = data.projects
        .filter(p => p.status === 'in_progress' || p.status === 'approved')
        .reduce((sum, p) => sum + p.contract_value, 0)
      setRealRevenue(realRev)

      // Build / update ghost river (wider than real river)
      _buildGhostRiver(group, realRev)

      // Build ghost crew positions (wireframe orbs)
      _buildGhostCrew(crewGroup, data)
    })

    // Fetch declined leads from Supabase
    fetchGhostLeads()

    return () => {
      unsub()
      nodesRef.current.forEach(n => {
        n.group.traverse(obj => {
          if (obj instanceof THREE.Mesh) {
            obj.geometry.dispose()
            if (Array.isArray(obj.material)) {
              obj.material.forEach(m => m.dispose())
            } else {
              obj.material.dispose()
            }
          }
        })
        group.remove(n.group)
      })
      nodesRef.current = []
      if (riverMeshRef.current) {
        riverMeshRef.current.geometry.dispose()
        ;(riverMeshRef.current.material as THREE.Material).dispose()
      }
      scene.remove(group)
    }
  }, [scene, visible, fetchGhostLeads])

  // ── Rebuild ghost mountains whenever ghostLeads changes ─────────────────────

  useEffect(() => {
    const group = groupRef.current
    if (!group) return

    // Dispose old nodes
    nodesRef.current.forEach(n => {
      n.group.traverse(obj => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose()
          if (Array.isArray(obj.material)) {
            obj.material.forEach(m => m.dispose())
          } else {
            obj.material.dispose()
          }
        }
      })
      group.remove(n.group)
    })
    nodesRef.current = []

    // Total ghost revenue
    const totalGhostRev = ghostLeads.reduce((s, l) => s + l.projectedValue, 0)
    setGhostRevenue(totalGhostRev)

    // Build new ghost mountains
    ghostLeads.forEach((lead, idx) => {
      const pos    = ghostPosition(lead.id)
      const height = contractValueToHeight(lead.projectedValue) * 0.85  // slightly shorter than real
      const radius = Math.max(1.8, height * 0.3)

      const nodeGroup = new THREE.Group()
      nodeGroup.position.set(pos.x, 0, pos.z)

      // Main ghost cone (mountain)
      const geo = new THREE.ConeGeometry(radius, height, 8, 1)
      const mat = new THREE.MeshStandardMaterial({
        color:             GHOST_COLOR,
        emissive:          GHOST_EMISSIVE,
        emissiveIntensity: 0.25,
        transparent:       true,
        opacity:           BASE_OPACITY,
        depthWrite:        false,
        side:              THREE.DoubleSide,
        roughness:         0.8,
        metalness:         0.15,
        wireframe:         false,
      })
      const mesh = new THREE.Mesh(geo, mat)
      mesh.position.y = height / 2
      mesh.userData = { leadId: lead.id }
      nodeGroup.add(mesh)

      // Wireframe outline (gives the "ghost static" feel)
      const wireMat = new THREE.MeshBasicMaterial({
        color:       0xaaddff,
        transparent: true,
        opacity:     0.12,
        wireframe:   true,
      })
      const wireMesh = new THREE.Mesh(geo.clone(), wireMat)
      wireMesh.position.y = height / 2
      nodeGroup.add(wireMesh)

      // Floating label ring (thin disc at summit to mark it as ghost)
      const ringGeo = new THREE.RingGeometry(radius * 0.7, radius * 0.9, 24)
      const ringMat = new THREE.MeshBasicMaterial({
        color:       0xaaddff,
        transparent: true,
        opacity:     0.18,
        side:        THREE.DoubleSide,
        depthWrite:  false,
      })
      const ring = new THREE.Mesh(ringGeo, ringMat)
      ring.rotation.x = -Math.PI / 2
      ring.position.y = height + 0.5
      nodeGroup.add(ring)

      group.add(nodeGroup)

      nodesRef.current.push({
        group:       nodeGroup,
        lead,
        baseY:       0,
        phaseOffset: (idx * 0.618) * Math.PI * 2,   // golden angle spread for desync'd pulses
      })
    })
  }, [ghostLeads])

  // ── Sync visibility ──────────────────────────────────────────────────────────

  useEffect(() => {
    if (groupRef.current) groupRef.current.visible = visible
  }, [visible])

  // ── Animation frame — pulse + shimmer ───────────────────────────────────────

  useEffect(() => {
    function onFrame() {
      if (!groupRef.current?.visible) return
      const t = performance.now() / 1000

      nodesRef.current.forEach(n => {
        const pulse = BASE_OPACITY + PULSE_AMP * Math.sin(t * PULSE_HZ * Math.PI * 2 + n.phaseOffset)

        n.group.traverse(obj => {
          if (!(obj instanceof THREE.Mesh)) return
          const mat = obj.material as THREE.MeshStandardMaterial | THREE.MeshBasicMaterial
          if (mat.transparent) {
            // Shimmer: add high-frequency flicker on top of slow pulse
            const shimmer = 0.04 * Math.sin(t * 6.3 + n.phaseOffset * 3)
            mat.opacity = Math.max(0.05, pulse + shimmer)
          }
        })
      })

      // Ghost river pulse
      if (riverMeshRef.current) {
        const rMat = riverMeshRef.current.material as THREE.MeshStandardMaterial
        rMat.opacity = 0.10 + 0.06 * Math.sin(t * 0.5)
      }
    }

    window.addEventListener('nw:frame', onFrame)
    return () => window.removeEventListener('nw:frame', onFrame)
  }, [])

  // ── Raycasting for hover / click ─────────────────────────────────────────────

  // We use a custom document-level mousemove listener that raycasts against ghost meshes.
  // We capture the canvas element from the scene's renderer.
  const raycasterRef = useRef(new THREE.Raycaster())
  const mouseRef     = useRef(new THREE.Vector2())
  const cameraRef    = useRef<THREE.PerspectiveCamera | null>(null)

  // Grab camera from WorldContext via a tiny bridge effect
  const { camera } = useWorldContext()
  useEffect(() => {
    cameraRef.current = camera
  }, [camera])

  useEffect(() => {
    function getMeshes(): THREE.Mesh[] {
      const meshes: THREE.Mesh[] = []
      nodesRef.current.forEach(n => {
        n.group.traverse(obj => {
          if (obj instanceof THREE.Mesh && obj.userData.leadId) {
            meshes.push(obj)
          }
        })
      })
      return meshes
    }

    function onMouseMove(e: MouseEvent) {
      if (!groupRef.current?.visible || !cameraRef.current) return
      const canvas = document.querySelector('canvas')
      if (!canvas) return
      const rect = canvas.getBoundingClientRect()
      mouseRef.current.x = ((e.clientX - rect.left) / rect.width)  * 2 - 1
      mouseRef.current.y = -((e.clientY - rect.top)  / rect.height) * 2 + 1

      raycasterRef.current.setFromCamera(mouseRef.current, cameraRef.current)
      const hits = raycasterRef.current.intersectObjects(getMeshes())
      if (hits.length > 0) {
        const leadId = hits[0].object.userData.leadId as string
        const node   = nodesRef.current.find(n => n.lead.id === leadId)
        if (node) {
          setHoveredLead({ lead: node.lead, x: e.clientX, y: e.clientY })
          canvas.style.cursor = 'pointer'
        }
      } else {
        setHoveredLead(null)
        canvas.style.cursor = ''
      }
    }

    function onMouseClick(e: MouseEvent) {
      if (!groupRef.current?.visible || !cameraRef.current) return
      const canvas = document.querySelector('canvas')
      if (!canvas) return
      const rect = canvas.getBoundingClientRect()
      mouseRef.current.x = ((e.clientX - rect.left) / rect.width)  * 2 - 1
      mouseRef.current.y = -((e.clientY - rect.top)  / rect.height) * 2 + 1

      raycasterRef.current.setFromCamera(mouseRef.current, cameraRef.current)
      const hits = raycasterRef.current.intersectObjects(getMeshes())
      if (hits.length > 0) {
        const leadId = hits[0].object.userData.leadId as string
        const node   = nodesRef.current.find(n => n.lead.id === leadId)
        if (node) {
          setSelectedLead(node.lead)
          setReviveStatus(null)
        }
      }
    }

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('click',     onMouseClick)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('click',     onMouseClick)
    }
  }, [])

  // ── Revive Lead ──────────────────────────────────────────────────────────────

  const handleReviveLead = useCallback(async (lead: GhostLead) => {
    if (reviving) return
    setReviving(true)
    setReviveStatus(null)
    try {
      const { error } = await (supabase as any)
        .from('leads')
        .insert({
          name:            `[REVIVED] ${lead.name}`,
          status:          'reopened',
          estimated_value: lead.projectedValue,
          reason:          `Revived from Ghost Universe. Original reason: ${lead.reason ?? 'unknown'}`,
          contact_name:    lead.contact_name ?? null,
          org_id:          lead.org_id,
          created_at:      new Date().toISOString(),
          notes:           `Originally declined on ${lead.date ?? 'unknown date'}. Revived via Ghost Universe.`,
        })
      if (error) {
        setReviveStatus('⚠ Error reviving lead. Check Supabase connection.')
      } else {
        setReviveStatus('✓ Lead revived! Check your Leads pipeline.')
        setTimeout(() => {
          setSelectedLead(null)
          setReviveStatus(null)
        }, 2500)
      }
    } catch {
      setReviveStatus('⚠ Network error. Lead not revived.')
    } finally {
      setReviving(false)
    }
  }, [reviving])

  // ── Render (React overlay) ───────────────────────────────────────────────────

  if (!visible) return null

  const realMonthly  = Math.round(realRevenue  / 12)
  const ghostMonthly = Math.round((realRevenue + ghostRevenue) / 12)
  const missed       = Math.round(ghostRevenue / 12)
  const capturePct   = ghostMonthly > 0
    ? Math.round((realMonthly / ghostMonthly) * 100)
    : 100

  return (
    <>
      {/* ── COMPARISON HUD — top bar ─────────────────────────────────────── */}
      <div
        style={{
          position:    'fixed',
          top:         0,
          left:        '50%',
          transform:   'translateX(-50%)',
          zIndex:      60,
          display:     'flex',
          alignItems:  'center',
          gap:         0,
          pointerEvents: 'none',
          fontFamily:  'monospace',
        }}
      >
        {/* Reality */}
        <div style={{
          background:   'rgba(0, 20, 40, 0.88)',
          border:       '1px solid rgba(0,229,204,0.5)',
          borderRight:  'none',
          borderRadius: '0 0 0 8px',
          padding:      '6px 18px',
          backdropFilter: 'blur(10px)',
        }}>
          <span style={{ color: 'rgba(0,229,204,0.55)', fontSize: 8, letterSpacing: 2 }}>REALITY</span>
          <div style={{ color: '#00e5cc', fontSize: 14, fontWeight: 700, letterSpacing: 1 }}>
            ${realMonthly.toLocaleString()}<span style={{ fontSize: 9, opacity: 0.6 }}>/mo</span>
          </div>
        </div>

        {/* Missed */}
        <div style={{
          background:   'rgba(30, 5, 40, 0.92)',
          border:       '1px solid rgba(180,80,255,0.7)',
          padding:      '6px 22px',
          backdropFilter: 'blur(10px)',
          textAlign:    'center',
        }}>
          <span style={{ color: 'rgba(200,130,255,0.65)', fontSize: 8, letterSpacing: 2 }}>MISSED</span>
          <div style={{ color: '#cc66ff', fontSize: 14, fontWeight: 700, letterSpacing: 1 }}>
            −${missed.toLocaleString()}<span style={{ fontSize: 9, opacity: 0.6 }}>/mo</span>
          </div>
          <div style={{ color: 'rgba(200,130,255,0.55)', fontSize: 8, letterSpacing: 1, marginTop: 2 }}>
            capturing {capturePct}% of potential
          </div>
        </div>

        {/* Ghost */}
        <div style={{
          background:   'rgba(5, 15, 40, 0.88)',
          border:       '1px solid rgba(120,170,255,0.5)',
          borderLeft:   'none',
          borderRadius: '0 0 8px 0',
          padding:      '6px 18px',
          backdropFilter: 'blur(10px)',
        }}>
          <span style={{ color: 'rgba(150,190,255,0.55)', fontSize: 8, letterSpacing: 2 }}>GHOST</span>
          <div style={{ color: '#aaddff', fontSize: 14, fontWeight: 700, letterSpacing: 1 }}>
            ${ghostMonthly.toLocaleString()}<span style={{ fontSize: 9, opacity: 0.6 }}>/mo</span>
          </div>
        </div>
      </div>

      {/* ── GHOST MODE BADGE ─────────────────────────────────────────────── */}
      <div
        style={{
          position:     'fixed',
          top:          62,
          left:         '50%',
          transform:    'translateX(-50%)',
          zIndex:       59,
          pointerEvents: 'none',
          fontFamily:   'monospace',
        }}
      >
        <div style={{
          background:   'rgba(10,5,30,0.80)',
          border:       '1px solid rgba(150,170,255,0.35)',
          borderRadius:  4,
          padding:      '3px 12px',
          color:        'rgba(150,190,255,0.7)',
          fontSize:      9,
          letterSpacing: 2,
          backdropFilter: 'blur(8px)',
          animation:    'nw-blink 2.8s ease infinite',
        }}>
          ◌ GHOST UNIVERSE ACTIVE · {ghostLeads.length} PATHS NOT TAKEN
        </div>
      </div>

      {/* ── HOVER TOOLTIP ────────────────────────────────────────────────── */}
      {hoveredLead && !selectedLead && (
        <div
          style={{
            position:   'fixed',
            left:       hoveredLead.x + 14,
            top:        hoveredLead.y - 10,
            zIndex:     65,
            pointerEvents: 'none',
            fontFamily: 'monospace',
          }}
        >
          <div style={{
            background:   'rgba(5, 8, 30, 0.92)',
            border:       '1px solid rgba(150,180,255,0.5)',
            borderRadius:  6,
            padding:      '10px 14px',
            backdropFilter: 'blur(12px)',
            maxWidth:      260,
            boxShadow:    '0 0 24px rgba(100,140,255,0.15)',
          }}>
            <div style={{
              color: '#aaddff',
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: 1,
              marginBottom: 5,
            }}>
              ◌ {hoveredLead.lead.name}
            </div>
            <div style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: '3px 10px',
            }}>
              <span style={{ color: 'rgba(150,180,255,0.55)', fontSize: 9 }}>Status</span>
              <span style={{ color: '#cc99ff', fontSize: 9, textTransform: 'uppercase' }}>{hoveredLead.lead.status}</span>
              <span style={{ color: 'rgba(150,180,255,0.55)', fontSize: 9 }}>Date</span>
              <span style={{ color: '#aaddff', fontSize: 9 }}>{hoveredLead.lead.date ?? '—'}</span>
              <span style={{ color: 'rgba(150,180,255,0.55)', fontSize: 9 }}>Est. Value</span>
              <span style={{ color: '#aaffcc', fontSize: 9, fontWeight: 700 }}>
                ${hoveredLead.lead.projectedValue.toLocaleString()}
              </span>
              {hoveredLead.lead.reason && (
                <>
                  <span style={{ color: 'rgba(150,180,255,0.55)', fontSize: 9, gridColumn: '1/-1' }}>Reason</span>
                  <span style={{ color: 'rgba(200,200,220,0.75)', fontSize: 9, gridColumn: '1/-1', fontStyle: 'italic' }}>
                    {hoveredLead.lead.reason.slice(0, 80)}{hoveredLead.lead.reason.length > 80 ? '…' : ''}
                  </span>
                </>
              )}
            </div>
            <div style={{ color: 'rgba(150,180,255,0.4)', fontSize: 8, marginTop: 7, letterSpacing: 1 }}>
              CLICK TO SEE FULL DETAILS + REVIVE
            </div>
          </div>
        </div>
      )}

      {/* ── DETAIL PANEL (click) ──────────────────────────────────────────── */}
      {selectedLead && (
        <div
          style={{
            position:   'fixed',
            top:        '50%',
            left:       '50%',
            transform:  'translate(-50%, -50%)',
            zIndex:     70,
            fontFamily: 'monospace',
            pointerEvents: 'all',
          }}
        >
          <div style={{
            background:   'rgba(4, 6, 25, 0.96)',
            border:       '1px solid rgba(150,180,255,0.6)',
            borderRadius:  10,
            padding:      '24px 28px',
            backdropFilter: 'blur(20px)',
            width:         340,
            boxShadow:    '0 0 60px rgba(100,140,255,0.20), 0 0 120px rgba(100,140,255,0.08)',
          }}>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16 }}>
              <div>
                <div style={{ color: 'rgba(150,180,255,0.5)', fontSize: 8, letterSpacing: 2.5, marginBottom: 4 }}>
                  ◌ PATH NOT TAKEN
                </div>
                <div style={{ color: '#aaddff', fontSize: 16, fontWeight: 700, letterSpacing: 1 }}>
                  {selectedLead.name}
                </div>
              </div>
              <button
                onClick={() => { setSelectedLead(null); setReviveStatus(null) }}
                style={{
                  background:  'transparent',
                  border:      '1px solid rgba(150,180,255,0.3)',
                  borderRadius: 4,
                  color:       'rgba(150,180,255,0.6)',
                  cursor:      'pointer',
                  fontSize:    12,
                  padding:     '2px 7px',
                  fontFamily:  'monospace',
                }}
              >
                ✕
              </button>
            </div>

            {/* Details grid */}
            <div style={{
              display:             'grid',
              gridTemplateColumns: '110px 1fr',
              gap:                 '6px 12px',
              marginBottom:        18,
            }}>
              <span style={{ color: 'rgba(150,180,255,0.5)', fontSize: 10 }}>Status</span>
              <span style={{ color: '#cc99ff', fontSize: 10, textTransform: 'uppercase', fontWeight: 600 }}>
                {selectedLead.status}
              </span>

              <span style={{ color: 'rgba(150,180,255,0.5)', fontSize: 10 }}>Date</span>
              <span style={{ color: '#aaddff', fontSize: 10 }}>
                {selectedLead.date ?? '—'}
              </span>

              {selectedLead.contact_name && (
                <>
                  <span style={{ color: 'rgba(150,180,255,0.5)', fontSize: 10 }}>Contact</span>
                  <span style={{ color: '#aaddff', fontSize: 10 }}>{selectedLead.contact_name}</span>
                </>
              )}

              <span style={{ color: 'rgba(150,180,255,0.5)', fontSize: 10 }}>Reason</span>
              <span style={{ color: 'rgba(200,200,230,0.75)', fontSize: 10, fontStyle: 'italic' }}>
                {selectedLead.reason ?? 'No reason recorded'}
              </span>

              <span style={{ color: 'rgba(150,180,255,0.5)', fontSize: 10 }}>Est. Value</span>
              <span style={{ color: '#00ffaa', fontSize: 13, fontWeight: 700 }}>
                ${selectedLead.projectedValue.toLocaleString()}
              </span>
            </div>

            {/* Ghost context */}
            <div style={{
              background:   'rgba(100,140,255,0.06)',
              border:       '1px solid rgba(150,180,255,0.15)',
              borderRadius:  6,
              padding:      '10px 12px',
              marginBottom:  18,
              color:        'rgba(180,200,255,0.65)',
              fontSize:      10,
              lineHeight:    1.6,
            }}>
              In the Ghost Universe, this work was completed and contributed
              <strong style={{ color: '#aaddff' }}> ${selectedLead.projectedValue.toLocaleString()}</strong> to your
              revenue river. In this timeline, it never happened.
            </div>

            {/* Revive status */}
            {reviveStatus && (
              <div style={{
                background:   reviveStatus.startsWith('✓')
                  ? 'rgba(0,60,30,0.7)'
                  : 'rgba(60,10,10,0.7)',
                border:       `1px solid ${reviveStatus.startsWith('✓') ? 'rgba(0,200,100,0.4)' : 'rgba(255,80,80,0.4)'}`,
                borderRadius:  5,
                padding:      '8px 12px',
                color:        reviveStatus.startsWith('✓') ? '#00cc66' : '#ff6666',
                fontSize:      10,
                letterSpacing: 0.5,
                marginBottom:  12,
              }}>
                {reviveStatus}
              </div>
            )}

            {/* Revive button */}
            {!reviveStatus?.startsWith('✓') && (
              <button
                onClick={() => handleReviveLead(selectedLead)}
                disabled={reviving}
                style={{
                  width:         '100%',
                  padding:       '10px 0',
                  background:    reviving
                    ? 'rgba(50,60,100,0.5)'
                    : 'rgba(100,140,255,0.18)',
                  border:        '1px solid rgba(150,180,255,0.6)',
                  borderRadius:   7,
                  color:         reviving ? 'rgba(150,180,255,0.5)' : '#aaddff',
                  cursor:        reviving ? 'wait' : 'pointer',
                  fontSize:       12,
                  fontWeight:     700,
                  letterSpacing:  2,
                  fontFamily:    'monospace',
                  transition:    'all 0.18s',
                  textTransform: 'uppercase',
                  boxShadow:     reviving ? 'none' : '0 0 20px rgba(100,140,255,0.15)',
                }}
              >
                {reviving ? '◌ REVIVING…' : '⟲ REVIVE LEAD'}
              </button>
            )}

            <div style={{
              color:        'rgba(150,180,255,0.35)',
              fontSize:      8,
              letterSpacing: 1,
              textAlign:    'center',
              marginTop:     10,
            }}>
              REVIVE creates a new lead entry with status "reopened"
            </div>
          </div>
        </div>
      )}
    </>
  )
}

// ── Helper functions (used inside useEffect — outside component to avoid re-creation) ──

function _buildGhostRiver(group: THREE.Group, realRevenue: number) {
  // Find and remove existing ghost river
  const existing = group.getObjectByName('ghost-river')
  if (existing) {
    if (existing instanceof THREE.Mesh) {
      existing.geometry.dispose()
      ;(existing.material as THREE.Material).dispose()
    }
    group.remove(existing)
  }

  // Ghost river is 1.5× wider than real river would be at this revenue level
  const realWidth = 6 + Math.min(realRevenue / 200000, 1) * 28
  const ghostWidth = realWidth * 1.5

  const geo = new THREE.PlaneGeometry(ghostWidth, 380, 1, 1)
  const mat = new THREE.MeshStandardMaterial({
    color:             new THREE.Color(0x8899ee),
    emissive:          new THREE.Color(0x4455aa),
    emissiveIntensity: 0.3,
    transparent:       true,
    opacity:           0.12,
    depthWrite:        false,
    side:              THREE.DoubleSide,
  })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.rotation.x = -Math.PI / 2
  mesh.position.set(RIVER_OFFSET_X, 0.5, 0)
  mesh.name = 'ghost-river'
  group.add(mesh)
}

function _buildGhostCrew(group: THREE.Group, data: NWWorldData) {
  // Clear old ghost crew
  while (group.children.length > 0) {
    const child = group.children[0]
    if (child instanceof THREE.Mesh) {
      child.geometry.dispose()
      ;(child.material as THREE.Material).dispose()
    }
    group.remove(child)
  }

  // Ghost crew: wireframe spheres at slightly offset positions from real project sites
  data.projects
    .filter(p => p.status === 'in_progress' || p.status === 'approved')
    .slice(0, 8)
    .forEach((p, idx) => {
      const pos  = seededPosition(p.id)
      const hash = p.id.split('').reduce((a: number, c: string) => a + c.charCodeAt(0), 0)
      // Place ghost crew between projects — alternate assignments
      const ghostX = pos.x + 12 + (hash % 10) - 5
      const ghostZ = pos.z + (hash % 8)  - 4

      const geo = new THREE.SphereGeometry(0.55, 8, 6)
      const mat = new THREE.MeshBasicMaterial({
        color:       GHOST_CREW_CLR,
        transparent: true,
        opacity:     0.18,
        wireframe:   true,
      })
      const mesh = new THREE.Mesh(geo, mat)
      mesh.position.set(ghostX, 1.0 + (idx * 0.2), ghostZ)
      group.add(mesh)
    })
}

export default GhostUniverseLayer
