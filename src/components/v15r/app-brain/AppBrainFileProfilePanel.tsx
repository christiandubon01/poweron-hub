import { FileSearch } from 'lucide-react'
import type { AppBrainDirectoryFile } from '../generatedAppBrainDirectory'
import { AppBrainPanelShell, EmptyState, StatCard } from './appBrainPanelShared'
import {
  formatFileSize,
  getCanarySuggestionPlaceholder,
  getDirectoryRiskPlaceholder,
  getRelatedActiveWork,
  getRelatedBacklogTasks,
  getSafeEditNotesPlaceholder,
} from './appBrainDirectoryBrain'

interface AppBrainFileProfilePanelProps {
  file: AppBrainDirectoryFile | null
}

function DetailRow({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg px-3 py-2" style={{ background: 'rgba(3,7,18,0.5)', border: '1px solid rgba(148,163,184,0.1)' }}>
      <p className="text-[9px] uppercase tracking-widest text-gray-500">{label}</p>
      <p className="text-[11px] text-gray-200 font-mono mt-1 break-words">{value}</p>
    </div>
  )
}

function TokenList({ label, values, emptyLabel }: { label: string; values: readonly string[]; emptyLabel: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-widest text-gray-500 mb-2">{label}</p>
      {values.length ? (
        <div className="flex flex-wrap gap-1.5">
          {values.map((value) => (
            <span
              key={value}
              className="text-[10px] rounded-full px-2 py-1 font-mono"
              style={{ color: '#bfdbfe', background: 'rgba(37,99,235,0.14)', border: '1px solid rgba(96,165,250,0.16)' }}
            >
              {value}
            </span>
          ))}
        </div>
      ) : (
        <p className="text-[11px] text-gray-600 font-mono">{emptyLabel}</p>
      )}
    </div>
  )
}

export default function AppBrainFileProfilePanel({ file }: AppBrainFileProfilePanelProps) {
  const relatedWork = getRelatedActiveWork(file)
  const relatedBacklog = getRelatedBacklogTasks(file)

  return (
    <AppBrainPanelShell
      title="File Profile"
      subtitle="Read-only generated file profile"
      icon={<FileSearch size={18} />}
      accent="#22d3ee"
    >
      {!file ? (
        <EmptyState message="Select a file in Directory Brain to inspect metadata, dependencies, related seed work, and safe-edit placeholders." />
      ) : (
        <div className="space-y-4">
          <div className="rounded-xl p-4" style={{ background: 'rgba(8,47,73,0.2)', border: '1px solid rgba(34,211,238,0.18)' }}>
            <p className="text-[10px] uppercase tracking-widest text-cyan-200/80">Selected file</p>
            <h3 className="text-sm text-gray-100 font-mono mt-2 break-words">{file.path}</h3>
            <p className="text-[10px] text-gray-500 font-mono mt-2">{file.fileId}</p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <StatCard label="Imports" value={file.importCount} color="#60a5fa" />
            <StatCard label="Imported by" value={file.importedByCount} color="#34d399" />
            <StatCard label="Components" value={file.components.length} color="#a78bfa" />
            <StatCard label="Backlog links" value={relatedBacklog.length} color="#facc15" />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-1 gap-2">
            <DetailRow label="Parent directory" value={file.parentDirectory} />
            <DetailRow label="Area / domain" value={file.area} />
            <DetailRow label="Extension / type" value={file.extension} />
            <DetailRow label="File size" value={formatFileSize(file.size)} />
          </div>

          <TokenList label="Detected components" values={file.components} emptyLabel="No PascalCase component names detected" />
          <TokenList label="Detected exports" values={file.exports} emptyLabel="No named/default exports detected" />

          <div className="rounded-xl p-3" style={{ background: 'rgba(3,7,18,0.5)', border: '1px solid rgba(52,211,153,0.14)' }}>
            <p className="text-[10px] uppercase tracking-widest text-emerald-300/80 mb-2">Imported by</p>
            {file.importedBy.length ? (
              <div className="space-y-1.5 max-h-[120px] overflow-y-auto pr-1">
                {file.importedBy.slice(0, 12).map((importer) => (
                  <p key={importer} className="text-[10px] font-mono text-gray-400 truncate">{importer}</p>
                ))}
              </div>
            ) : (
              <p className="text-[11px] text-gray-600 font-mono">No local imported-by records in this generated index</p>
            )}
          </div>

          <div className="rounded-xl p-3" style={{ background: 'rgba(15,23,42,0.58)', border: '1px solid rgba(96,165,250,0.16)' }}>
            <p className="text-[10px] uppercase tracking-widest text-blue-200/80 mb-2">Related active work</p>
            {relatedWork.length ? (
              <div className="space-y-2">
                {relatedWork.map((work) => (
                  <div key={`${work.sessionId}-${work.fileStatus}`} className="text-[11px]">
                    <p className="text-gray-200">{work.agent} / {work.status} / {work.fileStatus}</p>
                    <p className="text-gray-500 leading-snug">{work.task}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[11px] text-gray-600 font-mono">No related Wave 01 seed session claims</p>
            )}
          </div>

          <div className="rounded-xl p-3" style={{ background: 'rgba(15,23,42,0.58)', border: '1px solid rgba(250,204,21,0.16)' }}>
            <p className="text-[10px] uppercase tracking-widest text-yellow-200/80 mb-2">Related backlog</p>
            {relatedBacklog.length ? (
              <div className="space-y-2">
                {relatedBacklog.slice(0, 5).map((task) => (
                  <div key={task.taskId} className="text-[11px]">
                    <p className="text-gray-200">{task.title}</p>
                    <p className="text-gray-500 font-mono">{task.domain} / {task.status} / {task.priority}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[11px] text-gray-600 font-mono">No related backlog tasks in seed registry</p>
            )}
          </div>

          <div className="grid grid-cols-1 gap-2">
            <DetailRow label="Risk placeholder" value={getDirectoryRiskPlaceholder(file)} />
            <DetailRow label="Safe edit notes" value={getSafeEditNotesPlaceholder(file)} />
            <DetailRow label="Canary suggestion" value={getCanarySuggestionPlaceholder(file)} />
          </div>
        </div>
      )}
    </AppBrainPanelShell>
  )
}
