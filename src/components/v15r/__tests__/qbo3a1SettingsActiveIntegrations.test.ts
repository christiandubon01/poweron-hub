/**
 * QBO-3A1 — Settings "Active Integrations" wiring (source-contract, node env).
 *
 * The live QuickBooks connection is now wired into the Settings Active
 * Integrations card, REUSING the SAME QBO-3A connection authority
 * (useQuickBooksConnection) and the SAME QuickBooksAccountModal — no second
 * connection-state fetcher, no direct Intuit/Supabase connection-table access,
 * no financial writes. QuickBooks Batch Import stays a separate capability.
 *
 * V15rSettingsPanel.tsx is `// @ts-nocheck`, so these source-contract scans are
 * the only thing pinning the wiring (mirrors the V15rFieldLogPanel approach).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()
const PANEL = readFileSync(join(ROOT, 'src/components/v15r/V15rSettingsPanel.tsx'), 'utf8')

// Strip block + line comments so doc-comment prose (e.g. "no realmId, no
// tokens", "no second connection-state fetcher") does not false-positive on
// negative term scans.
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/.*$/gm, ' ')
}
const PANEL_CODE = stripComments(PANEL)

// The LIVE Active Integrations card is wrapped in `{showActiveIntegrations && (`
// and ends before the next `{false && (` dead block. All obsolete placeholder
// JSX still exists in dead `{false && ...}` blocks below — those must NOT be
// scanned, so the live region is sliced to the first `showActiveIntegrations &&`
// up to the following `{false &&`.
const LIVE_START = PANEL.indexOf('showActiveIntegrations &&')
const LIVE_FALSE = PANEL.indexOf('{false &&', LIVE_START)
const LIVE = PANEL.slice(LIVE_START, LIVE_FALSE === -1 ? undefined : LIVE_FALSE)
const LIVE_CODE = stripComments(LIVE)

describe('QBO-3A1 — Settings reuses the SAME QBO-3A connection authority', () => {
  it('imports the existing useQuickBooksConnection hook (no second fetcher defined locally)', () => {
    expect(PANEL).toMatch(/from ['"]@\/features\/quickbooks-connection\/useQuickBooksConnection['"]/)
    // The panel does NOT define its own connection-status fetch / state machine.
    expect(PANEL_CODE).not.toMatch(/function use[A-Za-z]*QuickBooks/)
    expect(PANEL_CODE).not.toMatch(/const \[[a-zA-Z]+, set[A-Za-z]+\] = useState<QuickBooksConnectionStatus/)
  })

  it('instantiates the hook once and derives qboConnected from its sanitized status', () => {
    expect(PANEL).toMatch(/const qbo = useQuickBooksConnection\(\)/)
    expect(PANEL).toMatch(/const qboConnected = !!qbo\.status\?\.connected/)
  })

  it('reuses the existing QuickBooksAccountModal + formatConnectedAt from billing-draft', () => {
    expect(PANEL).toMatch(/from ['"]@\/features\/billing-draft\/components\/QuickBooksAccountModal['"]/)
    expect(PANEL).toMatch(/QuickBooksAccountModal, formatConnectedAt/)
    // The modal is rendered in the live Active Integrations region, driven by qbo.
    expect(LIVE).toMatch(/<QuickBooksAccountModal/)
    expect(LIVE).toMatch(/open=\{qbo\.accountOpen\}/)
    expect(LIVE).toMatch(/onClose=\{qbo\.closeAccount\}/)
    expect(LIVE).toMatch(/onDisconnect=\{qbo\.disconnect\}/)
    expect(LIVE).toMatch(/disconnecting=\{qbo\.disconnecting\}/)
    expect(LIVE).toMatch(/disconnectError=\{qbo\.disconnectError\}/)
    expect(LIVE).toMatch(/connectedAt=\{qbo\.status\?\.connectedAt \?\? null\}/)
  })
})

describe('QBO-3A1 — obsolete placeholder state removed from the LIVE card', () => {
  it('the live QuickBooks Integration card has no "Coming soon" / "Coming in V3" placeholder', () => {
    expect(LIVE_CODE).not.toMatch(/Coming soon/i)
    expect(LIVE_CODE).not.toMatch(/Coming in V3/i)
    // No disabled placeholder Connect button in the live card.
    expect(LIVE_CODE).not.toMatch(/Connect QuickBooks — Coming in V3/)
  })

  it('the live card no longer describes unbuilt sync features as already shipping', () => {
    // The old copy promised "automatically sync invoices and estimates". The new
    // disconnected copy must not claim invoices/estimates/payments are syncing.
    expect(LIVE_CODE).not.toMatch(/automatically sync invoices and estimates/i)
    expect(LIVE_CODE).not.toMatch(/invoices are syncing/i)
    expect(LIVE_CODE).not.toMatch(/payments are syncing/i)
    expect(LIVE_CODE).not.toMatch(/estimates are syncing/i)
    expect(LIVE_CODE).not.toMatch(/reconciliation is active/i)
  })
})

describe('QBO-3A1 — disconnected card', () => {
  it('shows a "Not connected" pill and a "Connect QuickBooks" button wired to qbo.connect', () => {
    expect(LIVE).toContain('Connect QuickBooks')
    expect(LIVE).toMatch(/onClick=\{qbo\.connect\}/)
    // The connect button is gated by the in-flight connecting flag, not disabled
    // as a placeholder.
    expect(LIVE).toMatch(/disabled=\{qbo\.connecting\}/)
    expect(LIVE).toMatch(/\{qbo\.connecting \? ['"]Connecting\.\.\.['"] : ['"]Connect QuickBooks['"]\}/)
    // Gray "Not connected" pill branch exists.
    expect(LIVE).toMatch(/qboConnected \? ['"]Connected['"] : ['"]Not connected['"]/)
  })
})

describe('QBO-3A1 — connected card', () => {
  it('shows the sanitized company name with the approved fallback, "Connection active", and the connected timestamp', () => {
    expect(LIVE).toMatch(/qbo\.status\?\.companyName \|\| ['"]QuickBooks company connected['"]/)
    expect(LIVE).toContain('Connection active')
    // The connected timestamp is rendered via the shared formatConnectedAt, fed
    // only by the server-reported connectedAt — never fabricated locally.
    expect(LIVE).toMatch(/Connected \{formatConnectedAt\(qbo\.status\?\.connectedAt \?\? null\)\}/)
  })

  it('offers "QuickBooks Account" wired to qbo.openAccount (opens the SAME existing modal)', () => {
    expect(LIVE).toContain('QuickBooks Account')
    expect(LIVE).toMatch(/onClick=\{qbo\.openAccount\}/)
  })

  it('uses an emerald "Connected" pill when connected', () => {
    expect(LIVE).toMatch(/qboConnected \? ['"]Connected['"] : ['"]Not connected['"]/)
    expect(LIVE).toMatch(/border-emerald-400\/20 bg-emerald-400\/10 text-emerald-200/)
  })
})

describe('QBO-3A1 — QuickBooks Batch Import remains a SEPARATE, unchanged capability', () => {
  it('Batch Import is its own card, rendered via the same embedded component, NOT gated by qbo state', () => {
    expect(LIVE).toContain('QuickBooks Batch Import')
    expect(LIVE).toMatch(/<QuickBooksBatchImport persist=\{persist\} forceUpdate=\{forceUpdate\} embedded \/>/)
    // The Batch Import card text is unchanged.
    expect(LIVE).toContain('Extract invoice and estimate PDFs into PowerOn records.')
    // The Batch Import block does not reference the live connection hook.
    const batchStart = LIVE.indexOf('QuickBooks Batch Import')
    const batchBlock = LIVE.slice(batchStart, batchStart + 400)
    expect(batchBlock).not.toMatch(/qbo\./)
    expect(batchBlock).not.toMatch(/qboConnected/)
  })
})

describe('QBO-3A1 — Active Integrations summary uses REAL QBO connection state', () => {
  it('connectedIntegrations counts Anthropic (1) + Google Calendar + live QuickBooks', () => {
    // Anthropic stays a constant 1, Google Calendar unchanged, QuickBooks now
    // reflects the real sanitized connection state.
    expect(PANEL).toMatch(/const connectedIntegrations = 1 \+ \(settings\.gcalUrl \? 1 : 0\) \+ \(qboConnected \? 1 : 0\)/)
  })
})

describe('QBO-3A1 — no direct Intuit / Supabase connection-table / service-role access from Settings', () => {
  it('Settings never fetches Intuit endpoints, the connection tables, or uses service-role credentials', () => {
    // The panel consumes the sanitized hook; it must not reach Intuit, the
    // token-bearing Supabase tables, service-role keys, or the QBO Netlify
    // endpoints directly (the hook owns all of that).
    const forbidden = [
      'intuit.com',
      'oauth.platform.intuit',
      'quickbooks_connections',
      'quickbooks_oauth_states',
      'SUPABASE_SERVICE_ROLE',
      'service-role',
      'serviceRole',
    ]
    for (const term of forbidden) {
      expect(PANEL_CODE).not.toMatch(new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'))
    }
    // The panel must not call the QBO Netlify endpoints directly — only the hook does.
    expect(PANEL_CODE).not.toMatch(/\/\.netlify\/functions\/qbo-/)
    // No token / realmId / authorization-code references in the panel.
    for (const t of ['accessToken', 'refreshToken', 'realmId', 'authorization_code', 'client_secret', 'clientId']) {
      expect(PANEL_CODE).not.toMatch(new RegExp(`\\b${t}\\b`, 'i'))
    }
  })

  it('Settings performs no financial writes through the QBO wiring (no invoice/payment/estimate mutation)', () => {
    // The QBO wiring is connection UI only — it must not create/update invoices,
    // payments, or estimates.
    expect(PANEL_CODE).not.toMatch(/createInvoice|updateInvoice|sendInvoice|createPayment|createEstimate/i)
  })
})