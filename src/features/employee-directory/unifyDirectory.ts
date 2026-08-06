/**
 * unifyDirectory.ts — ROLE-2.4 / COST-SOURCE-2B unified Cost Model + Portal
 * employee directory.
 *
 * A single person can be represented by up to two records:
 *   • a Cost Model employee (labor/cost classification, hours source)
 *   • a Portal employee_profiles row (auth identity, portal access, roles)
 *
 * When they are LINKED (employee_profiles.backup_employee_id === costModel.id)
 * the directory renders them as ONE person — not two rows.
 *
 * Identity rules (deliberate and conservative):
 *   1. The ONLY automatic identity is the stable backup_employee_id linkage.
 *   2. Never deduplicate by display name — same name ≠ same person.
 *   3. A unique matching email only *suggests* an explicit owner-confirmed link;
 *      it never collapses two records automatically.
 *   4. Owner sentinel ids ('me', 'owner', 'owner-virtual') and the canonical name
 *      'Owner / Me' are detected and collapsed to one UI representation without
 *      deleting any stored record.
 *
 * This module is PURE (no I/O) so it is fully unit-testable and deterministic.
 */

// ── Inputs ──────────────────────────────────────────────────────────────────

export interface CostModelEmployeeInput {
  id: string
  name: string
  email?: string | null
  /** Cost Model classification to preserve on the unified row (e.g. full_time, temp, helper). */
  classification?: string | null
  /**
   * Explicit owner flag. When true, this employee is the business owner / "me"
   * sentinel. Pass normalizeEmployee(raw).isOwner here for pre-computed values.
   * When omitted, sentinel detection by id/name applies as a fallback.
   */
  isOwner?: boolean
}

export interface PortalProfileInput {
  id: string
  display_name: string
  email: string | null
  active: boolean
  user_id: string | null
  backup_employee_id: string | null
  employee_role?: string | null
  employment_type?: string | null
}

// ── Output ──────────────────────────────────────────────────────────────────

export type UnifiedRowKind = 'linked' | 'cost_model_only' | 'portal_only'
export type PortalStatus = 'Active' | 'Invitation Pending' | 'Inactive'

export interface UnifiedEmployeeRow {
  /** Stable render key. Also served as `unifiedKey` in the canonical contract. */
  key: string
  kind: UnifiedRowKind
  displayName: string

  // Cost Model side (null on portal-only rows)
  costModelId: string | null
  classification: string | null

  // Portal side (null on cost-model-only rows)
  portalProfileId: string | null
  portalStatus: PortalStatus | null
  /** True when a portal profile row exists AND has a confirmed auth user_id. */
  authLinked: boolean
  /** The portal auth user id when linked; null otherwise. */
  authUserId: string | null
  employeeRole: string | null
  employmentType: string | null

  email: string | null

  /**
   * True when this row represents the business owner / "me" sentinel.
   * Consumers should never show this person twice by rendering both the raw
   * owner Cost Model entry AND a separate "Owner / Me" UI sentinel.
   */
  isOwner: boolean

  /** Cost-model-only rows can be prepared/invited into a portal profile. */
  canPrepareOrInvite: boolean
  /**
   * For a cost-model-only row: the id of a single unlinked portal profile whose
   * email uniquely matches this employee. UI may offer "Link Existing Account".
   * Null when there is no match or the match is ambiguous. NEVER auto-applied.
   */
  suggestedLinkPortalProfileId: string | null
}

// ── Helpers ─────────────────────────────────────────────────────────────────

export function derivePortalStatus(p: { active: boolean; user_id: string | null }): PortalStatus {
  if (!p.active) return 'Inactive'
  if (p.user_id) return 'Active'
  return 'Invitation Pending'
}

function normEmail(e: string | null | undefined): string | null {
  const t = (e ?? '').trim().toLowerCase()
  return t || null
}

/**
 * Detect whether a Cost Model employee record represents the owner / "me"
 * sentinel, using the explicit flag first, then the canonical sentinel ids
 * and name as a fallback.
 *
 * Sentinel ids: 'me', 'owner', 'owner-virtual'
 * Sentinel name: 'owner / me' (case-insensitive)
 */
export function isCostModelOwner(cm: CostModelEmployeeInput): boolean {
  if (cm.isOwner === true) return true
  const id = String(cm.id ?? '').toLowerCase().trim()
  const name = String(cm.name ?? '').toLowerCase().trim()
  return (
    id === 'me' ||
    id === 'owner' ||
    id === 'owner-virtual' ||
    name === 'owner / me'
  )
}

// ── Core unification ────────────────────────────────────────────────────────

/**
 * Combine Cost Model employees and Portal profiles into one deterministic list.
 *
 * - linked pair (backup_employee_id match) → exactly one row; the separate
 *   cost-model-only row is suppressed.
 * - cost-model-only → one row (canPrepareOrInvite = true), with an optional
 *   unique-email link suggestion.
 * - portal-only (no backup link, or a dangling backup id) → one portal row.
 * - owner sentinels → isOwner = true; collapsed to one UI representation.
 *
 * Ordering: Cost Model order first (linked + cost-model-only preserve input
 * order), then any remaining portal-only rows in input order. Stable and pure.
 */
export function buildUnifiedDirectory(
  costModel: CostModelEmployeeInput[],
  portal: PortalProfileInput[],
): UnifiedEmployeeRow[] {
  // Index portal profiles by their backup_employee_id (linked ones only).
  const portalByBackupId = new Map<string, PortalProfileInput>()
  for (const p of portal) {
    if (p.backup_employee_id) portalByBackupId.set(p.backup_employee_id, p)
  }

  // Unlinked portal profiles are candidates for an email-based link suggestion.
  const unlinkedPortal = portal.filter(p => !p.backup_employee_id)

  const consumedPortalIds = new Set<string>()
  const rows: UnifiedEmployeeRow[] = []

  for (const cm of costModel) {
    const ownerFlag = isCostModelOwner(cm)
    const linked = portalByBackupId.get(cm.id)
    if (linked) {
      consumedPortalIds.add(linked.id)
      rows.push({
        key: `linked:${cm.id}:${linked.id}`,
        kind: 'linked',
        displayName: cm.name || linked.display_name,
        costModelId: cm.id,
        classification: cm.classification ?? null,
        portalProfileId: linked.id,
        portalStatus: derivePortalStatus(linked),
        authLinked: Boolean(linked.user_id),
        authUserId: linked.user_id ?? null,
        employeeRole: linked.employee_role ?? null,
        employmentType: linked.employment_type ?? null,
        email: linked.email ?? cm.email ?? null,
        isOwner: ownerFlag,
        canPrepareOrInvite: false,
        suggestedLinkPortalProfileId: null,
      })
      continue
    }

    // Cost-model-only. Suggest a link ONLY when exactly one unlinked, not-yet-
    // consumed portal profile has a matching email. Ambiguous → no suggestion.
    const cmEmail = normEmail(cm.email)
    let suggestion: string | null = null
    if (cmEmail) {
      const matches = unlinkedPortal.filter(
        p => !consumedPortalIds.has(p.id) && normEmail(p.email) === cmEmail,
      )
      if (matches.length === 1) suggestion = matches[0].id
    }

    rows.push({
      key: `cost:${cm.id}`,
      kind: 'cost_model_only',
      displayName: cm.name,
      costModelId: cm.id,
      classification: cm.classification ?? null,
      portalProfileId: null,
      portalStatus: null,
      authLinked: false,
      authUserId: null,
      employeeRole: null,
      employmentType: null,
      email: cm.email ?? null,
      isOwner: ownerFlag,
      canPrepareOrInvite: !ownerFlag,
      suggestedLinkPortalProfileId: suggestion,
    })
  }

  // Remaining portal profiles that were not linked to any Cost Model row.
  for (const p of portal) {
    if (consumedPortalIds.has(p.id)) continue
    rows.push({
      key: `portal:${p.id}`,
      kind: 'portal_only',
      displayName: p.display_name,
      costModelId: null,
      classification: null,
      portalProfileId: p.id,
      portalStatus: derivePortalStatus(p),
      authLinked: Boolean(p.user_id),
      authUserId: p.user_id ?? null,
      employeeRole: p.employee_role ?? null,
      employmentType: p.employment_type ?? null,
      email: p.email ?? null,
      isOwner: false,
      canPrepareOrInvite: false,
      suggestedLinkPortalProfileId: null,
    })
  }

  return rows
}

// ── Selector helpers ─────────────────────────────────────────────────────────
//
// All selectors begin from the same canonical unified directory so no screen
// can recreate identity matching independently.

/**
 * All non-owner rows suitable for Team card display.
 * Includes linked, cost-model-only, and portal-only (with status labels).
 * Owner rows are excluded — they are shown separately in the owner crown.
 */
export function getTeamCardDirectoryEntries(rows: UnifiedEmployeeRow[]): UnifiedEmployeeRow[] {
  return rows.filter(r => !r.isOwner)
}

/**
 * Rows for the organisation pyramid body (excludes the owner crown row).
 * Same as getTeamCardDirectoryEntries — split out for semantic clarity.
 */
export function getOrganizationPyramidEntries(rows: UnifiedEmployeeRow[]): UnifiedEmployeeRow[] {
  return rows.filter(r => !r.isOwner)
}

/**
 * Rows available for assignment in pickers (e.g. Field Log Assigned Employees).
 *
 * When includeOwner is true the caller is expected to prepend the explicit
 * "Owner / Me" sentinel option separately — this selector never returns owner
 * rows so the same person cannot appear twice.
 *
 * Excludes portal-only rows whose portal status is Inactive (they cannot
 * receive assignments).
 */
export function getAssignableEmployeeEntries(
  rows: UnifiedEmployeeRow[],
  options: { includeOwner?: boolean } = {},
): UnifiedEmployeeRow[] {
  return rows.filter(r => {
    if (r.isOwner) return false
    if (r.kind === 'portal_only' && r.portalStatus === 'Inactive') return false
    return true
  })
}

/**
 * Rows for the Roles Manager employee list.
 *
 * Includes:
 *   - Cost-model-only (pre-activation role preparation)
 *   - Invitation Pending (awaiting first login)
 *   - Active portal profiles
 *
 * Excludes:
 *   - Portal-only Inactive rows
 *   - Owner rows (owner has separate role management)
 */
export function getRoleManageableEmployeeEntries(rows: UnifiedEmployeeRow[]): UnifiedEmployeeRow[] {
  return rows.filter(r => {
    if (r.isOwner) return false
    if (r.kind === 'portal_only' && r.portalStatus === 'Inactive') return false
    return true
  })
}

/**
 * Guard for cost-source pricing: returns exactly one entry per real costed
 * person, collapsing:
 *   - linked pairs → one entry (Cost Model side preserved for economics)
 *   - owner sentinel → included once (as the owner row)
 *   - portal-only → included once (cost model id is null, no labor cost)
 *   - duplicate Cost Model records → remain separate (unresolved, NOT merged)
 *
 * This proves that one real person cannot be double-counted.
 * Do NOT connect to Service Log cost formulas until pricing phase is ready.
 */
export function uniqueCostedEmployeeIdentities(rows: UnifiedEmployeeRow[]): UnifiedEmployeeRow[] {
  const seen = new Set<string>()
  const out: UnifiedEmployeeRow[] = []
  for (const r of rows) {
    const key = r.key
    if (seen.has(key)) continue
    seen.add(key)
    out.push(r)
  }
  return out
}
