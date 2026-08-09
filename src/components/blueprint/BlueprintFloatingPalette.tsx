import React, { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'

const PALETTES_STORAGE_KEY = 'poweron.bp.palettes'
const MIN_W = 220
const MIN_H = 160
const DEFAULT_W = 280
const DEFAULT_H = 360

type PaletteGeom = { x: number; y: number; w: number; h: number }
type PaletteStore = Record<string, PaletteGeom>

function readPaletteStore(): PaletteStore {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(PALETTES_STORAGE_KEY) : null
    return raw ? (JSON.parse(raw) as PaletteStore) : {}
  } catch {
    return {}
  }
}

function writePaletteStore(store: PaletteStore): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(PALETTES_STORAGE_KEY, JSON.stringify(store))
    }
  } catch {}
}

export function clampPaletteGeom(g: PaletteGeom): PaletteGeom {
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1280
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800
  const w = Math.min(Math.max(g.w, MIN_W), vw)
  const h = Math.min(Math.max(g.h, MIN_H), vh)
  const x = Math.min(Math.max(g.x, 0), vw - w)
  const y = Math.min(Math.max(g.y, 0), vh - h)
  return { x, y, w, h }
}

interface BlueprintFloatingPaletteProps {
  paletteId: string
  title: string
  onClose: () => void
  children: React.ReactNode
  defaultX?: number
  defaultY?: number
}

export function BlueprintFloatingPalette({ paletteId, title, onClose, children, defaultX = 60, defaultY = 80 }: BlueprintFloatingPaletteProps) {
  const stored = readPaletteStore()[paletteId]
  const [geom, setGeom] = useState<PaletteGeom>(() =>
    clampPaletteGeom(stored ?? { x: defaultX, y: defaultY, w: DEFAULT_W, h: DEFAULT_H })
  )

  const dragRef = useRef<{ pointerId: number; startClientX: number; startClientY: number; startX: number; startY: number } | null>(null)
  const resizeRef = useRef<{ pointerId: number; startClientX: number; startClientY: number; startW: number; startH: number } | null>(null)

  useEffect(() => {
    const store = readPaletteStore()
    store[paletteId] = geom
    writePaletteStore(store)
  }, [paletteId, geom])

  useEffect(() => {
    const clamp = () => setGeom((g) => clampPaletteGeom(g))
    window.addEventListener('resize', clamp)
    window.addEventListener('orientationchange', clamp)
    return () => {
      window.removeEventListener('resize', clamp)
      window.removeEventListener('orientationchange', clamp)
    }
  }, [])

  const handleHeaderPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button')) return
    e.stopPropagation()
    dragRef.current = { pointerId: e.pointerId, startClientX: e.clientX, startClientY: e.clientY, startX: geom.x, startY: geom.y }
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId) } catch {}
  }

  const handleHeaderPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current || dragRef.current.pointerId !== e.pointerId) return
    setGeom((g) => clampPaletteGeom({
      ...g,
      x: dragRef.current!.startX + (e.clientX - dragRef.current!.startClientX),
      y: dragRef.current!.startY + (e.clientY - dragRef.current!.startClientY),
    }))
  }

  const handleHeaderPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId === e.pointerId) {
      try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId) } catch {}
      dragRef.current = null
    }
  }

  const handleHeaderPointerCancel = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId === e.pointerId) {
      try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId) } catch {}
      dragRef.current = null
    }
  }

  const handleResizePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation()
    resizeRef.current = { pointerId: e.pointerId, startClientX: e.clientX, startClientY: e.clientY, startW: geom.w, startH: geom.h }
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId) } catch {}
  }

  const handleResizePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!resizeRef.current || resizeRef.current.pointerId !== e.pointerId) return
    setGeom((g) => clampPaletteGeom({
      ...g,
      w: Math.max(resizeRef.current!.startW + (e.clientX - resizeRef.current!.startClientX), MIN_W),
      h: Math.max(resizeRef.current!.startH + (e.clientY - resizeRef.current!.startClientY), MIN_H),
    }))
  }

  const handleResizePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (resizeRef.current?.pointerId === e.pointerId) {
      try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId) } catch {}
      resizeRef.current = null
    }
  }

  const handleResizePointerCancel = (e: React.PointerEvent<HTMLDivElement>) => {
    if (resizeRef.current?.pointerId === e.pointerId) {
      try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId) } catch {}
      resizeRef.current = null
    }
  }

  return (
    <div
      style={{ position: 'fixed', left: geom.x, top: geom.y, width: geom.w, height: geom.h, zIndex: 100050 }}
      className="flex flex-col overflow-hidden rounded-lg border border-gray-700 bg-gray-900 shadow-xl"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      data-testid={`palette-${paletteId}`}
    >
      <div
        className="flex shrink-0 cursor-grab items-center gap-2 border-b border-gray-700 px-2 py-1.5 active:cursor-grabbing"
        style={{ touchAction: 'none' }}
        onPointerDown={handleHeaderPointerDown}
        onPointerMove={handleHeaderPointerMove}
        onPointerUp={handleHeaderPointerUp}
        onPointerCancel={handleHeaderPointerCancel}
      >
        <span className="flex-1 truncate text-xs font-semibold text-gray-100">{title}</span>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded p-0.5 text-gray-400 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300"
          aria-label={`Close ${title}`}
        >
          <X size={12} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto overflow-x-hidden p-1.5">
        <div className="grid grid-cols-1 gap-1">
          {children}
        </div>
      </div>
      <div
        className="absolute bottom-0 right-0 h-4 w-4 cursor-se-resize"
        style={{ touchAction: 'none' }}
        onPointerDown={handleResizePointerDown}
        onPointerMove={handleResizePointerMove}
        onPointerUp={handleResizePointerUp}
        onPointerCancel={handleResizePointerCancel}
      />
    </div>
  )
}
