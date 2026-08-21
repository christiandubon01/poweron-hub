/**
 * QBO-1A1 focused tests — legacy QuickBooks client-secret cleanup + state-secret hardening.
 *
 * SEC-LEGACY-1..5 : no VITE_QUICKBOOKS_CLIENT_SECRET / import.meta.env secret in
 *                   browser code; legacy import feature preserved; sensitive
 *                   request server-side; no tokens in browser code.
 * SEC-STATE-1..4  : production requires INTUIT_OAUTH_STATE_SECRET; no silent
 *                   JWT_SECRET substitution in production; existing tamper/expiry/
 *                   binding tests remain green; report replay-within-TTL.
 * GUARD-1..4      : no referral file changed; no migration; package.json/deno.lock untouched.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { QuickBooksConfigError } from '../services/quickbooks/quickbooksTypes'
import { isQboProductionEnv, loadQuickBooksConfig } from '../services/quickbooks/quickbooksConfig'
import { signState, verifyState } from '../services/quickbooks/quickbooksState'

const ROOT = process.cwd()
const read = (p: string): string => readFileSync(join(ROOT, p), 'utf8')
const exists = (p: string): boolean => existsSync(join(ROOT, p))

/** Recursively list production .ts/.tsx source under a dir (excludes tests). */
function listProductionSource(dir: string, out: string[] = []): string[] {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    if (ent.isDirectory()) {
      if (ent.name === 'node_modules' || ent.name === '__tests__') continue
      listProductionSource(join(dir, ent.name), out)
    } else if (ent.isFile() && (ent.name.endsWith('.ts') || ent.name.endsWith('.tsx'))) {
      if (/\.test\.(ts|tsx)$/.test(ent.name)) continue
      out.push(join(dir, ent.name))
    }
  }
  return out
}

const SRC_PRODUCTION = listProductionSource(join(ROOT, 'src')).map((f) => readFileSync(f, 'utf8')).join('\n')

const BASE_ENV = {
  INTUIT_CLIENT_ID: 'test-client-id-placeholder',
  INTUIT_CLIENT_SECRET: 'test-client-secret-placeholder',
  INTUIT_REDIRECT_URI: 'https://app.example.test/.netlify/functions/qbo-callback',
}
const STATE_SECRET = 'dedicated-state-secret-placeholder'

describe('QBO-1A1 legacy client-secret cleanup', () => {
  it('SEC-LEGACY-1: repository client/browser code contains zero VITE_QUICKBOOKS_CLIENT_SECRET references', () => {
    expect(SRC_PRODUCTION).not.toContain('VITE_QUICKBOOKS_CLIENT_SECRET')
    expect(SRC_PRODUCTION).not.toContain('VITE_QUICKBOOKS_CLIENT_ID')
    // The example env template no longer documents the insecure pattern either.
    if (exists('.env.local.example')) {
      expect(read('.env.local.example')).not.toContain('VITE_QUICKBOOKS_CLIENT_SECRET')
    }
  })

  it('SEC-LEGACY-2: no Intuit/QuickBooks client secret is accessed through import.meta.env', () => {
    // Targeted: an import.meta.env read of a QuickBooks/Intuit SECRET. (The
    // Anthropic API key used for PDF extraction is a separate, non-QBO concern.)
    expect(SRC_PRODUCTION).not.match(/import\.meta\.env[^;\n]*(QUICKBOOKS|INTUIT)[A-Z_]*SECRET/i)
    // No VITE_-prefixed Intuit/QuickBooks secret read anywhere in browser code.
    expect(SRC_PRODUCTION).not.match(/VITE_[A-Z_]*QUICKBOOKS[A-Z_]*SECRET/i)
    expect(SRC_PRODUCTION).not.match(/VITE_[A-Z_]*INTUIT[A-Z_]*SECRET/i)
  })

  it('SEC-LEGACY-3: legacy QuickBooks import functionality remains available', () => {
    const svc = read('src/services/quickbooksImportService.ts')
    for (const exp of [
      'export function fileToBase64',
      'export async function extractFromPDF',
      'export function mapToServiceLog',
      'export function mapToProject',
      'export function logImport',
      'export async function processBatch',
      'export function parseQBOCSV',
      'export function mapQBORowsToServiceLogs',
    ]) {
      expect(svc).toContain(exp)
    }
    // The modal is still default-exported and still imported by its production callers.
    expect(read('src/components/v15r/QuickBooksImportModal.tsx')).toContain('export default function QuickBooksImportModal')
    expect(read('src/components/v15r/V15rFieldLogPanel.tsx')).toContain('QuickBooksImportModal')
    expect(read('src/components/v15r/V15rProjectsPanel.tsx')).toContain('QuickBooksImportModal')
  })

  it('SEC-LEGACY-4: any sensitive legacy QuickBooks request executes server-side (no client secret in browser)', () => {
    const svc = read('src/services/quickbooksImportService.ts')
    // The legacy import service performs no QuickBooks OAuth/API request and reads no client secret.
    expect(svc).not.toContain('INTUIT_CLIENT_SECRET')
    expect(svc).not.toMatch(/fetch\([^)]*quickbooks\.api\.intuit\.com/)
    expect(svc).not.toMatch(/fetch\([^)]*oauth\.platform\.intuit\.com/)
    // PDF extraction routes through the server-side Claude proxy.
    expect(svc).toContain("from './claudeProxy'")
    expect(svc).toContain('callClaude')
    const proxy = read('src/services/claudeProxy.ts')
    expect(proxy).toContain('.netlify/functions/claude')
  })

  it('SEC-LEGACY-5: no access/refresh token is exposed to browser code', () => {
    const svc = read('src/services/quickbooksImportService.ts')
    const modal = read('src/components/v15r/QuickBooksImportModal.tsx')
    for (const banned of ['access_token', 'refresh_token', 'INTUIT_CLIENT_SECRET', 'Authorization']) {
      expect(svc).not.toContain(banned)
      expect(modal).not.toContain(banned)
    }
  })
})

describe('QBO-1A1 state-secret hardening', () => {
  it('SEC-STATE-1: production configuration requires INTUIT_OAUTH_STATE_SECRET', () => {
    const prodEnv = { ...BASE_ENV, NODE_ENV: 'production', JWT_SECRET: 'jwt-fallback-secret' }
    expect(() => loadQuickBooksConfig(prodEnv)).toThrow(QuickBooksConfigError)
    try {
      loadQuickBooksConfig(prodEnv)
    } catch (err) {
      expect((err as QuickBooksConfigError).missingKey).toBe('INTUIT_OAUTH_STATE_SECRET')
    }
    // Same via Netlify CONTEXT=production.
    const ctxEnv = { ...BASE_ENV, CONTEXT: 'production', JWT_SECRET: 'jwt-fallback-secret' }
    expect(() => loadQuickBooksConfig(ctxEnv)).toThrow(QuickBooksConfigError)
    // And when the dedicated secret is present in production, it is used.
    const okProd = loadQuickBooksConfig({ ...BASE_ENV, NODE_ENV: 'production', INTUIT_OAUTH_STATE_SECRET: STATE_SECRET })
    expect(okProd.stateSecret).toBe(STATE_SECRET)
  })

  it('SEC-STATE-2: JWT_SECRET is not silently substituted for the QBO state secret in production', () => {
    // Production + only JWT_SECRET → throws (no silent substitution).
    expect(() => loadQuickBooksConfig({ ...BASE_ENV, NODE_ENV: 'production', JWT_SECRET: 'jwt-fallback-secret' })).toThrow()
    // Non-production + only JWT_SECRET → dev fallback IS allowed (explicit, non-prod).
    const devCfg = loadQuickBooksConfig({ ...BASE_ENV, NODE_ENV: 'development', JWT_SECRET: 'jwt-fallback-secret' })
    expect(devCfg.stateSecret).toBe('jwt-fallback-secret')
    // isQboProductionEnv agrees.
    expect(isQboProductionEnv({ NODE_ENV: 'production' })).toBe(true)
    expect(isQboProductionEnv({ CONTEXT: 'production' })).toBe(true)
    expect(isQboProductionEnv({ NODE_ENV: 'development' })).toBe(false)
    expect(isQboProductionEnv({})).toBe(false)
  })

  it('SEC-STATE-3: existing signed-state tamper / expiry / user-org binding remain green', () => {
    const ctx = { userId: 'user-1', orgId: 'org-1' }
    const { state } = signState(ctx, STATE_SECRET)
    // Tampering rejected.
    const [payload, sig] = state.split('.')
    expect(verifyState(`${payload}.${(sig[0] === 'A' ? 'B' : 'A') + sig.slice(1)}`, STATE_SECRET).ok).toBe(false)
    // Expiry rejected.
    const past = 1_700_000_000_000
    const expired = signState(ctx, STATE_SECRET, { now: past, ttlSeconds: 60 })
    expect(verifyState(expired.state, STATE_SECRET, { now: past + 120_000 })).toEqual({ ok: false, reason: 'expired' })
    // User/org binding preserved.
    const verified = verifyState(state, STATE_SECRET)
    expect(verified.ok).toBe(true)
    if (verified.ok) expect(verified.context).toEqual(ctx)
  })

  it('SEC-STATE-4: an otherwise-valid signed state CAN be replayed within its TTL (stateless — report, do not overbuild)', () => {
    const ctx = { userId: 'user-1', orgId: 'org-1' }
    const { state } = signState(ctx, STATE_SECRET, { ttlSeconds: 600 })
    const first = verifyState(state, STATE_SECRET)
    const second = verifyState(state, STATE_SECRET)
    // Both verifications succeed — the nonce is not consumed server-side.
    expect(first.ok).toBe(true)
    expect(second.ok).toBe(true)
    // Documented current behavior: replay is possible within TTL. The fix is a
    // QBO-1B requirement (single-use nonce via persistent connection storage),
    // NOT a QBO-1A1 change. No migration is created here.
  })
})

describe('QBO-1A1 guardrails', () => {
  it('GUARD-1: no referral-owned file references QuickBooks (referral logic untouched)', () => {
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

  it('GUARD-2: no Supabase migration was created by QBO-1A1', () => {
    const migrations = readdirSync(join(ROOT, 'supabase/migrations')).filter((f) => f.endsWith('.sql'))
    // The real invariant: QBO-1A1 created NO migration. The only QBO/QuickBooks/
    // The real invariant: QBO-1A1 created NO migration. The only QBO/QuickBooks/
    // Intuit-named migrations are the later QBO-3A connection migration
    // (132_quickbooks_connections_and_oauth_states.sql), the QBO-4A.2 customer-
    // mapping migration (133_quickbooks_customer_mappings.sql), and the QBO-4A.6
    // text-identity migration (134_quickbooks_customer_mapping_text_identity.sql)
    // — not QBO-1A1 work.
    // (A numeric ceiling pin is not used: concurrent referral work legitimately
    // advances the highest migration number — e.g. 130_referral_profiles.sql —
    // and that is not QBO-1A1 work.)
    const qboNamed = migrations.filter((f) => /qbo|quickbooks|intuit/i.test(f))
    expect(qboNamed).toEqual([
      '132_quickbooks_connections_and_oauth_states.sql',
      '133_quickbooks_customer_mappings.sql',
      '134_quickbooks_customer_mapping_text_identity.sql',
    ])
  })

  it('GUARD-3: package.json untouched by QBO-1A1 (no QuickBooks/Intuit dependency added)', () => {
    const pkg = read('package.json').toLowerCase()
    expect(pkg).not.toContain('intuit')
    expect(pkg).not.toMatch(/"(intuit|@intuit|quickbooks)[^"]*"\s*:\s*"\^?\d/)
  })

  it('GUARD-4: deno.lock untouched by QBO-1A1 (no Intuit entry added)', () => {
    if (exists('deno.lock')) {
      expect(read('deno.lock').toLowerCase()).not.toContain('intuit')
    }
  })
})