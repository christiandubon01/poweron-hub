/**
 * QBO-3A firewall tests (47–50) — the QBO-1A2 financial-authority firewall
 * stays fully intact.
 *
 * Connection / refresh / disconnect are auth/integration plumbing only. They
 * touch only the two new server-only tables, perform no QBO create API call,
 * and import no financial-authority modules. CompanyInfo is a read.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()

/** New QBO-3A/4A server modules + Netlify functions (the surface under firewall). */
const SERVER_FILES = [
  'src/services/quickbooks/quickbooksConnectionStore.ts',
  'src/services/quickbooks/quickbooksOauthStateStore.ts',
  'src/services/quickbooks/quickbooksTokenAuthority.ts',
  'src/services/quickbooks/quickbooksCompanyInfo.ts',
  'src/services/quickbooks/quickbooksTokenCrypto.ts',
  'src/services/quickbooks/quickbooksCustomerMappingStore.ts',
  'src/services/quickbooks/quickbooksCompanyFingerprint.ts',
  'src/services/quickbooks/qboCustomerContract.ts',
  'src/services/quickbooks/qboAccountingClient.ts',
  'src/services/quickbooks/qboCustomerCreateInput.ts',
  'netlify/functions/quickbooks/qboRepos.ts',
  'netlify/functions/quickbooks/qboCustomerMappingRepo.ts',
  'netlify/functions/quickbooks/qboCustomerAuth.ts',
  'netlify/functions/quickbooks/qbo-authorize.ts',
  'netlify/functions/quickbooks/qbo-callback.ts',
  'netlify/functions/quickbooks/qbo-connection-status.ts',
  'netlify/functions/quickbooks/qbo-disconnect.ts',
  'netlify/functions/quickbooks/qbo-customer-search.ts',
  'netlify/functions/quickbooks/qbo-customer-mapping.ts',
  'netlify/functions/quickbooks/qbo-customer-link.ts',
  'netlify/functions/quickbooks/qbo-customer-create.ts',
  'netlify/functions/quickbooks/qbo-customer-unlink.ts',
].map((p) => join(ROOT, p))

function readAll(): { path: string; src: string; code: string }[] {
  return SERVER_FILES.map((path) => {
    const src = readFileSync(path, 'utf8')
    // Strip comments for negative scans.
    const code = src
      .replace(/\/\/.*$/gm, ' ')
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
    return { path, src, code }
  })
}

describe('QBO-3A firewall — writes no financial truth (47)', () => {
  const FINANCIAL_TABLES = [
    'invoice_drafts',
    'service_logs',
    'service_calls',
    'call_logs',
    'historical_payments',
    'weekly',
    'kpi',
    'referral',
  ]

  it('no new module references a financial-authority table', () => {
    const all = readAll()
    for (const { path, code } of all) {
      for (const t of FINANCIAL_TABLES) {
        // Allow the word appearing only inside a quickbooks_ table name fragment
        // is not possible for these names; a bare reference is a violation.
        expect(code, `${path} must not reference ${t}`).not.toMatch(new RegExp(`\\b${t}\\b`, 'i'))
      }
    }
  })

  it('the only Supabase tables referenced by the repos are the two new ones', () => {
    const repos = readFileSync(join(ROOT, 'netlify/functions/quickbooks/qboRepos.ts'), 'utf8')
    const froms = [...repos.matchAll(/\.from\(['"]([^'"]+)['"]\)/g)].map((m) => m[1])
    expect(froms.length).toBeGreaterThan(0)
    const unique = Array.from(new Set(froms))
    expect(unique.sort()).toEqual(['quickbooks_connections', 'quickbooks_oauth_states'])
  })
})

describe('QBO-3A/4A firewall — Customer endpoint is the only accounting write (48)', () => {
  // Financial-entity accounting endpoints are NEVER reached by the QBO surface.
  // QBO-4A.3 narrowly allows the Customer entity (read + create); everything else
  // financial stays banned. This is the narrow explicit allowance, not a global
  // weakening of the QBO-1A2 financial firewall.
  const FINANCIAL_ENTITY_PATH =
    /\/v3\/company\/[^/]+\/(invoice|estimate|payment|purchase|deposit|bill|journalentry|refund|salesreceipt|creditmemo|receivepayment|vendor|account|class|department|taxcode|item)\b/i

  it('no module reaches a financial-entity accounting endpoint (invoice/estimate/payment/...)', () => {
    const all = readAll()
    for (const { path, code } of all) {
      expect(code, `${path} must not reach a financial-entity endpoint`).not.toMatch(FINANCIAL_ENTITY_PATH)
    }
  })

  it('no module uses a QBO create/update/delete/void operation parameter', () => {
    const all = readAll()
    for (const { path, code } of all) {
      // Customer create is a plain POST (no operation= param); this ban still holds.
      expect(code, `${path}`).not.toMatch(/operation\s*=\s*(create|update|delete|void)/i)
    }
  })

  it('every /v3/company/{realmId}/{entity} path is only `query` or `customer` (the allowed Customer API)', () => {
    const all = readAll()
    for (const { path, code } of all) {
      const matches = [...code.matchAll(/\/v3\/company\/[^/]+\/([a-z]+)/gi)]
      for (const m of matches) {
        const entity = m[1].toLowerCase()
        expect(['query', 'customer']).toContain(entity)
      }
    }
  })

  it('CompanyInfo is still reached only via a GET query (no POST)', () => {
    const companyInfo = readFileSync(join(ROOT, 'src/services/quickbooks/quickbooksCompanyInfo.ts'), 'utf8')
    expect(companyInfo).toMatch(/method:\s*'GET'/)
    expect(companyInfo).toContain('CompanyInfo')
    expect(companyInfo).not.toMatch(/method:\s*'POST'[\s\S]*?v3\/company/i)
  })
})

describe('QBO-3A firewall — only the two new tables named by repo interfaces (49)', () => {
  it('createConnectionRepo touches only quickbooks_connections', () => {
    const repos = readFileSync(join(ROOT, 'netlify/functions/quickbooks/qboRepos.ts'), 'utf8')
    const start = repos.indexOf('export function createConnectionRepo')
    expect(start).toBeGreaterThan(-1)
    const segment = repos.slice(start) // through end of file
    expect(segment).toContain('quickbooks_connections')
    expect(segment).not.toContain('quickbooks_oauth_states')
  })

  it('createStateRepo touches only quickbooks_oauth_states', () => {
    const repos = readFileSync(join(ROOT, 'netlify/functions/quickbooks/qboRepos.ts'), 'utf8')
    const start = repos.indexOf('export function createStateRepo')
    const end = repos.indexOf('export function createConnectionRepo')
    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)
    const segment = repos.slice(start, end)
    expect(segment).toContain('quickbooks_oauth_states')
    expect(segment).not.toContain('quickbooks_connections')
  })
})

describe('QBO-3A firewall — no financial-authority imports (50)', () => {
  const FORBIDDEN_IMPORT_PATTERNS = [
    /billing-draft/i,
    /billingDraft/i,
    /canonicalCash/i,
    /collectedRevenue/i,
    /getCollectedRevenue/i,
    /serviceBalance/i,
    /unpaidServiceEligibility/i,
    /financialTimeline/i,
    /cashFlowAnalyzer/i,
    /invoiceDraft/i,
    /kpiTimeline/i,
  ]

  it('new QBO-3A/4A server modules import no financial-authority module', () => {
    const newModules = [
      'src/services/quickbooks/quickbooksConnectionStore.ts',
      'src/services/quickbooks/quickbooksOauthStateStore.ts',
      'src/services/quickbooks/quickbooksTokenAuthority.ts',
      'src/services/quickbooks/quickbooksCompanyInfo.ts',
      'src/services/quickbooks/quickbooksTokenCrypto.ts',
      'src/services/quickbooks/quickbooksCustomerMappingStore.ts',
      'src/services/quickbooks/quickbooksCompanyFingerprint.ts',
      'src/services/quickbooks/qboCustomerContract.ts',
      'src/services/quickbooks/qboAccountingClient.ts',
      'src/services/quickbooks/qboCustomerCreateInput.ts',
    ].map((p) => join(ROOT, p))
    for (const p of newModules) {
      const src = readFileSync(p, 'utf8')
      const importLines = src.match(/^import[\s\S]*?from\s+['"][^'"]+['"]/gm) ?? []
      for (const line of importLines) {
        for (const pat of FORBIDDEN_IMPORT_PATTERNS) {
          expect(line, `${p} must not import a financial-authority module`).not.toMatch(pat)
        }
      }
    }
  })

  it('the new QBO-3A UI files import no canonical financial authority', () => {
    // Only the QBO-3A *new* UI surface (QuickBooksMenu, QuickBooksAccountModal,
    // useQuickBooksConnection). Pre-existing QBO-2F1 files (e.g. the selector
    // modal) legitimately reuse the unpaid authority and are out of scope here.
    const qbo3aUi = [
      'src/features/billing-draft/components/QuickBooksMenu.tsx',
      'src/features/billing-draft/components/QuickBooksAccountModal.tsx',
      'src/features/quickbooks-connection/useQuickBooksConnection.ts',
    ].map((p) => join(ROOT, p))
    for (const f of qbo3aUi) {
      const src = readFileSync(f, 'utf8')
      for (const pat of [/canonicalCash/i, /getCollectedRevenue/i, /serviceBalance/i, /unpaidServiceEligibility/i, /financialTimeline/i, /cashFlowAnalyzer/i, /billingDraft/i, /invoiceDraft/i]) {
        expect(src, `${f} must not import canonical financial authority`).not.toMatch(pat)
      }
    }
  })
})

describe('QBO-4A firewall — customer mapping is identity plumbing only (51)', () => {
  it('the mapping repo touches only quickbooks_customer_mappings', () => {
    const repo = readFileSync(join(ROOT, 'netlify/functions/quickbooks/qboCustomerMappingRepo.ts'), 'utf8')
    const froms = [...repo.matchAll(/\.from\(['"]([^'"]+)['"]\)/g)].map((m) => m[1])
    expect(froms.length).toBeGreaterThan(0)
    const unique = Array.from(new Set(froms))
    expect(unique.sort()).toEqual(['quickbooks_customer_mappings'])
  })

  it('qboRepos.ts is unchanged — still only the two connection/oauth tables', () => {
    // The mapping repo lives in a SEPARATE file so qboRepos.ts (frozen by the
    // test above) is not extended with a third .from() table.
    const repos = readFileSync(join(ROOT, 'netlify/functions/quickbooks/qboRepos.ts'), 'utf8')
    const froms = [...repos.matchAll(/\.from\(['"]([^'"]+)['"]\)/g)].map((m) => m[1])
    const unique = Array.from(new Set(froms))
    expect(unique.sort()).toEqual(['quickbooks_connections', 'quickbooks_oauth_states'])
    expect(repos).not.toContain('quickbooks_customer_mappings')
  })

  it('the mapping surface never persists the raw realmId', () => {
    // The raw realmId stays encrypted in quickbooks_connections. The mapping
    // table stores only the domain-separated fingerprint. Assert neither the
    // store, the repo, nor the fingerprint helper insert/select a realm_id-ish
    // column from the mapping table.
    const files = [
      'src/services/quickbooks/quickbooksCustomerMappingStore.ts',
      'src/services/quickbooks/quickbooksCompanyFingerprint.ts',
      'netlify/functions/quickbooks/qboCustomerMappingRepo.ts',
    ].map((p) => join(ROOT, p))
    for (const f of files) {
      const src = readFileSync(f, 'utf8')
      // No realm_id / realmId column is ever written to the mapping payload.
      expect(src, `${f} must not persist a realmId column`).not.toMatch(/realm_id|realmId:\s*input|realmId:\s*realm/i)
    }
    // The fingerprint helper ACCEPTS a realmId param (to hash it) but must not
    // return or persist it — only the hex digest.
    const fp = readFileSync(join(ROOT, 'src/services/quickbooks/quickbooksCompanyFingerprint.ts'), 'utf8')
    expect(fp).toMatch(/return hashNonce/)
  })

  it('the mapping surface makes no QBO accounting API call', () => {
    // Mapping is Supabase CRUD + a pure hash only. No Intuit API path, no
    // create/update/delete operation, no fetch to the accounting base.
    const files = [
      'src/services/quickbooks/quickbooksCustomerMappingStore.ts',
      'src/services/quickbooks/quickbooksCompanyFingerprint.ts',
      'netlify/functions/quickbooks/qboCustomerMappingRepo.ts',
    ].map((p) => join(ROOT, p))
    for (const f of files) {
      const src = readFileSync(f, 'utf8')
      const code = src.replace(/\/\/.*$/gm, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ')
      expect(code, `${f} must not call the QBO accounting API`).not.toMatch(/v3\/company/i)
      expect(code, `${f} must not call the QBO accounting API`).not.toMatch(/quickbooks\.api\.intuit\.com|QBO_API_BASE/i)
      expect(code, `${f} must not perform a QBO create/update/delete`).not.toMatch(/operation\s*=\s*(create|update|delete|void)/i)
    }
  })

  it('the mapping store imports no Supabase / node:crypto / network module', () => {
    // The pure store must stay database-agnostic (the adapter owns Supabase).
    const store = readFileSync(join(ROOT, 'src/services/quickbooks/quickbooksCustomerMappingStore.ts'), 'utf8')
    const importLines = store.match(/^import[\s\S]*?from\s+['"][^'"]+['"]/gm) ?? []
    for (const line of importLines) {
      expect(line).not.toMatch(/@supabase|node:crypto|node:https|node:http|fetch/i)
    }
  })
})

describe('QBO-4A.3 firewall — customer endpoints are identity/link plumbing only (52)', () => {
  const ENDPOINT_FILES = [
    'netlify/functions/quickbooks/qboCustomerAuth.ts',
    'netlify/functions/quickbooks/qbo-customer-search.ts',
    'netlify/functions/quickbooks/qbo-customer-mapping.ts',
    'netlify/functions/quickbooks/qbo-customer-link.ts',
    'netlify/functions/quickbooks/qbo-customer-create.ts',
    'netlify/functions/quickbooks/qbo-customer-unlink.ts',
  ].map((p) => join(ROOT, p))

  const FINANCIAL_TABLES = [
    'invoice_drafts',
    'service_logs',
    'service_calls',
    'call_logs',
    'historical_payments',
    'weekly',
    'kpi',
    'referral',
  ]

  it('no customer endpoint references a financial-authority table', () => {
    for (const f of ENDPOINT_FILES) {
      const src = readFileSync(f, 'utf8')
      const code = src.replace(/\/\/.*$/gm, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ')
      for (const t of FINANCIAL_TABLES) {
        expect(code, `${f} must not reference ${t}`).not.toMatch(new RegExp(`\\b${t}\\b`, 'i'))
      }
    }
  })

  it('customer endpoints delegate mapping CRUD to the repo (no inline mapping-table .from()) — auth reads only profiles', () => {
    for (const f of ENDPOINT_FILES) {
      const src = readFileSync(f, 'utf8')
      const code = src.replace(/\/\/.*$/gm, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ')
      const froms = [...code.matchAll(/\.from\(['"]([^'"]+)['"]\)/g)].map((m) => m[1])
      if (f.includes('qboCustomerAuth.ts')) {
        // The auth bootstrap reads ONLY the profiles table (RLS org/role resolution).
        expect(froms.sort()).toEqual(['profiles'])
      } else {
        // Endpoints never touch the mapping table inline — they go through the repo.
        expect(froms).toEqual([])
        expect(code).not.toMatch(/\.from\(['"]quickbooks_customer_mappings['"]\)/)
      }
    }
  })

  it('search is read-only: GET only, no mapping write, no QBO create', () => {
    const search = readFileSync(join(ROOT, 'netlify/functions/quickbooks/qbo-customer-search.ts'), 'utf8')
    const code = search.replace(/\/\/.*$/gm, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ')
    expect(code).toMatch(/httpMethod !== 'GET'/)
    expect(code).not.toMatch(/createCustomer|insertMapping|createCustomerMapping|deactivateMapping/)
  })

  it('create only creates a QBO Customer + mapping (POST customer + insert mapping)', () => {
    const create = readFileSync(join(ROOT, 'netlify/functions/quickbooks/qbo-customer-create.ts'), 'utf8')
    const code = create.replace(/\/\/.*$/gm, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ')
    expect(code).toMatch(/createCustomerWithBearer/)
    expect(code).toMatch(/createCustomerMapping/)
    // The create endpoint never deletes a QBO customer or mapping row.
    expect(code).not.toMatch(/deactivateMapping|unlinkCustomerMapping|DELETE|delete/i)
  })

  it('link only writes the mapping (insert), after a QBO read (GET customer)', () => {
    const link = readFileSync(join(ROOT, 'netlify/functions/quickbooks/qbo-customer-link.ts'), 'utf8')
    const code = link.replace(/\/\/.*$/gm, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ')
    expect(code).toMatch(/readCustomerWithBearer/)
    expect(code).toMatch(/createCustomerMapping/)
    // Link never creates a QBO customer and never deletes.
    expect(code).not.toMatch(/createCustomerWithBearer|deactivateMapping/i)
  })

  it('unlink only updates mapping history (deactivate), never deletes a row or QBO customer', () => {
    const unlink = readFileSync(join(ROOT, 'netlify/functions/quickbooks/qbo-customer-unlink.ts'), 'utf8')
    const code = unlink.replace(/\/\/.*$/gm, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ')
    expect(code).toMatch(/unlinkCustomerMapping/)
    // Unlink never creates/reads a QBO customer and never hard-deletes.
    expect(code).not.toMatch(/createCustomerWithBearer|readCustomerWithBearer|\.delete\(\)/i)
  })

  it('no customer endpoint returns realmId / fingerprint / tokens / SyncToken', () => {
    // The response shapes come from sanitizeCustomerMapping + explicit safe objects.
    // Assert the response bodies never serialize the secret scope fields.
    for (const f of ENDPOINT_FILES) {
      const src = readFileSync(f, 'utf8')
      const code = src.replace(/\/\/.*$/gm, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ')
      expect(code, `${f} must not return realmId`).not.toMatch(/JSON\.stringify\([^)]*realmId/i)
      expect(code, `${f} must not return fingerprint`).not.toMatch(/JSON\.stringify\([^)]*fingerprint/i)
      expect(code, `${f} must not return accessToken`).not.toMatch(/JSON\.stringify\([^)]*accessToken/i)
      expect(code, `${f} must not return SyncToken`).not.toMatch(/SyncToken/)
    }
  })

  it('no customer endpoint imports a financial-authority or billing-draft module', () => {
    const FORBIDDEN = /billing-draft|billingDraft|canonicalCash|collectedRevenue|serviceBalance|unpaidServiceEligibility|financialTimeline|cashFlowAnalyzer|invoiceDraft|kpiTimeline|quickbooksImportService|servicePaymentLedger|businessGoalTruth/i
    for (const f of ENDPOINT_FILES) {
      const src = readFileSync(f, 'utf8')
      const importLines = src.match(/^import[\s\S]*?from\s+['"][^'"]+['"]/gm) ?? []
      for (const line of importLines) {
        expect(line, `${f} must not import a financial-authority module`).not.toMatch(FORBIDDEN)
      }
    }
  })

  it('the accounting client + create-input pure modules import no financial authority', () => {
    const pureModules = [
      'src/services/quickbooks/qboAccountingClient.ts',
      'src/services/quickbooks/qboCustomerCreateInput.ts',
      'src/services/quickbooks/qboCustomerContract.ts',
    ].map((p) => join(ROOT, p))
    const FORBIDDEN = /billing-draft|canonicalCash|collectedRevenue|serviceBalance|unpaidServiceEligibility|financialTimeline|cashFlowAnalyzer|invoiceDraft|kpiTimeline|servicePaymentLedger|businessGoalTruth/i
    for (const p of pureModules) {
      const src = readFileSync(p, 'utf8')
      const importLines = src.match(/^import[\s\S]*?from\s+['"][^'"]+['"]/gm) ?? []
      for (const line of importLines) {
        expect(line, `${p} must not import a financial-authority module`).not.toMatch(FORBIDDEN)
      }
    }
  })
})