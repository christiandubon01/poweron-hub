import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ARCHITECT_INSTRUCTION_ALLOWANCE_BYTES,
  CREATE_PLAN_MAX_PAYLOAD_BYTES,
  CREATE_PLAN_STORAGE_MAX_BYTES,
} from '../../src/features/control-tower/capacity.ts';
import { TEXT_FIELD_MAX_BYTES } from '../lib/orchestrationTypes.ts';
import { TASK_SPEC_MAX_BYTES } from './capacity.ts';
import { IMPORT_SCOPE_PACK_MAX_PAYLOAD_BYTES } from './scopePack.ts';
import { buildArchitectPrompt, buildTaskPrompt, parseCreatePlanPayload } from './planning.ts';
import { ROLE_TO_PERMISSION_PROFILE, type ControlPlan } from './types.ts';

test('create_plan envelope matches the control-request storage ceiling minus jsonb spacing', () => {
  assert.equal(CREATE_PLAN_STORAGE_MAX_BYTES, 192 * 1024);
  assert.equal(CREATE_PLAN_STORAGE_MAX_BYTES, IMPORT_SCOPE_PACK_MAX_PAYLOAD_BYTES);
  assert.ok(CREATE_PLAN_MAX_PAYLOAD_BYTES < CREATE_PLAN_STORAGE_MAX_BYTES);
  assert.ok(CREATE_PLAN_MAX_PAYLOAD_BYTES > 8_192);
  assert.ok(TASK_SPEC_MAX_BYTES > TEXT_FIELD_MAX_BYTES);
  assert.ok(TASK_SPEC_MAX_BYTES > CREATE_PLAN_MAX_PAYLOAD_BYTES);
});

test('create_plan accepts prompts below and above 8000 characters and preserves markers', () => {
  const small = parseCreatePlanPayload({ scope: 'Create a file.', constraints: ['Do not commit.'] });
  assert.equal(small.ok, true);
  if (!small.ok) return;
  assert.equal(small.payload.scope, 'Create a file.');
  assert.deepEqual(small.payload.constraints, ['Do not commit.']);

  const over = `BEGIN-MARKER\n${'A'.repeat(9_000)}\nMIDDLE-MARKER\nEND-MARKER`;
  const parsed = parseCreatePlanPayload({
    scope: over,
    constraints: ['Keep both markers.', 'Do not push.'],
    scopePackId: 'pack-1',
    scopePackVersion: 2,
    scopePackPhaseId: 'phase-a',
  });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.payload.scope, over);
  assert.ok(parsed.payload.scope.includes('BEGIN-MARKER'));
  assert.ok(parsed.payload.scope.includes('MIDDLE-MARKER'));
  assert.ok(parsed.payload.scope.includes('END-MARKER'));
  assert.deepEqual(parsed.payload.constraints, ['Keep both markers.', 'Do not push.']);
  assert.equal(parsed.payload.scopePackId, 'pack-1');
  assert.equal(parsed.payload.scopePackVersion, 2);
  assert.equal(parsed.payload.scopePackPhaseId, 'phase-a');
  const prompt = buildArchitectPrompt(parsed.payload);
  assert.ok(prompt.includes('BEGIN-MARKER'));
  assert.ok(prompt.includes('MIDDLE-MARKER'));
  assert.ok(prompt.includes('END-MARKER'));
  assert.equal(prompt.includes(over.slice(0, 20)), true);
  assert.equal(over.length, prompt.split('BEGIN-MARKER').length > 1 ? over.length : 0);
});

test('create_plan measures UTF-8 bytes and rejects an oversized payload without truncating', () => {
  const multibyte = `BEGIN-MARKER\n${'你'.repeat(3_000)}\nEND-MARKER`;
  assert.ok(multibyte.length < 8_000);
  assert.ok(Buffer.byteLength(multibyte, 'utf8') > multibyte.length);
  const accepted = parseCreatePlanPayload({ scope: multibyte, constraints: ['bêta constraint'] });
  assert.equal(accepted.ok, true);
  if (!accepted.ok) return;
  assert.equal(accepted.payload.scope, multibyte);
  assert.deepEqual(accepted.payload.constraints, ['bêta constraint']);

  const huge = '你'.repeat(80_000);
  assert.ok(huge.length < CREATE_PLAN_MAX_PAYLOAD_BYTES);
  const rejected = parseCreatePlanPayload({ scope: huge, constraints: [] });
  assert.equal(rejected.ok, false);
  if (rejected.ok) return;
  assert.equal(rejected.code, 'PAYLOAD_TOO_LARGE');
  assert.match(rejected.message, /UTF-8 bytes/);
  assert.match(rejected.message, /safety envelope/);
  assert.equal(rejected.message.includes(huge), false);
});

test('a substantially larger prompt still fits the task-spec envelope exactly', () => {
  const scope = `BEGIN-MARKER\n${'A'.repeat(40_000)}\nMIDDLE-MARKER\n${'你'.repeat(20)}\nEND-MARKER`;
  const parsed = parseCreatePlanPayload({ scope, constraints: ['constraint-exact'] });
  assert.equal(parsed.ok, true);
  const plan: ControlPlan = {
    planId: 'plan-large',
    objective: 'Interpret the owner scope.',
    constraints: ['constraint-exact'],
    riskSummary: null,
    ownerScope: scope,
    tasks: [
      {
        clientTaskKey: 'implement-the-change',
        title: 'Implement',
        goal: 'Apply the owner scope.',
        role: 'implementer',
        dependencies: [],
        permissionProfile: ROLE_TO_PERMISSION_PROFILE.implementer,
        authorizedWritePaths: ['agent-host/smoke/example.txt'],
        plannedAreas: ['agent-host/smoke'],
        validationRequirements: ['acceptance-exact'],
        provider: 'claude',
        requestedModel: null,
      },
    ],
  };
  const prompt = buildTaskPrompt(plan.tasks[0], plan);
  assert.ok(prompt.startsWith('You are the Implementer') || prompt.includes('BEGIN-MARKER'));
  assert.ok(prompt.includes('BEGIN-MARKER'));
  assert.ok(prompt.includes('MIDDLE-MARKER'));
  assert.ok(prompt.includes('END-MARKER'));
  assert.ok(prompt.includes('你'.repeat(20)));
  assert.ok(prompt.includes('acceptance-exact'));
  assert.ok(prompt.includes('constraint-exact'));
  assert.ok(Buffer.byteLength(prompt, 'utf8') > 8_192);
  assert.ok(Buffer.byteLength(prompt, 'utf8') < TASK_SPEC_MAX_BYTES);
});

test('architect instruction allowance stays near the real empty prompt', () => {
  const empty = buildArchitectPrompt({ scope: '', constraints: [], requestedRouting: null });
  const bytes = Buffer.byteLength(empty, 'utf8');
  assert.ok(Math.abs(bytes - ARCHITECT_INSTRUCTION_ALLOWANCE_BYTES) < 800, `template is ${bytes} bytes`);
});
