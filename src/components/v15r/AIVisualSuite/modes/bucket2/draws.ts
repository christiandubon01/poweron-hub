// @ts-nocheck
/**
 * draws.ts — B2 AI V1 modes 24-33
 * B48 — NEXUS Visual Suite Full Deploy
 */
import type { DrawFn } from '../bucket1/draws_1_12'

// ============================================================================
// State persistence for stateful modes
// ============================================================================

export const stateRef25 = { x: 0.1, y: 0, z: 0, trail: [] as [number,number,number][] }
export const stateRef27 = { cells: null as Uint8Array | null, lastUpdate: 0, history: [] as Uint8Array[] }
export const stateRef29 = { u: null as Float32Array|null, v: null as Float32Array|null, w: 0, h_: 0 }
export const stateRef30 = { particles: null as Array<{x:number,y:number,age:number}>|null }
export const stateRef31 = { trace: [] as [number,number][] }

// ============================================================================
// Mode 24: Quantum Foam
// ============================================================================

export const drawQuantumFoam: DrawFn = (ctx, W, H, t, B, M, Hi, bh, mtz) => {
  const cx = W / 2, cy = H / 2
  ctx.fillStyle = 'rgba(2,4,12,0.18)'
  ctx.fillRect(0, 0, W, H)

  const bubbleCount = 60 + Math.round(B * 60) + Math.round(mtz * 80)
  const R = Math.min(W, H) * 0.42

  for (let i = 0; i < bubbleCount; i++) {
    const seed = i * 1.618 + t * (0.08 + B * 0.18)
    const theta = seed * 2.399963
    const phi = Math.acos(1 - 2 * (i + 0.5) / bubbleCount)
    const r = R * (0.4 + 0.6 * Math.abs(Math.sin(seed * 3.7 + t)))
    const x = cx + r * Math.sin(phi) * Math.cos(theta)
    const y = cy + r * Math.sin(phi) * Math.sin(theta) * 0.6
    const radius = (2 + B * 6 + M * 3) * (0.5 + Math.abs(Math.sin(seed * 7.1 + t * 1.3)))

    const grad = ctx.createRadialGradient(x, y, 0, x, y, radius)
    grad.addColorStop(0, `hsl(${bh + i * 0.5},90%,70%)`)
    grad.addColorStop(1, 'rgba(200,200,255,0)')
    ctx.fillStyle = grad
    ctx.beginPath()
    ctx.arc(x, y, radius, 0, Math.PI * 2)
    ctx.fill()
  }

  // Wave interference rings
  if (M > 0.05) {
    ctx.strokeStyle = `hsla(${bh + 45},70%,60%,0.3)`
    for (let ring = 0; ring < 5; ring++) {
      const ringR = R * (0.2 + ring * 0.15) * (0.8 + 0.2 * Math.sin(t + ring))
      ctx.beginPath()
      ctx.arc(cx, cy, ringR, 0, Math.PI * 2)
      ctx.stroke()
    }
  }

  // MTZ virtual pair bursts
  if (mtz > 0.1) {
    for (let i = 0; i < Math.round(mtz * 8); i++) {
      const burst = (t * 3 + i) % 1
      const bx = cx + (Math.random() - 0.5) * W * 0.5
      const by = cy + (Math.random() - 0.5) * H * 0.5
      const bs = 2 + mtz * 4
      ctx.fillStyle = `rgba(255,200,100,${(1 - burst) * 0.6})`
      ctx.beginPath()
      ctx.arc(bx, by, bs * (1 - burst), 0, Math.PI * 2)
      ctx.fill()
    }
  }
}

// ============================================================================
// Mode 25: Strange Attractor (Lorenz)
// ============================================================================

export const drawStrangeAttractor: DrawFn = (ctx, W, H, t, B, M, Hi, bh, mtz) => {
  const cx = W / 2, cy = H / 2
  ctx.fillStyle = 'rgba(2,4,12,0.15)'
  ctx.fillRect(0, 0, W, H)

  const sigma = 10 + B * 4
  const rho = 28 + mtz * 12
  const beta = 8 / 3 + M * 0.8
  const dt = 0.006
  const steps = 4 + Math.round(M * 6)
  const maxTrail = 400 + Math.round(M * 600) + Math.round(mtz * 400)
  const scale = Math.min(W, H) / 55

  let { x, y, z } = stateRef25
  for (let step = 0; step < steps; step++) {
    const dx = sigma * (y - x)
    const dy = x * (rho - z) - y
    const dz = x * y - beta * z
    x += dx * dt
    y += dy * dt
    z += dz * dt
    stateRef25.trail.push([x, y, z])
  }

  if (stateRef25.trail.length > maxTrail) {
    stateRef25.trail.shift()
  }

  stateRef25.x = x
  stateRef25.y = y
  stateRef25.z = z

  ctx.strokeStyle = `hsl(${bh},80%,60%)`
  ctx.lineWidth = 1.5
  ctx.beginPath()
  for (let idx = 0; idx < stateRef25.trail.length; idx++) {
    const [tx, ty, tz] = stateRef25.trail[idx]
    const x2d = cx + (tx - ty) * scale * 0.7
    const y2d = cy - (tz - 25) * scale
    if (idx === 0) ctx.moveTo(x2d, y2d)
    else ctx.lineTo(x2d, y2d)
    if (idx % 4 === 0) {
      ctx.strokeStyle = `hsl(${bh + idx * 0.15},80%,60%)`
    }
  }
  ctx.stroke()

  if (mtz > 0.5 && Math.random() < 0.01) {
    stateRef25.x += (Math.random() - 0.5) * 10
    stateRef25.y += (Math.random() - 0.5) * 10
  }
}

// ============================================================================
// Mode 26: Hyperbolic Space (Poincaré Disk)
// ============================================================================

export const drawHyperbolicSpace: DrawFn = (ctx, W, H, t, B, M, Hi, bh, mtz) => {
  ctx.fillStyle = '#080810'
  ctx.fillRect(0, 0, W, H)

  const cx = W / 2, cy = H / 2
  const R = Math.min(W, H) * 0.42
  const boundaryR = Math.min(W, H) * 0.45

  // Boundary circle
  ctx.strokeStyle = `hsl(${bh},70%,65%)`
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.arc(cx, cy, boundaryR, 0, Math.PI * 2)
  ctx.stroke()

  const geoCount = 20 + Math.round(mtz * 20)
  for (let i = 0; i < geoCount; i++) {
    const angle = (i * Math.PI) / 10 + t * 0.05
    const a = R * Math.cos(angle)
    const arcR = Math.sqrt(R * R + a * a)

    ctx.strokeStyle = `hsla(${bh + i * 12},70%,55%,0.4)`
    ctx.beginPath()
    const startAngle = Math.acos(-a / arcR)
    ctx.arc(cx + a, cy, arcR, startAngle, Math.PI - startAngle)
    ctx.stroke()
  }

  // MTZ tessellation
  if (mtz > 0.3) {
    const innerGeos = Math.round(mtz * 10)
    for (let i = 0; i < innerGeos; i++) {
      const angle = (i * Math.PI) / 20 + t * 0.08
      const a = R * Math.cos(angle) * 0.4
      const arcR = Math.sqrt(R * R * 0.16 + a * a)
      ctx.strokeStyle = `hsla(${bh + 120},60%,45%,0.25)`
      ctx.beginPath()
      const sa = Math.acos(-a / arcR)
      ctx.arc(cx + a, cy, arcR, sa, Math.PI - sa)
      ctx.stroke()
    }
  }
}

// ============================================================================
// Mode 27: Cellular Automata (Rule 110)
// ============================================================================

export const drawCellularAutomata: DrawFn = (ctx, W, H, t, B, M, Hi, bh, mtz) => {
  ctx.fillStyle = '#0a0a14'
  ctx.fillRect(0, 0, W, H)

  const gW = Math.floor(W / 3)
  const cellSize = 3
  const rule = [0, 1, 1, 0, 1, 1, 1, 0]

  if (!stateRef27.cells) {
    stateRef27.cells = new Uint8Array(gW)
    stateRef27.cells[Math.floor(gW / 2)] = 1
    stateRef27.lastUpdate = t
  }

  const speed = 0.05 - mtz * 0.04
  if (t - stateRef27.lastUpdate > speed) {
    const newCells = new Uint8Array(gW)
    for (let i = 0; i < gW; i++) {
      const l = stateRef27.cells[(i - 1 + gW) % gW]
      const c = stateRef27.cells[i]
      const r = stateRef27.cells[(i + 1) % gW]
      const idx = (l << 2) | (c << 1) | r
      newCells[i] = rule[idx]
    }
    stateRef27.cells = newCells
    stateRef27.history.push(newCells)
    if (stateRef27.history.length > Math.floor(H / cellSize / 3)) {
      stateRef27.history.shift()
    }
    stateRef27.lastUpdate = t
  }

  for (let row = 0; row < stateRef27.history.length; row++) {
    const cells = stateRef27.history[row]
    for (let col = 0; col < gW; col++) {
      if (cells[col] === 1) {
        ctx.fillStyle = `hsl(${bh + row * 2},80%,55%)`
        ctx.fillRect(col * cellSize, row * cellSize, cellSize, cellSize)
      }
    }
  }
}

// ============================================================================
// Mode 28: Electric Field Lines
// ============================================================================

export const drawFieldLines: DrawFn = (ctx, W, H, t, B, M, Hi, bh, mtz) => {
  ctx.fillStyle = '#000000'
  ctx.fillRect(0, 0, W, H)

  const cx = W / 2, cy = H / 2
  const numCharges = 4 + Math.round(mtz * 4)
  const chargeR = Math.min(W, H) * 0.25
  const charges: Array<{x:number,y:number,pol:number}> = []

  for (let i = 0; i < numCharges; i++) {
    const angle = t * (0.2 + i * 0.1) + (i * 2 * Math.PI) / numCharges
    const pol = i % 2 ? 1 : -1
    charges.push({
      x: cx + chargeR * Math.cos(angle),
      y: cy + chargeR * Math.sin(angle) * 0.6,
      pol
    })
  }

  // Field lines from positive charges
  for (const charge of charges) {
    if (charge.pol < 0) continue
    for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 8) {
      let px = charge.x, py = charge.y
      ctx.strokeStyle = `hsl(${bh},70%,60%)`
      ctx.setLineDash([3, 3])
      ctx.beginPath()
      ctx.moveTo(px, py)

      for (let step = 0; step < 50; step++) {
        let fx = 0, fy = 0
        for (const c of charges) {
          const dx = c.x - px, dy = c.y - py
          const d2 = dx * dx + dy * dy + 1
          const invD = c.pol / (d2 * Math.sqrt(d2))
          fx += dx * invD
          fy += dy * invD
        }
        const len = Math.sqrt(fx * fx + fy * fy) + 0.01
        px += (fx / len) * 2
        py += (fy / len) * 2
        ctx.lineTo(px, py)
        if (px < 0 || px > W || py < 0 || py > H) break
      }
      ctx.stroke()
    }
  }

  ctx.setLineDash([])
  for (const charge of charges) {
    ctx.fillStyle = charge.pol > 0 ? '#ff6600' : '#0066ff'
    ctx.beginPath()
    ctx.arc(charge.x, charge.y, 4, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = 'white'
    ctx.font = 'bold 8px monospace'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(charge.pol > 0 ? '+' : '-', charge.x, charge.y)
  }
}

// ============================================================================
// Mode 29: Reaction-Diffusion (Gray-Scott)
// ============================================================================

export const drawReactionDiffusion: DrawFn = (ctx, W, H, t, B, M, Hi, bh, mtz) => {
  const gW = Math.floor(W / 3)
  const gH = Math.floor(H / 3)
  const cellSize = 3

  if (!stateRef29.u) {
    stateRef29.u = new Float32Array(gW * gH)
    stateRef29.v = new Float32Array(gW * gH)
    stateRef29.w = gW
    stateRef29.h_ = gH
    for (let i = 0; i < gW * gH; i++) stateRef29.u[i] = 1
    for (let i = 0; i < gW * gH; i++) stateRef29.v[i] = 0
    const seedR = 5
    for (let y = gH / 2 - seedR; y < gH / 2 + seedR; y++) {
      for (let x = gW / 2 - seedR; x < gW / 2 + seedR; x++) {
        if (x >= 0 && x < gW && y >= 0 && y < gH) {
          stateRef29.v[y * gW + x] = 1
        }
      }
    }
  }

  const F = 0.055 + mtz * 0.025
  const k = 0.062 + mtz * 0.008
  const Du = 0.16
  const Dv = 0.08

  // Gray-Scott iterations
  for (let iter = 0; iter < 4; iter++) {
    const u = stateRef29.u, v = stateRef29.v
    const u2 = new Float32Array(u), v2 = new Float32Array(v)
    for (let y = 1; y < gH - 1; y++) {
      for (let x = 1; x < gW - 1; x++) {
        const idx = y * gW + x
        const uv2 = u[idx] * v[idx] * v[idx]
        u2[idx] = u[idx] + Du * (u[idx-1] + u[idx+1] + u[idx-gW] + u[idx+gW] - 4*u[idx]) - uv2 + F * (1 - u[idx])
        v2[idx] = v[idx] + Dv * (v[idx-1] + v[idx+1] + v[idx-gW] + v[idx+gW] - 4*v[idx]) + uv2 - (k + F) * v[idx]
      }
    }
    stateRef29.u = u2
    stateRef29.v = v2
  }

  for (let y = 0; y < gH; y++) {
    for (let x = 0; x < gW; x++) {
      const vval = stateRef29.v[y * gW + x]
      ctx.fillStyle = `hsl(${bh + vval * 120},90%,${40 + vval * 30}%)`
      ctx.fillRect(x * cellSize, y * cellSize, cellSize, cellSize)
    }
  }
}

// ============================================================================
// Mode 30: Flow Field (Curl Noise, Particles)
// ============================================================================

export const drawFlowField: DrawFn = (ctx, W, H, t, B, M, Hi, bh, mtz) => {
  ctx.fillStyle = 'rgba(2,4,12,0.08)'
  ctx.fillRect(0, 0, W, H)

  const particleCount = 2500 + Math.round(mtz * 1000)
  if (!stateRef30.particles) {
    stateRef30.particles = Array.from({ length: particleCount }, () => ({
      x: Math.random() * W,
      y: Math.random() * H,
      age: 0
    }))
  }

  const maxAge = 100 + mtz * 100
  const speed = 1.5 + mtz * 2

  for (const p of stateRef30.particles) {
    const nx = (p.x / W) * 3 + t * 0.1
    const ny = (p.y / H) * 3
    const angle = Math.sin(nx) * Math.cos(ny) * Math.PI * 2 + Math.sin(nx * 2 + 1) * Math.PI
    const ox = p.x, oy = p.y
    p.x += Math.cos(angle) * speed
    p.y += Math.sin(angle) * speed
    p.age++

    ctx.strokeStyle = `hsl(${bh + p.age * 2},70%,55%)`
    ctx.lineWidth = 0.8
    ctx.beginPath()
    ctx.moveTo(ox, oy)
    ctx.lineTo(p.x, p.y)
    ctx.stroke()

    if (p.x < 0 || p.x > W || p.y < 0 || p.y > H || p.age > maxAge) {
      p.x = Math.random() * W
      p.y = Math.random() * H
      p.age = 0
    }
  }
}

// ============================================================================
// Mode 31: Fourier Epicycles
// ============================================================================

export const drawFourierEpicycles: DrawFn = (ctx, W, H, t, B, M, Hi, bh, mtz) => {
  ctx.fillStyle = 'rgba(0,0,0,0.05)'
  ctx.fillRect(0, 0, W, H)

  const cx = W / 2, cy = H / 2
  const N = 5 + Math.round(mtz * 15)
  const A = Array.from({ length: N }, (_, i) => 1 / (2 * i + 1))
  const f = Array.from({ length: N }, (_, i) => 2 * i + 1)

  let sumX = 0, sumY = 0
  for (let i = 0; i < N; i++) {
    const oldX = sumX, oldY = sumY
    sumX += A[i] * Math.cos(f[i] * t)
    sumY += A[i] * Math.sin(f[i] * t)

    ctx.strokeStyle = `hsl(${bh},70%,${50 - i * 5}%)`
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.arc(cx + oldX, cy + oldY, A[i], 0, Math.PI * 2)
    ctx.stroke()

    ctx.strokeStyle = 'rgba(255,255,255,0.6)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(cx + oldX, cy + oldY)
    ctx.lineTo(cx + sumX, cy + sumY)
    ctx.stroke()
  }

  stateRef31.trace.push([sumX, sumY])
  if (stateRef31.trace.length > 200) stateRef31.trace.shift()

  ctx.strokeStyle = 'rgba(255,255,255,0.8)'
  ctx.lineWidth = 1.5
  ctx.beginPath()
  for (let i = 0; i < stateRef31.trace.length; i++) {
    const [x, y] = stateRef31.trace[i]
    if (i === 0) ctx.moveTo(cx + x, cy + y)
    else ctx.lineTo(cx + x, cy + y)
  }
  ctx.stroke()

  ctx.fillStyle = 'rgba(255,200,100,0.9)'
  ctx.beginPath()
  ctx.arc(cx + sumX, cy + sumY, 3, 0, Math.PI * 2)
  ctx.fill()
}

// ============================================================================
// Mode 32: Mandelbrot (Continuous Zoom)
// ============================================================================

export const drawMandelbrot: DrawFn = (ctx, W, H, t, B, M, Hi, bh, mtz) => {
  const gW = 120, gH = 67
  const cx_tar = -0.7453, cy_tar = 0.1127
  const zoom = 0.5 * Math.pow(1.5, t * 0.3 + mtz * t * 0.2)
  const maxIter = 60 + Math.round(mtz * 40)
  const sx = (W / gW), sy = (H / gH)

  for (let py = 0; py < gH; py++) {
    for (let px = 0; px < gW; px++) {
      const c_re = cx_tar + ((px / gW) - 0.5) * 4 / zoom
      const c_im = cy_tar + ((py / gH) - 0.5) * 4 / zoom
      let zr = 0, zi = 0, iter = 0
      while (iter < maxIter && zr * zr + zi * zi < 4) {
        const zr2 = zr * zr - zi * zi + c_re
        zi = 2 * zr * zi + c_im
        zr = zr2
        iter++
      }
      const smoothIter = iter + 1 - Math.log(Math.log(zr * zr + zi * zi)) / Math.log(2)
      ctx.fillStyle = `hsl(${bh + smoothIter * 5},90%,50%)`
      ctx.fillRect(px * sx, py * sy, sx, sy)
    }
  }
}

// ============================================================================
// Mode 33: Topology Morph (Torus → Klein Bottle)
// ============================================================================

export const drawTopologyMorph: DrawFn = (ctx, W, H, t, B, M, Hi, bh, mtz) => {
  ctx.fillStyle = 'rgba(0,0,0,0.12)'
  ctx.fillRect(0, 0, W, H)

  const cx = W / 2, cy = H / 2
  const morph = (Math.sin(t * 0.2 + mtz) * 0.5 + 0.5)
  const R = Math.min(W, H) * 0.15
  const r = R * 0.4
  const scale = Math.min(W, H) * 0.3
  const rx = t * 0.2, ry = t * 0.15

  const segments = 30
  const points: Array<Array<[number,number,number]>> = []

  for (let ui = 0; ui <= segments; ui++) {
    const u = (ui / segments) * Math.PI * 2
    const row: Array<[number,number,number]> = []
    for (let vi = 0; vi <= segments; vi++) {
      const v = (vi / segments) * Math.PI * 2
      let x, y, z
      if (morph < 0.5) {
        // Torus
        const blendT = morph * 2
        const rad = (R + r * Math.cos(v))
        x = rad * Math.cos(u)
        y = rad * Math.sin(u)
        z = r * Math.sin(v)
      } else {
        // Klein bottle approximation
        const blendK = (morph - 0.5) * 2
        const rad = R * (1 - blendK * 0.3 + blendK * Math.cos(u / 2) * 0.2)
        x = rad * Math.cos(u) * (1 + blendK * Math.sin(v) * 0.1)
        y = rad * Math.sin(u)
        z = r * (Math.sin(v) + blendK * Math.cos(u / 2) * Math.sin(v) * 0.2)
      }
      // Rotation
      const x2 = x
      const y2 = y * Math.cos(rx) - z * Math.sin(rx)
      const z2 = y * Math.sin(rx) + z * Math.cos(rx)
      const x3 = x2 * Math.cos(ry) + z2 * Math.sin(ry)
      const y3 = y2
      const z3 = -x2 * Math.sin(ry) + z2 * Math.cos(ry)
      row.push([x3, y3, z3])
    }
    points.push(row)
  }

  // Draw edges
  for (let ui = 0; ui < segments; ui++) {
    for (let vi = 0; vi < segments; vi++) {
      const p00 = points[ui][vi], p10 = points[ui + 1][vi]
      const p01 = points[ui][vi + 1], p11 = points[ui + 1][vi + 1]

      ctx.strokeStyle = `hsl(${bh + ui * 30},80%,55%)`
      ctx.lineWidth = 0.5
      ctx.beginPath()
      ctx.moveTo(cx + p00[0] * scale, cy + p00[1] * scale)
      ctx.lineTo(cx + p10[0] * scale, cy + p10[1] * scale)
      ctx.stroke()

      ctx.beginPath()
      ctx.moveTo(cx + p00[0] * scale, cy + p00[1] * scale)
      ctx.lineTo(cx + p01[0] * scale, cy + p01[1] * scale)
      ctx.stroke()
    }
  }
}
