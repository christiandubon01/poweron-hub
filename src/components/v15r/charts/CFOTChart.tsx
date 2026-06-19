// @ts-nocheck
import React, { useRef, useState, useMemo } from 'react'
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ReferenceLine, ReferenceArea } from 'recharts'
import { num, type BackupData } from '@/services/backupDataService'

const fmtDollar = (v: number) => v >= 1000 ? `$${(v / 1000).toFixed(0)}k` : `$${v}`

// Subtle ring marker placed on the Projects Total Exposure line at a project's start week.
// Future-start projects render as a hollow ring; past/current as a filled amber dot.
function ProjectStartDot(props: any) {
  const { cx, cy, payload } = props
  if (cx == null || cy == null || !payload || payload.markerY == null) return null
  const isFuture = Array.isArray(payload.markerList) && payload.markerList.some((m: any) => m.isFuture)
  return (
    <g style={{ pointerEvents: 'none' }}>
      <circle cx={cx} cy={cy} r={5} fill={isFuture ? 'none' : '#fcd34d'} stroke="#fcd34d" strokeWidth={1.5} fillOpacity={0.85} />
      <circle cx={cx} cy={cy} r={1.6} fill="#0f1117" />
    </g>
  )
}

// Custom tooltip — replicates the prior series rows and appends project-start details
// when the hovered week has one or more project-start markers.
function CFOTTooltip({ active, payload, label }: any) {
  if (!active || !payload || !payload.length) return null
  const row = payload[0] && payload[0].payload ? payload[0].payload : {}
  const markerList = Array.isArray(row.markerList) ? row.markerList : []
  const rows = payload.filter((p: any) => p.dataKey !== 'markerY' && p.value !== null && p.value !== undefined)
  return (
    <div style={{ backgroundColor: '#0f1117', border: '1px solid #374151', borderRadius: 8, padding: '8px 10px', fontSize: 12 }}>
      <div style={{ color: '#fff', fontWeight: 'bold', marginBottom: 4 }}>{label}</div>
      {rows.map((p: any, i: number) => (
        <div key={i} style={{ color: '#d1d5db', display: 'flex', justifyContent: 'space-between', gap: 14 }}>
          <span><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: p.color, marginRight: 6 }} />{p.name}</span>
          <span style={{ fontVariantNumeric: 'tabular-nums' }}>${Number(p.value).toLocaleString()}</span>
        </div>
      ))}
      {markerList.length > 0 && (
        <div style={{ marginTop: 6, paddingTop: 6, borderTop: '1px solid #374151' }}>
          {markerList.map((m: any, i: number) => (
            <div key={i} style={{ marginBottom: 2 }}>
              <div style={{ color: '#fcd34d', fontWeight: 600 }}>📍 {m.projectName}{m.isFuture ? ' (upcoming)' : ''}</div>
              <div style={{ color: '#9ca3af', marginLeft: 14 }}>
                Start {m.date} · Contract ${Number(m.contract).toLocaleString()}{m.confirmedCOTotal > 0 ? ` · CO $${Number(m.confirmedCOTotal).toLocaleString()}` : ''}
              </div>
              <div style={{ color: '#9ca3af', marginLeft: 14 }}>+${Number(m.exposureAdded).toLocaleString()} exposure added</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default function CFOTChart({ data, backup, markers = [] }: { data: any[]; backup: BackupData; markers?: any[] }) {
  // Map markers by the CFOT week-start ISO they belong to (groups projects starting the same week).
  const markersByWeek = useMemo(() => {
    const m: Record<string, any[]> = {}
    for (const mk of (markers || [])) {
      if (!mk || !mk.weekStartIso) continue
      ;(m[mk.weekStartIso] = m[mk.weekStartIso] || []).push(mk)
    }
    return m
  }, [markers])

  const chartData = useMemo(() => (data || []).map(d => {
    const label = (() => {
      if (!d.start) return `Wk ${d.wk ?? '?'}`
      const dt = new Date(d.start + 'T00:00:00')
      return isNaN(dt.getTime()) ? `Wk ${d.wk ?? '?'}` : dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    })()
    const isProjection = !!d.isProjection
    const nv = (v: any) => (v === null || v === undefined ? null : num(v))
    const markerList = markersByWeek[d.start] || null
    // Place the marker dot on the relevant total-exposure line for that week.
    const totalForWeek = isProjection ? nv(d.projectedTotalExposure) : nv(d.totalExposure)
    return {
      name: label,
      startIso: d.start,
      isProjection,
      exposure: isProjection ? null : nv(d.totalExposure),
      activeExposure: isProjection ? null : nv(d.activeExposure),
      // Projected Total Exposure spans the Now boundary into the gray future area.
      projectedTotalExposure: nv(d.projectedTotalExposure),
      serviceExposure: isProjection ? null : nv(d.serviceExposure),
      pending: nv(d.pendingInv),
      svcPay: nv(d.svc),
      projPay: nv(d.proj),
      accum: nv(d.accum),
      markerY: markerList ? totalForWeek : null,
      markerList,
    }
  }), [data, markersByWeek])

  // ── Swipe / drag timeline window (no zoom; fixed-size window slides across all rows) ──
  const total = chartData.length
  const windowSize = Math.min(total || 1, 32)
  const maxStart = Math.max(0, total - windowSize)
  const canSwipe = total > windowSize
  const [startIdx, setStartIdx] = useState(maxStart) // default: most recent range (incl. future)
  const containerRef = useRef<HTMLDivElement>(null)
  const drag = useRef<{ active: boolean; startX: number; startIdx: number; moved: boolean }>({ active: false, startX: 0, startIdx: 0, moved: false })

  if (!data || !data.length) return <div className="flex items-center justify-center h-full text-gray-500 text-sm">No weekly data</div>

  const clamp = (v: number) => Math.max(0, Math.min(maxStart, v))
  const safeStart = clamp(startIdx)
  const visibleData = canSwipe ? chartData.slice(safeStart, safeStart + windowSize) : chartData
  const step = Math.max(1, Math.floor(windowSize / 2))
  const rangeLabel = visibleData.length ? `${visibleData[0].name} – ${visibleData[visibleData.length - 1].name}` : ''

  const onPointerDown = (e: React.PointerEvent) => {
    if (!canSwipe) return
    drag.current = { active: true, startX: e.clientX, startIdx: safeStart, moved: false }
  }
  const onPointerMove = (e: React.PointerEvent) => {
    if (!canSwipe || !drag.current.active) return
    const dx = e.clientX - drag.current.startX
    if (!drag.current.moved && Math.abs(dx) < 6) return // small movement = tap/hover, let tooltip work
    drag.current.moved = true
    const w = containerRef.current ? containerRef.current.offsetWidth : 600
    const pointWidth = w / windowSize
    const pointsMoved = Math.round(-dx / pointWidth) // drag left → window forward in time
    setStartIdx(clamp(drag.current.startIdx + pointsMoved))
  }
  const endDrag = () => { drag.current.active = false }

  // Now-marker, future area, and X tick density are derived from the VISIBLE slice.
  const firstProjectionIdx = visibleData.findIndex(d => d.isProjection)
  const currentWeekLabel = firstProjectionIdx > 0 ? visibleData[firstProjectionIdx - 1].name : null
  const projectionStartLabel = firstProjectionIdx >= 0 ? visibleData[firstProjectionIdx].name : null
  const projectionEndLabel = visibleData[visibleData.length - 1]?.name
  const xInterval = Math.max(0, Math.floor(visibleData.length / 9))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%' }}>
      {canSwipe && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, color: '#9ca3af' }}>{rangeLabel}</span>
          <div style={{ display: 'flex', gap: 6 }}>
            <button type="button" onClick={() => setStartIdx(clamp(safeStart - step))} disabled={safeStart <= 0}
              style={{ fontSize: 11, padding: '2px 8px', borderRadius: 6, border: '1px solid #374151', background: 'var(--bg-input)', color: '#d1d5db', cursor: safeStart <= 0 ? 'default' : 'pointer', opacity: safeStart <= 0 ? 0.4 : 1 }}>← Earlier</button>
            <button type="button" onClick={() => setStartIdx(maxStart)}
              style={{ fontSize: 11, padding: '2px 8px', borderRadius: 6, border: '1px solid #374151', background: 'var(--bg-input)', color: '#d1d5db', cursor: 'pointer' }}>Reset</button>
            <button type="button" onClick={() => setStartIdx(clamp(safeStart + step))} disabled={safeStart >= maxStart}
              style={{ fontSize: 11, padding: '2px 8px', borderRadius: 6, border: '1px solid #374151', background: 'var(--bg-input)', color: '#d1d5db', cursor: safeStart >= maxStart ? 'default' : 'pointer', opacity: safeStart >= maxStart ? 0.4 : 1 }}>Later →</button>
          </div>
        </div>
      )}
      <div
        ref={containerRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onPointerLeave={endDrag}
        style={{ flex: 1, minHeight: 0, width: '100%', touchAction: 'pan-y', cursor: canSwipe ? 'grab' : 'default' }}
      >
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={visibleData} margin={{ top: 5, right: 20, bottom: 5, left: 10 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
            <XAxis dataKey="name" tick={{ fill: '#9ca3af', fontSize: 10 }} interval={xInterval} />
            <YAxis tickFormatter={fmtDollar} tick={{ fill: '#9ca3af', fontSize: 11 }} />
            <Tooltip content={<CFOTTooltip />} />
            <Legend wrapperStyle={{ color: '#d1d5db', fontSize: 12 }} />

            {projectionStartLabel && projectionEndLabel && (
              <ReferenceArea x1={projectionStartLabel} x2={projectionEndLabel} fill="rgba(255,255,255,0.025)" stroke="none" />
            )}

            {currentWeekLabel && (
              <ReferenceLine
                x={currentWeekLabel}
                stroke="#9ca3af"
                strokeDasharray="5 4"
                label={{ value: 'Now', position: 'insideTopRight', fill: '#9ca3af', fontSize: 10 }}
              />
            )}

            <Line type="monotone" dataKey="exposure" name="Projects Total Exposure" stroke="#dc2626" strokeWidth={3} dot={false} connectNulls={false} />
            <Line type="monotone" dataKey="activeExposure" name="Active Exposure" stroke="#fb923c" strokeWidth={2.5} dot={false} connectNulls={false} />
            <Line type="monotone" dataKey="projectedTotalExposure" name="Projected Total Exposure" stroke="#fdba74" strokeWidth={2} strokeDasharray="6 4" strokeOpacity={0.85} dot={false} connectNulls={false} />
            <Line type="monotone" dataKey="serviceExposure" name="Service Calls Exposure" stroke="#fca5a5" strokeWidth={2} dot={false} connectNulls={false} />
            <Line type="monotone" dataKey="pending" name="Pending Invoice" stroke="#f59e0b" strokeWidth={2} dot={false} connectNulls={false} />
            <Line type="monotone" dataKey="svcPay" name="Service Payment" stroke="#86efac" strokeWidth={2} dot={false} connectNulls={false} />
            <Line type="monotone" dataKey="projPay" name="Project Payment" stroke="#16a34a" strokeWidth={2} dot={false} connectNulls={false} />
            <Line type="monotone" dataKey="accum" name="Accumulative Income" stroke="#14532d" strokeWidth={3} dot={false} connectNulls={false} />
            {/* Project-start markers — invisible line, custom dots only; hidden from legend. */}
            <Line type="monotone" dataKey="markerY" name="Project start" legendType="none" stroke="transparent" strokeWidth={0} isAnimationActive={false} connectNulls={false} dot={<ProjectStartDot />} activeDot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
