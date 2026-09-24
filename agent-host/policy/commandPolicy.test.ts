/**
 * ATB-4B: Host command classifier (pure, no processes).
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { classifyHostCommand } from './commandPolicy.ts';

test('ATB-4B: safe read-only and validation commands are allowed', () => {
  for (const argv of [
    ['git', 'status'],
    ['git', 'diff'],
    ['rg', 'TODO'],
    ['ls'],
    ['npm', 'run', 'test'],
    ['npm', 'test'],
    ['pnpm', 'run', 'typecheck'],
    ['yarn', 'build'],
    ['node', '--test'],
  ]) {
    const result = classifyHostCommand(argv);
    assert.equal(result.decision.decision, 'allow', argv.join(' '));
    assert.ok(result.classification === 'READ_ONLY' || result.classification === 'VALIDATION', argv.join(' '));
  }
});

test('ATB-4B: dependency mutations require a human gate', () => {
  for (const argv of [['npm', 'install'], ['pnpm', 'add', 'left-pad'], ['yarn', 'update'], ['bun', 'uninstall', 'x']]) {
    const result = classifyHostCommand(argv);
    assert.equal(result.classification, 'DEP_MUTATION', argv.join(' '));
    assert.equal(result.decision.decision, 'require-human', argv.join(' '));
    assert.equal(result.decision.reasonCode, 'dependency-mutation', argv.join(' '));
  }
});

test('ATB-4B: database, deploy, destructive git, history rewrite, and unknown classify safely', () => {
  const db = classifyHostCommand(['supabase', 'migration', 'up']);
  assert.equal(db.classification, 'DB_MUTATION');
  assert.equal(db.decision.decision, 'require-human');

  const deploy = classifyHostCommand(['netlify', 'deploy']);
  assert.equal(deploy.classification, 'DEPLOY');
  assert.equal(deploy.decision.decision, 'require-human');

  const destructive = classifyHostCommand(['git', 'reset', '--hard']);
  assert.equal(destructive.classification, 'GIT_DESTRUCTIVE');
  assert.equal(destructive.decision.decision, 'deny');

  const amend = classifyHostCommand(['git', 'commit', '--amend']);
  assert.equal(amend.classification, 'HISTORY_REWRITE');
  assert.equal(amend.decision.decision, 'deny');

  const forcePush = classifyHostCommand(['git', 'push', '--force']);
  assert.equal(forcePush.classification, 'HISTORY_REWRITE');
  assert.equal(forcePush.decision.decision, 'deny');

  const unknown = classifyHostCommand(['mystery-bin', '--explode']);
  assert.equal(unknown.classification, 'UNKNOWN');
  assert.equal(unknown.decision.decision, 'require-human');
});
