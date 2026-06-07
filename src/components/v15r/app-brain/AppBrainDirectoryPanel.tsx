import { useMemo, useState } from 'react'
import { FolderTree, Search } from 'lucide-react'
import { APP_BRAIN_DIRECTORY } from '../generatedAppBrainDirectory'
import { AppBrainPanelShell, StatCard } from './appBrainPanelShared'
import {
  APP_BRAIN_DIRECTORY_ALL,
  countDirectoryValues,
  filterDirectoryFiles,
  formatFileSize,
  type AppBrainDirectoryFilters,
} from './appBrainDirectoryBrain'

interface AppBrainDirectoryPanelProps {
  selectedFilePath: string | null
  onSelectFile: (filePath: string) => void
}

const CONTROL_STYLE = {
  background: 'rgba(3,7,18,0.72)',
  border: '1px solid rgba(148,163,184,0.18)',
  color: '#dbeafe',
}

export default function AppBrainDirectoryPanel({
  selectedFilePath,
  onSelectFile,
}: AppBrainDirectoryPanelProps) {
  const files = APP_BRAIN_DIRECTORY.fileMetadata
  const stats = APP_BRAIN_DIRECTORY.statistics
  const [filters, setFilters] = useState<AppBrainDirectoryFilters>({
    search: '',
    area: APP_BRAIN_DIRECTORY_ALL,
    extension: APP_BRAIN_DIRECTORY_ALL,
  })

  const areaEntries = useMemo(() => countDirectoryValues(files, (file) => file.area), [files])
  const extensionEntries = useMemo(() => countDirectoryValues(files, (file) => file.extension), [files])
  const filteredFiles = useMemo(() => filterDirectoryFiles(files, filters), [files, filters])
  const visibleFiles = filteredFiles.slice(0, 180)

  return (
    <AppBrainPanelShell
      title="Directory Brain"
      subtitle="Searchable generated file/component index"
      icon={<FolderTree size={18} />}
      accent="#60a5fa"
    >
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Files indexed" value={stats.totalFiles} color="#60a5fa" />
        <StatCard label="Matches" value={filteredFiles.length} color="#22d3ee" />
        <StatCard label="Areas" value={areaEntries.length} color="#34d399" />
        <StatCard label="Extensions" value={extensionEntries.length} color="#a78bfa" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_210px_150px] gap-3">
        <label className="block">
          <span className="text-[10px] uppercase tracking-widest text-gray-500 mb-1.5 flex items-center gap-1.5">
            <Search size={12} />
            Search files, components, exports
          </span>
          <input
            value={filters.search}
            onChange={(event) => setFilters({ ...filters, search: event.target.value })}
            placeholder="Try AppBrain, backup, panel, service..."
            className="w-full rounded-xl px-3 py-2 text-xs outline-none"
            style={CONTROL_STYLE}
          />
        </label>

        <label className="block">
          <span className="text-[10px] uppercase tracking-widest text-gray-500 mb-1.5 block">Area</span>
          <select
            value={filters.area}
            onChange={(event) => setFilters({ ...filters, area: event.target.value })}
            className="w-full rounded-xl px-3 py-2 text-xs outline-none"
            style={CONTROL_STYLE}
          >
            <option value={APP_BRAIN_DIRECTORY_ALL}>All areas</option>
            {areaEntries.map(([area, count]) => (
              <option key={area} value={area}>{area} ({count})</option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="text-[10px] uppercase tracking-widest text-gray-500 mb-1.5 block">Extension</span>
          <select
            value={filters.extension}
            onChange={(event) => setFilters({ ...filters, extension: event.target.value })}
            className="w-full rounded-xl px-3 py-2 text-xs outline-none"
            style={CONTROL_STYLE}
          >
            <option value={APP_BRAIN_DIRECTORY_ALL}>All types</option>
            {extensionEntries.map(([extension, count]) => (
              <option key={extension} value={extension}>{extension} ({count})</option>
            ))}
          </select>
        </label>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[220px_160px_1fr] gap-3">
        <div className="rounded-xl p-3" style={{ background: 'rgba(3,7,18,0.5)', border: '1px solid rgba(96,165,250,0.14)' }}>
          <p className="text-[10px] uppercase tracking-widest text-blue-200/80 mb-2">Area counts</p>
          <div className="space-y-1.5 max-h-[190px] overflow-y-auto pr-1">
            {areaEntries.map(([area, count]) => (
              <button
                key={area}
                type="button"
                onClick={() => setFilters({ ...filters, area })}
                className="w-full flex items-center justify-between gap-2 text-left text-[11px] rounded-lg px-2 py-1"
                style={{
                  background: filters.area === area ? 'rgba(96,165,250,0.14)' : 'transparent',
                  color: filters.area === area ? '#bfdbfe' : '#9ca3af',
                }}
              >
                <span className="font-mono truncate">{area.replace('src/', '')}</span>
                <span className="text-cyan-200 font-mono shrink-0">{count}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-xl p-3" style={{ background: 'rgba(3,7,18,0.5)', border: '1px solid rgba(167,139,250,0.14)' }}>
          <p className="text-[10px] uppercase tracking-widest text-violet-200/80 mb-2">Extension counts</p>
          <div className="space-y-1.5">
            {extensionEntries.map(([extension, count]) => (
              <button
                key={extension}
                type="button"
                onClick={() => setFilters({ ...filters, extension })}
                className="w-full flex items-center justify-between gap-2 text-left text-[11px] rounded-lg px-2 py-1"
                style={{
                  background: filters.extension === extension ? 'rgba(167,139,250,0.14)' : 'transparent',
                  color: filters.extension === extension ? '#ddd6fe' : '#9ca3af',
                }}
              >
                <span className="font-mono">{extension}</span>
                <span className="text-violet-200 font-mono">{count}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-xl overflow-hidden" style={{ background: 'rgba(3,7,18,0.5)', border: '1px solid rgba(148,163,184,0.12)' }}>
          <div className="flex items-center justify-between gap-3 px-3 py-2" style={{ borderBottom: '1px solid rgba(148,163,184,0.12)' }}>
            <p className="text-[10px] uppercase tracking-widest text-gray-500">File index</p>
            <p className="text-[10px] text-gray-600 font-mono">
              {visibleFiles.length}/{filteredFiles.length} shown
            </p>
          </div>
          <div className="max-h-[390px] overflow-y-auto">
            {visibleFiles.map((file) => {
              const selected = file.path === selectedFilePath
              return (
                <button
                  key={file.path}
                  type="button"
                  onClick={() => onSelectFile(file.path)}
                  className="w-full text-left px-3 py-2 transition-colors"
                  style={{
                    background: selected ? 'rgba(34,211,238,0.12)' : 'transparent',
                    borderBottom: '1px solid rgba(148,163,184,0.08)',
                  }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[11px] font-mono text-gray-200 truncate">{file.path}</p>
                      <p className="text-[10px] text-gray-500 truncate">
                        {file.components.length ? `components: ${file.components.slice(0, 3).join(', ')}` : file.parentDirectory}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-[10px] font-mono text-cyan-200">{file.extension}</p>
                      <p className="text-[10px] text-gray-600">{formatFileSize(file.size)}</p>
                    </div>
                  </div>
                </button>
              )
            })}
            {filteredFiles.length === 0 && (
              <div className="px-3 py-8 text-center text-xs text-gray-500">
                No files match the current filters.
              </div>
            )}
          </div>
        </div>
      </div>

      <p className="text-[10px] text-gray-600 font-mono">
        Generated {new Date(APP_BRAIN_DIRECTORY.generatedAt).toLocaleString()} / v{APP_BRAIN_DIRECTORY.version}
      </p>
    </AppBrainPanelShell>
  )
}
