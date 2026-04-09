/**
 * SimulationDotTraveler.tsx — NW19: Business cycle dot traveler animation.
 *
 * DotTraveler: 25-second journey through 6 business cycle stages.
 *   Stages: Estimate → Award → Purchase → Work → Invoice → Collect
 *   Accumulative TorusGeometry rings (radius +0.5 per pickup) mark each stage.
 *   Canvas text sprite labels per ring.
 *   World-dim callback (30% opacity during journey).
 *
 * DotTravelerManager: Up to 5 parallel travelers for TEAM_20+ presets.
 *
 * CycleSummaryPanel: React component shown at journey end.
 *   - Revenue, material cost, labor hours, profit margin + Replay button
 *
 * Triggered by nw:sim-play-cycle event from SimulationHUD.
 * Dispatches nw:sim-cycle-end when complete.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react'
import * as THREE from 'three'
import { useWorldContext } from './WorldContext'

// ── Stage definitions ─────────────────────────────────────────────────────────

export interface CycleStage {
  id: string
  label: string
  duration: number   // seconds
  ringColor: number
  ringRadius: number
  revenue: number    // cumulative at this stage
  materialCost: number
  laborHours: number
  worldPos: THREE.Vector3
}

const STAGES: CycleStage[] = [
  {
    id: 'estimate',
    label: 'ESTIMATE',
    duration: 3,
    ringColor: 0xffa040,
    ringRadius: 0.5,
    revenue: 0,
    materialCost: 500,
    laborHours: 8,
    worldPos: new THREE.Vector3(-50, 3, -10),
  },
  {
    id: 'award',
    label: 'AWARD',
    duration: 3,
    ringColor: 0xffe060,
    ringRadius: 1.0,
    revenue: 15000,
    materialCost: 500,
    laborHours: 0,
    worldPos: new THREE.Vector3(-40, 3, -5),
  },
  {
    id: 'purchase',
    label: 'PURCHASE',
    duration: 4,
    ringColor: 0xff6040,
    ringRadius: 1.5,
    revenue: 0,
    materialCost: 4200,
    laborHours: 2,
    worldPos: new THREE.Vector3(-30, 3, 5),
  },
  {
    id: 'work',
    label: 'WORK',
    duration: 7,
    ringColor: 0x00e5cc,
    ringRadius: 2.0,
    revenue: 0,
    materialCost: 800,
    laborHours: 80,
    worldPos: new THREE.Vector3(-20, 3, 0),
  },
  {
    id: 'invoice',
    label: 'INVOICE',
    duration: 4,
    ringColor: 0x80c0ff,
    ringRadius: 2.5,
    revenue: 22500,
    materialCost: 0,
    laborHours: 2,
    worldPos: new THREE.Vector3(-10, 3, -8),
  },
  {
    id: 'collect',
    label: 'COLLECT',
    duration: 4,
    ringColor: 0x60ff90,
    ringRadius: 3.0,
    revenue: 37500,
    materialCost: 0,
    laborHours: 1,
    worldPos: new THREE.Vector3(-5, 3, 5),
  },
]

// ── Canvas text sprite helper — B72: 40% size reduction ──────────────────────

function makeTextSprite(text: string, color = '#00e5cc'): THREE.Sprite {
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 64
  const ctx = canvas.getContext('2d')!
  ctx.clearRect(0, 0, 256, 64)
  ctx.font = 'bold 13px monospace'  // B72: reduced from 22 → 13 (40% smaller)
  ctx.fillStyle = color
  ctx.textAlign = 'center'
  ctx.fillText(text, 128, 40)
  const texture = new THREE.CanvasTexture(canvas)
  const mat = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false })
  const sprite = new THREE.Sprite(mat)
  sprite.scale.set(3.6, 0.9, 1)  // B72: reduced from (6, 1.5) → (3.6, 0.9) — 40% smaller
  return sprite
}

// ── DotTraveler class ─────────────────────────────────────────────────────────

interface TravelerSummary {
  totalRevenue: number
  totalMaterialCost: number
  totalLaborHours: number
  profitMargin: number  // percent
}

export class DotTraveler {
  scene: THREE.Scene
  group: THREE.Group
  dot: THREE.Mesh
  rings: THREE.Mesh[]
  labels: THREE.Sprite[]
  stageIndex: number
  stageProgress: number   // 0–1 within current stage
  elapsed: number
  done: boolean
  onComplete: (summary: TravelerSummary) => void
  onDim: (factor: number) => void

  private dotMat: THREE.MeshStandardMaterial
  private summary: TravelerSummary

  constructor(
    scene: THREE.Scene,
    onComplete: (summary: TravelerSummary) => void,
    onDim: (factor: number) => void,
  ) {
    this.scene = scene
    this.onComplete = onComplete
    this.onDim = onDim
    this.group = new THREE.Group()
    scene.add(this.group)

    this.rings = []
    this.labels = []
    this.stageIndex = 0
    this.stageProgress = 0
    this.elapsed = 0
    this.done = false
    this.summary = { totalRevenue: 0, totalMaterialCost: 0, totalLaborHours: 0, profitMargin: 0 }

    // Main dot
    this.dotMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0xffffff,
      emissiveIntensity: 2.5,
    })
    const dotGeo = new THREE.SphereGeometry(0.4, 12, 10)
    this.dot = new THREE.Mesh(dotGeo, this.dotMat)
    const startPos = STAGES[0].worldPos
    this.dot.position.copy(startPos)
    this.group.add(this.dot)

    // Dim world
    onDim(0.3)
  }

  update(deltaSeconds: number) {
    if (this.done) return

    this.elapsed += deltaSeconds
    const stage = STAGES[this.stageIndex]
    this.stageProgress += deltaSeconds / stage.duration

    // Move dot toward next stage worldPos or stay at current
    const targetPos = stage.worldPos
    const prevPos = this.stageIndex > 0 ? STAGES[this.stageIndex - 1].worldPos : STAGES[0].worldPos
    this.dot.position.lerpVectors(prevPos, targetPos, Math.min(this.stageProgress, 1))
    // Hover bob
    this.dot.position.y += Math.sin(this.elapsed * 4) * 0.04

    if (this.stageProgress >= 1) {
      this.arriveAtStage(this.stageIndex)
      this.stageIndex++
      this.stageProgress = 0

      if (this.stageIndex >= STAGES.length) {
        this.complete()
      }
    }
  }

  private arriveAtStage(idx: number) {
    const stage = STAGES[idx]

    // Accumulate summary
    this.summary.totalRevenue += stage.revenue
    this.summary.totalMaterialCost += stage.materialCost
    this.summary.totalLaborHours += stage.laborHours

    // Add ring at stage position
    const ringGeo = new THREE.TorusGeometry(stage.ringRadius, 0.08, 6, 32)
    const ringMat = new THREE.MeshStandardMaterial({
      color: stage.ringColor,
      emissive: stage.ringColor,
      emissiveIntensity: 0.8,
      transparent: true,
      opacity: 0.85,
    })
    const ring = new THREE.Mesh(ringGeo, ringMat)
    ring.position.copy(stage.worldPos)
    ring.rotation.x = Math.PI / 2
    this.group.add(ring)
    this.rings.push(ring)

    // Text label sprite
    const sprite = makeTextSprite(stage.label, '#' + stage.ringColor.toString(16).padStart(6, '0'))
    sprite.position.copy(stage.worldPos)
    sprite.position.y += stage.ringRadius + 1.5
    this.group.add(sprite)
    this.labels.push(sprite)
  }

  private complete() {
    this.done = true
    const revenue = this.summary.totalRevenue
    const cost = this.summary.totalMaterialCost + (this.summary.totalLaborHours * 85)  // $85/hr labor
    const margin = revenue > 0 ? Math.round(((revenue - cost) / revenue) * 100) : 0
    this.summary.profitMargin = margin
    this.onDim(1.0)  // restore
    this.onComplete(this.summary)
  }

  dispose() {
    this.scene.remove(this.group)
    this.dot.geometry.dispose()
    ;(this.dot.material as THREE.Material).dispose()
    this.rings.forEach(r => { r.geometry.dispose(); (r.material as THREE.Material).dispose() })
    this.labels.forEach(s => { ;(s.material as THREE.SpriteMaterial).map?.dispose(); ;(s.material as THREE.Material).dispose() })
  }
}

// ── DotTravelerManager ────────────────────────────────────────────────────────

export class DotTravelerManager {
  private scene: THREE.Scene
  private travelers: DotTraveler[]
  private maxTravelers: number
  private active: boolean
  private animFrame: number
  private lastTime: number
  private onAllComplete: (summary: TravelerSummary) => void
  private onDim: (factor: number) => void
  private completedCount: number

  constructor(
    scene: THREE.Scene,
    maxTravelers: number,
    onAllComplete: (summary: TravelerSummary) => void,
    onDim: (factor: number) => void,
  ) {
    this.scene = scene
    this.travelers = []
    this.maxTravelers = maxTravelers
    this.active = false
    this.animFrame = 0
    this.lastTime = 0
    this.onAllComplete = onAllComplete
    this.onDim = onDim
    this.completedCount = 0
  }

  start() {
    if (this.active) return
    this.active = true
    this.completedCount = 0

    // Stagger travelers
    const count = Math.min(this.maxTravelers, 5)
    for (let i = 0; i < count; i++) {
      setTimeout(() => {
        if (!this.active) return
        const t = new DotTraveler(
          this.scene,
          (summary) => {
            this.completedCount++
            if (this.completedCount >= count) {
              this.onAllComplete(summary)
            }
          },
          this.onDim,
        )
        this.travelers.push(t)
      }, i * 2000)  // 2s stagger between travelers
    }

    this.lastTime = performance.now()
    const loop = (now: number) => {
      if (!this.active) return
      const delta = (now - this.lastTime) / 1000
      this.lastTime = now
      this.travelers.forEach(t => t.update(delta))
      this.animFrame = requestAnimationFrame(loop)
    }
    this.animFrame = requestAnimationFrame(loop)
  }

  stop() {
    this.active = false
    if (this.animFrame) cancelAnimationFrame(this.animFrame)
    this.travelers.forEach(t => t.dispose())
    this.travelers = []
    this.onDim(1.0)
  }

  dispose() {
    this.stop()
  }
}

// ── CycleSummaryPanel component ───────────────────────────────────────────────

interface CycleSummaryProps {
  summary: TravelerSummary
  onReplay: () => void
  onClose: () => void
}

export function CycleSummaryPanel({ summary, onReplay, onClose }: CycleSummaryProps) {
  return (
    <div style={{
      position: 'absolute',
      bottom: 100,
      left: '50%',
      transform: 'translateX(-50%)',
      zIndex: 35,
      background: 'rgba(5,5,20,0.95)',
      border: '1px solid rgba(0,229,204,0.4)',
      borderRadius: 10,
      padding: '14px 20px',
      width: 280,
      fontFamily: 'monospace',
      backdropFilter: 'blur(10px)',
    }}>
      <div style={{ color: '#00e5cc', fontSize: 10, letterSpacing: 2, fontWeight: 700, marginBottom: 10 }}>
        ◉ BUSINESS CYCLE COMPLETE
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
        <SummaryItem label="REVENUE" value={`$${(summary.totalRevenue / 1000).toFixed(1)}k`} color="#60ff90" />
        <SummaryItem label="MATERIALS" value={`$${(summary.totalMaterialCost / 1000).toFixed(1)}k`} color="#ff6040" />
        <SummaryItem label="LABOR HRS" value={`${summary.totalLaborHours}h`} color="#ffa040" />
        <SummaryItem label="MARGIN" value={`${summary.profitMargin}%`} color={summary.profitMargin > 30 ? '#60ff90' : '#ffe060'} />
      </div>

      <div style={{ display: 'flex', gap: 6 }}>
        <button onClick={onReplay} style={{
          flex: 1,
          padding: '5px 8px',
          fontSize: 9,
          letterSpacing: 1,
          fontFamily: 'monospace',
          fontWeight: 700,
          borderRadius: 5,
          border: '1px solid rgba(0,229,204,0.6)',
          background: 'rgba(0,229,204,0.15)',
          color: '#00e5cc',
          cursor: 'pointer',
        }}>
          ↺ REPLAY
        </button>
        <button onClick={onClose} style={{
          flex: 1,
          padding: '5px 8px',
          fontSize: 9,
          letterSpacing: 1,
          fontFamily: 'monospace',
          borderRadius: 5,
          border: '1px solid rgba(255,255,255,0.15)',
          background: 'transparent',
          color: 'rgba(255,255,255,0.5)',
          cursor: 'pointer',
        }}>
          ✕ CLOSE
        </button>
      </div>
    </div>
  )
}

function SummaryItem({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ background: 'rgba(255,255,255,0.04)', borderRadius: 5, padding: '5px 7px' }}>
      <div style={{ color: 'rgba(255,255,255,0.35)', fontSize: 7, letterSpacing: 1 }}>{label}</div>
      <div style={{ color, fontSize: 14, fontWeight: 700 }}>{value}</div>
    </div>
  )
}

// ── SimDotTravelerController — React wrapper ──────────────────────────────────

export function SimDotTravelerController() {
  const { scene } = useWorldContext()
  const managerRef = useRef<DotTravelerManager | null>(null)
  const [summary, setSummary] = useState<TravelerSummary | null>(null)
  const [playing, setPlaying] = useState(false)

  const handleDim = useCallback((factor: number) => {
    // Dispatch world dim event
    window.dispatchEvent(new CustomEvent('nw:world-dim', { detail: { factor } }))
  }, [])

  const handleComplete = useCallback((s: TravelerSummary) => {
    setSummary(s)
    setPlaying(false)
    window.dispatchEvent(new CustomEvent('nw:sim-cycle-end'))
  }, [])

  const startCycle = useCallback((preset: string) => {
    if (managerRef.current) {
      managerRef.current.stop()
    }
    const maxTravelers = preset === 'SOLO' || preset === 'TEAM_5' ? 1
      : preset === 'TEAM_20' ? 2
      : preset === 'TEAM_50' ? 3
      : 5
    const mgr = new DotTravelerManager(scene, maxTravelers, handleComplete, handleDim)
    managerRef.current = mgr
    mgr.start()
    setPlaying(true)
    setSummary(null)
  }, [scene, handleComplete, handleDim])

  const stopCycle = useCallback(() => {
    managerRef.current?.stop()
    managerRef.current = null
    setPlaying(false)
    setSummary(null)
    handleDim(1.0)
  }, [handleDim])

  // Listen for play/stop events from SimulationHUD
  useEffect(() => {
    function onPlay(e: Event) {
      const ev = e as CustomEvent<{ preset: string }>
      startCycle(ev.detail?.preset ?? 'SOLO')
    }
    function onStop() {
      stopCycle()
    }
    window.addEventListener('nw:sim-play-cycle', onPlay)
    window.addEventListener('nw:sim-stop-cycle', onStop)
    return () => {
      window.removeEventListener('nw:sim-play-cycle', onPlay)
      window.removeEventListener('nw:sim-stop-cycle', onStop)
      managerRef.current?.dispose()
    }
  }, [startCycle, stopCycle])

  if (!summary) return null

  return (
    <CycleSummaryPanel
      summary={summary}
      onReplay={() => startCycle('SOLO')}
      onClose={() => setSummary(null)}
    />
  )
}
