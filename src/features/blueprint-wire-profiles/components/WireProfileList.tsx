import { Archive, Copy, Pencil, RotateCcw, Trash2 } from 'lucide-react'
import type { WireProfile } from '../types'
import type { WireProfileReferenceSummary } from '../wireProfileReferenceSummary'
import { WireProfilePreview } from './WireProfilePreview'

function toolLabel(tool: string): string {
  if (tool === 'circuit-path') return 'Path'
  if (tool === 'circuit-arc') return 'Arc'
  return tool
}

export function WireProfileList({
  profiles,
  selectedId,
  summaries,
  busy,
  onSelect,
  onDuplicate,
  onArchive,
  onRestore,
  onDelete,
}: {
  profiles: WireProfile[]
  selectedId: string | null
  summaries: Record<string, WireProfileReferenceSummary>
  busy: boolean
  onSelect: (profile: WireProfile) => void
  onDuplicate: (profile: WireProfile) => void
  onArchive: (profile: WireProfile) => void
  onRestore: (profile: WireProfile) => void
  onDelete: (profile: WireProfile) => void
}) {
  return (
    <div className="space-y-2">
      {profiles.map((profile) => {
        const refs = summaries[profile.id]?.totalLiveReferences || 0
        const canDelete = refs === 0
        return (
          <div
            key={profile.id}
            className={`rounded-md border p-3 ${selectedId === profile.id ? 'border-blue-500 bg-blue-950/25' : 'border-gray-800 bg-gray-950/35'}`}
          >
            <button
              type="button"
              onClick={() => onSelect(profile)}
              className="flex w-full min-w-0 items-start gap-3 text-left"
            >
              <WireProfilePreview color={profile.displayColor} width={profile.displayWidth} style={profile.displayStyle} />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className="truncate text-sm font-semibold text-gray-100">{profile.name}</span>
                  {profile.isArchived && <span className="rounded-full border border-amber-500/40 px-1.5 py-0.5 text-[10px] text-amber-300">Archived</span>}
                </span>
                <span className="mt-1 block text-xs text-gray-400">
                  {profile.installationFamily} · {[profile.materialDescription, profile.conductorDescription].filter(Boolean).join(' · ') || 'No material description'}
                </span>
                <span className="mt-1 block text-[11px] text-gray-500">
                  Waste {profile.wastePercent}%{profile.unitCost != null ? ` · $${profile.unitCost}/unit` : ''} · {profile.allowedTools.map(toolLabel).join(', ')} · {refs} live ref{refs === 1 ? '' : 's'}
                </span>
              </span>
            </button>
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" disabled={busy} onClick={() => onSelect(profile)} className="inline-flex min-h-10 items-center gap-1.5 rounded-md border border-gray-700 px-3 text-xs text-gray-300 hover:border-gray-500 hover:text-white disabled:opacity-50">
                <Pencil size={13} /> Edit
              </button>
              <button type="button" disabled={busy} onClick={() => onDuplicate(profile)} className="inline-flex min-h-10 items-center gap-1.5 rounded-md border border-gray-700 px-3 text-xs text-gray-300 hover:border-gray-500 hover:text-white disabled:opacity-50">
                <Copy size={13} /> Duplicate
              </button>
              {profile.isArchived ? (
                <button type="button" disabled={busy} onClick={() => onRestore(profile)} className="inline-flex min-h-10 items-center gap-1.5 rounded-md border border-emerald-600/50 px-3 text-xs text-emerald-300 hover:bg-emerald-950/30 disabled:opacity-50">
                  <RotateCcw size={13} /> Restore
                </button>
              ) : (
                <button type="button" disabled={busy} onClick={() => onArchive(profile)} className="inline-flex min-h-10 items-center gap-1.5 rounded-md border border-amber-600/50 px-3 text-xs text-amber-300 hover:bg-amber-950/30 disabled:opacity-50">
                  <Archive size={13} /> Archive
                </button>
              )}
              <button
                type="button"
                disabled={busy || !canDelete}
                onClick={() => onDelete(profile)}
                title={canDelete ? 'Permanently delete this unreferenced profile' : 'Referenced profiles cannot be permanently deleted'}
                className="inline-flex min-h-10 items-center gap-1.5 rounded-md border border-red-700/60 px-3 text-xs text-red-300 hover:bg-red-950/30 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Trash2 size={13} /> Delete
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
