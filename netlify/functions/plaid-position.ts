// @ts-nocheck
/**
 * netlify/functions/plaid-position.ts
 * Thin top-level entry (same pattern as the other bank entries). No logic lives here. The handler answers { enabled: false } unless CASH_OS_POSITION_ENABLED=true.
 */
export { handler } from './bank/plaid-position'
