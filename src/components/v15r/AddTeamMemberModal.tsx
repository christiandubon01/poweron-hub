// @ts-nocheck
/**
 * AddTeamMemberModal.tsx — "Add Team Member" modal with three-type selector.
 *
 * Replaces the old "Add Hypothetical Position" button in the org pyramid.
 *
 * TYPE 1 — Permanent Position
 *   Fields: name, role, hire date, hourly rate, classification (W-2 only),
 *           status (Active/Inactive), separation date (if Inactive)
 *
 * TYPE 2 — Per-Project Employee
 *   Fields: name, role, start date, estimated end date, hourly rate,
 *           classification (defaults 1099), project assignment (dropdown),
 *           status (Active/Closed)
 *
 * TYPE 3 — Hypothetical (Planning)
 *   Fields: role title, estimated hourly rate, start month (future planning)
 *
 * OHM compliance card fires AFTER save for types 1 & 2. Does not block save.
 */

import React, { useState, useEffect } from 'react'
import { X, User, Briefcase, Lightbulb, ChevronRight, AlertTriangle } from 'lucide-react'
import type { EmployeeType, ExtendedEmployee } from './employeeTypes'

interface Project {
  id: string
  name: string
  status?: string
}

interface AddTeamMemberModalProps {
  projects: Project[]
  onSave: (employee: Partial<ExtendedEmployee>) => void
  onCancel: () => void
  payrollMult?: number
}

// ── Type option cards ─────────────────────────────────────────────────────────
const TYPE_OPTIONS: Array<{
  type: EmployeeType
  label: string
  icon: React.ReactNode
  desc: string
  color: string
  borderColor: string
}> = [
  {
    type: 'permanent',
    label: 'Permanent Position',
    icon: <User className="w-6 h-6" />,
    desc: 'Full-time W-2 employee. Appears in all cost calculations permanently.',
    color: 'text-blue-300',
    borderColor: 'border-blue-500/50',
  },
  {
    type: 'per_project',
    label: 'Per-Project Employee',
    icon: <Briefcase className="w-6 h-6" />,
    desc: 'Project-based worker (1099 default). Labor flows into project budget.',
    color: 'text-amber-300',
    borderColor: 'border-amber-500/50',
  },
  {
    type: 'hypothetical',
    label: 'Hypothetical (Planning)',
    icon: <Lightbulb className="w-6 h-6" />,
    desc: 'Future position for 6-Month Cost Forecast modeling only. No real cost impact.',
    color: 'text-purple-300',
    borderColor: 'border-purple-500/50',
  },
]

// ── Shared input style ────────────────────────────────────────────────────────
const inputCls =
  'w-full bg-[#1a1d27] border border-gray-700 text-gray-100 text-sm px-3 py-2.5 rounded focus:outline-none focus:border-blue-600 placeholder-gray-600'

const labelCls = 'block text-xs font-semibold text-gray-400 mb-1 uppercase tracking-wide'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className={labelCls}>{label}</label>
      {children}
    </div>
  )
}

// ── Main modal ────────────────────────────────────────────────────────────────
export default function AddTeamMemberModal({
  projects,
  onSave,
  onCancel,
  payrollMult = 1.20,
}: AddTeamMemberModalProps) {
  const [step, setStep] = useState<'select' | 'form'>('select')
  const [selectedType, setSelectedType] = useState<EmployeeType | null>(null)

  // Form state
  const [name, setName] = useState('')
  const [role, setRole] = useState('')
  const [hourlyRate, setHourlyRate] = useState<number | ''>('')   // base wage
  const [billRate, setBillRate] = useState<number | ''>('')        // bill rate (independent)
  const [billRateOverridden, setBillRateOverridden] = useState(false)
  const [hireDate, setHireDate] = useState('')
  const [separationDate, setSeparationDate] = useState('')
  const [status, setStatus] = useState<'Active' | 'Inactive' | 'Closed'>('Active')
  const [classification, setClassification] = useState<'W-2' | '1099'>('W-2')
  const [startDate, setStartDate] = useState('')
  const [estimatedEndDate, setEstimatedEndDate] = useState('')
  const [projectId, setProjectId] = useState('')
  const [startMonth, setStartMonth] = useState('')

  // Auto-calculate bill rate default when base wage changes (unless user has overridden it)
  useEffect(() => {
    if (!billRateOverridden) {
      const base = Number(hourlyRate) || 0
      const loaded = base * payrollMult
      setBillRate(loaded > 0 ? parseFloat((loaded * 2.0).toFixed(2)) : '')
    }
  }, [hourlyRate, payrollMult, billRateOverridden])

  // Derived read-only values
  const baseWageNum = Number(hourlyRate) || 0
  const loadedCostRate = parseFloat((baseWageNum * payrollMult).toFixed(2))
  const billRateNum = Number(billRate) || 0
  const marginPerHour = parseFloat((billRateNum - loadedCostRate).toFixed(2))

  const activeProjects = projects.filter(
    p => p.status === 'active' || p.status === 'coming' || !p.status
  )

  const handleTypeSelect = (type: EmployeeType) => {
    setSelectedType(type)
    // Set classification defaults
    if (type === 'permanent') setClassification('W-2')
    if (type === 'per_project') setClassification('1099')
    setStep('form')
  }

  const handleSave = () => {
    if (!selectedType) return

    // Basic validation
    if (selectedType !== 'hypothetical' && !name.trim()) {
      alert('Name is required')
      return
    }
    if (!role.trim() && selectedType === 'hypothetical') {
      alert('Role title is required')
      return
    }

    const baseWage = Number(hourlyRate) || 0
    const loadedCost = parseFloat((baseWage * payrollMult).toFixed(2))
    const finalBillRate = Number(billRate) || loadedCost * 2.0

    const record: Partial<ExtendedEmployee> = {
      id: 'emp-' + Date.now(),
      employee_type: selectedType,
      hourly_rate: baseWage,
      // costRate stores the loaded cost rate; billRate is the independent customer-facing rate
      costRate: loadedCost,
      billRate: finalBillRate,
      status,
      classification,
      compliance_acknowledged: false,
    }

    if (selectedType === 'permanent') {
      record.name = name.trim()
      record.role = role.trim()
      record.hire_date = hireDate || undefined
      record.separation_date = status === 'Inactive' ? separationDate || undefined : undefined
      record.classification = 'W-2'
    }

    if (selectedType === 'per_project') {
      record.name = name.trim()
      record.role = role.trim()
      record.hire_date = startDate || undefined
      record.estimated_end_date = estimatedEndDate || undefined
      record.project_id = projectId || undefined
      record.status = status as 'Active' | 'Closed'
      record.classification = classification
    }

    if (selectedType === 'hypothetical') {
      record.name = role.trim() // use role title as display name too
      record.role = role.trim()
      record.start_month = startMonth || undefined
      // Hypotheticals have no project link, no compliance
    }

    onSave(record)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      style={{ background: 'rgba(0,0,0,0.65)' }}
    >
      <div className="w-full max-w-lg bg-[#0f1117] border border-gray-700 rounded-xl shadow-2xl overflow-hidden">
        {/* Modal header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-700">
          <h2 className="text-lg font-bold text-gray-100">
            {step === 'select' ? '+ Add Team Member' : `New ${TYPE_OPTIONS.find(t => t.type === selectedType)?.label}`}
          </h2>
          <button
            onClick={onCancel}
            className="text-gray-500 hover:text-gray-300 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Step 1 — Type selector */}
        {step === 'select' && (
          <div className="p-6 space-y-3">
            {TYPE_OPTIONS.map(opt => (
              <button
                key={opt.type}
                onClick={() => handleTypeSelect(opt.type)}
                className={`w-full flex items-center gap-4 p-4 rounded-lg border ${opt.borderColor} bg-gray-800/30 hover:bg-gray-800/60 transition text-left group`}
              >
                <div className={`${opt.color} flex-shrink-0`}>{opt.icon}</div>
                <div className="flex-1">
                  <div className={`font-semibold text-sm ${opt.color}`}>{opt.label}</div>
                  <div className="text-xs text-gray-500 mt-0.5">{opt.desc}</div>
                </div>
                <ChevronRight className="w-4 h-4 text-gray-600 group-hover:text-gray-400 flex-shrink-0" />
              </button>
            ))}
          </div>
        )}

        {/* Step 2 — Form fields */}
        {step === 'form' && selectedType && (
          <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">

            {/* ── PERMANENT POSITION ── */}
            {selectedType === 'permanent' && (
              <>
                <Field label="Full Name *">
                  <input
                    className={inputCls}
                    value={name}
                    onChange={e => setName(e.target.value)}
                    placeholder="e.g. Carlos Rivera"
                  />
                </Field>
                <Field label="Role / Title *">
                  <input
                    className={inputCls}
                    value={role}
                    onChange={e => setRole(e.target.value)}
                    placeholder="e.g. Journeyman Electrician"
                  />
                </Field>
                <Field label="Hire Date">
                  <input
                    type="date"
                    className={inputCls}
                    value={hireDate}
                    onChange={e => setHireDate(e.target.value)}
                  />
                </Field>
                <Field label="Base Wage ($/hr)">
                  <input
                    type="number"
                    className={inputCls}
                    value={hourlyRate}
                    onChange={e => {
                      setHourlyRate(parseFloat(e.target.value) || '')
                      setBillRateOverridden(false)
                    }}
                    placeholder="0.00"
                    step="0.01"
                    min="0"
                  />
                </Field>
                {baseWageNum > 0 && (
                  <>
                    <Field label="Loaded Cost ($/hr) — read only">
                      <div className="flex items-center gap-2 px-3 py-2.5 bg-[#1a1d27] border border-amber-700/40 rounded text-sm">
                        <span className="text-amber-400 font-bold">${loadedCostRate.toFixed(2)}</span>
                        <span className="text-gray-500 text-xs">= base × {payrollMult}x payroll multiplier</span>
                      </div>
                    </Field>
                    <Field label="Bill Rate ($/hr) — what you charge customers">
                      <input
                        type="number"
                        className={`${inputCls} border-green-700/50 focus:border-green-500`}
                        value={billRate}
                        onChange={e => {
                          setBillRate(parseFloat(e.target.value) || '')
                          setBillRateOverridden(true)
                        }}
                        placeholder="0.00"
                        step="0.01"
                        min="0"
                      />
                    </Field>
                    {billRateNum > 0 && (
                      <div className={`flex items-center gap-2 px-3 py-2 rounded text-sm ${marginPerHour >= 0 ? 'bg-emerald-900/20 border border-emerald-700/30' : 'bg-red-900/20 border border-red-700/30'}`}>
                        {marginPerHour < 0 && <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0" />}
                        <span className="text-gray-400 text-xs">Margin/hr:</span>
                        <span className={`font-bold text-sm ${marginPerHour >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                          {marginPerHour >= 0 ? '+' : ''}${marginPerHour.toFixed(2)}
                        </span>
                      </div>
                    )}
                  </>
                )}
                {/* Classification: W-2 only for permanent */}
                <Field label="Classification">
                  <div className="flex items-center gap-2 px-3 py-2.5 bg-[#1a1d27] border border-gray-700 rounded text-sm text-gray-300">
                    <span className="bg-blue-600/40 text-blue-200 text-xs px-2 py-0.5 rounded font-semibold">W-2</span>
                    <span className="text-gray-500">Permanent employees are always W-2</span>
                  </div>
                </Field>
                <Field label="Status">
                  <select
                    className={inputCls}
                    value={status}
                    onChange={e => setStatus(e.target.value as any)}
                  >
                    <option value="Active">Active</option>
                    <option value="Inactive">Inactive</option>
                  </select>
                </Field>
                {status === 'Inactive' && (
                  <Field label="Separation Date">
                    <input
                      type="date"
                      className={inputCls}
                      value={separationDate}
                      onChange={e => setSeparationDate(e.target.value)}
                    />
                  </Field>
                )}
              </>
            )}

            {/* ── PER-PROJECT EMPLOYEE ── */}
            {selectedType === 'per_project' && (
              <>
                <Field label="Full Name *">
                  <input
                    className={inputCls}
                    value={name}
                    onChange={e => setName(e.target.value)}
                    placeholder="e.g. Miguel Torres"
                  />
                </Field>
                <Field label="Role *">
                  <input
                    className={inputCls}
                    value={role}
                    onChange={e => setRole(e.target.value)}
                    placeholder="e.g. Apprentice, Helper, Subcontractor"
                  />
                </Field>
                <Field label="Start Date">
                  <input
                    type="date"
                    className={inputCls}
                    value={startDate}
                    onChange={e => setStartDate(e.target.value)}
                  />
                </Field>
                <Field label="Estimated End Date">
                  <input
                    type="date"
                    className={inputCls}
                    value={estimatedEndDate}
                    onChange={e => setEstimatedEndDate(e.target.value)}
                  />
                </Field>
                <Field label="Base Wage ($/hr)">
                  <input
                    type="number"
                    className={inputCls}
                    value={hourlyRate}
                    onChange={e => {
                      setHourlyRate(parseFloat(e.target.value) || '')
                      setBillRateOverridden(false)
                    }}
                    placeholder="0.00"
                    step="0.01"
                    min="0"
                  />
                </Field>
                {baseWageNum > 0 && (
                  <>
                    <Field label="Loaded Cost ($/hr) — read only">
                      <div className="flex items-center gap-2 px-3 py-2.5 bg-[#1a1d27] border border-amber-700/40 rounded text-sm">
                        <span className="text-amber-400 font-bold">${loadedCostRate.toFixed(2)}</span>
                        <span className="text-gray-500 text-xs">= base × {payrollMult}x payroll multiplier</span>
                      </div>
                    </Field>
                    <Field label="Bill Rate ($/hr) — what you charge customers">
                      <input
                        type="number"
                        className={`${inputCls} border-green-700/50 focus:border-green-500`}
                        value={billRate}
                        onChange={e => {
                          setBillRate(parseFloat(e.target.value) || '')
                          setBillRateOverridden(true)
                        }}
                        placeholder="0.00"
                        step="0.01"
                        min="0"
                      />
                    </Field>
                    {billRateNum > 0 && (
                      <div className={`flex items-center gap-2 px-3 py-2 rounded text-sm ${marginPerHour >= 0 ? 'bg-emerald-900/20 border border-emerald-700/30' : 'bg-red-900/20 border border-red-700/30'}`}>
                        {marginPerHour < 0 && <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0" />}
                        <span className="text-gray-400 text-xs">Margin/hr:</span>
                        <span className={`font-bold text-sm ${marginPerHour >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                          {marginPerHour >= 0 ? '+' : ''}${marginPerHour.toFixed(2)}
                        </span>
                      </div>
                    )}
                  </>
                )}
                <Field label="Classification">
                  <select
                    className={inputCls}
                    value={classification}
                    onChange={e => setClassification(e.target.value as any)}
                  >
                    <option value="1099">1099 — Independent Contractor</option>
                    <option value="W-2">W-2 — Employee</option>
                  </select>
                </Field>
                {classification === '1099' && (
                  <div className="flex items-start gap-2 px-3 py-2.5 bg-amber-900/20 border border-amber-600/30 rounded-lg">
                    <span className="text-amber-400 text-xs mt-0.5">⚠</span>
                    <span className="text-xs text-amber-300">
                      1099 requires a written IC agreement — OHM will show a compliance checklist after save.
                    </span>
                  </div>
                )}
                <Field label="Assign to Project">
                  <select
                    className={inputCls}
                    value={projectId}
                    onChange={e => setProjectId(e.target.value)}
                  >
                    <option value="">— No project assigned —</option>
                    {activeProjects.map(p => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Status">
                  <select
                    className={inputCls}
                    value={status}
                    onChange={e => setStatus(e.target.value as any)}
                  >
                    <option value="Active">Active</option>
                    <option value="Closed">Closed</option>
                  </select>
                </Field>
              </>
            )}

            {/* ── HYPOTHETICAL (PLANNING) ── */}
            {selectedType === 'hypothetical' && (
              <>
                <div className="flex items-start gap-2 px-3 py-2.5 bg-purple-900/20 border border-purple-600/30 rounded-lg mb-2">
                  <span className="text-purple-400 text-sm mt-0.5">🔮</span>
                  <span className="text-xs text-purple-300">
                    Hypothetical positions appear in the org pyramid as PLANNED and are used for 6-Month Cost Forecast modeling only. They do not affect any real calculations.
                  </span>
                </div>
                <Field label="Role Title *">
                  <input
                    className={inputCls}
                    value={role}
                    onChange={e => setRole(e.target.value)}
                    placeholder="e.g. Helper, Apprentice, Project Manager"
                  />
                </Field>
                <Field label="Estimated Hourly Rate ($/hr)">
                  <input
                    type="number"
                    className={inputCls}
                    value={hourlyRate}
                    onChange={e => setHourlyRate(parseFloat(e.target.value) || '')}
                    placeholder="0.00"
                    step="0.01"
                    min="0"
                  />
                </Field>
                <Field label="Start Month (future planning)">
                  <input
                    type="month"
                    className={inputCls}
                    value={startMonth}
                    onChange={e => setStartMonth(e.target.value)}
                  />
                </Field>
              </>
            )}
          </div>
        )}

        {/* Footer */}
        {step === 'form' && (
          <div className="flex gap-3 px-6 py-4 border-t border-gray-700">
            <button
              onClick={() => setStep('select')}
              className="px-4 py-2.5 bg-gray-700/50 text-gray-300 rounded-lg text-sm font-semibold hover:bg-gray-700 transition"
            >
              ← Back
            </button>
            <button
              onClick={handleSave}
              className="flex-1 px-4 py-2.5 bg-blue-600/70 text-blue-100 rounded-lg text-sm font-bold hover:bg-blue-600 transition"
            >
              Save Team Member
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
