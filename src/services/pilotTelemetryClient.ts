import { authedJsonHeaders } from '@/services/authedFetch'
import { isDemoRuntimeActive } from '@/services/demoModeSafety'
import {
  sanitizeTelemetryMetadata,
  type PilotTelemetryEventName,
} from '@/services/pilotTelemetryShared'

export interface TrackPilotTelemetryEventInput {
  eventName: PilotTelemetryEventName
  module?: string | null
  feature?: string | null
  objectId?: string | null
  metadata?: Record<string, unknown> | null
  occurredAt?: string | null
}

export interface FounderSupportIncidentInput {
  organizationId: string
  category: string
  note?: string | null
  minutesSpent?: number | null
}

export async function trackPilotTelemetryEvent(
  input: TrackPilotTelemetryEventInput,
): Promise<{ ok: boolean; skipped?: boolean; error?: string }> {
  if (isDemoRuntimeActive()) return { ok: true, skipped: true }

  try {
    const response = await fetch('/.netlify/functions/pilot-telemetry', {
      method: 'POST',
      headers: await authedJsonHeaders(),
      body: JSON.stringify({
        action: 'track_event',
        eventName: input.eventName,
        module: input.module ?? null,
        feature: input.feature ?? null,
        objectId: input.objectId ?? null,
        metadata: sanitizeTelemetryMetadata(input.metadata ?? {}),
        occurredAt: input.occurredAt ?? null,
      }),
    })

    if (!response.ok) {
      const text = await response.text()
      return { ok: false, error: text || `Telemetry request failed (${response.status})` }
    }
    return { ok: true }
  } catch (error: any) {
    return { ok: false, error: error?.message || 'Telemetry request failed.' }
  }
}

export async function trackFeatureErrorEvent(input: {
  module: string
  feature: string
  operation?: string | null
  category: string
}): Promise<void> {
  await trackPilotTelemetryEvent({
    eventName: 'feature_error',
    module: input.module,
    feature: input.feature,
    metadata: {
      operation: input.operation ?? undefined,
      category: input.category,
    },
  })
}

export async function logFounderSupportIncident(
  input: FounderSupportIncidentInput,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const response = await fetch('/.netlify/functions/pilot-telemetry', {
      method: 'POST',
      headers: await authedJsonHeaders(),
      body: JSON.stringify({
        action: 'log_support_incident',
        organizationId: input.organizationId,
        category: input.category,
        note: input.note ?? null,
        minutesSpent: input.minutesSpent ?? null,
      }),
    })
    if (!response.ok) {
      const text = await response.text()
      return { ok: false, error: text || `Support incident request failed (${response.status})` }
    }
    return { ok: true }
  } catch (error: any) {
    return { ok: false, error: error?.message || 'Support incident request failed.' }
  }
}

export async function fetchFounderPilotReport(): Promise<any> {
  const response = await fetch('/.netlify/functions/pilot-telemetry?action=founder_report', {
    method: 'GET',
    headers: await authedJsonHeaders(),
  })
  if (!response.ok) {
    throw new Error(await response.text() || `Pilot report failed (${response.status})`)
  }
  return response.json()
}

export async function setOrganizationPilotClassification(input: {
  organizationId: string
  classification: 'customer_zero' | 'design_partner' | 'normal'
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const response = await fetch('/.netlify/functions/pilot-telemetry', {
      method: 'POST',
      headers: await authedJsonHeaders(),
      body: JSON.stringify({
        action: 'set_org_classification',
        organizationId: input.organizationId,
        classification: input.classification,
      }),
    })
    if (!response.ok) {
      const text = await response.text()
      return { ok: false, error: text || `Classification update failed (${response.status})` }
    }
    return { ok: true }
  } catch (error: any) {
    return { ok: false, error: error?.message || 'Classification update failed.' }
  }
}
