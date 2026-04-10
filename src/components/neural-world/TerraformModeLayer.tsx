/**
 * TerraformModeLayer.tsx — NW65: Presentation mode for client meetings and investor pitches.
 *
 * Activation:  window.dispatchEvent(new CustomEvent('nw:terraform-toggle'))
 *
 * Features:
 *  - All nodes become draggable via DragDropSystem (nw:edit-layout-active event)
 *  - Scale handles: corner handles on selected node, drag to resize (nw:terraform-scale-node)
 *  - Hide button: 'X' on hover, click to temporarily hide any element
 *  - Unhide panel: sidebar list of hidden elements, click to restore
 *  - Layout save: localStorage key 'nw_terraform_layout_[name]'
 *  - Layout load: dropdown of saved layouts with apply/delete
 *  - Preset layouts: 'Revenue Focus' | 'Project Grid' | 'Timeline'
 *  - Screenshot mode: dispatch 'nw:terraform-screenshot' — hides all UI for 3 seconds
 *  - Exit: restores original data-driven positions with smooth 1s animation
 *
 * Events dispatched:
 *  - nw:edit-layout-active  { active: boolean }     — activates DragDropSystem drag mode
 *  - nw:terraform-hide-node { id: string }           — hide a node in all layers
 *  - nw:terraform-show-node { id: string }           — restore a hidden node
 *  - nw:terraform-scale-node { id: string, scale: number } — scale a node
 *  - nw:terraform-preset    { preset: TerraformPreset }    — apply a preset layout
 *  - nw:terraform-active    { active: boolean }      — broadcast mode state
 *
 * Events consumed:
 *  - nw:terraform-toggle    — toggle mode on/off
 *  - nw:terraform-screenshot — enter screenshot mode (can be dispatched externally too)
 *  - nw:node-moved          { id, x, z }             — track live node positions
 *  - nw:positions-reset                              — positions reverted
 *
 * NODE SCREEN POSITIONS:
 *  Scale handles use window.__nwNodeScreenPositions (optional integration point).
 *  If not populated by WorldEngine, scale handles are hidden gracefully.
 *
 * VIDEO GAME UX: HUD-style panels, glassmorphic surfaces, animated transitions.
 */

import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
} from 'react'
import { getAllOverrides, setNodePosition, resetAllPositions } from './NodePositionStore'

// ── Types ──────────────────────────────────────────────────────────────────────

export type TerraformPreset = 'Revenue Focus' | 'Project Grid' | 'Timeline'

export interface TerraformNodePos {
  x: number
  z: number
}

export interface TerraformLayout {
  name: string
  savedAt: number
  positions: Record<string, TerraformNodePos>
  hiddenNodes: string[]
  scaleOverrides: Record<string, number>
}

interface NodeRecord {
  id: string
  label: string
  category: 'agent' | 'landmark' | 'project'
  defaultX: number
  defaultZ: number
  revenueRelevant: boolean
}

// ── Static node registry ───────────────────────────────────────────────────────

const STATIC_NODES: NodeRecord[] = [
  { id: 'VAULT',        label: 'VAULT',         category: 'agent',    defaultX: -172, defaultZ:  80,  revenueRelevant: true  },
  { id: 'LEDGER',       label: 'LEDGER',         category: 'agent',    defaultX:  -30, defaultZ:  25,  revenueRelevant: true  },
  { id: 'OHM',          label: 'OHM',            category: 'agent',    defaultX: -165, defaultZ: -110, revenueRelevant: false },
  { id: 'CHRONO',       label: 'CHRONO',         category: 'agent',    defaultX: -105, defaultZ:   0,  revenueRelevant: false },
  { id: 'BLUEPRINT',    label: 'BLUEPRINT',      category: 'agent',    defaultX: -130, defaultZ: -70,  revenueRelevant: false },
  { id: 'SPARK',        label: 'SPARK',          category: 'agent',    defaultX:   60, defaultZ: -120, revenueRelevant: true  },
  { id: 'SCOUT',        label: 'SCOUT',          category: 'agent',    defaultX:  160, defaultZ:   0,  revenueRelevant: true  },
  { id: 'ECHO',         label: 'ECHO',           category: 'agent',    defaultX:  110, defaultZ:  130, revenueRelevant: false },
  { id: 'ATLAS',        label: 'ATLAS',          category: 'agent',    defaultX:   75, defaultZ:  80,  revenueRelevant: true  },
  { id: 'NEXUS',        label: 'NEXUS',          category: 'agent',    defaultX:  110, defaultZ: -60,  revenueRelevant: false },
  { id: 'MTZ_PLATEAU',  label: 'MTZ Solar',      category: 'landmark', defaultX: -175, defaultZ:  160, revenueRelevant: false },
  { id: 'NDA_GATE',     label: 'NDA Gate',       category: 'landmark', defaultX:   25, defaultZ:   0,  revenueRelevant: false },
  { id: 'IP_FORTRESS',  label: 'IP Fortress',    category: 'landmark', defaultX:  190, defaultZ:   0,  revenueRelevant: false },
  { id: 'MRR_MOUNTAIN', label: 'MRR Mountain',   category: 'landmark', defaultX:  100, defaultZ:   0,  revenueRelevant: true  },
  { id: 'OPERATOR',     label: 'OPERATOR',       category: 'landmark', defaultX:    0, defaultZ:   0,  revenueRelevant: false },
]

// ── Preset layout position maps ────────────────────────────────────────────────

/** Revenue Focus: revenue nodes front and center, others hidden */
const PRESET_REVENUE_FOCUS_POSITIONS: Record<string, TerraformNodePos> = {
  VAULT:        { x: -80,  z: -40  },
  LEDGER:       { x:   0,  z: -40  },
  SPARK:        { x:  80,  z: -40  },
  SCOUT:        { x: -40,  z:  40  },
  ATLAS:        { x:  40,  z:  40  },
  MRR_MOUNTAIN: { x:   0,  z: 120  },
}
const PRESET_REVENUE_FOCUS_HIDDEN: string[] = [
  'OHM', 'CHRONO', 'BLUEPRINT', 'ECHO', 'NEXUS',
  'MTZ_PLATEAU', 'NDA_GATE', 'IP_FORTRESS', 'OPERATOR',
]

/** Project Grid: uniform grid, all nodes visible */
const GRID_COLS = 4
const GRID_SPACING_X = 107
const GRID_SPACING_Z = 80
const GRID_ORIGIN_X = -160
const GRID_ORIGIN_Z = -120
const PRESET_GRID_POSITIONS: Record<string, TerraformNodePos> = (() => {
  const out: Record<string, TerraformNodePos> = {}
  STATIC_NODES.forEach((n, i) => {
    const col = i % GRID_COLS
    const row = Math.floor(i / GRID_COLS)
    out[n.id] = {
      x: GRID_ORIGIN_X + col * GRID_SPACING_X,
      z: GRID_ORIGIN_Z + row * GRID_SPACING_Z,
    }
  })
  return out
})()

/** Timeline: left-to-right business flow (pipeline → delivery → billing → growth) */
const PRESET_TIMELINE_POSITIONS: Record<string, TerraformNodePos> = {
  BLUEPRINT:    { x: -200, z:   0 },
  OHM:          { x: -155, z:  40 },
  CHRONO:       { x: -110, z: -30 },
  VAULT:        { x:  -65, z:  30 },
  LEDGER:       { x:  -20, z: -20 },
  SPARK:        { x:   25, z:  40 },
  ATLAS:        { x:   70, z: -30 },
  SCOUT:        { x:  115, z:  30 },
  NEXUS:        { x:  160, z: -20 },
  ECHO:         { x:  200, z:  40 },
  MTZ_PLATEAU:  { x: -200, z:  90 },
  NDA_GATE:     { x:  -65, z:  90 },
  IP_FORTRESS:  { x:  200, z:  90 },
  MRR_MOUNTAIN: { x:   70, z:  90 },
  OPERATOR:     { x:    0, z:  90 },
}

// ── localStorage helpers ───────────────────────────────────────────────────────

const LS_PREFIX = 'nw_terraform_layout_'

function getSavedLayoutNames(): string[] {
  const names: string[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (key && key.startsWith(LS_PREFIX)) {
      names.push(key.slice(LS_PREFIX.length))
    }
  }
  return names.sort()
}

function loadLayout(name: string): TerraformLayout | null {
  try {
    const raw = localStorage.getItem(`${LS_PREFIX}${name}`)
    if (!raw) return null
    return JSON.parse(raw) as TerraformLayout
  } catch {
    return null
  }
}

function saveLayout(layout: TerraformLayout): void {
  try {
    localStorage.setItem(`${LS_PREFIX}${layout.name}`, JSON.stringify(layout))
  } catch {
    console.warn('[TerraformMode] Failed to save layout to localStorage')
  }
}

function deleteLayout(name: string): void {
  try {
    localStorage.removeItem(`${LS_PREFIX}${name}`)
  } catch {
    // non-blocking
  }
}

// ── Design tokens ──────────────────────────────────────────────────────────────

const GLASS_BG      = 'rgba(4, 8, 24, 0.94)'
const CYAN          = '#00e5ff'
const CYAN_DIM      = 'rgba(0,229,255,0.12)'
const CYAN_BORDER   = 'rgba(0,229,255,0.28)'
const CYAN_GLOW     = 'rgba(0,229,255,0.50)'
const GOLD          = '#f59e0b'
const GOLD_DIM      = 'rgba(245,158,11,0.12)'
const GOLD_BORDER   = 'rgba(245,158,11,0.32)'
const RED_COLOR     = '#ef4444'
const RED_DIM       = 'rgba(239,68,68,0.12)'
const RED_BORDER    = 'rgba(239,68,68,0.32)'
const GREEN_COLOR   = '#22c55e'
const GREEN_DIM     = 'rgba(34,197,94,0.12)'
const GREEN_BORDER  = 'rgba(34,197,94,0.32)'
const MONO          = "'JetBrains Mono', 'Fira Mono', 'Courier New', monospace"
const TEXT_DIM      = 'rgba(255,255,255,0.45)'
const TEXT_MID      = 'rgba(255,255,255,0.72)'
const TEXT_BRIGHT   = '#fff'

// ── Utility ────────────────────────────────────────────────────────────────────

function dispatchNW<T extends object>(event: string, detail?: T): void {
  window.dispatchEvent(new CustomEvent(event, detail ? { detail } : undefined))
}

// ── ScaleHandleOverlay ─────────────────────────────────────────────────────────

interface ScaleHandleOverlayProps {
  nodeId: string
  currentScale: number
  screenPos: { x: number; y: number } | null
  onScaleChange: (id: string, scale: number) => void
  onClose: () => void
}

function ScaleHandleOverlay({
  nodeId,
  currentScale,
  screenPos,
  onScaleChange,
  onClose,
}: ScaleHandleOverlayProps) {
  const [scale, setScale] = useState(currentScale)
  const [isDraggingHandle, setIsDraggingHandle] = useState(false)
  const dragStartRef = useRef<{ y: number; scale: number } | null>(null)

  const handleDragStart = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    setIsDraggingHandle(true)
    dragStartRef.current = { y: e.clientY, scale }
  }, [scale])

  useEffect(() => {
    if (!isDraggingHandle) return
    function onMove(e: MouseEvent) {
      if (!dragStartRef.current) return
      const delta = (dragStartRef.current.y - e.clientY) / 120
      const newScale = Math.max(0.3, Math.min(3.0, dragStartRef.current.scale + delta))
      setScale(parseFloat(newScale.toFixed(2)))
    }
    function onUp() {
      setIsDraggingHandle(false)
      onScaleChange(nodeId, scale)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [isDraggingHandle, nodeId, onScaleChange, scale])

  const cx = screenPos?.x ?? window.innerWidth / 2
  const cy = screenPos?.y ?? window.innerHeight / 2
  const PANEL_W = 180
  const PANEL_H = 120

  return (
    <div
      style={{
        position: 'fixed',
        left: Math.min(cx - PANEL_W / 2, window.innerWidth - PANEL_W - 12),
        top: Math.max(cy - PANEL_H - 36, 12),
        width: PANEL_W,
        background: GLASS_BG,
        border: `1px solid ${CYAN_BORDER}`,
        borderRadius: 8,
        padding: '10px 12px',
        zIndex: 500,
        fontFamily: MONO,
        boxShadow: `0 0 24px ${CYAN_GLOW}`,
        userSelect: 'none',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ fontSize: 9, letterSpacing: 2, color: CYAN, textTransform: 'uppercase' }}>
          ◈ SCALE — {nodeId}
        </span>
        <button onClick={onClose} style={closeBtn}>✕</button>
      </div>

      {/* Scale display */}
      <div style={{
        textAlign: 'center',
        fontSize: 22,
        fontWeight: 700,
        color: scale > 1 ? CYAN : scale < 1 ? GOLD : TEXT_BRIGHT,
        marginBottom: 6,
      }}>
        {scale.toFixed(2)}×
      </div>

      {/* Drag handle */}
      <div
        onMouseDown={handleDragStart}
        style={{
          background: isDraggingHandle ? CYAN_DIM : 'rgba(255,255,255,0.04)',
          border: `1px solid ${isDraggingHandle ? CYAN_BORDER : 'rgba(255,255,255,0.15)'}`,
          borderRadius: 5,
          padding: '5px 0',
          textAlign: 'center',
          fontSize: 9,
          letterSpacing: 1.5,
          color: isDraggingHandle ? CYAN : TEXT_DIM,
          cursor: 'ns-resize',
          marginBottom: 8,
          transition: 'all 0.15s',
        }}
      >
        ▲ DRAG TO SCALE ▼
      </div>

      {/* Quick presets */}
      <div style={{ display: 'flex', gap: 5 }}>
        {([0.5, 1.0, 1.5, 2.0] as const).map(v => (
          <button
            key={v}
            onClick={() => { setScale(v); onScaleChange(nodeId, v) }}
            style={{
              flex: 1,
              background: Math.abs(scale - v) < 0.05 ? CYAN_DIM : 'rgba(255,255,255,0.04)',
              border: `1px solid ${Math.abs(scale - v) < 0.05 ? CYAN_BORDER : 'rgba(255,255,255,0.12)'}`,
              borderRadius: 4,
              padding: '3px 0',
              fontSize: 8,
              color: Math.abs(scale - v) < 0.05 ? CYAN : TEXT_DIM,
              cursor: 'pointer',
              fontFamily: MONO,
              transition: 'all 0.12s',
            }}
          >
            {v}×
          </button>
        ))}
      </div>
    </div>
  )
}

// ── HoverHideButton ────────────────────────────────────────────────────────────

interface HoverHideButtonProps {
  nodeId: string
  label: string
  screenPos: { x: number; y: number } | null
  onHide: (id: string) => void
}

function HoverHideButton({ nodeId, label, screenPos, onHide }: HoverHideButtonProps) {
  const [hovered, setHovered] = useState(false)

  if (!screenPos) return null

  return (
    <div
      style={{
        position: 'fixed',
        left: screenPos.x - 10,
        top: screenPos.y - 36,
        zIndex: 490,
        pointerEvents: 'auto',
      }}
    >
      <button
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onClick={() => onHide(nodeId)}
        title={`Hide ${label}`}
        style={{
          width: 20,
          height: 20,
          background: hovered ? RED_DIM : 'rgba(0,0,0,0.6)',
          border: `1px solid ${hovered ? RED_BORDER : 'rgba(255,255,255,0.15)'}`,
          borderRadius: '50%',
          color: hovered ? RED_COLOR : TEXT_DIM,
          fontSize: 9,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'all 0.12s',
          fontFamily: MONO,
          lineHeight: 1,
          padding: 0,
        }}
      >
        ✕
      </button>
    </div>
  )
}

// ── Shared button style ────────────────────────────────────────────────────────

const closeBtn: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: TEXT_DIM,
  cursor: 'pointer',
  fontSize: 11,
  padding: 0,
  lineHeight: 1,
}

// ── Main Component ─────────────────────────────────────────────────────────────

export function TerraformModeLayer() {
  // ── Core state ──────────────────────────────────────────────────────────────
  const [isActive, setIsActive] = useState(false)
  const [screenshotMode, setScreenshotMode] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(true)

  // ── Node management ─────────────────────────────────────────────────────────
  const [hiddenNodes, setHiddenNodes] = useState<Set<string>>(new Set())
  const [scaleOverrides, setScaleOverrides] = useState<Record<string, number>>({})
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [showScaleHandle, setShowScaleHandle] = useState(false)

  // ── Screen positions (populated by WorldEngine if integrated) ───────────────
  const [nodeScreenPositions, setNodeScreenPositions] = useState<Record<string, { x: number; y: number }>>({})
  const screenPosIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // ── Layout management ───────────────────────────────────────────────────────
  const [savedLayoutNames, setSavedLayoutNames] = useState<string[]>([])
  const [saveDialogOpen, setSaveDialogOpen] = useState(false)
  const [newLayoutName, setNewLayoutName] = useState('')
  const [selectedLayoutName, setSelectedLayoutName] = useState('')
  const [activePreset, setActivePreset] = useState<TerraformPreset | null>(null)

  // ── Original positions snapshot (taken on activate) ─────────────────────────
  const originalPositionsRef = useRef<Record<string, { x: number; z: number }>>({})
  const isActiveRef = useRef(false)

  // ── Screenshot timer ────────────────────────────────────────────────────────
  const screenshotTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Poll window.__nwNodeScreenPositions ─────────────────────────────────────
  useEffect(() => {
    if (!isActive) {
      if (screenPosIntervalRef.current) {
        clearInterval(screenPosIntervalRef.current)
        screenPosIntervalRef.current = null
      }
      return
    }
    screenPosIntervalRef.current = setInterval(() => {
      const positions = window.__nwNodeScreenPositions
      if (positions && Object.keys(positions).length > 0) {
        setNodeScreenPositions({ ...positions })
      }
    }, 100)
    return () => {
      if (screenPosIntervalRef.current) {
        clearInterval(screenPosIntervalRef.current)
        screenPosIntervalRef.current = null
      }
    }
  }, [isActive])

  // ── Activate / Deactivate ────────────────────────────────────────────────────

  const activate = useCallback(() => {
    // Snapshot original positions before any edits
    const currentOverrides = getAllOverrides()
    const snapshot: Record<string, { x: number; z: number }> = {}
    STATIC_NODES.forEach(n => {
      if (currentOverrides[n.id]) {
        snapshot[n.id] = { ...currentOverrides[n.id] }
      } else {
        snapshot[n.id] = { x: n.defaultX, z: n.defaultZ }
      }
    })
    originalPositionsRef.current = snapshot

    setIsActive(true)
    isActiveRef.current = true
    setSavedLayoutNames(getSavedLayoutNames())

    // Activate DragDropSystem drag mode
    dispatchNW('nw:edit-layout-active', { active: true })
    // Broadcast mode state
    dispatchNW('nw:terraform-active', { active: true })

    console.info('[TerraformMode] Activated — presentation mode ON')
  }, [])

  const deactivate = useCallback(() => {
    setIsActive(false)
    isActiveRef.current = false

    // Deactivate DragDropSystem drag mode
    dispatchNW('nw:edit-layout-active', { active: false })

    // Restore original positions with smooth animation signal
    dispatchNW('nw:terraform-restore-start', { duration: 1000 })
    resetAllPositions()

    // Restore any hidden nodes
    hiddenNodes.forEach(id => {
      dispatchNW('nw:terraform-show-node', { id })
    })

    // Reset scale overrides
    Object.keys(scaleOverrides).forEach(id => {
      dispatchNW('nw:terraform-scale-node', { id, scale: 1.0 })
    })

    // Clear state
    setHiddenNodes(new Set())
    setScaleOverrides({})
    setSelectedNodeId(null)
    setShowScaleHandle(false)
    setActivePreset(null)
    setScreenshotMode(false)

    dispatchNW('nw:terraform-active', { active: false })
    console.info('[TerraformMode] Deactivated — original positions restored')
  }, [hiddenNodes, scaleOverrides])

  // ── Event listeners ──────────────────────────────────────────────────────────

  useEffect(() => {
    function onToggle() {
      if (isActiveRef.current) {
        deactivate()
      } else {
        activate()
      }
    }

    function onScreenshot() {
      if (!isActiveRef.current) return
      setScreenshotMode(true)
      if (screenshotTimerRef.current) clearTimeout(screenshotTimerRef.current)
      screenshotTimerRef.current = setTimeout(() => {
        setScreenshotMode(false)
        screenshotTimerRef.current = null
      }, 3000)
    }

    function onNodeMoved(e: Event) {
      // Keep track of live node movements (informational — NodePositionStore handles persistence)
      const ev = e as CustomEvent<{ id: string; x: number; z: number }>
      if (!ev.detail) return
      // Forward to scale handle position update if needed
      if (ev.detail.id === selectedNodeId) {
        // Refresh screen positions next poll cycle
      }
    }

    function onPositionsReset() {
      if (!isActiveRef.current) return
      // If someone externally resets positions (e.g. DragDropSystem reset btn),
      // clear our scale/hide overrides too
      setScaleOverrides({})
    }

    window.addEventListener('nw:terraform-toggle', onToggle)
    window.addEventListener('nw:terraform-screenshot', onScreenshot)
    window.addEventListener('nw:node-moved', onNodeMoved)
    window.addEventListener('nw:positions-reset', onPositionsReset)

    return () => {
      window.removeEventListener('nw:terraform-toggle', onToggle)
      window.removeEventListener('nw:terraform-screenshot', onScreenshot)
      window.removeEventListener('nw:node-moved', onNodeMoved)
      window.removeEventListener('nw:positions-reset', onPositionsReset)
      if (screenshotTimerRef.current) clearTimeout(screenshotTimerRef.current)
    }
  }, [activate, deactivate, selectedNodeId])

  // ── Hide / Unhide ────────────────────────────────────────────────────────────

  const hideNode = useCallback((id: string) => {
    setHiddenNodes(prev => {
      const next = new Set(prev)
      next.add(id)
      return next
    })
    dispatchNW('nw:terraform-hide-node', { id })
    setHoveredNodeId(null)
    if (selectedNodeId === id) {
      setSelectedNodeId(null)
      setShowScaleHandle(false)
    }
  }, [selectedNodeId])

  const showNode = useCallback((id: string) => {
    setHiddenNodes(prev => {
      const next = new Set(prev)
      next.delete(id)
      return next
    })
    dispatchNW('nw:terraform-show-node', { id })
  }, [])

  // ── Scale changes ────────────────────────────────────────────────────────────

  const handleScaleChange = useCallback((id: string, scale: number) => {
    setScaleOverrides(prev => ({ ...prev, [id]: scale }))
    dispatchNW('nw:terraform-scale-node', { id, scale })
  }, [])

  // ── Layout save ──────────────────────────────────────────────────────────────

  const handleSaveLayout = useCallback(() => {
    const name = newLayoutName.trim()
    if (!name) return
    const layout: TerraformLayout = {
      name,
      savedAt: Date.now(),
      positions: getAllOverrides(),
      hiddenNodes: Array.from(hiddenNodes),
      scaleOverrides: { ...scaleOverrides },
    }
    saveLayout(layout)
    setSavedLayoutNames(getSavedLayoutNames())
    setSaveDialogOpen(false)
    setNewLayoutName('')
    setSelectedLayoutName(name)
  }, [newLayoutName, hiddenNodes, scaleOverrides])

  // ── Layout load ──────────────────────────────────────────────────────────────

  const handleLoadLayout = useCallback((name: string) => {
    const layout = loadLayout(name)
    if (!layout) return

    // Apply positions
    Object.entries(layout.positions).forEach(([id, pos]) => {
      setNodePosition(id, pos.x, pos.z)
    })

    // Apply hidden nodes
    const newHidden = new Set<string>(layout.hiddenNodes)
    // Restore previously hidden nodes not in new layout
    hiddenNodes.forEach(id => {
      if (!newHidden.has(id)) dispatchNW('nw:terraform-show-node', { id })
    })
    // Hide nodes in new layout
    newHidden.forEach(id => {
      if (!hiddenNodes.has(id)) dispatchNW('nw:terraform-hide-node', { id })
    })
    setHiddenNodes(newHidden)

    // Apply scales
    Object.entries(layout.scaleOverrides).forEach(([id, scale]) => {
      dispatchNW('nw:terraform-scale-node', { id, scale })
    })
    setScaleOverrides({ ...layout.scaleOverrides })

    setSelectedLayoutName(name)
    setActivePreset(null)
  }, [hiddenNodes])

  // ── Layout delete ────────────────────────────────────────────────────────────

  const handleDeleteLayout = useCallback((name: string) => {
    deleteLayout(name)
    setSavedLayoutNames(getSavedLayoutNames())
    if (selectedLayoutName === name) setSelectedLayoutName('')
  }, [selectedLayoutName])

  // ── Preset layouts ───────────────────────────────────────────────────────────

  const applyPreset = useCallback((preset: TerraformPreset) => {
    // Restore all hidden nodes first
    hiddenNodes.forEach(id => dispatchNW('nw:terraform-show-node', { id }))

    let positions: Record<string, TerraformNodePos> = {}
    let hidden: string[] = []

    if (preset === 'Revenue Focus') {
      positions = PRESET_REVENUE_FOCUS_POSITIONS
      hidden = PRESET_REVENUE_FOCUS_HIDDEN
    } else if (preset === 'Project Grid') {
      positions = PRESET_GRID_POSITIONS
      hidden = []
    } else if (preset === 'Timeline') {
      positions = PRESET_TIMELINE_POSITIONS
      hidden = []
    }

    // Apply positions
    Object.entries(positions).forEach(([id, pos]) => {
      setNodePosition(id, pos.x, pos.z)
    })

    // Apply hidden
    const newHidden = new Set<string>(hidden)
    newHidden.forEach(id => dispatchNW('nw:terraform-hide-node', { id }))
    setHiddenNodes(newHidden)

    // Reset scale overrides for a clean preset
    Object.keys(scaleOverrides).forEach(id => {
      dispatchNW('nw:terraform-scale-node', { id, scale: 1.0 })
    })
    setScaleOverrides({})

    setActivePreset(preset)
    setSelectedLayoutName('')

    dispatchNW('nw:terraform-preset', { preset })
  }, [hiddenNodes, scaleOverrides])

  // ── Screenshot trigger ───────────────────────────────────────────────────────

  const triggerScreenshot = useCallback(() => {
    dispatchNW('nw:terraform-screenshot')
    // The event listener above will handle the state change
  }, [])

  // ── Node hover tracking for hide button ──────────────────────────────────────

  const handleNodeHover = useCallback((id: string | null) => {
    setHoveredNodeId(id)
  }, [])

  // ── Node selection for scale handle ─────────────────────────────────────────

  const handleNodeSelect = useCallback((id: string) => {
    if (selectedNodeId === id && showScaleHandle) {
      setShowScaleHandle(false)
      setSelectedNodeId(null)
    } else {
      setSelectedNodeId(id)
      setShowScaleHandle(true)
    }
  }, [selectedNodeId, showScaleHandle])

  // ── Render ───────────────────────────────────────────────────────────────────

  if (!isActive) return null

  // Screenshot mode: hide all UI for clean render
  if (screenshotMode) {
    return (
      <div
        style={{
          position: 'fixed',
          bottom: 20,
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 600,
          fontFamily: MONO,
          fontSize: 9,
          letterSpacing: 2,
          color: 'rgba(0,229,255,0.4)',
          pointerEvents: 'none',
          animation: 'terraform-fade-in 0.3s ease',
        }}
      >
        ◈ CLEAN RENDER — RESUMING IN 3s
      </div>
    )
  }

  const visibleNodes = STATIC_NODES.filter(n => !hiddenNodes.has(n.id))
  const hiddenNodesList = STATIC_NODES.filter(n => hiddenNodes.has(n.id))

  return (
    <>
      {/* ── CSS keyframes ──────────────────────────────────────────────────────── */}
      <style>{`
        @keyframes terraform-fade-in {
          from { opacity: 0; transform: translateX(-50%) translateY(8px); }
          to   { opacity: 1; transform: translateX(-50%) translateY(0); }
        }
        @keyframes terraform-pulse-border {
          0%, 100% { box-shadow: 0 0 0 0 rgba(0,229,255,0); }
          50%       { box-shadow: 0 0 0 3px rgba(0,229,255,0.18); }
        }
        @keyframes terraform-slide-in-right {
          from { opacity: 0; transform: translateX(24px); }
          to   { opacity: 1; transform: translateX(0); }
        }
        @keyframes terraform-tag-appear {
          from { opacity: 0; transform: scale(0.85); }
          to   { opacity: 1; transform: scale(1); }
        }
      `}</style>

      {/* ── Top HUD banner ────────────────────────────────────────────────────── */}
      <div
        style={{
          position: 'fixed',
          top: 14,
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 600,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 6,
          animation: 'terraform-fade-in 0.4s ease',
          pointerEvents: 'none',
        }}
      >
        {/* Mode label */}
        <div style={{
          background: GLASS_BG,
          border: `1px solid ${CYAN_BORDER}`,
          borderRadius: 6,
          padding: '5px 20px',
          fontSize: 10,
          letterSpacing: 3,
          color: CYAN,
          boxShadow: `0 0 24px ${CYAN_GLOW}`,
          fontFamily: MONO,
          pointerEvents: 'none',
          animation: 'terraform-pulse-border 3s ease-in-out infinite',
        }}>
          ◈ TERRAFORM MODE — PRESENTATION ACTIVE
        </div>

        {/* Sub-label hints */}
        <div style={{
          display: 'flex',
          gap: 12,
          fontSize: 8,
          letterSpacing: 1.5,
          color: TEXT_DIM,
          fontFamily: MONO,
          pointerEvents: 'none',
        }}>
          <span>DRAG NODES TO REPOSITION</span>
          <span style={{ color: 'rgba(255,255,255,0.2)' }}>|</span>
          <span>HOVER NODE → HIDE</span>
          <span style={{ color: 'rgba(255,255,255,0.2)' }}>|</span>
          <span>CLICK NODE → SCALE</span>
        </div>
      </div>

      {/* ── Right sidebar ─────────────────────────────────────────────────────── */}
      <div
        style={{
          position: 'fixed',
          top: '50%',
          right: 0,
          transform: 'translateY(-50%)',
          zIndex: 580,
          animation: 'terraform-slide-in-right 0.4s ease',
        }}
      >
        {/* Sidebar toggle tab */}
        <button
          onClick={() => setSidebarOpen(o => !o)}
          style={{
            position: 'absolute',
            top: '50%',
            right: sidebarOpen ? 280 : 0,
            transform: 'translateY(-50%)',
            background: GLASS_BG,
            border: `1px solid ${CYAN_BORDER}`,
            borderRight: sidebarOpen ? `1px solid ${CYAN_BORDER}` : 'none',
            borderRadius: sidebarOpen ? '5px 0 0 5px' : '5px 0 0 5px',
            padding: '14px 5px',
            cursor: 'pointer',
            color: CYAN,
            fontSize: 9,
            fontFamily: MONO,
            letterSpacing: 1,
            writingMode: 'vertical-rl',
            transition: 'right 0.2s ease',
            zIndex: 581,
          }}
        >
          {sidebarOpen ? '▶ CLOSE' : '◀ TERRAFORM'}
        </button>

        {/* Sidebar panel */}
        {sidebarOpen && (
          <div
            style={{
              width: 280,
              maxHeight: '80vh',
              background: GLASS_BG,
              border: `1px solid ${CYAN_BORDER}`,
              borderRight: 'none',
              borderRadius: '10px 0 0 10px',
              display: 'flex',
              flexDirection: 'column',
              overflowY: 'auto',
              fontFamily: MONO,
              boxShadow: `-8px 0 32px rgba(0,0,0,0.6)`,
            }}
          >
            {/* ── Section: Preset layouts ─────────────────────────────────── */}
            <SidebarSection label="PRESET LAYOUTS">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                {(['Revenue Focus', 'Project Grid', 'Timeline'] as TerraformPreset[]).map(p => (
                  <button
                    key={p}
                    onClick={() => applyPreset(p)}
                    style={{
                      background: activePreset === p ? CYAN_DIM : 'rgba(255,255,255,0.03)',
                      border: `1px solid ${activePreset === p ? CYAN_BORDER : 'rgba(255,255,255,0.1)'}`,
                      borderRadius: 5,
                      padding: '7px 10px',
                      textAlign: 'left',
                      cursor: 'pointer',
                      fontFamily: MONO,
                      color: activePreset === p ? CYAN : TEXT_MID,
                      fontSize: 10,
                      letterSpacing: 1,
                      transition: 'all 0.15s',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                    }}
                  >
                    <span>
                      {p === 'Revenue Focus' && '💰 '}
                      {p === 'Project Grid'  && '⊞ '}
                      {p === 'Timeline'      && '→ '}
                      {p}
                    </span>
                    {activePreset === p && (
                      <span style={{ fontSize: 7, color: CYAN, letterSpacing: 1.5 }}>ACTIVE</span>
                    )}
                  </button>
                ))}
              </div>
              <div style={{ fontSize: 8, color: TEXT_DIM, marginTop: 5, lineHeight: 1.6 }}>
                {activePreset === 'Revenue Focus' && 'Showing revenue-critical nodes only.'}
                {activePreset === 'Project Grid'  && 'Even grid — all nodes visible.'}
                {activePreset === 'Timeline'      && 'Pipeline → delivery → billing order.'}
                {!activePreset && 'Select a preset to rearrange the world.'}
              </div>
            </SidebarSection>

            <SidebarDivider />

            {/* ── Section: Saved layouts ──────────────────────────────────── */}
            <SidebarSection label="SAVED LAYOUTS">
              {savedLayoutNames.length === 0 ? (
                <div style={{ fontSize: 9, color: TEXT_DIM, fontStyle: 'italic' }}>
                  No saved layouts yet.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 8 }}>
                  {savedLayoutNames.map(name => (
                    <div
                      key={name}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        background: selectedLayoutName === name ? CYAN_DIM : 'transparent',
                        border: `1px solid ${selectedLayoutName === name ? CYAN_BORDER : 'rgba(255,255,255,0.06)'}`,
                        borderRadius: 5,
                        padding: '4px 8px',
                      }}
                    >
                      <button
                        onClick={() => handleLoadLayout(name)}
                        style={{
                          flex: 1,
                          background: 'none',
                          border: 'none',
                          color: selectedLayoutName === name ? CYAN : TEXT_MID,
                          fontSize: 10,
                          cursor: 'pointer',
                          textAlign: 'left',
                          fontFamily: MONO,
                          padding: 0,
                          letterSpacing: 0.5,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                        title={`Load layout "${name}"`}
                      >
                        {selectedLayoutName === name ? '▶ ' : '  '}{name}
                      </button>
                      <button
                        onClick={() => handleDeleteLayout(name)}
                        title="Delete layout"
                        style={{
                          background: 'none',
                          border: 'none',
                          color: 'rgba(239,68,68,0.5)',
                          cursor: 'pointer',
                          fontSize: 9,
                          padding: 0,
                          fontFamily: MONO,
                          flexShrink: 0,
                        }}
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Save current layout */}
              {saveDialogOpen ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <input
                    type="text"
                    value={newLayoutName}
                    onChange={e => setNewLayoutName(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') handleSaveLayout() }}
                    placeholder="Layout name..."
                    autoFocus
                    maxLength={40}
                    style={{
                      background: 'rgba(255,255,255,0.05)',
                      border: `1px solid ${CYAN_BORDER}`,
                      borderRadius: 5,
                      padding: '5px 8px',
                      color: TEXT_BRIGHT,
                      fontFamily: MONO,
                      fontSize: 10,
                      outline: 'none',
                      width: '100%',
                      boxSizing: 'border-box',
                    }}
                  />
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button
                      onClick={handleSaveLayout}
                      disabled={!newLayoutName.trim()}
                      style={{
                        flex: 1,
                        background: newLayoutName.trim() ? CYAN_DIM : 'rgba(255,255,255,0.03)',
                        border: `1px solid ${newLayoutName.trim() ? CYAN_BORDER : 'rgba(255,255,255,0.1)'}`,
                        borderRadius: 5,
                        padding: '5px 0',
                        color: newLayoutName.trim() ? CYAN : TEXT_DIM,
                        cursor: newLayoutName.trim() ? 'pointer' : 'not-allowed',
                        fontFamily: MONO,
                        fontSize: 9,
                        letterSpacing: 1.5,
                      }}
                    >
                      SAVE
                    </button>
                    <button
                      onClick={() => { setSaveDialogOpen(false); setNewLayoutName('') }}
                      style={{
                        background: 'rgba(255,255,255,0.03)',
                        border: '1px solid rgba(255,255,255,0.1)',
                        borderRadius: 5,
                        padding: '5px 10px',
                        color: TEXT_DIM,
                        cursor: 'pointer',
                        fontFamily: MONO,
                        fontSize: 9,
                      }}
                    >
                      CANCEL
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setSaveDialogOpen(true)}
                  style={{
                    width: '100%',
                    background: GOLD_DIM,
                    border: `1px solid ${GOLD_BORDER}`,
                    borderRadius: 5,
                    padding: '6px 0',
                    color: GOLD,
                    cursor: 'pointer',
                    fontFamily: MONO,
                    fontSize: 9,
                    letterSpacing: 1.5,
                    transition: 'all 0.15s',
                  }}
                >
                  + SAVE CURRENT LAYOUT
                </button>
              )}
            </SidebarSection>

            <SidebarDivider />

            {/* ── Section: Hidden elements ────────────────────────────────── */}
            <SidebarSection label={`HIDDEN (${hiddenNodesList.length})`}>
              {hiddenNodesList.length === 0 ? (
                <div style={{ fontSize: 9, color: TEXT_DIM, fontStyle: 'italic' }}>
                  No hidden elements. Hover a node and click ✕ to hide.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {hiddenNodesList.map(n => (
                    <div
                      key={n.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        background: 'rgba(255,255,255,0.03)',
                        border: '1px solid rgba(255,255,255,0.07)',
                        borderRadius: 5,
                        padding: '5px 8px',
                        animation: 'terraform-tag-appear 0.2s ease',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontSize: 7, color: RED_COLOR }}>◉</span>
                        <span style={{ fontSize: 10, color: TEXT_MID, letterSpacing: 0.5 }}>{n.label}</span>
                        <span style={{ fontSize: 7, color: TEXT_DIM }}>{n.category}</span>
                      </div>
                      <button
                        onClick={() => showNode(n.id)}
                        title={`Restore ${n.label}`}
                        style={{
                          background: GREEN_DIM,
                          border: `1px solid ${GREEN_BORDER}`,
                          borderRadius: 4,
                          padding: '2px 7px',
                          color: GREEN_COLOR,
                          cursor: 'pointer',
                          fontFamily: MONO,
                          fontSize: 8,
                          letterSpacing: 1,
                        }}
                      >
                        RESTORE
                      </button>
                    </div>
                  ))}
                  <button
                    onClick={() => {
                      hiddenNodesList.forEach(n => showNode(n.id))
                    }}
                    style={{
                      width: '100%',
                      background: GREEN_DIM,
                      border: `1px solid ${GREEN_BORDER}`,
                      borderRadius: 5,
                      padding: '5px 0',
                      color: GREEN_COLOR,
                      cursor: 'pointer',
                      fontFamily: MONO,
                      fontSize: 8,
                      letterSpacing: 1.5,
                      marginTop: 4,
                    }}
                  >
                    RESTORE ALL
                  </button>
                </div>
              )}
            </SidebarSection>

            <SidebarDivider />

            {/* ── Section: Node visibility toggles ───────────────────────── */}
            <SidebarSection label="ALL NODES">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                {STATIC_NODES.map(n => {
                  const isHidden = hiddenNodes.has(n.id)
                  const scale = scaleOverrides[n.id] ?? 1.0
                  return (
                    <div
                      key={n.id}
                      onMouseEnter={() => handleNodeHover(n.id)}
                      onMouseLeave={() => handleNodeHover(null)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '4px 6px',
                        borderRadius: 5,
                        background: hoveredNodeId === n.id
                          ? 'rgba(0,229,255,0.06)'
                          : 'transparent',
                        transition: 'background 0.12s',
                        cursor: 'default',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1 }}>
                        <span style={{
                          width: 6,
                          height: 6,
                          borderRadius: '50%',
                          background: isHidden ? RED_COLOR : (n.revenueRelevant ? GOLD : CYAN),
                          flexShrink: 0,
                          opacity: isHidden ? 0.4 : 1,
                        }} />
                        <span style={{
                          fontSize: 9,
                          color: isHidden ? TEXT_DIM : TEXT_MID,
                          letterSpacing: 0.5,
                          textDecoration: isHidden ? 'line-through' : 'none',
                          flex: 1,
                        }}>
                          {n.label}
                        </span>
                        {scale !== 1.0 && (
                          <span style={{ fontSize: 7, color: CYAN, letterSpacing: 0.5 }}>
                            {scale.toFixed(1)}×
                          </span>
                        )}
                      </div>
                      <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                        {/* Scale button */}
                        <button
                          onClick={() => handleNodeSelect(n.id)}
                          title={`Scale ${n.label}`}
                          style={{
                            background: selectedNodeId === n.id ? CYAN_DIM : 'none',
                            border: `1px solid ${selectedNodeId === n.id ? CYAN_BORDER : 'transparent'}`,
                            borderRadius: 3,
                            padding: '1px 5px',
                            color: selectedNodeId === n.id ? CYAN : TEXT_DIM,
                            cursor: 'pointer',
                            fontFamily: MONO,
                            fontSize: 8,
                            transition: 'all 0.12s',
                          }}
                        >
                          ⤢
                        </button>
                        {/* Hide/show button */}
                        <button
                          onClick={() => isHidden ? showNode(n.id) : hideNode(n.id)}
                          title={isHidden ? `Show ${n.label}` : `Hide ${n.label}`}
                          style={{
                            background: isHidden ? GREEN_DIM : 'none',
                            border: `1px solid ${isHidden ? GREEN_BORDER : 'transparent'}`,
                            borderRadius: 3,
                            padding: '1px 5px',
                            color: isHidden ? GREEN_COLOR : TEXT_DIM,
                            cursor: 'pointer',
                            fontFamily: MONO,
                            fontSize: 8,
                            transition: 'all 0.12s',
                          }}
                        >
                          {isHidden ? '◎' : '✕'}
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </SidebarSection>

            <SidebarDivider />

            {/* ── Section: Actions ────────────────────────────────────────── */}
            <SidebarSection label="ACTIONS">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {/* Screenshot */}
                <button
                  onClick={triggerScreenshot}
                  style={{
                    background: 'rgba(255,255,255,0.04)',
                    border: '1px solid rgba(255,255,255,0.14)',
                    borderRadius: 5,
                    padding: '7px 10px',
                    color: TEXT_MID,
                    cursor: 'pointer',
                    fontFamily: MONO,
                    fontSize: 9,
                    letterSpacing: 1.5,
                    textAlign: 'left',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    transition: 'all 0.15s',
                  }}
                >
                  <span style={{ fontSize: 12 }}>📷</span>
                  CLEAN SCREENSHOT (3s)
                </button>

                {/* Reset layout */}
                <button
                  onClick={() => {
                    resetAllPositions()
                    hiddenNodes.forEach(id => dispatchNW('nw:terraform-show-node', { id }))
                    setHiddenNodes(new Set())
                    Object.keys(scaleOverrides).forEach(id =>
                      dispatchNW('nw:terraform-scale-node', { id, scale: 1.0 })
                    )
                    setScaleOverrides({})
                    setActivePreset(null)
                    setSelectedLayoutName('')
                  }}
                  style={{
                    background: RED_DIM,
                    border: `1px solid ${RED_BORDER}`,
                    borderRadius: 5,
                    padding: '7px 10px',
                    color: RED_COLOR,
                    cursor: 'pointer',
                    fontFamily: MONO,
                    fontSize: 9,
                    letterSpacing: 1.5,
                    textAlign: 'left',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    transition: 'all 0.15s',
                  }}
                >
                  <span>↺</span>
                  RESET TO DEFAULT
                </button>

                {/* Exit terraform mode */}
                <button
                  onClick={deactivate}
                  style={{
                    background: 'rgba(255,255,255,0.03)',
                    border: `1px solid rgba(255,255,255,0.15)`,
                    borderRadius: 5,
                    padding: '7px 10px',
                    color: TEXT_DIM,
                    cursor: 'pointer',
                    fontFamily: MONO,
                    fontSize: 9,
                    letterSpacing: 1.5,
                    textAlign: 'left',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    transition: 'all 0.15s',
                  }}
                >
                  <span>✕</span>
                  EXIT TERRAFORM MODE
                </button>
              </div>
            </SidebarSection>

            {/* Active layout label */}
            {(activePreset || selectedLayoutName) && (
              <div style={{
                padding: '8px 14px',
                borderTop: '1px solid rgba(255,255,255,0.06)',
                fontSize: 8,
                color: TEXT_DIM,
                letterSpacing: 1,
                fontFamily: MONO,
              }}>
                ACTIVE: {activePreset ?? selectedLayoutName}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Visible node count indicator ──────────────────────────────────────── */}
      <div
        style={{
          position: 'fixed',
          bottom: 20,
          left: 20,
          zIndex: 570,
          fontFamily: MONO,
          fontSize: 8,
          letterSpacing: 1.5,
          color: TEXT_DIM,
          display: 'flex',
          gap: 12,
          pointerEvents: 'none',
        }}
      >
        <span>
          <span style={{ color: CYAN }}>◉</span> VISIBLE: {visibleNodes.length}
        </span>
        <span>
          <span style={{ color: RED_COLOR }}>◉</span> HIDDEN: {hiddenNodesList.length}
        </span>
        {Object.keys(scaleOverrides).length > 0 && (
          <span>
            <span style={{ color: GOLD }}>◉</span> SCALED: {Object.keys(scaleOverrides).length}
          </span>
        )}
      </div>

      {/* ── Scale handle overlay (for selected node) ──────────────────────────── */}
      {showScaleHandle && selectedNodeId && (
        <ScaleHandleOverlay
          nodeId={selectedNodeId}
          currentScale={scaleOverrides[selectedNodeId] ?? 1.0}
          screenPos={nodeScreenPositions[selectedNodeId] ?? null}
          onScaleChange={handleScaleChange}
          onClose={() => { setShowScaleHandle(false); setSelectedNodeId(null) }}
        />
      )}

      {/* ── Hover hide buttons (for nodes with known screen positions) ───────────  */}
      {hoveredNodeId &&
        !hiddenNodes.has(hoveredNodeId) &&
        nodeScreenPositions[hoveredNodeId] && (
          <HoverHideButton
            nodeId={hoveredNodeId}
            label={STATIC_NODES.find(n => n.id === hoveredNodeId)?.label ?? hoveredNodeId}
            screenPos={nodeScreenPositions[hoveredNodeId] ?? null}
            onHide={hideNode}
          />
        )}
    </>
  )
}

// ── Sidebar sub-components ─────────────────────────────────────────────────────

interface SidebarSectionProps {
  label: string
  children: React.ReactNode
}

function SidebarSection({ label, children }: SidebarSectionProps) {
  return (
    <div style={{ padding: '12px 14px' }}>
      <div style={{
        fontSize: 7,
        letterSpacing: 2.5,
        color: CYAN,
        fontFamily: MONO,
        marginBottom: 10,
        opacity: 0.7,
        textTransform: 'uppercase',
      }}>
        {label}
      </div>
      {children}
    </div>
  )
}

function SidebarDivider() {
  return (
    <div style={{
      height: 1,
      background: 'rgba(0,229,255,0.08)',
      margin: '0 14px',
      flexShrink: 0,
    }} />
  )
}

// ── Global type extension ──────────────────────────────────────────────────────

declare global {
  interface Window {
    /**
     * Optional integration point: WorldEngine or NodeClickSystem can populate
     * this map each frame with projected 2D screen coordinates of each node.
     * Key: node ID (e.g. 'VAULT', 'LEDGER', 'P_<projectId>')
     * Value: { x: number, y: number } in viewport pixels
     *
     * TerraformModeLayer polls this map to position scale handles and hide buttons.
     * If not populated, those overlays are hidden gracefully.
     */
    __nwNodeScreenPositions?: Record<string, { x: number; y: number }>
  }
}
