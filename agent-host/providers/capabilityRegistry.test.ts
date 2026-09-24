/**
 * ATB-2: Provider/Model capability registry + effort + usage tests.
 * Fixtures only — NO live model executions, NO network, NO real CLIs.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import type { ProviderDiscoveryRecord } from '../types.ts';
import { catalogProbeLaunch, enumerateLocalModels } from '../control/worker.ts';
import {
  aggregateUsage,
  buildProviderCapabilityRegistry,
  MAX_CODEX_CATALOG_MODELS,
  parseCodexModelCatalog,
  parseOllamaModelList,
  toSafeProviderFleet,
} from './capabilityRegistry.ts';
import {
  EFFORT_LEVELS,
  mapNormalizedEffort,
  supportedEffortLevels,
  isEffortLevel,
} from './effort.ts';

function record(overrides: Partial<ProviderDiscoveryRecord> & Pick<ProviderDiscoveryRecord, 'toolId'>): ProviderDiscoveryRecord {
  return {
    displayName: overrides.toolId,
    kind: 'provider',
    command: 'x',
    harnessKind: 'native-executable',
    installed: true,
    workerCapable: true,
    discoveredAt: '2026-09-22T00:00:00.000Z',
    resolvedPath: 'C:\\secret\\path\\to\\tool.exe',
    cliVersion: '1.0.0',
    ...overrides,
  } as ProviderDiscoveryRecord;
}

const FULL_DISCOVERY: ProviderDiscoveryRecord[] = [
  record({ toolId: 'claude-code', displayName: 'Claude Code', command: 'claude' }),
  record({ toolId: 'codex-cli', displayName: 'Codex CLI', command: 'codex' }),
  record({ toolId: 'ollama-cli', displayName: 'Ollama CLI', command: 'ollama' }),
  record({ toolId: 'cursor-agent', displayName: 'Cursor Agent', command: 'cursor-agent' }),
  record({ toolId: 'cursor-editor', displayName: 'Cursor Editor CLI', command: 'cursor', kind: 'diagnostic', workerCapable: false }),
];

const now = () => new Date('2026-09-22T12:00:00.000Z');

test('A: discovery maps to a capability entry per provider with correct kinds and logo keys', () => {
  const registry = buildProviderCapabilityRegistry({ discovery: FULL_DISCOVERY, now });
  const byId = new Map(registry.map((p) => [p.providerId, p]));

  assert.equal(registry.length, 5);
  assert.equal(byId.get('claude')!.providerLogoKey, 'claude');
  assert.equal(byId.get('codex')!.providerLogoKey, 'codex');
  assert.equal(byId.get('ollama')!.providerLogoKey, 'ollama');
  assert.equal(byId.get('claude')!.providerKind, 'provider');
  assert.equal(byId.get('claude')!.lastRefreshedAt, '2026-09-22T12:00:00.000Z');
});

test('B: an uninstalled provider is unavailable with no worker capability', () => {
  const registry = buildProviderCapabilityRegistry({
    discovery: [record({ toolId: 'codex-cli', installed: false, workerCapable: true, resolvedPath: undefined, cliVersion: undefined })],
    now,
  });
  const codex = registry[0];
  assert.equal(codex.installed, false);
  assert.equal(codex.available, false);
  assert.equal(codex.availabilitySource, 'unavailable');
  assert.equal(codex.workerCapable, false);
  assert.deepEqual(codex.supportedRoles, []);
});

test('C: cursor-editor is diagnostic only — never an execution provider', () => {
  const registry = buildProviderCapabilityRegistry({ discovery: FULL_DISCOVERY, now });
  const editor = registry.find((p) => p.providerId === 'cursor-editor')!;
  assert.equal(editor.providerKind, 'diagnostic');
  assert.equal(editor.available, false);
  assert.equal(editor.workerCapable, false);
  assert.deepEqual(editor.supportedRoles, []);
  assert.deepEqual(editor.models, []);
});

test('D: cursor-agent is not worker-capable without a real execution adapter', () => {
  const registry = buildProviderCapabilityRegistry({ discovery: FULL_DISCOVERY, now });
  const cursor = registry.find((p) => p.providerId === 'cursor-agent')!;
  // Discovery says installed+workerCapable, but no adapter is registered → not runnable.
  assert.equal(cursor.installed, true);
  assert.equal(cursor.workerCapable, false);
  assert.equal(cursor.available, false);
  assert.deepEqual(cursor.supportedRoles, []);
  assert.deepEqual(cursor.models, []);
});

test('E: Ollama local model enumeration maps to available local-runtime models', () => {
  const stdout = ['NAME              ID    SIZE', 'llama3:8b   abc   4.7 GB', 'qwen2.5:14b def   9.0 GB', ''].join('\n');
  const models = parseOllamaModelList(stdout);
  assert.deepEqual(models, ['llama3:8b', 'qwen2.5:14b']);

  const registry = buildProviderCapabilityRegistry({ discovery: FULL_DISCOVERY, enumeratedModels: { ollama: models }, now });
  const ollama = registry.find((p) => p.providerId === 'ollama')!;
  assert.equal(ollama.local, true);
  assert.equal(ollama.models.length, 2);
  assert.equal(ollama.models[0].availability, 'available');
  assert.equal(ollama.models[0].availabilitySource, 'local-runtime');
});

test('F: configured allowlist supplies models when enumeration is unsupported', () => {
  const registry = buildProviderCapabilityRegistry({ discovery: FULL_DISCOVERY, configuredModels: { codex: ['gpt-5.6'] }, now });
  const codex = registry.find((p) => p.providerId === 'codex')!;
  assert.equal(codex.models.length, 1);
  assert.equal(codex.models[0].modelId, 'gpt-5.6');
  assert.equal(codex.models[0].availability, 'configured-unverified');
  assert.equal(codex.models[0].availabilitySource, 'configured-allowlist');
});

test('G: observed execution evidence yields an available model with reported runtime model', () => {
  const registry = buildProviderCapabilityRegistry({ discovery: FULL_DISCOVERY, observedModels: { claude: ['claude-opus-5'] }, now });
  const claude = registry.find((p) => p.providerId === 'claude')!;
  const model = claude.models.find((m) => m.modelId === 'claude-opus-5')!;
  assert.equal(model.availabilitySource, 'execution-evidence');
  assert.equal(model.reportedRuntimeModel, 'claude-opus-5');
});

test('H: configured/requested model stays separate from reported runtime model', () => {
  const registry = buildProviderCapabilityRegistry({
    discovery: FULL_DISCOVERY,
    configuredModels: { codex: ['gpt-5.6'] },
    now,
  });
  const codex = registry.find((p) => p.providerId === 'codex')!;
  const model = codex.models[0];
  assert.equal(model.configuredModel, 'gpt-5.6');
  assert.equal(model.reportedRuntimeModel, null, 'no runtime evidence → reported stays null, never copied from configured');
});

test('I: normalized effort supported by Codex and Claude maps to CLI-proven native values', () => {
  assert.deepEqual(EFFORT_LEVELS, ['low', 'medium', 'high', 'extra-high']);
  // ATB-2B: codex debug models (0.153.4) proves a native "xhigh"; claude
  // --help (2.1.277) lists valid effort values low|medium|high|xhigh|max.
  assert.deepEqual(supportedEffortLevels('codex'), ['low', 'medium', 'high', 'extra-high']);
  assert.deepEqual(supportedEffortLevels('claude'), ['low', 'medium', 'high', 'extra-high']);
  const mapping = mapNormalizedEffort('codex', 'high');
  assert.equal(mapping.supported, true);
  assert.equal(mapping.supported && mapping.nativeValue, 'high');
  const extra = mapNormalizedEffort('codex', 'extra-high');
  assert.equal(extra.supported, true);
  assert.equal(extra.supported && extra.nativeValue, 'xhigh');
  const claudeExtra = mapNormalizedEffort('claude', 'extra-high');
  assert.equal(claudeExtra.supported, true);
  assert.equal(claudeExtra.supported && claudeExtra.nativeValue, 'xhigh');

  const registry = buildProviderCapabilityRegistry({ discovery: FULL_DISCOVERY, configuredModels: { codex: ['gpt-5.6'] }, now });
  const codexModel = registry.find((p) => p.providerId === 'codex')!.models[0];
  assert.deepEqual(codexModel.effortLevels, ['low', 'medium', 'high', 'extra-high']);
});

test('J: unsupported effort is rejected with a reason, never silently downgraded', () => {
  // Ollama exposes no genuine effort control for local models → nothing maps.
  const ollamaHigh = mapNormalizedEffort('ollama', 'high');
  assert.equal(ollamaHigh.supported, false);
  assert.ok(!ollamaHigh.supported && ollamaHigh.reason.includes('does not support reasoning-effort control'));
  assert.deepEqual(supportedEffortLevels('ollama'), []);

  const registry = buildProviderCapabilityRegistry({ discovery: FULL_DISCOVERY, observedModels: { ollama: ['qwen3:14b'] }, now });
  assert.deepEqual(registry.find((p) => p.providerId === 'ollama')!.models[0].effortLevels, []);
  assert.ok(isEffortLevel('high') && !isEffortLevel('ultra') && !isEffortLevel('xhigh'));
});

test('K: parseCodexModelCatalog reads codex debug models output (list-visible slugs only)', () => {
  const catalog = JSON.stringify({
    models: [
      { slug: 'gpt-6-astra', visibility: 'list', supported_reasoning_levels: [{ effort: 'low' }, { effort: 'xhigh' }] },
      { slug: 'gpt-5.6-sol', visibility: 'list' },
      { slug: 'gpt-reserve', visibility: 'hide' },
      { slug: 'gpt-5.6-terra', visibility: 'list' },
      { slug: 42, visibility: 'list' },
      { visibility: 'list' },
      'garbage',
    ],
  });
  assert.deepEqual(parseCodexModelCatalog(catalog), ['gpt-6-astra', 'gpt-5.6-sol', 'gpt-5.6-terra']);

  // Malformed output never throws and never fabricates models.
  assert.deepEqual(parseCodexModelCatalog('not json'), []);
  assert.deepEqual(parseCodexModelCatalog('{"models": "nope"}'), []);
  assert.deepEqual(parseCodexModelCatalog('{}'), []);
  assert.deepEqual(parseCodexModelCatalog(''), []);

  // The catalog is bounded so a huge/corrupt payload can never bloat the fleet.
  const huge = JSON.stringify({
    models: Array.from({ length: 100 }, (_, i) => ({ slug: `model-${i}`, visibility: 'list' })),
  });
  assert.equal(parseCodexModelCatalog(huge).length, MAX_CODEX_CATALOG_MODELS);
});

test('L: codex catalog enumeration maps to available provider-enumeration models', () => {
  const registry = buildProviderCapabilityRegistry({
    discovery: FULL_DISCOVERY,
    enumeratedModels: { codex: ['gpt-6-astra', 'gpt-5.6-sol'] },
    configuredModels: { codex: ['gpt-5.6-sol'] },
    now,
  });
  const codex = registry.find((p) => p.providerId === 'codex')!;
  assert.equal(codex.models.length, 2, 'enumerated entry wins over duplicate configured entry');
  assert.equal(codex.models[0].modelId, 'gpt-6-astra');
  assert.equal(codex.models[0].availability, 'available');
  assert.equal(codex.models[0].availabilitySource, 'provider-enumeration');
  assert.equal(codex.models[1].availabilitySource, 'provider-enumeration');
});

test('M: the safe fleet publishes no executable/filesystem paths or discovery internals', () => {
  const registry = buildProviderCapabilityRegistry({ discovery: FULL_DISCOVERY, enumeratedModels: { ollama: ['llama3:8b'] }, now });
  const safe = toSafeProviderFleet(registry);
  const serialized = JSON.stringify(safe);
  assert.ok(!serialized.includes('C:\\\\secret'), 'no resolved executable path');
  assert.ok(!serialized.includes('secret'), 'no path fragments');
  const first = safe[0] as unknown as Record<string, unknown>;
  assert.ok(!('resolvedPath' in first));
  assert.ok(!('command' in first));
  assert.ok(!('error' in first));
  // But it DOES carry the safe capability truth.
  assert.equal(safe.find((p) => p.providerId === 'ollama')!.models[0].modelId, 'llama3:8b');
});

test('N: usage aggregation sums execution tokens per provider/model with provenance', () => {
  const events = [
    { type: 'execution.completed', payload: { provider: 'codex', reportedModel: null, requestedModel: 'gpt-5.6', usage: { totalTokens: 100, source: 'protocol-message' } } },
    { type: 'execution.completed', payload: { provider: 'codex', requestedModel: 'gpt-5.6', usage: { totalTokens: 50, source: 'protocol-message' } } },
    { type: 'execution.failed', payload: { provider: 'claude', reportedModel: 'claude-opus-5', usage: { totalTokens: 20, source: 'protocol-message' } } },
    { type: 'workspace.changeset.ready', payload: { changeCount: 1 } }, // ignored
  ];
  const agg = aggregateUsage(events);
  const codex = agg.find((e) => e.providerId === 'codex')!;
  assert.equal(codex.totalTokens, 150);
  assert.equal(codex.executionCount, 2);
  assert.equal(codex.source, 'protocol-message');
  assert.equal(agg.find((e) => e.providerId === 'claude')!.modelId, 'claude-opus-5');
});

test('O: quota/percent/reset are explicitly unsupported everywhere; Ollama is local', () => {
  const registry = buildProviderCapabilityRegistry({
    discovery: FULL_DISCOVERY,
    enumeratedModels: { ollama: ['llama3:8b'] },
    configuredModels: { codex: ['gpt-5.6'] },
    observedModels: { claude: ['m'] },
    now,
  });
  for (const provider of registry) {
    for (const model of provider.models) {
      assert.equal(model.usageCapabilities.quotaRemaining, false);
      assert.equal(model.usageCapabilities.quotaPercent, false);
      assert.equal(model.usageCapabilities.resetAt, false);
    }
  }
  // Providers with a token-parsing adapter expose executionTokens=true.
  assert.equal(registry.find((p) => p.providerId === 'codex')!.models[0].usageCapabilities.executionTokens, true);
  assert.equal(registry.find((p) => p.providerId === 'ollama')!.local, true);
});

test('P: cmd-wrapper catalog probes go through COMSPEC, native probes stay on the executable', () => {
  const codex = record({
    toolId: 'codex-cli',
    harnessKind: 'cmd-wrapper',
    resolvedPath: 'C:\\secret\\codex.cmd',
  });
  const launch = catalogProbeLaunch(codex, ['debug', 'models']);
  assert.notEqual(launch.file.toLowerCase(), 'c:\\secret\\codex.cmd');
  assert.match(launch.file.toLowerCase(), /cmd\.exe$/);
  assert.deepEqual(launch.args.slice(0, 3), ['/d', '/s', '/c']);
  assert.equal(launch.windowsVerbatimArguments, true);
  assert.ok(launch.args[3].includes('debug'));
  assert.ok(launch.args[3].includes('models'));
  assert.ok(launch.args[3].includes('C:\\secret\\codex.cmd'));
  assert.equal('shell' in launch, false);

  const ollama = record({
    toolId: 'ollama-cli',
    harnessKind: 'native-executable',
    resolvedPath: 'C:\\secret\\ollama.exe',
  });
  const native = catalogProbeLaunch(ollama, ['list']);
  assert.equal(native.file, 'C:\\secret\\ollama.exe');
  assert.deepEqual(native.args, ['list']);
  assert.equal(native.windowsVerbatimArguments, undefined);
});

test('Q: a successful Codex probe is published; failure and Claude stay empty; paths do not leak', async () => {
  const catalog = JSON.stringify({
    models: [
      { slug: 'gpt-6-astra', visibility: 'list' },
      { slug: 'gpt-reserve', visibility: 'hide' },
      ...Array.from({ length: 80 }, (_, index) => ({ slug: `model-${index}`, visibility: 'list' })),
    ],
  });
  const discovery = [
    record({ toolId: 'codex-cli', displayName: 'Codex CLI', command: 'codex', harnessKind: 'cmd-wrapper', resolvedPath: 'C:\\secret\\codex.cmd', cliVersion: '0.153.4' }),
    record({ toolId: 'claude-code', displayName: 'Claude Code', command: 'claude', resolvedPath: 'C:\\secret\\claude.cmd', cliVersion: '2.1.277' }),
    record({ toolId: 'ollama-cli', displayName: 'Ollama CLI', command: 'ollama', resolvedPath: 'C:\\secret\\ollama.exe' }),
  ];
  const enumerated = await enumerateLocalModels(discovery, async (probe, args) => {
    if (probe.toolId === 'ollama-cli') {
      assert.deepEqual(args, ['list']);
      return { stdout: 'NAME ID\nqwen3:14b abc\n' };
    }
    assert.equal(probe.toolId, 'codex-cli');
    assert.deepEqual(args, ['debug', 'models']);
    return { stdout: catalog };
  });
  assert.equal(enumerated.codex?.length, MAX_CODEX_CATALOG_MODELS);
  assert.equal(enumerated.codex?.[0], 'gpt-6-astra');
  assert.ok(!enumerated.codex?.includes('gpt-reserve'));
  assert.equal(enumerated.claude, undefined);
  assert.deepEqual(enumerated.ollama, ['qwen3:14b']);

  const safe = toSafeProviderFleet(buildProviderCapabilityRegistry({ discovery, enumeratedModels: enumerated, now }));
  const serialized = JSON.stringify(safe);
  assert.equal(safe.find((provider) => provider.providerId === 'codex')!.models.length, MAX_CODEX_CATALOG_MODELS);
  assert.equal(safe.find((provider) => provider.providerId === 'codex')!.models[0].modelId, 'gpt-6-astra');
  assert.equal(safe.find((provider) => provider.providerId === 'codex')!.models[0].availabilitySource, 'provider-enumeration');
  assert.equal(safe.find((provider) => provider.providerId === 'claude')!.models.length, 0);
  assert.ok(!serialized.includes('secret'));
  assert.ok(!serialized.includes('codex.cmd'));
  assert.ok(!serialized.toLowerCase().includes('stdout'));

  const failed = await enumerateLocalModels(discovery, async () => {
    throw new Error('EINVAL spawn');
  });
  assert.deepEqual(failed, {});
  const empty = toSafeProviderFleet(buildProviderCapabilityRegistry({ discovery, enumeratedModels: failed, now }));
  assert.equal(empty.find((provider) => provider.providerId === 'codex')!.models.length, 0);
  assert.equal(empty.find((provider) => provider.providerId === 'claude')!.models.length, 0);
});
