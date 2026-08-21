// @ts-nocheck
/**
 * Top-level Netlify entry for the QBO current-customer-mapping endpoint.
 * Registers /.netlify/functions/qbo-customer-mapping (QBO-3A-RUN-2 pattern).
 */
export { handler } from './quickbooks/qbo-customer-mapping'