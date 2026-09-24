/**
 * ATB-4: deterministic drift classifier unit tests (no git, no network).
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  classifyPathDrift,
  classifyUnplannedAreaDrift,
  isDatabaseMutationPath,
  isDependencyManifestPath,
  isPathWithinPlannedAreas,
} from './driftPolicy.ts';

test('ATB-4 classifier: dependency manifests are recognized regardless of directory', () => {
  assert.equal(isDependencyManifestPath('package.json'), true);
  assert.equal(isDependencyManifestPath('apps/web/package-lock.json'), true);
  assert.equal(isDependencyManifestPath('deno.lock'), true);
  assert.equal(isDependencyManifestPath('src/package.ts'), false);
});

test('ATB-4 classifier: migration and supabase SQL paths are database mutations', () => {
  assert.equal(isDatabaseMutationPath('supabase/migrations/135_agent_control_plane.sql'), true);
  assert.equal(isDatabaseMutationPath('prisma/migrations/20260101_init/migration.sql'), true);
  assert.equal(isDatabaseMutationPath('supabase/seed.sql'), true);
  assert.equal(isDatabaseMutationPath('supabase/.temp/cli-latest'), false);
  assert.equal(isDatabaseMutationPath('src/features/control-tower/a.ts'), false);
});

test('ATB-4 classifier: planned-area matching is prefix + case-insensitive', () => {
  assert.equal(isPathWithinPlannedAreas('src/features/foo/a.ts', ['src/features/foo']), true);
  assert.equal(isPathWithinPlannedAreas('src/features/foo', ['src/features/foo']), true);
  assert.equal(isPathWithinPlannedAreas('src/features/Foo/A.ts', ['src/features/foo']), true);
  assert.equal(isPathWithinPlannedAreas('src/features/bar/a.ts', ['src/features/foo']), false);
  assert.equal(isPathWithinPlannedAreas('src/features/foo/a.ts', []), false);
});

test('ATB-4 classifier: most-specific reserved drift class wins', () => {
  assert.equal(classifyPathDrift({ path: 'package.json', plannedAreas: [] })?.reasonCode, 'dependency-mutation');
  assert.equal(
    classifyPathDrift({ path: 'supabase/migrations/001.sql', plannedAreas: ['supabase/migrations/001.sql'] })?.reasonCode,
    'db-mutation',
  );
  assert.equal(
    classifyPathDrift({ path: 'supabase/migrations/001.sql', plannedAreas: ['src'] })?.reasonCode,
    'migration-outside-plan',
  );
  assert.equal(classifyPathDrift({ path: 'src/a.ts', plannedAreas: ['src'] }), null);
});

test('ATB-4 classifier: unplanned-area only fires when planned areas exist and miss', () => {
  assert.equal(classifyUnplannedAreaDrift({ path: 'src/b.ts', plannedAreas: [] }), null);
  assert.equal(classifyUnplannedAreaDrift({ path: 'src/b.ts', plannedAreas: ['src'] }), null);
  assert.equal(classifyUnplannedAreaDrift({ path: 'src/b.ts', plannedAreas: ['docs'] })?.reasonCode, 'unplanned-area');
});
