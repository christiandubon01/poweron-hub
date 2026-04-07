// @ts-nocheck
/**
 * AdminVisualizationLab.tsx — B35 | Neural Map Insight Layer
 *
 * Two main tabs:
 *   ORB LAB   — Organic Orb (Three.js particles) + Geometric Orb (wireframe icosahedron)
 *   NEURAL MAP — Force-directed graph with Projects / Agents / Decisions / Data / All layers
 *
 * Admin-only: visible when user email matches VITE_ADMIN_EMAIL (gated in V15rLayout sidebar).
 * The view itself renders without auth gating so the lazy-loaded chunk is standalone.
 */

import { useRef, useEffect, useState, useCallback } from 'react'
import * as THREE from 'three'
import { getBackupData, health, getKPIs } from '../services/backupDataService'

// ─── Types ────────────────────────────────────────────────────────────────────
type OrbState = 'IDLE' | 'LISTENING' | 'THINKING' | 'SPEAKING' | 'MULTI_AGENT'
type BgMode = 'deepspace' | 'datastream' | 'grid' | 'soliddark'
type MainTab = 'ORB_LAB' | 'NEURAL_MAP'
type NeuralTab = 'Projects' | 'Agents' | 'Decisions' | 'Data' | 'All'
type DepartureMode = 'silent' | 'label' | 'tone'

// ─── Constants ────────────────────────────────────────────────────────────────
const ORB_STATES: OrbState[] = ['IDLE', 'LISTENING', 'THINKING', 'SPEAKING', 'MULTI_AGENT']

// B34: updated tier colors per spec
const TIER_COLORS_HEX = ['#FFD24A', '#3A8EFF', '#2EE89A', '#AA6EFF', '#60607A']
const TIER_COLORS_INT = [0xFFD24A, 0x3A8EFF, 0x2EE89A, 0xAA6EFF, 0x60607A]

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
  } catch {
    return 75
  }
}

function healthColorInt(avg: number): number {
  if (avg > 70) return 0x00ff88
  if (avg > 40) return 0xffcc00
  return 0xff6600
}

// ─── Background Layer ─────────────────────────────────────────────────────────
function BackgroundLayer({ mode }: { mode: BgMode }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (mode !== 'datastream') return
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    canvas.width = canvas.offsetWidth
    canvas.height = canvas.offsetHeight

    const cols = Math.floor(canvas.width / 16)
    const drops: number[] = new Array(cols).fill(0)
    const chars = '01アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホ'

    let frame: number
    function draw() {
      frame = requestAnimationFrame(draw)
      ctx.fillStyle = 'rgba(0,0,0,0.05)'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.fillStyle = '#00ff41'
      ctx.font = '14px monospace'
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

  const starStyle: React.CSSProperties = {
    position: 'absolute', inset: 0, pointerEvents: 'none',
    background: 'radial-gradient(ellipse at center, #0a0f1e 0%, #020408 100%)',
  }

  if (mode === 'deepspace') {
    return (
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden' }}>
        <div style={starStyle} />
        {Array.from({ length: 120 }, (_, i) => (
          <div key={i} style={{
            position: 'absolute',
            left: `${Math.random() * 100}%`,
            top: `${Math.random() * 100}%`,
            width: Math.random() > 0.8 ? 2 : 1,
            height: Math.random() > 0.8 ? 2 : 1,
            borderRadius: '50%',
            backgroundColor: `rgba(255,255,255,${0.3 + Math.random() * 0.7})`,
            animation: `twinkle ${2 + Math.random() * 4}s ease-in-out infinite`,
            animationDelay: `${Math.random() * 4}s`,
          }} />
        ))}
      </div>
    )
  }

  if (mode === 'datastream') {
    return (
      <canvas ref={canvasRef} style={{
        position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0.6,
      }} />
    )
  }

  if (mode === 'grid') {
    return (
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none',
        backgroundImage: 'linear-gradient(rgba(0,255,136,0.07) 1px, transparent 1px), linear-gradient(90deg, rgba(0,255,136,0.07) 1px, transparent 1px)',
        backgroundSize: '40px 40px',
        animation: 'gridScroll 20s linear infinite',
      }} />
    )
  }

  // soliddark
  return <div style={{ position: 'absolute', inset: 0, backgroundColor: '#060608', pointerEvents: 'none' }} />
}

// ─── Organic Orb (Three.js particles) ────────────────────────────────────────
function OrganicOrb({ orbState, healthAvg }: { orbState: OrbState; healthAvg: number }) {
  const mountRef = useRef<HTMLDivElement>(null)
  const stateRef = useRef<OrbState>(orbState)
  const healthRef = useRef<number>(healthAvg)

  useEffect(() => { stateRef.current = orbState }, [orbState])
  useEffect(() => { healthRef.current = healthAvg }, [healthAvg])

  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return

    // B34 Fix 1: Hoist for cleanup access after deferred init
    let animFrame: number
    let renderer: THREE.WebGLRenderer
    let ro: ResizeObserver
    // Hoist satellite arrays so removeSatellites() is accessible from cleanup
    const satellites: THREE.Mesh[] = []
    const satLabelDivs: HTMLDivElement[] = []

    function removeSatellites() {
      satellites.forEach((s) => {
        s.geometry.dispose()
        ;(s.material as THREE.Material).dispose()
      })
      satellites.length = 0
      satLabelDivs.forEach((d) => { if (d.parentNode) d.parentNode.removeChild(d) })
      satLabelDivs.length = 0
    }

    // B34 Fix 1: Defer init 100ms to ensure DOM has layout before reading clientWidth/clientHeight
    const initTimer = setTimeout(() => {
      console.log('orb init started')
      const W = Math.max(mount.clientWidth || 400, 100)
      const H = Math.max(mount.clientHeight || 400, 100)

      const scene = new THREE.Scene()
      const camera = new THREE.PerspectiveCamera(60, W / H, 0.1, 100)
      camera.position.z = 3

      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
      // B34 Fix 1: setSize after renderer creation with actual container dimensions
      renderer.setSize(mount.clientWidth || W, mount.clientHeight || H)
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
      renderer.setClearColor(0x000000, 0)
      mount.appendChild(renderer.domElement)
      console.log('orb canvas attached')

      // ── Particles ─────────────────────────────────────────────────────────────
      const PCOUNT = 2000
      const positions = new Float32Array(PCOUNT * 3)
      const origPositions = new Float32Array(PCOUNT * 3)
      const drifts = new Float32Array(PCOUNT * 3)

      for (let i = 0; i < PCOUNT; i++) {
        const phi = Math.acos(2 * Math.random() - 1)
        const theta = 2 * Math.PI * Math.random()
        const r = 0.82 + Math.random() * 0.18
        const x = r * Math.sin(phi) * Math.cos(theta)
        const y = r * Math.sin(phi) * Math.sin(theta)
        const z = r * Math.cos(phi)
        positions[i * 3] = origPositions[i * 3] = x
        positions[i * 3 + 1] = origPositions[i * 3 + 1] = y
        positions[i * 3 + 2] = origPositions[i * 3 + 2] = z
        drifts[i * 3] = (Math.random() - 0.5) * 0.0015
        drifts[i * 3 + 1] = (Math.random() - 0.5) * 0.0015
        drifts[i * 3 + 2] = (Math.random() - 0.5) * 0.0015
      }

      const pGeo = new THREE.BufferGeometry()
      pGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
      const pMat = new THREE.PointsMaterial({ color: 0x00ff88, size: 0.014, transparent: true, opacity: 0.85, sizeAttenuation: true })
      const particles = new THREE.Points(pGeo, pMat)
      scene.add(particles)

      // ── Core glow sphere ──────────────────────────────────────────────────────
      const coreGeo = new THREE.SphereGeometry(0.15, 16, 16)
      const coreMat = new THREE.MeshBasicMaterial({ color: 0x00ff88, transparent: true, opacity: 0.3 })
      const core = new THREE.Mesh(coreGeo, coreMat)
      scene.add(core)

      // ── Branch lines ──────────────────────────────────────────────────────────
      const branchGroup = new THREE.Group()
      scene.add(branchGroup)

      function buildBranches(count: number, color: number, opacity: number) {
        while (branchGroup.children.length) {
          const child = branchGroup.children[0] as THREE.Line
          child.geometry?.dispose()
          ;(child.material as THREE.Material)?.dispose()
          branchGroup.remove(child)
        }
        const maxDist = 0.38
        let added = 0
        for (let i = 0; i < PCOUNT && added < count; i += 3) {
          for (let j = i + 3; j < PCOUNT && added < count; j += 3) {
            const dx = origPositions[i * 3] - origPositions[j * 3]
            const dy = origPositions[i * 3 + 1] - origPositions[j * 3 + 1]
            const dz = origPositions[i * 3 + 2] - origPositions[j * 3 + 2]
            if (dx * dx + dy * dy + dz * dz < maxDist * maxDist) {
              const geo = new THREE.BufferGeometry()
              const pts = new Float32Array([
                origPositions[i * 3], origPositions[i * 3 + 1], origPositions[i * 3 + 2],
                origPositions[j * 3], origPositions[j * 3 + 1], origPositions[j * 3 + 2],
              ])
              geo.setAttribute('position', new THREE.BufferAttribute(pts, 3))
              const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity })
              branchGroup.add(new THREE.Line(geo, mat))
              added++
            }
          }
        }
      }

      // ── Satellite orbs for MULTI_AGENT ────────────────────────────────────────
      const satAngles = TIER_COLORS_INT.map((_, i) => (i / 5) * Math.PI * 2)

      function buildSatellites(departure: DepartureMode) {
        removeSatellites()
        TIER_COLORS_INT.forEach((color, i) => {
          const geo = new THREE.SphereGeometry(0.055, 12, 12)
          const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9 })
          const mesh = new THREE.Mesh(geo, mat)
          scene.add(mesh)
          satellites.push(mesh)

          if (departure === 'label') {
            const div = document.createElement('div')
            div.style.cssText = `
              position:absolute;font-size:9px;color:${TIER_COLORS_HEX[i]};
              font-weight:700;letter-spacing:0.05em;pointer-events:none;
              text-shadow:0 0 6px ${TIER_COLORS_HEX[i]};
              white-space:nowrap;font-family:monospace;
            `
            div.textContent = `T${i + 1}`
            mount.appendChild(div)
            satLabelDivs.push(div)
          }
        })
      }

      // ── Speaking ring waves ───────────────────────────────────────────────────
      const ringGroup = new THREE.Group()
      scene.add(ringGroup)

      // ── State tracking ────────────────────────────────────────────────────────
      let lastState: OrbState = 'IDLE'
      let lastHealth = 75
      let lastDeparture: DepartureMode = 'silent'
      let time = 0
      let rotY = 0

      buildBranches(160, 0x00ff88, 0.28)

      function animate() {
        animFrame = requestAnimationFrame(animate)
        time += 0.016
        const pulse = Math.sin(time * 2) * 0.5 + 0.5
        const state = stateRef.current
        const avg = healthRef.current
        const clr = healthColorInt(avg)

        // Rebuild branches on health change
        if (Math.abs(avg - lastHealth) > 5) {
          lastHealth = avg
          const count = avg > 70 ? 180 : avg > 40 ? 100 : 50
          const opacity = avg > 70 ? 0.3 : avg > 40 ? 0.18 : 0.1
          buildBranches(count, clr, opacity)
        }

        // State change
        if (state !== lastState) {
          if (state === 'MULTI_AGENT') buildSatellites(lastDeparture)
          else removeSatellites()
          lastState = state
        }

        // Per-state animation
        switch (state) {
          case 'IDLE':
            rotY += 0.003
            pMat.color.setHex(clr)
            coreMat.color.setHex(clr)
            coreMat.opacity = 0.2 + pulse * 0.15
            pMat.size = 0.013 + pulse * 0.003
            break

          case 'LISTENING':
            rotY += 0.001
            pMat.color.setHex(0x0088ff)
            coreMat.color.setHex(0x0088ff)
            coreMat.opacity = 0.35 + pulse * 0.2
            // Flow inward
            for (let i = 0; i < PCOUNT; i++) {
              positions[i * 3] *= 0.9998
              positions[i * 3 + 1] *= 0.9998
              positions[i * 3 + 2] *= 0.9998
              const len = Math.sqrt(
                positions[i * 3] ** 2 + positions[i * 3 + 1] ** 2 + positions[i * 3 + 2] ** 2
              )
              if (len < 0.4) {
                const phi = Math.acos(2 * Math.random() - 1)
                const theta = 2 * Math.PI * Math.random()
                positions[i * 3] = 0.95 * Math.sin(phi) * Math.cos(theta)
                positions[i * 3 + 1] = 0.95 * Math.sin(phi) * Math.sin(theta)
                positions[i * 3 + 2] = 0.95 * Math.cos(phi)
              }
            }
            pGeo.attributes.position.needsUpdate = true
            break

          case 'THINKING':
            rotY += 0.012
            pMat.color.setHex(0xffaa00)
            coreMat.color.setHex(0xffaa00)
            coreMat.opacity = 0.5 + pulse * 0.3
            pMat.size = 0.011
            break

          case 'SPEAKING': {
            rotY += 0.005
            pMat.color.setHex(0x00ffcc)
            coreMat.color.setHex(0x00ffcc)
            coreMat.opacity = 0.4 + Math.sin(time * 8) * 0.2
            pMat.size = 0.014 + Math.sin(time * 8) * 0.007
            // Concentric rings
            if (ringGroup.children.length < 4) {
              const rGeo = new THREE.TorusGeometry(0.1 + ringGroup.children.length * 0.3, 0.005, 6, 32)
              const rMat = new THREE.MeshBasicMaterial({ color: 0x00ffcc, transparent: true, opacity: 0.5 })
              ringGroup.add(new THREE.Mesh(rGeo, rMat))
            }
            ringGroup.children.forEach((child, idx) => {
              const torus = child as THREE.Mesh
              const s = 1 + ((time * 0.5 + idx * 0.25) % 1) * 3
              torus.scale.setScalar(s)
              ;(torus.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.5 - s * 0.15)
            })
            break
          }

          case 'MULTI_AGENT':
            rotY += 0.004
            pMat.color.setHex(clr)
            coreMat.color.setHex(clr)
            coreMat.opacity = 0.3 + pulse * 0.1
            // Animate satellites
            satellites.forEach((sat, i) => {
              satAngles[i] += 0.018 * (1 + i * 0.15)
              const orbitR = 1.35 + i * 0.09
              sat.position.x = Math.cos(satAngles[i]) * orbitR
              sat.position.y = Math.sin(satAngles[i] * 0.6) * 0.55
              sat.position.z = Math.sin(satAngles[i]) * orbitR
              const scale = 0.7 + pulse * 0.5
              sat.scale.setScalar(scale)
              ;(sat.material as THREE.MeshBasicMaterial).opacity = 0.7 + pulse * 0.25

              // Update label position
              const label = satLabelDivs[i]
              if (label) {
                const projected = sat.position.clone().project(camera)
                label.style.left = ((projected.x + 1) / 2 * (mount.clientWidth || 400) + 14) + 'px'
                label.style.top = ((-projected.y + 1) / 2 * (mount.clientHeight || 400)) + 'px'
              }
            })
            break
        }

        // Drift particles (non-LISTENING states restore toward original)
        if (state !== 'LISTENING') {
          for (let i = 0; i < PCOUNT; i++) {
            positions[i * 3] += drifts[i * 3]
            positions[i * 3 + 1] += drifts[i * 3 + 1]
            positions[i * 3 + 2] += drifts[i * 3 + 2]
            const dx = origPositions[i * 3] - positions[i * 3]
            const dy = origPositions[i * 3 + 1] - positions[i * 3 + 1]
            const dz = origPositions[i * 3 + 2] - positions[i * 3 + 2]
            const dist = Math.sqrt(dx * dx + dy * dy + dz * dz)
            if (dist > 0.12) {
              drifts[i * 3] += dx * 0.00008
              drifts[i * 3 + 1] += dy * 0.00008
              drifts[i * 3 + 2] += dz * 0.00008
            }
          }
          pGeo.attributes.position.needsUpdate = true
        }

        particles.rotation.y = rotY
        particles.rotation.x = Math.sin(time * 0.4) * 0.08
        branchGroup.rotation.y = rotY
        branchGroup.rotation.x = Math.sin(time * 0.4) * 0.08

        renderer.render(scene, camera)
      }

      animate()

      // B34 Fix 1: ResizeObserver calls renderer.setSize on dimension changes
      ro = new ResizeObserver(() => {
        if (!mount) return
        const w = mount.clientWidth
        const h = mount.clientHeight
        if (w === 0 || h === 0) return
        camera.aspect = w / h
        camera.updateProjectionMatrix()
        renderer.setSize(w, h)
      })
      ro.observe(mount)
    }, 100) // 100ms defer ensures DOM has layout

    return () => {
      clearTimeout(initTimer)
      if (animFrame) cancelAnimationFrame(animFrame)
      if (ro) ro.disconnect()
      removeSatellites()
      if (renderer) {
        renderer.dispose()
        if (mount && mount.contains(renderer.domElement)) mount.removeChild(renderer.domElement)
      }
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // B34 Fix 1: explicit minHeight so container has dimensions at mount time
  return <div ref={mountRef} style={{ width: '100%', height: '100%', minHeight: '400px' }} />
}

// ─── Geometric Orb (Three.js icosahedron wireframe) ───────────────────────────
function GeometricOrb({ orbState, healthAvg }: { orbState: OrbState; healthAvg: number }) {
  const mountRef = useRef<HTMLDivElement>(null)
  const stateRef = useRef<OrbState>(orbState)
  const healthRef = useRef<number>(healthAvg)

  useEffect(() => { stateRef.current = orbState }, [orbState])
  useEffect(() => { healthRef.current = healthAvg }, [healthAvg])

  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return

    // B34 Fix 1: Hoist for cleanup access after deferred init
    let animFrame: number
    let renderer: THREE.WebGLRenderer
    let ro: ResizeObserver

    // B34 Fix 1: Defer init 100ms to ensure DOM has layout
    const initTimer = setTimeout(() => {
      console.log('orb init started')
      const W = Math.max(mount.clientWidth || 400, 100)
      const H = Math.max(mount.clientHeight || 400, 100)

      const scene = new THREE.Scene()
      const camera = new THREE.PerspectiveCamera(60, W / H, 0.1, 100)
      camera.position.z = 3

      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
      // B34 Fix 1: setSize after renderer creation with actual container dimensions
      renderer.setSize(mount.clientWidth || W, mount.clientHeight || H)
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
      renderer.setClearColor(0x000000, 0)
      mount.appendChild(renderer.domElement)
      console.log('orb canvas attached')

      // Base icosahedron - detail 2 for subdivision
      const icoGeo = new THREE.IcosahedronGeometry(1, 2)
      const icoEdges = new THREE.EdgesGeometry(icoGeo)
      const icoMat = new THREE.LineBasicMaterial({ color: 0x00ff88, transparent: true, opacity: 0.7 })
      const wireframe = new THREE.LineSegments(icoEdges, icoMat)
      scene.add(wireframe)

      // Inner core
      const coreGeo = new THREE.IcosahedronGeometry(0.45, 1)
      const coreEdges = new THREE.EdgesGeometry(coreGeo)
      const coreMat = new THREE.LineBasicMaterial({ color: 0x00ff88, transparent: true, opacity: 0.4 })
      const innerWire = new THREE.LineSegments(coreEdges, coreMat)
      scene.add(innerWire)

      // Face pulse meshes for SPEAKING state
      const faceMat = new THREE.MeshBasicMaterial({
        color: 0x00ffcc, transparent: true, opacity: 0.0, side: THREE.FrontSide,
      })
      const solidGeo = new THREE.IcosahedronGeometry(1, 2)
      const solidMesh = new THREE.Mesh(solidGeo, faceMat)
      scene.add(solidMesh)

      // Edge highlight lines
      const outerGeo = new THREE.IcosahedronGeometry(1.05, 0)
      const outerEdges = new THREE.EdgesGeometry(outerGeo)
      const outerMat = new THREE.LineBasicMaterial({ color: 0x00ff88, transparent: true, opacity: 0.2 })
      const outerWire = new THREE.LineSegments(outerEdges, outerMat)
      scene.add(outerWire)

      let time = 0

      function animate() {
        animFrame = requestAnimationFrame(animate)
        time += 0.016
        const pulse = Math.sin(time * 2) * 0.5 + 0.5
        const state = stateRef.current
        const avg = healthRef.current
        const clr = healthColorInt(avg)

        icoMat.color.setHex(clr)
        coreMat.color.setHex(clr)

        // Edge thickness by health
        outerMat.opacity = avg > 70 ? 0.3 + pulse * 0.1 : avg > 40 ? 0.15 + pulse * 0.08 : 0.05

        switch (state) {
          case 'IDLE':
            wireframe.rotation.y += 0.005
            wireframe.rotation.x += 0.002
            innerWire.rotation.y -= 0.004
            innerWire.rotation.x -= 0.002
            icoMat.opacity = 0.6 + pulse * 0.15
            faceMat.opacity = 0
            wireframe.scale.setScalar(1)
            break

          case 'LISTENING':
            wireframe.rotation.y += 0.001
            // Faces orient toward camera (scale Y slightly)
            wireframe.scale.y = 0.85 + pulse * 0.1
            wireframe.scale.x = 1 + pulse * 0.05
            icoMat.opacity = 0.5
            faceMat.opacity = 0.06 + pulse * 0.04
            faceMat.color.setHex(0x0088ff)
            icoMat.color.setHex(0x0088ff)
            coreMat.color.setHex(0x0088ff)
            break

          case 'THINKING':
            wireframe.rotation.y += 0.018
            wireframe.rotation.z += 0.009
            innerWire.rotation.y -= 0.015
            icoMat.opacity = 0.8 + pulse * 0.2
            faceMat.opacity = 0.12 + pulse * 0.08
            faceMat.color.setHex(0xffaa00)
            icoMat.color.setHex(0xffaa00)
            coreMat.color.setHex(0xffaa00)
            break

          case 'SPEAKING': {
            wireframe.rotation.y += 0.006
            const wave = Math.sin(time * 8)
            const pulseFaces = (wave * 0.5 + 0.5)
            // Faces pulse outward
            const scl = 1 + wave * 0.08
            wireframe.scale.setScalar(scl)
            solidMesh.scale.setScalar(scl * 0.98)
            faceMat.opacity = 0.08 + pulseFaces * 0.12
            faceMat.color.setHex(0x00ffcc)
            icoMat.color.setHex(0x00ffcc)
            coreMat.color.setHex(0x00ffcc)
            icoMat.opacity = 0.7 + pulseFaces * 0.2
            break
          }

          case 'MULTI_AGENT':
            wireframe.rotation.y += 0.005
            wireframe.rotation.z = Math.sin(time * 0.5) * 0.3
            icoMat.color.setHex(clr)
            icoMat.opacity = 0.65 + pulse * 0.15
            faceMat.opacity = 0.05 + pulse * 0.07
            faceMat.color.setHex(clr)
            break
        }

        outerWire.rotation.copy(wireframe.rotation)
        outerWire.scale.copy(wireframe.scale)
        innerWire.rotation.y = -wireframe.rotation.y * 0.8
        innerWire.rotation.x = wireframe.rotation.x * 0.6
        solidMesh.rotation.copy(wireframe.rotation)

        renderer.render(scene, camera)
      }

      animate()

      // B34 Fix 1: ResizeObserver calls renderer.setSize on dimension changes
      ro = new ResizeObserver(() => {
        if (!mount) return
        const w = mount.clientWidth
        const h = mount.clientHeight
        if (w === 0 || h === 0) return
        camera.aspect = w / h
        camera.updateProjectionMatrix()
        renderer.setSize(w, h)
      })
      ro.observe(mount)
    }, 100) // 100ms defer ensures DOM has layout

    return () => {
      clearTimeout(initTimer)
      if (animFrame) cancelAnimationFrame(animFrame)
      if (ro) ro.disconnect()
      if (renderer) {
        renderer.dispose()
        if (mount && mount.contains(renderer.domElement)) mount.removeChild(renderer.domElement)
      }
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // B34 Fix 1: explicit minHeight so container has dimensions at mount time
  return <div ref={mountRef} style={{ width: '100%', height: '100%', minHeight: '400px' }} />
}

// ─── Orb Lab ──────────────────────────────────────────────────────────────────
function OrbLab({ healthAvg }: { healthAvg: number }) {
  const [orbState, setOrbState] = useState<OrbState>('IDLE')
  const [bgMode, setBgMode] = useState<BgMode>('deepspace')
  const [fullscreen, setFullscreen] = useState<'left' | 'right' | null>(null)
  const [departure, setDeparture] = useState<DepartureMode>('silent')

  const BG_OPTIONS: { label: string; value: BgMode }[] = [
    { label: '🌌 Deep Space', value: 'deepspace' },
    { label: '💻 Data Stream', value: 'datastream' },
    { label: '⬡ Grid', value: 'grid' },
    { label: '⬛ Solid Dark', value: 'soliddark' },
  ]

  const healthLabel = healthAvg > 70 ? 'HEALTHY' : healthAvg > 40 ? 'WARNING' : 'CRITICAL'
  const healthClr = healthAvg > 70 ? '#00ff88' : healthAvg > 40 ? '#ffcc00' : '#ff6600'

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Controls bar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 16, padding: '10px 20px',
        borderBottom: '1px solid rgba(255,255,255,0.07)', flexWrap: 'wrap',
        backgroundColor: 'rgba(0,0,0,0.3)',
      }}>
        {/* State selector */}
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <span style={{ fontSize: 10, color: '#9ca3af', letterSpacing: '0.08em', textTransform: 'uppercase', marginRight: 4 }}>State</span>
          {ORB_STATES.map((s) => (
            <button
              key={s}
              onClick={() => setOrbState(s)}
              style={{
                padding: '4px 10px', borderRadius: 6, fontSize: 10, fontWeight: 700,
                letterSpacing: '0.05em', border: 'none', cursor: 'pointer',
                backgroundColor: orbState === s ? '#00ff88' : 'rgba(255,255,255,0.06)',
                color: orbState === s ? '#000' : '#9ca3af',
                transition: 'all 0.2s',
              }}
            >
              {s.replace('_', '-')}
            </button>
          ))}
        </div>

        {/* Departure mode (shown only in MULTI_AGENT) */}
        {orbState === 'MULTI_AGENT' && (
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <span style={{ fontSize: 10, color: '#9ca3af', letterSpacing: '0.08em', textTransform: 'uppercase', marginRight: 4 }}>Departure</span>
            {(['silent', 'label', 'tone'] as DepartureMode[]).map((d) => (
              <button
                key={d}
                onClick={() => setDeparture(d)}
                style={{
                  padding: '4px 8px', borderRadius: 5, fontSize: 10, fontWeight: 600,
                  border: 'none', cursor: 'pointer',
                  backgroundColor: departure === d ? '#7c3aed' : 'rgba(255,255,255,0.06)',
                  color: departure === d ? '#fff' : '#9ca3af',
                }}
              >
                {d}
              </button>
            ))}
          </div>
        )}

        {/* Health indicator */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto' }}>
          <div style={{
            width: 8, height: 8, borderRadius: '50%',
            backgroundColor: healthClr, boxShadow: `0 0 6px ${healthClr}`,
          }} />
          <span style={{ fontSize: 10, color: healthClr, fontWeight: 700, letterSpacing: '0.08em' }}>
            {healthLabel} ({Math.round(healthAvg)})
          </span>
        </div>

        {/* Background selector */}
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <span style={{ fontSize: 10, color: '#9ca3af', letterSpacing: '0.08em', textTransform: 'uppercase', marginRight: 4 }}>Bg</span>
          {BG_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setBgMode(opt.value)}
              title={opt.label}
              style={{
                padding: '4px 8px', borderRadius: 5, fontSize: 10, border: 'none', cursor: 'pointer',
                backgroundColor: bgMode === opt.value ? 'rgba(0,255,136,0.15)' : 'rgba(255,255,255,0.04)',
                color: bgMode === opt.value ? '#00ff88' : '#6b7280',
                fontWeight: bgMode === opt.value ? 700 : 400,
              }}
            >
              {opt.label.split(' ')[0]}
            </button>
          ))}
        </div>
      </div>

      {/* Orb panels */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', position: 'relative' }}>
        {/* Left: Organic Orb */}
        {fullscreen !== 'right' && (
          <div style={{
            flex: fullscreen === 'left' ? 1 : '0 0 50%',
            position: 'relative', overflow: 'hidden',
            borderRight: fullscreen ? 'none' : '1px solid rgba(255,255,255,0.06)',
          }}>
            <BackgroundLayer mode={bgMode} />
            <div style={{ position: 'absolute', inset: 0 }}>
              <OrganicOrb orbState={orbState} healthAvg={healthAvg} />
            </div>
            <div style={{
              position: 'absolute', top: 10, left: 14, zIndex: 10,
              fontSize: 10, fontWeight: 700, letterSpacing: '0.1em',
              color: '#00ff88', textShadow: '0 0 8px #00ff88', textTransform: 'uppercase',
            }}>
              Organic Orb
            </div>
            <button
              onClick={() => setFullscreen(fullscreen === 'left' ? null : 'left')}
              style={{
                position: 'absolute', top: 8, right: 8, zIndex: 10,
                background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.1)',
                color: '#9ca3af', borderRadius: 5, padding: '3px 7px', fontSize: 10, cursor: 'pointer',
              }}
            >
              {fullscreen === 'left' ? '⊡' : '⊞'}
            </button>
          </div>
        )}

        {/* Right: Geometric Orb */}
        {fullscreen !== 'left' && (
          <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
            <BackgroundLayer mode={bgMode} />
            <div style={{ position: 'absolute', inset: 0 }}>
              <GeometricOrb orbState={orbState} healthAvg={healthAvg} />
            </div>
            <div style={{
              position: 'absolute', top: 10, left: 14, zIndex: 10,
              fontSize: 10, fontWeight: 700, letterSpacing: '0.1em',
              color: '#00ff88', textShadow: '0 0 8px #00ff88', textTransform: 'uppercase',
            }}>
              Geometric Orb
            </div>
            <button
              onClick={() => setFullscreen(fullscreen === 'right' ? null : 'right')}
              style={{
                position: 'absolute', top: 8, right: 8, zIndex: 10,
                background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.1)',
                color: '#9ca3af', borderRadius: 5, padding: '3px 7px', fontSize: 10, cursor: 'pointer',
              }}
            >
              {fullscreen === 'right' ? '⊡' : '⊞'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Neural Map ───────────────────────────────────────────────────────────────
interface NNode {
  id: string; label: string; type: 'project' | 'agent' | 'decision' | 'data'
  color: number; size: number
  x: number; y: number; z: number
  vx: number; vy: number; vz: number
  fx: number; fy: number; fz: number
  mesh?: THREE.Mesh | THREE.Group
  meta?: Record<string, any>
  pinned?: boolean
}
interface NEdge { a: number; b: number; line?: THREE.Line | THREE.Mesh }

function NeuralMap() {
  const mountRef = useRef<HTMLDivElement>(null)
  const [activeTab, setActiveTab] = useState<NeuralTab>('All')
  const [layerToggles, setLayerToggles] = useState({ Projects: true, Agents: true, Decisions: true, Data: true })
  const sceneDataRef = useRef<{ nodes: NNode[]; edges: NEdge[] }>({ nodes: [], edges: [] })
  const rebuildRef = useRef<() => void>(() => {})
  const activeTabRef = useRef<NeuralTab>(activeTab)
  const togglesRef = useRef(layerToggles)

  useEffect(() => { activeTabRef.current = activeTab }, [activeTab])
  useEffect(() => { togglesRef.current = layerToggles }, [layerToggles])

  // B35 state
  const [selectedNode, setSelectedNode] = useState<NNode | null>(null)
  const setSelectedNodeRef = useRef<(n: NNode | null) => void>(() => {})
  useEffect(() => { setSelectedNodeRef.current = setSelectedNode }, [])
  const [summaryData, setSummaryData] = useState({ activeProjects: 0, agentsOnline: 0, decisionsLogged: 0, systemHealth: 75 })
  const setSummaryRef = useRef<(d: any) => void>(() => {})
  useEffect(() => { setSummaryRef.current = setSummaryData }, [])

  // Build node/edge data
  function buildGraphData(tab: NeuralTab, toggles: typeof layerToggles): { nodes: NNode[]; edges: NEdge[] } {
    const nodes: NNode[] = []
    const edges: NEdge[] = []
    const rand = (scale = 5) => (Math.random() - 0.5) * scale

    const showP = tab === 'Projects' || (tab === 'All' && toggles.Projects)
    const showA = tab === 'Agents' || (tab === 'All' && toggles.Agents)
    const showD = tab === 'Decisions' || (tab === 'All' && toggles.Decisions)
    const showDa = tab === 'Data' || (tab === 'All' && toggles.Data)

    // ── Projects ──────────────────────────────────────────────────────────────
    if (showP) {
      const data = getBackupData()
      const projects = data?.projects || []
      projects.forEach((p) => {
        const sc = health(p, data).sc
        const clr = sc > 70 ? 0x00ff88 : sc > 40 ? 0xffcc00 : 0xff6600
        const sz = 0.06 + Math.min(0.18, (p.contract || 50000) / 1000000)
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
      AGENT_LIST.slice(0, 15).forEach((ag) => {
        const tierClr = TIER_COLORS_INT[Math.min(ag.tier - 1, 4)]
        nodes.push({
          id: 'ag_' + ag.id, label: ag.label, type: 'agent',
          color: tierClr, size: 0.09 + Math.random() * 0.05,
          x: rand(5), y: rand(5), z: rand(5),
          vx: 0, vy: 0, vz: 0, fx: 0, fy: 0, fz: 0,
          meta: { tier: ag.tier, desc: ag.desc },
        })
      })
      // Delegation edges between agents
      const agentNodes = nodes.filter((n) => n.type === 'agent')
      if (agentNodes.length > 3) {
        const nexusIdx = nodes.findIndex((n) => n.id === 'ag_NEXUS')
        agentNodes.forEach((n, i) => {
          const nIdx = nodes.indexOf(n)
          if (nexusIdx >= 0 && nIdx !== nexusIdx && Math.random() > 0.3) {
            edges.push({ a: nexusIdx, b: nIdx })
          }
          if (i > 0 && Math.random() > 0.65) {
            edges.push({ a: nodes.indexOf(agentNodes[Math.floor(Math.random() * i)]), b: nIdx })
          }
        })
      }
    }

    // ── Decisions (mock last 50) ───────────────────────────────────────────────
    if (showD) {
      const DECISION_MOCKS = [
        { label: 'Approved change order', feedback: 1 },
        { label: 'Delayed inspection', feedback: -1 },
        { label: 'Material substitution', feedback: 0 },
        { label: 'Crew overtime approved', feedback: 1 },
        { label: 'RFI response sent', feedback: 1 },
        { label: 'Scope clarification', feedback: 0 },
        { label: 'Budget threshold alert', feedback: -1 },
        { label: 'Phase marked complete', feedback: 1 },
      ]
      const count = Math.min(50, 20 + Math.floor(Math.random() * 15))
      for (let i = 0; i < count; i++) {
        const mock = DECISION_MOCKS[i % DECISION_MOCKS.length]
        const clr = mock.feedback > 0 ? 0x00cc55 : mock.feedback < 0 ? 0xff4444 : 0x555577
        nodes.push({
          id: 'dec_' + i, label: mock.label, type: 'decision',
          color: clr, size: 0.04 + Math.random() * 0.04,
          x: rand(6), y: rand(6), z: rand(6),
          vx: 0, vy: 0, vz: 0, fx: 0, fy: 0, fz: 0,
          meta: { feedback: mock.feedback },
        })
      }
    }

    // ── Data (financial metrics) ───────────────────────────────────────────────
    if (showDa) {
      const d = getBackupData()
      const kpis = d ? getKPIs(d) : {}
      const metrics = [
        { label: 'Pipeline', value: kpis.totalPipeline || 0, color: 0x3b82f6 },
        { label: 'Paid', value: kpis.totalPaid || 0, color: 0x22c55e },
        { label: 'Exposure', value: kpis.totalAR || 0, color: 0xf59e0b },
        { label: 'Unbilled', value: kpis.totalUnbilled || 0, color: 0xa855f7 },
        { label: 'ServiceNet', value: kpis.serviceNet || 0, color: 0x06b6d4 },
      ]
      const dataStart = nodes.length
      metrics.forEach((m, i) => {
        const sz = 0.1 + Math.min(0.25, Math.abs(m.value) / 2000000)
        const absVal = Math.abs(m.value)
        const valStr = absVal >= 1000000
          ? `$${(absVal / 1000000).toFixed(1)}M`
          : absVal >= 1000
          ? `$${(absVal / 1000).toFixed(0)}k`
          : `$${absVal.toFixed(0)}`
        nodes.push({
          id: 'data_' + i, label: m.label, type: 'data',
          color: m.color, size: sz, x: rand(3), y: rand(3), z: rand(3),
          vx: 0, vy: 0, vz: 0, fx: 0, fy: 0, fz: 0,
          meta: { valueStr: valStr, metricType: m.label.toLowerCase() },
        })
      })
      // Connect data nodes to projects
      if (showP) {
        nodes.filter((n) => n.type === 'project').slice(0, 5).forEach((projNode, pi) => {
          const projIdx = nodes.indexOf(projNode)
          const dataIdx = dataStart + (pi % metrics.length)
          if (dataIdx < nodes.length) edges.push({ a: projIdx, b: dataIdx })
        })
      }
    }

    return { nodes, edges }
  }

  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return
    const W = Math.max(mount.clientWidth || 600, 100)
    const H = Math.max(mount.clientHeight || 600, 100)

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(55, W / H, 0.1, 100)
    camera.position.z = 10

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setSize(W, H)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setClearColor(0x020408, 1)
    mount.appendChild(renderer.domElement)

    // B34 Fix 2: Add lights for MeshStandardMaterial emissive to work properly
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.25)
    scene.add(ambientLight)
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.5)
    dirLight.position.set(5, 8, 5)
    scene.add(dirLight)

    // Node groups
    const nodeGroup = new THREE.Group()
    const edgeGroup = new THREE.Group()
    scene.add(nodeGroup)
    scene.add(edgeGroup)

    // B34 Fix 3: Shared hit sphere geometry/material (invisible) for raycasting
    const hitGeo = new THREE.SphereGeometry(1, 5, 5)
    const hitMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.0, depthWrite: false })
    let hitSpheres: THREE.Mesh[] = []

    let currentNodes: NNode[] = []
    let currentEdges: NEdge[] = []
    let simulationActive = true
    let edgesAsTubes = false // B34: upgrade edges to tubes after simulation settles

    // B35: Label overlay system
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
      if (a?.type === 'agent' && b?.type === 'agent') {
        return `${la} → ${lb}: Delegated coordination tasks`
      }
      if ((a?.type === 'agent' && b?.type === 'project') || (a?.type === 'project' && b?.type === 'agent')) {
        const agent = a?.type === 'agent' ? la : lb
        const proj = a?.type === 'project' ? la : lb
        return `${agent}: Active monitoring of ${proj}`
      }
      if ((a?.type === 'project' && b?.type === 'data') || (a?.type === 'data' && b?.type === 'project')) {
        const proj = a?.type === 'project' ? la : lb
        const data = a?.type === 'data' ? la : lb
        const val = (a?.type === 'data' ? a : b)?.meta?.valueStr || ''
        return `${proj} → ${data}: Contributes ${val}`
      }
      return `${la} ↔ ${lb}: Related`
    }

    // B34 Fix 2: Create premium node mesh based on type
    function createNodeMesh(n: NNode): THREE.Mesh | THREE.Group {
      if (n.type === 'project') {
        // Inner glowing energy sphere
        const innerGeo = new THREE.SphereGeometry(0.75, 16, 16)
        const innerMat = new THREE.MeshStandardMaterial({
          color: 0x111111,
          emissive: n.color,
          emissiveIntensity: 0.7,
          transparent: false,
        })
        const innerMesh = new THREE.Mesh(innerGeo, innerMat)

        // Outer transparent shell
        const outerGeo = new THREE.SphereGeometry(1.0, 16, 16)
        const outerMat = new THREE.MeshBasicMaterial({
          color: n.color,
          transparent: true,
          opacity: 0.12,
          side: THREE.FrontSide,
        })
        const outerMesh = new THREE.Mesh(outerGeo, outerMat)
        outerMesh.add(innerMesh)
        return outerMesh

      } else if (n.type === 'agent') {
        // B34 Fix 2: Crystalline gem — IcosahedronGeometry detail=1 flat shading
        const geo = new THREE.IcosahedronGeometry(1, 1)
        const mat = new THREE.MeshStandardMaterial({
          color: 0x0a0a0a,
          emissive: n.color,
          emissiveIntensity: 0.5,
          flatShading: true,
        })
        const mesh = new THREE.Mesh(geo, mat)

        // Ring around T1 NEXUS node only
        if (n.id === 'ag_NEXUS') {
          const ringGeo = new THREE.TorusGeometry(1.9, 0.06, 6, 40)
          const ringMat = new THREE.MeshBasicMaterial({
            color: TIER_COLORS_INT[0],
            transparent: true,
            opacity: 0.8,
          })
          const ring = new THREE.Mesh(ringGeo, ringMat)
          ring.rotation.x = Math.PI / 3
          mesh.add(ring)
        }
        return mesh

      } else if (n.type === 'decision') {
        // B34 Fix 2: Diamond — OctahedronGeometry rotated 45deg
        const geo = new THREE.OctahedronGeometry(1)
        const mat = new THREE.MeshStandardMaterial({
          color: 0x0a0a0a,
          emissive: n.color,
          emissiveIntensity: 0.5,
          flatShading: false,
        })
        const mesh = new THREE.Mesh(geo, mat)
        mesh.rotation.z = Math.PI / 4
        return mesh

      } else {
        // data — B34 Fix 2: Hexagonal prism CylinderGeometry 6 segments
        const geo = new THREE.CylinderGeometry(1, 1, 1.3, 6)
        const mat = new THREE.MeshStandardMaterial({
          color: 0x0a0a0a,
          emissive: n.color,
          emissiveIntensity: 0.45,
          flatShading: false,
        })
        return new THREE.Mesh(geo, mat)
      }
    }

    // Build scene from node/edge data
    function rebuildScene() {
      // Clear old hitSpheres from scene
      hitSpheres.forEach((s) => scene.remove(s))
      hitSpheres = []
      // B35: Clear old labels
      if (labelContainer) labelContainer.innerHTML = ''
      labelDivs = []

      // Clear old nodes/edges
      while (nodeGroup.children.length) nodeGroup.remove(nodeGroup.children[0])
      while (edgeGroup.children.length) edgeGroup.remove(edgeGroup.children[0])

      edgesAsTubes = false

      const { nodes, edges } = buildGraphData(activeTabRef.current, togglesRef.current)
      // Cluster if > 200 nodes
      const capped = nodes.slice(0, 200)
      currentNodes = capped
      currentEdges = edges.filter((e) => e.a < capped.length && e.b < capped.length)

      // B34 Fix 2: Create premium meshes per node
      currentNodes.forEach((n) => {
        const mesh = createNodeMesh(n)
        mesh.scale.setScalar(n.size)
        mesh.position.set(n.x, n.y, n.z)
        nodeGroup.add(mesh)
        n.mesh = mesh

        // B34 Fix 3: Create invisible hit sphere (1.5x visual size) for raycasting
        const hs = new THREE.Mesh(hitGeo, hitMat)
        hs.scale.setScalar(n.size * 1.5)
        hs.position.set(n.x, n.y, n.z)
        scene.add(hs)
        hitSpheres.push(hs)
      })

      // B35: Create node label divs
      if (labelContainer) {
        labelDivs = currentNodes.map((n) => {
          const div = document.createElement('div')
          div.style.cssText = [
            'position:absolute;pointer-events:none;white-space:nowrap;',
            'font-family:monospace;font-size:10px;font-weight:700;letter-spacing:0.04em;',
            'background:rgba(4,8,18,0.82);border:1px solid rgba(255,255,255,0.08);',
            'border-radius:5px;padding:2px 6px;color:#e2e8f0;',
            'transform:translate(-50%,-100%);margin-top:-8px;transition:opacity 0.3s;',
          ].join('')
          if (n.type === 'project') {
            const h = n.meta?.healthScore ?? '?'
            const hc = (h as number) > 70 ? '#00ff88' : (h as number) > 40 ? '#ffcc00' : '#ff6600'
            div.innerHTML = `<span style="color:${hc}">${n.label}</span> <span style="color:#6b7280;font-size:9px">${h}</span>`
          } else if (n.type === 'agent') {
            div.innerHTML = `<span style="color:#ca8a04">${n.label}</span><span style="background:rgba(0,255,136,0.15);color:#00ff88;font-size:8px;padding:1px 4px;border-radius:3px;margin-left:3px">Active</span>`
          } else if (n.type === 'decision') {
            const fb = n.meta?.feedback
            const emoji = fb > 0 ? '👍' : fb < 0 ? '👎' : '•'
            div.innerHTML = `<span style="color:#a855f7;font-size:9px">${n.label}</span> <span>${emoji}</span>`
          } else {
            div.innerHTML = `<span style="color:#06b6d4">${n.label}</span> <span style="color:#9ca3af;font-size:9px">${n.meta?.valueStr ?? ''}</span>`
          }
          labelContainer!.appendChild(div)
          return div
        })
      }

      // B34 Fix 2: Create initial edge lines (fast update during simulation)
      currentEdges.forEach((e) => {
        const a = currentNodes[e.a], b = currentNodes[e.b]
        if (!a || !b) return
        const geo = new THREE.BufferGeometry()
        const pts = new Float32Array([a.x, a.y, a.z, b.x, b.y, b.z])
        geo.setAttribute('position', new THREE.BufferAttribute(pts, 3))
        // Glowing blue-teal edge color
        const mat = new THREE.LineBasicMaterial({ color: 0x1a4060, transparent: true, opacity: 0.5 })
        const line = new THREE.Line(geo, mat)
        edgeGroup.add(line)
        e.line = line
      })

      simulationActive = true
      sceneDataRef.current = { nodes: currentNodes, edges: currentEdges }
      // B35: Update summary stats
      setSummaryRef.current({
        activeProjects: currentNodes.filter((n) => n.type === 'project').length,
        agentsOnline: currentNodes.filter((n) => n.type === 'agent').length,
        decisionsLogged: currentNodes.filter((n) => n.type === 'decision').length,
        systemHealth: Math.round(getAvgHealth()),
      })
    }

    rebuildScene()
    rebuildRef.current = rebuildScene

    // B34 Fix 2: Upgrade edges from Lines to TubeGeometry after simulation settles
    function upgradeEdgesToTubes() {
      edgesAsTubes = true
      currentEdges.forEach((e) => {
        const a = currentNodes[e.a], b = currentNodes[e.b]
        if (!a || !b || !e.line) return
        edgeGroup.remove(e.line as THREE.Object3D)
        ;(e.line as any).geometry?.dispose()
        ;(e.line as any).material?.dispose()

        const path = new THREE.LineCurve3(
          new THREE.Vector3(a.x, a.y, a.z),
          new THREE.Vector3(b.x, b.y, b.z)
        )
        // B34 Fix 2: TubeGeometry with emissive material, opacity 0.4
        const tubeGeo = new THREE.TubeGeometry(path, 2, 0.018, 5, false)
        const tubeMat = new THREE.MeshBasicMaterial({
          color: 0x1e5080,
          transparent: true,
          opacity: 0.4,
        })
        const tubeMesh = new THREE.Mesh(tubeGeo, tubeMat)
        edgeGroup.add(tubeMesh)
        e.line = tubeMesh
      })
    }

    // Force simulation step
    function simulateStep() {
      const repulsion = 3.5
      const spring = 0.08
      const damping = 0.85
      const gravity = 0.04

      for (const n of currentNodes) { n.fx = 0; n.fy = 0; n.fz = 0 }

      // Repulsion
      for (let i = 0; i < currentNodes.length; i++) {
        const a = currentNodes[i]
        for (let j = i + 1; j < currentNodes.length; j++) {
          const b = currentNodes[j]
          const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z
          const distSq = Math.max(0.25, dx * dx + dy * dy + dz * dz)
          const dist = Math.sqrt(distSq)
          const force = repulsion / distSq
          a.fx += dx / dist * force; a.fy += dy / dist * force; a.fz += dz / dist * force
          b.fx -= dx / dist * force; b.fy -= dy / dist * force; b.fz -= dz / dist * force
        }
      }

      // Spring
      for (const e of currentEdges) {
        const a = currentNodes[e.a], b = currentNodes[e.b]
        if (!a || !b) continue
        const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z
        const dist = Math.max(0.1, Math.sqrt(dx * dx + dy * dy + dz * dz))
        const target = 2.5
        const force = spring * (dist - target)
        a.fx += dx / dist * force; a.fy += dy / dist * force; a.fz += dz / dist * force
        b.fx -= dx / dist * force; b.fy -= dy / dist * force; b.fz -= dz / dist * force
      }

      // B35: Cluster grouping — weak attractive force toward type-specific centers
      const clusterStrength = 0.015
      const clusterTargets: Record<string, [number, number, number]> = {
        project: [-3, 0, 0], agent: [3, 0, 0], decision: [0, 3, 0], data: [0, -3, 0],
      }
      for (const n of currentNodes) {
        const ct = clusterTargets[n.type]
        if (ct) {
          n.fx += (ct[0] - n.x) * clusterStrength
          n.fy += (ct[1] - n.y) * clusterStrength
          n.fz += (ct[2] - n.z) * clusterStrength
        }
      }

      // Gravity + integrate
      let totalKE = 0
      for (const n of currentNodes) {
        if (n.pinned) { n.vx = 0; n.vy = 0; n.vz = 0; continue }
        n.fx -= n.x * gravity
        n.fy -= n.y * gravity
        n.fz -= n.z * gravity
        n.vx = (n.vx + n.fx) * damping
        n.vy = (n.vy + n.fy) * damping
        n.vz = (n.vz + n.fz) * damping
        n.x += n.vx; n.y += n.vy; n.z += n.vz
        if (n.mesh) (n.mesh as THREE.Object3D).position.set(n.x, n.y, n.z)
        totalKE += n.vx ** 2 + n.vy ** 2 + n.vz ** 2
      }

      // Update hitSphere positions to follow nodes
      hitSpheres.forEach((hs, i) => {
        const n = currentNodes[i]
        if (n) hs.position.set(n.x, n.y, n.z)
      })

      // Update edge lines (fast BufferGeometry update during simulation)
      if (!edgesAsTubes) {
        currentEdges.forEach((e) => {
          const a = currentNodes[e.a], b = currentNodes[e.b]
          if (!a || !b || !e.line) return
          const pos = (e.line as THREE.Line).geometry.attributes.position
          if (!pos) return
          pos.setXYZ(0, a.x, a.y, a.z)
          pos.setXYZ(1, b.x, b.y, b.z)
          pos.needsUpdate = true
        })
      }

      // B34 Fix 2: When simulation settles, upgrade edges to TubeGeometry
      if (totalKE < 0.001 * currentNodes.length) {
        simulationActive = false
        if (!edgesAsTubes) upgradeEdgesToTubes()
      }
    }

    // Camera orbit
    let pulseTick = 0
    let animFrame: number

    // Mouse drag for camera orbit
    let isDragging = false
    let dragMoved = false
    let lastMX = 0, lastMY = 0
    let camPhi = Math.PI / 6, camTheta = 0, camR = 10

    // B34 Fix 3: Smooth camera target for click-centering
    let targetCamR = 10
    const camLookAt = new THREE.Vector3(0, 0, 0)
    const targetLookAt = new THREE.Vector3(0, 0, 0)

    // B34 Fix 3: Hovered node tracking for smooth hover scale
    let hoveredNode: NNode | null = null

    // Raycaster for node hover
    const raycaster = new THREE.Raycaster()
    const mouse = new THREE.Vector2()
    let tooltipDiv: HTMLDivElement | null = null

    function createTooltip() {
      tooltipDiv = document.createElement('div')
      tooltipDiv.style.cssText = `
        position:absolute;background:rgba(4,8,18,0.92);border:1px solid rgba(0,255,136,0.2);
        color:#e2e8f0;font-size:11px;padding:7px 11px;border-radius:7px;
        pointer-events:none;white-space:nowrap;z-index:100;display:none;font-family:monospace;
        box-shadow:0 0 12px rgba(0,255,136,0.12);
      `
      mount.appendChild(tooltipDiv)
    }
    createTooltip()

    // B34 Fix 3: Format tooltip content with name, type, and key metric
    function updateTooltip(n: NNode, mx: number, my: number, rect: DOMRect) {
      if (!tooltipDiv) return
      const typeLabel = n.type.charAt(0).toUpperCase() + n.type.slice(1)
      let metric = ''
      if (n.type === 'project') metric = `Health: <span style="color:#00ff88">${n.meta?.healthScore ?? '?'}%</span>`
      if (n.type === 'agent') metric = `T${n.meta?.tier ?? '?'} · <span style="color:#9ca3af">${n.meta?.desc ?? ''}</span>`
      if (n.type === 'decision') {
        const fb = n.meta?.feedback
        metric = fb > 0 ? '<span style="color:#00cc55">👍 Approved</span>' : fb < 0 ? '<span style="color:#ff4444">👎 Issue</span>' : '<span style="color:#555577">• Pending</span>'
      }
      if (n.type === 'data') metric = `<span style="color:#06b6d4">${n.meta?.valueStr ?? ''}</span>`

      tooltipDiv.innerHTML = `
        <div style="font-weight:800;color:#fff;margin-bottom:2px;letter-spacing:0.04em">${n.label}</div>
        <div style="color:#4b5563;font-size:9px;text-transform:uppercase;letter-spacing:0.08em">${typeLabel}</div>
        ${metric ? `<div style="font-size:10px;margin-top:3px">${metric}</div>` : ''}
      `
      tooltipDiv.style.display = 'block'
      tooltipDiv.style.left = (mx - rect.left + 15) + 'px'
      tooltipDiv.style.top = (my - rect.top - 5) + 'px'
    }

    function onMouseDown(e: MouseEvent) {
      isDragging = true
      dragMoved = false
      lastMX = e.clientX
      lastMY = e.clientY
    }
    function onMouseUp() { isDragging = false }
    function onMouseMove(e: MouseEvent) {
      if (isDragging) {
        const dx = e.clientX - lastMX
        const dy = e.clientY - lastMY
        if (Math.abs(dx) > 2 || Math.abs(dy) > 2) dragMoved = true
        camTheta -= dx * 0.008
        camPhi = Math.max(0.2, Math.min(Math.PI - 0.2, camPhi - dy * 0.008))
        lastMX = e.clientX
        lastMY = e.clientY
      }
      // B34 Fix 3: Hover detection using hitSpheres (1.5x size)
      const rect = mount.getBoundingClientRect()
      mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
      mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1
      raycaster.setFromCamera(mouse, camera)
      const hits = raycaster.intersectObjects(hitSpheres)
      if (hits.length > 0) {
        const hitIdx = hitSpheres.indexOf(hits[0].object as THREE.Mesh)
        hoveredNode = hitIdx >= 0 ? (currentNodes[hitIdx] || null) : null
        if (tooltipDiv && hoveredNode) {
          updateTooltip(hoveredNode, e.clientX, e.clientY, rect)
        }
      } else {
        hoveredNode = null
        if (tooltipDiv) tooltipDiv.style.display = 'none'
        // B35: Edge hover detection — check proximity to edge midpoints projected to screen
        const edgeRect = mount.getBoundingClientRect()
        const emx = e.clientX - edgeRect.left
        const emy = e.clientY - edgeRect.top
        let closestEdge: NEdge | null = null
        let closestDist = 28
        currentEdges.forEach((edge) => {
          const a = currentNodes[edge.a], b = currentNodes[edge.b]
          if (!a || !b) return
          _labelV3.set((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2)
          _labelV3.project(camera)
          if (_labelV3.z > 1) return
          const ex = (_labelV3.x + 1) / 2 * (mount.clientWidth || 600)
          const ey = (-_labelV3.y + 1) / 2 * (mount.clientHeight || 600)
          const dist = Math.sqrt((emx - ex) ** 2 + (emy - ey) ** 2)
          if (dist < closestDist) { closestDist = dist; closestEdge = edge }
        })
        if (closestEdge && tooltipDiv) {
          const ea = currentNodes[closestEdge.a], eb = currentNodes[closestEdge.b]
          if (ea && eb) {
            tooltipDiv.innerHTML = `
              <div style="color:#1a6080;font-size:8px;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:2px">Edge</div>
              <div style="color:#e2e8f0;font-size:11px">${getEdgeDescription(ea, eb)}</div>
            `
            tooltipDiv.style.display = 'block'
            _labelV3.set((ea.x + eb.x) / 2, (ea.y + eb.y) / 2, (ea.z + eb.z) / 2)
            _labelV3.project(camera)
            const etx = (_labelV3.x + 1) / 2 * (mount.clientWidth || 600)
            const ety = (-_labelV3.y + 1) / 2 * (mount.clientHeight || 600)
            tooltipDiv.style.left = (etx + 15) + 'px'
            tooltipDiv.style.top = (ety - 5) + 'px'
          }
        }
      }
    }
    function onWheel(e: WheelEvent) {
      targetCamR = Math.max(3, Math.min(20, targetCamR + e.deltaY * 0.01))
    }

    // B34 Fix 3: Click to center camera on hovered node (500ms smooth)
    function onClick(e: MouseEvent) {
      if (dragMoved) return
      const rect = mount.getBoundingClientRect()
      mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
      mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1
      raycaster.setFromCamera(mouse, camera)
      const hits = raycaster.intersectObjects(hitSpheres)
      if (hits.length > 0) {
        const hitIdx = hitSpheres.indexOf(hits[0].object as THREE.Mesh)
        const n = currentNodes[hitIdx]
        if (n) {
          targetLookAt.set(n.x, n.y, n.z)
          setSelectedNodeRef.current(n) // B35: open detail sidebar
        }
      } else {
        setSelectedNodeRef.current(null) // B35: close sidebar on empty canvas click
      }
    }

    // B34 Fix 3: Double click to zoom in close
    function onDblClick(e: MouseEvent) {
      const rect = mount.getBoundingClientRect()
      mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
      mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1
      raycaster.setFromCamera(mouse, camera)
      const hits = raycaster.intersectObjects(hitSpheres)
      if (hits.length > 0) {
        const hitIdx = hitSpheres.indexOf(hits[0].object as THREE.Mesh)
        const n = currentNodes[hitIdx]
        if (n) {
          targetLookAt.set(n.x, n.y, n.z)
          targetCamR = 4
        }
      } else {
        targetLookAt.set(0, 0, 0)
        targetCamR = 10
      }
    }

    renderer.domElement.addEventListener('mousedown', onMouseDown)
    renderer.domElement.addEventListener('mouseup', onMouseUp)
    renderer.domElement.addEventListener('mousemove', onMouseMove)
    renderer.domElement.addEventListener('wheel', onWheel, { passive: true })
    renderer.domElement.addEventListener('click', onClick)
    renderer.domElement.addEventListener('dblclick', onDblClick)

    // Pause simulation when tab not visible
    const handleVisibility = () => { if (!document.hidden) simulationActive = true }
    document.addEventListener('visibilitychange', handleVisibility)

    function animate() {
      animFrame = requestAnimationFrame(animate)
      pulseTick += 0.016

      // B34 Fix 3: Smooth camera R and lookAt interpolation
      camR += (targetCamR - camR) * 0.05
      camLookAt.lerp(targetLookAt, 0.05)

      // Camera position from spherical coords
      if (!isDragging) camTheta += 0.002
      camera.position.x = camR * Math.sin(camPhi) * Math.sin(camTheta)
      camera.position.y = camR * Math.cos(camPhi)
      camera.position.z = camR * Math.sin(camPhi) * Math.cos(camTheta)
      camera.lookAt(camLookAt)

      // Simulate
      if (simulationActive) simulateStep()

      // B34 Fix 2 + Fix 3: Premium node animations with smooth hover scale
      const pPulse = Math.sin(pulseTick * 3) * 0.5 + 0.5
      const now = Date.now()

      currentNodes.forEach((n) => {
        if (!n.mesh) return
        const obj = n.mesh as THREE.Object3D

        // B34 Fix 3: Smooth hover scale — lerp to 1.2x when hovered, back to 1.0x when not
        const isHovered = hoveredNode === n
        const targetScale = isHovered ? n.size * 1.2 : n.size
        const currentScale = obj.scale.x
        const newScale = currentScale + (targetScale - currentScale) * 0.15 // ~200ms lerp
        obj.scale.setScalar(newScale)

        if (n.type === 'agent') {
          obj.rotation.y += 0.01
          // B34 Fix 2: Pulse emissive intensity on agents
          const mat = (obj as THREE.Mesh).material as THREE.MeshStandardMaterial
          if (mat?.emissiveIntensity !== undefined) {
            mat.emissiveIntensity = 0.4 + pPulse * 0.4
          }
          // Orbit NEXUS ring
          if (n.id === 'ag_NEXUS' && (obj as THREE.Mesh).children.length > 0) {
            const ring = (obj as THREE.Mesh).children[0]
            ring.rotation.z += 0.012
            ring.rotation.y += 0.007
          }

        } else if (n.type === 'project') {
          // B34 Fix 2: Pulse inner sphere emissive intensity
          const outerMesh = obj as THREE.Mesh
          if (outerMesh.children.length > 0) {
            const innerMesh = outerMesh.children[0] as THREE.Mesh
            const mat = innerMesh.material as THREE.MeshStandardMaterial
            if (mat?.emissiveIntensity !== undefined) {
              mat.emissiveIntensity = 0.5 + pPulse * 0.4
            }
          }

        } else if (n.type === 'decision') {
          // B34 Fix 2: Slow rotation animation for diamond shape
          obj.rotation.y += 0.005
          obj.rotation.x += 0.003

        } else if (n.type === 'data') {
          // B34 Fix 2: Hex prism rotation
          obj.rotation.y += 0.008
          obj.rotation.z += 0.004
        }
      })

      // B35: Update node label positions (project to screen space)
      const _fadeLabels = camR > 15
      currentNodes.forEach((n, i) => {
        const div = labelDivs[i]
        if (!div) return
        _labelV3.set(n.x, n.y, n.z)
        _labelV3.project(camera)
        if (_labelV3.z > 1) { div.style.display = 'none'; return }
        const lx = (_labelV3.x + 1) / 2 * (mount.clientWidth || 600)
        const ly = (-_labelV3.y + 1) / 2 * (mount.clientHeight || 600)
        div.style.left = lx + 'px'
        div.style.top = ly + 'px'
        div.style.display = 'block'
        div.style.opacity = _fadeLabels ? '0' : '1'
      })

      renderer.render(scene, camera)
    }
    animate()

    const ro = new ResizeObserver(() => {
      if (!mount) return
      const w = mount.clientWidth
      const h = mount.clientHeight
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      renderer.setSize(w, h)
    })
    ro.observe(mount)

    return () => {
      cancelAnimationFrame(animFrame)
      ro.disconnect()
      document.removeEventListener('visibilitychange', handleVisibility)
      renderer.domElement.removeEventListener('mousedown', onMouseDown)
      renderer.domElement.removeEventListener('mouseup', onMouseUp)
      renderer.domElement.removeEventListener('mousemove', onMouseMove)
      renderer.domElement.removeEventListener('wheel', onWheel)
      renderer.domElement.removeEventListener('click', onClick)
      renderer.domElement.removeEventListener('dblclick', onDblClick)
      // Dispose node meshes
      nodeGroup.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry?.dispose()
          if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose())
          else obj.material?.dispose()
        }
      })
      // Dispose edge geometry
      edgeGroup.traverse((obj) => {
        if ((obj as any).geometry) (obj as any).geometry.dispose()
        if ((obj as any).material) (obj as any).material.dispose()
      })
      // Dispose hit spheres
      hitSpheres.forEach((s) => scene.remove(s))
      hitGeo.dispose()
      hitMat.dispose()
      renderer.dispose()
      if (tooltipDiv?.parentNode) tooltipDiv.parentNode.removeChild(tooltipDiv)
      if (labelContainer?.parentNode) labelContainer.parentNode.removeChild(labelContainer)
      if (mount.contains(renderer.domElement)) mount.removeChild(renderer.domElement)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Trigger graph rebuild when tab/toggles change
  useEffect(() => {
    if (rebuildRef.current) rebuildRef.current()
  }, [activeTab, layerToggles])

  const TABS: NeuralTab[] = ['Projects', 'Agents', 'Decisions', 'Data', 'All']
  const LAYER_COLORS: Record<string, string> = {
    Projects: '#00ff88', Agents: '#ca8a04', Decisions: '#a855f7', Data: '#06b6d4',
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Sub-tab bar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '8px 20px',
        borderBottom: '1px solid rgba(255,255,255,0.07)',
        backgroundColor: 'rgba(0,0,0,0.3)',
      }}>
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setActiveTab(t)}
            style={{
              padding: '5px 14px', borderRadius: 6, fontSize: 11, fontWeight: 700,
              letterSpacing: '0.05em', border: 'none', cursor: 'pointer',
              backgroundColor: activeTab === t
                ? (t === 'All' ? 'rgba(255,255,255,0.12)' : `${LAYER_COLORS[t]}22`)
                : 'rgba(255,255,255,0.04)',
              color: activeTab === t
                ? (t === 'All' ? '#e2e8f0' : LAYER_COLORS[t])
                : '#6b7280',
              transition: 'all 0.2s',
            }}
          >
            {t}
          </button>
        ))}

        {/* Layer toggle chips (All tab only) */}
        {activeTab === 'All' && (
          <div style={{ display: 'flex', gap: 6, marginLeft: 16, alignItems: 'center' }}>
            <span style={{ fontSize: 9, color: '#4b5563', letterSpacing: '0.08em', textTransform: 'uppercase' }}>Layers</span>
            {(Object.keys(LAYER_COLORS) as NeuralTab[]).map((layer) => (
              <button
                key={layer}
                onClick={() => setLayerToggles((prev) => ({ ...prev, [layer]: !prev[layer] }))}
                style={{
                  padding: '3px 9px', borderRadius: 12, fontSize: 9, fontWeight: 700,
                  border: `1px solid ${LAYER_COLORS[layer]}55`, cursor: 'pointer',
                  backgroundColor: layerToggles[layer] ? `${LAYER_COLORS[layer]}22` : 'transparent',
                  color: layerToggles[layer] ? LAYER_COLORS[layer] : '#4b5563',
                  transition: 'all 0.15s',
                }}
              >
                {layer}
              </button>
            ))}
          </div>
        )}

        {/* Legend */}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 12, alignItems: 'center' }}>
          {[
            { shape: '●', label: 'Project' }, { shape: '◆', label: 'Agent' },
            { shape: '▲', label: 'Decision' }, { shape: '■', label: 'Data' },
          ].map((l) => (
            <span key={l.label} style={{ fontSize: 10, color: '#4b5563' }}>
              <span style={{ marginRight: 3 }}>{l.shape}</span>{l.label}
            </span>
          ))}
        </div>
      </div>

      {/* Main content: canvas with overlays + optional sidebar */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* Canvas wrapper — overlays sit absolutely inside this */}
        <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
          <div ref={mountRef} style={{ position: 'absolute', inset: 0 }} />

          {/* B35 Summary Bar — fixed top of canvas */}
          <div style={{
            position: 'absolute', top: 0, left: 0, right: 0, zIndex: 20,
            pointerEvents: 'none', display: 'flex', alignItems: 'center',
            justifyContent: 'center', gap: 28, padding: '7px 20px',
            background: 'linear-gradient(180deg,rgba(4,8,18,0.88) 0%,rgba(4,8,18,0) 100%)',
          }}>
            {[
              { icon: '⬡', label: `${summaryData.activeProjects} Active Projects`, color: '#00ff88' },
              { icon: '◆', label: `${summaryData.agentsOnline} Agents Online`, color: '#ca8a04' },
              { icon: '▲', label: `${summaryData.decisionsLogged} Decisions Logged`, color: '#a855f7' },
              {
                icon: '⚡',
                label: `System Health: ${summaryData.systemHealth}%`,
                color: summaryData.systemHealth > 70 ? '#00ff88' : summaryData.systemHealth > 40 ? '#ffcc00' : '#ff6600',
              },
            ].map((item) => (
              <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <span style={{ fontSize: 11, color: item.color }}>{item.icon}</span>
                <span style={{ fontSize: 10, fontWeight: 700, color: item.color, letterSpacing: '0.05em' }}>{item.label}</span>
              </div>
            ))}
          </div>

          {/* B35 Permanent Legend — fixed bottom-left */}
          <div style={{
            position: 'absolute', bottom: 16, left: 16, zIndex: 20, pointerEvents: 'none',
            background: 'rgba(4,8,18,0.80)', border: '1px solid rgba(255,255,255,0.07)',
            borderRadius: 8, padding: '10px 14px', backdropFilter: 'blur(4px)',
            minWidth: 130,
          }}>
            <div style={{ fontSize: 9, color: '#4b5563', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 7 }}>Legend</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {[
                { shape: '●', label: 'Project (Sphere)', color: '#00ff88' },
                { shape: '◆', label: 'Agent (Gem)', color: '#ca8a04' },
                { shape: '◆', label: 'Decision (Diamond)', color: '#a855f7' },
                { shape: '⬡', label: 'Data (Hex)', color: '#06b6d4' },
              ].map((l) => (
                <div key={l.label} style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                  <span style={{ color: l.color, fontSize: 11, lineHeight: 1, minWidth: 12 }}>{l.shape}</span>
                  <span style={{ fontSize: 9, color: '#9ca3af' }}>{l.label}</span>
                </div>
              ))}
              <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', marginTop: 5, paddingTop: 5 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 3 }}>
                  <div style={{ width: 16, height: 1, background: 'rgba(30,80,128,0.85)', flexShrink: 0 }} />
                  <span style={{ fontSize: 9, color: '#9ca3af' }}>Weak link</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                  <div style={{ width: 16, height: 3, background: 'rgba(30,80,128,0.85)', borderRadius: 2, flexShrink: 0 }} />
                  <span style={{ fontSize: 9, color: '#9ca3af' }}>Strong link</span>
                </div>
              </div>
              <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', marginTop: 5, paddingTop: 5, display: 'flex', flexDirection: 'column', gap: 3 }}>
                {[
                  { color: '#00ff88', label: 'Healthy / Active' },
                  { color: '#ffcc00', label: 'Warning / Partial' },
                  { color: '#ff6600', label: 'Critical' },
                  { color: '#6b7280', label: 'Future / Inactive' },
                ].map((c) => (
                  <div key={c.label} style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                    <div style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: c.color, flexShrink: 0 }} />
                    <span style={{ fontSize: 9, color: '#9ca3af' }}>{c.label}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* B35 Node Detail Sidebar — slides in from right on node click */}
        {selectedNode && (
          <div style={{
            width: 300, height: '100%', flexShrink: 0,
            backgroundColor: 'rgba(4,8,18,0.97)',
            borderLeft: '1px solid rgba(255,255,255,0.08)',
            display: 'flex', flexDirection: 'column', overflow: 'hidden',
            fontFamily: 'ui-monospace, monospace',
            animation: 'nmSlideIn 0.2s ease-out',
          }}>
            {/* Header */}
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,0.07)',
              backgroundColor: 'rgba(0,0,0,0.35)',
            }}>
              <div>
                <div style={{ fontSize: 9, color: '#4b5563', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 2 }}>
                  {selectedNode.type} · Detail
                </div>
                <div style={{ fontSize: 14, fontWeight: 800, color: '#e2e8f0', letterSpacing: '0.04em' }}>
                  {selectedNode.label}
                </div>
              </div>
              <button
                onClick={() => setSelectedNode(null)}
                style={{
                  background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
                  color: '#9ca3af', borderRadius: 6, padding: '5px 9px', fontSize: 13,
                  cursor: 'pointer', lineHeight: 1,
                }}
              >✕</button>
            </div>

            {/* Content */}
            <div style={{ flex: 1, overflow: 'auto', padding: '16px' }}>

              {/* PROJECT panel */}
              {selectedNode.type === 'project' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <div>
                    <div style={{ fontSize: 9, color: '#4b5563', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 5 }}>Health Score</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ flex: 1, height: 6, borderRadius: 3, background: 'rgba(255,255,255,0.08)' }}>
                        <div style={{
                          height: '100%', borderRadius: 3,
                          width: `${selectedNode.meta?.healthScore ?? 0}%`,
                          background: (selectedNode.meta?.healthScore ?? 0) > 70 ? '#00ff88' : (selectedNode.meta?.healthScore ?? 0) > 40 ? '#ffcc00' : '#ff6600',
                        }} />
                      </div>
                      <span style={{ fontSize: 13, fontWeight: 700, color: '#e2e8f0', minWidth: 24 }}>{selectedNode.meta?.healthScore ?? '?'}</span>
                    </div>
                  </div>
                  {[
                    { label: 'Quoted Amount', value: selectedNode.meta?.contract ? `$${(selectedNode.meta.contract / 1000).toFixed(0)}k` : 'N/A' },
                    { label: 'Open RFIs', value: '—' },
                    { label: 'Last Activity', value: 'Recently' },
                  ].map((r) => (
                    <div key={r.label}>
                      <div style={{ fontSize: 9, color: '#4b5563', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 2 }}>{r.label}</div>
                      <div style={{ fontSize: 12, color: '#e2e8f0', fontWeight: 600 }}>{r.value}</div>
                    </div>
                  ))}
                  <button style={{
                    marginTop: 4, padding: '8px 14px', borderRadius: 6, fontSize: 11, fontWeight: 700,
                    background: 'rgba(0,255,136,0.10)', border: '1px solid rgba(0,255,136,0.28)',
                    color: '#00ff88', cursor: 'pointer', letterSpacing: '0.05em',
                  }}>Navigate to Project →</button>
                </div>
              )}

              {/* AGENT panel */}
              {selectedNode.type === 'agent' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <div style={{
                      padding: '3px 8px', borderRadius: 4, fontSize: 9, fontWeight: 800,
                      background: `${TIER_COLORS_HEX[Math.min((selectedNode.meta?.tier ?? 1) - 1, 4)]}22`,
                      color: TIER_COLORS_HEX[Math.min((selectedNode.meta?.tier ?? 1) - 1, 4)],
                      border: `1px solid ${TIER_COLORS_HEX[Math.min((selectedNode.meta?.tier ?? 1) - 1, 4)]}44`,
                      letterSpacing: '0.06em',
                    }}>TIER {selectedNode.meta?.tier ?? '?'}</div>
                    <div style={{
                      padding: '3px 8px', borderRadius: 4, fontSize: 9, fontWeight: 800,
                      background: 'rgba(0,255,136,0.12)', color: '#00ff88',
                      border: '1px solid rgba(0,255,136,0.25)', letterSpacing: '0.06em',
                    }}>ACTIVE</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 9, color: '#4b5563', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 2 }}>Role</div>
                    <div style={{ fontSize: 12, color: '#9ca3af' }}>{selectedNode.meta?.desc ?? '—'}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 9, color: '#4b5563', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 5 }}>Capabilities</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {['Query classification', 'Context injection', 'Multi-agent routing', 'Prompt assembly', 'Structured response parsing'].map((cap) => (
                        <div key={cap} style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                          <div style={{ width: 4, height: 4, borderRadius: '50%', background: '#00ff88', flexShrink: 0 }} />
                          <span style={{ fontSize: 11, color: '#6b7280' }}>{cap}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <button style={{
                    marginTop: 4, padding: '8px 14px', borderRadius: 6, fontSize: 11, fontWeight: 700,
                    background: `${TIER_COLORS_HEX[0]}15`, border: `1px solid ${TIER_COLORS_HEX[0]}44`,
                    color: TIER_COLORS_HEX[0], cursor: 'pointer', letterSpacing: '0.05em',
                  }}>Open Agent Panel →</button>
                </div>
              )}

              {/* DECISION panel */}
              {selectedNode.type === 'decision' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <div>
                    <div style={{ fontSize: 9, color: '#4b5563', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 2 }}>Decision</div>
                    <div style={{ fontSize: 12, color: '#e2e8f0' }}>{selectedNode.label}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 9, color: '#4b5563', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>Feedback</div>
                    <div style={{ fontSize: 22 }}>
                      {selectedNode.meta?.feedback > 0 ? '👍' : selectedNode.meta?.feedback < 0 ? '👎' : '•'}
                      <span style={{ fontSize: 11, color: '#6b7280', marginLeft: 8 }}>
                        {selectedNode.meta?.feedback > 0 ? 'Approved' : selectedNode.meta?.feedback < 0 ? 'Issue flagged' : 'Pending review'}
                      </span>
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 9, color: '#4b5563', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 2 }}>Context</div>
                    <div style={{ fontSize: 11, color: '#6b7280', lineHeight: 1.5 }}>Decision logged via NEXUS orchestration layer during current session.</div>
                  </div>
                </div>
              )}

              {/* DATA panel */}
              {selectedNode.type === 'data' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <div>
                    <div style={{ fontSize: 9, color: '#4b5563', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 2 }}>Metric</div>
                    <div style={{ fontSize: 14, fontWeight: 800, color: '#06b6d4' }}>{selectedNode.label}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 9, color: '#4b5563', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 2 }}>Current Value</div>
                    <div style={{ fontSize: 22, fontWeight: 800, color: '#e2e8f0' }}>{selectedNode.meta?.valueStr ?? '—'}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 9, color: '#4b5563', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 2 }}>7-Day Trend</div>
                    <div style={{ fontSize: 20, color: '#00ff88' }}>↗ <span style={{ fontSize: 11, color: '#6b7280' }}>Trending up</span></div>
                  </div>
                  <div>
                    <div style={{ fontSize: 9, color: '#4b5563', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>What Affects This</div>
                    <div style={{ fontSize: 11, color: '#6b7280', lineHeight: 1.5 }}>Project billing events, service call completions, and payment receipts contribute to this metric.</div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <style>{`
        @keyframes nmSlideIn {
          from { transform: translateX(100%); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
      `}</style>
    </div>
  )
}

// ─── Admin Visualization Lab (main) ──────────────────────────────────────────
export default function AdminVisualizationLab() {
  const [activeTab, setActiveTab] = useState<MainTab>('ORB_LAB')
  const [healthAvg, setHealthAvg] = useState(75)

  // Health polling every 30s
  useEffect(() => {
    setHealthAvg(getAvgHealth())
    const iv = setInterval(() => setHealthAvg(getAvgHealth()), 30000)
    return () => clearInterval(iv)
  }, [])

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden',
      backgroundColor: '#060608', color: '#e2e8f0',
      fontFamily: 'ui-monospace, monospace',
    }}>
      {/* CSS animations */}
      <style>{`
        @keyframes twinkle {
          0%, 100% { opacity: 0.3; }
          50% { opacity: 1; }
        }
        @keyframes gridScroll {
          0% { background-position: 0 0; }
          100% { background-position: 40px 40px; }
        }
      `}</style>

      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 16, padding: '14px 24px',
        borderBottom: '1px solid rgba(255,255,255,0.08)',
        backgroundColor: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(8px)',
        flexShrink: 0,
      }}>
        {/* Badge */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          backgroundColor: 'rgba(0,255,136,0.08)',
          border: '1px solid rgba(0,255,136,0.25)',
          borderRadius: 8, padding: '5px 12px',
        }}>
          <div style={{
            width: 7, height: 7, borderRadius: '50%',
            backgroundColor: '#00ff88', boxShadow: '0 0 8px #00ff88',
            animation: 'twinkle 2s ease-in-out infinite',
          }} />
          <span style={{
            fontSize: 11, fontWeight: 800, letterSpacing: '0.1em',
            textTransform: 'uppercase', color: '#00ff88',
          }}>
            Visualization Lab
          </span>
        </div>

        <span style={{ fontSize: 10, color: '#374151', marginLeft: 4 }}>B35 · Admin Only</span>

        {/* Main tabs */}
        <div style={{ display: 'flex', gap: 6, marginLeft: 'auto' }}>
          {(['ORB_LAB', 'NEURAL_MAP'] as MainTab[]).map((t) => (
            <button
              key={t}
              onClick={() => setActiveTab(t)}
              style={{
                padding: '8px 20px', borderRadius: 8, fontSize: 12, fontWeight: 800,
                letterSpacing: '0.08em', border: 'none', cursor: 'pointer',
                backgroundColor: activeTab === t ? '#00ff88' : 'rgba(255,255,255,0.06)',
                color: activeTab === t ? '#000' : '#9ca3af',
                transition: 'all 0.2s',
                boxShadow: activeTab === t ? '0 0 16px rgba(0,255,136,0.3)' : 'none',
              }}
            >
              {t.replace('_', ' ')}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {activeTab === 'ORB_LAB'
          ? <OrbLab healthAvg={healthAvg} />
          : <NeuralMap />
        }
      </div>
    </div>
  )
}
