import { useMemo } from 'react'
import { FileText } from 'lucide-react'
import {
  buildAgentBrief,
  formatAgentBriefMarkdown,
  summarizeActiveOverlaps,
} from './appBrainBriefGenerator'
import { APP_BRAIN_ACTIVE_SESSIONS } from './appBrainSeedData'
import { AppBrainPanelShell, StatCard } from './appBrainPanelShared'

const SAMPLE_TARGET_FILES = [
  'src/components/v15r/app-brain/AppBrainDomainEcosystemPanel.tsx',
  'src/components/v15r/V15rAppBrainTab.tsx',
]

export default function AppBrainBriefGeneratorPanel() {
  const brief = useMemo(
    () =>
      buildAgentBrief(
        'preview-brief-w04',
        'Cursor',
        'gpt-5.5-medium',
        'main',
        'Integrate Wave 02 intelligence preview panels',
        'Wire read-only Domain Ecosystem, Governance, Brief, Metrics/QA, and Backlog Import previews into App Brain.',
        'app-brain-core',
        SAMPLE_TARGET_FILES,
      ),
    [],
  )

  const overlaps = useMemo(
    () =>
      summarizeActiveOverlaps(
        'app-brain-core',
        'Cursor',
        'main',
        Object.values(APP_BRAIN_ACTIVE_SESSIONS.sessions),
      ),
    [],
  )

  const markdown = useMemo(() => formatAgentBriefMarkdown(brief), [brief])

  const fieldRows = [
    { label: 'Task', value: brief.taskSummary },
    { label: 'Agent', value: `${brief.agent} (${brief.model})` },
    { label: 'Domain', value: brief.domain },
    { label: 'Relevant files', value: brief.targetFiles.join(', ') },
    {
      label: 'Do-not-touch files',
      value: `${brief.protectedFiles.length} protected · ${brief.protectedFiles.slice(0, 3).join(', ')}${brief.protectedFiles.length > 3 ? '…' : ''}`,
    },
    {
      label: 'Overlaps',
      value: overlaps.totalActiveOverlaps > 0
        ? `${overlaps.totalActiveOverlaps} detected — ${overlaps.resolutionRecommendation}`
        : overlaps.resolutionRecommendation,
    },
    {
      label: 'Canaries',
      value: brief.canarySuggestions.slice(0, 3).map((c) => c.name).join(', ') || 'None inferred',
    },
    {
      label: 'QA checklist',
      value: `${brief.qaChecklist.filter((item) => item.required).length} required items`,
    },
    { label: 'Commit message', value: brief.suggestedCommitMessage },
    {
      label: 'Context updates',
      value: brief.contextUpdateRequired.length > 0
        ? brief.contextUpdateRequired.join(', ')
        : 'SOLARUPGRADE_SHARED_CONTEXT.md, SOLARUPGRADE_CURSOR.md (when scoped)',
    },
  ]

  return (
    <AppBrainPanelShell
      mode="preview"
      title="Agent Brief Generator"
      subtitle="Deterministic sample brief — read-only preview, no export or write actions"
      icon={<FileText size={18} />}
      accent="#22d3ee"
    >
      <div
        className="rounded-xl p-3"
        style={{ background: 'rgba(251,191,36,0.06)', border: '1px solid rgba(251,191,36,0.18)' }}
      >
        <p className="text-xs text-yellow-200/90 leading-relaxed">
          Generated from appBrainBriefGenerator.ts using static sample inputs. Not a live session brief.
        </p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Protected files" value={brief.protectedFiles.length} color="#fb7185" />
        <StatCard label="Canary suggestions" value={brief.canarySuggestions.length} color="#facc15" />
        <StatCard label="QA items" value={brief.qaChecklist.length} color="#a78bfa" />
        <StatCard label="Est. tokens" value={markdown.estimatedTokens} color="#22d3ee" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {fieldRows.map((row) => (
          <div
            key={row.label}
            className="rounded-xl p-3"
            style={{ background: 'rgba(3,7,18,0.58)', border: '1px solid rgba(148,163,184,0.14)' }}
          >
            <p className="text-[9px] uppercase tracking-wider text-gray-500">{row.label}</p>
            <p className="text-xs text-gray-300 mt-1 leading-relaxed font-mono break-words">{row.value}</p>
          </div>
        ))}
      </div>

      <div>
        <p className="text-[10px] uppercase tracking-widest text-gray-500 mb-2">Markdown preview (truncated)</p>
        <pre
          className="rounded-xl p-4 text-[11px] text-gray-400 leading-relaxed overflow-x-auto max-h-64 overflow-y-auto font-mono whitespace-pre-wrap"
          style={{ background: 'rgba(7,11,20,0.85)', border: '1px solid rgba(148,163,184,0.12)' }}
        >
          {markdown.content.slice(0, 1800)}
          {markdown.content.length > 1800 ? '\n\n… truncated preview …' : ''}
        </pre>
      </div>

      <div>
        <p className="text-[9px] uppercase tracking-wider text-gray-500 mb-1.5">QA checklist preview</p>
        <div className="space-y-1">
          {brief.qaChecklist.map((item) => (
            <p key={item.id} className="text-[11px] text-gray-400 font-mono">
              [ ] {item.label}
              {item.required ? ' (required)' : ''}
            </p>
          ))}
        </div>
      </div>
    </AppBrainPanelShell>
  )
}
