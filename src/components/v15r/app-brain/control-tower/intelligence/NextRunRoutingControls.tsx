import { useState } from 'react'
import type { EffortLevel, ProviderCapabilityView } from '../controlTowerTypes'
import { EFFORT_OPTIONS, ROUTED_ROLES, type NextRunRouting, type RoleNextRunChoice, type RoutedRole } from '@/features/control-tower/nextRunRouting'
import { modelChoiceLabel, providerOmitsModelEnumeration } from './modelTruth'

const ROLE_LABEL: Record<RoutedRole, string> = {
  architect: 'Architect',
  implementer: 'Implementer',
  verifier: 'Verifier',
}

const EFFORT_LABEL: Record<EffortLevel, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  'extra-high': 'Extra High',
}

function workerProviders(fleet: ProviderCapabilityView[]): ProviderCapabilityView[] {
  return fleet.filter((provider) => provider.providerKind !== 'diagnostic' && provider.providerId !== 'cursor-editor')
}

function effortSupported(provider: ProviderCapabilityView | undefined, effort: EffortLevel): boolean {
  if (!provider) return false
  const levels = provider.models.flatMap((model) => model.effortLevels)
  return levels.includes(effort)
}

function RoleEditor({ role, choice, provider, providers, onUpdate }: {
  role: RoutedRole
  choice: RoleNextRunChoice
  provider: ProviderCapabilityView | undefined
  providers: ProviderCapabilityView[]
  onUpdate: (patch: Partial<RoleNextRunChoice>) => void
}) {
  const models = provider?.models ?? []
  const customSelected = choice.customModel != null && choice.customModel !== ''
  return <fieldset className="ct-role-routing" id={`ct-role-editor-${role}`}>
    <legend>{ROLE_LABEL[role]}</legend>
    <label className="ct-composer-field">
      <span className="ct-eyebrow">Provider</span>
      <select aria-label={`${ROLE_LABEL[role]} provider`} value={choice.providerId ?? ''} onChange={(event) => onUpdate({ providerId: event.target.value || null, modelId: null, customModel: null, effort: null })}>
        <option value="">No preference</option>
        {providers.filter((item) => item.supportedRoles.includes(role) || item.supportedRoles.length === 0 || item.available).map((item) => (
          <option key={item.providerId} value={item.providerId} disabled={!item.workerCapable}>{item.providerDisplayName}{!item.workerCapable ? ' · not worker-capable' : ''}</option>
        ))}
      </select>
    </label>
    <label className="ct-composer-field">
      <span className="ct-eyebrow">Model</span>
      <select aria-label={`${ROLE_LABEL[role]} model`} value={customSelected ? '__custom__' : (choice.modelId ?? '')} onChange={(event) => {
        if (event.target.value === '__custom__') onUpdate({ modelId: null, customModel: choice.customModel || '' })
        else onUpdate({ modelId: event.target.value || null, customModel: null })
      }}>
        <option value="">Provider default</option>
        {models.map((model) => <option key={model.modelId} value={model.modelId}>{model.modelDisplayName}</option>)}
        {provider?.providerId === 'claude' && <option value="__custom__">Custom model…</option>}
      </select>
    </label>
    {provider?.providerId === 'claude' && customSelected && <label className="ct-composer-field">
      <span className="ct-eyebrow">Custom model</span>
      <input aria-label={`${ROLE_LABEL[role]} custom model`} value={choice.customModel ?? ''} onChange={(event) => onUpdate({ customModel: event.target.value || null })} placeholder="configured / observed model id" />
    </label>}
    {providerOmitsModelEnumeration(provider) && <p className="ct-field-note">CLI does not enumerate available models. Choices are the configured allowlist plus execution evidence.</p>}
    <div className="ct-effort" role="group" aria-label={`${ROLE_LABEL[role]} effort`}>
      <span className="ct-eyebrow">Effort</span>
      <div className="ct-effort-seg">
        {EFFORT_OPTIONS.map((effort) => {
          const supported = effortSupported(provider, effort)
          return <button
            key={effort}
            type="button"
            aria-pressed={choice.effort === effort}
            aria-disabled={!supported}
            disabled={!supported}
            onClick={() => onUpdate({ effort })}
          >{EFFORT_LABEL[effort]}</button>
        })}
      </div>
      {!provider && <p className="ct-field-note">Select a provider to enable effort.</p>}
      {provider && provider.providerId === 'ollama' && <p className="ct-field-note">Ollama does not support effort. Options stay disabled.</p>}
    </div>
  </fieldset>
}

function FallbackLadder({ providers, routing }: { providers: ProviderCapabilityView[]; routing: NextRunRouting }) {
  return <details className="ct-disclosure ct-ladder">
    <summary>Advanced · fallback ladder</summary>
    <p className="ct-field-note">Priority 1 is the Next Run choice above. Automatic quota-percent switching is unavailable — providers do not expose quota percent.</p>
    {ROUTED_ROLES.map((role) => {
      const choice = routing[role]
      const provider = providers.find((item) => item.providerId === choice.providerId)
      return <div key={role} className="ct-ladder-row">
        <strong>{ROLE_LABEL[role]}</strong>
        <span>Priority 1 · {provider?.providerDisplayName ?? 'No provider'} · {choice.customModel || choice.modelId || 'default'} · {choice.effort ?? 'default'}</span>
        <span>Priority 2 · Host availability fallback only — never quota percent.</span>
      </div>
    })}
  </details>
}

export default function NextRunRoutingControls({ fleet, routing, onChange, compact = false, presentation = 'editor' }: {
  fleet: ProviderCapabilityView[]
  routing: NextRunRouting
  onChange: (next: NextRunRouting) => void
  compact?: boolean
  presentation?: 'editor' | 'summary'
}) {
  const providers = workerProviders(fleet)
  const [editing, setEditing] = useState<RoutedRole | null>(null)
  const update = (role: RoutedRole, patch: Partial<RoleNextRunChoice>) => {
    onChange({ ...routing, [role]: { ...routing[role], ...patch } })
  }
  return <div className={`ct-next-routing ${compact ? 'ct-next-routing--compact' : ''} ${presentation === 'summary' ? 'ct-next-routing--summary' : ''}`} aria-label="Next Run Routing">
    <p className="ct-field-note">Applies to next Run. Host create_plan accepts one provider/model preference for the Architect plan turn. This is not a permanent Host default.</p>
    {presentation === 'summary' && ROUTED_ROLES.map((role) => {
      const choice = routing[role]
      const provider = providers.find((item) => item.providerId === choice.providerId)
      const open = editing === role
      return <div key={role} className="ct-role-summary" data-role={role}>
        <div className="ct-role-summary-copy">
          <div className="ct-role-summary-name">{ROLE_LABEL[role]}</div>
          <div className="ct-role-summary-facts">
            <span>{provider?.providerDisplayName ?? 'No preference'}</span>
            <span className="ct-role-summary-dot" aria-hidden="true">·</span>
            <span>{modelChoiceLabel(choice, provider)}</span>
            <span className="ct-role-summary-dot" aria-hidden="true">·</span>
            <span>{choice.effort ? EFFORT_LABEL[choice.effort] : 'Default'}</span>
          </div>
        </div>
        <button
          type="button"
          className="ct-role-change"
          aria-expanded={open}
          aria-controls={`ct-role-editor-${role}`}
          aria-label={`${open ? 'Close' : 'Change'} ${ROLE_LABEL[role]} routing`}
          onClick={() => setEditing(open ? null : role)}
        >{open ? 'Done' : 'Change'}</button>
        {open && <RoleEditor role={role} choice={choice} provider={provider} providers={providers} onUpdate={(patch) => update(role, patch)} />}
      </div>
    })}
    {presentation === 'editor' && ROUTED_ROLES.map((role) => {
      const choice = routing[role]
      const provider = providers.find((item) => item.providerId === choice.providerId)
      return <RoleEditor key={role} role={role} choice={choice} provider={provider} providers={providers} onUpdate={(patch) => update(role, patch)} />
    })}
    {(presentation === 'editor' || editing) && <FallbackLadder providers={providers} routing={routing} />}
  </div>
}
