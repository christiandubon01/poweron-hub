/**
 * unifyDirectory.ts — ROLE-2.4 unified Cost Model + Portal employee directory.
 *
 * A single person can be represented by up to two records:
 *   • a Cost Model employee (labor/cost classification, hours source)
 *   • a Portal employee_profiles row (auth identity, portal access, roles)
 *
 * When they are LINKED (employee_profiles.backup_employee_id === costModel.id) the
 * directory must render them as ONE person — not two rows.
 *
 * Identity rules (deliberate and conservative):
 *   1. The ONLY automatic identity is the stable backup_employee_id linkage.
 *   2. Never deduplicate by display name — same name ≠ same person.
 *   3. A unique matching email only *suggests* an explicit owner-confirmed link;
 *      it never collapses two records automatically.
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
  /** Stable render key. */
  key: string
  kind: UnifiedRowKind
  displayName: string

  // Cost Model side (null on portal-only rows)
  costModelId: string | null
  classification: string | null

  // Portal side (null on cost-model-only rows)
  portalProfileId: string | null
  portalStatus: PortalStatus | null
  authLinked: boolean
  employeeRole: string | null
  employmentType: string | null

  email: string | null

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

// ── Core unification ────────────────────────────────────────────────────────

/**
 * Combine Cost Model employees and Portal profiles into one deterministic list.
 *
 * - linked pair (backup_employee_id match) → exactly one row, the separate
 *   cost-model-only row is suppressed.
 * - cost-model-only → one row (canPrepareOrInvite = true), with an optional
 *   unique-email link suggestion.
 * - portal-only (no backup link, or a dangling backup id) → one portal row.
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
        employeeRole: linked.employee_role ?? null,
        employmentType: linked.employment_type ?? null,
        email: linked.email ?? cm.email ?? null,
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
      employeeRole: null,
      employmentType: null,
      email: cm.email ?? null,
      canPrepareOrInvite: true,
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
      employeeRole: p.employee_role ?? null,
      employmentType: p.employment_type ?? null,
      email: p.email ?? null,
      canPrepareOrInvite: false,
      suggestedLinkPortalProfileId: null,
    })
  }

  return rows
}
