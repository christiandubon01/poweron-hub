// @ts-nocheck
import React, { useRef, useState, useMemo, useEffect } from 'react'
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ReferenceLine, ReferenceArea } from 'recharts'
import { num, type BackupData } from '@/services/backupDataService'

const fmtDollar = (v: number) => v >= 1000 ? `$${(v / 1000).toFixed(0)}k` : `$${v}`

// Source classification — used by tooltip filtering and Y-domain calculation.
const PROJECT_KEYS = new Set(['exposure', 'activeExposure', 'projectedTotalExposure', 'projPay'])
const SERVICE_KEYS = new Set(['serviceExposure', 'pending', 'svcPay'])
// 'accum' is combined-only — excluded when only one source is active.

// ── Project start dot — amber ring placed on the Projects Total Exposure line ──
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

// ── Service call dot — coral filled circle on the Service Calls Exposure line ──
// count > 1 renders slightly larger + a small count badge above-right.
function ServiceCallDot(props: any) {
  const { cx, cy, payload } = props
  if (cx == null || cy == null || !payload || payload.svcMarkerY == null) return null
  const count = Array.isArray(payload.svcMarkerList) ? payload.svcMarkerList.length : 1
  const r = count > 1 ? 6.5 : 5
  return (
    <g style={{ pointerEvents: 'none' }}>
      <circle cx={cx} cy={cy} r={r} fill="#fb7185" stroke="#fca5a5" strokeWidth={1.2} fillOpacity={0.92} />
      <circle cx={cx} cy={cy} r={2} fill="#0f1117" />
      {count > 1 && (
        <text x={cx + r - 1} y={cy - r + 1} fontSize={7} fill="#fca5a5" fontWeight={700}
          textAnchor="start" dominantBaseline="auto">{count}</text>
      )}
    </g>
  )
}

// ── Custom tooltip — filters rows and marker details by active source toggles ──
function CFOTTooltip({ active, payload, label, showProjects, showServiceCalls }: any) {
  if (!active || !payload || !payload.length) return null
  const row = payload[0] && payload[0].payload ? payload[0].payload : {}
  const markerList = Array.isArray(row.markerList) ? row.markerList : []
  const svcMarkerList = Array.isArray(row.svcMarkerList) ? row.svcMarkerList : []
  const rows = payload.filter((p: any) => {
    if (p.dataKey === 'markerY' || p.dataKey === 'svcMarkerY') return false
    if (p.value === null || p.value === undefined) return false
    if (PROJECT_KEYS.has(p.dataKey)) return showProjects
    if (SERVICE_KEYS.has(p.dataKey)) return showServiceCalls
    return showProjects && showServiceCalls
  })
  if (!rows.length && !markerList.length && !svcMarkerList.length) return null
  return (
    <div style={{ backgroundColor: '#0f1117', border: '1px solid #374151', borderRadius: 8, padding: '8px 10px', fontSize: 12, maxWidth: 280 }}>
      <div style={{ color: '#fff', fontWeight: 'bold', marginBottom: 4 }}>{label}</div>
      {rows.map((p: any, i: number) => (
        <div key={i} style={{ color: '#d1d5db', display: 'flex', justifyContent: 'space-between', gap: 14 }}>
          <span><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: p.color, marginRight: 6 }} />{p.name}</span>
          <span style={{ fontVariantNumeric: 'tabular-nums' }}>${Number(p.value).toLocaleString()}</span>
        </div>
      ))}
      {/* Project-start marker details */}
      {showProjects && markerList.length > 0 && (
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
      {/* Service-call marker details */}
      {showServiceCalls && svcMarkerList.length > 0 && (
        <div style={{ marginTop: 6, paddingTop: 6, borderTop: '1px solid #374151' }}>
          {svcMarkerList.map((m: any, i: number) => (
            <div key={i} style={{ marginBottom: 4 }}>
              <div style={{ color: '#fca5a5', fontWeight: 600 }}>🔧 {m.name}</div>
              <div style={{ color: '#9ca3af', marginLeft: 14 }}>{m.date} · Quoted ${Number(m.quoted).toLocaleString()}</div>
              <div style={{ color: '#9ca3af', marginLeft: 14 }}>
                Collected ${Number(m.collected).toLocaleString()} · Remaining ${Number(m.remaining).toLocaleString()}
              </div>
              {m.status && (
                <div style={{ color: '#6b7280', marginLeft: 14, fontSize: 11 }}>Status: {m.status}</div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// Zoom range options and their approximate week counts (data is weekly).
const ZOOM_OPTIONS = ['1M', '3M', '6M', '1Y', 'All'] as const
type ZoomRange = typeof ZOOM_OPTIONS[number]
const ZOOM_WEEKS: Record<string, number> = { '1M': 5, '3M': 13, '6M': 26, '1Y': 52 }

const BTN_BASE: React.CSSProperties = {
  fontSize: 11, padding: '2px 8px', borderRadius: 6, cursor: 'pointer',
  border: '1px solid #374151', background: 'var(--bg-input)', color: '#d1d5db',
}

export default function CFOTChart({ data, backup, markers = [] }: { data: any[]; backup: BackupData; markers?: any[] }) {
  // ── Project marker grouping by week-start ISO (unchanged) ──
  const markersByWeek = useMemo(() => {
    const m: Record<string, any[]> = {}
    for (const mk of (markers || [])) {
      if (!mk || !mk.weekStartIso) continue
      ;(m[mk.weekStartIso] = m[mk.weekStartIso] || []).push(mk)
    }
    return m
  }, [markers])

  // ── Service call marker grouping by week-start ISO ──
  // Includes ALL service logs (active, paid, archived) — every real service-call
  // event deserves a dot on the timeline, the same way project dots mark project
  // exposure events regardless of payment state.
  const svcMarkersByWeek = useMemo(() => {
    const serviceLogs = backup?.serviceLogs || []
    if (!serviceLogs.length || !data || !data.length) return {}

    // Build week timeline from data (same date structure as cfotData in dashboard)
    const weekStarts = (data || [])
      .map(d => ({ iso: d.start, t: d.start ? new Date(d.start + 'T00:00:00').getTime() : 0 }))
      .filter(w => w.t > 0)
    if (!weekStarts.length) return {}

    const firstT = weekStarts[0].t
    const lastT = weekStarts[weekStarts.length - 1].t
    const m: Record<string, any[]> = {}

    for (const log of serviceLogs) {
      const quoted = num(log.quoted)
      const collected = num(log.collected)
      const remaining = Math.max(0, quoted - collected)

      // Skip logs with no financial data at all AND no meaningful status
      if (quoted === 0 && collected === 0 && !log.payStatus && !log.serviceStatus) continue

      // Date priority: date → serviceDate → scheduledDate → createdAt
      const dateRaw = log.date || log.serviceDate || log.scheduledDate || log.createdAt
      if (!dateRaw) continue
      const d = new Date(String(dateRaw).includes('T') ? dateRaw : dateRaw + 'T00:00:00')
      if (isNaN(d.getTime())) continue
      d.setHours(0, 0, 0, 0)
      const t = d.getTime()

      // Find the week this service call falls in
      let idx = 0
      if (t <= firstT) idx = 0
      else if (t >= lastT) idx = weekStarts.length - 1
      else { for (let i = 0; i < weekStarts.length; i++) { if (weekStarts[i].t <= t) idx = i; else break } }

      const weekIso = weekStarts[idx].iso
      if (!weekIso) continue

      ;(m[weekIso] = m[weekIso] || []).push({
        id: log.id || String(t + Math.random()),
        name: (log.customer || log.projName || '').trim() || '(unnamed)',
        date: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
        quoted,
        collected,
        remaining,
        status: log.payStatus || log.serviceStatus || '',
      })
    }
    return m
  }, [backup, data])

  // ── Chart data transform (math/shape unchanged) ──
  const chartData = useMemo(() => (data || []).map(d => {
    const label = (() => {
      if (!d.start) return `Wk ${d.wk ?? '?'}`
      const dt = new Date(d.start + 'T00:00:00')
      return isNaN(dt.getTime()) ? `Wk ${d.wk ?? '?'}` : dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    })()
    const isProjection = !!d.isProjection
    const nv = (v: any) => (v === null || v === undefined ? null : num(v))
    const markerList = markersByWeek[d.start] || null
    const totalForWeek = isProjection ? nv(d.projectedTotalExposure) : nv(d.totalExposure)
    // Service markers shown on historical (non-projection) weeks only.
    // Y-position priority: Service Calls Exposure > Service Payment > Pending Invoice > 0 (baseline).
    // Using 0 (not null) as the last resort keeps the dot visible at the chart baseline
    // even for fully-paid weeks where all service lines read zero.
    const svcMarkerList = svcMarkersByWeek[d.start] || null
    const svcExp = isProjection ? null : nv(d.serviceExposure)
    const svcPmt = isProjection ? null : nv(d.svc)
    const svcPend = isProjection ? null : nv(d.pendingInv)
    const svcForWeek = isProjection ? null : (
      svcMarkerList
        ? (svcExp != null && svcExp > 0 ? svcExp
          : svcPmt != null && svcPmt > 0 ? svcPmt
          : svcPend != null && svcPend > 0 ? svcPend
          : 0)
        : null
    )
    return {
      name: label,
      startIso: d.start,
      isProjection,
      exposure: isProjection ? null : nv(d.totalExposure),
      activeExposure: isProjection ? null : nv(d.activeExposure),
      projectedTotalExposure: nv(d.projectedTotalExposure),
      serviceExposure: isProjection ? null : nv(d.serviceExposure),
      pending: nv(d.pendingInv),
      svcPay: nv(d.svc),
      projPay: nv(d.proj),
      accum: nv(d.accum),
      markerY: markerList ? totalForWeek : null,
      markerList,
      svcMarkerY: svcMarkerList ? svcForWeek : null,
      svcMarkerList,
    }
  }), [data, markersByWeek, svcMarkersByWeek])

  // ── Index of the last historical (non-projection) row = "Now" boundary ──
  const nowIndex = useMemo(() => {
    const idx = chartData.findIndex(d => d.isProjection)
    return idx > 0 ? idx - 1 : chartData.length - 1
  }, [chartData])

  // ── Source toggle state — both ON by default ──
  const [showProjects, setShowProjects] = useState(true)
  const [showServiceCalls, setShowServiceCalls] = useState(true)

  // At least one source must always be active.
  const toggleProjects = () => {
    if (showProjects && !showServiceCalls) return
    setShowProjects(v => !v)
  }
  const toggleServiceCalls = () => {
    if (showServiceCalls && !showProjects) return
    setShowServiceCalls(v => !v)
  }

  // ── Source-aware stable Y domain — no bouncing during pan; recalculates on toggle only ──
  const fullYDomain = useMemo(() => {
    const activeKeys: string[] = []
    if (showProjects) activeKeys.push('exposure', 'activeExposure', 'projectedTotalExposure', 'projPay')
    if (showServiceCalls) activeKeys.push('serviceExposure', 'pending', 'svcPay')
    if (showProjects && showServiceCalls) activeKeys.push('accum')

    let minVal = 0
    let maxVal = 0
    for (const row of chartData) {
      for (const key of activeKeys) {
        const v = row[key]
        if (v != null && !isNaN(v)) {
          if (v < minVal) minVal = v
          if (v > maxVal) maxVal = v
        }
      }
      if (showProjects && row.markerY != null && !isNaN(row.markerY) && row.markerY > maxVal) maxVal = row.markerY
      if (showServiceCalls && row.svcMarkerY != null && !isNaN(row.svcMarkerY) && row.svcMarkerY > maxVal) maxVal = row.svcMarkerY
    }
    const topPad = maxVal * 0.1
    return [minVal < 0 ? Math.floor(minVal * 1.1) : 0, Math.ceil(maxVal + topPad)]
  }, [chartData, showProjects, showServiceCalls])

  // ── Zoom + pan state ──
  const [zoomRange, setZoomRange] = useState<ZoomRange>('6M')

  const total = chartData.length
  const windowSize = zoomRange === 'All' ? total : Math.min(total || 1, ZOOM_WEEKS[zoomRange] ?? 26)
  const maxStart = Math.max(0, total - windowSize)
  const canSwipe = total > windowSize

  // Refs so wheel/overlay handlers always have fresh values without stale closures
  const canSwipeRef = useRef(canSwipe)
  const windowSizeRef = useRef(windowSize)
  const maxStartRef = useRef(maxStart)
  canSwipeRef.current = canSwipe
  windowSizeRef.current = windowSize
  maxStartRef.current = maxStart

  // Compute a start index anchoring the view 90% past / 10% future relative to Now.
  const anchorAtNow = (win: number): number => {
    const futureCount = Math.max(1, Math.round(win * 0.10))
    const rawStart = nowIndex + futureCount - win + 1
    const newMax = Math.max(0, total - win)
    return Math.max(0, Math.min(newMax, rawStart))
  }

  // Initial view: 6M window anchored at Now (90% past, 10% future).
  const [startIdx, setStartIdx] = useState(() => anchorAtNow(Math.min(total || 1, ZOOM_WEEKS['6M'])))

  // Safety: re-anchor once if data loads after mount.
  const anchoredRef = useRef(false)
  useEffect(() => {
    if (anchoredRef.current || !total) return
    anchoredRef.current = true
    const win = Math.min(total, ZOOM_WEEKS['6M'])
    setStartIdx(anchorAtNow(win))
  }, [total]) // eslint-disable-line react-hooks/exhaustive-deps

  const containerRef = useRef<HTMLDivElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)
  const drag = useRef({ active: false, startX: 0, startIdx: 0, moved: false, pendingIdx: 0, rafPending: false })

  // ── Non-passive wheel listener — horizontal trackpad / Shift+wheel pan ──
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const handler = (e: WheelEvent) => {
      if (!canSwipeRef.current) return
      const isHoriz = Math.abs(e.deltaX) > Math.abs(e.deltaY) * 0.7
      const isShiftVert = e.shiftKey && Math.abs(e.deltaY) > 2
      if (!isHoriz && !isShiftVert) return
      e.preventDefault()
      const delta = isHoriz ? e.deltaX : e.deltaY
      const pw = el.offsetWidth / windowSizeRef.current
      const pts = Math.round(delta / pw)
      if (pts === 0) return
      setStartIdx(prev => Math.max(0, Math.min(maxStartRef.current, prev + pts)))
    }
    el.addEventListener('wheel', handler, { passive: false })
    return () => el.removeEventListener('wheel', handler)
  }, [])

  if (!data || !data.length) return <div className="flex items-center justify-center h-full text-gray-500 text-sm">No weekly data</div>

  const clamp = (v: number) => Math.max(0, Math.min(maxStart, v))
  const safeStart = clamp(startIdx)
  const visibleData = canSwipe ? chartData.slice(safeStart, safeStart + windowSize) : chartData
  const step = Math.max(1, Math.floor(windowSize / 4))
  const rangeLabel = visibleData.length ? `${visibleData[0].name} – ${visibleData[visibleData.length - 1].name}` : ''

  // ── Pointer drag handlers ──
  const onPointerDown = (e: React.PointerEvent) => {
    if (!canSwipe) return
    drag.current = { active: true, startX: e.clientX, startIdx: safeStart, moved: false, pendingIdx: safeStart, rafPending: false }
    const overlay = overlayRef.current
    if (overlay) {
      overlay.style.pointerEvents = 'all'
      overlay.style.cursor = 'grabbing'
      try { overlay.setPointerCapture(e.pointerId) } catch (_) {}
    }
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current.active) return
    const dx = e.clientX - drag.current.startX
    if (!drag.current.moved && Math.abs(dx) < 6) return
    drag.current.moved = true
    const w = containerRef.current ? containerRef.current.offsetWidth : 600
    const pointWidth = w / windowSizeRef.current
    const newIdx = Math.max(0, Math.min(maxStartRef.current, drag.current.startIdx + Math.round(-dx / pointWidth)))
    drag.current.pendingIdx = newIdx
    if (!drag.current.rafPending) {
      drag.current.rafPending = true
      requestAnimationFrame(() => {
        drag.current.rafPending = false
        setStartIdx(drag.current.pendingIdx)
      })
    }
  }

  const endDrag = () => {
    drag.current.active = false
    const overlay = overlayRef.current
    if (overlay) { overlay.style.pointerEvents = 'none'; overlay.style.cursor = '' }
  }

  // ── Zoom change: anchor 90% past / 10% future around Now ──
  const handleZoomChange = (range: ZoomRange) => {
    if (range === 'All') { setZoomRange(range); setStartIdx(0); return }
    const newWin = Math.min(total, ZOOM_WEEKS[range] ?? 26)
    setZoomRange(range)
    setStartIdx(anchorAtNow(newWin))
  }

  const handleReset = () => {
    const newWin = Math.min(total, ZOOM_WEEKS['6M'])
    setZoomRange('6M')
    setStartIdx(anchorAtNow(newWin))
  }

  // Now-marker and future area from the VISIBLE slice
  const firstProjectionIdx = visibleData.findIndex(d => d.isProjection)
  const currentWeekLabel = firstProjectionIdx > 0 ? visibleData[firstProjectionIdx - 1].name : null
  const projectionStartLabel = firstProjectionIdx >= 0 ? visibleData[firstProjectionIdx].name : null
  const projectionEndLabel = visibleData[visibleData.length - 1]?.name
  const xInterval = Math.max(0, Math.floor(visibleData.length / 9))

  // Toggle pill style
  const pillStyle = (active: boolean, activeColor: string, activeBg: string): React.CSSProperties => ({
    fontSize: 11, padding: '2px 10px', borderRadius: 20, cursor: 'pointer',
    border: '1px solid',
    borderColor: active ? activeColor : '#374151',
    background: active ? activeBg : 'transparent',
    color: active ? activeColor : '#6b7280',
    fontWeight: active ? 600 : 400,
    transition: 'all 0.12s ease',
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%' }}>

      {/* ── Row 1: Source toggles — right-aligned above the range controls ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6, marginBottom: 3, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 10, color: '#6b7280', userSelect: 'none', letterSpacing: '0.05em' }}>SOURCES</span>
        <button type="button" onClick={toggleProjects}
          style={pillStyle(showProjects, '#a5b4fc', 'rgba(99,102,241,0.14)')}>
          Projects
        </button>
        <button type="button" onClick={toggleServiceCalls}
          style={pillStyle(showServiceCalls, '#fca5a5', 'rgba(252,165,165,0.12)')}>
          Service Calls
        </button>
        {(!showProjects || !showServiceCalls) && (
          <span style={{ fontSize: 10, color: '#4b5563', userSelect: 'none' }}>
            · {showProjects ? 'projects only' : 'service calls only'}
          </span>
        )}
      </div>

      {/* ── Row 2: Range label + zoom/pan controls ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <span style={{ fontSize: 11, color: '#9ca3af', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{rangeLabel}</span>
          {canSwipe && <span style={{ fontSize: 10, color: '#6b7280', whiteSpace: 'nowrap' }}>· drag or scroll to pan</span>}
        </div>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexShrink: 0 }}>
          {ZOOM_OPTIONS.map(range => (
            <button key={range} type="button" onClick={() => handleZoomChange(range)} style={{
              ...BTN_BASE,
              borderColor: zoomRange === range ? '#6366f1' : '#374151',
              background: zoomRange === range ? 'rgba(99,102,241,0.15)' : 'var(--bg-input)',
              color: zoomRange === range ? '#a5b4fc' : '#d1d5db',
              fontWeight: zoomRange === range ? 600 : 400,
            }}>
              {range}
            </button>
          ))}
          <span style={{ color: '#374151', fontSize: 13, userSelect: 'none' }}>|</span>
          {canSwipe && (
            <>
              <button type="button" onClick={() => setStartIdx(clamp(safeStart - step))} disabled={safeStart <= 0}
                style={{ ...BTN_BASE, cursor: safeStart <= 0 ? 'default' : 'pointer', opacity: safeStart <= 0 ? 0.4 : 1 }}>← Earlier</button>
              <button type="button" onClick={() => setStartIdx(clamp(safeStart + step))} disabled={safeStart >= maxStart}
                style={{ ...BTN_BASE, cursor: safeStart >= maxStart ? 'default' : 'pointer', opacity: safeStart >= maxStart ? 0.4 : 1 }}>Later →</button>
            </>
          )}
          <button type="button" onClick={handleReset} style={{ ...BTN_BASE, color: '#9ca3af' }}>Reset</button>
        </div>
      </div>

      {/* ── Chart interaction area ── */}
      <div
        ref={containerRef}
        onPointerDown={onPointerDown}
        style={{ position: 'relative', flex: 1, minHeight: 0, width: '100%', cursor: canSwipe ? 'grab' : 'default' }}
      >
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={visibleData} margin={{ top: 5, right: 20, bottom: 5, left: 10 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
            <XAxis dataKey="name" tick={{ fill: '#9ca3af', fontSize: 10 }} interval={xInterval} />
            <YAxis tickFormatter={fmtDollar} tick={{ fill: '#9ca3af', fontSize: 11 }} domain={fullYDomain} />
            <Tooltip content={<CFOTTooltip showProjects={showProjects} showServiceCalls={showServiceCalls} />} />
            <Legend wrapperStyle={{ color: '#d1d5db', fontSize: 12 }} />

            {/* Future gray area */}
            {projectionStartLabel && projectionEndLabel && (
              <ReferenceArea x1={projectionStartLabel} x2={projectionEndLabel} fill="rgba(255,255,255,0.025)" stroke="none" />
            )}

            {/* Now marker */}
            {currentWeekLabel && (
              <ReferenceLine x={currentWeekLabel} stroke="#9ca3af" strokeDasharray="5 4"
                label={{ value: 'Now', position: 'insideTopRight', fill: '#9ca3af', fontSize: 10 }} />
            )}

            {/* ── Project series ── */}
            {showProjects && <Line type="monotone" dataKey="exposure" name="Projects Total Exposure" stroke="#dc2626" strokeWidth={3} dot={false} connectNulls={false} isAnimationActive={false} />}
            {showProjects && <Line type="monotone" dataKey="activeExposure" name="Active Exposure" stroke="#fb923c" strokeWidth={2.5} dot={false} connectNulls={false} isAnimationActive={false} />}
            {showProjects && <Line type="monotone" dataKey="projectedTotalExposure" name="Projected Total Exposure" stroke="#fdba74" strokeWidth={2} strokeDasharray="6 4" strokeOpacity={0.85} dot={false} connectNulls={false} isAnimationActive={false} />}
            {showProjects && <Line type="monotone" dataKey="projPay" name="Project Payment" stroke="#16a34a" strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={false} />}

            {/* ── Service Calls series ── */}
            {showServiceCalls && <Line type="monotone" dataKey="serviceExposure" name="Service Calls Exposure" stroke="#fca5a5" strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={false} />}
            {showServiceCalls && <Line type="monotone" dataKey="pending" name="Pending Invoice" stroke="#f59e0b" strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={false} />}
            {showServiceCalls && <Line type="monotone" dataKey="svcPay" name="Service Payment" stroke="#86efac" strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={false} />}

            {/* ── Combined-only ── */}
            {showProjects && showServiceCalls && <Line type="monotone" dataKey="accum" name="Accumulative Income" stroke="#14532d" strokeWidth={3} dot={false} connectNulls={false} isAnimationActive={false} />}

            {/* ── Project start markers — amber ring on Projects Total Exposure line ── */}
            {showProjects && (
              <Line type="monotone" dataKey="markerY" name="Project start" legendType="none"
                stroke="transparent" strokeWidth={0} isAnimationActive={false}
                connectNulls={false} dot={<ProjectStartDot />} activeDot={false} />
            )}

            {/* ── Service call markers — pink square on Service Calls Exposure line ── */}
            {showServiceCalls && (
              <Line type="monotone" dataKey="svcMarkerY" name="Service call" legendType="none"
                stroke="transparent" strokeWidth={0} isAnimationActive={false}
                connectNulls={false} dot={<ServiceCallDot />} activeDot={false} />
            )}
          </LineChart>
        </ResponsiveContainer>

        {/* Transparent drag-capture overlay */}
        <div
          ref={overlayRef}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          style={{ position: 'absolute', inset: 0, zIndex: 1, pointerEvents: 'none', touchAction: 'pan-y' }}
        />
      </div>
    </div>
  )
}
