// @ts-nocheck
/**
 * V15rDashboard — Graph Dashboard with Chart.js canvas-based charts
 *
 * Fixes:
 * 1. ErrorBoundary to catch and display chart errors
 * 2. CFOT (Cash Flow Over Time) — Line chart with 3 series + tooltips + cleanup
 * 3. OPP (Open Projects Pipeline) — Horizontal bar chart with health colors + cleanup
 * 4. PCD (Project Completion Distribution) — Stacked horizontal bar by phase + cleanup
 * 5. EVR (Exposure vs Revenue) — Line chart cumulative by project + cleanup
 * 6. All undefined variable references fixed
 * 7. Chart instances properly destroyed on unmount
 */

import React, { useState, useEffect, useRef, useMemo } from 'react'
import { BarChart3, Brain } from 'lucide-react'
import { getBackupData, getProjectFinancials, health, num, fmtK, type BackupData } from '@/services/backupDataService'
import { callClaude, extractText } from '@/services/claudeProxy'

// ── ERROR BOUNDARY ──
class ChartErrorBoundary extends React.Component<{children: React.ReactNode}, {hasError: boolean, error: string}> {
  state = { hasError: false, error: '' }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error: error.message }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('ChartErrorBoundary caught error:', error, errorInfo)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex items-center justify-center h-full bg-[var(--bg-card)] rounded-lg p-6 text-red-400">
          <div className="text-center">
            <p className="font-semibold mb-2">Chart Error</p>
            <p className="text-sm">{this.state.error}</p>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

// ── HELPER: Dynamically load Chart.js from CDN ──
function useChartJS() {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    if ((window as any).Chart) {
      setReady(true)
      return
    }
    const s = document.createElement('script')
    s.src = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js'
    s.onload = () => setReady(true)
    s.onerror = () => console.error('Failed to load Chart.js')
    document.head.appendChild(s)
  }, [])
  return ready
}

// ── CFOT CHART COMPONENT (Google Sheets match) ──
function CFOTChart({ data, backup }: { data: any[], backup: BackupData }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const chartRef = useRef<any>(null)
  const chartReady = useChartJS()

  useEffect(() => {
    if (!chartReady || !canvasRef.current || !data.length) return

    const Chart = (window as any).Chart
    if (!Chart) return

    // Destroy existing chart
    if (chartRef.current) {
      chartRef.current.destroy()
      chartRef.current = null
    }

    const ctx = canvasRef.current.getContext('2d')
    if (!ctx) return

    // Build labels from week start dates
    const labels = data.map(d => {
      if (!d.start) return `Wk ${d.wk}`
      const dt = new Date(d.start)
      return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    })

    // Series data
    const totalExposureData = data.map(d => num(d.totalExposure || (num(d.unbilled || 0) + num(d.pendingInv || 0) + Math.max(0, num(d.svc || 0) - num(d.svcCollected || 0)))))
    const unbilledData = data.map(d => num(d.unbilled || 0))
    const pendingInvData = data.map(d => num(d.pendingInv || 0))
    const svcPaymentData = data.map(d => num(d.svc || 0))
    const projPaymentData = data.map(d => num(d.proj || 0))
    const accumData = data.map(d => num(d.accum || 0))

    // Identify gap weeks (past, zero activity)
    const today = new Date()
    const gapIndices = data.map((d, i) => {
      const weekStart = d.start ? new Date(d.start) : null
      const isPast = weekStart && weekStart < today
      const noActivity = num(d.proj) === 0 && num(d.svc) === 0
      return isPast && noActivity
    })

    // Build milestone markers from projects
    const projects = backup.projects || []
    const milestones: Array<{weekIdx: number, label: string, color: string}> = []
    projects.forEach(p => {
      if (!p.status || p.status === 'coming') return
      // Find the week when project became active or first payment
      const firstPayDate = p.lastCollectedAt || ''
      if (firstPayDate) {
        const payDate = new Date(firstPayDate)
        const matchIdx = data.findIndex(d => {
          if (!d.start) return false
          const ws = new Date(d.start)
          const we = new Date(ws.getTime() + 7 * 86400000)
          return payDate >= ws && payDate < we
        })
        if (matchIdx >= 0) {
          const abbrev = (p.name || '').substring(0, 12)
          const amt = num(p.contract) >= 1000 ? `$${Math.round(num(p.contract) / 1000)}k` : `$${num(p.contract)}`
          const typeColors: any = { 'New Construction': '#3b82f6', 'Commercial TI': '#eab308', 'Service': '#10b981', 'Solar': '#f97316' }
          milestones.push({
            weekIdx: matchIdx,
            label: `${abbrev} ${amt}`,
            color: typeColors[p.type] || '#8b5cf6'
          })
        }
      }
    })

    // Custom plugin for milestone annotations with collision detection
    const milestonePlugin = {
      id: 'milestoneAnnotations',
      afterDraw(chart: any) {
        const ctx2 = chart.ctx
        const xScale = chart.scales.x
        const yScale = chart.scales.y

        // Sort milestones by x position to detect collisions
        const sorted = [...milestones].sort((a, b) => a.weekIdx - b.weekIdx)

        // Assign vertical offsets to prevent label overlap
        // Labels within 14 days (~2 week indices) of each other get staggered by 25px
        const labelOffsets: number[] = []
        sorted.forEach((m, i) => {
          let offset = 0
          for (let j = 0; j < i; j++) {
            const gap = Math.abs(m.weekIdx - sorted[j].weekIdx)
            // If within 2 weeks and same base offset, increment
            if (gap < 2 && labelOffsets[j] >= offset) {
              offset = labelOffsets[j] + 25
            }
          }
          labelOffsets.push(offset)
        })

        sorted.forEach((m, i) => {
          const x = xScale.getPixelForValue(m.weekIdx)
          const yTop = yScale.top
          const yBottom = yScale.bottom
          const labelY = yTop + 14 + labelOffsets[i]

          // Dashed vertical line
          ctx2.save()
          ctx2.setLineDash([4, 4])
          ctx2.strokeStyle = m.color + '80'
          ctx2.lineWidth = 1
          ctx2.beginPath()
          ctx2.moveTo(x, labelY + 4)
          ctx2.lineTo(x, yBottom)
          ctx2.stroke()
          ctx2.restore()

          // Leader line from label to data point (if offset)
          if (labelOffsets[i] > 0) {
            ctx2.save()
            ctx2.strokeStyle = m.color + '60'
            ctx2.lineWidth = 0.8
            ctx2.setLineDash([2, 2])
            ctx2.beginPath()
            ctx2.moveTo(x, labelY + 2)
            ctx2.lineTo(x, yTop + 18)
            ctx2.stroke()
            ctx2.restore()
          }

          // Label above
          ctx2.save()
          ctx2.font = '9px sans-serif'
          ctx2.fillStyle = m.color
          ctx2.textAlign = 'center'
          ctx2.fillText(m.label, x, labelY)
          ctx2.restore()

          // Dot on accumulative line
          const accumDataset = chart.data.datasets[5] // Accumulative Income is 6th dataset
          if (accumDataset) {
            const meta = chart.getDatasetMeta(5)
            if (meta && meta.data[m.weekIdx]) {
              const point = meta.data[m.weekIdx]
              ctx2.save()
              ctx2.beginPath()
              ctx2.arc(point.x, point.y, 5, 0, Math.PI * 2)
              ctx2.fillStyle = m.color
              ctx2.fill()
              ctx2.strokeStyle = '#fff'
              ctx2.lineWidth = 1.5
              ctx2.stroke()
              ctx2.restore()
            }
          }
        })
      }
    }

    // Point styling for gap weeks (amber dots at y=0 on accum line)
    const accumPointColors = data.map((d, i) => gapIndices[i] ? '#f59e0b' : '#14532d')
    const accumPointRadius = data.map((d, i) => gapIndices[i] ? 5 : 3)

    chartRef.current = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Total Exposure',
            data: totalExposureData,
            borderColor: '#ef4444',
            backgroundColor: 'rgba(239, 68, 68, 0.05)',
            borderWidth: 4,
            fill: false,
            tension: 0.3,
            pointRadius: 3,
            pointHoverRadius: 6,
            pointBackgroundColor: '#ef4444',
          },
          {
            label: 'Unbilled',
            data: unbilledData,
            borderColor: '#f87171',
            backgroundColor: 'rgba(248, 113, 113, 0.05)',
            borderWidth: 2,
            fill: false,
            tension: 0.3,
            pointRadius: 2,
            pointHoverRadius: 5,
            pointBackgroundColor: '#f87171',
          },
          {
            label: 'Pending Invoice',
            data: pendingInvData,
            borderColor: '#f59e0b',
            backgroundColor: 'rgba(245, 158, 11, 0.05)',
            borderWidth: 2,
            fill: false,
            tension: 0.3,
            pointRadius: 2,
            pointHoverRadius: 5,
            pointBackgroundColor: '#f59e0b',
          },
          {
            label: 'Service Payment',
            data: svcPaymentData,
            borderColor: '#86efac',
            backgroundColor: 'rgba(134, 239, 172, 0.05)',
            borderWidth: 2,
            fill: false,
            tension: 0.3,
            pointRadius: 2,
            pointHoverRadius: 5,
            pointBackgroundColor: '#86efac',
          },
          {
            label: 'Project Payment',
            data: projPaymentData,
            borderColor: '#16a34a',
            backgroundColor: 'rgba(22, 163, 74, 0.05)',
            borderWidth: 2,
            fill: false,
            tension: 0.3,
            pointRadius: 2,
            pointHoverRadius: 5,
            pointBackgroundColor: '#16a34a',
          },
          {
            label: 'Accumulative Income',
            data: accumData,
            borderColor: '#14532d',
            backgroundColor: 'rgba(20, 83, 45, 0.15)',
            borderWidth: 4,
            fill: true,
            tension: 0.3,
            pointRadius: accumPointRadius,
            pointHoverRadius: 6,
            pointBackgroundColor: accumPointColors,
          },
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          tooltip: {
            backgroundColor: 'rgba(15, 17, 23, 0.95)',
            titleColor: '#fff',
            bodyColor: '#d1d5db',
            borderColor: '#374151',
            borderWidth: 1,
            padding: 12,
            titleFont: { size: 13, weight: 'bold' },
            bodyFont: { size: 12 },
            callbacks: {
              label: (tooltipCtx: any) => {
                const label = tooltipCtx.dataset.label || ''
                const value = tooltipCtx.parsed.y || 0
                return `  ${label}: $${Number(value).toLocaleString()}`
              },
              afterBody: (tooltipItems: any) => {
                const idx = tooltipItems[0]?.dataIndex
                if (idx !== undefined && gapIndices[idx]) {
                  return ['\n⚠ No activity logged']
                }
                return []
              }
            }
          },
          legend: {
            position: 'top',
            labels: {
              color: '#d1d5db',
              font: { size: 14 },
              padding: 15,
              usePointStyle: true,
            }
          }
        },
        scales: {
          x: {
            ticks: {
              color: '#9ca3af',
              font: { size: 10 },
              maxTicksLimit: 26,
              maxRotation: 45,
            },
            grid: { color: 'rgba(255,255,255,0.03)' }
          },
          y: {
            type: 'linear',
            position: 'left',
            ticks: {
              color: '#9ca3af',
              font: { size: 11 },
              callback: (v: any) => '$' + Number(v).toLocaleString()
            },
            grid: { color: 'rgba(255,255,255,0.05)' }
          }
        }
      },
      plugins: [milestonePlugin]
    })

    return () => {
      if (chartRef.current) {
        chartRef.current.destroy()
        chartRef.current = null
      }
    }
  }, [chartReady, data, backup])

  return <canvas ref={canvasRef} />
}

// ── OPP CHART COMPONENT ──
function OPPChart({ projects, backup }: { projects: any[], backup: BackupData }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const chartRef = useRef<any>(null)
  const chartReady = useChartJS()

  useEffect(() => {
    if (!chartReady || !canvasRef.current || !projects.length) return

    const Chart = (window as any).Chart
    if (!Chart) return

    if (chartRef.current) {
      chartRef.current.destroy()
      chartRef.current = null
    }

    const ctx = canvasRef.current.getContext('2d')
    if (!ctx) return

    const labels = projects.map(p => p.name?.substring(0, 20) || 'Unknown')
    const contractData = projects.map(p => p.contract || 0)
    const colors = projects.map(p => health(p, backup).clr)

    chartRef.current = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'Contract Amount',
            data: contractData,
            backgroundColor: colors,
            borderColor: 'rgba(255,255,255,0.1)',
            borderWidth: 1
          }
        ]
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          tooltip: {
            backgroundColor: 'rgba(0,0,0,0.8)',
            titleColor: '#fff',
            bodyColor: '#ccc',
            padding: 8,
            callbacks: {
              label: (ctx: any) => `$${Number(ctx.parsed.x).toLocaleString()}`
            }
          },
          legend: {
            labels: { color: '#9ca3af', font: { size: 12 } }
          }
        },
        scales: {
          x: {
            ticks: {
              color: '#9ca3af',
              callback: (v: any) => '$' + Number(v).toLocaleString()
            },
            grid: { color: 'rgba(255,255,255,0.05)' }
          },
          y: {
            ticks: { color: '#9ca3af', font: { size: 10 } },
            grid: { display: false }
          }
        }
      }
    })

    return () => {
      if (chartRef.current) {
        chartRef.current.destroy()
        chartRef.current = null
      }
    }
  }, [chartReady, projects, backup])

  return <canvas ref={canvasRef} />
}

// ── PCD CHART COMPONENT ──
function PCDChart({ projects, backup }: { projects: any[], backup: BackupData }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const chartRef = useRef<any>(null)
  const chartReady = useChartJS()

  const phaseNames = ['Planning', 'Estimating', 'Site Prep', 'Rough-in', 'Trim', 'Finish']
  const phaseColors = ['#6b7280', '#8b5cf6', '#f59e0b', '#3b82f6', '#eab308', '#10b981']
  const defaultWeights = { Planning: 5, Estimating: 10, 'Site Prep': 15, 'Rough-in': 30, Trim: 25, Finish: 15 }
  const weights = backup.settings?.phaseWeights || defaultWeights

  useEffect(() => {
    if (!chartReady || !canvasRef.current || !projects.length) return

    const Chart = (window as any).Chart
    if (!Chart) return

    if (chartRef.current) {
      chartRef.current.destroy()
      chartRef.current = null
    }

    const ctx = canvasRef.current.getContext('2d')
    if (!ctx) return

    const labels = projects.map(p => p.name?.substring(0, 20) || 'Unknown')

    // Build phase datasets
    const phaseDatasets = phaseNames.map((phaseName, phaseIdx) => ({
      label: phaseName,
      data: projects.map(p => {
        const phases = p.phases || {}
        const completion = phases[phaseName] || 0
        const weight = (weights as any)[phaseName] || 0
        return (weight * (completion / 100))
      }),
      backgroundColor: phaseColors[phaseIdx]
    }))

    chartRef.current = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: phaseDatasets
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          tooltip: {
            backgroundColor: 'rgba(0,0,0,0.8)',
            titleColor: '#fff',
            bodyColor: '#ccc',
            padding: 8,
            callbacks: {
              label: (ctx: any) => `${ctx.dataset.label}: ${ctx.parsed.x.toFixed(1)}`
            }
          },
          legend: {
            labels: { color: '#9ca3af', font: { size: 11 } }
          }
        },
        scales: {
          x: {
            stacked: true,
            ticks: { color: '#9ca3af', callback: (v: any) => Number(v).toFixed(0) },
            grid: { color: 'rgba(255,255,255,0.05)' }
          },
          y: {
            stacked: true,
            ticks: { color: '#9ca3af', font: { size: 11 } },
            grid: { display: false }
          }
        }
      }
    })

    return () => {
      if (chartRef.current) {
        chartRef.current.destroy()
        chartRef.current = null
      }
    }
  }, [chartReady, projects, backup])

  return <canvas ref={canvasRef} />
}

// ── EVR CHART COMPONENT ──
function EVRChart({ projects, backup }: { projects: any[], backup: BackupData }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const chartRef = useRef<any>(null)
  const chartReady = useChartJS()

  useEffect(() => {
    if (!chartReady || !canvasRef.current || !projects.length) return

    const Chart = (window as any).Chart
    if (!Chart) return

    if (chartRef.current) {
      chartRef.current.destroy()
      chartRef.current = null
    }

    const ctx = canvasRef.current.getContext('2d')
    if (!ctx) return

    // Build cumulative data
    let cumIncome = 0, cumAR = 0, cumPipeline = 0
    const labels = projects.map(p => p.name?.substring(0, 15) || 'Unknown')
    const incomeData: number[] = []
    const arData: number[] = []
    const pipelineData: number[] = []

    projects.forEach(p => {
      const fin = getProjectFinancials(p, backup)
      const exposure = Math.max(0, (fin.billed || fin.contract) - fin.paid)
      cumIncome += fin.paid || 0
      cumAR += exposure || 0
      cumPipeline += p.contract || 0
      incomeData.push(cumIncome)
      arData.push(cumAR)
      pipelineData.push(cumPipeline)
    })

    chartRef.current = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Accumulated Income',
            data: incomeData,
            borderColor: '#10b981',
            backgroundColor: 'rgba(16, 185, 129, 0.1)',
            borderWidth: 2,
            fill: true,
            tension: 0.3
          },
          {
            label: 'Outstanding AR',
            data: arData,
            borderColor: '#ef4444',
            backgroundColor: 'rgba(239, 68, 68, 0.1)',
            borderWidth: 2,
            fill: true,
            tension: 0.3
          },
          {
            label: 'Total Pipeline',
            data: pipelineData,
            borderColor: '#3b82f6',
            borderDash: [5, 5],
            backgroundColor: 'rgba(59, 130, 246, 0.05)',
            borderWidth: 2,
            fill: false,
            tension: 0.3
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          tooltip: {
            backgroundColor: 'rgba(0,0,0,0.8)',
            titleColor: '#fff',
            bodyColor: '#ccc',
            padding: 8,
            titleFont: { size: 12 },
            bodyFont: { size: 11 },
            callbacks: {
              label: (ctx: any) => {
                const label = ctx.dataset.label || ''
                return `${label}: $${Number(ctx.parsed.y).toLocaleString()}`
              }
            }
          },
          legend: {
            labels: { color: '#9ca3af', font: { size: 12 } }
          }
        },
        scales: {
          x: {
            ticks: { color: '#9ca3af', font: { size: 10 } },
            grid: { display: false }
          },
          y: {
            ticks: {
              color: '#9ca3af',
              callback: (v: any) => '$' + (Number(v) / 1000).toFixed(0) + 'k'
            },
            grid: { color: 'rgba(255,255,255,0.05)' }
          }
        }
      }
    })

    return () => {
      if (chartRef.current) {
        chartRef.current.destroy()
        chartRef.current = null
      }
    }
  }, [chartReady, projects, backup])

  return <canvas ref={canvasRef} />
}

// ── SCP: Service Calls Performance CHART COMPONENT ──
function SCPChart({ serviceLogs, backup }: { serviceLogs: any[], backup: BackupData }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const chartRef = useRef<any>(null)
  const chartReady = useChartJS()

  useEffect(() => {
    if (!chartReady || !canvasRef.current || !serviceLogs.length) return

    const Chart = (window as any).Chart
    if (!Chart) return

    if (chartRef.current) {
      chartRef.current.destroy()
      chartRef.current = null
    }

    const ctx = canvasRef.current.getContext('2d')
    if (!ctx) return

    // Take last 8 service calls
    const recent = serviceLogs.slice(-8)
    const labels = recent.map((l: any) => (l.customer || 'Unknown').substring(0, 12))
    const quotedData = recent.map((l: any) => num(l.quoted || 0))
    const materialData = recent.map((l: any) => num(l.materialCost || l.material || 0))
    const netData = recent.map((l: any) => {
      const quoted = num(l.quoted || 0)
      const mat = num(l.materialCost || l.material || 0)
      const miles = num(l.mileage || 0) * num(backup.settings?.mileRate || 0.66)
      return Math.max(0, quoted - mat - miles)
    })

    chartRef.current = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'Quoted',
            data: quotedData,
            backgroundColor: '#3b82f6',
            borderRadius: 3,
          },
          {
            label: 'Material',
            data: materialData,
            backgroundColor: '#f59e0b',
            borderRadius: 3,
          },
          {
            label: 'Net Profit',
            data: netData,
            backgroundColor: '#10b981',
            borderRadius: 3,
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          tooltip: {
            backgroundColor: 'rgba(0,0,0,0.8)',
            titleColor: '#fff',
            bodyColor: '#ccc',
            padding: 8,
            callbacks: {
              label: (ctx: any) => `${ctx.dataset.label}: $${Number(ctx.parsed.y).toLocaleString()}`
            }
          },
          legend: {
            labels: { color: '#9ca3af', font: { size: 11 } }
          }
        },
        scales: {
          x: {
            ticks: { color: '#9ca3af', font: { size: 10 } },
            grid: { display: false }
          },
          y: {
            ticks: {
              color: '#9ca3af',
              callback: (v: any) => '$' + Number(v).toLocaleString()
            },
            grid: { color: 'rgba(255,255,255,0.05)' }
          }
        }
      }
    })

    return () => {
      if (chartRef.current) {
        chartRef.current.destroy()
        chartRef.current = null
      }
    }
  }, [chartReady, serviceLogs, backup])

  return <canvas ref={canvasRef} />
}

// ── REVENUE vs COST ANALYSIS CHART COMPONENT ──
function RevenueCostChart({ projects, backup }: { projects: any[], backup: BackupData }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const chartRef = useRef<any>(null)
  const chartReady = useChartJS()

  // Helper to filter logs by project ID (case-insensitive, handles both projId and projectId)
  const filterLogsByProject = (logs: any[], projectId: string) => {
    return logs.filter(l => {
      const logProj = (l.projId || l.projectId || '').toString().trim().toLowerCase()
      const selected = projectId.toString().trim().toLowerCase()
      return logProj === selected
    })
  }

  useEffect(() => {
    if (!chartReady || !canvasRef.current || !projects.length) return

    const Chart = (window as any).Chart
    if (!Chart) return

    if (chartRef.current) {
      chartRef.current.destroy()
      chartRef.current = null
    }

    const ctx = canvasRef.current.getContext('2d')
    if (!ctx) return

    const mileRate = num(backup.settings?.mileRate || 0.66)
    const opCost = num(backup.settings?.opCost || 42.45)
    const logs = backup.logs || []
    const isSingleProject = projects.length === 1

    const collectedData: number[] = []
    const laborCostData: number[] = []
    const materialCostData: number[] = []
    const mileageCostData: number[] = []
    const arExposureData: number[] = []
    const breakEvenData: number[] = []
    let labels: string[] = []

    if (isSingleProject) {
      // Single project: group by date and show date labels
      const p = projects[0]
      const projLogs = filterLogsByProject(logs, p.id)

      // Group logs by date
      const byDate: { [key: string]: any[] } = {}
      projLogs.forEach(log => {
        const dateKey = log.date ? new Date(log.date).toISOString().split('T')[0] : 'unknown'
        if (!byDate[dateKey]) byDate[dateKey] = []
        byDate[dateKey].push(log)
      })

      // Sort dates and process
      const sortedDates = Object.keys(byDate).sort()
      const fin = getProjectFinancials(p, backup)
      const projectCollected = fin.paid || 0

      sortedDates.forEach(dateStr => {
        const dateLogs = byDate[dateStr]
        const totalHrs = dateLogs.reduce((s, l) => s + num(l.hrs), 0)
        const totalMiles = dateLogs.reduce((s, l) => s + num(l.miles), 0)
        const totalMat = dateLogs.reduce((s, l) => s + num(l.mat), 0)

        const laborTotal = totalHrs * opCost
        const mileTotal = totalMiles * mileRate
        const breakevenTotal = laborTotal + totalMat + mileTotal

        collectedData.push(projectCollected)
        laborCostData.push(laborTotal)
        materialCostData.push(totalMat)
        mileageCostData.push(mileTotal)
        arExposureData.push(Math.max(0, (fin.billed || fin.contract || 0) - projectCollected))
        breakEvenData.push(breakevenTotal)

        // Format date as "Mar 8"
        const dt = new Date(dateStr + 'T00:00:00')
        labels.push(dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }))
      })

      if (labels.length === 0) {
        labels = [p.name || 'Unknown']
        collectedData.push(0)
        laborCostData.push(0)
        materialCostData.push(0)
        mileageCostData.push(0)
        arExposureData.push(0)
        breakEvenData.push(0)
      }
    } else {
      // All projects: show project names (one per project)
      projects.forEach(p => {
        const fin = getProjectFinancials(p, backup)
        const projLogs = filterLogsByProject(logs, p.id)

        const totalHrs = projLogs.reduce((s, l) => s + num(l.hrs), 0)
        const totalMiles = projLogs.reduce((s, l) => s + num(l.miles), 0)
        const totalMat = projLogs.reduce((s, l) => s + num(l.mat), 0)
        const laborTotal = totalHrs * opCost
        const mileTotal = totalMiles * mileRate

        const collected = fin.paid || 0
        const arTotal = Math.max(0, (fin.billed || fin.contract || 0) - collected)

        collectedData.push(collected)
        laborCostData.push(laborTotal)
        materialCostData.push(totalMat)
        mileageCostData.push(mileTotal)
        arExposureData.push(arTotal)
        breakEvenData.push(laborTotal + totalMat + mileTotal)

        labels.push((p.name || 'Unknown').substring(0, 18))
      })
    }

    // Shaded zone plugin for red/yellow/green
    const zonePlugin = {
      id: 'revenueZones',
      beforeDatasetsDraw(chart: any) {
        const ctx2 = chart.ctx
        const yScale = chart.scales.y
        const xScale = chart.scales.x
        if (!yScale || !xScale) return
        const left = xScale.left
        const right = xScale.right

        // Find max break-even for zone boundaries
        const maxBE = Math.max(...breakEvenData, 1)
        const dangerLine = maxBE * 0.7
        const warnLine = maxBE

        // Red zone: 0 → 70% of break-even
        const yDangerBottom = yScale.getPixelForValue(0)
        const yDangerTop = yScale.getPixelForValue(dangerLine)
        ctx2.save()
        ctx2.fillStyle = 'rgba(239, 68, 68, 0.04)'
        ctx2.fillRect(left, yDangerTop, right - left, yDangerBottom - yDangerTop)

        // Yellow zone: 70% → 100% of break-even
        const yWarnTop = yScale.getPixelForValue(warnLine)
        ctx2.fillStyle = 'rgba(245, 158, 11, 0.04)'
        ctx2.fillRect(left, yWarnTop, right - left, yDangerTop - yWarnTop)

        // Green zone: above break-even
        const yGreenTop = yScale.top
        ctx2.fillStyle = 'rgba(16, 185, 129, 0.04)'
        ctx2.fillRect(left, yGreenTop, right - left, yWarnTop - yGreenTop)
        ctx2.restore()
      }
    }

    chartRef.current = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Collected Revenue',
            data: collectedData,
            borderColor: '#10b981',
            backgroundColor: 'rgba(16, 185, 129, 0.12)',
            borderWidth: 3,
            fill: true,
            tension: 0.3,
            pointRadius: 4,
            pointHoverRadius: 7,
            pointBackgroundColor: '#10b981',
          },
          {
            label: 'Labor Cost',
            data: laborCostData,
            borderColor: '#ef4444',
            backgroundColor: 'rgba(239, 68, 68, 0.06)',
            borderWidth: 2,
            fill: false,
            tension: 0.3,
            pointRadius: 3,
            pointHoverRadius: 6,
            pointBackgroundColor: '#ef4444',
          },
          {
            label: 'Material Cost',
            data: materialCostData,
            borderColor: '#f59e0b',
            backgroundColor: 'rgba(245, 158, 11, 0.06)',
            borderWidth: 2,
            fill: false,
            tension: 0.3,
            pointRadius: 3,
            pointHoverRadius: 6,
            pointBackgroundColor: '#f59e0b',
          },
          {
            label: 'Mileage Cost',
            data: mileageCostData,
            borderColor: '#8b5cf6',
            backgroundColor: 'rgba(139, 92, 246, 0.06)',
            borderWidth: 2,
            fill: false,
            tension: 0.3,
            borderDash: [4, 4],
            pointRadius: 3,
            pointHoverRadius: 6,
            pointBackgroundColor: '#8b5cf6',
          },
          {
            label: 'Total AR Exposure',
            data: arExposureData,
            borderColor: '#f87171',
            backgroundColor: 'rgba(248, 113, 113, 0.06)',
            borderWidth: 2.5,
            fill: false,
            tension: 0.3,
            borderDash: [6, 3],
            pointRadius: 3,
            pointHoverRadius: 6,
            pointBackgroundColor: '#f87171',
          },
          {
            label: 'Break-even',
            data: breakEvenData,
            borderColor: '#6b7280',
            backgroundColor: 'transparent',
            borderWidth: 2,
            fill: false,
            tension: 0,
            borderDash: [8, 4],
            pointRadius: 0,
            pointHoverRadius: 4,
            pointBackgroundColor: '#6b7280',
          },
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          tooltip: {
            backgroundColor: 'rgba(15, 17, 23, 0.95)',
            titleColor: '#fff',
            bodyColor: '#d1d5db',
            borderColor: '#374151',
            borderWidth: 1,
            padding: 12,
            titleFont: { size: 13, weight: 'bold' },
            bodyFont: { size: 12 },
            callbacks: {
              label: (tooltipCtx: any) => {
                const label = tooltipCtx.dataset.label || ''
                const value = tooltipCtx.parsed.y || 0
                return `  ${label}: $${Number(value).toLocaleString()}`
              },
              afterBody: (tooltipItems: any) => {
                const idx = tooltipItems[0]?.dataIndex
                if (idx !== undefined) {
                  const rev = collectedData[idx] || 0
                  const cost = (laborCostData[idx] || 0) + (materialCostData[idx] || 0) + (mileageCostData[idx] || 0)
                  const profit = rev - cost
                  const margin = rev > 0 ? ((profit / rev) * 100).toFixed(1) : '0.0'
                  return [`\n  Profit: $${profit.toLocaleString()} (${margin}% margin)`]
                }
                return []
              }
            }
          },
          legend: {
            position: 'top',
            labels: {
              color: '#d1d5db',
              font: { size: 12 },
              padding: 12,
              usePointStyle: true,
            }
          }
        },
        scales: {
          x: {
            ticks: { color: '#9ca3af', font: { size: 10 }, maxRotation: 45 },
            grid: { color: 'rgba(255,255,255,0.03)' }
          },
          y: {
            ticks: {
              color: '#9ca3af',
              font: { size: 11 },
              callback: (v: any) => '$' + Number(v).toLocaleString()
            },
            grid: { color: 'rgba(255,255,255,0.05)' }
          }
        }
      },
      plugins: [zonePlugin]
    })

    return () => {
      if (chartRef.current) {
        chartRef.current.destroy()
        chartRef.current = null
      }
    }
  }, [chartReady, projects, backup])

  // Check if selected project has no logs
  const hasData = (() => {
    const logs = backup.logs || []
    if (projects.length === 0) return false
    if (projects.length === 1) {
      const projLogs = filterLogsByProject(logs, projects[0].id)
      return projLogs.length > 0
    }
    return true
  })()

  if (!hasData && projects.length === 1) {
    return (
      <div className="flex items-center justify-center h-48 text-gray-500 text-sm">
        No field log data yet for this project
      </div>
    )
  }

  return <canvas ref={canvasRef} />
}

// ── NEXUS AI DASHBOARD ANALYZER ──
interface NEXUSAnalysis {
  loading: boolean
  error?: string
  analysis?: string
  bullets?: Array<{ icon: string; text: string; priority: 'high' | 'medium' | 'low' }>
}

function NEXUSDashboardAnalyzer({ backup, cfotSummary, projects }: {
  backup: BackupData
  cfotSummary: { exposure: number; unbilled: number; pending: number; svcTotal: number; projTotal: number; accumTotal: number }
  projects: any[]
}) {
  const [state, setState] = useState<NEXUSAnalysis>({ loading: true })
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    const analyze = async () => {
      try {
        setState({ loading: true })
        const dashboardContext = {
          summary: cfotSummary,
          activeProjects: projects.filter(p => p.status === 'active').length,
          totalContract: projects.reduce((s: number, p: any) => s + num(p.contract), 0),
          weeklyData: (backup.weeklyData || []).slice(-4),
          serviceLogs: (backup.serviceLogs || []).slice(-5),
        }

        const response = await callClaude({
          system: 'You are NEXUS, the AI dashboard analyzer for Power On Solutions. Analyze financial dashboard data and provide 3-5 priority-scored bullet points (🔴 high risk, 🟡 medium attention, 🟢 healthy). Be concise and actionable.',
          messages: [{
            role: 'user',
            content: `Analyze this dashboard data and identify key risk items, projects needing attention, and healthy indicators:\n${JSON.stringify(dashboardContext, null, 2)}`
          }],
          max_tokens: 1024,
        })

        const text = extractText(response)
        // Parse bullet points with icons
        const bullets = text
          .split('\n')
          .filter((line: string) => line.match(/^[🔴🟡🟢]/))
          .map((line: string) => {
            const match = line.match(/^([🔴🟡🟢])\s*(.+)/)
            if (!match) return null
            const iconMap = { '🔴': 'high', '🟡': 'medium', '🟢': 'low' }
            return {
              icon: match[1],
              text: match[2].trim(),
              priority: iconMap[match[1] as keyof typeof iconMap] || 'medium'
            }
          })
          .filter(Boolean)

        setState({ loading: false, analysis: text, bullets: bullets.length > 0 ? bullets : undefined })
      } catch (err) {
        setState({ loading: false, error: (err as any)?.message || 'Analysis failed' })
      }
    }

    analyze()
  }, [backup, cfotSummary, projects])

  if (state.loading) {
    return (
      <div className="bg-[var(--bg-card)] rounded-lg border border-gray-700 p-6 animate-pulse">
        <div className="flex items-center gap-2 mb-4">
          <Brain size={24} className="text-purple-400" />
          <h2 className="text-[26px] font-bold text-gray-100">NEXUS Dashboard Analysis</h2>
        </div>
        <div className="h-20 bg-gray-700 rounded"></div>
      </div>
    )
  }

  if (state.error) {
    return (
      <div className="bg-[var(--bg-card)] rounded-lg border border-gray-700 p-6">
        <div className="flex items-center gap-2 mb-4">
          <Brain size={24} className="text-purple-400" />
          <h2 className="text-[26px] font-bold text-gray-100">NEXUS Dashboard Analysis</h2>
        </div>
        <p className="text-red-400 text-sm">{state.error}</p>
      </div>
    )
  }

  return (
    <div className="bg-[var(--bg-card)] rounded-lg border border-gray-700 p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Brain size={24} className="text-purple-400" />
          <h2 className="text-[26px] font-bold text-gray-100">NEXUS Dashboard Analysis</h2>
        </div>
        <button
          onClick={() => setExpanded(!expanded)}
          className="px-3 py-1 text-xs bg-purple-600 hover:bg-purple-700 text-white rounded transition-colors"
        >
          {expanded ? 'Collapse' : 'Dive Deeper'}
        </button>
      </div>

      <div className="space-y-2">
        {state.bullets ? (
          state.bullets.map((b, i) => (
            <div key={i} className="flex gap-3 text-sm text-gray-300">
              <span className="text-lg flex-shrink-0">{b.icon}</span>
              <span>{b.text}</span>
            </div>
          ))
        ) : (
          <p className="text-gray-400 text-sm">{state.analysis}</p>
        )}
      </div>

      {expanded && state.analysis && (
        <div className="mt-4 pt-4 border-t border-gray-600 max-h-80 overflow-y-auto">
          <p className="text-gray-400 text-xs whitespace-pre-wrap">{state.analysis}</p>
        </div>
      )}
    </div>
  )
}

// ── INNER DASHBOARD COMPONENT ──
function V15rDashboardInner() {
  const backup = getBackupData()

  if (!backup) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[var(--bg-secondary)]">
        <p className="text-gray-400">No backup data available</p>
      </div>
    )
  }

  const projects = backup.projects || []
  const weeklyData = backup.weeklyData || []

  // ── CFOT: Cash Flow Over Time ──
  const cfotData = weeklyData.slice(-52).map(w => ({
    wk: w.wk,
    svc: w.svc || 0,
    proj: w.proj || 0,
    accum: w.accum || 0,
    start: w.start
  }))

  // ── CFOT Summary Boxes — computed directly from backup data ──
  const serviceLogs = backup.serviceLogs || []
  const projectLogs = backup.logs || []
  const cfotSummary = (() => {
    const activeProjects = projects.filter(p => p.status === 'active')
    // Exposure: active project contract value not yet collected
    const exposure = activeProjects.reduce((s, p) => s + Math.max(0, num(p.contract) - num(p.paid)), 0)
    // Unbilled: completed work not yet invoiced (contract - billed for active projects)
    const unbilled = activeProjects.reduce((s, p) => s + Math.max(0, num(p.contract) - num(p.billed)), 0)
    // Pending: service calls quoted but not yet collected
    const pending = serviceLogs
      .filter((l: any) => num(l.quoted) > 0 && num(l.collected) < num(l.quoted))
      .reduce((s: number, l: any) => s + Math.max(0, num(l.quoted) - num(l.collected)), 0)
    // Service: total collected from serviceLogs all time
    const svcTotal = serviceLogs.reduce((s: number, l: any) => s + num(l.collected), 0)
    // Project: total collected (paid) from projects all time
    const projTotal = projects.reduce((s: number, p: any) => s + num(p.paid), 0)
    // Accumulative: combined
    const accumTotal = svcTotal + projTotal
    return { exposure, unbilled, pending, svcTotal, projTotal, accumTotal }
  })()

  // ── OPP: Active projects by contract value ──
  const oppProjects = projects
    .filter(p => p.status === 'active' || p.status === 'coming')
    .sort((a, b) => (b.contract || 0) - (a.contract || 0))
    .slice(0, 8)

  // ── PCD: Project Completion Distribution by Phase ──
  const pcdProjects = projects
    .filter(p => p.status === 'active' || p.status === 'coming')
    .sort((a, b) => (b.contract || 0) - (a.contract || 0))
    .slice(0, 10)

  // ── EVR: Exposure vs Revenue (Top 6 by contract) ──
  const evrProjects = projects
    .filter(p => p.contract > 0)
    .sort((a, b) => (b.contract || 0) - (a.contract || 0))
    .slice(0, 6)

  // ── SCP: Service Calls Performance (last 8) ──
  const scpLogs = serviceLogs.slice(-8)

  // ── RCA: Revenue vs Cost Analysis (Active Projects) ──
  const [rcaSelectedProject, setRcaSelectedProject] = useState<string>('all')
  const allRcaProjects = projects
    .filter(p => p.status === 'active' && (p.contract || 0) > 0)
    .sort((a, b) => (b.contract || 0) - (a.contract || 0))
    .slice(0, 10)
  const rcaDropdownProjects = backup.projects || []
  const rcaProjects = rcaSelectedProject === 'all'
    ? allRcaProjects
    : allRcaProjects.filter(p => p.id === rcaSelectedProject)

  return (
    <div className="min-h-screen bg-[var(--bg-secondary)] p-6">
      {/* HEADER */}
      <div className="flex items-center gap-3 mb-8">
        <BarChart3 size={32} className="text-blue-400" />
        <div>
          <h1 className="text-3xl font-bold text-gray-100">Graph Dashboard</h1>
          <p className="text-gray-500 text-sm mt-1">Cash flow, pipeline, completion, and revenue analysis</p>
        </div>
      </div>

      {/* 2x2 GRID */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* CFOT: Cash Flow Over Time */}
        <div className="bg-[var(--bg-card)] rounded-lg border border-gray-700 p-6 lg:col-span-2">
          <div className="mb-4">
            <h2 className="text-[30px] font-bold text-gray-100 leading-tight">Projects Cash Flow Over Time</h2>
            <p className="text-sm text-gray-400 italic mt-1">Accumulative vs Total Exposure — Detailed with Unbilled, Invoiced and Received</p>
          </div>
          <div className="relative w-full h-[500px]">
            <ChartErrorBoundary>
              <CFOTChart data={cfotData} backup={backup} />
            </ChartErrorBoundary>
          </div>
          <div className="mt-4 grid grid-cols-3 lg:grid-cols-6 gap-3 text-xs">
            <div className="bg-[var(--bg-input)] p-2 rounded">
              <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-full" style={{background:'#ef4444'}}></div><span className="text-gray-500">Exposure</span></div>
              <p className="font-bold font-mono text-red-400 mt-1">${cfotSummary.exposure.toLocaleString()}</p>
            </div>
            <div className="bg-[var(--bg-input)] p-2 rounded">
              <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-full" style={{background:'#f87171'}}></div><span className="text-gray-500">Unbilled</span></div>
              <p className="font-bold font-mono text-red-300 mt-1">${cfotSummary.unbilled.toLocaleString()}</p>
            </div>
            <div className="bg-[var(--bg-input)] p-2 rounded">
              <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-full" style={{background:'#f59e0b'}}></div><span className="text-gray-500">Pending</span></div>
              <p className="font-bold font-mono text-amber-400 mt-1">${cfotSummary.pending.toLocaleString()}</p>
            </div>
            <div className="bg-[var(--bg-input)] p-2 rounded">
              <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-full" style={{background:'#86efac'}}></div><span className="text-gray-500">Service $</span></div>
              <p className="font-bold font-mono text-green-300 mt-1">${cfotSummary.svcTotal.toLocaleString()}</p>
            </div>
            <div className="bg-[var(--bg-input)] p-2 rounded">
              <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-full" style={{background:'#16a34a'}}></div><span className="text-gray-500">Project $</span></div>
              <p className="font-bold font-mono text-green-500 mt-1">${cfotSummary.projTotal.toLocaleString()}</p>
            </div>
            <div className="bg-[var(--bg-input)] p-2 rounded">
              <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-full" style={{background:'#14532d'}}></div><span className="text-gray-500">Accum</span></div>
              <p className="font-bold font-mono text-green-900 mt-1">${cfotSummary.accumTotal.toLocaleString()}</p>
            </div>
          </div>
        </div>

        {/* OPP: Open Projects Pipeline */}
        <div className="bg-[var(--bg-card)] rounded-lg border border-gray-700 p-6">
          <h2 className="text-lg font-bold text-gray-100 mb-4">OPP: Open Projects Pipeline</h2>
          <div className="relative w-full h-64">
            <ChartErrorBoundary>
              <OPPChart projects={oppProjects} backup={backup} />
            </ChartErrorBoundary>
          </div>
        </div>

        {/* PCD: Project Completion Distribution */}
        <div className="bg-[var(--bg-card)] rounded-lg border border-gray-700 p-6">
          <h2 className="text-lg font-bold text-gray-100 mb-4">PCD: Project Completion Distribution</h2>
          <div className="relative w-full h-64">
            <ChartErrorBoundary>
              <PCDChart projects={pcdProjects} backup={backup} />
            </ChartErrorBoundary>
          </div>
        </div>

        {/* EVR: Exposure vs Revenue */}
        <div className="bg-[var(--bg-card)] rounded-lg border border-gray-700 p-6">
          <h2 className="text-lg font-bold text-gray-100 mb-4">EVR: Exposure vs Revenue</h2>
          <div className="relative w-full h-64">
            <ChartErrorBoundary>
              <EVRChart projects={evrProjects} backup={backup} />
            </ChartErrorBoundary>
          </div>
        </div>

        {/* SCP: Service Calls Performance */}
        <div className="bg-[var(--bg-card)] rounded-lg border border-gray-700 p-6">
          <h2 className="text-lg font-bold text-gray-100 mb-4">SCP: Service Calls Performance</h2>
          {scpLogs.length > 0 ? (
            <div className="relative w-full h-64">
              <ChartErrorBoundary>
                <SCPChart serviceLogs={scpLogs} backup={backup} />
              </ChartErrorBoundary>
            </div>
          ) : (
            <div className="flex items-center justify-center h-64 text-gray-500 text-sm">
              No service call data yet
            </div>
          )}
        </div>

        {/* RCA: Revenue vs Cost Analysis — Active Projects */}
        <div className="bg-[var(--bg-card)] rounded-lg border border-gray-700 p-6 lg:col-span-2">
          <div className="mb-4 flex items-start justify-between gap-4 flex-wrap">
            <div>
              <h2 className="text-[26px] font-bold text-gray-100 leading-tight">Revenue vs Cost Analysis — Active Projects</h2>
              <p className="text-sm text-gray-400 italic mt-1">Collected Revenue, Labor/Material/Mileage Costs, AR Exposure &amp; Break-even — with shaded profit zones</p>
            </div>
            <select
              value={rcaSelectedProject}
              onChange={e => setRcaSelectedProject(e.target.value)}
              className="bg-[#232738] border border-gray-600 rounded px-3 py-1.5 text-xs text-gray-200 focus:border-blue-500 outline-none min-w-[180px]"
            >
              <option value="all">All Projects</option>
              {rcaDropdownProjects.map(p => (
                <option key={p.id} value={p.id}>{(p.name || 'Unknown').substring(0, 30)}</option>
              ))}
            </select>
          </div>
          <div className="relative w-full h-[420px]">
            <ChartErrorBoundary>
              <RevenueCostChart projects={rcaProjects} backup={backup} />
            </ChartErrorBoundary>
          </div>
          <div className="mt-3 flex items-center gap-4 text-[10px] text-gray-500">
            <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded" style={{background:'rgba(239,68,68,0.15)'}}></span> Danger zone</span>
            <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded" style={{background:'rgba(245,158,11,0.15)'}}></span> Warning zone</span>
            <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded" style={{background:'rgba(16,185,129,0.15)'}}></span> Profit zone</span>
          </div>
        </div>

        {/* NEXUS: AI Dashboard Analyzer */}
        <div className="lg:col-span-2">
          <NEXUSDashboardAnalyzer backup={backup} cfotSummary={cfotSummary} projects={projects} />
        </div>

      </div>
    </div>
  )
}

// ── EXPORT WITH ERROR BOUNDARY ──
export default function V15rDashboard() {
  return (
    <ChartErrorBoundary>
      <V15rDashboardInner />
    </ChartErrorBoundary>
  )
}
