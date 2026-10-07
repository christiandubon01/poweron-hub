import React, { useState } from 'react'
import type { PlannerOwnerDetails } from '@/services/portal/plannerDetails'
import { formatAttachmentDiagnostic, isNetlifyDeployPreview, type AttachmentEntry, type AttachmentReadDiagnostic } from '@/services/portal/portalStorageService'
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
  return <section className="min-w-0 rounded-xl border border-gray-800 bg-gray-900/40 p-4 space-y-3"><h4 className="text-xs font-bold text-amber-300 uppercase tracking-wide">{title}</h4>{children}</section>
}
function Loads({ value }: { value: unknown }) {
  if (!list(value).length) return <p>No equipment reported.</p>
  return <ul className="space-y-3">{list(value).map((item, i) => {
    const load = object(item)
    const def = (taxonomy.LOAD_TYPES as Record<string, {label: string; fields: Record<string, {unit?: string}>}>)[text(load.type)]
    if (!def) return null
    const details = object(load.details)
    return <li key={i} className="rounded-lg bg-gray-900 border border-gray-800 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2"><p className="font-semibold text-gray-200">{def.label}</p><span className="rounded-md bg-gray-800 px-2 py-1 text-xs text-gray-300">{load.status === 'unsure' ? 'Unsure / needs verification' : label(load.status)}</span></div>
      <dl>{Object.keys(def.fields).filter(key => key in details).map(key => <div key={key} className="mt-1"><dt className="inline text-gray-400">{LABELS[key] || label(key)}{def.fields[key].unit ? ` (${def.fields[key].unit})` : ''}: </dt><dd className="inline"><Fact value={details[key]} /></dd></div>)}</dl>
      {text(load.note) && <p className="mt-2 whitespace-pre-wrap">Customer note: {text(load.note)}</p>}
    </li>
  })}</ul>
}
function SummaryTile({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="min-w-0 rounded-lg border border-amber-800/25 bg-gray-950/60 p-3"><p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-amber-300/80">{title}</p><div className="text-sm font-medium leading-relaxed text-gray-100">{children}</div></div>
}
function PlannerPhoto({ photo, entry, loading, diagnostic }: { photo: Record<string, unknown>; entry?: AttachmentEntry; loading: boolean; diagnostic?: AttachmentReadDiagnostic | null }) {
  const [failed, setFailed] = useState(false)
  const category = (taxonomy.PHOTO_CATEGORIES as Record<string, {label: string}>)[text(photo.category)]?.label || 'Planner photo'
  const caption = text(photo.caption)
  const showDiagnostic = !loading && (!entry?.signedUrl || failed) && diagnostic && typeof window !== 'undefined' && isNetlifyDeployPreview(window.location.hostname)
  return <figure className="min-w-0 self-start overflow-hidden rounded-xl border border-gray-800 bg-gray-900">
    {entry?.signedUrl && !failed ? <a href={entry.signedUrl} target="_blank" rel="noopener noreferrer" aria-label={`Open ${category}${caption ? `: ${caption}` : ''}`} className="block focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400"><img src={entry.signedUrl} alt={`${category}${caption ? ` — ${caption}` : ''}; not reviewed`} onError={() => setFailed(true)} loading="lazy" className="w-full aspect-[4/3] object-cover" /></a> : <p className="px-3 pt-3 text-xs text-gray-400">{loading ? 'Loading photo…' : 'Photo preview unavailable'}</p>}
    {showDiagnostic && <p className="px-3 pt-2 text-[10px] leading-relaxed text-gray-500">{formatAttachmentDiagnostic(diagnostic)}</p>}
    <figcaption className="p-3 space-y-1"><p className="font-medium text-gray-200">{category}</p>{caption && <p className="text-xs whitespace-pre-wrap text-gray-400">{caption}</p>}<span className="inline-block rounded-md border border-amber-800/40 bg-amber-950/40 px-2 py-1 text-[10px] font-medium text-amber-300">Not reviewed</span></figcaption>
  </figure>
}
/** Explicit presentation allowlist: never enumerate or dump the private snapshot. */
export function PlannerOwnerSection({ details, attachments, loadingPhotos, diagnostic }: {
  details: PlannerOwnerDetails; attachments: AttachmentEntry[]; loadingPhotos: boolean; diagnostic?: AttachmentReadDiagnostic | null
}) {
  const snapshot = object(details.snapshot), intent = object(snapshot.intent), service = object(snapshot.existing_service)
  const panel = object(snapshot.panel), concerns = object(panel.concerns), result = object(snapshot.result_states)
  const uncertainty = object(snapshot.uncertainty), recommendation = object(intent.reported_recommendation)
  const photos = details.photos.filter(photo => photo.registered === true)
  const reviewRequested = snapshot.professional_review_requested === true
  const serviceFact = object(service.main_rating).value === 'other' ? service.other_amps : service.main_rating
  return <section aria-labelledby="planner-heading" className="border-t border-amber-700/40 pt-5 space-y-4 text-sm text-gray-300 break-words [overflow-wrap:anywhere]">
    <header data-testid="planner-overview" className="rounded-2xl border border-amber-700/35 bg-gradient-to-br from-amber-950/30 via-gray-900 to-gray-950 p-4 sm:p-5">
      <div className="mb-4"><h3 id="planner-heading" className="text-xs font-bold text-amber-400 tracking-widest">PANEL PLANNER</h3><p className="mt-1 text-xl font-semibold tracking-tight text-gray-100">Customer electrical picture</p><p className="mt-1 text-xs text-gray-400">Customer-reported information · Preliminary website guidance</p></div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <SummaryTile title="Service"><Fact value={serviceFact} amps /></SummaryTile>
        <SummaryTile title="Capacity"><p>{lookup(taxonomy.CAPACITY_OUTLOOKS, result.capacity_outlook)}</p><p className="mt-1 text-xs font-normal text-amber-300/80">Preliminary · Needs professional verification</p></SummaryTile>
        <SummaryTile title="Condition"><p>{lookup(taxonomy.CONDITION_OUTLOOKS, result.condition_outlook)}</p><p className="mt-1 text-xs font-normal text-amber-300/80">Preliminary · Not inspected</p></SummaryTile>
        <SummaryTile title="Review">{reviewRequested ? 'Professional review requested' : 'Not explicitly requested in Planner'}</SummaryTile>
      </div>
    </header>
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <Group title="Customer intent">
        <div className="flex flex-wrap gap-2">{list(intent.intents).length ? list(intent.intents).map((value, i) => <span key={i} className="rounded-full border border-gray-700 bg-gray-800/60 px-3 py-1 text-xs text-gray-200">{label(value)}</span>) : <p>Intent not specified</p>}</div>
        <p className="rounded-lg border border-amber-800/40 bg-amber-950/25 px-3 py-2 font-medium text-amber-200">Professional review: {reviewRequested ? 'Requested' : 'Not explicitly requested in Planner'}</p>
        {text(recommendation.source) && <p className="text-xs leading-relaxed">Customer-reported recommendation: {label(recommendation.source)}{text(recommendation.note) && ` — ${text(recommendation.note)}`}</p>}
      </Group>
      <Group title="Existing service"><p>Reported main / service size: <Fact value={service.main_rating} amps /></p>
        {object(service.main_rating).value === 'other' && <p>Custom reported size: <Fact value={service.other_amps} amps /></p>}
      </Group>
    </div>
    <div data-testid="planner-load-columns" className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <Group title="Existing major loads"><Loads value={snapshot.existing_loads} /></Group>
      <Group title="Planned loads"><Loads value={snapshot.planned_loads} /></Group>
    </div>
    <Group title="Panel condition"><p>Reported age: <Fact value={panel.age_band} /></p>
      <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2">{taxonomy.CONCERN_IDS.filter(id => id in concerns).map(id => {
        const fact = object(concerns[id])
        return <li key={id} className="rounded-lg border border-gray-800 bg-gray-950/50 p-3"><p className="font-medium text-gray-200">{lookup(taxonomy.REASON_LABELS, `concern_${id}`)}</p><p className="mt-1 text-xs text-amber-200">{fact.value === 'present' ? 'Reported concern' : fact.value === 'absent' ? 'No concern reported' : 'Unsure / unknown'}</p><p className="mt-1 text-xs text-gray-400">{PROVENANCE[text(fact.provenance)] || 'Needs verification'}</p></li>
      })}</ul>
      {!Object.keys(concerns).length && <p>Observations unknown / not provided.</p>}
      {text(panel.note) && <p className="whitespace-pre-wrap">Customer panel note: {text(panel.note)}</p>}
      <p className="text-xs leading-relaxed text-gray-400">Customer observations; equipment has not been inspected by Power On.</p>
    </Group>
    <section aria-labelledby="planner-guidance-heading" className="rounded-xl border border-amber-700/40 bg-amber-950/15 p-4 sm:p-5 space-y-4">
      <h4 id="planner-guidance-heading" className="text-xs font-bold tracking-wide text-amber-300">PRELIMINARY WEBSITE GUIDANCE</h4>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <SummaryTile title="Capacity outlook">{lookup(taxonomy.CAPACITY_OUTLOOKS, result.capacity_outlook)}</SummaryTile>
        <SummaryTile title="Condition outlook">{lookup(taxonomy.CONDITION_OUTLOOKS, result.condition_outlook)}</SummaryTile>
      </div>
      <p className="text-xs leading-relaxed text-gray-400">Preliminary website guidance based on customer information. This is not Power On’s final electrical determination. A professional must verify the system and proposed loads.</p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div><h5 className="mb-2 text-xs font-semibold uppercase text-amber-200">Why</h5><ul className="list-disc pl-4 space-y-2 text-xs leading-relaxed">{[...list(result.capacity_reason_codes), ...list(result.condition_reason_codes)].map((reason, i) => <li key={i}>{lookup(taxonomy.REASON_LABELS, reason, 'Needs professional verification')}</li>)}</ul></div>
        <div><h5 className="mb-2 text-xs font-semibold text-amber-200">Known unknowns / needs verification</h5>
          {list(uncertainty.known_unknowns).length ? <ul className="space-y-2">{list(uncertainty.known_unknowns).map((unknown, i) => <li key={i} className="rounded-lg border border-gray-800 bg-gray-950/50 px-3 py-2 text-xs">{label(object(unknown).id)} · {PROVENANCE[text(object(unknown).reason)] || label(object(unknown).reason) || 'Needs verification'}</li>)}</ul> : <p className="text-xs">Professional verification still required.</p>}
          {list(uncertainty.help_requested).length > 0 && <p className="mt-2 text-xs">Help requested: {list(uncertainty.help_requested).map(label).join(' · ')}</p>}
        </div>
      </div>
      <div><h5 className="mb-2 text-xs font-semibold text-amber-200">Possible paths presented</h5><ul data-testid="planner-paths" className="grid grid-cols-1 sm:grid-cols-2 gap-2">{list(result.paths_presented).map((path, i) => {
        const option = (taxonomy.PATHS as Record<string, {label: string; description: string}>)[text(path)]
        return option ? <li key={i} className="rounded-lg border border-amber-900/40 bg-gray-950/60 p-3"><p className="text-sm font-medium text-gray-200">{option.label}</p><p className="mt-1 text-xs leading-relaxed text-gray-400">{option.description}</p></li> : null
      })}</ul></div>
      <p className="rounded-lg border border-amber-700/35 bg-amber-900/20 p-3 font-medium text-amber-100">Next step: {lookup(taxonomy.NEXT_STEPS, result.next_step)}</p>
    </section>
    <Group title="Customer request context">
      <p className="rounded-lg border border-gray-800 bg-gray-950/50 p-3 whitespace-pre-wrap">Customer note: {details.customer_note || 'None provided'}</p>
      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
        <div><dt className="text-gray-400">Preferred contact: </dt><dd className="mt-1 text-gray-200">{details.preferred_contact || 'Not specified'}</dd></div>
        <div><dt className="text-gray-400">Service request consent: </dt><dd className="mt-1 text-gray-200">{details.consent_granted ? 'Granted' : 'Not granted'}</dd></div>
        <div><dt className="text-gray-400">Consent version</dt><dd className="mt-1 text-gray-400">{details.consent_version}</dd></div>
        <div><dt className="text-gray-400">Consent recorded: </dt><dd className="mt-1 text-gray-200">{new Date(details.consent_recorded_at).toLocaleString()}</dd></div>
        <div><dt className="text-gray-400">Submitted: </dt><dd className="mt-1 text-gray-200">{new Date(details.created_at).toLocaleString()}</dd></div>
      </dl>
    </Group>
    <Group title={`Registered Planner photos (${photos.length})`}>
      {loadingPhotos && <p role="status">Loading Planner photos…</p>}
      <div data-testid="planner-photo-grid" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">{photos.map((photo, i) => {
        const entry = attachments.find(a => a.clientPhotoId === photo.client_photo_id)
        return <PlannerPhoto key={`${text(photo.client_photo_id) || i}/${entry?.signedUrl || ''}`} photo={photo} entry={entry} loading={loadingPhotos} diagnostic={diagnostic} />
      })}</div>
    </Group>
  </section>
}
