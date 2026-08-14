import { authedJsonHeaders } from '@/services/authedFetch'

export interface FounderContractorAccount {
  organizationId: string
  organizationName: string
  ownerEmail: string
  createdAt: string
  onboardingStatus: 'complete' | 'pending'
  agreementStatus: 'signed' | 'grandfathered' | 'missing' | 'revoked'
  ndaState: 'SIGNED_CURRENT' | 'SIGNED_LEGACY' | 'GRANDFATHERED_LEGACY_ACCESS' | 'UNSIGNED' | 'REVOKED'
  agreementVersion: string | null
  signedAt: string | null
  signer: string | null
  artifactAvailable: boolean
  classification: string
  accountStatus: 'active' | 'inactive'
}

export interface FounderBetaInvite {
  id: string
  email: string
  industry: string | null
  status: 'pending' | 'accepted' | 'expired' | 'revoked'
  invitedAt: string
  acceptedAt: string | null
  expiresAt: string
  organizationId: string | null
  organizationName: string | null
}

export interface FounderSignedAgreement {
  id: string
  signer: string
  email: string
  organizationId: string | null
  organizationName: string | null
  version: string | null
  signedAt: string | null
  ndaState: 'SIGNED_CURRENT' | 'SIGNED_LEGACY' | 'GRANDFATHERED_LEGACY_ACCESS' | 'UNSIGNED' | 'REVOKED'
  status: 'current' | 'legacy' | 'grandfathered' | 'unsigned' | 'revoked'
  pinVerified: boolean
  hasPdf: boolean
  artifactStatus: 'signed_document_on_file' | 'no_signed_pdf_captured' | 'access_grandfathered_no_signed_document' | 'no_document'
}

export interface FounderContractorAdminReport {
  generatedAt: string
  contractorAccounts: FounderContractorAccount[]
  contractorBetaInvites: FounderBetaInvite[]
  signedAgreements: FounderSignedAgreement[]
}

export async function fetchFounderContractorAdminReport(): Promise<FounderContractorAdminReport> {
  const response = await fetch('/.netlify/functions/pilot-telemetry?action=founder_contractor_admin', {
    method: 'GET',
    headers: await authedJsonHeaders(),
  })
  if (!response.ok) throw new Error(await response.text() || `Founder contractor report failed (${response.status})`)
  return response.json()
}
