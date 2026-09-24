/**
 * ATB-4B: classified Host command runner. Fake spawn only — no real commands.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { executeHostCommand } from './hostCommandRunner.ts';

test('ATB-4B: allowed command launches exactly once', async () => {
  let launches = 0;
  const result = await executeHostCommand(['npm', 'run', 'test'], {
    run: async () => {
      launches += 1;
    },
  });
  assert.equal(result.status, 'executed');
  assert.equal(result.launches, 1);
  assert.equal(launches, 1);
  assert.equal(result.signalCategory, null);
});

test('ATB-4B: deny and require-human prevent process launch', async () => {
  let launches = 0;
  const run = async () => {
    launches += 1;
  };

  const denied = await executeHostCommand(['git', 'reset', '--hard'], { run });
  assert.equal(denied.status, 'denied');
  assert.equal(denied.launches, 0);
  assert.equal(denied.signalCategory, 'policy-gate');

  const gated = await executeHostCommand(['npm', 'install'], { run });
  assert.equal(gated.status, 'gated');
  assert.equal(gated.launches, 0);
  assert.equal(gated.ownerActionRequired, true);
  assert.equal(gated.signalCategory, 'dependency-mutation');

  const db = await executeHostCommand(['supabase', 'db', 'reset'], { run });
  assert.equal(db.status, 'gated');
  assert.equal(db.signalCategory, 'db-mutation');

  const unknown = await executeHostCommand(['totally-unknown'], { run });
  assert.equal(unknown.status, 'gated');
  assert.equal(unknown.signalCategory, 'unknown-command');

  assert.equal(launches, 0);
});

test('ATB-4B: classifier exception fail-closes without launching', async () => {
  const result = await executeHostCommand(null as unknown as string[]);
  assert.equal(result.status, 'failed-closed');
  assert.equal(result.launches, 0);
});
