// @ts-nocheck
/**
 * netlify/functions/plaid-connection-status.ts
 * Thin top-level entry. Netlify does not route nested files, so this registers /.netlify/functions/plaid-connection-status and delegates to
 * the handler in ./bank/plaid-connection-status (same ESM named re-export pattern as the QuickBooks entries). No logic lives here.
 */
export { handler } from './bank/plaid-connection-status'
