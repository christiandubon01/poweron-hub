/**
 * src/services/quickbooks/quickbooksCallback.ts
 *
 * Reusable QuickBooks OAuth callback parsing/validation.
 *
 * Order of checks:
 *  1. Provider denial / error → sanitized application error
 *  2. Missing state → fail
 *  3. Invalid / expired / unsigned state → fail
 *  4. Missing authorization code → fail
 *  5. Missing realmId → fail
 *
 * The realmId returned by Intuit is the QuickBooks company id. It is recorded
 * as metadata only and NEVER selects a PowerOn organization — PowerOn org
 * identity comes exclusively from the validated signed state. Does not perform
 * token exchange or persistent connection completion.
 */
import { verifyState } from './quickbooksState'
import type { QboStateVerifyReason } from './quickbooksState'
import type { QboCallbackInput, QboErrorCategory, QboStateContext } from './quickbooksTypes'

export interface QboCallbackValidation {
  ok: boolean
  context?: QboStateContext
  /** Signed-state nonce, recovered server-side to look up the single-use row. */
  nonce?: string
  code?: string
  realmId?: string
  error?: { category: QboErrorCategory; message: string }
}

const STATE_REASON_TO_CATEGORY: Record<QboStateVerifyReason, QboErrorCategory> = {
  malformed: 'invalid_state',
  invalid_signature: 'invalid_state',
  expired: 'expired_state',
  missing_context: 'missing_context',
}

export function validateCallback(
  input: QboCallbackInput,
  stateSecret: string,
  options?: { now?: number },
): QboCallbackValidation {
  if (input.error) {
    return { ok: false, error: { category: 'provider_denied', message: 'QuickBooks denied the connection request.' } }
  }
  if (!input.state) {
    return { ok: false, error: { category: 'missing_state', message: 'Missing OAuth state.' } }
  }
  const verified = verifyState(input.state, stateSecret, options)
  if (!verified.ok) {
    return {
      ok: false,
      error: {
        category: STATE_REASON_TO_CATEGORY[verified.reason],
        message: 'OAuth state validation failed.',
      },
    }
  }
  if (!input.code) {
    return { ok: false, error: { category: 'missing_code', message: 'Missing authorization code.' } }
  }
  if (!input.realmId) {
    return { ok: false, error: { category: 'missing_realm_id', message: 'Missing QuickBooks realm id.' } }
  }
  return { ok: true, context: verified.context, nonce: verified.nonce, code: input.code, realmId: input.realmId }
}