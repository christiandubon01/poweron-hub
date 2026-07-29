import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from 'react'
import { Maximize2, Minus, Move, Plus } from 'lucide-react'

const MAX_ZOOM_SCALE = 4
const ZOOM_STEP = 0.25

export function calculateBlueprintSnapshotFitScale(input: {
  viewportWidth: number
  viewportHeight: number
  imageWidth: number
  imageHeight: number
}): number {
  const viewportWidth = Math.max(1, Number(input.viewportWidth) || 0)
  const viewportHeight = Math.max(1, Number(input.viewportHeight) || 0)
  const imageWidth = Math.max(1, Number(input.imageWidth) || 0)
  const imageHeight = Math.max(1, Number(input.imageHeight) || 0)
  return Math.max(0.01, Math.min(1, viewportWidth / imageWidth, viewportHeight / imageHeight))
}

export function clampBlueprintSnapshotZoom(zoom: number, fitScale: number): number {
  return Math.max(Math.max(0.01, fitScale), Math.min(MAX_ZOOM_SCALE, Number(zoom) || fitScale))
}

export function clampBlueprintSnapshotPan(input: {
  panX: number
  panY: number
  zoom: number
  viewportWidth: number
  viewportHeight: number
  imageWidth: number
  imageHeight: number
}): { x: number; y: number } {
  const scaledWidth = Math.max(1, input.imageWidth * input.zoom)
  const scaledHeight = Math.max(1, input.imageHeight * input.zoom)
  const maxX = Math.max(0, (scaledWidth - Math.max(1, input.viewportWidth)) / 2)
  const maxY = Math.max(0, (scaledHeight - Math.max(1, input.viewportHeight)) / 2)
  return {
    x: Math.max(-maxX, Math.min(maxX, Number(input.panX) || 0)),
    y: Math.max(-maxY, Math.min(maxY, Number(input.panY) || 0)),
  }
}

export function zoomBlueprintSnapshotAtPoint(input: {
  previousZoom: number
  nextZoom: number
  panX: number
  panY: number
  pointerX: number
  pointerY: number
  viewportWidth: number
  viewportHeight: number
  imageWidth: number
  imageHeight: number
}): { zoom: number; pan: { x: number; y: number } } {
  const previousZoom = Math.max(0.01, input.previousZoom)
  const nextZoom = Math.max(0.01, input.nextZoom)
  const centerX = input.viewportWidth / 2
  const centerY = input.viewportHeight / 2
  const imagePointX = (input.pointerX - centerX - input.panX) / previousZoom
  const imagePointY = (input.pointerY - centerY - input.panY) / previousZoom
  const pan = clampBlueprintSnapshotPan({
    panX: input.pointerX - centerX - imagePointX * nextZoom,
    panY: input.pointerY - centerY - imagePointY * nextZoom,
    zoom: nextZoom,
    viewportWidth: input.viewportWidth,
    viewportHeight: input.viewportHeight,
    imageWidth: input.imageWidth,
    imageHeight: input.imageHeight,
  })
  return { zoom: nextZoom, pan }
}

export function formatBlueprintSnapshotZoomPercent(zoom: number): string {
  return `${Math.round(Math.max(0.01, zoom) * 100)}%`
}

export function BlueprintSnapshotPreviewViewport({
  sourceCanvas,
  imageWidth,
  imageHeight,
  accessibleLabel,
  resetKey,
  onReady,
  onError,
}: {
  sourceCanvas: HTMLCanvasElement | null | undefined
  imageWidth: number
  imageHeight: number
  accessibleLabel: string
  resetKey: string | number
  onReady?: () => void
  onError?: () => void
}) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const imageMountRef = useRef<HTMLDivElement>(null)
  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map())
  const dragRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null)
  const pinchRef = useRef<{ distance: number; zoom: number; centerX: number; centerY: number; panX: number; panY: number } | null>(null)
  const [viewportSize, setViewportSize] = useState({ width: 1, height: 1 })
  const fitScale = useMemo(() => calculateBlueprintSnapshotFitScale({
    viewportWidth: viewportSize.width,
    viewportHeight: viewportSize.height,
    imageWidth,
    imageHeight,
  }), [imageHeight, imageWidth, viewportSize.height, viewportSize.width])
  const [zoom, setZoom] = useState(fitScale)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const isFit = Math.abs(zoom - fitScale) < 0.005
  const isNative = Math.abs(zoom - 1) < 0.005
  const isPannable = imageWidth * zoom > viewportSize.width || imageHeight * zoom > viewportSize.height

  const setZoomAndPan = useCallback((nextZoom: number, nextPan = pan) => {
    const clampedZoom = clampBlueprintSnapshotZoom(nextZoom, fitScale)
    setZoom(clampedZoom)
    setPan(clampBlueprintSnapshotPan({
      panX: nextPan.x,
      panY: nextPan.y,
      zoom: clampedZoom,
      viewportWidth: viewportSize.width,
      viewportHeight: viewportSize.height,
      imageWidth,
      imageHeight,
    }))
  }, [fitScale, imageHeight, imageWidth, pan, viewportSize.height, viewportSize.width])

  const setFit = useCallback(() => setZoomAndPan(fitScale, { x: 0, y: 0 }), [fitScale, setZoomAndPan])
  const setNative = useCallback(() => setZoomAndPan(1, { x: 0, y: 0 }), [setZoomAndPan])

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    const measure = () => {
      const rect = viewport.getBoundingClientRect()
      setViewportSize({ width: Math.max(1, rect.width), height: Math.max(1, rect.height) })
    }
    measure()
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null
    observer?.observe(viewport)
    window.addEventListener('resize', measure)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [])

  useEffect(() => {
    setZoom(fitScale)
    setPan({ x: 0, y: 0 })
    pointersRef.current.clear()
    dragRef.current = null
    pinchRef.current = null
  }, [fitScale, resetKey])

  useEffect(() => {
    const mount = imageMountRef.current
    if (!mount || !sourceCanvas || sourceCanvas.width <= 0 || sourceCanvas.height <= 0) {
      onError?.()
      return
    }
    mount.replaceChildren(sourceCanvas)
    sourceCanvas.style.width = `${imageWidth}px`
    sourceCanvas.style.height = `${imageHeight}px`
    sourceCanvas.style.maxWidth = 'none'
    sourceCanvas.style.maxHeight = 'none'
    sourceCanvas.style.display = 'block'
    sourceCanvas.style.imageRendering = 'auto'
    sourceCanvas.setAttribute('aria-hidden', 'true')
    onReady?.()
    return () => {
      if (mount.contains(sourceCanvas)) mount.removeChild(sourceCanvas)
    }
  }, [imageHeight, imageWidth, onError, onReady, sourceCanvas])

  const zoomBy = useCallback((delta: number) => {
    setZoomAndPan(Math.round((zoom + delta) / ZOOM_STEP) * ZOOM_STEP)
  }, [setZoomAndPan, zoom])

  const handleWheel = useCallback((event: ReactWheelEvent<HTMLDivElement>) => {
    if (!viewportRef.current) return
    event.preventDefault()
    const rect = viewportRef.current.getBoundingClientRect()
    const nextZoom = clampBlueprintSnapshotZoom(zoom + (event.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP), fitScale)
    const next = zoomBlueprintSnapshotAtPoint({
      previousZoom: zoom,
      nextZoom,
      panX: pan.x,
      panY: pan.y,
      pointerX: event.clientX - rect.left,
      pointerY: event.clientY - rect.top,
      viewportWidth: rect.width,
      viewportHeight: rect.height,
      imageWidth,
      imageHeight,
    })
    setZoom(next.zoom)
    setPan(next.pan)
  }, [fitScale, imageHeight, imageWidth, pan.x, pan.y, zoom])

  const handlePointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!viewportRef.current) return
    event.currentTarget.setPointerCapture(event.pointerId)
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    if (pointersRef.current.size === 2) {
      event.preventDefault()
      const points = Array.from(pointersRef.current.values())
      const distance = Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y)
      const rect = viewportRef.current.getBoundingClientRect()
      pinchRef.current = {
        distance,
        zoom,
        centerX: ((points[0].x + points[1].x) / 2) - rect.left,
        centerY: ((points[0].y + points[1].y) / 2) - rect.top,
        panX: pan.x,
        panY: pan.y,
      }
      dragRef.current = null
      return
    }
    if (isPannable) {
      event.preventDefault()
      dragRef.current = { x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y }
    }
  }, [isPannable, pan.x, pan.y, zoom])

  const handlePointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!viewportRef.current || !pointersRef.current.has(event.pointerId)) return
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    if (pinchRef.current && pointersRef.current.size >= 2) {
      event.preventDefault()
      const points = Array.from(pointersRef.current.values()).slice(0, 2)
      const distance = Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y)
      const nextZoom = clampBlueprintSnapshotZoom(pinchRef.current.zoom * (distance / Math.max(1, pinchRef.current.distance)), fitScale)
      const next = zoomBlueprintSnapshotAtPoint({
        previousZoom: pinchRef.current.zoom,
        nextZoom,
        panX: pinchRef.current.panX,
        panY: pinchRef.current.panY,
        pointerX: pinchRef.current.centerX,
        pointerY: pinchRef.current.centerY,
        viewportWidth: viewportSize.width,
        viewportHeight: viewportSize.height,
        imageWidth,
        imageHeight,
      })
      setZoom(next.zoom)
      setPan(next.pan)
      return
    }
    if (dragRef.current && isPannable) {
      event.preventDefault()
      setPan(clampBlueprintSnapshotPan({
        panX: dragRef.current.panX + event.clientX - dragRef.current.x,
        panY: dragRef.current.panY + event.clientY - dragRef.current.y,
        zoom,
        viewportWidth: viewportSize.width,
        viewportHeight: viewportSize.height,
        imageWidth,
        imageHeight,
      }))
    }
  }, [fitScale, imageHeight, imageWidth, isPannable, viewportSize.height, viewportSize.width, zoom])

  const clearPointer = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    pointersRef.current.delete(event.pointerId)
    if (pointersRef.current.size < 2) pinchRef.current = null
    if (pointersRef.current.size === 0) dragRef.current = null
  }, [])

  const handleDoubleClick = useCallback(() => {
    if (isFit && fitScale < 1) setNative()
    else setFit()
  }, [fitScale, isFit, setFit, setNative])

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-gray-700 bg-[#060910]">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-800 px-3 py-2">
        <div className="flex items-center gap-1">
          <button type="button" onClick={setFit} className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-semibold ${isFit ? 'border-cyan-400 bg-cyan-400/15 text-cyan-100' : 'border-gray-700 text-gray-300 hover:bg-white/5'}`}>
            <Maximize2 size={13} />
            Fit
          </button>
          <button type="button" onClick={setNative} className={`rounded-md border px-2 py-1 text-xs font-semibold ${isNative ? 'border-cyan-400 bg-cyan-400/15 text-cyan-100' : 'border-gray-700 text-gray-300 hover:bg-white/5'}`}>100%</button>
          <button type="button" onClick={() => zoomBy(-ZOOM_STEP)} disabled={zoom <= fitScale + 0.005} className="rounded-md border border-gray-700 p-1 text-gray-300 hover:bg-white/5 disabled:opacity-40" aria-label="Zoom out" title="Zoom out">
            <Minus size={14} />
          </button>
          <button type="button" onClick={() => zoomBy(ZOOM_STEP)} disabled={zoom >= MAX_ZOOM_SCALE - 0.005} className="rounded-md border border-gray-700 p-1 text-gray-300 hover:bg-white/5 disabled:opacity-40" aria-label="Zoom in" title="Zoom in">
            <Plus size={14} />
          </button>
        </div>
        <div className="inline-flex items-center gap-2 text-xs font-semibold text-gray-300">
          <Move size={13} className={isPannable ? 'text-cyan-200' : 'text-gray-600'} />
          <span aria-live="polite">{formatBlueprintSnapshotZoomPercent(zoom)}</span>
        </div>
      </div>
      <div
        ref={viewportRef}
        className={`relative min-h-[42vh] flex-1 overflow-hidden bg-white ${isPannable ? 'cursor-grab active:cursor-grabbing' : 'cursor-default'}`}
        role="img"
        aria-label={accessibleLabel}
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={clearPointer}
        onPointerCancel={clearPointer}
        onDoubleClick={handleDoubleClick}
        style={{ touchAction: 'none' }}
      >
        <div
          ref={imageMountRef}
          className="absolute left-1/2 top-1/2 origin-center"
          style={{
            width: imageWidth,
            height: imageHeight,
            transform: `translate(calc(-50% + ${pan.x}px), calc(-50% + ${pan.y}px)) scale(${zoom})`,
          }}
        />
      </div>
    </div>
  )
}
