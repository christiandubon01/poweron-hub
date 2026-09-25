/**
 * CT-LIVE-0A create_plan transport envelope.
 *
 * agent_control_requests.payload is jsonb. Scope Pack imports already refuse
 * more than 192 KiB of jsonb text on that same column. create_plan uses the
 * same storage ceiling. This is a transport/storage safety envelope, not a
 * provider context window.
 *
 * Postgres jsonb text inserts a space after ':' and ','. The application
 * measures compact JSON UTF-8 and stays 256 bytes under the storage ceiling
 * so an accepted payload still fits the database check.
 */

export const CREATE_PLAN_STORAGE_MAX_BYTES = 192 * 1024

export const CREATE_PLAN_JSONB_SPACING_RESERVE_BYTES = 256

/** Compact JSON UTF-8 limit enforced in the browser and on the Host. */
export const CREATE_PLAN_MAX_PAYLOAD_BYTES =
  CREATE_PLAN_STORAGE_MAX_BYTES - CREATE_PLAN_JSONB_SPACING_RESERVE_BYTES

/**
 * Approximate size of the Architect instruction text that wraps the owner
 * scope. The displayed token count is an estimate, not a provider budget.
 */
export const ARCHITECT_INSTRUCTION_ALLOWANCE_BYTES = 3_187

export function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).length
}

export function createPlanPayloadBytes(payload: unknown): number {
  try {
    return utf8ByteLength(JSON.stringify(payload))
  } catch {
    return Number.POSITIVE_INFINITY
  }
}

/** ~4 UTF-8 bytes per token. Always an approximation. */
export function approximateTokenCount(text: string): number {
  return Math.ceil(utf8ByteLength(text) / 4)
}

export function estimateArchitectContextTokens(scope: string, constraints: readonly string[]): number {
  return approximateTokenCount(`${scope}\n${constraints.join('\n')}`) + Math.ceil(ARCHITECT_INSTRUCTION_ALLOWANCE_BYTES / 4)
}

export function assertPersistableCreatePlanPayload(payload: unknown):
  | { ok: true }
  | { ok: false; message: string } {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return { ok: false, message: 'create_plan payload must be a JSON object.' }
  }
  const bytes = createPlanPayloadBytes(payload)
  if (bytes > CREATE_PLAN_MAX_PAYLOAD_BYTES) {
    return {
      ok: false,
      message: `create_plan payload is ${bytes} UTF-8 bytes and exceeds the ${CREATE_PLAN_MAX_PAYLOAD_BYTES}-byte safety envelope.`,
    }
  }
  return { ok: true }
}
