// @ts-nocheck
/**
 * netlify/functions/plaid-sync.ts
 * Thin top-level entry. Netlify does not route nested files, so this registers /.netlify/functions/plaid-sync and delegates to
 * the handler in ./bank/plaid-sync (same ESM named re-export pattern as the other bank entries). No logic lives here.
 */
export { handler } from './bank/plaid-sync'
