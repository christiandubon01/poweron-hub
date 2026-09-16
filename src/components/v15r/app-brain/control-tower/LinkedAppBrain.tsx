import { useEffect, useRef, useState } from 'react'
import { Maximize2, Minimize2 } from 'lucide-react'
import V15rAppBrainScene from '../../V15rAppBrainScene'
import { APP_BRAIN_CATEGORY_META, APP_BRAIN_NODES, getAppBrainNode } from '../../appBrainMap'
import { EvidenceProvenance, TowerPanel } from './ControlTowerPrimitives'
import type { Role, TaskState } from './controlTowerTypes'

const NODE_IDS = APP_BRAIN_NODES.map(node => node.id)

/** Frozen CT-3F focus states: only states the preview model can honestly support. */
const FOCUS_LABELS = { active: 'Active task', gate: 'Scope gate', verifier: 'Verifier', passed: 'Passed', waiting: 'Waiting', scope: 'Planned scope' } as const

export default function LinkedAppBrain({ scope, taskTitle, taskRole, taskState }: { scope: string; taskTitle?: string; taskRole?: Role; taskState?: TaskState }) {
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)
  const expandRef = useRef<HTMLButtonElement>(null)
  const frameRef = useRef<HTMLDivElement>(null)
  const node = getAppBrainNode(selectedNodeId)
  const focus = taskState === 'running' ? 'active' : taskState === 'blocked' ? 'gate' : taskRole === 'Verifier' ? 'verifier' : taskState === 'passed' ? 'passed' : taskState ? 'waiting' : 'scope'
  const focusLabel = FOCUS_LABELS[focus]

  useEffect(() => {
    if (!expanded) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setExpanded(false); expandRef.current?.focus() }
      if (event.key === 'Tab') {
        const controls = Array.from(frameRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), select, summary') ?? []).filter(control => control.getClientRects().length)
        if (!controls?.length) return
        const first = controls[0], last = controls[controls.length - 1]
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
      }
    }
    document.addEventListener('keydown', onKey)
    expandRef.current?.focus()
    return () => document.removeEventListener('keydown', onKey)
  }, [expanded])

  return <div ref={frameRef} className={`ct-map-frame ct-focus-${focus} ${expanded ? 'ct-map-expanded' : ''}`} role={expanded ? 'dialog' : undefined} aria-modal={expanded || undefined} aria-label={expanded ? 'Expanded App Brain' : undefined}>
    <TowerPanel title="App Brain" className="ct-map" action={<button ref={expandRef} type="button" onClick={() => setExpanded(!expanded)} aria-label={expanded ? 'Collapse App Brain' : 'Expand App Brain'}>{expanded ? <Minimize2 size={15} /> : <Maximize2 size={15} />}{expanded ? 'Collapse' : 'Expand'}</button>}>
      <div className="ct-map-toolbar">
        <p className="ct-breadcrumb">Overview{node ? <><span className="ct-crumb-sep" aria-hidden="true"> → </span>{node.label}</> : taskRole && taskTitle ? <><span className="ct-crumb-sep" aria-hidden="true"> → </span>{taskRole}<span className="ct-crumb-sep" aria-hidden="true"> → </span>{taskTitle}</> : null}</p>
        <div className="ct-map-actions"><button type="button" disabled aria-describedby="ct-map-capability">Focus task</button><label className="ct-follow"><input type="checkbox" disabled aria-describedby="ct-map-capability" />Follow task</label><button type="button" onClick={() => setSelectedNodeId(null)}>Return to overview</button></div>
        <p className="ct-muted"><span className={`ct-map-state ct-focus-text-${focus}`}>{focusLabel} · Snapshot</span> · {taskTitle ?? 'Selected Run'} · no map association in this snapshot<span id="ct-map-capability" className="ct-muted"> · Task focus &amp; follow · Future integration</span></p>
      </div>
      <div className="ct-map-scene"><V15rAppBrainScene staticPresentation selectedNodeId={selectedNodeId} hoveredNodeId={hoveredNodeId} visibleNodeIds={NODE_IDS} onSelectNode={setSelectedNodeId} onHoverNode={setHoveredNodeId} /></div>
      <div className="ct-map-bottom"><details><summary>Inspect an area / map legend</summary><label className="ct-map-select">Architecture area<select value={selectedNodeId ?? ''} onChange={event => setSelectedNodeId(event.target.value || null)}><option value="">Overview</option>{APP_BRAIN_NODES.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
        <div className="ct-map-legend">{Object.entries(APP_BRAIN_CATEGORY_META).map(([key, meta]) => <span key={key}><i style={{ background: meta.color }} />{meta.label}</span>)}</div></details>
        <div className="ct-map-legend" aria-label="Map category key">{Object.entries(APP_BRAIN_CATEGORY_META).slice(0,3).map(([key, meta]) => <span key={key}><i style={{ background: meta.color }} />{meta.label}</span>)}</div>
        <EvidenceProvenance kind="Planned scope" freshness="Snapshot" source={scope + '. Precise map association unavailable; no task activity or changed files are shown.'} />
      </div>
    </TowerPanel>
  </div>
}