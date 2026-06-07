import { FolderTree } from 'lucide-react'
import { APP_BRAIN_DIRECTORY } from '../generatedAppBrainDirectory'
import { AppBrainPanelShell, StatCard } from './appBrainPanelShared'

export default function AppBrainDirectoryPanel() {
  const stats = APP_BRAIN_DIRECTORY.statistics
  const areaEntries = Object.entries(stats.filesPerArea).sort((a, b) => b[1] - a[1])
  const extensionEntries = Object.entries(stats.filesByExtension).sort((a, b) => b[1] - a[1])
  const topFiles = APP_BRAIN_DIRECTORY.allFiles.slice(0, 12)

  return (
    <AppBrainPanelShell
      title="Directory"
      subtitle="Generated directory index — full file tree arrives in Wave 2"
      icon={<FolderTree size={18} />}
      accent="#60a5fa"
    >
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Files indexed" value={stats.totalFiles} color="#60a5fa" />
        <StatCard label="Scan roots" value={APP_BRAIN_DIRECTORY.scanRoots.length} color="#22d3ee" />
        <StatCard label="Areas" value={areaEntries.length} color="#34d399" />
        <StatCard label="Extensions" value={extensionEntries.length} color="#a78bfa" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
        <div className="rounded-xl p-3" style={{ background: 'rgba(3,7,18,0.5)', border: '1px solid rgba(96,165,250,0.14)' }}>
          <p className="text-[10px] uppercase tracking-widest text-blue-200/80 mb-2">Area counts</p>
          <div className="space-y-1.5 max-h-[220px] overflow-y-auto pr-1">
            {areaEntries.map(([area, count]) => (
              <div key={area} className="flex items-center justify-between text-[11px]">
                <span className="text-gray-400 font-mono truncate mr-2">{area}</span>
                <span className="text-cyan-200 font-mono shrink-0">{count}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-xl p-3" style={{ background: 'rgba(3,7,18,0.5)', border: '1px solid rgba(167,139,250,0.14)' }}>
          <p className="text-[10px] uppercase tracking-widest text-violet-200/80 mb-2">Extension counts</p>
          <div className="space-y-1.5">
            {extensionEntries.map(([ext, count]) => (
              <div key={ext} className="flex items-center justify-between text-[11px]">
                <span className="text-gray-400 font-mono">{ext}</span>
                <span className="text-violet-200 font-mono">{count}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="rounded-xl p-3" style={{ background: 'rgba(3,7,18,0.5)', border: '1px solid rgba(148,163,184,0.12)' }}>
        <p className="text-[10px] uppercase tracking-widest text-gray-500 mb-2">Top file list (compact preview)</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5">
          {topFiles.map((file) => (
            <p key={file} className="text-[10px] font-mono text-gray-400 truncate">{file}</p>
          ))}
        </div>
        <p className="text-[10px] text-gray-600 mt-2 font-mono">
          Generated {new Date(APP_BRAIN_DIRECTORY.generatedAt).toLocaleString()} · v{APP_BRAIN_DIRECTORY.version}
        </p>
      </div>
    </AppBrainPanelShell>
  )
}
