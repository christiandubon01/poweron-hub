import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import type { HostPresenceView } from '@/features/control-tower/controlTowerAdapter'
import { PREVIEW_DEMO_TOKEN_USAGE, PREVIEW_FLEET_LABEL } from '@/features/control-tower/previewFleet'
import type { NextRunRouting } from '@/features/control-tower/nextRunRouting'
import type { ProviderCapabilityView } from '../controlTowerTypes'
import ProviderMark from './ProviderMark'
import NextRunRoutingControls from './NextRunRoutingControls'
import {
  collapsedCapabilitySummary,
  discoveryValue,
  modelListLabel,
  providerOmitsModelEnumeration,
  providerStatusLine,
  reportedModelLine,
  routingModelPhrase,
  supportedEffortLine,
} from './modelTruth'

function assignedRoles(provider: ProviderCapabilityView, routing: NextRunRouting): string {
  const roles: string[] = []
  if (routing.architect.providerId === provider.providerId) roles.push('Architect')
  if (routing.implementer.providerId === provider.providerId) roles.push('Implementer')
  if (routing.verifier.providerId === provider.providerId) roles.push('Verifier')
  return roles.length > 0 ? roles.join(' · ') : 'None'
}

function usageLine(provider: ProviderCapabilityView, preview: boolean): string {
  const canTokens = provider.models.some((model) => model.usageCapabilities.executionTokens)
  if (preview && PREVIEW_DEMO_TOKEN_USAGE[provider.providerId] != null) {
    return `${PREVIEW_DEMO_TOKEN_USAGE[provider.providerId].toLocaleString()} execution tokens · demo`
  }
  if (canTokens) return 'Capability present · count not published in this heartbeat'
  if (provider.local) return 'Local runtime · no provider quota'
  return 'Not published'
}

function quotaLine(provider: ProviderCapabilityView): { quota: string; reset: string } {
  if (provider.local || provider.providerId === 'ollama') {
    return { quota: 'Local runtime · no provider quota', reset: 'Not exposed' }
  }
  return { quota: 'Not exposed by provider CLI', reset: 'Not exposed' }
}

function ProviderCard({ provider, routing, preview, open, onToggle }: {
  provider: ProviderCapabilityView
  routing: NextRunRouting
  preview: boolean
  open: boolean
  onToggle: () => void
}) {
  const quota = quotaLine(provider)
  const detailId = `ct-provider-detail-${provider.providerId}`
  const status = providerStatusLine(provider)
  const summary = collapsedCapabilitySummary(provider, routing)
  const showRuntimeReport = provider.workerCapable
  return <article className="ct-provider-card" data-provider={provider.providerId} data-kind={provider.providerKind} data-open={open ? 'true' : 'false'}>
    <button
      type="button"
      className="ct-provider-toggle"
      aria-expanded={open}
      aria-controls={detailId}
      aria-label={`${open ? 'Collapse' : 'Expand'} ${provider.providerDisplayName}, ${status}, ${summary}`}
      onClick={onToggle}
    >
      <ProviderMark logoKey={provider.providerLogoKey} label={provider.providerDisplayName} />
      <span className="ct-provider-card-copy">
        <span className="ct-provider-name">{provider.providerDisplayName}</span>
        <span className="ct-provider-status">{status}</span>
        <span className="ct-provider-model">{summary}</span>
      </span>
      <ChevronDown className="ct-provider-chevron" size={16} aria-hidden="true" />
    </button>
    {open && <div id={detailId} className="ct-provider-detail">
      <dl className="ct-facts">
        <div><dt>CLI</dt><dd>{provider.cliVersion ?? 'Not reported'}</dd></div>
        <div><dt>Availability</dt><dd>{provider.available ? 'Available' : 'Unavailable'}</dd></div>
        <div><dt>Availability source</dt><dd>{provider.availabilitySource.replace(/-/g, ' ')}</dd></div>
        <div><dt>Worker</dt><dd>{provider.workerCapable ? 'Worker-capable' : 'Not worker-capable'}</dd></div>
        <div><dt>Assigned roles</dt><dd>{assignedRoles(provider, routing)}</dd></div>
        <div><dt>Model discovery</dt><dd>{discoveryValue(provider)}</dd></div>
        {provider.models.length > 0 && <div><dt>{modelListLabel(provider)}</dt><dd>{provider.models.map((model) => model.modelDisplayName).join(' · ')}</dd></div>}
        {showRuntimeReport && <div><dt>Reported model</dt><dd>{reportedModelLine(provider)}</dd></div>}
        {provider.workerCapable && <div><dt>Routing model</dt><dd>{routingModelPhrase(provider, routing)}</dd></div>}
        <div><dt>Supported effort</dt><dd>{supportedEffortLine(provider)}</dd></div>
        <div><dt>Recent usage</dt><dd>{usageLine(provider, preview)}</dd></div>
        <div><dt>Quota</dt><dd>{quota.quota}</dd></div>
        <div><dt>Reset</dt><dd>{quota.reset}</dd></div>
        <div><dt>Runtime</dt><dd>{provider.local ? 'Local runtime' : 'Cloud provider'}</dd></div>
      </dl>
      {providerOmitsModelEnumeration(provider) && <p className="ct-field-note">CLI does not enumerate available models.</p>}
    </div>}
  </article>
}

export default function ModelsMode({ presence, routing, onRoutingChange, preview }: {
  presence?: HostPresenceView
  routing: NextRunRouting
  onRoutingChange: (next: NextRunRouting) => void
  preview: boolean
}) {
  const fleet = presence?.providerFleet ?? []
  const [openProviderId, setOpenProviderId] = useState<string | null>(null)
  return <div className="ct-models-mode" aria-label="Models">
    {preview && <p className="ct-preview-scope-label">{PREVIEW_FLEET_LABEL}</p>}
    {!preview && fleet.length === 0 && <p className="ct-muted">No provider fleet published by this Host. Names-only heartbeats do not invent capability cards.</p>}
    {fleet.length > 0 && <section className="ct-intelligence-section" data-section="next-run-routing">
      <h4>Next Run Routing</h4>
      <NextRunRoutingControls fleet={fleet} routing={routing} onChange={onRoutingChange} presentation="summary" />
    </section>}
    {fleet.length > 0 && <section className="ct-intelligence-section" data-section="provider-fleet">
      <h4>Provider Fleet</h4>
      <div className="ct-provider-list">
        {fleet.map((provider) => <ProviderCard
          key={provider.providerId}
          provider={provider}
          routing={routing}
          preview={preview}
          open={openProviderId === provider.providerId}
          onToggle={() => setOpenProviderId((current) => current === provider.providerId ? null : provider.providerId)}
        />)}
      </div>
    </section>}
  </div>
}
