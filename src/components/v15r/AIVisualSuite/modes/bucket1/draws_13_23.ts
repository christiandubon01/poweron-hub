// @ts-nocheck
/**
 * draws_13_23.ts — B1 ORIGINALS modes 13-23
 * B48 — NEXUS Visual Suite Full Deploy
 */
import type { DrawFn } from './draws_1_12'

const PI = Math.PI

export const drawCymatics: DrawFn = (ctx, W, H, t, B, M, Hi, bh, mtz) => {
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, W, H)
  ctx.fillStyle = `hsl(${bh},80%,60%)`
  const fx = 3 + Math.round(mtz * 5), fy = 4 + Math.round(mtz * 4)
  const threshold = 0.12
  for (let x = 0; x < W; x += W / 80) {
    for (let y = 0; y < H; y += H / 80) {
      const v = Math.sin(x * fx * PI / W) * Math.sin(y * fy * PI / H) + Math.sin(x * 2 * PI / W + t) * Math.sin(y * 5 * PI / H + t)
      if (Math.abs(v) < threshold) {
        ctx.globalAlpha = 0.5 + 0.5 * (1 - Math.abs(v) / threshold)
        ctx.fillRect(x - 1, y - 1, 2, 2)
      }
    }
  }
  ctx.globalAlpha = 1
}

export const drawLavaLamp: DrawFn = (ctx, W, H, t, B, M, Hi, bh, mtz) => {
  ctx.fillStyle = 'rgba(5,0,10,0.15)'
  ctx.fillRect(0, 0, W, H)
  const count = 5 + Math.round(mtz * 3)
  const r = 50 + M * 30 + mtz * 30
  ctx.globalCompositeOperation = 'screen'
  for (let i = 0; i < count; i++) {
    const seed = i * 73.1
    const speed = 0.4 + i * 0.05
    const range = H * 0.15
    const cx = W * (0.2 + i * 0.15)
    const cy = H * (0.3 + i * 0.1)
    const x = cx + Math.sin(seed * 2.1 + t * speed) * range
    const y = cy + Math.cos(seed * 1.7 + t * speed) * range
    const grad = ctx.createRadialGradient(x, y, 0, x, y, r)
    grad.addColorStop(0, `hsl(${bh + i * 40},90%,60%)`)
    grad.addColorStop(1, `hsl(${bh + i * 40},90%,60%,0)`)
    ctx.fillStyle = grad
    ctx.beginPath()
    ctx.arc(x, y, r, 0, 2 * PI)
    ctx.fill()
  }
  ctx.globalCompositeOperation = 'source-over'
}

export const drawCrystal: DrawFn = (ctx, W, H, t, B, M, Hi, bh, mtz) => {
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, W, H)
  const cx = W / 2, cy = H / 2
  const angle = t * 0.15
  const size = 80
  for (let face = 0; face < 6; face++) {
    const fa = angle + face * (PI / 3)
    const x1 = cx + Math.cos(fa) * size
    const y1 = cy + Math.sin(fa) * size
    const x2 = cx + Math.cos(fa + PI / 3) * size
    const y2 = cy + Math.sin(fa + PI / 3) * size
    const grad = ctx.createLinearGradient(cx, cy, x1, y1)
    grad.addColorStop(0, `hsl(${bh + face * 20},70%,55%)`)
    grad.addColorStop(1, `hsl(${bh + face * 20 + 30},50%,30%)`)
    ctx.fillStyle = grad
    ctx.beginPath()
    ctx.moveTo(cx, cy)
    ctx.lineTo(x1, y1)
    ctx.lineTo(x2, y2)
    ctx.closePath()
    ctx.fill()
    if (mtz > 0.1) {
      ctx.fillStyle = `hsla(${bh + face * 20},60%,40%,0.4)`
      ctx.arc(cx + (x1 + x2) / 2 - cx, cy + (y1 + y2) / 2 - cy, size * 0.2, 0, 2 * PI)
      ctx.fill()
    }
    ctx.fillStyle = `hsl(${bh + face * 20},100%,80%)`
    ctx.fillRect(x1 - 2, y1 - 2, 4, 4)
  }
}

export const drawBlueprint: DrawFn = (ctx, W, H, t, B, M, Hi, bh, mtz) => {
  ctx.fillStyle = 'rgba(0,5,20,0.9)'
  ctx.fillRect(0, 0, W, H)
  ctx.strokeStyle = `hsl(${bh + 200},100%,80%)`
  const busY = [H / 4, H / 2, (3 * H) / 4]
  const lineWidth = 2 + mtz * 3
  ctx.lineWidth = lineWidth
  busY.forEach(y => ctx.line(0, y, W, y))
  ctx.stroke()
  const branches = 3 + Math.round(mtz * 4)
  for (let i = 0; i < branches; i++) {
    const x = (W / (branches + 1)) * (i + 1)
    ctx.beginPath()
    ctx.moveTo(x, busY[0])
    ctx.lineTo(x, busY[2])
    ctx.stroke()
  }
  ctx.fillStyle = `hsl(${bh + 200},100%,70%)`
  for (let i = 0; i < 8 + Math.round(mtz * 4); i++) {
    const dx = (t * 60 + i * 30) % W
    busY.forEach(y => ctx.arc(dx, y, 3 + Hi * 2, 0, 2 * PI))
    ctx.fill()
  }
  ctx.beginPath()
}

export const drawVoltage: DrawFn = (ctx, W, H, t, B, M, Hi, bh, mtz) => {
  ctx.fillStyle = 'rgba(0,0,5,0.8)'
  ctx.fillRect(0, 0, W, H)
  const busY = [H * 0.25, H * 0.5, (3 * H) / 4]
  const phases = [{ hue: 0, label: 'Ø A' }, { hue: 240, label: 'Ø B' }, { hue: 120, label: 'Ø C' }]
  const freq = 6
  const amp = 15
  phases.forEach((ph, i) => {
    ctx.strokeStyle = `hsl(${ph.hue},100%,55%)`
    ctx.lineWidth = 4
    ctx.beginPath()
    for (let x = 0; x < W; x += 2) {
      const y = busY[i] + Math.sin(x * freq * PI / W + t + i * (2 * PI / 3)) * amp
      ctx.lineTo(x, y)
    }
    ctx.stroke()
    ctx.fillStyle = `hsl(${ph.hue},100%,55%)`
    ctx.font = '12px monospace'
    ctx.fillText(ph.label, 10, busY[i] - 10)
  })
  const arcCount = Math.floor(mtz * 3)
  for (let a = 0; a < arcCount; a++) {
    const x = Math.random() * W
    const y1 = busY[Math.floor(Math.random() * 3)]
    const y2 = busY[Math.floor(Math.random() * 3)]
    ctx.strokeStyle = `hsla(${bh + 200},100%,80%,${0.5 + mtz * 0.5})`
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(x, y1)
    for (let j = 0; j < 5; j++) {
      ctx.lineTo(x + (Math.random() - 0.5) * 10, y1 + (y2 - y1) * (j / 4))
    }
    ctx.stroke()
  }
}

export const drawHustleGrid: DrawFn = (ctx, W, H, t, B, M, Hi, bh, mtz) => {
  ctx.fillStyle = 'rgba(5,5,10,0.9)'
  ctx.fillRect(0, 0, W, H)
  const labels = ['LEADS', 'EST', 'JOBS', 'REV', 'CREW', 'MTL', 'HR', 'NET']
  const barWidth = W / 10
  const baseHeight = H * 0.5
  for (let i = 0; i < 8; i++) {
    const h = baseHeight + Math.sin(t * 1.5 + i) * 30 + B * 50
    const x = barWidth * (i + 1)
    ctx.fillStyle = `hsl(${bh + i * 25},80%,55%)`
    ctx.fillRect(x - barWidth / 3, H - h, (2 * barWidth) / 3, h)
    ctx.fillStyle = '#fff'
    ctx.font = '11px sans-serif'
    ctx.fillText(labels[i], x - 20, H - h - 5)
  }
  const particleCount = 5 + Math.round(mtz * 5)
  ctx.fillStyle = `hsla(${bh + 60},100%,70%,0.7)`
  for (let i = 0; i < particleCount; i++) {
    const px = (t * 80 + i * (W / particleCount)) % W
    const py = H * 0.12
    ctx.fillRect(px, py, 3, 3)
  }
}

export const drawDesertStorm: DrawFn = (ctx, W, H, t, B, M, Hi, bh, mtz) => {
  const skyGrad = ctx.createLinearGradient(0, 0, 0, H)
  skyGrad.addColorStop(0, 'hsl(25,80%,15%)')
  skyGrad.addColorStop(1, 'hsl(20,90%,40%)')
  ctx.fillStyle = skyGrad
  ctx.fillRect(0, 0, W, H)
  const sunR = Math.min(W, H) * 0.12 + mtz * 30
  const sunGrad = ctx.createRadialGradient(W / 2, H * 0.35, 0, W / 2, H * 0.35, sunR)
  sunGrad.addColorStop(0, 'hsl(40,100%,60%)')
  sunGrad.addColorStop(1, 'hsl(20,90%,40%)')
  ctx.fillStyle = sunGrad
  ctx.beginPath()
  ctx.arc(W / 2, H * 0.35, sunR, 0, 2 * PI)
  ctx.fill()
  for (let i = 0; i < 3; i++) {
    ctx.fillStyle = `hsl(${30 - i * 3},60%,${25 - i * 5}%)`
    ctx.beginPath()
    for (let x = 0; x < W; x += 10) {
      ctx.lineTo(x, H * (0.6 + i * 0.13) + Math.sin(x * 0.02 + t) * 8)
    }
    ctx.lineTo(W, H)
    ctx.lineTo(0, H)
    ctx.closePath()
    ctx.fill()
  }
  const dustCount = 60 + Math.round(mtz * 80)
  ctx.fillStyle = `rgba(180,150,100,${0.2 + mtz * 0.3})`
  for (let i = 0; i < dustCount; i++) {
    const seed = i * 37.3
    const px = (Math.sin(seed) * W + t * 30) % W
    const py = H * (0.8 - (Math.cos(seed) * 0.5 + t * 0.05) % 0.6)
    ctx.fillRect(px, py, 2, 2)
  }
}

export const drawNEXUSMind: DrawFn = (ctx, W, H, t, B, M, Hi, bh, mtz) => {
  ctx.fillStyle = 'rgba(0,0,0,0.18)'
  ctx.fillRect(0, 0, W, H)
  const cx = W / 2, cy = H / 2
  ctx.fillStyle = `hsl(${bh},100%,70%)`
  ctx.shadowBlur = 20
  ctx.shadowColor = `hsl(${bh},80%,55%)`
  ctx.beginPath()
  ctx.arc(cx, cy, 12, 0, 2 * PI)
  ctx.fill()
  ctx.shadowBlur = 0
  const orbitSpeed = 0.2 + mtz * 0.6
  for (let i = 0; i < 11; i++) {
    const angle = t * orbitSpeed + i * (2 * PI / 11)
    const radius = Math.min(W, H) * (0.15 + i * 0.02)
    const nx = cx + Math.cos(angle) * radius
    const ny = cy + Math.sin(angle) * radius
    ctx.strokeStyle = `hsla(${bh + i * 20},100%,50%,0.6)`
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(cx, cy)
    ctx.lineTo(nx, ny)
    ctx.stroke()
    ctx.fillStyle = `hsl(${bh + i * 20},90%,65%)`
    ctx.beginPath()
    ctx.arc(nx, ny, 4, 0, 2 * PI)
    ctx.fill()
  }
  const pulseCount = Math.floor(t / 2) % (3 + Math.round(mtz * 2))
  const pulseDist = ((t % 2) / 2) * (Math.min(W, H) * 0.4)
  ctx.strokeStyle = `hsla(${bh},80%,55%,${Math.max(0, 1 - (t % 2) / 2)})`
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.arc(cx, cy, pulseDist, 0, 2 * PI)
  ctx.stroke()
}

export const drawEmpireFall: DrawFn = (ctx, W, H, t, B, M, Hi, bh, mtz) => {
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, W, H)
  ctx.fillStyle = '#fff'
  for (let i = 0; i < 100; i++) {
    const sx = (Math.sin(i * 7.2) * W) / 2 + W / 2
    const sy = (Math.cos(i * 5.1) * H) / 2 + H / 2
    ctx.fillRect(sx, sy, 1, 1)
  }
  const pillars = 5 + Math.round(mtz)
  for (let i = 0; i < pillars; i++) {
    const px = ((i + 1) / (pillars + 1)) * W
    const py = H * 0.4
    const ph = H * 0.4
    const lean = Math.sin(t * 0.1 + i) * mtz * 15
    ctx.save()
    ctx.translate(px, py + ph / 2)
    ctx.rotate((lean * PI) / 180)
    ctx.fillStyle = 'hsl(30,10%,35%)'
    ctx.fillRect(-15, -ph / 2, 30, ph)
    ctx.strokeStyle = '#555'
    ctx.lineWidth = 1
    for (let c = 0; c < 3 + Math.round(mtz * 2); c++) {
      const cy = (-ph / 2 + (c / 4) * ph) + Math.sin(t + i) * mtz * 5
      ctx.beginPath()
      ctx.moveTo(-15, cy)
      ctx.lineTo(15, cy + 8 * mtz)
      ctx.stroke()
    }
    ctx.restore()
    for (let d = 0; d < 5 + Math.round(mtz * 3); d++) {
      const dx = px + (Math.random() - 0.5) * 20
      const dy = py + ph + (t * 80 + d * 20) % (H - py - ph)
      ctx.fillStyle = `rgba(200,180,150,${0.6 - dy / H})`
      ctx.fillRect(dx, dy, 2, 2)
    }
  }
}

export const drawInfiniteLoop: DrawFn = (ctx, W, H, t, B, M, Hi, bh, mtz) => {
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, W, H)
  const cx = W / 2, cy = H / 2
  const fib = [1, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144]
  const angle = t * 0.15 + mtz * t * 0.3
  const scale = Math.min(W, H) / 300
  ctx.save()
  ctx.translate(cx, cy)
  ctx.rotate(angle)
  for (let i = 0; i < 12; i++) {
    ctx.strokeStyle = `hsl(${bh + i * 15},80%,55%)`
    ctx.lineWidth = 2 + mtz
    const x0 = -fib[i] * scale
    const y0 = -fib[i] * scale
    const w = fib[i] * 2 * scale
    ctx.beginPath()
    ctx.arc(x0 + fib[i] * scale, y0 + fib[i] * scale, fib[i] * scale, 0, PI / 2)
    ctx.stroke()
    if (mtz > 0.2) {
      ctx.strokeStyle = `hsla(${bh + i * 15},60%,40%,0.4)`
      ctx.arc(x0 + fib[i] * scale, y0 + fib[i] * scale, (fib[i] * scale) / 2, 0, PI / 2)
      ctx.stroke()
    }
  }
  ctx.restore()
}

export const drawIronWill: DrawFn = (ctx, W, H, t, B, M, Hi, bh, mtz) => {
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, W, H)
  const cy = H / 2
  ctx.strokeStyle = `hsl(${bh + 120},100%,55%)`
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(0, cy)
  ctx.lineTo(W, cy)
  ctx.stroke()
  const cycle = t % 2
  const heartX = (t * 100) % W
  if (cycle < 0.3) {
    const ph = (cycle / 0.3) * 8
    ctx.beginPath()
    ctx.moveTo(heartX, cy)
    ctx.lineTo(heartX + 30, cy - ph)
    ctx.stroke()
  } else if (cycle < 0.6) {
    const ph = ((cycle - 0.3) / 0.3) * 20
    ctx.strokeStyle = `hsl(${bh + 120},100%,55%)`
    ctx.lineWidth = 2.5
    ctx.beginPath()
    ctx.moveTo(heartX - 30, cy - 5)
    ctx.lineTo(heartX, cy + ph)
    ctx.lineTo(heartX + 40, cy - (H * 0.35 + mtz * H * 0.25))
    ctx.stroke()
  } else if (cycle < 0.8) {
    const ph = ((cycle - 0.6) / 0.2) * 5
    ctx.beginPath()
    ctx.moveTo(heartX, cy - (H * 0.35 + mtz * H * 0.25))
    ctx.lineTo(heartX + 30, cy - ph)
    ctx.stroke()
  }
  if (cycle > 0.5 && cycle < 0.65) {
    const rng = 8 + Math.round(mtz * 8)
    for (let r = 0; r < rng; r++) {
      const ringR = (cycle - 0.5) / 0.15 * (H * 0.2)
      ctx.strokeStyle = `hsla(${bh + 120},100%,55%,${Math.max(0, 1 - ringR / (H * 0.2))})`
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.arc(heartX, cy - (H * 0.35 + mtz * H * 0.25), ringR, 0, 2 * PI)
      ctx.stroke()
    }
  }
}
