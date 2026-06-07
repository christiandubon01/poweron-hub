/**
 * Import Graph Overlay preview — read-only structural analysis from generated manifest.
 */

import { useMemo } from 'react'
import { GitBranch } from 'lucide-react'
import { GENERATED_APP_BRAIN_MANIFEST } from '../generatedAppBrainManifest'
import { createImportGraphOverlay, summarizeImportGraphOverlay } from './appBrainImportGraphOverlay'
import { AppBrainPanelShell, StatCard } from './appBrainPanelShared'

const RISK_COLORS: Record<string, string> = {
  critical: '#fb7185',
  high: '#facc15',
  medium: '#22d3ee',
  low: '#34d399',
  minimal: '#94a3b8',
}

export default function AppBrainImportGraphOverlayPanel() {
  const overlay = useMemo(
    () => createImportGraphOverlay([...GENERATED_APP_BRAIN_MANIFEST.files], { useDomainMapping: true }),
    [],
  )
  const summary = useMemo(() => summarizeImportGraphOverlay(overlay, { topHighTouchFileCount: 6 }), [overlay])
  const topDomains = useMemo(
    () =>
      Object.entries(overlay.summary.filesByDomain)
        .sort((a, b) => b[1].length - a[1].length)
        .slice(0, 6),
    [overlay],
  )

  return (
    <AppBrainPanelShell
      mode="runtime"
      title="Import Graph Overlay"
      subtitle="Structural import analysis from generated manifest — no 3D scene wiring yet"
      icon={<GitBranch size={18} />}
      accent="#22d3ee"
    >
      <div
        className="rounded-xl p-3"
        style={{ background: 'rgba(34,211,238,0.06)', border: '1px solid rgba(34,211,238,0.16)' }}
      >
        <p className="text-xs text-cyan-100/90 leading-relaxed">
          Overlay derived from <span className="font-mono">generatedAppBrainManifest.ts</span>. Edge and cluster
          counts reflect manifest import metadata only — not live git or filesystem scans.
        </p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Files in graph" value={overlay.summary.totalFiles} color="#22d3ee" />
        <StatCard label="Import edges" value={overlay.summary.totalEdges} color="#34d399" />
        <StatCard label="Clusters" value={overlay.summary.totalClusters} color="#a78bfa" />
        <StatCard
          label="Health score"
          value={`${Math.round(overlay.summary.healthScore * 100)}%`}
          color="#facc15"
        />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
        <div className="rounded-xl p-3" style={{ background: 'rgba(3,7,18,0.5)', border: '1px solid rgba(251,113,133,0.16)' }}>
          <p className="text-[10px] uppercase tracking-widest text-rose-200/80 mb-2">High-touch files</p>
          <div className="space-y-2">
            {summary.topHighTouchFiles.length > 0 ? (
              summary.topHighTouchFiles.map((file) => (
                <div key={file.filePath} className="text-[11px] text-gray-300">
                  <p className="font-mono truncate">{file.filePath}</p>
                  <p className="text-gray-500">
                    {file.reason} · score {file.score}
                  </p>
                </div>
              ))
            ) : (
              <p className="text-sm text-gray-500">No high-touch files identified in manifest sample.</p>
            )}
          </div>
        </div>

        <div className="rounded-xl p-3" style={{ background: 'rgba(3,7,18,0.5)', border: '1px solid rgba(167,139,250,0.16)' }}>
          <p className="text-[10px] uppercase tracking-widest text-violet-200/80 mb-2">Domain mapping preview</p>
          <div className="space-y-2">
            {topDomains.map(([domain, files]) => (
              <div key={domain} className="flex justify-between text-[11px] font-mono text-gray-400">
                <span className="truncate">{domain}</span>
                <span className="text-gray-500 shrink-0 ml-2">{files.length} files</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div
        className="rounded-xl p-3 space-y-2"
        style={{ background: 'rgba(3,7,18,0.5)', border: `1px solid ${RISK_COLORS[summary.riskLevel] ?? '#94a3b8'}33` }}
      >
        <div className="flex items-center justify-between gap-2">
          <p className="text-[10px] uppercase tracking-widest text-gray-500">Risk summary</p>
          <span
            className="text-[10px] uppercase font-mono px-2 py-1 rounded-full"
            style={{
              color: RISK_COLORS[summary.riskLevel] ?? '#94a3b8',
              background: `${RISK_COLORS[summary.riskLevel] ?? '#94a3b8'}14`,
              border: `1px solid ${RISK_COLORS[summary.riskLevel] ?? '#94a3b8'}33`,
            }}
          >
            {summary.riskLevel}
          </span>
        </div>
        <p className="text-[11px] text-gray-400 font-mono">
          Overall risk score: {(overlay.risk.overallRiskScore * 100).toFixed(0)}% · Circular deps:{' '}
          {overlay.risk.circularDependencies.length} · Bottlenecks: {overlay.risk.bottleneckFiles.length}
        </p>
        {summary.recommendations.length > 0 ? (
          <div className="space-y-1">
            {summary.recommendations.map((rec) => (
              <p key={rec} className="text-xs text-gray-400 leading-relaxed">
                - {rec}
              </p>
            ))}
          </div>
        ) : (
          <p className="text-xs text-gray-500">No risk recommendations from current manifest sample.</p>
        )}
      </div>
    </AppBrainPanelShell>
  )
}

export { AppBrainImportGraphOverlayPanel }
