/**
 * Time Session identity terminology.
 *
 * Sessions store a denormalized title/name in `work_package_name`. That field
 * alone must not prove Work Package identity — use assignment_id / work_package_id.
 */

export type TimeSessionIdentityKind = 'work-order' | 'work-package' | 'project-only'

export interface TimeSessionIdentityInput {
  assignmentId?: string | null
  /** Genuine Work Package identity when the projection exposes it. */
  workPackageId?: string | null
  /** Denormalized Work Order title or Work Package name (historical column). */
  workPackageName?: string | null
  projectName?: string | null
}

export interface TimeSessionIdentity {
  kind: TimeSessionIdentityKind
  /** Primary identity label: Work Order | Work Package | Project */
  label: string
  /** Primary identity value (WO title, WP name, or project name). */
  value: string | null
  projectName: string | null
  /** True when this is unbound project time with no WO/WP identity. */
  isProjectOnly: boolean
}

function cleanOptional(value: unknown): string | null {
  if (value == null) return null
  const text = String(value).trim()
  return text ? text : null
}

/**
 * Resolve display identity for a Time Session (or clock-in selection preview).
 *
 * Rules:
 * 1. assignment_id present → Work Order (title from work_package_name)
 * 2. else genuine work_package_id present → Work Package
 * 3. else → Project-only (do not infer WP from a nonempty title alone)
 */
export function resolveTimeSessionIdentity(input: TimeSessionIdentityInput): TimeSessionIdentity {
  const assignmentId = cleanOptional(input.assignmentId)
  const workPackageId = cleanOptional(input.workPackageId)
  const workPackageName = cleanOptional(input.workPackageName)
  const projectName = cleanOptional(input.projectName)

  if (assignmentId) {
    return {
      kind: 'work-order',
      label: 'Work Order',
      value: workPackageName,
      projectName,
      isProjectOnly: false,
    }
  }

  if (workPackageId) {
    return {
      kind: 'work-package',
      label: 'Work Package',
      value: workPackageName,
      projectName,
      isProjectOnly: false,
    }
  }

  return {
    kind: 'project-only',
    label: 'Project',
    value: projectName,
    projectName,
    isProjectOnly: true,
  }
}

/** Display value for the primary identity line; project-only uses the empty WP wording. */
export function timeSessionIdentityDisplayValue(
  identity: TimeSessionIdentity,
  emptyFallback = 'Not assigned yet',
): string {
  if (identity.kind === 'project-only') return emptyFallback
  return identity.value || emptyFallback
}

/** Compact one-line summary used in lists (e.g. "Work Order: Title"). */
export function formatTimeSessionIdentityLine(
  identity: TimeSessionIdentity,
  emptyFallback = 'Not assigned yet',
): string {
  if (identity.kind === 'project-only') {
    return `Work Package: ${emptyFallback}`
  }
  return `${identity.label}: ${identity.value || emptyFallback}`
}
