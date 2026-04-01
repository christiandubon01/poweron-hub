// @ts-nocheck
/**
 * Pure SVG chart components — zero external dependencies, zero useState.
 * Uses useRef for DOM tooltips to avoid TDZ on React hooks.
 */
import React from 'react'
import { getProjectFinancials, health, num, fmtK, type BackupData } from '@/services/backupDataService'

function fmtDollar(v) { return v >= 1000000 ? '$' + (v / 1000000).toFixed(1) + 'M' : v >= 1000 ? '$' + (v / 1000).toFixed(0) + 'k' : '$' + Math.round(v) }
function EmptyChart() { return <div className="flex items-center justify-center h-full text-gray-500 text-sm">No data available</div> }

// ── SVG LINE CHART (reusable) ──
function SVGLineChart({ data, lines, height, zones, milestones }) {
  var tooltipRef = React.useRef(null)
  if (!data || !data.length) return <EmptyChart />
  var H = height || 280, W = 900
  var pad = { t: 30, r: 20, b: 44, l: 62 }
  var cW = W - pad.l - pad.r, cH = H - pad.t - pad.b
  var allVals = []
  for (var di = 0; di < data.length; di++) { for (var li = 0; li < lines.length; li++) { var v = num(data[di][lines[li].key]); if (v !== 0 || data[di][lines[li].key] !== undefined) allVals.push(v) } }
  var maxV = Math.max.apply(null, allVals.length ? allVals.concat([1]) : [1])
  var minV = Math.min.apply(null, allVals.length ? allVals.concat([0]) : [0])
  var range = maxV - minV || 1
  function x(i) { return pad.l + (i / Math.max(data.length - 1, 1)) * cW }
  function y(v) { return pad.t + cH - ((v - minV) / range) * cH }
  var ticks = [0,1,2,3,4].map(function(i) { return minV + (range * i) / 4 })
  var labelStep = data.length > 20 ? Math.ceil(data.length / 12) : data.length > 12 ? 2 : 1

  function showTip(i) {
    var el = tooltipRef.current; if (!el || !data[i]) return
    var html = '<b style="color:#fff">' + data[i].label + '</b>'
    for (var j = 0; j < lines.length; j++) {
      var val = num(data[i][lines[j].key])
      html += '<div style="display:flex;align-items:center;gap:6px;padding:2px 0"><span style="width:8px;height:8px;border-radius:50%;background:' + lines[j].color + ';display:inline-block"></span><span style="color:#9ca3af">' + lines[j].label + ':</span><span style="color:#e5e7eb;font-family:monospace;margin-left:auto">' + fmtDollar(val) + '</span></div>'
    }
    el.innerHTML = html; el.style.display = 'block'
  }
  function hideTip() { var el = tooltipRef.current; if (el) el.style.display = 'none' }

  return (
    <div className="relative w-full h-full">
      <svg viewBox={'0 0 ' + W + ' ' + H} preserveAspectRatio="xMidYMid meet" className="w-full h-full" style={{ display: 'block' }}>
        {/* Shaded zones */}
        {zones && zones.map(function(z, zi) {
          var y1v = y(z.y1 !== undefined ? z.y1 : maxV)
          var y2v = y(z.y2 !== undefined ? z.y2 : minV)
          return <rect key={zi} x={pad.l} y={Math.min(y1v, y2v)} width={cW} height={Math.abs(y2v - y1v)} fill={z.color} opacity={z.opacity || 0.08} />
        })}
        {/* Grid */}
        {ticks.map(function(v, i) { return (
          <g key={i}>
            <line x1={pad.l} y1={y(v)} x2={W - pad.r} y2={y(v)} stroke="rgba(255,255,255,0.06)" />
            <text x={pad.l - 8} y={y(v) + 4} textAnchor="end" fill="#9ca3af" fontSize="10">{fmtDollar(v)}</text>
          </g>
        )})}
        {/* X labels */}
        {data.map(function(d, i) {
          if (i > 0 && i < data.length - 1 && i % labelStep !== 0) return null
          return <text key={i} x={x(i)} y={H - 6} textAnchor="middle" fill="#9ca3af" fontSize="9">{d.label}</text>
        })}
        {/* Milestone markers */}
        {milestones && milestones.map(function(m, mi) {
          if (m.idx < 0 || m.idx >= data.length) return null
          return (
            <g key={mi}>
              <line x1={x(m.idx)} y1={pad.t} x2={x(m.idx)} y2={pad.t + cH} stroke={m.color || '#8b5cf6'} strokeWidth={1} strokeDasharray="4 3" opacity={0.6} />
              <text x={x(m.idx)} y={pad.t - 4} textAnchor="middle" fill={m.color || '#8b5cf6'} fontSize="8" fontWeight="600">{m.label}</text>
            </g>
          )
        })}
        {/* Lines */}
        {lines.map(function(line) {
          var pts = data.map(function(d, i) { return x(i) + ',' + y(num(d[line.key])) }).join(' ')
          return <polyline key={line.key} points={pts} fill="none" stroke={line.color}
            strokeWidth={line.width || 2} strokeDasharray={line.dashed ? '6 4' : undefined} strokeLinejoin="round" />
        })}
        {/* Hover columns (invisible) */}
        {data.map(function(d, i) {
          return <rect key={i} x={x(i) - cW / data.length / 2} y={pad.t} width={cW / data.length} height={cH}
            fill="transparent" onMouseEnter={function() { showTip(i) }} onMouseLeave={hideTip} />
        })}
      </svg>
      {/* Tooltip (DOM ref, no state) */}
      <div ref={tooltipRef} style={{ display: 'none', position: 'absolute', top: 8, right: 8, background: 'rgba(15,17,23,0.95)', border: '1px solid #374151', borderRadius: 8, padding: '10px 14px', fontSize: 11, zIndex: 10, pointerEvents: 'none', minWidth: 170 }} />
      {/* Legend */}
      <div className="flex flex-wrap gap-3 mt-2 justify-center">
        {lines.map(function(l) { return (
          <div key={l.key} className="flex items-center gap-1.5 text-[10px] text-gray-400">
            <div style={{ width: 12, height: l.dashed ? 0 : 2, borderTop: l.dashed ? '2px dashed ' + l.color : undefined, background: l.dashed ? 'none' : l.color, borderRadius: 1 }} />
            <span>{l.label}</span>
          </div>
        )})}
      </div>
    </div>
  )
}

// ── CFOT CHART ──
function CFOTChart({ data, backup }) {
  var projects = backup.projects || []
  var chartData = data.map(function(d) {
    var label = d.start ? (function() { var dt = new Date(d.start + 'T00:00:00'); return isNaN(dt.getTime()) ? 'Wk ' + (d.wk || '?') : dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) })() : 'Wk ' + (d.wk || '?')
    return {
      label: label,
      exposure: num(d.totalExposure || (num(d.unbilled || 0) + num(d.pendingInv || 0) + Math.max(0, num(d.svc || 0) - num(d.svcCollected || 0)))),
      unbilled: num(d.unbilled || 0),
      pending: num(d.pendingInv || 0),
      svcPay: num(d.svc || 0),
      projPay: num(d.proj || 0),
      accum: num(d.accum || 0),
    }
  })

  // Build milestone markers from project payment events
  var milestones = []
  projects.forEach(function(p) {
    if (!p.lastCollectedAt) return
    var payDate = new Date(p.lastCollectedAt)
    for (var i = 0; i < data.length; i++) {
      if (!data[i].start) continue
      var ws = new Date(data[i].start), we = new Date(ws.getTime() + 7 * 86400000)
      if (payDate >= ws && payDate < we) {
        var abbr = (p.name || '').substring(0, 10)
        var amt = num(p.contract) >= 1000 ? '$' + Math.round(num(p.contract) / 1000) + 'k' : '$' + num(p.contract)
        milestones.push({ idx: i, label: abbr + ' ' + amt, color: '#8b5cf6' })
        break
      }
    }
  })

  return <SVGLineChart data={chartData} height={350} milestones={milestones} lines={[
    { key: 'exposure', color: '#ef4444', label: 'Total Exposure', width: 3 },
    { key: 'unbilled', color: '#f87171', label: 'Unbilled' },
    { key: 'pending', color: '#f59e0b', label: 'Pending Invoice' },
    { key: 'svcPay', color: '#86efac', label: 'Service Payment' },
    { key: 'projPay', color: '#16a34a', label: 'Project Payment' },
    { key: 'accum', color: '#22c55e', label: 'Accumulative Income', width: 4 },
  ]} />
}

// ── OPP CHART (horizontal bars) ──
function OPPChart({ projects, backup }) {
  if (!projects.length) return <EmptyChart />
  var maxVal = Math.max.apply(null, projects.map(function(p) { return num(p.contract) }).concat([1]))
  var barH = 28, gap = 6, padL = 140, padR = 80
  var W = 900, H = Math.max(200, projects.length * (barH + gap) + 40)

  return (
    <div className="relative w-full h-full">
      <svg viewBox={'0 0 ' + W + ' ' + H} preserveAspectRatio="xMidYMid meet" className="w-full h-full" style={{ display: 'block' }}>
        {projects.map(function(p, i) {
          var clr = health(p, backup).clr
          var w = (num(p.contract) / maxVal) * (W - padL - padR)
          var yPos = 20 + i * (barH + gap)
          return (
            <g key={p.id || i}>
              <text x={padL - 8} y={yPos + barH / 2 + 4} textAnchor="end" fill="#d1d5db" fontSize="11">
                {(p.name || 'Unknown').substring(0, 18)}
              </text>
              <rect x={padL} y={yPos} width={Math.max(w, 2)} height={barH} rx={4} fill={clr} opacity={0.85} />
              <text x={padL + Math.max(w, 2) + 8} y={yPos + barH / 2 + 4} fill="#9ca3af" fontSize="10" fontFamily="monospace">
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
var phaseNames = ['Planning', 'Estimating', 'Site Prep', 'Rough-in', 'Trim', 'Finish']
var phaseColors = ['#6b7280', '#8b5cf6', '#f59e0b', '#3b82f6', '#eab308', '#10b981']
var defaultWeights = { Planning: 5, Estimating: 10, 'Site Prep': 15, 'Rough-in': 30, Trim: 25, Finish: 15 }

function PCDChart({ projects, backup }) {
  if (!projects.length) return <EmptyChart />
  var weights = backup.settings?.phaseWeights || defaultWeights
  var barH = 26, gap = 5, padL = 140
  var W = 900, H = Math.max(200, projects.length * (barH + gap) + 60)
  var maxTotal = 100
  var barArea = W - padL - 40

  return (
    <div className="relative w-full h-full">
      <svg viewBox={'0 0 ' + W + ' ' + H} preserveAspectRatio="xMidYMid meet" className="w-full h-full" style={{ display: 'block' }}>
        {projects.map(function(p, pi) {
          var phases = p.phases || {}
          var xOff = padL
          var yPos = 20 + pi * (barH + gap)
          return (
            <g key={p.id || pi}>
              <text x={padL - 8} y={yPos + barH / 2 + 4} textAnchor="end" fill="#d1d5db" fontSize="10">
                {(p.name || '?').substring(0, 18)}
              </text>
              {phaseNames.map(function(pn, i) {
                var completion = phases[pn] || 0
                var weight = weights[pn] || 0
                var val = weight * (completion / 100)
                var w = (val / maxTotal) * barArea
                var curX = xOff
                xOff += w
                var pct = val.toFixed(0)
                return (
                  <g key={pn}>
                    <rect x={curX} y={yPos} width={Math.max(w, 0)} height={barH} fill={phaseColors[i]} />
                    {w > barArea * 0.05 && <text x={curX + w / 2} y={yPos + barH / 2 + 4} textAnchor="middle" fill="#fff" fontSize="8" fontWeight="600">{pct}%</text>}
                  </g>
                )
              })}
            </g>
          )
        })}
      </svg>
      <div className="flex flex-wrap gap-3 mt-1 justify-center">
        {phaseNames.map(function(pn, i) { return (
          <div key={pn} className="flex items-center gap-1 text-[10px] text-gray-400">
            <div className="w-2.5 h-2.5 rounded-sm" style={{ background: phaseColors[i] }} />
            <span>{pn}</span>
          </div>
        )})}
      </div>
    </div>
  )
}

// ── EVR CHART ──
function EVRChart({ projects, backup, dateStart, dateEnd }) {
  function inRange(d) { if (!d) return true; if (dateStart && d < dateStart) return false; if (dateEnd && d > dateEnd) return false; return true }
  var cumIncome = 0, cumAR = 0, cumPipeline = 0
  var chartData = projects.map(function(p) {
    var fin = getProjectFinancials(p, backup)
    var logs = (backup.logs || []).filter(function(l) { return l.projectId === p.id && inRange(l.date) })
    var income = dateStart || dateEnd ? logs.reduce(function(s, l) { return s + num(l.collected) }, 0) : fin.paid
    cumIncome += income; cumAR += Math.max(0, fin.billed - fin.paid); cumPipeline += num(p.contract)
    return { label: (p.name || '?').substring(0, 15), income: cumIncome, ar: cumAR, pipeline: cumPipeline }
  })

  return <SVGLineChart data={chartData} lines={[
    { key: 'income', color: '#10b981', label: 'Accumulated Income', width: 2 },
    { key: 'ar', color: '#ef4444', label: 'Outstanding AR', width: 2 },
    { key: 'pipeline', color: '#3b82f6', label: 'Total Pipeline', dashed: true, width: 2 },
  ]} />
}

// ── SCP CHART (grouped bars) ──
function SCPChart({ serviceLogs, backup }) {
  if (!serviceLogs.length) return <EmptyChart />
  var tooltipRef = React.useRef(null)
  var mileRate = num(backup.settings?.mileRate || 0.66)
  var items = serviceLogs.slice(-8).map(function(l) {
    var quoted = num(l.quoted), mat = num(l.materialCost || l.material), miles = num(l.mileage || 0) * mileRate
    return { label: (l.customer || '?').substring(0, 12), quoted: quoted, material: mat, profit: Math.max(0, quoted - mat - miles) }
  })
  var maxVal = 1
  for (var si = 0; si < items.length; si++) { maxVal = Math.max(maxVal, items[si].quoted, items[si].material, items[si].profit) }
  var W = 900, H = 280, pad = { t: 20, r: 20, b: 44, l: 62 }
  var cW = W - pad.l - pad.r, cH = H - pad.t - pad.b
  var groupW = cW / items.length, barW = groupW / 4

  function showTip(i) {
    var el = tooltipRef.current; if (!el) return
    el.innerHTML = '<b style="color:#fff">' + items[i].label + '</b><div style="color:#60a5fa">Quoted: ' + fmtDollar(items[i].quoted) + '</div><div style="color:#fbbf24">Material: ' + fmtDollar(items[i].material) + '</div><div style="color:#34d399">Profit: ' + fmtDollar(items[i].profit) + '</div>'
    el.style.display = 'block'
  }
  function hideTip() { if (tooltipRef.current) tooltipRef.current.style.display = 'none' }

  return (
    <div className="relative w-full h-full">
      <svg viewBox={'0 0 ' + W + ' ' + H} preserveAspectRatio="xMidYMid meet" className="w-full h-full" style={{ display: 'block' }}>
        {[0, 0.25, 0.5, 0.75, 1].map(function(f, i) {
          var v = maxVal * f, yPos = pad.t + cH - (f * cH)
          return <g key={i}><line x1={pad.l} y1={yPos} x2={W - pad.r} y2={yPos} stroke="rgba(255,255,255,0.06)" />
            <text x={pad.l - 8} y={yPos + 4} textAnchor="end" fill="#9ca3af" fontSize="10">{fmtDollar(v)}</text></g>
        })}
        {items.map(function(d, i) {
          var gx = pad.l + i * groupW + groupW * 0.1
          var bars = [
            { val: d.quoted, color: '#3b82f6' },
            { val: d.material, color: '#f59e0b' },
            { val: d.profit, color: '#10b981' },
          ]
          return (
            <g key={i} onMouseEnter={function() { showTip(i) }} onMouseLeave={hideTip}>
              {bars.map(function(b, bi) {
                var h = (b.val / maxVal) * cH
                return <rect key={bi} x={gx + bi * barW} y={pad.t + cH - h} width={barW - 2} height={h} rx={2} fill={b.color} opacity={0.85} />
              })}
              <text x={gx + barW * 1.5} y={H - 8} textAnchor="middle" fill="#9ca3af" fontSize="9">{d.label}</text>
            </g>
          )
        })}
      </svg>
      <div ref={tooltipRef} style={{ display: 'none', position: 'absolute', top: 8, right: 8, background: 'rgba(15,17,23,0.95)', border: '1px solid #374151', borderRadius: 8, padding: '10px 14px', fontSize: 11, zIndex: 10, pointerEvents: 'none', minWidth: 150 }} />
      <div className="flex gap-4 mt-1 justify-center text-[10px] text-gray-400">
        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-blue-500" /> Quoted</span>
        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-amber-500" /> Material</span>
        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-emerald-500" /> Net Profit</span>
      </div>
    </div>
  )
}

// ── RCA CHART (Revenue vs Cost with zones) ──
function RevenueCostChart({ projects, backup, dateStart, dateEnd }) {
  var mileRate = num(backup.settings?.mileRate || 0.66)
  var opCost = num(backup.settings?.opCost || 42.45)
  var logs = backup.logs || []
  function inRange(d) { if (!d) return true; if (dateStart && d < dateStart) return false; if (dateEnd && d > dateEnd) return false; return true }
  var chartData
  if (projects.length === 1) {
    var p = projects[0]
    var pLogs = logs.filter(function(l) { return l.projectId === p.id && inRange(l.date) }).sort(function(a, b) { return (a.date || '').localeCompare(b.date || '') })
    var cc = 0, cl = 0, cm = 0, cmi = 0
    chartData = pLogs.map(function(l) {
      cc += num(l.collected); cl += num(l.hrs) * opCost; cm += num(l.mat); cmi += num(l.miles || 0) * mileRate
      return { label: l.date ? new Date(l.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '?', collected: cc, labor: cl, material: cm, mileage: cmi, breakeven: cl + cm + cmi }
    })
  } else {
    chartData = projects.map(function(p) {
      var fin = getProjectFinancials(p, backup)
      var pLogs = logs.filter(function(l) { return l.projectId === p.id && inRange(l.date) })
      var hrs = pLogs.reduce(function(s, l) { return s + num(l.hrs) }, 0)
      var mat = pLogs.reduce(function(s, l) { return s + num(l.mat) }, 0)
      var mi = pLogs.reduce(function(s, l) { return s + num(l.miles || 0) }, 0)
      return { label: (p.name || '?').substring(0, 15), collected: fin.paid, labor: hrs * opCost, material: mat, mileage: mi * mileRate, breakeven: hrs * opCost + mat + mi * mileRate }
    })
  }

  // Compute zone boundaries from data
  var maxBE = 1
  for (var zi = 0; zi < (chartData || []).length; zi++) { maxBE = Math.max(maxBE, chartData[zi].breakeven || 0) }
  var zones = [
    { y1: 0, y2: maxBE * 0.7, color: '#ef4444', opacity: 0.06 },
    { y1: maxBE * 0.7, y2: maxBE, color: '#f59e0b', opacity: 0.06 },
    { y1: maxBE, y2: maxBE * 2, color: '#10b981', opacity: 0.06 },
  ]

  return <SVGLineChart data={chartData} height={380} zones={zones} lines={[
    { key: 'collected', color: '#10b981', label: 'Collected Revenue', width: 3 },
    { key: 'labor', color: '#ef4444', label: 'Labor Cost' },
    { key: 'material', color: '#f59e0b', label: 'Material Cost' },
    { key: 'mileage', color: '#8b5cf6', label: 'Mileage Cost', dashed: true },
    { key: 'breakeven', color: '#6b7280', label: 'Break-even', dashed: true },
  ]} />
}

// ── PvA CHART ──
var pvColors = ['#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899']

function PlannedVsActualChart({ projects, backup }) {
  if (!projects.length) return <EmptyChart />
  var logs = backup.logs || []
  var allDates = {}
  projects.forEach(function(p) {
    if (p.plannedStart) allDates[p.plannedStart] = 1
    if (p.plannedEnd) allDates[p.plannedEnd] = 1
    logs.filter(function(l) { return l.projectId === p.id && l.date }).forEach(function(l) { allDates[l.date] = 1 })
  })
  var sortedDates = Object.keys(allDates).sort()
  if (!sortedDates.length) return <EmptyChart />

  var lineData = []
  var chartData = sortedDates.map(function(date) {
    var row = { label: new Date(date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) }
    projects.forEach(function(p, i) {
      var pKey = 'p' + i + '_planned', aKey = 'p' + i + '_actual'
      if (p.plannedStart && p.plannedEnd && date >= p.plannedStart && date <= p.plannedEnd) row[pKey] = num(p.contract)
      var cum = logs.filter(function(l) { return l.projectId === p.id && l.date && l.date <= date }).reduce(function(s, l) { return s + num(l.collected) }, 0)
      if (cum > 0) row[aKey] = cum
    })
    return row
  })

  projects.forEach(function(p, i) {
    var c = pvColors[i % pvColors.length]
    var name = (p.name || 'Project').substring(0, 12)
    lineData.push({ key: 'p' + i + '_planned', color: c, label: name + ' (Plan)', dashed: true })
    lineData.push({ key: 'p' + i + '_actual', color: c, label: name + ' (Actual)', width: 2 })
  })

  return <SVGLineChart data={chartData} height={340} lines={lineData} />
}

// Single default export
export default { CFOTChart, OPPChart, PCDChart, EVRChart, SCPChart, RevenueCostChart, PlannedVsActualChart }
