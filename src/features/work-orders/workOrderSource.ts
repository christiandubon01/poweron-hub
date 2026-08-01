export type WorkOrderSourceMode = 'project' | 'blueprint' | 'work-package'

const TITLE_MAX = 200

/** Derive source mode from nullable IDs. Project ID must still be validated separately. */
export function deriveWorkOrderSourceMode(input: {
  blueprintSetId?: string | null
  workPackageId?: string | null
}): WorkOrderSourceMode {
  const workPackageId = cleanOptionalId(input.workPackageId)
  const blueprintSetId = cleanOptionalId(input.blueprintSetId)
  if (workPackageId) return 'work-package'
  if (blueprintSetId) return 'blueprint'
  return 'project'
}

export function cleanOptionalId(value: unknown): string | null {
  if (value == null) return null
  const text = String(value).trim()
  return text ? text.slice(0, 200) : null
}

export function normalizeWorkOrderTitle(value: unknown): string {
  if (value == null) return ''
  return String(value).trim().replace(/\s+/g, ' ').slice(0, TITLE_MAX)
}

export function isValidWorkOrderTitle(value: unknown): boolean {
  return normalizeWorkOrderTitle(value).length > 0
}

export function workOrderSourceLabel(mode: WorkOrderSourceMode): string {
  if (mode === 'work-package') return 'Work Package Work Order'
  if (mode === 'blueprint') return 'Blueprint Work Order'
  return 'Project Work Order'
}
