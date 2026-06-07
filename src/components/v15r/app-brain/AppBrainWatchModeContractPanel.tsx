/**
 * Watch Mode Contract preview — design specification only, not implemented.
 */

import { Eye } from 'lucide-react'
import { DEFAULT_WATCH_MODE_CONFIG } from './appBrainWatchModeContract'
import type { WatchSource } from './appBrainWatchModeContract'
import { AppBrainPanelShell, DesignOnlyBadge } from './appBrainPanelShared'

const WATCH_RESPONSIBILITIES = [
  'Work manifest freshness — signal when generatedAppBrainWorkManifest.ts is stale',
  'Directory manifest refresh — detect file structure drift vs generatedAppBrainDirectory.ts',
  'Context freshness — validate solarupgrade_agent_context/ coherence with active sessions',
  'Git status snapshot — branch, HEAD, dirty state (read-only, never stage or commit)',
  'Isolation boundary checks — flag unexpected touches to protected scope',
]

const SAFETY_CONSTRAINTS = [
  'Never modify package.json or package-lock.json',
  'Never modify .claude/settings.local.json',
  'Never stage or commit automatically',
  'Never capture secrets (.env, credentials)',
  'Exclude node_modules, dist, .vite cache from watch noise',
  'No live claim unless watch subprocess is actively running',
]

const REFRESH_SOURCES: WatchSource[] = [
  'work-manifest',
  'directory-manifest',
  'context-freshness',
  'git-status',
  'isolation-boundary',
  'config-watch',
  'user-command',
]

export default function AppBrainWatchModeContractPanel() {
  const config = DEFAULT_WATCH_MODE_CONFIG

  return (
    <AppBrainPanelShell
      mode="runtime"
      title="Watch Mode Contract"
      subtitle="Future npm run app-brain:watch specification — observe only, never modify"
      icon={<Eye size={18} />}
      accent="#60a5fa"
    >
      <div className="flex flex-wrap gap-2">
        <DesignOnlyBadge />
      </div>

      <div
        className="rounded-xl p-3"
        style={{ background: 'rgba(96,165,250,0.06)', border: '1px solid rgba(96,165,250,0.16)' }}
      >
        <p className="text-xs text-blue-100/90 leading-relaxed">
          Contract defined in <span className="font-mono">appBrainWatchModeContract.ts</span> and{' '}
          <span className="font-mono">APP_BRAIN_WATCH_MODE_DESIGN.md</span>. No file watching, polling, or package.json
          script changes in this wave.
        </p>
      </div>

      <div>
        <p className="text-[10px] uppercase tracking-widest text-gray-500 mb-2">Watch mode responsibilities</p>
        <div className="space-y-1.5">
          {WATCH_RESPONSIBILITIES.map((item) => (
            <p key={item} className="text-xs text-gray-400 leading-relaxed">
              - {item}
            </p>
          ))}
        </div>
      </div>

      <div>
        <p className="text-[10px] uppercase tracking-widest text-gray-500 mb-2">Future command contract</p>
        <div
          className="rounded-xl p-3 font-mono text-sm text-cyan-100"
          style={{ background: 'rgba(3,7,18,0.58)', border: '1px solid rgba(34,211,238,0.16)' }}
        >
          npm run app-brain:watch
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-2 text-[10px] font-mono text-gray-500">
          <span>poll: {config.pollIntervalMs}ms</span>
          <span>safeMode: {config.safeMode ? 'enforced' : 'off'}</span>
          <span>enabled: {config.enabled ? 'yes' : 'no (default)'}</span>
        </div>
      </div>

      <div>
        <p className="text-[10px] uppercase tracking-widest text-gray-500 mb-2">Sources to refresh</p>
        <div className="flex flex-wrap gap-2">
          {REFRESH_SOURCES.map((source) => (
            <span
              key={source}
              className="text-[10px] rounded-full px-2 py-1 font-mono"
              style={{ color: '#cbd5e1', background: 'rgba(15,23,42,0.7)', border: '1px solid rgba(148,163,184,0.14)' }}
            >
              {source}
            </span>
          ))}
        </div>
      </div>

      <div>
        <p className="text-[10px] uppercase tracking-widest text-gray-500 mb-2">Safety constraints</p>
        <div className="space-y-1.5">
          {SAFETY_CONSTRAINTS.map((item) => (
            <p key={item} className="text-xs text-gray-400 leading-relaxed">
              - {item}
            </p>
          ))}
        </div>
      </div>

      <div
        className="rounded-xl p-3"
        style={{ background: 'rgba(15,23,42,0.48)', border: '1px solid rgba(148,163,184,0.12)' }}
      >
        <p className="text-[10px] uppercase tracking-widest text-gray-500 mb-2">Expected behavior (when implemented)</p>
        <div className="grid grid-cols-2 gap-2 text-[11px] text-gray-400">
          <span>pollsManifests: yes</span>
          <span>neverStages: yes</span>
          <span>neverCommits: yes</span>
          <span>neverModifiesFiles: yes</span>
          <span>logsToFile: planned</span>
          <span>gracefulShutdown: planned</span>
        </div>
      </div>
    </AppBrainPanelShell>
  )
}

export { AppBrainWatchModeContractPanel }
