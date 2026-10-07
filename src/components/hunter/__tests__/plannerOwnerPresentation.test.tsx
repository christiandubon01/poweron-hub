// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { PortalInbox } from '../PortalInbox'
import { PlannerOwnerSection } from '../PlannerOwnerSection'
import payload from '@/__tests__/fixtures/planner-payload-v1.json'

const mocks = vi.hoisted(() => ({ requests: vi.fn(), convert: vi.fn(), dismiss: vi.fn(), details: vi.fn(), attachments: vi.fn(), session: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ supabase: { auth: { getSession: mocks.session } } }))
vi.mock('@/services/portal/portalService', () => ({ fetchNewPortalRequests: mocks.requests, convertToLead: mocks.convert, dismissPortalRequest: mocks.dismiss }))
vi.mock('@/services/portal/plannerDetails', () => ({ getPlannerOwnerDetails: mocks.details }))
vi.mock('@/services/portal/portalStorageService', async original => ({ ...await original<object>(), fetchAttachmentSignedUrls: mocks.attachments }))
vi.mock('@/services/referral/referralService', () => ({ fetchReferralClaimForRequest: async () => null }))
vi.mock('@/utils/googleMapsLoader', () => ({ GOOGLE_MAPS_BROWSER_KEY: '', loadV15rGoogleMapsScript: vi.fn() }))
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
const req = { id: 'request-one', name: 'Owner test', request_type: 'homeowner', service_category: 'panel_upgrade', description: 'Normal description', phone: '7605550100', email: 'test@example.com', notes: null, created_at: '2026-10-07T12:00:00Z' }
function details() {
  return { request_id: req.id, schema_version: 1, snapshot: {
    ...payload, intent: { intents: ['ev_charger', 'existing_panel_concern'], reported_recommendation: { source: 'inspector', note: 'Check capacity' } },
    professional_review_requested: true,
    existing_service: {main_rating:{value:'other',provenance:'customer_known'},other_amps:{value:225,provenance:'customer_estimated'}},
    existing_loads: [{type:'central_hvac',status:'present',details:{tonnage:{value:3,provenance:'customer_estimated'}},note:'Upstairs unit'}],
    planned_loads: [{type:'ev_charging',status:'considering',details:{},note:'New vehicle'}],
    panel: {age_band:{value:'25_40',provenance:'customer_estimated'}, concerns:{corrosion:{value:'present',provenance:'customer_known'},damage_visible:{value:'absent',provenance:'customer_known'},buzzing_unusual_sound:{value:null,provenance:'unknown'}},note:'Outside panel'},
    result_states:{...payload.result_states,capacity_outlook:'evaluation_recommended',condition_outlook:'more_information_needed',capacity_reason_codes:['service_rating_estimated'],next_step:'request_professional_review'},
    recovery_token_hash:'RECOVERY_SECRET',payload_digest:'DIGEST_SECRET',photo_transport:{object_path:'PRIVATE_PATH'},submission:{idempotency_key:'PRIVATE_KEY'},tenant_id:'PRIVATE_TENANT',provider_secret:'PROVIDER_SECRET',
  }, customer_note:'Please call after work', preferred_contact:'phone', consent_granted:true,consent_version:'panel_planner_contact_v1',consent_recorded_at:req.created_at,created_at:req.created_at,
  photos:[{client_photo_id:'photo-one',category:'panel_label',caption:'Panel label close-up',registered:true},{client_photo_id:'photo-two',category:'other_equipment',caption:'UNREGISTERED',registered:false}] }
}
let host: HTMLDivElement, root: Root
async function flush() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) }) }
async function render(element: React.ReactNode) { await act(async () => root.render(element)); await flush() }
async function open() { await render(<PortalInbox />); await act(async () => { Array.from(host.querySelectorAll('button')).find(b => b.textContent?.includes('Owner test'))!.click() }); await flush() }
const button = (name: string) => Array.from(host.querySelectorAll('button')).find(b => b.textContent === name)!
beforeEach(() => {
  vi.clearAllMocks(); host=document.createElement('div');document.body.appendChild(host);root=createRoot(host)
  mocks.requests.mockResolvedValue([req]);mocks.details.mockResolvedValue(null);mocks.attachments.mockResolvedValue([])
  mocks.session.mockResolvedValue({data:{session:{access_token:'owner-jwt'}}});mocks.convert.mockResolvedValue('lead-one');mocks.dismiss.mockResolvedValue(undefined)
})
afterEach(() => { act(() => root.unmount());host.remove() })
describe('Current Portal Inbox Planner presentation', () => {
  it('keeps ordinary contact/description/actions and hides the Planner section after null RPC', async () => {
    await open();expect(mocks.details).toHaveBeenCalledWith(req.id)
    expect(host.textContent).toContain('Normal description');expect(host.querySelector('a[href="mailto:test@example.com"]')).not.toBeNull()
    expect(host.querySelector('#planner-heading')).toBeNull();expect(button('Convert to Lead')).toBeDefined();expect(button('Dismiss')).toBeDefined()
  })
  it('probes only when the owner opens the existing modal; loading is announced', async () => {
    mocks.details.mockReturnValue(new Promise(() => {}));await render(<PortalInbox />);expect(mocks.details).not.toHaveBeenCalled()
    await act(async () => { Array.from(host.querySelectorAll('button')).find(b => b.textContent?.includes('Owner test'))!.click() })
    expect(host.querySelector('[role="status"]')?.textContent).toContain('Checking Planner details');expect(button('Convert to Lead').disabled).toBe(false)
  })
  it('sanitizes failed/unauthorized detail retrieval and leaves Dismiss usable', async () => {
    mocks.details.mockRejectedValue(new Error('RECOVERY_SECRET PRIVATE_PATH'));await open()
    expect(host.textContent).toContain('Planner details unavailable');expect(host.innerHTML).not.toContain('RECOVERY_SECRET');expect(host.innerHTML).not.toContain('PRIVATE_PATH')
    await act(async () => button('Dismiss').click());expect(mocks.dismiss).toHaveBeenCalledWith(req.id)
  })
  it('detects Planner by RPC even with no description marker and loads authenticated photos', async () => {
    mocks.details.mockResolvedValue(details());await open();expect(host.querySelector('#planner-heading')).not.toBeNull()
    expect(mocks.attachments).toHaveBeenCalledWith(req.id,'owner-jwt')
  })
  it('never falls back to anonymous attachment reads without an owner session', async () => {
    mocks.details.mockResolvedValue(details());mocks.session.mockResolvedValue({data:{session:null}});await open();expect(mocks.attachments).not.toHaveBeenCalled()
  })
  it('renders intent, service/custom amps/provenance, load details and customer notes', async () => {
    await render(<PlannerOwnerSection details={details() as any} attachments={[]} loadingPhotos={false} />)
    for(const value of ['EV charging','Professional review: Requested','Customer reported','225 A','Customer estimate','Central heating & cooling','3','Upstairs unit','New vehicle'])expect(host.textContent).toContain(value)
  })
  it('distinguishes reported/absent/unknown observations without diagnosis and shows age', async () => {
    await render(<PlannerOwnerSection details={details() as any} attachments={[]} loadingPhotos={false} />)
    for(const value of ['25–40 years','Reported concern','No concern reported','Unsure / unknown','Outside panel','has not been inspected'])expect(host.textContent).toContain(value)
  })
  it('labels preliminary outcomes, reasons, unknowns, possible paths and next step', async () => {
    await render(<PlannerOwnerSection details={details() as any} attachments={[]} loadingPhotos={false} />)
    for(const value of ['PRELIMINARY WEBSITE GUIDANCE','Further capacity evaluation recommended','More information needed about the equipment','The service size is an estimate','Known unknowns / needs verification','Gather a little more information','Ask Power On to review this','not Power On’s final'])expect(host.textContent).toContain(value)
  })
  it('shows customer request context and consent/submitted timestamp', async () => {
    await render(<PlannerOwnerSection details={details() as any} attachments={[]} loadingPhotos={false} />)
    for(const value of ['Please call after work','Preferred contact: phone','Granted','panel_planner_contact_v1','Consent recorded:','Submitted:'])expect(host.textContent).toContain(value)
  })
  it('renders registered photo thumbnail/category/caption, Not reviewed; excludes private fields', async () => {
    await render(<PlannerOwnerSection details={details() as any} attachments={[{clientPhotoId:'photo-one',signedUrl:'https://signed.example/photo',displayName:'Attachment',mimeType:'image/png',expiresAt:null}]} loadingPhotos={false} />)
    expect(host.textContent).toContain('Registered Planner photos (1)');expect(host.textContent).toContain('Panel label close-up');expect(host.textContent).toContain('Not reviewed')
    expect(host.querySelector('img')?.alt).toContain('Panel label close-up');expect(host.querySelector('a')?.href).toBe('https://signed.example/photo')
    for(const value of ['UNREGISTERED','RECOVERY_SECRET','DIGEST_SECRET','PRIVATE_PATH','PRIVATE_KEY','PRIVATE_TENANT','PROVIDER_SECRET'])expect(host.innerHTML).not.toContain(value)
  })
  it('keeps Convert to Lead callback/arguments unchanged for Planner', async () => {
    mocks.details.mockResolvedValue(details());const converted=vi.fn();await render(<PortalInbox onLeadConverted={converted} />)
    await act(async () => Array.from(host.querySelectorAll('button')).find(b => b.textContent?.includes('Owner test'))!.click());await flush()
    await act(async () => button('Convert to Lead').click());expect(mocks.convert).toHaveBeenCalledWith(req);expect(converted).toHaveBeenCalledOnce()
  })
  it.each([
    ['customer_known','Customer reported'],['customer_estimated','Customer estimate'],
    ['unknown','Unknown'],['verification_required','Needs verification'],
    ['inferred_preliminary','Preliminary website assumption'],['measured','Measured claim'],
  ])('keeps %s provenance without upgrading it to verification',async(provenance,expected)=>{
    const d=details();d.snapshot.existing_service.main_rating={value:200,provenance} as any
    await render(<PlannerOwnerSection details={d as any} attachments={[]} loadingPhotos={false} />)
    expect(host.textContent).toContain(expected);expect(host.textContent).not.toContain('Power On verified')
  })
  it('shows the four overview tiles and wider responsive modal without hiding information',async()=>{
    mocks.details.mockResolvedValue(details());await open()
    const overview=host.querySelector('[data-testid="planner-overview"]')!
    for(const title of ['Service','Capacity','Condition','Review'])expect(overview.textContent).toContain(title)
    expect(overview.textContent).toContain('225 A');expect(overview.textContent).toContain('Customer estimate')
    expect(overview.textContent).toContain('Preliminary');expect(overview.textContent).toContain('Not inspected')
    expect(host.querySelector('[role="dialog"]')!.className).toContain('max-w-[920px]')
    expect(host.querySelector('[data-testid="planner-load-columns"]')!.className).toContain('md:grid-cols-2')
    expect(host.querySelector('[data-testid="planner-photo-grid"]')!.className).toContain('lg:grid-cols-3')
    expect(button('Convert to Lead')).toBeDefined();expect(button('Dismiss')).toBeDefined()
  })
  it('retains every possible path title and explanation in separate responsive cards',async()=>{
    const d=details()
    const taxonomy=JSON.parse(readFileSync('netlify/functions/lib/planner-taxonomy.json','utf8'))
    d.snapshot.result_states.paths_presented=Object.keys(taxonomy.PATHS)
    await render(<PlannerOwnerSection details={d as any} attachments={[]} loadingPhotos={false} />)
    const paths=host.querySelector('[data-testid="planner-paths"]')!
    expect(paths.children.length).toBe(Object.keys(taxonomy.PATHS).length)
    for(const path of Object.values(taxonomy.PATHS) as any[]) {
      expect(paths.textContent).toContain(path.label);expect(paths.textContent).toContain(path.description)
    }
  })
  it('collapses a broken signed thumbnail into a compact unavailable card without losing its metadata',async()=>{
    await render(<PlannerOwnerSection details={details() as any} attachments={[{clientPhotoId:'photo-one',signedUrl:'https://signed.example/photo',displayName:'Attachment',mimeType:'image/png',expiresAt:null}]} loadingPhotos={false} />)
    await act(async()=>host.querySelector('img')!.dispatchEvent(new Event('error')))
    expect(host.querySelector('img')).toBeNull();expect(host.textContent).toContain('Photo preview unavailable')
    expect(host.textContent).toContain('Panel label close-up');expect(host.textContent).toContain('Not reviewed')
    expect(host.querySelector('figure')!.className).not.toMatch(/h-\d|aspect-/)
  })
  it('uses the current Sales Intelligence Leads → HunterPanel → PortalInbox wiring', () => {
    expect(readFileSync('src/components/salesIntel/tabs/LeadsTab.tsx','utf8')).toContain('<HunterPanel')
    expect(readFileSync('src/components/hunter/HunterPanel.tsx','utf8')).toContain('<PortalInbox onLeadConverted={fetchLeads}')
    expect(readFileSync('src/components/hunter/PortalInbox.tsx','utf8')).not.toContain('PortalLeadInbox')
  })
})
