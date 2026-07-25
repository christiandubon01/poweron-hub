import type { WireProfileAllowedTool } from '../types'
import { Check } from 'lucide-react'
import {
  getAllowedToolOptionClassName,
  getUnitCostAffordance,
} from '../wireProfileManagerState'
import {
  WIRE_DISPLAY_STYLES,
  WIRE_INSTALLATION_FAMILIES,
  WIRE_PROFILE_ALLOWED_TOOLS,
} from '../wireProfileModel'
import type { WireProfileDraft, WireProfileDraftErrors } from '../wireProfileDraftValidation'
import { WireProfilePreview } from './WireProfilePreview'

const TOOL_LABELS: Record<WireProfileAllowedTool, string> = {
  'circuit-path': 'Circuit Path',
  'circuit-arc': 'Circuit Arc',
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null
  return <div className="mt-1 text-[11px] text-red-300">{message}</div>
}

export function WireProfileForm({
  draft,
  errors,
  busy,
  mode,
  projectReady,
  onChange,
  onSave,
  onSecondaryAction,
}: {
  draft: WireProfileDraft
  errors: WireProfileDraftErrors
  busy: boolean
  mode: 'create' | 'edit'
  projectReady: boolean
  onChange: (draft: WireProfileDraft) => void
  onSave: () => void
  onSecondaryAction: () => void
}) {
  const unitCostAffordance = getUnitCostAffordance()
  const set = (patch: Partial<WireProfileDraft>) => onChange({ ...draft, ...patch })
  const toggleTool = (tool: WireProfileAllowedTool) => {
    const current = new Set(draft.allowedTools)
    if (current.has(tool)) current.delete(tool)
    else current.add(tool)
    set({ allowedTools: Array.from(current) })
  }

  const saveDisabled = busy || !projectReady || Object.keys(errors).length > 0

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h4 className="text-sm font-semibold text-gray-100">{mode === 'create' ? 'New Profile' : 'Edit Profile'}</h4>
            <p className="mt-0.5 text-xs text-gray-500">Defaults for future circuit drawing.</p>
          </div>
          <WireProfilePreview color={draft.displayColor} width={Number(draft.displayWidth) || 1} style={draft.displayStyle} />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-xs text-gray-400 sm:col-span-2">
            Profile Name
            <input value={draft.name} disabled={busy} onChange={(event) => set({ name: event.target.value })} className="mt-1 w-full rounded-md border border-gray-700 bg-gray-950/60 px-3 py-2 text-sm text-gray-100 outline-none focus:border-blue-500 disabled:opacity-50" />
            <FieldError message={errors.name} />
          </label>

          <label className="block text-xs text-gray-400">
            Installation Family
            <select value={draft.installationFamily} disabled={busy} onChange={(event) => set({ installationFamily: event.target.value })} className="mt-1 w-full rounded-md border border-gray-700 bg-gray-950/60 px-3 py-2 text-sm text-gray-100 outline-none focus:border-blue-500 disabled:opacity-50">
              {WIRE_INSTALLATION_FAMILIES.map((family) => <option key={family} value={family}>{family}</option>)}
            </select>
            <FieldError message={errors.installationFamily} />
          </label>

          <label className="block text-xs text-gray-400">
            Material Description
            <input value={draft.materialDescription || ''} disabled={busy} onChange={(event) => set({ materialDescription: event.target.value })} className="mt-1 w-full rounded-md border border-gray-700 bg-gray-950/60 px-3 py-2 text-sm text-gray-100 outline-none focus:border-blue-500 disabled:opacity-50" />
          </label>

          <label className="block text-xs text-gray-400 sm:col-span-2">
            Conductor Description
            <input value={draft.conductorDescription || ''} disabled={busy} onChange={(event) => set({ conductorDescription: event.target.value })} className="mt-1 w-full rounded-md border border-gray-700 bg-gray-950/60 px-3 py-2 text-sm text-gray-100 outline-none focus:border-blue-500 disabled:opacity-50" />
          </label>

          <label className="block text-xs text-gray-400">
            Display Color
            <input type="color" value={draft.displayColor} disabled={busy} onChange={(event) => set({ displayColor: event.target.value })} className="mt-1 h-11 w-full rounded-md border border-gray-700 bg-gray-950/60 px-2 py-1 disabled:opacity-50" />
            <FieldError message={errors.displayColor} />
          </label>

          <label className="block text-xs text-gray-400">
            Display Width
            <input type="number" min="0.1" step="0.1" value={draft.displayWidth} disabled={busy} onChange={(event) => set({ displayWidth: event.target.value })} className="mt-1 w-full rounded-md border border-gray-700 bg-gray-950/60 px-3 py-2 text-sm text-gray-100 outline-none focus:border-blue-500 disabled:opacity-50" />
            <FieldError message={errors.displayWidth} />
          </label>

          <label className="block text-xs text-gray-400">
            Display Style
            <select value={draft.displayStyle} disabled={busy} onChange={(event) => set({ displayStyle: event.target.value })} className="mt-1 w-full rounded-md border border-gray-700 bg-gray-950/60 px-3 py-2 text-sm text-gray-100 outline-none focus:border-blue-500 disabled:opacity-50">
              {WIRE_DISPLAY_STYLES.map((style) => <option key={style} value={style}>{style}</option>)}
            </select>
            <FieldError message={errors.displayStyle} />
          </label>

          <label className="block text-xs text-gray-400">
            Waste Percent
            <input type="number" min="0" max="100" step="0.1" value={draft.wastePercent} disabled={busy} onChange={(event) => set({ wastePercent: event.target.value })} className="mt-1 w-full rounded-md border border-gray-700 bg-gray-950/60 px-3 py-2 text-sm text-gray-100 outline-none focus:border-blue-500 disabled:opacity-50" />
            <FieldError message={errors.wastePercent} />
          </label>

          <label className="block text-xs text-gray-400">
            Unit Cost
            <div className="mt-1 flex overflow-hidden rounded-md border border-gray-700 bg-gray-950/60 focus-within:border-blue-500">
              <span className="inline-flex items-center border-r border-gray-700 px-3 text-sm font-semibold text-gray-300">{unitCostAffordance.prefix}</span>
              <input type="number" inputMode={unitCostAffordance.inputMode} min="0" step="0.01" value={draft.unitCost ?? ''} disabled={busy} onChange={(event) => set({ unitCost: event.target.value })} className="min-w-0 flex-1 bg-transparent px-3 py-2 text-sm text-gray-100 outline-none disabled:opacity-50" aria-describedby="wire-profile-unit-cost-hint" />
              <span id="wire-profile-unit-cost-hint" className="inline-flex items-center border-l border-gray-700 px-3 text-[11px] font-semibold text-gray-500">{unitCostAffordance.hint}</span>
            </div>
            <FieldError message={errors.unitCost} />
          </label>

          <label className="block text-xs text-gray-400 sm:col-span-2">
            Cost Reference
            <input value={draft.costReference || ''} disabled={busy} onChange={(event) => set({ costReference: event.target.value })} className="mt-1 w-full rounded-md border border-gray-700 bg-gray-950/60 px-3 py-2 text-sm text-gray-100 outline-none focus:border-blue-500 disabled:opacity-50" />
          </label>

          <div className="sm:col-span-2">
            <div className="mb-1 text-xs text-gray-400">Allowed Tools</div>
            <div className="flex flex-wrap gap-2">
              {WIRE_PROFILE_ALLOWED_TOOLS.map((tool) => (
                <label key={tool} className={`inline-flex min-h-11 items-center gap-2 rounded-md border px-3 text-xs font-semibold transition-colors ${getAllowedToolOptionClassName(draft.allowedTools.includes(tool))}`}>
                  <input type="checkbox" checked={draft.allowedTools.includes(tool)} disabled={busy} onChange={() => toggleTool(tool)} className="sr-only" />
                  <span className={`inline-flex h-4 w-4 items-center justify-center rounded border ${draft.allowedTools.includes(tool) ? 'border-blue-300 bg-blue-500 text-white' : 'border-gray-600 bg-gray-950'}`} aria-hidden="true">
                    {draft.allowedTools.includes(tool) ? <Check size={12} strokeWidth={3} /> : null}
                  </span>
                  {TOOL_LABELS[tool]}
                </label>
              ))}
            </div>
            <FieldError message={errors.allowedTools} />
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-gray-800 bg-[#111827] px-4 py-3">
        <button type="button" disabled={busy} onClick={onSecondaryAction} className="inline-flex min-h-11 items-center rounded-md border border-gray-700 px-4 text-sm text-gray-300 hover:border-gray-500 hover:text-white disabled:opacity-50">
          {mode === 'create' ? 'Reset' : 'Cancel Edit'}
        </button>
        <button type="button" disabled={saveDisabled} onClick={onSave} className="inline-flex min-h-11 items-center rounded-md bg-blue-600 px-5 text-sm font-semibold text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50">
          {busy ? 'Saving...' : mode === 'create' ? 'Create Profile' : 'Save Profile'}
        </button>
      </div>
    </div>
  )
}
