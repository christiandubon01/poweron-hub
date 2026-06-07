/**
 * Watch Mode Contract panel — opt-in CLI utility with generated runtime snapshot.
 */

import { Eye } from 'lucide-react'
import { GENERATED_APP_BRAIN_RUNTIME_SNAPSHOT } from '../generatedAppBrainRuntimeSnapshot'
import { DEFAULT_WATCH_MODE_CONFIG } from './appBrainWatchModeContract'
import type { WatchSource } from './appBrainWatchModeContract'
import { AppBrainPanelShell, StatCard } from './appBrainPanelShared'

const UTILITY_BADGES = [
  { label: 'Opt-in utility', color: '#34d399' },
  { label: 'No hooks', color: '#22d3ee' },
  { label: 'No auto-commit', color: '#a78bfa' },
  { label: 'No secrets', color: '#facc15' },
  { label: 'No financial values', color: '#fb7185' },
]

const REFRESH_SOURCES: WatchSource[] = [
  'app-brain-manifest',
  'work-manifest',
  'directory-manifest',
  'git-status',
  'context-freshness',
]

function UtilityBadge({ label, color }: { label: string; color: string }) {
  return (
    <span
      className="text-[10px] font-mono uppercase tracking-wider px-3 py-1.5 rounded-lg"
      style={{ color, background: `${color}14`, border: `1px solid ${color}33` }}
    >
      {label}
    </span>
  )
}

export default function AppBrainWatchModeContractPanel() {
  const snapshot = GENERATED_APP_BRAIN_RUNTIME_SNAPSHOT
  const config = DEFAULT_WATCH_MODE_CONFIG
  const generatedDate = new Date(snapshot.generatedAt).toLocaleString()
  const successCount = snapshot.generatorResults.filter((result) => result.success).length

  return (
    <AppBrainPanelShell
      mode="runtime"
      title="Watch Mode Contract"
      subtitle="Opt-in CLI refresh utility — generated snapshot only, not live dashboard state"
      icon={<Eye size={18} />}
      accent="#60a5fa"
    >
      <div className="flex flex-wrap gap-2">
        {UTILITY_BADGES.map((badge) => (
          <UtilityBadge key={badge.label} label={badge.label} color={badge.color} />
        ))}
      </div>

      <div
        className="rounded-xl p-3"
        style={{ background: 'rgba(96,165,250,0.06)', border: '1px solid rgba(96,165,250,0.16)' }}
      >
        <p className="text-xs text-blue-100/90 leading-relaxed">
          Watch mode is available as an opt-in CLI utility via{' '}
          <span className="font-mono">npm run app-brain:refresh</span> and{' '}
          <span className="font-mono">npm run app-brain:watch</span>. This panel shows the latest{' '}
          <span className="font-mono">generatedAppBrainRuntimeSnapshot.ts</span> file — not a websocket or live
          process unless you run watch mode separately in a terminal.
        </p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Snapshot time" value={generatedDate} color="#60a5fa" />
        <StatCard label="Branch" value={snapshot.branch ?? 'unknown'} color="#22d3ee" />
        <StatCard
          label="Git state"
          value={snapshot.gitClean === null ? 'unavailable' : snapshot.gitClean ? 'clean' : 'dirty'}
          color={snapshot.gitClean ? '#34d399' : '#facc15'}
        />
        <StatCard label="Changed files" value={snapshot.changedFileCount} color="#a78bfa" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
        <div className="rounded-xl p-3" style={{ background: 'rgba(3,7,18,0.5)', border: '1px solid rgba(34,211,238,0.16)' }}>
          <p className="text-[10px] uppercase tracking-widest text-cyan-200/80 mb-2">CLI commands</p>
          <div className="space-y-2 font-mono text-sm text-cyan-100">
            <p>npm run app-brain:refresh</p>
            <p>npm run app-brain:watch</p>
          </div>
          <p className="text-[10px] text-gray-500 mt-2">
            Mode: {snapshot.mode} · Available: {snapshot.isWatchModeAvailable ? 'yes' : 'no'} · Running at snapshot:{' '}
            {snapshot.isWatchModeRunning ? 'yes' : 'no'}
          </p>
        </div>

        <div className="rounded-xl p-3" style={{ background: 'rgba(3,7,18,0.5)', border: '1px solid rgba(167,139,250,0.16)' }}>
          <p className="text-[10px] uppercase tracking-widest text-violet-200/80 mb-2">Refreshed sources</p>
          <div className="flex flex-wrap gap-2">
            {snapshot.sourcesRefreshed.map((source) => (
              <span
                key={source}
                className="text-[10px] rounded-full px-2 py-1 font-mono"
                style={{ color: '#cbd5e1', background: 'rgba(15,23,42,0.7)', border: '1px solid rgba(148,163,184,0.14)' }}
              >
                {source}
              </span>
            ))}
          </div>
          <p className="text-[10px] text-gray-500 mt-2">
            Generators: {successCount}/{snapshot.generatorResults.length} succeeded
          </p>
        </div>
      </div>

      <div>
        <p className="text-[10px] uppercase tracking-widest text-gray-500 mb-2">Generator results</p>
        <div className="space-y-2">
          {snapshot.generatorResults.map((result) => (
            <div
              key={result.source}
              className="rounded-lg p-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2"
              style={{ background: 'rgba(3,7,18,0.5)', border: '1px solid rgba(148,163,184,0.12)' }}
            >
              <div>
                <p className="text-xs font-medium text-gray-200">{result.source}</p>
                <p className="text-[10px] font-mono text-gray-500 mt-0.5">{result.command}</p>
              </div>
              <div className="text-right">
                <span
                  className="text-[10px] uppercase font-mono px-2 py-1 rounded-full"
                  style={{
                    color: result.success ? '#34d399' : '#fb7185',
                    background: result.success ? 'rgba(52,211,153,0.1)' : 'rgba(251,113,133,0.1)',
                    border: `1px solid ${result.success ? 'rgba(52,211,153,0.25)' : 'rgba(251,113,133,0.25)'}`,
                  }}
                >
                  {result.success ? 'success' : 'failed'}
                </span>
                <p className="text-[10px] text-gray-600 font-mono mt-1">{result.durationMs}ms</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {snapshot.changedFiles.length > 0 ? (
        <div>
          <p className="text-[10px] uppercase tracking-widest text-gray-500 mb-2">Changed file paths (snapshot)</p>
          <div className="space-y-1 max-h-32 overflow-y-auto">
            {snapshot.changedFiles.slice(0, 12).map((file) => (
              <p key={file} className="text-[11px] font-mono text-gray-400 truncate">
                {file}
              </p>
            ))}
          </div>
        </div>
      ) : null}

      {snapshot.warnings.length > 0 ? (
        <div
          className="rounded-xl p-3"
          style={{ background: 'rgba(251,191,36,0.06)', border: '1px solid rgba(251,191,36,0.18)' }}
        >
          <p className="text-[10px] uppercase tracking-widest text-yellow-200/80 mb-2">Warnings</p>
          {snapshot.warnings.map((warning) => (
            <p key={warning} className="text-xs text-gray-400 leading-relaxed">
              - {warning}
            </p>
          ))}
        </div>
      ) : null}

      <div>
        <p className="text-[10px] uppercase tracking-widest text-gray-500 mb-2">Safety notes</p>
        <div className="space-y-1.5">
          {snapshot.safetyNotes.map((note) => (
            <p key={note} className="text-xs text-gray-400 leading-relaxed">
              - {note}
            </p>
          ))}
        </div>
      </div>

      <div
        className="rounded-xl p-3"
        style={{ background: 'rgba(15,23,42,0.48)', border: '1px solid rgba(148,163,184,0.12)' }}
      >
        <p className="text-[10px] uppercase tracking-widest text-gray-500 mb-2">Contract defaults (design)</p>
        <div className="grid grid-cols-2 gap-2 text-[11px] text-gray-400">
          <span>pollIntervalMs: {config.pollIntervalMs}</span>
          <span>safeMode: {config.safeMode ? 'enforced' : 'off'}</span>
          <span>neverStages: yes</span>
          <span>neverCommits: yes</span>
        </div>
        <p className="text-[10px] text-gray-600 mt-2">
          Expected refresh sources: {REFRESH_SOURCES.join(', ')}
        </p>
      </div>
    </AppBrainPanelShell>
  )
}

export { AppBrainWatchModeContractPanel }
