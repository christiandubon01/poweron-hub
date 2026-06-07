import { BookOpen } from 'lucide-react'
import { GENERATED_APP_BRAIN_WORK_MANIFEST } from '../generatedAppBrainWorkManifest'
import { AppBrainPanelShell, StatCard } from './appBrainPanelShared'

const FRESHNESS_COLORS: Record<string, string> = {
  recent: '#34d399',
  aging: '#facc15',
  stale: '#fb923c',
  missing: '#6b7280',
  unknown: '#94a3b8',
}

function freshnessLabel(freshness: string): string {
  if (freshness === 'recent') return 'Recent'
  if (freshness === 'aging') return 'Aging'
  if (freshness === 'stale') return 'Stale'
  if (freshness === 'missing') return 'Missing'
  return 'Unknown'
}

export default function AppBrainContextHubPanel() {
  const manifest = GENERATED_APP_BRAIN_WORK_MANIFEST
  const contextFiles = manifest.contextFiles
  const presentCount = contextFiles.filter((file) => file.exists).length
  const missingCount = contextFiles.filter((file) => !file.exists).length
  const recentCount = contextFiles.filter((file) => file.freshness === 'recent').length

  return (
    <AppBrainPanelShell
      title="Context Hub"
      subtitle="Agent context file snapshot from generated work manifest"
      icon={<BookOpen size={18} />}
      accent="#a78bfa"
    >
      <div
        className="rounded-xl p-3"
        style={{ background: 'rgba(251,191,36,0.06)', border: '1px solid rgba(251,191,36,0.18)' }}
      >
        <p className="text-xs text-yellow-200/90 leading-relaxed">{manifest.snapshotWarning}</p>
        <p className="text-[10px] text-gray-500 font-mono mt-2">
          Snapshot generated {new Date(manifest.generatedAt).toLocaleString()}
        </p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Context files" value={`${presentCount}/${contextFiles.length}`} color="#a78bfa" />
        <StatCard label="Recent" value={recentCount} color="#34d399" />
        <StatCard label="Missing" value={missingCount} color="#6b7280" />
        <StatCard label="Sources read" value={manifest.sourcesRead.length} color="#22d3ee" />
      </div>

      {missingCount > 0 && (
        <div
          className="rounded-xl p-3"
          style={{ background: 'rgba(127,29,29,0.12)', border: '1px solid rgba(251,113,133,0.16)' }}
        >
          <p className="text-[10px] uppercase tracking-widest text-rose-200/80 mb-1">
            Missing handoff warning (placeholder)
          </p>
          <p className="text-xs text-gray-300 leading-relaxed">
            {contextFiles
              .filter((file) => !file.exists)
              .map((file) => file.label)
              .join(', ')}{' '}
            not found. Add or regenerate before the next agent wave if handoff coverage is required.
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {contextFiles.map((file) => {
          const color = FRESHNESS_COLORS[file.freshness] ?? '#94a3b8'
          return (
            <div
              key={file.key}
              className="rounded-xl p-4 space-y-3"
              style={{
                background: 'rgba(3,7,18,0.58)',
                border: `1px solid ${color}28`,
              }}
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-gray-100">{file.label}</p>
                  <p className="text-[10px] font-mono text-gray-500 mt-0.5 break-all">{file.path}</p>
                </div>
                <span
                  className="text-[10px] uppercase tracking-wider font-mono px-2 py-1 rounded-full shrink-0"
                  style={{ color, background: `${color}14`, border: `1px solid ${color}33` }}
                >
                  {file.exists ? freshnessLabel(file.freshness) : 'Missing'}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2 text-[11px]">
                <div>
                  <p className="text-gray-500 uppercase tracking-wider text-[9px]">Exists</p>
                  <p className="text-gray-300 font-mono mt-0.5">{file.exists ? 'yes' : 'no'}</p>
                </div>
                <div>
                  <p className="text-gray-500 uppercase tracking-wider text-[9px]">Size</p>
                  <p className="text-gray-300 font-mono mt-0.5">
                    {file.exists ? `${file.sizeBytes.toLocaleString()} B` : '—'}
                  </p>
                </div>
                <div className="col-span-2">
                  <p className="text-gray-500 uppercase tracking-wider text-[9px]">Last updated</p>
                  <p className="text-gray-300 font-mono mt-0.5">
                    {file.modifiedAt ? new Date(file.modifiedAt).toLocaleString() : '—'}
                  </p>
                </div>
              </div>

              <div>
                <p className="text-[9px] uppercase tracking-wider text-gray-500 mb-1">Last report excerpt</p>
                {file.lastReportExcerpt ? (
                  <p className="text-xs text-gray-400 leading-relaxed">{file.lastReportExcerpt}</p>
                ) : (
                  <p className="text-[11px] text-gray-600">No excerpt available.</p>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {manifest.sourcesMissing.length > 0 && (
        <p className="text-[10px] text-gray-600 font-mono">
          Registry sources missing: {manifest.sourcesMissing.join(', ')}
        </p>
      )}
    </AppBrainPanelShell>
  )
}
