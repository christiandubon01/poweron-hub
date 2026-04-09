/**
 * DragDropSystem.tsx — NW24: Drag-and-drop node repositioning with Supabase persistence.
 *
 * When EDIT LAYOUT mode is active (toggled from CommandHUD):
 *  - Raycasts hit-spheres at every known node position
 *  - Mousedown on a node grabs it
 *  - Mousemove drags along XZ ground plane (Y locked to terrain height)
 *  - Mouseup drops and persists to Supabase neural_world_settings.node_positions
 *
 * Visual feedback:
 *  - Hovering node: move cursor, subtle white pulse ring
 *  - Grabbed node: bright white outline sphere (glow)
 *  - Dragging: drop shadow disc below node
 *  - Ghost: semi-transparent ring at original position (fades after 3s)
 *  - On reconnect: nw:drag-reconnect event (DataFlowLayer pulses green lines)
 *
 * Persistence:
 *  - Saves to neural_world_settings.node_positions (JSONB) on each drop
 *  - Loads on mount from same column
 *  - RESET TO DEFAULT clears overrides and nulls Supabase column
 */

import React, {
  useEffect,
  useRef,
  useState,
  useCallback,
} from 'react'
import * as THREE from 'three'
import { useWorldContext } from './WorldContext'
import {
  subscribeWorldData,
  seededPosition,
  type NWWorldData,
} from './DataBridge'
import {
  setNodePosition,
  getNodePosition,
  getAllOverrides,
  applyOverrides,
  resetAllPositions,
  type NodePos,
} from './NodePositionStore'
import { supabase } from '@/lib/supabase'

// ── Static node default positions (mirrors NodeClickSystem STATIC_POSITIONS) ──

const STATIC_DEFAULTS: Record<string, { x: number; z: number; y: number; label: string }> = {
  VAULT:        { x: -172, z:  80,  y: 6,  label: 'VAULT'        },
  LEDGER:       { x:  -30, z:  25,  y: 6,  label: 'LEDGER'       },
  OHM:          { x: -165, z: -110, y: 6,  label: 'OHM'          },
  CHRONO:       { x: -105, z:   0,  y: 6,  label: 'CHRONO'       },
  BLUEPRINT:    { x: -130, z: -70,  y: 6,  label: 'BLUEPRINT'    },
  SPARK:        { x:   60, z: -120, y: 10, label: 'SPARK'        },
  SCOUT:        { x:  160, z:   0,  y: 6,  label: 'SCOUT'        },
  ECHO:         { x:  110, z:  130, y: 6,  label: 'ECHO'         },
  ATLAS:        { x:   75, z:   80, y: 6,  label: 'ATLAS'        },
  NEXUS:        { x:  110, z:  -60, y: 6,  label: 'NEXUS'        },
  MTZ_PLATEAU:  { x: -175, z:  160, y: 5,  label: 'MTZ Solar'    },
  NDA_GATE:     { x:   25, z:    0, y: 5,  label: 'NDA Gate'     },
  IP_FORTRESS:  { x:  190, z:    0, y: 8,  label: 'IP Fortress'  },
  MRR_MOUNTAIN: { x:  100, z:    0, y: 8,  label: 'MRR Mountain' },
  OPERATOR:     { x:    0, z:    0, y: 4,  label: 'OPERATOR'     },
}

// Terrain Y height approximation per x zone
function terrainY(x: number): number {
  // West continent: slight elevation from terrain generator
  if (x < -20) return 0
  // Central river
  if (x < 20) return 0
  // East continent
  return 0
}

// Debounce helper
function debounce<T extends (...args: Parameters<T>) => void>(fn: T, delay: number): T {
  let timer: ReturnType<typeof setTimeout>
  return ((...args) => {
    clearTimeout(timer)
    timer = setTimeout(() => fn(...args), delay)
  }) as T
}

// ── Component ─────────────────────────────────────────────────────────────────

interface NodeHandle {
  id: string
  label: string
  hitMesh: THREE.Mesh
  glowRing: THREE.Mesh
}

export function DragDropSystem() {
  const { scene, camera, renderer } = useWorldContext()

  const [editActive, setEditActive] = useState(false)
  const editActiveRef = useRef(false)
  const orgIdRef = useRef<string | null>(null)

  // All draggable handles
  const handlesRef = useRef<Map<string, NodeHandle>>(new Map())

  // Drag state
  const isDraggingRef     = useRef(false)
  const dragNodeIdRef     = useRef<string | null>(null)
  const dragNodeRef       = useRef<NodeHandle | null>(null)
  const dragStartPosRef   = useRef<THREE.Vector3>(new THREE.Vector3())
  const dragCurrentPosRef = useRef<THREE.Vector3>(new THREE.Vector3())
  const hoverNodeIdRef    = useRef<string | null>(null)

  // Three.js drag helpers (created/destroyed per drag)
  const groundPlaneRef    = useRef<THREE.Plane>(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0))
  const raycasterRef      = useRef<THREE.Raycaster>(new THREE.Raycaster())
  const mouseRef          = useRef<THREE.Vector2>(new THREE.Vector2())

  // Visual feedback objects
  const shadowDiscRef     = useRef<THREE.Mesh | null>(null)
  const ghostRingRef      = useRef<THREE.Mesh | null>(null)
  const ghostFadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const ghostOpacityRef   = useRef<number>(0)

  // Cursor management
  const containerRef = useRef<HTMLDivElement | null>(null)

  // World data for dynamic project mountains
  const worldDataRef = useRef<NWWorldData | null>(null)

  // ── Supabase helpers ─────────────────────────────────────────────────────────

  useEffect(() => {
    async function loadOrgId() {
      try {
        const { data: { user } } = await (supabase as any).auth.getUser()
        if (!user) return
        const { data: profile } = await (supabase as any)
          .from('profiles')
          .select('org_id')
          .eq('id', user.id)
          .maybeSingle()
        orgIdRef.current = profile?.org_id ?? null

        // Load saved positions
        if (!orgIdRef.current) return
        const { data: settings } = await (supabase as any)
          .from('neural_world_settings')
          .select('node_positions')
          .eq('org_id', orgIdRef.current)
          .maybeSingle()

        if (settings?.node_positions && typeof settings.node_positions === 'object') {
          const saved = settings.node_positions as Record<string, NodePos>
          applyOverrides(saved)
          // After loading, rebuild handles to reflect saved positions
          rebuildAllHandles()
          // Notify all layers to reposition
          for (const [id, pos] of Object.entries(saved)) {
            window.dispatchEvent(new CustomEvent<{ id: string; x: number; z: number }>('nw:node-moved', {
              detail: { id, x: pos.x, z: pos.z },
            }))
          }
        }
      } catch (err) {
        console.warn('[DragDropSystem] loadOrgId error (non-blocking):', err)
      }
    }
    loadOrgId()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Debounced save to Supabase
  const savePositions = useCallback(
    debounce(async () => {
      try {
        const orgId = orgIdRef.current
        if (!orgId) return
        const overrides = getAllOverrides()
        await (supabase as any)
          .from('neural_world_settings')
          .upsert(
            { org_id: orgId, node_positions: overrides },
            { onConflict: 'org_id' }
          )
      } catch (err) {
        console.warn('[DragDropSystem] savePositions error (non-blocking):', err)
      }
    }, 800),
    []
  )

  // Reset handler
  const handleReset = useCallback(async () => {
    resetAllPositions()
    rebuildAllHandles()
    // Clear from Supabase
    try {
      const orgId = orgIdRef.current
      if (!orgId) return
      await (supabase as any)
        .from('neural_world_settings')
        .upsert(
          { org_id: orgId, node_positions: null },
          { onConflict: 'org_id' }
        )
    } catch (err) {
      console.warn('[DragDropSystem] reset save error:', err)
    }
  }, [])

  // ── Handle creation ──────────────────────────────────────────────────────────

  function makeHitSphere(x: number, y: number, z: number): THREE.Mesh {
    const geo = new THREE.SphereGeometry(6, 8, 6)
    const mat = new THREE.MeshBasicMaterial({ visible: false, side: THREE.FrontSide })
    const mesh = new THREE.Mesh(geo, mat)
    mesh.position.set(x, y, z)
    return mesh
  }

  function makeGlowRing(x: number, y: number, z: number): THREE.Mesh {
    const geo = new THREE.TorusGeometry(6.5, 0.4, 8, 32)
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    })
    const mesh = new THREE.Mesh(geo, mat)
    mesh.position.set(x, y, z)
    mesh.rotation.x = Math.PI / 2  // flat ring
    return mesh
  }

  function getHandlePos(id: string, def: { x: number; z: number; y: number }): { x: number; z: number; y: number } {
    const override = getNodePosition(id, def.x, def.z)
    return { x: override.x, z: override.z, y: def.y }
  }

  function addHandle(id: string, label: string, x: number, y: number, z: number) {
    // Remove old handle
    removeHandle(id)

    const hitMesh = makeHitSphere(x, y, z)
    hitMesh.userData = { dragNodeId: id }
    scene.add(hitMesh)

    const glowRing = makeGlowRing(x, y, z)
    scene.add(glowRing)

    handlesRef.current.set(id, { id, label, hitMesh, glowRing })
  }

  function removeHandle(id: string) {
    const h = handlesRef.current.get(id)
    if (!h) return
    scene.remove(h.hitMesh)
    h.hitMesh.geometry.dispose()
    ;(h.hitMesh.material as THREE.Material).dispose()
    scene.remove(h.glowRing)
    h.glowRing.geometry.dispose()
    ;(h.glowRing.material as THREE.Material).dispose()
    handlesRef.current.delete(id)
  }

  function rebuildAllHandles() {
    // Static nodes
    for (const [id, def] of Object.entries(STATIC_DEFAULTS)) {
      const pos = getHandlePos(id, def)
      addHandle(id, def.label, pos.x, pos.y, pos.z)
    }
    // Dynamic project mountains (if world data available)
    const data = worldDataRef.current
    if (data) {
      for (const p of data.projects) {
        const defaults = seededPosition(p.id)
        const pos = getNodePosition(`P_${p.id}`, defaults.x, defaults.z)
        addHandle(`P_${p.id}`, p.name.slice(0, 20), pos.x, 4, pos.z)
      }
    }
    // Update visibility based on current edit state
    setHandlesVisible(editActiveRef.current)
  }

  function setHandlesVisible(active: boolean) {
    handlesRef.current.forEach(h => {
      h.hitMesh.userData.dragActive = active
      if (!active) {
        ;(h.glowRing.material as THREE.MeshBasicMaterial).opacity = 0
      }
    })
  }

  // ── World data subscription (for project mountains) ──────────────────────────

  useEffect(() => {
    const unsub = subscribeWorldData(data => {
      worldDataRef.current = data
      // Add/update handles for project mountains
      for (const p of data.projects) {
        const defaults = seededPosition(p.id)
        const pos = getNodePosition(`P_${p.id}`, defaults.x, defaults.z)
        addHandle(`P_${p.id}`, p.name.slice(0, 20), pos.x, 4, pos.z)
      }
    })
    return unsub
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene])

  // ── Initial handle setup ─────────────────────────────────────────────────────

  useEffect(() => {
    rebuildAllHandles()
    return () => {
      handlesRef.current.forEach((_, id) => removeHandle(id))
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene])

  // ── Edit mode toggle ─────────────────────────────────────────────────────────

  useEffect(() => {
    function onToggle(e: Event) {
      const ev = e as CustomEvent<{ active: boolean }>
      const active = !!ev.detail?.active
      editActiveRef.current = active
      setEditActive(active)
      setHandlesVisible(active)
      // Tell NodeClickSystem to suppress during edit
      window.__nwEditLayoutActive = active
    }
    window.addEventListener('nw:edit-layout-active', onToggle)
    return () => window.removeEventListener('nw:edit-layout-active', onToggle)
  }, [])

  // ── Mouse coordinate helper ──────────────────────────────────────────────────

  function getMouseNDC(e: MouseEvent): THREE.Vector2 {
    const canvas = renderer.domElement
    const rect = canvas.getBoundingClientRect()
    return new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width)  *  2 - 1,
      ((e.clientY - rect.top)  / rect.height) * -2 + 1,
    )
  }

  function raycastHitMeshes(ndc: THREE.Vector2): NodeHandle | null {
    raycasterRef.current.setFromCamera(ndc, camera)
    const hitMeshes = Array.from(handlesRef.current.values()).map(h => h.hitMesh)
    const hits = raycasterRef.current.intersectObjects(hitMeshes, false)
    if (hits.length === 0) return null
    const id = hits[0].object.userData.dragNodeId as string
    return handlesRef.current.get(id) ?? null
  }

  function getGroundIntersect(ndc: THREE.Vector2): THREE.Vector3 | null {
    raycasterRef.current.setFromCamera(ndc, camera)
    const target = new THREE.Vector3()
    const hit = raycasterRef.current.ray.intersectPlane(groundPlaneRef.current, target)
    return hit ? target : null
  }

  // ── Drop shadow disc ─────────────────────────────────────────────────────────

  function createShadowDisc(x: number, z: number) {
    removeShadowDisc()
    const geo = new THREE.CircleGeometry(5, 24)
    const mat = new THREE.MeshBasicMaterial({
      color: 0x000000,
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
    })
    const disc = new THREE.Mesh(geo, mat)
    disc.rotation.x = -Math.PI / 2
    disc.position.set(x, 0.08, z)
    scene.add(disc)
    shadowDiscRef.current = disc
  }

  function updateShadowDisc(x: number, z: number) {
    if (!shadowDiscRef.current) return
    shadowDiscRef.current.position.set(x, 0.08, z)
  }

  function removeShadowDisc() {
    if (!shadowDiscRef.current) return
    scene.remove(shadowDiscRef.current)
    shadowDiscRef.current.geometry.dispose()
    ;(shadowDiscRef.current.material as THREE.Material).dispose()
    shadowDiscRef.current = null
  }

  // ── Ghost ring ───────────────────────────────────────────────────────────────

  function createGhostRing(x: number, y: number, z: number) {
    removeGhostRing()
    const geo = new THREE.TorusGeometry(6.5, 0.4, 8, 32)
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
    })
    const ring = new THREE.Mesh(geo, mat)
    ring.rotation.x = Math.PI / 2
    ring.position.set(x, y, z)
    scene.add(ring)
    ghostRingRef.current = ring
    ghostOpacityRef.current = 0.35

    // Fade out over 3 seconds
    if (ghostFadeTimerRef.current) clearTimeout(ghostFadeTimerRef.current)
    const startTime = performance.now()
    const FADE_DURATION = 3000
    function fade() {
      const elapsed = performance.now() - startTime
      const t = Math.min(elapsed / FADE_DURATION, 1)
      const opacity = 0.35 * (1 - t)
      ghostOpacityRef.current = opacity
      if (ghostRingRef.current) {
        ;(ghostRingRef.current.material as THREE.MeshBasicMaterial).opacity = opacity
        if (t < 1) {
          requestAnimationFrame(fade)
        } else {
          removeGhostRing()
        }
      }
    }
    requestAnimationFrame(fade)
  }

  function removeGhostRing() {
    if (!ghostRingRef.current) return
    scene.remove(ghostRingRef.current)
    ghostRingRef.current.geometry.dispose()
    ;(ghostRingRef.current.material as THREE.Material).dispose()
    ghostRingRef.current = null
    if (ghostFadeTimerRef.current) {
      clearTimeout(ghostFadeTimerRef.current)
      ghostFadeTimerRef.current = null
    }
  }

  // ── Glow ring helpers ────────────────────────────────────────────────────────

  function setGlowOpacity(handle: NodeHandle, opacity: number) {
    ;(handle.glowRing.material as THREE.MeshBasicMaterial).opacity = opacity
  }

  function setGlowColor(handle: NodeHandle, color: number) {
    ;(handle.glowRing.material as THREE.MeshBasicMaterial).color.setHex(color)
  }

  // ── Mouse events ─────────────────────────────────────────────────────────────

  useEffect(() => {
    const canvas = renderer.domElement

    function onMouseMove(e: MouseEvent) {
      if (!editActiveRef.current) return
      const ndc = getMouseNDC(e)
      mouseRef.current = ndc

      if (isDraggingRef.current && dragNodeRef.current) {
        // Move dragged node
        const groundPt = getGroundIntersect(ndc)
        if (!groundPt) return
        const x = groundPt.x
        const z = groundPt.z
        const y = terrainY(x)
        dragCurrentPosRef.current.set(x, y, z)

        // Move hit mesh + glow ring
        const h = dragNodeRef.current
        h.hitMesh.position.set(x, h.hitMesh.position.y, z)
        h.glowRing.position.set(x, h.glowRing.position.y, z)
        updateShadowDisc(x, z)
        canvas.style.cursor = 'grabbing'
      } else {
        // Hover detect
        const hit = raycastHitMeshes(ndc)
        if (hit) {
          if (hoverNodeIdRef.current !== hit.id) {
            // Unhover previous
            if (hoverNodeIdRef.current) {
              const prev = handlesRef.current.get(hoverNodeIdRef.current)
              if (prev && !isDraggingRef.current) setGlowOpacity(prev, 0)
            }
            hoverNodeIdRef.current = hit.id
            setGlowOpacity(hit, 0.55)
            setGlowColor(hit, 0xffffff)
          }
          canvas.style.cursor = 'grab'
        } else {
          if (hoverNodeIdRef.current) {
            const prev = handlesRef.current.get(hoverNodeIdRef.current)
            if (prev && !isDraggingRef.current) setGlowOpacity(prev, 0)
            hoverNodeIdRef.current = null
          }
          canvas.style.cursor = 'default'
        }
      }
    }

    function onMouseDown(e: MouseEvent) {
      if (!editActiveRef.current) return
      if (e.button !== 0) return
      const ndc = getMouseNDC(e)
      const hit = raycastHitMeshes(ndc)
      if (!hit) return

      e.stopPropagation()
      e.preventDefault()

      isDraggingRef.current = true
      dragNodeIdRef.current = hit.id
      dragNodeRef.current = hit
      dragStartPosRef.current.copy(hit.hitMesh.position)
      dragCurrentPosRef.current.copy(hit.hitMesh.position)

      // Bright white glow
      setGlowOpacity(hit, 1.0)
      setGlowColor(hit, 0xffffff)

      // Shadow disc
      createShadowDisc(hit.hitMesh.position.x, hit.hitMesh.position.z)

      canvas.style.cursor = 'grabbing'
    }

    function onMouseUp(e: MouseEvent) {
      if (!editActiveRef.current || !isDraggingRef.current) return
      if (e.button !== 0) return

      const h = dragNodeRef.current
      if (!h) return

      const x = dragCurrentPosRef.current.x
      const z = dragCurrentPosRef.current.z

      // Only commit if actually moved (> 1 unit)
      const moved = dragStartPosRef.current.distanceTo(new THREE.Vector3(x, dragCurrentPosRef.current.y, z)) > 1
      if (moved) {
        // Ghost at original position
        createGhostRing(
          dragStartPosRef.current.x,
          dragStartPosRef.current.y,
          dragStartPosRef.current.z,
        )

        // Update NodePositionStore → broadcasts nw:node-moved
        setNodePosition(h.id, x, z)

        // Animate reconnect pulse (green glow ring flash)
        setGlowColor(h, 0x00ff88)
        setGlowOpacity(h, 1.0)
        setTimeout(() => {
          setGlowColor(h, 0xffffff)
          setTimeout(() => {
            if (!isDraggingRef.current) setGlowOpacity(h, 0)
          }, 500)
        }, 500)

        // Emit reconnect event for DataFlowLayer
        window.dispatchEvent(new CustomEvent('nw:drag-reconnect', { detail: { id: h.id, x, z } }))

        // Persist
        savePositions()
      } else {
        // Snap back
        h.hitMesh.position.copy(dragStartPosRef.current)
        h.glowRing.position.x = dragStartPosRef.current.x
        h.glowRing.position.z = dragStartPosRef.current.z
        setGlowOpacity(h, 0)
      }

      // Cleanup drag state
      removeShadowDisc()
      isDraggingRef.current = false
      dragNodeIdRef.current = null
      dragNodeRef.current = null
      canvas.style.cursor = 'grab'
    }

    canvas.addEventListener('mousemove', onMouseMove)
    canvas.addEventListener('mousedown', onMouseDown)
    window.addEventListener('mouseup', onMouseUp)

    return () => {
      canvas.removeEventListener('mousemove', onMouseMove)
      canvas.removeEventListener('mousedown', onMouseDown)
      window.removeEventListener('mouseup', onMouseUp)
      canvas.style.cursor = 'default'
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene, camera, renderer])

  // ── Cursor reset on edit mode exit ──────────────────────────────────────────

  useEffect(() => {
    if (!editActive) {
      renderer.domElement.style.cursor = 'default'
      // Hide all glow rings
      handlesRef.current.forEach(h => setGlowOpacity(h, 0))
      // Cancel any active drag
      if (isDraggingRef.current) {
        const h = dragNodeRef.current
        if (h) {
          h.hitMesh.position.copy(dragStartPosRef.current)
          h.glowRing.position.x = dragStartPosRef.current.x
          h.glowRing.position.z = dragStartPosRef.current.z
        }
        isDraggingRef.current = false
        dragNodeRef.current = null
        removeShadowDisc()
      }
    }
  }, [editActive, renderer])

  // ── Positions-reset listener (RESET TO DEFAULT) ──────────────────────────────

  useEffect(() => {
    function onReset() {
      rebuildAllHandles()
    }
    window.addEventListener('nw:positions-reset', onReset)
    return () => window.removeEventListener('nw:positions-reset', onReset)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Edit mode HUD overlay ────────────────────────────────────────────────────

  if (!editActive) return null

  return (
    <div
      style={{
        position: 'fixed',
        top: 12,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 80,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 8,
        fontFamily: 'monospace',
        pointerEvents: 'none',
      }}
    >
      {/* Edit mode banner */}
      <div style={{
        background: 'rgba(255, 165, 0, 0.12)',
        border: '1px solid rgba(255, 165, 0, 0.55)',
        borderRadius: 6,
        padding: '5px 16px',
        fontSize: 10,
        letterSpacing: 2.5,
        color: '#ffaa33',
        boxShadow: '0 0 18px rgba(255,165,0,0.18)',
        pointerEvents: 'none',
      }}>
        ◈ EDIT LAYOUT — DRAG NODES TO REPOSITION
      </div>

      {/* Reset button */}
      <button
        onClick={handleReset}
        style={{
          background: 'rgba(255,40,40,0.12)',
          border: '1px solid rgba(255,40,40,0.45)',
          borderRadius: 5,
          padding: '4px 14px',
          fontSize: 9,
          letterSpacing: 1.5,
          color: '#ff6666',
          cursor: 'pointer',
          pointerEvents: 'auto',
          fontFamily: 'monospace',
        }}
      >
        ↺ RESET TO DEFAULT
      </button>
    </div>
  )
}

// Global type extension
declare global {
  interface Window {
    __nwEditLayoutActive?: boolean
  }
}
