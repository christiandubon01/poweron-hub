import { createClient } from '@supabase/supabase-js'
import {
  derivePilotActivationSnapshot,
  deriveWeeklyActivitySummary,
  getPilotOrganizationClassification,
  isBlueprintActiveOrganization,
  isEmployeePortalActiveOrganization,
  isPilotTelemetryEventName,
  sanitizeTelemetryMetadata,
} from '../../src/services/pilotTelemetryShared'
import {
  allowsNDAAccess,
  resolveNDAStatus,
  type NDAAccessOverrideRecordLike,
  type NDASignedAgreementRecordLike,
} from '../../src/services/ndaAuthority'

type NetlifyEvent = {
  httpMethod?: string
  headers?: Record<string, string | undefined>
  queryStringParameters?: Record<string, string | undefined>
  body?: string | null
}

function json(statusCode: number, body: unknown) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
    body: JSON.stringify(body),
  }
}

function readBearerToken(event: NetlifyEvent): string | null {
  const value = event.headers?.authorization ?? event.headers?.Authorization ?? ''
  const match = String(value).match(/^Bearer\s+(.+)$/i)
  return match?.[1] ?? null
}

async function verifyAuthenticatedUser(event: NetlifyEvent) {
  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || ''
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || ''
  const token = readBearerToken(event)

  if (!supabaseUrl || !anonKey || !token) return null

  const authClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data, error } = await authClient.auth.getUser(token)
  if (error || !data?.user) return null
  return data.user
}

function getServiceClient() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || ''
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
  if (!url || !key) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

function founderEmail(): string {
  return String(
    process.env.PILOT_TELEMETRY_FOUNDER_EMAIL
    || process.env.ADMIN_EMAIL
    || process.env.VITE_ADMIN_EMAIL
    || '',
  ).trim().toLowerCase()
}

export function isFounderUser(user: { email?: string | null } | null | undefined, configuredEmail = founderEmail()): boolean {
  const expected = String(configuredEmail || '').trim().toLowerCase()
  return Boolean(expected && String(user?.email || '').trim().toLowerCase() === expected)
}

export function requireFounder(user: any, configuredEmail = founderEmail()) {
  return isFounderUser(user, configuredEmail)
    ? null
    : json(403, { error: 'Founder access required.' })
}

async function resolveActorContext(supabase: any, userId: string) {
  const { data: profile } = await supabase
    .from('profiles')
    .select('id, org_id, role')
    .eq('id', userId)
    .maybeSingle()

  const { data: employeeProfiles } = await supabase
    .from('employee_profiles')
    .select('id, org_id, active, accepted_at, portal_access')
    .eq('user_id', userId)
    .eq('active', true)

  const employeeProfile = (employeeProfiles ?? []).find((entry: any) => {
    const access = entry?.portal_access
    return access?.time_tracking === true || access?.time_tracking === 'true' || Boolean(entry?.accepted_at)
  }) ?? employeeProfiles?.[0]

  if (employeeProfile?.org_id) {
    return {
      organizationId: String(employeeProfile.org_id),
      actorUserId: userId,
      actorEmployeeProfileId: String(employeeProfile.id),
      actorKind: 'employee',
      role: 'employee',
    }
  }

  return {
    organizationId: String(profile?.org_id || ''),
    actorUserId: userId,
    actorEmployeeProfileId: null,
    actorKind: 'owner_admin',
    role: String(profile?.role || ''),
  }
}

async function handleTrackEvent(event: NetlifyEvent, user: any) {
  const payload = event.body ? JSON.parse(event.body) : {}
  const eventName = String(payload?.eventName || '').trim()
  if (!isPilotTelemetryEventName(eventName)) {
    return json(400, { error: 'Invalid pilot telemetry event name.' })
  }
  if (eventName === 'founder_support_incident') {
    return json(400, { error: 'Use log_support_incident for founder support incidents.' })
  }
  if (payload?.isDemo === true) {
    return json(200, { ok: true, skipped: true, reason: 'demo_mode' })
  }

  const supabase = getServiceClient()
  const actor = await resolveActorContext(supabase, user.id)
  if (!actor.organizationId) {
    return json(400, { error: 'Could not resolve organization for telemetry event.' })
  }

  const record = {
    organization_id: actor.organizationId,
    actor_user_id: actor.actorUserId,
    actor_employee_profile_id: actor.actorEmployeeProfileId,
    actor_kind: actor.actorKind,
    event_name: eventName,
    module: String(payload?.module || '').trim() || null,
    feature: String(payload?.feature || '').trim() || null,
    object_id: String(payload?.objectId || '').trim() || null,
    metadata: sanitizeTelemetryMetadata(payload?.metadata || {}),
    is_demo: false,
    occurred_at: payload?.occurredAt || new Date().toISOString(),
  }

  const { error } = await supabase.from('pilot_telemetry_events').insert(record)
  if (error) {
    return json(500, { error: error.message || 'Failed to record telemetry event.' })
  }
  return json(200, { ok: true })
}

async function handleSupportIncident(event: NetlifyEvent, user: any) {
  if (String(user?.email || '').trim().toLowerCase() !== founderEmail()) {
    return json(403, { error: 'Founder access required.' })
  }

  const payload = event.body ? JSON.parse(event.body) : {}
  const organizationId = String(payload?.organizationId || '').trim()
  const category = String(payload?.category || '').trim().toLowerCase()
  if (!organizationId || !category) {
    return json(400, { error: 'organizationId and category are required.' })
  }

  const supabase = getServiceClient()
  const { error } = await supabase.from('pilot_telemetry_events').insert({
    organization_id: organizationId,
    actor_user_id: user.id,
    actor_employee_profile_id: null,
    actor_kind: 'founder',
    event_name: 'founder_support_incident',
    module: 'support',
    feature: category,
    object_id: organizationId,
    metadata: sanitizeTelemetryMetadata({
      category,
      summary: payload?.note ?? undefined,
      minutesSpent:
        typeof payload?.minutesSpent === 'number' && Number.isFinite(payload.minutesSpent)
          ? Math.max(0, Math.round(payload.minutesSpent))
          : undefined,
    }),
    is_demo: false,
    occurred_at: new Date().toISOString(),
  })

  if (error) {
    return json(500, { error: error.message || 'Failed to log support incident.' })
  }
  return json(200, { ok: true })
}

async function handleSetOrgClassification(event: NetlifyEvent, user: any) {
  if (String(user?.email || '').trim().toLowerCase() !== founderEmail()) {
    return json(403, { error: 'Founder access required.' })
  }

  const payload = event.body ? JSON.parse(event.body) : {}
  const organizationId = String(payload?.organizationId || '').trim()
  const classification = String(payload?.classification || '').trim().toLowerCase()
  if (!organizationId || !['customer_zero', 'design_partner', 'normal'].includes(classification)) {
    return json(400, { error: 'Valid organizationId and classification are required.' })
  }

  const supabase = getServiceClient()
  const { data: current, error: currentError } = await supabase
    .from('organizations')
    .select('settings')
    .eq('id', organizationId)
    .maybeSingle()

  if (currentError) {
    return json(500, { error: currentError.message || 'Failed to load organization settings.' })
  }

  const settings = current?.settings && typeof current.settings === 'object' && !Array.isArray(current.settings)
    ? current.settings
    : {}
  const nextSettings = {
    ...settings,
    pilot: {
      ...((settings as any).pilot && typeof (settings as any).pilot === 'object' ? (settings as any).pilot : {}),
      classification,
    },
  }

  const { error } = await supabase
    .from('organizations')
    .update({ settings: nextSettings })
    .eq('id', organizationId)

  if (error) {
    return json(500, { error: error.message || 'Failed to update organization classification.' })
  }
  return json(200, { ok: true })
}

function weekRange(now = new Date()) {
  const start = new Date(now)
  const day = start.getUTCDay()
  const diffToMonday = day === 0 ? -6 : 1 - day
  start.setUTCDate(start.getUTCDate() + diffToMonday)
  start.setUTCHours(0, 0, 0, 0)
  const end = new Date(start)
  end.setUTCDate(start.getUTCDate() + 7)
  return { start, end }
}

async function readOptionalTable(
  supabase: any,
  table: string,
  select: string,
) {
  const { data, error } = await supabase.from(table as any).select(select as any)
  if (error) return { data: null, available: false }
  return { data: data ?? [], available: true }
}

async function handleFounderReport(user: any) {
  if (String(user?.email || '').trim().toLowerCase() !== founderEmail()) {
    return json(403, { error: 'Founder access required.' })
  }

  const supabase = getServiceClient()
  const { data: organizations, error: orgError } = await supabase
    .from('organizations')
    .select('id, name, settings, created_at')

  if (orgError) {
    return json(500, { error: orgError.message || 'Failed to load organizations.' })
  }

  const pilotOrganizations = (organizations ?? []).map((org: any) => ({
    id: String(org.id),
    name: String(org.name || ''),
    createdAt: org.created_at,
    classification: getPilotOrganizationClassification(org.settings),
  }))
  const includedOrganizations = pilotOrganizations.filter((org) => ['customer_zero', 'design_partner'].includes(org.classification))

  const pilotOrgIds = includedOrganizations.map((org) => org.id)

  const [
    projectsRes,
    estimatesRes,
    employeesRes,
    timePunchesRes,
    paymentsRes,
    portalRequestsRes,
    telemetryRes,
    blueprintUploadsRes,
  ] = await Promise.all([
    readOptionalTable(supabase, 'projects', 'id, org_id, created_at'),
    readOptionalTable(supabase, 'estimates', 'id, org_id, status, sent_at, created_at'),
    readOptionalTable(supabase, 'employee_profiles', 'id, org_id, invited_at, accepted_at'),
    readOptionalTable(supabase, 'time_punch_events', 'id, org_id, employee_user_id, punched_at, is_void'),
    readOptionalTable(supabase, 'payments', 'id, org_id, created_at'),
    readOptionalTable(supabase, 'portal_requests', 'id, organization_id, created_at'),
    readOptionalTable(supabase, 'pilot_telemetry_events', 'id, organization_id, actor_user_id, event_name, module, feature, object_id, metadata, occurred_at'),
    readOptionalTable(supabase, 'blueprint_uploads', 'id, org_id, created_at'),
  ])

  const projects = (projectsRes.data ?? []).filter((row: any) => pilotOrgIds.includes(String(row.org_id)))
  const estimates = (estimatesRes.data ?? []).filter((row: any) => pilotOrgIds.includes(String(row.org_id)))
  const employees = (employeesRes.data ?? []).filter((row: any) => pilotOrgIds.includes(String(row.org_id)))
  const timePunches = (timePunchesRes.data ?? []).filter((row: any) => pilotOrgIds.includes(String(row.org_id)) && row.is_void !== true)
  const payments = (paymentsRes.data ?? []).filter((row: any) => pilotOrgIds.includes(String(row.org_id)))
  const portalRequests = (portalRequestsRes.data ?? []).filter((row: any) => pilotOrgIds.includes(String(row.organization_id)))
  const telemetry = (telemetryRes.data ?? []).filter((row: any) => pilotOrgIds.includes(String(row.organization_id)))
  const blueprintUploads = (blueprintUploadsRes.data ?? []).filter((row: any) => pilotOrgIds.includes(String(row.org_id)))

  const { start, end } = weekRange()
  const weekly = deriveWeeklyActivitySummary(
    telemetry.map((row: any) => ({
      organizationId: String(row.organization_id),
      userId: row.actor_user_id ? String(row.actor_user_id) : null,
      occurredAt: String(row.occurred_at),
      eventName: String(row.event_name),
    })),
    start.toISOString(),
    end.toISOString(),
  )

  const organizationsReport = includedOrganizations.map((org) => {
    const orgProjects = projects.filter((row: any) => String(row.org_id) === org.id)
    const orgEstimates = estimates.filter((row: any) => String(row.org_id) === org.id)
    const orgEmployees = employees.filter((row: any) => String(row.org_id) === org.id)
    const orgTimePunches = timePunches.filter((row: any) => String(row.org_id) === org.id)
    const orgTelemetry = telemetry.filter((row: any) => String(row.organization_id) === org.id)
    const orgBlueprintUploads = blueprintUploads.filter((row: any) => String(row.org_id) === org.id)
    const orgSupportIncidents = orgTelemetry.filter((row: any) => row.event_name === 'founder_support_incident')

    const activation = derivePilotActivationSnapshot({
      organizationCreatedAt: org.createdAt,
      firstProjectAt: orgProjects.map((row: any) => row.created_at).sort()[0] ?? null,
      firstEstimateAt: orgEstimates.map((row: any) => row.created_at).sort()[0] ?? null,
      firstBlueprintUploadAt: blueprintUploadsRes.available ? orgBlueprintUploads.map((row: any) => row.created_at).sort()[0] ?? null : null,
      firstEmployeeInviteAt: orgEmployees.map((row: any) => row.invited_at).filter(Boolean).sort()[0] ?? null,
      onboardingCompletedAt: orgTelemetry
        .filter((row: any) => row.event_name === 'onboarding_completed')
        .map((row: any) => row.occurred_at)
        .sort()[0] ?? null,
    })

    const blueprintOpenCount = orgTelemetry.filter((row: any) => row.event_name === 'blueprint_opened').length
    const measurementCount = orgTelemetry.filter((row: any) => row.event_name === 'blueprint_measurement_created').length
    const circuitPathCount = orgTelemetry.filter((row: any) => row.event_name === 'circuit_path_created').length
    const circuitArcCount = orgTelemetry.filter((row: any) => row.event_name === 'circuit_arc_created').length
    const workPackageCount = orgTelemetry.filter((row: any) => row.event_name === 'work_package_created').length
    const featureErrorCount = orgTelemetry.filter((row: any) => row.event_name === 'feature_error').length

    return {
      organizationId: org.id,
      organizationName: org.name,
      classification: org.classification,
      createdAt: org.createdAt,
      activated: activation.activated,
      activationAt: activation.activationAt,
      firstValueAt: activation.firstValueAt,
      minutesToFirstValue: activation.minutesToFirstValue,
      projectsCreated: orgProjects.length,
      estimatesCreated: orgEstimates.length,
      estimatesSent: orgEstimates.filter((row: any) => row.status === 'sent' || Boolean(row.sent_at)).length,
      employeesInvited: orgEmployees.filter((row: any) => row.invited_at).length,
      employeesActivated: orgEmployees.filter((row: any) => row.accepted_at).length,
      employeeActivationRate:
        orgEmployees.filter((row: any) => row.invited_at).length > 0
          ? Number((orgEmployees.filter((row: any) => row.accepted_at).length / orgEmployees.filter((row: any) => row.invited_at).length).toFixed(4))
          : null,
      employeePortalActive: isEmployeePortalActiveOrganization({
        acceptedEmployees: orgEmployees.filter((row: any) => row.accepted_at).length,
        timePunchCount: orgTimePunches.length,
      }),
      employeePortalActivityCount: orgTimePunches.length,
      blueprintUploads: blueprintUploadsRes.available ? orgBlueprintUploads.length : null,
      blueprintUploadsAvailable: blueprintUploadsRes.available,
      blueprintOpenCount,
      blueprintMeasurementCount: measurementCount,
      circuitPathCount,
      circuitArcCount,
      workPackageCount,
      blueprintActive: isBlueprintActiveOrganization({
        hasBlueprintOpen: blueprintOpenCount > 0 || (blueprintUploadsRes.available && orgBlueprintUploads.length > 0),
        measurementCount,
        circuitPathCount,
        circuitArcCount,
        workPackageCount,
      }),
      paymentsRecorded: payments.filter((row: any) => String(row.org_id) === org.id).length,
      portalRequests: portalRequests.filter((row: any) => String(row.organization_id) === org.id).length,
      featureErrorCount,
      founderSupportIncidentCount: orgSupportIncidents.length,
      founderSupportMinutes: orgSupportIncidents.reduce((sum: number, row: any) => sum + Number(row.metadata?.minutesSpent || 0), 0),
    }
  })

  return json(200, {
    generatedAt: new Date().toISOString(),
    weekStart: start.toISOString(),
    weekEnd: end.toISOString(),
    summary: {
      totalPilotOrganizations: organizationsReport.length,
      activatedOrganizations: organizationsReport.filter((row) => row.activated).length,
      weeklyActiveOrganizations: weekly.weeklyActiveOrganizations,
      weeklyActiveUsers: weekly.weeklyActiveUsers,
      blueprintUploadsAvailable: blueprintUploadsRes.available,
    },
    allOrganizations: pilotOrganizations,
    organizations: organizationsReport,
  })
}

async function listAllAuthUsers(supabase: any): Promise<any[]> {
  const users: any[] = []
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 })
    if (error) throw error
    const batch = data?.users ?? []
    users.push(...batch)
    if (batch.length < 1000) break
  }
  return users
}

function record(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {}
}

export function buildFounderContractorAdminReport(input: {
  organizations: any[]
  profiles: any[]
  invites: any[]
  agreements: any[]
  authUsers: any[]
  overrides?: any[]
}, now = Date.now()) {
  const { organizations, profiles, invites, agreements, authUsers, overrides = [] } = input
  const authById = new Map(authUsers.map((entry: any) => [String(entry.id), entry]))
  const authByEmail = new Map(authUsers
    .filter((entry: any) => entry.email)
    .map((entry: any) => [String(entry.email).trim().toLowerCase(), entry]))
  const profileByUserId = new Map(profiles.map((entry: any) => [String(entry.id), entry]))
  const organizationById = new Map(organizations.map((entry: any) => [String(entry.id), entry]))
  const organizationByOwnerId = new Map(organizations
    .filter((entry: any) => entry.owner_id)
    .map((entry: any) => [String(entry.owner_id), entry]))
  const agreementsByUserId = new Map<string, NDASignedAgreementRecordLike[]>()
  for (const agreement of agreements) {
    const key = String(agreement.user_id || '')
    if (!agreementsByUserId.has(key)) agreementsByUserId.set(key, [])
    agreementsByUserId.get(key)!.push(agreement)
  }
  const overrideByUserId = new Map<string, NDAAccessOverrideRecordLike>(
    overrides
      .filter((entry: any) => entry?.user_id)
      .map((entry: any) => [String(entry.user_id), entry]),
  )

  function describeNDAStatus(state: string): 'signed' | 'grandfathered' | 'missing' | 'revoked' {
    if (state === 'SIGNED_CURRENT' || state === 'SIGNED_LEGACY') return 'signed'
    if (state === 'GRANDFATHERED_LEGACY_ACCESS') return 'grandfathered'
    if (state === 'REVOKED') return 'revoked'
    return 'missing'
  }

  const contractorAccounts = organizations
    .filter((org: any) => org.owner_id)
    .map((org: any) => {
    const ownerId = String(org.owner_id || '')
    const owner = authById.get(ownerId) as any
    const ownerProfile = profileByUserId.get(ownerId) as any
    const settings = record(org.settings)
    const onboarding = record(settings.onboarding)
    const resolved = resolveNDAStatus({
      agreements: agreementsByUserId.get(ownerId) ?? [],
      override: overrideByUserId.get(ownerId) ?? null,
      user: {
        userId: ownerId,
        role: ownerProfile?.role ?? 'owner',
        organizationId: String(org.id),
        organizationOwnerId: ownerId,
        authCreatedAt: owner?.created_at ?? null,
        lastSignInAt: owner?.last_sign_in_at ?? null,
        profileCreatedAt: ownerProfile?.created_at ?? null,
        organizationCreatedAt: org.created_at ?? null,
      },
    })
    return {
      organizationId: String(org.id),
      organizationName: String(org.name || ''),
      ownerEmail: String(owner?.email || ''),
      createdAt: org.created_at,
      onboardingStatus: onboarding.complete === true ? 'complete' : 'pending',
      agreementStatus: describeNDAStatus(resolved.state),
      ndaState: resolved.state,
      agreementVersion: resolved.agreement?.agreement_type || null,
      signedAt: resolved.signedAt,
      signer: resolved.signer || ownerProfile?.full_name || null,
      artifactAvailable: resolved.hasArtifact,
      classification: getPilotOrganizationClassification(settings),
      accountStatus: ownerProfile?.is_active === false ? 'inactive' : 'active',
    }
  })

  const contractorBetaInvites = invites.map((invite: any) => {
    const acceptedUser = (invite.accepted_user_id
      ? authById.get(String(invite.accepted_user_id))
      : authByEmail.get(String(invite.email || '').trim().toLowerCase())) as any
    const linkedOrg = (invite.organization_id
      ? organizationById.get(String(invite.organization_id))
      : acceptedUser
        ? organizationByOwnerId.get(String(acceptedUser.id))
        : null) as any
    const status = invite.status === 'pending' && new Date(invite.expires_at).getTime() <= now
      ? 'expired'
      : invite.status
    return {
      id: String(invite.id),
      email: String(invite.email || ''),
      industry: invite.industry ? String(invite.industry) : null,
      status,
      invitedAt: invite.invited_at,
      acceptedAt: invite.accepted_at,
      expiresAt: invite.expires_at,
      organizationId: linkedOrg?.id ? String(linkedOrg.id) : null,
      organizationName: linkedOrg?.name ? String(linkedOrg.name) : null,
    }
  })

  const signedAgreements = contractorAccounts.map((account: any) => {
    const ownerId = String(account.organizationId ? (organizationById.get(account.organizationId)?.owner_id || '') : '')
    const owner = authById.get(ownerId) as any
    const profile = profileByUserId.get(ownerId) as any
    const org = organizationById.get(String(account.organizationId)) as any
    const resolved = resolveNDAStatus({
      agreements: agreementsByUserId.get(ownerId) ?? [],
      override: overrideByUserId.get(ownerId) ?? null,
      user: {
        userId: ownerId,
        role: profile?.role ?? 'owner',
        organizationId: org?.id ? String(org.id) : null,
        organizationOwnerId: ownerId,
        authCreatedAt: owner?.created_at ?? null,
        lastSignInAt: owner?.last_sign_in_at ?? null,
        profileCreatedAt: profile?.created_at ?? null,
        organizationCreatedAt: org?.created_at ?? null,
      },
    })
    const agreement = resolved.agreement as NDASignedAgreementRecordLike | null
    const status = resolved.state === 'SIGNED_CURRENT'
      ? 'current'
      : resolved.state === 'SIGNED_LEGACY'
        ? 'legacy'
        : resolved.state === 'GRANDFATHERED_LEGACY_ACCESS'
          ? 'grandfathered'
          : resolved.state === 'REVOKED'
            ? 'revoked'
            : 'unsigned'
    return {
      id: String(agreement?.id || `nda-access-${ownerId}`),
      signer: String(agreement?.typed_name || profile?.full_name || ''),
      email: String(agreement?.email || owner?.email || ''),
      organizationId: org?.id ? String(org.id) : null,
      organizationName: org?.name ? String(org.name) : null,
      version: agreement?.agreement_type ? String(agreement.agreement_type) : null,
      signedAt: resolved.signedAt,
      ndaState: resolved.state,
      status,
      pinVerified: agreement?.pin_verified === true,
      hasPdf: resolved.hasArtifact,
      artifactStatus: resolved.state === 'GRANDFATHERED_LEGACY_ACCESS'
        ? 'access_grandfathered_no_signed_document'
        : resolved.hasArtifact
          ? 'signed_document_on_file'
          : allowsNDAAccess(resolved.state)
            ? 'no_signed_pdf_captured'
            : 'no_document',
    }
  })

  return {
    contractorAccounts: contractorAccounts.sort((a: any, b: any) => String(b.createdAt).localeCompare(String(a.createdAt))),
    contractorBetaInvites: contractorBetaInvites.sort((a: any, b: any) => String(b.invitedAt).localeCompare(String(a.invitedAt))),
    signedAgreements: signedAgreements.sort((a: any, b: any) => String(b.signedAt).localeCompare(String(a.signedAt))),
  }
}

/** Founder-only cross-org contractor account, beta invite, and agreement report. */
async function handleFounderContractorAdmin(user: any) {
  const denied = requireFounder(user)
  if (denied) return denied

  const supabase = getServiceClient()
  const [organizationsResult, profilesResult, invitesResult, agreementsResult, overridesResult, authUsers] = await Promise.all([
    supabase.from('organizations').select('id, name, owner_id, settings, created_at'),
    supabase.from('profiles').select('id, org_id, full_name, role, is_active, created_at'),
    supabase.from('beta_invites').select('id, email, industry, status, invited_at, accepted_at, expires_at, accepted_user_id, organization_id'),
    supabase.from('signed_agreements').select('id, user_id, agreement_type, typed_name, full_name, email, signed_at, created_at, pdf_url, signature_image, signature_data, ip_address, version, org_id'),
    readOptionalTable(supabase, 'nda_access_authority', 'user_id, access_state, source_classification, reason, effective_at, created_at'),
    listAllAuthUsers(supabase),
  ])

  for (const result of [organizationsResult, profilesResult, invitesResult, agreementsResult]) {
    if (result.error) return json(500, { error: result.error.message || 'Founder contractor report query failed.' })
  }

  const report = buildFounderContractorAdminReport({
    organizations: organizationsResult.data ?? [],
    profiles: profilesResult.data ?? [],
    invites: invitesResult.data ?? [],
    agreements: agreementsResult.data ?? [],
    overrides: overridesResult.available ? (overridesResult.data ?? []) : [],
    authUsers,
  })

  return json(200, {
    generatedAt: new Date().toISOString(),
    ...report,
  })
}

async function handleFounderRevokeBetaInvite(event: NetlifyEvent, user: any) {
  const denied = requireFounder(user)
  if (denied) return denied
  const payload = event.body ? JSON.parse(event.body) : {}
  const inviteId = String(payload?.inviteId || '').trim()
  if (!inviteId) return json(400, { error: 'inviteId is required.' })

  const supabase = getServiceClient()
  const { data, error } = await supabase
    .from('beta_invites')
    .update({ status: 'revoked' })
    .eq('id', inviteId)
    .select('id')
    .maybeSingle()
  if (error) return json(500, { error: error.message || 'Could not revoke beta invite.' })
  if (!data?.id) return json(404, { error: 'Beta invite not found.' })
  return json(200, { ok: true, inviteId })
}

export async function handler(event: NetlifyEvent) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' }, body: '' }
  }

  const user = await verifyAuthenticatedUser(event)
  if (!user) return json(401, { error: 'Authentication required.' })

  const action = event.httpMethod === 'GET'
    ? String(event.queryStringParameters?.action || '').trim()
    : String((event.body ? JSON.parse(event.body).action : '') || '').trim()

  try {
    if (action === 'track_event') return await handleTrackEvent(event, user)
    if (action === 'log_support_incident') return await handleSupportIncident(event, user)
    if (action === 'founder_report') return await handleFounderReport(user)
    if (action === 'founder_contractor_admin') return await handleFounderContractorAdmin(user)
    if (action === 'founder_revoke_beta_invite') return await handleFounderRevokeBetaInvite(event, user)
    if (action === 'set_org_classification') return await handleSetOrgClassification(event, user)
    return json(400, { error: 'Unknown action.' })
  } catch (error: any) {
    return json(500, { error: error?.message || 'Pilot telemetry request failed.' })
  }
}
