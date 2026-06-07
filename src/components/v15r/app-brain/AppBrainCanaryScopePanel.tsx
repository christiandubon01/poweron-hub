/**
 * Canary / Scope Checker preview — low-friction scope validation model only.
 */

import { useMemo } from 'react'
import { ShieldCheck } from 'lucide-react'
import {
  buildScopeCanaryPlan,
  recommendCanaryFiles,
  checkScopeOverlap,
  summarizeCanaryStatus,
} from './appBrainScopeCanaryModel'
import type { CanarySeverity } from './appBrainCanaryTypes'
import { AppBrainPanelShell, StatCard } from './appBrainPanelShared'

const SEVERITY_META: Record<
  CanarySeverity,
  { label: string; friction: string; color: string }
> = {
  clean: { label: 'Clean', friction: 'Quiet', color: '#34d399' },
  warning: { label: 'Dirty', friction: 'Warning', color: '#facc15' },
  critical: { label: 'Severe', friction: 'Owner review', color: '#fb7185' },
}

const SAMPLE_CHANGED_FILES = [
  'src/components/v15r/app-brain/appBrainCanaryTypes.ts',
  'src/components/v15r/app-brain/appBrainScopeCanaryModel.ts',
]

const SAMPLE_OVERLAP_SCOPES: Record<string, string[]> = {
  'Haiku-W03-A4': ['src/components/v15r/app-brain/appBrainCanaryTypes.ts'],
  'Cursor-W05': ['src/components/v15r/V15rAppBrainTab.tsx'],
}

export default function AppBrainCanaryScopePanel() {
  const plan = useMemo(
    () => buildScopeCanaryPlan('wave03-sample', 'Haiku', 'main'),
    [],
  )
  const recommendations = useMemo(() => recommendCanaryFiles(), [])
  const sampleStatus = useMemo(
    () => summarizeCanaryStatus('main', SAMPLE_CHANGED_FILES, plan),
    [plan],
  )
  const overlapWarnings = useMemo(
    () =>
      checkScopeOverlap('Cursor-W05', ['src/components/v15r/V15rAppBrainTab.tsx'], SAMPLE_OVERLAP_SCOPES),
    [],
  )

  const severityMeta = SEVERITY_META[sampleStatus.overallSeverity]

  return (
    <AppBrainPanelShell
      mode="runtime"
      title="Canary / Scope Checker"
      subtitle="Scope boundary model preview — no hooks, no blocking behavior"
      icon={<ShieldCheck size={18} />}
      accent="#facc15"
    >
      <div
        className="rounded-xl p-3"
        style={{ background: 'rgba(251,191,36,0.06)', border: '1px solid rgba(251,191,36,0.16)' }}
      >
        <p className="text-xs text-yellow-100/90 leading-relaxed">
          Low-friction status levels: <span className="font-mono">clean → quiet</span>,{' '}
          <span className="font-mono">warning → flag</span>,{' '}
          <span className="font-mono">critical → owner review</span>. This panel does not install git hooks or block
          commits.
        </p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Allowed scope" value={plan.summary.allowedCount} color="#34d399" />
        <StatCard label="Protected files" value={plan.summary.protectedCount} color="#fb7185" />
        <StatCard
          label="Package guard"
          value={plan.summary.packageGuardsActive ? 'active' : 'off'}
          color="#22d3ee"
        />
        <StatCard
          label="Shared context guard"
          value={plan.summary.sharedContextGuardsActive ? 'active' : 'off'}
          color="#a78bfa"
        />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
        <div className="rounded-xl p-3" style={{ background: 'rgba(3,7,18,0.5)', border: '1px solid rgba(52,211,153,0.16)' }}>
          <p className="text-[10px] uppercase tracking-widest text-emerald-200/80 mb-2">Sample scope canary plan</p>
          <p className="text-[11px] font-mono text-gray-400 mb-2">
            {plan.sessionId} · {plan.agentName} · {plan.branch}
          </p>
          <div className="space-y-1">
            {plan.allowedFiles.slice(0, 4).map((file) => (
              <p key={file.pattern} className="text-[11px] text-gray-300 font-mono truncate">
                {file.pattern}
              </p>
            ))}
          </div>
        </div>

        <div className="rounded-xl p-3" style={{ background: 'rgba(3,7,18,0.5)', border: '1px solid rgba(251,113,133,0.16)' }}>
          <p className="text-[10px] uppercase tracking-widest text-rose-200/80 mb-2">Protected files summary</p>
          <p className="text-[11px] text-gray-500 mb-2">
            {plan.packageFiles.length} package · {plan.sharedContextFiles.length} shared context ·{' '}
            {plan.protectedFiles.length} total protected
          </p>
          <div className="space-y-1">
            {plan.packageFiles.map((file) => (
              <p key={file.path} className="text-[11px] text-gray-300 font-mono truncate">
                {file.path}
              </p>
            ))}
          </div>
        </div>
      </div>

      <div
        className="rounded-xl p-3"
        style={{ background: 'rgba(3,7,18,0.5)', border: `1px solid ${severityMeta.color}33` }}
      >
        <div className="flex items-center justify-between gap-2 mb-2">
          <p className="text-[10px] uppercase tracking-widest text-gray-500">Sample canary status</p>
          <span
            className="text-[10px] uppercase font-mono px-2 py-1 rounded-full"
            style={{
              color: severityMeta.color,
              background: `${severityMeta.color}14`,
              border: `1px solid ${severityMeta.color}33`,
            }}
          >
            {severityMeta.label} · {severityMeta.friction}
          </span>
        </div>
        <p className="text-xs text-gray-400">{sampleStatus.recommendation}</p>
        <p className="text-[10px] text-gray-600 font-mono mt-2">
          Package intact: {sampleStatus.packageFilesIntact ? 'yes' : 'no'} · Shared context intact:{' '}
          {sampleStatus.sharedContextIntact ? 'yes' : 'no'}
        </p>
      </div>

      {overlapWarnings.length > 0 ? (
        <div>
          <p className="text-[10px] uppercase tracking-widest text-gray-500 mb-2">Overlap warning example</p>
          {overlapWarnings.map((warning) => (
            <div
              key={`${warning.file}-${warning.assignedAgent}`}
              className="rounded-lg p-3"
              style={{ background: 'rgba(127,29,29,0.12)', border: '1px solid rgba(251,113,133,0.2)' }}
            >
              <p className="text-xs text-gray-300 font-mono truncate">{warning.file}</p>
              <p className="text-[10px] text-gray-500 mt-1">
                {warning.currentAgent} vs {warning.assignedAgent} · {warning.severity}
              </p>
              <p className="text-[10px] text-gray-600 mt-1">{warning.recommendation}</p>
            </div>
          ))}
        </div>
      ) : null}

      <div>
        <p className="text-[10px] uppercase tracking-widest text-gray-500 mb-2">File recommendations</p>
        <div className="space-y-1">
          {recommendations.slice(0, 5).map((rec) => (
            <div
              key={rec.file}
              className="rounded-lg p-2 flex items-center justify-between gap-2 text-[11px]"
              style={{ background: 'rgba(3,7,18,0.5)', border: '1px solid rgba(148,163,184,0.1)' }}
            >
              <span className="font-mono text-gray-400 truncate">{rec.file}</span>
              <span className="text-gray-500 shrink-0 uppercase">{rec.action}</span>
            </div>
          ))}
        </div>
      </div>
    </AppBrainPanelShell>
  )
}

export { AppBrainCanaryScopePanel }
