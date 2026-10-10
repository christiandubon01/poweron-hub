import { useRef, useState } from 'react'
import { ColorSwatchPicker, useDisplayColors } from '@/features/display-colors/DisplayColors'
import { parentColorKey, parentDisplayColor } from '@/features/display-colors/hierarchyColors'
import { useHierarchy, type DefinitionEdit } from './HierarchyProvider'
import { btn, btnPrimary } from './ui'
import type { CleanupPreview } from '@/services/bankProvider/spending/definitionCleanup'
import { authedJsonHeaders } from '@/services/authedFetch'
import { defaultHierarchy } from '@/finance/bankSpendingHierarchy'

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
/** Navigation folders only: these never classify ownership or change persisted parent membership. */
const BUSINESS_PARENTS = new Set(['vehicle','overhead','materials','tools','insurance','people','permits','marketing','meals','taxes','business'])
const BUILTIN_PARENTS = new Set(defaultHierarchy().parents.map(p=>p.key))
const folderFor = (key: string) => key === 'personal' ? 'personal' : BUSINESS_PARENTS.has(key) ? 'business' : ['income','movement'].includes(key) ? 'activity' : 'unorganized'
export function HierarchyManager() {
  const { hierarchy } = useHierarchy(), colors = useDisplayColors()
  const [edit, setEdit] = useState<DefinitionEdit | null>(null), [notice, setNotice] = useState<string | null>(null)
  const [colorEdit,setColorEdit]=useState<DefinitionEdit|null>(null)
  const [cleanup,setCleanup]=useState<{definition:DefinitionEdit;action:'Merge'|'Delete'|'Convert to category'}|null>(null)
  const [inventory,setInventory]=useState<CleanupPreview|null>(null),[inventoryError,setInventoryError]=useState<string|null>(null),[loading,setLoading]=useState(false),[target,setTarget]=useState('')
  const [conversionName,setConversionName]=useState('')
  const sequence=useRef(0)
  const enabled = hierarchy.available && hierarchy.writesEnabled
  const startEdit=(d:DefinitionEdit)=>{setNotice(null);setColorEdit(null);setEdit(d)}
  const preview=async(d:DefinitionEdit,action:'Merge'|'Delete'|'Convert to category')=>{
    const current=++sequence.current
    setCleanup({definition:d,action});setInventory(null);setInventoryError(null);setTarget('');setConversionName(d.name);setLoading(true)
    try {
      const headers=await authedJsonHeaders()
      const response=await fetch(`/.netlify/functions/plaid-spending?definition_preview=${encodeURIComponent(d.key!)}&definition_type=${d.type}`,{headers})
      if(!response.ok)throw new Error('Reference check unavailable. No cleanup is permitted.')
      const result=await response.json()
      if(result.executionAllowed!==false || !Array.isArray(result.references) || !result.counts)throw new Error('Reference coverage is unverified.')
      if(current===sequence.current)setInventory(result)
    }catch(e){if(current===sequence.current)setInventoryError(e instanceof Error?e.message:'Reference check unavailable.')}finally{if(current===sequence.current)setLoading(false)}
  }
  const actions=(d:DefinitionEdit,builtin=false)=><div className="flex flex-wrap gap-2" aria-label={`Actions for ${d.name}`}>
    {d.type==='parent'&&<button className={btn} disabled={!enabled||d.archived} onClick={()=>startEdit({type:'category',name:'',parentKey:d.key})}>+ Add category</button>}
    <button className={btn} disabled={!enabled} aria-label={`Edit / Rename ${d.type==='parent'?'parent bucket':'category'} ${d.name}`} onClick={()=>startEdit(d)}>Rename</button>
    <button className={btn} disabled={d.key==='other_needs_review'||!colors.enabled} onClick={()=>{setColorEdit(d);setEdit(null)}}>Change Color</button>
    {d.type==='category'&&<button className={btn} disabled={!enabled} onClick={()=>startEdit(d)}>Move</button>}
    {d.type==='parent'&&<button className={btn} disabled title="Changing navigation-root membership requires an explicit persisted organization setting or a reviewed conversion plan.">Move · pending</button>}
    <button className={btn} disabled={!enabled||builtin} title={builtin?'Built-in categories cannot be archived':undefined} onClick={()=>startEdit(d)}>{d.archived?'Restore':'Archive'}</button>
    <button className={btn} onClick={()=>void preview(d,'Merge')}>Merge preview</button>
    <button className={btn} disabled={builtin} title={builtin?'Built-in definitions cannot be deleted':undefined} onClick={()=>void preview(d,'Delete')}>Delete preview</button>
    {d.type==='parent'&&<button className={btn} onClick={()=>void preview(d,'Convert to category')}>Conversion preview</button>}
  </div>
  const leaf=(c:typeof hierarchy.categories[number])=>{
    const d:DefinitionEdit={type:'category',...c,color:colors.categoryColor(c.key)}
    return <li key={c.key} className="relative border-l border-[var(--border-primary)] py-3 pl-5" data-testid="settings-leaf" data-key={c.key}>
      <span aria-hidden="true" className="absolute left-0 top-6 w-3 border-t border-[var(--border-primary)]"/>
      <p className="mb-2 flex items-center gap-2 font-medium"><span className="h-3 w-3 shrink-0 rounded-full" style={{backgroundColor:colors.categoryColor(c.key)??'var(--text-secondary)'}}/>{c.name}{c.archived?' · Archived':''}<span className="text-xs font-normal text-[var(--text-secondary)]">Category{c.builtin?' · built-in':''}</span></p>{actions(d,c.builtin)}
    </li>
  }
  return <section className="mt-4 space-y-3 rounded-xl border border-[var(--border-primary)] p-3 sm:p-4" aria-label="Classification settings" data-testid="hierarchy-manager">
    <h3 className="font-semibold">Settings · Spending categories</h3>
    <p className="text-xs text-[var(--text-secondary)]">Business and Personal are navigation folders, not financial decisions. Existing parent groups and assignments stay intact. Names never establish a debt, business or personal relationship.</p>
    {!enabled&&<p className="text-sm">Classification management is read-only until its schema and organization write gate are available. Display colors remain separate.</p>}
    <div className="flex flex-wrap gap-2"><button className={btn} disabled={!enabled} onClick={()=>startEdit({type:'parent',name:''})}>+ Create parent bucket</button><button className={btn} disabled={!enabled} onClick={()=>startEdit({type:'category',name:''})}>+ Create category</button></div>
    {notice&&<p role="status" className="text-sm">{notice}</p>}
    {edit&&<DefinitionForm key={`${edit.type}:${edit.key??'new'}`} initial={edit} onClose={()=>setEdit(null)} onSaved={()=>setNotice('Classification saved. Names and grouping updated; transaction decisions are unchanged.')}/>}
    {colorEdit&&<div className="space-y-3 rounded-xl border border-[var(--border-primary)] p-3"><ColorSwatchPicker label={colorEdit.name} value={colorEdit.type==='parent'?colors.categoryColor(parentColorKey(colorEdit.key!))??colorEdit.color??null:colors.categoryColor(colorEdit.key!)} onChange={color=>void colors.setColor('category',colorEdit.type==='parent'?parentColorKey(colorEdit.key!):colorEdit.key!,color)}/>{colors.error&&<p role="alert">{colors.error}</p>}<p className="text-xs">Colors save immediately through the existing shared palette; they never approve transactions.</p><button className={btn} onClick={()=>setColorEdit(null)}>Done</button></div>}
    {cleanup&&<section className="space-y-3 rounded-xl border border-[var(--border-primary)] p-3" aria-label="Category cleanup preview" data-testid="cleanup-preview">
      <h4 className="font-semibold">{cleanup.action} preview · {cleanup.definition.name}</h4>
      <p className="text-xs">Source key: {cleanup.definition.key}. No records will change from this preview.</p>
      {loading&&<p role="status">Checking references…</p>}{inventoryError&&<p role="alert">{inventoryError}</p>}
      {inventory&&<><p className="text-sm">{inventory.complete?'All rows returned for the two listed tables at their read times.':'Partial reference list · not all matching records are displayed.'} This is not deletion eligibility.</p>
        <ul className="text-sm">{Object.entries(inventory.counts).map(([table,count])=><li key={table}>{table==='financial_provider_interpretations'?'Current and historical decisions':'Merchant rules (all statuses)'}: {count}</li>)}</ul>
        {inventory.children.length>0&&<p className="text-sm">Children: {inventory.children.map(c=>c.name).join(', ')}</p>}
        <div className="max-h-64 overflow-auto break-words text-xs"><ul>{inventory.references.map(r=><li key={`${r.table}:${r.id}`} className="border-b border-[var(--border-primary)] py-2">{r.table==='financial_provider_interpretations'?'Decision':'Merchant rule'} {r.id} · {r.status} · category {r.category}{r.provider_transaction_ref?` · transaction ${r.provider_transaction_ref}`:''}</li>)}</ul></div><p className="text-xs">{inventory.reason}</p></>}
      {cleanup.action==='Convert to category'&&<label className="block text-sm">Proposed new category name<input className="mt-1 min-h-[48px] w-full rounded-lg bg-[var(--surface-1)] px-3" maxLength={80} value={conversionName} onChange={e=>setConversionName(e.target.value)}/></label>}
      {cleanup.action!=='Delete'&&<label className="block text-sm">{cleanup.action==='Merge'?'Proposed destination':'Parent for new category and relocated children'}<select className="mt-1 min-h-[48px] w-full rounded-lg bg-[var(--surface-1)] px-3" value={target} onChange={e=>setTarget(e.target.value)}><option value="">Choose a destination</option>{(cleanup.definition.type==='parent'?hierarchy.parents:hierarchy.categories).filter(d=>d.key!==cleanup.definition.key&&!d.archived).map(d=><option key={d.key} value={d.key}>{d.name}{'parentKey'in d?` · ${hierarchy.parents.find(p=>p.key===d.parentKey)?.name??'No parent'}`:''}</option>)}</select></label>}
      {target&&<p className="text-sm">Proposed {cleanup.definition.type==='parent'?'child membership':'category-only reassignment'} plan: {cleanup.definition.name} → {hierarchy.categories.find(c=>c.key===target)?.name??hierarchy.parents.find(p=>p.key===target)?.name}. Exact current-record changes and conflicts require an atomic final preview. Financial relationships and evidence must remain unchanged; historical decision rows must never be rewritten.</p>}
      {cleanup.action==='Convert to category'&&<p className="text-sm">Draft migration plan: create “{conversionName.trim()||'new category'}” with a distinct leaf key under the chosen parent; relocate the listed children there without changing their keys or transaction assignments; preserve old identity/history and retire the old parent only when eligible. Duplicate names, built-in protections and reference conflicts require final review. No identity or type mutation.</p>}
      {cleanup.action==='Delete'&&inventory&&Object.values(inventory.counts).some(n=>n>0)&&<button className={btn} onClick={()=>void preview(cleanup.definition,'Merge')}>Review merge instead</button>}
      <p className="text-sm">Execution disabled pending reviewed cleanup SQL and separate owner approval. Built-in identities cannot be deleted; historical references prevent ordinary deletion. Archive is available through the existing editor.</p>
      <div className="flex flex-wrap gap-2"><button className={btnPrimary} disabled>Confirm {cleanup.action.toLowerCase()} · unavailable</button><button className={btn} onClick={()=>{++sequence.current;setLoading(false);setCleanup(null)}}>Close preview</button></div>
    </section>}
    <div aria-label="Spending category tree" data-testid="settings-tree" className="space-y-3">
      {([['business','Business'],['personal','Personal'],['activity','Other money activity'],['unorganized','Unorganized groups']]as const).map(([folder,label])=><details key={folder} open={folder==='business'||folder==='personal'} className="rounded-xl bg-[var(--surface-1)] p-3">
        <summary className="min-h-[48px] cursor-pointer py-3 text-base font-semibold">{label}</summary>
        {(folder==='business'||folder==='personal')&&<button className={btn} disabled={!enabled} onClick={()=>startEdit({type:'category',name:'',parentKey:folder==='personal'?hierarchy.parents.find(p=>p.key==='personal'&&!p.archived)?.key??null:hierarchy.parents.find(p=>p.key==='business'&&!p.archived)?.key??hierarchy.parents.find(p=>p.key==='overhead'&&!p.archived)?.key??null})}>+ Add {label.toLowerCase()} category</button>}
        <ul className="ml-2 border-l border-[var(--border-primary)] pl-4 sm:ml-3">{hierarchy.parents.filter(p=>folderFor(p.key)===folder).map(p=><li key={p.key} className="relative py-2" data-testid="settings-parent" data-key={p.key}>
          <span aria-hidden="true" className="absolute -left-4 top-7 w-3 border-t border-[var(--border-primary)]"/>
          <details><summary className="min-h-[48px] cursor-pointer py-3 font-semibold"><span className="mr-2 inline-block h-3 w-3 rounded-full" style={{backgroundColor:parentDisplayColor(p.key,hierarchy,colors.categoryColor)}}/>{p.name}{p.archived?' · Archived':''}<span className="ml-2 text-xs font-normal">Parent bucket</span></summary>
            {actions({type:'parent',...p,color:parentDisplayColor(p.key,hierarchy,colors.categoryColor)},BUILTIN_PARENTS.has(p.key))}
            <ul className="ml-2 sm:ml-4">{hierarchy.categories.filter(c=>c.parentKey===p.key).map(leaf)}</ul>
          </details>
        </li>)}</ul>
        {folder==='unorganized'&&<><p className="py-2 text-sm">No parent assigned</p><ul className="ml-2">{hierarchy.categories.filter(c=>!c.parentKey||!hierarchy.parents.some(p=>p.key===c.parentKey)).map(leaf)}</ul></>}
      </details>)}
    </div>
  </section>
}
