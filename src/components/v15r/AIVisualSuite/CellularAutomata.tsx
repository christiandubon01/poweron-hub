// @ts-nocheck
/**
 * CellularAutomata — Conway's Game of Life / Rule 110 hybrid renderer
 * B46 — AI Visual Suite | Visual 3
 *
 * Runs a 2D cellular automaton with audio-reactive birth/survival rules.
 * Bass increases birth probability (more cells spring to life), mid slows
 * down the generation tick, high adds color depth per cell age, MTZ
 * injects glider seeds and pattern perturbations.
 */

import { useRef } from 'react'
import { useVisualEngine } from './useVisualEngine'
import type { VisualEngineProps } from './useVisualEngine'

interface Props extends VisualEngineProps {
  className?: string
  style?: React.CSSProperties
}

const COLS = 80, ROWS = 60

export default function CellularAutomata({ bass = 0, mid = 0, high = 0, mtz = 0, hue = 120, className = '', style }: Props) {
  const propsRef = useRef({ bass, mid, high, mtz, hue })
  propsRef.current = { bass, mid, high, mtz, hue }

  // Grid: cell age (0 = dead, 1+ = alive with age)
  const gridRef  = useRef<Uint8Array>(new Uint8Array(COLS * ROWS))
  const lastTick = useRef(0)

  // Initialize random seed
  if (gridRef.current.every(v => v === 0)) {
    const g = gridRef.current
    for (let i = 0; i < g.length; i++) g[i] = Math.random() < 0.25 ? 1 : 0
  }

  function idx(col: number, row: number) {
    return ((row + ROWS) % ROWS) * COLS + ((col + COLS) % COLS)
  }

  function neighbors(grid: Uint8Array, c: number, r: number): number {
    let n = 0
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue
      if (grid[idx(c + dc, r + dr)] > 0) n++
    }
    return n
  }

  function step(bass: number, mtz: number) {
    const g = gridRef.current
    const next = new Uint8Array(g.length)
    // Modified rule: birth on 3 neighbors, survives on 2 or 3
    // Bass lowers birth threshold slightly
    const birthNeighbors = Math.random() < bass * 0.3 ? 2 : 3
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const n  = neighbors(g, c, r)
        const alive = g[idx(c, r)] > 0
        if (alive) next[idx(c, r)] = n === 2 || n === 3 ? Math.min(255, g[idx(c, r)] + 1) : 0
        else       next[idx(c, r)] = n === birthNeighbors ? 1 : 0
      }
    }
    // MTZ: inject random live cells
    if (mtz > 0.3) {
      const seeds = Math.round(mtz * 20)
      for (let i = 0; i < seeds; i++) {
        next[Math.floor(Math.random() * g.length)] = 1
      }
    }
    gridRef.current = next
  }

  const { canvasRef } = useVisualEngine((ctx, w, h, t) => {
    const { bass: b, mid: m, high: hi, mtz: z, hue: h0 } = propsRef.current

    const tickInterval = 0.08 - m * 0.04
    if (t - lastTick.current > tickInterval) {
      step(b, z)
      lastTick.current = t
    }

    ctx.fillStyle = 'rgba(2,6,2,0.35)'
    ctx.fillRect(0, 0, w, h)

    const g = gridRef.current
    const cellW = w / COLS, cellH = h / ROWS

    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const age = g[idx(c, r)]
        if (age === 0) continue
        const ageFactor = Math.min(1, age / 30)
        const lightness = 40 + hi * 30 + ageFactor * 25
        const hShift    = h0 + ageFactor * 80 * hi
        const alpha     = 0.6 + ageFactor * 0.4
        ctx.fillStyle = `hsla(${hShift % 360},80%,${lightness}%,${alpha})`
        ctx.fillRect(
          c * cellW + 0.5, r * cellH + 0.5,
          cellW - 1, cellH - 1
        )
      }
    }

    // Bass: rim glow
    if (b > 0.1) {
      const rim = ctx.createRadialGradient(w * 0.5, h * 0.5, Math.min(w, h) * 0.3, w * 0.5, h * 0.5, Math.min(w, h) * 0.6)
      rim.addColorStop(0, 'transparent')
      rim.addColorStop(1, `hsla(${h0},80%,60%,${b * 0.15})`)
      ctx.fillStyle = rim
      ctx.fillRect(0, 0, w, h)
    }
  })

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{ width: '100%', height: '100%', display: 'block', ...style }}
    />
  )
}
