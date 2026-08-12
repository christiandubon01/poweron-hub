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
