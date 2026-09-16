import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, MoreHorizontal, Plus } from 'lucide-react'
import { AttentionItem, ChangesetSummary, ConnectionFreshness, ProviderModelBadge, RoleRelay, RunStatus, TaskRow, TowerPanel, VerifierState } from './ControlTowerPrimitives'
import { CONTROL_TOWER_SCENARIOS, type PreviewScenario } from './controlTowerPreview'
import TaskInspector from './TaskInspector'
import LinkedAppBrain from './LinkedAppBrain'

export default function ControlTower() {
  const [scenario, setScenario] = useState<PreviewScenario>('working')
  const preview = CONTROL_TOWER_SCENARIOS[scenario]
  const [selectedId, setSelectedId] = useState<string | null>('validation')
  const [inspectorSection, setInspectorSection] = useState<'Details' | 'Attempt' | 'Evidence'>('Details')
  const [mode, setMode] = useState<'work' | 'map' | 'details'>('work')
  const [showAllAttention, setShowAllAttention] = useState(false)
  const [inspectorOpen, setInspectorOpen] = useState(false)
  const [sheetMode, setSheetMode] = useState(false)
  const shellRef = useRef<HTMLElement>(null)
  const taskTriggerRef = useRef<HTMLElement | null>(null)
  const detailsRef = useRef<HTMLButtonElement>(null)
  const selected = preview.tasks.find(task => task.id === selectedId) ?? null
  const selectTask = (id: string | null, section: typeof inspectorSection = 'Details') => {
    taskTriggerRef.current = document.activeElement as HTMLElement
    setSelectedId(id)
    setInspectorSection(section)
    setMode('details')
    setInspectorOpen(true)
    // On compact layouts the initiating row becomes hidden; retain keyboard context.
    if (detailsRef.current?.getClientRects().length) detailsRef.current.focus()
  }
  const restoreTaskFocus = () => requestAnimationFrame(() => {
    const trigger = taskTriggerRef.current
    if (trigger?.getClientRects().length && trigger !== document.body) trigger.focus()
    else shellRef.current?.querySelector<HTMLButtonElement>('.ct-compact-modes button')?.focus()
  })
  const backToTasks = () => { setMode('work'); setInspectorOpen(false); restoreTaskFocus() }
  useEffect(() => {
    if (!shellRef.current || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(([entry]) => {
      setSheetMode(entry.contentRect.width >= 850 && entry.contentRect.width < 1080)
      // The workspace fills from the shell top down to a 24px bottom floor; measured, never assumed.
      if (entry.contentRect.width > 0) shellRef.current?.style.setProperty('--ct-top', `${Math.max(0, Math.round(entry.target.getBoundingClientRect().top))}px`)
    })
    observer.observe(shellRef.current)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    if (!inspectorOpen) return
    const panel = shellRef.current?.querySelector<HTMLElement>('.ct-inspector')
    // The sheet and compact back path share one inspector; wide selection never steals focus.
    const back = panel?.querySelector<HTMLButtonElement>('.ct-inspector-back')
    if (back?.getClientRects().length) back.focus()
    const onKey = (event: KeyboardEvent) => {
      if (!back?.getClientRects().length) return
      if (event.key === 'Escape') { setInspectorOpen(false); setMode('work'); restoreTaskFocus() }
      if (event.key === 'Tab' && getComputedStyle(panel!).position === 'fixed') {
        const controls = panel!.querySelectorAll<HTMLElement>('button,summary,select')
        const first = controls[0], last = controls[controls.length - 1]
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [inspectorOpen, sheetMode])

  const attention = preview.attention
  const gated = attention.some(item => item.kind === 'gate')
  const passedCount = preview.tasks.filter(task => task.state === 'passed').length
  // The spine is traversed through the last task that has begun; ahead of the frontier it stays dashed.
  const frontierIndex = preview.tasks.reduce((last, task, index) => task.state === 'pending-ready' || task.state === 'pending-waiting' ? last : index, -1)

  return <div className="ct-container"><main ref={shellRef} className="ct-shell" data-mode={mode} data-inspector-open={inspectorOpen} data-gated={gated} aria-label="Control Tower preview">
    <header className="ct-page-header"><p className="ct-eyebrow">App Brain / Operations</p><h1>Control Tower <span className="ct-preview">Preview</span></h1><ConnectionFreshness freshness={preview.freshness} detail="Host unavailable · local example" /></header>

    {attention.length > 0 && (
      <section className="ct-attention" aria-labelledby="ct-attention-heading">
        <p className="ct-authority" id="ct-attention-heading"><AlertTriangle size={15} aria-hidden="true" />{gated ? 'Paused — your authority is required.' : 'Needs your attention.'}</p>
        {(showAllAttention ? attention : attention.slice(0, 1)).map(item => <AttentionItem key={item.id} item={item} onInspect={() => selectTask(item.taskId ?? null)} onEvidence={item.taskId ? () => selectTask(item.taskId!, 'Evidence') : undefined} />)}
        {attention.length > 1 && <button type="button" className="ct-attention-toggle" onClick={() => setShowAllAttention(!showAllAttention)} aria-expanded={showAllAttention}>{showAllAttention ? 'Show less' : `View all (${attention.length})`}</button>}
      </section>
    )}

    <section className={`ct-run ct-run-bar ct-run-state-${preview.runState}`} aria-labelledby="ct-run-heading">
      <div className="ct-run-left"><span className="ct-eyebrow">Run · Snapshot</span><h2 id="ct-run-heading">{preview.objective}</h2></div>
      <div className="ct-run-state">
        <RoleRelay currentRole={preview.currentRole} />
        <p className="ct-run-phase"><RunStatus state={preview.runState} /><span>{preview.phase}</span></p>
        <div className="ct-progress"><span className="ct-progress-track" aria-hidden="true"><span className="ct-progress-fill" style={{ width: `${preview.tasks.length ? Math.round(passedCount / preview.tasks.length * 100) : 0}%` }} /></span><span className="ct-number">{passedCount}/{preview.tasks.length} tasks passed</span></div>
      </div>
      <div className="ct-run-right">
        <div className="ct-run-controls">
          {attention.length === 0 && <span className="ct-clear" role="status">Clear · nothing needs you</span>}
          <label className="ct-scenario">Snapshot<select aria-label="Preview snapshot" value={scenario} onChange={event => { const value = event.target.value as PreviewScenario; setScenario(value); setSelectedId(value === 'working' ? 'validation' : value === 'gate' ? 'edit-draft' : 'verify'); setInspectorSection('Details'); setShowAllAttention(false) }}><option value="working">Work in progress</option><option value="gate">Scope gate</option><option value="completed">Completed · not applied</option></select></label>
          <div className="ct-new-run"><button type="button" className="ct-primary" disabled aria-describedby="ct-new-run-note"><Plus size={14} aria-hidden="true" />New Run</button><span id="ct-new-run-note">Preview · integration unavailable</span></div>
          <details className="ct-run-actions"><summary aria-label="Run actions preview"><MoreHorizontal size={18} /></summary><div><strong>Future capabilities</strong><p>Pause / Resume, Apply, Commit, Push, and Deploy require integration and are unavailable.</p></div></details>
        </div>
        <div className="ct-run-secondary">
          <VerifierState state={preview.verification} />
          <ChangesetSummary state={preview.changeset} />
          <ProviderModelBadge identity={preview.tasks.find(task => task.role === preview.currentRole)?.requested ?? { state: 'unavailable' }} />
        </div>
      </div>
    </section>

    <nav className="ct-compact-modes" aria-label="Control Tower workspace modes">{(['work', 'map', 'details'] as const).map(value => <button ref={value === 'details' ? detailsRef : undefined} type="button" key={value} aria-pressed={mode === value} onClick={() => setMode(value)}>{value === 'work' ? 'Work' : value === 'map' ? 'Map' : 'Details'}</button>)}</nav>
    <div className="ct-workspace">
      <div className="ct-col-tasks">
        <TowerPanel title="Tasks" className="ct-tasks" action={<span className="ct-muted">Snapshot</span>}>
          <div className="ct-task-list">{preview.tasks.map((task, index) => <div key={task.id} className={`ct-rail-step ct-step-${task.state} ${index <= frontierIndex ? 'ct-spine-solid' : 'ct-spine-dashed'}`}>
            <span className={`ct-rail-node ct-node-${task.state} ${task.role === 'Verifier' ? 'ct-node-verifier' : ''}`} aria-hidden="true" />
            {index > 0 && task.role !== preview.tasks[index - 1].role && <span className="ct-handoff">{preview.tasks[index - 1].role} → {task.role}</span>}
            <TaskRow task={task} selected={selectedId === task.id} onSelect={() => selectTask(task.id)} />
          </div>)}</div>
          <div className="ct-rail-foot">
            <p className="ct-eyebrow">Other active Runs</p><p className="ct-muted">No other Runs in this preview snapshot.</p>
            <p className="ct-eyebrow">Recent work</p><p className="ct-muted">Architect · Invoice draft plan prepared · Snapshot<br />{scenario === 'completed' ? 'Verification passed in this example. Candidate changes remain unapplied.' : 'No completed Run history supplied in this example.'}</p>
          </div>
        </TowerPanel>
        {sheetMode && inspectorOpen && <button type="button" className="ct-inspector-backdrop" aria-label="Close task inspector" onClick={backToTasks} />}
      </div>
      <LinkedAppBrain scope={preview.scope} taskTitle={selected?.title} taskRole={selected?.role} taskState={selected?.state} />
      <TaskInspector task={selected} preview={preview} section={inspectorSection} onSectionChange={setInspectorSection} onClear={() => { setSelectedId(null); setInspectorSection('Details') }} onBack={backToTasks} modal={sheetMode && inspectorOpen} />
    </div>
    <footer className="ct-footer">{preview.source}. All Run, Task, and Attempt content is illustrative.</footer>
  </main></div>
}