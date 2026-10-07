// @ts-nocheck
// Multi-tenant public intake routing (migrations 149/150): WEBSITE / PUBLIC INTEGRATION -> ORGANIZATION.
// Runs the real migrations on PostgreSQL (pinned dev-only PGlite). Organization A = Power On (SITE_A, SITE_A2),
// Organization B = a second contractor (SITE_B, disabled SITE_OFF).
import {beforeAll,beforeEach,afterAll,describe,it,expect} from 'vitest'
import {createRequire} from 'node:module'
import {randomUUID} from 'node:crypto'
import {readFileSync} from 'node:fs'
import fixture from './fixtures/planner-payload-v1.json'
import {database,reset,role,rpc,SITE_A,SITE_A2,SITE_B,SITE_OFF,SITE_UNKNOWN,ORG,ORG_B,ORIGIN_A,ORIGIN_B,TENANT,OWNER,EMPLOYEE,OTHER_OWNER} from './fixtures/planner-database'
import {resolvePortalSiteKey,isPortalSiteKey,POWER_ON_PORTAL_SITE_KEY,buildTrackingUrl,fetchPortalSitePublicConfig} from '../services/portal/portalSite'
const require=createRequire(import.meta.url)
const {validateEnvelope,PlannerError,STATUS}=require('../../netlify/functions/lib/planner-contract.cjs')
const {makeHandler}=require('../../netlify/functions/lib/planner-handler.cjs')
const {runMaintenance}=require('../../netlify/functions/lib/planner-maintenance.cjs')
const SECRET='a1'.repeat(32), WRONG='b2'.repeat(32)
const TENANT_B='20000000-0000-4000-8000-000000000002'
const clone=x=>JSON.parse(JSON.stringify(x))
function envelope(site=SITE_A,key=randomUUID(),over={}) {
  const p=clone(fixture);p.submission.idempotency_key=key
  return {contract_version:1,action:'create',site_key:site,idempotency_key:key,recovery_token:SECRET,planner_payload:p,
    customer_note:'note',consent_version:'panel_planner_contact_v1',photo_manifest:[],...over}
}
const createArgs=(b,origin)=>({p_payload:b.planner_payload,p_idempotency_key:b.idempotency_key,p_recovery_token:b.recovery_token,
  p_customer_note:b.customer_note,p_consent_version:b.consent_version,p_photo_manifest:b.photo_manifest,p_site_key:b.site_key,
  ...(origin?{p_origin:origin}:{})})

describe('portal site routing — normal portal (submit_portal_request)',()=>{
  let db
  beforeAll(async()=>{db=await database()},30000)
  beforeEach(async()=>{await reset(db)})
  afterAll(async()=>{await db?.close()})
  const submit=(site,over={},origin)=>db.query(
    `SELECT public.submit_portal_request(p_name=>$1,p_phone=>$2,p_site_key=>$3) AS v`,[over.name||'Synthetic Customer','7605550100',site]
  ).then(r=>r.rows[0].v)
  async function asAnon(fn){await db.exec('SET ROLE anon');try{return await fn()}finally{await db.exec('RESET ROLE; SELECT set_config(\'request.headers\',\'\',false)')}}
  const row=id=>db.query('SELECT organization_id,portal_site_integration_id,source,status FROM public.portal_requests WHERE id=$1',[id]).then(r=>r.rows[0])
  const integ=key=>db.query('SELECT id,organization_id FROM public.portal_site_integrations WHERE public_site_key=$1',[key]).then(r=>r.rows[0])

  it('Site A lands in Org A and records its integration; Site B lands in Org B',async()=>{
    const a=await asAnon(()=>submit(SITE_A)),b=await asAnon(()=>submit(SITE_B))
    const ra=await row(a.request_id),rb=await row(b.request_id),ia=await integ(SITE_A),ib=await integ(SITE_B)
    expect(ra.organization_id).toBe(ORG);expect(ra.portal_site_integration_id).toBe(ia.id)
    expect(rb.organization_id).toBe(ORG_B);expect(rb.portal_site_integration_id).toBe(ib.id)
    expect(ra.source).toBe('customer_portal');expect(ra.status).toBe('new')
    expect(a.attach_token).toMatch(/^[0-9a-f]{64}$/)
  })
  it('browser cannot supply organization_id or integration id',async()=>{
    await expect(asAnon(()=>db.query(`SELECT public.submit_portal_request(p_name=>'x',p_phone=>'7605550100',p_site_key=>$1,p_organization_id=>$2) v`,[SITE_B,ORG]))).rejects.toThrow()
    expect((await db.query("SELECT count(*)::int n FROM pg_proc WHERE proname='submit_portal_request' AND (proargnames::text ILIKE '%organization%' OR proargnames::text ILIKE '%integration%')")).rows[0].n).toBe(0)
  })
  it.each([['unknown',SITE_UNKNOWN],['disabled',SITE_OFF],['malformed','not-a-key'],['sql-ish',"ps_' OR 1=1 --"],['uppercase','PS_3F9C1E7AB25D4086B1C7E0AA']])('%s site key is denied and writes nothing',async(_n,key)=>{
    await expect(asAnon(()=>submit(key))).rejects.toThrow('REQUEST_UNAVAILABLE')
    expect((await db.query('SELECT count(*)::int n FROM public.portal_requests')).rows[0].n).toBe(0)
  })
  it('Origin must match the integration when present; absent Origin is not authority',async()=>{
    await db.exec(`SELECT set_config('request.headers','{"origin":"${ORIGIN_B}"}',false)`)
    await expect(asAnon(()=>submit(SITE_A))).rejects.toThrow('ORIGIN_DENIED')
    await db.exec(`SELECT set_config('request.headers','{"origin":"${ORIGIN_A}"}',false)`)
    await expect(asAnon(()=>submit(SITE_B))).rejects.toThrow('ORIGIN_DENIED')   // A's origin cannot act as B
    await db.exec(`SELECT set_config('request.headers','{"origin":"${ORIGIN_A}"}',false)`)
    expect((await asAnon(()=>submit(SITE_A))).request_id).toBeTruthy()
    await db.exec(`SELECT set_config('request.headers','{"origin":"${ORIGIN_B}"}',false)`)
    expect((await asAnon(()=>submit(SITE_B))).request_id).toBeTruthy()
    await db.exec(`SELECT set_config('request.headers','{"origin":"https://evil.example"}',false)`)
    await expect(asAnon(()=>submit(SITE_B))).rejects.toThrow('ORIGIN_DENIED')
  })
  it('legacy key-less /portal clients still land in the Power On organization (bounded bridge)',async()=>{
    const legacy=await asAnon(()=>db.query(`SELECT public.submit_portal_request(p_name=>'Legacy',p_phone=>'7605550100') v`).then(r=>r.rows[0].v))
    const r=await row(legacy.request_id);const ia=await integ(SITE_A)
    expect(r.organization_id).toBe(ORG);expect(r.portal_site_integration_id).toBe(ia.id)
  })
  it('referral claim stays in the resolved organization',async()=>{
    const out=await asAnon(()=>db.query(`SELECT public.submit_portal_request(p_name=>'Ref',p_phone=>'7605550100',p_referred_by_text=>'A friend',p_site_key=>$1) v`,[SITE_B]).then(r=>r.rows[0].v))
    expect((await db.query('SELECT organization_id FROM public.referral_claims WHERE portal_request_id=$1',[out.request_id])).rows[0].organization_id).toBe(ORG_B)
  })
  it('anonymous cannot read integrations or enumerate origins',async()=>{
    await db.exec('SET ROLE anon')
    await expect(db.query('SELECT * FROM public.portal_site_integrations')).rejects.toThrow('permission denied')
    await expect(db.query('SELECT public.portal_site_allowed_origins()')).rejects.toThrow('permission denied')
    await expect(db.query("UPDATE public.portal_site_integrations SET enabled=true")).rejects.toThrow('permission denied')
    await expect(db.query('SELECT portal_private.resolve_site($1)',[SITE_A])).rejects.toThrow('permission denied')
    await db.exec('RESET ROLE')
  })
  it('integration table integrity: wildcard/plain-http origins, organization immutability, cross-org request link',async()=>{
    const add=(origin)=>db.query(`INSERT INTO public.portal_site_integrations(organization_id,public_site_key,label,primary_origin,allowed_origins) VALUES($1,$2,'x',$3,ARRAY[$3])`,[ORG_B,'ps_'+randomUUID().replace(/-/g,''),origin])
    await expect(add('https://*.netlify.app')).rejects.toThrow()
    await expect(add('http://evil.example')).rejects.toThrow()
    await expect(add('https://a.example/path')).rejects.toThrow()
    await expect(add('HTTPS://UPPER.example')).rejects.toThrow()
    await add('https://ok.example');await add('http://localhost:5173')
    await expect(db.query("UPDATE public.portal_site_integrations SET organization_id=$1 WHERE public_site_key=$2",[ORG,SITE_B])).rejects.toThrow('immutable')
    const ib=await integ(SITE_B)
    await expect(db.query(`INSERT INTO public.portal_requests(organization_id,portal_site_integration_id,name) VALUES($1,$2,'cross')`,[ORG,ib.id])).rejects.toThrow()
    await expect(db.query("INSERT INTO public.portal_site_integrations(organization_id,public_site_key,label,primary_origin,allowed_origins,legacy_default) VALUES($1,'ps_dddddddddddddddddddddddd','dup','https://d.example',ARRAY['https://d.example'],true)",[ORG_B])).rejects.toThrow()
  })
})

describe('portal site routing — Panel Planner, recovery, owner access, HUNTER, notifications, public config',()=>{
  let db
  beforeAll(async()=>{db=await database()},30000)
  beforeEach(async()=>{await reset(db);await db.exec("DELETE FROM public.user_tenants WHERE user_id='"+OTHER_OWNER+"'")})
  afterAll(async()=>{await db?.close()})
  const create=(b,origin)=>{validateEnvelope(b);return rpc(db,'submit_panel_planner_request',createArgs(b,origin))}
  const recover=(b,site=b.site_key,origin)=>rpc(db,'recover_panel_planner_request',{p_idempotency_key:b.idempotency_key,p_recovery_token:b.recovery_token,p_site_key:site,...(origin?{p_origin:origin}:{})})
  const org=id=>db.query('SELECT organization_id,portal_site_integration_id i FROM public.portal_requests WHERE id=$1',[id]).then(r=>r.rows[0])

  it('planner Site A -> Org A and Site B -> Org B; details carry the same organization',async()=>{
    const a=await create(envelope(SITE_A)),b=await create(envelope(SITE_B))
    expect((await org(a.request_id)).organization_id).toBe(ORG);expect((await org(b.request_id)).organization_id).toBe(ORG_B)
    const d=await db.query('SELECT d.organization_id=r.organization_id ok FROM public.portal_request_planner_details d JOIN public.portal_requests r ON r.id=d.request_id')
    expect(d.rows.every(x=>x.ok)).toBe(true)
    expect(a.tracking_url).toBe('https://app.poweronsolutionsllc.com/portal/track/'+a.request_id)
    expect(b.tracking_url).toBe('https://track.beta-power.example/portal/track/'+b.request_id)
  })
  it('does not consult the global singleton (works with no configuration row)',async()=>{
    await db.exec('DELETE FROM public.portal_request_configuration')
    const b=await create(envelope(SITE_B));expect((await org(b.request_id)).organization_id).toBe(ORG_B)
    await db.exec('INSERT INTO public.portal_request_configuration VALUES(true,$$'+ORG+'$$)')
  })
  it('same idempotency UUID in two organizations is allowed as separate requests',async()=>{
    const key=randomUUID();const a=await create(envelope(SITE_A,key)),b=await create(envelope(SITE_B,key))
    expect(a.request_id).not.toBe(b.request_id);expect(a.replayed).toBe(false);expect(b.replayed).toBe(false)
    expect((await db.query('SELECT count(*)::int n FROM public.portal_request_planner_details WHERE idempotency_key=$1',[key])).rows[0].n).toBe(2)
  })
  it('same key within the same site keeps replay/conflict; another site in the same org conflicts',async()=>{
    const e=envelope(SITE_A),first=await create(e);const again=await create(e)
    expect(again.replayed).toBe(true);expect(again.request_id).toBe(first.request_id)
    const changed=clone(e);changed.planner_payload.customer.name='Changed';await expect(create(changed)).rejects.toThrow('IDEMPOTENCY_CONFLICT')
    await expect(create({...clone(e),site_key:SITE_A2})).rejects.toThrow('IDEMPOTENCY_CONFLICT')
  })
  it.each([['unknown',SITE_UNKNOWN],['disabled',SITE_OFF]])('%s site is denied for create and recover with a generic failure',async(_n,site)=>{
    await expect(create(envelope(site))).rejects.toThrow('REQUEST_UNAVAILABLE')
    await expect(recover(envelope(SITE_A),site)).rejects.toThrow('REQUEST_UNAVAILABLE')
    expect((await db.query('SELECT count(*)::int n FROM public.portal_requests')).rows[0].n).toBe(0)
  })
  it('planner origin must belong to the resolved integration',async()=>{
    await expect(create(envelope(SITE_A),ORIGIN_B)).rejects.toThrow('ORIGIN_DENIED')
    await expect(create(envelope(SITE_B),ORIGIN_A)).rejects.toThrow('ORIGIN_DENIED')
    expect((await create(envelope(SITE_B),ORIGIN_B)).request_id).toBeTruthy()
  })
  it('recovery: only the originating integration with the capability; no cross-org, cross-site or enumeration',async()=>{
    const e=envelope(SITE_A),saved=await create(e)
    expect((await recover(e)).request_id).toBe(saved.request_id)
    await expect(recover(e,SITE_B)).rejects.toThrow('REQUEST_UNAVAILABLE')      // other organization
    await expect(recover(e,SITE_A2)).rejects.toThrow('REQUEST_UNAVAILABLE')     // other site, same organization
    await expect(recover({...e,recovery_token:WRONG})).rejects.toThrow('REQUEST_UNAVAILABLE')
    const missing=await recover(envelope(SITE_A)).catch(x=>x.message),other=await recover(e,SITE_B).catch(x=>x.message)
    expect(missing).toBe(other)   // same generic failure for "absent" and "belongs elsewhere"
  })
  it('owner/admin RLS: A sees A, B sees B, employee and cross-org see nothing',async()=>{
    const a=await create(envelope(SITE_A)),b=await create(envelope(SITE_B))
    const count=async(user,id)=>{await role(db,user);try{return (await db.query('SELECT count(*)::int n FROM public.portal_requests WHERE id=$1',[id])).rows[0].n}finally{await db.exec('RESET ROLE')}}
    expect(await count(OWNER,a.request_id)).toBe(1);expect(await count(OWNER,b.request_id)).toBe(0)
    expect(await count(OTHER_OWNER,b.request_id)).toBe(1);expect(await count(OTHER_OWNER,a.request_id)).toBe(0)
    expect(await count(EMPLOYEE,a.request_id)).toBe(0)
    const details=async(user,id)=>{await role(db,user);try{return (await db.query('SELECT public.get_panel_planner_owner_details($1::uuid) v',[id])).rows[0].v}finally{await db.exec('RESET ROLE')}}
    expect((await details(OWNER,a.request_id)).request_id).toBe(a.request_id);expect(await details(OWNER,b.request_id)).toBeNull()
    expect(await details(OTHER_OWNER,a.request_id)).toBeNull();expect(await details(EMPLOYEE,a.request_id)).toBeNull()
    await role(db,OWNER);await expect(db.query('SELECT * FROM public.portal_site_integrations WHERE organization_id=$1',[ORG_B]).then(r=>r.rows.length)).resolves.toBe(0)
    expect((await db.query('SELECT count(*)::int n FROM public.portal_site_integrations')).rows[0].n).toBeGreaterThan(0)
    await db.exec('RESET ROLE');await role(db,EMPLOYEE);expect((await db.query('SELECT * FROM public.portal_site_integrations')).rows).toHaveLength(0)
    await db.exec('RESET ROLE')
  })
  it('attachments: another organization cannot obtain or register photos for a request',async()=>{
    const e=envelope(SITE_A);e.planner_payload.photos=[{category:'panel_label',caption:'c',file_name:'a.png',mime_type:'image/png',size_bytes:32,upload_state:'not_started',review_state:'not_reviewed'}]
    e.photo_manifest=[{client_photo_id:randomUUID(),payload_photo_index:0}]
    const a=await create(e)
    await expect(rpc(db,'authorize_panel_planner_photos',{p_request_id:a.request_id,p_recovery_token:WRONG,p_authorization_key:randomUUID(),p_photo_ids:[e.photo_manifest[0].client_photo_id]})).rejects.toThrow('CAPABILITY_INVALID')
    await expect(rpc(db,'get_panel_planner_customer_photos',{p_request_id:a.request_id,p_recovery_token:WRONG})).rejects.toThrow('CAPABILITY_INVALID')
    await role(db,OTHER_OWNER)
    expect((await db.query("SELECT public.get_panel_planner_owner_details($1::uuid) v",[a.request_id])).rows[0].v).toBeNull()
    await expect(db.query('SELECT 1 FROM public.portal_upload_authorizations')).rejects.toThrow('permission denied')
    await db.exec('RESET ROLE')
    expect((await db.query('SELECT count(*)::int n FROM public.portal_upload_authorizations')).rows[0].n).toBe(0)
  })
  it('HUNTER conversion uses each request organization tenant; cross-tenant link is impossible',async()=>{
    await db.exec(`INSERT INTO public.user_tenants VALUES('${OTHER_OWNER}','${TENANT_B}')`)
    const a=await create(envelope(SITE_A)),b=await create(envelope(SITE_B))
    await role(db,OWNER);const la=(await db.query('SELECT public.accept_portal_request_to_hunter($1::uuid) v',[a.request_id])).rows[0].v
    await expect(db.query('SELECT public.accept_portal_request_to_hunter($1::uuid)',[b.request_id])).rejects.toThrow('REQUEST_UNAVAILABLE')
    await db.exec('RESET ROLE');await role(db,OTHER_OWNER)
    const lb=(await db.query('SELECT public.accept_portal_request_to_hunter($1::uuid) v',[b.request_id])).rows[0].v
    await expect(db.query('SELECT public.accept_portal_request_to_hunter($1::uuid)',[a.request_id])).rejects.toThrow('REQUEST_UNAVAILABLE')
    expect((await db.query('SELECT public.accept_portal_request_to_hunter($1::uuid) v',[b.request_id])).rows[0].v.replayed).toBe(true)
    await db.exec('RESET ROLE')
    const leads=(await db.query('SELECT id,tenant_id FROM public.hunter_leads')).rows
    expect(leads).toHaveLength(2)
    expect(leads.find(l=>l.id===la.lead_id).tenant_id).toBe(TENANT);expect(leads.find(l=>l.id===lb.lead_id).tenant_id).toBe(TENANT_B)
  })
  it('notification routing: per-site trusted recipient, no cross-organization delivery, no browser recipient',async()=>{
    const a=await create(envelope(SITE_A)),a2=await create(envelope(SITE_A2)),b=await create(envelope(SITE_B))
    const events=await rpc(db,'claim_panel_planner_notifications',{})
    const forReq=id=>events.find(e=>e.request_id===id&&e.event_type==='owner_new_request')
    expect(forReq(a.request_id)).toMatchObject({owner_email:null,owner_email_fallback_allowed:true})
    expect(forReq(a2.request_id)).toMatchObject({owner_email:'owner-a2@example.test',owner_email_fallback_allowed:false})
    expect(forReq(b.request_id)).toMatchObject({owner_email:'owner-b@example.test',owner_email_fallback_allowed:false,display_name:'Beta Power',tracking_base_url:'https://track.beta-power.example'})
    const sent=[];const env={RESEND_API_KEY:'k',PANEL_PLANNER_FROM_EMAIL:'x@example.com',PANEL_PLANNER_OWNER_EMAIL:'poweron-owner@example.com'}
    const backend={rpc:async(n,args)=>n==='panel_planner_orphan_paths'?[]:n==='panel_planner_expire_technical_data'?0:n==='claim_panel_planner_notifications'?events.filter(e=>e.event_type==='owner_new_request'):n==='prepare_panel_planner_notification'?args.p_delivery_payload:true,remove:async()=>{}}
    await runMaintenance({env,backend,fetcher:async(_u,o)=>{sent.push(JSON.parse(o.body));return new Response('{"id":"m"}')}})
    const to=id=>sent.find(s=>s.text.includes(id)).to[0]
    expect(to(a.request_id)).toBe('poweron-owner@example.com')   // documented Power On-only fallback
    expect(to(a2.request_id)).toBe('owner-a2@example.test');expect(to(b.request_id)).toBe('owner-b@example.test')
    // Owner alerts open the authenticated Hub; per-site tracking stays customer-facing.
    expect(sent.find(s=>s.text.includes(b.request_id)).text).toContain('Open in Power On Hub → https://app.poweronsolutionsllc.com/')
    // A non-legacy site without its own recipient must NOT fall back to the Power On address.
    const lone={...forReq(b.request_id),owner_email:null};const sent2=[]
    const r=await runMaintenance({env,backend:{...backend,rpc:async(n,args)=>n==='claim_panel_planner_notifications'?[lone]:backend.rpc(n,args)},fetcher:async(_u,o)=>{sent2.push(o);return new Response('{"id":"m"}')}})
    expect(sent2).toHaveLength(0);expect(r.failed).toBe(1)
    for(const field of ['recipient','owner_email','to','organization_id','site_integration_id']) {
      expect(()=>validateEnvelope({...envelope(SITE_A),[field]:'attacker@example.com'})).toThrow()
    }
  })
  it('customer confirmation uses the site brand, never Power On branding for another organization',async()=>{
    const e=envelope(SITE_B);e.planner_payload.customer.email='cust@example.test';await create(e)
    const events=await rpc(db,'claim_panel_planner_notifications',{});const sent=[]
    const backend={rpc:async(n,args)=>n==='panel_planner_orphan_paths'?[]:n==='panel_planner_expire_technical_data'?0:n==='claim_panel_planner_notifications'?events.filter(x=>x.event_type!=='owner_new_request'):n==='prepare_panel_planner_notification'?args.p_delivery_payload:true,remove:async()=>{}}
    await runMaintenance({env:{RESEND_API_KEY:'k',PANEL_PLANNER_FROM_EMAIL:'x@example.com'},backend,fetcher:async(_u,o)=>{sent.push(JSON.parse(o.body));return new Response('{"id":"m"}')}})
    expect(sent[0].to).toEqual(['cust@example.test']);expect(sent[0].subject).toContain('Beta Power');expect(JSON.stringify(sent[0])).not.toMatch(/Power On Solutions/)
  })
  it('public config: each site gets only its own safe projection',async()=>{
    await db.exec('SET ROLE anon')
    const get=k=>db.query('SELECT public.get_portal_site_public_config($1) v',[k]).then(r=>r.rows[0].v)
    const a=await get(SITE_A),b=await get(SITE_B)
    await db.exec('RESET ROLE')
    expect(Object.keys(a).sort()).toEqual(['display_name','logo_url','public_email','public_phone','site_label','tracking_base_url'])
    expect(a).toMatchObject({display_name:'Alpha Electric',public_phone:'7605550111',public_email:null,logo_url:'https://cdn.example.test/a.png'})
    expect(b).toMatchObject({display_name:'Beta Power',public_phone:'7605550222',public_email:'hello@beta-power.example',logo_url:null,tracking_base_url:'https://track.beta-power.example'})
    const text=JSON.stringify([a,b])
    expect(text).not.toMatch(/secret|billing|private-|owner-|[0-9a-f]{8}-[0-9a-f]{4}-/i)
    expect(JSON.stringify(a)).not.toMatch(/Beta|beta/);expect(JSON.stringify(b)).not.toMatch(/Alpha|alpha/)
    await db.exec('SET ROLE anon');expect(await get(SITE_UNKNOWN)).toBeNull();expect(await get(SITE_OFF)).toBeNull();expect(await get('bad')).toBeNull();expect(await get(null)).toBeNull()
    await db.exec('RESET ROLE')
  })
  it('public tracking never exposes planner or routing internals',async()=>{
    const a=await create(envelope(SITE_B));await db.exec('SET ROLE anon')
    const v=(await db.query('SELECT public.get_portal_request_status($1::uuid) v',[a.request_id])).rows[0].v
    await db.exec('RESET ROLE')
    expect(JSON.stringify(v)).not.toMatch(/site_integration|integration|snapshot|recovery|idempotency|organization|notification|owner-b/i)
  })
  it('planner RPC ACLs remain service-only after the signature change',async()=>{
    const rows=(await db.query("SELECT proname,has_function_privilege('anon',oid,'EXECUTE') a,has_function_privilege('authenticated',oid,'EXECUTE') u,has_function_privilege('service_role',oid,'EXECUTE') s FROM pg_proc WHERE proname IN('submit_panel_planner_request','recover_panel_planner_request','portal_site_allowed_origins')")).rows
    expect(rows).toHaveLength(3);for(const r of rows){expect(r.a).toBe(false);expect(r.u).toBe(false);expect(r.s).toBe(true)}
    expect((await db.query("SELECT count(*)::int n FROM pg_proc WHERE proname IN('submit_panel_planner_request','recover_panel_planner_request')")).rows[0].n).toBe(2)
  })
})

describe('planner HTTP adapter origins and contract with site keys',()=>{
  const body=b=>JSON.stringify(b)
  const handlerWith=(list,calls=[])=>makeHandler({env:{},backendFactory:()=>({rate:0,rateHash:()=> 'd'.repeat(64),rpc:async(n,a)=>{calls.push([n,a]);if(n==='portal_site_allowed_origins'){if(list instanceof Error)throw list;return list};if(n==='panel_planner_rate_limit')return true;return {request_id:randomUUID(),replayed:false}}})})
  it('static Power On origins preflight without a lookup',async()=>{
    const calls=[];const r=await handlerWith([],calls)({httpMethod:'OPTIONS',headers:{origin:ORIGIN_A}})
    expect(r.statusCode).toBe(204);expect(calls).toHaveLength(0)
  })
  it('a contractor origin is allowed only when an enabled integration lists it exactly',async()=>{
    const ok=await handlerWith([ORIGIN_B])({httpMethod:'OPTIONS',headers:{origin:ORIGIN_B}});expect(ok.statusCode).toBe(204);expect(ok.headers['Access-Control-Allow-Origin']).toBe(ORIGIN_B)
    for(const o of ['https://beta-power.example.evil.com','http://beta-power.example','https://x.netlify.app','null','https://BETA-POWER.example',undefined,''])
      expect((await handlerWith([ORIGIN_B])({httpMethod:'OPTIONS',headers:o===undefined?{}:{origin:o}})).statusCode).toBe(403)
  })
  it('lookup failure or empty list fails closed',async()=>{
    expect((await handlerWith(new Error('db down'))({httpMethod:'OPTIONS',headers:{origin:ORIGIN_B}})).statusCode).toBe(403)
    expect((await handlerWith([])({httpMethod:'OPTIONS',headers:{origin:ORIGIN_B}})).statusCode).toBe(403)
  })
  it('create/recover forward the site key and request Origin to the database, never an organization',async()=>{
    const calls=[];const h=handlerWith([ORIGIN_B],calls);const e=envelope(SITE_B)
    const r=await h({httpMethod:'POST',headers:{origin:ORIGIN_B},body:body(e)});expect(r.statusCode).toBe(201)
    const submit=calls.find(([n])=>n==='submit_panel_planner_request')[1]
    expect(submit).toMatchObject({p_site_key:SITE_B,p_origin:ORIGIN_B});expect(JSON.stringify(submit)).not.toMatch(/organization_id|tenant/)
    await h({httpMethod:'POST',headers:{origin:ORIGIN_B},body:body({contract_version:1,action:'recover',site_key:SITE_B,idempotency_key:e.idempotency_key,recovery_token:SECRET})})
    expect(calls.find(([n])=>n==='recover_panel_planner_request')[1]).toMatchObject({p_site_key:SITE_B,p_origin:ORIGIN_B})
  })
  it('envelope requires a well-formed site key; extra routing fields are rejected',()=>{
    for(const bad of ['','ps_short','PS_'+'a'.repeat(24),'ps_'+'a'.repeat(24)+'!',123,null])
      expect(()=>validateEnvelope({...envelope(SITE_A),site_key:bad})).toThrow()
    const missing=envelope(SITE_A);delete missing.site_key;expect(()=>validateEnvelope(missing)).toThrow()
    expect(()=>validateEnvelope({...envelope(SITE_A),organization_id:ORG})).toThrow()
  })
})

describe('portal site helper (front end) and migration contracts',()=>{
  it('resolves the Power On key by default, accepts only well-formed link keys, never an organization id',()=>{
    expect(resolvePortalSiteKey('')).toBe(POWER_ON_PORTAL_SITE_KEY)
    expect(resolvePortalSiteKey('?site='+SITE_B)).toBe(SITE_B)
    expect(resolvePortalSiteKey('?site='+ORG)).toBe(ORG)
    expect(resolvePortalSiteKey('?organization_id='+ORG_B)).toBe(POWER_ON_PORTAL_SITE_KEY)
    expect(resolvePortalSiteKey('?site=ps_x',SITE_B)).toBe(SITE_B)
    expect(isPortalSiteKey(SITE_A)).toBe(true);expect(isPortalSiteKey("ps_' OR 1=1")).toBe(false)
  })
  it('tracking URLs use the platform host unless a site specifies its own',()=>{
    expect(buildTrackingUrl('abc')).toBe('https://app.poweronsolutionsllc.com/portal/track/abc')
    expect(buildTrackingUrl('abc','https://track.beta-power.example/')).toBe('https://track.beta-power.example/portal/track/abc')
  })
  it('public config helper fails closed',async()=>{
    expect(await fetchPortalSitePublicConfig({rpc:async()=>({data:null,error:{message:'x'}})},SITE_A)).toBeNull()
    expect(await fetchPortalSitePublicConfig({rpc:async()=>({data:{site_label:'x'},error:null})},'bad')).toBeNull()
  })
  it('CustomerPortalView sends only a site key (no organization id) and guards Power On-only notifications',()=>{
    const src=readFileSync('src/views/CustomerPortalView.tsx','utf8')
    expect(src).toMatch(/p_site_key:\s+siteKey/);expect(src).not.toMatch(/p_organization_id|organization_id:/)
    expect(src).toMatch(/if \(isPowerOnSite\) fetch\('\/\.netlify\/functions\/notify-new-lead'/)
  })
  it('migration 149 is additive, keeps the singleton as a documented bridge, and does not touch history',()=>{
    const m=readFileSync('supabase/migrations/149_portal_site_integrations.sql','utf8')
    expect(m).not.toMatch(/DROP TABLE|TRUNCATE|DELETE FROM|DROP COLUMN|ALTER COLUMN organization_id/i)
    expect(m).toMatch(/BOUNDED COMPATIBILITY BRIDGE/);expect(m).toMatch(/ENABLE ROW LEVEL SECURITY/)
    expect(m).toMatch(/REVOKE ALL ON public\.portal_site_integrations FROM PUBLIC, anon, authenticated/)
    const p=readFileSync('supabase/migrations/150_panel_planner_site_routing.sql','utf8')
    expect(p).not.toMatch(/portal_request_configuration/);expect(p).toMatch(/portal_private\.resolve_site/)
  })
})
