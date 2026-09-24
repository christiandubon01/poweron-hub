/**
 * ATB-4B: pre-provider launch contract (pure).
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { evaluateLaunchContract } from './launchContract.ts';
import { parseTaskControlSpec } from './supervisorPort.ts';

function spec(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    control: {
      provider: 'claude',
      requestedModel: null,
      permissionProfile: 'task-implementer',
      prompt: 'Do the work.',
      timeoutMs: 600_000,
    },
    policy: { authorizedWritePaths: ['src/a.ts'] },
    workingDirectory: 'C:\\repo',
    plan: { clientTaskKey: 'impl', role: 'implementer', plannedAreas: ['src'] },
    ...overrides,
  };
}

function check(
  raw: Record<string, unknown>,
  extras: Omit<Parameters<typeof evaluateLaunchContract>[0], 'parsed' | 'rawSpec'> = {},
) {
  return evaluateLaunchContract({
    parsed: parseTaskControlSpec(raw),
    rawSpec: raw,
    availableProviders: extras.availableProviders,
    supportedModels: extras.supportedModels,
  });
}

test('ATB-4B: architect/implementer/verifier contracts', () => {
  assert.equal(check(spec()).ok, true);

  const verifier = check(spec({
    control: { provider: 'claude', requestedModel: null, permissionProfile: 'verifier', prompt: 'Verify.', timeoutMs: 600_000 },
    policy: { authorizedWritePaths: [] },
    plan: { clientTaskKey: 'v', role: 'verifier' },
  }));
  assert.equal(verifier.ok, true);

  const architect = check(spec({
    control: { provider: 'claude', requestedModel: null, permissionProfile: 'read-only-reviewer', prompt: 'Plan.', timeoutMs: 600_000 },
    policy: { authorizedWritePaths: [] },
    plan: { clientTaskKey: 'a', role: 'architect' },
  }));
  assert.equal(architect.ok, true);
});

test('ATB-4B: implementer write-scope and verifier no-write', () => {
  const missing = check(spec({ policy: { authorizedWritePaths: [] } }));
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.equal(missing.code, 'IMPLEMENTER_WRITE_SCOPE_MISSING');

  const writes = check(spec({
    control: { provider: 'claude', requestedModel: null, permissionProfile: 'verifier', prompt: 'V.', timeoutMs: 600_000 },
    policy: { authorizedWritePaths: ['src/a.ts'] },
    plan: { clientTaskKey: 'v', role: 'verifier' },
  }));
  assert.equal(writes.ok, false);
  if (!writes.ok) assert.equal(writes.code, 'VERIFIER_MUST_BE_READ_ONLY');

  const mismatch = check(spec({
    control: { provider: 'claude', requestedModel: null, permissionProfile: 'verifier', prompt: 'V.', timeoutMs: 600_000 },
    policy: { authorizedWritePaths: [] },
    plan: { clientTaskKey: 'impl', role: 'implementer' },
  }));
  assert.equal(mismatch.ok, false);
  if (!mismatch.ok) assert.equal(mismatch.code, 'ROLE_PROFILE_MISMATCH');
});

test('ATB-4B: provider / model / effort capability', () => {
  const unavailable = check(spec(), { availableProviders: new Set(['codex']) });
  assert.equal(unavailable.ok, false);
  if (!unavailable.ok) assert.equal(unavailable.code, 'PROVIDER_UNAVAILABLE');

  const effort = check(spec({
    control: { provider: 'ollama', requestedModel: 'llama3', permissionProfile: 'task-implementer', prompt: 'Do.', timeoutMs: 600_000, reasoningEffort: 'high' },
  }), { availableProviders: new Set(['ollama']) });
  assert.equal(effort.ok, false);
  if (!effort.ok) assert.equal(effort.code, 'EFFORT_UNSUPPORTED');

  const model = check(spec({
    control: { provider: 'codex', requestedModel: 'nope', permissionProfile: 'task-implementer', prompt: 'Do.', timeoutMs: 600_000 },
  }), { availableProviders: new Set(['codex']), supportedModels: new Set(['gpt-5.6']) });
  assert.equal(model.ok, false);
  if (!model.ok) assert.equal(model.code, 'MODEL_UNSUPPORTED');

  const honestUnknownModel = check(spec({
    control: { provider: 'claude', requestedModel: 'claude-opus-5', permissionProfile: 'task-implementer', prompt: 'Do.', timeoutMs: 600_000 },
  }), { availableProviders: new Set(['claude']) });
  assert.equal(honestUnknownModel.ok, true, 'Claude has no model enumeration; Host must not invent a deny');
});
