// @ts-nocheck
/**
 * V15rTriggerMatrix — 8 business trigger rules matching v15r layout
 *
 * Features:
 * - 8 editable trigger rules
 * - Condition / Threshold / Review / Solution
 * - Color-coded by trigger type/color
 * - Toggle active/inactive
 * - Editable fields (saves to localStorage)
 */

import { useState, useMemo } from 'react'
import { Shield, AlertTriangle, Edit3, Save, X, Zap } from 'lucide-react'
import { getBackupData, saveBackupData, type BackupData } from '@/services/backupDataService'
import ImportBackupButton from '@/components/ImportBackupButton'

interface TriggerRule {
  id: string
  name: string
  type: string
  color: string
  active: boolean
  condition: string
  threshold: string
  thresholdLabel: string
  situation: string
  review: string
  solution: string
  reflection: string
}

const COLOR_MAP: Record<string, string> = {
  red: 'border-l-red-500 bg-red-500/5',
  orange: 'border-l-orange-500 bg-orange-500/5',
  yellow: 'border-l-yellow-500 bg-yellow-500/5',
  green: 'border-l-emerald-500 bg-emerald-500/5',
  blue: 'border-l-blue-500 bg-blue-500/5',
  purple: 'border-l-purple-500 bg-purple-500/5',
  cyan: 'border-l-cyan-500 bg-cyan-500/5',
  pink: 'border-l-pink-500 bg-pink-500/5',
}

const COLOR_BADGE: Record<string, string> = {
  red: 'bg-red-500/20 text-red-400',
  orange: 'bg-orange-500/20 text-orange-400',
  yellow: 'bg-yellow-500/20 text-yellow-400',
  green: 'bg-emerald-500/20 text-emerald-400',
  blue: 'bg-blue-500/20 text-blue-400',
  purple: 'bg-purple-500/20 text-purple-400',
  cyan: 'bg-cyan-500/20 text-cyan-400',
  pink: 'bg-pink-500/20 text-pink-400',
}

export default function V15rTriggerMatrix() {
  const backup = getBackupData()
  if (!backup) return <NoData />

  const rules: TriggerRule[] = ((backup as any)?.triggerRules || [])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<TriggerRule | null>(null)

  function startEdit(rule: TriggerRule) {
    setEditingId(rule.id)
    setEditForm({ ...rule })
  }

  function cancelEdit() {
    setEditingId(null)
    setEditForm(null)
  }

  function saveEdit() {
    if (!editForm || !backup) return
    const updatedRules = (rules || []).map(r => r.id === editForm.id ? editForm : r)
    const updated: BackupData = {
      ...backup,
      triggerRules: updatedRules,
    } as any
    saveBackupData(updated)
    setEditingId(null)
    setEditForm(null)
    window.location.reload()
  }

  function toggleActive(ruleId: string) {
    if (!backup) return
    const updatedRules = (rules || []).map(r =>
      r.id === ruleId ? { ...r, active: !r.active } : r
    )
    const updated: BackupData = {
      ...backup,
      triggerRules: updatedRules,
    } as any
    saveBackupData(updated)
    window.location.reload()
  }

  const activeCount = (rules || []).filter(r => r.active).length

  return (
    <div className="space-y-6 p-5 min-h-screen">
      <ImportBackupButton />

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Shield size={20} className="text-cyan-400" />
          <h2 className="text-lg font-bold text-gray-200 uppercase tracking-wider">
            Trigger Matrix ({(rules || []).length} rules)
          </h2>
        </div>
        <span className="text-[10px] text-gray-500">
          {activeCount} active / {(rules || []).length - activeCount} inactive
        </span>
      </div>

      {/* Trigger Cards */}
      <div className="space-y-3">
        {(rules || []).map((rule, idx) => {
          const isEditing = editingId === rule.id
          const colorClass = COLOR_MAP[rule.color] || 'border-l-gray-500 bg-gray-500/5'
          const badgeClass = COLOR_BADGE[rule.color] || 'bg-gray-500/20 text-gray-400'

          return (
            <div
              key={rule.id || idx}
              className={`rounded-xl border border-gray-700 border-l-4 ${colorClass} ${!rule.active ? 'opacity-50' : ''}`}
            >
              {isEditing && editForm ? (
                /* Edit Mode */
                <div className="p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-gray-300">Editing: {rule.name}</span>
                    <div className="flex items-center gap-2">
                      <button onClick={saveEdit} className="flex items-center gap-1 text-[10px] text-emerald-400 hover:text-emerald-300">
                        <Save size={12} /> Save
                      </button>
                      <button onClick={cancelEdit} className="flex items-center gap-1 text-[10px] text-gray-500 hover:text-gray-300">
                        <X size={12} /> Cancel
                      </button>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="space-y-1">
                      <span className="text-[10px] text-gray-500 uppercase">Name</span>
                      <input value={editForm.name} onChange={e => setEditForm({ ...editForm, name: e.target.value })}
                        className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-xs text-gray-300" />
                    </label>
                    <label className="space-y-1">
                      <span className="text-[10px] text-gray-500 uppercase">Type</span>
                      <input value={editForm.type} onChange={e => setEditForm({ ...editForm, type: e.target.value })}
                        className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-xs text-gray-300" />
                    </label>
                    <label className="space-y-1">
                      <span className="text-[10px] text-gray-500 uppercase">Threshold Label</span>
                      <input value={editForm.thresholdLabel} onChange={e => setEditForm({ ...editForm, thresholdLabel: e.target.value })}
                        className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-xs text-gray-300" />
                    </label>
                    <label className="space-y-1">
                      <span className="text-[10px] text-gray-500 uppercase">Threshold</span>
                      <input value={editForm.threshold} onChange={e => setEditForm({ ...editForm, threshold: e.target.value })}
                        className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-xs text-gray-300" />
                    </label>
                  </div>
                  <label className="space-y-1 block">
                    <span className="text-[10px] text-gray-500 uppercase">Condition</span>
                    <textarea value={editForm.condition} onChange={e => setEditForm({ ...editForm, condition: e.target.value })} rows={2}
                      className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-xs text-gray-300" />
                  </label>
                  <label className="space-y-1 block">
                    <span className="text-[10px] text-gray-500 uppercase">Review</span>
                    <textarea value={editForm.review} onChange={e => setEditForm({ ...editForm, review: e.target.value })} rows={2}
                      className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-xs text-gray-300" />
                  </label>
                  <label className="space-y-1 block">
                    <span className="text-[10px] text-gray-500 uppercase">Solution</span>
                    <textarea value={editForm.solution} onChange={e => setEditForm({ ...editForm, solution: e.target.value })} rows={2}
                      className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-xs text-gray-300" />
                  </label>
                </div>
              ) : (
                /* Display Mode */
                <div className="p-4">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-mono font-bold text-gray-500">T{String(idx + 1).padStart(2, '0')}</span>
                      <span className="text-xs font-bold text-gray-200">{rule.name}</span>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${badgeClass}`}>{rule.type}</span>
                      {!rule.active && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-600/20 text-gray-500">Inactive</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => toggleActive(rule.id)}
                        className={`text-[10px] px-2 py-0.5 rounded ${rule.active ? 'text-emerald-400 hover:text-emerald-300' : 'text-gray-500 hover:text-gray-300'}`}
                      >
                        {rule.active ? 'Active' : 'Enable'}
                      </button>
                      <button
                        onClick={() => startEdit(rule)}
                        className="text-gray-500 hover:text-gray-300"
                      >
                        <Edit3 size={12} />
                      </button>
                    </div>
                  </div>

                  {/* Info Grid */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-[10px]">
                    {rule.condition && (
                      <div>
                        <span className="text-gray-500 uppercase font-bold tracking-wider">Condition</span>
                        <p className="text-gray-300 mt-0.5">{rule.condition}</p>
                      </div>
                    )}
                    {rule.threshold && (
                      <div>
                        <span className="text-gray-500 uppercase font-bold tracking-wider">
                          {rule.thresholdLabel || 'Threshold'}
                        </span>
                        <p className="text-gray-300 mt-0.5 font-mono">{rule.threshold}</p>
                      </div>
                    )}
                    {rule.situation && (
                      <div>
                        <span className="text-gray-500 uppercase font-bold tracking-wider">Situation</span>
                        <p className="text-gray-300 mt-0.5">{rule.situation}</p>
                      </div>
                    )}
                    {rule.review && (
                      <div>
                        <span className="text-gray-500 uppercase font-bold tracking-wider">Review</span>
                        <p className="text-gray-300 mt-0.5">{rule.review}</p>
                      </div>
                    )}
                    {rule.solution && (
                      <div className="md:col-span-2">
                        <span className="text-gray-500 uppercase font-bold tracking-wider">Solution</span>
                        <p className="text-gray-300 mt-0.5">{rule.solution}</p>
                      </div>
                    )}
                    {rule.reflection && (
                      <div className="md:col-span-2">
                        <span className="text-gray-500 uppercase font-bold tracking-wider">Reflection</span>
                        <p className="text-gray-400 mt-0.5 italic">{rule.reflection}</p>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {(rules || []).length === 0 && (
        <div className="text-center text-gray-500 py-10 text-sm">
          No trigger rules found. Import your v15r backup to load your trigger matrix.
        </div>
      )}

      <div className="text-[10px] text-gray-600 flex items-center gap-1">
        <Zap size={10} /> NEXUS AI monitors triggers in real-time when field logs are saved
      </div>
    </div>
  )
}

function NoData() {
  return (
    <div className="p-6 space-y-4">
      <ImportBackupButton />
      <div className="text-center text-gray-500 py-20">
        <p className="text-lg font-semibold mb-2">No trigger rules loaded</p>
        <p className="text-sm">Import your v15r backup file to see your trigger matrix</p>
      </div>
    </div>
  )
}
