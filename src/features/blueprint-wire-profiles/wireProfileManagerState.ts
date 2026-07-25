import type { WireProfile } from './types'
import { defaultWireProfileDraft, type WireProfileDraft } from './wireProfileDraftValidation'

export type WireProfileFilter = 'active' | 'archived'
export type WireProfileListState = 'empty' | 'archived-only' | 'has-active' | 'has-archived'
export type WireProfileActionState = 'idle' | 'create' | 'update' | 'duplicate' | 'archive' | 'restore' | 'delete' | 'starters'
export type WireProfileSaveStatus = 'success' | 'warning' | 'error'
export type WireProfileEscapeOutcome = 'cancel-confirm' | 'ignore' | 'close'
export type WireProfileCloseRequestResult = 'blocked-busy' | 'blocked-confirm' | 'open-discard-confirm' | 'force-close'
export type WireProfileDiscardDraftAction =
  | { kind: 'close-manager' }
  | { kind: 'reset-create' }
  | { kind: 'cancel-edit' }
  | { kind: 'start-new' }
  | { kind: 'select-profile'; profileId: string }
export type WireProfileProjectChangeResult = 'no-op' | 'force-close-reset'
export type WireProfileViewerEscapeResult = 'delegate-to-manager' | 'handle-viewer-escape'
export type WireProfileConfirmCancelResult = 'clear-confirm-keep-manager'
export type WireProfileConfirmationState =
  | { type: 'archive'; profileId: string }
  | { type: 'delete'; profileId: string }
  | { type: 'discard-draft'; action: WireProfileDiscardDraftAction }
  | null

export function filterWireProfiles(profiles: WireProfile[], filter: WireProfileFilter): WireProfile[] {
  return (Array.isArray(profiles) ? profiles : [])
    .filter((profile) => !profile.deletedAt)
    .filter((profile) => filter === 'archived' ? profile.isArchived : !profile.isArchived)
}

export function getWireProfileListState(profiles: WireProfile[], filter: WireProfileFilter): WireProfileListState {
  const live = (Array.isArray(profiles) ? profiles : []).filter((profile) => !profile.deletedAt)
  const active = live.filter((profile) => !profile.isArchived)
  const archived = live.filter((profile) => profile.isArchived)
  if (live.length === 0) return 'empty'
  if (active.length === 0 && archived.length > 0 && filter === 'active') return 'archived-only'
  return filter === 'archived' ? 'has-archived' : 'has-active'
}

export function reconcileWireProfileSelection(
  previousSelectedId: string | null,
  profiles: WireProfile[],
): string | null {
  const selected = String(previousSelectedId || '').trim()
  if (selected && profiles.some((profile) => profile.id === selected && !profile.deletedAt)) return selected
  return null
}

export function canStartWireProfileAction(action: WireProfileActionState): boolean {
  return action === 'idle'
}

export function canDismissWireProfileManager({
  busy,
  confirmOpen,
}: {
  busy: boolean
  confirmOpen: boolean
}): boolean {
  return !busy && !confirmOpen
}

export function getWireProfileEscapeOutcome({
  busy,
  confirmOpen,
}: {
  busy: boolean
  confirmOpen: boolean
}): WireProfileEscapeOutcome {
  if (confirmOpen) return 'cancel-confirm'
  if (busy) return 'ignore'
  return 'close'
}

export function getWireProfileCloseRequestResult({
  busy,
  confirmOpen,
  dirty,
}: {
  busy: boolean
  confirmOpen: boolean
  dirty: boolean
}): WireProfileCloseRequestResult {
  if (busy) return 'blocked-busy'
  if (confirmOpen) return 'blocked-confirm'
  if (dirty) return 'open-discard-confirm'
  return 'force-close'
}

export function getWireProfileConfirmedDiscardResult(action: WireProfileDiscardDraftAction): 'force-close' | 'apply-local-discard' {
  return action.kind === 'close-manager' ? 'force-close' : 'apply-local-discard'
}

export function getWireProfileConfirmCancelResult(): WireProfileConfirmCancelResult {
  return 'clear-confirm-keep-manager'
}

export function classifyWireProfileSaveResult(result: unknown): WireProfileSaveStatus {
  if (!result || typeof result !== 'object') return 'error'
  const saveResult = result as { localSaved?: unknown; cloudSynced?: unknown; warning?: unknown; error?: unknown }
  if (typeof saveResult.error === 'string' && saveResult.error.trim()) return 'error'
  if (saveResult.localSaved !== true) return 'error'
  if ((typeof saveResult.warning === 'string' && saveResult.warning.trim()) || saveResult.cloudSynced === false) return 'warning'
  if (saveResult.cloudSynced !== true) return 'warning'
  return 'success'
}

function normalizeDraftValue(value: unknown, numeric = false): string | number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  const text = String(value ?? '').trim()
  if (!text) return undefined
  const numericValue = Number(text)
  if (numeric && Number.isFinite(numericValue)) return numericValue
  return text
}

export function draftFromWireProfile(profile: WireProfile): WireProfileDraft {
  return {
    name: profile.name,
    installationFamily: profile.installationFamily,
    materialDescription: profile.materialDescription || '',
    conductorDescription: profile.conductorDescription || '',
    displayColor: profile.displayColor,
    displayWidth: profile.displayWidth,
    displayStyle: profile.displayStyle,
    wastePercent: profile.wastePercent,
    unitCost: profile.unitCost ?? '',
    costReference: profile.costReference || '',
    allowedTools: [...profile.allowedTools],
  }
}

export function isWireProfileDraftDirty({
  draft,
  baselineDraft,
}: {
  draft: WireProfileDraft
  baselineDraft?: WireProfileDraft | null
}): boolean {
  const baseline = baselineDraft || defaultWireProfileDraft()
  const fields: Array<keyof WireProfileDraft> = [
    'name',
    'installationFamily',
    'materialDescription',
    'conductorDescription',
    'displayColor',
    'displayWidth',
    'displayStyle',
    'wastePercent',
    'unitCost',
    'costReference',
  ]
  const numericFields = new Set<keyof WireProfileDraft>(['displayWidth', 'wastePercent', 'unitCost'])
  for (const field of fields) {
    if (normalizeDraftValue(draft[field], numericFields.has(field)) !== normalizeDraftValue(baseline[field], numericFields.has(field))) return true
  }
  const draftTools = [...new Set((draft.allowedTools || []).map((tool) => String(tool).trim()).filter(Boolean))].sort()
  const baselineTools = [...new Set((baseline.allowedTools || []).map((tool) => String(tool).trim()).filter(Boolean))].sort()
  return draftTools.join('\n') !== baselineTools.join('\n')
}

export function getWireProfileProjectChangeResult({
  open,
  previousProjectId,
  nextProjectId,
}: {
  open: boolean
  previousProjectId: string | null | undefined
  nextProjectId: string | null | undefined
}): WireProfileProjectChangeResult {
  if (!open) return 'no-op'
  return String(previousProjectId || '').trim() === String(nextProjectId || '').trim()
    ? 'no-op'
    : 'force-close-reset'
}

export function shouldCloseWireProfileManagerForProjectChange({
  isOpen,
  previousProjectId,
  nextProjectId,
}: {
  isOpen: boolean
  previousProjectId: string | null | undefined
  nextProjectId: string | null | undefined
}): boolean {
  return getWireProfileProjectChangeResult({
    open: isOpen,
    previousProjectId,
    nextProjectId,
  }) === 'force-close-reset'
}

export function getWireProfileViewerEscapeResult(managerOpen: boolean): WireProfileViewerEscapeResult {
  return managerOpen ? 'delegate-to-manager' : 'handle-viewer-escape'
}

export function reconcileWireProfileConfirmationForRefresh(
  confirm: WireProfileConfirmationState,
  profiles: WireProfile[],
): { confirm: WireProfileConfirmationState; cleared: boolean } {
  if (!confirm) return { confirm: null, cleared: false }
  if (confirm.type === 'discard-draft' && confirm.action.kind !== 'select-profile') return { confirm, cleared: false }
  const targetId = confirm.type === 'discard-draft' && confirm.action.kind === 'select-profile'
    ? confirm.action.profileId
    : confirm.type === 'discard-draft'
      ? ''
      : confirm.profileId
  const targetExists = (Array.isArray(profiles) ? profiles : []).some((profile) => profile.id === targetId && !profile.deletedAt)
  return targetExists ? { confirm, cleared: false } : { confirm: null, cleared: true }
}

export function dirtyDraftRequiresConfirmation({
  draft,
  baselineDraft,
}: {
  draft: WireProfileDraft
  baselineDraft?: WireProfileDraft | null
}): boolean {
  return isWireProfileDraftDirty({ draft, baselineDraft })
}

export function canApplyWireProfileAsyncResult({
  mounted,
  projectId,
  expectedProjectId,
  sessionId,
  currentSessionId,
  actionToken,
  currentActionToken,
}: {
  mounted: boolean
  projectId: string
  expectedProjectId: string
  sessionId: number
  currentSessionId: number
  actionToken?: number | null
  currentActionToken?: number | null
}): boolean {
  if (!mounted) return false
  if (projectId !== expectedProjectId) return false
  if (sessionId !== currentSessionId) return false
  if (actionToken != null && actionToken !== currentActionToken) return false
  return true
}

export function getAllowedToolOptionClassName(checked: boolean): string {
  return checked
    ? 'border-blue-400 bg-blue-500/15 text-blue-50 shadow-[inset_0_0_0_1px_rgba(96,165,250,0.45)]'
    : 'border-gray-700 bg-transparent text-gray-300 hover:border-gray-500 hover:text-white'
}

export function getUnitCostAffordance(): { prefix: string; inputMode: 'decimal'; hint: string } {
  return { prefix: '$', inputMode: 'decimal', hint: 'USD' }
}

export function getWireProfilePreviewLabel({
  color,
  width,
  style,
}: {
  color: string
  width: number
  style: string
}): string {
  const safeWidth = Math.max(1, Number(width) || 1)
  return `Wire profile preview: ${String(style || 'solid')} ${safeWidth}px line in ${color || '#facc15'}.`
}

export function getPreviewStrokeDasharray(displayStyle: string, displayWidth: number): string | undefined {
  const width = Math.max(1, Number(displayWidth) || 1)
  if (displayStyle === 'dashed') return `${width * 4} ${width * 2}`
  if (displayStyle === 'dotted') return `0 ${width * 2.4}`
  return undefined
}

export function getWireProfileModalOverlayClassName(): string {
  return 'fixed inset-0 z-[100070] flex items-center justify-center bg-black/75 p-3 pointer-events-auto'
}

export function getWireProfileLayoutMode(width: number): 'desktop' | 'compact' {
  return Number(width) >= 820 ? 'desktop' : 'compact'
}
