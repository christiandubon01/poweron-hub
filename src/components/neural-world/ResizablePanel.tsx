/**
 * ResizablePanel.tsx — B73: Universal resizable + draggable panel wrapper.
 *
 * Features:
 *  - 8 resize handles: N, S, E, W edges (8px hit zone) + NW, NE, SW, SE corners (12px hit zone)
 *  - Drag-to-move via transparent overlay on title bar area
 *  - Proportional content zoom: transform: scale(currentW / defaultWidth)
 *  - Min: 200×150px  Max: 80% viewport
 *  - localStorage persistence per panelKey
 *  - No conflict: title bar drag vs. edge/corner resize (handles take priority)
 *
 * Usage:
 *   <ResizablePanel panelKey="my-panel" defaultWidth={400} defaultHeight={480}>
 *     {children with their own title bar}
 *   </ResizablePanel>
 */

import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'

// ── Types ──────────────────────────────────────────────────────────────────────

type ResizeDir = 'n' | 's' | 'e' | 'w' | 'nw' | 'ne' | 'sw' | 'se'

interface PanelSize   { w: number; h: number }
interface PanelPos    { x: number; y: number }

interface ResizablePanelProps {
  /** Unique key for localStorage (e.g. "resonance-breakdown") */
  panelKey: string
  /** Natural (default) content width in px */
  defaultWidth: number
  /** Natural (default) container height in px */
  defaultHeight: number
  /** Height of the title-bar drag zone in px (default 44) */
  titleBarHeight?: number
  /** Extra style overrides for the outer container */
  containerStyle?: React.CSSProperties
  /** z-index for the outer container (default 60) */
  zIndex?: number
  /** Initial position when no localStorage value exists (omit for viewport-centered) */
  initialPos?: PanelPos
  children: React.ReactNode
}

// ── Storage helpers ────────────────────────────────────────────────────────────

function loadSize(key: string, dw: number, dh: number): PanelSize {
  try {
    const raw = localStorage.getItem(`nw_panel_size_${key}`)
    if (raw) {
      const p = JSON.parse(raw) as PanelSize
      if (typeof p.w === 'number' && typeof p.h === 'number') return p
    }
  } catch { /* ignore */ }
  return { w: dw, h: dh }
}

function loadPos(key: string): PanelPos | null {
  try {
    const raw = localStorage.getItem(`nw_panel_pos_${key}`)
    if (raw) {
      const p = JSON.parse(raw) as PanelPos
      if (typeof p.x === 'number' && typeof p.y === 'number') return p
    }
  } catch { /* ignore */ }
  return null
}

function saveSize(key: string, size: PanelSize) {
  try { localStorage.setItem(`nw_panel_size_${key}`, JSON.stringify(size)) } catch { /* ignore */ }
}

function savePos(key: string, pos: PanelPos) {
  try { localStorage.setItem(`nw_panel_pos_${key}`, JSON.stringify(pos)) } catch { /* ignore */ }
}

// ── Cursor map ─────────────────────────────────────────────────────────────────

const CURSOR_MAP: Record<ResizeDir, string> = {
  n:  'ns-resize',
  s:  'ns-resize',
  e:  'ew-resize',
  w:  'ew-resize',
  nw: 'nwse-resize',
  se: 'nwse-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
}

// ── Component ──────────────────────────────────────────────────────────────────

export function ResizablePanel({
  panelKey,
  defaultWidth,
  defaultHeight,
  titleBarHeight = 44,
  containerStyle = {},
  zIndex = 60,
  initialPos,
  children,
}: ResizablePanelProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  const [size, setSize] = useState<PanelSize>(() =>
    loadSize(panelKey, defaultWidth, defaultHeight))
  const [pos, setPos]   = useState<PanelPos | null>(() => loadPos(panelKey) ?? initialPos ?? null)

  // Refs to avoid stale closures during mouse events
  const sizeRef = useRef(size)
  const posRef  = useRef<PanelPos | null>(pos)
  useEffect(() => { sizeRef.current = size }, [size])
  useEffect(() => { posRef.current  = pos  }, [pos])

  const interactionRef = useRef<{
    type: 'drag' | 'resize'
    dir?: ResizeDir
    startMouseX: number
    startMouseY: number
    startW: number
    startH: number
    startX: number
    startY: number
  } | null>(null)

  const MIN_W = 200
  const MIN_H = 150

  // ── Get effective position (for absolute layout) ───────────────────────────
  function getEffectivePos(): PanelPos {
    if (posRef.current) return posRef.current
    // Default: center of viewport — compute from containerRef if mounted
    const el = containerRef.current
    if (el) {
      const rect = el.getBoundingClientRect()
      return { x: rect.left, y: rect.top }
    }
    return { x: Math.round(window.innerWidth  / 2 - sizeRef.current.w / 2),
             y: Math.round(window.innerHeight / 2 - sizeRef.current.h / 2) }
  }

  // ── Mouse event handlers ───────────────────────────────────────────────────

  const onMouseMove = useCallback((e: MouseEvent) => {
    const ia = interactionRef.current
    if (!ia) return
    e.preventDefault()

    const dx = e.clientX - ia.startMouseX
    const dy = e.clientY - ia.startMouseY
    const maxW = Math.floor(window.innerWidth  * 0.8)
    const maxH = Math.floor(window.innerHeight * 0.8)

    if (ia.type === 'drag') {
      const nx = Math.max(0, Math.min(window.innerWidth  - sizeRef.current.w, ia.startX + dx))
      const ny = Math.max(0, Math.min(window.innerHeight - sizeRef.current.h, ia.startY + dy))
      const newPos = { x: nx, y: ny }
      setPos(newPos)
      savePos(panelKey, newPos)
    } else if (ia.type === 'resize') {
      let nw = ia.startW
      let nh = ia.startH
      let nx = ia.startX
      let ny = ia.startY

      const dir = ia.dir!
      if (dir.includes('e')) nw = Math.max(MIN_W, Math.min(maxW, ia.startW + dx))
      if (dir.includes('s')) nh = Math.max(MIN_H, Math.min(maxH, ia.startH + dy))
      if (dir.includes('w')) {
        const dw = Math.min(ia.startW - MIN_W, Math.max(ia.startW - maxW, dx))
        nw = ia.startW - dw
        nx = ia.startX + dw
      }
      if (dir.includes('n')) {
        const dh = Math.min(ia.startH - MIN_H, Math.max(ia.startH - maxH, dy))
        nh = ia.startH - dh
        ny = ia.startY + dh
      }

      const newSize = { w: nw, h: nh }
      const newPos  = { x: nx, y: ny }
      setSize(newSize)
      setPos(newPos)
      saveSize(panelKey, newSize)
      savePos(panelKey, newPos)
    }
  }, [panelKey])

  const onMouseUp = useCallback(() => {
    interactionRef.current = null
    document.body.style.userSelect = ''
    document.body.style.cursor     = ''
  }, [])

  useEffect(() => {
    window.addEventListener('mousemove', onMouseMove, { passive: false })
    window.addEventListener('mouseup',   onMouseUp)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup',   onMouseUp)
    }
  }, [onMouseMove, onMouseUp])

  // ── Start drag (title bar) ─────────────────────────────────────────────────
  const startDrag = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const ep = getEffectivePos()
    // Materialize position so the element goes into absolute-left/top mode
    if (!posRef.current) {
      setPos(ep)
      savePos(panelKey, ep)
    }
    interactionRef.current = {
      type:        'drag',
      startMouseX: e.clientX,
      startMouseY: e.clientY,
      startW:      sizeRef.current.w,
      startH:      sizeRef.current.h,
      startX:      ep.x,
      startY:      ep.y,
    }
    document.body.style.userSelect = 'none'
    document.body.style.cursor     = 'move'
  }, [panelKey]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Start resize ───────────────────────────────────────────────────────────
  const startResize = useCallback((e: React.MouseEvent, dir: ResizeDir) => {
    e.preventDefault()
    e.stopPropagation()
    const ep = getEffectivePos()
    if (!posRef.current) {
      setPos(ep)
      savePos(panelKey, ep)
    }
    interactionRef.current = {
      type:        'resize',
      dir,
      startMouseX: e.clientX,
      startMouseY: e.clientY,
      startW:      sizeRef.current.w,
      startH:      sizeRef.current.h,
      startX:      ep.x,
      startY:      ep.y,
    }
    document.body.style.userSelect = 'none'
    document.body.style.cursor     = CURSOR_MAP[dir]
  }, [panelKey]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Computed values ────────────────────────────────────────────────────────
  const scale = size.w / defaultWidth

  const outerStyle: React.CSSProperties = {
    position:   'absolute',
    width:      size.w,
    height:     size.h,
    overflow:   'hidden',
    zIndex,
    ...containerStyle,
    // Positioning: prefer explicit pos; fall back to CSS centering
    ...(pos
      ? { left: pos.x, top: pos.y, transform: 'none' }
      : { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }),
  }

  const innerStyle: React.CSSProperties = {
    width:           defaultWidth,
    minHeight:       defaultHeight,
    transformOrigin: 'top left',
    transform:       `scale(${scale})`,
    pointerEvents:   'all',
  }

  // ── Resize handle factory ──────────────────────────────────────────────────
  function handle(dir: ResizeDir) {
    const isCorner = dir.length === 2
    const s: React.CSSProperties = {
      position:    'absolute',
      zIndex:      zIndex + 1,
      cursor:      CURSOR_MAP[dir],
      background:  'transparent',
    }
    const edge = isCorner ? 12 : 8

    if (dir === 'n')  Object.assign(s, { top: -4, left: edge, right: edge, height: 8 })
    if (dir === 's')  Object.assign(s, { bottom: -4, left: edge, right: edge, height: 8 })
    if (dir === 'e')  Object.assign(s, { right: -4, top: edge, bottom: edge, width: 8 })
    if (dir === 'w')  Object.assign(s, { left: -4, top: edge, bottom: edge, width: 8 })
    if (dir === 'nw') Object.assign(s, { top: -6, left: -6, width: 12, height: 12 })
    if (dir === 'ne') Object.assign(s, { top: -6, right: -6, width: 12, height: 12 })
    if (dir === 'sw') Object.assign(s, { bottom: -6, left: -6, width: 12, height: 12 })
    if (dir === 'se') Object.assign(s, { bottom: -6, right: -6, width: 12, height: 12 })

    return (
      <div
        key={dir}
        style={s}
        onMouseDown={e => startResize(e, dir)}
      />
    )
  }

  return (
    <div ref={containerRef} style={outerStyle}>
      {/* Scaled content */}
      <div style={innerStyle}>
        {children}
      </div>

      {/* Drag overlay — sits over title bar area only */}
      <div
        onMouseDown={startDrag}
        style={{
          position:   'absolute',
          top:        0,
          left:       14,
          right:      14,
          height:     titleBarHeight,
          cursor:     'move',
          zIndex:     zIndex + 1,
          background: 'transparent',
          // pointerEvents on child buttons etc. still work through
          // because they are in the scaled inner div (below this overlay)
          // We prevent drag from triggering on the close button area
          // by keeping this overlay narrow (14px margin on each side)
        }}
      />

      {/* 8 resize handles */}
      {(['n','s','e','w','nw','ne','sw','se'] as ResizeDir[]).map(handle)}
    </div>
  )
}

export default ResizablePanel
