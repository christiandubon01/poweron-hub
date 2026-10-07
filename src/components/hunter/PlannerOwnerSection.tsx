import React from 'react'
import type { PlannerOwnerDetails } from '@/services/portal/plannerDetails'
import type { AttachmentEntry } from '@/services/portal/portalStorageService'
import taxonomy from '../../../netlify/functions/lib/planner-taxonomy.json'

const PROVENANCE: Record<string, string> = {
  customer_known: 'Customer reported', customer_estimated: 'Customer estimate', unknown: 'Unknown',
  verification_required: 'Needs verification', inferred_preliminary: 'Preliminary website assumption', measured: 'Measured claim',
}
const LABELS: Record<string, string> = {
  ev_charger: 'EV charging', hvac: 'HVAC', pool_spa: 'Pool / spa', electric_range_cooking: 'Electric cooking',
  electric_dryer: 'Electric dryer', electric_water_heater: 'Electric water heater', tankless_water_heater: 'Tankless water heater',
  solar: 'Solar', battery: 'Battery', remodel: 'Remodel', adu_addition: 'ADU / addition',
  existing_panel_concern: 'Existing panel concern', told_need_upgrade: 'Reported upgrade recommendation',
  understand_existing_system: 'Understand the existing system', other: 'Other',
  tonnage: 'Tonnage', equipment_type: 'Equipment type', breaker_amps_reported: 'Reported breaker amps',
  charging_amps: 'Charging amps', charger_type: 'Charger type', size_kw: 'Size (kW)', capacity_kwh: 'Capacity (kWh)',
  description: 'Description', under_10: 'Under 10 years', '10_25': '10–25 years', '25_40': '25–40 years', '40_plus': '40+ years',
  'service.main_rating': 'Service size', service_main_rating: 'Service size', panel_label: 'Panel label',
  meter_equipment: 'Meter equipment', load_identification: 'Load identification',
}
const object = (v: unknown): Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {}
const list = (v: unknown): unknown[] => Array.isArray(v) ? v : []
const text = (v: unknown): string => typeof v === 'string' ? v : ''
const label = (v: unknown) => LABELS[text(v)] || text(v).replace(/_/g, ' ')
const lookup = (map: object, v: unknown, fallback = 'Unknown / needs verification') => (map as Record<string, string>)[text(v)] || fallback
function Fact({ value, amps = false }: { value: unknown; amps?: boolean }) {
  const fact = object(value)
  const reported = fact.value
  return <span>{reported === null || reported === undefined ? 'Unknown / needs verification' :
    typeof reported === 'number' ? `${reported}${amps ? ' A' : ''}` : label(reported)}
    {' · '}{PROVENANCE[text(fact.provenance)] || 'Needs verification'}</span>
}
function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="space-y-2"><h4 className="text-xs font-bold text-amber-300 uppercase tracking-wide">{title}</h4>{children}</section>
}
function Loads({ value }: { value: unknown }) {
  if (!list(value).length) return <p>No equipment reported.</p>
  return <ul className="space-y-3">{list(value).map((item, i) => {
    const load = object(item)
    const def = (taxonomy.LOAD_TYPES as Record<string, {label: string; fields: Record<string, {unit?: string}>}>)[text(load.type)]
    if (!def) return null
    const details = object(load.details)
    return <li key={i} className="rounded-lg bg-gray-900 border border-gray-800 p-3">
      <p className="font-semibold text-gray-200">{def.label} · {load.status === 'unsure' ? 'Unsure / needs verification' : label(load.status)}</p>
      <dl>{Object.keys(def.fields).filter(key => key in details).map(key => <div key={key} className="mt-1"><dt className="inline text-gray-400">{LABELS[key] || label(key)}{def.fields[key].unit ? ` (${def.fields[key].unit})` : ''}: </dt><dd className="inline"><Fact value={details[key]} /></dd></div>)}</dl>
      {text(load.note) && <p className="mt-2 whitespace-pre-wrap">Customer note: {text(load.note)}</p>}
    </li>
  })}</ul>
}
/** Explicit presentation allowlist: never enumerate or dump the private snapshot. */
export function PlannerOwnerSection({ details, attachments, loadingPhotos }: {
  details: PlannerOwnerDetails; attachments: AttachmentEntry[]; loadingPhotos: boolean
}) {
  const snapshot = object(details.snapshot), intent = object(snapshot.intent), service = object(snapshot.existing_service)
  const panel = object(snapshot.panel), concerns = object(panel.concerns), result = object(snapshot.result_states)
  const uncertainty = object(snapshot.uncertainty), recommendation = object(intent.reported_recommendation)
  const photos = details.photos.filter(photo => photo.registered === true)
  return <section aria-labelledby="planner-heading" className="border-t border-amber-700/40 pt-5 space-y-5 text-sm text-gray-300 break-words [overflow-wrap:anywhere]">
    <header><h3 id="planner-heading" className="font-bold text-amber-400 tracking-widest">PANEL PLANNER</h3><p className="mt-1 text-gray-200">Customer electrical picture</p></header>
    <Group title="Customer intent">
      <p>{list(intent.intents).length ? list(intent.intents).map(label).join(' · ') : 'Intent not specified'}</p>
      <p>Professional review: {snapshot.professional_review_requested === true ? 'Requested' : 'Not explicitly requested in Planner'}</p>
      {text(recommendation.source) && <p>Customer-reported recommendation: {label(recommendation.source)}{text(recommendation.note) && ` — ${text(recommendation.note)}`}</p>}
    </Group>
    <Group title="Existing service"><p>Reported main / service size: <Fact value={service.main_rating} amps /></p>
      {object(service.main_rating).value === 'other' && <p>Custom reported size: <Fact value={service.other_amps} amps /></p>}
    </Group>
    <Group title="Existing major loads"><Loads value={snapshot.existing_loads} /></Group>
    <Group title="Planned loads"><Loads value={snapshot.planned_loads} /></Group>
    <Group title="Panel condition"><p>Reported age: <Fact value={panel.age_band} /></p>
      <ul className="space-y-1">{taxonomy.CONCERN_IDS.filter(id => id in concerns).map(id => {
        const fact = object(concerns[id])
        return <li key={id}>{lookup(taxonomy.REASON_LABELS, `concern_${id}`)}: {fact.value === 'present' ? 'Reported concern' : fact.value === 'absent' ? 'No concern reported' : 'Unsure / unknown'} · {PROVENANCE[text(fact.provenance)] || 'Needs verification'}</li>
      })}</ul>
      {!Object.keys(concerns).length && <p>Observations unknown / not provided.</p>}
      {text(panel.note) && <p className="whitespace-pre-wrap">Customer panel note: {text(panel.note)}</p>}
      <p className="text-gray-400">Customer observations; equipment has not been inspected by Power On.</p>
    </Group>
    <Group title="PRELIMINARY WEBSITE GUIDANCE">
      <p>Capacity outlook: {lookup(taxonomy.CAPACITY_OUTLOOKS, result.capacity_outlook)}</p>
      <p>Condition outlook: {lookup(taxonomy.CONDITION_OUTLOOKS, result.condition_outlook)}</p>
      <ul className="list-disc pl-5">{[...list(result.capacity_reason_codes), ...list(result.condition_reason_codes)].map((reason, i) => <li key={i}>{lookup(taxonomy.REASON_LABELS, reason, 'Needs professional verification')}</li>)}</ul>
      <p className="text-gray-400">Preliminary website guidance based on customer information. This is not Power On’s final electrical determination. A professional must verify the system and proposed loads.</p>
      <p className="font-semibold">Known unknowns / needs verification</p>
      {list(uncertainty.known_unknowns).length ? <ul>{list(uncertainty.known_unknowns).map((unknown, i) => <li key={i}>{label(object(unknown).id)} · {PROVENANCE[text(object(unknown).reason)] || label(object(unknown).reason) || 'Needs verification'}</li>)}</ul> : <p>Professional verification still required.</p>}
      {list(uncertainty.help_requested).length > 0 && <p>Help requested: {list(uncertainty.help_requested).map(label).join(' · ')}</p>}
      <p className="font-semibold">Possible paths presented</p><ul>{list(result.paths_presented).map((path, i) => {
        const option = (taxonomy.PATHS as Record<string, {label: string; description: string}>)[text(path)]
        return option ? <li key={i} className="mt-1">{option.label} — {option.description}</li> : null
      })}</ul>
      <p>Next step: {lookup(taxonomy.NEXT_STEPS, result.next_step)}</p>
    </Group>
    <Group title="Customer request context">
      <p className="whitespace-pre-wrap">Customer note: {details.customer_note || 'None provided'}</p>
      <p>Preferred contact: {details.preferred_contact || 'Not specified'}</p>
      <p>Service request consent: {details.consent_granted ? 'Granted' : 'Not granted'} · {details.consent_version}</p>
      <p>Consent recorded: {new Date(details.consent_recorded_at).toLocaleString()}</p>
      <p>Submitted: {new Date(details.created_at).toLocaleString()}</p>
    </Group>
    <Group title={`Registered Planner photos (${photos.length})`}>
      {loadingPhotos && <p role="status">Loading Planner photos…</p>}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">{photos.map((photo, i) => {
        const entry = attachments.find(a => a.clientPhotoId === photo.client_photo_id)
        const category = (taxonomy.PHOTO_CATEGORIES as Record<string, {label: string}>)[text(photo.category)]?.label || 'Planner photo'
        const caption = text(photo.caption)
        return <figure key={text(photo.client_photo_id) || i} className="rounded-lg border border-gray-800 bg-gray-900 p-2">
          {entry?.signedUrl ? <a href={entry.signedUrl} target="_blank" rel="noopener noreferrer" aria-label={`Open ${category}${caption ? `: ${caption}` : ''}`}><img src={entry.signedUrl} alt={`${category}${caption ? ` — ${caption}` : ''}; not reviewed`} loading="lazy" className="w-full h-32 object-cover rounded" /></a> : !loadingPhotos && <p>Photo preview unavailable</p>}
          <figcaption className="mt-2">{category}{caption && <p className="whitespace-pre-wrap">{caption}</p>}<p className="text-amber-300">Not reviewed</p></figcaption>
        </figure>
      })}</div>
    </Group>
  </section>
}
