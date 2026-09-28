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

  it('publishes Claude auth mode only when the host reports a known value', () => {
    const reported = mapProviderFleet([{ ...CLAUDE_ENTRY, authMode: 'not-reported' }])
    expect(reported[0].authMode).toBe('not-reported')
    const invented = mapProviderFleet([{ ...CLAUDE_ENTRY, authMode: 'subscription' }])
    expect(invented[0].authMode).toBe('subscription')
    const unknown = mapProviderFleet([{ ...CLAUDE_ENTRY, authMode: 'guessed-pro' }])
    expect(unknown[0].authMode).toBeUndefined()
  })

  it('drops malformed / legacy string entries rather than fabricating capability', () => {
    expect(mapProviderFleet(['claude-code', 'codex-cli'])).toEqual([])
    expect(mapProviderFleet([{ noProviderId: true }, 42, null])).toEqual([])
    expect(mapProviderFleet('not-an-array' as unknown)).toEqual([])
  })

  it('computeHostPresence exposes the fleet + derives provider names (object shape)', () => {
    const presence = computeHostPresence([row([CLAUDE_ENTRY])], Date.now())
    expect(presence.state).toBe('healthy')
    expect(presence.providerFleet).toHaveLength(1)
    expect(presence.providers).toEqual(['Claude Code'])
  })

  it('stays backward compatible with a pre-ATB-2 Host that published string[] names', () => {
    const presence = computeHostPresence([row(['claude-code', 'codex-cli'])], Date.now())
    expect(presence.providerFleet).toEqual([])
    expect(presence.providers).toEqual(['claude-code', 'codex-cli'])
  })

  /**
   * CT-REL-2 amendment 6: the CT-REL-2 host-status marker rides the providers
   * jsonb under `kind: 'host-status'` — it must NEVER render as a provider in
   * the MODELS / provider fleet UI, and its restartRequired flag must reach the
   * presence view for the banner.
   */
  it('never renders the namespaced host-status marker as a provider', () => {
    const marker = {
      kind: 'host-status',
      sourceFingerprint: 'a'.repeat(64),
      restartRequired: true,
      restartDetectedAt: '2026-09-27T10:00:00.000Z',
      health: { state: 'healthy', consecutiveFailures: 0, lastFailureAt: null },
    }
    const fleet = mapProviderFleet([CLAUDE_ENTRY, marker])
    expect(fleet.map((provider) => provider.providerId)).toEqual(['claude'])
    const presence = computeHostPresence([row([CLAUDE_ENTRY, marker])], Date.now())
    expect(presence.providerFleet.map((provider) => provider.providerId)).toEqual(['claude'])
    expect(presence.providers).toEqual(['Claude Code'])
    expect(presence.state).toBe('healthy')
    expect(presence.restartRequired).toBe(true)
    expect(presence.restartDetectedAt).toBe('2026-09-27T10:00:00.000Z')
    expect(presence.hostHealth).toEqual({ state: 'healthy', consecutiveFailures: 0, lastFailureAt: null })
  })
})
