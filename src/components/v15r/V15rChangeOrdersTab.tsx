// @ts-nocheck
import React, { useEffect, useRef, useState } from 'react'
import {
  fetchLatestRemoteBackup,
  getBackupData,
  saveBackupData,
  saveBackupDataAndSync,
  saveBackupWithRemoteBaselineSync,
} from '@/services/backupDataService'
import type { ChangeOrder, ChangeOrderStatus } from '@/services/backupDataService'
import {
  createChangeOrderTombstone,
  getLiveChangeOrders,
  mergeProjectChangeOrdersIntoRemote,
} from '@/services/projectScopeMerge'
import { pushState } from '@/services/undoRedoService'
import { useDemoMode } from '@/store/demoStore'

// ── Module-level constants (stable references, never redefined on render) ────

const CO_STATUSES: ChangeOrderStatus[] = [
  'Draft', 'Sent', 'Pending Approval', 'Approved', 'Rejected', 'Completed', 'Invoiced', 'Paid',
]

const DEFAULT_STAGES = [
  'Preconstruction', 'Underground', 'Rough-In', 'Trim', 'Finish', 'Punch', 'Closeout',
]

const APPROVED_STATUSES = new Set(['Approved', 'Completed', 'Paid'])
const EXPOSURE_STATUSES = new Set(['Sent', 'Pending Approval', 'Invoiced'])

const INPUT_STYLE: React.CSSProperties = {
  width: '100%',
  backgroundColor: '#1a1d27',
  border: '1px solid rgba(255,255,255,0.12)',
  borderRadius: '6px',
  padding: '7px 10px',
  color: '#e2e8f0',
  fontSize: '13px',
  outline: 'none',
  boxSizing: 'border-box',
}

const SELECT_STYLE: React.CSSProperties = {
  ...INPUT_STYLE,
  cursor: 'pointer',
  appearance: 'auto' as any,
  backgroundColor: '#1a1d27',
  color: '#e2e8f0',
}

const LABEL_STYLE: React.CSSProperties = {
  display: 'block',
  fontSize: '11px',
  fontWeight: '600',
  color: 'rgba(255,255,255,0.5)',
  marginBottom: '4px',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function isoNow(): string { return new Date().toISOString() }

function localDateTimeValue(iso: string): string {
  try {
    const d = new Date(iso)
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
  } catch { return '' }
}

function blankForm() {
  return {
    title: '', description: '', stage: '', requestedBy: '', approvedBy: '',
    createdAt: localDateTimeValue(isoNow()), approvalAt: '',
    laborCost: '', materialCost: '', totalCost: '',
    permitRelated: false, status: 'Draft' as ChangeOrderStatus,
  }
}

function statusColor(s: ChangeOrderStatus): string {
  const map: Record<string, string> = {
    'Draft': '#94a3b8',
    'Sent': '#60a5fa',
    'Pending Approval': '#fbbf24',
    'Approved': '#34d399',
    'Rejected': '#f87171',
    'Completed': '#a78bfa',
    'Invoiced': '#fb923c',
    'Paid': '#6ee7b7',
  }
  return map[s] || '#94a3b8'
}

function cloneChangeOrders(changeOrders: any[]): ChangeOrder[] {
  return (Array.isArray(changeOrders) ? changeOrders : []).map((co: any) => ({ ...co }))
}

function fmtMoney(n: number): string {
  if (!n && n !== 0) return '—'
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

// ── COForm — MUST be at module level, not inside the main component ───────────
// (Defining it inside would cause unmount/remount on every keystroke → focus loss)

interface COFormProps {
  form: ReturnType<typeof blankForm>
  setForm: (f: ReturnType<typeof blankForm>) => void
  phases: string[]
}

function COForm({ form, setForm, phases }: COFormProps) {
  const stageList = phases.length > 0 ? phases : DEFAULT_STAGES

  const field = (
    label: string,
    key: keyof ReturnType<typeof blankForm>,
    type = 'text',
    placeholder = '',
  ) => (
    <div>
      <label style={LABEL_STYLE}>{label}</label>
      <input
        type={type}
        value={form[key] as string}
        onChange={e => setForm({ ...form, [key]: e.target.value })}
        placeholder={placeholder}
        style={INPUT_STYLE}
      />
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <style>{'.co-select option { background-color: #1a1d27; color: #e2e8f0; }'}</style>

      {field('Title *', 'title', 'text', 'e.g. Add 20A circuit for HVAC')}

      <div>
        <label style={LABEL_STYLE}>Description</label>
        <textarea
          value={form.description}
          onChange={e => setForm({ ...form, description: e.target.value })}
          rows={3}
          placeholder="Scope of work, reason for change..."
          style={{ ...INPUT_STYLE, resize: 'vertical' }}
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
        <div>
          <label style={LABEL_STYLE}>Status</label>
          <select
            className="co-select"
            value={form.status}
            onChange={e => setForm({ ...form, status: e.target.value as ChangeOrderStatus })}
            style={SELECT_STYLE}
          >
            {CO_STATUSES.map(s => (
              <option key={s} value={s} style={{ backgroundColor: '#1a1d27', color: '#e2e8f0' }}>{s}</option>
            ))}
          </select>
        </div>

        <div>
          <label style={LABEL_STYLE}>Stage</label>
          <select
            className="co-select"
            value={form.stage}
            onChange={e => setForm({ ...form, stage: e.target.value })}
            style={SELECT_STYLE}
          >
            <option value="" style={{ backgroundColor: '#1a1d27', color: '#94a3b8' }}>— select stage —</option>
            {stageList.map(s => (
              <option key={s} value={s} style={{ backgroundColor: '#1a1d27', color: '#e2e8f0' }}>{s}</option>
            ))}
          </select>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
        {field('Requested By', 'requestedBy', 'text', 'Name or company')}
        {field('Approved By', 'approvedBy', 'text', 'Name')}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
        <div>
          <label style={LABEL_STYLE}>Created Date</label>
          <input
            type="datetime-local"
            value={form.createdAt}
            onChange={e => setForm({ ...form, createdAt: e.target.value })}
            style={INPUT_STYLE}
          />
        </div>
        <div>
          <label style={LABEL_STYLE}>Approval Date</label>
          <input
            type="datetime-local"
            value={form.approvalAt}
            onChange={e => setForm({ ...form, approvalAt: e.target.value })}
            style={INPUT_STYLE}
          />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px' }}>
        {field('Labor Cost ($)', 'laborCost', 'number', '0')}
        {field('Material Cost ($)', 'materialCost', 'number', '0')}
        {field('Total CO Cost ($)', 'totalCost', 'number', '0')}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <input
          type="checkbox"
          id="co-permit"
          checked={form.permitRelated}
          onChange={e => setForm({ ...form, permitRelated: e.target.checked })}
          style={{ width: '16px', height: '16px', cursor: 'pointer' }}
        />
        <label htmlFor="co-permit" style={{ ...LABEL_STYLE, marginBottom: 0, cursor: 'pointer', textTransform: 'none', letterSpacing: 'normal', fontSize: '13px', color: '#e2e8f0' }}>
          Permit Related
        </label>
      </div>
    </div>
  )
}

// ── COModal — also at module level ───────────────────────────────────────────

interface COModalProps {
  title: string
  onClose: () => void
  onSave: () => void
  saveLabel?: string
  warning?: string
  children?: React.ReactNode
}

function COModal({ title, onClose, onSave, saveLabel = 'Save', warning, children }: COModalProps) {
  const backdropPointerDownStartedOnBackdropRef = useRef(false)

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        backgroundColor: 'rgba(0,0,0,0.7)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '16px',
      }}
      onPointerDown={e => {
        backdropPointerDownStartedOnBackdropRef.current = e.target === e.currentTarget
      }}
      onClick={e => {
        const shouldClose = e.target === e.currentTarget && backdropPointerDownStartedOnBackdropRef.current
        backdropPointerDownStartedOnBackdropRef.current = false
        if (shouldClose) onClose()
      }}
    >
      <div
        style={{
          backgroundColor: '#1e2235',
          border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: '12px',
          width: '100%', maxWidth: '560px',
          maxHeight: '90vh', overflowY: 'auto',
          padding: '24px',
        }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <h3 style={{ color: '#e2e8f0', fontSize: '16px', fontWeight: '700', margin: 0 }}>{title}</h3>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: '20px', cursor: 'pointer', lineHeight: 1 }}
          >×</button>
        </div>

        {warning && (
          <div style={{ backgroundColor: 'rgba(248,113,113,0.15)', border: '1px solid rgba(248,113,113,0.3)', borderRadius: '8px', padding: '10px 14px', marginBottom: '16px', color: '#fca5a5', fontSize: '13px' }}>
            {warning}
          </div>
        )}

        {children}

        <div style={{ display: 'flex', gap: '10px', marginTop: '20px', justifyContent: 'flex-end' }}>
          <button
            onClick={onClose}
            style={{ padding: '8px 16px', backgroundColor: 'rgba(255,255,255,0.08)', color: '#94a3b8', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', fontSize: '13px', cursor: 'pointer' }}
          >
            Cancel
          </button>
          <button
            onClick={onSave}
            style={{ padding: '8px 16px', backgroundColor: 'rgba(59,130,246,0.3)', color: '#60a5fa', border: '1px solid rgba(59,130,246,0.4)', borderRadius: '6px', fontSize: '13px', fontWeight: '600', cursor: 'pointer' }}
          >
            {saveLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

interface Props {
  projectId: string
  onUpdate?: () => void
  backup?: any
}

export default function V15rChangeOrdersTab({ projectId, onUpdate, backup: backupProp }: Props) {
  const { isDemoMode } = useDemoMode()

  const [showAdd, setShowAdd] = useState(false)
  const [addForm, setAddForm] = useState(blankForm)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState(blankForm)

  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [localRawChangeOrders, setLocalRawChangeOrders] = useState<ChangeOrder[] | null>(null)

  useEffect(() => {
    setLocalRawChangeOrders(null)
  }, [projectId])

  const backup = backupProp || getBackupData()
  if (!backup) return null
  const p = backup.projects.find((x: any) => x.id === projectId)
  if (!p) return null

  const rawChangeOrders: ChangeOrder[] = localRawChangeOrders ?? (p.changeOrders || [])
  const cos: ChangeOrder[] = getLiveChangeOrders(rawChangeOrders)
  const phases = Object.keys(p.phases || {})

  // ── Metrics ─────────────────────────────────────────────────────────────────
  const originalQuote: number = Number(p.contract) || 0
  const coTotal = cos.reduce((s, c) => APPROVED_STATUSES.has(c.status) ? s + (Number(c.totalCost) || 0) : s, 0)
  const coExposure = cos.reduce((s, c) => EXPOSURE_STATUSES.has(c.status) ? s + (Number(c.totalCost) || 0) : s, 0)
  const revisedTotal = originalQuote + coTotal
  const paidTotal = cos.reduce((s, c) => c.status === 'Paid' ? s + (Number(c.totalCost) || 0) : s, 0)
  const invoicedTotal = cos.reduce((s, c) => c.status === 'Invoiced' ? s + (Number(c.totalCost) || 0) : s, 0)
  const rejectedTotal = cos.reduce((s, c) => c.status === 'Rejected' ? s + (Number(c.totalCost) || 0) : s, 0)
  const laborTotal = cos.reduce((s, c) => s + (Number(c.laborCost) || 0), 0)
  const materialTotal = cos.reduce((s, c) => s + (Number(c.materialCost) || 0), 0)
  const permitCount = cos.filter(c => c.permitRelated).length
  const openCount = cos.filter(c => c.status !== 'Rejected' && c.status !== 'Paid' && c.status !== 'Completed').length
  const totalCount = cos.length

  // ── Persistence helpers ───────────────────────────────────────────────────

  async function persist(mutate: (proj: any) => void) {
    const fresh = getBackupData()
    if (!fresh) return
    const proj = (fresh.projects || []).find((x: any) => x.id === projectId)
    if (!proj) return
    pushState()
    mutate(proj)
    setLocalRawChangeOrders(cloneChangeOrders(proj.changeOrders || []))
    fresh._lastSavedAt = new Date().toISOString()
    saveBackupData(fresh)
    if (onUpdate) onUpdate()

    try {
      const remote = await fetchLatestRemoteBackup()
      const remoteHasProject = !!(
        remote.hasRemoteRow &&
        remote.remoteData &&
        (remote.remoteData.projects || []).some((rp: any) => String(rp?.id || '') === projectId)
      )

      if (remoteHasProject) {
        const merged = mergeProjectChangeOrdersIntoRemote(remote.remoteData, fresh, projectId)
        const mergedProject = (merged.projects || []).find((mp: any) => String(mp?.id || '') === projectId)
        setLocalRawChangeOrders(cloneChangeOrders(mergedProject?.changeOrders || []))
        await saveBackupWithRemoteBaselineSync(
          merged,
          {
            remoteUpdatedAt: remote.remoteUpdatedAt,
            remoteDataLastSavedAt: remote.remoteDataLastSavedAt,
          },
          {
            source: 'project-change-orders-remote-merge',
            changedKey: 'projects',
            _scopes: ['project.changeOrders'],
          },
        )
        if (onUpdate) onUpdate()
        return
      }

      saveBackupDataAndSync(fresh, 'projects', { source: 'project.changeOrders' })
    } catch (err) {
      console.warn('[V15rChangeOrdersTab] Change Order remote-merge save failed; kept local and used guarded sync', err)
      saveBackupDataAndSync(fresh, 'projects', { source: 'project.changeOrders' })
    }
  }

  // ── CRUD ──────────────────────────────────────────────────────────────────

  function createCO() {
    if (!addForm.title.trim()) return
    const now = isoNow()
    const newCO: ChangeOrder = {
      id: crypto.randomUUID(),
      title: addForm.title.trim(),
      description: addForm.description.trim(),
      stage: addForm.stage,
      requestedBy: addForm.requestedBy.trim(),
      approvedBy: addForm.approvedBy.trim(),
      createdAt: addForm.createdAt ? new Date(addForm.createdAt).toISOString() : now,
      approvalAt: addForm.approvalAt ? new Date(addForm.approvalAt).toISOString() : '',
      laborCost: Number(addForm.laborCost) || 0,
      materialCost: Number(addForm.materialCost) || 0,
      totalCost: Number(addForm.totalCost) || 0,
      permitRelated: addForm.permitRelated,
      status: addForm.status,
      updatedAt: now,
    }
    persist(proj => {
      if (!proj.changeOrders) proj.changeOrders = []
      proj.changeOrders.unshift(newCO)
    })
    setShowAdd(false)
    setAddForm(blankForm())
  }

  function openEditModal(co: ChangeOrder) {
    setEditForm({
      title: co.title,
      description: co.description,
      stage: co.stage || '',
      requestedBy: co.requestedBy || '',
      approvedBy: co.approvedBy || '',
      createdAt: co.createdAt ? localDateTimeValue(co.createdAt) : '',
      approvalAt: co.approvalAt ? localDateTimeValue(co.approvalAt) : '',
      laborCost: String(co.laborCost ?? ''),
      materialCost: String(co.materialCost ?? ''),
      totalCost: String(co.totalCost ?? ''),
      permitRelated: co.permitRelated || false,
      status: co.status,
    })
    setEditingId(co.id)
  }

  function saveEdit() {
    if (!editForm.title.trim() || !editingId) return
    persist(proj => {
      const co = (proj.changeOrders || []).find((c: ChangeOrder) => c.id === editingId)
      if (!co) return
      co.title = editForm.title.trim()
      co.description = editForm.description.trim()
      co.stage = editForm.stage
      co.requestedBy = editForm.requestedBy.trim()
      co.approvedBy = editForm.approvedBy.trim()
      co.createdAt = editForm.createdAt ? new Date(editForm.createdAt).toISOString() : co.createdAt
      co.approvalAt = editForm.approvalAt ? new Date(editForm.approvalAt).toISOString() : ''
      co.laborCost = Number(editForm.laborCost) || 0
      co.materialCost = Number(editForm.materialCost) || 0
      co.totalCost = Number(editForm.totalCost) || 0
      co.permitRelated = editForm.permitRelated
      co.status = editForm.status
      co.updatedAt = isoNow()
    })
    setEditingId(null)
  }

  function deleteCO(id: string) {
    persist(proj => {
      const arr: ChangeOrder[] = proj.changeOrders || []
      const idx = arr.findIndex((c: ChangeOrder) => c.id === id)
      if (idx === -1) {
        console.warn('[V15rChangeOrdersTab] delete: Change Order not found; nothing to tombstone', id)
        return
      }
      arr[idx] = createChangeOrderTombstone(arr[idx])
      proj.changeOrders = arr
    })
    setDeleteId(null)
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div style={{ color: '#e2e8f0' }}>

      {/* ── KPI Dashboard ────────────────────────────────────────────────── */}
      <div style={{ marginBottom: '20px' }}>

        {/* Primary row: Original Quote / Approved CO Total / Revised Total */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px', marginBottom: '10px' }}>
          {[
            { label: 'Original Quote', value: fmtMoney(originalQuote), color: '#e5e7eb', accent: 'rgba(229,231,235,0.08)' },
            { label: 'Approved CO Total', value: fmtMoney(coTotal), color: '#a78bfa', accent: 'rgba(167,139,250,0.08)' },
            { label: 'Revised Project Total', value: fmtMoney(revisedTotal), color: '#34d399', accent: 'rgba(52,211,153,0.08)' },
          ].map(({ label, value, color, accent }) => (
            <div key={label} style={{ backgroundColor: accent, border: `1px solid ${color}22`, borderRadius: '10px', padding: '14px 12px', textAlign: 'center' }}>
              <div style={{ fontSize: '18px', fontWeight: '700', color }}>{value}</div>
              <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.4)', marginTop: '4px' }}>{label}</div>
            </div>
          ))}
        </div>

        {/* Secondary row: Exposure / Paid / Invoiced / Rejected */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr) repeat(2, 1fr)', gap: '8px', marginBottom: '8px' }}>
          {[
            { label: 'Pending / Exposure', value: fmtMoney(coExposure), color: '#f87171' },
            { label: 'Paid CO Total', value: fmtMoney(paidTotal), color: '#6ee7b7' },
            { label: 'Invoiced CO Total', value: fmtMoney(invoicedTotal), color: '#fb923c' },
            { label: 'Rejected CO Total', value: fmtMoney(rejectedTotal), color: '#94a3b8' },
          ].map(({ label, value, color }) => (
            <div key={label} style={{ backgroundColor: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '8px', padding: '10px 10px', textAlign: 'center' }}>
              <div style={{ fontSize: '15px', fontWeight: '700', color }}>{value}</div>
              <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.35)', marginTop: '3px' }}>{label}</div>
            </div>
          ))}
        </div>

        {/* Detail row: Labor / Material / Permit / Open COs / Total COs */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '8px' }}>
          {[
            { label: 'Labor Total', value: fmtMoney(laborTotal), color: '#60a5fa' },
            { label: 'Material Total', value: fmtMoney(materialTotal), color: '#38bdf8' },
            { label: 'Permit-Related', value: String(permitCount), color: '#fbbf24' },
            { label: 'Open COs', value: String(openCount), color: '#fbbf24' },
            { label: 'Total COs', value: String(totalCount), color: '#94a3b8' },
          ].map(({ label, value, color }) => (
            <div key={label} style={{ backgroundColor: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '8px', padding: '8px', textAlign: 'center' }}>
              <div style={{ fontSize: '14px', fontWeight: '700', color }}>{value}</div>
              <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.3)', marginTop: '3px' }}>{label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Add button */}
      {!isDemoMode && (
        <button
          onClick={() => { setAddForm(blankForm()); setShowAdd(true) }}
          style={{ marginBottom: '16px', padding: '9px 18px', backgroundColor: 'rgba(59,130,246,0.2)', color: '#60a5fa', border: '1px solid rgba(59,130,246,0.35)', borderRadius: '8px', fontSize: '13px', fontWeight: '600', cursor: 'pointer' }}
        >
          + Add Change Order
        </button>
      )}

      {/* CO list */}
      {cos.length === 0 ? (
        <div style={{ textAlign: 'center', color: 'rgba(255,255,255,0.3)', padding: '40px', fontSize: '14px' }}>
          No change orders yet
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {cos.map(co => (
            <div key={co.id} style={{ backgroundColor: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '10px', padding: '14px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px', marginBottom: '8px' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '14px', fontWeight: '600', color: '#e2e8f0' }}>{co.title}</span>
                    <span style={{ fontSize: '11px', fontWeight: '700', padding: '2px 8px', borderRadius: '20px', backgroundColor: statusColor(co.status) + '22', color: statusColor(co.status), border: `1px solid ${statusColor(co.status)}44` }}>
                      {co.status}
                    </span>
                    {co.permitRelated && (
                      <span style={{ fontSize: '10px', padding: '2px 6px', borderRadius: '20px', backgroundColor: 'rgba(251,191,36,0.15)', color: '#fbbf24', border: '1px solid rgba(251,191,36,0.3)' }}>
                        Permit
                      </span>
                    )}
                  </div>
                  {co.stage && (
                    <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.4)', marginTop: '4px' }}>Stage: {co.stage}</div>
                  )}
                  {co.description && (
                    <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.5)', marginTop: '6px' }}>{co.description}</div>
                  )}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px', flexShrink: 0 }}>
                  <div style={{ fontSize: '16px', fontWeight: '700', color: '#a78bfa' }}>{fmtMoney(co.totalCost)}</div>
                  {!isDemoMode && (
                    <div style={{ display: 'flex', gap: '6px' }}>
                      <button onClick={() => openEditModal(co)} style={{ padding: '4px 10px', backgroundColor: 'rgba(59,130,246,0.15)', color: '#60a5fa', border: '1px solid rgba(59,130,246,0.3)', borderRadius: '5px', fontSize: '11px', cursor: 'pointer' }}>Edit</button>
                      <button onClick={() => setDeleteId(co.id)} style={{ padding: '4px 10px', backgroundColor: 'rgba(248,113,113,0.15)', color: '#f87171', border: '1px solid rgba(248,113,113,0.3)', borderRadius: '5px', fontSize: '11px', cursor: 'pointer' }}>Delete</button>
                    </div>
                  )}
                </div>
              </div>
              <div style={{ display: 'flex', gap: '16px', fontSize: '11px', color: 'rgba(255,255,255,0.35)', flexWrap: 'wrap' }}>
                {co.requestedBy && <span>Requested by: {co.requestedBy}</span>}
                {co.approvedBy && <span>Approved by: {co.approvedBy}</span>}
                {co.laborCost > 0 && <span>Labor: {fmtMoney(co.laborCost)}</span>}
                {co.materialCost > 0 && <span>Materials: {fmtMoney(co.materialCost)}</span>}
                {co.createdAt && <span>{new Date(co.createdAt).toLocaleDateString()}</span>}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add modal */}
      {showAdd && (
        <COModal
          title="Add Change Order"
          onClose={() => setShowAdd(false)}
          onSave={createCO}
          saveLabel="Create CO"
        >
          <COForm form={addForm} setForm={setAddForm} phases={phases} />
        </COModal>
      )}

      {/* Edit modal */}
      {editingId && (
        <COModal
          title="Edit Change Order"
          onClose={() => setEditingId(null)}
          onSave={saveEdit}
          saveLabel="Save Changes"
        >
          <COForm form={editForm} setForm={setEditForm} phases={phases} />
        </COModal>
      )}

      {/* Delete confirm modal */}
      {deleteId && (
        <COModal
          title="Delete Change Order"
          onClose={() => setDeleteId(null)}
          onSave={() => deleteCO(deleteId)}
          saveLabel="Delete"
          warning="This will remove this change order from live views and preserve a delete marker for sync safety."
        />
      )}
    </div>
  )
}
