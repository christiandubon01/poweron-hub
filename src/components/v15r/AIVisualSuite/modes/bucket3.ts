// @ts-nocheck
/**
 * bucket3.ts — B3 AI V2 draw functions (modes 33-42)
 * B48 — NEXUS Visual Suite Full Deploy
 */

export type DrawFn = (
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  t: number,
  B: number,
  M: number,
  Hi: number,
  bh: number,
  mtz: number,
) => void

// ─── Module-level state ───────────────────────────────────────────────────────

// Double-Slit particle accumulation
const s35 = {
  screen: null as Float32Array | null,
  W: 0,
}

// Percolation grid
const s41 = {
  grid: null as Uint8Array | null,
  gW: 0,
  gH: 0,
  lastT: -9999,
}

// DLA (Diffusion-Limited Aggregation)
const s42 = {
  agg: null as Set<string> | null,
  particles: [] as { x: number; y: number }[],
  lastT: -9999,
}

// ─── 33: Phase Portrait ───────────────────────────────────────────────────────
export function drawPhasePortrait(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  t: number,
  B: number,
  M: number,
  Hi: number,
  bh: number,
  mtz: number,
): void {
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, W, H)

  const cx = W * 0.5
  const cy = H * 0.5
  const scx = W * 0.28
  const scy = H * 0.28
  const mu = 0.8 + B * 1.4 + mtz * 0.004

  const hue = Hi
  const steps = 280 + Math.round(M * 120)
  const dt2 = 0.06

  // Draw multiple trajectories from different ICs
  for (let k = 0; k < 6; k++) {
    let x = 1.5 * Math.cos((k / 6) * Math.PI * 2 + t * 0.12)
    let y = 1.5 * Math.sin((k / 6) * Math.PI * 2 + t * 0.12)

    ctx.beginPath()
    ctx.moveTo(cx + x * scx, cy - y * scy)

    for (let i = 0; i < steps; i++) {
      // Van der Pol-like: x'' - mu*(1-x^2)*x' + x = 0
      const dx = y
      const dy = mu * (1 - x * x) * y - x
      x += dx * dt2
      y += dy * dt2
      const px = cx + x * scx
      const py = cy - y * scy
      ctx.lineTo(px, py)
    }

    const alpha = 0.55 + k * 0.06
    ctx.strokeStyle = `hsla(${(hue + k * 28) % 360}, 90%, 65%, ${alpha})`
    ctx.lineWidth = 1.2
    ctx.stroke()
  }

  // Axes
  ctx.strokeStyle = 'rgba(255,255,255,0.18)'
  ctx.lineWidth = 0.8
  ctx.beginPath(); ctx.moveTo(W * 0.06, cy); ctx.lineTo(W * 0.94, cy); ctx.stroke()
  ctx.beginPath(); ctx.moveTo(cx, H * 0.06); ctx.lineTo(cx, H * 0.94); ctx.stroke()

  ctx.font = '11px Courier New'
  ctx.fillStyle = `hsla(${hue}, 80%, 70%, 0.7)`
  ctx.fillText('PHASE PORTRAIT', 14, 18)
  ctx.fillStyle = 'rgba(255,255,255,0.4)'
  ctx.fillText(`μ=${mu.toFixed(2)}`, 14, 33)
}

// ─── 34: Geodesic Dome ────────────────────────────────────────────────────────
export function drawGeodesicDome(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  t: number,
  B: number,
  M: number,
  Hi: number,
  bh: number,
  mtz: number,
): void {
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, W, H)

  const cx = W * 0.5
  const cy = H * 0.5
  const R = Math.min(W, H) * (0.3 + B * 0.08)
  const hue = Hi

  const rotX = t * 0.25 + mtz * 0.002
  const rotY = t * 0.33

  // Project 3D point onto 2D
  function project(x: number, y: number, z: number): [number, number, number] {
    // Rotate around Y
    const x1 = x * Math.cos(rotY) - z * Math.sin(rotY)
    const z1 = x * Math.sin(rotY) + z * Math.cos(rotY)
    // Rotate around X
    const y2 = y * Math.cos(rotX) - z1 * Math.sin(rotX)
    const z2 = y * Math.sin(rotX) + z1 * Math.cos(rotX)
    const fov = 3.5
    const scale = fov / (fov + z2 + 1.5)
    return [cx + x1 * R * scale, cy - y2 * R * scale, z2]
  }

  // Icosahedron vertices
  const phi = (1 + Math.sqrt(5)) / 2
  const verts: [number, number, number][] = []
  const pairs: [number[], number[]][] = [
    [0, 1], [-1, 1], [0, -1], [1, -1],
  ]
  // normalized icosahedron
  const ico: [number,number,number][] = [
    [0,1,phi],[0,-1,phi],[0,1,-phi],[0,-1,-phi],
    [1,phi,0],[-1,phi,0],[1,-phi,0],[-1,-phi,0],
    [phi,0,1],[phi,0,-1],[-phi,0,1],[-phi,0,-1],
  ]
  const norm = Math.sqrt(1 + phi * phi)
  const icoN: [number,number,number][] = ico.map(([x,y,z]) => [x/norm, y/norm, z/norm])

  // Icosahedron edges
  const edges: [number,number][] = []
  for (let i = 0; i < icoN.length; i++) {
    for (let j = i + 1; j < icoN.length; j++) {
      const dx = icoN[i][0]-icoN[j][0]
      const dy = icoN[i][1]-icoN[j][1]
      const dz = icoN[i][2]-icoN[j][2]
      const d = Math.sqrt(dx*dx+dy*dy+dz*dz)
      if (d < 1.05 / norm * 2.1) edges.push([i,j])
    }
  }

  const freq = Math.round(1 + M * 2) // subdivision frequency
  const subdEdges: [number,number,number][][] = []

  edges.forEach(([a, b]) => {
    const pa = icoN[a], pb = icoN[b]
    const pts: [number,number,number][] = []
    for (let k = 0; k <= freq; k++) {
      const s = k / freq
      let x = pa[0] + (pb[0]-pa[0])*s
      let y = pa[1] + (pb[1]-pa[1])*s
      let z = pa[2] + (pb[2]-pa[2])*s
      const r = Math.sqrt(x*x+y*y+z*z)
      pts.push([x/r, y/r, z/r])
    }
    subdEdges.push(pts)
  })

  // Draw edges
  subdEdges.forEach((pts, ei) => {
    const [px0, py0, pz0] = project(pts[0][0], pts[0][1], pts[0][2])
    ctx.beginPath()
    ctx.moveTo(px0, py0)
    for (let k = 1; k < pts.length; k++) {
      const [px, py] = project(pts[k][0], pts[k][1], pts[k][2])
      ctx.lineTo(px, py)
    }
    const depth = (pz0 + 2) / 4
    const alpha = 0.3 + depth * 0.55
    ctx.strokeStyle = `hsla(${(hue + ei * 7) % 360}, 80%, 65%, ${alpha})`
    ctx.lineWidth = 0.9
    ctx.stroke()
  })

  // Glow at center
  const grd = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 0.4)
  grd.addColorStop(0, `hsla(${hue}, 90%, 70%, ${0.12 + B * 0.1})`)
  grd.addColorStop(1, 'transparent')
  ctx.fillStyle = grd
  ctx.fillRect(0, 0, W, H)

  ctx.font = '11px Courier New'
  ctx.fillStyle = `hsla(${hue}, 80%, 70%, 0.7)`
  ctx.fillText('GEODESIC DOME', 14, 18)
  ctx.fillStyle = 'rgba(255,255,255,0.4)'
  ctx.fillText(`FREQ ${freq}`, 14, 33)
}

// ─── 35: Double-Slit ──────────────────────────────────────────────────────────
export function drawDoubleSlit(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  t: number,
  B: number,
  M: number,
  Hi: number,
  bh: number,
  mtz: number,
): void {
  const W2 = Math.round(W)
  if (s35.screen === null || s35.W !== W2) {
    s35.screen = new Float32Array(W2).fill(0)
    s35.W = W2
  }

  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, W, H)

  const cx = W * 0.5
  const cy = H * 0.5
  const hue = Hi
  const lambda = 0.04 + M * 0.03
  const d = 0.12 + mtz * 0.0005
  const slitY = H * 0.35

  // Compute interference pattern analytically
  const maxI = W2
  for (let px = 0; px < W2; px++) {
    const x = (px / W - 0.5) * 2
    const r1 = Math.sqrt((x - d) ** 2 + 0.5 ** 2)
    const r2 = Math.sqrt((x + d) ** 2 + 0.5 ** 2)
    const phase = (r1 - r2) / lambda
    const intensity = (1 + Math.cos(phase * Math.PI * 2)) * 0.5
    s35.screen[px] = s35.screen[px] * 0.96 + intensity * B * 0.04
  }

  // Draw screen histogram
  for (let px = 0; px < W2; px++) {
    const v = Math.min(s35.screen[px] * 2, 1)
    const barH = v * H * 0.5
    ctx.fillStyle = `hsla(${(hue + v * 80) % 360}, 90%, 60%, ${0.7 * v + 0.1})`
    ctx.fillRect(px, H * 0.5, 1, -barH)
    ctx.fillRect(px, H * 0.5, 1, barH * 0.3)
  }

  // Draw slit barrier
  const slitW = 6, gap = Math.round(W * d * 0.8)
  ctx.fillStyle = 'rgba(255,255,255,0.85)'
  ctx.fillRect(0, slitY - 2, cx - gap / 2 - slitW / 2, 4)
  ctx.fillRect(cx - gap / 2 + slitW / 2, slitY - 2, gap - slitW, 4)
  ctx.fillRect(cx + gap / 2 + slitW / 2, slitY - 2, W - (cx + gap / 2 + slitW / 2), 4)

  // Particle dots (simulate falling)
  const nP = Math.round(6 + B * 12)
  for (let i = 0; i < nP; i++) {
    const phase2 = t * 3.7 + i * 1.23
    const px2 = (W * 0.5 + Math.sin(phase2) * W * 0.4)
    const py2 = (slitY + (t * 60 + i * 80) % (H * 0.5 - slitY))
    const alpha2 = Math.random() * 0.6 + 0.2
    ctx.beginPath()
    ctx.arc(px2, py2, 1.5, 0, Math.PI * 2)
    ctx.fillStyle = `hsla(${hue}, 90%, 80%, ${alpha2})`
    ctx.fill()
  }

  ctx.font = '11px Courier New'
  ctx.fillStyle = `hsla(${hue}, 80%, 70%, 0.7)`
  ctx.fillText('DOUBLE-SLIT', 14, 18)
  ctx.fillStyle = 'rgba(255,255,255,0.4)'
  ctx.fillText(`λ=${lambda.toFixed(3)}`, 14, 33)
}

// ─── 36: Voronoi Crystal ──────────────────────────────────────────────────────
export function drawVoronoiCrystal(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  t: number,
  B: number,
  M: number,
  Hi: number,
  bh: number,
  mtz: number,
): void {
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, W, H)

  const hue = Hi
  const nSeeds = Math.round(12 + M * 16)
  const seeds: [number, number][] = []

  for (let i = 0; i < nSeeds; i++) {
    const ang = (i / nSeeds) * Math.PI * 2 + t * 0.18 * (i % 2 ? 1 : -1)
    const r = (0.15 + (i / nSeeds) * 0.32 + Math.sin(t * 0.4 + i) * 0.06 * B) * Math.min(W, H)
    seeds.push([W * 0.5 + Math.cos(ang) * r, H * 0.5 + Math.sin(ang) * r])
  }

  const imageData = ctx.getImageData(0, 0, W, H)
  const data = imageData.data
  const step = 2

  for (let py = 0; py < H; py += step) {
    for (let px = 0; px < W; px += step) {
      let minD = Infinity, minI = 0, secD = Infinity
      for (let k = 0; k < seeds.length; k++) {
        const dx = px - seeds[k][0]
        const dy = py - seeds[k][1]
        const d = dx * dx + dy * dy
        if (d < minD) { secD = minD; minD = d; minI = k }
        else if (d < secD) secD = d
      }
      const edge = Math.sqrt(secD) - Math.sqrt(minD)
      const isEdge = edge < 3.5
      const cellHue = (hue + (minI / nSeeds) * 220) % 360
      const depth = Math.sqrt(minD) / (Math.min(W, H) * 0.5)
      const light = isEdge ? 95 : (45 + (1 - depth) * 30)
      const alpha = isEdge ? 200 : Math.round(80 + (1 - depth) * 80 * B)
      const [r, g, b] = hslToRgb(cellHue / 360, 0.75, light / 100)
      const idx = (py * W + px) * 4
      for (let dy2 = 0; dy2 < step && py + dy2 < H; dy2++) {
        for (let dx2 = 0; dx2 < step && px + dx2 < W; dx2++) {
          const i2 = ((py + dy2) * W + (px + dx2)) * 4
          data[i2] = r; data[i2+1] = g; data[i2+2] = b; data[i2+3] = alpha
        }
      }
    }
  }
  ctx.putImageData(imageData, 0, 0)

  ctx.font = '11px Courier New'
  ctx.fillStyle = `hsla(${hue}, 80%, 70%, 0.7)`
  ctx.fillText('VORONOI CRYSTAL', 14, 18)
  ctx.fillStyle = 'rgba(255,255,255,0.4)'
  ctx.fillText(`SEEDS ${nSeeds}`, 14, 33)
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  let r, g, b
  if (s === 0) { r = g = b = l } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s
    const p = 2 * l - q
    r = hue2rgb(p, q, h + 1/3)
    g = hue2rgb(p, q, h)
    b = hue2rgb(p, q, h - 1/3)
  }
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)]
}
function hue2rgb(p: number, q: number, t: number): number {
  if (t < 0) t += 1; if (t > 1) t -= 1
  if (t < 1/6) return p + (q - p) * 6 * t
  if (t < 1/2) return q
  if (t < 2/3) return p + (q - p) * (2/3 - t) * 6
  return p
}

// ─── 37: Penrose Tiling ───────────────────────────────────────────────────────
export function drawPenroseTiling(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  t: number,
  B: number,
  M: number,
  Hi: number,
  bh: number,
  mtz: number,
): void {
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, W, H)

  const hue = Hi
  const cx = W * 0.5
  const cy = H * 0.5
  const scale = Math.min(W, H) * (0.38 + B * 0.04)
  const rot = t * 0.04 + mtz * 0.001

  // Penrose P2 using deflation approach (simplified kite/dart pattern)
  const phi2 = (1 + Math.sqrt(5)) / 2

  // Generate a set of "kite" triangles
  type Tri = [number, [number,number], [number,number], [number,number]]
  let triangles: Tri[] = []

  // Initial 10 golden gnomons around center
  for (let i = 0; i < 10; i++) {
    const a = (2 * i - 1) * Math.PI / 10
    const b2 = (2 * i + 1) * Math.PI / 10
    const p0: [number, number] = [0, 0]
    const p1: [number, number] = [Math.cos(a), Math.sin(a)]
    const p2: [number, number] = [Math.cos(b2), Math.sin(b2)]
    triangles.push([0, p0, i % 2 ? p1 : p2, i % 2 ? p2 : p1])
  }

  // Deflate 4 times
  const levels = Math.round(3 + M * 2)
  for (let lv = 0; lv < levels; lv++) {
    const next: Tri[] = []
    triangles.forEach(([kind, A, B2, C]) => {
      if (kind === 0) {
        // Golden gnomon
        const P: [number,number] = [
          A[0] + (B2[0]-A[0]) / phi2,
          A[1] + (B2[1]-A[1]) / phi2,
        ]
        next.push([0, C, P, B2])
        next.push([1, P, C, A])
      } else {
        // Kite
        const Q: [number,number] = [
          B2[0] + (A[0]-B2[0]) / phi2,
          B2[1] + (A[1]-B2[1]) / phi2,
        ]
        const R: [number,number] = [
          B2[0] + (C[0]-B2[0]) / phi2,
          B2[1] + (C[1]-B2[1]) / phi2,
        ]
        next.push([1, R, A, Q])
        next.push([0, Q, A, B2])
        next.push([1, R, C, B2])
      }
    })
    triangles = next
    if (triangles.length > 6000) break
  }

  // Draw
  triangles.forEach(([kind, A, B2, C], idx) => {
    const ax = cx + (A[0]*Math.cos(rot) - A[1]*Math.sin(rot)) * scale
    const ay = cy + (A[0]*Math.sin(rot) + A[1]*Math.cos(rot)) * scale
    const bx = cx + (B2[0]*Math.cos(rot) - B2[1]*Math.sin(rot)) * scale
    const by = cy + (B2[0]*Math.sin(rot) + B2[1]*Math.cos(rot)) * scale
    const ccx2 = cx + (C[0]*Math.cos(rot) - C[1]*Math.sin(rot)) * scale
    const ccy2 = cy + (C[0]*Math.sin(rot) + C[1]*Math.cos(rot)) * scale

    ctx.beginPath()
    ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.lineTo(ccx2, ccy2); ctx.closePath()
    const fillHue = (hue + (kind === 0 ? 0 : 140)) % 360
    ctx.fillStyle = `hsla(${fillHue}, 75%, ${30 + B * 20}%, 0.72)`
    ctx.fill()
    ctx.strokeStyle = `hsla(${fillHue}, 80%, 70%, 0.45)`
    ctx.lineWidth = 0.6
    ctx.stroke()
  })

  ctx.font = '11px Courier New'
  ctx.fillStyle = `hsla(${hue}, 80%, 70%, 0.7)`
  ctx.fillText('PENROSE TILING', 14, 18)
  ctx.fillStyle = 'rgba(255,255,255,0.4)'
  ctx.fillText(`TILES ${triangles.length}`, 14, 33)
}

// ─── 38: Spinor Field ─────────────────────────────────────────────────────────
export function drawSpinorField(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  t: number,
  B: number,
  M: number,
  Hi: number,
  bh: number,
  mtz: number,
): void {
  ctx.fillStyle = 'rgba(0,0,0,0.18)'
  ctx.fillRect(0, 0, W, H)

  const hue = Hi
  const cx = W * 0.5
  const cy = H * 0.5
  const gridN = Math.round(14 + M * 10)
  const spacing = Math.min(W, H) / gridN

  for (let gy = 0; gy <= gridN; gy++) {
    for (let gx = 0; gx <= gridN; gx++) {
      const px = gx * spacing
      const py = gy * spacing
      const rx = (px - cx) / W
      const ry = (py - cy) / H
      const r = Math.sqrt(rx * rx + ry * ry)

      // Spinor angle: winds twice as fast as position angle
      const theta = Math.atan2(ry, rx)
      const spinPhase = 2 * theta + t * (0.6 + B * 0.8) + r * 8 + mtz * 0.003
      const len = spacing * 0.38 * (0.5 + B * 0.5)
      const ex = Math.cos(spinPhase) * len
      const ey = Math.sin(spinPhase) * len

      const alpha = 0.5 + 0.4 * Math.sin(spinPhase * 0.5)
      ctx.strokeStyle = `hsla(${(hue + r * 180) % 360}, 85%, 65%, ${alpha})`
      ctx.lineWidth = 1.2
      ctx.beginPath()
      ctx.moveTo(px - ex * 0.5, py - ey * 0.5)
      ctx.lineTo(px + ex * 0.5, py + ey * 0.5)
      ctx.stroke()

      // Arrow head
      const ah = len * 0.35
      ctx.beginPath()
      ctx.arc(px + ex * 0.5, py + ey * 0.5, 1.5, 0, Math.PI * 2)
      ctx.fillStyle = `hsla(${(hue + r * 180) % 360}, 90%, 75%, ${alpha})`
      ctx.fill()
    }
  }

  ctx.font = '11px Courier New'
  ctx.fillStyle = `hsla(${hue}, 80%, 70%, 0.7)`
  ctx.fillText('SPINOR FIELD', 14, 18)
  ctx.fillStyle = 'rgba(255,255,255,0.4)'
  ctx.fillText('SU(2) BASIS', 14, 33)
}

// ─── 39: Riemann Surface ──────────────────────────────────────────────────────
export function drawRiemannSurface(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  t: number,
  B: number,
  M: number,
  Hi: number,
  bh: number,
  mtz: number,
): void {
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, W, H)

  const hue = Hi
  const cx = W * 0.5
  const cy = H * 0.5
  const sc = Math.min(W, H) * 0.35
  const sheets = Math.round(2 + M * 2)
  const rotAngle = t * 0.2 + mtz * 0.002

  const gridN = 28
  const step2 = 2 / gridN

  for (let sheet = 0; sheet < sheets; sheet++) {
    for (let i = 0; i <= gridN; i++) {
      ctx.beginPath()
      let first = true
      for (let j = 0; j <= gridN; j++) {
        const u = -1 + j * step2
        const v = -1 + i * step2
        const r2 = Math.sqrt(u * u + v * v) + 0.001
        const arg = Math.atan2(v, u) + sheet * Math.PI * 2
        const logR = Math.log(r2) * 0.5

        // Riemann surface of w = z^(1/sheets)
        const w_r = Math.pow(r2, 0.5 / sheets)
        const w_arg = arg / sheets
        const x3d = w_r * Math.cos(w_arg)
        const y3d = logR * 0.5
        const z3d = w_r * Math.sin(w_arg)

        // Rotate
        const x2 = x3d * Math.cos(rotAngle) - z3d * Math.sin(rotAngle)
        const z2 = x3d * Math.sin(rotAngle) + z3d * Math.cos(rotAngle)
        const fov = 4
        const scl = fov / (fov + z2 + 2)

        const px = cx + x2 * sc * scl
        const py = cy - y3d * sc * scl

        if (first) { ctx.moveTo(px, py); first = false }
        else ctx.lineTo(px, py)
      }
      const sheetHue = (hue + (sheet / sheets) * 180) % 360
      const alpha = 0.4 + B * 0.3
      ctx.strokeStyle = `hsla(${sheetHue}, 80%, 60%, ${alpha})`
      ctx.lineWidth = 1.0
      ctx.stroke()
    }
  }

  ctx.font = '11px Courier New'
  ctx.fillStyle = `hsla(${hue}, 80%, 70%, 0.7)`
  ctx.fillText('RIEMANN SURFACE', 14, 18)
  ctx.fillStyle = 'rgba(255,255,255,0.4)'
  ctx.fillText(`w = z^(1/${sheets})`, 14, 33)
}

// ─── 40: Percolation ─────────────────────────────────────────────────────────
export function drawPercolation(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  t: number,
  B: number,
  M: number,
  Hi: number,
  bh: number,
  mtz: number,
): void {
  const cellSz = Math.round(Math.max(4, 10 - M * 4))
  const gW2 = Math.floor(W / cellSz)
  const gH2 = Math.floor(H / cellSz)

  // Regenerate grid periodically
  const period = Math.floor(t / 3)
  if (s41.grid === null || s41.gW !== gW2 || s41.gH !== gH2 || Math.floor(t / 3) !== period || s41.lastT === -9999) {
    s41.grid = new Uint8Array(gW2 * gH2)
    s41.gW = gW2; s41.gH = gH2
    const p = 0.45 + B * 0.25 + mtz * 0.001
    for (let k = 0; k < gW2 * gH2; k++) {
      s41.grid[k] = Math.random() < p ? 1 : 0
    }
    // BFS flood from top row
    const visited = new Uint8Array(gW2 * gH2)
    const queue: number[] = []
    for (let x2 = 0; x2 < gW2; x2++) {
      if (s41.grid[x2] === 1) { visited[x2] = 2; queue.push(x2) }
    }
    while (queue.length > 0) {
      const idx2 = queue.pop()!
      const gx = idx2 % gW2, gy = Math.floor(idx2 / gW2)
      const nbrs = [[gx-1,gy],[gx+1,gy],[gx,gy-1],[gx,gy+1]]
      nbrs.forEach(([nx2,ny2]) => {
        if (nx2 < 0 || nx2 >= gW2 || ny2 < 0 || ny2 >= gH2) return
        const ni = ny2 * gW2 + nx2
        if (s41.grid![ni] === 1 && !visited[ni]) { visited[ni] = 2; queue.push(ni) }
      })
    }
    for (let k = 0; k < gW2 * gH2; k++) {
      if (s41.grid[k] === 1) s41.grid[k] = visited[k] === 2 ? 2 : 1
    }
    s41.lastT = period
  }

  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, W, H)

  const hue = Hi
  for (let gy = 0; gy < gH2; gy++) {
    for (let gx2 = 0; gx2 < gW2; gx2++) {
      const v = s41.grid![gy * gW2 + gx2]
      if (v === 0) continue
      const light = v === 2 ? 70 : 30
      const sat = v === 2 ? 90 : 40
      const h2 = v === 2 ? (hue + gy * 2) % 360 : (hue + 120) % 360
      ctx.fillStyle = `hsl(${h2}, ${sat}%, ${light}%)`
      ctx.fillRect(gx2 * cellSz + 0.5, gy * cellSz + 0.5, cellSz - 1, cellSz - 1)
    }
  }

  ctx.font = '11px Courier New'
  ctx.fillStyle = `hsla(${hue}, 80%, 70%, 0.7)`
  ctx.fillText('PERCOLATION', 14, 18)
  ctx.fillStyle = 'rgba(255,255,255,0.4)'
  const p2 = (0.45 + B * 0.25).toFixed(2)
  ctx.fillText(`p=${p2} pc≈0.593`, 14, 33)
}

// ─── 41: DLA Branching ────────────────────────────────────────────────────────
export function drawDLABranching(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  t: number,
  B: number,
  M: number,
  Hi: number,
  bh: number,
  mtz: number,
): void {
  const cx = W * 0.5, cy = H * 0.5

  if (s42.agg === null || Math.abs(t - s42.lastT) > 12) {
    s42.agg = new Set<string>()
    s42.agg.add(`${Math.round(cx)},${Math.round(cy)}`)
    s42.particles = []
    s42.lastT = t
  }

  const agg = s42.agg!
  const maxParticles = Math.round(30 + M * 50)

  // Spawn particles
  while (s42.particles.length < maxParticles) {
    const angle = Math.random() * Math.PI * 2
    const r = Math.min(W, H) * 0.45
    s42.particles.push({
      x: cx + Math.cos(angle) * r,
      y: cy + Math.sin(angle) * r,
    })
  }

  // Walk particles
  const stepsPerFrame = Math.round(8 + B * 16)
  const radius = 3
  const newAgg: string[] = []

  for (let pi = s42.particles.length - 1; pi >= 0; pi--) {
    const p = s42.particles[pi]
    for (let step = 0; step < stepsPerFrame; step++) {
      p.x += (Math.random() - 0.5) * 4
      p.y += (Math.random() - 0.5) * 4

      const px2 = Math.round(p.x), py2 = Math.round(p.y)
      // Check neighbors
      let stuck = false
      for (let dy2 = -radius; dy2 <= radius && !stuck; dy2++) {
        for (let dx2 = -radius; dx2 <= radius && !stuck; dx2++) {
          if (agg.has(`${px2+dx2},${py2+dy2}`)) stuck = true
        }
      }
      if (stuck) {
        const key = `${px2},${py2}`
        agg.add(key)
        newAgg.push(key)
        s42.particles.splice(pi, 1)
        break
      }
      // Out of bounds → respawn
      if (p.x < 0 || p.x > W || p.y < 0 || p.y > H) {
        const angle2 = Math.random() * Math.PI * 2
        const r2 = Math.min(W, H) * 0.45
        p.x = cx + Math.cos(angle2) * r2
        p.y = cy + Math.sin(angle2) * r2
        break
      }
    }
  }

  // Limit aggregate size
  if (agg.size > 4000) {
    s42.agg = new Set<string>()
    s42.agg.add(`${Math.round(cx)},${Math.round(cy)}`)
    s42.particles = []
  }

  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, W, H)

  const hue = Hi
  agg.forEach(key => {
    const [ax, ay] = key.split(',').map(Number)
    const dx2 = ax - cx, dy2 = ay - cy
    const dist = Math.sqrt(dx2*dx2 + dy2*dy2)
    const maxR = Math.min(W, H) * 0.45
    const depthHue = (hue + (dist / maxR) * 160) % 360
    const light = 40 + (dist / maxR) * 40
    ctx.fillStyle = `hsl(${depthHue}, 85%, ${light}%)`
    ctx.fillRect(ax - 1.5, ay - 1.5, 3, 3)
  })

  // Particles (walkers)
  s42.particles.forEach(p => {
    ctx.beginPath()
    ctx.arc(p.x, p.y, 1.5, 0, Math.PI * 2)
    ctx.fillStyle = `hsla(${hue}, 60%, 80%, 0.35)`
    ctx.fill()
  })

  ctx.font = '11px Courier New'
  ctx.fillStyle = `hsla(${hue}, 80%, 70%, 0.7)`
  ctx.fillText('DLA BRANCHING', 14, 18)
  ctx.fillStyle = 'rgba(255,255,255,0.4)'
  ctx.fillText(`AGG ${agg.size}`, 14, 33)
}

// ─── 42: Van der Pol ──────────────────────────────────────────────────────────
export function drawVanDerPol(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  t: number,
  B: number,
  M: number,
  Hi: number,
  bh: number,
  mtz: number,
): void {
  ctx.fillStyle = 'rgba(0,0,0,0.12)'
  ctx.fillRect(0, 0, W, H)

  const hue = Hi
  const cx = W * 0.5
  const cy = H * 0.5
  const scx = W * 0.22
  const scy = H * 0.22

  // Multiple coupled oscillators with varying mu
  const nOsc = Math.round(4 + M * 8)
  for (let k = 0; k < nOsc; k++) {
    const mu = 0.5 + (k / nOsc) * 3.5 * (1 + B * 0.5) + mtz * 0.003
    const phase0 = (k / nOsc) * Math.PI * 2

    // Runge-Kutta integration from t=0 to t=t
    let x = 2 * Math.cos(phase0)
    let y = 2 * Math.sin(phase0)

    const dt2 = 0.04
    const nSteps = Math.round(t / dt2) % 800

    ctx.beginPath()
    ctx.moveTo(cx + x * scx, cy - y * scy)

    for (let i = 0; i < nSteps + 300; i++) {
      const f = (xx: number, yy: number) => [yy, mu*(1-xx*xx)*yy - xx]
      const [k1x, k1y] = f(x, y)
      const [k2x, k2y] = f(x + k1x*dt2/2, y + k1y*dt2/2)
      const [k3x, k3y] = f(x + k2x*dt2/2, y + k2y*dt2/2)
      const [k4x, k4y] = f(x + k3x*dt2, y + k3y*dt2)
      x += (k1x + 2*k2x + 2*k3x + k4x) * dt2 / 6
      y += (k1y + 2*k2y + 2*k3y + k4y) * dt2 / 6
      if (i >= nSteps) ctx.lineTo(cx + x * scx, cy - y * scy)
    }

    const oscHue = (hue + (k / nOsc) * 200) % 360
    const alpha = 0.6 - (k / nOsc) * 0.25
    ctx.strokeStyle = `hsla(${oscHue}, 90%, 65%, ${alpha})`
    ctx.lineWidth = 1.4
    ctx.stroke()
  }

  // Limit cycle marker
  ctx.beginPath()
  ctx.arc(cx, cy, scx * 1.95, 0, Math.PI * 2)
  ctx.strokeStyle = `hsla(${hue}, 60%, 55%, 0.18)`
  ctx.lineWidth = 0.7
  ctx.stroke()

  ctx.font = '11px Courier New'
  ctx.fillStyle = `hsla(${hue}, 80%, 70%, 0.7)`
  ctx.fillText('VAN DER POL', 14, 18)
  ctx.fillStyle = 'rgba(255,255,255,0.4)'
  ctx.fillText(`OSC ${nOsc}`, 14, 33)
}

// ─── Registry ─────────────────────────────────────────────────────────────────
export const B3_DRAWS: DrawFn[] = [
  drawPhasePortrait,   // 33
  drawGeodesicDome,    // 34
  drawDoubleSlit,      // 35
  drawVoronoiCrystal,  // 36
  drawPenroseTiling,   // 37
  drawSpinorField,     // 38
  drawRiemannSurface,  // 39
  drawPercolation,     // 40
  drawDLABranching,    // 41
  drawVanDerPol,       // 42
]
