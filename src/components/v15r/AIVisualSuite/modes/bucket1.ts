// @ts-nocheck
/**
 * bucket1.ts — B1 ORIGINALS draw functions (modes 0-22)
 * B48 — NEXUS Visual Suite Full Deploy
 */

export type DrawFn = (ctx: CanvasRenderingContext2D, W: number, H: number, t: number, B: number, M: number, Hi: number, bh: number, mtz: number) => void

export function drawOrbCore(ctx: CanvasRenderingContext2D, W: number, H: number, t: number, B: number, M: number, Hi: number, bh: number, mtz: number): void {
  const cx = W / 2, cy = H / 2, R = Math.min(W, H) * (0.18 + B * 0.08 + mtz * 0.12)
  // bg
  ctx.fillStyle = 'rgba(0,0,0,0.15)'
  ctx.fillRect(0, 0, W, H)
  // core glow
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 2.5)
  g.addColorStop(0, `hsla(${bh},100%,70%,0.8)`)
  g.addColorStop(0.4, `hsla(${bh},100%,50%,0.3)`)
  g.addColorStop(1, 'transparent')
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.arc(cx, cy, R * 2.5, 0, Math.PI * 2)
  ctx.fill()
  // corona
  const spikes = 24 + Math.round(mtz * 24)
  for (let i = 0; i < spikes; i++) {
    const a = i / spikes * Math.PI * 2 + t * 0.3
    const l = R * (0.6 + mtz * 0.8) + Math.abs(Math.sin(t * 2 + i * 1.3)) * R * (0.4 + B * 0.6)
    ctx.strokeStyle = `hsla(${(bh + i * 6) % 360},90%,70%,${0.5 + Hi * 0.4})`
    ctx.lineWidth = 1 + Hi * 1.5
    ctx.beginPath()
    ctx.moveTo(cx + Math.cos(a) * R * 0.9, cy + Math.sin(a) * R * 0.9)
    ctx.lineTo(cx + Math.cos(a) * l, cy + Math.sin(a) * l)
    ctx.stroke()
  }
  // core sphere
  const cg = ctx.createRadialGradient(cx, cy, 0, cx, cy, R)
  cg.addColorStop(0, `hsla(${bh},100%,90%,0.9)`)
  cg.addColorStop(1, `hsla(${bh},100%,50%,0.2)`)
  ctx.fillStyle = cg
  ctx.beginPath()
  ctx.arc(cx, cy, R, 0, Math.PI * 2)
  ctx.fill()
}

export function drawWaveTerrain(ctx: CanvasRenderingContext2D, W: number, H: number, t: number, B: number, M: number, Hi: number, bh: number, mtz: number): void {
  ctx.fillStyle = 'rgba(0,0,0,0.18)'
  ctx.fillRect(0, 0, W, H)
  const rows = 20, cols = 50, rowH = H * 0.55 / rows, startY = H * 0.2
  for (let r = rows - 1; r >= 0; r--) {
    const y = startY + r * rowH, persp = 0.4 + r / rows * 0.6
    ctx.beginPath()
    for (let c = 0; c <= cols; c++) {
      const px = c / cols * W
      const nx = px / W * 4 - 2
      const amp = H * 0.04 * (1 + B * 2 + mtz * 3) * (r / rows)
      const ht = Math.sin(nx * 3 + t * 1.2) * amp + Math.sin(nx * 5 - t * 0.8) * amp * 0.5
        + Math.sin(nx * 2 + t * 0.5 + r) * amp * 0.3
      const py = y - ht
      c === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)
    }
    ctx.strokeStyle = `hsla(${bh + r * 4},80%,${40 + r * 2}%,${0.3 + r / rows * 0.5})`
    ctx.lineWidth = 1 + r / rows
    ctx.stroke()
    if (mtz > 0.3) {
      for (let c = 0; c <= cols; c += 4) {
        const px = c / cols * W
        const amp = H * 0.04 * (1 + B * 2 + mtz * 3) * (r / rows)
        const ht = Math.sin(px / W * 4 * 3 + t * 1.2) * amp
        const pilH = ht * mtz * 2
        if (Math.abs(ht) > amp * 0.7) {
          ctx.strokeStyle = `hsla(${bh + 60},100%,80%,${mtz * 0.6})`
          ctx.lineWidth = 1
          ctx.beginPath()
          ctx.moveTo(px, y - ht)
          ctx.lineTo(px, y - ht - pilH)
          ctx.stroke()
          ctx.fillStyle = `hsla(${bh + 60},100%,90%,${mtz * 0.5})`
          ctx.beginPath()
          ctx.arc(px, y - ht - pilH, 2, 0, Math.PI * 2)
          ctx.fill()
        }
      }
    }
  }
}

export function draw3DSpiral(ctx: CanvasRenderingContext2D, W: number, H: number, t: number, B: number, M: number, Hi: number, bh: number, mtz: number): void {
  ctx.fillStyle = 'rgba(0,0,0,0.12)'
  ctx.fillRect(0, 0, W, H)
  const cx = W / 2, cy = H / 2
  const rings = 8 + Math.round(mtz * 16)
  const spin = t * (0.4 + mtz * 0.6)
  for (let i = 0; i < rings; i++) {
    const prog = i / rings
    const rx = Math.min(W, H) * (0.15 + prog * 0.3 + B * 0.08)
    const ry = rx * (0.35 + Math.abs(Math.sin(spin + prog * Math.PI)) * 0.45)
    const z = Math.sin(prog * Math.PI * 2 + spin)
    const alpha = 0.3 + z * 0.3 + M * 0.2
    ctx.strokeStyle = `hsla(${(bh + i * 15) % 360},90%,60%,${Math.max(0.05, alpha)})`
    ctx.lineWidth = 1 + z * 1.5
    ctx.beginPath()
    ctx.ellipse(cx, cy, rx, ry, spin + prog * 0.5, 0, Math.PI * 2)
    ctx.stroke()
  }
}

export function drawWireSphere(ctx: CanvasRenderingContext2D, W: number, H: number, t: number, B: number, M: number, Hi: number, bh: number, mtz: number): void {
  ctx.fillStyle = 'rgba(0,0,0,0.15)'
  ctx.fillRect(0, 0, W, H)
  const cx = W / 2, cy = H / 2, R = Math.min(W, H) * (0.35 + mtz * 0.1)
  const lines = 18 + Math.round(mtz * 14), tilt = t * 0.3
  for (let i = 0; i < lines; i++) {
    const lat = i / lines * Math.PI
    const ry = R * Math.sin(lat), y = cy + R * Math.cos(lat)
    ctx.strokeStyle = `hsla(${bh},70%,55%,0.4)`
    ctx.lineWidth = 0.8
    ctx.beginPath()
    ctx.ellipse(cx, y, ry, ry * 0.3, tilt, 0, Math.PI * 2)
    ctx.stroke()
  }
  for (let i = 0; i < lines; i++) {
    const lng = i / lines * Math.PI
    ctx.strokeStyle = `hsla(${bh + 30},70%,55%,0.35)`
    ctx.lineWidth = 0.8
    ctx.beginPath()
    ctx.ellipse(cx, cy, R, R * 0.3, lng + tilt, 0, Math.PI * 2)
    ctx.stroke()
  }
}

export function drawKaleidoscope(ctx: CanvasRenderingContext2D, W: number, H: number, t: number, B: number, M: number, Hi: number, bh: number, mtz: number): void {
  ctx.fillStyle = 'rgba(0,0,0,0.15)'
  ctx.fillRect(0, 0, W, H)
  const cx = W / 2, cy = H / 2
  const N = 6 + Math.round(mtz * 14), angle = t * 0.2 + M * 0.5
  const plen = Math.min(W, H) * (0.3 + B * 0.08)
  for (let i = 0; i < N; i++) {
    ctx.save()
    ctx.translate(cx, cy)
    ctx.rotate(i / N * Math.PI * 2 + angle)
    ctx.beginPath()
    ctx.moveTo(0, 0)
    ctx.bezierCurveTo(plen * 0.3, plen * -0.3, plen * 0.7, plen * -0.3, plen, 0)
    ctx.bezierCurveTo(plen * 0.7, plen * 0.3, plen * 0.3, plen * 0.3, 0, 0)
    ctx.fillStyle = `hsla(${(bh + i * 360 / N) % 360},80%,55%,0.4)`
    ctx.fill()
    if (mtz > 0.3) {
      const sub = 2 + Math.round(mtz * 3)
      for (let j = 1; j <= sub; j++) {
        const sf = 1 / j / 1.5
        ctx.save()
        ctx.translate(plen * (1 - sf), 0)
        ctx.scale(sf, sf)
        ctx.beginPath()
        ctx.moveTo(0, 0)
        ctx.bezierCurveTo(plen * 0.3, -plen * 0.3, plen * 0.7, -plen * 0.3, plen, 0)
        ctx.bezierCurveTo(plen * 0.7, plen * 0.3, plen * 0.3, plen * 0.3, 0, 0)
        ctx.fillStyle = `hsla(${(bh + i * 360 / N + j * 40) % 360},80%,65%,0.3)`
        ctx.fill()
        ctx.restore()
      }
    }
    ctx.restore()
  }
}

export function drawSpectrumBars(ctx: CanvasRenderingContext2D, W: number, H: number, t: number, B: number, M: number, Hi: number, bh: number, mtz: number): void {
  ctx.fillStyle = 'rgba(0,0,0,0.2)'
  ctx.fillRect(0, 0, W, H)
  const bars = 32, bw = W / bars * 0.7, gap = W / bars
  for (let i = 0; i < bars; i++) {
    const freq = i / bars
    const ht = (H * 0.06 + Math.abs(Math.sin(i * 0.5 + t * (1 + freq))) * H * 0.4 * (1 + B * 2)) * (1 + mtz * 3)
    const x = i * gap + (gap - bw) / 2, y = H * 0.8 - ht
    // shadows
    const shad = 1 + Math.round(mtz * 2)
    for (let s = shad; s > 0; s--) {
      ctx.fillStyle = `hsla(${(bh + i * 8) % 360},70%,35%,${0.15 / s})`
      ctx.fillRect(x + s * 4, y + s * 3, bw, ht)
    }
    // bar
    const g = ctx.createLinearGradient(0, y, 0, y + ht)
    g.addColorStop(0, `hsla(${(bh + i * 8) % 360},100%,70%,0.95)`)
    g.addColorStop(1, `hsla(${(bh + i * 8 + 40) % 360},80%,40%,0.6)`)
    ctx.fillStyle = g
    ctx.fillRect(x, y, bw, ht)
    // cap
    ctx.fillStyle = `hsla(${(bh + i * 8) % 360},100%,80%,0.9)`
    ctx.fillRect(x, y - 3, bw, 3)
  }
}

export function drawPlexusArc(ctx: CanvasRenderingContext2D, W: number, H: number, t: number, B: number, M: number, Hi: number, bh: number, mtz: number): void {
  ctx.fillStyle = 'rgba(0,0,0,0.14)'
  ctx.fillRect(0, 0, W, H)
  const cx = W / 2, cy = H / 2
  const nodeCount = 40 + Math.round(mtz * 40)
  // stable positions via deterministic seed
  const nodes = Array.from({ length: nodeCount }, (_, i) => {
    const seed = i * 2.399963
    const r = Math.min(W, H) * (0.1 + ((i * 0.618) % 1) * 0.4)
    const a = seed * 2.399963 + t * (0.05 + i * 0.002)
    return { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r * 0.6 }
  })
  const thresh = Math.min(W, H) * 0.25
  nodes.forEach((a, i) => {
    nodes.forEach((b, j) => {
      if (j <= i) return
      const dx = a.x - b.x, dy = a.y - b.y, d = Math.sqrt(dx * dx + dy * dy)
      if (d < thresh) {
        ctx.strokeStyle = `hsla(${bh},70%,60%,${(1 - d / thresh) * 0.4})`
        ctx.lineWidth = 0.8
        ctx.beginPath()
        ctx.moveTo(a.x, a.y)
        ctx.lineTo(b.x, b.y)
        ctx.stroke()
      }
    })
    ctx.fillStyle = `hsla(${bh + i * 5},80%,65%,0.8)`
    ctx.beginPath()
    ctx.arc(a.x, a.y, 2 + B * 2, 0, Math.PI * 2)
    ctx.fill()
  })
}

export function drawSolarFlare(ctx: CanvasRenderingContext2D, W: number, H: number, t: number, B: number, M: number, Hi: number, bh: number, mtz: number): void {
  ctx.fillStyle = 'rgba(0,0,0,0.18)'
  ctx.fillRect(0, 0, W, H)
  const cx = W / 2, cy = H / 2, SR = Math.min(W, H) * 0.12
  // corona
  const cg = ctx.createRadialGradient(cx, cy, SR * 0.5, cx, cy, SR * 3)
  cg.addColorStop(0, `hsla(${bh + 40},100%,80%,0.8)`)
  cg.addColorStop(0.4, `hsla(${bh + 20},100%,60%,0.3)`)
  cg.addColorStop(1, 'transparent')
  ctx.fillStyle = cg
  ctx.beginPath()
  ctx.arc(cx, cy, SR * 3, 0, Math.PI * 2)
  ctx.fill()
  // sun
  const sg = ctx.createRadialGradient(cx, cy, 0, cx, cy, SR)
  sg.addColorStop(0, `hsla(${bh + 50},100%,95%,1)`)
  sg.addColorStop(1, `hsla(${bh + 30},100%,65%,0.9)`)
  ctx.fillStyle = sg
  ctx.beginPath()
  ctx.arc(cx, cy, SR, 0, Math.PI * 2)
  ctx.fill()
  // flares
  const flares = 5 + Math.round(mtz * 8)
  for (let i = 0; i < flares; i++) {
    const a = i / flares * Math.PI * 2 + t * 0.1
    const fl = Math.min(W, H) * (0.2 + mtz * 0.3) + Math.abs(Math.sin(t + i)) * Math.min(W, H) * 0.1
    const cp1x = cx + Math.cos(a + 0.5) * fl * 0.6, cp1y = cy + Math.sin(a + 0.5) * fl * 0.6
    const cp2x = cx + Math.cos(a - 0.5) * fl * 0.6, cp2y = cy + Math.sin(a - 0.5) * fl * 0.6
    const ex = cx + Math.cos(a) * fl, ey = cy + Math.sin(a) * fl
    ctx.strokeStyle = `hsla(${bh + 20},100%,65%,${0.4 + B * 0.4})`
    ctx.lineWidth = 2 + B * 2
    ctx.beginPath()
    ctx.moveTo(cx + Math.cos(a) * SR, cy + Math.sin(a) * SR)
    ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, ex, ey)
    ctx.stroke()
  }
}

export function drawDNAHelix(ctx: CanvasRenderingContext2D, W: number, H: number, t: number, B: number, M: number, Hi: number, bh: number, mtz: number): void {
  ctx.fillStyle = 'rgba(0,0,0,0.15)'
  ctx.fillRect(0, 0, W, H)
  const cx = W / 2, amp = W * 0.15 + M * 30, freq = 0.035 + Hi * 0.015
  const strands = 2 + Math.round(mtz * 4)
  for (let s = 0; s < strands; s++) {
    const phase = s * Math.PI * 2 / strands + t * 0.5
    ctx.strokeStyle = `hsla(${(bh + s * 120) % 360},90%,60%,0.8)`
    ctx.lineWidth = 2
    ctx.beginPath()
    for (let py = 0; py <= H; py += 4) {
      const x = cx + Math.sin(py * freq + phase) * amp
      py === 0 ? ctx.moveTo(x, py) : ctx.lineTo(x, py)
    }
    ctx.stroke()
  }
  // rungs
  for (let py = 0; py <= H; py += 20) {
    const x1 = cx + Math.sin(py * freq + t * 0.5) * amp
    const x2 = cx + Math.sin(py * freq + t * 0.5 + Math.PI) * amp
    ctx.strokeStyle = `hsla(${bh + 60},70%,70%,0.4)`
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(x1, py)
    ctx.lineTo(x2, py)
    ctx.stroke()
    ctx.fillStyle = `hsla(${bh + 60},100%,80%,0.6)`
    ctx.beginPath()
    ctx.arc(x1, py, 3, 0, Math.PI * 2)
    ctx.fill()
    ctx.beginPath()
    ctx.arc(x2, py, 3, 0, Math.PI * 2)
    ctx.fill()
  }
}

export function drawBlackHole(ctx: CanvasRenderingContext2D, W: number, H: number, t: number, B: number, M: number, Hi: number, bh: number, mtz: number): void {
  ctx.fillStyle = 'rgba(0,0,2,0.2)'
  ctx.fillRect(0, 0, W, H)
  const cx = W / 2, cy = H / 2, EH = Math.min(W, H) * 0.08
  ctx.fillStyle = '#000'
  ctx.beginPath()
  ctx.arc(cx, cy, EH, 0, Math.PI * 2)
  ctx.fill()
  // photon sphere
  const pg = ctx.createRadialGradient(cx, cy, EH, cx, cy, EH * 1.8)
  pg.addColorStop(0, `hsla(${bh + 40},100%,80%,0.9)`)
  pg.addColorStop(1, 'transparent')
  ctx.fillStyle = pg
  ctx.beginPath()
  ctx.arc(cx, cy, EH * 1.8, 0, Math.PI * 2)
  ctx.fill()
  // accretion rings
  const rings = 6 + Math.round(mtz * 6)
  for (let i = 0; i < rings; i++) {
    const rr = EH * (2 + i * 0.8)
    ctx.strokeStyle = `hsla(${(bh + i * 15) % 360},100%,${55 + i * 3}%,${0.6 - i * 0.06})`
    ctx.lineWidth = 3 - i * 0.3
    ctx.beginPath()
    ctx.ellipse(cx, cy, rr, rr * 0.25, 0, 0, Math.PI * 2)
    ctx.stroke()
  }
  // jets
  const jl = Math.min(H, W) * (0.3 + mtz * 0.3 + B * 0.1)
  ctx.strokeStyle = `hsla(${bh + 200},80%,70%,0.5)`
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(cx, cy - EH)
  ctx.lineTo(cx, cy - jl)
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(cx, cy + EH)
  ctx.lineTo(cx, cy + jl)
  ctx.stroke()
}

export function drawLightning(ctx: CanvasRenderingContext2D, W: number, H: number, t: number, B: number, M: number, Hi: number, bh: number, mtz: number): void {
  ctx.fillStyle = 'rgba(0,0,0,0.25)'
  ctx.fillRect(0, 0, W, H)
  const strikes = 2 + Math.round(mtz * 6)
  function bolt(x1: number, y1: number, x2: number, y2: number, depth: number) {
    if (depth <= 0) {
      ctx.beginPath()
      ctx.moveTo(x1, y1)
      ctx.lineTo(x2, y2)
      ctx.stroke()
      return
    }
    const mx = (x1 + x2) / 2 + (Math.random() - 0.5) * 60, my = (y1 + y2) / 2 + (Math.random() - 0.5) * 30
    bolt(x1, y1, mx, my, depth - 1)
    bolt(mx, my, x2, y2, depth - 1)
    if (Math.random() < 0.3) {
      bolt(mx, my, mx + (Math.random() - 0.5) * 100, my + Math.random() * 80, depth - 2)
    }
  }
  for (let s = 0; s < strikes; s++) {
    const x = W * 0.2 + Math.random() * W * 0.6
    ctx.strokeStyle = `hsla(${bh + 200},60%,95%,0.8)`
    ctx.lineWidth = 2
    bolt(x, 0, x + (Math.random() - 0.5) * W * 0.3, H, 2 + Math.round(mtz * 3))
  }
}

export function drawWormhole(ctx: CanvasRenderingContext2D, W: number, H: number, t: number, B: number, M: number, Hi: number, bh: number, mtz: number): void {
  ctx.fillStyle = 'rgba(0,0,0,0.1)'
  ctx.fillRect(0, 0, W, H)
  const cx = W / 2, cy = H / 2
  const rcount = 20 + Math.round(mtz * 20)
  const speed = 0.3 + mtz * 0.5
  const phase = (t * speed) % 1
  for (let i = 0; i < rcount; i++) {
    const p = ((i / rcount + phase) % 1)
    const rx = Math.min(W, H) * (0.05 + p * 0.45), ry = rx * (0.2 + p * 0.3)
    const alpha = p * (0.8 - p * 0.5)
    ctx.strokeStyle = `hsla(${(bh + i * 8) % 360},80%,55%,${alpha})`
    ctx.lineWidth = 1 + p * 2
    ctx.beginPath()
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2)
    ctx.stroke()
  }
}

export function drawCymatics(ctx: CanvasRenderingContext2D, W: number, H: number, t: number, B: number, M: number, Hi: number, bh: number, mtz: number): void {
  ctx.fillStyle = 'rgba(0,0,0,0.2)'
  ctx.fillRect(0, 0, W, H)
  const fx = 3 + Math.round(M * 3 + mtz * 5), fy = 4 + Math.round(M * 2 + mtz * 4)
  const fx2 = 2 + Math.round(Hi), fy2 = 5 + Math.round(mtz * 2)
  const step = 4, thresh = 0.15 + B * 0.1
  for (let px = 0; px < W; px += step) {
    for (let py = 0; py < H; py += step) {
      const nx = px / W, ny = py / H
      const v = Math.sin(nx * fx * Math.PI) * Math.sin(ny * fy * Math.PI)
        + Math.sin(nx * fx2 * Math.PI + t) * Math.sin(ny * fy2 * Math.PI + t * 0.7)
      if (Math.abs(v) < thresh) {
        const alpha = (thresh - Math.abs(v)) / thresh
        ctx.fillStyle = `hsla(${bh},80%,60%,${alpha * 0.9})`
        ctx.fillRect(px, py, step, step)
      }
    }
  }
}

export function drawLavaLamp(ctx: CanvasRenderingContext2D, W: number, H: number, t: number, B: number, M: number, Hi: number, bh: number, mtz: number): void {
  ctx.fillStyle = 'rgba(5,0,10,0.15)'
  ctx.fillRect(0, 0, W, H)
  const blobs = 5 + Math.round(mtz * 3), prev = ctx.globalCompositeOperation
  ctx.globalCompositeOperation = 'screen'
  for (let i = 0; i < blobs; i++) {
    const seed = i * 1.7 + 1
    const bx = W / 2 + Math.sin(seed * 2.1 + t * (0.3 + i * 0.05)) * W * 0.3
    const by = H / 2 + Math.cos(seed * 1.7 + t * (0.25 + i * 0.04)) * H * 0.3
    const br = 50 + M * 30 + mtz * 30 + B * 20
    const g = ctx.createRadialGradient(bx, by, 0, bx, by, br)
    g.addColorStop(0, `hsla(${(bh + i * 40) % 360},90%,60%,0.6)`)
    g.addColorStop(1, 'transparent')
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(bx, by, br, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.globalCompositeOperation = prev
}

export function drawCrystal(ctx: CanvasRenderingContext2D, W: number, H: number, t: number, B: number, M: number, Hi: number, bh: number, mtz: number): void {
  ctx.fillStyle = 'rgba(0,0,0,0.18)'
  ctx.fillRect(0, 0, W, H)
  const cx = W / 2, cy = H / 2, rot = t * 0.15
  function face(ax: number, ay: number, bx: number, by: number, color: string) {
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.moveTo(cx, cy)
    ctx.lineTo(ax, ay)
    ctx.lineTo(bx, by)
    ctx.closePath()
    ctx.fill()
    ctx.strokeStyle = 'rgba(255,255,255,0.3)'
    ctx.lineWidth = 0.5
    ctx.stroke()
  }
  const R = Math.min(W, H) * (0.3 + B * 0.05)
  const faces = 6 + Math.round(mtz * 2)
  for (let i = 0; i < faces; i++) {
    const a1 = i / faces * Math.PI * 2 + rot, a2 = (i + 1) / faces * Math.PI * 2 + rot
    const x1 = cx + Math.cos(a1) * R, y1 = cy + Math.sin(a1) * R
    const x2 = cx + Math.cos(a2) * R, y2 = cy + Math.sin(a2) * R
    face(x1, y1, x2, y2, `hsla(${(bh + i * 360 / faces) % 360},70%,${40 + i * 5}%,0.6)`)
    if (mtz > 0.3) {
      const depth = 1 + Math.round(mtz * 2)
      for (let d = 1; d <= depth; d++) {
        const sf = 0.5 / d, midx = (x1 + x2) / 2, midy = (y1 + y2) / 2
        face(cx + (midx - cx) * sf, cy + (midy - cy) * sf, cx + (x1 - cx) * sf, cy + (y1 - cy) * sf,
          `hsla(${(bh + i * 360 / faces + d * 30) % 360},60%,${50 + d * 10}%,0.4)`)
      }
    }
  }
}

export function drawBlueprint(ctx: CanvasRenderingContext2D, W: number, H: number, t: number, B: number, M: number, Hi: number, bh: number, mtz: number): void {
  ctx.fillStyle = 'rgba(0,5,20,0.9)'
  ctx.fillRect(0, 0, W, H)
  // grid
  ctx.strokeStyle = 'rgba(0,100,200,0.15)'
  ctx.lineWidth = 0.5
  for (let x = 0; x < W; x += 20) {
    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.lineTo(x, H)
    ctx.stroke()
  }
  for (let y = 0; y < H; y += 20) {
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(W, y)
    ctx.stroke()
  }
  // bus bars
  const buses = 3, busY = [H * 0.3, H * 0.5, H * 0.7]
  busY.forEach((y, i) => {
    ctx.strokeStyle = `hsla(${bh + 200 + i * 20},80%,60%,0.6)`
    ctx.lineWidth = 2 + i
    ctx.beginPath()
    ctx.moveTo(W * 0.1, y)
    ctx.lineTo(W * 0.9, y)
    ctx.stroke()
  })
  // branches
  const branchCount = 4 + Math.round(mtz * 4)
  for (let i = 0; i <= branchCount; i++) {
    const x = W * 0.15 + i * (W * 0.75 / branchCount)
    ctx.strokeStyle = `hsla(${bh + 200},60%,50%,0.4)`
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(x, busY[0])
    ctx.lineTo(x, busY[2])
    ctx.stroke()
    ctx.strokeStyle = `hsla(${bh + 200},80%,70%,0.4)`
    ctx.lineWidth = 5
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.moveTo(x, busY[1] - 8)
    ctx.lineTo(x, busY[1] + 8)
    ctx.stroke()
  }
  // voltage wave
  const wy = H * 0.5, wamp = 20 + B * 30
  ctx.strokeStyle = `hsla(${bh + 200},100%,80%,0.7)`
  ctx.lineWidth = 1.5
  ctx.lineCap = 'butt'
  ctx.beginPath()
  for (let x = 0; x <= W; x += 2) {
    const v = wy + Math.sin(x / W * Math.PI * 6 * (1 + mtz) + t * 3) * wamp * (1 + mtz)
    x === 0 ? ctx.moveTo(x, v) : ctx.lineTo(x, v)
  }
  ctx.stroke()
}

export function drawVoltage(ctx: CanvasRenderingContext2D, W: number, H: number, t: number, B: number, M: number, Hi: number, bh: number, mtz: number): void {
  ctx.fillStyle = 'rgba(0,0,0,0.2)'
  ctx.fillRect(0, 0, W, H)
  const phases = [{ c: `hsla(60,100%,55%,0.8)`, y: H * 0.3, off: 0 },
  { c: `hsla(180,100%,60%,0.8)`, y: H * 0.5, off: Math.PI * 2 / 3 },
  { c: `hsla(300,100%,65%,0.8)`, y: H * 0.7, off: Math.PI * 4 / 3 }]
  phases.forEach(p => {
    ctx.strokeStyle = p.c
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.moveTo(W * 0.05, p.y)
    ctx.lineTo(W * 0.95, p.y)
    ctx.stroke()
    ctx.lineWidth = 1.5
    ctx.beginPath()
    for (let x = 0; x < W; x += 3) {
      const v = p.y + Math.sin(x / W * Math.PI * 8 + t * 2 + p.off) * 20 * (1 + B)
      x === 0 ? ctx.moveTo(x, v) : ctx.lineTo(x, v)
    }
    ctx.stroke()
  })
  const arcCount = Math.floor(mtz * 3 + B * 2)
  for (let i = 0; i < arcCount; i++) {
    const ax = W * (0.2 + Math.random() * 0.6)
    ctx.strokeStyle = `hsla(60,100%,90%,0.8)`
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(ax, phases[0].y)
    ctx.bezierCurveTo(ax + (Math.random() - 0.5) * 40, H * 0.35, ax + (Math.random() - 0.5) * 40, H * 0.45, ax, phases[1].y)
    ctx.stroke()
  }
}

export function drawHustleGrid(ctx: CanvasRenderingContext2D, W: number, H: number, t: number, B: number, M: number, Hi: number, bh: number, mtz: number): void {
  ctx.fillStyle = 'rgba(5,5,10,0.9)'
  ctx.fillRect(0, 0, W, H)
  const labels = ['LEADS', 'EST', 'JOBS', 'REV', 'CREW', 'MTL', 'HR', 'NET'], bars = 8
  const bw = W * 0.08, gap = W / bars
  for (let i = 0; i < bars; i++) {
    const speed = 0.5 + i * 0.1
    const ht = (H * 0.15 + Math.abs(Math.sin(t * speed + i)) * H * 0.45 * (1 + B)) * (1 + mtz)
    const x = i * gap + (gap - bw) / 2, y = H * 0.88 - ht
    const g = ctx.createLinearGradient(0, y, 0, y + ht)
    g.addColorStop(0, `hsla(${(bh + i * 25) % 360},80%,55%,0.9)`)
    g.addColorStop(1, `hsla(${(bh + i * 25 + 30) % 360},60%,30%,0.5)`)
    ctx.fillStyle = g
    ctx.fillRect(x, y, bw, ht)
    ctx.fillStyle = 'rgba(255,255,255,0.5)'
    ctx.font = '8px monospace'
    ctx.textAlign = 'center'
    ctx.fillText(labels[i], x + bw / 2, H * 0.93)
  }
  const pCount = 30 + Math.round(mtz * 50)
  for (let i = 0; i < pCount; i++) {
    const px = ((t * 80 + i * (W / pCount)) % W)
    ctx.fillStyle = `hsla(${bh + i * 10},80%,65%,0.7)`
    ctx.beginPath()
    ctx.arc(px, H * 0.1, 2, 0, Math.PI * 2)
    ctx.fill()
  }
}

export function drawDesertStorm(ctx: CanvasRenderingContext2D, W: number, H: number, t: number, B: number, M: number, Hi: number, bh: number, mtz: number): void {
  const skyG = ctx.createLinearGradient(0, 0, 0, H)
  skyG.addColorStop(0, 'hsl(25,80%,12%)')
  skyG.addColorStop(1, 'hsl(20,80%,35%)')
  ctx.fillStyle = skyG
  ctx.fillRect(0, 0, W, H)
  const cx = W / 2, sy = H * 0.38, sr = Math.min(W, H) * (0.1 + mtz * 0.06 + B * 0.03)
  const sg = ctx.createRadialGradient(cx, sy, sr * 0.2, cx, sy, sr * 2.5)
  sg.addColorStop(0, 'hsla(40,100%,70%,0.9)')
  sg.addColorStop(0.4, 'hsla(25,90%,50%,0.5)')
  sg.addColorStop(1, 'transparent')
  ctx.fillStyle = sg
  ctx.beginPath()
  ctx.arc(cx, sy, sr * 2.5, 0, Math.PI * 2)
  ctx.fill()
  const sg2 = ctx.createRadialGradient(cx, sy, 0, cx, sy, sr)
  sg2.addColorStop(0, 'hsla(50,100%,80%,1)')
  sg2.addColorStop(1, 'hsla(30,100%,60%,0.9)')
  ctx.fillStyle = sg2
  ctx.beginPath()
  ctx.arc(cx, sy, sr, 0, Math.PI * 2)
  ctx.fill()
  for (let d = 0; d < 3; d++) {
    const dy = H * (0.65 + d * 0.12)
    ctx.fillStyle = `hsl(30,50%,${18 - d * 4}%)`
    ctx.beginPath()
    ctx.moveTo(0, H)
    for (let x = 0; x <= W; x += 20) {
      ctx.lineTo(x, dy + Math.sin(x / W * Math.PI * 4) * H * 0.04 * (1 + d))
    }
    ctx.lineTo(W, H)
    ctx.closePath()
    ctx.fill()
  }
  const dustCount = 60 + Math.round(mtz * 80)
  for (let i = 0; i < dustCount; i++) {
    const dp = ((i / dustCount + t * 0.05) % 1)
    const dx = dp * W * 1.2 - W * 0.1, dy = H * (0.4 + i / dustCount * 0.5)
    ctx.fillStyle = `hsla(30,60%,60%,${0.1 + Hi * 0.2})`
    ctx.beginPath()
    ctx.arc(dx, dy, 1 + Math.random() * 2, 0, Math.PI * 2)
    ctx.fill()
  }
}

export function drawNEXUSMind(ctx: CanvasRenderingContext2D, W: number, H: number, t: number, B: number, M: number, Hi: number, bh: number, mtz: number): void {
  ctx.fillStyle = 'rgba(0,0,0,0.18)'
  ctx.fillRect(0, 0, W, H)
  const cx = W / 2, cy = H / 2
  const cg = ctx.createRadialGradient(cx, cy, 0, cx, cy, 18)
  cg.addColorStop(0, `hsla(${bh},100%,90%,1)`)
  cg.addColorStop(1, `hsla(${bh},100%,50%,0.2)`)
  ctx.fillStyle = cg
  ctx.beginPath()
  ctx.arc(cx, cy, 18, 0, Math.PI * 2)
  ctx.fill()
  const agents = 11
  for (let i = 0; i < agents; i++) {
    const baseR = Math.min(W, H) * (0.1 + i * 0.024)
    const speed = (0.2 + i * 0.04) * (1 + mtz * 2)
    const ax = cx + Math.cos(t * speed + i * Math.PI * 2 / agents) * baseR
    const ay = cy + Math.sin(t * speed + i * Math.PI * 2 / agents) * baseR * 0.6
    ctx.strokeStyle = `hsla(${(bh + i * 20) % 360},50%,40%,0.3)`
    ctx.lineWidth = 0.8
    ctx.beginPath()
    ctx.moveTo(cx, cy)
    ctx.lineTo(ax, ay)
    ctx.stroke()
    ctx.fillStyle = `hsla(${(bh + i * 20) % 360},90%,65%,0.9)`
    ctx.beginPath()
    ctx.arc(ax, ay, 4 + B * 3, 0, Math.PI * 2)
    ctx.fill()
  }
  const pulseCount = 2 + Math.round(mtz * 4)
  for (let p = 0; p < pulseCount; p++) {
    const pr = ((t * 0.2 + p / pulseCount) % 1) * Math.min(W, H) * 0.5
    ctx.strokeStyle = `hsla(${bh},80%,55%,${1 - pr / Math.min(W, H) * 2})`
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.arc(cx, cy, pr, 0, Math.PI * 2)
    ctx.stroke()
  }
}

export function drawEmpireFall(ctx: CanvasRenderingContext2D, W: number, H: number, t: number, B: number, M: number, Hi: number, bh: number, mtz: number): void {
  ctx.fillStyle = 'rgba(0,0,5,0.2)'
  ctx.fillRect(0, 0, W, H)
  for (let i = 0; i < 80; i++) {
    const sx = ((i * 137.5) % W), sy = H * 0.05 + ((i * 73.1) % (H * 0.4))
    ctx.fillStyle = `rgba(255,255,255,${0.2 + Math.sin(t * 0.5 + i) * 0.3})`
    ctx.fillRect(sx, sy, 1, 1)
  }
  const pillars = 5
  for (let i = 0; i < pillars; i++) {
    const px = W * 0.1 + i * W * 0.18, pw = W * 0.06, ph = H * (0.35 + mtz * 0.1)
    const lean = Math.sin(t * 0.1 + i) * mtz * 0.2
    ctx.save()
    ctx.translate(px + pw / 2, H)
    ctx.rotate(lean)
    ctx.fillStyle = `hsl(30,10%,${30 + i * 4}%)`
    ctx.fillRect(-pw / 2, -ph, pw, ph)
    ctx.strokeStyle = `hsla(${bh},40%,50%,${mtz * 0.6})`
    ctx.lineWidth = 1
    for (let c = 0; c < Math.round(1 + mtz * 4); c++) {
      const cy2 = Math.random() * ph
      ctx.beginPath()
      ctx.moveTo(-pw / 2 + Math.random() * pw * 0.3, -cy2)
      ctx.lineTo(Math.random() * pw * 0.3, -(cy2 + Math.random() * 20))
      ctx.stroke()
    }
    ctx.restore()
    for (let d = 0; d < Math.round(mtz * 10); d++) {
      const dx = px + Math.random() * pw, dy = H - Math.random() * H * 0.3
      ctx.fillStyle = `hsla(30,30%,40%,0.6)`
      ctx.beginPath()
      ctx.arc(dx, dy, 2, 0, Math.PI * 2)
      ctx.fill()
    }
  }
}

export function drawInfiniteLoop(ctx: CanvasRenderingContext2D, W: number, H: number, t: number, B: number, M: number, Hi: number, bh: number, mtz: number): void {
  ctx.fillStyle = 'rgba(0,0,0,0.15)'
  ctx.fillRect(0, 0, W, H)
  const cx = W / 2, cy = H / 2, phi = 1.618033
  const rot = t * (0.15 + mtz * 0.3), layers = 3 + Math.round(mtz * 3)
  ctx.save()
  ctx.translate(cx, cy)
  ctx.rotate(rot)
  let a = Math.min(W, H) * 0.04
  for (let i = 0; i < 12 * layers; i++) {
    const R = a * phi
    const startA = (Math.floor(i / 4)) * Math.PI / 2
    ctx.strokeStyle = `hsla(${(bh + i * 15) % 360},80%,55%,0.7)`
    ctx.lineWidth = 1 + i / 20
    ctx.beginPath()
    ctx.arc(a * (i % 4 < 2 ? phi / 2 : -phi / 2) * (i < 4 * layers ? 1 : 1),
      a * (i % 4 < 2 && i % 4 > 0 ? phi / 2 : i % 4 === 3 ? -phi / 2 : 0), R, startA, startA + Math.PI / 2)
    ctx.stroke()
    if (i % 4 === 3) a *= phi
  }
  ctx.restore()
}

export function drawIronWill(ctx: CanvasRenderingContext2D, W: number, H: number, t: number, B: number, M: number, Hi: number, bh: number, mtz: number): void {
  ctx.fillStyle = 'rgba(0,0,0,0.2)'
  ctx.fillRect(0, 0, W, H)
  const cy = H / 2, period = 2, phase = (t % period) / period
  // flat line
  ctx.strokeStyle = `hsla(${bh + 120},100%,55%,0.5)`
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(0, cy)
  ctx.lineTo(W, cy)
  ctx.stroke()
  // EKG
  ctx.strokeStyle = `hsla(${bh + 120},100%,${50 + B * 30}%,0.9)`
  ctx.lineWidth = 2
  ctx.beginPath()
  for (let px = 0; px < W; px += 2) {
    const x = (px / W + phase) % 1
    let y = cy
    if (x > 0.3 && x < 0.35) y = cy - H * 0.05
    else if (x >= 0.35 && x < 0.38) y = cy + H * 0.08
    else if (x >= 0.38 && x < 0.42) y = cy - (H * (0.35 + mtz * 0.25) * (1 + B * 0.5))
    else if (x >= 0.42 && x < 0.46) y = cy + H * 0.05
    else if (x >= 0.46 && x < 0.52) y = cy - H * 0.04
    px === 0 ? ctx.moveTo(px, y) : ctx.lineTo(px, y)
  }
  ctx.stroke()
  // shockwaves at peak
  if (phase > 0.38 && phase < 0.44) {
    const peakX = W * 0.4, shocks = 2 + Math.round(mtz * 6)
    for (let s = 0; s < shocks; s++) {
      const sr = (phase - 0.38) * W * (s + 1) * 0.3
      ctx.strokeStyle = `hsla(${bh + 120},100%,70%,${0.5 - s * 0.1})`
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.arc(peakX, cy, sr, 0, Math.PI * 2)
      ctx.stroke()
    }
  }
}

export const B1_DRAWS: DrawFn[] = [
  drawOrbCore, drawWaveTerrain, draw3DSpiral, drawWireSphere, drawKaleidoscope,
  drawSpectrumBars, drawPlexusArc, drawSolarFlare, drawDNAHelix, drawBlackHole,
  drawLightning, drawWormhole, drawCymatics, drawLavaLamp, drawCrystal,
  drawBlueprint, drawVoltage, drawHustleGrid, drawDesertStorm, drawNEXUSMind,
  drawEmpireFall, drawInfiniteLoop, drawIronWill,
]
