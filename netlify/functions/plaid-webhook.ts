// @ts-nocheck
/**
 * netlify/functions/plaid-webhook.ts
 * Thin top-level entry. Netlify does not route nested files, so this registers /.netlify/functions/plaid-webhook and delegates to
 * the handler in ./bank/plaid-webhook (same ESM named re-export pattern as the other bank entries). No logic lives here.
 */
export { handler } from './bank/plaid-webhook'
