import { describe, expect, it } from 'vitest'

import { resolveNDAStatus } from '../ndaAuthority'

const OWNER_CONTEXT = {
  userId: 'owner-1',
  role: 'owner',
  organizationId: 'org-1',
  organizationOwnerId: 'owner-1',
  authCreatedAt: '2026-08-05T03:40:15.434857Z',
  lastSignInAt: '2026-08-14T04:51:41.694269Z',
  profileCreatedAt: '2026-08-05T03:40:15.434516Z',
  organizationCreatedAt: '2026-08-05T03:40:15.434516Z',
} as const

describe('resolveNDAStatus', () => {
  it('keeps an older signed version valid when newer versions do not require re-consent', () => {
    const result = resolveNDAStatus({
      agreements: [{
        id: 'nda-v1',
        user_id: 'owner-1',
        agreement_type: 'nda_beta_v1',
        signed_at: '2026-04-06T01:57:05.984Z',
        typed_name: 'Legacy Signer',
        signature_image: 'data:image/png;base64,legacy',
      }],
      user: OWNER_CONTEXT,
      versionCatalog: [
        { agreementType: 'nda_beta_v1', requiresReconsent: false },
        { agreementType: 'nda_beta_v2', requiresReconsent: false },
      ],
    })

    expect(result.state).toBe('SIGNED_LEGACY')
  })

  it('forces re-consent only when a newer version explicitly requires it', () => {
    const result = resolveNDAStatus({
      agreements: [{
        id: 'nda-v1',
        user_id: 'owner-1',
        agreement_type: 'nda_beta_v1',
        signed_at: '2026-04-06T01:57:05.984Z',
        typed_name: 'Legacy Signer',
        signature_image: 'data:image/png;base64,legacy',
      }],
      user: OWNER_CONTEXT,
      versionCatalog: [
        { agreementType: 'nda_beta_v1', requiresReconsent: false },
        { agreementType: 'nda_beta_v2', requiresReconsent: true },
      ],
    })

    expect(result.state).toBe('UNSIGNED')
    expect(result.source).toBe('reconsent_required')
  })

  it('prefers explicit grandfathered access records when no signed row exists', () => {
    const result = resolveNDAStatus({
      agreements: [],
      override: {
        user_id: 'owner-1',
        access_state: 'GRANDFATHERED_LEGACY_ACCESS',
        source_classification: 'legacy_owner_account_without_server_agreement',
        reason: 'Historical accepted access',
      },
      user: {
        userId: 'owner-1',
        role: 'owner',
      },
    })

    expect(result.state).toBe('GRANDFATHERED_LEGACY_ACCESS')
    expect(result.source).toBe('override_grandfathered')
  })

  it('does not infer grandfathered access from account age or owner status alone', () => {
    const result = resolveNDAStatus({
      agreements: [],
      user: OWNER_CONTEXT,
    })

    expect(result.state).toBe('UNSIGNED')
    expect(result.source).toBe('missing')
  })
})
