import { describe, expect, it } from 'vitest'
import {
  buildOrganizationIdentityPatch,
  normalizeOrganizationIdentity,
  resolveProductRedirectUrl,
} from '../organizationIdentityService'

describe('COMM-1B organization identity service', () => {
  it('normalizes organization name plus nested identity settings', () => {
    const identity = normalizeOrganizationIdentity({
      name: 'Desert Test Electric LLC',
      settings: {
        identity: {
          supportEmail: ' ops@desert.test ',
          supportPhone: ' 760-555-0100 ',
          address: ' 123 Main St ',
          licenseNumber: ' C-10-555 ',
          timezone: 'America/Phoenix',
          logoLight: 'light-logo',
          logoDark: 'dark-logo',
        },
      },
    })

    expect(identity).toEqual({
      companyName: 'Desert Test Electric LLC',
      supportEmail: 'ops@desert.test',
      supportPhone: '760-555-0100',
      address: '123 Main St',
      licenseNumber: 'C-10-555',
      timezone: 'America/Phoenix',
      logoLight: 'light-logo',
      logoDark: 'dark-logo',
    })
  })

  it('defaults missing nested identity fields without falling back to Power On branding', () => {
    expect(normalizeOrganizationIdentity({ name: 'External Org', settings: {} })).toEqual({
      companyName: 'External Org',
      supportEmail: '',
      supportPhone: '',
      address: '',
      licenseNumber: '',
      timezone: 'America/Los_Angeles',
      logoLight: '',
      logoDark: '',
    })
  })

  it('builds a partial settings patch without discarding unrelated organization settings', () => {
    const patch = buildOrganizationIdentityPatch(
      {
        name: 'Power On Solutions LLC',
        settings: {
          unrelated: { keep: true },
          identity: {
            supportEmail: 'office@poweron.test',
            supportPhone: '760-111-2222',
            address: '',
            licenseNumber: 'OLD',
            timezone: 'America/Los_Angeles',
            logoLight: 'light-a',
            logoDark: 'dark-a',
          },
        },
      },
      {
        companyName: 'Desert Test Electric LLC',
        licenseNumber: 'NEW-C-10',
        supportPhone: '760-999-0000',
      },
    )

    expect(patch).toEqual({
      name: 'Desert Test Electric LLC',
      settings: {
        unrelated: { keep: true },
        identity: {
          supportEmail: 'office@poweron.test',
          supportPhone: '760-999-0000',
          address: '',
          licenseNumber: 'NEW-C-10',
          timezone: 'America/Los_Angeles',
          logoLight: 'light-a',
          logoDark: 'dark-a',
        },
      },
    })
  })

  it('prefers configured product host, then browser origin, then legacy fallback for magic links', () => {
    expect(resolveProductRedirectUrl('https://hub.poweron.example/', 'https://ignored.example')).toBe('https://hub.poweron.example')
    expect(resolveProductRedirectUrl('', 'https://pilot.poweronhub.app/')).toBe('https://pilot.poweronhub.app')
    expect(resolveProductRedirectUrl('', '')).toBe('https://app.poweronsolutionsllc.com')
  })
})
