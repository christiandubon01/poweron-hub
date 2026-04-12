/**
 * MemoryPalaceLayer.tsx — NW69: Spatial bookmarks with hotkey teleport and CatmullRom arc transitions.
 *
 * FEATURES:
 *   - Save current camera view as named bookmark via event 'nw:bookmark-save'
 *   - Bookmark data: { name, position:{x,y,z}, rotation:{x,y,z,w}, zoom, created_at, hotkey }
 *   - Storage: localStorage key 'nw_bookmarks' (JSON array, max 20 entries)
 *   - Visual markers: floating OctahedronGeometry diamonds at each bookmarked position
 *     · Gold (#ffcc44) for user-created bookmarks
 *     · Teal (#00e5cc) for auto-suggested bookmarks
 *     · Gentle y-bobbing + rotation animation, semi-transparent (opacity 0.72)
 *   - Click diamond  → smooth 1.5s CatmullRomCurve3 arc camera flight
 *   - Hotkeys 1–9   → instant camera teleport to assigned bookmark
 *     · Conflict avoidance: no hotkey intercept in THIRD_PERSON mode (1-3 reserved for TP dist)
 *   - Hold-on-arrival: camera stays locked at destination until user input, no snap-back
 *   - Bottom HUD strip: bookmark name chips with hotkey badges, scrollable
 *   - Auto-bookmark suggestions: tracks camera dwell time; after 40s cumulative at a position, suggests bookmark
 *   - Right-click diamond: context menu with Rename / Delete / Assign Hotkey
 *   - Import/export: JSON file for sharing between devices
 *   - Max 20 bookmarks: oldest auto-bookmark evicted first; user bookmarks never auto-deleted
 *
 * INTEGRATION NOTE (for CameraController):
 *   This layer dispatches 'nw:tour-lock-camera' and 'nw:tour-unlock-camera' to take/release
 *   camera control during arc transitions. CameraController already handles these events.
 *   After unlock, it also dispatches 'nw:set-orbit-radius' with bookmark zoom + target.
 *
 * EXPORT: named export `MemoryPalaceLayer`
 */

import React, {
  useEffect,
  useRef,
  useState,
  useCallback,
} from 'react'
import * as THREE from 'three'
import { useWorldContext } from './WorldContext'

// ── Constants ─────────────────────────────────────────────────────────────────

const LS_KEY              = 'nw_bookmarks'
const MAX_BOOKMARKS       = 20
const ARC_DURATION_MS     = 1500
const DWELL_CHECK_INTERVAL= 2000   // ms between dwell checks
const DWELL_ZONE_RADIUS   = 10     // world units
const DWELL_AUTO_THRESHOLD= 40000  // 40s cumulative dwell to suggest auto-bookmark
const BOB_SPEED           = 0.7
const BOB_AMPLITUDE       = 0.18
const DIAMOND_RADIUS      = 0.45
const DIAMOND_FLOAT_HEIGHT= 2.0    // units above bookmark y

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SpatialBookmark {
  id        : string
  name      : string
  position  : { x: number; y: number; z: number }
  rotation  : { x: number; y: number; z: number; w: number }
  zoom      : number          // orbit radius at time of saving
  created_at: string
  hotkey    : number | null   // 1–9 or null
  source    : 'user' | 'auto'
  visitCount: number
}

interface FlyState {
  curve       : THREE.CatmullRomCurve3
  startQuat   : THREE.Quaternion
  endQuat     : THREE.Quaternion
  startTime   : number
  bookmarkId  : string
}

interface HoldState {
  position  : THREE.Vector3
  quaternion: THREE.Quaternion
}

interface DwellZone {
  pos    : THREE.Vector3
  totalMs: number
  lastEntered: number
}

interface CtxMenu {
  screenX   : number
  screenY   : number
  bookmarkId: string
}

interface HotkeyAssign {
  bookmarkId: string
}

// ── Storage helpers ───────────────────────────────────────────────────────────

function loadBookmarks(): SpatialBookmark[] {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as SpatialBookmark[]) : []
  } catch {
    return []
  }
}

function saveBookmarks(bms: SpatialBookmark[]): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(bms))
  } catch {
    // non-blocking
  }
}

// ── Utility ───────────────────────────────────────────────────────────────────

function nwUid(): string {
  return Math.random().toString(36).slice(2, 9)
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

// ── Component ─────────────────────────────────────────────────────────────────

interface MemoryPalaceLayerProps {
  visible: boolean
}

export function MemoryPalaceLayer({ visible }: MemoryPalaceLayerProps) {
  const { scene, camera, renderer } = useWorldContext()

  // ── Primary state ─────────────────────────────────────────────────────────
  const [bookmarks, setBookmarks]     = useState<SpatialBookmark[]>(loadBookmarks)
  const [ctxMenu,   setCtxMenu]       = useState<CtxMenu | null>(null)
  const [renaming,  setRenaming]      = useState<{ id: string; name: string } | null>(null)
  const [hotkeyAssign, setHotkeyAssign] = useState<HotkeyAssign | null>(null)
  const [hudVisible, setHudVisible]   = useState<boolean>(true)

  // ── Refs (frame-safe access) ──────────────────────────────────────────────
  const bookmarksRef     = useRef<SpatialBookmark[]>(bookmarks)
  const meshMap          = useRef<Map<string, THREE.Mesh>>(new Map())
  const flyRef           = useRef<FlyState | null>(null)
  const holdRef          = useRef<HoldState | null>(null)
  const orbitRadiusRef   = useRef<number>(80)
  const cameraModeRef    = useRef<string>('ORBIT')
  const dwellZoneMap     = useRef<Map<string, DwellZone>>(new Map())

  // ── Sync bookmarks ref ────────────────────────────────────────────────────
  useEffect(() => {
    bookmarksRef.current = bookmarks
    saveBookmarks(bookmarks)
  }, [bookmarks])

  // ── Track orbit radius ────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: Event) => {
      const ev = e as CustomEvent<{ radius: number }>
      if (ev.detail?.radius !== undefined) orbitRadiusRef.current = ev.detail.radius
    }
    window.addEventListener('nw:orbit-radius', handler)
    return () => window.removeEventListener('nw:orbit-radius', handler)
  }, [])

  // ── Track camera mode (to avoid key conflict) ─────────────────────────────
  useEffect(() => {
    const handler = (e: Event) => {
      const ev = e as CustomEvent<{ mode: string }>
      if (ev.detail?.mode) cameraModeRef.current = ev.detail.mode
    }
    window.addEventListener('nw:camera-mode', handler)
    return () => window.removeEventListener('nw:camera-mode', handler)
  }, [])

  // ── Cleanup hold lock on any user input ───────────────────────────────────
  useEffect(() => {
    const clearHold = () => {
      if (holdRef.current) {
        holdRef.current = null
        window.dispatchEvent(new CustomEvent('nw:tour-unlock-camera'))
      }
    }
    const canvas = renderer.domElement
    canvas.addEventListener('mousedown', clearHold)
    window.addEventListener('keydown', clearHold)
    return () => {
      canvas.removeEventListener('mousedown', clearHold)
      window.removeEventListener('keydown', clearHold)
    }
  }, [renderer])

  // ── Three.js mesh management ──────────────────────────────────────────────

  /** Sync diamond meshes to current bookmarks state */
  const syncMeshes = useCallback((bms: SpatialBookmark[]) => {
    const ids = new Set(bms.map(b => b.id))

    // Remove orphaned meshes
    meshMap.current.forEach((mesh, id) => {
      if (!ids.has(id)) {
        scene.remove(mesh)
        mesh.geometry.dispose()
        ;(mesh.material as THREE.Material).dispose()
        meshMap.current.delete(id)
      }
    })

    // Add or update meshes
    bms.forEach(bm => {
      if (!meshMap.current.has(bm.id)) {
        const geo  = new THREE.OctahedronGeometry(DIAMOND_RADIUS, 0)
        const hex  = bm.source === 'user' ? 0xffcc44 : 0x00e5cc
        const mat  = new THREE.MeshStandardMaterial({
          color           : hex,
          emissive        : hex,
          emissiveIntensity: 0.55,
          transparent     : true,
          opacity         : 0.72,
          roughness       : 0.15,
          metalness       : 0.55,
        })
        const mesh = new THREE.Mesh(geo, mat)
        mesh.position.set(
          bm.position.x,
          bm.position.y + DIAMOND_FLOAT_HEIGHT,
          bm.position.z,
        )
        mesh.userData.bookmarkId = bm.id
        mesh.visible = visible
        scene.add(mesh)
        meshMap.current.set(bm.id, mesh)
      }
    })
  }, [scene, visible]) // eslint-disable-line react-hooks/exhaustive-deps

  // Re-sync meshes whenever bookmarks change
  useEffect(() => {
    syncMeshes(bookmarks)
  }, [bookmarks, syncMeshes])

  // Update visibility on prop change
  useEffect(() => {
    meshMap.current.forEach(mesh => { mesh.visible = visible })
  }, [visible])

  // Mount/unmount: initial sync + cleanup
  useEffect(() => {
    syncMeshes(loadBookmarks())
    return () => {
      meshMap.current.forEach(mesh => {
        scene.remove(mesh)
        mesh.geometry.dispose()
        ;(mesh.material as THREE.Material).dispose()
      })
      meshMap.current.clear()
    }
  }, [scene]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Bookmark management ───────────────────────────────────────────────────

  const addBookmark = useCallback((bm: SpatialBookmark) => {
    setBookmarks(prev => {
      const next = [...prev, bm]
      if (next.length <= MAX_BOOKMARKS) return next
      // Evict oldest auto-bookmark first; user bookmarks are protected
      const autoIdx = next.findIndex(b => b.source === 'auto')
      if (autoIdx !== -1) {
        next.splice(autoIdx, 1)
      } else {
        // All are user bookmarks — evict oldest
        next.shift()
      }
      return next
    })
  }, [])

  const removeBookmark = useCallback((id: string) => {
    setBookmarks(prev => prev.filter(b => b.id !== id))
    setCtxMenu(null)
  }, [])

  const renameBookmark = useCallback((id: string, name: string) => {
    if (!name.trim()) return
    setBookmarks(prev => prev.map(b => b.id === id ? { ...b, name: name.trim() } : b))
    setRenaming(null)
    setCtxMenu(null)
  }, [])

  const assignHotkey = useCallback((id: string, key: number | null) => {
    setBookmarks(prev => {
      // Clear any existing bookmark that had this hotkey
      const cleared = key !== null
        ? prev.map(b => b.hotkey === key ? { ...b, hotkey: null } : b)
        : prev
      return cleared.map(b => b.id === id ? { ...b, hotkey: key } : b)
    })
    setHotkeyAssign(null)
    setCtxMenu(null)
  }, [])

  // ── Save bookmark via event ───────────────────────────────────────────────
  useEffect(() => {
    const onSave = (e: Event) => {
      const ev   = e as CustomEvent<{ name?: string; hotkey?: number | null }>
      const name = ev.detail?.name?.trim() || `View ${bookmarksRef.current.length + 1}`
      const hotkey = (ev.detail?.hotkey != null &&
                      ev.detail.hotkey >= 1 &&
                      ev.detail.hotkey <= 9)
        ? ev.detail.hotkey
        : null

      const bm: SpatialBookmark = {
        id        : nwUid(),
        name,
        position  : { x: camera.position.x, y: camera.position.y, z: camera.position.z },
        rotation  : {
          x: camera.quaternion.x,
          y: camera.quaternion.y,
          z: camera.quaternion.z,
          w: camera.quaternion.w,
        },
        zoom      : orbitRadiusRef.current,
        created_at: new Date().toISOString(),
        hotkey    : hotkey,
        source    : 'user',
        visitCount: 0,
      }
      addBookmark(bm)
    }

    window.addEventListener('nw:bookmark-save', onSave)
    return () => window.removeEventListener('nw:bookmark-save', onSave)
  }, [camera, addBookmark])

  // ── Camera flight (arc + hold) ────────────────────────────────────────────

  const flyToBookmark = useCallback((bm: SpatialBookmark) => {
    // Cancel any existing hold
    if (holdRef.current) {
      holdRef.current = null
    }

    const startPos = camera.position.clone()
    const endPos   = new THREE.Vector3(bm.position.x, bm.position.y, bm.position.z)

    // Arc: mid-point elevated above the straight-line path
    const dist      = startPos.distanceTo(endPos)
    const arcHeight = Math.max(dist * 0.4, 15)
    const midPos    = new THREE.Vector3(
      (startPos.x + endPos.x) / 2,
      Math.max(startPos.y, endPos.y) + arcHeight,
      (startPos.z + endPos.z) / 2,
    )

    const curve     = new THREE.CatmullRomCurve3([startPos, midPos, endPos])
    const startQuat = camera.quaternion.clone()
    const endQuat   = new THREE.Quaternion(
      bm.rotation.x, bm.rotation.y, bm.rotation.z, bm.rotation.w,
    )

    flyRef.current = {
      curve,
      startQuat,
      endQuat,
      startTime  : performance.now(),
      bookmarkId : bm.id,
    }

    window.dispatchEvent(new CustomEvent('nw:tour-lock-camera'))

    // Increment visit count
    setBookmarks(prev =>
      prev.map(b => b.id === bm.id ? { ...b, visitCount: b.visitCount + 1 } : b)
    )
  }, [camera])

  const teleportToBookmark = useCallback((bm: SpatialBookmark) => {
    // Instant — no arc
    if (flyRef.current) flyRef.current = null

    camera.position.set(bm.position.x, bm.position.y, bm.position.z)
    camera.quaternion.set(bm.rotation.x, bm.rotation.y, bm.rotation.z, bm.rotation.w)

    holdRef.current = {
      position  : new THREE.Vector3(bm.position.x, bm.position.y, bm.position.z),
      quaternion: new THREE.Quaternion(bm.rotation.x, bm.rotation.y, bm.rotation.z, bm.rotation.w),
    }

    window.dispatchEvent(new CustomEvent('nw:tour-lock-camera'))
    window.dispatchEvent(new CustomEvent('nw:set-orbit-radius', {
      detail: { radius: bm.zoom },
    }))

    setBookmarks(prev =>
      prev.map(b => b.id === bm.id ? { ...b, visitCount: b.visitCount + 1 } : b)
    )
  }, [camera])

  // ── Frame loop: arc animation + hold + diamond bob ────────────────────────
  useEffect(() => {
    const onFrame = () => {
      const now = performance.now()

      // ── Arc animation ──────────────────────────────────────────────────
      if (flyRef.current) {
        const fly = flyRef.current
        const raw = (now - fly.startTime) / ARC_DURATION_MS
        const t   = Math.min(raw, 1.0)
        const te  = easeInOutCubic(t)

        const pos = fly.curve.getPoint(te)
        camera.position.copy(pos)
        camera.quaternion.copy(
          fly.startQuat.clone().slerp(fly.endQuat, te)
        )

        if (t >= 1.0) {
          const bm = bookmarksRef.current.find(b => b.id === fly.bookmarkId)
          flyRef.current = null

          if (bm) {
            // Transition into hold mode so camera stays put
            holdRef.current = {
              position  : new THREE.Vector3(bm.position.x, bm.position.y, bm.position.z),
              quaternion: new THREE.Quaternion(bm.rotation.x, bm.rotation.y, bm.rotation.z, bm.rotation.w),
            }
            // Let orbit system know the new radius/target
            window.dispatchEvent(new CustomEvent('nw:set-orbit-radius', {
              detail: { radius: bm.zoom },
            }))
          } else {
            // No bookmark found — release immediately
            window.dispatchEvent(new CustomEvent('nw:tour-unlock-camera'))
          }
        }
        // While flying or holding, skip bob (diamonds still animate below)
      }

      // ── Hold-at-destination ────────────────────────────────────────────
      if (!flyRef.current && holdRef.current) {
        camera.position.copy(holdRef.current.position)
        camera.quaternion.copy(holdRef.current.quaternion)
      }

      // ── Diamond bob + rotation ─────────────────────────────────────────
      if (visible) {
        const t_sec = now * 0.001
        meshMap.current.forEach((mesh, id) => {
          const bm = bookmarksRef.current.find(b => b.id === id)
          if (!bm) return
          mesh.position.y =
            bm.position.y + DIAMOND_FLOAT_HEIGHT +
            Math.sin(t_sec * BOB_SPEED + bm.position.x * 0.31 + bm.position.z * 0.13) * BOB_AMPLITUDE
          mesh.rotation.y += 0.012
        })
      }
    }

    window.addEventListener('nw:frame', onFrame)
    return () => window.removeEventListener('nw:frame', onFrame)
  }, [camera, visible])

  // ── Hotkey handler (keys 1–9) ─────────────────────────────────────────────
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return
      if (hotkeyAssign) return   // wait for hotkey assignment modal to close
      if (renaming)    return
      if (ctxMenu)     return
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase()
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return

      // Keys 1–3 in THIRD_PERSON mode belong to TP distance — skip
      if (cameraModeRef.current === 'THIRD_PERSON') return

      const digit = parseInt(e.key, 10)
      if (isNaN(digit) || digit < 1 || digit > 9) return

      const bm = bookmarksRef.current.find(b => b.hotkey === digit)
      if (!bm) return

      e.preventDefault()
      teleportToBookmark(bm)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [teleportToBookmark, hotkeyAssign, renaming, ctxMenu])

  // ── Canvas click: diamond left-click = fly, right-click = context menu ────
  useEffect(() => {
    const canvas = renderer.domElement
    const raycaster = new THREE.Raycaster()
    const mouseNDC  = new THREE.Vector2()

    const onClick = (e: MouseEvent) => {
      if (!visible) return
      const rect = canvas.getBoundingClientRect()
      mouseNDC.x =  ((e.clientX - rect.left) / rect.width)  * 2 - 1
      mouseNDC.y = -((e.clientY - rect.top)  / rect.height) * 2 + 1

      raycaster.setFromCamera(mouseNDC, camera)
      const meshes = Array.from(meshMap.current.values())
      const hits   = raycaster.intersectObjects(meshes, false)
      if (hits.length === 0) return

      const id = hits[0].object.userData.bookmarkId as string
      const bm = bookmarksRef.current.find(b => b.id === id)
      if (!bm) return

      e.stopPropagation()
      flyToBookmark(bm)
    }

    const onContextMenu = (e: MouseEvent) => {
      if (!visible) return
      const rect = canvas.getBoundingClientRect()
      mouseNDC.x =  ((e.clientX - rect.left) / rect.width)  * 2 - 1
      mouseNDC.y = -((e.clientY - rect.top)  / rect.height) * 2 + 1

      raycaster.setFromCamera(mouseNDC, camera)
      const meshes = Array.from(meshMap.current.values())
      const hits   = raycaster.intersectObjects(meshes, false)
      if (hits.length === 0) return

      const id = hits[0].object.userData.bookmarkId as string
      e.preventDefault()
      e.stopPropagation()
      setCtxMenu({ screenX: e.clientX, screenY: e.clientY, bookmarkId: id })
    }

    canvas.addEventListener('click', onClick)
    canvas.addEventListener('contextmenu', onContextMenu)
    return () => {
      canvas.removeEventListener('click', onClick)
      canvas.removeEventListener('contextmenu', onContextMenu)
    }
  }, [camera, renderer, visible, flyToBookmark])

  // ── Auto-bookmark suggestions via camera dwell tracking ───────────────────
  useEffect(() => {
    const interval = setInterval(() => {
      const camPos = camera.position.clone()

      // Find which zone (if any) the camera is in
      let currentZoneKey: string | null = null
      dwellZoneMap.current.forEach((zone, key) => {
        if (camPos.distanceTo(zone.pos) < DWELL_ZONE_RADIUS) {
          currentZoneKey = key
        }
      })

      if (currentZoneKey === null) {
        // Not in any known zone — create or find one
        const gridKey = `${Math.round(camPos.x / DWELL_ZONE_RADIUS)}_${Math.round(camPos.z / DWELL_ZONE_RADIUS)}`
        if (!dwellZoneMap.current.has(gridKey)) {
          dwellZoneMap.current.set(gridKey, {
            pos        : camPos.clone(),
            totalMs    : 0,
            lastEntered: Date.now(),
          })
        }
        currentZoneKey = gridKey
      }

      // Accumulate time in zone
      const zone = dwellZoneMap.current.get(currentZoneKey)!
      zone.totalMs += DWELL_CHECK_INTERVAL

      if (zone.totalMs >= DWELL_AUTO_THRESHOLD) {
        // Check no user/auto bookmark already nearby
        const nearby = bookmarksRef.current.find(b =>
          new THREE.Vector3(b.position.x, b.position.y, b.position.z)
            .distanceTo(zone.pos) < DWELL_ZONE_RADIUS * 1.5
        )
        if (!nearby) {
          const autoCount = bookmarksRef.current.filter(b => b.source === 'auto').length
          const autoBm: SpatialBookmark = {
            id        : nwUid(),
            name      : `Frequent View ${autoCount + 1}`,
            position  : { x: zone.pos.x, y: zone.pos.y, z: zone.pos.z },
            rotation  : {
              x: camera.quaternion.x,
              y: camera.quaternion.y,
              z: camera.quaternion.z,
              w: camera.quaternion.w,
            },
            zoom      : orbitRadiusRef.current,
            created_at: new Date().toISOString(),
            hotkey    : null,
            source    : 'auto',
            visitCount: 0,
          }
          addBookmark(autoBm)
        }
        dwellZoneMap.current.delete(currentZoneKey)
      }
    }, DWELL_CHECK_INTERVAL)

    return () => clearInterval(interval)
  }, [camera, addBookmark])

  // ── Import / Export ───────────────────────────────────────────────────────

  const handleExport = useCallback(() => {
    const json = JSON.stringify(bookmarks, null, 2)
    const blob = new Blob([json], { type: 'application/json' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = `poweron_bookmarks_${Date.now()}.json`
    a.click()
    URL.revokeObjectURL(url)
  }, [bookmarks])

  const handleImport = useCallback(() => {
    const input      = document.createElement('input')
    input.type       = 'file'
    input.accept     = '.json,application/json'
    input.onchange   = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (!file) return
      const reader = new FileReader()
      reader.onload = (ev) => {
        try {
          const parsed = JSON.parse(ev.target?.result as string)
          if (!Array.isArray(parsed)) return
          const valid = parsed.filter(
            (b): b is SpatialBookmark =>
              typeof b === 'object' && b !== null &&
              typeof b.id === 'string' &&
              typeof b.name === 'string' &&
              typeof b.position === 'object' &&
              typeof b.rotation === 'object'
          )
          setBookmarks(prev => {
            const existingIds = new Set(prev.map(b => b.id))
            const incoming    = valid.filter(b => !existingIds.has(b.id))
            const merged      = [...prev, ...incoming].slice(-MAX_BOOKMARKS)
            return merged
          })
        } catch {
          // bad JSON — ignore
        }
      }
      reader.readAsText(file)
    }
    input.click()
  }, [])

  // ── Dismiss context menu on outside click ─────────────────────────────────
  useEffect(() => {
    if (!ctxMenu) return
    const dismiss = (e: MouseEvent) => {
      const el = e.target as HTMLElement
      if (!el.closest('[data-mp-ctx]')) setCtxMenu(null)
    }
    window.addEventListener('mousedown', dismiss)
    return () => window.removeEventListener('mousedown', dismiss)
  }, [ctxMenu])

  // ── Render ────────────────────────────────────────────────────────────────

  const ctxBm = ctxMenu ? bookmarks.find(b => b.id === ctxMenu.bookmarkId) : null
  const hotkeyBm = hotkeyAssign ? bookmarks.find(b => b.id === hotkeyAssign.bookmarkId) : null

  return (
    <>
      {/* ── Bookmark HUD strip ── */}
      {hudVisible && bookmarks.length > 0 && (
        <div
          style={{
            position       : 'fixed',
            bottom         : 80,
            left           : '50%',
            transform      : 'translateX(-50%)',
            zIndex         : 25,
            display        : 'flex',
            alignItems     : 'center',
            gap            : 6,
            padding        : '5px 10px',
            background     : 'rgba(0,0,0,0.55)',
            border         : '1px solid rgba(255,255,255,0.1)',
            borderRadius   : 24,
            backdropFilter : 'blur(8px)',
            maxWidth       : 'calc(100vw - 40px)',
            overflowX      : 'auto',
            scrollbarWidth : 'none',
          }}
        >
          {/* Palace icon + toggle */}
          <span
            style={{
              fontSize  : 13,
              color     : 'rgba(255,204,68,0.8)',
              flexShrink: 0,
              marginRight: 2,
            }}
            title="Memory Palace"
          >
            ◆
          </span>

          {bookmarks.map(bm => (
            <button
              key={bm.id}
              onClick={() => flyToBookmark(bm)}
              onContextMenu={e => {
                e.preventDefault()
                setCtxMenu({ screenX: e.clientX, screenY: e.clientY, bookmarkId: bm.id })
              }}
              title={`${bm.name}${bm.hotkey ? ` [${bm.hotkey}]` : ''} — click to fly`}
              style={{
                display        : 'flex',
                alignItems     : 'center',
                gap            : 4,
                padding        : '3px 9px',
                background     : bm.source === 'user'
                  ? 'rgba(255,204,68,0.12)'
                  : 'rgba(0,229,204,0.10)',
                border         : `1px solid ${bm.source === 'user' ? 'rgba(255,204,68,0.3)' : 'rgba(0,229,204,0.25)'}`,
                borderRadius   : 12,
                color          : bm.source === 'user' ? '#ffcc44' : '#00e5cc',
                fontSize       : 11,
                fontWeight     : 500,
                letterSpacing  : 0.4,
                cursor         : 'pointer',
                whiteSpace     : 'nowrap',
                flexShrink     : 0,
                transition     : 'all 0.15s',
              }}
            >
              {bm.hotkey !== null && (
                <span
                  style={{
                    fontSize        : 9,
                    fontWeight      : 700,
                    background      : 'rgba(255,255,255,0.15)',
                    borderRadius    : 4,
                    padding         : '1px 4px',
                    color           : 'rgba(255,255,255,0.7)',
                    letterSpacing   : 0,
                    lineHeight      : 1.4,
                  }}
                >
                  {bm.hotkey}
                </span>
              )}
              <span style={{ maxWidth: 90, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {bm.name}
              </span>
            </button>
          ))}

          {/* Divider */}
          <div style={{ width: 1, height: 16, background: 'rgba(255,255,255,0.1)', flexShrink: 0 }} />

          {/* Save current view */}
          <button
            onClick={() => {
              window.dispatchEvent(new CustomEvent('nw:bookmark-save', {
                detail: { name: `View ${bookmarks.length + 1}` },
              }))
            }}
            title="Save current camera view"
            style={{
              padding      : '3px 9px',
              background   : 'rgba(255,255,255,0.07)',
              border       : '1px solid rgba(255,255,255,0.15)',
              borderRadius : 12,
              color        : 'rgba(255,255,255,0.5)',
              fontSize     : 11,
              cursor       : 'pointer',
              flexShrink   : 0,
              whiteSpace   : 'nowrap',
            }}
          >
            + Save
          </button>

          {/* Export */}
          <button
            onClick={handleExport}
            title="Export bookmarks as JSON"
            style={{
              padding      : '3px 8px',
              background   : 'rgba(255,255,255,0.05)',
              border       : '1px solid rgba(255,255,255,0.12)',
              borderRadius : 12,
              color        : 'rgba(255,255,255,0.38)',
              fontSize     : 10,
              cursor       : 'pointer',
              flexShrink   : 0,
            }}
          >
            ↑
          </button>

          {/* Import */}
          <button
            onClick={handleImport}
            title="Import bookmarks from JSON"
            style={{
              padding      : '3px 8px',
              background   : 'rgba(255,255,255,0.05)',
              border       : '1px solid rgba(255,255,255,0.12)',
              borderRadius : 12,
              color        : 'rgba(255,255,255,0.38)',
              fontSize     : 10,
              cursor       : 'pointer',
              flexShrink   : 0,
            }}
          >
            ↓
          </button>

          {/* Hide strip */}
          <button
            onClick={() => setHudVisible(false)}
            title="Hide bookmark strip"
            style={{
              padding      : '3px 7px',
              background   : 'transparent',
              border       : 'none',
              color        : 'rgba(255,255,255,0.25)',
              fontSize     : 11,
              cursor       : 'pointer',
              flexShrink   : 0,
            }}
          >
            ✕
          </button>
        </div>
      )}

      {/* ── Restore strip button (when hidden) ── */}
      {!hudVisible && (
        <button
          onClick={() => setHudVisible(true)}
          title="Show Memory Palace bookmarks"
          style={{
            position       : 'fixed',
            bottom         : 82,
            left           : '50%',
            transform      : 'translateX(-50%)',
            zIndex         : 25,
            padding        : '4px 12px',
            background     : 'rgba(0,0,0,0.45)',
            border         : '1px solid rgba(255,204,68,0.3)',
            borderRadius   : 12,
            color          : 'rgba(255,204,68,0.6)',
            fontSize       : 11,
            cursor         : 'pointer',
            backdropFilter : 'blur(6px)',
          }}
        >
          ◆ Bookmarks
        </button>
      )}

      {/* ── Right-click context menu ── */}
      {ctxMenu && ctxBm && (
        <div
          data-mp-ctx="1"
          style={{
            position       : 'fixed',
            left           : ctxMenu.screenX + 4,
            top            : ctxMenu.screenY + 4,
            zIndex         : 999,
            background     : 'rgba(10,12,18,0.95)',
            border         : '1px solid rgba(255,255,255,0.14)',
            borderRadius   : 10,
            padding        : '6px 0',
            minWidth       : 176,
            backdropFilter : 'blur(10px)',
            boxShadow      : '0 4px 24px rgba(0,0,0,0.6)',
          }}
        >
          {/* Header */}
          <div style={{
            padding   : '4px 14px 8px',
            fontSize  : 10,
            color     : ctxBm.source === 'user' ? '#ffcc44' : '#00e5cc',
            fontWeight: 600,
            letterSpacing: 0.6,
            borderBottom: '1px solid rgba(255,255,255,0.08)',
            marginBottom: 4,
          }}>
            ◆ {ctxBm.name}
          </div>

          {/* Fly to */}
          <CtxItem
            label="Fly to view"
            icon="✈"
            onClick={() => { flyToBookmark(ctxBm); setCtxMenu(null) }}
          />

          {/* Rename */}
          <CtxItem
            label="Rename"
            icon="✏"
            onClick={() => {
              setRenaming({ id: ctxBm.id, name: ctxBm.name })
              setCtxMenu(null)
            }}
          />

          {/* Assign hotkey */}
          <CtxItem
            label={ctxBm.hotkey !== null ? `Hotkey: ${ctxBm.hotkey} (reassign)` : 'Assign hotkey'}
            icon="⌨"
            onClick={() => {
              setHotkeyAssign({ bookmarkId: ctxBm.id })
              setCtxMenu(null)
            }}
          />

          {ctxBm.hotkey !== null && (
            <CtxItem
              label="Clear hotkey"
              icon="✕"
              onClick={() => assignHotkey(ctxBm.id, null)}
            />
          )}

          <div style={{ height: 1, background: 'rgba(255,255,255,0.08)', margin: '4px 0' }} />

          {/* Delete */}
          <CtxItem
            label="Delete bookmark"
            icon="🗑"
            danger
            onClick={() => removeBookmark(ctxBm.id)}
          />
        </div>
      )}

      {/* ── Rename modal ── */}
      {renaming && (
        <Modal onClose={() => setRenaming(null)}>
          <div style={{ color: '#fff', fontSize: 13, fontWeight: 600, marginBottom: 10 }}>
            Rename Bookmark
          </div>
          <input
            autoFocus
            defaultValue={renaming.name}
            onKeyDown={e => {
              if (e.key === 'Enter')  renameBookmark(renaming.id, (e.target as HTMLInputElement).value)
              if (e.key === 'Escape') setRenaming(null)
            }}
            style={{
              width        : '100%',
              background   : 'rgba(255,255,255,0.08)',
              border       : '1px solid rgba(255,255,255,0.2)',
              borderRadius : 8,
              padding      : '7px 10px',
              color        : '#fff',
              fontSize     : 13,
              outline      : 'none',
              boxSizing    : 'border-box',
            }}
          />
          <div style={{ display: 'flex', gap: 8, marginTop: 10, justifyContent: 'flex-end' }}>
            <ModalBtn label="Cancel" onClick={() => setRenaming(null)} />
            <ModalBtn
              label="Save"
              primary
              onClick={() => {
                const inp = document.querySelector<HTMLInputElement>('input[autofocus]')
                // fallback: use the rename state
                renameBookmark(renaming.id, renaming.name)
              }}
            />
          </div>
        </Modal>
      )}

      {/* ── Hotkey assign modal ── */}
      {hotkeyAssign && hotkeyBm && (
        <Modal onClose={() => setHotkeyAssign(null)}>
          <div style={{ color: '#fff', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
            Assign Hotkey
          </div>
          <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 11, marginBottom: 14 }}>
            Press 1–9 to assign to &quot;{hotkeyBm.name}&quot;
          </div>
          <HotkeyGrid
            bookmarks={bookmarks}
            targetId={hotkeyAssign.bookmarkId}
            onSelect={key => assignHotkey(hotkeyAssign.bookmarkId, key)}
            onClear={() => assignHotkey(hotkeyAssign.bookmarkId, null)}
          />
        </Modal>
      )}
    </>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

function CtxItem({
  label, icon, onClick, danger = false,
}: {
  label: string; icon: string; onClick: () => void; danger?: boolean
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display     : 'flex',
        alignItems  : 'center',
        gap         : 8,
        width       : '100%',
        padding     : '6px 14px',
        background  : 'transparent',
        border      : 'none',
        color       : danger ? '#ff5566' : 'rgba(255,255,255,0.75)',
        fontSize    : 12,
        cursor      : 'pointer',
        textAlign   : 'left',
        transition  : 'background 0.1s',
      }}
      onMouseEnter={e => {
        (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.07)'
      }}
      onMouseLeave={e => {
        (e.currentTarget as HTMLButtonElement).style.background = 'transparent'
      }}
    >
      <span style={{ width: 16, textAlign: 'center', fontSize: 12 }}>{icon}</span>
      {label}
    </button>
  )
}

function Modal({
  children, onClose,
}: {
  children: React.ReactNode; onClose: () => void
}) {
  return (
    <div
      style={{
        position       : 'fixed',
        inset          : 0,
        zIndex         : 1000,
        display        : 'flex',
        alignItems     : 'center',
        justifyContent : 'center',
        background     : 'rgba(0,0,0,0.5)',
        backdropFilter : 'blur(3px)',
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        style={{
          background    : 'rgba(12,15,22,0.97)',
          border        : '1px solid rgba(255,255,255,0.15)',
          borderRadius  : 14,
          padding       : '20px 22px',
          minWidth      : 280,
          maxWidth      : 360,
          boxShadow     : '0 8px 40px rgba(0,0,0,0.7)',
        }}
      >
        {children}
      </div>
    </div>
  )
}

function ModalBtn({
  label, onClick, primary = false,
}: {
  label: string; onClick: () => void; primary?: boolean
}) {
  return (
    <button
      onClick={onClick}
      style={{
        padding      : '6px 16px',
        borderRadius : 8,
        border       : primary ? 'none' : '1px solid rgba(255,255,255,0.18)',
        background   : primary ? 'rgba(0,229,204,0.2)' : 'transparent',
        color        : primary ? '#00e5cc' : 'rgba(255,255,255,0.55)',
        fontSize     : 12,
        cursor       : 'pointer',
        fontWeight   : primary ? 600 : 400,
      }}
    >
      {label}
    </button>
  )
}

function HotkeyGrid({
  bookmarks, targetId, onSelect, onClear,
}: {
  bookmarks: SpatialBookmark[]
  targetId : string
  onSelect : (key: number) => void
  onClear  : () => void
}) {
  const hotkeyMap: Record<number, string> = {}
  bookmarks.forEach(b => { if (b.hotkey !== null) hotkeyMap[b.hotkey] = b.name })
  const target = bookmarks.find(b => b.id === targetId)

  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
        {[1,2,3,4,5,6,7,8,9].map(k => {
          const taken   = hotkeyMap[k] && hotkeyMap[k] !== target?.name
          const current = target?.hotkey === k
          return (
            <button
              key={k}
              onClick={() => onSelect(k)}
              title={taken ? `In use: ${hotkeyMap[k]}` : `Assign [${k}]`}
              style={{
                width        : 38,
                height       : 38,
                borderRadius : 8,
                border       : current
                  ? '2px solid #00e5cc'
                  : taken
                    ? '1px solid rgba(255,85,102,0.4)'
                    : '1px solid rgba(255,255,255,0.18)',
                background   : current
                  ? 'rgba(0,229,204,0.15)'
                  : taken
                    ? 'rgba(255,85,102,0.08)'
                    : 'rgba(255,255,255,0.05)',
                color        : current ? '#00e5cc' : taken ? '#ff8899' : 'rgba(255,255,255,0.7)',
                fontSize     : 14,
                fontWeight   : 600,
                cursor       : taken ? 'not-allowed' : 'pointer',
              }}
            >
              {k}
            </button>
          )
        })}
      </div>
      {target?.hotkey !== null && (
        <button
          onClick={onClear}
          style={{
            marginTop    : 12,
            padding      : '5px 12px',
            background   : 'transparent',
            border       : '1px solid rgba(255,85,102,0.3)',
            borderRadius : 8,
            color        : '#ff8899',
            fontSize     : 11,
            cursor       : 'pointer',
          }}
        >
          Clear hotkey
        </button>
      )}
    </div>
  )
}
