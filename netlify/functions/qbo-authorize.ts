// @ts-nocheck
/**
 * netlify/functions/qbo-authorize.ts
 *
 * Thin top-level Netlify Function entry point for QuickBooks OAuth authorize.
 *
 * ROOT CAUSE (QBO-3A-RUN-2): Netlify's function discovery does NOT route arbitrary
 * nested files as /.netlify/functions/quickbooks/<file>. A subdirectory is exposed
 * as a single function only via an index.* entry. The real QBO handlers are
 * organized under netlify/functions/quickbooks/ (qbo-authorize.ts + qboRepos.ts)
 * for code organization, but those nested files never registered as routes, so the
 * browser's POST /.netlify/functions/quickbooks/qbo-authorize returned a 0ms 404
 * at the Netlify routing layer (the handler was never reached).
 *
 * This top-level entry registers the browser-facing endpoint
 *   /.netlify/functions/qbo-authorize
 * and delegates to the existing secure handler in ./quickbooks/qbo-authorize.
 *
 * ESM named re-export (matches the proven calendar.ts pattern) — the package is
 * "type":"module", and the CJS `exports.handler = require(...).handler` form does
 * not interop with lambda-local. No logic is duplicated here; the single authority
 * remains netlify/functions/quickbooks/qbo-authorize.ts.
 */
export { handler } from './quickbooks/qbo-authorize'