import { supabase } from '@/lib/supabase'

export interface OrganizationIdentity {
  companyName: string
  supportEmail: string
  supportPhone: string
  address: string
  licenseNumber: string
  timezone: string
  logoLight: string
  logoDark: string
}

type OrganizationRow = {
  id?: string
  name?: string | null
  settings?: Record<string, unknown> | null
}

type PersistedIdentity = Partial<{
  supportEmail: string
  supportPhone: string
  address: string
  licenseNumber: string
  timezone: string
  logoLight: string
  logoDark: string
}>

/**
 * COMM-PROD-1.1. First-run company identity onboarding state.
 *
 * AppShell and BetaOnboarding both addressed a table named `orgs`, which does not
 * exist — `organizations` is the multi-tenant root (migration 002). Every read
 * errored and every write was silently dropped, so a brand-new contractor never
 * reached company identity onboarding.
 *
 * The state lives in `organizations.settings.onboarding` (JSONB, already present
 * on the real table) so no schema change is required, and it sits beside
 * `settings.identity` under the same org-scoped authority.
 */
export interface OrganizationOnboarding {
  complete: boolean
  industry: string
  businessName: string
  ownerName: string
  licenseNumber: string
  cityState: string
  aiName: string
  nexusVoiceId: string
}

export interface OrganizationOnboardingState {
  identity: OrganizationIdentity
  onboarding: OrganizationOnboarding
  /** True when this organization already has a company identity on file. */
  identityConfigured: boolean
}

const DEFAULT_TIMEZONE = 'America/Los_Angeles'

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

export function normalizeOrganizationIdentity(row: OrganizationRow | null | undefined): OrganizationIdentity {
  const settings = asRecord(row?.settings)
  const identity = asRecord(settings.identity)

  return {
    companyName: cleanString(row?.name),
    supportEmail: cleanString(identity.supportEmail),
    supportPhone: cleanString(identity.supportPhone),
    address: cleanString(identity.address),
    licenseNumber: cleanString(identity.licenseNumber),
    timezone: cleanString(identity.timezone) || DEFAULT_TIMEZONE,
    logoLight: cleanString(identity.logoLight),
    logoDark: cleanString(identity.logoDark),
  }
}

/**
 * Mirrors the authoritative organization identity into the legacy workspace
 * settings consumed by the shell. Returns the original object when no value
 * changes so bootstrap can avoid a redundant persistence write.
 */
export function applyOrganizationIdentityToWorkspaceSettings(
  settings: Record<string, unknown>,
  identity: OrganizationIdentity,
): Record<string, unknown> {
  const patch: Record<string, unknown> = {}
  if (identity.companyName && settings.company !== identity.companyName) patch.company = identity.companyName
  if (identity.licenseNumber && settings.license !== identity.licenseNumber) patch.license = identity.licenseNumber
  if (identity.supportEmail && settings.supportEmail !== identity.supportEmail) patch.supportEmail = identity.supportEmail
  if (identity.supportPhone && settings.supportPhone !== identity.supportPhone) patch.supportPhone = identity.supportPhone
  if (identity.address && settings.businessAddress !== identity.address) patch.businessAddress = identity.address
  if (identity.timezone && settings.orgTimezone !== identity.timezone) patch.orgTimezone = identity.timezone
  if (identity.logoLight && settings.logoLight !== identity.logoLight) patch.logoLight = identity.logoLight
  if (identity.logoDark && settings.logoDark !== identity.logoDark) patch.logoDark = identity.logoDark
  return Object.keys(patch).length > 0 ? { ...settings, ...patch } : settings
}

export function buildOrganizationIdentityPatch(
  current: OrganizationRow | null | undefined,
  patch: Partial<OrganizationIdentity>,
): { name?: string; settings: Record<string, unknown> } {
  const currentSettings = asRecord(current?.settings)
  const currentIdentity = asRecord(currentSettings.identity)
  const nextIdentity: PersistedIdentity = {
    supportEmail: cleanString(patch.supportEmail ?? currentIdentity.supportEmail),
    supportPhone: cleanString(patch.supportPhone ?? currentIdentity.supportPhone),
    address: cleanString(patch.address ?? currentIdentity.address),
    licenseNumber: cleanString(patch.licenseNumber ?? currentIdentity.licenseNumber),
    timezone: cleanString(patch.timezone ?? currentIdentity.timezone) || DEFAULT_TIMEZONE,
    logoLight: cleanString(patch.logoLight ?? currentIdentity.logoLight),
    logoDark: cleanString(patch.logoDark ?? currentIdentity.logoDark),
  }

  return {
    ...(patch.companyName !== undefined ? { name: cleanString(patch.companyName) || current?.name || '' } : {}),
    settings: {
      ...currentSettings,
      identity: nextIdentity,
    },
  }
}

export function normalizeOrganizationOnboarding(row: OrganizationRow | null | undefined): OrganizationOnboarding {
  const settings = asRecord(row?.settings)
  const onboarding = asRecord(settings.onboarding)

  return {
    complete: onboarding.complete === true,
    industry: cleanString(onboarding.industry),
    businessName: cleanString(onboarding.businessName),
    ownerName: cleanString(onboarding.ownerName),
    licenseNumber: cleanString(onboarding.licenseNumber),
    cityState: cleanString(onboarding.cityState),
    aiName: cleanString(onboarding.aiName),
    nexusVoiceId: cleanString(onboarding.nexusVoiceId),
  }
}

/**
 * An organization that already carries company identity details has been set up,
 * whether or not it ever walked the beta onboarding screens. This is what keeps
 * Customer Zero and any other established tenant out of first-run onboarding.
 */
export function hasConfiguredOrganizationIdentity(identity: OrganizationIdentity | null | undefined): boolean {
  if (!identity) return false
  return Boolean(
    identity.supportEmail ||
    identity.supportPhone ||
    identity.address ||
    identity.licenseNumber ||
    identity.logoLight ||
    identity.logoDark,
  )
}

export function buildOrganizationOnboardingPatch(
  current: OrganizationRow | null | undefined,
  patch: Partial<OrganizationOnboarding>,
): { name?: string; settings: Record<string, unknown> } {
  const currentSettings = asRecord(current?.settings)
  const currentOnboarding = normalizeOrganizationOnboarding(current)
  const businessName = cleanString(patch.businessName ?? currentOnboarding.businessName)

  const nextOnboarding: OrganizationOnboarding = {
    complete: patch.complete ?? currentOnboarding.complete,
    industry: cleanString(patch.industry ?? currentOnboarding.industry),
    businessName,
    ownerName: cleanString(patch.ownerName ?? currentOnboarding.ownerName),
    licenseNumber: cleanString(patch.licenseNumber ?? currentOnboarding.licenseNumber),
    cityState: cleanString(patch.cityState ?? currentOnboarding.cityState),
    aiName: cleanString(patch.aiName ?? currentOnboarding.aiName),
    nexusVoiceId: cleanString(patch.nexusVoiceId ?? currentOnboarding.nexusVoiceId),
  }

  // The business name and license the owner just entered ARE this organization's
  // identity, so they land in settings.identity too — that is what the rest of
  // the product already reads (COMM-1B).
  const identityPatch = buildOrganizationIdentityPatch(current, {
    ...(businessName ? { companyName: businessName } : {}),
    ...(nextOnboarding.licenseNumber ? { licenseNumber: nextOnboarding.licenseNumber } : {}),
  })

  return {
    ...(businessName ? { name: businessName } : {}),
    settings: {
      ...currentSettings,
      ...identityPatch.settings,
      onboarding: nextOnboarding,
    },
  }
}

/** Read the onboarding + identity state for one organization. Org-scoped by id. */
export async function loadOrganizationOnboardingState(orgId: string): Promise<OrganizationOnboardingState | null> {
  const cleanOrgId = cleanString(orgId)
  if (!cleanOrgId) return null

  const { data, error } = await supabase
    .from('organizations')
    .select('id, name, settings')
    .eq('id', cleanOrgId)
    .maybeSingle()

  if (error) throw error
  if (!data) return null

  const row = data as OrganizationRow
  const identity = normalizeOrganizationIdentity(row)
  return {
    identity,
    onboarding: normalizeOrganizationOnboarding(row),
    identityConfigured: hasConfiguredOrganizationIdentity(identity),
  }
}

/** Persist first-run onboarding answers onto the organization. Org-scoped by id. */
export async function saveOrganizationOnboarding(
  orgId: string,
  patch: Partial<OrganizationOnboarding>,
): Promise<OrganizationOnboarding | null> {
  const cleanOrgId = cleanString(orgId)
  if (!cleanOrgId) return null

  const from = supabase.from as any

  const { data: current, error: currentError } = await from('organizations')
    .select('id, name, settings')
    .eq('id', cleanOrgId)
    .maybeSingle()

  if (currentError) throw currentError
  if (!current) return null

  const update = buildOrganizationOnboardingPatch(current as OrganizationRow, patch)
  const { data: saved, error: saveError } = await from('organizations')
    .update(update)
    .eq('id', cleanOrgId)
    .select('id, name, settings')
    .maybeSingle()

  if (saveError) throw saveError
  return normalizeOrganizationOnboarding((saved ?? { ...(current as OrganizationRow), ...update }) as OrganizationRow)
}

export async function loadOrganizationIdentity(orgId: string): Promise<OrganizationIdentity | null> {
  const cleanOrgId = cleanString(orgId)
  if (!cleanOrgId) return null

  const { data, error } = await supabase
    .from('organizations')
    .select('id, name, settings')
    .eq('id', cleanOrgId)
    .maybeSingle()

  if (error) throw error
  if (!data) return null
  return normalizeOrganizationIdentity(data as OrganizationRow)
}

export async function saveOrganizationIdentity(
  orgId: string,
  patch: Partial<OrganizationIdentity>,
): Promise<OrganizationIdentity | null> {
  const cleanOrgId = cleanString(orgId)
  if (!cleanOrgId) return null

  const from = supabase.from as any

  const { data: current, error: currentError } = await from('organizations')
    .select('id, name, settings')
    .eq('id', cleanOrgId)
    .maybeSingle()

  if (currentError) throw currentError
  if (!current) return null

  const update = buildOrganizationIdentityPatch(current as OrganizationRow, patch)
  const { data: saved, error: saveError } = await from('organizations')
    .update(update)
    .eq('id', cleanOrgId)
    .select('id, name, settings')
    .maybeSingle()

  if (saveError) throw saveError
  return normalizeOrganizationIdentity((saved ?? current) as OrganizationRow)
}

export function resolveProductRedirectUrl(
  envUrl?: string | null,
  browserOrigin?: string | null,
): string {
  const preferred = cleanString(envUrl)
  if (preferred) return preferred.replace(/\/$/, '')

  const origin = cleanString(browserOrigin)
  if (origin) return origin.replace(/\/$/, '')

  return 'https://app.poweronsolutionsllc.com'
}
