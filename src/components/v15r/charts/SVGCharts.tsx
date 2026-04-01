// @ts-nocheck
/**
 * Pure SVG chart components — zero external dependencies.
 * Replaces Chart.js to eliminate TDZ bundler conflicts.
 */
import React, { useState, useMemo } from 'react'
import { getProjectFinancials, health, num, fmtK, type BackupData } from '@/services/backupDataService'

const fmtDollar = (v: number) => v >= 1000000 ? `$${(v / 1000000).toFixed(1)}M` : v >= 1000 ? `$${(v / 1000).toFixed(0)}k` : `$${Math.round(v)}`
const EMPTY = <div className="flex items-center justify-center h-full text-gray-500 text-sm">No data available</div>

// ── SVG LINE CHART (reusable) ──
function SVGLineChart({ data, lines, height = 280 }: {
  data: Array<{ label: string; [key: string]: any }>
  lines: Array<{ key: string; color: string; label: string; dashed?: boolean; width?: number }>
  height?: number
}) {
  const [hover, setHover] = useState<number | null>(null)
  if (!data.length) return EMPTY

  const W = 800, H = height, pad = { t: 30, r: 20, b: 40, l: 60 }
  const cW = W - pad.l - pad.r, cH = H - pad.t - pad.b

  const allVals = data.flatMap(d => lines.map(l => num(d[l.key])))
  const maxV = Math.max(...allVals, 1)
  const minV = Math.min(...allVals, 0)
  const range = maxV - minV || 1

  const x = (i: number) => pad.l + (i / Math.max(data.length - 1, 1)) * cW
  const y = (v: number) => pad.t + cH - ((v - minV) / range) * cH

  const ticks = 5
  const tickVals = Array.from({ length: ticks }, (_, i) => minV + (range * i) / (ticks - 1))

  return (
    <div className="relative w-full h-full">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" className="w-full h-full">
        {/* Grid lines */}
        {tickVals.map((v, i) => (
          <g key={i}>
            <line x1={pad.l} y1={y(v)} x2={W - pad.r} y2={y(v)} stroke="rgba(255,255,255,0.06)" />
            <text x={pad.l - 8} y={y(v) + 4} textAnchor="end" fill="#9ca3af" fontSize="10">{fmtDollar(v)}</text>
          </g>
        ))}
        {/* X labels */}
        {data.map((d, i) => {
          if (data.length > 12 && i % Math.ceil(data.length / 12) !== 0 && i !== data.length - 1) return null
          return <text key={i} x={x(i)} y={H - 8} textAnchor="middle" fill="#9ca3af" fontSize="9">{d.label}</text>
        })}
        {/* Lines */}
        {lines.map(line => {
          const pts = data.map((d, i) => `${x(i)},${y(num(d[line.key]))}`).join(' ')
          return <polyline key={line.key} points={pts} fill="none" stroke={line.color}
            strokeWidth={line.width || 2} strokeDasharray={line.dashed ? '6 4' : undefined} />
        })}
        {/* Hover column */}
        {hover !== null && (
          <line x1={x(hover)} y1={pad.t} x2={x(hover)} y2={H - pad.b} stroke="rgba(255,255,255,0.2)" strokeWidth={1} />
        )}
        {/* Invisible hover rects */}
        {data.map((_, i) => (
          <rect key={i} x={x(i) - cW / data.length / 2} y={pad.t} width={cW / data.length} height={cH}
            fill="transparent" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} />
        ))}
      </svg>
      {/* Tooltip */}
      {hover !== null && data[hover] && (
        <div className="absolute top-2 right-2 bg-gray-900/95 border border-gray-700 rounded-lg p-3 text-xs z-10 pointer-events-none" style={{ minWidth: 160 }}>
          <p className="font-bold text-white mb-1">{data[hover].label}</p>
          {lines.map(l => (
            <div key={l.key} className="flex items-center gap-2 py-0.5">
              <div className="w-2 h-2 rounded-full" style={{ background: l.color }} />
              <span className="text-gray-400">{l.label}:</span>
              <span className="text-gray-200 font-mono ml-auto">{fmtDollar(num(data[hover][l.key]))}</span>
            </div>
          ))}
        </div>
      )}
      {/* Legend */}
      <div className="flex flex-wrap gap-3 mt-2 justify-center">
        {lines.map(l => (
          <div key={l.key} className="flex items-center gap-1.5 text-[10px] text-gray-400">
            <div className="w-3 h-0.5 rounded" style={{ background: l.color, borderTop: l.dashed ? '2px dashed ' + l.color : undefined }} />
            <span>{l.label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── CFOT CHART ──
export function CFOTChart({ data, backup }: { data: any[]; backup: BackupData }) {
  const chartData = useMemo(() => data.map(d => {
    const label = (() => {
      if (!d.start) return `Wk ${d.wk ?? '?'}`
      const dt = new Date(d.start + 'T00:00:00')
      return isNaN(dt.getTime()) ? `Wk ${d.wk ?? '?'}` : dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    })()
    return {
      label,
      exposure: num(d.totalExposure || (num(d.unbilled || 0) + num(d.pendingInv || 0) + Math.max(0, num(d.svc || 0) - num(d.svcCollected || 0)))),
      unbilled: num(d.unbilled || 0),
      pending: num(d.pendingInv || 0),
      svcPay: num(d.svc || 0),
      projPay: num(d.proj || 0),
      accum: num(d.accum || 0),
    }
  }), [data])

  return <SVGLineChart data={chartData} height={350} lines={[
    { key: 'exposure', color: '#ef4444', label: 'Total Exposure', width: 3 },
    { key: 'unbilled', color: '#f87171', label: 'Unbilled' },
    { key: 'pending', color: '#f59e0b', label: 'Pending Invoice' },
    { key: 'svcPay', color: '#86efac', label: 'Service Payment' },
    { key: 'projPay', color: '#16a34a', label: 'Project Payment' },
    { key: 'accum', color: '#14532d', label: 'Accumulative Income', width: 3 },
  ]} />
}

// ── OPP CHART (horizontal bars) ──
export function OPPChart({ projects, backup }: { projects: any[]; backup: BackupData }) {
  const [hover, setHover] = useState<number | null>(null)
  if (!projects.length) return EMPTY
  const maxVal = Math.max(...projects.map(p => num(p.contract)), 1)
  const barH = 28, gap = 6, padL = 130, padR = 70
  const W = 800, H = Math.max(200, projects.length * (barH + gap) + 40)

  return (
    <div className="relative w-full h-full">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" className="w-full h-full">
        {projects.map((p, i) => {
          const clr = health(p, backup).clr
          const w = (num(p.contract) / maxVal) * (W - padL - padR)
          const yPos = 20 + i * (barH + gap)
          return (
            <g key={p.id || i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <text x={padL - 8} y={yPos + barH / 2 + 4} textAnchor="end" fill="#d1d5db" fontSize="11">
                {(p.name || 'Unknown').substring(0, 18)}
              </text>
              <rect x={padL} y={yPos} width={Math.max(w, 2)} height={barH} rx={3} fill={clr} opacity={hover === i ? 1 : 0.8} />
              <text x={padL + w + 8} y={yPos + barH / 2 + 4} fill="#9ca3af" fontSize="10" fontFamily="monospace">
                {fmtDollar(num(p.contract))}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

// ── PCD CHART (stacked horizontal bars) ──
const phaseNames = ['Planning', 'Estimating', 'Site Prep', 'Rough-in', 'Trim', 'Finish']
const phaseColors = ['#6b7280', '#8b5cf6', '#f59e0b', '#3b82f6', '#eab308', '#10b981']
const defaultWeights: any = { Planning: 5, Estimating: 10, 'Site Prep': 15, 'Rough-in': 30, Trim: 25, Finish: 15 }

export function PCDChart({ projects, backup }: { projects: any[]; backup: BackupData }) {
  if (!projects.length) return EMPTY
  const weights = backup.settings?.phaseWeights || defaultWeights
  const barH = 24, gap = 5, padL = 130
  const W = 800, H = Math.max(200, projects.length * (barH + gap) + 60)
  const maxTotal = 100

  return (
    <div className="relative w-full h-full">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" className="w-full h-full">
        {projects.map((p, pi) => {
          const phases = p.phases || {}
          let xOff = padL
          const yPos = 20 + pi * (barH + gap)
          return (
            <g key={p.id || pi}>
              <text x={padL - 8} y={yPos + barH / 2 + 4} textAnchor="end" fill="#d1d5db" fontSize="10">
                {(p.name || '?').substring(0, 18)}
              </text>
              {phaseNames.map((pn, i) => {
                const completion = phases[pn] || 0
                const weight = (weights as any)[pn] || 0
                const val = weight * (completion / 100)
                const w = (val / maxTotal) * (W - padL - 40)
                const el = <rect key={pn} x={xOff} y={yPos} width={Math.max(w, 0)} height={barH} fill={phaseColors[i]} />
                xOff += w
                return el
              })}
            </g>
          )
        })}
      </svg>
      <div className="flex flex-wrap gap-3 mt-1 justify-center">
        {phaseNames.map((pn, i) => (
          <div key={pn} className="flex items-center gap-1 text-[10px] text-gray-400">
            <div className="w-2.5 h-2.5 rounded-sm" style={{ background: phaseColors[i] }} />
            <span>{pn}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── EVR CHART ──
export function EVRChart({ projects, backup, dateStart, dateEnd }: { projects: any[]; backup: BackupData; dateStart?: string; dateEnd?: string }) {
  const chartData = useMemo(() => {
    const inRange = (d: string) => { if (!d) return true; if (dateStart && d < dateStart) return false; if (dateEnd && d > dateEnd) return false; return true }
    let cumIncome = 0, cumAR = 0, cumPipeline = 0
    return projects.map(p => {
      const fin = getProjectFinancials(p, backup)
      const logs = (backup.logs || []).filter((l: any) => l.projectId === p.id && inRange(l.date))
      const income = dateStart || dateEnd ? logs.reduce((s: number, l: any) => s + num(l.collected), 0) : fin.paid
      cumIncome += income; cumAR += Math.max(0, fin.billed - fin.paid); cumPipeline += num(p.contract)
      return { label: (p.name || '?').substring(0, 15), income: cumIncome, ar: cumAR, pipeline: cumPipeline }
    })
  }, [projects, backup, dateStart, dateEnd])

  return <SVGLineChart data={chartData} lines={[
    { key: 'income', color: '#10b981', label: 'Accumulated Income', width: 2 },
    { key: 'ar', color: '#ef4444', label: 'Outstanding AR', width: 2 },
    { key: 'pipeline', color: '#3b82f6', label: 'Total Pipeline', dashed: true, width: 2 },
  ]} />
}

// ── SCP CHART (grouped bars) ──
export function SCPChart({ serviceLogs, backup }: { serviceLogs: any[]; backup: BackupData }) {
  const [hover, setHover] = useState<number | null>(null)
  if (!serviceLogs.length) return EMPTY
  const mileRate = num(backup.settings?.mileRate || 0.66)
  const items = serviceLogs.slice(-8).map((l: any) => {
    const quoted = num(l.quoted), mat = num(l.materialCost || l.material), miles = num(l.mileage || 0) * mileRate
    return { label: (l.customer || '?').substring(0, 12), quoted, material: mat, profit: Math.max(0, quoted - mat - miles) }
  })
  const maxVal = Math.max(...items.flatMap(d => [d.quoted, d.material, d.profit]), 1)
  const W = 800, H = 280, pad = { t: 20, r: 20, b: 40, l: 60 }
  const cW = W - pad.l - pad.r, cH = H - pad.t - pad.b
  const groupW = cW / items.length, barW = groupW / 4

  return (
    <div className="relative w-full h-full">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" className="w-full h-full">
        {[0, 0.25, 0.5, 0.75, 1].map((f, i) => {
          const v = maxVal * f, yPos = pad.t + cH - (f * cH)
          return <g key={i}><line x1={pad.l} y1={yPos} x2={W - pad.r} y2={yPos} stroke="rgba(255,255,255,0.06)" />
            <text x={pad.l - 8} y={yPos + 4} textAnchor="end" fill="#9ca3af" fontSize="10">{fmtDollar(v)}</text></g>
        })}
        {items.map((d, i) => {
          const gx = pad.l + i * groupW + groupW * 0.1
          const bars = [
            { val: d.quoted, color: '#3b82f6', label: 'Quoted' },
            { val: d.material, color: '#f59e0b', label: 'Material' },
            { val: d.profit, color: '#10b981', label: 'Net Profit' },
          ]
          return (
            <g key={i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              {bars.map((b, bi) => {
                const h = (b.val / maxVal) * cH
                return <rect key={bi} x={gx + bi * barW} y={pad.t + cH - h} width={barW - 2} height={h} rx={2} fill={b.color} opacity={hover === i ? 1 : 0.8} />
              })}
              <text x={gx + barW * 1.5} y={H - 8} textAnchor="middle" fill="#9ca3af" fontSize="9">{d.label}</text>
            </g>
          )
        })}
      </svg>
      {hover !== null && items[hover] && (
        <div className="absolute top-2 right-2 bg-gray-900/95 border border-gray-700 rounded-lg p-3 text-xs z-10 pointer-events-none">
          <p className="font-bold text-white mb-1">{items[hover].label}</p>
          <p className="text-blue-400">Quoted: {fmtDollar(items[hover].quoted)}</p>
          <p className="text-amber-400">Material: {fmtDollar(items[hover].material)}</p>
          <p className="text-emerald-400">Profit: {fmtDollar(items[hover].profit)}</p>
        </div>
      )}
      <div className="flex gap-4 mt-1 justify-center text-[10px] text-gray-400">
        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-blue-500" /> Quoted</span>
        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-amber-500" /> Material</span>
        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-emerald-500" /> Net Profit</span>
      </div>
    </div>
  )
}

// ── RCA CHART (Revenue vs Cost with zones) ──
export function RevenueCostChart({ projects, backup, dateStart, dateEnd }: { projects: any[]; backup: BackupData; dateStart?: string; dateEnd?: string }) {
  const chartData = useMemo(() => {
    const mileRate = num(backup.settings?.mileRate || 0.66)
    const opCost = num(backup.settings?.opCost || 42.45)
    const logs = backup.logs || []
    const inRange = (d: string) => { if (!d) return true; if (dateStart && d < dateStart) return false; if (dateEnd && d > dateEnd) return false; return true }

    if (projects.length === 1) {
      const p = projects[0]
      const pLogs = logs.filter((l: any) => l.projectId === p.id && inRange(l.date)).sort((a: any, b: any) => (a.date || '').localeCompare(b.date || ''))
      let cc = 0, cl = 0, cm = 0, cmi = 0
      return pLogs.map((l: any) => {
        cc += num(l.collected); cl += num(l.hrs) * opCost; cm += num(l.mat); cmi += num(l.miles || 0) * mileRate
        return { label: l.date ? new Date(l.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '?', collected: cc, labor: cl, material: cm, mileage: cmi, breakeven: cl + cm + cmi }
      })
    }
    return projects.map(p => {
      const fin = getProjectFinancials(p, backup)
      const pLogs = logs.filter((l: any) => l.projectId === p.id && inRange(l.date))
      const hrs = pLogs.reduce((s: number, l: any) => s + num(l.hrs), 0)
      const mat = pLogs.reduce((s: number, l: any) => s + num(l.mat), 0)
      const mi = pLogs.reduce((s: number, l: any) => s + num(l.miles || 0), 0)
      return { label: (p.name || '?').substring(0, 15), collected: fin.paid, labor: hrs * opCost, material: mat, mileage: mi * mileRate, breakeven: hrs * opCost + mat + mi * mileRate }
    })
  }, [projects, backup, dateStart, dateEnd])

  return <SVGLineChart data={chartData} height={380} lines={[
    { key: 'collected', color: '#10b981', label: 'Collected Revenue', width: 3 },
    { key: 'labor', color: '#ef4444', label: 'Labor Cost' },
    { key: 'material', color: '#f59e0b', label: 'Material Cost' },
    { key: 'mileage', color: '#8b5cf6', label: 'Mileage Cost', dashed: true },
    { key: 'breakeven', color: '#6b7280', label: 'Break-even', dashed: true },
  ]} />
}

// ── PvA CHART ──
const pvColors = ['#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899']

export function PlannedVsActualChart({ projects, backup }: { projects: any[]; backup: BackupData }) {
  if (!projects.length) return EMPTY
  const logs = backup.logs || []
  const allDates = new Set<string>()
  projects.forEach(p => {
    if (p.plannedStart) allDates.add(p.plannedStart)
    if (p.plannedEnd) allDates.add(p.plannedEnd)
    logs.filter((l: any) => l.projectId === p.id && l.date).forEach((l: any) => allDates.add(l.date))
  })
  const sortedDates = [...allDates].sort()
  if (!sortedDates.length) return EMPTY

  const lineData: Array<{ key: string; color: string; label: string; dashed?: boolean; width?: number }> = []
  const chartData = sortedDates.map(date => {
    const row: any = { label: new Date(date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) }
    projects.forEach((p, i) => {
      const c = pvColors[i % pvColors.length]
      const pKey = `p${i}_planned`, aKey = `p${i}_actual`
      if (p.plannedStart && p.plannedEnd && date >= p.plannedStart && date <= p.plannedEnd) row[pKey] = num(p.contract)
      const cum = logs.filter((l: any) => l.projectId === p.id && l.date && l.date <= date).reduce((s: number, l: any) => s + num(l.collected), 0)
      if (cum > 0) row[aKey] = cum
    })
    return row
  })

  projects.forEach((p, i) => {
    const c = pvColors[i % pvColors.length]
    const name = (p.name || 'Project').substring(0, 12)
    lineData.push({ key: `p${i}_planned`, color: c, label: `${name} (Plan)`, dashed: true })
    lineData.push({ key: `p${i}_actual`, color: c, label: `${name} (Actual)`, width: 2 })
  })

  return <SVGLineChart data={chartData} height={340} lines={lineData} />
}
