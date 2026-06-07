import { useMemo } from 'react'
import { Import } from 'lucide-react'
import {
  createBacklogTaskDraft,
  inferBacklogDomain,
  inferBacklogPriority,
  inferBacklogRisk,
  normalizeTaskTitle,
} from './appBrainBacklogImport'
import { AppBrainPanelShell, StatCard } from './appBrainPanelShared'

const SAMPLE_RAW = {
  title: '  Add App Brain watch-mode design doc   ',
  feature: 'App Brain Wave 04',
  description: 'Draft architecture for optional file watcher — not live yet. Admin control tower scope.',
}

export default function AppBrainBacklogImportPanel() {
  const normalizedTitle = useMemo(() => normalizeTaskTitle(SAMPLE_RAW.title), [])
  const inferredDomain = useMemo(
    () => inferBacklogDomain(normalizedTitle, SAMPLE_RAW.description),
    [normalizedTitle],
  )
  const inferredPriority = useMemo(
    () => inferBacklogPriority(normalizedTitle, SAMPLE_RAW.description),
    [normalizedTitle],
  )
  const inferredRisk = useMemo(
    () => inferBacklogRisk(normalizedTitle, inferredPriority, SAMPLE_RAW.description),
    [normalizedTitle, inferredPriority],
  )

  const draft = useMemo(
    () =>
      createBacklogTaskDraft(
        'preview-import-001',
        SAMPLE_RAW.title,
        SAMPLE_RAW.feature,
        SAMPLE_RAW.description,
        { source: 'preview-classifier' },
      ),
    [],
  )

  const classifierFields = [
    { label: 'Domain', value: inferredDomain },
    { label: 'Risk', value: inferredRisk },
    { label: 'Priority', value: inferredPriority },
    { label: 'Normalized title', value: normalizedTitle },
  ]

  return (
    <AppBrainPanelShell
      mode="preview"
      title="Backlog Import Helper"
      subtitle="Classifier inference preview — full owner backlog import not active yet"
      icon={<Import size={18} />}
      accent="#facc15"
    >
      <div
        className="rounded-xl p-3"
        style={{ background: 'rgba(251,191,36,0.06)', border: '1px solid rgba(251,191,36,0.18)' }}
      >
        <p className="text-xs text-yellow-200/90 leading-relaxed">
          appBrainBacklogImport.ts can infer domain, risk, priority, normalized title, and task drafts from raw text.
          No write behavior — preview only.
        </p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Inferred domain" value={draft.domain} color="#facc15" />
        <StatCard label="Inferred priority" value={draft.priority} color="#22d3ee" />
        <StatCard label="Inferred risk" value={draft.risk} color="#fb7185" />
        <StatCard label="Draft status" value={draft.status} color="#94a3b8" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className="rounded-xl p-4 space-y-3" style={{ background: 'rgba(3,7,18,0.58)', border: '1px solid rgba(251,191,36,0.2)' }}>
          <p className="text-[10px] uppercase tracking-widest text-yellow-200/80">Sample input</p>
          <div className="space-y-2 text-[11px] font-mono">
            <p className="text-gray-500">title:</p>
            <p className="text-gray-300">{JSON.stringify(SAMPLE_RAW.title)}</p>
            <p className="text-gray-500 mt-2">feature:</p>
            <p className="text-gray-300">{SAMPLE_RAW.feature}</p>
            <p className="text-gray-500 mt-2">description:</p>
            <p className="text-gray-400 leading-relaxed">{SAMPLE_RAW.description}</p>
          </div>
        </div>

        <div className="rounded-xl p-4 space-y-3" style={{ background: 'rgba(3,7,18,0.58)', border: '1px solid rgba(34,211,238,0.2)' }}>
          <p className="text-[10px] uppercase tracking-widest text-cyan-200/80">Classifier output</p>
          <div className="space-y-2">
            {classifierFields.map((field) => (
              <div key={field.label}>
                <p className="text-[9px] uppercase tracking-wider text-gray-500">{field.label}</p>
                <p className="text-xs text-gray-300 font-mono mt-0.5">{field.value}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="rounded-xl p-4 space-y-2" style={{ background: 'rgba(15,23,42,0.5)', border: '1px solid rgba(148,163,184,0.12)' }}>
        <p className="text-[10px] uppercase tracking-widest text-gray-500">Task draft preview</p>
        <div className="grid grid-cols-2 gap-2 text-[11px]">
          <div>
            <p className="text-gray-500">taskId</p>
            <p className="text-gray-300 font-mono">{draft.taskId}</p>
          </div>
          <div>
            <p className="text-gray-500">source</p>
            <p className="text-gray-300 font-mono">{draft.source}</p>
          </div>
          <div className="col-span-2">
            <p className="text-gray-500">title</p>
            <p className="text-gray-200">{draft.title}</p>
          </div>
          <div className="col-span-2">
            <p className="text-gray-500">feature</p>
            <p className="text-gray-300">{draft.feature}</p>
          </div>
        </div>
      </div>
    </AppBrainPanelShell>
  )
}
