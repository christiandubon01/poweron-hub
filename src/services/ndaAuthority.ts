export type NDAState =
  | 'SIGNED_CURRENT'
  | 'SIGNED_LEGACY'
  | 'GRANDFATHERED_LEGACY_ACCESS'
  | 'UNSIGNED'
  | 'REVOKED'

export interface NDAVersionPolicy {
  agreementType: string
  requiresReconsent: boolean
}

export const NDA_VERSION_CATALOG: NDAVersionPolicy[] = [
  {
    agreementType: 'nda_beta_v1',
    requiresReconsent: false,
  },
]

export interface NDASignedAgreementRecordLike {
  id?: string | null
  user_id?: string | null
  agreement_type?: string | null
  signature_image?: string | null
  signature_data?: string | null
  typed_name?: string | null
  full_name?: string | null
  email?: string | null
  ip_address?: string | null
  signed_at?: string | null
  created_at?: string | null
  pdf_url?: string | null
  pin_verified?: boolean | null
  verification_timestamp?: string | null
  revoked?: boolean | null
  version?: string | null
  org_id?: string | null
}

export interface NDAAccessOverrideRecordLike {
  user_id?: string | null
  access_state?: string | null
  source_classification?: string | null
  reason?: string | null
  effective_at?: string | null
  created_at?: string | null
}

export interface NDAUserContext {
  userId: string
  role?: string | null
  organizationId?: string | null
  organizationOwnerId?: string | null
  authCreatedAt?: string | null
  lastSignInAt?: string | null
  profileCreatedAt?: string | null
  organizationCreatedAt?: string | null
}

export interface ResolvedNDAStatus {
  state: NDAState
  agreement: NDASignedAgreementRecordLike | null
  override: NDAAccessOverrideRecordLike | null
  versionPolicy: NDAVersionPolicy | null
  signedAt: string | null
  signer: string | null
  email: string | null
  hasArtifact: boolean
  source:
    | 'server_current'
    | 'server_legacy'
    | 'override_grandfathered'
    | 'override_revoked'
    | 'missing'
    | 'reconsent_required'
}

function normalizeAgreementType(value: string | null | undefined): string {
  return String(value || '').trim().toLowerCase()
}

export function isNdaAgreementType(value: string | null | undefined): boolean {
  return normalizeAgreementType(value).includes('nda')
}

function hasAgreementTimestamp(record: NDASignedAgreementRecordLike): boolean {
  return Boolean(record.signed_at || record.created_at)
}

function parseTime(value: string | null | undefined): number | null {
  if (!value) return null
  const time = Date.parse(value)
  return Number.isFinite(time) ? time : null
}

function getPolicyIndex(
  agreementType: string | null | undefined,
  versionCatalog: NDAVersionPolicy[],
): number {
  const normalized = normalizeAgreementType(agreementType)
  return versionCatalog.findIndex((policy) => normalizeAgreementType(policy.agreementType) === normalized)
}

function hasLaterReconsentRequirement(
  agreementType: string | null | undefined,
  versionCatalog: NDAVersionPolicy[],
): boolean {
  const index = getPolicyIndex(agreementType, versionCatalog)
  if (index === -1) return false
  return versionCatalog.slice(index + 1).some((policy) => policy.requiresReconsent === true)
}

function supportsCurrentWriteContract(
  record: NDASignedAgreementRecordLike,
  versionCatalog: NDAVersionPolicy[],
): boolean {
  const currentPolicy = versionCatalog[versionCatalog.length - 1] ?? null
  if (!currentPolicy) return false
  return (
    normalizeAgreementType(record.agreement_type) === normalizeAgreementType(currentPolicy.agreementType)
    && hasAgreementTimestamp(record)
    && Boolean(record.typed_name || record.full_name)
    && Boolean(record.email)
    && Boolean(record.signature_image || record.signature_data)
  )
}

export function hasRealNDAArtifact(pdfUrl: string | null | undefined): boolean {
  const normalized = String(pdfUrl || '').trim()
  if (!normalized) return false
  return !normalized.toLowerCase().startsWith('stub-')
}

function classifyServerAgreement(
  record: NDASignedAgreementRecordLike,
  versionCatalog: NDAVersionPolicy[],
): { state: 'SIGNED_CURRENT' | 'SIGNED_LEGACY'; policy: NDAVersionPolicy | null } | null {
  if (!record) return null
  if (record.revoked === true) return null
  if (!isNdaAgreementType(record.agreement_type)) return null
  if (!hasAgreementTimestamp(record)) return null
  if (hasLaterReconsentRequirement(record.agreement_type, versionCatalog)) return null
  const policyIndex = getPolicyIndex(record.agreement_type, versionCatalog)
  const policy = policyIndex === -1 ? null : versionCatalog[policyIndex]
  return supportsCurrentWriteContract(record, versionCatalog)
    ? { state: 'SIGNED_CURRENT', policy }
    : { state: 'SIGNED_LEGACY', policy }
}

function agreementSignedAt(record: NDASignedAgreementRecordLike): number {
  return parseTime(record.signed_at) ?? parseTime(record.created_at) ?? 0
}

function selectBestAgreement(
  agreements: NDASignedAgreementRecordLike[],
  versionCatalog: NDAVersionPolicy[],
): { record: NDASignedAgreementRecordLike; state: 'SIGNED_CURRENT' | 'SIGNED_LEGACY'; policy: NDAVersionPolicy | null } | null {
  const ordered = [...agreements].sort((left, right) => agreementSignedAt(right) - agreementSignedAt(left))
  for (const record of ordered) {
    const classification = classifyServerAgreement(record, versionCatalog)
    if (classification) {
      return { record, state: classification.state, policy: classification.policy }
    }
  }
  return null
}

export function allowsNDAAccess(state: NDAState): boolean {
  return state === 'SIGNED_CURRENT' || state === 'SIGNED_LEGACY' || state === 'GRANDFATHERED_LEGACY_ACCESS'
}

export function resolveNDAStatus(params: {
  agreements?: NDASignedAgreementRecordLike[] | null
  override?: NDAAccessOverrideRecordLike | null
  user: NDAUserContext
  versionCatalog?: NDAVersionPolicy[]
}): ResolvedNDAStatus {
  const agreements = Array.isArray(params.agreements) ? params.agreements : []
  const override = params.override ?? null
  const versionCatalog = params.versionCatalog?.length ? params.versionCatalog : NDA_VERSION_CATALOG

  if (override?.access_state === 'REVOKED') {
    return {
      state: 'REVOKED',
      agreement: null,
      override,
      versionPolicy: null,
      signedAt: null,
      signer: null,
      email: null,
      hasArtifact: false,
      source: 'override_revoked',
    }
  }

  const bestAgreement = selectBestAgreement(agreements, versionCatalog)
  if (bestAgreement) {
    return {
      state: bestAgreement.state,
      agreement: bestAgreement.record,
      override,
      versionPolicy: bestAgreement.policy,
      signedAt: bestAgreement.record.signed_at || bestAgreement.record.created_at || null,
      signer: bestAgreement.record.typed_name || bestAgreement.record.full_name || null,
      email: bestAgreement.record.email || null,
      hasArtifact: hasRealNDAArtifact(bestAgreement.record.pdf_url),
      source: bestAgreement.state === 'SIGNED_CURRENT' ? 'server_current' : 'server_legacy',
    }
  }

  const requiresReconsent = agreements.some((agreement) => hasLaterReconsentRequirement(agreement.agreement_type, versionCatalog))
  if (requiresReconsent) {
    return {
      state: 'UNSIGNED',
      agreement: null,
      override,
      versionPolicy: null,
      signedAt: null,
      signer: null,
      email: null,
      hasArtifact: false,
      source: 'reconsent_required',
    }
  }

  const hasLegacyAccessOverride = override?.access_state === 'GRANDFATHERED_LEGACY_ACCESS'
  if (hasLegacyAccessOverride) {
    return {
      state: 'GRANDFATHERED_LEGACY_ACCESS',
      agreement: null,
      override,
      versionPolicy: null,
      signedAt: null,
      signer: null,
      email: null,
      hasArtifact: false,
      source: 'override_grandfathered',
    }
  }
  return {
    state: 'UNSIGNED',
    agreement: null,
    override,
    versionPolicy: null,
    signedAt: null,
    signer: null,
    email: null,
    hasArtifact: false,
    source: requiresReconsent ? 'reconsent_required' : 'missing',
  }
}
