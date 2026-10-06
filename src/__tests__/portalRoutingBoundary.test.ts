// @ts-nocheck
import {beforeAll,beforeEach,afterAll,it,expect} from 'vitest'
import {randomUUID} from 'node:crypto'
import {readFileSync} from 'node:fs'
import {database,reset,role,rpc,SITE_A,SITE_B,ORG,ORG_B,OWNER,OTHER_OWNER,TENANT} from './fixtures/planner-database'
import payload from './fixtures/planner-payload-v1.json'
import {resolvePortalSiteKey} from '../services/portal/portalSite'
let db
beforeAll(async()=>{db=await database()},30000)
beforeEach(async()=>{await reset(db);await db.exec("SELECT set_config('request.headers','',false)")})
afterAll(async()=>{await db?.close()})
const submit=()=>db.query("SELECT public.submit_portal_request(p_name=>'Legacy',p_phone=>'7605550100') v").then(r=>r.rows[0].v)
const row=id=>db.query('SELECT * FROM public.portal_requests WHERE id=$1',[id]).then(r=>r.rows[0])
async function create(site,key=randomUUID()) {
  const p=JSON.parse(JSON.stringify(payload));p.submission.idempotency_key=key
  return rpc(db,'submit_panel_planner_request',{p_payload:p,p_idempotency_key:key,p_recovery_token:'a1'.repeat(32),p_customer_note:'note',p_consent_version:'panel_planner_contact_v1',p_photo_manifest:[],p_site_key:site})
}
it('legacy bridge denies origins and disabled integration',async()=>{
  await db.exec(`SELECT set_config('request.headers','{"origin":"https://evil.example"}',false); SET ROLE anon`)
  await expect(submit()).rejects.toThrow('ORIGIN_DENIED')
  await db.exec("RESET ROLE; SELECT set_config('request.headers','',false)")
  await db.query('UPDATE public.portal_site_integrations SET enabled=false WHERE public_site_key=$1',[SITE_A])
  try { await db.exec('SET ROLE anon');await expect(submit()).rejects.toThrow('REQUEST_UNAVAILABLE') }
  finally { await db.exec('RESET ROLE');await db.query('UPDATE public.portal_site_integrations SET enabled=true WHERE public_site_key=$1',[SITE_A]) }
  expect((await db.query('SELECT count(*)::int n FROM public.portal_requests')).rows[0].n).toBe(0)
})
it('legacy bridge does not consult singleton for tenant authority',async()=>{
  await db.query('UPDATE public.portal_request_configuration SET organization_id=$1',[ORG_B])
  try { expect((await row((await submit()).request_id)).organization_id).toBe(ORG) }
  finally { await db.query('UPDATE public.portal_request_configuration SET organization_id=$1',[ORG]) }
})
it('request branding is safe, bound to original organization, and survives disabled intake',async()=>{
  const a=await create(SITE_A),b=await create(SITE_B)
  const get=id=>db.query('SELECT public.get_portal_request_public_config($1::uuid) v',[id]).then(r=>r.rows[0].v)
  await db.exec('SET ROLE anon')
  expect(await get(a.request_id)).toMatchObject({display_name:'Alpha Electric',power_on_compatibility:true,site_key:SITE_A})
  const cb=await get(b.request_id)
  expect(cb).toMatchObject({display_name:'Beta Power',power_on_compatibility:false,site_key:SITE_B})
  expect(JSON.stringify(cb)).not.toMatch(/Alpha|Power On|billing|secret|owner-|private-|organization|10000000/)
  expect(await get(randomUUID())).toBeNull()
  await db.exec('RESET ROLE')
  await db.query('UPDATE public.portal_site_integrations SET enabled=false WHERE public_site_key=$1',[SITE_B])
  try { expect((await get(b.request_id)).display_name).toBe('Beta Power') }
  finally { await db.query('UPDATE public.portal_site_integrations SET enabled=true WHERE public_site_key=$1',[SITE_B]) }
})
it('admins A and B see only their own requests',async()=>{
  const a=await create(SITE_A),b=await create(SITE_B)
  const admins=['30000000-0000-4000-8000-000000000004','30000000-0000-4000-8000-000000000005']
  for (const [idx,user] of admins.entries()) {
    await role(db,user)
    try { expect((await db.query('SELECT id FROM public.portal_requests')).rows.map(r=>r.id)).toEqual([idx===0?a.request_id:b.request_id]) }
    finally { await db.exec('RESET ROLE') }
  }
})
it('recovery is symmetric and wrong proof cannot enumerate requests',async()=>{
  for (const site of [SITE_A,SITE_B]) {
    const key=randomUUID();await create(site,key)
    const base={p_idempotency_key:key,p_recovery_token:'a1'.repeat(32),p_site_key:site}
    for (const args of [{...base,p_idempotency_key:randomUUID()},{...base,p_recovery_token:'b2'.repeat(32)},{...base,p_site_key:site===SITE_A?SITE_B:SITE_A}])
      await expect(rpc(db,'recover_panel_planner_request',args)).rejects.toThrow('REQUEST_UNAVAILABLE')
  }
})
it('Org B HUNTER tenant mismatch fails atomically',async()=>{
  const b=await create(SITE_B)
  await db.query('INSERT INTO public.user_tenants VALUES($1,$2)',[OTHER_OWNER,TENANT])
  await role(db,OTHER_OWNER)
  try { await expect(db.query('SELECT public.accept_portal_request_to_hunter($1::uuid)',[b.request_id])).rejects.toThrow() }
  finally { await db.exec('RESET ROLE');await db.query('DELETE FROM public.user_tenants WHERE user_id=$1',[OTHER_OWNER]) }
  expect((await db.query('SELECT count(*)::int n FROM public.hunter_leads')).rows[0].n).toBe(0)
  expect((await row(b.request_id)).hunter_lead_id).toBeNull()
})
it('malformed supplied keys do not silently select Power On',()=>{
  expect(resolvePortalSiteKey('?site=bad')).toBe('bad')
  expect(resolvePortalSiteKey('?site=')).toBe('')
  expect(resolvePortalSiteKey('', 'bad-env')).toBe('bad-env')
})
it('tracking renderer consumes request-bound identity and retains the original site',()=>{
  const source=readFileSync('src/views/PortalTrackView.tsx','utf8')
  expect(source).toContain("rpc('get_portal_request_public_config', { p_id: requestId })")
  expect(source).toContain('alt={brandName}')
  expect(source).toContain('href={portalUrl}')
  expect(source).not.toContain('Thank you for choosing Power On Solutions')
})
