// @ts-nocheck
/**
 * netlify/functions/qbo-connection-status.ts
 *
 * Thin top-level Netlify Function entry point for the sanitized QuickBooks
 * connection STATUS read used by the browser menu.
 *
 * ROOT CAUSE (QBO-3A-RUN-2): Netlify's function discovery does NOT route arbitrary
 * nested files as /.netlify/functions/quickbooks/<file>; the nested
 * quickbooks/qbo-connection-status.ts never registered as a route, so the
 * browser's GET /.netlify/functions/quickbooks/qbo-connection-status returned a
 * 0ms 404 at the Netlify routing layer. This top-level entry registers
 *   /.netlify/functions/qbo-connection-status
 * and delegates to the existing secure handler in ./quickbooks/qbo-connection-status.
 *
 * ESM named re-export (matches the proven calendar.ts pattern). NO authentication,
 * owner/admin gate, sanitized-status shaping, or service-role read logic is
 * duplicated here — the single authority remains
 * netlify/functions/quickbooks/qbo-connection-status.ts.
 */
export { handler } from './quickbooks/qbo-connection-status'