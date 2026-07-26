import { X } from 'lucide-react'
import { formatWireLength } from '../formatting'
import type { WireProfile } from '@/features/blueprint-wire-profiles'
import type { WireProfileAssignmentPlan } from '../wireQuantityAssignment'

export function AssignWireProfileDialog({
  open,
  profiles,
  selectedProfileId,
  plan,
  packageNamesById = {},
  busy = false,
  onProfileChange,
  onCancel,
  onApply,
}: {
  open: boolean
  profiles: WireProfile[]
  selectedProfileId: string
  plan: WireProfileAssignmentPlan | null
  packageNamesById?: Record<string, string>
  busy?: boolean
  onProfileChange(profileId: string): void
  onCancel(): void
  onApply(): void
}) {
  if (!open) return null
  const selectedLength = plan?.selectedLengthByUnit || []
  const affectedPackageNames = (plan?.affectedPackageIds || []).map((id) => packageNamesById[id] || id)
  const canApply = !!plan?.ok && !!selectedProfileId && !busy

  return (
    <div className="fixed inset-0 z-[100003] flex items-center justify-center bg-black/70 px-4" onMouseDown={(e) => e.stopPropagation()}>
      <div className="w-full max-w-md rounded-lg border border-gray-700 bg-[#111827] shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 border-b border-gray-800 px-4 py-3">
          <div>
            <div id="assign-wire-profile-title" className="text-sm font-semibold text-gray-100">Assign Wire Profile</div>
            <div className="mt-0.5 text-xs text-gray-500">Apply to selected Unassigned quantities</div>
          </div>
          <button type="button" onClick={onCancel} className="rounded p-1 text-gray-400 hover:bg-white/10 hover:text-gray-200" title="Close" aria-label="Close assign wire profile dialog">
            <X size={14} />
          </button>
        </div>
        <div className="space-y-3 p-4" role="dialog" aria-modal="true" aria-labelledby="assign-wire-profile-title">
          <label className="block text-xs text-gray-300">
            Wire Profile
            <select
              value={selectedProfileId}
              onChange={(event) => onProfileChange(event.target.value)}
              className="mt-1 w-full rounded border border-gray-700 bg-gray-950/70 px-2 py-1.5 text-xs text-gray-100 outline-none focus:border-cyan-500"
            >
              <option value="">Select profile...</option>
              {profiles.map((profile) => (
                <option key={profile.id} value={profile.id}>{profile.name}</option>
              ))}
            </select>
          </label>

          <div className="grid grid-cols-3 gap-2">
            <div className="rounded border border-gray-800 bg-gray-950/40 px-2 py-1.5">
              <div className="text-[9px] uppercase text-gray-500">Routes</div>
              <div className="text-sm font-semibold text-gray-100">{plan?.routeCount || 0}</div>
            </div>
            <div className="rounded border border-gray-800 bg-gray-950/40 px-2 py-1.5">
              <div className="text-[9px] uppercase text-gray-500">Segments</div>
              <div className="text-sm font-semibold text-gray-100">{plan?.segmentCount || 0}</div>
            </div>
            <div className="rounded border border-gray-800 bg-gray-950/40 px-2 py-1.5">
              <div className="text-[9px] uppercase text-gray-500">Pages</div>
              <div className="text-sm font-semibold text-gray-100">{plan?.affectedPages.length || 0}</div>
            </div>
          </div>

          <div className="rounded border border-gray-800 bg-gray-950/40 px-2 py-2 text-[11px] text-gray-300">
            <div className="font-semibold text-gray-200">Selected measured length</div>
            <div className="mt-1 space-y-0.5">
              {selectedLength.length === 0 && <div className="text-gray-500">No measurable selection.</div>}
              {selectedLength.map((entry) => (
                <div key={entry.unit || 'not-configured'} className="tabular-nums">{formatWireLength(entry.measuredLength, entry.unit)}</div>
              ))}
            </div>
            <div className="mt-2 text-gray-500">Packages: {affectedPackageNames.length ? affectedPackageNames.join(', ') : 'None'}</div>
          </div>

          {plan && (plan.warnings.length > 0 || plan.errors.length > 0) && (
            <div className="space-y-1">
              {plan.errors.map((error) => (
                <div key={error} className="rounded border border-red-800/60 bg-red-950/30 px-2 py-1 text-[10px] text-red-200">{error}</div>
              ))}
              {plan.warnings.map((warning) => (
                <div key={warning} className="rounded border border-amber-700/50 bg-amber-950/30 px-2 py-1 text-[10px] text-amber-200">{warning}</div>
              ))}
            </div>
          )}

          <div className="flex justify-end gap-2 border-t border-gray-800 pt-3">
            <button type="button" onClick={onCancel} disabled={busy} className="rounded border border-gray-700 px-3 py-1.5 text-xs text-gray-300 hover:bg-white/5 disabled:opacity-60">
              Cancel
            </button>
            <button type="button" onClick={onApply} disabled={!canApply} className="rounded bg-cyan-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-cyan-500 disabled:cursor-not-allowed disabled:bg-gray-700 disabled:text-gray-400">
              {busy ? 'Assigning...' : 'Apply'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
