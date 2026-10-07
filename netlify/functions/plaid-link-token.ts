// @ts-nocheck
/**
 * netlify/functions/plaid-link-token.ts
 * Thin top-level entry. Netlify does not route nested files, so this registers /.netlify/functions/plaid-link-token and delegates to
 * the handler in ./bank/plaid-link-token (same ESM named re-export pattern as the QuickBooks entries). No logic lives here.
 */
export { handler } from './bank/plaid-link-token'
