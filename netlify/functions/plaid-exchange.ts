// @ts-nocheck
/**
 * netlify/functions/plaid-exchange.ts
 * Thin top-level entry. Netlify does not route nested files, so this registers /.netlify/functions/plaid-exchange and delegates to
 * the handler in ./bank/plaid-exchange (same ESM named re-export pattern as the QuickBooks entries). No logic lives here.
 */
export { handler } from './bank/plaid-exchange'
