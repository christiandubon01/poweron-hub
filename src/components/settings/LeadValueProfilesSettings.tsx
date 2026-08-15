/**
 * Job Value Profiles — owner-managed expected job values for portal leads.
 * Persists via tenant_settings (lead_value_profiles_v1), same pattern as HomeBaseSettings.
 */

import React, { useCallback, useEffect, useState } from 'react'
import { Pencil, Plus, Trash2, X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import {
  LEAD_VALUE_SERVICE_CATEGORIES,
  LeadValueProfile,
  LeadValueProfileError,
  deleteLeadValueProfile,
  getCurrentTenantIdForProfiles,
  loadLeadValueProfiles,
  saveLeadValueProfiles,
  upsertLeadValueProfile,
} from '@/services/portal/leadValueProfiles'

type Draft = {
  id?: string
  name: string
  serviceCategory: string
  minValue: string
  maxValue: string
}

const EMPTY_DRAFT: Draft = {
  name: '',
  serviceCategory: '',
  minValue: '',
  maxValue: '',
}

function categoryLabel(value: string): string {
  return (
    LEAD_VALUE_SERVICE_CATEGORIES.find((c) => c.value === value)?.label ?? value
  )
}

function formatMoney(n: number): string {
  return `$${n.toLocaleString('en-US')}`
}

export function LeadValueProfilesSettings() {
  const [tenantId, setTenantId] = useState<string | null>(null)
  const [userId, setUserId] = useState<string | null>(null)
  const [profiles, setProfiles] = useState<LeadValueProfile[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editorOpen, setEditorOpen] = useState(false)
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT)

  const refresh = useCallback(async (tid: string) => {
    const rows = await loadLeadValueProfiles(tid)
    setProfiles(rows)
  }, [])

  useEffect(() => {
    let cancelled = false
    async function init() {
      setLoading(true)
      setError(null)
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser()
        if (!user || cancelled) return
        setUserId(user.id)
        const tid = await getCurrentTenantIdForProfiles()
        if (!tid || cancelled) return
        setTenantId(tid)
        await refresh(tid)
      } catch (err: any) {
        if (!cancelled) {
          setError(err?.message || 'Failed to load job value profiles')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void init()
    return () => {
      cancelled = true
    }
  }, [refresh])

  const openAdd = () => {
    setDraft(EMPTY_DRAFT)
    setError(null)
    setEditorOpen(true)
  }

  const openEdit = (profile: LeadValueProfile) => {
    setDraft({
      id: profile.id,
      name: profile.name,
      serviceCategory: profile.serviceCategory,
      minValue: String(profile.minValue),
      maxValue: String(profile.maxValue),
    })
    setError(null)
    setEditorOpen(true)
  }

  const persist = async (next: LeadValueProfile[]) => {
    if (!tenantId || !userId) {
      throw new LeadValueProfileError('Not authenticated. Refresh and try again.')
    }
    const saved = await saveLeadValueProfiles(tenantId, userId, next)
    setProfiles(saved)
    return saved
  }

  const handleSaveDraft = async () => {
    setSaving(true)
    setError(null)
    try {
      const next = upsertLeadValueProfile(profiles, {
        id: draft.id,
        name: draft.name,
        serviceCategory: draft.serviceCategory,
        minValue: Number(draft.minValue),
        maxValue: Number(draft.maxValue),
      })
      await persist(next)
      setEditorOpen(false)
      setDraft(EMPTY_DRAFT)
    } catch (err: any) {
      setError(err?.message || 'Failed to save profile')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (profileId: string) => {
    if (!window.confirm('Delete this job value profile?')) return
    setSaving(true)
    setError(null)
    try {
      await persist(deleteLeadValueProfile(profiles, profileId))
    } catch (err: any) {
      setError(err?.message || 'Failed to delete profile')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <p className="text-xs text-gray-500">Loading job value profiles…</p>
  }

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wider text-cyan-200/80">
            Job Value Profiles
          </h4>
          <p className="mt-1 text-[11px] leading-snug text-gray-500">
            Expected job values used when converting portal requests to Hunter leads.
            Unmatched categories leave estimated value unset.
          </p>
        </div>
        <button
          type="button"
          onClick={openAdd}
          disabled={saving}
          className="inline-flex items-center gap-1 rounded-lg border border-cyan-400/25 bg-cyan-400/10 px-2.5 py-1.5 text-[11px] font-semibold text-cyan-200 hover:bg-cyan-400/15 disabled:opacity-50"
        >
          <Plus size={12} />
          Add
        </button>
      </div>

      {error && !editorOpen && (
        <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-[11px] text-red-200">
          {error}
        </p>
      )}

      {profiles.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-700 bg-slate-950/50 px-3 py-4 text-[11px] text-gray-500">
          No profiles yet. Add ranges such as EV Charger 500–800 or Panel Upgrade 4500–6000
          when you are ready — nothing is seeded automatically.
        </div>
      ) : (
        <ul className="space-y-2">
          {profiles.map((profile) => (
            <li
              key={profile.id}
              className="flex items-center justify-between gap-3 rounded-lg border border-cyan-400/10 bg-slate-950/60 px-3 py-2"
            >
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-gray-100">{profile.name}</div>
                <div className="mt-0.5 text-[11px] text-gray-400">
                  {categoryLabel(profile.serviceCategory)} · {formatMoney(profile.minValue)}–
                  {formatMoney(profile.maxValue)}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={() => openEdit(profile)}
                  disabled={saving}
                  className="rounded-md p-1.5 text-gray-400 hover:bg-cyan-400/10 hover:text-cyan-200 disabled:opacity-50"
                  title="Edit profile"
                >
                  <Pencil size={13} />
                </button>
                <button
                  type="button"
                  onClick={() => void handleDelete(profile.id)}
                  disabled={saving}
                  className="rounded-md p-1.5 text-gray-400 hover:bg-red-500/10 hover:text-red-300 disabled:opacity-50"
                  title="Delete profile"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {editorOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-2xl border border-cyan-400/20 bg-slate-950 p-4 shadow-2xl shadow-blue-950/40">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h3 className="text-sm font-bold text-gray-100">
                {draft.id ? 'Edit Job Value Profile' : 'Add Job Value Profile'}
              </h3>
              <button
                type="button"
                onClick={() => setEditorOpen(false)}
                className="rounded-md p-1 text-gray-400 hover:bg-slate-800 hover:text-gray-200"
              >
                <X size={16} />
              </button>
            </div>

            <div className="space-y-3">
              <label className="block">
                <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                  Name
                </span>
                <input
                  value={draft.name}
                  onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                  placeholder="e.g. EV Charger"
                  className="w-full rounded-lg border border-cyan-400/20 bg-slate-900 px-3 py-2 text-sm text-gray-100 placeholder:text-gray-600 focus:border-cyan-400/50 focus:outline-none"
                />
              </label>

              <label className="block">
                <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                  Matching service category
                </span>
                <select
                  value={draft.serviceCategory}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, serviceCategory: e.target.value }))
                  }
                  className="w-full rounded-lg border border-cyan-400/20 bg-slate-900 px-3 py-2 text-sm text-gray-100 focus:border-cyan-400/50 focus:outline-none"
                >
                  <option value="">Select category…</option>
                  {LEAD_VALUE_SERVICE_CATEGORIES.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </label>

              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                    Minimum expected value
                  </span>
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={draft.minValue}
                    onChange={(e) => setDraft((d) => ({ ...d, minValue: e.target.value }))}
                    placeholder="500"
                    className="w-full rounded-lg border border-cyan-400/20 bg-slate-900 px-3 py-2 text-sm text-gray-100 placeholder:text-gray-600 focus:border-cyan-400/50 focus:outline-none"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                    Maximum expected value
                  </span>
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={draft.maxValue}
                    onChange={(e) => setDraft((d) => ({ ...d, maxValue: e.target.value }))}
                    placeholder="800"
                    className="w-full rounded-lg border border-cyan-400/20 bg-slate-900 px-3 py-2 text-sm text-gray-100 placeholder:text-gray-600 focus:border-cyan-400/50 focus:outline-none"
                  />
                </label>
              </div>

              {error && (
                <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-[11px] text-red-200">
                  {error}
                </p>
              )}

              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setEditorOpen(false)}
                  disabled={saving}
                  className="rounded-lg border border-gray-700 bg-slate-900 px-3 py-2 text-xs font-semibold text-gray-300 hover:bg-slate-800 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void handleSaveDraft()}
                  disabled={saving}
                  className="rounded-lg border border-cyan-400/25 bg-cyan-400/10 px-3 py-2 text-xs font-semibold text-cyan-200 hover:bg-cyan-400/15 disabled:opacity-50"
                >
                  {saving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default LeadValueProfilesSettings
