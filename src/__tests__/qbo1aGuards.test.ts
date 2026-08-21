/**
 * QBO-1A guardrail tests — prove QBO-1A did not cross its bounded scope.
 *
 * QBO-GUARD-1: no Supabase migration created
 * QBO-GUARD-2: no referral-owned file changed by QBO
 * QBO-GUARD-3: no pre-existing dirty / UI file wired to QuickBooks
 * QBO-GUARD-4: package.json unchanged by QBO
 * QBO-GUARD-5: deno.lock unchanged by QBO
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()
const read = (p: string): string => readFileSync(join(ROOT, p), 'utf8')
const exists = (p: string): boolean => existsSync(join(ROOT, p))

describe('QBO-1A guardrails', () => {
  it('QBO-GUARD-1: no Supabase migration was created by QBO-1A', () => {
    const migrations = readdirSync(join(ROOT, 'supabase/migrations')).filter((f) => f.endsWith('.sql'))
    // The real invariant: QBO-1A created NO migration. The only QBO/QuickBooks/
    // Intuit-named migrations are the later QBO-3A connection migration
    // (132_quickbooks_connections_and_oauth_states.sql), the QBO-4A.2 customer-
    // mapping migration (133_quickbooks_customer_mappings.sql), and the QBO-4A.6
    // text-identity migration (134_quickbooks_customer_mapping_text_identity.sql)
    // — not QBO-1A work.
    // (A numeric ceiling pin is not used: concurrent referral work legitimately
    // advances the highest migration number — e.g. 130_referral_profiles.sql —
    // and that is not QBO-1A work.)
    const qboNamed = migrations.filter((f) => /qbo|quickbooks|intuit/i.test(f))
    expect(qboNamed).toEqual([
      '132_quickbooks_connections_and_oauth_states.sql',
      '133_quickbooks_customer_mappings.sql',
      '134_quickbooks_customer_mapping_text_identity.sql',
    ])
  })

  it('QBO-GUARD-2: no referral-owned file references QuickBooks (referral logic untouched)', () => {
    const referralFiles = [
      'src/services/referral/referralService.ts',
      'src/components/salesIntel/tabs/ReferralsTab.tsx',
      'src/__tests__/leadSrc4hUnlinkedReferrer.test.ts',
      'supabase/migrations/129_referral_unlinked_confirmation.sql',
    ]
    for (const f of referralFiles) {
      if (exists(f)) {
        const src = read(f).toLowerCase()
        expect(src).not.toContain('quickbooks')
        expect(src).not.toContain('intuit')
        expect(src).not.toContain('services/quickbooks')
      }
    }
  })

  it('QBO-GUARD-3: no pre-existing dirty / UI file was wired to QuickBooks by QBO-1A', () => {
    const protectedFiles = [
      'src/App.tsx',
      'src/views/AdminToolsView.tsx',
      'src/views/GuardianView.tsx',
      'src/views/CrewPortal.tsx',
      'src/components/v15r/V15rTeamPanel.tsx',
      'src/services/crewPortalService.ts',
      'src/features/employee-directory/unifyDirectory.ts',
      'netlify/functions/sendEmployeeInvite.ts',
    ]
    for (const f of protectedFiles) {
      if (exists(f)) {
        const src = read(f)
        expect(src).not.toContain('services/quickbooks/')
        expect(src).not.toContain('netlify/functions/quickbooks')
      }
    }
  })

  it('QBO-GUARD-4: package.json unchanged by QBO-1A (no QuickBooks/Intuit dependency added)', () => {
    const pkg = read('package.json').toLowerCase()
    expect(pkg).not.toContain('intuit')
    // 'quickbooks' may pre-exist via quickbooksImportService references? Assert no npm dep spec.
    expect(pkg).not.toMatch(/"(intuit|@intuit|quickbooks)[^"]*"\s*:\s*"\^?\d/)
  })

  it('QBO-GUARD-5: deno.lock unchanged by QBO-1A (no Intuit entry added)', () => {
    if (exists('deno.lock')) {
      const lock = read('deno.lock').toLowerCase()
      expect(lock).not.toContain('intuit')
    }
  })
})