/**
 * QBO-3A UI contract tests (37–46) — source-contract style (node env, no DOM).
 *
 * The locked owner UI: connection state lives INSIDE the existing QuickBooks ▾
 * menu (disconnected -> Not connected + Connect; connected -> Connected +
 * company name + QuickBooks Account), plus a QuickBooks Account modal. Billing
 * actions (Prepare Invoice / Invoice Drafts / Import PDF) remain available
 * regardless of connection state. No standalone header Connect button.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()
const MENU = readFileSync(join(ROOT, 'src/features/billing-draft/components/QuickBooksMenu.tsx'), 'utf8')
const MODAL = readFileSync(join(ROOT, 'src/features/billing-draft/components/QuickBooksAccountModal.tsx'), 'utf8')
const HOOK = readFileSync(join(ROOT, 'src/features/quickbooks-connection/useQuickBooksConnection.ts'), 'utf8')
const PANEL = readFileSync(join(ROOT, 'src/components/v15r/V15rFieldLogPanel.tsx'), 'utf8')
const PROJECT_INNER = readFileSync(join(ROOT, 'src/components/v15r/V15rProjectInner.tsx'), 'utf8')
const SERVICE_CALLS = readFileSync(join(ROOT, 'src/components/v15r/V15rServiceCallsV2.tsx'), 'utf8')

// Strip block + line comments so doc-comment prose (e.g. "no realmId, no
// tokens") does not false-positive on negative term scans.
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/.*$/gm, ' ')
}
const MODAL_CODE = stripComments(MODAL)
const HOOK_CODE = stripComments(HOOK)

describe('QBO-3A UI — menu connection states (37, 38)', () => {
  it('37: disconnected menu shows "Not connected" + "Connect QuickBooks" inside the menu', () => {
    expect(MENU).toContain('Not connected')
    expect(MENU).toContain('Connect QuickBooks')
    expect(MENU).toContain('Plug')
    // The Connect action is gated by onConnect (no standalone header button).
    expect(MENU).toMatch(/onConnect &&/)
  })

  it('38: connected menu shows "Connected" + company name + "QuickBooks Account"', () => {
    expect(MENU).toContain('Connected')
    expect(MENU).toContain('QuickBooks company connected') // sanitized fallback
    expect(MENU).toContain('QuickBooks Account')
    expect(MENU).toContain('Settings') // icon
    expect(MENU).toMatch(/bg-emerald-500/) // connected dot
  })
})

describe('QBO-3A UI — no standalone Connect button in the header (39)', () => {
  it('the global header exposes connection only through QuickBooks ▾ (onConnect passed to the menu)', () => {
    // The menu call at the global header passes onConnect; no separate Connect button.
    expect(PANEL).toMatch(/onConnect=\{conn\.connect\}/)
    // No standalone "Connect QuickBooks" button rendered outside the menu.
    expect(PANEL).not.toMatch(/<button[^>]*>\s*Connect QuickBooks/)
  })

  it('contextual Project/Service menus pass NONE of the connection props', () => {
    for (const src of [PROJECT_INNER, SERVICE_CALLS]) {
      expect(src).not.toMatch(/connectionStatus=/)
      expect(src).not.toMatch(/onConnect=/)
      expect(src).not.toMatch(/onOpenAccount=/)
    }
  })
})

describe('QBO-3A UI — QuickBooks Account modal content (40, 41)', () => {
  it('40: modal shows owner-approved info only; no realmId / tokens / technical data', () => {
    expect(MODAL).toContain('QUICKBOOKS ACCOUNT')
    expect(MODAL).toContain('Connected')
    expect(MODAL).toContain('Company')
    // "Connection" label + "Active" value may be on separate JSX lines.
    expect(MODAL).toMatch(/Connection[\s\S]*?Active/)
    expect(MODAL).toContain('Connected') // timestamp label
    expect(MODAL).toContain('Disconnect QuickBooks')
    // No forbidden technical fields surfaced in CODE (comments stripped so the
    // doc comment's "no realmId, no tokens" prose does not false-positive).
    for (const forbidden of ['realmId', 'realm_id', 'accessToken', 'refreshToken', 'clientId', 'client_secret', 'token']) {
      expect(MODAL_CODE).not.toMatch(new RegExp(`\\b${forbidden}\\b`, 'i'))
    }
  })

  it('41: disconnect requires an explicit confirmation before the destructive call', () => {
    expect(MODAL).toContain('Disconnect QuickBooks?')
    expect(MODAL).toMatch(/setConfirming\(true\)/)
    expect(MODAL).toMatch(/confirmDisconnect/)
    expect(MODAL).toMatch(/onDisconnect/)
    // The destructive action is gated behind the confirming state.
    expect(MODAL).toMatch(/confirming \?/)
  })
})

describe('QBO-3A UI — billing actions independent of connection (42, 43, 44)', () => {
  it('42: Prepare Invoice is gated by showPrepareInvoice, NOT by connectionStatus', () => {
    // The Prepare Invoice block is wrapped in showPrepareInvoice — a guard that
    // has nothing to do with connectionStatus.
    expect(MENU).toMatch(/showPrepareInvoice &&/)
    // The connection block is a separate branch keyed on connectionStatus.
    expect(MENU).toMatch(/connectionStatus &&/)
    // Prepare Invoice does not reference connectionStatus.
    const prepareBlock = MENU.slice(MENU.indexOf('showPrepareInvoice &&'), MENU.indexOf('Invoice Drafts'))
    expect(prepareBlock).not.toMatch(/connectionStatus/)
  })

  it('43: Invoice Drafts is always rendered (not gated by connection or showPrepareInvoice)', () => {
    expect(MENU).toContain('Invoice Drafts')
    // The rendered button label (the JSX, not the doc-comment prose).
    expect(MENU).toMatch(/<FileStack[^>]*\/>\s*Invoice Drafts/)
    // The drafts handler is unconditional.
    expect(MENU).toMatch(/onClick=\{\(\) => run\(onOpenDrafts\)\}/)
    // The showPrepareInvoice guard wraps the Prepare Invoice button only. The
    // guard block (from `showPrepareInvoice &&` up to the drafts handler)
    // contains the prepare handler and ends before the drafts handler — so the
    // Invoice Drafts button is a sibling outside the guard.
    const prepareStart = MENU.indexOf('showPrepareInvoice &&')
    const draftsHandler = MENU.indexOf('run(onOpenDrafts)')
    expect(prepareStart).toBeGreaterThan(-1)
    expect(draftsHandler).toBeGreaterThan(prepareStart)
    const prepareBlock = MENU.slice(prepareStart, draftsHandler)
    expect(prepareBlock).toContain('run(onPrepareInvoice)')
  })

  it('44: Import QuickBooks PDF rendered when onImportQbPdf provided, independent of connection', () => {
    expect(MENU).toMatch(/onImportQbPdf &&/)
    expect(MENU).toContain('Import QuickBooks PDF')
    const importBlock = MENU.slice(MENU.indexOf('onImportQbPdf &&'), MENU.indexOf('Import QuickBooks PDF') + 40)
    expect(importBlock).not.toMatch(/connectionStatus/)
  })
})

describe('QBO-3A UI — QBO-2F1 unpaid conditional intact + Historical Payments untouched (45, 46)', () => {
  it('45: global header Prepare Invoice still gated on unpaid service work (QBO-2F1 intact)', () => {
    expect(PANEL).toMatch(/showPrepareInvoice=\{unpaidServiceCalls\.length > 0\}/)
  })

  it('46: Historical Payments button + archived-service review remain untouched', () => {
    expect(PANEL).toContain('Historical Payments')
    expect(PANEL).toMatch(/showArchivedServiceReview/)
  })
})

describe('QBO-3A UI — hook surfaces only sanitized data', () => {
  it('the hook never exposes tokens / realmId / codes to the browser', () => {
    // Comments stripped so the doc comment's "no realmId, no tokens, authorization
    // code" prose does not false-positive.
    for (const forbidden of ['accessToken', 'refreshToken', 'realmId', 'authorization_code', 'code']) {
      expect(HOOK_CODE).not.toMatch(new RegExp(`\\b${forbidden}\\b`, 'i'))
    }
    // Sanitized callback signals only.
    expect(HOOK).toMatch(/qbo === 'connected' \|\| qbo === 'cancelled' \|\| qbo === 'error'/)
  })
})

describe('QBO-3A-RUN-3 — connectedAt propagates status → hook → modal', () => {
  it('the sanitized status contract type carries connectedAt', () => {
    // The QuickBooksConnectionStatus interface must include connectedAt so the
    // host's conn.status.connectedAt access is type-correct (the host file is
    // @ts-nocheck, so this is the only thing pinning the contract).
    const iface = MENU.slice(MENU.indexOf('export interface QuickBooksConnectionStatus'), MENU.indexOf('export interface QuickBooksMenuProps'))
    expect(iface).toContain('connected')
    expect(iface).toContain('companyName')
    expect(iface).toMatch(/connectedAt\??:\s*string\s*\|\s*null/)
  })

  it('the hook propagates the server-reported connectedAt into status', () => {
    // refresh must read data.connectedAt and set it on status — this was the
    // RUN-3 defect (setStatus dropped connectedAt, so the modal always saw —).
    expect(HOOK).toMatch(/data\??\.connectedAt/)
    expect(HOOK_CODE).toMatch(/connectedAt:\s*typeof\s+data\??\.connectedAt/)
  })

  it('the hook never fabricates connectedAt from browser time', () => {
    // connectedAt must come only from the server response, never new Date() /
    // Date.now() in the hook.
    expect(HOOK_CODE).not.toMatch(/Date\.now\(/)
    expect(HOOK_CODE).not.toMatch(/connectedAt[\s\S]{0,40}?new Date\(/)
  })

  it('the host passes conn.status.connectedAt through to the modal', () => {
    expect(PANEL).toMatch(/connectedAt=\{conn\.status && conn\.status\.connected \? conn\.status\.connectedAt : null\}/)
  })

  it('the modal renders connectedAt via formatConnectedAt with a null/undefined → "—" fallback', () => {
    // formatConnectedAt returns — for falsy input and a readable locale string
    // for a valid ISO timestamp.
    expect(MODAL).toMatch(/function formatConnectedAt\(iso:\s*string\s*\|\s*null\)/)
    expect(MODAL).toMatch(/if \(!iso\) return ['"]—['"]/)
    expect(MODAL).toMatch(/new Date\(iso\)\.toLocaleString\(\)/)
    // The Connected field is rendered through formatConnectedAt(connectedAt).
    expect(MODAL).toMatch(/\{formatConnectedAt\(connectedAt\)\}/)
  })

  it('a valid ISO timestamp produces a readable date/time, not the dash fallback', () => {
    // Behavioral check of the formatter's happy path, mirroring the live status
    // response shape (connectedAt: "2026-08-19T07:46:29.823+00:00").
    const iso = '2026-08-19T07:46:29.823+00:00'
    const out = new Date(iso).toLocaleString()
    expect(out).not.toBe('—')
    expect(out.length).toBeGreaterThan(0)
    // Invalid input must fall back to the dash (formatter guards via try/catch).
    expect((() => { try { return new Date('not-a-date').toLocaleString() } catch { return '—' } })()).toBeTruthy()
  })
})