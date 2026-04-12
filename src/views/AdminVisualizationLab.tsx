// @ts-nocheck
/**
 * AdminVisualizationLab.tsx — B42 | Neural Map Premium Features
 *
 * Features added in B42:
 *   F1 — SVG-style billboard sprites (SpriteMaterial + CanvasTexture) per node type
 *   F2 — Pause / speed control bar  (SLOW 20% | NORMAL | PAUSE, Spacebar, 3-tap mobile)
 *   F3 — Business path category system (Lead→Estimate→Project→Field→Invoice→Payment)
 *   F4 — Goal-based path visualizer, 1-10 profiles, left slide-in drawer
 *
 * Protected files NOT touched: authStore.ts, netlify.toml, backupDataService.ts,
 *   vite.config.ts, SVGCharts.tsx
 */

import { useRef, useEffect, useState, useCallback } from 'react'
import * as THREE from 'three'
import { getBackupData, health, getKPIs } from '../services/backupDataService'
import { callClaude, extractText } from '../services/claudeProxy'
import VisualSuitePanel from '../components/v15r/AIVisualSuite/VisualSuitePanel'
// B53: NEXUS voice pipeline for OrbLab mic
// B56: + onTTSAudioChange (orb reacts to TTS) + setOrbLabMode (suppress drawer) + isOrbLabMode
import { getVoiceSubsystem, unlockAudioContext, onOrbStateChange, onTTSAudioChange, setOrbLabMode, type VoiceSessionStatus } from '../services/voice'
// B62: orbLabActive zustand flag — hides floating NEXUS mic while ORB LAB is mounted
import { useUIStore } from '../store/uiStore'
// FIX-ORB: auth store — used to ensure voice subsystem is initialized before OrbLab mic fires
import { useAuthStore } from '../store/authStore'
// B67: Combined Neural Map 2
import CombinedNeuralMap from './CombinedNeuralMap'

// ─── Types ────────────────────────────────────────────────────────────────────
type OrbState = 'IDLE' | 'LISTENING' | 'THINKING' | 'SPEAKING' | 'MULTI_AGENT'
type BgMode = 'deepspace' | 'datastream' | 'grid' | 'soliddark'
type MainTab = 'ORB_LAB' | 'NEURAL_MAP' | 'COMBINED'
type NeuralTab = 'Projects' | 'Agents' | 'Decisions' | 'Data' | 'All'
type DepartureMode = 'silent' | 'label' | 'tone'
type SpeedMode = 'normal' | 'slow' | 'paused'

interface NNode {
  id: string; label: string
  type: 'project' | 'agent' | 'decision' | 'data' | 'pathstep' | 'goalstep'
  color: number; size: number
  x: number; y: number; z: number
  vx: number; vy: number; vz: number
  fx: number; fy: number; fz: number
  mesh?: THREE.Sprite | THREE.Object3D
  meta?: Record<string, any>
  pinned?: boolean
}
interface NEdge {
  a: number; b: number
  line?: THREE.Line | THREE.Mesh
  pathColor?: string
  isPath?: boolean
  isGoal?: boolean
}

interface GoalProfile {
  id: string
  name: string
  color: string
  startingPoint: 'current' | 'fictional'
  startingCapital: number
  startingRevenue: number
  startingTeamSize: number
  targetAmount: number
  timeHorizonMonths: number
  scenarioFactors: string[]
  notes: string
  active: boolean
}

// ─── Constants ────────────────────────────────────────────────────────────────
const ORB_STATES: OrbState[] = ['IDLE', 'LISTENING', 'THINKING', 'SPEAKING', 'MULTI_AGENT']
const TIER_COLORS_HEX = ['#FFD24A', '#3A8EFF', '#2EE89A', '#AA6EFF', '#60607A']
const TIER_COLORS_INT = [0xFFD24A, 0x3A8EFF, 0x2EE89A, 0xAA6EFF, 0x60607A]
const GOAL_PROFILE_COLORS = [
  '#7c3aed','#0ea5e9','#10b981','#f59e0b','#ef4444',
  '#a855f7','#06b6d4','#84cc16','#fb923c','#f43f5e',
]
const SCENARIO_FACTORS = [
  'App Growth','Electrical Pipeline','RMO Active','Investment Received',
  'Disruption Event','Personal Health Event',
]
const GOAL_STORAGE_KEY  = 'poweron_goal_paths'
const VALUES_STORAGE_KEY = 'poweron_values_profile'
const PATH_STEPS = ['Lead','Estimate','Project','Field Logs','Invoice','Payment']

const AGENT_LIST = [
  { id: 'VAULT',     label: 'VAULT',     tier: 1, desc: 'Estimating & contract intelligence' },
  { id: 'OHM',       label: 'OHM',       tier: 2, desc: 'NEC code compliance' },
  { id: 'LEDGER',    label: 'LEDGER',    tier: 2, desc: 'Financial tracking' },
  { id: 'BLUEPRINT', label: 'BLUEPRINT', tier: 1, desc: 'Drawing analysis' },
  { id: 'CHRONO',    label: 'CHRONO',    tier: 2, desc: 'Scheduling & timeline' },
  { id: 'SPARK',     label: 'SPARK',     tier: 1, desc: 'Live call intelligence' },
  { id: 'ATLAS',     label: 'ATLAS',     tier: 3, desc: 'Material intelligence' },
  { id: 'NEXUS',     label: 'NEXUS',     tier: 1, desc: 'Orchestration brain' },
  { id: 'GUARDIAN',  label: 'GUARDIAN',  tier: 2, desc: 'Project health monitor' },
  { id: 'HUNTER',    label: 'HUNTER',    tier: 3, desc: 'Lead hunting' },
  { id: 'PULSE',     label: 'PULSE',     tier: 3, desc: 'Proactive alerts' },
  { id: 'LEDGER2',   label: 'LEDGER+',   tier: 4, desc: 'Advanced financials' },
  { id: 'ECHO',      label: 'ECHO',      tier: 4, desc: 'Context memory' },
  { id: 'SCOUT',     label: 'SCOUT',     tier: 5, desc: 'Proposal feed' },
  { id: 'CHRONO2',   label: 'CHRONO+',   tier: 5, desc: 'Phase timeline' },
]

// ─── Health Helpers ───────────────────────────────────────────────────────────
function getAvgHealth(): number {
  try {
    const d = getBackupData()
    if (!d?.projects?.length) return 75
    const scores = d.projects.map((p) => health(p, d).sc)
    return scores.reduce((a: number, b: number) => a + b, 0) / scores.length
  } catch { return 75 }
}

function healthColorInt(avg: number): number {
  if (avg > 70) return 0x00ff88
  if (avg > 40) return 0xffcc00
  return 0xff6600
}

// ─── Canvas Icon Drawing Functions (Feature 1) ────────────────────────────────

function makeAgentChipCanvas(tierHex: string, isNexus: boolean): HTMLCanvasElement {
  const SIZE = 128
  const c = document.createElement('canvas')
  c.width = SIZE; c.height = SIZE
  const ctx = c.getContext('2d')!
  ctx.clearRect(0, 0, SIZE, SIZE)

  // Gold crown for NEXUS node
  if (isNexus) {
    ctx.fillStyle = '#FFD24A'
    ctx.beginPath()
    ctx.moveTo(42, 26)
    ctx.lineTo(42, 8)
    ctx.lineTo(52, 17)
    ctx.lineTo(64, 4)
    ctx.lineTo(76, 17)
    ctx.lineTo(86, 8)
    ctx.lineTo(86, 26)
    ctx.closePath()
    ctx.fill()
    ctx.strokeStyle = '#FFF0A0'
    ctx.lineWidth = 1.5
    ctx.stroke()
  }

  const top = isNexus ? 30 : 12
  const cx = 24, cw = 80, ch = 80
  const cy = top

  // Chip body
  ctx.fillStyle = '#0d0d0d'
  ctx.fillRect(cx, cy, cw, ch)
  ctx.strokeStyle = tierHex
  ctx.lineWidth = 3
  ctx.strokeRect(cx, cy, cw, ch)

  // Corner notch (IC style)
  ctx.fillStyle = '#060606'
  ctx.beginPath()
  ctx.arc(cx + 10, cy + 10, 6, 0, Math.PI * 2)
  ctx.fill()

  // Inner grid pattern
  ctx.strokeStyle = tierHex + '44'
  ctx.lineWidth = 0.8
  for (let gx = cx + 14; gx < cx + cw; gx += 14) {
    ctx.beginPath(); ctx.moveTo(gx, cy + 2); ctx.lineTo(gx, cy + ch - 2); ctx.stroke()
  }
  for (let gy = cy + 14; gy < cy + ch; gy += 14) {
    ctx.beginPath(); ctx.moveTo(cx + 2, gy); ctx.lineTo(cx + cw - 2, gy); ctx.stroke()
  }

  // Glow center dot
  const grad = ctx.createRadialGradient(64, cy + ch / 2, 0, 64, cy + ch / 2, 18)
  grad.addColorStop(0, tierHex + 'BB')
  grad.addColorStop(1, 'transparent')
  ctx.fillStyle = grad
  ctx.beginPath()
  ctx.arc(64, cy + ch / 2, 18, 0, Math.PI * 2)
  ctx.fill()

  // Pins — left side (4 pins)
  for (let i = 0; i < 4; i++) {
    ctx.fillStyle = tierHex
    ctx.fillRect(cx - 11, cy + 10 + i * 17, 11, 7)
  }
  // Pins — right side (4 pins)
  for (let i = 0; i < 4; i++) {
    ctx.fillStyle = tierHex
    ctx.fillRect(cx + cw, cy + 10 + i * 17, 11, 7)
  }
  // Pins — top (3 pins)
  for (let i = 0; i < 3; i++) {
    ctx.fillStyle = tierHex
    ctx.fillRect(cx + 14 + i * 20, cy - 10, 8, 10)
  }
  // Pins — bottom (3 pins)
  for (let i = 0; i < 3; i++) {
    ctx.fillStyle = tierHex
    ctx.fillRect(cx + 14 + i * 20, cy + ch, 8, 10)
  }

  return c
}

function makeProjectHardHatCanvas(healthHex: string): HTMLCanvasElement {
  const SIZE = 128
  const c = document.createElement('canvas')
  c.width = SIZE; c.height = SIZE
  const ctx = c.getContext('2d')!
  ctx.clearRect(0, 0, SIZE, SIZE)

  // Hard hat dome
  ctx.fillStyle = healthHex
  ctx.beginPath()
  ctx.ellipse(64, 50, 40, 28, 0, Math.PI, 0, true)
  ctx.closePath()
  ctx.fill()

  // Brim
  ctx.fillStyle = healthHex
  ctx.beginPath()
  ctx.ellipse(64, 54, 50, 9, 0, 0, Math.PI * 2)
  ctx.fill()

  // Inner band (shadow)
  ctx.fillStyle = 'rgba(0,0,0,0.35)'
  ctx.fillRect(24, 52, 80, 6)

  // Folder body
  ctx.fillStyle = '#111'
  ctx.strokeStyle = healthHex
  ctx.lineWidth = 2.5
  ctx.fillRect(22, 72, 84, 46)
  ctx.strokeRect(22, 72, 84, 46)

  // Folder tab
  ctx.fillStyle = healthHex
  ctx.fillRect(22, 64, 28, 10)
  ctx.strokeStyle = healthHex
  ctx.lineWidth = 2
  ctx.strokeRect(22, 64, 28, 10)

  // Ruled lines inside folder
  ctx.strokeStyle = healthHex + '44'
  ctx.lineWidth = 1
  for (let fy = 83; fy < 116; fy += 11) {
    ctx.beginPath(); ctx.moveTo(32, fy); ctx.lineTo(96, fy); ctx.stroke()
  }

  return c
}

function makeDecisionGavelCanvas(colorHex: string): HTMLCanvasElement {
  const SIZE = 128
  const c = document.createElement('canvas')
  c.width = SIZE; c.height = SIZE
  const ctx = c.getContext('2d')!
  ctx.clearRect(0, 0, SIZE, SIZE)

  ctx.fillStyle = colorHex
  ctx.strokeStyle = colorHex
  ctx.lineCap = 'round'

  // Gavel head (rotated rectangle)
  ctx.save()
  ctx.translate(50, 46)
  ctx.rotate(-Math.PI / 4)
  ctx.fillRect(-26, -12, 52, 24)
  ctx.restore()

  // Band on gavel head
  ctx.save()
  ctx.translate(50, 46)
  ctx.rotate(-Math.PI / 4)
  ctx.fillStyle = 'rgba(0,0,0,0.3)'
  ctx.fillRect(-26, -2, 52, 4)
  ctx.restore()

  // Handle
  ctx.strokeStyle = colorHex
  ctx.lineWidth = 9
  ctx.beginPath()
  ctx.moveTo(62, 62)
  ctx.lineTo(105, 105)
  ctx.stroke()

  // Sound block (base)
  ctx.fillStyle = colorHex + '77'
  ctx.strokeStyle = colorHex
  ctx.lineWidth = 2
  ctx.fillRect(8, 100, 52, 14)
  ctx.strokeRect(8, 100, 52, 14)

  return c
}

function makeDataIconCanvas(metricType: string, colorHex: string): HTMLCanvasElement {
  const SIZE = 128
  const c = document.createElement('canvas')
  c.width = SIZE; c.height = SIZE
  const ctx = c.getContext('2d')!
  ctx.clearRect(0, 0, SIZE, SIZE)

  ctx.fillStyle = colorHex
  ctx.strokeStyle = colorHex
  const mt = (metricType || '').toLowerCase()

  if (mt === 'project') {
    // Hard hat worker figure
    ctx.lineWidth = 5; ctx.lineCap = 'round'
    // Hat
    ctx.fillStyle = colorHex
    ctx.beginPath(); ctx.ellipse(64, 38, 26, 16, 0, Math.PI, 0, true); ctx.closePath(); ctx.fill()
    ctx.fillRect(36, 42, 56, 6)
    // Body
    ctx.beginPath(); ctx.moveTo(64, 64); ctx.lineTo(64, 96); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(36, 78); ctx.lineTo(92, 78); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(64, 96); ctx.lineTo(44, 118); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(64, 96); ctx.lineTo(84, 118); ctx.stroke()
    ctx.beginPath(); ctx.arc(64, 58, 8, 0, Math.PI * 2); ctx.fill()
  } else if (mt === 'decision') {
    // Scales of justice
    ctx.lineWidth = 3
    ctx.beginPath(); ctx.moveTo(64, 14); ctx.lineTo(64, 110); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(18, 48); ctx.lineTo(110, 48); ctx.stroke()
    // Chains
    ctx.beginPath(); ctx.moveTo(18, 48); ctx.lineTo(26, 62); ctx.moveTo(34, 48); ctx.lineTo(26, 62); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(94, 48); ctx.lineTo(102, 62); ctx.moveTo(110, 48); ctx.lineTo(102, 62); ctx.stroke()
    // Pans
    ctx.beginPath(); ctx.arc(26, 78, 16, 0, Math.PI); ctx.stroke()
    ctx.beginPath(); ctx.arc(102, 78, 16, 0, Math.PI); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(42, 108); ctx.lineTo(86, 108); ctx.stroke()
  } else if (mt === 'time') {
    // Clock face
    ctx.lineWidth = 4
    ctx.beginPath(); ctx.arc(64, 64, 46, 0, Math.PI * 2); ctx.stroke()
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2
      ctx.lineWidth = i % 3 === 0 ? 3 : 1.5
      ctx.beginPath()
      ctx.moveTo(64 + 37 * Math.sin(a), 64 - 37 * Math.cos(a))
      ctx.lineTo(64 + 44 * Math.sin(a), 64 - 44 * Math.cos(a))
      ctx.stroke()
    }
    ctx.lineWidth = 4; ctx.lineCap = 'round'
    ctx.beginPath(); ctx.moveTo(64, 64); ctx.lineTo(64, 26); ctx.stroke()
    ctx.lineWidth = 3
    ctx.beginPath(); ctx.moveTo(64, 64); ctx.lineTo(90, 52); ctx.stroke()
    ctx.fillStyle = colorHex
    ctx.beginPath(); ctx.arc(64, 64, 4, 0, Math.PI * 2); ctx.fill()
  } else {
    // Default: $ dollar sign (money/pipeline/paid/etc.)
    ctx.font = 'bold 78px monospace'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('$', 64, 66)
  }

  return c
}

function makePathStepCanvas(pathColorHex: string, stepIndex: number, pathState: string): HTMLCanvasElement {
  const SIZE = 128
  const c = document.createElement('canvas')
  c.width = SIZE; c.height = SIZE
  const ctx = c.getContext('2d')!
  ctx.clearRect(0, 0, SIZE, SIZE)

  const isCurrent = pathState === 'current'
  const isComplete = pathState === 'complete'
  const isStalled  = pathState === 'stalled'
  const isFuture   = pathState === 'future'

  ctx.globalAlpha = isFuture ? 0.38 : 1.0
  const ringColor  = isStalled ? '#ff4444' : pathColorHex

  // Filled bg for complete/current
  if (isComplete || isCurrent) {
    ctx.fillStyle = pathColorHex + (isComplete ? '28' : '18')
    ctx.beginPath(); ctx.arc(64, 64, 46, 0, Math.PI * 2); ctx.fill()
  }

  // Ring
  ctx.strokeStyle = ringColor
  ctx.lineWidth = isCurrent ? 5 : 3
  ctx.beginPath(); ctx.arc(64, 64, 44, 0, Math.PI * 2); ctx.stroke()

  // Step number or checkmark
  ctx.fillStyle = ringColor
  ctx.font = 'bold 38px monospace'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  if (isComplete) {
    ctx.font = 'bold 46px monospace'
    ctx.fillText('✓', 64, 66)
  } else if (isStalled) {
    ctx.fillStyle = '#ff4444'
    ctx.font = 'bold 42px monospace'
    ctx.fillText('!', 64, 66)
  } else {
    ctx.fillText(String(stepIndex + 1), 64, 66)
  }

  // Outer pulse ring for current
  if (isCurrent) {
    ctx.globalAlpha = 0.4
    ctx.strokeStyle = pathColorHex
    ctx.lineWidth = 2
    ctx.beginPath(); ctx.arc(64, 64, 55, 0, Math.PI * 2); ctx.stroke()
  }

  return c
}

function makeGoalStepCanvas(goalColorHex: string, stepIndex: number): HTMLCanvasElement {
  const SIZE = 128
  const c = document.createElement('canvas')
  c.width = SIZE; c.height = SIZE
  const ctx = c.getContext('2d')!
  ctx.clearRect(0, 0, SIZE, SIZE)

  // Diamond background
  ctx.fillStyle = goalColorHex + '22'
  ctx.strokeStyle = goalColorHex
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.moveTo(64, 10); ctx.lineTo(112, 64); ctx.lineTo(64, 118); ctx.lineTo(16, 64)
  ctx.closePath()
  ctx.fill(); ctx.stroke()

  // Inner accent
  ctx.strokeStyle = goalColorHex + '66'
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.moveTo(64, 24); ctx.lineTo(98, 64); ctx.lineTo(64, 104); ctx.lineTo(30, 64)
  ctx.closePath(); ctx.stroke()

  // Step number
  ctx.fillStyle = goalColorHex
  ctx.font = 'bold 38px monospace'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(String(stepIndex + 1), 64, 65)

  return c
}

// ─── Background Layer ─────────────────────────────────────────────────────────
function BackgroundLayer({ mode }: { mode: BgMode }) {
  // FIX B46: canvasRef always rendered (display toggled via CSS) so ref is always assigned
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (mode !== 'datastream') return
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    // Use actual rendered size fallback so canvas.width is never 0
    const W = canvas.clientWidth || canvas.parentElement?.clientWidth || 800
    const H = canvas.clientHeight || canvas.parentElement?.clientHeight || 600
    canvas.width = W; canvas.height = H
    const cols = Math.floor(W / 16)
    const drops: number[] = new Array(cols).fill(0)
    const chars = '01アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホ'
    let frame: number
    function draw() {
      frame = requestAnimationFrame(draw)
      ctx.fillStyle = 'rgba(0,0,0,0.05)'; ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.fillStyle = '#00ff41'; ctx.font = '14px monospace'
      for (let i = 0; i < drops.length; i++) {
        const ch = chars[Math.floor(Math.random() * chars.length)]
        ctx.fillText(ch, i * 16, drops[i] * 16)
        if (drops[i] * 16 > canvas.height && Math.random() > 0.975) drops[i] = 0
        drops[i]++
      }
    }
    draw()
    return () => cancelAnimationFrame(frame)
  }, [mode])

  // Canvas always present in DOM — only visibility toggled — so canvasRef.current is always assigned
  const canvasStyle: React.CSSProperties = {
    position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0.6,
    display: mode === 'datastream' ? 'block' : 'none',
    pointerEvents: 'none',
  }

  if (mode === 'deepspace') {
    return (
      <>
        <canvas ref={canvasRef} style={canvasStyle} />
        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden' }}>
          <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(ellipse at center, #0a0f1e 0%, #020408 100%)' }} />
          {Array.from({ length: 120 }, (_, i) => (
            <div key={i} style={{
              position: 'absolute', left: `${Math.random() * 100}%`, top: `${Math.random() * 100}%`,
              width: Math.random() > 0.8 ? 2 : 1, height: Math.random() > 0.8 ? 2 : 1,
              borderRadius: '50%', backgroundColor: `rgba(255,255,255,${0.3 + Math.random() * 0.7})`,
              animation: `twinkle ${2 + Math.random() * 4}s ease-in-out infinite`,
              animationDelay: `${Math.random() * 4}s`,
            }} />
          ))}
        </div>
      </>
    )
  }
  if (mode === 'datastream') {
    return <canvas ref={canvasRef} style={canvasStyle} />
  }
  if (mode === 'grid') {
    return (
      <>
        <canvas ref={canvasRef} style={canvasStyle} />
        <div style={{
          position: 'absolute', inset: 0, pointerEvents: 'none',
          backgroundImage: 'linear-gradient(rgba(0,255,136,0.07) 1px,transparent 1px),linear-gradient(90deg,rgba(0,255,136,0.07) 1px,transparent 1px)',
          backgroundSize: '40px 40px', animation: 'gridScroll 20s linear infinite',
        }} />
      </>
    )
  }
  return (
    <>
      <canvas ref={canvasRef} style={canvasStyle} />
      <div style={{ position: 'absolute', inset: 0, backgroundColor: '#060608', pointerEvents: 'none' }} />
    </>
  )
}

// ─── Organic Orb ──────────────────────────────────────────────────────────────
function OrganicOrb({ orbState, healthAvg }: { orbState: OrbState; healthAvg: number }) {
  const mountRef = useRef<HTMLDivElement>(null)
  const stateRef = useRef<OrbState>(orbState)
  const healthRef = useRef<number>(healthAvg)
  const orbInitialized = useRef(false)
  useEffect(() => { stateRef.current = orbState }, [orbState])
  useEffect(() => { healthRef.current = healthAvg }, [healthAvg])

  useEffect(() => {
    const mount = mountRef.current; if (!mount) return
    let animFrame: number, renderer: THREE.WebGLRenderer, ro: ResizeObserver, io: IntersectionObserver
    const satellites: THREE.Mesh[] = [], satLabelDivs: HTMLDivElement[] = []
    function removeSatellites() {
      satellites.forEach((s) => { s.geometry.dispose(); (s.material as THREE.Material).dispose() })
      satellites.length = 0
      satLabelDivs.forEach((d) => { if (d.parentNode) d.parentNode.removeChild(d) })
      satLabelDivs.length = 0
    }
    function doInit() {
      if (orbInitialized.current) return
      orbInitialized.current = true
      const W = Math.max(mount.clientWidth || 800, 100), H = Math.max(mount.clientHeight || 600, 100)
      const scene = new THREE.Scene()
      const camera = new THREE.PerspectiveCamera(60, W / H, 0.1, 100); camera.position.z = 3
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
      renderer.setSize(W, H); renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
      renderer.setClearColor(0x000000, 0)
      renderer.domElement.style.position = 'absolute'
      renderer.domElement.style.zIndex = '1'
      mount.appendChild(renderer.domElement)

      const PCOUNT = 2000
      const positions = new Float32Array(PCOUNT * 3), origPositions = new Float32Array(PCOUNT * 3)
      const drifts = new Float32Array(PCOUNT * 3)
      for (let i = 0; i < PCOUNT; i++) {
        const phi = Math.acos(2 * Math.random() - 1), theta = 2 * Math.PI * Math.random()
        const r = 0.82 + Math.random() * 0.18
        const x = r * Math.sin(phi) * Math.cos(theta), y = r * Math.sin(phi) * Math.sin(theta), z = r * Math.cos(phi)
        positions[i*3]=origPositions[i*3]=x; positions[i*3+1]=origPositions[i*3+1]=y; positions[i*3+2]=origPositions[i*3+2]=z
        drifts[i*3]=(Math.random()-0.5)*0.0015; drifts[i*3+1]=(Math.random()-0.5)*0.0015; drifts[i*3+2]=(Math.random()-0.5)*0.0015
      }
      const pGeo = new THREE.BufferGeometry()
      pGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
      const pMat = new THREE.PointsMaterial({ color: 0x00ff88, size: 0.014, transparent: true, opacity: 0.85, sizeAttenuation: true })
      const particles = new THREE.Points(pGeo, pMat); scene.add(particles)
      const coreGeo = new THREE.SphereGeometry(0.15, 16, 16)
      const coreMat = new THREE.MeshBasicMaterial({ color: 0x00ff88, transparent: true, opacity: 0.3 })
      const core = new THREE.Mesh(coreGeo, coreMat); scene.add(core)
      const branchGroup = new THREE.Group(); scene.add(branchGroup)

      function buildBranches(count: number, color: number, opacity: number) {
        while (branchGroup.children.length) {
          const child = branchGroup.children[0] as THREE.Line
          child.geometry?.dispose(); (child.material as THREE.Material)?.dispose(); branchGroup.remove(child)
        }
        const maxDist = 0.38; let added = 0
        for (let i = 0; i < PCOUNT && added < count; i += 3) {
          for (let j = i + 3; j < PCOUNT && added < count; j += 3) {
            const dx=origPositions[i*3]-origPositions[j*3], dy=origPositions[i*3+1]-origPositions[j*3+1], dz=origPositions[i*3+2]-origPositions[j*3+2]
            if (dx*dx+dy*dy+dz*dz < maxDist*maxDist) {
              const geo = new THREE.BufferGeometry()
              const pts = new Float32Array([origPositions[i*3],origPositions[i*3+1],origPositions[i*3+2],origPositions[j*3],origPositions[j*3+1],origPositions[j*3+2]])
              geo.setAttribute('position', new THREE.BufferAttribute(pts, 3))
              branchGroup.add(new THREE.Line(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity }))); added++
            }
          }
        }
      }

      const satAngles = TIER_COLORS_INT.map((_, i) => (i / 5) * Math.PI * 2)
      function buildSatellites(departure: DepartureMode) {
        removeSatellites()
        TIER_COLORS_INT.forEach((color, i) => {
          const geo = new THREE.SphereGeometry(0.055, 12, 12)
          const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9 })
          const mesh = new THREE.Mesh(geo, mat); scene.add(mesh); satellites.push(mesh)
          if (departure === 'label') {
            const div = document.createElement('div')
            div.style.cssText = `position:absolute;font-size:9px;color:${TIER_COLORS_HEX[i]};font-weight:700;letter-spacing:0.05em;pointer-events:none;text-shadow:0 0 6px ${TIER_COLORS_HEX[i]};white-space:nowrap;font-family:monospace;`
            div.textContent = `T${i+1}`; mount.appendChild(div); satLabelDivs.push(div)
          }
        })
      }
      const ringGroup = new THREE.Group(); scene.add(ringGroup)
      let lastState: OrbState = 'IDLE', lastHealth = 75, lastDeparture: DepartureMode = 'silent', time = 0, rotY = 0
      buildBranches(160, 0x00ff88, 0.28)

      function animate() {
        animFrame = requestAnimationFrame(animate); time += 0.016
        const pulse = Math.sin(time * 2) * 0.5 + 0.5, state = stateRef.current, avg = healthRef.current, clr = healthColorInt(avg)
        if (Math.abs(avg - lastHealth) > 5) { lastHealth = avg; buildBranches(avg>70?180:avg>40?100:50,clr,avg>70?0.3:avg>40?0.18:0.1) }
        if (state !== lastState) { if (state==='MULTI_AGENT') buildSatellites(lastDeparture); else removeSatellites(); lastState=state }
        switch (state) {
          case 'IDLE': rotY+=0.003; pMat.color.setHex(clr); coreMat.color.setHex(clr); coreMat.opacity=0.2+pulse*0.15; pMat.size=0.013+pulse*0.003; break
          case 'LISTENING': rotY+=0.001; pMat.color.setHex(0x0088ff); coreMat.color.setHex(0x0088ff); coreMat.opacity=0.35+pulse*0.2
            for (let i=0;i<PCOUNT;i++) { positions[i*3]*=0.9998; positions[i*3+1]*=0.9998; positions[i*3+2]*=0.9998; const len=Math.sqrt(positions[i*3]**2+positions[i*3+1]**2+positions[i*3+2]**2); if(len<0.4){const phi2=Math.acos(2*Math.random()-1);const theta2=2*Math.PI*Math.random();positions[i*3]=0.95*Math.sin(phi2)*Math.cos(theta2);positions[i*3+1]=0.95*Math.sin(phi2)*Math.sin(theta2);positions[i*3+2]=0.95*Math.cos(phi2)} }
            pGeo.attributes.position.needsUpdate=true; break
          case 'THINKING': rotY+=0.012; pMat.color.setHex(0xffaa00); coreMat.color.setHex(0xffaa00); coreMat.opacity=0.5+pulse*0.3; pMat.size=0.011; break
          case 'SPEAKING': { rotY+=0.005; pMat.color.setHex(0x00ffcc); coreMat.color.setHex(0x00ffcc); coreMat.opacity=0.4+Math.sin(time*8)*0.2; pMat.size=0.014+Math.sin(time*8)*0.007
            if(ringGroup.children.length<4){const rGeo=new THREE.TorusGeometry(0.1+ringGroup.children.length*0.3,0.005,6,32);const rMat=new THREE.MeshBasicMaterial({color:0x00ffcc,transparent:true,opacity:0.5});ringGroup.add(new THREE.Mesh(rGeo,rMat))}
            ringGroup.children.forEach((child,idx)=>{const torus=child as THREE.Mesh;const s=1+((time*0.5+idx*0.25)%1)*3;torus.scale.setScalar(s);(torus.material as THREE.MeshBasicMaterial).opacity=Math.max(0,0.5-s*0.15)}); break }
          case 'MULTI_AGENT': rotY+=0.004; pMat.color.setHex(clr); coreMat.color.setHex(clr); coreMat.opacity=0.3+pulse*0.1
            satellites.forEach((sat,i)=>{ satAngles[i]+=0.018*(1+i*0.15); const orbitR=1.35+i*0.09; sat.position.x=Math.cos(satAngles[i])*orbitR; sat.position.y=Math.sin(satAngles[i]*0.6)*0.55; sat.position.z=Math.sin(satAngles[i])*orbitR; sat.scale.setScalar(0.7+pulse*0.5); (sat.material as THREE.MeshBasicMaterial).opacity=0.7+pulse*0.25
              const label=satLabelDivs[i]; if(label){const p=sat.position.clone().project(camera);label.style.left=((p.x+1)/2*(mount.clientWidth||400)+14)+'px';label.style.top=((-p.y+1)/2*(mount.clientHeight||400))+'px'} }); break
        }
        if (state!=='LISTENING') { for(let i=0;i<PCOUNT;i++){positions[i*3]+=drifts[i*3];positions[i*3+1]+=drifts[i*3+1];positions[i*3+2]+=drifts[i*3+2];const dx=origPositions[i*3]-positions[i*3];const dy=origPositions[i*3+1]-positions[i*3+1];const dz=origPositions[i*3+2]-positions[i*3+2];const dist=Math.sqrt(dx*dx+dy*dy+dz*dz);if(dist>0.12){drifts[i*3]+=dx*0.00008;drifts[i*3+1]+=dy*0.00008;drifts[i*3+2]+=dz*0.00008}} pGeo.attributes.position.needsUpdate=true }
        particles.rotation.y=rotY; particles.rotation.x=Math.sin(time*0.4)*0.08
        branchGroup.rotation.y=rotY; branchGroup.rotation.x=Math.sin(time*0.4)*0.08
        renderer.render(scene, camera)
      }
      animate()
      ro = new ResizeObserver(() => { if(!mount)return; const w=mount.clientWidth,h=mount.clientHeight; if(!w||!h)return; camera.aspect=w/h; camera.updateProjectionMatrix(); renderer.setSize(w,h) }); ro.observe(mount)
    }
    io = new IntersectionObserver((entries) => { if(entries[0].isIntersecting && mount.clientWidth>0) doInit() }, { threshold: 0 }); io.observe(mount)
    // FIX B46: defer doInit by one rAF so flex layout is fully computed before reading clientWidth/Height
    requestAnimationFrame(() => doInit())
    return () => { if(io)io.disconnect(); if(animFrame)cancelAnimationFrame(animFrame); if(ro)ro.disconnect(); removeSatellites(); if(renderer){renderer.dispose(); if(mount&&mount.contains(renderer.domElement))mount.removeChild(renderer.domElement)} }
  }, [])

  return <div ref={mountRef} style={{ width: '100%', height: 'calc(100vh - 160px)', position: 'relative', overflow: 'hidden' }} />
}

// ─── Geometric Orb ────────────────────────────────────────────────────────────
function GeometricOrb({ orbState, healthAvg }: { orbState: OrbState; healthAvg: number }) {
  const mountRef = useRef<HTMLDivElement>(null)
  const stateRef = useRef<OrbState>(orbState)
  const healthRef = useRef<number>(healthAvg)
  const orbInitialized = useRef(false)
  useEffect(() => { stateRef.current = orbState }, [orbState])
  useEffect(() => { healthRef.current = healthAvg }, [healthAvg])

  useEffect(() => {
    const mount = mountRef.current; if (!mount) return
    let animFrame: number, renderer: THREE.WebGLRenderer, ro: ResizeObserver, io: IntersectionObserver
    function doInit() {
      if (orbInitialized.current) return
      orbInitialized.current = true
      const W=Math.max(mount.clientWidth||800,100), H=Math.max(mount.clientHeight||600,100)
      const scene=new THREE.Scene(); const camera=new THREE.PerspectiveCamera(60,W/H,0.1,100); camera.position.z=3
      renderer=new THREE.WebGLRenderer({antialias:true,alpha:true}); renderer.setSize(W,H); renderer.setPixelRatio(Math.min(window.devicePixelRatio,2)); renderer.setClearColor(0x000000,0)
      renderer.domElement.style.position='absolute'; renderer.domElement.style.zIndex='1'
      mount.appendChild(renderer.domElement)
      const icoGeo=new THREE.IcosahedronGeometry(1,2); const icoEdges=new THREE.EdgesGeometry(icoGeo)
      const icoMat=new THREE.LineBasicMaterial({color:0x00ff88,transparent:true,opacity:0.7}); const wireframe=new THREE.LineSegments(icoEdges,icoMat); scene.add(wireframe)
      const coreGeo2=new THREE.IcosahedronGeometry(0.45,1); const coreEdges=new THREE.EdgesGeometry(coreGeo2)
      const coreMat2=new THREE.LineBasicMaterial({color:0x00ff88,transparent:true,opacity:0.4}); const innerWire=new THREE.LineSegments(coreEdges,coreMat2); scene.add(innerWire)
      const faceMat=new THREE.MeshBasicMaterial({color:0x00ffcc,transparent:true,opacity:0.0,side:THREE.FrontSide})
      const solidMesh=new THREE.Mesh(new THREE.IcosahedronGeometry(1,2),faceMat); scene.add(solidMesh)
      const outerMat=new THREE.LineBasicMaterial({color:0x00ff88,transparent:true,opacity:0.2})
      const outerWire=new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(1.05,0)),outerMat); scene.add(outerWire)
      let time=0
      function animate() {
        animFrame=requestAnimationFrame(animate); time+=0.016
        const pulse=Math.sin(time*2)*0.5+0.5, state=stateRef.current, avg=healthRef.current, clr=healthColorInt(avg)
        icoMat.color.setHex(clr); coreMat2.color.setHex(clr)
        outerMat.opacity=avg>70?0.3+pulse*0.1:avg>40?0.15+pulse*0.08:0.05
        switch(state){
          case 'IDLE': wireframe.rotation.y+=0.005; wireframe.rotation.x+=0.002; innerWire.rotation.y-=0.004; innerWire.rotation.x-=0.002; icoMat.opacity=0.6+pulse*0.15; faceMat.opacity=0; wireframe.scale.setScalar(1); break
          case 'LISTENING': wireframe.rotation.y+=0.001; wireframe.scale.y=0.85+pulse*0.1; wireframe.scale.x=1+pulse*0.05; icoMat.opacity=0.5; faceMat.opacity=0.06+pulse*0.04; faceMat.color.setHex(0x0088ff); icoMat.color.setHex(0x0088ff); coreMat2.color.setHex(0x0088ff); break
          case 'THINKING': wireframe.rotation.y+=0.018; wireframe.rotation.z+=0.009; innerWire.rotation.y-=0.015; icoMat.opacity=0.8+pulse*0.2; faceMat.opacity=0.12+pulse*0.08; faceMat.color.setHex(0xffaa00); icoMat.color.setHex(0xffaa00); coreMat2.color.setHex(0xffaa00); break
          case 'SPEAKING': { wireframe.rotation.y+=0.006; const wave=Math.sin(time*8); const scl=1+wave*0.08; wireframe.scale.setScalar(scl); solidMesh.scale.setScalar(scl*0.98); faceMat.opacity=0.08+(wave*0.5+0.5)*0.12; faceMat.color.setHex(0x00ffcc); icoMat.color.setHex(0x00ffcc); coreMat2.color.setHex(0x00ffcc); icoMat.opacity=0.7+(wave*0.5+0.5)*0.2; break }
          case 'MULTI_AGENT': wireframe.rotation.y+=0.005; wireframe.rotation.z=Math.sin(time*0.5)*0.3; icoMat.color.setHex(clr); icoMat.opacity=0.65+pulse*0.15; faceMat.opacity=0.05+pulse*0.07; faceMat.color.setHex(clr); break
        }
        outerWire.rotation.copy(wireframe.rotation); outerWire.scale.copy(wireframe.scale)
        innerWire.rotation.y=-wireframe.rotation.y*0.8; innerWire.rotation.x=wireframe.rotation.x*0.6
        solidMesh.rotation.copy(wireframe.rotation); renderer.render(scene,camera)
      }
      animate()
      ro=new ResizeObserver(()=>{if(!mount)return;const w=mount.clientWidth,h=mount.clientHeight;if(!w||!h)return;camera.aspect=w/h;camera.updateProjectionMatrix();renderer.setSize(w,h)}); ro.observe(mount)
    }
    io=new IntersectionObserver((entries)=>{if(entries[0].isIntersecting&&mount.clientWidth>0)doInit()},{threshold:0}); io.observe(mount)
    // FIX B46: defer doInit by one rAF so flex layout is fully computed before reading clientWidth/Height
    requestAnimationFrame(() => doInit())
    return ()=>{if(io)io.disconnect();if(animFrame)cancelAnimationFrame(animFrame);if(ro)ro.disconnect();if(renderer){renderer.dispose();if(mount&&mount.contains(renderer.domElement))mount.removeChild(renderer.domElement)}}
  }, [])

  return <div ref={mountRef} style={{ width: '100%', height: 'calc(100vh - 160px)', position: 'relative', overflow: 'hidden' }} />
}

// ─── Orb Lab ──────────────────────────────────────────────────────────────────
function OrbLab({ healthAvg }: { healthAvg: number }) {
  const [orbState, setOrbState] = useState<OrbState>('IDLE')
  const setOrbLabActive = useUIStore((s) => s.setOrbLabActive)
  // B50: Mic state
  const [micActive, setMicActive] = useState(false)
  const [micStream, setMicStream] = useState<MediaStream | null>(null)
  const micStreamRef = useRef<MediaStream | null>(null)
  // B53: NEXUS voice state for audio-reactive visuals
  const [voiceStatus, setVoiceStatus] = useState<VoiceSessionStatus>('inactive')
  const [ttsElement, setTtsElement] = useState<HTMLAudioElement | null>(null)
  // B56 FIX 2: status text replaces full chat panel in ORB LAB
  const [nexusStatusText, setNexusStatusText] = useState<string | null>(null)
  // FIX-ORB: mic error message shown inside ORB LAB panel
  const [micError, setMicError] = useState<string | null>(null)

  // FIX-ORB: auth context — ensure voice subsystem is initialized with orgId+userId
  const { user, profile } = useAuthStore()

  // B62: Set orbLabActive flag on mount so floating NEXUS mic is hidden
  useEffect(() => {
    setOrbLabActive(true)
    return () => setOrbLabActive(false)
  }, [setOrbLabActive])

  // FIX-ORB: Initialize voice subsystem on mount if auth is available.
  // VoiceActivationButton normally owns initialization, but when orbLabActive=true
  // the floating NEXUS mic is hidden — so OrbLab must ensure the singleton is ready
  // before calling startRecording(). initialize() is idempotent-safe (re-calling is harmless).
  useEffect(() => {
    const orgId  = (profile as any)?.org_id as string | undefined
    const userId = (user as any)?.id as string | undefined
    if (!orgId || !userId) return
    const voice = getVoiceSubsystem()
    voice.initialize({ orgId, userId }).catch((err: unknown) => {
      console.warn('[OrbLab] Voice subsystem init failed:', err)
    })
  }, [(user as any)?.id, (profile as any)?.org_id])

  // B53+B56: Subscribe to NEXUS voice status so micStream + nexusState stay in sync.
  // B56 FIX 3: ttsElement is now set via onTTSAudioChange (fires after audio is created),
  // not getCurrentAudio() inside onOrbStateChange (which fires before audio exists).
  // FIX-ORB: also subscribe to voice.on() so error event payloads surface in OrbLab UI.
  useEffect(() => {
    const unsubOrb = onOrbStateChange((status: VoiceSessionStatus) => {
      setVoiceStatus(status)
      const vs = getVoiceSubsystem()
      const ms = vs.getMicStream()
      if (ms && ms !== micStreamRef.current) {
        micStreamRef.current = ms
        setMicStream(ms)
      }
      // B57 FIX 1: only reset orbLabMode on 'inactive' — NOT on 'complete'.
      // 'complete' fired before session_complete event in B56, causing isOrbLabMode()
      // to return false by the time VoiceActivationButton checked it, opening the drawer.
      // Now session_complete fires before setStatus('inactive'), keeping orbLabMode true
      // through the drawer-suppression check.
      if (status === 'inactive') {
        setMicActive(false)
        setOrbLabMode(false)
        setNexusStatusText('IDLE')
        micStreamRef.current = null; setMicStream(null)
      } else if (status === 'complete') {
        setMicActive(false)
        setNexusStatusText(null)
      } else if (status === 'recording' || status === 'listening') {
        setMicActive(true)
        setMicError(null)
        setNexusStatusText('LISTENING')
      } else if (status === 'transcribing' || status === 'processing') {
        setNexusStatusText('PROCESSING')
      } else if (status === 'responding') {
        setNexusStatusText('SPEAKING')
      } else if (status === 'error') {
        // FIX-ORB: error status — reset mic, clear orbLabMode, show IDLE label
        setMicActive(false)
        setOrbLabMode(false)
        setNexusStatusText('IDLE')
        micStreamRef.current = null; setMicStream(null)
      }
    })
    // B56 FIX 1+3: subscribe to TTS audio element — fires when audio is actually created,
    // giving useNEXUSAudio a valid HTMLAudioElement to connect to AudioContext analyser.
    const unsubTTS = onTTSAudioChange((audio: HTMLAudioElement | null) => {
      setTtsElement(audio)
    })
    // FIX-ORB: subscribe to voice error events to capture the human-readable error string
    // (e.g. "Microphone access blocked." / "Microphone requires HTTPS").
    // voice.on() fires for ALL events; we only act on 'error' here.
    const unsubVoiceEvents = getVoiceSubsystem().on((event: any) => {
      if (event.type === 'error') {
        const msg = typeof event.data?.error === 'string'
          ? event.data.error
          : 'Mic error — check browser permissions.'
        setMicError(msg)
        // Auto-dismiss error after 6 seconds so it doesn't linger
        setTimeout(() => setMicError(null), 6000)
      }
    })
    return () => { unsubOrb(); unsubTTS(); unsubVoiceEvents() }
  }, [])

  // B53+B56: handleMicToggle routes through NEXUS voice pipeline.
  // B56 FIX 2: sets orbLabMode=true so drawer stays closed (pure-visual mode).
  const handleMicToggle = async () => {
    const voice = getVoiceSubsystem()
    setMicError(null)
    if (micActive) {
      setOrbLabMode(false)
      if (voiceStatus === 'recording') { await voice.stopRecording() }
      else if (voiceStatus === 'responding') { try { await voice.stopSpeaking() } catch {} }
      setMicActive(false)
      micStreamRef.current = null; setMicStream(null)
      setOrbState('IDLE')
      setNexusStatusText('IDLE')
    } else {
      try {
        unlockAudioContext()
        setOrbLabMode(true) // B56: suppress NEXUS drawer — ORB LAB is pure-visual
        voice.setConversationHistory([])
        await voice.startRecording('normal')
        setMicActive(true)
        setOrbState('LISTENING')
      } catch (e) {
        setOrbLabMode(false)
        const errMsg = e instanceof Error ? e.message : 'Mic error — check browser permissions.'
        setMicError(errMsg)
        // Auto-dismiss after 6 seconds
        setTimeout(() => setMicError(null), 6000)
        console.warn('[OrbLab] NEXUS voice start failed', e)
      }
    }
  }

  // FIX-ORB: map nexusStatusText label color for LISTENING/PROCESSING/SPEAKING/IDLE
  const statusColor =
    nexusStatusText === 'LISTENING'   ? '#22c55e' :
    nexusStatusText === 'PROCESSING'  ? '#3A8EFF' :
    nexusStatusText === 'SPEAKING'    ? '#7c3aed' : '#4b5563'
  const statusBg =
    nexusStatusText === 'LISTENING'   ? 'rgba(34,197,94,0.10)' :
    nexusStatusText === 'PROCESSING'  ? 'rgba(58,142,255,0.12)' :
    nexusStatusText === 'SPEAKING'    ? 'rgba(124,58,237,0.12)' : 'rgba(75,85,99,0.10)'
  const statusBorder =
    nexusStatusText === 'LISTENING'   ? 'rgba(34,197,94,0.30)' :
    nexusStatusText === 'PROCESSING'  ? 'rgba(58,142,255,0.30)' :
    nexusStatusText === 'SPEAKING'    ? 'rgba(124,58,237,0.30)' : 'rgba(75,85,99,0.20)'

  // B62: Full-screen layout — canvas + 72px bar = 100% height, zero scrolling
  return (
    <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden', position:'relative' }}>
      {/* FIX-ORB: mic error banner — shown inside ORB LAB when mic permission denied or pipeline fails */}
      {micError && (
        <div style={{
          position: 'absolute', top: 10, left: '50%', transform: 'translateX(-50%)',
          zIndex: 100, backgroundColor: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.45)',
          borderRadius: 7, padding: '8px 16px', display: 'flex', alignItems: 'center', gap: 8,
          fontFamily: 'Courier New, monospace', fontSize: 11, color: '#fca5a5',
          backdropFilter: 'blur(8px)', boxShadow: '0 4px 16px rgba(0,0,0,0.6)',
          maxWidth: 480, textAlign: 'center',
        }}>
          <span style={{ fontSize: 14, flexShrink: 0 }}>⚠️</span>
          <span>{micError}</span>
          <button
            onClick={() => setMicError(null)}
            style={{ background:'none', border:'none', color:'#f87171', cursor:'pointer', fontSize:13, flexShrink:0, padding:'0 2px' }}
          >✕</button>
        </div>
      )}
      <VisualSuitePanel
        micStream={micStream}
        ttsElement={ttsElement}
        nexusState={
          voiceStatus === 'recording'    ? 'listening'  :
          voiceStatus === 'transcribing' ? 'thinking'   :
          voiceStatus === 'processing'   ? 'thinking'   :
          voiceStatus === 'responding'   ? 'speaking'   :
          micActive                      ? 'listening'  : 'idle'
        }
        onMicToggle={handleMicToggle}
        micActive={micActive}
        nexusStatusText={nexusStatusText}
        nexusStatusColor={statusColor}
        nexusStatusBg={statusBg}
        nexusStatusBorder={statusBorder}
      />
    </div>
  )
}

// Create a THREE.Sprite from a canvas node descriptor
function createNodeSprite(n: NNode): THREE.Sprite {
  let canvas: HTMLCanvasElement

  if (n.type === 'agent') {
    const tierHex = TIER_COLORS_HEX[Math.min((n.meta?.tier ?? 1) - 1, 4)]
    canvas = makeAgentChipCanvas(tierHex, n.id === 'ag_NEXUS')
  } else if (n.type === 'project') {
    const h = n.meta?.healthScore ?? 75
    const hc = h > 70 ? '#00ff88' : h > 40 ? '#ffcc00' : '#ff6600'
    canvas = makeProjectHardHatCanvas(hc)
  } else if (n.type === 'decision') {
    const fb = n.meta?.feedback ?? 0
    const dc = fb > 0 ? '#00cc55' : fb < 0 ? '#ff4444' : '#555577'
    canvas = makeDecisionGavelCanvas(dc)
  } else if (n.type === 'pathstep') {
    canvas = makePathStepCanvas(
      n.meta?.pathColor || '#00ff88',
      n.meta?.stepIndex || 0,
      n.meta?.pathState || 'future',
    )
  } else if (n.type === 'goalstep') {
    canvas = makeGoalStepCanvas(n.meta?.goalColor || '#7c3aed', n.meta?.stepIndex || 0)
  } else {
    // data node — dollar sign or domain icon
    const mt = n.meta?.metricType || ''
    const clrHex = '#' + n.color.toString(16).padStart(6, '0')
    canvas = makeDataIconCanvas(mt, clrHex)
  }

  const texture = new THREE.CanvasTexture(canvas)
  const mat = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false })
  const sprite = new THREE.Sprite(mat)
  return sprite
}

// ─── GoalPathsDrawer (Feature 4) ─────────────────────────────────────────────
function GoalPathsDrawer({
  open,
  onClose,
  onProfilesChange,
}: {
  open: boolean
  onClose: () => void
  onProfilesChange: (profiles: GoalProfile[]) => void
}) {
  const [profiles, setProfiles] = useState<GoalProfile[]>([])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState<Partial<GoalProfile>>({})

  useEffect(() => {
    try {
      const saved = localStorage.getItem(GOAL_STORAGE_KEY)
      if (saved) setProfiles(JSON.parse(saved))
    } catch {}
  }, [])

  const saveProfiles = useCallback((next: GoalProfile[]) => {
    setProfiles(next)
    try { localStorage.setItem(GOAL_STORAGE_KEY, JSON.stringify(next)) } catch {}
    onProfilesChange(next)
  }, [onProfilesChange])

  const newProfile = () => {
    if (profiles.length >= 10) return
    const id = Date.now().toString()
    const color = GOAL_PROFILE_COLORS[profiles.length % GOAL_PROFILE_COLORS.length]
    setDraft({ id, name: 'New Scenario', color, startingPoint: 'current', startingCapital: 50000, startingRevenue: 20000, startingTeamSize: 2, targetAmount: 500000, timeHorizonMonths: 24, scenarioFactors: [], notes: '', active: false })
    setEditingId(id)
  }

  const saveDraft = () => {
    if (!draft.id) return
    const full: GoalProfile = {
      id: draft.id, name: draft.name || 'Scenario', color: draft.color || '#7c3aed',
      startingPoint: draft.startingPoint || 'current', startingCapital: draft.startingCapital || 0,
      startingRevenue: draft.startingRevenue || 0, startingTeamSize: draft.startingTeamSize || 1,
      targetAmount: draft.targetAmount || 100000, timeHorizonMonths: draft.timeHorizonMonths || 12,
      scenarioFactors: draft.scenarioFactors || [], notes: draft.notes || '', active: draft.active || false,
    }
    const existing = profiles.find((p) => p.id === full.id)
    const next = existing ? profiles.map((p) => p.id === full.id ? full : p) : [...profiles, full]
    saveProfiles(next)
    setEditingId(null)
    setDraft({})
  }

  const toggleActive = (id: string) => {
    saveProfiles(profiles.map((p) => p.id === id ? { ...p, active: !p.active } : p))
  }
  const deleteProfile = (id: string) => {
    saveProfiles(profiles.filter((p) => p.id !== id))
    if (editingId === id) { setEditingId(null); setDraft({}) }
  }

  const toggleFactor = (factor: string) => {
    const factors = draft.scenarioFactors || []
    setDraft({ ...draft, scenarioFactors: factors.includes(factor) ? factors.filter((f) => f !== factor) : [...factors, factor] })
  }

  const inputStyle = { background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 5, color: '#e2e8f0', fontSize: 11, padding: '5px 8px', width: '100%', boxSizing: 'border-box' as const }
  const labelStyle = { fontSize: 9, color: '#6b7280', textTransform: 'uppercase' as const, letterSpacing: '0.07em', marginBottom: 3 }

  if (!open) return null

  return (
    <div style={{ position: 'absolute', top: 0, left: 0, bottom: 0, width: 320, zIndex: 50, background: 'rgba(4,8,18,0.97)', borderRight: '1px solid rgba(255,255,255,0.08)', display: 'flex', flexDirection: 'column', fontFamily: 'ui-monospace,monospace', animation: 'gpSlideIn 0.25s ease-out' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px', borderBottom: '1px solid rgba(255,255,255,0.07)', flexShrink: 0 }}>
        <div>
          <div style={{ fontSize: 9, color: '#7c3aed', textTransform: 'uppercase', letterSpacing: '0.08em' }}>B42 · Feature 4</div>
          <div style={{ fontSize: 13, fontWeight: 800, color: '#e2e8f0' }}>Goal Paths</div>
        </div>
        <button onClick={onClose} style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: '#9ca3af', borderRadius: 5, padding: '4px 8px', fontSize: 12, cursor: 'pointer' }}>✕</button>
      </div>

      {/* Profile list */}
      <div style={{ flex: 1, overflow: 'auto', padding: '10px 12px' }}>
        {profiles.map((p) => (
          <div key={p.id} style={{ marginBottom: 10, borderRadius: 8, border: `1px solid ${p.color}44`, background: p.active ? `${p.color}12` : 'rgba(255,255,255,0.03)', padding: '8px 10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <div style={{ width: 10, height: 10, borderRadius: '50%', background: p.color, flexShrink: 0 }} />
              <span style={{ flex: 1, fontSize: 11, fontWeight: 700, color: '#e2e8f0' }}>{p.name}</span>
              {/* Active toggle */}
              <div onClick={() => toggleActive(p.id)} style={{ width: 28, height: 14, borderRadius: 7, background: p.active ? p.color : 'rgba(255,255,255,0.12)', cursor: 'pointer', position: 'relative', transition: 'background 0.2s', flexShrink: 0 }}>
                <div style={{ position: 'absolute', top: 2, left: p.active ? 16 : 2, width: 10, height: 10, borderRadius: '50%', background: '#fff', transition: 'left 0.2s' }} />
              </div>
            </div>
            <div style={{ fontSize: 9, color: '#6b7280' }}>
              Target: ${(p.targetAmount / 1000).toFixed(0)}k · {p.timeHorizonMonths}mo · {p.startingPoint === 'current' ? 'Current State' : 'Fictional Entry'}
            </div>
            {p.scenarioFactors.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginTop: 4 }}>
                {p.scenarioFactors.map((f) => (
                  <span key={f} style={{ fontSize: 8, padding: '1px 5px', borderRadius: 10, background: `${p.color}22`, color: p.color, border: `1px solid ${p.color}44` }}>{f}</span>
                ))}
              </div>
            )}
            <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
              <button onClick={() => { setDraft({ ...p }); setEditingId(p.id) }} style={{ flex: 1, fontSize: 9, padding: '3px 0', borderRadius: 4, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: '#9ca3af', cursor: 'pointer' }}>Edit</button>
              <button onClick={() => deleteProfile(p.id)} style={{ fontSize: 9, padding: '3px 8px', borderRadius: 4, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', color: '#f87171', cursor: 'pointer' }}>✕</button>
            </div>
          </div>
        ))}

        {profiles.length < 10 && (
          <button onClick={newProfile} style={{ width: '100%', padding: '8px', borderRadius: 6, border: '1px dashed rgba(124,58,237,0.4)', background: 'transparent', color: '#7c3aed', fontSize: 10, fontWeight: 700, cursor: 'pointer', letterSpacing: '0.05em' }}>+ New Profile ({profiles.length}/10)</button>
        )}

        {/* Edit form */}
        {editingId && (
          <div style={{ marginTop: 14, padding: '12px', borderRadius: 8, border: '1px solid rgba(124,58,237,0.3)', background: 'rgba(124,58,237,0.05)' }}>
            <div style={{ fontSize: 10, fontWeight: 800, color: '#a78bfa', marginBottom: 12 }}>Edit Profile</div>

            <div style={{ marginBottom: 8 }}><div style={labelStyle}>Profile Name</div><input value={draft.name || ''} onChange={(e) => setDraft({ ...draft, name: e.target.value })} style={inputStyle} /></div>

            <div style={{ marginBottom: 8 }}><div style={labelStyle}>Color</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {GOAL_PROFILE_COLORS.map((c) => (
                  <div key={c} onClick={() => setDraft({ ...draft, color: c })} style={{ width: 16, height: 16, borderRadius: '50%', background: c, cursor: 'pointer', outline: draft.color === c ? `2px solid #fff` : 'none', outlineOffset: 1 }} />
                ))}
              </div>
            </div>

            <div style={{ marginBottom: 8 }}><div style={labelStyle}>Starting Point</div>
              <div style={{ display: 'flex', gap: 6 }}>
                {(['current', 'fictional'] as const).map((sp) => (
                  <button key={sp} onClick={() => setDraft({ ...draft, startingPoint: sp })} style={{ flex: 1, fontSize: 9, padding: '4px', borderRadius: 4, border: `1px solid ${draft.startingPoint === sp ? '#7c3aed' : 'rgba(255,255,255,0.1)'}`, background: draft.startingPoint === sp ? 'rgba(124,58,237,0.2)' : 'transparent', color: draft.startingPoint === sp ? '#a78bfa' : '#6b7280', cursor: 'pointer' }}>{sp === 'current' ? 'Current State' : 'Fictional Entry'}</button>
                ))}
              </div>
            </div>

            {draft.startingPoint === 'fictional' && (
              <div style={{ marginBottom: 8, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                <div><div style={labelStyle}>Start Capital ($)</div><input type="number" value={draft.startingCapital || 0} onChange={(e) => setDraft({ ...draft, startingCapital: Number(e.target.value) })} style={inputStyle} /></div>
                <div><div style={labelStyle}>Start Revenue ($)</div><input type="number" value={draft.startingRevenue || 0} onChange={(e) => setDraft({ ...draft, startingRevenue: Number(e.target.value) })} style={inputStyle} /></div>
                <div><div style={labelStyle}>Team Size</div><input type="number" value={draft.startingTeamSize || 1} onChange={(e) => setDraft({ ...draft, startingTeamSize: Number(e.target.value) })} style={inputStyle} /></div>
              </div>
            )}

            <div style={{ marginBottom: 8, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
              <div><div style={labelStyle}>Target Amount ($)</div><input type="number" value={draft.targetAmount || 0} onChange={(e) => setDraft({ ...draft, targetAmount: Number(e.target.value) })} style={inputStyle} /></div>
              <div><div style={labelStyle}>Time Horizon (months)</div><input type="number" min={12} max={240} value={draft.timeHorizonMonths || 12} onChange={(e) => setDraft({ ...draft, timeHorizonMonths: Number(e.target.value) })} style={inputStyle} /></div>
            </div>

            <div style={{ marginBottom: 8 }}><div style={labelStyle}>Scenario Factors</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                {SCENARIO_FACTORS.map((f) => {
                  const active = (draft.scenarioFactors || []).includes(f)
                  return <button key={f} onClick={() => toggleFactor(f)} style={{ fontSize: 8, padding: '3px 7px', borderRadius: 10, border: `1px solid ${active ? (draft.color || '#7c3aed') : 'rgba(255,255,255,0.1)'}`, background: active ? `${draft.color || '#7c3aed'}22` : 'transparent', color: active ? (draft.color || '#a78bfa') : '#6b7280', cursor: 'pointer' }}>{f}</button>
                })}
              </div>
            </div>

            <div style={{ marginBottom: 10 }}><div style={labelStyle}>Notes</div><textarea value={draft.notes || ''} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} rows={2} style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }} /></div>

            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={saveDraft} style={{ flex: 1, padding: '6px', borderRadius: 5, background: '#7c3aed', border: 'none', color: '#fff', fontSize: 10, fontWeight: 700, cursor: 'pointer' }}>Save Profile</button>
              <button onClick={() => { setEditingId(null); setDraft({}) }} style={{ padding: '6px 10px', borderRadius: 5, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: '#9ca3af', fontSize: 10, cursor: 'pointer' }}>Cancel</button>
            </div>
          </div>
        )}
      </div>
      <style>{`@keyframes gpSlideIn { from { transform:translateX(-100%);opacity:0 } to { transform:translateX(0);opacity:1 } }`}</style>
    </div>
  )
}

// ─── PathClickPanel (Feature 3) ───────────────────────────────────────────────
function PathClickPanel({
  node,
  screenX,
  screenY,
  onClose,
}: {
  node: NNode | null
  screenX: number
  screenY: number
  onClose: () => void
}) {
  const [analysis, setAnalysis] = useState('')
  const [analysisLoading, setAnalysisLoading] = useState(false)
  const [showAnalysis, setShowAnalysis] = useState(false)

  useEffect(() => { setAnalysis(''); setShowAnalysis(false) }, [node?.id])

  const load3xBetter = useCallback(async () => {
    if (!node) return
    setShowAnalysis(true); setAnalysisLoading(true)
    try {
      let valuesCtx = ''
      try { const vp = JSON.parse(localStorage.getItem(VALUES_STORAGE_KEY) || '{}'); valuesCtx = JSON.stringify(vp) } catch {}
      const res = await callClaude({
        messages: [{ role: 'user', content: `Business step: "${node.label}" for project "${node.meta?.projectName}". Step state: ${node.meta?.pathState}. Values profile: ${valuesCtx || 'not set'}. Analyze what could make this step 3x better for a small electrical contractor. If any suggestion conflicts with stated values, flag it with ⚠️ [conflicts with: value name]. Be concise — 3-4 bullet points.` }],
        system: 'You are a business optimization advisor for small electrical contractors. Be specific, practical, and brief.',
        max_tokens: 400,
      })
      setAnalysis(extractText(res))
    } catch (err) {
      setAnalysis('Unable to load analysis. Check API connection.')
    }
    setAnalysisLoading(false)
  }, [node])

  if (!node) return null

  const panelX = Math.min(screenX + 16, window.innerWidth - 300)
  const panelY = Math.min(screenY, window.innerHeight - 280)
  const pathColor = node.meta?.pathColor || '#00ff88'
  const stepLabels = ['Lead captured', 'Estimate sent', 'Project created', 'Field logs started', 'Invoice issued', 'Payment collected']

  return (
    <div style={{ position: 'absolute', left: panelX, top: panelY, width: 280, zIndex: 60, background: 'rgba(4,8,18,0.96)', border: `1px solid ${pathColor}44`, borderRadius: 10, padding: '12px 14px', fontFamily: 'ui-monospace,monospace', boxShadow: `0 0 20px ${pathColor}22`, animation: 'nmSlideIn 0.15s ease-out' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div>
          <div style={{ fontSize: 8, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Path Step · {node.meta?.pathState}</div>
          <div style={{ fontSize: 13, fontWeight: 800, color: pathColor }}>{node.label}</div>
          <div style={{ fontSize: 10, color: '#9ca3af', marginTop: 1 }}>{node.meta?.projectName}</div>
        </div>
        <button onClick={onClose} style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: '#9ca3af', borderRadius: 5, padding: '3px 7px', fontSize: 11, cursor: 'pointer', flexShrink: 0 }}>✕</button>
      </div>

      <div style={{ marginBottom: 8 }}>
        <div style={{ fontSize: 9, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 3 }}>What happened at this step</div>
        <div style={{ fontSize: 11, color: '#d1d5db', lineHeight: 1.5 }}>
          {stepLabels[node.meta?.stepIndex] || node.label}
          {node.meta?.pathState === 'complete' && <span style={{ color: pathColor }}> ✓ Complete</span>}
          {node.meta?.pathState === 'stalled' && <span style={{ color: '#ff4444' }}> ⚠ Stalled 30+ days</span>}
          {node.meta?.pathState === 'current' && <span style={{ color: '#ffcc00' }}> ◎ In Progress</span>}
        </div>
      </div>

      {node.meta?.pathState !== 'future' && (
        <div style={{ fontSize: 9, color: '#6b7280', marginBottom: 8 }}>
          Step {(node.meta?.stepIndex || 0) + 1} of {PATH_STEPS.length} · Path ID {node.meta?.pathId}
        </div>
      )}

      {/* 3x Better button */}
      <button
        onClick={() => showAnalysis ? setShowAnalysis(false) : load3xBetter()}
        style={{ width: '100%', padding: '6px', borderRadius: 5, border: `1px solid ${pathColor}55`, background: `${pathColor}12`, color: pathColor, fontSize: 10, fontWeight: 700, cursor: 'pointer', letterSpacing: '0.04em', marginBottom: showAnalysis ? 8 : 0 }}
      >
        {showAnalysis ? '▲ Hide Analysis' : '⚡ 3x Better (Claude)'}
      </button>

      {showAnalysis && (
        <div style={{ background: 'rgba(0,0,0,0.3)', borderRadius: 6, padding: '8px 10px', fontSize: 10, color: '#d1d5db', lineHeight: 1.6 }}>
          {analysisLoading ? <div style={{ color: '#6b7280' }}>Analyzing…</div> : analysis}
        </div>
      )}
    </div>
  )
}

// ─── Neural Map ───────────────────────────────────────────────────────────────
function NeuralMap() {
  const mountRef = useRef<HTMLDivElement>(null)
  const [activeTab, setActiveTab] = useState<NeuralTab>('All')
  const [layerToggles, setLayerToggles] = useState({ Projects: true, Agents: true, Decisions: true, Data: true })

  // Refs for Three.js communication
  const sceneDataRef  = useRef<{ nodes: NNode[]; edges: NEdge[] }>({ nodes: [], edges: [] })
  const rebuildRef    = useRef<() => void>(() => {})
  const activeTabRef  = useRef<NeuralTab>(activeTab)
  const togglesRef    = useRef(layerToggles)
  useEffect(() => { activeTabRef.current = activeTab }, [activeTab])
  useEffect(() => { togglesRef.current = layerToggles }, [layerToggles])

  // B35 selected node sidebar
  const [selectedNode, setSelectedNode] = useState<NNode | null>(null)
  const setSelectedNodeRef = useRef<(n: NNode | null) => void>(() => {})
  useEffect(() => { setSelectedNodeRef.current = setSelectedNode }, [])

  // Summary stats
  const [summaryData, setSummaryData] = useState({ activeProjects: 0, agentsOnline: 0, decisionsLogged: 0, systemHealth: 75 })
  const setSummaryRef = useRef<(d: any) => void>(() => {})
  useEffect(() => { setSummaryRef.current = setSummaryData }, [])

  // Feature 2 — Pause / speed
  const [speedMode, setSpeedMode] = useState<SpeedMode>('normal')
  const speedModeRef  = useRef<SpeedMode>('normal')
  const setSpeedModeRef = useRef<(m: SpeedMode) => void>(() => {})
  useEffect(() => { speedModeRef.current = speedMode }, [speedMode])
  useEffect(() => { setSpeedModeRef.current = setSpeedMode }, [])

  // Feature 3 — selected path node
  const [pathNode, setPathNode] = useState<NNode | null>(null)
  const [pathScreenX, setPathScreenX] = useState(0)
  const [pathScreenY, setPathScreenY] = useState(0)
  const setPathNodeRef = useRef<(n: NNode | null, x: number, y: number) => void>(() => {})
  useEffect(() => { setPathNodeRef.current = (n, x, y) => { setPathNode(n); setPathScreenX(x); setPathScreenY(y) } }, [])

  // Feature 4 — Goal paths
  const [goalPathsOpen, setGoalPathsOpen] = useState(false)
  const [goalProfiles, setGoalProfiles] = useState<GoalProfile[]>([])
  const goalProfilesRef = useRef<GoalProfile[]>([])
  const goalRebuildRef  = useRef<() => void>(() => {})
  useEffect(() => { goalProfilesRef.current = goalProfiles }, [goalProfiles])

  const handleProfilesChange = useCallback((profiles: GoalProfile[]) => {
    setGoalProfiles(profiles)
    goalProfilesRef.current = profiles
    if (goalRebuildRef.current) goalRebuildRef.current()
  }, [])

  // Load goal profiles on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem(GOAL_STORAGE_KEY)
      if (saved) {
        const parsed = JSON.parse(saved)
        setGoalProfiles(parsed)
        goalProfilesRef.current = parsed
      }
    } catch {}
  }, [])

  // Build node/edge data (Features 1 + 3)
  function buildGraphData(tab: NeuralTab, toggles: typeof layerToggles): { nodes: NNode[]; edges: NEdge[] } {
    const nodes: NNode[] = []
    const edges: NEdge[] = []
    const rand = (scale = 5) => (Math.random() - 0.5) * scale

    const showP  = tab === 'Projects' || (tab === 'All' && toggles.Projects)
    const showA  = tab === 'Agents'   || (tab === 'All' && toggles.Agents)
    const showD  = tab === 'Decisions'|| (tab === 'All' && toggles.Decisions)
    const showDa = tab === 'Data'     || (tab === 'All' && toggles.Data)

    // ── Projects ──────────────────────────────────────────────────────────────
    if (showP) {
      const data = getBackupData()
      const projects = data?.projects || []
      projects.forEach((p) => {
        const sc = health(p, data).sc
        const clr = sc > 70 ? 0x00ff88 : sc > 40 ? 0xffcc00 : 0xff6600
        const sz = 0.10 + Math.min(0.22, (p.contract || 50000) / 1000000)
        nodes.push({
          id: 'proj_' + p.id, label: p.name || 'Project', type: 'project',
          color: clr, size: sz, x: rand(4), y: rand(4), z: rand(4),
          vx: 0, vy: 0, vz: 0, fx: 0, fy: 0, fz: 0,
          meta: { healthScore: Math.round(sc), contract: p.contract || 0 },
        })
      })
    }

    // ── Agents ────────────────────────────────────────────────────────────────
    if (showA) {
      AGENT_LIST.forEach((ag) => {
        const tierClr = TIER_COLORS_INT[Math.min(ag.tier - 1, 4)]
        nodes.push({
          id: 'ag_' + ag.id, label: ag.label, type: 'agent',
          color: tierClr, size: 0.10 + Math.random() * 0.05,
          x: rand(5), y: rand(5), z: rand(5),
          vx: 0, vy: 0, vz: 0, fx: 0, fy: 0, fz: 0,
          meta: { tier: ag.tier, desc: ag.desc },
        })
      })
      const agentNodes = nodes.filter((n) => n.type === 'agent')
      const nexusIdx   = nodes.findIndex((n) => n.id === 'ag_NEXUS')
      agentNodes.forEach((n) => {
        const nIdx = nodes.indexOf(n)
        if (nexusIdx >= 0 && nIdx !== nexusIdx && Math.random() > 0.3) edges.push({ a: nexusIdx, b: nIdx })
        const rand2 = agentNodes[Math.floor(Math.random() * agentNodes.length)]
        if (rand2 && rand2 !== n && Math.random() > 0.65) edges.push({ a: nodes.indexOf(rand2), b: nIdx })
      })
    }

    // ── Decisions ─────────────────────────────────────────────────────────────
    if (showD) {
      const DECISION_MOCKS = [
        { label: 'Approved change order', feedback: 1 }, { label: 'Delayed inspection', feedback: -1 },
        { label: 'Material substitution', feedback: 0 }, { label: 'Crew overtime approved', feedback: 1 },
        { label: 'RFI response sent', feedback: 1 }, { label: 'Scope clarification', feedback: 0 },
        { label: 'Budget threshold alert', feedback: -1 }, { label: 'Phase marked complete', feedback: 1 },
      ]
      const count = Math.min(50, 20 + Math.floor(Math.random() * 15))
      for (let i = 0; i < count; i++) {
        const mock = DECISION_MOCKS[i % DECISION_MOCKS.length]
        const clr = mock.feedback > 0 ? 0x00cc55 : mock.feedback < 0 ? 0xff4444 : 0x555577
        nodes.push({
          id: 'dec_' + i, label: mock.label, type: 'decision',
          color: clr, size: 0.05 + Math.random() * 0.04,
          x: rand(6), y: rand(6), z: rand(6),
          vx: 0, vy: 0, vz: 0, fx: 0, fy: 0, fz: 0,
          meta: { feedback: mock.feedback },
        })
      }
    }

    // ── Data nodes ────────────────────────────────────────────────────────────
    if (showDa) {
      const d = getBackupData()
      const kpis = d ? getKPIs(d) : {}
      const metrics = [
        { label: 'Pipeline',   value: kpis.totalPipeline || 0, color: 0x22c55e, metricType: 'money' },
        { label: 'Paid',       value: kpis.totalPaid     || 0, color: 0x22c55e, metricType: 'money' },
        { label: 'Exposure',   value: kpis.totalAR       || 0, color: 0xf59e0b, metricType: 'money' },
        { label: 'Unbilled',   value: kpis.totalUnbilled || 0, color: 0xa855f7, metricType: 'money' },
        { label: 'ServiceNet', value: kpis.serviceNet    || 0, color: 0x06b6d4, metricType: 'money' },
      ]
      const dataStart = nodes.length
      metrics.forEach((m, i) => {
        const sz = 0.11 + Math.min(0.26, Math.abs(m.value) / 2000000)
        const absVal = Math.abs(m.value)
        const valStr = absVal >= 1000000 ? `$${(absVal/1000000).toFixed(1)}M` : absVal >= 1000 ? `$${(absVal/1000).toFixed(0)}k` : `$${absVal.toFixed(0)}`
        nodes.push({
          id: 'data_' + i, label: m.label, type: 'data',
          color: m.color, size: sz, x: rand(3), y: rand(3), z: rand(3),
          vx: 0, vy: 0, vz: 0, fx: 0, fy: 0, fz: 0,
          meta: { valueStr: valStr, metricType: m.metricType },
        })
      })
      if (showP) {
        nodes.filter((n) => n.type === 'project').slice(0, 5).forEach((projNode, pi) => {
          const projIdx = nodes.indexOf(projNode)
          const dataIdx = dataStart + (pi % metrics.length)
          if (dataIdx < nodes.length) edges.push({ a: projIdx, b: dataIdx })
        })
      }
    }

    // ── Feature 3: Business Path Step Nodes ───────────────────────────────────
    if (showP || tab === 'All') {
      const data = getBackupData()
      const projects = (data?.projects || []).slice(0, 5)
      projects.forEach((proj, projIdx) => {
        const sc = health(proj, data).sc
        const pathColor = sc > 70 ? '#00ff88' : sc > 40 ? '#ffcc00' : '#ff4444'
        const logs = proj.logs || []
        const lastLogTs = logs.reduce((max, l) => {
          const ts = l.date ? new Date(l.date).getTime() : (l.ts || 0)
          return ts > max ? ts : max
        }, 0)
        const daysSince = lastLogTs ? (Date.now() - lastLogTs) / 86400000 : 999
        const isStalled = daysSince > 30
        const currentStep =
          !proj.contract ? 0 :
          !proj.started  ? 1 :
          !logs.length   ? 2 :
          !proj.invoiced ? 3 :
          !proj.invoicePaid ? 4 : 5

        const baseX  = (projIdx - 2) * 4.5
        const baseY  = -7
        const baseZ  = 3 + projIdx * 0.4
        const pathStart = nodes.length

        PATH_STEPS.forEach((stepLabel, stepIdx) => {
          const isComplete = stepIdx < currentStep
          const isCurrent  = stepIdx === currentStep
          const pathState  = isStalled && isCurrent ? 'stalled' : isComplete ? 'complete' : isCurrent ? 'current' : 'future'

          nodes.push({
            id: `path_${proj.id}_${stepIdx}`,
            label: stepLabel,
            type: 'pathstep',
            color: 0x00ff88,
            size: 0.10,
            x: baseX + stepIdx * 1.4,
            y: baseY,
            z: baseZ,
            vx: 0, vy: 0, vz: 0, fx: 0, fy: 0, fz: 0,
            pinned: true,
            meta: {
              pathColor, stepIndex: stepIdx, stepLabel, pathState,
              projectName: proj.name || 'Project', pathId: `path_${proj.id}`,
              currentStep, isStalled, projectId: proj.id,
            },
          })

          if (stepIdx > 0) {
            edges.push({
              a: pathStart + stepIdx - 1,
              b: pathStart + stepIdx,
              pathColor: isStalled && stepIdx === currentStep ? '#ff4444' : pathColor,
              isPath: true,
            })
          }
        })
      })
    }

    return { nodes, edges }
  }

  // ─── Three.js scene useEffect ────────────────────────────────────────────────
  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return

    let _animFrame: number
    let _renderer: THREE.WebGLRenderer | null = null
    let _ro:       ResizeObserver | null = null
    let _cleanup:  (() => void) | null = null

    function doInit() {
    // B54: if tab is display:none, clientWidth/Height=0 — defer until visible
    if (mount.clientWidth === 0 || mount.clientHeight === 0) { requestAnimationFrame(doInit); return }
    if (_renderer) return  // already initialised with real dimensions
    const W = Math.max(mount.clientWidth, 100)
    const H = Math.max(mount.clientHeight, 100)

    const scene    = new THREE.Scene()
    const camera   = new THREE.PerspectiveCamera(55, W / H, 0.1, 2000)
    camera.position.z = 10

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    _renderer = renderer
    renderer.setSize(W, H)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setClearColor(0x020408, 1)
    renderer.domElement.style.position = 'absolute'
    renderer.domElement.style.zIndex = '1'
    renderer.domElement.style.top = '0'
    renderer.domElement.style.left = '0'
    mount.appendChild(renderer.domElement)

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.25); scene.add(ambientLight)
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.5); dirLight.position.set(5, 8, 5); scene.add(dirLight)

    const nodeGroup = new THREE.Group(); scene.add(nodeGroup)
    const edgeGroup = new THREE.Group(); scene.add(edgeGroup)
    const goalGroup = new THREE.Group(); scene.add(goalGroup)

    // B58 Enhancement 5: Static constellation star field
    const b58StarGeo = new THREE.BufferGeometry()
    const b58StarPos = new Float32Array(1200 * 3)
    for (let si = 0; si < 1200; si++) {
      const sTheta = Math.random() * Math.PI * 2
      const sPhi = Math.acos(2 * Math.random() - 1)
      const sR = 800
      b58StarPos[si*3]   = sR * Math.sin(sPhi) * Math.cos(sTheta)
      b58StarPos[si*3+1] = sR * Math.sin(sPhi) * Math.sin(sTheta)
      b58StarPos[si*3+2] = sR * Math.cos(sPhi) - 500
    }
    b58StarGeo.setAttribute('position', new THREE.BufferAttribute(b58StarPos, 3))
    const b58StarMat = new THREE.PointsMaterial({ color: 0xffffff, size: 1, transparent: true, opacity: 0.4, sizeAttenuation: false })
    const b58StarField = new THREE.Points(b58StarGeo, b58StarMat)
    scene.add(b58StarField)

    // B58 Enhancement 1: Edge particle flow group
    const b58ParticleGroup = new THREE.Group(); scene.add(b58ParticleGroup)
    let b58EdgeParticles: { points: THREE.Points; tValues: Float32Array }[] = []

    // B58 Enhancement 2: Node pulse rings group
    const b58PulseGroup = new THREE.Group(); scene.add(b58PulseGroup)
    let b58PulseRings: { ring1: THREE.Mesh; ring2: THREE.Mesh; nodeIndex: number; startTime: number }[] = []

    // B58 Enhancement 4: Health corona glow group
    const b58CoronaGroup = new THREE.Group(); scene.add(b58CoronaGroup)
    let b58CoronaSprites: { sprite: THREE.Sprite; nodeIndex: number; pulseSpeed: number }[] = []

    // Invisible hit spheres for raycasting
    const hitGeo = new THREE.SphereGeometry(1, 5, 5)
    const hitMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.0, depthWrite: false })
    let hitSpheres: THREE.Mesh[] = []

    let currentNodes: NNode[] = []
    let currentEdges: NEdge[] = []
    let simulationActive = true
    let edgesAsTubes = false

    // B35 label overlay
    let labelContainer: HTMLDivElement | null = null
    let labelDivs: HTMLDivElement[] = []
    const _labelV3 = new THREE.Vector3()

    function createLabelContainer() {
      labelContainer = document.createElement('div')
      labelContainer.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:10;'
      mount.appendChild(labelContainer)
    }
    createLabelContainer()

    function getEdgeDescription(a: NNode, b: NNode): string {
      const la = a?.label || '?', lb = b?.label || '?'
      if (a?.type === 'agent' && b?.type === 'agent') return `${la} → ${lb}: Delegated coordination`
      if ((a?.type === 'agent' && b?.type === 'project') || (a?.type === 'project' && b?.type === 'agent')) {
        const agent = a?.type === 'agent' ? la : lb, proj = a?.type === 'project' ? la : lb
        return `${agent}: Active monitoring of ${proj}`
      }
      if ((a?.type === 'project' && b?.type === 'data') || (a?.type === 'data' && b?.type === 'project')) {
        const proj = a?.type === 'project' ? la : lb, data = a?.type === 'data' ? la : lb
        const val = (a?.type === 'data' ? a : b)?.meta?.valueStr || ''
        return `${proj} → ${data}: Contributes ${val}`
      }
      if (a?.type === 'pathstep' && b?.type === 'pathstep') return `Path: ${la} → ${lb}`
      return `${la} ↔ ${lb}: Related`
    }

    // ── rebuildScene ──────────────────────────────────────────────────────────
    function rebuildScene() {
      hitSpheres.forEach((s) => scene.remove(s)); hitSpheres = []
      if (labelContainer) labelContainer.innerHTML = ''; labelDivs = []
      while (nodeGroup.children.length) nodeGroup.remove(nodeGroup.children[0])
      while (edgeGroup.children.length) edgeGroup.remove(edgeGroup.children[0])
      edgesAsTubes = false

      const { nodes, edges } = buildGraphData(activeTabRef.current, togglesRef.current)
      const capped = nodes.slice(0, 200)
      currentNodes = capped
      currentEdges = edges.filter((e) => e.a < capped.length && e.b < capped.length)

      // Feature 1: Create sprite for each node
      currentNodes.forEach((n) => {
        const sprite = createNodeSprite(n)
        sprite.scale.setScalar(n.size * 1.6)
        sprite.position.set(n.x, n.y, n.z)
        nodeGroup.add(sprite)
        n.mesh = sprite

        const hs = new THREE.Mesh(hitGeo, hitMat)
        hs.scale.setScalar(n.size * 1.8)
        hs.position.set(n.x, n.y, n.z)
        scene.add(hs); hitSpheres.push(hs)
      })

      // Node labels
      if (labelContainer) {
        labelDivs = currentNodes.map((n) => {
          const div = document.createElement('div')
          div.style.cssText = 'position:absolute;pointer-events:none;white-space:nowrap;font-family:monospace;font-size:10px;font-weight:700;letter-spacing:0.04em;background:rgba(4,8,18,0.82);border:1px solid rgba(255,255,255,0.08);border-radius:5px;padding:2px 6px;color:#e2e8f0;transform:translate(-50%,-100%);margin-top:-8px;transition:opacity 0.3s;'
          if (n.type === 'project') {
            const h = n.meta?.healthScore ?? '?', hc = (h as number)>70?'#00ff88':(h as number)>40?'#ffcc00':'#ff6600'
            div.innerHTML = `<span style="color:${hc}">${n.label}</span> <span style="color:#6b7280;font-size:9px">${h}</span>`
          } else if (n.type === 'agent') {
            div.innerHTML = `<span style="color:#ca8a04">${n.label}</span><span style="background:rgba(0,255,136,0.15);color:#00ff88;font-size:8px;padding:1px 4px;border-radius:3px;margin-left:3px">Active</span>`
          } else if (n.type === 'decision') {
            const fb = n.meta?.feedback; const emoji = fb>0?'👍':fb<0?'👎':'•'
            div.innerHTML = `<span style="color:#a855f7;font-size:9px">${n.label}</span> <span>${emoji}</span>`
          } else if (n.type === 'pathstep') {
            const pc = n.meta?.pathColor || '#00ff88'
            div.innerHTML = `<span style="color:${pc};font-size:9px">${n.label}</span>`
            div.style.borderColor = pc + '44'
          } else if (n.type === 'goalstep') {
            const gc = n.meta?.goalColor || '#7c3aed'
            div.innerHTML = `<span style="color:${gc};font-size:9px">${n.label}</span>`
          } else {
            div.innerHTML = `<span style="color:#06b6d4">${n.label}</span> <span style="color:#9ca3af;font-size:9px">${n.meta?.valueStr ?? ''}</span>`
          }
          labelContainer!.appendChild(div)
          return div
        })
      }

      // Create edges
      currentEdges.forEach((e) => {
        const a = currentNodes[e.a], b = currentNodes[e.b]; if (!a || !b) return
        const geo = new THREE.BufferGeometry()
        const pts = new Float32Array([a.x, a.y, a.z, b.x, b.y, b.z])
        geo.setAttribute('position', new THREE.BufferAttribute(pts, 3))
        const edgeColor = e.isPath ? parseInt((e.pathColor || '#1a4060').replace('#', ''), 16) : 0x1a4060
        const edgeOpacity = e.isPath ? 0.7 : 0.5
        const mat = new THREE.LineBasicMaterial({ color: edgeColor, transparent: true, opacity: edgeOpacity })
        const line = new THREE.Line(geo, mat); edgeGroup.add(line); e.line = line
      })

      simulationActive = true
      sceneDataRef.current = { nodes: currentNodes, edges: currentEdges }
      setSummaryRef.current({
        activeProjects: currentNodes.filter((n) => n.type === 'project').length,
        agentsOnline: currentNodes.filter((n) => n.type === 'agent').length,
        decisionsLogged: currentNodes.filter((n) => n.type === 'decision').length,
        systemHealth: Math.round(getAvgHealth()),
      })
      b58RebuildParticles()
      b58RebuildPulseRings()
      b58RebuildCoronas()
    }

    rebuildScene()
    rebuildRef.current = rebuildScene

    // ── Feature 2: upgrade edges to TubeGeometry after sim settles ────────────
    function upgradeEdgesToTubes() {
      edgesAsTubes = true
      currentEdges.forEach((e) => {
        const a = currentNodes[e.a], b = currentNodes[e.b]
        if (!a || !b || !e.line) return
        edgeGroup.remove(e.line as THREE.Object3D)
        ;(e.line as any).geometry?.dispose()
        ;(e.line as any).material?.dispose()
        const path = new THREE.LineCurve3(new THREE.Vector3(a.x, a.y, a.z), new THREE.Vector3(b.x, b.y, b.z))
        const tubeGeo = new THREE.TubeGeometry(path, 2, e.isPath ? 0.025 : 0.016, 5, false)
        const edgeColor = e.isPath ? parseInt((e.pathColor || '#1a4060').replace('#', ''), 16) : 0x1e5080
        const tubeMat = new THREE.MeshBasicMaterial({ color: edgeColor, transparent: true, opacity: e.isPath ? 0.65 : 0.4 })
        const tubeMesh = new THREE.Mesh(tubeGeo, tubeMat)
        edgeGroup.add(tubeMesh); e.line = tubeMesh
      })
    }

    // ── B58 Enhancement 1: Rebuild edge particle flow ────────────────────────
    function b58RebuildParticles() {
      while (b58ParticleGroup.children.length) b58ParticleGroup.remove(b58ParticleGroup.children[0])
      b58EdgeParticles = []
      currentEdges.forEach((e) => {
        const a = currentNodes[e.a], b = currentNodes[e.b]
        if (!a || !b) return
        const PCOUNT = 4
        const pGeo = new THREE.BufferGeometry()
        const positions = new Float32Array(PCOUNT * 3)
        pGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
        const srcColor = new THREE.Color(a.color)
        const pMat = new THREE.PointsMaterial({ color: srcColor, size: 2, transparent: true, opacity: 0.8, sizeAttenuation: false, depthWrite: false })
        const pts = new THREE.Points(pGeo, pMat)
        b58ParticleGroup.add(pts)
        const tValues = new Float32Array(PCOUNT)
        for (let pi = 0; pi < PCOUNT; pi++) tValues[pi] = pi / PCOUNT
        b58EdgeParticles.push({ points: pts, tValues })
      })
    }

    // ── B58 Enhancement 2: Rebuild pulse rings for agent nodes ───────────────
    function b58RebuildPulseRings() {
      while (b58PulseGroup.children.length) b58PulseGroup.remove(b58PulseGroup.children[0])
      b58PulseRings = []
      currentNodes.forEach((n, idx) => {
        if (n.type !== 'agent') return
        const baseR = n.size * 0.9
        const rGeo1 = new THREE.RingGeometry(baseR, baseR + baseR * 0.1, 24)
        const rMat1 = new THREE.MeshBasicMaterial({ color: n.color, transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false })
        const ring1 = new THREE.Mesh(rGeo1, rMat1)
        ring1.position.set(n.x, n.y, n.z)
        b58PulseGroup.add(ring1)
        const rGeo2 = new THREE.RingGeometry(baseR, baseR + baseR * 0.1, 24)
        const rMat2 = new THREE.MeshBasicMaterial({ color: n.color, transparent: true, opacity: 0.0, side: THREE.DoubleSide, depthWrite: false })
        const ring2 = new THREE.Mesh(rGeo2, rMat2)
        ring2.position.set(n.x, n.y, n.z)
        b58PulseGroup.add(ring2)
        b58PulseRings.push({ ring1, ring2, nodeIndex: idx, startTime: performance.now() })
      })
    }

    // ── B58 Enhancement 4: Rebuild health corona glows ───────────────────────
    function b58RebuildCoronas() {
      while (b58CoronaGroup.children.length) b58CoronaGroup.remove(b58CoronaGroup.children[0])
      b58CoronaSprites = []
      currentNodes.forEach((n, idx) => {
        const h = (n.meta?.healthScore as number) ?? 75
        const daysStalled = (n.meta?.daysStalled as number) ?? 0
        const isCritical = n.type === 'project' && h < 40
        const isStalled  = n.type === 'project' && daysStalled > 3 && !isCritical
        let glowColor = 0x00ff9f, pulseSpeed = 1.5
        if (isCritical)     { glowColor = 0xff4444; pulseSpeed = 0.8 }
        else if (isStalled) { glowColor = 0xffd700; pulseSpeed = 2.0 }
        const gc = document.createElement('canvas')
        gc.width = 64; gc.height = 64
        const gctx = gc.getContext('2d')!
        const hexStr = '#' + glowColor.toString(16).padStart(6, '0')
        const grad = gctx.createRadialGradient(32, 32, 0, 32, 32, 32)
        grad.addColorStop(0, hexStr + 'cc')
        grad.addColorStop(0.5, hexStr + '44')
        grad.addColorStop(1, 'transparent')
        gctx.fillStyle = grad; gctx.fillRect(0, 0, 64, 64)
        const gTex = new THREE.CanvasTexture(gc)
        const sMat = new THREE.SpriteMaterial({ map: gTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })
        const sprite = new THREE.Sprite(sMat)
        sprite.scale.setScalar(n.size * 4.0)
        sprite.position.set(n.x, n.y, n.z)
        b58CoronaGroup.add(sprite)
        b58CoronaSprites.push({ sprite, nodeIndex: idx, pulseSpeed })
      })
    }

    // ── Feature 4: rebuild goal path nodes ───────────────────────────────────
    function rebuildGoalNodes() {
      while (goalGroup.children.length) goalGroup.remove(goalGroup.children[0])
      const activeProfiles = goalProfilesRef.current.filter((p) => p.active)
      activeProfiles.forEach((profile, profileIdx) => {
        const milestoneCount = Math.min(12, Math.max(8, Math.round(profile.timeHorizonMonths / 4)))
        const yOffset = 6 + profileIdx * 1.8
        const milestones = generateMilestones(profile, milestoneCount)

        for (let i = 0; i < milestones.length; i++) {
          const canvas = makeGoalStepCanvas(profile.color, i)
          const texture = new THREE.CanvasTexture(canvas)
          const mat = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false })
          const sprite = new THREE.Sprite(mat)
          const xPos = (i - milestones.length / 2) * 1.5
          sprite.scale.setScalar(0.18)
          sprite.position.set(xPos, yOffset, 0)
          goalGroup.add(sprite)

          // Edge to next milestone
          if (i > 0) {
            const prevSprite = goalGroup.children[goalGroup.children.length - 2] as THREE.Sprite
            if (prevSprite?.position) {
              const geo = new THREE.BufferGeometry()
              const pts = new Float32Array([prevSprite.position.x, prevSprite.position.y, prevSprite.position.z, xPos, yOffset, 0])
              geo.setAttribute('position', new THREE.BufferAttribute(pts, 3))
              const clrInt = parseInt(profile.color.replace('#', ''), 16)
              const mat2 = new THREE.LineBasicMaterial({ color: clrInt, transparent: true, opacity: 0.5 })
              goalGroup.add(new THREE.Line(geo, mat2))
            }
          }
        }
      })
    }

    function generateMilestones(profile: GoalProfile, count: number): string[] {
      const base = ['Baseline assessment', 'First revenue milestone', 'Systems automation', 'Team expansion', 'Market validation', 'Pipeline optimization', 'Revenue target 25%', 'Revenue target 50%', 'Revenue target 75%', 'Revenue target 100%', 'Scale phase', 'Target achieved']
      if (profile.scenarioFactors.includes('RMO Active')) base.splice(2, 0, 'RMO program launch')
      if (profile.scenarioFactors.includes('Investment Received')) base.splice(1, 0, 'Capital deployment')
      return base.slice(0, count)
    }

    rebuildGoalNodes()
    goalRebuildRef.current = rebuildGoalNodes

    // ── Force simulation ─────────────────────────────────────────────────────
    function simulateStep() {
      const repulsion = 3.5, spring = 0.08, damping = 0.85, gravity = 0.04
      for (const n of currentNodes) { n.fx = 0; n.fy = 0; n.fz = 0 }
      for (let i = 0; i < currentNodes.length; i++) {
        const a = currentNodes[i]
        if (a.pinned) continue
        for (let j = i + 1; j < currentNodes.length; j++) {
          const b = currentNodes[j]; if (b.pinned) continue
          const dx=a.x-b.x, dy=a.y-b.y, dz=a.z-b.z
          const distSq = Math.max(0.25, dx*dx+dy*dy+dz*dz), dist = Math.sqrt(distSq)
          const force = repulsion / distSq
          a.fx+=dx/dist*force; a.fy+=dy/dist*force; a.fz+=dz/dist*force
          b.fx-=dx/dist*force; b.fy-=dy/dist*force; b.fz-=dz/dist*force
        }
      }
      for (const e of currentEdges) {
        const a = currentNodes[e.a], b = currentNodes[e.b]; if (!a||!b) continue
        const dx=b.x-a.x, dy=b.y-a.y, dz=b.z-a.z
        const dist = Math.max(0.1, Math.sqrt(dx*dx+dy*dy+dz*dz)), target = 2.5
        const force = spring * (dist - target)
        if (!a.pinned) { a.fx+=dx/dist*force; a.fy+=dy/dist*force; a.fz+=dz/dist*force }
        if (!b.pinned) { b.fx-=dx/dist*force; b.fy-=dy/dist*force; b.fz-=dz/dist*force }
      }
      const clusterStrength = 0.015
      const clusterTargets: Record<string, [number,number,number]> = { project:[-3,0,0], agent:[3,0,0], decision:[0,3,0], data:[0,-3,0] }
      for (const n of currentNodes) {
        if (n.pinned) continue
        const ct = clusterTargets[n.type]
        if (ct) { n.fx+=(ct[0]-n.x)*clusterStrength; n.fy+=(ct[1]-n.y)*clusterStrength; n.fz+=(ct[2]-n.z)*clusterStrength }
      }
      let totalKE = 0
      for (const n of currentNodes) {
        if (n.pinned) { n.vx=0; n.vy=0; n.vz=0; continue }
        n.fx -= n.x*gravity; n.fy -= n.y*gravity; n.fz -= n.z*gravity
        n.vx=(n.vx+n.fx)*damping; n.vy=(n.vy+n.fy)*damping; n.vz=(n.vz+n.fz)*damping
        n.x+=n.vx; n.y+=n.vy; n.z+=n.vz
        if (n.mesh) (n.mesh as THREE.Object3D).position.set(n.x, n.y, n.z)
        totalKE += n.vx**2+n.vy**2+n.vz**2
      }
      hitSpheres.forEach((hs, i) => { const n = currentNodes[i]; if (n) hs.position.set(n.x, n.y, n.z) })
      if (!edgesAsTubes) {
        currentEdges.forEach((e) => {
          const a = currentNodes[e.a], b = currentNodes[e.b]; if (!a||!b||!e.line) return
          const pos = (e.line as THREE.Line).geometry?.attributes?.position; if (!pos) return
          pos.setXYZ(0, a.x, a.y, a.z); pos.setXYZ(1, b.x, b.y, b.z); pos.needsUpdate = true
        })
      }
      if (totalKE < 0.001 * currentNodes.length) { simulationActive = false; if (!edgesAsTubes) upgradeEdgesToTubes() }
    }

    // ── Camera controls ──────────────────────────────────────────────────────
    let pulseTick = 0, animFrame: number
    let isDragging = false, dragMoved = false, lastMX = 0, lastMY = 0
    let camPhi = Math.PI / 6, camTheta = 0, camR = 10, targetCamR = 10
    const camLookAt = new THREE.Vector3(), targetLookAt = new THREE.Vector3()
    let hoveredNode: NNode | null = null
    const raycaster = new THREE.Raycaster()
    const mouse = new THREE.Vector2()
    let tooltipDiv: HTMLDivElement | null = null

    function createTooltip() {
      tooltipDiv = document.createElement('div')
      tooltipDiv.style.cssText = 'position:absolute;background:rgba(4,8,18,0.92);border:1px solid rgba(0,255,136,0.2);color:#e2e8f0;font-size:11px;padding:7px 11px;border-radius:7px;pointer-events:none;white-space:nowrap;z-index:100;display:none;font-family:monospace;box-shadow:0 0 12px rgba(0,255,136,0.12);'
      mount.appendChild(tooltipDiv)
    }
    createTooltip()

    function updateTooltip(n: NNode, mx: number, my: number, rect: DOMRect) {
      if (!tooltipDiv) return
      const typeLabel = n.type.charAt(0).toUpperCase() + n.type.slice(1)
      let metric = ''
      if (n.type === 'project') metric = `Health: <span style="color:#00ff88">${n.meta?.healthScore ?? '?'}%</span>`
      if (n.type === 'agent')   metric = `T${n.meta?.tier??'?'} · <span style="color:#9ca3af">${n.meta?.desc??''}</span>`
      if (n.type === 'decision') { const fb=n.meta?.feedback; metric=fb>0?'<span style="color:#00cc55">👍 Approved</span>':fb<0?'<span style="color:#ff4444">👎 Issue</span>':'<span style="color:#555577">• Pending</span>' }
      if (n.type === 'data')    metric = `<span style="color:#06b6d4">${n.meta?.valueStr??''}</span>`
      if (n.type === 'pathstep') { const pc=n.meta?.pathColor||'#00ff88'; metric = `<span style="color:${pc}">${n.meta?.pathState}</span> · ${n.meta?.projectName||''}` }
      if (n.type === 'goalstep') { const gc=n.meta?.goalColor||'#7c3aed'; metric = `<span style="color:${gc}">Step ${(n.meta?.stepIndex||0)+1} · Goal path</span>` }
      tooltipDiv.innerHTML = `<div style="font-weight:800;color:#fff;margin-bottom:2px;letter-spacing:0.04em">${n.label}</div><div style="color:#4b5563;font-size:9px;text-transform:uppercase;letter-spacing:0.08em">${typeLabel}</div>${metric?`<div style="font-size:10px;margin-top:3px">${metric}</div>`:''}`
      tooltipDiv.style.display = 'block'
      tooltipDiv.style.left = (mx - rect.left + 15) + 'px'
      tooltipDiv.style.top  = (my - rect.top - 5) + 'px'
    }

    function onMouseDown(e: MouseEvent) { isDragging=true; dragMoved=false; lastMX=e.clientX; lastMY=e.clientY }
    function onMouseUp()   { isDragging = false }
    function onMouseMove(e: MouseEvent) {
      if (isDragging) {
        const dx=e.clientX-lastMX, dy=e.clientY-lastMY
        if (Math.abs(dx)>2||Math.abs(dy)>2) dragMoved=true
        camTheta -= dx*0.008
        camPhi = Math.max(0.2, Math.min(Math.PI-0.2, camPhi - dy*0.008))
        lastMX=e.clientX; lastMY=e.clientY
      }
      const rect = mount.getBoundingClientRect()
      mouse.x = ((e.clientX-rect.left)/rect.width)*2-1
      mouse.y = -((e.clientY-rect.top)/rect.height)*2+1
      raycaster.setFromCamera(mouse, camera)
      const hits = raycaster.intersectObjects(hitSpheres)
      if (hits.length > 0) {
        const hitIdx = hitSpheres.indexOf(hits[0].object as THREE.Mesh)
        hoveredNode = hitIdx >= 0 ? (currentNodes[hitIdx] || null) : null
        if (tooltipDiv && hoveredNode) updateTooltip(hoveredNode, e.clientX, e.clientY, rect)
      } else {
        hoveredNode = null
        if (tooltipDiv) tooltipDiv.style.display = 'none'
        // Edge hover
        const emx=e.clientX-rect.left, emy=e.clientY-rect.top
        let closestEdge: NEdge | null = null, closestDist = 28
        currentEdges.forEach((edge) => {
          const a=currentNodes[edge.a], b=currentNodes[edge.b]; if(!a||!b) return
          _labelV3.set((a.x+b.x)/2,(a.y+b.y)/2,(a.z+b.z)/2); _labelV3.project(camera); if(_labelV3.z>1) return
          const ex=(_labelV3.x+1)/2*(mount.clientWidth||600), ey=(-_labelV3.y+1)/2*(mount.clientHeight||600)
          const dist=Math.sqrt((emx-ex)**2+(emy-ey)**2); if(dist<closestDist){closestDist=dist;closestEdge=edge}
        })
        if (closestEdge && tooltipDiv) {
          const ea=currentNodes[closestEdge.a], eb=currentNodes[closestEdge.b]
          if (ea&&eb) {
            tooltipDiv.innerHTML = `<div style="color:#1a6080;font-size:8px;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:2px">Edge</div><div style="color:#e2e8f0;font-size:11px">${getEdgeDescription(ea,eb)}</div>`
            tooltipDiv.style.display = 'block'
            _labelV3.set((ea.x+eb.x)/2,(ea.y+eb.y)/2,(ea.z+eb.z)/2); _labelV3.project(camera)
            tooltipDiv.style.left=((_labelV3.x+1)/2*(mount.clientWidth||600)+15)+'px'
            tooltipDiv.style.top=((-_labelV3.y+1)/2*(mount.clientHeight||600)-5)+'px'
          }
        }
      }
    }
    function onWheel(e: WheelEvent) { targetCamR = Math.max(3, Math.min(20, targetCamR + e.deltaY*0.01)) }

    function onClick(e: MouseEvent) {
      if (dragMoved) return
      const rect = mount.getBoundingClientRect()
      mouse.x = ((e.clientX-rect.left)/rect.width)*2-1
      mouse.y = -((e.clientY-rect.top)/rect.height)*2+1
      raycaster.setFromCamera(mouse, camera)
      const hits = raycaster.intersectObjects(hitSpheres)
      if (hits.length > 0) {
        const hitIdx = hitSpheres.indexOf(hits[0].object as THREE.Mesh)
        const n = currentNodes[hitIdx]
        if (n) {
          if (n.type === 'pathstep') {
            // Feature 3: open path panel
            setPathNodeRef.current(n, e.clientX - mount.getBoundingClientRect().left, e.clientY - mount.getBoundingClientRect().top)
          } else {
            targetLookAt.set(n.x, n.y, n.z)
            setSelectedNodeRef.current(n)
            setPathNodeRef.current(null, 0, 0)
          }
        }
      } else {
        setSelectedNodeRef.current(null)
        setPathNodeRef.current(null, 0, 0)
      }
    }

    function onDblClick(e: MouseEvent) {
      const rect = mount.getBoundingClientRect()
      mouse.x = ((e.clientX-rect.left)/rect.width)*2-1
      mouse.y = -((e.clientY-rect.top)/rect.height)*2+1
      raycaster.setFromCamera(mouse, camera)
      const hits = raycaster.intersectObjects(hitSpheres)
      if (hits.length > 0) {
        const n = currentNodes[hitSpheres.indexOf(hits[0].object as THREE.Mesh)]
        if (n) { targetLookAt.set(n.x, n.y, n.z); targetCamR = 4 }
      } else { targetLookAt.set(0,0,0); targetCamR = 10 }
    }

    // Feature 2 — Spacebar toggle pause/normal
    function onKeyDown(e: KeyboardEvent) {
      if (e.code === 'Space' && e.target === document.body) {
        e.preventDefault()
        const next: SpeedMode = speedModeRef.current === 'paused' ? 'normal' : 'paused'
        speedModeRef.current = next
        setSpeedModeRef.current(next)
      }
    }

    // Feature 2 — Mobile 3-tap detection (3 taps within 1250ms)
    const tapTimes: number[] = []
    function onTouchEnd() {
      const now = Date.now()
      tapTimes.push(now)
      // Keep only taps within 1250ms window
      while (tapTimes.length && now - tapTimes[0] > 1250) tapTimes.shift()
      if (tapTimes.length >= 3) {
        tapTimes.length = 0
        const next: SpeedMode = speedModeRef.current === 'paused' ? 'normal' : 'paused'
        speedModeRef.current = next
        setSpeedModeRef.current(next)
      }
    }

    renderer.domElement.addEventListener('mousedown', onMouseDown)
    renderer.domElement.addEventListener('mouseup', onMouseUp)
    renderer.domElement.addEventListener('mousemove', onMouseMove)
    renderer.domElement.addEventListener('wheel', onWheel, { passive: true })
    renderer.domElement.addEventListener('click', onClick)
    renderer.domElement.addEventListener('dblclick', onDblClick)
    renderer.domElement.addEventListener('touchend', onTouchEnd, { passive: true })
    document.addEventListener('keydown', onKeyDown)
    const handleVisibility = () => { if (!document.hidden) simulationActive = true }
    document.addEventListener('visibilitychange', handleVisibility)

    // ── Main animation loop (Feature 2: speed/pause) ─────────────────────────
    function animate() {
      animFrame = requestAnimationFrame(animate)
      const mode = speedModeRef.current
      const isPaused = mode === 'paused'
      const speedMult = isPaused ? 0 : mode === 'slow' ? 0.2 : 1.0

      // Camera smooth lerp always runs (allows zoom/pan even when paused)
      camR += (targetCamR - camR) * 0.05
      camLookAt.lerp(targetLookAt, 0.05)

      if (!isPaused) {
        pulseTick += 0.016 * speedMult
        if (!isDragging) camTheta += 0.002 * speedMult
        if (simulationActive) simulateStep()
      }

      camera.position.x = camR * Math.sin(camPhi) * Math.sin(camTheta)
      camera.position.y = camR * Math.cos(camPhi)
      camera.position.z = camR * Math.sin(camPhi) * Math.cos(camTheta)
      camera.lookAt(camLookAt)

      // Sprite scale pulsing (replaces geometry rotation for sprites)
      const pPulse = Math.sin(pulseTick * 3) * 0.5 + 0.5
      currentNodes.forEach((n) => {
        if (!n.mesh) return
        const sprite = n.mesh as THREE.Sprite
        const isHovered = hoveredNode === n
        const targetScale = (isHovered ? n.size * 1.3 : n.size) * 1.6
        const curScale = sprite.scale.x
        const newScale = curScale + (targetScale - curScale) * 0.12
        // Path step current node gets extra pulse
        if (n.type === 'pathstep' && n.meta?.pathState === 'current') {
          sprite.scale.setScalar(newScale * (1 + Math.sin(pulseTick * 4) * 0.08))
        } else if (n.type === 'agent') {
          sprite.scale.setScalar(newScale * (1 + pPulse * 0.05))
        } else {
          sprite.scale.setScalar(newScale)
        }
      })

      // B58 Enhancement 5: Slow star field rotation
      if (!isPaused) b58StarField.rotation.y += 0.00005 * speedMult

      // B58 Enhancement 3: Depth fog (scene-scale adapted)
      currentNodes.forEach((n) => {
        if (!n.mesh) return
        const dx = camera.position.x - n.x
        const dy = camera.position.y - n.y
        const dz = camera.position.z - n.z
        const dist = Math.sqrt(dx*dx + dy*dy + dz*dz)
        const sp = n.mesh as THREE.Sprite
        let opacity: number
        if (dist < 8)       opacity = 1.0
        else if (dist < 14) opacity = 0.7 + (0.3) * (1 - (dist - 8) / 6)
        else                opacity = 0.4 + (0.3) * (1 - Math.min(1, (dist - 14) / 8))
        sp.material.opacity = opacity
        sp.material.needsUpdate = true
      })

      // B58 Enhancement 1: Update edge particle flow
      if (!isPaused) {
        b58EdgeParticles.forEach((ep, ei) => {
          const e = currentEdges[ei]; if (!e) return
          const a = currentNodes[e.a], b = currentNodes[e.b]; if (!a || !b) return
          const posAttr = ep.points.geometry.attributes.position as THREE.BufferAttribute
          for (let pi = 0; pi < ep.tValues.length; pi++) {
            ep.tValues[pi] = (ep.tValues[pi] + 0.003 * speedMult) % 1.0
            const t = ep.tValues[pi]
            posAttr.setXYZ(pi, a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t)
          }
          posAttr.needsUpdate = true
        })
      }

      // B58 Enhancement 2: Update pulse rings
      const b58Now = performance.now()
      b58PulseRings.forEach((pr) => {
        const n = currentNodes[pr.nodeIndex]; if (!n) return
        const DURATION = 1500
        const baseR = n.size * 0.9
        // Ring 1
        const t1 = ((b58Now - pr.startTime) % DURATION) / DURATION
        pr.ring1.scale.setScalar(1 + t1 * 2)
        ;(pr.ring1.material as THREE.MeshBasicMaterial).opacity = (1 - t1) * 0.6
        pr.ring1.position.set(n.x, n.y, n.z)
        pr.ring1.lookAt(camera.position)
        // Ring 2 staggered 0.75s
        const t2 = ((b58Now - pr.startTime + 750) % DURATION) / DURATION
        pr.ring2.scale.setScalar(1 + t2 * 2)
        ;(pr.ring2.material as THREE.MeshBasicMaterial).opacity = (1 - t2) * 0.6
        pr.ring2.position.set(n.x, n.y, n.z)
        pr.ring2.lookAt(camera.position)
      })

      // B58 Enhancement 4: Update corona glows
      b58CoronaSprites.forEach((cs) => {
        const n = currentNodes[cs.nodeIndex]; if (!n) return
        const sine = Math.sin(pulseTick * cs.pulseSpeed) * 0.5 + 0.5
        cs.sprite.scale.setScalar(n.size * 4.0 * (0.85 + sine * 0.3))
        cs.sprite.position.set(n.x, n.y, n.z)
      })

      // Goal group gentle float
      if (!isPaused) {
        goalGroup.children.forEach((child, i) => {
          if (child instanceof THREE.Sprite) {
            child.position.y += Math.sin(pulseTick + i * 0.3) * 0.0008 * speedMult
          }
        })
      }

      // B35: Update node label positions
      const _fadeLabels = camR > 15
      currentNodes.forEach((n, i) => {
        const div = labelDivs[i]; if (!div) return
        _labelV3.set(n.x, n.y, n.z); _labelV3.project(camera)
        if (_labelV3.z > 1) { div.style.display = 'none'; return }
        const lx = (_labelV3.x+1)/2*(mount.clientWidth||600)
        const ly = (-_labelV3.y+1)/2*(mount.clientHeight||600)
        div.style.left = lx + 'px'; div.style.top = ly + 'px'
        div.style.display = 'block'
        div.style.opacity = _fadeLabels ? '0' : '1'
      })

      renderer.render(scene, camera)
    }
    animate()

    const ro = new ResizeObserver(() => {
      if (!mount) return
      const w=mount.clientWidth, h=mount.clientHeight; if(!w||!h) return
      camera.aspect=w/h; camera.updateProjectionMatrix(); renderer.setSize(w,h)
    })
    ro.observe(mount)
    _ro = ro

    _cleanup = () => {
      cancelAnimationFrame(animFrame)
      ro.disconnect()
      document.removeEventListener('visibilitychange', handleVisibility)
      document.removeEventListener('keydown', onKeyDown)
      renderer.domElement.removeEventListener('mousedown', onMouseDown)
      renderer.domElement.removeEventListener('mouseup', onMouseUp)
      renderer.domElement.removeEventListener('mousemove', onMouseMove)
      renderer.domElement.removeEventListener('wheel', onWheel)
      renderer.domElement.removeEventListener('click', onClick)
      renderer.domElement.removeEventListener('dblclick', onDblClick)
      renderer.domElement.removeEventListener('touchend', onTouchEnd)
      // Dispose sprites in nodeGroup
      nodeGroup.traverse((obj) => { if (obj instanceof THREE.Sprite) { obj.material.map?.dispose(); obj.material.dispose() } })
      edgeGroup.traverse((obj) => { if ((obj as any).geometry) (obj as any).geometry.dispose(); if ((obj as any).material) (obj as any).material.dispose() })
      goalGroup.traverse((obj) => { if (obj instanceof THREE.Sprite) { obj.material.map?.dispose(); obj.material.dispose() } })
      // B58: dispose enhancement groups
      b58StarGeo.dispose(); b58StarMat.dispose()
      b58ParticleGroup.traverse((obj) => { if ((obj as any).geometry) (obj as any).geometry.dispose(); if ((obj as any).material) (obj as any).material.dispose() })
      b58PulseGroup.traverse((obj) => { if ((obj as any).geometry) (obj as any).geometry.dispose(); if ((obj as any).material) (obj as any).material.dispose() })
      b58CoronaGroup.traverse((obj) => { if (obj instanceof THREE.Sprite) { obj.material.map?.dispose(); obj.material.dispose() } })
      hitSpheres.forEach((s) => scene.remove(s)); hitGeo.dispose(); hitMat.dispose()
      renderer.dispose()
      if (tooltipDiv?.parentNode) tooltipDiv.parentNode.removeChild(tooltipDiv)
      if (labelContainer?.parentNode) labelContainer.parentNode.removeChild(labelContainer)
      if (mount.contains(renderer.domElement)) mount.removeChild(renderer.domElement)
    }
    } // end doInit

    // B54: rAF defer only — doInit polls itself until mount has real dimensions
    requestAnimationFrame(doInit)

    return () => {
      if (_cleanup) _cleanup(); else { if (_ro) _ro.disconnect() }
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Trigger rebuild when tab/toggles change
  useEffect(() => { if (rebuildRef.current) rebuildRef.current() }, [activeTab, layerToggles])
  // Trigger goal rebuild when profiles change
  useEffect(() => { if (goalRebuildRef.current) goalRebuildRef.current() }, [goalProfiles])

  const TABS: NeuralTab[] = ['Projects', 'Agents', 'Decisions', 'Data', 'All']
  const LAYER_COLORS: Record<string, string> = { Projects: '#00ff88', Agents: '#ca8a04', Decisions: '#a855f7', Data: '#06b6d4' }

  const speedBtnStyle = (active: boolean, color: string) => ({
    padding: '4px 12px', borderRadius: 5, fontSize: 10, fontWeight: 800, border: 'none',
    cursor: 'pointer', letterSpacing: '0.06em',
    backgroundColor: active ? color : 'rgba(255,255,255,0.06)',
    color: active ? (color === '#ff4444' ? '#fff' : '#000') : '#9ca3af',
    transition: 'all 0.15s',
  })

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative' }}>

      {/* Feature 2 — Control bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 16px', borderBottom: '1px solid rgba(255,255,255,0.07)', backgroundColor: 'rgba(0,0,0,0.4)', flexShrink: 0, flexWrap: 'wrap' }}>
        {/* Speed controls */}
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <span style={{ fontSize: 9, color: '#4b5563', textTransform: 'uppercase', letterSpacing: '0.08em', marginRight: 4 }}>Speed</span>
          <button onClick={() => { const m: SpeedMode = 'slow'; speedModeRef.current = m; setSpeedMode(m) }} style={speedBtnStyle(speedMode === 'slow', '#3A8EFF')}>SLOW</button>
          <button onClick={() => { const m: SpeedMode = 'normal'; speedModeRef.current = m; setSpeedMode(m) }} style={speedBtnStyle(speedMode === 'normal', '#00ff88')}>NORMAL</button>
          <button onClick={() => { const m: SpeedMode = 'paused'; speedModeRef.current = m; setSpeedMode(m) }} style={speedBtnStyle(speedMode === 'paused', '#ff4444')}>PAUSE</button>
        </div>

        <div style={{ width: 1, height: 16, background: 'rgba(255,255,255,0.08)', margin: '0 4px' }} />

        {/* Sub-tabs */}
        {TABS.map((t) => (
          <button key={t} onClick={() => setActiveTab(t)} style={{ padding: '4px 12px', borderRadius: 5, fontSize: 10, fontWeight: 700, letterSpacing: '0.05em', border: 'none', cursor: 'pointer', backgroundColor: activeTab===t?(t==='All'?'rgba(255,255,255,0.12)':`${LAYER_COLORS[t]}22`):'rgba(255,255,255,0.04)', color: activeTab===t?(t==='All'?'#e2e8f0':LAYER_COLORS[t]):'#6b7280', transition: 'all 0.2s' }}>{t}</button>
        ))}

        {/* Layer toggles for All tab */}
        {activeTab === 'All' && (
          <div style={{ display: 'flex', gap: 5, alignItems: 'center', marginLeft: 4 }}>
            <span style={{ fontSize: 9, color: '#4b5563', letterSpacing: '0.08em', textTransform: 'uppercase' }}>Layers</span>
            {(Object.keys(LAYER_COLORS) as NeuralTab[]).map((layer) => (
              <button key={layer} onClick={() => setLayerToggles((prev) => ({ ...prev, [layer]: !prev[layer] }))} style={{ padding: '2px 8px', borderRadius: 10, fontSize: 8, fontWeight: 700, border: `1px solid ${LAYER_COLORS[layer]}55`, cursor: 'pointer', backgroundColor: layerToggles[layer]?`${LAYER_COLORS[layer]}22`:'transparent', color: layerToggles[layer]?LAYER_COLORS[layer]:'#4b5563', transition: 'all 0.15s' }}>{layer}</button>
            ))}
          </div>
        )}

        {/* Goal Paths toggle — Feature 4 */}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
          <button
            onClick={() => setGoalPathsOpen((o) => !o)}
            style={{ padding: '4px 12px', borderRadius: 5, fontSize: 10, fontWeight: 800, letterSpacing: '0.05em', border: '1px solid rgba(124,58,237,0.4)', cursor: 'pointer', backgroundColor: goalPathsOpen ? 'rgba(124,58,237,0.2)' : 'transparent', color: goalPathsOpen ? '#a78bfa' : '#6b7280', transition: 'all 0.2s' }}
          >GOAL PATHS {goalProfiles.filter((p) => p.active).length > 0 && `(${goalProfiles.filter((p) => p.active).length} active)`}</button>
          {/* Legend */}
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            {[{ shape: '■', label: 'Agent' }, { shape: '⬡', label: 'Project' }, { shape: '◆', label: 'Decision' }, { shape: '●', label: 'Data' }].map((l) => (
              <span key={l.label} style={{ fontSize: 9, color: '#4b5563' }}><span style={{ marginRight: 2 }}>{l.shape}</span>{l.label}</span>
            ))}
          </div>
        </div>
      </div>

      {/* Main content */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* Canvas wrapper */}
        <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
          <div ref={mountRef} style={{ position: 'relative', width: '100%', height: 'calc(100vh - 106px)', overflow: 'hidden' }} />

          {/* Goal Paths Drawer — Feature 4 */}
          <GoalPathsDrawer open={goalPathsOpen} onClose={() => setGoalPathsOpen(false)} onProfilesChange={handleProfilesChange} />

          {/* Path Click Panel — Feature 3 */}
          <PathClickPanel node={pathNode} screenX={pathScreenX} screenY={pathScreenY} onClose={() => setPathNode(null)} />

          {/* Feature 2 — PAUSED badge */}
          {speedMode === 'paused' && (
            <div style={{ position: 'absolute', top: 14, right: 14, zIndex: 30, padding: '5px 12px', borderRadius: 6, background: 'rgba(255,68,68,0.15)', border: '1px solid rgba(255,68,68,0.5)', color: '#ff4444', fontSize: 11, fontWeight: 800, letterSpacing: '0.1em', pointerEvents: 'none' }}>
              ⏸ PAUSED <span style={{ fontSize: 9, color: '#ff888866', marginLeft: 4 }}>SPACE to resume</span>
            </div>
          )}
          {speedMode === 'slow' && (
            <div style={{ position: 'absolute', top: 14, right: 14, zIndex: 30, padding: '5px 12px', borderRadius: 6, background: 'rgba(58,142,255,0.12)', border: '1px solid rgba(58,142,255,0.4)', color: '#3A8EFF', fontSize: 11, fontWeight: 800, letterSpacing: '0.1em', pointerEvents: 'none' }}>
              🐢 SLOW 20%
            </div>
          )}

          {/* B35 Summary Bar */}
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 20, pointerEvents: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 28, padding: '7px 20px', background: 'linear-gradient(180deg,rgba(4,8,18,0.88) 0%,rgba(4,8,18,0) 100%)' }}>
            {[
              { icon: '⬡', label: `${summaryData.activeProjects} Active Projects`, color: '#00ff88' },
              { icon: '◆', label: `${summaryData.agentsOnline} Agents Online`, color: '#ca8a04' },
              { icon: '▲', label: `${summaryData.decisionsLogged} Decisions Logged`, color: '#a855f7' },
              { icon: '⚡', label: `System Health: ${summaryData.systemHealth}%`, color: summaryData.systemHealth>70?'#00ff88':summaryData.systemHealth>40?'#ffcc00':'#ff6600' },
            ].map((item) => (
              <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <span style={{ fontSize: 11, color: item.color }}>{item.icon}</span>
                <span style={{ fontSize: 10, fontWeight: 700, color: item.color, letterSpacing: '0.05em' }}>{item.label}</span>
              </div>
            ))}
          </div>

          {/* B35 Legend */}
          <div style={{ position: 'absolute', bottom: 16, left: 16, zIndex: 20, pointerEvents: 'none', background: 'rgba(4,8,18,0.80)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 8, padding: '10px 14px', backdropFilter: 'blur(4px)', minWidth: 130 }}>
            <div style={{ fontSize: 9, color: '#4b5563', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 7 }}>Legend</div>
            {[{ shape: '■', label: 'Agent (Chip)', color: '#ca8a04' }, { shape: '⬡', label: 'Project (Hat)', color: '#00ff88' }, { shape: '◆', label: 'Decision (Gavel)', color: '#a855f7' }, { shape: '●', label: 'Data (Icon)', color: '#06b6d4' }, { shape: '○', label: 'Path Step', color: '#00ff88' }].map((l) => (
              <div key={l.label} style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 4 }}>
                <span style={{ color: l.color, fontSize: 11, lineHeight: 1, minWidth: 12 }}>{l.shape}</span>
                <span style={{ fontSize: 9, color: '#9ca3af' }}>{l.label}</span>
              </div>
            ))}
            <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', marginTop: 5, paddingTop: 5 }}>
              <div style={{ fontSize: 9, color: '#4b5563', marginBottom: 3 }}>Path States</div>
              {[{ color: '#00ff88', label: 'Complete' }, { color: '#ffcc00', label: 'In Progress' }, { color: '#ff4444', label: 'Stalled 30+ days' }, { color: '#555577', label: 'Not yet started' }].map((c) => (
                <div key={c.label} style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 2 }}>
                  <div style={{ width: 7, height: 7, borderRadius: '50%', backgroundColor: c.color, flexShrink: 0 }} />
                  <span style={{ fontSize: 8, color: '#9ca3af' }}>{c.label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* B35 Node Detail Sidebar */}
        {selectedNode && !pathNode && (
          <div style={{ width: 300, height: '100%', flexShrink: 0, backgroundColor: 'rgba(4,8,18,0.97)', borderLeft: '1px solid rgba(255,255,255,0.08)', display: 'flex', flexDirection: 'column', overflow: 'hidden', fontFamily: 'ui-monospace,monospace', animation: 'nmSlideIn 0.2s ease-out' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,0.07)', backgroundColor: 'rgba(0,0,0,0.35)' }}>
              <div>
                <div style={{ fontSize: 9, color: '#4b5563', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 2 }}>{selectedNode.type} · Detail</div>
                <div style={{ fontSize: 14, fontWeight: 800, color: '#e2e8f0', letterSpacing: '0.04em' }}>{selectedNode.label}</div>
              </div>
              <button onClick={() => setSelectedNode(null)} style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: '#9ca3af', borderRadius: 6, padding: '5px 9px', fontSize: 13, cursor: 'pointer', lineHeight: 1 }}>✕</button>
            </div>
            <div style={{ flex: 1, overflow: 'auto', padding: '16px' }}>
              {selectedNode.type === 'project' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <div>
                    <div style={{ fontSize: 9, color: '#4b5563', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 5 }}>Health Score</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ flex: 1, height: 6, borderRadius: 3, background: 'rgba(255,255,255,0.08)' }}>
                        <div style={{ height: '100%', borderRadius: 3, width: `${selectedNode.meta?.healthScore ?? 0}%`, background: (selectedNode.meta?.healthScore??0)>70?'#00ff88':(selectedNode.meta?.healthScore??0)>40?'#ffcc00':'#ff6600' }} />
                      </div>
                      <span style={{ fontSize: 13, fontWeight: 700, color: '#e2e8f0', minWidth: 24 }}>{selectedNode.meta?.healthScore ?? '?'}</span>
                    </div>
                  </div>
                  {[{ label: 'Quoted Amount', value: selectedNode.meta?.contract ? `$${(selectedNode.meta.contract/1000).toFixed(0)}k` : 'N/A' }, { label: 'Last Activity', value: 'Recently' }].map((r) => (
                    <div key={r.label}><div style={{ fontSize: 9, color: '#4b5563', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 2 }}>{r.label}</div><div style={{ fontSize: 12, color: '#e2e8f0', fontWeight: 600 }}>{r.value}</div></div>
                  ))}
                  <button style={{ marginTop: 4, padding: '8px 14px', borderRadius: 6, fontSize: 11, fontWeight: 700, background: 'rgba(0,255,136,0.10)', border: '1px solid rgba(0,255,136,0.28)', color: '#00ff88', cursor: 'pointer', letterSpacing: '0.05em' }}>Navigate to Project →</button>
                </div>
              )}
              {selectedNode.type === 'agent' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <div style={{ padding: '3px 8px', borderRadius: 4, fontSize: 9, fontWeight: 800, background: `${TIER_COLORS_HEX[Math.min((selectedNode.meta?.tier??1)-1,4)]}22`, color: TIER_COLORS_HEX[Math.min((selectedNode.meta?.tier??1)-1,4)], border: `1px solid ${TIER_COLORS_HEX[Math.min((selectedNode.meta?.tier??1)-1,4)]}44`, letterSpacing: '0.06em' }}>TIER {selectedNode.meta?.tier??'?'}</div>
                    <div style={{ padding: '3px 8px', borderRadius: 4, fontSize: 9, fontWeight: 800, background: 'rgba(0,255,136,0.12)', color: '#00ff88', border: '1px solid rgba(0,255,136,0.25)', letterSpacing: '0.06em' }}>ACTIVE</div>
                  </div>
                  <div><div style={{ fontSize: 9, color: '#4b5563', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 2 }}>Role</div><div style={{ fontSize: 12, color: '#9ca3af' }}>{selectedNode.meta?.desc ?? '—'}</div></div>
                  <div><div style={{ fontSize: 9, color: '#4b5563', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 5 }}>Capabilities</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {['Query classification','Context injection','Multi-agent routing','Prompt assembly','Structured response parsing'].map((cap) => (
                        <div key={cap} style={{ display: 'flex', alignItems: 'center', gap: 7 }}><div style={{ width: 4, height: 4, borderRadius: '50%', background: '#00ff88', flexShrink: 0 }} /><span style={{ fontSize: 11, color: '#6b7280' }}>{cap}</span></div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
              {selectedNode.type === 'decision' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <div><div style={{ fontSize: 9, color: '#4b5563', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 2 }}>Decision</div><div style={{ fontSize: 12, color: '#e2e8f0' }}>{selectedNode.label}</div></div>
                  <div style={{ fontSize: 24 }}>{selectedNode.meta?.feedback > 0 ? '👍' : selectedNode.meta?.feedback < 0 ? '👎' : '•'}<span style={{ fontSize: 11, color: '#6b7280', marginLeft: 8 }}>{selectedNode.meta?.feedback>0?'Approved':selectedNode.meta?.feedback<0?'Issue flagged':'Pending'}</span></div>
                </div>
              )}
              {selectedNode.type === 'data' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <div><div style={{ fontSize: 9, color: '#4b5563', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 2 }}>Metric</div><div style={{ fontSize: 14, fontWeight: 800, color: '#06b6d4' }}>{selectedNode.label}</div></div>
                  <div><div style={{ fontSize: 9, color: '#4b5563', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 2 }}>Current Value</div><div style={{ fontSize: 22, fontWeight: 800, color: '#e2e8f0' }}>{selectedNode.meta?.valueStr ?? '—'}</div></div>
                  <div><div style={{ fontSize: 9, color: '#4b5563', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 2 }}>7-Day Trend</div><div style={{ fontSize: 20, color: '#00ff88' }}>↗ <span style={{ fontSize: 11, color: '#6b7280' }}>Trending up</span></div></div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <style>{`
        @keyframes nmSlideIn { from { transform: translateX(100%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
        @keyframes gpSlideIn { from { transform: translateX(-100%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
      `}</style>
    </div>
  )
}

// ─── Admin Visualization Lab (main) ──────────────────────────────────────────
interface AdminVisualizationLabProps { defaultTab?: MainTab }

export default function AdminVisualizationLab({ defaultTab = 'ORB_LAB' }: AdminVisualizationLabProps = {}) {
  const [activeTab, setActiveTab] = useState<MainTab>(defaultTab)
  const [healthAvg, setHealthAvg] = useState(75)

  useEffect(() => {
    setHealthAvg(getAvgHealth())
    const iv = setInterval(() => setHealthAvg(getAvgHealth()), 30000)
    return () => clearInterval(iv)
  }, [])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', backgroundColor: '#060608', color: '#e2e8f0', fontFamily: 'ui-monospace, monospace' }}>
      <style>{`
        @keyframes twinkle { 0%, 100% { opacity: 0.3; } 50% { opacity: 1; } }
        @keyframes gridScroll { 0% { background-position: 0 0; } 100% { background-position: 40px 40px; } }
      `}</style>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '14px 24px', borderBottom: '1px solid rgba(255,255,255,0.08)', backgroundColor: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(8px)', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, backgroundColor: 'rgba(0,255,136,0.08)', border: '1px solid rgba(0,255,136,0.25)', borderRadius: 8, padding: '5px 12px' }}>
          <div style={{ width: 7, height: 7, borderRadius: '50%', backgroundColor: '#00ff88', boxShadow: '0 0 8px #00ff88', animation: 'twinkle 2s ease-in-out infinite' }} />
          <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#00ff88' }}>Visualization Lab</span>
        </div>
        <span style={{ fontSize: 10, color: '#374151', marginLeft: 4 }}>B42 · Admin Only</span>
        <div style={{ display: 'flex', gap: 6, marginLeft: 'auto' }}>
          {(['ORB_LAB', 'NEURAL_MAP', 'COMBINED'] as MainTab[]).map((t) => (
            <button key={t} onClick={() => setActiveTab(t)} style={{ padding: '8px 20px', borderRadius: 8, fontSize: 12, fontWeight: 800, letterSpacing: '0.08em', border: 'none', cursor: 'pointer', backgroundColor: activeTab===t?'#00ff88':'rgba(255,255,255,0.06)', color: activeTab===t?'#000':'#9ca3af', transition: 'all 0.2s', boxShadow: activeTab===t?'0 0 16px rgba(0,255,136,0.3)':'none' }}>{t.replace('_', ' ')}</button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', position: 'relative' }}>
        <div style={{ display: activeTab==='ORB_LAB'?'flex':'none', flex: 1, overflow: 'hidden' }}>
          <OrbLab healthAvg={healthAvg} />
        </div>
        <div style={{ display: activeTab==='NEURAL_MAP'?'flex':'none', flex: 1, overflow: 'hidden' }}>
          <NeuralMap />
        </div>
        {/* B67 — COMBINED MAP: Neural Map 2 - Combined Business Intelligence */}
        <div style={{ display: activeTab==='COMBINED'?'flex':'none', flex: 1, overflow: 'hidden' }}>
          <CombinedNeuralMap />
        </div>
      </div>
    </div>
  )
}

