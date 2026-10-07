// @ts-nocheck
/**
 * netlify/functions/plaid-disconnect.ts
 * Thin top-level entry. Netlify does not route nested files, so this registers /.netlify/functions/plaid-disconnect and delegates to
 * the handler in ./bank/plaid-disconnect (same ESM named re-export pattern as the QuickBooks entries). No logic lives here.
 */
export { handler } from './bank/plaid-disconnect'
