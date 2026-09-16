import { useState } from 'react'
import { ChangesetSummary, EvidenceProvenance, ProviderModelBadge, RetryIndicator, RoleBadge, TaskStatus, TowerPanel, VerifierState } from './ControlTowerPrimitives'
import { CONTROL_TOWER_PREVIEW } from './controlTowerPreview'
import type { ControlTowerPreview, PreviewTask } from './controlTowerTypes'

type InspectorSection = 'Details' | 'Attempt' | 'Evidence'
interface Props {
  task: PreviewTask | null
  preview?: ControlTowerPreview
  section?: InspectorSection
  onSectionChange?: (section: InspectorSection) => void
  onClear: () => void
  onBack?: () => void
  modal?: boolean
}
export default function TaskInspector({ task, preview = CONTROL_TOWER_PREVIEW, section: controlledSection, onSectionChange, onClear, onBack, modal = false }: Props) {
  const [localSection, setLocalSection] = useState<InspectorSection>('Details')
  const section = controlledSection ?? localSection
  const selectSection = (value: InspectorSection) => { setLocalSection(value); onSectionChange?.(value) }
  return <TowerPanel title="Inspector" className="ct-inspector" modal={modal} action={task && <button type="button" onClick={onClear}>Run overview</button>}>
    {onBack && <button className="ct-inspector-back" type="button" onClick={onBack}>Back to tasks</button>}
    <div className="ct-inspector-context"><span className="ct-eyebrow">{task ? 'Selected task' : 'Selected Run'} · Snapshot</span><h3>{task?.title ?? preview.objective}</h3></div>
    <nav className="ct-section-tabs" aria-label="Inspector sections">
      {(['Details', 'Attempt', 'Evidence'] as const).map(label => <button type="button" key={label} aria-pressed={section === label} onClick={() => selectSection(label)}>{label}</button>)}
    </nav>
    <div className="ct-inspector-body" aria-live="polite">
      {section === 'Details' && (task ? <>
        <div className="ct-inspect-lead"><RoleBadge role={task.role} /><TaskStatus state={task.state} /></div>
        {task.state === 'blocked' && <div className="ct-inspect-gate"><span className="ct-eyebrow">Gate reason</span><p>{task.detail}</p></div>}
        <div className="ct-prose"><span className="ct-eyebrow">What this means</span><p>{task.detail}</p></div>
        <div className="ct-prose"><span className="ct-eyebrow">Current Attempt</span><p>{task.attempt}</p><RetryIndicator state={task.retry} /></div>
        <div className="ct-prose"><span className="ct-eyebrow">Dependencies</span><p>{task.dependencies}</p></div>
        <div className="ct-prose"><span className="ct-eyebrow">Planned scope</span><p>{preview.scope}</p></div>
      </> : <><div className="ct-prose"><span className="ct-eyebrow">Run overview</span><p>Select a task to inspect its scope, Attempt, and evidence.</p></div><div className="ct-inspect-lead"><VerifierState state={preview.verification} /><ChangesetSummary state={preview.changeset} /></div><p className="ct-muted">Run {preview.runState} · Snapshot. No Host state is connected.</p></>)}
      {section === 'Attempt' && (task ? <><div className="ct-prose"><span className="ct-eyebrow">Current Attempt</span><p>{task.attempt}</p><RetryIndicator state={task.retry} /></div><div className="ct-prose"><span className="ct-eyebrow">Model</span><ProviderModelBadge identity={task.requested} /><ProviderModelBadge identity={task.reported} /></div><p className="ct-muted">No command log, usage, or fine-grained activity has been reported.</p></> : <p>Select a task to inspect its Attempt. No Run-wide execution trace is available.</p>)}
      {section === 'Evidence' && <><div className="ct-prose"><span className="ct-eyebrow">Model configuration</span><div className="ct-models">{task ? <><ProviderModelBadge identity={task.requested} /><ProviderModelBadge identity={task.reported} /></> : <><ProviderModelBadge identity={{ state: 'unavailable' }} /><ProviderModelBadge identity={{ state: 'unreported' }} /></>}</div><p className="ct-muted">Requested configuration does not establish the model used. No task ids, timestamps, or usage figures are supplied in this snapshot.</p></div>
        <div className="ct-prose"><span className="ct-eyebrow">Candidate changes</span><ChangesetSummary state={preview.changeset} /><p className="ct-muted">{preview.changeset === 'not-applied' ? 'Illustrative candidate only; no diff or artifact is supplied. Completion does not apply changes.' : 'No candidate diff supplied. Proposed boundary: edit drafts while keeping the existing approval flow unchanged.'}</p></div>
        <div className="ct-prose"><span className="ct-eyebrow">Provenance</span><EvidenceProvenance kind="Planned scope" freshness="Snapshot" source={preview.source} /><p className="ct-muted">No file reads, edits, or verifier results are inferred from task titles.</p></div>
        <p className="ct-muted">{preview.scope}</p><p className="ct-muted">{task?.detail}</p></>}
    </div>
    <footer className="ct-inspector-footer">Snapshot · local fixture · inspection only</footer>
  </TowerPanel>
}