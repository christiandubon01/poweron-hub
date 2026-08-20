/**
 * unifyDirectory.ts - shared canonical employee identity unifier.
 *
 * Team and Crew Portal both consume this pure helper so one person renders once,
 * even when the same same-org employee is represented by both:
 * - BackupData.employees (labor / cost authority)
 * - employee_profiles   (portal / auth authority)
 *
 * Reconciliation precedence:
 * 1. Stable backup_employee_id link
 * 2. Same-org exact email reconciliation when the cost-model email is unique
 * 3. Owner / Me sentinel collapse
 *
 * Historical duplicates are never deleted here. They are collapsed into one
 * canonical UI row and surfaced via duplicateSignals for later owner cleanup.
 */

export interface CostModelEmployeeInput {
  id: string
  name: string
  email?: string | null
  classification?: string | null
  isOwner?: boolean
}

export interface PortalProfileInput {
  id: string
  display_name: string
  email: string | null
  active: boolean
  user_id: string | null
  backup_employee_id: string | null
  role?: string | null
  employee_role?: string | null
  employment_type?: string | null
  accepted_at?: string | null
}

export type UnifiedRowKind = 'linked' | 'cost_model_only' | 'portal_only'
export type PortalStatus = 'Active' | 'Invitation Pending' | 'Inactive'
export type CanonicalEmployeeStatus = 'pending' | 'active' | 'inactive'
export type IdentityReconciledBy = 'backup_employee_id' | 'same_org_email' | 'none'
export type UnifiedDuplicateCode =
  | 'duplicate_backup_employee_id'
  | 'duplicate_email'
  | 'owner_self_duplicate'

export interface UnifiedDuplicateSignal {
  code: UnifiedDuplicateCode
  relatedPortalProfileIds: string[]
  relatedCostModelIds: string[]
}

export interface UnifiedEmployeeRow {
  key: string
  kind: UnifiedRowKind
  displayName: string
  canonicalStatus: CanonicalEmployeeStatus
  stableLink: boolean
  reconciledBy: IdentityReconciledBy

  costModelId: string | null
  costModelIds: string[]
  classification: string | null

  portalProfileId: string | null
  portalProfileIds: string[]
  portalStatus: PortalStatus | null
  authLinked: boolean
  authUserId: string | null
  employeeRole: string | null
  employmentType: string | null

  email: string | null
  isOwner: boolean
  canPrepareOrInvite: boolean
  suggestedLinkPortalProfileId: string | null
  duplicateSignals: UnifiedDuplicateSignal[]
}

export function derivePortalStatus(p: { active: boolean; user_id: string | null }): PortalStatus {
  if (!p.active) return 'Inactive'
  if (p.user_id) return 'Active'
  return 'Invitation Pending'
}

export function deriveCanonicalEmployeeStatus(portalStatus: PortalStatus | null): CanonicalEmployeeStatus {
  if (portalStatus === 'Inactive') return 'inactive'
  if (portalStatus === 'Active') return 'active'
  return 'pending'
}

function normEmail(email: string | null | undefined): string | null {
  const trimmed = String(email ?? '').trim().toLowerCase()
  return trimmed || null
}

export function isCostModelOwner(cm: CostModelEmployeeInput): boolean {
  if (cm.isOwner === true) return true
  const id = String(cm.id ?? '').trim().toLowerCase()
  const name = String(cm.name ?? '').trim().toLowerCase()
  return id === 'me' || id === 'owner' || id === 'owner-virtual' || name === 'owner / me'
}

function portalPriority(profile: PortalProfileInput): number {
  const status = derivePortalStatus(profile)
  if (status === 'Active') return 0
  if (status === 'Invitation Pending') return 1
  return 2
}

function uniqueIds(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))]
}

function appendDuplicateSignal(
  signals: UnifiedDuplicateSignal[],
  code: UnifiedDuplicateCode,
  relatedPortalProfileIds: string[],
  relatedCostModelIds: string[],
): UnifiedDuplicateSignal[] {
  if (relatedPortalProfileIds.length === 0 && relatedCostModelIds.length === 0) return signals
  return [...signals, { code, relatedPortalProfileIds, relatedCostModelIds }]
}

function pickPrimaryPortalProfile(
  profiles: PortalProfileInput[],
  portalOrder: Map<string, number>,
): PortalProfileInput {
  return [...profiles].sort((a, b) => {
    const rankDiff = portalPriority(a) - portalPriority(b)
    if (rankDiff !== 0) return rankDiff
    return (portalOrder.get(a.id) ?? 0) - (portalOrder.get(b.id) ?? 0)
  })[0]
}

function mergeOwnerRows(rows: UnifiedEmployeeRow[]): UnifiedEmployeeRow[] {
  const ownerRows = rows.filter((row) => row.isOwner)
  if (ownerRows.length <= 1) return rows

  const primary = [...ownerRows].sort((a, b) => {
    const rank = (row: UnifiedEmployeeRow) => {
      if (row.portalStatus === 'Active') return 0
      if (row.portalStatus === 'Invitation Pending') return 1
      if (row.portalStatus === null) return 2
      return 3
    }
    return rank(a) - rank(b)
  })[0]

  const mergedCostModelIds = uniqueIds(ownerRows.flatMap((row) => row.costModelIds))
  const mergedPortalIds = uniqueIds(ownerRows.flatMap((row) => row.portalProfileIds))
  const mergedSignals = ownerRows.flatMap((row) => row.duplicateSignals)

  const mergedPrimary: UnifiedEmployeeRow = {
    ...primary,
    costModelIds: mergedCostModelIds,
    portalProfileIds: mergedPortalIds,
    duplicateSignals: [
      ...mergedSignals,
      {
        code: 'owner_self_duplicate',
        relatedPortalProfileIds: mergedPortalIds,
        relatedCostModelIds: mergedCostModelIds,
      },
    ],
  }

  let replaced = false
  return rows
    .filter((row) => !row.isOwner || row.key === primary.key)
    .map((row) => {
      if (row.key !== primary.key || replaced) return row
      replaced = true
      return mergedPrimary
    })
}

export function buildUnifiedDirectory(
  costModel: CostModelEmployeeInput[],
  portal: PortalProfileInput[],
): UnifiedEmployeeRow[] {
  const portalOrder = new Map<string, number>()
  portal.forEach((profile, index) => portalOrder.set(profile.id, index))

  const portalByBackupId = new Map<string, PortalProfileInput[]>()
  const portalByEmail = new Map<string, PortalProfileInput[]>()
  for (const profile of portal) {
    if (profile.backup_employee_id) {
      const list = portalByBackupId.get(profile.backup_employee_id) ?? []
      list.push(profile)
      portalByBackupId.set(profile.backup_employee_id, list)
    }
    const email = normEmail(profile.email)
    if (email) {
      const list = portalByEmail.get(email) ?? []
      list.push(profile)
      portalByEmail.set(email, list)
    }
  }

  const costModelEmailCounts = new Map<string, number>()
  for (const employee of costModel) {
    const email = normEmail(employee.email)
    if (!email) continue
    costModelEmailCounts.set(email, (costModelEmailCounts.get(email) ?? 0) + 1)
  }

  const consumedPortalIds = new Set<string>()
  const rows: UnifiedEmployeeRow[] = []

  for (const employee of costModel) {
    const ownerFlag = isCostModelOwner(employee)
    const employeeEmail = normEmail(employee.email)
    const emailUniqueInCostModel = Boolean(
      employeeEmail && costModelEmailCounts.get(employeeEmail) === 1,
    )

    const matchedProfiles: PortalProfileInput[] = []
    for (const profile of portalByBackupId.get(employee.id) ?? []) {
      if (!consumedPortalIds.has(profile.id)) matchedProfiles.push(profile)
    }

    if (emailUniqueInCostModel && employeeEmail) {
      for (const profile of portalByEmail.get(employeeEmail) ?? []) {
        const canReconcileByEmail =
          !profile.backup_employee_id || profile.backup_employee_id === employee.id
        if (!canReconcileByEmail || consumedPortalIds.has(profile.id)) continue
        if (!matchedProfiles.some((existing) => existing.id === profile.id)) {
          matchedProfiles.push(profile)
        }
      }
    }

    if (matchedProfiles.length > 0) {
      const primaryPortal = pickPrimaryPortalProfile(matchedProfiles, portalOrder)
      matchedProfiles.forEach((profile) => consumedPortalIds.add(profile.id))

      const stableLink = matchedProfiles.some((profile) => profile.backup_employee_id === employee.id)
      const portalProfileIds = uniqueIds(matchedProfiles.map((profile) => profile.id))
      let duplicateSignals: UnifiedDuplicateSignal[] = []

      if (matchedProfiles.filter((profile) => profile.backup_employee_id === employee.id).length > 1) {
        duplicateSignals = appendDuplicateSignal(
          duplicateSignals,
          'duplicate_backup_employee_id',
          portalProfileIds,
          [employee.id],
        )
      }

      if (employeeEmail && matchedProfiles.filter((profile) => normEmail(profile.email) === employeeEmail).length > 1) {
        duplicateSignals = appendDuplicateSignal(
          duplicateSignals,
          'duplicate_email',
          portalProfileIds,
          [employee.id],
        )
      }

      const portalStatus = derivePortalStatus(primaryPortal)
      rows.push({
        key: `linked:${employee.id}:${primaryPortal.id}`,
        kind: 'linked',
        displayName: employee.name || primaryPortal.display_name,
        canonicalStatus: deriveCanonicalEmployeeStatus(portalStatus),
        stableLink,
        reconciledBy: stableLink ? 'backup_employee_id' : 'same_org_email',
        costModelId: employee.id,
        costModelIds: [employee.id],
        classification: employee.classification ?? null,
        portalProfileId: primaryPortal.id,
        portalProfileIds,
        portalStatus,
        authLinked: Boolean(primaryPortal.user_id),
        authUserId: primaryPortal.user_id ?? null,
        employeeRole: primaryPortal.employee_role ?? null,
        employmentType: primaryPortal.employment_type ?? null,
        email: primaryPortal.email ?? employee.email ?? null,
        isOwner: ownerFlag,
        canPrepareOrInvite: false,
        suggestedLinkPortalProfileId: stableLink ? null : primaryPortal.id,
        duplicateSignals,
      })
      continue
    }

    let suggestion: string | null = null
    if (emailUniqueInCostModel && employeeEmail) {
      const matchingUnlinked = (portalByEmail.get(employeeEmail) ?? []).filter(
        (profile) => !consumedPortalIds.has(profile.id) && !profile.backup_employee_id,
      )
      if (matchingUnlinked.length === 1) suggestion = matchingUnlinked[0].id
    }

    rows.push({
      key: `cost:${employee.id}`,
      kind: 'cost_model_only',
      displayName: employee.name,
      canonicalStatus: 'pending',
      stableLink: false,
      reconciledBy: 'none',
      costModelId: employee.id,
      costModelIds: [employee.id],
      classification: employee.classification ?? null,
      portalProfileId: null,
      portalProfileIds: [],
      portalStatus: null,
      authLinked: false,
      authUserId: null,
      employeeRole: null,
      employmentType: null,
      email: employee.email ?? null,
      isOwner: ownerFlag,
      canPrepareOrInvite: !ownerFlag,
      suggestedLinkPortalProfileId: suggestion,
      duplicateSignals: [],
    })
  }

  for (const profile of portal) {
    if (consumedPortalIds.has(profile.id)) continue

    const groupedProfiles: PortalProfileInput[] = []
    const sameBackupProfiles = profile.backup_employee_id
      ? (portalByBackupId.get(profile.backup_employee_id) ?? [])
      : [profile]
    for (const candidate of sameBackupProfiles) {
      if (!consumedPortalIds.has(candidate.id)) groupedProfiles.push(candidate)
    }

    const email = normEmail(profile.email)
    if (email) {
      for (const candidate of portalByEmail.get(email) ?? []) {
        const canCollapseByEmail =
          !candidate.backup_employee_id || candidate.backup_employee_id === profile.backup_employee_id
        if (!canCollapseByEmail || consumedPortalIds.has(candidate.id)) continue
        if (!groupedProfiles.some((existing) => existing.id === candidate.id)) {
          groupedProfiles.push(candidate)
        }
      }
    }

    const primaryPortal = pickPrimaryPortalProfile(groupedProfiles, portalOrder)
    groupedProfiles.forEach((candidate) => consumedPortalIds.add(candidate.id))

    const portalProfileIds = uniqueIds(groupedProfiles.map((candidate) => candidate.id))
    let duplicateSignals: UnifiedDuplicateSignal[] = []

    if (profile.backup_employee_id && groupedProfiles.filter((candidate) => candidate.backup_employee_id === profile.backup_employee_id).length > 1) {
      duplicateSignals = appendDuplicateSignal(
        duplicateSignals,
        'duplicate_backup_employee_id',
        portalProfileIds,
        [],
      )
    }

    if (email && groupedProfiles.filter((candidate) => normEmail(candidate.email) === email).length > 1) {
      duplicateSignals = appendDuplicateSignal(
        duplicateSignals,
        'duplicate_email',
        portalProfileIds,
        [],
      )
    }

    const portalStatus = derivePortalStatus(primaryPortal)
    rows.push({
      key: `portal:${primaryPortal.id}`,
      kind: 'portal_only',
      displayName: primaryPortal.display_name,
      canonicalStatus: deriveCanonicalEmployeeStatus(portalStatus),
      stableLink: false,
      reconciledBy: 'none',
      costModelId: null,
      costModelIds: [],
      classification: null,
      portalProfileId: primaryPortal.id,
      portalProfileIds,
      portalStatus,
      authLinked: Boolean(primaryPortal.user_id),
      authUserId: primaryPortal.user_id ?? null,
      employeeRole: primaryPortal.employee_role ?? null,
      employmentType: primaryPortal.employment_type ?? null,
      email: primaryPortal.email ?? null,
      isOwner: false,
      canPrepareOrInvite: false,
      suggestedLinkPortalProfileId: null,
      duplicateSignals,
    })
  }

  return mergeOwnerRows(rows)
}

export function getTeamCardDirectoryEntries(rows: UnifiedEmployeeRow[]): UnifiedEmployeeRow[] {
  return rows.filter((row) => !row.isOwner)
}

export function getOrganizationPyramidEntries(rows: UnifiedEmployeeRow[]): UnifiedEmployeeRow[] {
  return rows.filter((row) => !row.isOwner)
}

export function getAssignableEmployeeEntries(
  rows: UnifiedEmployeeRow[],
  options: { includeOwner?: boolean } = {},
): UnifiedEmployeeRow[] {
  void options
  return rows.filter((row) => {
    if (row.isOwner) return false
    if (row.kind === 'portal_only' && row.portalStatus === 'Inactive') return false
    return true
  })
}

export function getRoleManageableEmployeeEntries(rows: UnifiedEmployeeRow[]): UnifiedEmployeeRow[] {
  return rows.filter((row) => {
    if (row.isOwner) return false
    if (row.kind === 'portal_only' && row.portalStatus === 'Inactive') return false
    return true
  })
}

export function uniqueCostedEmployeeIdentities(rows: UnifiedEmployeeRow[]): UnifiedEmployeeRow[] {
  const seen = new Set<string>()
  const uniqueRows: UnifiedEmployeeRow[] = []
  for (const row of rows) {
    if (seen.has(row.key)) continue
    seen.add(row.key)
    uniqueRows.push(row)
  }
  return uniqueRows
}
