// @ts-nocheck
/**
 * V15rIncomeCalc.tsx — Income Calculator Panel (v15r FAITHFUL PORT)
 *
 * LEFT: Input fields for calcRefs values (system size kW, RMO fee, monthly base rate, battery fee,
 *       panel upgrade fee, per-watt rate, battery install rate, panel install rate, labor cost/hr,
 *       systems/month, operating cost/mo)
 * RIGHT:
 *  - Per-System Breakdown: TWO columns — RMO Revenue Fees (left) and Installation Revenue Fees (right)
 *  - Job Mix + Combined Results: Visual grid (Solo/Battery/Panel/Combined) with monthly and annual projections
 *  - Deal Outlook: Pipeline (coming), Active (count + total), Closed (completed)
 *  - Exposure & Risk: Horizontal bar chart by project
 *  - Business-Linked Projections: Monthly revenue projection bars by revenue stream
 *  - AI Analysis (SCOUT) button
 */

import { useMemo, useState, useRef, useEffect, useCallback } from 'react'
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, LineChart, Line, XAxis, YAxis, CartesianGrid, Legend, BarChart, Bar } from 'recharts'
import { AlertCircle, TrendingUp, Sparkles, Zap, ChevronDown, ChevronRight, Users, X } from 'lucide-react'
import { callClaude, extractText } from '@/services/claudeProxy'
import { getBackupData, getProjectFinancials, resolveProjectBucket, fmtK, fmt, pct, num, saveBackupData, type BackupData } from '@/services/backupDataService'
import { pushState } from '@/services/undoRedoService'
import { ErrorBoundary } from '@/components/ErrorBoundary'


// ── RMO Status Card — collapsible after first setup ──────────────────────────

function RMOStatusCard({
  rmoActive,
  collapsed,
  onToggleCollapse,
  onActivate,
  onDeactivate,
}: {
  rmoActive: boolean
  collapsed: boolean
  onToggleCollapse: () => void
  onActivate: () => void
  onDeactivate: () => void
}) {
  const [agreementFile, setAgreementFile] = useState<File | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  function handleToggleActive() {
    if (rmoActive) {
      try { localStorage.setItem('rmo_active', 'false') } catch { /* ignore */ }
      onDeactivate()
    } else {
      try { localStorage.setItem('rmo_active', 'true') } catch { /* ignore */ }
      import('@/lib/supabase').then(({ supabase }) => {
        ;(async () => {
          try {
            const { error } = await supabase.from('user_preferences' as never).upsert({ key: 'rmo_active', value: 'true' })
            if (error) console.error(error)
          } catch(err) { console.error(err) }
        })()
      }).catch(() => {/* ignore */})
      onActivate()
    }
  }

  if (collapsed) {
    return (
      <div className="flex items-center justify-between bg-[var(--bg-card,#1f2937)] border border-gray-700 rounded-xl px-4 py-3 mb-4">
        <div className="flex items-center gap-2">
          <span>☀️</span>
          <span className="text-sm font-semibold text-gray-200">RMO Solar Income</span>
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${rmoActive ? 'bg-emerald-500/20 text-emerald-400' : 'bg-gray-700 text-gray-400'}`}>
            {rmoActive ? 'Active' : 'Inactive'}
          </span>
        </div>
        <button
          onClick={onToggleCollapse}
          className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
        >
          Configure ▾
        </button>
      </div>
    )
  }

  return (
    <div className="bg-[var(--bg-card,#1f2937)] border border-gray-700 rounded-2xl p-5 mb-4 shadow-lg">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span style={{ fontSize: '1.4rem' }}>☀️</span>
          <h2 className="text-base font-bold text-gray-100">RMO Setup</h2>
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${rmoActive ? 'bg-emerald-500/20 text-emerald-400' : 'bg-gray-700 text-gray-400'}`}>
            {rmoActive ? 'Active' : 'Inactive'}
          </span>
        </div>
        {rmoActive && (
          <button
            onClick={onToggleCollapse}
            className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
          >
            Collapse ▴
          </button>
        )}
      </div>

      <p className="text-xs text-gray-400 mb-4 leading-relaxed">
        RMO (Residential Maintenance Operations) tracks your solar income pipeline — installation revenue, RMO oversight fees, and monthly projections.
      </p>

      {/* Active/inactive toggle */}
      <div className="flex items-center justify-between bg-gray-800/60 rounded-xl px-4 py-3 mb-4 border border-gray-700">
        <div>
          <p className="text-sm font-semibold text-gray-200">Solar Income Tracking</p>
          <p className="text-xs text-gray-500 mt-0.5">Enables RMO pipeline metrics below the calculator</p>
        </div>
        <button
          onClick={handleToggleActive}
          className={`relative inline-flex w-11 h-6 rounded-full transition-colors focus:outline-none ${rmoActive ? 'bg-emerald-500' : 'bg-gray-600'}`}
        >
          <span className={`inline-block w-5 h-5 bg-white rounded-full shadow transition-transform mt-0.5 ${rmoActive ? 'translate-x-5' : 'translate-x-0.5'}`} />
        </button>
      </div>

      {/* Agreement upload */}
      <div>
        <p className="text-xs text-gray-400 mb-2 font-medium uppercase tracking-wide">RMO Agreement PDF (optional)</p>
        <div
          onClick={() => fileInputRef.current?.click()}
          className="flex items-center gap-3 border border-dashed border-gray-600 hover:border-gray-400 rounded-xl px-4 py-3 cursor-pointer transition-colors"
        >
          <span className="text-gray-400 text-lg">📄</span>
          <span className="text-sm text-gray-400">
            {agreementFile ? agreementFile.name : 'Upload RMO Agreement PDF'}
          </span>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf"
          className="hidden"
          onChange={e => setAgreementFile(e.target.files?.[0] || null)}
        />
      </div>
    </div>
  )
}

// ── RMO Dashboard — extra fields + AI analysis (rendered when rmo_active) ───

function RMODashboardExtras() {
  const backup = getBackupData()
  const calcRefs = backup?.calcRefs || {}
  const [, forceUpdate] = useState({})
  const [aiLoading, setAiLoading] = useState(false)
  const [aiResult, setAiResult] = useState<string>('')

  function updateRMOField(key: string, value: any) {
    if (!backup) return
    pushState()
    backup.calcRefs[key] = value
    saveBackupData(backup)
    forceUpdate({})
  }

  const revenuePerInstall = num(calcRefs.rmoRevenuePerInstall) || 0
  const transportCostPerJob = num(calcRefs.rmoTransportCostPerJob) || 0
  const overheadAllocation = num(calcRefs.rmoOverheadAllocation) || 0
  const idleTimeCostPerHr = num(calcRefs.rmoIdleTimeCostPerHr) || 0
  const rmoCap = num(calcRefs.rmoCapMaxJobs) || 0

  const marginPerJob = revenuePerInstall - transportCostPerJob - overheadAllocation
  const monthlyRevenue = revenuePerInstall * rmoCap
  const totalCostPerJob = transportCostPerJob + overheadAllocation
  const breakEvenJobs = totalCostPerJob > 0 ? Math.ceil(overheadAllocation / Math.max(1, marginPerJob)) : 0

  async function runAI() {
    setAiLoading(true)
    setAiResult('')
    try {
      const prompt = `You are a solar income analyst for an electrical contractor.
Given: Revenue per install: $${revenuePerInstall}, Transport cost/job: $${transportCostPerJob}, Overhead allocation: $${overheadAllocation}, Idle time cost/hr: $${idleTimeCostPerHr}, RMO cap (max jobs/month): ${rmoCap}.
Provide concise analysis covering:
1. Margin per job: $${marginPerJob.toFixed(2)}
2. Monthly revenue projection at full cap
3. Break-even job count
4. One actionable recommendation to improve margins.
Keep it short and practical.`
      const res = await callClaude([{ role: 'user', content: prompt }])
      setAiResult(extractText(res))
    } catch (e: any) {
      setAiResult('AI analysis unavailable — check Claude API connection.')
    } finally {
      setAiLoading(false)
    }
  }

  return (
    <div className="mt-6 space-y-4">
      {/* RMO Editable Fields */}
      <div className="bg-[var(--bg-card,#1f2937)] border border-amber-700/40 rounded-xl p-5">
        <h3 className="text-sm font-bold text-amber-400 uppercase tracking-wider mb-4">RMO Income Parameters</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[
            { label: 'Revenue per Installation ($)', key: 'rmoRevenuePerInstall', val: revenuePerInstall },
            { label: 'Transportation Cost per Job ($)', key: 'rmoTransportCostPerJob', val: transportCostPerJob },
            { label: 'Overhead Allocation ($)', key: 'rmoOverheadAllocation', val: overheadAllocation },
            { label: 'Idle Time Cost per Hour ($)', key: 'rmoIdleTimeCostPerHr', val: idleTimeCostPerHr },
            { label: 'RMO Cap: Max Jobs/Month', key: 'rmoCapMaxJobs', val: rmoCap },
          ].map(({ label, key, val }) => (
            <div key={key} className="flex flex-col gap-1">
              <label className="text-xs text-gray-400">{label}</label>
              <input
                type="number"
                value={val || ''}
                onChange={e => updateRMOField(key, parseFloat(e.target.value) || 0)}
                placeholder="0"
                className="bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-100 focus:border-amber-500 outline-none"
              />
            </div>
          ))}
        </div>

        {/* Live calculations */}
        <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 gap-3">
          {[
            { label: 'Margin per Job', val: `$${marginPerJob.toFixed(2)}`, color: marginPerJob >= 0 ? 'text-emerald-400' : 'text-red-400' },
            { label: 'Monthly Revenue (full cap)', val: `$${monthlyRevenue.toFixed(0)}`, color: 'text-blue-400' },
            { label: 'Break-even Jobs', val: `${breakEvenJobs}`, color: 'text-amber-400' },
          ].map(({ label, val, color }) => (
            <div key={label} className="bg-gray-800/60 rounded-lg px-3 py-2.5 border border-gray-700">
              <p className="text-xs text-gray-500 mb-1">{label}</p>
              <p className={`text-base font-bold ${color}`}>{val}</p>
            </div>
          ))}
        </div>
      </div>

      {/* AI Analysis */}
      <div className="bg-[var(--bg-card,#1f2937)] border border-gray-700 rounded-xl p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-bold text-gray-200 flex items-center gap-2">
            <span>🤖</span> AI Analysis
          </h3>
          <button
            onClick={runAI}
            disabled={aiLoading}
            className="px-3 py-1.5 text-xs font-semibold bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 text-white rounded-lg transition-colors"
          >
            {aiLoading ? 'Analyzing…' : 'Run Analysis'}
          </button>
        </div>
        {aiResult ? (
          <p className="text-sm text-gray-300 leading-relaxed whitespace-pre-wrap">{aiResult}</p>
        ) : (
          <p className="text-xs text-gray-500 italic">Enter your RMO parameters above and click Run Analysis for margin, revenue projections, and break-even insights.</p>
        )}
      </div>
    </div>
  )
}

// ── Main export — Solar Income always visible; RMO is an add-on ──────────────

export default function V15rIncomeCalc() {
  const [rmoActive, setRmoActive] = useState<boolean>(() => {
    try { return localStorage.getItem('rmo_active') === 'true' } catch { return false }
  })
  // Collapse the RMO card by default once it has been set up
  const [rmoCardCollapsed, setRmoCardCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem('rmo_active') === 'true' } catch { return false }
  })

  function handleActivate() {
    setRmoActive(true)
    setRmoCardCollapsed(true)
  }

  function handleDeactivate() {
    setRmoActive(false)
    setRmoCardCollapsed(false)
  }

  return (
    <>
      {/* RMO status card — sits above the calculator, collapsible after first setup */}
      <div className="px-4 pt-4">
        <RMOStatusCard
          rmoActive={rmoActive}
          collapsed={rmoCardCollapsed}
          onToggleCollapse={() => setRmoCardCollapsed(c => !c)}
          onActivate={handleActivate}
          onDeactivate={handleDeactivate}
        />
      </div>

      {/* Full Solar Income calculator — always visible regardless of RMO status */}
      <V15rIncomeCalcInner />

      {/* RMO-specific metrics — additional section, only visible when rmo_active */}
      {rmoActive && (
        <div className="px-4 pb-6">
          <RMODashboardExtras />
        </div>
      )}
    </>
  )
}

function V15rIncomeCalcInner() {
  const backup = getBackupData()
  if (!backup) return <NoData />

  const calcRefs = backup.calcRefs || {}
  const [, forceUpdate] = useState({})

  // All fields from calcRefs — port exact names
  const rmoFee = num(calcRefs.rmoFee)
  const monthlyBaseFee = num(calcRefs.monthlyBaseFee)
  const custPerWatt = num(calcRefs.custPerWatt)
  const panelWatts = num(calcRefs.panelWatts)
  const panelsPerSystem = num(calcRefs.panelsPerSystem)
  const totalProjectsPerMonth = num(calcRefs.totalProjectsPerMonth)
  const selfInstallProjectsPerMonth = num(calcRefs.selfInstallProjectsPerMonth)
  const visitsPerMonth = num(calcRefs.visitsPerMonth)
  const batteryFeePerSystem = num(calcRefs.batteryFeePerSystem)
  const panelUpgradeFeePerSystem = num(calcRefs.panelUpgradeFeePerSystem)
  const solarOnlyPct = num(calcRefs.solarOnlyPct)
  const panelOnlyPct = num(calcRefs.panelOnlyPct)
  const batteryPanelPct = num(calcRefs.batteryPanelPct)
  const batteryOnlyPct = num(calcRefs.batteryOnlyPct)
  const installPerWatt = num(calcRefs.installPerWatt)
  const batteryInstallFeePerSystem = num(calcRefs.batteryInstallFeePerSystem)
  const batteryInstallHoursPerSystem = num(calcRefs.batteryInstallHoursPerSystem)
  const panelUpgradeInstallFeePerSystem = num(calcRefs.panelUpgradeInstallFeePerSystem)
  const panelUpgradeInstallHoursPerSystem = num(calcRefs.panelUpgradeInstallHoursPerSystem)
  const installEnabled = !!calcRefs.installEnabled
  const crewSize = num(calcRefs.crewSize)
  const installDays = num(calcRefs.installDays)
  const laborCostPerHr = num(calcRefs.laborCostPerHr)
  const payrollLoadMult = Math.max(1, num(calcRefs.payrollLoadMult) || 1.2)
  const rmoVisitHours = num(calcRefs.rmoVisitHours) || 2.5
  const rmoVisitMilesRT = num(calcRefs.rmoVisitMilesRT)
  const rmoVisitCostPerMile = num(calcRefs.rmoVisitCostPerMile)
  const rmoVisitFlatCost = num(calcRefs.rmoVisitFlatCost)

  // ── EMPLOYEE COST ANALYSIS STATE ──
  const [empCostOpen, setEmpCostOpen] = useState(!!calcRefs.empCostEnabled)
  const empCostEnabled = !!calcRefs.empCostEnabled
  const empCount = num(calcRefs.empCount) || 1
  const empHourlyRate = num(calcRefs.empHourlyRate) || 25
  const empHoursPerWeek = num(calcRefs.empHoursPerWeek) || 40
  const empPayrollTax = num(calcRefs.empPayrollTax) || 15.3
  const empWorkersComp = num(calcRefs.empWorkersComp) || 4
  const empGenLiability = num(calcRefs.empGenLiability) || 1.5
  const empBenefitsPerMonth = num(calcRefs.empBenefitsPerMonth) || 0

  const updateField = (key: string, value: any) => {
    pushState()
    backup.calcRefs[key] = value
    saveBackupData(backup)
    forceUpdate({})
  }

  // ── CALCULATIONS (port from HTML renderIncomeCalc) ──
  const sysW = panelWatts * panelsPerSystem
  const sysKW = sysW / 1000
  const baseSolarContractVal = sysW * custPerWatt

  const mixRaw = { solarOnly: solarOnlyPct, batteryOnly: batteryOnlyPct, panelOnly: panelOnlyPct, both: batteryPanelPct }
  const mixTotal = mixRaw.solarOnly + mixRaw.batteryOnly + mixRaw.panelOnly + mixRaw.both
  const mixScale = mixTotal > 100 ? 100 / mixTotal : 1
  const solarOnlyNorm = mixRaw.solarOnly * mixScale
  const batteryOnlyNorm = mixRaw.batteryOnly * mixScale
  const panelOnlyNorm = mixRaw.panelOnly * mixScale
  const batteryPanelNorm = mixRaw.both * mixScale
  const batteryAttachPct = batteryOnlyNorm + batteryPanelNorm
  const panelUpgradeAttachPct = panelOnlyNorm + batteryPanelNorm

  const batteryAdderAvg = batteryFeePerSystem * (batteryAttachPct / 100)
  const panelUpgradeAdderAvg = panelUpgradeFeePerSystem * (panelUpgradeAttachPct / 100)
  const contractVal = baseSolarContractVal + batteryAdderAvg + panelUpgradeAdderAvg

  const baseRmoPerSys = baseSolarContractVal * (rmoFee / 100)
  const batteryRmoFeePct = num(calcRefs.batteryRmoFeePct) || 3
  const panelUpgradeRmoFeePct = num(calcRefs.panelUpgradeRmoFeePct) || 3
  const batteryRmoPerSys = batteryAdderAvg * (batteryRmoFeePct / 100)
  const panelUpgradeRmoPerSys = panelUpgradeAdderAvg * (panelUpgradeRmoFeePct / 100)
  const rmoPerSys = baseRmoPerSys + batteryRmoPerSys + panelUpgradeRmoPerSys
  // Fee per battery-specific system (raw, not attach-weighted)
  const batteryRmoFeePerBatterySys = batteryFeePerSystem * (batteryRmoFeePct / 100)
  // Fee per panel-upgrade-specific system (raw, not attach-weighted)
  const panelRmoFeePerPanelSys = panelUpgradeFeePerSystem * (panelUpgradeRmoFeePct / 100)
  // Monthly system counts by type
  const batterySystemsPerMonth = totalProjectsPerMonth * (batteryAttachPct / 100)
  const panelSystemsPerMonth = totalProjectsPerMonth * (panelUpgradeAttachPct / 100)
  // Base fee spread per system using total projects/month (2000 ÷ total projects)
  const monthlyBasePerSys = monthlyBaseFee / Math.max(1, totalProjectsPerMonth)
  const rmoRevenuePerSystemTotal = rmoPerSys + monthlyBasePerSys + (batteryFeePerSystem * (batteryAttachPct / 100)) + (panelUpgradeFeePerSystem * (panelUpgradeAttachPct / 100))

  const baseInstallRevenuePerSys = sysW * installPerWatt
  const avgBatteryInstallRevenuePerSys = batteryInstallFeePerSystem * (batteryAttachPct / 100)
  const avgPanelUpgradeInstallRevenuePerSys = panelUpgradeInstallFeePerSystem * (panelUpgradeAttachPct / 100)
  const installPerSys = baseInstallRevenuePerSys + avgBatteryInstallRevenuePerSys + avgPanelUpgradeInstallRevenuePerSys

  const baseInstallHrsPerSys = installDays * 8
  const avgBatteryInstallHoursPerSys = batteryInstallHoursPerSystem * (batteryAttachPct / 100)
  const avgPanelUpgradeInstallHoursPerSys = panelUpgradeInstallHoursPerSystem * (panelUpgradeAttachPct / 100)
  const installHrsPerSys = baseInstallHrsPerSys + avgBatteryInstallHoursPerSys + avgPanelUpgradeInstallHoursPerSys

  const burdenedEmployeeRate = laborCostPerHr * payrollLoadMult
  const crewBaseWagesPerSys = crewSize * installHrsPerSys * laborCostPerHr
  const crewBurdenCostPerSys = crewSize * installHrsPerSys * burdenedEmployeeRate
  const payrollBurdenPerSys = Math.max(0, crewBurdenCostPerSys - crewBaseWagesPerSys)

  const installMonthly = installEnabled ? installPerSys * selfInstallProjectsPerMonth : 0
  const installLabor = installEnabled ? crewBurdenCostPerSys * selfInstallProjectsPerMonth : 0
  const installNetMonthly = installMonthly - installLabor

  const rmoVisitCost = rmoVisitHours * burdenedEmployeeRate + rmoVisitMilesRT * rmoVisitCostPerMile + rmoVisitFlatCost
  const rmoMonthly = rmoPerSys * totalProjectsPerMonth + monthlyBaseFee + (rmoVisitCost * visitsPerMonth)
  const rmoAnnual = rmoMonthly * 12

  const totalMonthly = rmoMonthly + installMonthly
  const totalLabor = installLabor + (rmoVisitCost * visitsPerMonth)
  const totalNetMonthly = totalMonthly - totalLabor
  const totalAnnual = totalMonthly * 12

  // ── EMPLOYEE COST CALCULATIONS ──
  const empGrossMonthlyPerEmp = empHourlyRate * empHoursPerWeek * 4.33
  const empPayrollCostPerEmp = empGrossMonthlyPerEmp * (empPayrollTax / 100)
  const empWcCostPerEmp = empGrossMonthlyPerEmp * (empWorkersComp / 100)
  const empGlCostPerEmp = empGrossMonthlyPerEmp * (empGenLiability / 100)
  const empTotalPerEmp = empGrossMonthlyPerEmp + empPayrollCostPerEmp + empWcCostPerEmp + empGlCostPerEmp + empBenefitsPerMonth
  const empTotalMonthly = empCostEnabled ? empTotalPerEmp * empCount : 0
  const trueNetMonthly = totalNetMonthly - empTotalMonthly

  // Project buckets
  const projects = backup.projects || []
  const dealOutlook = useMemo(() => {
    const coming = projects.filter(p => resolveProjectBucket(p) === 'coming')
    const active = projects.filter(p => resolveProjectBucket(p) === 'active')
    const completed = projects.filter(p => resolveProjectBucket(p) === 'completed')
    const calcTotal = (ps: typeof projects) => ps.reduce((s, p) => s + num(p.contract), 0)
    return {
      coming: { count: coming.length, total: calcTotal(coming) },
      active: { count: active.length, total: calcTotal(active) },
      completed: { count: completed.length, total: calcTotal(completed) }
    }
  }, [projects])

  // Revenue Stream Data (12-month breakdown)
  const activeProjects = projects.filter(p => resolveProjectBucket(p) === 'active')
  const electricalPipelineTotal = activeProjects.reduce((s, p) => s + num(p.contract), 0)
  const serviceLogs = backup.serviceLogs || []

  // Revenue Streams — last 3 months actuals
  const revenueStreams = useMemo(() => {
    const now = new Date()
    const threeMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 3, 1)
    const recentProjects = projects.filter(p => {
      const d = p.completedDate || p.endDate || p.startDate
      return d && new Date(d) >= threeMonthsAgo
    })
    const recentSvc = serviceLogs.filter((l: any) => {
      const d = l.date || l.completedDate
      return d && new Date(d) >= threeMonthsAgo
    })
    const projRevenue3mo = recentProjects.reduce((s, p) => s + num(p.paid || p.collected), 0)
    const svcRevenue3mo = recentSvc.reduce((s: number, l: any) => s + num(l.collected), 0)
    const projMonthlyNet = projRevenue3mo / 3
    const svcMonthlyNet = svcRevenue3mo / 3
    const rmoNet = rmoMonthly - (totalLabor / Math.max(1, totalMonthly) * rmoMonthly)
    return { rmoNet, projMonthlyNet, svcMonthlyNet }
  }, [projects, serviceLogs, rmoMonthly, totalLabor, totalMonthly])

  // AI analysis state for revenue streams
  const [revenueAiResponse, setRevenueAiResponse] = useState('')
  const [revenueAiLoading, setRevenueAiLoading] = useState(false)

  // Deep Analysis modal state
  const [deepAnalysisOpen, setDeepAnalysisOpen] = useState(false)
  const [deepAnalysis, setDeepAnalysis] = useState<string | null>(null)
  const [deepAnalysisLoading, setDeepAnalysisLoading] = useState(false)

  // electricalMonthData: maps each pipeline project to the actual month its revenue lands.
  // CONFIRMED: project has a completedDate/endDate → assign contract value to that month.
  // PROJECTED: has startDate but no completion → estimate completion = start + 30 days.
  // ESTIMATED: no dates at all → pool distributed as rolling average across all 12 months.
  const electricalMonthData = useMemo(() => {
    const now = new Date()
    now.setHours(0, 0, 0, 0)
    const pipelineProjects = projects.filter(p => {
      const bucket = resolveProjectBucket(p)
      return bucket === 'active' || bucket === 'coming'
    })

    // Build 12 monthly buckets starting from current month
    const buckets = Array.from({ length: 12 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() + i, 1)
      return {
        month: d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
        date: d,
        confirmed: 0,
        confirmedCount: 0,
        confirmedProjects: [] as string[],
        projected: 0,
        projectedCount: 0,
        estimated: 0,
        solarRMO: rmoMonthly,
        solarInstall: installMonthly,
      }
    })

    let unscheduledTotal = 0

    for (const p of pipelineProjects) {
      const contract = num(p.contract ?? p.contract_value ?? 0)
      if (contract <= 0) continue

      const completionDate = p.completedDate || p.endDate
      const startDate = p.startDate || p.lastMove

      if (completionDate) {
        // CONFIRMED: has a specific completion/payment date
        const cd = new Date(completionDate + (completionDate.includes('T') ? '' : 'T00:00:00'))
        if (!isNaN(cd.getTime())) {
          const idx = buckets.findIndex(b =>
            cd.getFullYear() === b.date.getFullYear() && cd.getMonth() === b.date.getMonth()
          )
          if (idx >= 0) {
            buckets[idx].confirmed += contract
            buckets[idx].confirmedCount++
            buckets[idx].confirmedProjects.push(p.name || 'Project')
          } else {
            unscheduledTotal += contract
          }
        } else {
          unscheduledTotal += contract
        }
      } else if (startDate) {
        // PROJECTED: estimate completion = start + 30 days (default)
        const sd = new Date(startDate + (startDate.includes('T') ? '' : 'T00:00:00'))
        if (!isNaN(sd.getTime())) {
          const estCompletion = new Date(sd.getTime() + 30 * 86400000)
          const idx = buckets.findIndex(b =>
            estCompletion.getFullYear() === b.date.getFullYear() &&
            estCompletion.getMonth() === b.date.getMonth()
          )
          if (idx >= 0) {
            buckets[idx].projected += contract
            buckets[idx].projectedCount++
          } else {
            unscheduledTotal += contract
          }
        } else {
          unscheduledTotal += contract
        }
      } else {
        // ESTIMATED: no dates at all → unscheduled pool
        unscheduledTotal += contract
      }
    }

    // Distribute unscheduled pool as rolling average across all 12 months
    if (unscheduledTotal > 0) {
      const monthlyEst = unscheduledTotal / 12
      for (const b of buckets) {
        b.estimated = monthlyEst
      }
    }

    return buckets
  }, [projects, rmoMonthly, installMonthly])

  return (
    <div className="space-y-6 p-5 min-h-screen bg-[#1a1d27]">
      {/* HEADER */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold text-gray-100 mb-1">Solar Income</h1>
          <p className="text-sm text-gray-400">RMO deal scenario calculator — projections only, does not affect your main business numbers</p>
        </div>
        <TrendingUp className="w-8 h-8 text-emerald-500" />
      </div>

      {/* TWO-COLUMN LAYOUT */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* LEFT PANEL: INPUTS */}
        <div className="xl:col-span-1 space-y-4">
          {/* Deal Structure */}
          <div className="bg-[#232738] rounded-lg p-4 space-y-3">
            <h3 className="text-sm font-semibold text-gray-200 uppercase">Deal Structure</h3>
            <InputField label="RMO Oversight Fee %" value={rmoFee} onChange={(v) => updateField('rmoFee', v)} />
            <InputField label="Monthly Base Fee $" value={monthlyBaseFee} onChange={(v) => updateField('monthlyBaseFee', v)} />
            <InputField label="Customer Cost/Watt $" value={custPerWatt} onChange={(v) => updateField('custPerWatt', v)} step="0.01" />
          </div>

          {/* System Config */}
          <div className="bg-[#232738] rounded-lg p-4 space-y-3">
            <h3 className="text-sm font-semibold text-gray-200 uppercase">System Config</h3>
            <InputField label="Panel Wattage (W)" value={panelWatts} onChange={(v) => updateField('panelWatts', v)} />
            <InputField label="Panels/System" value={panelsPerSystem} onChange={(v) => updateField('panelsPerSystem', v)} />
            <InputField label="Total Projects/Month" value={totalProjectsPerMonth} onChange={(v) => updateField('totalProjectsPerMonth', v)} />
            <InputField label="Self-Install Projects/Month" value={selfInstallProjectsPerMonth} onChange={(v) => updateField('selfInstallProjectsPerMonth', v)} />
            <InputField label="RMO Visits/Month" value={visitsPerMonth} onChange={(v) => updateField('visitsPerMonth', v)} />
          </div>

          {/* Contract Adders + Job Mix */}
          <div className="bg-[#232738] rounded-lg p-4 space-y-3">
            <h3 className="text-sm font-semibold text-gray-200 uppercase">Contract Adders</h3>

            {/* Battery Fee Add-On */}
            <InputField label="Battery Fee Add-On $" value={batteryFeePerSystem} onChange={(v) => updateField('batteryFeePerSystem', v)} />
            <div className="flex items-center gap-2">
              <label className="text-xs text-gray-400 flex-1">Battery Adder RMO %</label>
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={0.5}
                  value={batteryRmoFeePct}
                  onChange={(e) => updateField('batteryRmoFeePct', parseFloat(e.target.value) || 0)}
                  className="w-20 bg-[#1a1d27] border border-gray-600 rounded px-2 py-1 text-sm text-gray-100 text-right focus:border-cyan-500 focus:outline-none"
                />
                <span className="text-xs text-gray-400">%</span>
              </div>
            </div>
            <div className="text-xs text-emerald-400 pl-2">
              = ${batteryRmoFeePerBatterySys.toFixed(2)} RMO fee per battery system
            </div>

            {/* Panel Upgrade Fee */}
            <InputField label="Panel Upgrade Fee $" value={panelUpgradeFeePerSystem} onChange={(v) => updateField('panelUpgradeFeePerSystem', v)} />
            <div className="flex items-center gap-2">
              <label className="text-xs text-gray-400 flex-1">Panel Upgrade RMO %</label>
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={0.5}
                  value={panelUpgradeRmoFeePct}
                  onChange={(e) => updateField('panelUpgradeRmoFeePct', parseFloat(e.target.value) || 0)}
                  className="w-20 bg-[#1a1d27] border border-gray-600 rounded px-2 py-1 text-sm text-gray-100 text-right focus:border-cyan-500 focus:outline-none"
                />
                <span className="text-xs text-gray-400">%</span>
              </div>
            </div>
            <div className="text-xs text-emerald-400 pl-2">
              = ${panelRmoFeePerPanelSys.toFixed(2)} RMO fee per panel upgrade system
            </div>
          </div>

          {/* Employee Cost Analysis — Collapsible */}
          <div className="bg-[#232738] rounded-lg p-4 space-y-3">
            <button
              onClick={() => setEmpCostOpen(!empCostOpen)}
              className="flex items-center justify-between w-full text-left"
            >
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4 text-purple-400" />
                <h3 className="text-sm font-semibold text-gray-200 uppercase">Employee Cost Analysis</h3>
              </div>
              {empCostOpen ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
            </button>
            {empCostOpen && (
              <div className="space-y-3 pt-2 border-t border-gray-600/50">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={empCostEnabled}
                    onChange={(e) => updateField('empCostEnabled', e.target.checked)}
                    className="w-4 h-4 rounded accent-purple-500"
                  />
                  <label className="text-sm text-gray-300">Include Employee Costs</label>
                </div>
                {empCostEnabled && (
                  <div className="space-y-3">
                    <InputField label="Number of W-2 Employees" value={empCount} onChange={(v) => updateField('empCount', v)} />
                    <InputField label="Average Hourly Rate $" value={empHourlyRate} onChange={(v) => updateField('empHourlyRate', v)} step="0.50" />
                    <InputField label="Average Hours/Week" value={empHoursPerWeek} onChange={(v) => updateField('empHoursPerWeek', v)} />
                    <InputField label="Payroll Tax Burden %" value={empPayrollTax} onChange={(v) => updateField('empPayrollTax', v)} step="0.1" />
                    <InputField label="Workers Comp Rate %" value={empWorkersComp} onChange={(v) => updateField('empWorkersComp', v)} step="0.1" />
                    <InputField label="General Liability %" value={empGenLiability} onChange={(v) => updateField('empGenLiability', v)} step="0.1" />
                    <InputField label="Benefits/Employee/Month $" value={empBenefitsPerMonth} onChange={(v) => updateField('empBenefitsPerMonth', v)} />

                    {/* Cost Breakdown */}
                    <div className="bg-[#1a1d27] rounded p-3 space-y-2 mt-2">
                      <p className="text-xs font-semibold text-purple-300 uppercase mb-2">Monthly Cost Breakdown</p>
                      <MetricLine label="Gross Wages" value={`$${Math.round(empGrossMonthlyPerEmp * empCount).toLocaleString()}`} />
                      <MetricLine label="Payroll Tax" value={`$${Math.round(empPayrollCostPerEmp * empCount).toLocaleString()}`} red />
                      <MetricLine label="Workers Comp" value={`$${Math.round(empWcCostPerEmp * empCount).toLocaleString()}`} red />
                      <MetricLine label="General Liability" value={`$${Math.round(empGlCostPerEmp * empCount).toLocaleString()}`} red />
                      <MetricLine label="Benefits" value={`$${Math.round(empBenefitsPerMonth * empCount).toLocaleString()}`} red />
                      <div className="border-t border-gray-600 pt-2 mt-2">
                        <MetricLine label="Total Employee Cost" value={`$${Math.round(empTotalMonthly).toLocaleString()}/mo`} red bold />
                      </div>
                    </div>

                    {/* Breakdown Bar: Gross RMO | Employee Cost | True Net */}
                    <div className="bg-[#1a1d27] rounded p-3">
                      <p className="text-xs font-semibold text-gray-400 uppercase mb-2">True Net Breakdown</p>
                      <div className="flex h-6 rounded overflow-hidden mb-2">
                        {totalNetMonthly > 0 && (
                          <>
                            <div
                              className="bg-emerald-500/70 flex items-center justify-center text-[9px] font-bold text-white"
                              style={{ width: `${Math.max(5, (trueNetMonthly / totalNetMonthly) * 100)}%` }}
                            >
                              Net
                            </div>
                            <div
                              className="bg-red-500/70 flex items-center justify-center text-[9px] font-bold text-white"
                              style={{ width: `${Math.max(5, (empTotalMonthly / totalNetMonthly) * 100)}%` }}
                            >
                              Emp
                            </div>
                          </>
                        )}
                      </div>
                      <div className="flex justify-between text-xs">
                        <span className="text-gray-400">RMO Net: <span className="text-emerald-400 font-semibold">{fmtK(totalNetMonthly)}</span></span>
                        <span className="text-gray-400">True Net: <span className={`font-semibold ${trueNetMonthly >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{fmtK(trueNetMonthly)}</span></span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Job Mix Sliders */}
          <div className="bg-[#232738] rounded-lg p-4 space-y-3">
            <h3 className="text-sm font-semibold text-gray-200 uppercase">Job Mix</h3>
            <JobMixSliders
              values={{
                solarOnly: solarOnlyPct,
                batteryOnly: batteryOnlyPct,
                panelOnly: panelOnlyPct,
                batteryPanel: batteryPanelPct,
              }}
              onChange={(key, val) => updateField(key, val)}
            />
          </div>

          {/* Install Revenue */}
          <div className="bg-[#232738] rounded-lg p-4 space-y-3">
            <h3 className="text-sm font-semibold text-gray-200 uppercase">Install Revenue</h3>
            <InputField label="Base Install Pay/Watt $" value={installPerWatt} onChange={(v) => updateField('installPerWatt', v)} step="0.01" />
            <InputField label="Battery Install Rate/Job $" value={batteryInstallFeePerSystem} onChange={(v) => updateField('batteryInstallFeePerSystem', v)} />
            <InputField label="Battery Install Hours/Job" value={batteryInstallHoursPerSystem} onChange={(v) => updateField('batteryInstallHoursPerSystem', v)} />
            <InputField label="Panel Upgrade Install Rate/Job $" value={panelUpgradeInstallFeePerSystem} onChange={(v) => updateField('panelUpgradeInstallFeePerSystem', v)} />
            <InputField label="Panel Upgrade Install Hours" value={panelUpgradeInstallHoursPerSystem} onChange={(v) => updateField('panelUpgradeInstallHoursPerSystem', v)} />
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={installEnabled}
                onChange={(e) => updateField('installEnabled', e.target.checked)}
                className="w-4 h-4 rounded accent-emerald-500"
              />
              <label className="text-sm text-gray-300">Install Labor Stream Enabled</label>
            </div>
          </div>

          {/* Operating Cost */}
          <div className="bg-[#232738] rounded-lg p-4 space-y-3">
            <h3 className="text-sm font-semibold text-gray-200 uppercase">Operating Cost</h3>
            <InputField label="Crew Size" value={crewSize} onChange={(v) => updateField('crewSize', v)} />
            <InputField label="Install Days/System" value={installDays} onChange={(v) => updateField('installDays', v)} step="0.1" />
            <InputField label="Employee Hourly Rate $" value={laborCostPerHr} onChange={(v) => updateField('laborCostPerHr', v)} />
            <InputField label="Payroll+WC Multiplier" value={payrollLoadMult} onChange={(v) => updateField('payrollLoadMult', v)} step="0.01" />
            <InputField label="RMO Visit Hours" value={rmoVisitHours} onChange={(v) => updateField('rmoVisitHours', v)} step="0.5" />
            <InputField label="RMO Visit Miles RT" value={rmoVisitMilesRT} onChange={(v) => updateField('rmoVisitMilesRT', v)} />
            <InputField label="Mileage Cost/Mile $" value={rmoVisitCostPerMile} onChange={(v) => updateField('rmoVisitCostPerMile', v)} step="0.01" />
            <InputField label="RMO Visit Flat Cost $" value={rmoVisitFlatCost} onChange={(v) => updateField('rmoVisitFlatCost', v)} />
          </div>
        </div>

        {/* RIGHT PANEL: RESULTS */}
        <div className="xl:col-span-2 space-y-4">
          {/* Per-System Breakdown */}
          <div className="bg-[#232738] rounded-lg p-4">
            <h3 className="text-sm font-semibold text-gray-200 uppercase mb-4">Per-System Breakdown</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-gray-400 mb-3">RMO Revenue Fees</p>
                <div className="space-y-2">
                  <MetricLine label="System Size" value={`${sysKW.toFixed(2)} kW`} />
                  <MetricLine label={`RMO Base Fee (DC-watt ${rmoFee}%)`} value={`$${baseRmoPerSys.toFixed(0)}`} green />
                  <MetricLine label={`Battery Add-On RMO Fee (${batteryRmoFeePct}%)`} value={`$${batteryRmoFeePerBatterySys.toFixed(0)}`} green />
                  <MetricLine label={`Panel Upgrade RMO Fee (${panelUpgradeRmoFeePct}%)`} value={`$${panelRmoFeePerPanelSys.toFixed(0)}`} green />
                  <MetricLine label={`Monthly Base Fee/System (÷${totalProjectsPerMonth})`} value={`$${monthlyBasePerSys.toFixed(0)}`} green />
                  <div className="border-t border-gray-600 pt-2 mt-2">
                    <MetricLine label="Total RMO/System" value={`$${(baseRmoPerSys + batteryRmoFeePerBatterySys + panelRmoFeePerPanelSys + monthlyBasePerSys).toFixed(0)}`} green bold />
                  </div>
                </div>
              </div>
              <div>
                <p className="text-xs text-gray-400 mb-3">Installation Revenue Fees</p>
                <div className="space-y-2">
                  <MetricLine label="Install Per-Watt" value={`$${baseInstallRevenuePerSys.toFixed(0)}`} green />
                  <MetricLine label="Battery Install (Wtd)" value={`$${avgBatteryInstallRevenuePerSys.toFixed(0)}`} green />
                  <MetricLine label="Panel Install (Wtd)" value={`$${avgPanelUpgradeInstallRevenuePerSys.toFixed(0)}`} green />
                  <MetricLine label="Install Labor Cost" value={`-$${installLabor.toFixed(0)}`} red />
                  <div className="border-t border-gray-600 pt-2 mt-2">
                    <MetricLine label="Install Net/System" value={`$${(installPerSys - crewBurdenCostPerSys).toFixed(0)}`} green={installPerSys > crewBurdenCostPerSys} bold />
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Job Mix Doughnut Chart — Double-ring: outer=revenue by job type, inner=cost ratio */}
          {(
            <ErrorBoundary>
              <JobMixChart
                solar={solarOnlyNorm}
                panel={panelOnlyNorm}
                batteryPanel={batteryPanelNorm}
                batteryOnly={batteryOnlyNorm}
                rmoFeeTotal={rmoPerSys * totalProjectsPerMonth}
                installLaborTotal={installLabor}
                netMarginTotal={totalNetMonthly}
              />
            </ErrorBoundary>
          )}

          {/* Job Mix Scenario Grid */}
          <JobMixScenarioGrid
            solarOnlyPct={solarOnlyNorm}
            batteryOnlyPct={batteryOnlyNorm}
            panelOnlyPct={panelOnlyNorm}
            batteryPanelPct={batteryPanelNorm}
            totalMonthly={totalMonthly}
            totalLabor={totalLabor}
            totalNetMonthly={totalNetMonthly}
            solarOnlyProj={totalMonthly * (solarOnlyNorm / 100)}
            batteryOnlyProj={totalMonthly * (batteryOnlyNorm / 100)}
            panelOnlyProj={totalMonthly * (panelOnlyNorm / 100)}
            batteryPanelProj={totalMonthly * (batteryPanelNorm / 100)}
          />

          {/* Revenue Streams — Separated by source */}
          <div className="bg-[#232738] rounded-lg p-4">
            <h3 className="text-sm font-semibold text-gray-200 uppercase mb-4">Revenue Streams</h3>
            <div className="space-y-4">
              {/* Card 1: RMO — Power On Solutions LLC */}
              {(() => {
                const rmoCardTotal = (baseRmoPerSys * totalProjectsPerMonth)
                  + (batteryRmoFeePerBatterySys * batterySystemsPerMonth)
                  + (panelRmoFeePerPanelSys * panelSystemsPerMonth)
                  + monthlyBaseFee
                return (
                  <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-4 space-y-2">
                    <h4 className="text-sm font-medium text-cyan-400">RMO — Power On Solutions LLC</h4>
                    <p className="text-2xl font-bold text-white">{fmtK(rmoCardTotal)}</p>
                    <p className="text-xs text-gray-400">RMO oversight fee income</p>
                    <div className="text-xs text-gray-500 space-y-1 mt-3 pt-2 border-t border-gray-700">
                      <div>Base fee: {fmtK(monthlyBaseFee)}/mo</div>
                      <div>DC-watt fee: {fmtK(baseRmoPerSys)}/system × {totalProjectsPerMonth} systems = {fmtK(baseRmoPerSys * totalProjectsPerMonth)}</div>
                      <div>Battery adder: {fmtK(batteryRmoFeePerBatterySys)}/system × {batterySystemsPerMonth.toFixed(1)} systems = {fmtK(batteryRmoFeePerBatterySys * batterySystemsPerMonth)}</div>
                      <div>Panel adder: {fmtK(panelRmoFeePerPanelSys)}/system × {panelSystemsPerMonth.toFixed(1)} systems = {fmtK(panelRmoFeePerPanelSys * panelSystemsPerMonth)}</div>
                    </div>
                  </div>
                )
              })()}

              {/* Card 2: Installation — Subcontractor */}
              <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-4 space-y-2">
                <h4 className="text-sm font-medium text-blue-400">Installation — Subcontractor</h4>
                <p className="text-2xl font-bold text-white">{fmtK(installNetMonthly)}</p>
                <p className="text-xs text-gray-400">Installation monthly net income</p>
                <div className="text-xs text-gray-500 space-y-1 mt-3 pt-2 border-t border-gray-700">
                  <div>Fee per system: {fmtK(installPerSys)} × {selfInstallProjectsPerMonth} projects = {fmtK(installMonthly)}</div>
                  <div>Labor cost: -{fmtK(installLabor)}</div>
                  <div>Net: {fmtK(installNetMonthly)}</div>
                </div>
              </div>

              {/* Card 3: Electrical Projects — Monthly Net */}
              {(() => {
                const confirmedThisMonth = electricalMonthData[0]?.confirmed ?? 0
                const pipelineK = Math.round(electricalPipelineTotal / 1000)
                return (
                  <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-4 space-y-2">
                    <h4 className="text-sm font-medium text-emerald-400">Electrical Projects — Monthly Net</h4>
                    <p className="text-2xl font-bold text-white">{fmtK(confirmedThisMonth)}</p>
                    <p className="text-xs text-gray-400">Monthly Net (confirmed)</p>
                    <div className="text-xs text-gray-300 space-y-1 mt-3 pt-2 border-t border-gray-700">
                      <div className="font-medium">Pipeline (active): ${pipelineK}k — {activeProjects.length} project{activeProjects.length !== 1 ? 's' : ''}</div>
                      {electricalMonthData[0]?.projected > 0 && (
                        <div className="text-amber-400">Projected this month: {fmtK(electricalMonthData[0].projected)}</div>
                      )}
                    </div>
                  </div>
                )
              })()}

              {/* Combined Total */}
              <div className="bg-gray-800/50 border border-emerald-500/30 rounded-xl p-4 flex justify-between items-center">
                <span className="text-sm font-medium text-gray-300">Combined Monthly Revenue</span>
                <span className="text-2xl font-bold text-emerald-400">{fmtK(rmoMonthly + installNetMonthly + (electricalMonthData[0]?.confirmed ?? 0))}</span>
              </div>
            </div>
          </div>

          {/* Revenue Stream Chart — month-mapped pipeline data */}
          {(
            <RevenueStreamChart data={electricalMonthData} />
          )}

          {/* Business-Linked Projections Grouped Bar Chart */}
          {(
            <BusinessProjectionsChart
              rmoMonthly={rmoMonthly}
              rmoAnnual={rmoAnnual}
              installMonthly={installMonthly}
              installAnnual={installMonthly * 12}
              totalMonthly={totalMonthly}
              totalAnnual={totalAnnual}
              electricalPipelineTotal={electricalPipelineTotal}
            />
          )}

          {/* Business-Linked Projections Summary Cards */}
          <div className="bg-[#232738] rounded-lg p-4">
            <h3 className="text-sm font-semibold text-gray-200 uppercase mb-4">Projections Summary</h3>
            <div className="grid grid-cols-3 gap-4">
              <div className="bg-[#1e2130] rounded p-3">
                <p className="text-xs text-gray-400 mb-2">Monthly Revenue</p>
                <p className="text-lg font-bold text-emerald-400">{fmtK(totalMonthly)}</p>
              </div>
              <div className="bg-[#1e2130] rounded p-3">
                <p className="text-xs text-gray-400 mb-2">Annual Revenue</p>
                <p className="text-lg font-bold text-blue-400">{fmtK(totalAnnual)}</p>
              </div>
              <div className="bg-[#1e2130] rounded p-3">
                <p className="text-xs text-gray-400 mb-2">Net Monthly</p>
                <p className="text-lg font-bold text-purple-400">{fmtK(totalNetMonthly)}</p>
              </div>
            </div>
          </div>

          {/* Combined Projection */}
          <div className="bg-[#232738] rounded-lg p-4">
            <h3 className="text-sm font-semibold text-gray-200 uppercase mb-4">Combined Projection</h3>
            <div className="space-y-2">
              <ProjectionLine label="Your Electrical Pipeline" value={fmtK(dealOutlook.active.total)} />
              <ProjectionLine label="Projected RMO Revenue" value={fmtK(rmoMonthly)} />
              <div className="border-t border-gray-600 pt-2 mt-2">
                <ProjectionLine label="Combined Monthly Estimate" value={fmtK(rmoMonthly + dealOutlook.active.total)} bold />
              </div>
              <ProjectionLine label="Combined Annual Estimate" value={fmtK((rmoMonthly + dealOutlook.active.total) * 12)} bold />
            </div>
            <div className="mt-4 px-3 py-2 bg-yellow-900/30 border border-yellow-700 rounded-lg text-xs text-yellow-200">
              <p className="font-semibold mb-1">⚠️ PROJECTION ONLY</p>
              <p>Does not affect your business numbers — this is a scenario calculator only</p>
            </div>
          </div>

          {/* SCOUT AI Analysis */}
          <LiveAIInsightPanel
            rmoMonthly={rmoMonthly}
            rmoPerSys={rmoPerSys}
            totalProjectsPerMonth={totalProjectsPerMonth}
            totalMonthly={totalMonthly}
            totalLabor={totalLabor}
            totalNetMonthly={totalNetMonthly}
            electricalPipelineTotal={electricalPipelineTotal}
            visitsPerMonth={visitsPerMonth}
            onDeepAnalysis={async () => {
              setDeepAnalysisOpen(true)
              setDeepAnalysisLoading(true)
              try {
                const response = await callClaude({
                  system: 'You are a financial analyst for Power On Solutions, a C-10 electrical contractor. Provide concise, actionable analysis.',
                  messages: [{ role: 'user', content: `Analyze this income data:\nRMO Monthly: $${Math.round(rmoMonthly)}\nInstall Monthly: $${Math.round(installNetMonthly)}\nElectrical Monthly: $${Math.round(revenueStreams.projMonthlyNet)}\nTotal Monthly: $${Math.round(rmoMonthly + installNetMonthly + revenueStreams.projMonthlyNet)}\nMonthly Overhead: $${Math.round(totalLabor)}\n\nProvide: 1) Break-even analysis 2) Pipeline coverage months 3) Profitability assessment 4) Revenue stream comparison. Keep under 300 words.` }],
                  max_tokens: 768,
                })
                setDeepAnalysis(extractText(response))
              } catch { setDeepAnalysis('Analysis unavailable. Check connection.') }
              setDeepAnalysisLoading(false)
            }}
          />

          {/* Bottom-Line Summary */}
          <div className="bg-[#232738] rounded-lg p-4 border border-emerald-700/30">
            <p className="text-sm text-gray-300 leading-relaxed">
              At <span className="font-semibold text-emerald-400">{totalProjectsPerMonth} systems/month</span> with <span className="font-semibold text-emerald-400">{batteryAttachPct.toFixed(0)}% battery attach</span>, <span className="font-semibold text-emerald-400">{panelUpgradeAttachPct.toFixed(0)}% panel upgrade rate</span>, and <span className="font-semibold text-cyan-400">{batteryRmoFeePct}% battery adder fee</span> + <span className="font-semibold text-cyan-400">{panelUpgradeRmoFeePct}% panel adder fee</span>, projected net monthly RMO revenue is <span className="font-bold text-lg text-emerald-400">{fmtK(totalNetMonthly)}</span>
            </p>
          </div>
        </div>
      </div>

      {/* Deep Analysis Modal */}
      {deepAnalysisOpen && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/50" onClick={() => setDeepAnalysisOpen(false)} />
          <div className="relative w-full max-w-md bg-gray-900 border-l border-gray-700 p-6 overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-white font-semibold text-lg">Deep Analysis</h3>
              <div className="flex gap-2">
                {deepAnalysis && (
                  <button onClick={() => navigator.clipboard.writeText(deepAnalysis)} className="px-3 py-1 bg-gray-700 text-gray-300 rounded text-xs hover:bg-gray-600">Copy</button>
                )}
                <button onClick={() => setDeepAnalysisOpen(false)} className="text-gray-400 hover:text-white"><X className="w-5 h-5" /></button>
              </div>
            </div>
            {deepAnalysisLoading ? (
              <div className="flex justify-center py-12"><div className="w-6 h-6 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" /></div>
            ) : (
              <div className="text-gray-300 text-sm whitespace-pre-wrap leading-relaxed">{deepAnalysis}</div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ── CHART COMPONENTS ──

// Job Mix Double-Ring Doughnut — matches Business Health Overview in V15rMoneyPanel.tsx
// Outer ring: Revenue breakdown by job type (Solar Only, Battery Only, Panel Upgrade, Battery+Panel)
// Inner ring: Cost ratio (RMO Fee, Installation Labor, Net Margin)
function JobMixChart({ solar, panel, batteryPanel, batteryOnly, rmoFeeTotal, installLaborTotal, netMarginTotal }) {
  // recharts imported at top of file
  const outerData = [
    { name: 'Solar Only', value: solar, color: '#3b82f6' },
    { name: 'Battery Only', value: batteryOnly, color: '#8b5cf6' },
    { name: 'Panel Upgrade', value: panel, color: '#14b8a6' },
    { name: 'Battery+Panel', value: batteryPanel, color: '#f59e0b' },
  ].filter(d => d.value > 0)
  const innerData = [
    { name: 'RMO Fee', value: rmoFeeTotal, color: '#22c55e' },
    { name: 'Install Labor', value: installLaborTotal, color: '#ef4444' },
    { name: 'Net Margin', value: netMarginTotal, color: '#10b981' },
  ].filter(d => d.value > 0)
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-center">
        <div style={{ position: 'relative', maxWidth: '320px', height: '320px', width: '100%' }}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={outerData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={120} innerRadius={50}>
                {outerData.map((d, i) => <Cell key={i} fill={d.color} stroke="#1a1d27" strokeWidth={2} />)}
              </Pie>
              <Pie data={innerData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={45} innerRadius={0}>
                {innerData.map((d, i) => <Cell key={i} fill={d.color} stroke="#1a1d27" strokeWidth={2} />)}
              </Pie>
              <Tooltip contentStyle={{ backgroundColor: '#374151', border: '1px solid #4b5563', borderRadius: 8 }} formatter={(v) => ['$' + Number(v).toLocaleString()]} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4 text-xs">
        {[...outerData, ...innerData].map(d => (
          <div key={d.name} className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: d.color }} />
            <span className="text-gray-400">{d.name}:</span>
            <span className="text-gray-200 font-mono">{fmtK(d.value)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// RevenueStreamChart — pure SVG, zero state hooks, ref-based tooltip only.
// Accepts electricalMonthData buckets with confirmed/projected/estimated breakdown.
// Bar stacking (bottom → top): estimated → projected → confirmed
// Trend line: solid green for past months, dashed amber for future months.
function RevenueStreamChart({ data }) {
  var tooltipRef = useRef<HTMLDivElement>(null)
  if (!data || !data.length) {
    return (
      <div className="bg-[#232738] rounded-lg p-4">
        <h3 className="text-sm font-semibold text-gray-200 uppercase mb-4">Electrical Pipeline & Revenue Projection</h3>
        <div className="flex items-center justify-center h-40 text-gray-500 text-sm">No pipeline data</div>
      </div>
    )
  }

  var safe = function(v: any): number { var n = Number(v); return (isNaN(n) || !isFinite(n)) ? 0 : n }
  var fmtD = function(v: number): string { v = safe(v); return v >= 1000000 ? '$' + (v / 1000000).toFixed(1) + 'M' : v >= 1000 ? '$' + (v / 1000).toFixed(0) + 'k' : '$' + Math.round(v) }

  var W = 900, H = 300, pad = { t: 30, r: 24, b: 46, l: 70 }
  var cW = W - pad.l - pad.r, cH = H - pad.t - pad.b

  // Max value across all months (electrical stack + solar streams)
  var maxVal = 1
  for (var di = 0; di < data.length; di++) {
    var d = data[di]
    var total = safe(d.confirmed) + safe(d.projected) + safe(d.estimated) + safe(d.solarRMO) + safe(d.solarInstall)
    if (total > maxVal) maxVal = total
  }
  maxVal = maxVal * 1.15

  var barW = (cW / data.length) * 0.62
  var barGap = cW / data.length

  function xCenter(i: number) { return pad.l + i * barGap + barGap / 2 }
  function yScale(v: number) { return pad.t + cH - (safe(v) / maxVal) * cH }

  var now = new Date(); now.setHours(0, 0, 0, 0)

  function showTip(i: number) {
    var el = tooltipRef.current; if (!el || !data[i]) return
    var d = data[i]
    var conf = safe(d.confirmed), proj = safe(d.projected), est = safe(d.estimated)
    var rmo = safe(d.solarRMO), inst = safe(d.solarInstall)
    var total = conf + proj + est + rmo + inst
    var html = '<b style="color:#fff;display:block;margin-bottom:6px">' + (d.month || '') + '</b>'
    if (conf > 0) {
      html += '<div style="color:#1D9E75">■ Confirmed: ' + fmtD(conf)
      if (d.confirmedCount > 0) html += ' (' + d.confirmedCount + ' project' + (d.confirmedCount !== 1 ? 's' : '') + ')'
      html += '</div>'
      if (d.confirmedProjects && d.confirmedProjects.length > 0) {
        html += '<div style="color:#6b7280;font-size:10px;padding-left:8px;margin-bottom:2px">' + d.confirmedProjects.slice(0, 3).join(', ') + '</div>'
      }
    }
    if (proj > 0) html += '<div style="color:#f59e0b">■ Projected: ' + fmtD(proj) + (d.projectedCount > 0 ? ' (' + d.projectedCount + ')' : '') + '</div>'
    if (est > 0) html += '<div style="color:#fbbf24;opacity:0.8">░ Estimated: ' + fmtD(est) + ' (avg)</div>'
    if (rmo > 0) html += '<div style="color:#34d399">⁃ Solar RMO: ' + fmtD(rmo) + '</div>'
    if (inst > 0) html += '<div style="color:#eab308">⁃ Solar Install: ' + fmtD(inst) + '</div>'
    html += '<div style="border-top:1px solid #374151;margin-top:5px;padding-top:4px;color:#e5e7eb;font-weight:700">Total: ' + fmtD(total) + '</div>'
    el.innerHTML = html
    el.style.display = 'block'
  }
  function hideTip() { var el = tooltipRef.current; if (el) el.style.display = 'none' }

  var ticks = [0, 0.25, 0.5, 0.75, 1].map(function(f) { return maxVal * f })

  // Trend line: top of (confirmed + projected + estimated) per month
  var trendPts = data.map(function(d: any, i: number) {
    var elec = safe(d.confirmed) + safe(d.projected) + safe(d.estimated)
    var isPast = d.date instanceof Date ? d.date < now : false
    return { x: xCenter(i), y: yScale(elec), isPast }
  })

  return (
    <div className="bg-[#232738] rounded-lg p-4">
      <h3 className="text-sm font-semibold text-gray-200 uppercase mb-4">Electrical Pipeline & Revenue Projection</h3>
      <div className="relative w-full" style={{ height: H + 'px' }}>
        <svg viewBox={'0 0 ' + W + ' ' + H} preserveAspectRatio="xMidYMid meet" className="w-full h-full" style={{ display: 'block' }}>

          {/* Y-axis grid + labels */}
          {ticks.map(function(v, i) {
            var yPos = yScale(v)
            return (
              <g key={i}>
                <line x1={pad.l} y1={yPos} x2={W - pad.r} y2={yPos} stroke="rgba(255,255,255,0.05)" />
                <text x={pad.l - 8} y={yPos + 4} textAnchor="end" fill="#9ca3af" fontSize="10">{fmtD(v)}</text>
              </g>
            )
          })}

          {/* Stacked bars per month */}
          {data.map(function(d: any, i: number) {
            var bx = xCenter(i) - barW / 2
            var conf = safe(d.confirmed), proj = safe(d.projected), est = safe(d.estimated)
            var yBottom = pad.t + cH

            var estH = (est / maxVal) * cH
            var projH = (proj / maxVal) * cH
            var confH = (conf / maxVal) * cH

            // Stack from bottom: estimated → projected → confirmed
            var yEst = yBottom - estH
            var yProj = yEst - projH
            var yConf = yProj - confH

            return (
              <g key={i}
                onMouseEnter={function() { showTip(i) }}
                onMouseLeave={hideTip}
              >
                {/* Estimated: amber 30% opacity + dashed top border */}
                {estH > 0.5 && (
                  <g>
                    <rect x={bx} y={yEst} width={barW} height={estH} fill="#f59e0b" opacity={0.3} />
                    <line x1={bx} y1={yEst} x2={bx + barW} y2={yEst}
                      stroke="#f59e0b" strokeWidth="1.5" strokeDasharray="4 3" opacity={0.9} />
                  </g>
                )}
                {/* Projected: amber 70% opacity */}
                {projH > 0.5 && (
                  <rect x={bx} y={yProj} width={barW} height={projH} fill="#f59e0b" opacity={0.7} />
                )}
                {/* Confirmed: solid green */}
                {confH > 0.5 && (
                  <rect x={bx} y={yConf} width={barW} height={confH} fill="#1D9E75" opacity={1} rx={2} />
                )}
                {/* Invisible hit area */}
                <rect x={bx} y={pad.t} width={barW} height={cH} fill="transparent" />
                {/* X-axis label */}
                <text x={xCenter(i)} y={H - 8} textAnchor="middle" fill="#9ca3af" fontSize="9">{d.month || ''}</text>
              </g>
            )
          })}

          {/* Trend line: past months = solid green, future = dashed amber */}
          {trendPts.map(function(pt, i) {
            if (i === 0) return null
            var prev = trendPts[i - 1]
            var isPastSeg = prev.isPast && pt.isPast
            var isFutureSeg = !prev.isPast && !pt.isPast
            var isTransition = prev.isPast !== pt.isPast
            if (isPastSeg) {
              return <line key={'t' + i} x1={prev.x} y1={prev.y} x2={pt.x} y2={pt.y}
                stroke="#10b981" strokeWidth="2" opacity={0.9} />
            }
            if (isFutureSeg || isTransition) {
              return <line key={'t' + i} x1={prev.x} y1={prev.y} x2={pt.x} y2={pt.y}
                stroke="#f59e0b" strokeWidth="2" strokeDasharray="5 4" opacity={0.8} />
            }
            return null
          })}

          {/* "Est. trend →" label at final point if it's a future point */}
          {trendPts.length > 0 && !trendPts[trendPts.length - 1].isPast && (
            <text x={trendPts[trendPts.length - 1].x + 6} y={trendPts[trendPts.length - 1].y + 4}
              fill="#9ca3af" fontSize="8" opacity={0.7}>Est. trend →</text>
          )}

        </svg>
        {/* Tooltip — ref-based DOM, no state */}
        <div ref={tooltipRef} style={{
          display: 'none', position: 'absolute', top: 8, right: 8,
          background: 'rgba(15,17,23,0.96)', border: '1px solid #374151',
          borderRadius: 8, padding: '10px 14px', fontSize: 11, zIndex: 10,
          pointerEvents: 'none', minWidth: 210, maxWidth: 260,
        }} />
      </div>
      {/* Legend */}
      <div className="flex flex-wrap gap-4 mt-2 justify-center text-[10px] text-gray-400">
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: '#1D9E75' }} />
          Confirmed
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: '#f59e0b', opacity: 0.7 }} />
          Projected
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: '#f59e0b', opacity: 0.3 }} />
          Estimated
        </span>
        <span className="flex items-center gap-1.5">
          <span style={{ width: 14, height: 0, borderTop: '2px dashed #f59e0b', display: 'inline-block', verticalAlign: 'middle' }} />
          <span>Est. trend</span>
        </span>
      </div>
    </div>
  )
}

function BusinessProjectionsChart({ rmoMonthly, rmoAnnual, installMonthly, installAnnual, totalMonthly, totalAnnual, electricalPipelineTotal }) {
  // NaN guard: any undefined/NaN value from missing or zero-division inputs becomes 0
  const safe = (val: number) => (isNaN(val) || !isFinite(val)) ? 0 : val
  const ePipeline = safe(num(electricalPipelineTotal))
  // recharts imported at top of file
  const chartData = [
    { name: 'Monthly', electrical: safe(ePipeline / 12), rmo: safe(rmoMonthly), install: safe(installMonthly) },
    { name: 'Annual (mo)', electrical: safe(ePipeline / 12), rmo: safe(rmoAnnual / 12), install: safe(installAnnual / 12) },
    { name: '5-Year (mo)', electrical: safe(ePipeline / 12), rmo: safe((rmoAnnual / 12) * 5), install: safe((installAnnual / 12) * 5) },
  ]
  return (
    <div className="bg-[#232738] rounded-lg p-4">
      <h3 className="text-sm font-semibold text-gray-200 uppercase mb-4">Business-Linked Projections</h3>
      <div style={{ height: '300px' }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 10 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
            <XAxis dataKey="name" tick={{ fill: '#9ca3af', fontSize: 10 }} />
            <YAxis tickFormatter={(v) => '$' + (v / 1000).toFixed(0) + 'k'} tick={{ fill: '#9ca3af', fontSize: 11 }} />
            <Tooltip contentStyle={{ backgroundColor: '#0f1117', border: '1px solid #374151', borderRadius: 8 }} formatter={(v) => ['$' + Number(v).toLocaleString()]} />
            <Legend wrapperStyle={{ color: '#d1d5db', fontSize: 11 }} />
            <Bar dataKey="electrical" name="Electrical Pipeline" fill="#3b82f6" radius={[3, 3, 0, 0]} />
            <Bar dataKey="rmo" name="RMO Revenue" fill="#10b981" radius={[3, 3, 0, 0]} />
            <Bar dataKey="install" name="Install Labor" fill="#eab308" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

function JobMixSliders({ values, onChange }: { values: { solarOnly: number, batteryOnly: number, panelOnly: number, batteryPanel: number }, onChange: (key: string, val: number) => void }) {
  const sliders = [
    { key: 'solarOnly', label: 'Solar Only %', color: '#3b82f6', field: 'solarOnlyPct' },
    { key: 'batteryOnly', label: 'Battery Only %', color: '#f59e0b', field: 'batteryOnlyPct' },
    { key: 'panelOnly', label: 'Panel Upgrade Only %', color: '#8b5cf6', field: 'panelOnlyPct' },
    { key: 'batteryPanel', label: 'Battery+Panel %', color: '#10b981', field: 'batteryPanelPct' },
  ]

  const total = values.solarOnly + values.batteryOnly + values.panelOnly + values.batteryPanel

  // ISSUE 6: Each slider moves INDEPENDENTLY — no auto-adjustment of others
  const handleSliderChange = (field: string, newVal: number) => {
    onChange(field, newVal)
  }

  return (
    <div className="space-y-3">
      {sliders.map(s => (
        <div key={s.key}>
          <div className="flex justify-between items-center mb-1">
            <label className="text-xs text-gray-400">{s.label}</label>
            <span className="text-xs font-mono text-gray-200">{values[s.key as keyof typeof values]}%</span>
          </div>
          <input
            type="range"
            min={0}
            max={100}
            value={values[s.key as keyof typeof values]}
            onChange={(e) => handleSliderChange(s.field, Number(e.target.value))}
            className="w-full h-1.5 rounded-full appearance-none cursor-pointer"
            style={{
              background: `linear-gradient(to right, ${s.color} ${values[s.key as keyof typeof values]}%, #374151 ${values[s.key as keyof typeof values]}%)`,
            }}
          />
        </div>
      ))}
      {total === 100 ? (
        <div className="text-[10px] font-semibold text-right text-emerald-400">
          ✓ 100%
        </div>
      ) : (
        <div className="text-[10px] font-semibold text-right text-red-400">
          ⚠ {total}% — must equal 100%
        </div>
      )}
    </div>
  )
}

function InputField({ label, value, onChange, step = '1' }) {
  return (
    <div>
      <label className="text-xs text-gray-400 block mb-1">{label}</label>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        step={step}
        className="w-full px-2 py-1.5 bg-[#1a1d27] border border-gray-600 rounded text-sm text-gray-100 focus:outline-none focus:border-emerald-500"
      />
    </div>
  )
}

function MetricLine({ label, value, green, red, bold = false }) {
  const color = green ? 'text-emerald-400' : red ? 'text-red-400' : 'text-gray-300'
  const weight = bold ? 'font-semibold' : 'font-normal'
  return (
    <div className="flex justify-between items-center text-sm">
      <span className="text-gray-400">{label}</span>
      <span className={`${color} ${weight}`}>{value}</span>
    </div>
  )
}

function OutlookCard({ label, emoji, count, value, green = false }) {
  const color = green ? 'text-emerald-400' : 'text-gray-300'
  return (
    <div className="bg-[#1e2130] rounded p-3 text-center">
      <p className="text-xl mb-1">{emoji}</p>
      <p className="text-xs text-gray-400 mb-2">{label}</p>
      <p className={`text-sm font-bold ${color} mb-1`}>{count} deals</p>
      <p className={`text-xs ${color}`}>{fmtK(value)}</p>
    </div>
  )
}

function ProjectionLine({ label, value, bold = false }) {
  const weight = bold ? 'font-semibold' : 'font-normal'
  return (
    <div className="flex justify-between items-center text-sm">
      <span className="text-gray-400">{label}</span>
      <span className={`${weight} text-emerald-400`}>{value}</span>
    </div>
  )
}

// Job Mix Scenario Grid
function JobMixScenarioGrid({
  solarOnlyPct,
  batteryOnlyPct,
  panelOnlyPct,
  batteryPanelPct,
  totalMonthly,
  totalLabor,
  totalNetMonthly,
  solarOnlyProj,
  batteryOnlyProj,
  panelOnlyProj,
  batteryPanelProj
}) {
  const calcScenario = (monthlyRev) => {
    const monthlyNet = monthlyRev - (totalLabor / (totalMonthly > 0 ? totalMonthly : 1)) * monthlyRev
    const annualNet = monthlyNet * 12
    return { monthlyRev, monthlyNet, annualNet }
  }

  const solarOnly = calcScenario(solarOnlyProj)
  const batteryOnly = calcScenario(batteryOnlyProj)
  const panelOnly = calcScenario(panelOnlyProj)
  const batteryPanel = calcScenario(batteryPanelProj)

  const ScenarioCard = ({ title, monthly, monthlyNet, annualNet, color }) => {
    const isPositive = monthlyNet >= 0
    return (
      <div className="bg-[#232738] border border-gray-700/50 rounded-lg p-4">
        <h4 className="text-sm font-semibold text-gray-200 mb-4">{title}</h4>
        <div className="space-y-3">
          <div>
            <p className="text-xs text-gray-400 mb-1">Monthly Gross</p>
            <p className={`text-lg font-bold ${color}`}>{fmtK(monthly)}</p>
          </div>
          <div>
            <p className="text-xs text-gray-400 mb-1">Monthly Net</p>
            <p className={`text-lg font-bold flex items-center gap-1 ${isPositive ? 'text-emerald-400' : 'text-red-400'}`}>
              {fmtK(monthlyNet)}
              {isPositive ? '↑' : '↓'}
            </p>
          </div>
          <div className="border-t border-gray-600 pt-2">
            <p className="text-xs text-gray-400 mb-1">Annual Net</p>
            <p className={`text-base font-semibold ${isPositive ? 'text-emerald-400' : 'text-red-400'}`}>{fmtK(annualNet)}</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-2 gap-4">
      <ScenarioCard title="Solar Only" monthly={solarOnly.monthlyRev} monthlyNet={solarOnly.monthlyNet} annualNet={solarOnly.annualNet} color="text-blue-400" />
      <ScenarioCard title="Battery Only" monthly={batteryOnly.monthlyRev} monthlyNet={batteryOnly.monthlyNet} annualNet={batteryOnly.annualNet} color="text-orange-400" />
      <ScenarioCard title="Panel Only" monthly={panelOnly.monthlyRev} monthlyNet={panelOnly.monthlyNet} annualNet={panelOnly.annualNet} color="text-yellow-400" />
      <ScenarioCard title="Battery + Panel" monthly={batteryPanel.monthlyRev} monthlyNet={batteryPanel.monthlyNet} annualNet={batteryPanel.annualNet} color="text-purple-400" />
    </div>
  )
}

// Live AI Insight Panel
function LiveAIInsightPanel({
  rmoMonthly,
  rmoPerSys,
  totalProjectsPerMonth,
  totalMonthly,
  totalLabor,
  totalNetMonthly,
  electricalPipelineTotal,
  visitsPerMonth,
  onDeepAnalysis
}) {
  const [analyzing, setAnalyzing] = useState(false)

  useEffect(() => {
    setAnalyzing(true)
    const timer = setTimeout(() => setAnalyzing(false), 500)
    return () => clearTimeout(timer)
  }, [rmoMonthly, totalProjectsPerMonth, electricalPipelineTotal])

  const breakEvenSystems = totalProjectsPerMonth > 0 && rmoPerSys > 0 ? Math.round((totalLabor / 12) / rmoPerSys) : 0
  const rmoIsProfit = rmoMonthly > (totalLabor / 12)
  const pipelineMonths = electricalPipelineTotal > 0 ? (electricalPipelineTotal / Math.max(1, totalLabor / 12)) : 0

  return (
    <div className="bg-[#1a1d27] border border-purple-500/30 rounded-lg p-4">
      <div className="flex items-center gap-2 mb-4">
        <Zap className="w-5 h-5 text-purple-400" />
        <h3 className="text-sm font-semibold text-purple-300 uppercase">SCOUT Analysis</h3>
        {analyzing && <span className="text-xs text-purple-400 animate-pulse">Analyzing...</span>}
      </div>
      <div className="space-y-3 mb-4">
        <div className="flex items-start gap-2">
          <span className="text-purple-400 font-bold mt-0.5">•</span>
          <p className="text-sm text-gray-300">
            Break-even at <span className="font-semibold text-emerald-400">{breakEvenSystems} systems/month</span> based on current RMO per-system value
          </p>
        </div>
        <div className="flex items-start gap-2">
          <span className={rmoIsProfit ? 'text-emerald-400' : 'text-yellow-400'} style={{ fontWeight: 'bold', marginTop: '0.125rem' }}>•</span>
          <p className="text-sm text-gray-300">
            RMO becomes <span className={rmoIsProfit ? 'text-emerald-400 font-semibold' : 'text-yellow-400 font-semibold'}>
              {rmoIsProfit ? 'HIGHLY PROFITABLE' : 'needs more volume'}
            </span> at current {totalProjectsPerMonth} systems/month
          </p>
        </div>
        <div className="flex items-start gap-2">
          <span className="text-blue-400 font-bold mt-0.5">•</span>
          <p className="text-sm text-gray-300">
            Your electrical pipeline covers <span className="font-semibold text-blue-400">{pipelineMonths.toFixed(1)} months</span> of operational overhead
          </p>
        </div>
      </div>
      <button
        onClick={onDeepAnalysis}
        className="w-full px-3 py-2 bg-purple-600/20 border border-purple-500/50 hover:border-purple-500 rounded text-sm text-purple-300 font-semibold transition-colors"
      >
        Deep Analysis
      </button>
    </div>
  )
}

function NoData() {
  return (
    <div className="flex items-center justify-center min-h-screen bg-[#1a1d27]">
      <div className="text-center">
        <AlertCircle className="w-12 h-12 text-gray-500 mx-auto mb-4" />
        <p className="text-gray-400">No backup data available</p>
      </div>
    </div>
  )
}
