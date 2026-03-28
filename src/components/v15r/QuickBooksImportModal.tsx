// @ts-nocheck
/**
 * QuickBooksImportModal — Shared modal for QuickBooks PDF import
 *
 * Used in:
 *  - Field Log → Service Log tab (for service invoices)
 *  - Projects panel → New Project from Estimate (for project estimates)
 *
 * Flow: User uploads PDF → Claude extracts data → pre-filled form shown → user confirms → saved
 * CRITICAL: Never auto-saves. User must click "Save to App" to confirm.
 */

import { useState, useRef } from 'react'
import { Upload, FileText, Check, X, ChevronDown, ChevronUp, Loader2, AlertCircle } from 'lucide-react'
import {
  extractFromPDF,
  mapToServiceLog,
  mapToProject,
  logImport,
  type QBExtractedData,
} from '@/services/quickbooksImportService'
import { getBackupData, saveBackupData, num, fmt } from '@/services/backupDataService'
import { pushState } from '@/services/undoRedoService'

// ── Types ────────────────────────────────────────────────────────────────────

interface QuickBooksImportModalProps {
  mode: 'service' | 'project'
  onClose: () => void
  onImported: () => void
}

// ── Component ────────────────────────────────────────────────────────────────

export default function QuickBooksImportModal({ mode, onClose, onImported }: QuickBooksImportModalProps) {
  const [step, setStep] = useState<'upload' | 'extracting' | 'review' | 'error'>('upload')
  const [extracted, setExtracted] = useState<QBExtractedData | null>(null)
  const [error, setError] = useState('')
  const [showRawJson, setShowRawJson] = useState(false)
  const [filename, setFilename] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Editable pre-filled fields (service mode)
  const [sCustomer, setSCustomer] = useState('')
  const [sAddress, setSAddress] = useState('')
  const [sDate, setSDate] = useState('')
  const [sQuoted, setSQuoted] = useState('')
  const [sCollected, setSCollected] = useState('')
  const [sPayStatus, setSPayStatus] = useState('N')
  const [sJobType, setSJobType] = useState('Other')
  const [sNotes, setSNotes] = useState('')

  // Editable pre-filled fields (project mode)
  const [pName, setPName] = useState('')
  const [pContract, setPContract] = useState('')
  const [pType, setPType] = useState('service')
  const [pScope, setPScope] = useState('')

  const JOB_TYPES = [
    'GFCI / Receptacles', 'Panel / Service', 'Troubleshoot', 'Lighting',
    'EV Charger', 'Low Voltage', 'Circuit Add/Replace', 'Switches / Dimmers',
    'Warranty', 'Other'
  ]

  // ── Handle file selection ──────────────────────────────────────────────────

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    if (!file.name.toLowerCase().endsWith('.pdf')) {
      setError('Please select a PDF file')
      setStep('error')
      return
    }

    setFilename(file.name)
    setStep('extracting')
    setError('')

    try {
      const data = await extractFromPDF(file)
      setExtracted(data)

      // Pre-fill fields based on mode
      if (mode === 'service') {
        const mapped = mapToServiceLog(data)
        setSCustomer(mapped.customer || '')
        setSAddress(mapped.address || '')
        setSDate(mapped.date || '')
        setSQuoted(String(mapped.quoted || 0))
        setSCollected(String(mapped.collected || 0))
        setSPayStatus(mapped.payStatus || 'N')
        setSJobType(mapped.jtype || 'Other')
        setSNotes(mapped.notes || '')
      } else {
        const mapped = mapToProject(data)
        setPName(mapped.name || '')
        setPContract(String(mapped.contract || 0))
        setPType(mapped.type || 'service')
        setPScope(mapped.scopeNotes || '')
      }

      setStep('review')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setStep('error')
    }
  }

  // ── Save to app ────────────────────────────────────────────────────────────

  function handleSaveToApp() {
    const backup = getBackupData()
    if (!backup) return

    pushState()

    if (mode === 'service') {
      const entry = {
        id: 'svc' + Date.now() + Math.random().toString(36).slice(2, 6),
        date: sDate || new Date().toISOString().slice(0, 10),
        customer: sCustomer || 'Unknown',
        address: sAddress,
        jtype: sJobType,
        hrs: 0,
        miles: 0,
        quoted: parseFloat(sQuoted) || 0,
        mat: 0,
        collected: parseFloat(sCollected) || 0,
        payStatus: sPayStatus,
        balanceDue: Math.max(0, (parseFloat(sQuoted) || 0) - (parseFloat(sCollected) || 0)),
        store: '',
        notes: sNotes,
        adjustments: [],
        source: 'quickbooks_import',
      }
      if (!backup.serviceLogs) backup.serviceLogs = []
      backup.serviceLogs.push(entry)

      logImport(backup, 'pdf', filename, 1, 'invoice', sCustomer, parseFloat(sQuoted) || 0)
    } else {
      const project = {
        id: 'proj' + Date.now() + Math.random().toString(36).slice(2, 6),
        name: pName || 'Imported Project',
        type: pType,
        status: 'coming',
        contract: parseFloat(pContract) || 0,
        billed: 0,
        paid: 0,
        mileRT: 30,
        miDays: 0,
        phases: {},
        logs: [],
        finance: {},
        rfis: [],
        coord: {},
        tasks: {},
        ohRows: [],
        matRows: [],
        mtoRows: [],
        laborRows: [],
        lastMove: new Date().toISOString().slice(0, 10),
        scopeNotes: pScope,
        source: 'quickbooks_import',
      }
      if (!backup.projects) backup.projects = []
      backup.projects.push(project)

      logImport(backup, 'pdf', filename, 1, 'estimate', pName, parseFloat(pContract) || 0)
    }

    backup._lastSavedAt = new Date().toISOString()
    saveBackupData(backup)
    onImported()
    onClose()
  }

  // ── Render helpers ─────────────────────────────────────────────────────────

  const modalBg = {
    position: 'fixed' as const,
    inset: 0,
    zIndex: 9999,
    backgroundColor: 'rgba(0,0,0,0.7)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '16px',
  }

  const modalBox = {
    backgroundColor: '#1a1d27',
    borderRadius: '12px',
    border: '1px solid rgba(255,255,255,0.1)',
    maxWidth: '640px',
    width: '100%',
    maxHeight: '85vh',
    overflowY: 'auto' as const,
    padding: '24px',
  }

  const inputStyle = {
    width: '100%',
    padding: '6px 8px',
    backgroundColor: '#1e2130',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '4px',
    color: '#e5e7eb',
    fontSize: '13px',
  }

  const labelStyle = {
    display: 'block',
    fontSize: '10px',
    color: '#9ca3af',
    marginBottom: '4px',
    fontWeight: '600' as const,
    textTransform: 'uppercase' as const,
  }

  // ── UPLOAD STEP ────────────────────────────────────────────────────────────

  if (step === 'upload') {
    return (
      <div style={modalBg} onClick={onClose}>
        <div style={modalBox} onClick={e => e.stopPropagation()}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
            <h3 style={{ color: '#e5e7eb', fontWeight: '700', fontSize: '16px', margin: 0 }}>
              Import from QuickBooks PDF
            </h3>
            <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#9ca3af', cursor: 'pointer' }}>
              <X size={18} />
            </button>
          </div>

          <div
            style={{
              border: '2px dashed rgba(99,102,241,0.4)',
              borderRadius: '8px',
              padding: '40px 20px',
              textAlign: 'center',
              cursor: 'pointer',
              transition: 'border-color 0.2s',
            }}
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload size={32} style={{ color: '#6366f1', margin: '0 auto 12px' }} />
            <p style={{ color: '#e5e7eb', fontWeight: '600', margin: '0 0 6px 0' }}>
              Click to select a QuickBooks PDF
            </p>
            <p style={{ color: '#6b7280', fontSize: '12px', margin: 0 }}>
              {mode === 'service' ? 'Invoice PDF → pre-fill Service Log entry' : 'Estimate PDF → pre-fill New Project'}
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf"
              onChange={handleFileSelect}
              style={{ display: 'none' }}
            />
          </div>
        </div>
      </div>
    )
  }

  // ── EXTRACTING STEP ────────────────────────────────────────────────────────

  if (step === 'extracting') {
    return (
      <div style={modalBg}>
        <div style={modalBox}>
          <div style={{ textAlign: 'center', padding: '40px 20px' }}>
            <Loader2 size={40} style={{ color: '#6366f1', margin: '0 auto 16px', animation: 'spin 1s linear infinite' }} />
            <p style={{ color: '#e5e7eb', fontWeight: '600', margin: '0 0 6px 0' }}>Extracting data from PDF...</p>
            <p style={{ color: '#6b7280', fontSize: '12px', margin: 0 }}>{filename}</p>
            <p style={{ color: '#6b7280', fontSize: '11px', margin: '8px 0 0 0' }}>
              Sending to Claude API for intelligent extraction
            </p>
          </div>
          <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
        </div>
      </div>
    )
  }

  // ── ERROR STEP ─────────────────────────────────────────────────────────────

  if (step === 'error') {
    return (
      <div style={modalBg} onClick={onClose}>
        <div style={modalBox} onClick={e => e.stopPropagation()}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
            <h3 style={{ color: '#ef4444', fontWeight: '700', fontSize: '16px', margin: 0 }}>
              Import Error
            </h3>
            <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#9ca3af', cursor: 'pointer' }}>
              <X size={18} />
            </button>
          </div>
          <div style={{ backgroundColor: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '8px', padding: '16px' }}>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
              <AlertCircle size={16} style={{ color: '#ef4444', flexShrink: 0, marginTop: '2px' }} />
              <p style={{ color: '#fca5a5', fontSize: '13px', margin: 0, wordBreak: 'break-word' }}>{error}</p>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px', marginTop: '16px' }}>
            <button
              onClick={() => { setStep('upload'); setError('') }}
              style={{
                padding: '8px 16px',
                backgroundColor: 'rgba(99,102,241,0.2)',
                color: '#818cf8',
                border: '1px solid rgba(99,102,241,0.3)',
                borderRadius: '6px',
                fontSize: '13px',
                fontWeight: '600',
                cursor: 'pointer',
              }}
            >
              Try Again
            </button>
            <button
              onClick={onClose}
              style={{
                padding: '8px 16px',
                backgroundColor: '#232738',
                color: '#9ca3af',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: '6px',
                fontSize: '13px',
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ── REVIEW STEP (service mode) ─────────────────────────────────────────────

  if (step === 'review' && mode === 'service') {
    return (
      <div style={modalBg}>
        <div style={modalBox} onClick={e => e.stopPropagation()}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
            <div>
              <h3 style={{ color: '#e5e7eb', fontWeight: '700', fontSize: '16px', margin: 0 }}>
                Review Extracted Invoice
              </h3>
              <p style={{ color: '#6b7280', fontSize: '11px', margin: '4px 0 0 0' }}>
                <FileText size={10} style={{ display: 'inline', verticalAlign: 'middle' }} /> {filename}
              </p>
            </div>
            <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#9ca3af', cursor: 'pointer' }}>
              <X size={18} />
            </button>
          </div>

          {/* Pre-filled form */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '16px' }}>
            <div>
              <label style={labelStyle}>Customer Name</label>
              <input value={sCustomer} onChange={e => setSCustomer(e.target.value)} style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>Address</label>
              <input value={sAddress} onChange={e => setSAddress(e.target.value)} style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>Date</label>
              <input type="date" value={sDate} onChange={e => setSDate(e.target.value)} style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>Job Type</label>
              <select value={sJobType} onChange={e => setSJobType(e.target.value)} style={inputStyle}>
                {JOB_TYPES.map(jt => <option key={jt} value={jt}>{jt}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Total Quoted</label>
              <input type="number" step="0.01" value={sQuoted} onChange={e => setSQuoted(e.target.value)} style={{ ...inputStyle, fontFamily: 'monospace' }} />
            </div>
            <div>
              <label style={labelStyle}>Payment Collected</label>
              <input type="number" step="0.01" value={sCollected} onChange={e => setSCollected(e.target.value)} style={{ ...inputStyle, fontFamily: 'monospace' }} />
            </div>
            <div>
              <label style={labelStyle}>Payment Status</label>
              <select value={sPayStatus} onChange={e => setSPayStatus(e.target.value)} style={inputStyle}>
                <option value="Y">Paid in Full</option>
                <option value="P">Partial</option>
                <option value="N">Unpaid</option>
              </select>
            </div>
          </div>
          <div style={{ marginBottom: '16px' }}>
            <label style={labelStyle}>Notes</label>
            <textarea value={sNotes} onChange={e => setSNotes(e.target.value)} rows={2} style={{ ...inputStyle, resize: 'none' }} />
          </div>

          {/* Raw JSON collapsible */}
          <div style={{ marginBottom: '16px' }}>
            <button
              onClick={() => setShowRawJson(!showRawJson)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                background: 'none',
                border: 'none',
                color: '#6b7280',
                fontSize: '11px',
                cursor: 'pointer',
                padding: 0,
              }}
            >
              {showRawJson ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
              Show extracted data
            </button>
            {showRawJson && (
              <pre style={{
                marginTop: '8px',
                padding: '12px',
                backgroundColor: '#0f1117',
                borderRadius: '6px',
                fontSize: '10px',
                color: '#9ca3af',
                overflowX: 'auto',
                maxHeight: '200px',
                overflowY: 'auto',
                border: '1px solid rgba(255,255,255,0.05)',
              }}>
                {JSON.stringify(extracted, null, 2)}
              </pre>
            )}
          </div>

          {/* Action buttons */}
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={handleSaveToApp}
              style={{
                flex: 1,
                padding: '10px 16px',
                backgroundColor: 'rgba(16,185,129,0.2)',
                color: '#10b981',
                border: '1px solid rgba(16,185,129,0.3)',
                borderRadius: '6px',
                fontSize: '13px',
                fontWeight: '700',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px',
              }}
            >
              <Check size={14} />
              Save to App
            </button>
            <button
              onClick={onClose}
              style={{
                padding: '10px 16px',
                backgroundColor: '#232738',
                color: '#9ca3af',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: '6px',
                fontSize: '13px',
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ── REVIEW STEP (project mode) ─────────────────────────────────────────────

  if (step === 'review' && mode === 'project') {
    return (
      <div style={modalBg}>
        <div style={modalBox} onClick={e => e.stopPropagation()}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
            <div>
              <h3 style={{ color: '#e5e7eb', fontWeight: '700', fontSize: '16px', margin: 0 }}>
                Review Extracted Estimate
              </h3>
              <p style={{ color: '#6b7280', fontSize: '11px', margin: '4px 0 0 0' }}>
                <FileText size={10} style={{ display: 'inline', verticalAlign: 'middle' }} /> {filename}
              </p>
            </div>
            <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#9ca3af', cursor: 'pointer' }}>
              <X size={18} />
            </button>
          </div>

          {/* Pre-filled form */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '16px' }}>
            <div style={{ gridColumn: 'span 2' }}>
              <label style={labelStyle}>Project Name</label>
              <input value={pName} onChange={e => setPName(e.target.value)} style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>Contract Amount</label>
              <input type="number" step="0.01" value={pContract} onChange={e => setPContract(e.target.value)} style={{ ...inputStyle, fontFamily: 'monospace' }} />
            </div>
            <div>
              <label style={labelStyle}>Project Type</label>
              <select value={pType} onChange={e => setPType(e.target.value)} style={inputStyle}>
                <option value="service">Service</option>
                <option value="commercial">Commercial</option>
                <option value="residential">Residential</option>
                <option value="remodel">Remodel</option>
              </select>
            </div>
          </div>
          <div style={{ marginBottom: '16px' }}>
            <label style={labelStyle}>Scope / Line Items</label>
            <textarea value={pScope} onChange={e => setPScope(e.target.value)} rows={4} style={{ ...inputStyle, resize: 'none', fontSize: '11px' }} />
          </div>

          {/* Raw JSON collapsible */}
          <div style={{ marginBottom: '16px' }}>
            <button
              onClick={() => setShowRawJson(!showRawJson)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                background: 'none',
                border: 'none',
                color: '#6b7280',
                fontSize: '11px',
                cursor: 'pointer',
                padding: 0,
              }}
            >
              {showRawJson ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
              Show extracted data
            </button>
            {showRawJson && (
              <pre style={{
                marginTop: '8px',
                padding: '12px',
                backgroundColor: '#0f1117',
                borderRadius: '6px',
                fontSize: '10px',
                color: '#9ca3af',
                overflowX: 'auto',
                maxHeight: '200px',
                overflowY: 'auto',
                border: '1px solid rgba(255,255,255,0.05)',
              }}>
                {JSON.stringify(extracted, null, 2)}
              </pre>
            )}
          </div>

          {/* Action buttons */}
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={handleSaveToApp}
              style={{
                flex: 1,
                padding: '10px 16px',
                backgroundColor: 'rgba(16,185,129,0.2)',
                color: '#10b981',
                border: '1px solid rgba(16,185,129,0.3)',
                borderRadius: '6px',
                fontSize: '13px',
                fontWeight: '700',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px',
              }}
            >
              <Check size={14} />
              Save to App
            </button>
            <button
              onClick={onClose}
              style={{
                padding: '10px 16px',
                backgroundColor: '#232738',
                color: '#9ca3af',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: '6px',
                fontSize: '13px',
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    )
  }

  return null
}
