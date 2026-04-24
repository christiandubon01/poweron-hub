// @ts-nocheck
/**
 * AddLeadModal — Manual Lead Entry form
 *
 * HUNTER-B6-MANUAL-ADD-LEAD-APR23-2026-1
 *
 * Modal form for the operator to manually add a lead to the HUNTER pipeline.
 * On Save, calls useHunterStore.getState().addLead which writes tenant-scoped
 * to Supabase via the existing B2 wiring. No scoring runs synchronously — the
 * lead is inserted with score 0 and the scoring engine picks it up async.
 *
 * Sections:
 *   1. Contact       (contact_name*, company_name, phone, email)
 *   2. Location      (address, city)
 *   3. Job Details   (lead_type*, description, estimated_value)
 *   4. Urgency/Src   (urgency_level, urgency_reason if urgency >= 3, source*)
 *   5. Notes         (notes)
 *
 * Required fields gate the Save button until all are present:
 *   contact_name, lead_type, source
 */

import React, { useState } from 'react'
import { X } from 'lucide-react'
import { useHunterStore } from '@/store/hunterStore'

export interface AddLeadModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess?: () => void
}

interface FormState {
  contact_name: string
  company_name: string
  phone: string
  email: string
  address: string
  city: string
  lead_type: string
  description: string
  estimated_value: string // kept as string for controlled input; parsed on save
  urgency_level: string // '' | '1'..'5'
  urgency_reason: string
  source: string
  source_tag: string
  notes: string
}

const EMPTY_FORM: FormState = {
  contact_name: '',
  company_name: '',
  phone: '',
  email: '',
  address: '',
  city: '',
  lead_type: '',
  description: '',
  estimated_value: '',
  urgency_level: '',
  urgency_reason: '',
  source: '',
  source_tag: '',
  notes: '',
}

// Maps the operator-facing source labels onto stable values for source
// (free-form string column) and source_tag (marker column).
const SOURCE_OPTIONS: Array<{ value: string; label: string; tag: string }> = [
  { value: 'manual_entry', label: 'Manual Entry', tag: 'manual_entry' },
  { value: 'referral', label: 'Referral', tag: 'referral' },
  { value: 'website', label: 'Website', tag: 'website' },
  { value: 'phone_call', label: 'Phone Call', tag: 'phone_call' },
  { value: 'other', label: 'Other', tag: 'other' },
]

// Lead-type options. Values match the canonical LeadType enum where possible;
// 'industrial' is included per spec as a string value — the store accepts it.
const LEAD_TYPE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'residential', label: 'Residential' },
  { value: 'commercial', label: 'Commercial' },
  { value: 'industrial', label: 'Industrial' },
  { value: 'service', label: 'Service' },
]

const URGENCY_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '1', label: '1 — No rush' },
  { value: '2', label: '2' },
  { value: '3', label: '3 — Standard' },
  { value: '4', label: '4' },
  { value: '5', label: '5 — Urgent' },
]

function isRequiredFilled(form: FormState): boolean {
  return (
    form.contact_name.trim().length > 0 &&
    form.lead_type.trim().length > 0 &&
    form.source.trim().length > 0
  )
}

export function AddLeadModal({ isOpen, onClose, onSuccess }: AddLeadModalProps) {
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [isSaving, setIsSaving] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  if (!isOpen) return null

  const setField = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget && !isSaving) {
      onClose()
    }
  }

  const handleCancel = () => {
    if (isSaving) return
    setErrorMessage(null)
    setForm(EMPTY_FORM)
    onClose()
  }

  const canSave = isRequiredFilled(form) && !isSaving

  const handleSave = async () => {
    if (!canSave) return
    setIsSaving(true)
    setErrorMessage(null)

    // Build the payload for addLead. We omit empty strings so Supabase defaults
    // / nullability rules apply. estimated_value & urgency_level get parsed.
    const selectedSource = SOURCE_OPTIONS.find((s) => s.value === form.source)
    const payload: any = {
      source: selectedSource?.value ?? form.source,
      source_tag: form.source_tag || selectedSource?.tag || 'manual_entry',
      lead_type: form.lead_type,
      score: 0,
    }

    if (form.contact_name.trim()) payload.contact_name = form.contact_name.trim()
    if (form.company_name.trim()) payload.company_name = form.company_name.trim()
    if (form.phone.trim()) payload.phone = form.phone.trim()
    if (form.email.trim()) payload.email = form.email.trim()
    if (form.address.trim()) payload.address = form.address.trim()
    if (form.city.trim()) payload.city = form.city.trim()
    if (form.description.trim()) payload.description = form.description.trim()
    if (form.notes.trim()) payload.notes = form.notes.trim()

    if (form.estimated_value.trim()) {
      const parsed = Number(form.estimated_value)
      if (!Number.isNaN(parsed) && parsed >= 0) {
        payload.estimated_value = parsed
      }
    }

    if (form.urgency_level) {
      const parsedUrgency = parseInt(form.urgency_level, 10)
      if (!Number.isNaN(parsedUrgency)) {
        payload.urgency_level = parsedUrgency
        if (parsedUrgency >= 3 && form.urgency_reason.trim()) {
          payload.urgency_reason = form.urgency_reason.trim()
        }
      }
    }

    try {
      await useHunterStore.getState().addLead(payload)
      // Success: clear, close, notify parent.
      setForm(EMPTY_FORM)
      setIsSaving(false)
      onSuccess?.()
      onClose()
    } catch (err: any) {
      // Keep modal open, preserve form, show inline error.
      const msg = err?.message ?? String(err) ?? 'Failed to save lead. Please try again.'
      setErrorMessage(msg)
      setIsSaving(false)
    }
  }

  const showUrgencyReason =
    form.urgency_level !== '' && parseInt(form.urgency_level, 10) >= 3

  const labelClass = 'block text-xs font-medium text-gray-300 mb-1'
  const requiredMark = <span className="text-emerald-400 ml-0.5">*</span>
  const inputClass =
    'w-full px-3 py-2 bg-gray-800 text-gray-100 text-sm rounded border border-gray-700 ' +
    'focus:outline-none focus:border-emerald-500 placeholder-gray-500'

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-70 p-4"
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-lead-modal-title"
    >
      <div
        className="bg-gray-900 border border-gray-700 rounded-lg shadow-xl w-full max-w-[600px] max-h-[90vh] flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
          <h2 id="add-lead-modal-title" className="text-lg font-bold text-white">
            Add Lead
          </h2>
          <button
            type="button"
            onClick={handleCancel}
            disabled={isSaving}
            className="p-1 text-gray-400 hover:text-white transition-colors disabled:opacity-50"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {/* Section 1 — Contact */}
          <section className="space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wide text-emerald-400">Contact</h3>
            <div>
              <label className={labelClass}>
                Contact Name{requiredMark}
              </label>
              <input
                type="text"
                value={form.contact_name}
                onChange={(e) => setField('contact_name', e.target.value)}
                className={inputClass}
                placeholder="Jane Doe"
                required
              />
            </div>
            <div>
              <label className={labelClass}>Company Name</label>
              <input
                type="text"
                value={form.company_name}
                onChange={(e) => setField('company_name', e.target.value)}
                className={inputClass}
                placeholder="Acme Inc."
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass}>Phone</label>
                <input
                  type="tel"
                  value={form.phone}
                  onChange={(e) => setField('phone', e.target.value)}
                  className={inputClass}
                  placeholder="(555) 123-4567"
                />
              </div>
              <div>
                <label className={labelClass}>Email</label>
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => setField('email', e.target.value)}
                  className={inputClass}
                  placeholder="jane@example.com"
                />
              </div>
            </div>
          </section>

          {/* Section 2 — Location */}
          <section className="space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wide text-emerald-400">Location</h3>
            <div>
              <label className={labelClass}>Address</label>
              <input
                type="text"
                value={form.address}
                onChange={(e) => setField('address', e.target.value)}
                className={inputClass}
                placeholder="123 Main St"
              />
            </div>
            <div>
              <label className={labelClass}>City</label>
              <input
                type="text"
                value={form.city}
                onChange={(e) => setField('city', e.target.value)}
                className={inputClass}
                placeholder="Los Angeles"
              />
            </div>
          </section>

          {/* Section 3 — Job Details */}
          <section className="space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wide text-emerald-400">Job Details</h3>
            <div>
              <label className={labelClass}>
                Lead Type{requiredMark}
              </label>
              <select
                value={form.lead_type}
                onChange={(e) => setField('lead_type', e.target.value)}
                className={inputClass}
                required
              >
                <option value="">Select type…</option>
                {LEAD_TYPE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>Description</label>
              <textarea
                value={form.description}
                onChange={(e) => setField('description', e.target.value)}
                className={inputClass}
                rows={3}
                placeholder="Panel upgrade, EV charger install, etc."
              />
            </div>
            <div>
              <label className={labelClass}>Estimated Value</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm pointer-events-none">$</span>
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={form.estimated_value}
                  onChange={(e) => setField('estimated_value', e.target.value)}
                  className={inputClass + ' pl-7'}
                  placeholder="0.00"
                />
              </div>
            </div>
          </section>

          {/* Section 4 — Urgency & Source */}
          <section className="space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wide text-emerald-400">Urgency & Source</h3>
            <div>
              <label className={labelClass}>Urgency Level</label>
              <select
                value={form.urgency_level}
                onChange={(e) => setField('urgency_level', e.target.value)}
                className={inputClass}
              >
                <option value="">Not specified</option>
                {URGENCY_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
            {showUrgencyReason && (
              <div>
                <label className={labelClass}>Urgency Reason</label>
                <input
                  type="text"
                  value={form.urgency_reason}
                  onChange={(e) => setField('urgency_reason', e.target.value)}
                  className={inputClass}
                  placeholder="Panel failure, code deadline, …"
                />
              </div>
            )}
            <div>
              <label className={labelClass}>
                Source{requiredMark}
              </label>
              <select
                value={form.source}
                onChange={(e) => setField('source', e.target.value)}
                className={inputClass}
                required
              >
                <option value="">Select source…</option>
                {SOURCE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          </section>

          {/* Section 5 — Notes */}
          <section className="space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wide text-emerald-400">Notes</h3>
            <div>
              <label className={labelClass}>Notes</label>
              <textarea
                value={form.notes}
                onChange={(e) => setField('notes', e.target.value)}
                className={inputClass}
                rows={2}
                placeholder="Internal notes for this lead"
              />
            </div>
          </section>

          {errorMessage && (
            <div
              className="bg-red-950 border border-red-700 text-red-200 text-sm rounded px-3 py-2"
              role="alert"
            >
              {errorMessage}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-gray-800 bg-gray-950 rounded-b-lg">
          <button
            type="button"
            onClick={handleCancel}
            disabled={isSaving}
            className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-200 text-sm rounded transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={!canSave}
            className={
              'px-4 py-2 text-white text-sm rounded transition-colors ' +
              (canSave
                ? 'bg-emerald-600 hover:bg-emerald-700'
                : 'bg-emerald-900 opacity-60 cursor-not-allowed')
            }
          >
            {isSaving ? 'Saving…' : 'Save Lead'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default AddLeadModal
