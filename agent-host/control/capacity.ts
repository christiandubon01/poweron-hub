/**
 * CT-LIVE-0A task-spec storage envelope.
 *
 * TEXT_FIELD_MAX_BYTES (8192) remains the cap for run goals, event payloads,
 * and other diagnostic records. Task specs are the execution contract, so
 * they use a separate ceiling derived from:
 *   - the accepted create_plan compact-JSON envelope
 *   - the Architect field limits already enforced by validatePlan
 *   - the maximum Scope Pack inheritance contract
 *   - JSON string escaping (a quote or control character can double)
 *   - a fixed object skeleton for keys, paths, and the working directory
 *
 * This is a storage envelope. It is not a provider context window.
 */

import { CREATE_PLAN_MAX_PAYLOAD_BYTES } from '../../src/features/control-tower/capacity.ts';
import { scopePackInheritanceMaxBytes } from './scopePack.ts';
import { PLAN_FIELD_LIMITS } from './types.ts';

export { CREATE_PLAN_MAX_PAYLOAD_BYTES };

/** Static sentences in the synthesized task prompt, outside owner/plan fields. */
export const TASK_SPEC_TEMPLATE_ALLOWANCE_BYTES = 4_096;

/** Keys, working directory, provider ids, and scope-pack identifiers around the prompt. */
export const TASK_SPEC_OBJECT_SKELETON_MAX_BYTES = 8_192;

/**
 * JSON.stringify turns `"` and `\` into two characters and control characters
 * into `\u00XX`. Two is the upper bound for accepted text.
 */
export const TASK_SPEC_JSON_ESCAPE_FACTOR = 2;

export const PLAN_TASK_PROMPT_FIXED_MAX_BYTES =
  PLAN_FIELD_LIMITS.goalMaxChars
  + PLAN_FIELD_LIMITS.maxValidationRequirements * PLAN_FIELD_LIMITS.validationRequirementMaxChars
  + PLAN_FIELD_LIMITS.maxConstraints * PLAN_FIELD_LIMITS.constraintMaxChars
  + PLAN_FIELD_LIMITS.maxAuthorizedWritePaths * PLAN_FIELD_LIMITS.pathMaxChars
  + PLAN_FIELD_LIMITS.maxPlannedAreas * PLAN_FIELD_LIMITS.pathMaxChars
  + TASK_SPEC_TEMPLATE_ALLOWANCE_BYTES;

export const TASK_SPEC_PROMPT_MAX_BYTES =
  CREATE_PLAN_MAX_PAYLOAD_BYTES
  + PLAN_TASK_PROMPT_FIXED_MAX_BYTES
  + scopePackInheritanceMaxBytes();

export const TASK_SPEC_MAX_BYTES =
  TASK_SPEC_PROMPT_MAX_BYTES * TASK_SPEC_JSON_ESCAPE_FACTOR
  + TASK_SPEC_OBJECT_SKELETON_MAX_BYTES;
