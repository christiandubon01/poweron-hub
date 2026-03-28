// @ts-nocheck
import React, { useState, useCallback } from 'react'
import { Sparkles } from 'lucide-react'
import { getBackupData, saveBackupData, num, fmt, fmtK, pct, getPhaseWeights } from '@/services/backupDataService'
import { pushState } from '@/services/undoRedoService'
import { AskAIButton, AskAIPanel } from './AskAIPanel'
import type { Insight } from './AskAIPanel'

interface V15rEstimateTabProps {
  projectId: string
  onUpdate?: () => void
  backup?: any
}

export default function V15rEstimateTab({ projectId, onUpdate, backup: initialBackup }: V15rEstimateTabProps) {
  const [, setTick] = useState(0)
  const forceUpdate = useCallback(() => setTick(t => t + 1), [])
  const [subtab, setSubtab] = useState<'project' | 'service'>('project')
  const [aiOpen, setAiOpen] = useState(false)

  // Service Call form state
  const [scCust, setScCust] = useState('')
  const [scAddr, setScAddr] = useState('')
  const [scJtype, setScJtype] = useState('GFCI / Receptacles')
  const [scDate, setScDate] = useState(new Date().toISOString().slice(0, 10))
  const [scHrs, setScHrs] = useState('')
  const [scRate, setScRate] = useState(num(backup.settings?.billRate || 65))
  const [scMat, setScMat] = useState('')
  const [scMiles, setScMiles] = useState('')
  const [scTax, setScTax] = useState(num(backup.settings?.tax || 0))
  const [scNotes, setScNotes] = useState('')

  const backup = initialBackup || getBackupData()
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

  function saveAsServiceLead() {
    pushState()
    if (!backup.serviceLeads) backup.serviceLeads = []
    backup.serviceLeads.push({
      id: 'slead' + Date.now(),
      customer: scCust || 'Unknown',
      address: scAddr,
      jtype: scJtype,
      estHours: scHrsN,
      estMaterials: scMatN,
      estMileage: scMilesN,
      estQuote: +scQuoted.toFixed(2),
      notes: scNotes,
      status: 'estimate_pending',
      createdAt: new Date().toISOString().slice(0, 10),
    })
    saveBackupData(backup)
    forceUpdate()
    alert('Saved as Service Lead')
    setScCust(''); setScAddr(''); setScDate(new Date().toISOString().slice(0, 10)); setScHrs(''); setScRate(num(backup.settings?.billRate || 65)); setScMat(''); setScMiles(''); setScTax(num(backup.settings?.tax || 0)); setScNotes('')
  }

  function convertToServiceLog() {
    pushState()
    if (!backup.serviceLogs) backup.serviceLogs = []
    backup.serviceLogs.push({
      id: 'svc' + Date.now(),
      date: new Date().toISOString().slice(0, 10),
      customer: scCust || 'Unknown',
      address: scAddr,
      jtype: scJtype,
      hrs: scHrsN,
      miles: scMilesN,
      quoted: +scQuoted.toFixed(2),
      mat: scMatN,
      collected: 0,
      payStatus: 'N',
      balanceDue: +scQuoted.toFixed(2),
      store: '',
      notes: scNotes,
      adjustments: [],
    })
    saveBackupData(backup)
    forceUpdate()
    alert('Converted to Service Log entry')
    setScCust(''); setScAddr(''); setScDate(new Date().toISOString().slice(0, 10)); setScHrs(''); setScRate(num(backup.settings?.billRate || 65)); setScMat(''); setScMiles(''); setScTax(num(backup.settings?.tax || 0)); setScNotes('')
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

  return (
    <div style={{ backgroundColor: '#1a1d27', padding: '0' }}>
      {/* SUBTAB BAR */}
      <div style={{ display: 'flex', gap: '2px', marginBottom: '16px', backgroundColor: '#0f1117', borderRadius: '8px', padding: '3px', alignItems: 'center' }}>
        <button
          onClick={() => setSubtab('project')}
          style={{
            flex: 1,
            padding: '8px 12px',
            fontSize: '13px',
            fontWeight: '600',
            borderRadius: '6px',
            border: 'none',
            cursor: 'pointer',
            backgroundColor: subtab === 'project' ? 'rgba(16,185,129,0.3)' : 'transparent',
            color: subtab === 'project' ? '#fff' : '#9ca3af',
          }}
        >
          Project Estimate
        </button>
        <button
          onClick={() => setSubtab('service')}
          style={{
            flex: 1,
            padding: '8px 12px',
            fontSize: '13px',
            fontWeight: '600',
            borderRadius: '6px',
            border: 'none',
            cursor: 'pointer',
            backgroundColor: subtab === 'service' ? 'rgba(234,179,8,0.3)' : 'transparent',
            color: subtab === 'service' ? '#fff' : '#9ca3af',
          }}
        >
          Service Call Estimate
        </button>
        <div style={{ marginLeft: 'auto', paddingRight: '8px' }}>
          <AskAIButton onClick={() => setAiOpen(true)} />
        </div>
      </div>

      {/* SERVICE CALL ESTIMATE SUBTAB */}
      {subtab === 'service' && (
        <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
          <div style={{ backgroundColor: '#232738', borderRadius: '8px', padding: '16px', marginBottom: '16px' }}>
            <h3 style={{ color: 'var(--t1)', fontWeight: '600', margin: '0 0 16px 0', fontSize: '15px' }}>Service Call Quick Estimate</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '10px', color: 'var(--t3)', marginBottom: '4px', fontWeight: '600', textTransform: 'uppercase' }}>Customer</label>
                <input value={scCust} onChange={e => setScCust(e.target.value)} style={{ width: '100%', padding: '6px 8px', backgroundColor: '#1e2130', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '4px', color: 'var(--t1)', fontSize: '13px' }} />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '10px', color: 'var(--t3)', marginBottom: '4px', fontWeight: '600', textTransform: 'uppercase' }}>Address</label>
                <input value={scAddr} onChange={e => setScAddr(e.target.value)} style={{ width: '100%', padding: '6px 8px', backgroundColor: '#1e2130', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '4px', color: 'var(--t1)', fontSize: '13px' }} />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '10px', color: 'var(--t3)', marginBottom: '4px', fontWeight: '600', textTransform: 'uppercase' }}>Date</label>
                <input type="date" value={scDate} onChange={e => setScDate(e.target.value)} style={{ width: '100%', padding: '6px 8px', backgroundColor: '#1e2130', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '4px', color: 'var(--t1)', fontSize: '13px' }} />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '10px', color: 'var(--t3)', marginBottom: '4px', fontWeight: '600', textTransform: 'uppercase' }}>Job Type</label>
                <select value={scJtype} onChange={e => setScJtype(e.target.value)} style={{ width: '100%', padding: '6px 8px', backgroundColor: '#1e2130', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '4px', color: 'var(--t1)', fontSize: '13px' }}>
                  {SVC_JOB_TYPES.map(jt => <option key={jt} value={jt}>{jt}</option>)}
                </select>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '10px', color: 'var(--t3)', marginBottom: '4px', fontWeight: '600', textTransform: 'uppercase' }}>Est. Hours</label>
                <input type="number" step="0.5" value={scHrs} onChange={e => setScHrs(e.target.value)} style={{ width: '100%', padding: '6px 8px', backgroundColor: '#1e2130', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '4px', color: 'var(--t1)', fontSize: '13px', fontFamily: 'monospace' }} />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '10px', color: 'var(--t3)', marginBottom: '4px', fontWeight: '600', textTransform: 'uppercase' }}>Hourly Rate $</label>
                <input type="number" step="0.01" value={scRate} onChange={e => setScRate(e.target.value)} style={{ width: '100%', padding: '6px 8px', backgroundColor: '#1e2130', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '4px', color: 'var(--t1)', fontSize: '13px', fontFamily: 'monospace' }} />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '10px', color: 'var(--t3)', marginBottom: '4px', fontWeight: '600', textTransform: 'uppercase' }}>Materials $</label>
                <input type="number" step="0.01" value={scMat} onChange={e => setScMat(e.target.value)} style={{ width: '100%', padding: '6px 8px', backgroundColor: '#1e2130', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '4px', color: 'var(--t1)', fontSize: '13px', fontFamily: 'monospace' }} />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '10px', color: 'var(--t3)', marginBottom: '4px', fontWeight: '600', textTransform: 'uppercase' }}>Miles RT</label>
                <input type="number" value={scMiles} onChange={e => setScMiles(e.target.value)} style={{ width: '100%', padding: '6px 8px', backgroundColor: '#1e2130', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '4px', color: 'var(--t1)', fontSize: '13px', fontFamily: 'monospace' }} />
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
          </div>

          {/* LIVE QUOTE CALC */}
          <div style={{ backgroundColor: '#232738', borderRadius: '8px', padding: '16px', marginBottom: '16px', borderLeft: '3px solid #eab308' }}>
            <h4 style={{ color: 'var(--t1)', fontWeight: '600', margin: '0 0 12px 0', fontSize: '14px' }}>Calculation Breakdown</h4>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontSize: '13px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
                <span style={{ color: 'var(--t3)' }}>Labor ({scHrsN}h × ${scRateN})</span>
                <span style={{ fontFamily: 'monospace', color: 'var(--t1)' }}>{fmt(scLaborQuote)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
                <span style={{ color: 'var(--t3)' }}>Materials</span>
                <span style={{ fontFamily: 'monospace', color: 'var(--t1)' }}>{fmt(scMatN)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
                <span style={{ color: 'var(--t3)' }}>Mileage ({scMilesN}mi × ${mileRate})</span>
                <span style={{ fontFamily: 'monospace', color: 'var(--t1)' }}>{fmt(scMileCost)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
                <span style={{ color: 'var(--t3)' }}>Tax ({scTaxN}%)</span>
                <span style={{ fontFamily: 'monospace', color: 'var(--t1)' }}>{fmt(scMaterialsTax)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid var(--bdr2)' }}>
                <span style={{ color: 'var(--t3)', fontWeight: '600' }}>Subtotal</span>
                <span style={{ fontFamily: 'monospace', color: 'var(--t1)', fontWeight: '600' }}>{fmt(scSubtotal)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
                <span style={{ color: 'var(--t3)' }}>Markup ({Math.round(scMarkup * 100)}%)</span>
                <span style={{ fontFamily: 'monospace', color: 'var(--t1)' }}>{fmt(scSubtotal * scMarkup)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderTop: '1px solid var(--bdr2)', marginTop: '8px' }}>
              <span style={{ color: 'var(--t1)', fontWeight: '700', fontSize: '15px' }}>Quoted Total</span>
              <span style={{ fontFamily: 'monospace', color: '#eab308', fontWeight: '700', fontSize: '18px' }}>{fmt(scQuoted)}</span>
            </div>
            <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid var(--bdr2)' }}>
              <h4 style={{ color: 'var(--t1)', fontWeight: '600', margin: '0 0 8px 0', fontSize: '13px' }}>Profit Analysis</h4>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: '13px' }}>
                <span style={{ color: 'var(--t3)' }}>Internal Cost ({scHrsN}h × ${opRate} + mat + miles)</span>
                <span style={{ fontFamily: 'monospace', color: 'var(--t1)' }}>{fmt(scInternalCost)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
                <span style={{ color: 'var(--t3)', fontWeight: '600' }}>Projected Profit</span>
                <span style={{ fontFamily: 'monospace', color: scProfit >= 0 ? '#10b981' : '#ef4444', fontWeight: '700' }}>{fmt(scProfit)}</span>
              </div>
            </div>
          </div>

          {/* ACTION BUTTONS */}
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <button
              onClick={saveAsServiceLead}
              style={{
                padding: '10px 16px',
                backgroundColor: 'rgba(59,130,246,0.2)',
                color: '#3b82f6',
                border: '1px solid rgba(59,130,246,0.3)',
                borderRadius: '6px',
                fontSize: '13px',
                fontWeight: '600',
                cursor: 'pointer',
              }}
            >
              Save as Service Lead
            </button>
            <button
              onClick={convertToServiceLog}
              style={{
                padding: '10px 16px',
                backgroundColor: 'rgba(249,115,22,0.2)',
                color: '#f97316',
                border: '1px solid rgba(249,115,22,0.3)',
                borderRadius: '6px',
                fontSize: '13px',
                fontWeight: '600',
                cursor: 'pointer',
              }}
            >
              Convert to Service Log
            </button>
          </div>
        </div>
      )}

      {/* PROJECT ESTIMATE SUBTAB (existing content) */}
      {subtab === 'project' && (
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
                        <input
                          type="text"
                          value={r.desc || ''}
                          onChange={e => editLaborRow(r.id, 'desc', e.target.value)}
                          style={{
                            background: 'transparent',
                            border: 'none',
                            color: 'var(--t1)',
                            width: '100%',
                            fontSize: '13px',
                          }}
                        />
                      </td>
                      <td style={{ padding: '8px', fontSize: '12px', color: 'var(--t3)' }}>{emp.name}</td>
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

        {/* AI REVIEW BUTTON */}
        <button
          onClick={() => alert('AI Estimate Review placeholder')}
          style={{
            marginTop: '16px',
            padding: '10px 16px',
            backgroundColor: 'rgba(139,92,246,0.2)',
            color: '#a78bfa',
            border: '1px solid rgba(139,92,246,0.3)',
            borderRadius: '6px',
            fontSize: '13px',
            fontWeight: '600',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
          }}
        >
          <Sparkles size={14} />
          AI Estimate Review
        </button>
      </div>
      )}

      <AskAIPanel
        panelName="Estimate"
        insights={generateEstimateInsights()}
        isOpen={aiOpen}
        onClose={() => setAiOpen(false)}
      />
    </div>
  )
}
