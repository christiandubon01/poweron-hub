'use strict';
const T = require('./planner-taxonomy.json');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SECRET = /^[0-9a-f]{64}$/;
const MAX_BYTES = 10 * 1024 * 1024;
const STATUS = {
  INVALID_PAYLOAD: 422, CONTACT_REQUIRED: 422, INVALID_CONTACT: 422, CONSENT_REQUIRED: 422,
  UNSUPPORTED_SCHEMA: 422, ORIGIN_DENIED: 403, CAPABILITY_INVALID: 403, REQUEST_UNAVAILABLE: 404,
  IDEMPOTENCY_CONFLICT: 409, FINALIZATION_CONFLICT: 409, PHOTO_REQUEST_CLOSED: 409,
  PHOTO_WINDOW_EXPIRED: 410, RECOVERY_EXPIRED: 410, SNAPSHOT_TOO_LARGE: 413,
  PHOTO_TOO_LARGE: 413, PHOTO_TYPE_INVALID: 422, PHOTO_COUNT_EXCEEDED: 422,
  PHOTO_OBJECT_INVALID: 422, RATE_LIMITED: 429, TEMPORARILY_UNAVAILABLE: 503
};
class PlannerError extends Error {
  constructor(code) { super(code); this.code = code; }
}
const fail = (code = 'INVALID_PAYLOAD') => { throw new PlannerError(code); };
const record = x => x !== null && typeof x === 'object' && !Array.isArray(x);
function shape(x, required, optional = []) {
  if (!record(x) || required.some(k => !Object.hasOwn(x, k)) ||
      Object.keys(x).some(k => !required.includes(k) && !optional.includes(k))) fail();
}
function text(x, max, nullable = false) {
  if (nullable && x === null) return;
  if (typeof x !== 'string' || x.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(x)) fail();
}
function choice(x, values, nullable = false) {
  if (!(nullable && x === null) && !values.includes(x)) fail();
}
function list(x, max) { if (!Array.isArray(x) || x.length > max) fail(); }
function unique(x) { if (new Set(x).size !== x.length) fail(); }
function ids(x) { list(x, 10); unique(x); if (x.some(id => typeof id!=='string' || !UUID.test(id))) fail(); }
function fact(x, test) {
  shape(x, ['value', 'provenance']); choice(x.provenance, T.PROVENANCE_VALUES);
  if (x.value === null) {
    if (!['unknown', 'verification_required'].includes(x.provenance)) fail();
  } else {
    if (x.provenance === 'unknown' || !test(x.value)) fail();
  }
}
function numberRange(v, min, max) { return typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max; }
function detail(v, d) {
  if (d.kind === 'number') return numberRange(v, d.min, d.max);
  if (d.kind === 'enum') return d.options.includes(v);
  return typeof v === 'string' && v.length <= d.maxLength;
}
function loads(xs, scope) {
  list(xs, 100);
  for (const l of xs) {
    shape(l, ['type', 'status', 'origin', 'details', 'note']);
    if (typeof l.type !== 'string' || !Object.hasOwn(T.LOAD_TYPES,l.type)) fail();
    const def = T.LOAD_TYPES[l.type];
    if (!def || !def.appliesTo.includes(scope)) fail();
    choice(l.status, T.LOAD_STATUSES[scope]); choice(l.origin, ['intent_seed', 'customer_selected']);
    shape(l.details, [], Object.keys(def.fields)); text(l.note, 500);
    for (const [k, v] of Object.entries(l.details)) fact(v, n => detail(n, def.fields[k]));
  }
}
function validatePayload(p) {
  if (p?.schema_version !== 1) fail('UNSUPPORTED_SCHEMA');
  if (Buffer.byteLength(JSON.stringify(p), 'utf8') > 131072) fail('SNAPSHOT_TOO_LARGE');
  shape(p, ['schema_version', 'lead_type', 'client', 'submission', 'customer', 'intent', 'context',
    'existing_service', 'existing_loads', 'planned_loads', 'panel', 'photos', 'uncertainty',
    'result_states', 'professional_review_requested', 'attribution']);
  if (p.lead_type !== 'panel_planner' || p.client !== 'panel-planner-web-v1') fail();
  shape(p.submission, ['page_url', 'idempotency_key', 'consent']);
  text(p.submission.page_url, 2048, true);
  if (p.submission.page_url !== null) {
    let url; try { url = new URL(p.submission.page_url); } catch { fail(); }
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) fail();
  }
  if (typeof p.submission.idempotency_key !== 'string' || !UUID.test(p.submission.idempotency_key)) fail();
  if (p.submission.consent !== true) fail('CONSENT_REQUIRED');
  shape(p.customer, [], ['name', 'phone', 'email', 'address', 'city', 'preferred_contact']);
  const c = p.customer;
  for (const k of ['name', 'phone', 'email', 'address', 'city']) {
    if (Object.hasOwn(c, k)) { try { text(c[k], k === 'phone' ? 30 : 200); } catch { fail('INVALID_CONTACT'); } }
  }
  if (!c.name?.trim() || (!c.phone?.trim() && !c.email?.trim())) fail('CONTACT_REQUIRED');
  if (c.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email.trim())) fail('INVALID_CONTACT');
  if (c.phone) {
    const digits = c.phone.replace(/\D/g, '');
    if (!/^[+()\-\s.\d]+$/.test(c.phone) || digits.length < 7 || digits.length > 15) fail('INVALID_CONTACT');
  }
  if (c.preferred_contact !== undefined) {
    choice(c.preferred_contact, T.CONTACT_METHODS, true);
    if (['phone','text'].includes(c.preferred_contact) && !c.phone?.trim()) fail('INVALID_CONTACT');
    if (c.preferred_contact === 'email' && !c.email?.trim()) fail('INVALID_CONTACT');
  }
  shape(p.intent, ['intents', 'customer_type', 'reported_recommendation']);
  list(p.intent.intents, T.INTENT_IDS.length); unique(p.intent.intents);
  p.intent.intents.forEach(x => choice(x, T.INTENT_IDS));
  choice(p.intent.customer_type, T.CUSTOMER_TYPES, true);
  if (p.intent.reported_recommendation !== null) {
    shape(p.intent.reported_recommendation, ['source','note']);
    choice(p.intent.reported_recommendation.source, T.RECOMMENDATION_SOURCES);
    text(p.intent.reported_recommendation.note, 300);
  }
  shape(p.context, ['home_size_range']);
  fact(p.context.home_size_range, v => T.HOME_SIZE_RANGES.includes(v));
  shape(p.existing_service, ['main_rating', 'other_amps']);
  fact(p.existing_service.main_rating, v => T.SERVICE_RATINGS.includes(v));
  fact(p.existing_service.other_amps, v => numberRange(v, 30, 1200));
  if (p.existing_service.other_amps.value !== null && p.existing_service.main_rating.value !== 'other') fail();
  loads(p.existing_loads, 'existing'); loads(p.planned_loads, 'planned');
  shape(p.panel, ['age_band', 'concerns', 'note']);
  fact(p.panel.age_band, v => T.AGE_BANDS.includes(v));
  shape(p.panel.concerns, [], T.CONCERN_IDS); text(p.panel.note, 500);
  Object.values(p.panel.concerns).forEach(v => fact(v, n => ['present','absent'].includes(n)));
  if (Array.isArray(p.photos) && p.photos.length > 10) fail('PHOTO_COUNT_EXCEEDED');
  list(p.photos, 10);
  for (const photo of p.photos) {
    shape(photo, ['category','caption','file_name','mime_type','size_bytes','upload_state','review_state']);
    choice(photo.category, Object.keys(T.PHOTO_CATEGORIES)); text(photo.caption, 200); text(photo.file_name,120,true);
    if (!['image/jpeg','image/png','image/webp'].includes(photo.mime_type)) fail('PHOTO_TYPE_INVALID');
    if (!Number.isInteger(photo.size_bytes) || photo.size_bytes <= 0) fail();
    if (photo.size_bytes > MAX_BYTES) fail('PHOTO_TOO_LARGE');
    choice(photo.upload_state, T.PHOTO_UPLOAD_STATES);
    if (photo.review_state !== 'not_reviewed') fail();
  }
  shape(p.uncertainty, ['known_unknowns','help_requested']);
  list(p.uncertainty.known_unknowns, 1000);
  for (const u of p.uncertainty.known_unknowns) {
    shape(u, ['id','reason']); text(u.id,200);
    if (!/^[a-zA-Z0-9_.:-]+$/.test(u.id)) fail();
    choice(u.reason, ['unknown','needs_verification','estimated','not_provided','unsure']);
  }
  list(p.uncertainty.help_requested, T.HELP_TOPICS.length); unique(p.uncertainty.help_requested);
  p.uncertainty.help_requested.forEach(x => choice(x,T.HELP_TOPICS));
  const r = p.result_states;
  shape(r, ['source','determination','ruleset','capacity_outlook','capacity_reason_codes','condition_outlook',
    'condition_reason_codes','prompt_contact_suggested','paths_presented','next_step']);
  if (r.source !== 'client_derived' || r.determination !== 'preliminary') fail();
  shape(r.ruleset, ['id','version','status']);
  if (r.ruleset.id !== 'workflow-only' || r.ruleset.version !== 'workflow-0.2' || r.ruleset.status !== 'unvalidated') fail();
  choice(r.capacity_outlook, ['not_assessed','more_information_needed','evaluation_recommended']);
  choice(r.condition_outlook, ['not_assessed','no_concerns_reported','more_information_needed','evaluation_recommended']);
  for (const k of ['capacity_reason_codes','condition_reason_codes']) {
    list(r[k], 100); r[k].forEach(x => choice(x,Object.keys(T.REASON_LABELS)));
  }
  list(r.paths_presented, Object.keys(T.PATHS).length); unique(r.paths_presented);
  r.paths_presented.forEach(x => choice(x,Object.keys(T.PATHS)));
  choice(r.next_step,Object.keys(T.NEXT_STEPS));
  if (typeof r.prompt_contact_suggested !== 'boolean' || typeof p.professional_review_requested !== 'boolean') fail();
  shape(p.attribution, [], T.ATTRIBUTION_KEYS);
  Object.values(p.attribution).forEach(x => text(x,512));
  // Preserve client-derived markers. A reported/instrument claim is never server verification.
  return p;
}
function validateEnvelope(b) {
  if (!record(b) || b.contract_version !== 1) fail('UNSUPPORTED_SCHEMA');
  const fields = {
    create: ['site_key','idempotency_key','recovery_token','planner_payload','customer_note','consent_version','photo_manifest'],
    recover: ['site_key','idempotency_key','recovery_token'],
    authorize_photos: ['request_id','recovery_token','authorization_key','photo_ids'],
    finalize_photos: ['request_id','recovery_token','finalization_key','authorization_id','photo_ids','close_photos'],
    read_photos: ['request_id','recovery_token']
  };
  if (typeof b.action !== 'string' || !Object.hasOwn(fields,b.action)) fail();
  shape(b, ['contract_version','action',...fields[b.action]]);
  if (typeof b.recovery_token !== 'string' || !SECRET.test(b.recovery_token)) fail('CAPABILITY_INVALID');
  for (const k of ['idempotency_key','request_id','authorization_key','finalization_key','authorization_id']) {
    if (Object.hasOwn(b,k) && (typeof b[k] !== 'string' || !UUID.test(b[k]))) fail();
  }
  if (Object.hasOwn(b,'site_key') && (typeof b.site_key !== 'string' || !SITE_KEY.test(b.site_key))) fail();
  if (b.action === 'create') {
    validatePayload(b.planner_payload);
    if (b.planner_payload.submission.idempotency_key !== b.idempotency_key) fail();
    if (b.consent_version !== 'panel_planner_contact_v1') fail('CONSENT_REQUIRED');
    text(b.customer_note,5000,true);
    if (!Array.isArray(b.photo_manifest) || b.photo_manifest.length > 10 || b.planner_payload.photos.length > 10) fail('PHOTO_COUNT_EXCEEDED');
    if (b.photo_manifest.length !== b.planner_payload.photos.length) fail();
    const seen = new Set();
    b.photo_manifest.forEach(m => {
      shape(m,['client_photo_id','payload_photo_index']);
      if (typeof m.client_photo_id !== 'string' || !UUID.test(m.client_photo_id) || !Number.isInteger(m.payload_photo_index) ||
          !b.planner_payload.photos[m.payload_photo_index] || seen.has(m.payload_photo_index)) fail();
      seen.add(m.payload_photo_index);
    });
    unique(b.photo_manifest.map(m=>m.client_photo_id));
  }
  if (['authorize_photos','finalize_photos'].includes(b.action)) ids(b.photo_ids);
  if (b.action === 'authorize_photos' && b.photo_ids.length === 0) fail();
  if (b.action === 'finalize_photos' && (typeof b.close_photos !== 'boolean' || (!b.close_photos && b.photo_ids.length === 0))) fail();
  return b;
}
const SITE_KEY = /^ps_[a-z0-9]{24,64}$/;
/** Bootstrap origins (Power On) plus the one exact preview origin. Per-site origins live in
 *  portal_site_integrations; the handler unions those in and the RPCs enforce the per-site match. */
function allowedOrigins(env) {
  const set = new Set(['https://poweronsolutionsllc.com','https://www.poweronsolutionsllc.com','https://app.poweronsolutionsllc.com']);
  if (env.PANEL_PLANNER_PREVIEW_ORIGIN) {
    const raw = env.PANEL_PLANNER_PREVIEW_ORIGIN;
    let u; try { u=new URL(raw); } catch { return set; }
    if (u.protocol === 'https:' && u.origin === raw && !raw.includes('*')) set.add(raw);
  }
  return set;
}
module.exports = { SITE_KEY, PlannerError, STATUS, UUID, MAX_BYTES, validatePayload, validateEnvelope, allowedOrigins };
