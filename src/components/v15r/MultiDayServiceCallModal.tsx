/**
 * MultiDayServiceCallModal.tsx
 * Modal for adding a new daily entry to an existing service call,
 * or creating a brand new service call (Day 1).
 *
 * Features:
 *  - Itemized materials: [Item Name] [Qty] [Unit $] [Row Total] + "Add Item"
 *  - Labor hours × $43 rate
 *  - Transportation miles × rate
 *  - Daily total preview
 *  - Collection amount for this day
 *  - Notes field
 */

import { useState, useCallback } from 'react'
import { Plus, Trash2, X, DollarSign, Truck, Clock, Package } from 'lucide-react'
import {
  type ServiceMaterialItem,
  type ServiceCallRecord,
  materialItemTotal,
  dayMaterialsTotal,
  genId,
  today,
  addDayToServiceCall,
  createServiceCallRecord,
} from '@/services/serviceCallService'
import { num } from '@/services/backupDataService'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ModalMode {
  type: 'new_call'
  laborRate?: number
  mileRate?: number
}

export interface AddDayMode {
  type: 'add_day'
  call: ServiceCallRecord
  laborRate?: number
  mileRate?: number
}

export type MultiDayModalConfig = ModalMode | AddDayMode

interface Props {
  config: MultiDayModalConfig
  onSave: (result: ServiceCallRecord) => void
  onClose: () => void
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const JOB_TYPES = [
  'GFCI / Receptacles', 'Panel / Service', 'Troubleshoot', 'Lighting',
  'EV Charger', 'Low Voltage', 'Circuit Add/Replace', 'Switches / Dimmers',
  'Warranty', 'Other',
]

function emptyMaterial(): ServiceMaterialItem {
  return { id: genId('mat'), item_name: '', quantity: 1, unit_cost: 0, total: 0 }
}

function fmtMoney(n: number): string {
  if (!n && n !== 0) return '$0'
  if (Math.abs(n) >= 1000) return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 0 })
  return '$' + n.toFixed(2)
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function MultiDayServiceCallModal({ config, onSave, onClose }: Props) {
  const isNewCall = config.type === 'new_call'
  const laborRate = config.laborRate ?? 43
  const mileRate = config.mileRate ?? 0.67
  const existingCall = config.type === 'add_day' ? config.call : null

  // New-call-only fields
  const [customer, setCustomer] = useState('')
  const [address, setAddress] = useState('')
  const [jtype, setJtype] = useState(JOB_TYPES[0])

  // Day-level fields
  const [date, setDate] = useState(today())
  const [laborHours, setLaborHours] = useState('')
  const [miles, setMiles] = useState('')
  const [collection, setCollection] = useState('')
  const [notes, setNotes] = useState('')
  const [materials, setMaterials] = useState<ServiceMaterialItem[]>([emptyMaterial()])

  // ── Material row handlers ─────────────────────────────────────────────────

  const addMaterialRow = useCallback(() => {
    setMaterials(prev => [...prev, emptyMaterial()])
  }, [])

  const removeMaterialRow = useCallback((id: string) => {
    setMaterials(prev => prev.filter(m => m.id !== id))
  }, [])

  const updateMaterialRow = useCallback(
    (id: string, field: keyof ServiceMaterialItem, raw: string) => {
      setMaterials(prev =>
        prev.map(m => {
          if (m.id !== id) return m
          const updated = { ...m, [field]: field === 'item_name' ? raw : num(raw) }
          return { ...updated, total: materialItemTotal(updated) }
        })
      )
    },
    []
  )

  // ── Derived preview ───────────────────────────────────────────────────────

  const validMaterials = materials.filter(m => m.item_name.trim() !== '' || m.total > 0)
  const materialsTotal = dayMaterialsTotal(validMaterials)
  const laborCost = num(laborHours) * laborRate
  const transCost = num(miles) * mileRate
  const dailyTotal = laborCost + materialsTotal + transCost

  // ── Save ──────────────────────────────────────────────────────────────────

  function handleSave() {
    const mats = materials
      .filter(m => m.item_name.trim() !== '')
      .map(m => ({ ...m, total: materialItemTotal(m) }))

    if (isNewCall) {
      if (!customer.trim()) {
        alert('Customer name is required.')
        return
      }
      const newCall = createServiceCallRecord({
        customer: customer.trim(),
        address: address.trim(),
        jtype,
        labor_rate: laborRate,
        day1: {
          date,
          labor_hours: num(laborHours),
          materials: mats,
          transportation_miles: num(miles),
          transportation_rate: mileRate,
          collection_amount: num(collection),
          notes: notes.trim(),
        },
      })
      onSave(newCall)
    } else if (existingCall) {
      const updated = addDayToServiceCall(existingCall, {
        date,
        labor_hours: num(laborHours),
        materials: mats,
        transportation_miles: num(miles),
        transportation_rate: mileRate,
        collection_amount: num(collection),
        notes: notes.trim(),
        labor_rate: laborRate,
      })
      onSave(updated)
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  const dayLabel = isNewCall ? 'Day 1' : `Day ${(existingCall?.days?.length ?? 0) + 1}`
  const title = isNewCall
    ? 'New Service Call'
    : `Add ${dayLabel} — ${existingCall?.customer || 'Service Call'}`

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl border border-gray-700 bg-gray-900 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-700">
          <h2 className="text-sm font-bold text-gray-100 uppercase tracking-wider">{title}</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-5">
          {/* New call: customer info */}
          {isNewCall && (
            <div className="space-y-3">
              <SectionLabel icon={<Clock size={12} />} label="Call Info" />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field
                  label="Customer *"
                  value={customer}
                  onChange={setCustomer}
                  placeholder="Customer name"
                />
                <Field
                  label="Address"
                  value={address}
                  onChange={setAddress}
                  placeholder="Job address"
                />
              </div>
              <div>
                <label className="block text-[10px] text-gray-400 uppercase tracking-wider mb-1">
                  Job Type
                </label>
                <select
                  value={jtype}
                  onChange={e => setJtype(e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-xs text-gray-200 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                >
                  {JOB_TYPES.map(t => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {/* Day info */}
          <div className="space-y-3">
            <SectionLabel icon={<Clock size={12} />} label={`${dayLabel} Details`} />
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Field
                label="Date"
                type="date"
                value={date}
                onChange={setDate}
              />
              <FieldNumeric
                label={`Labor Hours (×$${laborRate}/hr)`}
                value={laborHours}
                onChange={setLaborHours}
                placeholder="0"
                hint={laborHours ? `= ${fmtMoney(num(laborHours) * laborRate)}` : undefined}
              />
              <FieldNumeric
                label={`Miles (×$${mileRate}/mi)`}
                value={miles}
                onChange={setMiles}
                placeholder="0"
                hint={miles ? `= ${fmtMoney(num(miles) * mileRate)}` : undefined}
              />
            </div>
          </div>

          {/* Itemized Materials */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <SectionLabel icon={<Package size={12} />} label="Materials (Itemized)" />
              <button
                onClick={addMaterialRow}
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-600/20 text-emerald-400 border border-emerald-500/30 text-[10px] font-semibold hover:bg-emerald-600/30 transition-colors"
              >
                <Plus size={10} /> Add Item
              </button>
            </div>

            {/* Material header */}
            <div className="grid grid-cols-[1fr_60px_80px_70px_28px] gap-2 text-[9px] text-gray-500 uppercase tracking-wider px-1">
              <span>Item Description</span>
              <span className="text-right">Qty</span>
              <span className="text-right">Unit $</span>
              <span className="text-right">Total</span>
              <span />
            </div>

            {materials.map(m => (
              <div key={m.id} className="grid grid-cols-[1fr_60px_80px_70px_28px] gap-2 items-center">
                <input
                  type="text"
                  value={m.item_name}
                  onChange={e => updateMaterialRow(m.id, 'item_name', e.target.value)}
                  placeholder="e.g. GFCI Outlet"
                  className="bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-200 focus:outline-none focus:ring-1 focus:ring-emerald-500 w-full"
                />
                <input
                  type="number"
                  min="0"
                  step="0.5"
                  value={m.quantity || ''}
                  onChange={e => updateMaterialRow(m.id, 'quantity', e.target.value)}
                  placeholder="1"
                  className="bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-200 text-right focus:outline-none focus:ring-1 focus:ring-emerald-500 w-full"
                />
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={m.unit_cost || ''}
                  onChange={e => updateMaterialRow(m.id, 'unit_cost', e.target.value)}
                  placeholder="0.00"
                  className="bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-200 text-right focus:outline-none focus:ring-1 focus:ring-emerald-500 w-full"
                />
                <div className="text-xs font-mono text-orange-400 text-right pr-1">
                  {m.total > 0 ? fmtMoney(m.total) : '—'}
                </div>
                <button
                  onClick={() => removeMaterialRow(m.id)}
                  className="text-gray-600 hover:text-red-400 transition-colors flex items-center justify-center"
                  title="Remove item"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}

            {/* Materials subtotal */}
            <div className="flex justify-end">
              <span className="text-[10px] text-gray-500">
                Materials Total:{' '}
                <span className="text-orange-400 font-mono font-bold">
                  {fmtMoney(materialsTotal)}
                </span>
              </span>
            </div>
          </div>

          {/* Collection */}
          <div className="space-y-3">
            <SectionLabel icon={<DollarSign size={12} />} label="Collection" />
            <FieldNumeric
              label="Amount Collected Today"
              value={collection}
              onChange={setCollection}
              placeholder="0.00"
            />
          </div>

          {/* Notes */}
          <div>
            <label className="block text-[10px] text-gray-400 uppercase tracking-wider mb-1">
              Notes / Scope Notes
            </label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={2}
              placeholder="What was done, any scope changes, materials found on site..."
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-xs text-gray-200 focus:outline-none focus:ring-1 focus:ring-emerald-500 resize-none"
            />
          </div>

          {/* Daily Total Preview */}
          <div className="rounded-xl border border-gray-700 bg-gray-800/50 p-4">
            <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-3">
              {dayLabel} — Cost Preview
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
              <PreviewCell label="Labor" value={fmtMoney(laborCost)} color="text-cyan-400" />
              <PreviewCell label="Materials" value={fmtMoney(materialsTotal)} color="text-orange-400" />
              <PreviewCell label="Transport" value={fmtMoney(transCost)} color="text-purple-400" />
              <PreviewCell label="Day Total" value={fmtMoney(dailyTotal)} color="text-yellow-400" bold />
            </div>
            {num(collection) > 0 && (
              <div className="mt-3 pt-3 border-t border-gray-700 flex justify-between text-xs">
                <span className="text-gray-400">Collected Today</span>
                <span className="text-emerald-400 font-mono font-bold">{fmtMoney(num(collection))}</span>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-gray-700">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-xs text-gray-400 hover:text-gray-200 border border-gray-700 hover:border-gray-500 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="px-5 py-2 rounded-lg text-xs font-semibold bg-emerald-600 text-white hover:bg-emerald-500 transition-colors"
          >
            {isNewCall ? 'Create Service Call' : `Save ${dayLabel}`}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SectionLabel({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-gray-500">{icon}</span>
      <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">{label}</span>
    </div>
  )
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  type?: string
}) {
  return (
    <div>
      <label className="block text-[10px] text-gray-400 uppercase tracking-wider mb-1">
        {label}
      </label>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-xs text-gray-200 focus:outline-none focus:ring-1 focus:ring-emerald-500"
      />
    </div>
  )
}

function FieldNumeric({
  label,
  value,
  onChange,
  placeholder,
  hint,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  hint?: string
}) {
  return (
    <div>
      <label className="block text-[10px] text-gray-400 uppercase tracking-wider mb-1">
        {label}
      </label>
      <input
        type="number"
        min="0"
        step="any"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-xs text-gray-200 focus:outline-none focus:ring-1 focus:ring-emerald-500"
      />
      {hint && <div className="text-[9px] text-gray-500 mt-0.5 font-mono">{hint}</div>}
    </div>
  )
}

function PreviewCell({
  label,
  value,
  color,
  bold,
}: {
  label: string
  value: string
  color: string
  bold?: boolean
}) {
  return (
    <div>
      <div className="text-[9px] text-gray-500 uppercase tracking-wider">{label}</div>
      <div className={`text-sm font-mono ${color} ${bold ? 'font-bold' : ''}`}>{value}</div>
    </div>
  )
}
