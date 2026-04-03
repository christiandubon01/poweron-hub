// @ts-nocheck
import React, { useState, useCallback } from 'react'
import { Sparkles, Plus, ArrowRight, Check, Trash2, X } from 'lucide-react'
import { getBackupData, saveBackupData, saveBackupDataAndSync, num, fmt, fmtK, pct, getPhaseWeights, resolveProjectBucket, getProjectFinancials } from '@/services/backupDataService'
import { pushState } from '@/services/undoRedoService'
import { AskAIButton, AskAIPanel } from './AskAIPanel'
import type { Insight } from './AskAIPanel'

interface V15rEstimateTabProps {
  projectId: string
  onUpdate?: () => void
  backup?: any
}

export default function V15rEstimateTab({ projectId, onUpdate, backup: initialBackup }: V15rEstimateTabProps) {
  // ── Data must be resolved BEFORE any useState that references it (TDZ fix) ──
  const backup = initialBackup || getBackupData()

  const [, setTick] = useState(0)
  const forceUpdate = useCallback(() => setTick(t => t + 1), [])
  const [subtab, setSubtab] = useState<'project' | 'service'>('project')
  const [aiOpen, setAiOpen] = useState(false)

  // Part 1 — VAULT Health Check
  const [healthCheckLoading, setHealthCheckLoading] = useState(false)
  const [healthCheckOpen, setHealthCheckOpen] = useState(false)
  const [healthCheckResult, setHealthCheckResult] = useState<any>(null)

  // Part 2 — Quick Start Templates
  const [showQuickStart, setShowQuickStart] = useState(false)

  // Part 3 — Labor Calculator
  const [showLaborCalc, setShowLaborCalc] = useState(false)
  const [calcInput, setCalcInput] = useState(1000)
  const [calcInputType, setCalcInputType] = useState<'sqft' | 'devices'>('sqft')
  const [calcComplexity, setCalcComplexity] = useState<'simple' | 'standard' | 'complex'>('standard')
  const [calcCrew, setCalcCrew] = useState(2)
  const [calcResult, setCalcResult] = useState<{hours: number; cost: number} | null>(null)

  // Part 4 — Version History
  const [showVersionHistory, setShowVersionHistory] = useState(false)

  // Service Call form state
  const [scCust, setScCust] = useState('')
  const [scAddr, setScAddr] = useState('')
  const [scJtype, setScJtype] = useState('GFCI / Receptacles')
  const [scDate, setScDate] = useState(new Date().toISOString().slice(0, 10))
  const [scHrs, setScHrs] = useState('')
  const [scRate, setScRate] = useState(num(backup?.settings?.billRate || 65))
  const [scMat, setScMat] = useState('')
  const [scMiles, setScMiles] = useState('')
  const [scTax, setScTax] = useState(num(backup?.settings?.tax || 0))
  const [scNotes, setScNotes] = useState('')
  const [scStore, setScStore] = useState('')
  const [showEstForm, setShowEstForm] = useState(false)
  const [editingEstId, setEditingEstId] = useState<string | null>(null)
  if (!backup) return <div style={{ color: 'var(--t3)' }}>No data</div>

  const p = backup.projects.find(x => x.id === projectId)
  if (!p) return <div style={{ color: 'var(--t3)' }}>Project not found</div>

  const getMTOActivePhaseBreakdown = (proj) => {
    // Show ALL MTO phases that have rows — matches HTML renderMTO() which shows all phases
    const allPhases = backup.settings?.mtoPhases || ['Underground', 'Rough In', 'Trim', 'Finish']
    const taxRate = num(backup.settings?.tax || 0) / 100
    return (proj.mtoRows || [])
      .filter(r => allPhases.includes(r.phase))
      .reduce((acc, r) => {
        const pbItem = (backup.priceBook || []).find(x => x.id === r.matId)
        const costUnit = num(pbItem?.cost || r.costUnit || 0)
        const waste = num(pbItem?.waste || 0)
        const lineRaw = num(r.qty || 0) * costUnit * (1 + waste)
        const lineTax = lineRaw * taxRate
        const existing = acc.find(x => x.phase === r.phase)
        if (existing) {
          existing.raw += lineRaw
          existing.tax += lineTax
          existing.total = existing.raw + existing.tax
          existing.count += 1
        } else {
          acc.push({ phase: r.phase, raw: lineRaw, tax: lineTax, total: lineRaw + lineTax, count: 1 })
        }
        return acc
      }, [])
  }

  const estTotals = () => {
    const matBreakdown = getMTOActivePhaseBreakdown(p)
    const lab = (p.laborRows || []).reduce((s, r) => s + num(r.hrs) * num(r.rate), 0)
    const matC = matBreakdown.reduce((s, r) => s + num(r.raw), 0)
    const taxAmt = matBreakdown.reduce((s, r) => s + num(r.tax), 0)
    const labHrs = (p.laborRows || []).reduce((s, r) => s + num(r.hrs), 0)
    const manualOH = (p.ohRows || []).reduce((s, r) => s + num(r.hrs) * num(r.rate), 0)
    const opRate = num(backup.settings?.opCost || 42.45)
    const opC = labHrs * opRate
    const oh = opC + manualOH
    const mi = num(p.mileRT || 0) * num(p.miDays || 0) * num(backup.settings?.mileRate || 0.66)
    const subtotal = lab + matC + oh + mi
    const total = subtotal + taxAmt
    const directCost = matC + oh + mi
    const profit = num(p.contract || 0) - total
    const marginPct = total > 0 ? (profit / total) * 100 : 0
    return { lab, matC, taxAmt, matTx: matC + taxAmt, oh, manualOH, mi, subtotal, total, labHrs, opC, opRate, directCost, profit, marginPct, matBreakdown }
  }

  const t = estTotals()

  const editLaborRow = (rowId, field, value) => {
    pushState()
    const row = (p.laborRows || []).find(r => r.id === rowId)
    if (row) {
      if (field === 'hrs') row.hrs = num(value)
      else if (field === 'rate') row.rate = num(value)
      else if (field === 'desc') row.desc = String(value)
      else if (field === 'empId') row.empId = String(value)
    }
    saveBackupData(backup)
    forceUpdate()
  }

  const addLaborRow = () => {
    pushState()
    p.laborRows = p.laborRows || []
    p.laborRows.push({
      id: 'lr' + Date.now(),
      desc: 'New task',
      empId: 'me',
      hrs: 0,
      rate: num(backup.settings?.billRate || 65),
    })
    saveBackupData(backup)
    forceUpdate()
  }

  const delLaborRow = (rowId) => {
    pushState()
    p.laborRows = (p.laborRows || []).filter(r => r.id !== rowId)
    saveBackupData(backup)
    forceUpdate()
  }

  const editOHRow = (rowId, field, value) => {
    pushState()
    const row = (p.ohRows || []).find(r => r.id === rowId)
    if (row) {
      if (field === 'hrs') row.hrs = num(value)
      else if (field === 'rate') row.rate = num(value)
      else if (field === 'desc') row.desc = String(value)
    }
    saveBackupData(backup)
    forceUpdate()
  }

  const addOHRow = () => {
    pushState()
    p.ohRows = p.ohRows || []
    p.ohRows.push({
      id: 'oh' + Date.now(),
      desc: 'New item',
      hrs: 0,
      rate: num(backup.settings?.defaultOHRate || 55),
    })
    saveBackupData(backup)
    forceUpdate()
  }

  const delOHRow = (rowId) => {
    pushState()
    p.ohRows = (p.ohRows || []).filter(r => r.id !== rowId)
    saveBackupData(backup)
    forceUpdate()
  }

  const editMileage = (field, value) => {
    pushState()
    if (field === 'mileRT') p.mileRT = num(value)
    else if (field === 'miDays') p.miDays = num(value)
    saveBackupData(backup)
    forceUpdate()
  }

  const editTax = (value) => {
    pushState()
    backup.settings.tax = num(value)
    saveBackupData(backup)
    forceUpdate()
  }

  // Check if completely empty
  const hasAnyData = (p.laborRows || []).length > 0 || (p.ohRows || []).length > 0 || t.matBreakdown.length > 0

  // Service Call estimate helpers
  const SVC_JOB_TYPES = ['GFCI / Receptacles', 'Panel / Service', 'Troubleshoot', 'Lighting', 'EV Charger', 'Low Voltage', 'Circuit Add/Replace', 'Switches / Dimmers', 'Warranty', 'Other']
  const mileRate = num(backup.settings?.mileRate || 0.66)
  const opRate = num(backup.settings?.opCost || 42.45)
  const scHrsN = parseFloat(scHrs) || 0
  const scMatN = parseFloat(scMat) || 0
  const scMilesN = parseInt(scMiles) || 0
  const scRateN = num(scRate) || num(backup.settings?.billRate || 65)
  const scTaxN = num(scTax) || 0
  const scMileCost = scMilesN * mileRate
  const scLaborQuote = scHrsN * scRateN
  const scMaterialsTax = scMatN * (scTaxN / 100)
  const scSubtotal = scMatN + scMileCost + scLaborQuote + scMaterialsTax
  const scMarkup = num(backup.settings?.markup || 50) / 100
  const scQuoted = scSubtotal * (1 + scMarkup)
  const scOpCost = scHrsN * opRate
  const scInternalCost = scOpCost + scMatN + scMileCost
  const scProfit = scQuoted - scInternalCost

  function resetEstForm() {
    setScCust(''); setScAddr(''); setScDate(new Date().toISOString().slice(0, 10))
    setScHrs(''); setScRate(num(backup.settings?.billRate || 65)); setScMat('')
    setScMiles(''); setScTax(num(backup.settings?.tax || 0)); setScNotes(''); setScStore('')
    setEditingEstId(null)
  }

  function saveEstimate() {
    if (!scCust.trim()) { alert('Customer / Job Name is required.'); return }
    pushState(backup)
    if (!backup.serviceEstimates) backup.serviceEstimates = []
    const id = editingEstId || ('sest' + Date.now() + Math.random().toString(36).slice(2, 6))
    const estObj = {
      id,
      customer: scCust.trim(),
      address: scAddr.trim(),
      jtype: scJtype,
      date: scDate,
      estHours: scHrsN,
      rate: scRateN,
      estMaterials: scMatN,
      estMileage: scMilesN,
      taxPct: scTaxN,
      store: scStore.trim(),
      notes: scNotes.trim(),
      quoted: +scQuoted.toFixed(2),
      internalCost: +scInternalCost.toFixed(2),
      profit: +scProfit.toFixed(2),
      createdAt: new Date().toISOString(),
    }
    if (editingEstId) {
      const idx = backup.serviceEstimates.findIndex(e => e.id === editingEstId)
      if (idx >= 0) backup.serviceEstimates[idx] = { ...backup.serviceEstimates[idx], ...estObj }
    } else {
      backup.serviceEstimates.push(estObj)
    }
    saveBackupDataAndSync(backup, 'serviceEstimates')
    resetEstForm()
    setShowEstForm(false)
    forceUpdate()
  }

  function editEstimate(est) {
    setScCust(est.customer || ''); setScAddr(est.address || ''); setScJtype(est.jtype || 'GFCI / Receptacles')
    setScDate(est.date || new Date().toISOString().slice(0, 10)); setScHrs(String(est.estHours || ''))
    setScRate(est.rate || num(backup.settings?.billRate || 65)); setScMat(String(est.estMaterials || ''))
    setScMiles(String(est.estMileage || '')); setScTax(est.taxPct || num(backup.settings?.tax || 0))
    setScStore(est.store || ''); setScNotes(est.notes || ''); setEditingEstId(est.id)
    setShowEstForm(true)
  }

  function deleteEstimate(id) {
    if (!confirm('Delete this estimate?')) return
    pushState(backup)
    backup.serviceEstimates = (backup.serviceEstimates || []).filter(e => e.id !== id)
    saveBackupDataAndSync(backup, 'serviceEstimates')
    forceUpdate()
  }

  function moveToActive(id) {
    pushState(backup)
    const ests = backup.serviceEstimates || []
    const idx = ests.findIndex(e => e.id === id)
    if (idx < 0) return
    const est = ests[idx]
    if (!backup.activeServiceCalls) backup.activeServiceCalls = []
    backup.activeServiceCalls.push({
      id: 'asc' + Date.now() + Math.random().toString(36).slice(2, 6),
      fromEstimateId: est.id,
      customer: est.customer,
      address: est.address,
      jtype: est.jtype,
      date: est.date,
      estHours: est.estHours,
      rate: est.rate,
      estMaterials: est.estMaterials,
      estMileage: est.estMileage,
      taxPct: est.taxPct,
      store: est.store,
      notes: est.notes,
      quoted: est.quoted,
      internalCost: est.internalCost,
      profit: est.profit,
      movedAt: new Date().toISOString(),
    })
    backup.serviceEstimates = ests.filter(e => e.id !== id)
    saveBackupDataAndSync(backup, 'activeServiceCalls')
    forceUpdate()
  }

  function completeAndLog(id) {
    pushState(backup)
    const calls = backup.activeServiceCalls || []
    const idx = calls.findIndex(c => c.id === id)
    if (idx < 0) return
    const call = calls[idx]
    if (!backup.serviceLogs) backup.serviceLogs = []
    const mileCost = num(call.estMileage || 0) * mileRate
    backup.serviceLogs.push({
      id: 'svc_' + Date.now(),
      customer: call.customer || 'Unknown',
      address: call.address || '',
      date: call.date || new Date().toISOString().slice(0, 10),
      hrs: num(call.estHours || 0),
      miles: num(call.estMileage || 0),
      quoted: num(call.quoted || 0),
      collected: 0,
      mat: num(call.estMaterials || 0),
      opCost: num(call.estHours || 0) * opRate,
      jtype: call.jtype || 'Service Call',
      notes: call.notes || '',
      mileCost: mileCost,
      fromActiveCallId: call.id,
    })
    backup.activeServiceCalls = calls.filter(c => c.id !== id)
    saveBackupDataAndSync(backup, 'serviceLogs')
    forceUpdate()
  }

  function deleteActiveCall(id) {
    if (!confirm('Delete this active service call?')) return
    pushState(backup)
    backup.activeServiceCalls = (backup.activeServiceCalls || []).filter(c => c.id !== id)
    saveBackupDataAndSync(backup, 'activeServiceCalls')
    forceUpdate()
  }

  // Generate AI insights
  const generateEstimateInsights = (): Insight[] => {
    const insights: Insight[] = []
    const totals = estTotals()

    // Check margin %
    if (totals.marginPct < 20) {
      insights.push({
        icon: '⚠️',
        text: `Margin is low at ${totals.marginPct.toFixed(1)}%. Consider pricing adjustment or cost reduction.`,
        severity: 'warning',
      })
    } else if (totals.marginPct >= 25) {
      insights.push({
        icon: '✓',
        text: `Healthy margin at ${totals.marginPct.toFixed(1)}% — well positioned.`,
        severity: 'success',
      })
    }

    // Check labor cost ratio
    const laborRatio = totals.total > 0 ? (totals.lab / totals.total) * 100 : 0
    if (laborRatio > 50) {
      insights.push({
        icon: '⚠️',
        text: `Labor is ${laborRatio.toFixed(0)}% of total cost. Review crew efficiency.`,
        severity: 'warning',
      })
    }

    // Material cost check
    const matRatio = totals.total > 0 ? (totals.matC / totals.total) * 100 : 0
    if (matRatio > 40) {
      insights.push({
        icon: 'ℹ️',
        text: `Materials are ${matRatio.toFixed(0)}% of total. Ensure material pricing is competitive.`,
        severity: 'info',
      })
    }

    // Overhead % check (typical range 15-25%)
    const ohRatio = totals.total > 0 ? (totals.oh / totals.total) * 100 : 0
    if (ohRatio > 25) {
      insights.push({
        icon: 'ℹ️',
        text: `Overhead is ${ohRatio.toFixed(0)}%. Monitor operational cost allocation.`,
        severity: 'info',
      })
    } else if (ohRatio < 10) {
      insights.push({
        icon: 'ℹ️',
        text: `Overhead is ${ohRatio.toFixed(0)}%. May understate true project cost.`,
        severity: 'info',
      })
    }

    if (insights.length === 0) {
      insights.push({
        icon: '✓',
        text: 'Estimate parameters look healthy.',
        severity: 'success',
      })
    }

    return insights
  }

  // ── Part 1: VAULT Health Check ──────────────────────────────────────────────

  async function runVaultHealthCheck() {
    if (!hasAnyData) { alert('Add some estimate data first.'); return }
    setHealthCheckLoading(true)
    setHealthCheckOpen(false)
    setHealthCheckResult(null)
    try {
      const { callClaude, extractText } = await import('@/services/claudeProxy')
      const totals = estTotals()
      const laborRows = (p.laborRows || []).map(r => `${r.desc}: ${r.hrs}h @ $${r.rate}/h`)
      const priceBookItems = (backup.priceBook || []).map(i => i.name || i.desc || '').filter(Boolean).slice(0, 30)
      const completedJobs = (backup.completedArchive || []).slice(0, 5).map(j => `${j.name}: $${j.contract || 0} contract`)
      const prompt = `You are VAULT, estimating AI for Power On Solutions LLC, C-10 electrical contractor (Coachella Valley, CA).

Analyze this project estimate and return a JSON object with exactly these keys:
- "marginCheck": string — is the ${totals.marginPct.toFixed(1)}% margin adequate? What's typical for this job type?
- "missingItems": string[] — list of common line items for electrical work that appear to be missing
- "riskFlags": string[] — any unusually low or high line items or red flags
- "comparison": string — how this compares to typical estimates for similar work

Project: ${p.name || 'Unnamed'}
Contract: $${num(p.contract || 0).toFixed(0)}
Estimate Total: $${totals.total.toFixed(0)}
Labor: $${totals.lab.toFixed(0)} (${totals.labHrs.toFixed(1)} hrs)
Materials: $${totals.matC.toFixed(0)}
Overhead: $${totals.oh.toFixed(0)}
Mileage: $${totals.mi.toFixed(0)}
Margin: ${totals.marginPct.toFixed(1)}%
Labor rows: ${laborRows.join('; ') || 'none'}
Price book items available: ${priceBookItems.join(', ')}
Past completed jobs: ${completedJobs.join('; ') || 'none on record'}

Return ONLY valid JSON, no other text.`
      const resp = await callClaude({
        messages: [{ role: 'user', content: prompt }],
        system: 'You are VAULT, an electrical contracting estimate analyst. Return only valid JSON.',
        max_tokens: 800,
      })
      const text = extractText(resp)
      const cleaned = text.replace(/^```json?\s*/i, '').replace(/\s*```$/i, '').trim()
      const parsed = JSON.parse(cleaned)
      setHealthCheckResult(parsed)
      setHealthCheckOpen(true)
    } catch (err) {
      console.error('[VAULT HealthCheck]', err)
      setHealthCheckResult({ error: 'Analysis failed. Check console.' })
      setHealthCheckOpen(true)
    } finally {
      setHealthCheckLoading(false)
    }
  }

  // ── Part 2: Quick Start Templates ───────────────────────────────────────────

  const QUICK_START_TEMPLATES = [
    {
      id: 'residential_service_upgrade',
      label: '⚡ Residential Service Upgrade',
      laborRows: [
        { desc: 'Service Upgrade — Main', hrs: 16, rate: null },
        { desc: 'Panel Installation', hrs: 8, rate: null },
        { desc: 'Service Conductors & Conduit', hrs: 12, rate: null },
        { desc: 'Final Connections & Testing', hrs: 4, rate: null },
      ],
      ohRows: [
        { desc: 'Permit Fees', hrs: 2, rate: null },
        { desc: 'Inspection & Final Walkthrough', hrs: 2, rate: null },
      ],
    },
    {
      id: 'commercial_tenant_improvement',
      label: '🏢 Commercial Tenant Improvement',
      laborRows: [
        { desc: 'Branch Circuit Rough-In', hrs: 32, rate: null },
        { desc: 'Lighting Installation', hrs: 16, rate: null },
        { desc: 'Device & Outlet Install', hrs: 12, rate: null },
        { desc: 'Panel Feeder & Main', hrs: 8, rate: null },
        { desc: 'Final Trim & Testing', hrs: 6, rate: null },
      ],
      ohRows: [
        { desc: 'Permit & Plan Check', hrs: 4, rate: null },
        { desc: 'Inspection', hrs: 2, rate: null },
        { desc: 'As-Built Drawings', hrs: 2, rate: null },
      ],
    },
    {
      id: 'solar_installation',
      label: '☀️ Solar Installation (Sub to RMO)',
      laborRows: [
        { desc: 'AC Disconnect Installation', hrs: 4, rate: null },
        { desc: 'Conduit, Wire & Raceway', hrs: 12, rate: null },
        { desc: 'Inverter Connection & Config', hrs: 4, rate: null },
        { desc: 'Interconnection & Metering', hrs: 3, rate: null },
      ],
      ohRows: [
        { desc: 'Utility Interconnection Paperwork', hrs: 2, rate: null },
        { desc: 'NEC Labeling & Inspection', hrs: 2, rate: null },
      ],
    },
    {
      id: 'service_call',
      label: '🔧 Service Call',
      laborRows: [
        { desc: 'Diagnostic / Troubleshoot', hrs: 1, rate: null },
        { desc: 'Repair Labor', hrs: 2, rate: null },
      ],
      ohRows: [],
    },
    {
      id: 'panel_replacement',
      label: '🔌 Panel Replacement',
      laborRows: [
        { desc: 'Demo Existing Panel', hrs: 3, rate: null },
        { desc: 'Install New Panel & Bus', hrs: 8, rate: null },
        { desc: 'Reconnect Circuits', hrs: 6, rate: null },
        { desc: 'Label & Test', hrs: 2, rate: null },
      ],
      ohRows: [
        { desc: 'Permit Filing', hrs: 2, rate: null },
        { desc: 'Inspection', hrs: 1, rate: null },
      ],
    },
  ]

  function applyQuickStartTemplate(templateId: string) {
    const tpl = QUICK_START_TEMPLATES.find(t => t.id === templateId)
    if (!tpl) return
    if ((p.laborRows || []).length > 0 || (p.ohRows || []).length > 0) {
      if (!confirm(`This will replace existing labor and overhead rows with the "${tpl.label}" template. Continue?`)) return
    }
    pushState()
    const billRate = num(backup.settings?.billRate || 65)
    const ohRate = num(backup.settings?.defaultOHRate || 55)
    p.laborRows = tpl.laborRows.map(r => ({
      id: 'lr' + Date.now() + Math.random().toString(36).slice(2, 5),
      desc: r.desc,
      empId: 'me',
      hrs: r.hrs,
      rate: r.rate !== null ? r.rate : billRate,
    }))
    p.ohRows = tpl.ohRows.map(r => ({
      id: 'oh' + Date.now() + Math.random().toString(36).slice(2, 5),
      desc: r.desc,
      hrs: r.hrs,
      rate: r.rate !== null ? r.rate : ohRate,
    }))
    saveBackupData(backup)
    setShowQuickStart(false)
    forceUpdate()
  }

  // ── Part 3: Labor Calculator ─────────────────────────────────────────────────

  function computeLaborCalc() {
    const hrsPerUnit = {
      sqft: { simple: 0.02, standard: 0.035, complex: 0.06 },
      devices: { simple: 0.15, standard: 0.25, complex: 0.40 },
    }
    const crewEfficiency = { 1: 1.0, 2: 1.7, 3: 2.3 }
    const baseHrs = calcInput * (hrsPerUnit[calcInputType][calcComplexity] || 0.035)
    const efficiency = crewEfficiency[calcCrew as 1 | 2 | 3] || 1.7
    const hours = Math.round((baseHrs / efficiency) * 10) / 10
    const rate = num(backup.settings?.billRate || 65)
    return { hours, cost: Math.round(hours * rate * 100) / 100 }
  }

  function applyLaborCalc() {
    const result = computeLaborCalc()
    pushState()
    p.laborRows = p.laborRows || []
    p.laborRows.push({
      id: 'lr' + Date.now(),
      desc: `Labor — ${calcComplexity.charAt(0).toUpperCase() + calcComplexity.slice(1)} (${calcInput} ${calcInputType}, ${calcCrew}-person crew)`,
      empId: 'me',
      hrs: result.hours,
      rate: num(backup.settings?.billRate || 65),
    })
    saveBackupData(backup)
    setShowLaborCalc(false)
    setCalcResult(null)
    forceUpdate()
  }

  // ── Part 4: Version History ───────────────────────────────────────────────────

  function saveEstimateVersion() {
    const totals = estTotals()
    if (!hasAnyData && totals.total === 0) { alert('Nothing to snapshot yet.'); return }
    pushState()
    if (!backup.estimateVersions) backup.estimateVersions = {}
    if (!backup.estimateVersions[projectId]) backup.estimateVersions[projectId] = []
    const versions = backup.estimateVersions[projectId]
    versions.unshift({
      ts: Date.now(),
      total: totals.total,
      laborCount: (p.laborRows || []).length,
      ohCount: (p.ohRows || []).length,
      laborRows: JSON.parse(JSON.stringify(p.laborRows || [])),
      ohRows: JSON.parse(JSON.stringify(p.ohRows || [])),
    })
    // Max 5 versions
    if (versions.length > 5) versions.length = 5
    saveBackupData(backup)
    forceUpdate()
    alert('Snapshot saved ✓')
  }

  function restoreEstimateVersion(versionIdx: number) {
    const versions = (backup.estimateVersions || {})[projectId] || []
    const ver = versions[versionIdx]
    if (!ver) return
    if (!confirm(`Restore snapshot from ${new Date(ver.ts).toLocaleString()}? This replaces current labor and overhead rows.`)) return
    pushState()
    p.laborRows = JSON.parse(JSON.stringify(ver.laborRows))
    p.ohRows = JSON.parse(JSON.stringify(ver.ohRows))
    saveBackupData(backup)
    setShowVersionHistory(false)
    forceUpdate()
  }

  const estimateVersions = ((backup.estimateVersions || {})[projectId] || [])

  // G7: Estimate pipeline — compute Won / Pending / Lost from live data
  // ── Helper: total billable for a service log using money math (never stale payStatus) ──
  const svcTotalBillable = (l) => {
    const adjs = Array.isArray(l.adjustments) ? l.adjustments : []
    const addIncome = adjs.filter(a => a?.type === 'income').reduce((ac, a) => ac + num(a.amount), 0)
    return num(l.quoted) + addIncome
  }

  // WON box: active/won projects (work awarded) + service logs fully paid (money math)
  const pipelineWon = (() => {
    const allProjects = backup.projects || []
    const svcLogs = backup.serviceLogs || []
    // Active projects = awarded work (status: active, in_progress, won)
    const wonProjects = allProjects.filter(p => {
      const s = (p.status || '').toLowerCase()
      return resolveProjectBucket(p) === 'active' || s === 'won' || s === 'in_progress'
    })
    // Service logs fully collected: collected >= totalBillable (money math, never stale payStatus)
    const paidSvc = svcLogs.filter(l => {
      const tb = svcTotalBillable(l)
      return tb > 0 && num(l.collected) >= tb
    })
    return {
      count: wonProjects.length + paidSvc.length,
      value: wonProjects.reduce((s, p) => s + num(p.contract), 0)
             + paidSvc.reduce((s, l) => s + svcTotalBillable(l), 0)
    }
  })()

  // PENDING box: coming/estimating projects + open service estimates + active calls + partial svc
  const pipelinePending = (() => {
    const allProjects = backup.projects || []
    const estimates = backup.serviceEstimates || []
    const activeCalls = backup.activeServiceCalls || []
    const svcLogs = backup.serviceLogs || []
    // Coming projects = estimates in progress / not yet awarded
    const comingProjects = allProjects.filter(p => {
      const s = (p.status || '').toLowerCase()
      if (s === 'deleted' || s === 'lost' || s === 'rejected') return false
      return resolveProjectBucket(p) === 'coming'
    })
    // Open (non-lost) service estimates
    const openEstimates = estimates.filter(e => (e.estimateStatus || e.status || '') !== 'lost')
    // Active service calls in progress
    // Partial service payments (money math: some collected but not complete)
    const partialSvc = svcLogs.filter(l => {
      const tb = svcTotalBillable(l)
      return tb > 0 && num(l.collected) > 0 && num(l.collected) < tb
    })
    return {
      count: comingProjects.length + openEstimates.length + activeCalls.length + partialSvc.length,
      value: comingProjects.reduce((s, p) => s + num(p.contract), 0)
             + openEstimates.reduce((s, e) => s + num(e.quoted || 0), 0)
             + activeCalls.reduce((s, c) => s + num(c.quoted || 0), 0)
             + partialSvc.reduce((s, l) => s + (svcTotalBillable(l) - num(l.collected)), 0)
    }
  })()

  // LOST/UNPAID box — split into two states:
  // LOST: estimates/projects explicitly marked lost/rejected
  // UNPAID: completed projects with outstanding AR, unpaid service logs
  const pipelineLost = (() => {
    const allProjects = backup.projects || []
    const svcLogs = backup.serviceLogs || []
    const estimates = backup.serviceEstimates || []

    // LOST: estimates manually marked as lost
    const lostEstimates = estimates.filter(e => (e.estimateStatus || e.status || '') === 'lost')
    // LOST: projects explicitly set to lost/rejected status
    const lostProjects = allProjects.filter(p => {
      const s = (p.status || '').toLowerCase()
      return s === 'lost' || s === 'rejected'
    })
    const lostValue = lostEstimates.reduce((s, e) => s + num(e.quoted || 0), 0)
                    + lostProjects.reduce((s, p) => s + num(p.contract), 0)
    const lostCount = lostEstimates.length + lostProjects.length

    // UNPAID: completed projects with AR > 0 (money math)
    const unpaidProjects = allProjects.filter(p => {
      if (resolveProjectBucket(p) !== 'completed') return false
      const fin = getProjectFinancials(p, backup)
      return fin.AR > 0
    })
    // UNPAID: service logs with zero collection (money math, no stale payStatus)
    const unpaidSvc = svcLogs.filter(l => {
      const tb = svcTotalBillable(l)
      return tb > 0 && num(l.collected) === 0
    })
    const unpaidValue = unpaidProjects.reduce((s, p) => s + getProjectFinancials(p, backup).AR, 0)
                      + unpaidSvc.reduce((s, l) => s + svcTotalBillable(l), 0)
    const unpaidCount = unpaidProjects.length + unpaidSvc.length

    return {
      count: lostCount + unpaidCount,
      value: lostValue + unpaidValue,
      lostCount, lostValue,
      unpaidCount, unpaidValue
    }
  })()
  const pipelineTotal = pipelineWon.value + pipelinePending.value + pipelineLost.value

  return (
    <div style={{ backgroundColor: '#1a1d27', padding: '0' }}>

      {/* G7: Deal Overview Pipeline Chart */}
      <div style={{ backgroundColor: '#232738', borderRadius: '8px', padding: '16px', marginBottom: '16px', border: '1px solid rgba(255,255,255,0.06)' }}>
        <div style={{ fontWeight: '700', fontSize: '13px', color: '#9ca3af', textTransform: 'uppercase', marginBottom: '12px', letterSpacing: '0.05em' }}>
          📊 Estimate Pipeline Overview
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px', marginBottom: '12px' }}>
          {/* Won — active projects (awarded work) + fully paid service calls */}
          <div style={{ backgroundColor: 'rgba(16,185,129,0.1)', borderRadius: '6px', padding: '10px 12px', borderLeft: '3px solid #10b981' }}>
            <div style={{ fontSize: '10px', color: '#6b7280', fontWeight: '600', textTransform: 'uppercase', marginBottom: '4px' }}>✅ Won</div>
            <div style={{ fontSize: '18px', fontWeight: '800', color: '#10b981', fontFamily: 'monospace' }}>{fmt(pipelineWon.value)}</div>
            <div style={{ fontSize: '11px', color: '#6b7280' }}>{pipelineWon.count} active/awarded</div>
          </div>
          {/* Pending — coming projects + open service estimates + active calls */}
          <div style={{ backgroundColor: 'rgba(234,179,8,0.1)', borderRadius: '6px', padding: '10px 12px', borderLeft: '3px solid #eab308' }}>
            <div style={{ fontSize: '10px', color: '#6b7280', fontWeight: '600', textTransform: 'uppercase', marginBottom: '4px' }}>⏳ Pending</div>
            <div style={{ fontSize: '18px', fontWeight: '800', color: '#eab308', fontFamily: 'monospace' }}>{fmt(pipelinePending.value)}</div>
            <div style={{ fontSize: '11px', color: '#6b7280' }}>{pipelinePending.count} open estimates</div>
          </div>
          {/* Lost / Unpaid — split into two states */}
          <div style={{ backgroundColor: 'rgba(239,68,68,0.1)', borderRadius: '6px', padding: '10px 12px', borderLeft: '3px solid #ef4444' }}>
            <div style={{ fontSize: '10px', color: '#6b7280', fontWeight: '600', textTransform: 'uppercase', marginBottom: '4px' }}>❌ Lost / Unpaid</div>
            <div style={{ fontSize: '18px', fontWeight: '800', color: '#ef4444', fontFamily: 'monospace' }}>{fmt(pipelineLost.value)}</div>
            <div style={{ display: 'flex', gap: '8px', marginTop: '4px', flexWrap: 'wrap' }}>
              {pipelineLost.lostCount > 0 && (
                <span style={{ fontSize: '10px', color: '#f87171', backgroundColor: 'rgba(239,68,68,0.15)', padding: '1px 6px', borderRadius: '3px' }}>
                  Lost: {pipelineLost.lostCount} ({fmt(pipelineLost.lostValue)})
                </span>
              )}
              {pipelineLost.unpaidCount > 0 && (
                <span style={{ fontSize: '10px', color: '#fb923c', backgroundColor: 'rgba(251,146,60,0.15)', padding: '1px 6px', borderRadius: '3px' }}>
                  Unpaid: {pipelineLost.unpaidCount} ({fmt(pipelineLost.unpaidValue)})
                </span>
              )}
              {pipelineLost.count === 0 && <span style={{ fontSize: '11px', color: '#6b7280' }}>0 items</span>}
            </div>
          </div>
        </div>

        {/* Pending estimate rows with Mark as Lost */}
        {(backup.serviceEstimates || []).filter(e => (e.estimateStatus || e.status || '') !== 'lost').length > 0 && (
          <div style={{ marginTop: '12px', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '10px' }}>
            <div style={{ fontSize: '10px', color: '#6b7280', fontWeight: '600', textTransform: 'uppercase', marginBottom: '6px' }}>
              Open Service Estimates
            </div>
            {(backup.serviceEstimates || [])
              .filter(e => (e.estimateStatus || e.status || '') !== 'lost')
              .map(est => (
                <div key={est.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '5px 8px', backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: '4px', marginBottom: '4px' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ fontSize: '12px', color: '#d1d5db', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>
                      {est.customer || est.name || 'Unnamed'} — {est.address || ''}
                    </span>
                    <span style={{ fontSize: '10px', color: '#6b7280' }}>{fmt(num(est.quoted))} · {est.date || ''}</span>
                  </div>
                  <button
                    onClick={() => {
                      if (!confirm('Mark this estimate as Lost?')) return
                      const b = getBackupData()
                      if (!b) return
                      const idx = (b.serviceEstimates || []).findIndex(e => e.id === est.id)
                      if (idx >= 0) {
                        b.serviceEstimates[idx].estimateStatus = 'lost'
                        saveBackupData(b)
                        forceUpdate()
                      }
                    }}
                    style={{ padding: '3px 8px', backgroundColor: 'rgba(239,68,68,0.15)', color: '#f87171', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '3px', fontSize: '10px', fontWeight: '600', cursor: 'pointer', whiteSpace: 'nowrap', marginLeft: '8px' }}
                  >
                    Mark Lost
                  </button>
                </div>
              ))
            }
          </div>
        )}
        {/* Pipeline bar visualization */}
        {pipelineTotal > 0 && (
          <div>
            <div style={{ height: '12px', borderRadius: '6px', overflow: 'hidden', display: 'flex', gap: '1px', backgroundColor: '#1e2130' }}>
              {pipelineWon.value > 0 && (
                <div style={{ flex: pipelineWon.value / pipelineTotal, backgroundColor: '#10b981', minWidth: '2px' }}
                     title={`Won: ${fmt(pipelineWon.value)}`} />
              )}
              {pipelinePending.value > 0 && (
                <div style={{ flex: pipelinePending.value / pipelineTotal, backgroundColor: '#eab308', minWidth: '2px' }}
                     title={`Pending: ${fmt(pipelinePending.value)}`} />
              )}
              {pipelineLost.value > 0 && (
                <div style={{ flex: pipelineLost.value / pipelineTotal, backgroundColor: '#ef4444', minWidth: '2px' }}
                     title={`Lost: ${fmt(pipelineLost.value)}`} />
              )}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: '#4b5563', marginTop: '4px' }}>
              <span>Total Pipeline: {fmt(pipelineTotal)}</span>
              <span>Win Rate: {pipelineTotal > 0 ? ((pipelineWon.value / pipelineTotal) * 100).toFixed(0) : 0}%</span>
            </div>
          </div>
        )}
      </div>

      {/* Estimate header bar */}
      <div style={{ display: 'flex', gap: '2px', marginBottom: showQuickStart ? '0' : '16px', backgroundColor: '#0f1117', borderRadius: showQuickStart ? '8px 8px 0 0' : '8px', padding: '3px', alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, padding: '8px 12px', fontSize: '13px', fontWeight: '600', color: '#fff' }}>
          Project Estimate
        </div>
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center', paddingRight: '8px' }}>
          <button
            onClick={() => { setShowQuickStart(v => !v); setShowVersionHistory(false) }}
            title="Quick Start Templates"
            style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '5px 10px', backgroundColor: showQuickStart ? 'rgba(234,179,8,0.25)' : 'rgba(234,179,8,0.12)', color: '#fbbf24', border: '1px solid rgba(234,179,8,0.3)', borderRadius: '5px', fontSize: '11px', fontWeight: '600', cursor: 'pointer' }}
          >
            ⚡ Quick Start
          </button>
          <button
            onClick={() => { setShowVersionHistory(v => !v); setShowQuickStart(false) }}
            title="Version History"
            style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '5px 10px', backgroundColor: showVersionHistory ? 'rgba(99,102,241,0.25)' : 'rgba(99,102,241,0.12)', color: '#818cf8', border: '1px solid rgba(99,102,241,0.3)', borderRadius: '5px', fontSize: '11px', fontWeight: '600', cursor: 'pointer' }}
          >
            📋 History {estimateVersions.length > 0 ? `(${estimateVersions.length})` : ''}
          </button>
          <AskAIButton onClick={() => setAiOpen(true)} />
        </div>
      </div>

      {/* Quick Start Template Dropdown */}
      {showQuickStart && (
        <div style={{ backgroundColor: '#1a1f2e', border: '1px solid rgba(234,179,8,0.25)', borderTop: 'none', borderRadius: '0 0 8px 8px', padding: '12px', marginBottom: '16px' }}>
          <div style={{ fontSize: '11px', color: '#9ca3af', fontWeight: '600', textTransform: 'uppercase', marginBottom: '8px', letterSpacing: '0.05em' }}>
            Select a job type to pre-populate common line items:
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '6px' }}>
            {QUICK_START_TEMPLATES.map(tpl => (
              <button
                key={tpl.id}
                onClick={() => applyQuickStartTemplate(tpl.id)}
                style={{ textAlign: 'left', padding: '8px 12px', backgroundColor: 'rgba(234,179,8,0.08)', color: '#f3f4f6', border: '1px solid rgba(234,179,8,0.2)', borderRadius: '6px', fontSize: '12px', fontWeight: '500', cursor: 'pointer' }}
              >
                {tpl.label}
                <div style={{ fontSize: '10px', color: '#6b7280', marginTop: '2px' }}>
                  {tpl.laborRows.length} labor rows{tpl.ohRows.length > 0 ? ` + ${tpl.ohRows.length} overhead` : ''}
                </div>
              </button>
            ))}
          </div>
          <div style={{ fontSize: '10px', color: '#4b5563', marginTop: '8px' }}>
            Tip: Templates use your price book rates. Edit any row after applying.
          </div>
        </div>
      )}

      {/* Version History Dropdown */}
      {showVersionHistory && (
        <div style={{ backgroundColor: '#1a1f2e', border: '1px solid rgba(99,102,241,0.25)', borderTop: 'none', borderRadius: '0 0 8px 8px', padding: '12px', marginBottom: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <div style={{ fontSize: '11px', color: '#9ca3af', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Saved Snapshots (max 5)
            </div>
            <button
              onClick={saveEstimateVersion}
              style={{ padding: '4px 10px', backgroundColor: 'rgba(99,102,241,0.2)', color: '#818cf8', border: '1px solid rgba(99,102,241,0.3)', borderRadius: '4px', fontSize: '10px', fontWeight: '600', cursor: 'pointer' }}
            >
              💾 Save Now
            </button>
          </div>
          {estimateVersions.length === 0 ? (
            <div style={{ fontSize: '12px', color: '#4b5563', textAlign: 'center', padding: '12px 0' }}>
              No snapshots yet. Click "Save Now" to capture current state.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {estimateVersions.map((ver, idx) => (
                <div key={ver.ts} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px', backgroundColor: 'rgba(99,102,241,0.06)', border: '1px solid rgba(99,102,241,0.15)', borderRadius: '6px' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '12px', color: '#e5e7eb', fontWeight: '600' }}>
                      {new Date(ver.ts).toLocaleString()}
                    </div>
                    <div style={{ fontSize: '10px', color: '#6b7280' }}>
                      Total: <span style={{ color: '#10b981', fontFamily: 'monospace' }}>{fmt(ver.total)}</span>
                      {' · '}{ver.laborCount} labor + {ver.ohCount} overhead rows
                    </div>
                  </div>
                  {idx === 0 && <span style={{ fontSize: '9px', color: '#818cf8', fontWeight: '700', textTransform: 'uppercase' }}>Latest</span>}
                  <button
                    onClick={() => restoreEstimateVersion(idx)}
                    style={{ padding: '3px 8px', backgroundColor: 'rgba(99,102,241,0.2)', color: '#818cf8', border: '1px solid rgba(99,102,241,0.3)', borderRadius: '3px', fontSize: '10px', fontWeight: '600', cursor: 'pointer' }}
                  >
                    Restore
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Service Call Estimate removed — available in Field Log panel */}
      {false && (
        <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
          {/* TWO-BUCKET HEADER ROW */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
            {/* LEFT BUCKET: Open Service Estimates */}
            <div style={{ backgroundColor: '#232738', borderRadius: '8px', overflow: 'hidden' }}>
              <div style={{ backgroundColor: 'rgba(59,130,246,0.15)', padding: '10px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                <h4 style={{ color: '#3b82f6', fontWeight: '600', margin: 0, fontSize: '13px' }}>Open Service Estimates</h4>
                <button onClick={() => { resetEstForm(); setShowEstForm(true) }} style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '4px 10px', backgroundColor: 'rgba(59,130,246,0.25)', color: '#60a5fa', border: '1px solid rgba(59,130,246,0.4)', borderRadius: '4px', fontSize: '11px', fontWeight: '600', cursor: 'pointer' }}>
                  <Plus size={12} /> Add Estimate
                </button>
              </div>
              <div style={{ padding: '8px', maxHeight: '280px', overflowY: 'auto' }}>
                {(backup.serviceEstimates || []).length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '20px 8px', color: 'var(--t3)', fontSize: '12px' }}>No open estimates</div>
                ) : (backup.serviceEstimates || []).map(est => (
                  <div key={est.id} style={{ backgroundColor: '#1e2130', borderRadius: '6px', padding: '10px 12px', marginBottom: '6px', borderLeft: '3px solid #3b82f6' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '4px' }}>
                      <div>
                        <div style={{ color: 'var(--t1)', fontWeight: '600', fontSize: '13px' }}>{est.customer}</div>
                        <div style={{ color: 'var(--t3)', fontSize: '11px' }}>{est.jtype} &middot; {est.date}</div>
                      </div>
                      <span style={{ color: '#eab308', fontWeight: '700', fontFamily: 'monospace', fontSize: '14px' }}>{fmt(est.quoted)}</span>
                    </div>
                    <div style={{ display: 'flex', gap: '4px', marginTop: '6px' }}>
                      <button onClick={() => editEstimate(est)} style={{ padding: '3px 8px', backgroundColor: 'rgba(234,179,8,0.15)', color: '#eab308', border: '1px solid rgba(234,179,8,0.3)', borderRadius: '3px', fontSize: '10px', fontWeight: '600', cursor: 'pointer' }}>Edit</button>
                      <button onClick={() => moveToActive(est.id)} style={{ display: 'flex', alignItems: 'center', gap: '3px', padding: '3px 8px', backgroundColor: 'rgba(16,185,129,0.15)', color: '#10b981', border: '1px solid rgba(16,185,129,0.3)', borderRadius: '3px', fontSize: '10px', fontWeight: '600', cursor: 'pointer' }}><ArrowRight size={10} /> Move to Active</button>
                      <button onClick={() => deleteEstimate(est.id)} style={{ padding: '3px 6px', backgroundColor: 'rgba(239,68,68,0.15)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '3px', fontSize: '10px', cursor: 'pointer', marginLeft: 'auto' }}><Trash2 size={10} /></button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* RIGHT BUCKET: Active Service Calls */}
            <div style={{ backgroundColor: '#232738', borderRadius: '8px', overflow: 'hidden' }}>
              <div style={{ backgroundColor: 'rgba(249,115,22,0.15)', padding: '10px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                <h4 style={{ color: '#f97316', fontWeight: '600', margin: 0, fontSize: '13px' }}>Active Service Calls</h4>
                <span style={{ fontSize: '11px', color: 'var(--t3)', fontWeight: '600' }}>{(backup.activeServiceCalls || []).length} active</span>
              </div>
              <div style={{ padding: '8px', maxHeight: '280px', overflowY: 'auto' }}>
                {(backup.activeServiceCalls || []).length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '20px 8px', color: 'var(--t3)', fontSize: '12px' }}>No active calls</div>
                ) : (backup.activeServiceCalls || []).map(call => (
                  <div key={call.id} style={{ backgroundColor: '#1e2130', borderRadius: '6px', padding: '10px 12px', marginBottom: '6px', borderLeft: '3px solid #f97316' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '4px' }}>
                      <div>
                        <div style={{ color: 'var(--t1)', fontWeight: '600', fontSize: '13px' }}>{call.customer}</div>
                        <div style={{ color: 'var(--t3)', fontSize: '11px' }}>{call.jtype} &middot; {call.date}</div>
                      </div>
                      <span style={{ color: '#eab308', fontWeight: '700', fontFamily: 'monospace', fontSize: '14px' }}>{fmt(call.quoted)}</span>
                    </div>
                    <div style={{ display: 'flex', gap: '4px', marginTop: '6px' }}>
                      <button onClick={() => completeAndLog(call.id)} style={{ display: 'flex', alignItems: 'center', gap: '3px', padding: '3px 8px', backgroundColor: 'rgba(16,185,129,0.15)', color: '#10b981', border: '1px solid rgba(16,185,129,0.3)', borderRadius: '3px', fontSize: '10px', fontWeight: '600', cursor: 'pointer' }}><Check size={10} /> Complete & Log</button>
                      <button onClick={() => deleteActiveCall(call.id)} style={{ padding: '3px 6px', backgroundColor: 'rgba(239,68,68,0.15)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '3px', fontSize: '10px', cursor: 'pointer', marginLeft: 'auto' }}><Trash2 size={10} /></button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* SERVICE CALL ESTIMATOR FORM (collapsible) */}
          {showEstForm && (
            <div style={{ backgroundColor: '#232738', borderRadius: '8px', padding: '16px', marginBottom: '16px', border: '1px solid rgba(59,130,246,0.3)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                <h3 style={{ color: 'var(--t1)', fontWeight: '600', margin: 0, fontSize: '15px' }}>{editingEstId ? 'Edit Service Estimate' : 'New Service Estimate'}</h3>
                <button onClick={() => { setShowEstForm(false); resetEstForm() }} style={{ background: 'none', border: 'none', color: 'var(--t3)', cursor: 'pointer' }}><X size={16} /></button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '10px', color: 'var(--t3)', marginBottom: '4px', fontWeight: '600', textTransform: 'uppercase' }}>Customer / Job Name *</label>
                  <input value={scCust} onChange={e => setScCust(e.target.value)} style={{ width: '100%', padding: '6px 8px', backgroundColor: '#1e2130', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '4px', color: 'var(--t1)', fontSize: '13px' }} />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '10px', color: 'var(--t3)', marginBottom: '4px', fontWeight: '600', textTransform: 'uppercase' }}>Job Type</label>
                  <select value={scJtype} onChange={e => setScJtype(e.target.value)} style={{ width: '100%', padding: '6px 8px', backgroundColor: '#1e2130', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '4px', color: 'var(--t1)', fontSize: '13px' }}>
                    {SVC_JOB_TYPES.map(jt => <option key={jt} value={jt}>{jt}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '10px', color: 'var(--t3)', marginBottom: '4px', fontWeight: '600', textTransform: 'uppercase' }}>Date</label>
                  <input type="date" value={scDate} onChange={e => setScDate(e.target.value)} style={{ width: '100%', padding: '6px 8px', backgroundColor: '#1e2130', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '4px', color: 'var(--t1)', fontSize: '13px' }} />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '10px', color: 'var(--t3)', marginBottom: '4px', fontWeight: '600', textTransform: 'uppercase' }}>Total Quoted $</label>
                  <div style={{ padding: '6px 8px', backgroundColor: '#1e2130', border: '1px solid rgba(234,179,8,0.3)', borderRadius: '4px', color: '#eab308', fontSize: '13px', fontFamily: 'monospace', fontWeight: '600' }}>{fmt(scQuoted)}</div>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '10px', color: 'var(--t3)', marginBottom: '4px', fontWeight: '600', textTransform: 'uppercase' }}>Material Cost $</label>
                  <input type="number" step="0.01" value={scMat} onChange={e => setScMat(e.target.value)} style={{ width: '100%', padding: '6px 8px', backgroundColor: '#1e2130', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '4px', color: 'var(--t1)', fontSize: '13px', fontFamily: 'monospace' }} />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '10px', color: 'var(--t3)', marginBottom: '4px', fontWeight: '600', textTransform: 'uppercase' }}>Est Labor Hours</label>
                  <input type="number" step="0.5" value={scHrs} onChange={e => setScHrs(e.target.value)} style={{ width: '100%', padding: '6px 8px', backgroundColor: '#1e2130', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '4px', color: 'var(--t1)', fontSize: '13px', fontFamily: 'monospace' }} />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '10px', color: 'var(--t3)', marginBottom: '4px', fontWeight: '600', textTransform: 'uppercase' }}>Hourly Rate $</label>
                  <input type="number" step="0.01" value={scRate} onChange={e => setScRate(e.target.value)} style={{ width: '100%', padding: '6px 8px', backgroundColor: '#1e2130', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '4px', color: 'var(--t1)', fontSize: '13px', fontFamily: 'monospace' }} />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '10px', color: 'var(--t3)', marginBottom: '4px', fontWeight: '600', textTransform: 'uppercase' }}>Miles RT</label>
                  <input type="number" value={scMiles} onChange={e => setScMiles(e.target.value)} style={{ width: '100%', padding: '6px 8px', backgroundColor: '#1e2130', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '4px', color: 'var(--t1)', fontSize: '13px', fontFamily: 'monospace' }} />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '10px', color: 'var(--t3)', marginBottom: '4px', fontWeight: '600', textTransform: 'uppercase' }}>Store / Supplier</label>
                  <input value={scStore} onChange={e => setScStore(e.target.value)} style={{ width: '100%', padding: '6px 8px', backgroundColor: '#1e2130', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '4px', color: 'var(--t1)', fontSize: '13px' }} />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '10px', color: 'var(--t3)', marginBottom: '4px', fontWeight: '600', textTransform: 'uppercase' }}>Tax %</label>
                  <input type="number" step="0.01" value={scTax} onChange={e => setScTax(e.target.value)} style={{ width: '100%', padding: '6px 8px', backgroundColor: '#1e2130', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '4px', color: 'var(--t1)', fontSize: '13px', fontFamily: 'monospace' }} />
                </div>
              </div>
              <div style={{ marginTop: '12px' }}>
                <label style={{ display: 'block', fontSize: '10px', color: 'var(--t3)', marginBottom: '4px', fontWeight: '600', textTransform: 'uppercase' }}>Notes / Scope</label>
                <textarea value={scNotes} onChange={e => setScNotes(e.target.value)} rows={2} style={{ width: '100%', padding: '6px 8px', backgroundColor: '#1e2130', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '4px', color: 'var(--t1)', fontSize: '13px', resize: 'none' }} />
              </div>

              {/* COST BREAKDOWN BAR */}
              {scQuoted > 0 && (
                <div style={{ marginTop: '16px' }}>
                  <div style={{ fontSize: '11px', color: 'var(--t3)', marginBottom: '6px', fontWeight: '600', textTransform: 'uppercase' }}>Cost Breakdown</div>
                  <div style={{ display: 'flex', height: '20px', borderRadius: '4px', overflow: 'hidden', gap: '1px', backgroundColor: '#1e2130' }}>
                    {scMatN > 0 && <div style={{ flex: scMatN / scQuoted, backgroundColor: '#f59e0b', minWidth: '2px' }} title={`Material: ${fmt(scMatN)}`} />}
                    {scMileCost > 0 && <div style={{ flex: scMileCost / scQuoted, backgroundColor: '#06b6d4', minWidth: '2px' }} title={`Mileage: ${fmt(scMileCost)}`} />}
                    {scOpCost > 0 && <div style={{ flex: scOpCost / scQuoted, backgroundColor: '#a855f7', minWidth: '2px' }} title={`OP Cost: ${fmt(scOpCost)}`} />}
                    {scProfit > 0 && <div style={{ flex: scProfit / scQuoted, backgroundColor: '#10b981', minWidth: '2px' }} title={`Profit: ${fmt(scProfit)}`} />}
                  </div>
                  <div style={{ display: 'flex', gap: '12px', marginTop: '6px', fontSize: '10px', flexWrap: 'wrap' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '4px', color: 'var(--t3)' }}><span style={{ width: '6px', height: '6px', backgroundColor: '#eab308', borderRadius: '1px', display: 'inline-block' }} />Quoted {fmt(scQuoted)}</span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '4px', color: 'var(--t3)' }}><span style={{ width: '6px', height: '6px', backgroundColor: '#f59e0b', borderRadius: '1px', display: 'inline-block' }} />Material {fmt(scMatN)}</span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '4px', color: 'var(--t3)' }}><span style={{ width: '6px', height: '6px', backgroundColor: '#06b6d4', borderRadius: '1px', display: 'inline-block' }} />Mileage {fmt(scMileCost)}</span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '4px', color: 'var(--t3)' }}><span style={{ width: '6px', height: '6px', backgroundColor: '#a855f7', borderRadius: '1px', display: 'inline-block' }} />OP Cost {fmt(scOpCost)}</span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '4px', color: scProfit >= 0 ? '#10b981' : '#ef4444' }}><span style={{ width: '6px', height: '6px', backgroundColor: scProfit >= 0 ? '#10b981' : '#ef4444', borderRadius: '1px', display: 'inline-block' }} />Profit {fmt(scProfit)}</span>
                  </div>
                </div>
              )}

              {/* SAVE BUTTON */}
              <div style={{ display: 'flex', gap: '8px', marginTop: '16px' }}>
                <button onClick={saveEstimate} style={{ padding: '10px 20px', backgroundColor: 'rgba(59,130,246,0.25)', color: '#60a5fa', border: '1px solid rgba(59,130,246,0.4)', borderRadius: '6px', fontSize: '13px', fontWeight: '600', cursor: 'pointer' }}>
                  {editingEstId ? 'Update Estimate' : 'Save Estimate'}
                </button>
                <button onClick={() => { setShowEstForm(false); resetEstForm() }} style={{ padding: '10px 16px', backgroundColor: 'transparent', color: 'var(--t3)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', fontSize: '13px', cursor: 'pointer' }}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* PROJECT ESTIMATE (main content) */}
      {(
      <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
        {!hasAnyData && (
          <div
            style={{
              backgroundColor: '#232738',
              borderRadius: '8px',
              padding: '40px 16px',
              textAlign: 'center',
              color: 'var(--t3)',
              marginBottom: '16px',
            }}
          >
            <p style={{ margin: '0 0 16px 0' }}>No estimate data yet. Start by adding labor, materials, or overhead.</p>
            <button
              onClick={addLaborRow}
              style={{
                padding: '8px 16px',
                backgroundColor: 'rgba(59,130,246,0.2)',
                color: '#3b82f6',
                border: '1px solid rgba(59,130,246,0.3)',
                borderRadius: '4px',
                fontSize: '12px',
                fontWeight: '600',
                cursor: 'pointer',
                marginRight: '8px',
              }}
            >
              + Add Labor
            </button>
            <button
              onClick={addOHRow}
              style={{
                padding: '8px 16px',
                backgroundColor: 'rgba(59,130,246,0.2)',
                color: '#3b82f6',
                border: '1px solid rgba(59,130,246,0.3)',
                borderRadius: '4px',
                fontSize: '12px',
                fontWeight: '600',
                cursor: 'pointer',
              }}
            >
              + Add Overhead
            </button>
          </div>
        )}

        {/* LABOR CALCULATOR */}
        <div style={{ backgroundColor: '#232738', borderRadius: '8px', marginBottom: '16px', overflow: 'hidden' }}>
          <div
            style={{ backgroundColor: 'rgba(6,182,212,0.1)', padding: '10px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', borderBottom: showLaborCalc ? '1px solid rgba(255,255,255,0.05)' : 'none' }}
            onClick={() => { setShowLaborCalc(v => !v); setCalcResult(null) }}
          >
            <h4 style={{ color: '#22d3ee', fontWeight: '600', margin: '0', fontSize: '13px' }}>🔢 Labor Calculator</h4>
            <span style={{ color: '#6b7280', fontSize: '11px' }}>{showLaborCalc ? '▲ Hide' : '▼ Expand'}</span>
          </div>
          {showLaborCalc && (
            <div style={{ padding: '14px 16px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '12px', marginBottom: '12px' }}>
                {/* Input value */}
                <div>
                  <label style={{ display: 'block', fontSize: '10px', color: '#9ca3af', fontWeight: '600', textTransform: 'uppercase', marginBottom: '4px' }}>
                    {calcInputType === 'sqft' ? 'Square Footage' : 'Number of Devices'}
                  </label>
                  <input
                    type="number"
                    min={1}
                    value={calcInput}
                    onChange={e => { setCalcInput(parseInt(e.target.value) || 1); setCalcResult(null) }}
                    style={{ width: '100%', padding: '6px 8px', backgroundColor: '#1e2130', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '4px', color: '#f3f4f6', fontFamily: 'monospace', fontSize: '13px' }}
                  />
                </div>
                {/* Input type */}
                <div>
                  <label style={{ display: 'block', fontSize: '10px', color: '#9ca3af', fontWeight: '600', textTransform: 'uppercase', marginBottom: '4px' }}>Input Type</label>
                  <select
                    value={calcInputType}
                    onChange={e => { setCalcInputType(e.target.value as any); setCalcResult(null) }}
                    style={{ width: '100%', padding: '6px 8px', backgroundColor: '#1e2130', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '4px', color: '#f3f4f6', fontSize: '13px' }}
                  >
                    <option value="sqft">Square Footage</option>
                    <option value="devices">Number of Devices</option>
                  </select>
                </div>
                {/* Complexity */}
                <div>
                  <label style={{ display: 'block', fontSize: '10px', color: '#9ca3af', fontWeight: '600', textTransform: 'uppercase', marginBottom: '4px' }}>Job Complexity</label>
                  <select
                    value={calcComplexity}
                    onChange={e => { setCalcComplexity(e.target.value as any); setCalcResult(null) }}
                    style={{ width: '100%', padding: '6px 8px', backgroundColor: '#1e2130', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '4px', color: '#f3f4f6', fontSize: '13px' }}
                  >
                    <option value="simple">Simple</option>
                    <option value="standard">Standard</option>
                    <option value="complex">Complex</option>
                  </select>
                </div>
                {/* Crew size */}
                <div>
                  <label style={{ display: 'block', fontSize: '10px', color: '#9ca3af', fontWeight: '600', textTransform: 'uppercase', marginBottom: '4px' }}>Crew Size</label>
                  <select
                    value={calcCrew}
                    onChange={e => { setCalcCrew(parseInt(e.target.value)); setCalcResult(null) }}
                    style={{ width: '100%', padding: '6px 8px', backgroundColor: '#1e2130', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '4px', color: '#f3f4f6', fontSize: '13px' }}
                  >
                    <option value={1}>1 Person</option>
                    <option value={2}>2 People</option>
                    <option value={3}>3 People</option>
                  </select>
                </div>
              </div>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                <button
                  onClick={() => setCalcResult(computeLaborCalc())}
                  style={{ padding: '8px 16px', backgroundColor: 'rgba(6,182,212,0.2)', color: '#22d3ee', border: '1px solid rgba(6,182,212,0.4)', borderRadius: '5px', fontSize: '12px', fontWeight: '600', cursor: 'pointer' }}
                >
                  Calculate
                </button>
                {calcResult && (
                  <>
                    <div style={{ flex: 1, padding: '8px 12px', backgroundColor: 'rgba(6,182,212,0.08)', border: '1px solid rgba(6,182,212,0.2)', borderRadius: '5px', fontSize: '13px', color: '#e5e7eb' }}>
                      <span style={{ color: '#22d3ee', fontWeight: '700', fontFamily: 'monospace' }}>{calcResult.hours}h</span>
                      <span style={{ color: '#6b7280', margin: '0 6px' }}>·</span>
                      <span style={{ color: '#10b981', fontWeight: '700', fontFamily: 'monospace' }}>{fmt(calcResult.cost)}</span>
                      <span style={{ color: '#6b7280', fontSize: '11px', marginLeft: '6px' }}>@ ${num(backup.settings?.billRate || 65)}/h</span>
                    </div>
                    <button
                      onClick={applyLaborCalc}
                      style={{ padding: '8px 14px', backgroundColor: 'rgba(16,185,129,0.2)', color: '#10b981', border: '1px solid rgba(16,185,129,0.4)', borderRadius: '5px', fontSize: '12px', fontWeight: '600', cursor: 'pointer' }}
                    >
                      + Add to Estimate
                    </button>
                  </>
                )}
              </div>
              <div style={{ fontSize: '10px', color: '#374151', marginTop: '8px' }}>
                Rates: sqft — simple 0.02h, standard 0.035h, complex 0.06h | devices — simple 0.15h, standard 0.25h, complex 0.40h
              </div>
            </div>
          )}
        </div>

        {/* LABOR SECTION */}
        <div style={{ backgroundColor: '#232738', borderRadius: '8px', marginBottom: '16px', overflow: 'hidden' }}>
          <div
            style={{
              backgroundColor: 'rgba(16,185,129,0.1)',
              padding: '12px 16px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              borderBottom: '1px solid rgba(255,255,255,0.05)',
            }}
          >
            <h4 style={{ color: 'var(--t1)', fontWeight: '600', margin: '0' }}>Labor</h4>
            <span style={{ color: '#10b981', fontWeight: '600', fontFamily: 'monospace' }}>{fmt(t.lab)}</span>
          </div>
          <div style={{ padding: '12px' }}>
            <table style={{ width: '100%', fontSize: '13px', color: 'var(--t2)', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--bdr2)' }}>
                  <th style={{ textAlign: 'left', padding: '8px', fontWeight: '600' }}>Description</th>
                  <th style={{ textAlign: 'left', padding: '8px', fontWeight: '600', width: '120px' }}>Employee</th>
                  <th style={{ textAlign: 'right', padding: '8px', fontWeight: '600', width: '80px' }}>Hours</th>
                  <th style={{ textAlign: 'right', padding: '8px', fontWeight: '600', width: '80px' }}>Rate</th>
                  <th style={{ textAlign: 'right', padding: '8px', fontWeight: '600', width: '100px' }}>Total</th>
                  <th style={{ textAlign: 'center', padding: '8px', fontWeight: '600', width: '40px' }}></th>
                </tr>
              </thead>
              <tbody>
                {(p.laborRows || []).map(r => {
                  const emp = (backup.employees || []).find(e => e.id === r.empId) || { name: 'Owner/Me' }
                  return (
                    <tr key={r.id} style={{ borderBottom: '1px solid var(--bdr2)' }}>
                      <td style={{ padding: '8px' }}>
                        <textarea
                          value={r.desc || ''}
                          onChange={e => editLaborRow(r.id, 'desc', e.target.value)}
                          rows={1}
                          onInput={e => {
                            const el = e.currentTarget
                            el.style.height = 'auto'
                            el.style.height = el.scrollHeight + 'px'
                          }}
                          style={{
                            background: 'transparent',
                            border: 'none',
                            color: 'var(--t1)',
                            width: '100%',
                            fontSize: '13px',
                            resize: 'none',
                            overflow: 'hidden',
                            lineHeight: '1.4',
                            padding: '0',
                            fontFamily: 'inherit',
                            display: 'block',
                          }}
                        />
                      </td>
                      <td style={{ padding: '8px', fontSize: '12px' }}>
                        {(() => {
                          const teamRoster = backup.employees || []
                          return (
                            <select
                              value={r.empId || 'me'}
                              onChange={e => editLaborRow(r.id, 'empId', e.target.value)}
                              title={teamRoster.length === 0 ? 'Add crew in Team settings' : undefined}
                              style={{
                                background: 'rgba(255,255,255,0.04)',
                                border: '1px solid rgba(255,255,255,0.1)',
                                color: 'var(--t2)',
                                fontSize: '12px',
                                borderRadius: '4px',
                                padding: '2px 4px',
                                width: '100%',
                                cursor: 'pointer',
                              }}
                            >
                              <option value="me">Owner / Me</option>
                              {teamRoster.map(e => (
                                <option key={e.id} value={e.id}>{e.name}</option>
                              ))}
                              {teamRoster.length === 0 && (
                                <option disabled value="">— Add crew in Team settings</option>
                              )}
                            </select>
                          )
                        })()}
                      </td>
                      <td style={{ padding: '8px', textAlign: 'right' }}>
                        <input
                          type="number"
                          value={r.hrs || 0}
                          onChange={e => editLaborRow(r.id, 'hrs', e.target.value)}
                          style={{
                            background: 'transparent',
                            border: 'none',
                            color: 'var(--t1)',
                            width: '100%',
                            textAlign: 'right',
                            fontFamily: 'monospace',
                            fontSize: '13px',
                          }}
                        />
                      </td>
                      <td style={{ padding: '8px', textAlign: 'right' }}>
                        <input
                          type="number"
                          value={r.rate || 0}
                          onChange={e => editLaborRow(r.id, 'rate', e.target.value)}
                          style={{
                            background: 'transparent',
                            border: 'none',
                            color: 'var(--t1)',
                            width: '100%',
                            textAlign: 'right',
                            fontFamily: 'monospace',
                            fontSize: '13px',
                          }}
                        />
                      </td>
                      <td style={{ padding: '8px', textAlign: 'right', fontWeight: '600', color: '#10b981' }}>
                        {fmt((r.hrs || 0) * (r.rate || 0))}
                      </td>
                      <td style={{ padding: '8px', textAlign: 'center' }}>
                        <button
                          onClick={() => delLaborRow(r.id)}
                          style={{
                            background: 'none',
                            border: 'none',
                            color: '#ef4444',
                            cursor: 'pointer',
                            fontSize: '16px',
                            padding: '0',
                          }}
                        >
                          ×
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            <button
              onClick={addLaborRow}
              style={{
                marginTop: '8px',
                padding: '6px 12px',
                backgroundColor: 'rgba(59,130,246,0.2)',
                color: '#3b82f6',
                border: '1px solid rgba(59,130,246,0.3)',
                borderRadius: '4px',
                fontSize: '12px',
                fontWeight: '600',
                cursor: 'pointer',
              }}
            >
              + Add Labor Row
            </button>
          </div>
        </div>

        {/* MATERIALS BY ACTIVE PHASE (from MTO) */}
        <div style={{ backgroundColor: '#232738', borderRadius: '8px', marginBottom: '16px', overflow: 'hidden' }}>
          <div
            style={{
              backgroundColor: 'rgba(139,92,246,0.1)',
              padding: '12px 16px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              borderBottom: '1px solid rgba(255,255,255,0.05)',
            }}
          >
            <h4 style={{ color: 'var(--t1)', fontWeight: '600', margin: '0' }}>Materials by Phase (from MTO)</h4>
            <span style={{ color: '#10b981', fontWeight: '600', fontFamily: 'monospace' }}>{fmt(t.matTx)}</span>
          </div>
          <div style={{ padding: '12px', fontSize: '13px', color: 'var(--t2)' }}>
            {t.matBreakdown.length > 0 ? (
              <>
                {/* Phase header row */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 60px 90px 70px 90px', gap: '8px', padding: '6px 0', borderBottom: '1px solid var(--bdr2)', fontWeight: '600', fontSize: '11px', color: 'var(--t3)' }}>
                  <div>Phase</div>
                  <div style={{ textAlign: 'right' }}>Items</div>
                  <div style={{ textAlign: 'right' }}>Raw Cost</div>
                  <div style={{ textAlign: 'right' }}>Tax</div>
                  <div style={{ textAlign: 'right' }}>Phase Total</div>
                </div>
                {t.matBreakdown.map((r, i) => (
                  <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 60px 90px 70px 90px', gap: '8px', padding: '6px 0', borderBottom: '1px solid var(--bdr2)' }}>
                    <div>{r.phase}</div>
                    <div style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: '12px' }}>{r.count}</div>
                    <div style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: '12px' }}>{fmt(r.raw)}</div>
                    <div style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: '12px', color: '#ef4444' }}>{fmt(r.tax)}</div>
                    <div style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: '600', color: '#10b981' }}>{fmt(r.total)}</div>
                  </div>
                ))}
                <div style={{ fontSize: '10px', color: 'var(--t3)', marginTop: '8px' }}>
                  Read-only summary from Material Takeoff tab. Edit items in MTO.
                </div>
              </>
            ) : (
              <div style={{ textAlign: 'center', padding: '20px 0', color: 'var(--t3)', fontSize: '12px' }}>
                No MTO items yet. Add materials in the Material Takeoff tab.
              </div>
            )}
          </div>
        </div>

        {/* PLANNING & OVERHEAD */}
        <div style={{ backgroundColor: '#232738', borderRadius: '8px', marginBottom: '16px', overflow: 'hidden' }}>
          <div
            style={{
              backgroundColor: 'rgba(244,114,182,0.1)',
              padding: '12px 16px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              borderBottom: '1px solid rgba(255,255,255,0.05)',
            }}
          >
            <h4 style={{ color: 'var(--t1)', fontWeight: '600', margin: '0' }}>Planning & Overhead</h4>
            <span style={{ color: '#ec4899', fontWeight: '600', fontFamily: 'monospace' }}>{fmt(t.oh)}</span>
          </div>
          <div style={{ padding: '12px' }}>
            <table style={{ width: '100%', fontSize: '13px', color: 'var(--t2)', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--bdr2)' }}>
                  <th style={{ textAlign: 'left', padding: '8px', fontWeight: '600' }}>Description</th>
                  <th style={{ textAlign: 'right', padding: '8px', fontWeight: '600', width: '80px' }}>Hours</th>
                  <th style={{ textAlign: 'right', padding: '8px', fontWeight: '600', width: '80px' }}>Rate</th>
                  <th style={{ textAlign: 'right', padding: '8px', fontWeight: '600', width: '100px' }}>Total</th>
                  <th style={{ textAlign: 'center', padding: '8px', fontWeight: '600', width: '40px' }}></th>
                </tr>
              </thead>
              <tbody>
                {(p.ohRows || []).map(r => (
                  <tr key={r.id} style={{ borderBottom: '1px solid var(--bdr2)' }}>
                    <td style={{ padding: '8px' }}>
                      <input
                        type="text"
                        value={r.desc || ''}
                        onChange={e => editOHRow(r.id, 'desc', e.target.value)}
                        style={{
                          background: 'transparent',
                          border: 'none',
                          color: 'var(--t1)',
                          width: '100%',
                          fontSize: '13px',
                        }}
                      />
                    </td>
                    <td style={{ padding: '8px', textAlign: 'right' }}>
                      <input
                        type="number"
                        value={r.hrs || 0}
                        onChange={e => editOHRow(r.id, 'hrs', e.target.value)}
                        style={{
                          background: 'transparent',
                          border: 'none',
                          color: 'var(--t1)',
                          width: '100%',
                          textAlign: 'right',
                          fontFamily: 'monospace',
                          fontSize: '13px',
                        }}
                      />
                    </td>
                    <td style={{ padding: '8px', textAlign: 'right' }}>
                      <input
                        type="number"
                        value={r.rate || 0}
                        onChange={e => editOHRow(r.id, 'rate', e.target.value)}
                        style={{
                          background: 'transparent',
                          border: 'none',
                          color: 'var(--t1)',
                          width: '100%',
                          textAlign: 'right',
                          fontFamily: 'monospace',
                          fontSize: '13px',
                        }}
                      />
                    </td>
                    <td style={{ padding: '8px', textAlign: 'right', fontWeight: '600', color: '#ec4899' }}>
                      {fmt((r.hrs || 0) * (r.rate || 0))}
                    </td>
                    <td style={{ padding: '8px', textAlign: 'center' }}>
                      <button
                        onClick={() => delOHRow(r.id)}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: '#ef4444',
                          cursor: 'pointer',
                          fontSize: '16px',
                          padding: '0',
                        }}
                      >
                        ×
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button
              onClick={addOHRow}
              style={{
                marginTop: '8px',
                padding: '6px 12px',
                backgroundColor: 'rgba(59,130,246,0.2)',
                color: '#3b82f6',
                border: '1px solid rgba(59,130,246,0.3)',
                borderRadius: '4px',
                fontSize: '12px',
                fontWeight: '600',
                cursor: 'pointer',
              }}
            >
              + Add Overhead Row
            </button>
          </div>
        </div>

        {/* MILEAGE */}
        <div style={{ backgroundColor: '#232738', borderRadius: '8px', marginBottom: '16px', overflow: 'hidden', padding: '12px 16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <h4 style={{ color: 'var(--t1)', fontWeight: '600', margin: '0' }}>Mileage Calculation</h4>
            <span style={{ color: '#f59e0b', fontWeight: '600', fontFamily: 'monospace' }}>{fmt(t.mi)}</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px', fontSize: '13px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '11px', color: 'var(--t3)', marginBottom: '4px' }}>
                Miles Round Trip
              </label>
              <input
                type="number"
                value={p.mileRT || 30}
                onChange={e => editMileage('mileRT', e.target.value)}
                style={{
                  width: '100%',
                  padding: '6px',
                  backgroundColor: '#1e2130',
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: '4px',
                  color: 'var(--t1)',
                  fontFamily: 'monospace',
                }}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '11px', color: 'var(--t3)', marginBottom: '4px' }}>
                Days on Site
              </label>
              <input
                type="number"
                value={p.miDays || 12}
                onChange={e => editMileage('miDays', e.target.value)}
                style={{
                  width: '100%',
                  padding: '6px',
                  backgroundColor: '#1e2130',
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: '4px',
                  color: 'var(--t1)',
                  fontFamily: 'monospace',
                }}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '11px', color: 'var(--t3)', marginBottom: '4px' }}>
                Rate (per mile)
              </label>
              <div style={{ color: 'var(--t2)', fontFamily: 'monospace', fontSize: '13px', padding: '6px' }}>
                ${(backup.settings?.mileRate || 0.66).toFixed(2)}
              </div>
            </div>
          </div>
        </div>

        {/* DEAL OVERVIEW CHART */}
        {num(p.contract || 0) > 0 && (
          <div style={{ backgroundColor: '#1f2937', borderRadius: '8px', marginBottom: '16px', padding: '16px', border: '1px solid rgba(255,255,255,0.05)' }}>
            <h4 style={{ color: 'var(--t1)', fontWeight: '600', margin: '0 0 16px 0' }}>Deal Overview</h4>
            <div style={{ textAlign: 'center', marginBottom: '16px' }}>
              <p style={{ color: '#22c55e', fontSize: '32px', fontWeight: '700', fontFamily: 'monospace', margin: '0 0 4px 0' }}>{fmt(t.profit)}</p>
              <p style={{ color: 'var(--t3)', fontSize: '12px', margin: '0' }}>Projected Profit ({t.marginPct.toFixed(1)}%)</p>
            </div>
            <div style={{ space: '8px' }}>
              {[
                { label: 'Labor', value: t.lab, color: '#3b82f6', pct: t.total > 0 ? (t.lab / t.total) * 100 : 0 },
                { label: 'Material', value: t.matC, color: '#eab308', pct: t.total > 0 ? (t.matC / t.total) * 100 : 0 },
                { label: 'Mileage', value: t.mi, color: '#14b8a6', pct: t.total > 0 ? (t.mi / t.total) * 100 : 0 },
                { label: 'Overhead', value: t.oh, color: '#a855f7', pct: t.total > 0 ? (t.oh / t.total) * 100 : 0 },
                { label: 'Profit', value: t.profit, color: '#22c55e', pct: t.total > 0 ? (t.profit / t.total) * 100 : 0 },
              ].map(item => (
                <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
                  <span style={{ color: 'var(--t3)', fontSize: '12px', width: '65px', textAlign: 'left' }}>{item.label}</span>
                  <div style={{ flex: 1, backgroundColor: '#111827', borderRadius: '4px', height: '16px', overflow: 'hidden' }}>
                    <div style={{ backgroundColor: item.color, height: '100%', borderRadius: '4px', width: Math.max(0, Math.min(100, item.pct)) + '%', transition: 'width 0.2s' }} />
                  </div>
                  <span style={{ color: 'var(--t2)', fontSize: '11px', width: '90px', textAlign: 'right', fontFamily: 'monospace' }}>{fmt(item.value)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* COST BREAKDOWN CHART */}
        {hasAnyData && (
          <div style={{ backgroundColor: '#232738', borderRadius: '8px', marginBottom: '16px', padding: '16px' }}>
            <h4 style={{ color: 'var(--t1)', fontWeight: '600', margin: '0 0 12px 0' }}>Cost Breakdown</h4>

            {/* Segmented bar: each category as proportion */}
            <div style={{ display: 'flex', height: '24px', borderRadius: '4px', overflow: 'hidden', marginBottom: '16px', gap: '1px', backgroundColor: '#1e2130' }}>
              {t.lab > 0 && (
                <div style={{ flex: t.lab / t.total, backgroundColor: '#3b82f6', minWidth: '2px' }} title={`Labor: ${fmt(t.lab)}`} />
              )}
              {t.matC > 0 && (
                <div style={{ flex: t.matC / t.total, backgroundColor: '#f59e0b', minWidth: '2px' }} title={`Material: ${fmt(t.matC)}`} />
              )}
              {t.oh > 0 && (
                <div style={{ flex: t.oh / t.total, backgroundColor: '#a855f7', minWidth: '2px' }} title={`Overhead: ${fmt(t.oh)}`} />
              )}
              {t.mi > 0 && (
                <div style={{ flex: t.mi / t.total, backgroundColor: '#06b6d4', minWidth: '2px' }} title={`Mileage: ${fmt(t.mi)}`} />
              )}
              {t.taxAmt > 0 && (
                <div style={{ flex: t.taxAmt / t.total, backgroundColor: '#ef4444', minWidth: '2px' }} title={`Tax: ${fmt(t.taxAmt)}`} />
              )}
            </div>

            {/* Legend with bars */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '12px' }}>
              {t.lab > 0 && (
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                    <div style={{ width: '8px', height: '8px', backgroundColor: '#3b82f6', borderRadius: '2px' }} />
                    <span style={{ fontSize: '12px', color: 'var(--t3)' }}>Labor</span>
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--t2)', fontFamily: 'monospace' }}>{fmt(t.lab)} ({((t.lab / t.total) * 100).toFixed(0)}%)</div>
                </div>
              )}
              {t.matC > 0 && (
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                    <div style={{ width: '8px', height: '8px', backgroundColor: '#f59e0b', borderRadius: '2px' }} />
                    <span style={{ fontSize: '12px', color: 'var(--t3)' }}>Material</span>
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--t2)', fontFamily: 'monospace' }}>{fmt(t.matC)} ({((t.matC / t.total) * 100).toFixed(0)}%)</div>
                </div>
              )}
              {t.oh > 0 && (
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                    <div style={{ width: '8px', height: '8px', backgroundColor: '#a855f7', borderRadius: '2px' }} />
                    <span style={{ fontSize: '12px', color: 'var(--t3)' }}>Overhead</span>
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--t2)', fontFamily: 'monospace' }}>{fmt(t.oh)} ({((t.oh / t.total) * 100).toFixed(0)}%)</div>
                </div>
              )}
              {t.mi > 0 && (
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                    <div style={{ width: '8px', height: '8px', backgroundColor: '#06b6d4', borderRadius: '2px' }} />
                    <span style={{ fontSize: '12px', color: 'var(--t3)' }}>Mileage</span>
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--t2)', fontFamily: 'monospace' }}>{fmt(t.mi)} ({((t.mi / t.total) * 100).toFixed(0)}%)</div>
                </div>
              )}
              {t.taxAmt > 0 && (
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                    <div style={{ width: '8px', height: '8px', backgroundColor: '#ef4444', borderRadius: '2px' }} />
                    <span style={{ fontSize: '12px', color: 'var(--t3)' }}>Tax</span>
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--t2)', fontFamily: 'monospace' }}>{fmt(t.taxAmt)} ({((t.taxAmt / t.total) * 100).toFixed(0)}%)</div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* SUMMARY */}
        <div style={{ backgroundColor: '#232738', borderRadius: '8px', padding: '16px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
          <div>
            <div style={{ marginBottom: '8px', display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--t3)', fontSize: '13px' }}>Labor Total</span>
              <span style={{ color: 'var(--t1)', fontFamily: 'monospace', fontWeight: '600' }}>{fmt(t.lab)}</span>
            </div>
            <div style={{ marginBottom: '8px', display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--t3)', fontSize: '13px' }}>Materials</span>
              <span style={{ color: 'var(--t1)', fontFamily: 'monospace', fontWeight: '600' }}>{fmt(t.matC)}</span>
            </div>
            <div style={{ marginBottom: '8px', display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--t3)', fontSize: '13px' }}>Overhead</span>
              <span style={{ color: 'var(--t1)', fontFamily: 'monospace', fontWeight: '600' }}>{fmt(t.oh)}</span>
            </div>
            <div style={{ marginBottom: '12px', display: 'flex', justifyContent: 'space-between', paddingBottom: '12px', borderBottom: '1px solid var(--bdr2)' }}>
              <span style={{ color: 'var(--t3)', fontSize: '13px' }}>Mileage</span>
              <span style={{ color: 'var(--t1)', fontFamily: 'monospace', fontWeight: '600' }}>{fmt(t.mi)}</span>
            </div>
            <div style={{ marginBottom: '8px', display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--t3)', fontSize: '13px' }}>Subtotal</span>
              <span style={{ color: 'var(--t1)', fontFamily: 'monospace', fontWeight: '600' }}>{fmt(t.subtotal)}</span>
            </div>
            <div style={{ marginBottom: '8px', display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--t3)', fontSize: '13px' }}>
                Tax (
                <input
                  type="number"
                  value={num(backup.settings?.tax || 0)}
                  onChange={e => editTax(e.target.value)}
                  style={{
                    width: '40px',
                    padding: '2px 4px',
                    backgroundColor: 'transparent',
                    border: '1px solid rgba(255,255,255,0.1)',
                    color: 'var(--t1)',
                    fontFamily: 'monospace',
                    fontSize: '12px',
                  }}
                />
                %)
              </span>
              <span style={{ color: 'var(--t1)', fontFamily: 'monospace', fontWeight: '600' }}>{fmt(t.taxAmt)}</span>
            </div>
          </div>
          <div>
            <div style={{ marginBottom: '12px', paddingBottom: '12px', borderBottom: '1px solid var(--bdr2)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                <span style={{ color: 'var(--t3)', fontSize: '13px', fontWeight: '600' }}>TOTAL</span>
                <span style={{ color: '#10b981', fontFamily: 'monospace', fontWeight: '700', fontSize: '16px' }}>
                  {fmt(t.total)}
                </span>
              </div>
            </div>
            <div style={{ marginBottom: '8px', display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--t3)', fontSize: '13px' }}>Contract Amount</span>
              <span style={{ color: 'var(--t1)', fontFamily: 'monospace', fontWeight: '600' }}>{fmt(p.contract || 0)}</span>
            </div>
            <div style={{ marginBottom: '8px', display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--t3)', fontSize: '13px' }}>Profit</span>
              <span
                style={{
                  color: t.profit > 0 ? '#10b981' : '#ef4444',
                  fontFamily: 'monospace',
                  fontWeight: '600',
                }}
              >
                {fmt(t.profit)}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--t3)', fontSize: '13px' }}>Margin %</span>
              <span
                style={{
                  color: t.marginPct >= 20 ? '#10b981' : t.marginPct >= 10 ? '#f59e0b' : '#ef4444',
                  fontFamily: 'monospace',
                  fontWeight: '600',
                }}
              >
                {t.marginPct.toFixed(1)}%
              </span>
            </div>
          </div>
        </div>

        {/* VAULT HEALTH CHECK */}
        <div style={{ marginTop: '16px' }}>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <button
              onClick={runVaultHealthCheck}
              disabled={healthCheckLoading}
              style={{
                padding: '10px 16px',
                backgroundColor: healthCheckLoading ? 'rgba(139,92,246,0.1)' : 'rgba(139,92,246,0.2)',
                color: healthCheckLoading ? '#6b7280' : '#a78bfa',
                border: '1px solid rgba(139,92,246,0.3)',
                borderRadius: '6px',
                fontSize: '13px',
                fontWeight: '600',
                cursor: healthCheckLoading ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                opacity: healthCheckLoading ? 0.7 : 1,
              }}
            >
              <Sparkles size={14} />
              {healthCheckLoading ? 'Analyzing...' : 'VAULT Analysis'}
            </button>
            <button
              onClick={saveEstimateVersion}
              style={{ padding: '10px 14px', backgroundColor: 'rgba(99,102,241,0.15)', color: '#818cf8', border: '1px solid rgba(99,102,241,0.3)', borderRadius: '6px', fontSize: '12px', fontWeight: '600', cursor: 'pointer' }}
            >
              💾 Save Snapshot
            </button>
          </div>

          {/* Health Check Result */}
          {healthCheckOpen && healthCheckResult && (
            <div style={{ marginTop: '12px', backgroundColor: '#1a1f2e', border: '1px solid rgba(139,92,246,0.3)', borderRadius: '8px', overflow: 'hidden' }}>
              <div
                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', backgroundColor: 'rgba(139,92,246,0.12)', cursor: 'pointer' }}
                onClick={() => setHealthCheckOpen(v => !v)}
              >
                <span style={{ color: '#a78bfa', fontWeight: '700', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Sparkles size={14} /> VAULT Analysis Results
                </span>
                <span style={{ color: '#6b7280', fontSize: '11px' }}>▲ Collapse</span>
              </div>
              <div style={{ padding: '14px' }}>
                {healthCheckResult.error ? (
                  <div style={{ color: '#ef4444', fontSize: '13px' }}>{healthCheckResult.error}</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    {/* Margin Check */}
                    {healthCheckResult.marginCheck && (
                      <div style={{ padding: '10px 12px', backgroundColor: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.2)', borderRadius: '6px' }}>
                        <div style={{ fontSize: '10px', color: '#6b7280', fontWeight: '700', textTransform: 'uppercase', marginBottom: '4px' }}>📊 Margin Check</div>
                        <div style={{ fontSize: '13px', color: '#d1fae5' }}>{healthCheckResult.marginCheck}</div>
                      </div>
                    )}
                    {/* Missing Items */}
                    {healthCheckResult.missingItems && healthCheckResult.missingItems.length > 0 && (
                      <div style={{ padding: '10px 12px', backgroundColor: 'rgba(234,179,8,0.08)', border: '1px solid rgba(234,179,8,0.2)', borderRadius: '6px' }}>
                        <div style={{ fontSize: '10px', color: '#6b7280', fontWeight: '700', textTransform: 'uppercase', marginBottom: '4px' }}>📋 Potentially Missing Items</div>
                        <ul style={{ margin: '0', paddingLeft: '16px', fontSize: '12px', color: '#fef3c7' }}>
                          {healthCheckResult.missingItems.map((item, i) => (
                            <li key={i} style={{ marginBottom: '2px' }}>{item}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {/* Risk Flags */}
                    {healthCheckResult.riskFlags && healthCheckResult.riskFlags.length > 0 && (
                      <div style={{ padding: '10px 12px', backgroundColor: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: '6px' }}>
                        <div style={{ fontSize: '10px', color: '#6b7280', fontWeight: '700', textTransform: 'uppercase', marginBottom: '4px' }}>⚠️ Risk Flags</div>
                        <ul style={{ margin: '0', paddingLeft: '16px', fontSize: '12px', color: '#fecaca' }}>
                          {healthCheckResult.riskFlags.map((flag, i) => (
                            <li key={i} style={{ marginBottom: '2px' }}>{flag}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {/* Comparison */}
                    {healthCheckResult.comparison && (
                      <div style={{ padding: '10px 12px', backgroundColor: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.2)', borderRadius: '6px' }}>
                        <div style={{ fontSize: '10px', color: '#6b7280', fontWeight: '700', textTransform: 'uppercase', marginBottom: '4px' }}>📈 Comparison</div>
                        <div style={{ fontSize: '13px', color: '#e0e7ff' }}>{healthCheckResult.comparison}</div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
      )}

      <AskAIPanel
        panelName="Estimate"
        insights={generateEstimateInsights()}
        dataContext={(() => {
          const t = estTotals()
          return {
            projectName: p?.name || '',
            contract: num(p?.contract || 0),
            laborCost: t.lab,
            materialCost: t.matC,
            overheadCost: t.oh,
            mileageCost: t.mi,
            totalCost: t.total,
            profit: t.profit,
            marginPct: t.marginPct,
            laborHours: (p?.laborRows || []).reduce((s, r) => s + num(r.hrs), 0),
            materialLineItems: (p?.mtoRows || []).length,
          }
        })()}
        isOpen={aiOpen}
        onClose={() => setAiOpen(false)}
      />
    </div>
  )
}
