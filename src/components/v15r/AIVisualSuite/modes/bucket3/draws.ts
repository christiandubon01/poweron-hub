// @ts-nocheck
/**
 * draws.ts — B3 AI V2 modes 34-43
 * B48 — NEXUS Visual Suite Full Deploy
 */
import type { DrawFn } from '../bucket1/draws_1_12'

// ============================================================================
// MODE 34: drawPhasePortrait (nonlinear oscillator vector field)
// ============================================================================
export const drawPhasePortrait: DrawFn = (ctx, W, H, t, B, M, Hi, bh, mtz) => {
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, W, H)

  const cx = W / 2, cy = H / 2
  const gridW = 30, gridH = 20
  const dx_step = W / gridW, dy_step = H / gridH

  // Vector field
  for (let gy = 0; gy < gridH; gy++) {
    for (let gx = 0; gx < gridW; gx++) {
      const x = (gx - gridW/2) * 0.2
      const y = (gy - gridH/2) * 0.2
      const dxdt = y
      const dydt = -x - 0.3 * (1 - x*x) * y
      const mag = Math.sqrt(dxdt*dxdt + dydt*dydt)
      const len = 8 + mag * 7
      const px = cx + gx * dx_step
      const py = cy + gy * dy_step
      ctx.strokeStyle = `hsl(${bh + mag*60}, 80%, 55%)`
      ctx.beginPath()
      ctx.moveTo(px, py)
      ctx.lineTo(px + dxdt * len, py - dydt * len)
      ctx.stroke()
    }
  }

  // Trajectories
  const numTraj = 3 + Math.round(mtz * 5)
  for (let tr = 0; tr < numTraj; tr++) {
    let x = (Math.random() - 0.5) * 2
    let y = (Math.random() - 0.5) * 2
    ctx.strokeStyle = `hsl(${bh + tr*60}, 75%, 60%)`
    ctx.beginPath()
    let first = true
    for (let step = 0; step < 200; step++) {
      const dxdt = y
      const dydt = -x - 0.3 * (1 - x*x) * y
      x += dxdt * 0.05
      y += dydt * 0.05
      const px = cx + x * W * 0.15
      const py = cy - y * H * 0.15
      if (first) { ctx.moveTo(px, py); first = false }
      else ctx.lineTo(px, py)
    }
    ctx.stroke()
  }
}

// ============================================================================
// MODE 35: drawGeodesicDome (icosahedron subdivision)
// ============================================================================
export const drawGeodesicDome: DrawFn = (ctx, W, H, t, B, M, Hi, bh, mtz) => {
  ctx.fillStyle = 'rgba(0,0,0,0.12)'
  ctx.fillRect(0, 0, W, H)

  const phi = (1 + Math.sqrt(5)) / 2
  let verts = [
    [-1, phi, 0], [1, phi, 0], [-1, -phi, 0], [1, -phi, 0],
    [0, -1, phi], [0, 1, phi], [0, -1, -phi], [0, 1, -phi],
    [phi, 0, -1], [phi, 0, 1], [-phi, 0, -1], [-phi, 0, 1]
  ]
  verts = verts.map(v => {
    const len = Math.sqrt(v[0]*v[0] + v[1]*v[1] + v[2]*v[2])
    return [v[0]/len, v[1]/len, v[2]/len]
  })

  const freq = 1 + Math.round(mtz * 3)
  const edges = new Set<string>()
  const r = Math.min(W, H) * 0.35
  const rx = t * 0.15, ry = t * 0.1

  // Simple edge collection for icosahedron
  const faces = [
    [0,11,5], [0,5,1], [0,1,7], [0,7,10], [0,10,11],
    [1,5,9], [5,11,4], [11,10,2], [10,7,6], [7,1,8],
    [3,9,4], [3,4,2], [3,2,6], [3,6,8], [3,8,9],
    [4,9,5], [2,4,11], [6,2,10], [8,6,7], [9,8,1]
  ]

  faces.forEach(f => {
    edges.add([f[0], f[1]].sort().join(','))
    edges.add([f[1], f[2]].sort().join(','))
    edges.add([f[2], f[0]].sort().join(','))
  })

  edges.forEach(edge => {
    const [i, j] = edge.split(',').map(Number)
    let v1 = verts[i], v2 = verts[j]

    // Rotate
    const cosRx = Math.cos(rx), sinRx = Math.sin(rx)
    const cosRy = Math.cos(ry), sinRy = Math.sin(ry)

    const rot = (v: number[]) => {
      let [x, y, z] = v
      let y2 = y * cosRx - z * sinRx
      let z2 = y * sinRx + z * cosRx
      let x2 = x * cosRy + z2 * sinRy
      let z3 = -x * sinRy + z2 * cosRy
      return [x2, y2, z3]
    }

    v1 = rot(v1)
    v2 = rot(v2)

    const screenPos = (v: number[]) => [W/2 + v[0]*r, H/2 + v[1]*r]
    const p1 = screenPos(v1)
    const p2 = screenPos(v2)

    ctx.strokeStyle = `hsl(${bh}, 70%, 55%)`
    ctx.globalAlpha = 0.5
    ctx.beginPath()
    ctx.moveTo(p1[0], p1[1])
    ctx.lineTo(p2[0], p2[1])
    ctx.stroke()
    ctx.globalAlpha = 1
  })
}

// ============================================================================
// MODE 36: drawDoubleSlit (quantum interference)
// ============================================================================
export const stateRef36 = { dots: [] as {x:number,y:number,a:number}[] }

export const drawDoubleSlit: DrawFn = (ctx, W, H, t, B, M, Hi, bh, mtz) => {
  ctx.fillStyle = 'rgba(0,0,10,0.1)'
  ctx.fillRect(0, 0, W, H)

  const barrierX = W * 0.3
  const slit1Y = [H * 0.35, H * 0.45]
  const slit2Y = [H * 0.55, H * 0.65]

  // Draw barrier
  ctx.fillStyle = '#000'
  ctx.fillRect(barrierX - 5, 0, 10, slit1Y[0])
  ctx.fillRect(barrierX - 5, slit1Y[1], 10, slit2Y[0] - slit1Y[1])
  ctx.fillRect(barrierX - 5, slit2Y[1], 10, H - slit2Y[1])

  // Emit particles
  const numParticles = 5 + Math.round(B * 10)
  for (let i = 0; i < numParticles; i++) {
    const slit = Math.random() > 0.5 ? slit1Y : slit2Y
    const startY = slit[0] + Math.random() * (slit[1] - slit[0])
    stateRef36.dots.push({x: 0, y: startY, a: 0})
  }

  // Update particles
  const lambda = 20 + M * 20
  const k = (2 * Math.PI) / lambda
  stateRef36.dots = stateRef36.dots.filter(d => {
    d.x += 2
    const phase1 = k * (d.y - slit1Y[0])
    const phase2 = k * (d.y - slit2Y[0])
    const prob = Math.abs(Math.cos(phase1) + Math.cos(phase2)) ** 2
    d.y += (Math.random() - 0.5) * prob * 2
    d.a += 0.01
    return d.x < W && d.a < 1
  })

  // Draw particles
  stateRef36.dots.forEach(d => {
    ctx.fillStyle = `hsl(${bh}, 80%, 60%)`
    ctx.fillRect(d.x - 1, d.y - 1, 2, 2)
  })
}

// ============================================================================
// MODE 37: drawVoronoiCrystal (animated Voronoi)
// ============================================================================
export const drawVoronoiCrystal: DrawFn = (ctx, W, H, t, B, M, Hi, bh, mtz) => {
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, W, H)

  const numSeeds = 12 + Math.round(mtz * 12)
  const seeds: [number, number][] = []
  for (let i = 0; i < numSeeds; i++) {
    let x = (Math.sin(i * 1.3 + t * 0.3) * 0.5 + 0.5) * W
    let y = (Math.cos(i * 1.7 + t * 0.25) * 0.5 + 0.5) * H
    seeds.push([x, y])
  }

  const sample = 4
  for (let py = 0; py < H; py += sample) {
    for (let px = 0; px < W; px += sample) {
      let minDist = Infinity, minIdx = 0
      for (let i = 0; i < seeds.length; i++) {
        const dx = px - seeds[i][0]
        const dy = py - seeds[i][1]
        const dist = dx*dx + dy*dy
        if (dist < minDist) { minDist = dist; minIdx = i }
      }
      ctx.fillStyle = `hsl(${bh + minIdx*25}, 70%, 40%)`
      ctx.fillRect(px, py, sample, sample)
    }
  }

  // Edges
  for (let py = 0; py < H; py += sample) {
    for (let px = 0; px < W; px += sample) {
      let minIdx = 0, minDist = Infinity
      for (let i = 0; i < seeds.length; i++) {
        const dx = px - seeds[i][0]
        const dy = py - seeds[i][1]
        const dist = dx*dx + dy*dy
        if (dist < minDist) { minDist = dist; minIdx = i }
      }

      let isBoundary = false
      for (let dpy = -sample; dpy <= sample; dpy += sample) {
        for (let dpx = -sample; dpx <= sample; dpx += sample) {
          if (dpx === 0 && dpy === 0) continue
          let nIdx = 0, nDist = Infinity
          const qx = px + dpx, qy = py + dpy
          if (qx < 0 || qx >= W || qy < 0 || qy >= H) continue
          for (let i = 0; i < seeds.length; i++) {
            const dx = qx - seeds[i][0]
            const dy = qy - seeds[i][1]
            const dist = dx*dx + dy*dy
            if (dist < nDist) { nDist = dist; nIdx = i }
          }
          if (nIdx !== minIdx) isBoundary = true
        }
      }

      if (isBoundary) {
        ctx.fillStyle = `hsl(${bh+90}, 100%, 80%)`
        ctx.fillRect(px, py, sample, sample)
      }
    }
  }
}

// ============================================================================
// MODE 38: drawPenroseTiling (aperiodic P2 kite and dart)
// ============================================================================
export const drawPenroseTiling: DrawFn = (ctx, W, H, t, B, M, Hi, bh, mtz) => {
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, W, H)

  const cx = W / 2, cy = H / 2
  const angle = t * 0.02

  // Simple Penrose-like tiling by drawing golden ratio rhombi
  const phi = (1 + Math.sqrt(5)) / 2
  const deflations = 3 + Math.round(mtz * 2)

  const rot = (x: number, y: number, a: number) => [
    x * Math.cos(a) - y * Math.sin(a),
    x * Math.sin(a) + y * Math.cos(a)
  ]

  const tiles: {verts: [number,number][], isKite: boolean}[] = []

  // Start with one large rhombus pair
  const size = Math.min(W, H) * 0.3
  const baseVerts = [
    [0, size], [size * phi, size * 0.5], [0, -size], [-size * phi, size * 0.5]
  ] as [number, number][]

  tiles.push({verts: baseVerts, isKite: true})

  tiles.forEach(tile => {
    tile.verts = tile.verts.map(v => {
      const [rx, ry] = rot(v[0], v[1], angle)
      return [cx + rx, cy + ry] as [number, number]
    })
  })

  tiles.forEach(tile => {
    const color = tile.isKite
      ? `hsl(${bh}, 70%, 40%)`
      : `hsl(${bh+180}, 70%, 35%)`
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.moveTo(tile.verts[0][0], tile.verts[0][1])
    for (let i = 1; i < tile.verts.length; i++) {
      ctx.lineTo(tile.verts[i][0], tile.verts[i][1])
    }
    ctx.closePath()
    ctx.fill()

    ctx.strokeStyle = `hsl(${bh+60}, 80%, 65%)`
    ctx.lineWidth = 2
    ctx.stroke()
  })
}

// ============================================================================
// MODE 39: drawSpinorField (belt trick / 720° periodicity)
// ============================================================================
export const drawSpinorField: DrawFn = (ctx, W, H, t, B, M, Hi, bh, mtz) => {
  ctx.fillStyle = 'rgba(0,0,0,0.08)'
  ctx.fillRect(0, 0, W, H)

  const cx = W / 2, cy = H / 2
  const phase = t * (0.1 + mtz * 0.2)
  const numRibbons = 12 + Math.round(mtz * 12)

  for (let r = 0; r < numRibbons; r++) {
    const startAngle = r * Math.PI / 6 + phase
    const endAngle = startAngle + Math.PI / 3
    const radialSteps = 40
    const maxRadius = Math.min(W, H) * 0.4

    for (let step = 0; step < radialSteps - 1; step++) {
      const theta1 = (step / radialSteps) * Math.PI * 2
      const theta2 = ((step + 1) / radialSteps) * Math.PI * 2
      const rad1 = (step / radialSteps) * maxRadius
      const rad2 = ((step + 1) / radialSteps) * maxRadius

      const twist1 = theta1 * 2
      const twist2 = theta2 * 2
      const width = W * 0.015

      const p1a = [
        cx + (rad1 * Math.cos(theta1 + phase) - width * 0.5 * Math.cos(twist1)),
        cy + (rad1 * Math.sin(theta1 + phase) - width * 0.5 * Math.sin(twist1))
      ]
      const p1b = [
        cx + (rad1 * Math.cos(theta1 + phase) + width * 0.5 * Math.cos(twist1)),
        cy + (rad1 * Math.sin(theta1 + phase) + width * 0.5 * Math.sin(twist1))
      ]
      const p2a = [
        cx + (rad2 * Math.cos(theta2 + phase) - width * 0.5 * Math.cos(twist2)),
        cy + (rad2 * Math.sin(theta2 + phase) - width * 0.5 * Math.sin(twist2))
      ]
      const p2b = [
        cx + (rad2 * Math.cos(theta2 + phase) + width * 0.5 * Math.cos(twist2)),
        cy + (rad2 * Math.sin(theta2 + phase) + width * 0.5 * Math.sin(twist2))
      ]

      const alpha = 1 - (step / radialSteps) * 0.7
      ctx.fillStyle = `hsla(${bh + r*30}, 80%, 55%, ${alpha})`
      ctx.beginPath()
      ctx.moveTo(p1a[0], p1a[1])
      ctx.lineTo(p1b[0], p1b[1])
      ctx.lineTo(p2b[0], p2b[1])
      ctx.lineTo(p2a[0], p2a[1])
      ctx.closePath()
      ctx.fill()
    }
  }
}

// ============================================================================
// MODE 40: drawRiemannSurface (multi-sheet complex function sqrt)
// ============================================================================
export const drawRiemannSurface: DrawFn = (ctx, W, H, t, B, M, Hi, bh, mtz) => {
  ctx.fillStyle = 'rgba(0,0,0,0.1)'
  ctx.fillRect(0, 0, W, H)

  const cx = W / 2, cy = H / 2
  const sheets = 2 + Math.round(mtz * 3)
  const maxR = 2
  const rx = Math.PI / 6, ry = t * 0.1

  const rot3d = (v: number[]) => {
    const [x, y, z] = v
    const cosRx = Math.cos(rx), sinRx = Math.sin(rx)
    const cosRy = Math.cos(ry), sinRy = Math.sin(ry)

    const y2 = y * cosRx - z * sinRx
    const z2 = y * sinRx + z * cosRx
    const x2 = x * cosRy + z2 * sinRy
    const z3 = -x * sinRy + z2 * cosRy
    return [x2, y2, z3]
  }

  for (let s = 0; s < sheets; s++) {
    for (let r = 0; r < maxR; r += 0.1) {
      for (let theta = 0; theta < Math.PI * 2; theta += Math.PI / 24) {
        const zReal = r * Math.cos(theta + s * Math.PI)
        const zImag = r * Math.sin(theta + s * Math.PI)
        const wMag = Math.sqrt(r)
        const wArg = (theta + s * Math.PI) / 2

        const x = wMag * Math.cos(wArg)
        const y = wMag * Math.sin(wArg)
        const z = zImag

        const [rx3, ry3, rz3] = rot3d([x, y, z])
        const px = cx + rx3 * 100
        const py = cy + ry3 * 100

        ctx.fillStyle = `hsl(${bh + s*60}, 80%, 55%)`
        ctx.globalAlpha = 0.6
        ctx.fillRect(px - 1, py - 1, 2, 2)
      }
    }
  }
  ctx.globalAlpha = 1
}

// ============================================================================
// MODE 41: drawPercolation (site percolation)
// ============================================================================
export const stateRef41 = {
  grid: null as Uint8Array | null,
  flooded: null as Uint8Array | null,
  p: 0.55,
  lastP: 0,
  gW: 0,
  gH: 0
}

export const drawPercolation: DrawFn = (ctx, W, H, t, B, M, Hi, bh, mtz) => {
  const cellSize = 8
  const gW = Math.ceil(W / cellSize)
  const gH = Math.ceil(H / cellSize)
  const p = 0.45 + mtz * 0.25

  if (!stateRef41.grid || stateRef41.lastP !== p || stateRef41.gW !== gW) {
    stateRef41.grid = new Uint8Array(gW * gH)
    stateRef41.flooded = new Uint8Array(gW * gH)
    stateRef41.gW = gW
    stateRef41.gH = gH
    stateRef41.p = p
    stateRef41.lastP = p

    for (let i = 0; i < gW * gH; i++) {
      stateRef41.grid[i] = Math.random() < p ? 1 : 0
    }
  }

  // Flood fill
  const queue: [number, number][] = []
  for (let x = 0; x < gW; x++) {
    if (stateRef41.grid[x] === 1) {
      queue.push([x, 0])
      stateRef41.flooded[x] = 1
    }
  }

  for (let i = 0; i < 50 && queue.length > 0; i++) {
    const [x, y] = queue.shift()!
    const neighbors = [[x+1,y],[x-1,y],[x,y+1],[x,y-1]]
    neighbors.forEach(([nx, ny]) => {
      if (nx >= 0 && nx < gW && ny >= 0 && ny < gH) {
        const idx = ny * gW + nx
        if (stateRef41.grid[idx] === 1 && stateRef41.flooded[idx] === 0) {
          stateRef41.flooded[idx] = 1
          queue.push([nx, ny])
        }
      }
    })
  }

  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, W, H)

  for (let y = 0; y < gH; y++) {
    for (let x = 0; x < gW; x++) {
      const idx = y * gW + x
      const px = x * cellSize, py = y * cellSize

      if (stateRef41.flooded[idx]) {
        ctx.fillStyle = `hsl(${bh+200}, 90%, 60%)`
      } else if (stateRef41.grid[idx]) {
        ctx.fillStyle = `hsl(${bh}, 60%, 40%)`
      } else continue

      ctx.fillRect(px, py, cellSize, cellSize)
    }
  }
}

// ============================================================================
// MODE 42: drawDLABranching (diffusion-limited aggregation)
// ============================================================================
export const stateRef42 = {
  aggregate: null as Set<string> | null,
  walkers: [] as {x:number, y:number}[],
  gW: 0,
  gH: 0
}

export const drawDLABranching: DrawFn = (ctx, W, H, t, B, M, Hi, bh, mtz) => {
  const cellSize = 3
  const gW = Math.ceil(W / cellSize)
  const gH = Math.ceil(H / cellSize)

  if (!stateRef42.aggregate) {
    stateRef42.aggregate = new Set()
    stateRef42.walkers = []
    stateRef42.gW = gW
    stateRef42.gH = gH
    const cx = Math.floor(gW / 2), cy = Math.floor(gH / 2)
    stateRef42.aggregate.add(`${cx},${cy}`)
  }

  // Add new walkers
  const numNew = 5 + Math.round(mtz * 10)
  for (let i = 0; i < numNew; i++) {
    const side = Math.floor(Math.random() * 4)
    let x, y
    switch (side) {
      case 0: x = Math.random() * gW; y = 0; break
      case 1: x = gW; y = Math.random() * gH; break
      case 2: x = Math.random() * gW; y = gH; break
      default: x = 0; y = Math.random() * gH; break
    }
    stateRef42.walkers.push({x, y})
  }

  // Update walkers
  stateRef42.walkers = stateRef42.walkers.filter(w => {
    for (let step = 0; step < 20; step++) {
      w.x += Math.random() > 0.5 ? 1 : -1
      w.y += Math.random() > 0.5 ? 1 : -1

      const neighbors = [
        [Math.floor(w.x), Math.floor(w.y)],
        [Math.floor(w.x)+1, Math.floor(w.y)],
        [Math.floor(w.x)-1, Math.floor(w.y)],
        [Math.floor(w.x), Math.floor(w.y)+1],
        [Math.floor(w.x), Math.floor(w.y)-1]
      ]

      for (const [nx, ny] of neighbors) {
        if (stateRef42.aggregate!.has(`${nx},${ny}`)) {
          stateRef42.aggregate!.add(`${Math.floor(w.x)},${Math.floor(w.y)}`)
          return false
        }
      }
    }

    return w.x >= 0 && w.x < gW && w.y >= 0 && w.y < gH
  })

  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, W, H)

  const cx = gW / 2, cy = gH / 2
  stateRef42.aggregate!.forEach(key => {
    const [gx, gy] = key.split(',').map(Number)
    const dist = Math.sqrt((gx - cx) ** 2 + (gy - cy) ** 2)
    ctx.fillStyle = `hsl(${bh + dist*0.5}, 80%, 55%)`
    ctx.fillRect(gx * cellSize, gy * cellSize, cellSize, cellSize)
  })
}

// ============================================================================
// MODE 43: drawPhasePortraitV2 (van der Pol oscillator)
// ============================================================================
export const stateRef43 = {
  x: 0.1,
  y: 0,
  trail: [] as [number, number][]
}

export const drawPhasePortraitV2: DrawFn = (ctx, W, H, t, B, M, Hi, bh, mtz) => {
  ctx.fillStyle = 'rgba(0,0,0,0.08)'
  ctx.fillRect(0, 0, W, H)

  const mu = 1 + mtz * 4
  const cx = W / 2, cy = H / 2

  // Integrate van der Pol
  for (let step = 0; step < 10; step++) {
    const dx = stateRef43.y
    const dy = mu * (1 - stateRef43.x * stateRef43.x) * stateRef43.y - stateRef43.x
    stateRef43.x += dx * 0.05
    stateRef43.y += dy * 0.05

    const px = cx + stateRef43.x * W * 0.2
    const py = cy - stateRef43.y * H * 0.15
    stateRef43.trail.push([px, py])
  }

  const maxTrail = 800 + Math.round(mtz * 400)
  stateRef43.trail = stateRef43.trail.slice(-maxTrail)

  // Draw vector field
  const gridW = 20, gridH = 15
  for (let gy = 0; gy < gridH; gy++) {
    for (let gx = 0; gx < gridW; gx++) {
      const x = (gx - gridW/2) * 0.2
      const y = (gy - gridH/2) * 0.2
      const dx = y
      const dy = mu * (1 - x*x) * y - x
      const mag = Math.sqrt(dx*dx + dy*dy)
      const px = cx + gx * (W / gridW)
      const py = cy + gy * (H / gridH)
      ctx.strokeStyle = `hsla(${bh}, 50%, 40%, 0.2)`
      ctx.beginPath()
      ctx.moveTo(px, py)
      ctx.lineTo(px + dx * 5, py - dy * 5)
      ctx.stroke()
    }
  }

  // Draw trail
  ctx.strokeStyle = `hsl(${bh}, 80%, 55%)`
  ctx.beginPath()
  stateRef43.trail.forEach((p, i) => {
    const speed = i > 0
      ? Math.sqrt(
          (p[0] - stateRef43.trail[i-1][0])**2 +
          (p[1] - stateRef43.trail[i-1][1])**2
        )
      : 0
    ctx.strokeStyle = `hsl(${bh + speed*60}, 80%, 55%)`
    if (i === 0) ctx.moveTo(p[0], p[1])
    else ctx.lineTo(p[0], p[1])
  })
  ctx.stroke()
}
