import { useState } from 'react'
import { ColorSwatchPicker, useDisplayColors } from '@/features/display-colors/DisplayColors'
import { parentDisplayColor } from '@/features/display-colors/hierarchyColors'
import { useHierarchy, type DefinitionEdit } from './HierarchyProvider'
import { btn, btnPrimary } from './ui'

export function DefinitionForm({ initial, onClose, onSaved }: { initial: DefinitionEdit; onClose: () => void; onSaved?: (key: string) => void }) {
  const { hierarchy, save } = useHierarchy()
  const [edit, setEdit] = useState(initial), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null)
  const existing = edit.type === 'category' ? hierarchy.categories.find(c => c.key === edit.key) : undefined
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); if (busy || !edit.name.trim()) return
    setBusy(true); setError(null)
    try { const key = await save(edit); onSaved?.(key); onClose() } catch (e) { setError(e instanceof Error ? e.message : 'Save failed.') } finally { setBusy(false) }
  }
  return <form onSubmit={submit} onKeyDown={e => { if (busy && e.key === 'Escape') e.stopPropagation() }} className="space-y-3 rounded-xl border border-[var(--border-primary)] bg-[var(--bg-card)] p-4" data-testid="definition-form">
    <h3 className="font-semibold">{edit.key ? 'Edit / Rename' : 'Create'} {edit.type === 'parent' ? 'parent bucket' : 'category'}</h3>
    <label className="block text-sm">Name<input autoFocus maxLength={80} required value={edit.name} disabled={busy} onChange={e => setEdit({ ...edit, name: e.target.value })} className="mt-1 min-h-[48px] w-full rounded-lg border border-[var(--border-primary)] bg-[var(--surface-1)] px-3" /></label>
    {edit.type === 'category' && <label className="block text-sm">Parent bucket<select value={edit.parentKey ?? ''} disabled={busy} onChange={e => setEdit({ ...edit, parentKey: e.target.value || null })} className="mt-1 min-h-[48px] w-full rounded-lg border border-[var(--border-primary)] bg-[var(--surface-1)] px-3">
      <option value="">No parent assigned</option>{hierarchy.parents.filter(p => !p.archived).map(p => <option key={p.key} value={p.key}>{p.name}</option>)}
    </select></label>}
    <ColorSwatchPicker label={edit.name || 'Classification'} value={edit.color ?? null} onChange={color => setEdit({ ...edit, color })} disabled={busy} />
    {edit.key && !existing?.builtin && <label className="flex min-h-[44px] items-center gap-2"><input type="checkbox" checked={edit.archived ?? false} disabled={busy} onChange={e => setEdit({ ...edit, archived: e.target.checked })} />Archived · keep historical assignments</label>}
    {existing?.builtin && <p className="text-xs text-[var(--text-secondary)]">This is your organization's display name. The built-in key and financial meaning stay unchanged. Moving it changes reporting groups, not transaction decisions.</p>}
    <p className="text-xs text-[var(--text-secondary)]">{edit.type === 'category' ? 'Saving creates or updates a reusable category. Transaction approval remains a separate action.' : 'Reporting group only. Move active categories before archiving a parent.'} Historical reports use the current hierarchy.</p>
    {error && <p role="alert" className="text-sm">{error}</p>}
    <div className="flex gap-2"><button className={btnPrimary} disabled={busy || !edit.name.trim()}>{busy ? 'Saving…' : 'Save classification'}</button><button type="button" className={btn} disabled={busy} onClick={onClose}>Cancel</button></div>
  </form>
}
export function HierarchyManager() {
  const { hierarchy } = useHierarchy(), colors = useDisplayColors()
  const [edit, setEdit] = useState<DefinitionEdit | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const enabled = hierarchy.available && hierarchy.writesEnabled
  return <section className="mt-4 space-y-3 rounded-xl border border-[var(--border-primary)] p-4" aria-label="Classification settings" data-testid="hierarchy-manager">
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">Classification settings</h3><span className="text-xs text-[var(--text-secondary)]">Parent bucket → category · one category per transaction</span></div>
    {!enabled && <p className="text-sm">{hierarchy.available?'Management is read-only. Category creation, renaming, moving and archiving await owner approval. Existing choices and color settings remain available.':'Management is read-only until the reviewed schema is available.'}</p>}
    <div className="flex flex-wrap gap-2"><button className={btn} disabled={!enabled} onClick={() => setEdit({ type: 'parent', name: '' })}>+ Create parent bucket</button><button className={btn} disabled={!enabled} onClick={() => setEdit({ type: 'category', name: '' })}>+ Create category</button></div>
    {notice && <p role="status" className="text-sm">{notice}</p>}
    {edit && <DefinitionForm key={`${edit.type}:${edit.key ?? 'new'}`} initial={edit} onClose={() => setEdit(null)} onSaved={() => setNotice('Classification saved. Names and grouping updated; transaction decisions are unchanged.')} />}
    {hierarchy.parents.map(p => <div key={p.key} className="rounded-xl bg-[var(--surface-1)] p-3">
      <button aria-label={`Edit / Rename parent bucket ${p.name}`} className="min-h-[48px] text-left font-semibold" disabled={!enabled} onClick={() => { setNotice(null); setEdit({ type: 'parent', ...p, color: parentDisplayColor(p.key, hierarchy, colors.categoryColor) }) }}><span className="mr-2 inline-block h-3 w-3 rounded-full" style={{ backgroundColor: parentDisplayColor(p.key, hierarchy, colors.categoryColor) }} />{p.name}{p.archived ? ' · Archived' : ''} <span className="text-xs font-normal">· Edit / Rename</span></button>
      <div className="flex flex-wrap gap-2">{hierarchy.categories.filter(c => c.parentKey === p.key).map(c => <button key={c.key} aria-label={`Edit / Rename category ${c.name}`} className={btn} disabled={!enabled} onClick={() => { setNotice(null); setEdit({ type: 'category', ...c, color: colors.categoryColor(c.key) }) }}>{c.name}{c.archived ? ' · Archived' : ''} · Edit / Rename</button>)}</div>
    </div>)}
    <div><h4 className="text-sm font-semibold">No parent assigned</h4>{hierarchy.categories.filter(c => !c.parentKey).map(c => <button key={c.key} aria-label={`Edit / Rename category ${c.name}`} className={`${btn} mr-2 mt-2`} disabled={!enabled} onClick={() => { setNotice(null); setEdit({ type: 'category', ...c, color: colors.categoryColor(c.key) }) }}>{c.name}{c.archived ? ' · Archived' : ''} · Edit / Rename</button>)}</div>
  </section>
}
