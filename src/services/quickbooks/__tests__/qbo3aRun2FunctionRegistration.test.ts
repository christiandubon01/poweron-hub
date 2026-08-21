/**
 * QBO-3A-RUN-2 focused source-contract tests — Netlify function registration fix.
 *
 * ROOT CAUSE: the QBO handlers lived under netlify/functions/quickbooks/ (a
 * subdirectory). Netlify does not route arbitrary nested files as
 * /.netlify/functions/quickbooks/<file>, so the browser hit a 0ms 404 at the
 * Netlify routing layer. The fix adds four THIN top-level entry points
 * (netlify/functions/qbo-*.ts) that delegate to the existing secure handlers,
 * and updates browser call sites to the registered top-level endpoints.
 *
 * These tests prove:
 *  - REG-1..4: the four top-level entry files exist and delegate (re-export
 *    `handler`) to the corresponding nested secure handler.
 *  - REG-5  : the entries introduce NO duplicate OAuth/state/encryption/
 *    persistence/authorization logic (pure re-export).
 *  - REG-6  : browser QBO URLs match the registered top-level function names.
 *  - REG-7  : no nested /.netlify/functions/quickbooks/... runtime URLs remain
 *    in browser production code.
 *  - REG-8  : the example env callback URI uses the registered top-level callback.
 *  - REG-9  : the nested secure handlers remain the authority and are proper ESM
 *    (export const handler) so esbuild wires the named export (the live-verified
 *    defect: CJS `exports.handler =` mixed with ESM `import` under type:module
 *    was stubbed to undefined).
 *  - REG-10 : no duplicate QBO security implementation was introduced.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()
const read = (p: string): string => readFileSync(join(ROOT, p), 'utf8')

/** Strip line + block comments for negative scans (keeps string literals). */
function stripComments(src: string): string {
  return src.replace(/\/\/.*$/gm, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ')
}

const ENTRIES = [
  { file: 'netlify/functions/qbo-authorize.ts', nested: './quickbooks/qbo-authorize' },
  { file: 'netlify/functions/qbo-callback.ts', nested: './quickbooks/qbo-callback' },
  { file: 'netlify/functions/qbo-connection-status.ts', nested: './quickbooks/qbo-connection-status' },
  { file: 'netlify/functions/qbo-disconnect.ts', nested: './quickbooks/qbo-disconnect' },
] as const

describe('QBO-3A-RUN-2 — top-level entries register & delegate (REG-1..4)', () => {
  for (const { file, nested } of ENTRIES) {
    it(`${file} exists and re-exports handler from ${nested}`, () => {
      const src = read(file)
      // Pure ESM named re-export — matches the proven calendar.ts pattern. This
      // form resolves statically under esbuild; the CJS `exports.handler =
      // require(...).handler` form did NOT (stubbed to undefined).
      expect(src).toMatch(new RegExp(`export\\s+\\{\\s*handler\\s*\\}\\s+from\\s+['"]${nested.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]`))
    })
  }
})

describe('QBO-3A-RUN-2 — entries add no duplicate logic (REG-5, REG-10)', () => {
  // Tokens that would indicate the entry reimplemented handler logic instead of
  // delegating. A pure re-export must contain none of these in code.
  const FORBIDDEN = [
    'createClient',
    'loadQuickBooksConfig',
    'buildAuthorizationUrl',
    'exchangeAuthorizationCode',
    'revokeTokensDetail',
    'encryptToken',
    'decryptToken',
    'loadQboTokenEncryptionKey',
    'createState',
    'consumeState',
    'upsertConnection',
    'loadConnection',
    'markDisconnected',
    'getSanitizedStatus',
    'isConnectionUsable',
    'fetchCompanyName',
    'validateCallback',
    'safeReturnPath',
    'INTUIT_CLIENT_ID',
    'INTUIT_CLIENT_SECRET',
    'INTUIT_REDIRECT_URI',
    'INTUIT_OAUTH_STATE_SECRET',
    'POWERON_QBO_TOKEN_ENCRYPTION_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
    'process.env',
    'auth.users',
    'from(\'profiles\'',
    'from("profiles"',
    'bearerToken',
    'verifyAuthenticatedUser',
  ]

  for (const { file } of ENTRIES) {
    it(`${file} contains no OAuth/security/persistence implementation`, () => {
      const code = stripComments(read(file))
      for (const tok of FORBIDDEN) {
        expect(code, `${file} must not contain ${tok}`).not.toContain(tok)
      }
    })
  }
})

describe('QBO-3A-RUN-2 — browser URLs match registered function names (REG-6)', () => {
  const hook = read('src/features/quickbooks-connection/useQuickBooksConnection.ts')

  it('status URL is the registered top-level endpoint', () => {
    expect(hook).toContain("const STATUS_URL = '/.netlify/functions/qbo-connection-status'")
  })
  it('authorize URL is the registered top-level endpoint', () => {
    expect(hook).toContain("const AUTHORIZE_URL = '/.netlify/functions/qbo-authorize'")
  })
  it('disconnect URL is the registered top-level endpoint', () => {
    expect(hook).toContain("const DISCONNECT_URL = '/.netlify/functions/qbo-disconnect'")
  })
})

describe('QBO-3A-RUN-2 — no nested runtime URLs in browser code (REG-7)', () => {
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

  it('no browser production source references /.netlify/functions/quickbooks/ as a runtime URL', () => {
    const files = listProductionSource(join(ROOT, 'src'))
    expect(files.length).toBeGreaterThan(0)
    for (const f of files) {
      const code = stripComments(readFileSync(f, 'utf8'))
      // The registered endpoints are top-level qbo-*; the nested path is never a
      // runtime URL in browser code (comments documenting the root cause are
      // stripped here).
      expect(code, `${f} must not call /.netlify/functions/quickbooks/`).not.toMatch(/['"`]\/\.netlify\/functions\/quickbooks\//)
    }
  })
})

describe('QBO-3A-RUN-2 — example env callback URI is the registered endpoint (REG-8)', () => {
  it('.env.local.example INTUIT_REDIRECT_URI uses the top-level qbo-callback', () => {
    const env = read('.env.local.example')
    // The VALUE line (not the explanatory comment) must target the registered
    // top-level callback, not the nested path.
    const valueLine = env.split(/\r?\n/).find((l) => l.startsWith('INTUIT_REDIRECT_URI='))
    expect(valueLine).toBeDefined()
    expect(valueLine).toMatch(/\/\.netlify\/functions\/qbo-callback$/)
    expect(valueLine).not.toMatch(/\/\.netlify\/functions\/quickbooks\//)
  })
})

describe('QBO-3A-RUN-2 — nested handlers remain the authority & are proper ESM (REG-9)', () => {
  const NESTED = [
    {
      file: 'netlify/functions/quickbooks/qbo-authorize.ts',
      markers: ['buildAuthorizationUrl', 'createState', 'Only owners and admins can connect QuickBooks'],
    },
    {
      file: 'netlify/functions/quickbooks/qbo-callback.ts',
      markers: ['exchangeAuthorizationCode', 'encryptToken', 'consumeState', 'upsertConnection'],
    },
    {
      file: 'netlify/functions/quickbooks/qbo-connection-status.ts',
      markers: ['getSanitizedStatus', 'Only owners and admins can view QuickBooks connection status'],
    },
    {
      file: 'netlify/functions/quickbooks/qbo-disconnect.ts',
      markers: ['revokeTokensDetail', 'decryptToken', 'markDisconnected', 'Only owners and admins can disconnect QuickBooks'],
    },
  ]

  for (const { file, markers } of NESTED) {
    it(`${file} is proper ESM (export const handler) and keeps its secure logic`, () => {
      const src = read(file)
      // The live-verified defect fix: CJS `exports.handler =` was stubbed to
      // undefined by esbuild under type:module; the ESM named export wires
      // correctly. Function body is otherwise unchanged.
      expect(src).toMatch(/export\s+const\s+handler\s*=\s*async\s*\(event\)\s*=>\s*\{/)
      expect(src).not.toMatch(/^\s*exports\.handler\s*=/m)
      for (const m of markers) {
        expect(src, `${file} must retain ${m}`).toContain(m)
      }
    })
  }
})