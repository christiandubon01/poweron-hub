// @ts-nocheck
/**
 * draws_1_12.ts — B1 ORIGINALS modes 1-12
 * B48 — NEXUS Visual Suite Full Deploy
 */

export type DrawFn = (ctx: CanvasRenderingContext2D, W: number, H: number, t: number, B: number, M: number, Hi: number, bh: number, mtz: number) => void

const PI = Math.PI
const TWO_PI = PI * 2

export const drawOrbCore: DrawFn = (ctx, W, H, t, B, M, Hi, bh, mtz) => {
  ctx.fillStyle = 'rgba(0,0,0,0.15)'
  ctx.fillRect(0, 0, W, H)
  const cx = W / 2, cy = H / 2
  const R = Math.min(W, H) * 0.18 + B * 40 + mtz * 60
  const grd = ctx.createRadialGradient(cx, cy, 0, cx, cy, R)
  grd.addColorStop(0, `hsl(${bh},100%,80%)`)
  grd.addColorStop(1, `hsl(${bh + 30},100%,40%)`)
  ctx.fillStyle = grd
  ctx.beginPath()
  ctx.arc(cx, cy, R, 0, TWO_PI)
  ctx.fill()
  const spikes = 24 + Math.round(mtz * 24)
  for (let i = 0; i < spikes; i++) {
    const ang = i / spikes * TWO_PI
    const slen = R * 0.4 + M * 30 + mtz * R * 0.6 + Math.sin(t + i) * R * 0.2
    const x1 = cx + R * Math.cos(ang), y1 = cy + R * Math.sin(ang)
    const x2 = cx + (R + slen) * Math.cos(ang), y2 = cy + (R + slen) * Math.sin(ang)
    ctx.strokeStyle = `hsl(${bh + i * 5},100%,70%)`
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(x1, y1)
    ctx.lineTo(x2, y2)
    ctx.stroke()
  }
  const ogrd = ctx.createRadialGradient(cx, cy, R, cx, cy, Math.min(W, H) * 0.45)
  ogrd.addColorStop(0, `hsla(${bh},100%,50%,0.3)`)
  ogrd.addColorStop(1, `hsla(${bh},100%,50%,0)`)
  ctx.fillStyle = ogrd
  ctx.beginPath()
  ctx.arc(cx, cy, Math.min(W, H) * 0.45, 0, TWO_PI)
  ctx.fill()
}

export const drawWaveTerrain: DrawFn = (ctx, W, H, t, B, M, Hi, bh, mtz) => {
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, W, H)
  const rows = 40, cols = 60
  const freq = 0.15 + M * 0.2, freq2 = 0.08
  const amp = H * 0.06 + B * H * 0.08 + mtz * H * 0.15
  const amp2 = amp * 0.6
  const rowH = H / rows
  for (let r = 0; r < rows; r++) {
    ctx.strokeStyle = `hsla(${bh + r * 3},80%,${50 + Math.min(r, 50)},${0.4 + r / rows * 0.4})`
    ctx.lineWidth = 1
    ctx.beginPath()
    for (let c = 0; c < cols; c++) {
      const x = W / cols * c
      const wv = Math.sin(x * freq + t) * amp + Math.sin(x * freq2 - t * 1.3) * amp2
      const y = rowH * r + wv + r * 2
      if (c === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.stroke()
  }
}

export const draw3DSpiral: DrawFn = (ctx, W, H, t, B, M, Hi, bh, mtz) => {
  ctx.fillStyle = 'rgba(0,0,0,0.12)'
  ctx.fillRect(0, 0, W, H)
  const cx = W / 2, cy = H / 2
  const rings = 8 + Math.round(mtz * 16)
  for (let i = 0; i < rings; i++) {
    const angle = t * (0.4 + mtz * 0.6) + i * 0.2
    const r = Math.min(W, H) * 0.25 * (1 - i / rings * 0.6)
    const ellipse_h = r * (1 - (i / rings) * 0.3)
    ctx.strokeStyle = `hsl(${bh + i * 15},90%,60%)`
    ctx.lineWidth = 1.5
    ctx.save()
    ctx.translate(cx, cy)
    ctx.rotate(angle)
    ctx.beginPath()
    ctx.ellipse(0, 0, r, ellipse_h, 0, 0, TWO_PI)
    ctx.stroke()
    ctx.restore()
  }
}

export const drawWireSphere: DrawFn = (ctx, W, H, t, B, M, Hi, bh, mtz) => {
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, W, H)
  const cx = W / 2, cy = H / 2
  const r = Math.min(W, H) * 0.35 + mtz * Math.min(W, H) * 0.1
  const lats = 18 + Math.round(mtz * 6)
  const lngs = 18 + Math.round(mtz * 6)
  ctx.strokeStyle = `hsla(${bh},70%,55%,0.5)`
  ctx.lineWidth = 1
  for (let lat = 1; lat < lats; lat++) {
    const phi = (lat / lats) * PI
    const y = cy - Math.cos(phi) * r
    const rx = r * Math.sin(phi)
    const tilt = Math.sin(t * 0.3) * 0.1
    ctx.beginPath()
    ctx.ellipse(cx, y, rx, rx * 0.3, tilt, 0, TWO_PI)
    ctx.stroke()
  }
  for (let lng = 0; lng < lngs; lng++) {
    const theta = (lng / lngs) * TWO_PI
    ctx.beginPath()
    for (let lat = 0; lat <= lats; lat++) {
      const phi = (lat / lats) * PI
      const x = cx + Math.cos(theta) * Math.sin(phi) * r
      const y = cy - Math.cos(phi) * r
      if (lat === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.stroke()
  }
}

export const drawKaleidoscope: DrawFn = (ctx, W, H, t, B, M, Hi, bh, mtz) => {
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, W, H)
  const cx = W / 2, cy = H / 2
  const N = 6 + Math.round(mtz * 14)
  const petal_len = Math.min(W, H) * 0.3 + B * 40
  const base_angle = t * 0.2 + M * 0.5
  for (let i = 0; i < N; i++) {
    ctx.save()
    ctx.translate(cx, cy)
    ctx.rotate(base_angle + i * TWO_PI / N)
    ctx.strokeStyle = `hsl(${bh + i * 30},90%,65%)`
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(0, 0)
    ctx.quadraticCurveTo(petal_len * 0.3, -petal_len * 0.4, petal_len * 0.2, -petal_len)
    ctx.quadraticCurveTo(0, -petal_len * 0.8, -petal_len * 0.2, -petal_len)
    ctx.quadraticCurveTo(-petal_len * 0.3, -petal_len * 0.4, 0, 0)
    ctx.stroke()
    ctx.restore()
  }
}

export const drawSpectrumBars: DrawFn = (ctx, W, H, t, B, M, Hi, bh, mtz) => {
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, W, H)
  const bars = 32
  const barW = W / bars
  for (let i = 0; i < bars; i++) {
    const h = H * 0.05 + (Math.sin(i * 0.5 + t) * 0.5 + 0.5) * H * 0.4 * (1 + B * 2) * (1 + mtz * 3)
    const x = i * barW
    ctx.fillStyle = `hsl(${bh + i * 8},90%,45%)`
    ctx.fillRect(x, H - h, barW - 1, h)
    ctx.fillStyle = `hsla(${bh + i * 8},90%,30%,0.6)`
    ctx.fillRect(x + 4, H - h + 4, barW - 5, h - 4)
    ctx.fillRect(x + 8, H - h + 8, barW - 9, h - 8)
  }
}

export const drawPlexusArc: DrawFn = (ctx, W, H, t, B, M, Hi, bh, mtz) => {
  ctx.fillStyle = 'rgba(0,0,0,0.15)'
  ctx.fillRect(0, 0, W, H)
  const cx = W / 2, cy = H / 2
  const nodes = 40 + Math.round(mtz * 40)
  const thresh = Math.min(W, H) * 0.25
  const pos: Array<[number, number, number]> = []
  for (let i = 0; i < nodes; i++) {
    const seed = i * 137.5
    const ang = (seed % 360) * PI / 180
    const rad = Math.min(W, H) * 0.3 * (0.5 + Math.sin(seed) * 0.5)
    const x = cx + rad * Math.cos(ang) + Math.sin(seed + t) * 30
    const y = cy + rad * Math.sin(ang) + Math.sin(seed + t + 1) * 30
    pos.push([x, y, seed])
  }
  for (let i = 0; i < nodes; i++) {
    for (let j = i + 1; j < nodes; j++) {
      const dx = pos[j][0] - pos[i][0], dy = pos[j][1] - pos[i][1]
      const dist = Math.sqrt(dx * dx + dy * dy)
      if (dist < thresh) {
        ctx.strokeStyle = `hsla(${bh},70%,60%,${1 - dist / thresh})`
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(pos[i][0], pos[i][1])
        ctx.lineTo(pos[j][0], pos[j][1])
        ctx.stroke()
      }
    }
  }
  for (const [x, y] of pos) {
    ctx.fillStyle = `hsl(${bh},80%,70%)`
    ctx.beginPath()
    ctx.arc(x, y, 3, 0, TWO_PI)
    ctx.fill()
  }
}

export const drawSolarFlare: DrawFn = (ctx, W, H, t, B, M, Hi, bh, mtz) => {
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, W, H)
  const cx = W / 2, cy = H / 2
  const sun_r = Math.min(W, H) * 0.12
  const grd = ctx.createRadialGradient(cx, cy, 0, cx, cy, sun_r)
  grd.addColorStop(0, `hsl(${bh},100%,90%)`)
  grd.addColorStop(1, `hsl(${bh + 20},100%,60%)`)
  ctx.fillStyle = grd
  ctx.beginPath()
  ctx.arc(cx, cy, sun_r, 0, TWO_PI)
  ctx.fill()
  const flares = 5 + Math.round(mtz * 8)
  const flare_len = Math.min(W, H) * 0.2 + mtz * Math.min(W, H) * 0.3
  for (let i = 0; i < flares; i++) {
    const ang = i / flares * TWO_PI + t * 0.5
    const osc = Math.sin(t * 2 + i) * sun_r * 0.3
    const x1 = cx + (sun_r + osc) * Math.cos(ang)
    const y1 = cy + (sun_r + osc) * Math.sin(ang)
    const x2 = cx + (sun_r + flare_len) * Math.cos(ang)
    const y2 = cy + (sun_r + flare_len) * Math.sin(ang)
    ctx.strokeStyle = `hsl(${bh + 20},100%,65%)`
    ctx.lineWidth = 3 + i % 2
    ctx.beginPath()
    ctx.moveTo(x1, y1)
    ctx.quadraticCurveTo(x1 + (x2 - x1) * 0.5 + Math.sin(i) * 20, y1 + (y2 - y1) * 0.5, x2, y2)
    ctx.stroke()
  }
  const cgrd = ctx.createRadialGradient(cx, cy, sun_r, cx, cy, sun_r * 4)
  cgrd.addColorStop(0, `hsla(${bh},100%,60%,0.4)`)
  cgrd.addColorStop(1, `hsla(${bh},100%,60%,0)`)
  ctx.fillStyle = cgrd
  ctx.beginPath()
  ctx.arc(cx, cy, sun_r * 4, 0, TWO_PI)
  ctx.fill()
}

export const drawDNAHelix: DrawFn = (ctx, W, H, t, B, M, Hi, bh, mtz) => {
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, W, H)
  const cx = W / 2
  const strands = 2 + Math.round(mtz * 4)
  const amp = W * 0.15 + M * 30
  const freq = 0.04 + Hi * 0.02
  ctx.lineWidth = 2
  for (let s = 0; s < strands; s++) {
    ctx.strokeStyle = `hsl(${bh + s * 120},90%,60%)`
    ctx.beginPath()
    for (let y = 0; y < H; y += 2) {
      const phase = s * PI
      const x = cx + Math.sin(y * freq + t + phase) * amp
      if (y === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.stroke()
  }
  ctx.lineWidth = 1
  ctx.strokeStyle = `hsla(${bh + 60},70%,70%,0.6)`
  for (let y = 0; y < H; y += 20) {
    const x1 = cx + Math.sin(y * freq + t) * amp
    const x2 = cx + Math.sin(y * freq + t + PI) * amp
    ctx.beginPath()
    ctx.moveTo(x1, y)
    ctx.lineTo(x2, y)
    ctx.stroke()
  }
}

export const drawBlackHole: DrawFn = (ctx, W, H, t, B, M, Hi, bh, mtz) => {
  ctx.fillStyle = 'rgba(0,0,2,0.2)'
  ctx.fillRect(0, 0, W, H)
  const cx = W / 2, cy = H / 2
  const eh = Math.min(W, H) * 0.08
  ctx.fillStyle = '#000'
  ctx.beginPath()
  ctx.arc(cx, cy, eh, 0, TWO_PI)
  ctx.fill()
  const ps = eh * 1.5
  const pgrd = ctx.createRadialGradient(cx, cy, ps - 2, cx, cy, ps + 2)
  pgrd.addColorStop(0, `hsl(${bh},100%,70%)`)
  pgrd.addColorStop(0.5, `hsl(${bh + 30},100%,80%)`)
  pgrd.addColorStop(1, `hsl(${bh},100%,50%)`)
  ctx.strokeStyle = pgrd
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.arc(cx, cy, ps, 0, TWO_PI)
  ctx.stroke()
  const rings = 6 + Math.round(mtz * 6)
  for (let i = 0; i < rings; i++) {
    const r = ps + (Math.min(W, H) * 0.2 * (i / rings))
    ctx.strokeStyle = `hsla(${bh + i * 15},100%,${60 + i * 3},${0.8 - i / rings * 0.6})`
    ctx.lineWidth = Math.max(1, 4 - i)
    ctx.beginPath()
    ctx.ellipse(cx, cy, r, r * 0.2, PI / 12, 0, TWO_PI)
    ctx.stroke()
  }
  const jlen = Math.min(W, H) * 0.3 + mtz * Math.min(W, H) * 0.2
  ctx.strokeStyle = `hsl(${bh + 200},60%,90%)`
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(cx, cy)
  ctx.lineTo(cx, cy - jlen)
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(cx, cy)
  ctx.lineTo(cx, cy + jlen)
  ctx.stroke()
}

export const drawLightning: DrawFn = (ctx, W, H, t, B, M, Hi, bh, mtz) => {
  ctx.fillStyle = 'rgba(0,0,0,0.25)'
  ctx.fillRect(0, 0, W, H)
  const bolts = 2 + Math.round(mtz * 6)
  const depth = 4 + Math.round(mtz * 3)
  for (let b = 0; b < bolts; b++) {
    const seed = b * 997 + Math.floor(t * 10)
    ctx.strokeStyle = `hsl(${bh + 200},60%,90%)`
    ctx.lineWidth = 4
    ctx.beginPath()
    const sx = W / (bolts + 1) * (b + 1)
    ctx.moveTo(sx, 0)
    let x = sx, y = 0
    for (let seg = 0; seg < H / 20; seg++) {
      const rnd = Math.sin(seed + seg * 0.5) * 30
      x += rnd
      y += 20
      ctx.lineTo(x, y)
    }
    ctx.stroke()
    ctx.strokeStyle = `hsl(${bh + 210},50%,80%)`
    ctx.lineWidth = 1
    ctx.stroke()
  }
}

export const drawWormhole: DrawFn = (ctx, W, H, t, B, M, Hi, bh, mtz) => {
  ctx.fillStyle = 'rgba(0,0,0,0.1)'
  ctx.fillRect(0, 0, W, H)
  const cx = W / 2, cy = H / 2
  const rings = 20 + Math.round(mtz * 20)
  const spacing = H / rings
  for (let i = 0; i < rings; i++) {
    const phase = (t * (0.5 + mtz * 0.3) - i * 0.05) % 1
    const scale = Math.pow(1 - i / rings, 1.5)
    const rx = Math.min(W, H) * 0.3 * scale
    const ry = Math.min(W, H) * 0.1 * scale
    const yoff = cy + (i - rings / 2) * spacing * (1 - i / rings)
    const opacity = 1 - i / rings
    ctx.strokeStyle = `hsla(${bh + i * 8},80%,55%,${opacity})`
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.ellipse(cx, yoff, rx, ry, 0, 0, TWO_PI)
    ctx.stroke()
  }
}
