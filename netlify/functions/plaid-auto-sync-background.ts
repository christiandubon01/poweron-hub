// @ts-nocheck
/**
 * netlify/functions/plaid-auto-sync-background.ts
 * Thin top-level entry. The "-background" suffix makes Netlify run it asynchronously (up to 15 minutes) and answer 202 at once; Netlify does not route
 * nested files, so this registers /.netlify/functions/plaid-auto-sync-background and delegates to ./bank/plaid-auto-sync-background. No logic lives here.
 */
export { handler } from './bank/plaid-auto-sync-background'
