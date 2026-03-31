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
import { AlertCircle, TrendingUp, Sparkles, Zap, ChevronDown, ChevronRight, Users, X } from 'lucide-react'
import { callClaude, extractText } from '@/services/claudeProxy'
import { getBackupData, getProjectFinancials, resolveProjectBucket, fmtK, fmt, pct, num, saveBackupData, type BackupData } from '@/services/backupDataService'
import { pushState } from '@/services/undoRedoService'
import { ErrorBoundary } from '@/components/ErrorBoundary'

// ── CHART.JS LOADER HOOK ──
function useChartJS() {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    if ((window as any).Chart) { setReady(true); return }
    const s = document.createElement('script')
    s.src = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js'
    s.onload = () => setReady(true)
    document.head.appendChild(s)
  }, [])
  return ready
}

export default function V15rIncomeCalc() {
  const backup = getBackupData()
  if (!backup) return <NoData />

  const calcRefs = backup.calcRefs || {}
  const [, forceUpdate] = useState({})
  const chartReady = useChartJS()

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
  const batteryRmoPerSys = batteryAdderAvg * (num(calcRefs.batteryRmoFeePct) / 100)
  const panelUpgradeRmoPerSys = panelUpgradeAdderAvg * (num(calcRefs.panelUpgradeRmoFeePct) / 100)
  const rmoPerSys = baseRmoPerSys + batteryRmoPerSys + panelUpgradeRmoPerSys
  const monthlyBasePerSys = monthlyBaseFee / Math.max(1, panelsPerSystem)
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

  const revenueStreamData = useMemo(() => {
    const months = Array.from({ length: 12 }, (_, i) => {
      const monthNum = i + 1
      return {
        month: monthNum,
        electrical: electricalPipelineTotal / 12,
        rmo: rmoMonthly,
        installLabor: installMonthly,
        employeeCost: empTotalMonthly,
        total: (electricalPipelineTotal / 12) + rmoMonthly + installMonthly
      }
    })
    return months
  }, [electricalPipelineTotal, rmoMonthly, installMonthly, empTotalMonthly])

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
            <InputField label="Battery Fee Add-On $" value={batteryFeePerSystem} onChange={(v) => updateField('batteryFeePerSystem', v)} />
            <InputField label="Panel Upgrade Fee $" value={panelUpgradeFeePerSystem} onChange={(v) => updateField('panelUpgradeFeePerSystem', v)} />
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
                  <MetricLine label="RMO Fee" value={`$${baseRmoPerSys.toFixed(0)}`} green />
                  <MetricLine label="Monthly Base Fee" value={`$${monthlyBasePerSys.toFixed(0)}`} green />
                  <MetricLine label="Battery Fee (Wtd)" value={`$${(batteryFeePerSystem * (batteryAttachPct / 100)).toFixed(0)}`} green />
                  <MetricLine label="Panel Upgrade (Wtd)" value={`$${(panelUpgradeFeePerSystem * (panelUpgradeAttachPct / 100)).toFixed(0)}`} green />
                  <div className="border-t border-gray-600 pt-2 mt-2">
                    <MetricLine label="Total/System" value={`$${rmoRevenuePerSystemTotal.toFixed(0)}`} green bold />
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
          {chartReady && (
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
              <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-4 space-y-2">
                <h4 className="text-sm font-medium text-cyan-400">RMO — Power On Solutions LLC</h4>
                <p className="text-2xl font-bold text-white">{fmtK(rmoMonthly)}</p>
                <p className="text-xs text-gray-400">RMO oversight fee income</p>
                <div className="text-xs text-gray-500 space-y-1 mt-3 pt-2 border-t border-gray-700">
                  <div>Fee per system: {fmtK(rmoPerSys)} × {totalProjectsPerMonth} systems = {fmtK(rmoPerSys * totalProjectsPerMonth)}</div>
                  <div>Monthly base: {fmtK(monthlyBaseFee)}</div>
                  <div>RMO visits: {fmtK(rmoVisitCost)} × {visitsPerMonth} = {fmtK(rmoVisitCost * visitsPerMonth)}</div>
                </div>
              </div>

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
              <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-4 space-y-2">
                <h4 className="text-sm font-medium text-emerald-400">Electrical Projects — Monthly Net</h4>
                <p className="text-2xl font-bold text-white">{fmtK(revenueStreams.projMonthlyNet)}</p>
                <p className="text-xs text-gray-400">Paid electrical projects (3mo average)</p>
                <div className="text-xs text-gray-500 space-y-1 mt-3 pt-2 border-t border-gray-700">
                  <div>Pipeline total: {fmtK(electricalPipelineTotal)}</div>
                  <div>Active projects: {activeProjects.length}</div>
                </div>
              </div>

              {/* Combined Total */}
              <div className="bg-gray-800/50 border border-emerald-500/30 rounded-xl p-4 flex justify-between items-center">
                <span className="text-sm font-medium text-gray-300">Combined Monthly Revenue</span>
                <span className="text-2xl font-bold text-emerald-400">{fmtK(rmoMonthly + installNetMonthly + revenueStreams.projMonthlyNet)}</span>
              </div>
            </div>
          </div>

          {/* Revenue Stream Stacked Area Chart */}
          {chartReady && (
            <RevenueStreamChart data={revenueStreamData} />
          )}

          {/* Business-Linked Projections Grouped Bar Chart */}
          {chartReady && (
            <BusinessProjectionsChart
              rmoMonthly={rmoMonthly}
              rmoAnnual={rmoAnnual}
              installMonthly={installMonthly}
              installAnnual={installMonthly * 12}
              totalMonthly={totalMonthly}
              totalAnnual={totalAnnual}
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
              At <span className="font-semibold text-emerald-400">{totalProjectsPerMonth} systems/month</span> with <span className="font-semibold text-emerald-400">{batteryAttachPct.toFixed(0)}% battery attach</span> and <span className="font-semibold text-emerald-400">{panelUpgradeAttachPct.toFixed(0)}% panel upgrade</span> rate, projected net monthly revenue is <span className="font-bold text-lg text-emerald-400">{fmtK(totalNetMonthly)}</span>
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
  const canvasRef = useRef(null)
  const chartRef = useRef(null)

  // Outer ring — revenue by job type
  const outerColors = { solar: '#3b82f6', battery: '#8b5cf6', panel: '#14b8a6', batteryPanel: '#f59e0b' }
  // Inner ring — cost ratio
  const innerColors = { rmo: '#22c55e', labor: '#ef4444', margin: '#10b981' }

  const outerSegments = [
    { name: 'Solar Only', pct: solar, color: outerColors.solar, ring: 'outer' },
    { name: 'Battery Only', pct: batteryOnly, color: outerColors.battery, ring: 'outer' },
    { name: 'Panel Upgrade', pct: panel, color: outerColors.panel, ring: 'outer' },
    { name: 'Battery+Panel', pct: batteryPanel, color: outerColors.batteryPanel, ring: 'outer' },
  ]

  const innerSegments = [
    { name: 'RMO Fee', value: Math.max(0, rmoFeeTotal), color: innerColors.rmo, ring: 'inner' },
    { name: 'Install Labor', value: Math.max(0, installLaborTotal), color: innerColors.labor, ring: 'inner' },
    { name: 'Net Margin', value: Math.max(0, netMarginTotal), color: innerColors.margin, ring: 'inner' },
  ]

  useEffect(() => {
    if (!canvasRef.current || !(window as any).Chart) return

    if (chartRef.current) {
      chartRef.current.destroy()
    }

    const ctx = canvasRef.current.getContext('2d')
    if (!ctx) return

    const Chart = (window as any).Chart
    Chart.defaults.color = '#9ca3af'
    Chart.defaults.borderColor = 'rgba(255,255,255,0.05)'

    chartRef.current = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: [
          'Solar Only', 'Battery Only', 'Panel Upgrade', 'Battery+Panel',
          'RMO Fee', 'Install Labor', 'Net Margin'
        ],
        datasets: [
          {
            label: 'Revenue Breakdown',
            data: [solar, batteryOnly, panel, batteryPanel],
            backgroundColor: [outerColors.solar, outerColors.battery, outerColors.panel, outerColors.batteryPanel],
            borderColor: '#1a1d27',
            borderWidth: 2,
            borderRadius: 2,
            offset: [0, 0, 0, 0],
          },
          {
            label: 'Cost Ratio',
            data: [Math.max(0, rmoFeeTotal), Math.max(0, installLaborTotal), Math.max(0, netMarginTotal)],
            backgroundColor: [innerColors.rmo, innerColors.labor, innerColors.margin],
            borderColor: '#1a1d27',
            borderWidth: 2,
            borderRadius: 2,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        aspectRatio: 1,
        cutout: '35%',
        plugins: {
          legend: {
            position: 'bottom',
            labels: {
              color: '#d1d5db',
              font: { size: 12 },
              padding: 15,
              usePointStyle: true,
            },
          },
          tooltip: {
            backgroundColor: '#374151',
            titleColor: '#f0f0ff',
            bodyColor: '#e5e7eb',
            borderColor: '#4b5563',
            borderWidth: 1,
            padding: 10,
            titleFont: { weight: 'bold' },
            callbacks: {
              label: (context) => {
                const datasetIdx = context.datasetIndex
                const value = context.parsed
                if (datasetIdx === 0) {
                  return `${context.label}: ${value.toFixed(1)}%`
                } else {
                  return `${context.label}: ${fmtK(value)}`
                }
              },
            },
          },
        },
      },
    })

    return () => {
      if (chartRef.current) {
        chartRef.current.destroy()
        chartRef.current = null
      }
    }
  }, [solar, panel, batteryPanel, batteryOnly, rmoFeeTotal, installLaborTotal, netMarginTotal])

  return (
    <div className="bg-[#232738] rounded-lg p-4">
      <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-4">Job Mix Distribution</h3>

      <div className="flex items-center justify-center">
        <div style={{ position: 'relative', maxWidth: '320px', maxHeight: '320px', width: '100%' }}>
          <canvas ref={canvasRef} style={{ width: '100%', height: '100%' }} />
        </div>
      </div>

      {/* Segment Breakdown Legend — matches Business Health Overview format */}
      <div className="space-y-4 border-t border-gray-600 pt-4">
        {/* Outer Ring */}
        <div>
          <p className="text-xs font-semibold text-gray-400 mb-2 uppercase">Revenue by Job Type (Outer Ring)</p>
          <div className="space-y-1">
            {outerSegments.map((seg) => (
              <div key={seg.name} className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-3">
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: seg.color }}></div>
                  <span className="text-gray-300">{seg.name}</span>
                </div>
                <span className="text-gray-300">{seg.pct.toFixed(1)}%</span>
              </div>
            ))}
          </div>
        </div>

        {/* Inner Ring */}
        <div>
          <p className="text-xs font-semibold text-gray-400 mb-2 uppercase">Cost Ratio (Inner Ring)</p>
          <div className="space-y-1">
            {innerSegments.map((seg) => (
              <div key={seg.name} className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-3">
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: seg.color }}></div>
                  <span className="text-gray-300">{seg.name}</span>
                </div>
                <span className="text-gray-300">{fmtK(seg.value)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

// Revenue Stream Stacked Area Chart
function RevenueStreamChart({ data }) {
  const canvasRef = useRef(null)
  const chartRef = useRef(null)

  useEffect(() => {
    if (!canvasRef.current || !(window as any).Chart) return

    if (chartRef.current) {
      chartRef.current.destroy()
    }

    const ctx = canvasRef.current.getContext('2d')
    if (!ctx) return

    const Chart = (window as any).Chart
    Chart.defaults.color = '#9ca3af'

    chartRef.current = new Chart(ctx, {
      type: 'line',
      data: {
        labels: data.map(d => `Month ${d.month}`),
        datasets: [
          {
            label: 'Electrical Pipeline Revenue',
            data: data.map(d => d.electrical),
            backgroundColor: 'rgba(16, 185, 129, 0.3)',
            borderColor: '#10b981',
            borderWidth: 2,
            fill: true,
            tension: 0.4,
            pointRadius: 4,
            pointBackgroundColor: '#10b981'
          },
          {
            label: 'RMO Revenue',
            data: data.map(d => d.rmo),
            backgroundColor: 'rgba(52, 211, 153, 0.3)',
            borderColor: '#34d399',
            borderWidth: 2,
            fill: true,
            tension: 0.4,
            pointRadius: 4,
            pointBackgroundColor: '#34d399'
          },
          {
            label: 'Installation Labor Revenue',
            data: data.map(d => d.installLabor),
            backgroundColor: 'rgba(234, 179, 8, 0.3)',
            borderColor: '#eab308',
            borderWidth: 2,
            fill: true,
            tension: 0.4,
            pointRadius: 4,
            pointBackgroundColor: '#eab308'
          },
          ...(data[0]?.employeeCost > 0 ? [{
            label: 'Employee Cost',
            data: data.map(d => d.employeeCost),
            backgroundColor: 'rgba(239, 68, 68, 0.3)',
            borderColor: '#ef4444',
            borderWidth: 2,
            fill: true,
            tension: 0.4,
            pointRadius: 4,
            pointBackgroundColor: '#ef4444',
            borderDash: [5, 5]
          }] : []),
          {
            label: 'Combined Total',
            data: data.map(d => d.total),
            backgroundColor: 'rgba(255, 255, 255, 0)',
            borderColor: '#ffffff',
            borderWidth: 3,
            fill: false,
            tension: 0.4,
            pointRadius: 5,
            pointBackgroundColor: '#ffffff'
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            labels: { color: '#9ca3af', padding: 15, font: { size: 12 } }
          },
          tooltip: {
            mode: 'index',
            intersect: false,
            callbacks: {
              label: function(context) {
                const val = context.parsed.y
                return context.dataset.label + ': $' + val.toLocaleString('en-US', { maximumFractionDigits: 0 })
              }
            }
          }
        },
        scales: {
          y: {
            beginAtZero: true,
            grid: { color: 'rgba(255,255,255,0.05)' },
            ticks: {
              color: '#9ca3af',
              callback: (v) => '$' + (v / 1000).toFixed(0) + 'k'
            }
          },
          x: {
            grid: { display: false },
            ticks: { color: '#9ca3af' }
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
  }, [data])

  return (
    <div className="bg-[#232738] rounded-lg p-4">
      <h3 className="text-sm font-semibold text-gray-200 uppercase mb-4">Electrical Pipeline & Revenue Projection</h3>
      <div style={{ height: '300px' }}>
        <canvas ref={canvasRef} style={{ width: '100%', height: '100%' }} />
      </div>
    </div>
  )
}

// Business Projections Grouped Bar Chart
function BusinessProjectionsChart({
  rmoMonthly,
  rmoAnnual,
  installMonthly,
  installAnnual,
  totalMonthly,
  totalAnnual
}) {
  const canvasRef = useRef(null)
  const chartRef = useRef(null)
  const backup = getBackupData()
  const activeProjects = (backup?.projects || []).filter(p => resolveProjectBucket(p) === 'active')
  const electricalPipelineTotal = activeProjects.reduce((s, p) => s + num(p.contract), 0)

  useEffect(() => {
    if (!canvasRef.current || !(window as any).Chart) return

    if (chartRef.current) {
      chartRef.current.destroy()
    }

    const ctx = canvasRef.current.getContext('2d')
    if (!ctx) return

    const Chart = (window as any).Chart
    Chart.defaults.color = '#9ca3af'

    const electricalMonthly = electricalPipelineTotal / 12

    chartRef.current = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: ['Monthly', 'Annual (monthly equiv)', '5-Year (monthly equiv)'],
        datasets: [
          {
            label: 'Electrical Pipeline',
            data: [electricalMonthly, electricalMonthly, electricalMonthly],
            backgroundColor: '#3b82f6',
            borderColor: '#1d4ed8',
            borderWidth: 1
          },
          {
            label: 'RMO Revenue',
            data: [rmoMonthly, rmoAnnual / 12, (rmoAnnual / 12) * 5],
            backgroundColor: '#10b981',
            borderColor: '#059669',
            borderWidth: 1
          },
          {
            label: 'Install Labor Revenue',
            data: [installMonthly, installAnnual / 12, (installAnnual / 12) * 5],
            backgroundColor: '#eab308',
            borderColor: '#ca8a04',
            borderWidth: 1
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            labels: { color: '#9ca3af', padding: 15, font: { size: 12 } }
          },
          tooltip: {
            mode: 'index',
            intersect: false,
            callbacks: {
              label: function(context) {
                const val = context.parsed.y
                const label = context.dataset.label
                return label + ': $' + val.toLocaleString('en-US', { maximumFractionDigits: 0 })
              }
            }
          }
        },
        scales: {
          y: {
            beginAtZero: true,
            grid: { color: 'rgba(255,255,255,0.05)' },
            ticks: {
              color: '#9ca3af',
              callback: (v) => '$' + (v / 1000).toFixed(0) + 'k'
            }
          },
          x: {
            grid: { display: false },
            ticks: { color: '#9ca3af' }
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
  }, [rmoMonthly, rmoAnnual, installMonthly, installAnnual, totalMonthly, totalAnnual, electricalPipelineTotal])

  return (
    <div className="bg-[#232738] rounded-lg p-4">
      <h3 className="text-sm font-semibold text-gray-200 uppercase mb-4">Business-Linked Projections</h3>
      <div style={{ height: '300px' }}>
        <canvas ref={canvasRef} style={{ width: '100%', height: '100%' }} />
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
