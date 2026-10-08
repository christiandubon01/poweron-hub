/**
 * src/features/bank-connection/plaidLink.ts
 *
 * Browser boundary for Plaid Link. The browser receives ONLY a short-lived Link token (from our authenticated server
 * function) and, after the owner finishes Link, a one-time public token that is handed straight to the server for exchange.
 *
 * The browser NEVER sees the Plaid secret, an access token, an encrypted credential or the service key. The public token is
 * passed to the success callback and nowhere else: it is not stored in state, localStorage, sessionStorage or logs.
 *
 * Plaid's script must be loaded directly from cdn.plaid.com (per Plaid's web integration docs); no npm package is added.
 */
const PLAID_LINK_SCRIPT = 'https://cdn.plaid.com/link/v2/stable/link-initialize.js'

interface PlaidHandler { open: () => void; exit: (options?: { force?: boolean }) => void; destroy: () => void }
interface PlaidGlobal { create: (config: Record<string, unknown>) => PlaidHandler }
declare global { interface Window { Plaid?: PlaidGlobal } }

let loading: Promise<PlaidGlobal> | null = null

export function loadPlaidLink(): Promise<PlaidGlobal> {
  if (typeof window === 'undefined') return Promise.reject(new Error('Plaid Link requires a browser.'))
  if (window.Plaid) return Promise.resolve(window.Plaid)
  if (loading) return loading
  loading = new Promise<PlaidGlobal>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = PLAID_LINK_SCRIPT
    script.async = true
    script.onload = () => (window.Plaid ? resolve(window.Plaid) : reject(new Error('Plaid Link did not initialize.')))
    script.onerror = () => { loading = null; reject(new Error('Plaid Link could not be loaded.')) }
    document.head.appendChild(script)
  })
  return loading
}

/**
 * OAuth banks (e.g. Wells Fargo in Production) send the owner away to sign in and then back to the registered redirect URI with `?oauth_state_id=`.
 * Plaid requires Link to be re-opened with the SAME link token and the full returned URL. Only the short-lived LINK token (never a public or
 * access token, and nothing that can read bank data) is kept, in this tab's sessionStorage, for at most 30 minutes, and removed as soon as it is used.
 */
const OAUTH_KEY = 'poweron.plaid.oauth.link'
const OAUTH_MAX_AGE_MS = 30 * 60 * 1000
export interface PendingOauth { linkToken: string; mode: 'new' | 'update'; itemId: string | null }

export function rememberLinkToken(pending: PendingOauth, now = Date.now()): void {
  try { window.sessionStorage.setItem(OAUTH_KEY, JSON.stringify({ ...pending, at: now })) } catch { /* storage may be blocked: non-OAuth banks do not need it */ }
}
export function clearPendingOauth(): void {
  try { window.sessionStorage.removeItem(OAUTH_KEY) } catch { /* ignore */ }
}
/** Returns the stored session only when this page load IS an OAuth return and the stored token is still fresh. */
export function readPendingOauth(search: string = typeof window === 'undefined' ? '' : window.location.search, now = Date.now()): PendingOauth | null {
  if (!/[?&]oauth_state_id=/.test(search)) return null
  try {
    const raw = window.sessionStorage.getItem(OAUTH_KEY)
    if (!raw) return null
    const v = JSON.parse(raw) as Partial<PendingOauth> & { at?: number }
    if (typeof v.linkToken !== 'string' || !v.linkToken || typeof v.at !== 'number' || now - v.at > OAUTH_MAX_AGE_MS || now < v.at) { clearPendingOauth(); return null }
    return { linkToken: v.linkToken, mode: v.mode === 'update' ? 'update' : 'new', itemId: typeof v.itemId === 'string' ? v.itemId : null }
  } catch { clearPendingOauth(); return null }
}

/** Opens Link. `onSuccess` receives the one-time public token and must forward it immediately; nothing here retains it. */
export async function openPlaidLink(options: { linkToken: string; receivedRedirectUri?: string; onSuccess: (publicToken: string) => void | Promise<void>; onExit: () => void }): Promise<void> {
  const Plaid = await loadPlaidLink()
  const handler = Plaid.create({
    token: options.linkToken,
    ...(options.receivedRedirectUri ? { receivedRedirectUri: options.receivedRedirectUri } : {}),
    onSuccess: (publicToken: string) => { void options.onSuccess(publicToken); handler.destroy() },
    onExit: () => { options.onExit(); handler.destroy() },
  })
  handler.open()
}
