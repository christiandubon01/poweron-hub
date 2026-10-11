// @ts-nocheck
/**
 * netlify/functions/plaid-balances.ts
 * Thin top-level entry (same pattern as the other bank entries). No logic lives here. The handler refuses everything unless PLAID_BALANCES_ENABLED=true.
 */
export { handler } from './bank/plaid-balances'
