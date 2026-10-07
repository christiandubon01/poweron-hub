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

/** Opens Link. `onSuccess` receives the one-time public token and must forward it immediately; nothing here retains it. */
export async function openPlaidLink(options: { linkToken: string; onSuccess: (publicToken: string) => void | Promise<void>; onExit: () => void }): Promise<void> {
  const Plaid = await loadPlaidLink()
  const handler = Plaid.create({
    token: options.linkToken,
    onSuccess: (publicToken: string) => { void options.onSuccess(publicToken); handler.destroy() },
    onExit: () => { options.onExit(); handler.destroy() },
  })
  handler.open()
}
