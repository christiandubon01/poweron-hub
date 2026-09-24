// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import ControlTower from '../app-brain/control-tower/ControlTower'
import ModelsMode from '../app-brain/control-tower/intelligence/ModelsMode'
import NextRunRoutingControls from '../app-brain/control-tower/intelligence/NextRunRoutingControls'
import { PREVIEW_FLEET_LABEL, PREVIEW_PROVIDER_FLEET } from '@/features/control-tower/previewFleet'
import { EMPTY_NEXT_RUN_ROUTING, toRequestedRouting, type NextRunRouting } from '@/features/control-tower/nextRunRouting'
import { mapProviderFleet } from '@/features/control-tower/controlTowerAdapter'
import type { HostPresenceView } from '@/features/control-tower/controlTowerAdapter'

vi.mock('../V15rAppBrainScene', () => ({ default: () => <div data-testid="brain" /> }))

let container: HTMLDivElement
let root: ReturnType<typeof createRoot>
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); container = document.createElement('div'); document.body.append(container); root = createRoot(container) })
afterEach(() => { act(() => root.unmount()); container.remove() })

const presence: HostPresenceView = {
  state: 'connected', repoKey: 'abc', providers: PREVIEW_PROVIDER_FLEET.map((item) => item.providerDisplayName),
  providerFleet: PREVIEW_PROVIDER_FLEET, hostVersion: '0.1.0', lastSeenAt: '2026-09-22T00:00:00Z', hostInstanceId: 'h1',
}

it('renders Claude, Codex, Ollama, and Cursor diagnostic cards from real fleet mapping', () => {
  act(() => root.render(<ModelsMode presence={presence} routing={EMPTY_NEXT_RUN_ROUTING} onRoutingChange={() => {}} preview={false} />))
  expect(container.querySelector('[data-provider="claude"]')).toBeTruthy()
  expect(container.querySelector('[data-provider="codex"]')).toBeTruthy()
  expect(container.querySelector('[data-provider="ollama"]')).toBeTruthy()
  expect(container.querySelector('[data-provider="cursor-editor"]')?.textContent).toContain('Diagnostic only')
  expect(container.querySelector('[data-provider="cursor-agent"]')?.textContent).toContain('Unavailable / not worker-capable')
})

it('maps providerFleet honestly and does not invent a Live fleet', () => {
  const mapped = mapProviderFleet(PREVIEW_PROVIDER_FLEET)
  expect(mapped.map((item) => item.providerId)).toEqual(['claude', 'codex', 'ollama', 'cursor-editor', 'cursor-agent'])
  act(() => root.render(<ModelsMode presence={{ ...presence, providerFleet: [] }} routing={EMPTY_NEXT_RUN_ROUTING} onRoutingChange={() => {}} preview={false} />))
  expect(container.textContent).toContain('No provider fleet published')
  expect(container.textContent).not.toContain(PREVIEW_FLEET_LABEL)
})

it('states Claude is non-enumerable and offers configured/observed plus custom', () => {
  act(() => root.render(<ControlTower />))
  act(() => { [...container.querySelectorAll('button')].find((item) => item.textContent === 'MODELS')!.click() })
  expect(container.textContent).toContain(PREVIEW_FLEET_LABEL)
  act(() => { container.querySelector<HTMLButtonElement>('[data-provider="claude"] button')!.click() })
  expect(container.textContent).toContain('CLI does not enumerate available models')
  expect(container.textContent).toContain('Configured allowlist + execution evidence')
})

it('lists Codex catalog options and Ollama installed models', () => {
  act(() => root.render(<ModelsMode presence={presence} routing={EMPTY_NEXT_RUN_ROUTING} onRoutingChange={() => {}} preview />))
  const codex = container.querySelector<HTMLElement>('[data-provider="codex"]')!
  expect(codex.textContent).toContain('Provider catalog available')
  expect(codex.textContent).not.toContain('gpt-5.6')
  act(() => { codex.querySelector('button')!.click() })
  expect(codex.textContent).toContain('gpt-5.6')
  expect(codex.textContent).toContain('Not reported')
  const ollama = container.querySelector<HTMLElement>('[data-provider="ollama"]')!
  expect(ollama.textContent).toContain('llama3.1:8b')
  act(() => { ollama.querySelector('button')!.click() })
  expect(ollama.textContent).toContain('qwen2.5-coder:14b')
  expect(codex.getAttribute('data-open')).toBe('false')
})

it('enables Claude/Codex effort and disables Ollama effort', () => {
  let latest: NextRunRouting = {
    ...EMPTY_NEXT_RUN_ROUTING,
    architect: { providerId: 'claude', modelId: 'claude-sonnet-5', effort: null, customModel: null },
  }
  act(() => root.render(<NextRunRoutingControls fleet={PREVIEW_PROVIDER_FLEET} routing={latest} onChange={(next) => { latest = next }} />))
  const extra = [...container.querySelectorAll('[aria-label="Architect effort"] button')].find((item) => item.textContent === 'Extra High') as HTMLButtonElement
  expect(extra.disabled).toBe(false)
  act(() => { extra.click() })
  expect(latest.architect.effort).toBe('extra-high')
  act(() => root.render(<NextRunRoutingControls fleet={PREVIEW_PROVIDER_FLEET} routing={{ ...EMPTY_NEXT_RUN_ROUTING, implementer: { providerId: 'ollama', modelId: 'llama3.1:8b', effort: null, customModel: null } }} onChange={() => {}} />))
  const ollamaEffort = [...container.querySelectorAll('[aria-label="Implementer effort"] button')]
  expect(ollamaEffort.every((button) => (button as HTMLButtonElement).disabled)).toBe(true)
})

it('propagates Next Run Routing into create_plan requestedRouting without silent downgrade', () => {
  const routing: NextRunRouting = {
    ...EMPTY_NEXT_RUN_ROUTING,
    architect: { providerId: 'claude', modelId: 'claude-sonnet-5', effort: 'high', customModel: null },
  }
  expect(toRequestedRouting(routing)).toEqual({ provider: 'claude', requestedModel: 'claude-sonnet-5' })
})

it('separates configured and reported models and tells the truth about quota/reset', () => {
  act(() => root.render(<ModelsMode presence={presence} routing={EMPTY_NEXT_RUN_ROUTING} onRoutingChange={() => {}} preview={false} />))
  expect(container.textContent).not.toContain('No model published')
  expect(container.textContent).not.toContain(PREVIEW_FLEET_LABEL)
  act(() => { container.querySelector<HTMLButtonElement>('[data-provider="claude"] button')!.click() })
  expect(container.textContent).toContain('Not exposed by provider CLI')
  expect(container.textContent).toContain('Not exposed')
  expect(container.textContent).toContain('CLI does not enumerate available models')
  act(() => { container.querySelector<HTMLButtonElement>('[data-provider="ollama"] button')!.click() })
  expect(container.textContent).toContain('Local runtime · no provider quota')
  expect(container.textContent).toContain('Not exposed')
  expect(container.textContent).not.toMatch(/quota remaining|countdown/i)
  act(() => { container.querySelector<HTMLButtonElement>('[aria-label="Change Architect routing"]')!.click() })
  expect(container.textContent).toContain('do not expose quota percent')
})

it('opens Next Run Routing above a collapsed provider fleet', () => {
  act(() => root.render(<ModelsMode presence={presence} routing={EMPTY_NEXT_RUN_ROUTING} onRoutingChange={() => {}} preview={false} />))
  const mode = container.querySelector('.ct-models-mode')!
  const routing = mode.querySelector('[data-section="next-run-routing"]')!
  const fleet = mode.querySelector('[data-section="provider-fleet"]')!
  expect(routing.compareDocumentPosition(fleet) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(container.textContent).toContain('Architect')
  expect(container.textContent).toContain('Implementer')
  expect(container.textContent).toContain('Verifier')
  expect(container.textContent).toContain('Provider default')
  expect(container.querySelector('.ct-provider-list .ct-effort-seg')).toBeNull()
  expect(container.querySelector('[data-provider="claude"]')?.textContent).toContain('No model override selected')
  expect(container.querySelector('[data-provider="codex"]')?.textContent).toContain('Provider catalog available')
  expect(container.querySelector('[data-provider="cursor-editor"]')?.textContent).toContain('Diagnostic only')
  expect(container.querySelector('[data-provider="cursor-agent"]')?.textContent).toContain('Unavailable / not worker-capable')
  const claudeToggle = container.querySelector<HTMLButtonElement>('[data-provider="claude"] button')!
  const codexToggle = container.querySelector<HTMLButtonElement>('[data-provider="codex"] button')!
  expect(claudeToggle.tagName).toBe('BUTTON')
  expect(claudeToggle.getAttribute('aria-expanded')).toBe('false')
  act(() => { claudeToggle.click() })
  expect(claudeToggle.getAttribute('aria-expanded')).toBe('true')
  expect(container.querySelector('[data-provider="claude"] .ct-effort-seg')).toBeNull()
  expect(container.querySelector('[data-provider="claude"]')?.textContent).toContain('Low · Medium · High · Extra High')
  act(() => { codexToggle.click() })
  expect(claudeToggle.getAttribute('aria-expanded')).toBe('false')
  expect(codexToggle.getAttribute('aria-expanded')).toBe('true')
})

it('says Provider default when a role selects a provider without a model override', () => {
  const routing: NextRunRouting = {
    ...EMPTY_NEXT_RUN_ROUTING,
    architect: { providerId: 'claude', modelId: null, effort: 'high', customModel: null },
  }
  act(() => root.render(<ModelsMode presence={presence} routing={routing} onRoutingChange={() => {}} preview={false} />))
  expect(container.querySelector('[data-role="architect"]')?.textContent).toContain('Provider default')
  expect(container.querySelector('[data-role="architect"]')?.textContent).toContain('High')
  expect(container.querySelector('[data-provider="claude"]')?.textContent).toContain('Provider default')
  expect(container.querySelector('[data-provider="claude"]')?.textContent).not.toContain('No model override selected')
  expect(container.textContent).not.toContain('No model published')
})

it('keeps Architect provider, model, and effort controls functional from the summary row', () => {
  let latest: NextRunRouting = { ...EMPTY_NEXT_RUN_ROUTING, architect: { ...EMPTY_NEXT_RUN_ROUTING.architect }, implementer: { ...EMPTY_NEXT_RUN_ROUTING.implementer }, verifier: { ...EMPTY_NEXT_RUN_ROUTING.verifier } }
  const renderRouting = () => act(() => root.render(<ModelsMode presence={presence} routing={latest} onRoutingChange={(next) => { latest = next }} preview={false} />))
  renderRouting()
  const change = container.querySelector<HTMLButtonElement>('[aria-label="Change Architect routing"]')!
  expect(change.tagName).toBe('BUTTON')
  act(() => { change.click() })
  const provider = container.querySelector<HTMLSelectElement>('[aria-label="Architect provider"]')!
  act(() => { provider.value = 'claude'; provider.dispatchEvent(new Event('change', { bubbles: true })) })
  renderRouting()
  const model = container.querySelector<HTMLSelectElement>('[aria-label="Architect model"]')!
  act(() => { model.value = 'claude-sonnet-5'; model.dispatchEvent(new Event('change', { bubbles: true })) })
  renderRouting()
  const extra = [...container.querySelectorAll('[aria-label="Architect effort"] button')].find((item) => item.textContent === 'Extra High') as HTMLButtonElement
  act(() => { extra.click() })
  expect(latest.architect).toMatchObject({ providerId: 'claude', modelId: 'claude-sonnet-5', effort: 'extra-high' })
  expect(toRequestedRouting(latest)).toEqual({ provider: 'claude', requestedModel: 'claude-sonnet-5' })
})
