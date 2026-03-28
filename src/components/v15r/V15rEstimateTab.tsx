// @ts-nocheck
import React, { useState, useCallback } from 'react'
import { Sparkles, Plus, ArrowRight, Check, Trash2, X } from 'lucide-react'
import { getBackupData, saveBackupData, saveBackupDataAndSync, num, fmt, fmtK, pct, getPhaseWeights } from '@/services/backupDataService'
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
  const [scStore, setScStore] = useState('')
  const [showEstForm, setShowEstForm] = useState(false)
  const [editingEstId, setEditingEstId] = useState<string | null>(null)

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
    backup.serviceLogs.push({
      id: 'svc' + Date.now(),
      date: call.date || new Date().toISOString().slice(0, 10),
      customer: call.customer || 'Unknown',
      address: call.address || '',
      jtype: call.jtype || '',
      hrs: call.estHours || 0,
      miles: call.estMileage || 0,
      quoted: call.quoted || 0,
      mat: call.estMaterials || 0,
      collected: 0,
      payStatus: 'N',
      balanceDue: call.quoted || 0,
      store: call.store || '',
      notes: call.notes || '',
      adjustments: [],
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
