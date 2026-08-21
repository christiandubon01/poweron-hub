// @ts-nocheck
/**
 * netlify/functions/qbo-customer-search.ts
 *
 * Top-level Netlify entry for the QBO customer search endpoint. Netlify does not
 * route nested files under netlify/functions/quickbooks/, so a thin top-level
 * re-export registers /.netlify/functions/qbo-customer-search (QBO-3A-RUN-2 pattern).
 */
export { handler } from './quickbooks/qbo-customer-search'