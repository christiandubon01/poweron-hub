// @ts-nocheck
/**
 * useVisualEngine — shared canvas animation hook for AIVisualSuite
 * B46 — AI Visual Suite
 *
 * Accepts audio/MTZ props and provides a canvas ref + animation frame lifecycle.
 * Each visualizer calls this hook to get a ready-to-use canvas context.
 */

import { useRef, useEffect, useCallback } from 'react'

export interface VisualEngineProps {
  bass?: number    // 0-1 bass frequency amplitude
  mid?: number     // 0-1 mid frequency amplitude
  high?: number    // 0-1 high frequency amplitude
  mtz?: number     // 0-1 MTZ (meta-trigger zone) intensity
  hue?: number     // 0-360 base hue override
}

export interface VisualEngine {
  canvasRef: React.RefObject<HTMLCanvasElement>
  frameRef: React.MutableRefObject<number>
  timeRef: React.MutableRefObject<number>
}

/**
 * Sets up a canvas with ResizeObserver + rAF lifecycle.
 * The draw callback is called each frame with (ctx, width, height, time).
 */
export function useVisualEngine(
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number, t: number) => void,
  deps: any[] = []
): VisualEngine {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const frameRef  = useRef<number>(0)
  const timeRef   = useRef<number>(0)
  const drawRef   = useRef(draw)

  useEffect(() => { drawRef.current = draw }, deps) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let running = true

    function resize() {
      const dpr = window.devicePixelRatio || 1
      const rect = canvas.getBoundingClientRect()
      const w = rect.width  || canvas.clientWidth  || 400
      const h = rect.height || canvas.clientHeight || 400
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width  = Math.round(w * dpr)
        canvas.height = Math.round(h * dpr)
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      }
    }

    function loop(ts: number) {
      if (!running) return
      timeRef.current = ts * 0.001
      resize()
      const dpr = window.devicePixelRatio || 1
      const w = canvas.width  / dpr
      const h = canvas.height / dpr
      drawRef.current(ctx, w, h, timeRef.current)
      frameRef.current = requestAnimationFrame(loop)
    }

    resize()
    frameRef.current = requestAnimationFrame(loop)

    const ro = new ResizeObserver(resize)
    ro.observe(canvas)

    return () => {
      running = false
      cancelAnimationFrame(frameRef.current)
      ro.disconnect()
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return { canvasRef, frameRef, timeRef }
}
