import { useMemo } from 'react'
import { BarChart3 } from 'lucide-react'
import {
  calculateMetricsSummary,
  createEmptyMetricsSummary,
  SAMPLE_SESSIONS,
} from './appBrainMetricsSeed'
import type { GateStatus } from './appBrainQaGateTypes'
import type { QAGateResult } from './appBrainQaGateTypes'
import { AppBrainPanelShell, StatCard } from './appBrainPanelShared'

const GATE_STATUS_COLORS: Record<GateStatus, string> = {
  PASS: '#34d399',
  FAIL: '#fb7185',
  PARTIAL: '#facc15',
}

function buildPreviewQAGate(): QAGateResult {
  const now = new Date().toISOString()
  return {
    gateId: 'qa-gate-preview-w04',
    gateName: 'Wave 02 Metrics / QA Foundations',
    category: 'spec-compliance',
    status: 'PARTIAL',
    specItems: [
      {
        specId: 'spec-metrics-001',
        category: 'type-definitions',
        requirement: 'Metrics and QA gate types defined',
        fulfilled: true,
      },
      {
        specId: 'spec-metrics-002',
        category: 'seed-data',
        requirement: 'Sample dev sessions seeded',
        fulfilled: true,
      },
      {
        specId: 'spec-metrics-003',
        category: 'no-ui-integration',
        requirement: 'Live metrics ingestion wired',
        fulfilled: false,
        notes: 'Preview panel only — placeholders until watch mode',
      },
    ],
    filesChanged: SAMPLE_SESSIONS[0]?.filesChanged ?? [],
    fileChangeCount: SAMPLE_SESSIONS[0]?.filesChanged.length ?? 0,
    canaries: [
      { filePath: 'package.json', status: 'clean', checkedAt: now },
      { filePath: '.claude/settings.local.json', status: 'clean', checkedAt: now },
    ],
    allCanariesClean: true,
    tscResult: {
      passed: true,
      errorCount: 0,
      warningCount: 0,
      command: 'npx tsc --noEmit -p tsconfig.json',
      executedAt: now,
    },
    buildResult: {
      passed: true,
      exitCode: 0,
      command: 'npm run build',
      executedAt: now,
    },
    typecheckResult: {
      passed: false,
      exitCode: -1,
      command: 'npm.cmd run typecheck',
      executedAt: now,
      blockedByHarness: true,
      blockerDescription: 'Shell harness no exit status — documented placeholder',
    },
    contextStatus: {
      status: 'unchanged',
      protectedFiles: [
        'solarupgrade_agent_context/SOLARUPGRADE_CLAUDE.md',
        'solarupgrade_agent_context/SOLARUPGRADE_CODEX.md',
      ],
      protectedFilesChanged: [],
      newReportFiles: [],
      checkedAt: now,
    },
    manualQANeeded: true,
    manualQAReason: 'Preview integration — verify panels render read-only in App Brain',
    commitHash: SAMPLE_SESSIONS[0]?.commitHash ?? 'pending',
    branch: 'main',
    executedAt: now,
    summary: 'AI development efficiency preview — not operational business metrics.',
  }
}

export default function AppBrainMetricsQaPanel() {
  const metrics = useMemo(
    () => (SAMPLE_SESSIONS.length > 0 ? calculateMetricsSummary(SAMPLE_SESSIONS) : createEmptyMetricsSummary()),
    [],
  )
  const qaGate = useMemo(() => buildPreviewQAGate(), [])
  const adminDomain = metrics.domains['admin-app-brain']

  const checklistRows = [
    { label: 'Spec items', value: `${qaGate.specItems.filter((s) => s.fulfilled).length}/${qaGate.specItems.length} fulfilled` },
    { label: 'Gate status', value: qaGate.status },
    { label: 'Files changed', value: String(qaGate.fileChangeCount) },
    { label: 'Canaries clean', value: qaGate.allCanariesClean ? 'Yes' : 'No' },
    { label: 'Build result', value: qaGate.buildResult.passed ? 'PASS' : 'FAIL' },
    { label: 'Typecheck result', value: qaGate.tscResult.passed ? 'PASS (tsc)' : 'FAIL' },
    { label: 'Context updated', value: qaGate.contextStatus.status },
    { label: 'Commit hash', value: qaGate.commitHash ?? '—' },
    { label: 'Manual QA needed', value: qaGate.manualQANeeded ? 'Yes' : 'No' },
  ]

  return (
    <AppBrainPanelShell
      mode="preview"
      title="Metrics / QA Gate"
      subtitle="AI development efficiency metrics only — no business financial KPIs"
      icon={<BarChart3 size={18} />}
      accent="#a78bfa"
    >
      <div
        className="rounded-xl p-3"
        style={{ background: 'rgba(167,139,250,0.08)', border: '1px solid rgba(167,139,250,0.18)' }}
      >
        <p className="text-xs text-violet-100/90 leading-relaxed">
          Placeholder metrics from appBrainMetricsSeed.ts sample sessions. Live session tracking is not active.
        </p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Sessions (sample)" value={metrics.metadata.totalSessions} color="#22d3ee" />
        <StatCard label="Completed" value={metrics.metadata.completedSessions} color="#34d399" />
        <StatCard label="Blocked" value={metrics.metadata.blockedSessions} color="#fb7185" />
        <StatCard label="Repass avg" value={metrics.summary.avgRepassesPerBlockedSession.toFixed(1)} color="#facc15" />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          label="Typecheck pass rate"
          value={`${Math.round(metrics.summary.overallTypecheckRate * 100)}%`}
          color="#34d399"
        />
        <StatCard
          label="Build pass rate"
          value={`${Math.round(metrics.summary.overallBuildRate * 100)}%`}
          color="#22d3ee"
        />
        <StatCard label="Context resets avg" value={metrics.summary.avgContextResetsPerSession.toFixed(1)} color="#a78bfa" />
        <StatCard label="Admin domain sessions" value={adminDomain?.totalSessions ?? 0} color="#fb7185" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className="rounded-xl p-4 space-y-3" style={{ background: 'rgba(3,7,18,0.58)', border: '1px solid rgba(167,139,250,0.2)' }}>
          <p className="text-[10px] uppercase tracking-widest text-violet-200/80">Model / domain placeholder</p>
          <div className="space-y-2 text-[11px] text-gray-300 font-mono">
            <p>Period: {metrics.metadata.period}</p>
            <p>
              Models: sonnet {metrics.summary.modelDistribution['claude-3-5-sonnet']} · haiku{' '}
              {metrics.summary.modelDistribution['claude-3-5-haiku']} · other{' '}
              {metrics.summary.modelDistribution.other}
            </p>
            <p>Files touched (unique): {metrics.summary.totalFilesTouched}</p>
          </div>
          {SAMPLE_SESSIONS[0] && (
            <div className="text-xs text-gray-400 leading-relaxed">
              Sample: {SAMPLE_SESSIONS[0].feature} · {SAMPLE_SESSIONS[0].durationMinutes} min · context resets{' '}
              {SAMPLE_SESSIONS[0].contextResetCount}
            </div>
          )}
        </div>

        <div className="rounded-xl p-4 space-y-3" style={{ background: 'rgba(3,7,18,0.58)', border: '1px solid rgba(251,191,36,0.2)' }}>
          <div className="flex items-center justify-between gap-2">
            <p className="text-[10px] uppercase tracking-widest text-yellow-200/80">QA gate checklist preview</p>
            <span
              className="text-[10px] uppercase font-mono px-2 py-1 rounded-full"
              style={{
                color: GATE_STATUS_COLORS[qaGate.status],
                background: `${GATE_STATUS_COLORS[qaGate.status]}14`,
                border: `1px solid ${GATE_STATUS_COLORS[qaGate.status]}33`,
              }}
            >
              {qaGate.status}
            </span>
          </div>
          <div className="space-y-2">
            {checklistRows.map((row) => (
              <div key={row.label} className="flex justify-between gap-3 text-[11px]">
                <span className="text-gray-500">{row.label}</span>
                <span className="text-gray-300 font-mono text-right">{row.value}</span>
              </div>
            ))}
          </div>
          {qaGate.manualQAReason && (
            <p className="text-[11px] text-gray-500 leading-relaxed">{qaGate.manualQAReason}</p>
          )}
        </div>
      </div>

      <div>
        <p className="text-[10px] uppercase tracking-widest text-gray-500 mb-2">Spec items</p>
        <div className="space-y-2">
          {qaGate.specItems.map((item) => (
            <div
              key={item.specId}
              className="rounded-lg px-3 py-2 flex items-start justify-between gap-3"
              style={{ background: 'rgba(15,23,42,0.6)', border: '1px solid rgba(148,163,184,0.1)' }}
            >
              <div>
                <p className="text-xs text-gray-300">{item.requirement}</p>
                <p className="text-[10px] text-gray-600 font-mono mt-0.5">{item.category}</p>
              </div>
              <span className="text-[10px] font-mono uppercase" style={{ color: item.fulfilled ? '#34d399' : '#facc15' }}>
                {item.fulfilled ? 'PASS' : 'PARTIAL'}
              </span>
            </div>
          ))}
        </div>
      </div>
    </AppBrainPanelShell>
  )
}
