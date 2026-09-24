/**
 * ATB-2: frontend provider-fleet adapter tests.
 *
 * Proves the browser consumes the safe provider fleet honestly and stays
 * backward compatible with pre-ATB-2 Hosts that published a plain string[].
 */
import { describe, expect, it } from 'vitest'
import { computeHostPresence, mapProviderFleet } from './controlTowerAdapter'
import type { HostPresenceRow } from './controlTowerService'

function row(providers: unknown[], lastSeenAt = new Date().toISOString()): HostPresenceRow {
  return { repo_key: 'r', host_instance_id: 'h', status: 'connected', host_version: '0.1.0', providers, last_seen_at: lastSeenAt }
}

const CLAUDE_ENTRY = {
  providerId: 'claude', providerDisplayName: 'Claude Code', providerKind: 'provider', providerLogoKey: 'claude',
  installed: true, available: true, availabilitySource: 'runtime-probe', cliVersion: '1.0.0', workerCapable: true,
  supportedRoles: ['architect', 'implementer', 'verifier'], local: false, lastRefreshedAt: '2026-09-22T00:00:00.000Z',
  models: [{ modelId: 'claude-opus-5', modelDisplayName: 'claude-opus-5', availability: 'execution-evidence' /* invalid */, availabilitySource: 'execution-evidence', effortLevels: [], defaultEffort: null, reportedRuntimeModel: 'claude-opus-5', configuredModel: null, contextWindow: null, usageCapabilities: { executionTokens: true, quotaRemaining: false, quotaPercent: false, resetAt: false } }],
}

describe('ATB-2 provider fleet adapter', () => {
  it('maps object fleet entries into typed capability views', () => {
    const fleet = mapProviderFleet([CLAUDE_ENTRY])
    expect(fleet).toHaveLength(1)
    expect(fleet[0].providerId).toBe('claude')
    expect(fleet[0].providerLogoKey).toBe('claude')
    expect(fleet[0].supportedRoles).toEqual(['architect', 'implementer', 'verifier'])
    expect(fleet[0].models[0].reportedRuntimeModel).toBe('claude-opus-5')
    // 'execution-evidence' is not a valid model AVAILABILITY enum → safe fallback.
    expect(fleet[0].models[0].availability).toBe('unavailable')
    expect(fleet[0].models[0].usageCapabilities.executionTokens).toBe(true)
    expect(fleet[0].models[0].usageCapabilities.quotaRemaining).toBe(false)
  })

  it('drops malformed / legacy string entries rather than fabricating capability', () => {
    expect(mapProviderFleet(['claude-code', 'codex-cli'])).toEqual([])
    expect(mapProviderFleet([{ noProviderId: true }, 42, null])).toEqual([])
    expect(mapProviderFleet('not-an-array' as unknown)).toEqual([])
  })

  it('computeHostPresence exposes the fleet + derives provider names (object shape)', () => {
    const presence = computeHostPresence([row([CLAUDE_ENTRY])], Date.now())
    expect(presence.state).toBe('connected')
    expect(presence.providerFleet).toHaveLength(1)
    expect(presence.providers).toEqual(['Claude Code'])
  })

  it('stays backward compatible with a pre-ATB-2 Host that published string[] names', () => {
    const presence = computeHostPresence([row(['claude-code', 'codex-cli'])], Date.now())
    expect(presence.providerFleet).toEqual([])
    expect(presence.providers).toEqual(['claude-code', 'codex-cli'])
  })
})
