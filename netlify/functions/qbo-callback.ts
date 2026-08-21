// @ts-nocheck
/**
 * netlify/functions/qbo-callback.ts
 *
 * Thin top-level Netlify Function entry point for the QuickBooks OAuth redirect
 * callback.
 *
 * ROOT CAUSE (QBO-3A-RUN-2): Netlify's function discovery does NOT route arbitrary
 * nested files as /.netlify/functions/quickbooks/<file>; the nested
 * quickbooks/qbo-callback.ts never registered as a route. This top-level entry
 * registers the Intuit redirect target
 *   /.netlify/functions/qbo-callback
 * and delegates to the existing secure handler in ./quickbooks/qbo-callback.
 *
 * ESM named re-export (matches the proven calendar.ts pattern). NO state
 * validation, code exchange, token encryption, connection upsert, or
 * redirect-sanitization logic is duplicated here — the single authority remains
 * netlify/functions/quickbooks/qbo-callback.ts.
 */
export { handler } from './quickbooks/qbo-callback'