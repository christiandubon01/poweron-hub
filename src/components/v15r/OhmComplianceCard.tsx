// @ts-nocheck
/**
 * OhmComplianceCard.tsx — Non-blocking OHM compliance alert for employee saves.
 *
 * Shows after an employee record is saved (never blocks the save).
 * Renders different checklists for W-2 (permanent) vs 1099 (per_project).
 * Hypothetical employees receive no compliance card.
 *
 * Usage:
 *   <OhmComplianceCard
 *     employeeType="permanent"   // or "per_project"
 *     employeeName="John Doe"
 *     onDismiss={() => setShowCard(false)}
 *     onAcknowledge={() => { markAcknowledged(); setShowCard(false) }}
 *   />
 */

import React, { useState } from 'react'
import { AlertCircle, CheckSquare, Square, X, ShieldCheck } from 'lucide-react'
import type { EmployeeType } from './employeeTypes'

// ── W-2 checklist items ───────────────────────────────────────────────────────
const W2_CHECKLIST = [
  { id: 'i9',   label: 'Form I-9 (identity + work authorization)' },
  { id: 'w4',   label: 'Form W-4 (federal withholding)' },
  { id: 'de4',  label: 'CA DE-4 (state withholding)' },
  { id: 'dfeh', label: 'DFEH harassment prevention notice' },
  { id: 'wc',   label: 'Workers comp certificate (required for ANY CA employee)' },
  { id: 'ea',   label: 'Written employment agreement' },
  { id: 'biz',  label: 'Riverside County: confirm business license covers work location' },
]

// ── 1099 checklist items ──────────────────────────────────────────────────────
const IC_CHECKLIST = [
  { id: 'w9',    label: 'Form W-9' },
  { id: 'ica',   label: 'Written Independent Contractor Agreement' },
  { id: 'ctrl',  label: 'Agreement must NOT include behavioral control language' },
  { id: 'abc_a', label: 'ABC Test — A) Worker is free from your control and direction' },
  { id: 'abc_b', label: 'ABC Test — B) Work is outside your usual business (electrical contracting)' },
  { id: 'abc_c', label: 'ABC Test — C) Worker has an established independent business' },
]

interface OhmComplianceCardProps {
  employeeType: EmployeeType
  employeeName: string
  classification?: 'W-2' | '1099'
  onDismiss: () => void
  onAcknowledge: () => void
}

export default function OhmComplianceCard({
  employeeType,
  employeeName,
  classification,
  onDismiss,
  onAcknowledge,
}: OhmComplianceCardProps) {
  // Hypothetical employees never get a compliance card
  if (employeeType === 'hypothetical') return null

  const isW2 = classification === 'W-2' || employeeType === 'permanent'
  const checklist = isW2 ? W2_CHECKLIST : IC_CHECKLIST
  const [checked, setChecked] = useState<Record<string, boolean>>({})

  const allChecked = checklist.every(item => checked[item.id])

  const toggle = (id: string) => {
    setChecked(prev => ({ ...prev, [id]: !prev[id] }))
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center px-4 pb-4 sm:pb-0"
      style={{ background: 'rgba(0,0,0,0.55)' }}
    >
      <div className="w-full max-w-lg bg-[#0f1117] border border-yellow-500/60 rounded-xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-start justify-between p-5 border-b border-yellow-500/30 bg-yellow-500/10">
          <div className="flex items-center gap-3">
            <AlertCircle className="w-6 h-6 text-yellow-400 flex-shrink-0 mt-0.5" />
            <div>
              <div className="text-sm font-bold text-yellow-300 uppercase tracking-wide">
                OHM Compliance
              </div>
              <div className="text-base font-semibold text-gray-100 mt-0.5">
                {isW2 ? 'California W-2 Employee' : 'California 1099 Contractor'}
                {' '}— Required Documents
              </div>
              <div className="text-xs text-gray-400 mt-0.5">For: {employeeName}</div>
            </div>
          </div>
          <button
            onClick={onDismiss}
            className="text-gray-500 hover:text-gray-300 transition ml-3"
            title="Dismiss"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Checklist */}
        <div className="p-5 space-y-2">
          {checklist.map(item => (
            <button
              key={item.id}
              onClick={() => toggle(item.id)}
              className="w-full flex items-start gap-3 text-left group"
            >
              {checked[item.id]
                ? <CheckSquare className="w-5 h-5 text-emerald-400 flex-shrink-0 mt-0.5" />
                : <Square className="w-5 h-5 text-gray-600 flex-shrink-0 mt-0.5 group-hover:text-gray-400" />
              }
              <span className={`text-sm leading-snug transition ${checked[item.id] ? 'text-gray-400 line-through' : 'text-gray-200'}`}>
                {item.label}
              </span>
            </button>
          ))}
        </div>

        {/* Warning banners */}
        {isW2 && (
          <div className="mx-5 mb-4 p-3 bg-red-900/30 border border-red-600/40 rounded-lg">
            <p className="text-xs text-red-300 font-semibold">
              ⚠ Workers comp is required before the first day of work in California — no exceptions.
            </p>
          </div>
        )}

        {!isW2 && (
          <div className="mx-5 mb-4 p-3 bg-orange-900/30 border border-orange-600/40 rounded-lg">
            <p className="text-xs text-orange-300 font-semibold">
              ⚠ Misclassification is a major CA risk. If this worker fails the ABC test,
              they must be classified as W-2 — not 1099.
            </p>
          </div>
        )}

        {/* Footer actions */}
        <div className="flex gap-3 px-5 pb-5">
          <button
            onClick={onDismiss}
            className="flex-1 px-4 py-2.5 bg-gray-700/60 text-gray-300 rounded-lg text-sm font-semibold hover:bg-gray-700 transition"
          >
            Review Later
          </button>
          <button
            onClick={onAcknowledge}
            className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold transition ${
              allChecked
                ? 'bg-emerald-600/70 text-emerald-100 hover:bg-emerald-600'
                : 'bg-gray-700/40 text-gray-500 cursor-default'
            }`}
            disabled={!allChecked}
            title={allChecked ? 'Mark compliance acknowledged' : 'Check all items to acknowledge'}
          >
            <ShieldCheck className="w-4 h-4" />
            Acknowledge All
          </button>
        </div>
      </div>
    </div>
  )
}
