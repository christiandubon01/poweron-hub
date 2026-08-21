// @ts-nocheck
/**
 * netlify/functions/qbo-disconnect.ts
 *
 * Thin top-level Netlify Function entry point for disconnecting the org's
 * QuickBooks connection.
 *
 * ROOT CAUSE (QBO-3A-RUN-2): Netlify's function discovery does NOT route arbitrary
 * nested files as /.netlify/functions/quickbooks/<file>; the nested
 * quickbooks/qbo-disconnect.ts never registered as a route. This top-level entry
 * registers the browser-facing endpoint
 *   /.netlify/functions/qbo-disconnect
 * and delegates to the existing secure handler in ./quickbooks/qbo-disconnect.
 *
 * ESM named re-export (matches the proven calendar.ts pattern). NO authentication,
 * owner/admin gate, token decryption, Intuit revoke, or mark-disconnected logic is
 * duplicated here — the single authority remains
 * netlify/functions/quickbooks/qbo-disconnect.ts.
 */
export { handler } from './quickbooks/qbo-disconnect'