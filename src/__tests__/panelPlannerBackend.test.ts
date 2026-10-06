// @ts-nocheck
import {beforeAll,beforeEach,afterAll,describe,it,expect} from 'vitest'
import {createRequire} from 'node:module'
import {randomUUID} from 'node:crypto'
import fixture from './fixtures/planner-payload-v1.json'
import variants from './fixtures/planner-payload-variants-v1.json'
import {database,reset,role,rpc,SITE_A,ORG,TENANT,OWNER,EMPLOYEE,OTHER_OWNER} from './fixtures/planner-database'
const require=createRequire(import.meta.url)
const {validateEnvelope,validatePayload,allowedOrigins,PlannerError,STATUS}=require('../../netlify/functions/lib/planner-contract.cjs')
const {makeHandler}=require('../../netlify/functions/lib/planner-handler.cjs')
const {runtime}=require('../../netlify/functions/lib/planner-runtime.cjs')
const {denyPlannerUuidRead}=require('../../netlify/functions/lib/planner-legacy-guard.cjs')
const SECRET='a1'.repeat(32), WRONG='b2'.repeat(32)
const clone=x=>JSON.parse(JSON.stringify(x))
function envelope(photos=0) {
  const p=clone(fixture); const key=randomUUID();p.submission.idempotency_key=key
  p.photos=Array.from({length:photos},()=>({category:'panel_label',caption:'Customer label',file_name:'label.png',
    mime_type:'image/png',size_bytes:32,upload_state:'not_started',review_state:'not_reviewed'}))
  return {contract_version:1,action:'create',site_key:SITE_A,idempotency_key:key,recovery_token:SECRET,planner_payload:p,
    customer_note:'Please call after work',consent_version:'panel_planner_contact_v1',
    photo_manifest:p.photos.map((_,i)=>({client_photo_id:randomUUID(),payload_photo_index:i}))}
}
const createArgs=b=>({p_payload:b.planner_payload,p_idempotency_key:b.idempotency_key,p_recovery_token:b.recovery_token,
  p_customer_note:b.customer_note,p_consent_version:b.consent_version,p_photo_manifest:b.photo_manifest,p_site_key:b.site_key})
describe('planner strict transport contract',()=>{

  it.each(variants)('accepts frozen observation/null payload variant %#',payload=>{
    const b=envelope();b.planner_payload=clone(payload);b.planner_payload.submission.idempotency_key=b.idempotency_key;
    expect(validateEnvelope(b)).toBeTruthy()
  })
  it.each(['constructor','toString','__proto__'])('rejects prototype-shaped action %s',action=>{
    expect(()=>validateEnvelope({contract_version:1,action})).toThrow('INVALID_PAYLOAD')
  })
  it('rejects array UUID coercion',()=>{const b=envelope();b.idempotency_key=[b.idempotency_key];expect(()=>validateEnvelope(b)).toThrow('INVALID_PAYLOAD')})
  it('accepts frozen name+phone payload',()=>expect(validateEnvelope(envelope())).toBeTruthy())
  it('accepts name+email without phone',()=>{const b=envelope();delete b.planner_payload.customer.phone;b.planner_payload.customer.email='test@example.com';expect(validateEnvelope(b)).toBeTruthy()})
  const invalids=[
    ['missing both','CONTACT_REQUIRED',b=>{delete b.planner_payload.customer.phone}],
    ['blank name','CONTACT_REQUIRED',b=>{b.planner_payload.customer.name='  '}],
    ['bad email','INVALID_CONTACT',b=>{b.planner_payload.customer.email='bad'}],
    ['bad phone','INVALID_CONTACT',b=>{b.planner_payload.customer.phone='760foo5550100'}],
    ['short phone','INVALID_CONTACT',b=>{b.planner_payload.customer.phone='12'}],
    ['long phone','INVALID_CONTACT',b=>{b.planner_payload.customer.phone='1'.repeat(31)}],
    ['long name','INVALID_CONTACT',b=>{b.planner_payload.customer.name='n'.repeat(201)}],
    ['email preference mismatch','INVALID_CONTACT',b=>{b.planner_payload.customer.preferred_contact='email'}],
    ['text preference mismatch','INVALID_CONTACT',b=>{delete b.planner_payload.customer.phone;b.planner_payload.customer.email='t@example.com';b.planner_payload.customer.preferred_contact='text'}],
    ['consent false','CONSENT_REQUIRED',b=>{b.planner_payload.submission.consent=false}],
    ['wrong consent version','CONSENT_REQUIRED',b=>{b.consent_version='marketing'}],
    ['unsupported schema','UNSUPPORTED_SCHEMA',b=>{b.planner_payload.schema_version=2}],
    ['oversized snapshot','SNAPSHOT_TOO_LARGE',b=>{b.planner_payload.panel.note='x'.repeat(132000)}],
    ['browser org injection','INVALID_PAYLOAD',b=>{b.organization_id=ORG}],
    ['payload status injection','INVALID_PAYLOAD',b=>{b.planner_payload.status='accepted'}],
    ['source injection','INVALID_PAYLOAD',b=>{b.source='admin'}],
    ['HUNTER tenant injection','INVALID_PAYLOAD',b=>{b.tenant_id=TENANT}],
    ['fake verified fact','INVALID_PAYLOAD',b=>{b.planner_payload.existing_service.main_rating={value:200,provenance:'verified'}}],
    ['missing provenance','INVALID_PAYLOAD',b=>{b.planner_payload.existing_service.main_rating={value:200}}],
    ['unknown coerced to zero','INVALID_PAYLOAD',b=>{b.planner_payload.existing_service.main_rating={value:0,provenance:'unknown'}}],
    ['unbounded detail','INVALID_PAYLOAD',b=>{b.planner_payload.planned_loads=[{type:'solar',status:'planned',origin:'customer_selected',note:'',details:{system_kw:{value:999,provenance:'customer_known'}}}]}],
    ['fake validated result','INVALID_PAYLOAD',b=>{b.planner_payload.result_states.ruleset.status='validated'}],
    ['fake determination','INVALID_PAYLOAD',b=>{b.planner_payload.result_states.determination='verified'}],
    ['unsupported attribution','INVALID_PAYLOAD',b=>{b.planner_payload.attribution.email='private@example.com'}],
    ['PII query URL','INVALID_PAYLOAD',b=>{b.planner_payload.submission.page_url='https://poweronsolutionsllc.com/?email=x'}],
    ['mismatched idempotency','INVALID_PAYLOAD',b=>{b.idempotency_key=randomUUID()}],
    ['bad secret','CAPABILITY_INVALID',b=>{b.recovery_token='short'}],
    ['bad MIME','PHOTO_TYPE_INVALID',b=>{b.planner_payload.photos[0].mime_type='application/pdf'}],
    ['photo too large','PHOTO_TOO_LARGE',b=>{b.planner_payload.photos[0].size_bytes=10485761}],
    ['photo claimed reviewed','INVALID_PAYLOAD',b=>{b.planner_payload.photos[0].review_state='reviewed'}],
    ['duplicate client ID','INVALID_PAYLOAD',b=>{b.photo_manifest[1].client_photo_id=b.photo_manifest[0].client_photo_id}],
    ['duplicate photo index','INVALID_PAYLOAD',b=>{b.photo_manifest[1].payload_photo_index=0}],
    ['blob URL injection','INVALID_PAYLOAD',b=>{b.planner_payload.photos[0].preview_url='blob:local'}]
  ]
  it.each(invalids)('rejects %s',(_name,code,mutate)=>{const b=envelope(2);mutate(b);expect(()=>validateEnvelope(b)).toThrow(code)})
  it.each(['image/jpeg','image/png','image/webp'])('accepts %s metadata',mime=>{const b=envelope(1);b.planner_payload.photos[0].mime_type=mime;expect(validateEnvelope(b)).toBeTruthy()})
  it('enforces ten manifest photos',()=>{const b=envelope(11);expect(()=>validateEnvelope(b)).toThrow()})
  it('requires unique authorization photo IDs',()=>{const id=randomUUID();expect(()=>validateEnvelope({contract_version:1,action:'authorize_photos',request_id:randomUUID(),recovery_token:SECRET,authorization_key:randomUUID(),photo_ids:[id,id]})).toThrow()})
  it('supports both production origins, rejects guessed preview',()=>{const set=allowedOrigins({});expect(set.has('https://poweronsolutionsllc.com')).toBe(true);expect(set.has('https://www.poweronsolutionsllc.com')).toBe(true);expect(set.has('https://any.netlify.app')).toBe(false)})
  it('allows exactly configured preview origin',()=>{expect(allowedOrigins({PANEL_PLANNER_PREVIEW_ORIGIN:'https://approved.netlify.app'}).has('https://approved.netlify.app')).toBe(true)})
  it('rejects wildcard preview configuration',()=>expect(allowedOrigins({PANEL_PLANNER_PREVIEW_ORIGIN:'https://*.netlify.app'}).has('https://other.netlify.app')).toBe(false))
})
describe('planner PostgreSQL transactions, security and recovery',()=>{
  let db
  beforeAll(async()=>{db=await database()},30000)
  beforeEach(async()=>{await reset(db)})
  afterAll(async()=>{await db?.close()})
  async function create(b=envelope()){validateEnvelope(b);return rpc(db,'submit_panel_planner_request',createArgs(b))}
  async function authorize(request,b,ids=b.photo_manifest.map(m=>m.client_photo_id),key=randomUUID()){
    return rpc(db,'authorize_panel_planner_photos',{p_request_id:request.request_id,p_recovery_token:SECRET,p_authorization_key:key,p_photo_ids:ids})
  }
  async function recover(b){return rpc(db,'recover_panel_planner_request',{p_idempotency_key:b.idempotency_key,p_recovery_token:SECRET,p_site_key:SITE_A})}
  async function storeFile(file,override={}){
    await db.query("INSERT INTO storage.objects(bucket_id,name,metadata,created_at) VALUES('portal-uploads',$1,$2::jsonb,planner_private.now()) ON CONFLICT(bucket_id,name) DO UPDATE SET metadata=excluded.metadata",
      [file.object_path,JSON.stringify({size:file.size_bytes,mimetype:file.mime_type,...override})])
  }
  function args(request,batch,ids=batch.files.map(f=>f.client_photo_id),close=false,key=randomUUID()){
    return {p_request_id:request.request_id,p_recovery_token:SECRET,p_finalization_key:key,
      p_authorization_id:batch.authorization_id,p_photo_ids:ids,p_close_photos:close}
  }
  async function finalize(a,batch){
    return rpc(db,'finalize_panel_planner_photos',{...a,p_verified_objects:batch.files.filter(f=>a.p_photo_ids.includes(f.client_photo_id)).map(f=>({...f,signature_verified:true}))})
  }

  it('service RPC ACLs deny anon and authenticated invocation',async()=>{
    const rows=(await db.query("SELECT proname,has_function_privilege('anon',oid,'EXECUTE') anon_ok,has_function_privilege('authenticated',oid,'EXECUTE') auth_ok FROM pg_proc WHERE proname IN ('submit_panel_planner_request','recover_panel_planner_request','authorize_panel_planner_photos','prepare_panel_planner_finalization','finalize_panel_planner_photos','get_panel_planner_customer_photos','claim_panel_planner_notifications','panel_planner_orphan_paths','panel_planner_expire_technical_data')")).rows
    expect(rows).toHaveLength(9);for(const row of rows){expect(row.anon_ok).toBe(false);expect(row.auth_ok).toBe(false)}
  })
  it('capabilities cannot be used across requests',async()=>{
    const b=envelope(1);const first=await create(b);const other=envelope(1);other.recovery_token=WRONG;
    const second=await create(other);
    await expect(rpc(db,'get_panel_planner_customer_photos',{p_request_id:second.request_id,p_recovery_token:SECRET})).rejects.toThrow('CAPABILITY_INVALID')
    await expect(rpc(db,'authorize_panel_planner_photos',{p_request_id:second.request_id,p_recovery_token:SECRET,p_authorization_key:randomUUID(),p_photo_ids:other.photo_manifest.map(x=>x.client_photo_id)})).rejects.toThrow('CAPABILITY_INVALID')
    expect(first.request_id).not.toBe(second.request_id)
  })
  it('photo read capability expires at 24h',async()=>{const r=await create();await db.exec("UPDATE test_clock SET t=t+interval '24 hours'");await expect(rpc(db,'get_panel_planner_customer_photos',{p_request_id:r.request_id,p_recovery_token:SECRET})).rejects.toThrow('RECOVERY_EXPIRED')})
  it('empty finalization requires explicit photo close',async()=>{const b=envelope(1),r=await create(b),batch=await authorize(r,b);await expect(finalize(args(r,batch,[]),batch)).rejects.toThrow('INVALID_PAYLOAD');expect((await finalize(args(r,batch,[],true),batch)).photos.state).toBe('closed_without_all_photos')})
  it('HUNTER existing link from another tenant is denied',async()=>{const r=await create();const id=randomUUID();await db.query('INSERT INTO hunter_leads(id,tenant_id) VALUES($1,$2)',[id,randomUUID()]);await db.query('UPDATE portal_requests SET hunter_lead_id=$1 WHERE id=$2',[id,r.request_id]);await role(db);await expect(rpc(db,'accept_portal_request_to_hunter',{p_request_id:r.request_id})).rejects.toThrow('REQUEST_UNAVAILABLE')})
  it('HUNTER source normalization retains existing semantics',async()=>{const r=await create();await db.query("UPDATE portal_requests SET source_category=' Paid_Search ' WHERE id=$1",[r.request_id]);await role(db);await rpc(db,'accept_portal_request_to_hunter',{p_request_id:r.request_id});await db.exec('RESET ROLE');expect((await db.query('SELECT source FROM hunter_leads')).rows[0].source).toBe('paid_search')})
  it('invalid value profile is ignored instead of blocking acceptance',async()=>{const r=await create();await db.query("INSERT INTO tenant_settings VALUES($1,'lead_value_profiles_v1',$2::jsonb)",[TENANT,JSON.stringify({profiles:[{id:'x',name:'x',serviceCategory:'panel_upgrade',minValue:'bad',maxValue:123}]})]);await role(db);await rpc(db,'accept_portal_request_to_hunter',{p_request_id:r.request_id});await db.exec('RESET ROLE');expect((await db.query('SELECT estimated_value FROM hunter_leads')).rows[0].estimated_value).toBeNull()})
  it('notification payload freezes through retry and stops after ambiguous horizon',async()=>{
    await create();let [event]=await rpc(db,'claim_panel_planner_notifications');
    const first={to:['trusted@example.com'],text:'saved request'};
    expect(await rpc(db,'prepare_panel_planner_notification',{p_id:event.id,p_claim_token:event.claim_token,p_delivery_payload:first})).toEqual(first)
    await db.exec("UPDATE test_clock SET t=t+interval '6 minutes'");
    ;[event]=await rpc(db,'claim_panel_planner_notifications');
    expect(await rpc(db,'prepare_panel_planner_notification',{p_id:event.id,p_claim_token:event.claim_token,p_delivery_payload:{to:['changed@example.com']}})).toEqual(first)
    await db.exec("UPDATE test_clock SET t=t+interval '23 hours'");
    expect(await rpc(db,'claim_panel_planner_notifications')).toEqual([])
    expect((await db.query('SELECT state FROM portal_planner_notification_events')).rows[0].state).toBe('uncertain')
    expect((await db.query('SELECT notification_state FROM portal_request_planner_details')).rows[0].notification_state.owner_new_request).toBe('uncertain')
  })
  it('creates one canonical request and immutable private snapshot',async()=>{
    const b=envelope();const result=await create(b)
    expect(result.request_state).toBe('saved');expect(result.photos.state).toBe('not_requested')
    const row=(await db.query('SELECT * FROM portal_requests')).rows[0]
    expect([row.organization_id,row.request_type,row.service_category,row.source,row.status]).toEqual([ORG,'homeowner','panel_upgrade','customer_portal','new'])
    expect(row.description).not.toContain('existing_service')
    const d=(await db.query('SELECT * FROM portal_request_planner_details')).rows[0]
    expect(d.snapshot).toEqual(b.planner_payload);expect(d.recovery_token_hash).not.toBe(SECRET)
    expect(d.consent_version).toBe('panel_planner_contact_v1');expect(d.consent_granted).toBe(true)
    expect(new Date(d.write_deadline).getTime()-new Date(d.created_at).getTime()).toBe(1800000)
    expect(new Date(d.recovery_expires_at).getTime()-new Date(d.created_at).getTime()).toBe(86400000)
    expect(new Date(d.dedupe_expires_at).getTime()-new Date(d.created_at).getTime()).toBe(90*86400000)
  })
  it('duplicate same payload returns receipt and no duplicate events',async()=>{
    const b=envelope();b.planner_payload.customer.email='test@example.com'
    const first=await create(b);const second=await create(b)
    expect(second.request_id).toBe(first.request_id);expect(second.replayed).toBe(true)
    expect((await db.query('SELECT count(*)::int n FROM portal_requests')).rows[0].n).toBe(1)
    expect((await db.query('SELECT count(*)::int n FROM portal_planner_notification_events')).rows[0].n).toBe(2)
  })
  it('concurrent callers create exactly one request',async()=>{
    const b=envelope();const receipts=await Promise.all(Array.from({length:8},()=>create(b)))
    expect(new Set(receipts.map(r=>r.request_id)).size).toBe(1)
    expect((await db.query('SELECT count(*)::int n FROM portal_requests')).rows[0].n).toBe(1)
  })
  it('changed payload conflicts',async()=>{const b=envelope();await create(b);b.customer_note='different';await expect(create(b)).rejects.toThrow('IDEMPOTENCY_CONFLICT')})
  it('lost response and refreshed caller recover using only key+proof',async()=>{
    const b=envelope();const first=await create(b);const result=await recover(b)
    expect(result.request_id).toBe(first.request_id)
    expect(JSON.stringify(result)).not.toMatch(/snapshot|customer_note|recovery_token|payload_digest|Planner Test/)
  })
  it('wrong create replay proof denied',async()=>{const b=envelope();await create(b);b.recovery_token=WRONG;await expect(create(b)).rejects.toThrow('CAPABILITY_INVALID')})
  it('details constraint failure rolls back request and events',async()=>{
    const b=envelope();b.customer_note='x'.repeat(5001)
    await expect(rpc(db,'submit_panel_planner_request',createArgs(b))).rejects.toThrow()
    expect((await db.query('SELECT count(*)::int n FROM portal_requests')).rows[0].n).toBe(0)
    expect((await db.query('SELECT count(*)::int n FROM portal_planner_notification_events')).rows[0].n).toBe(0)
  })
  it('submitted snapshot and manifest cannot be updated',async()=>{await create();await expect(db.exec("UPDATE portal_request_planner_details SET snapshot='{}'")).rejects.toThrow('INVALID_PAYLOAD')})
  it.each(['SELECT * FROM portal_request_planner_details',"INSERT INTO portal_request_planner_details(request_id) VALUES(gen_random_uuid())","UPDATE portal_request_planner_details SET customer_note='x'","DELETE FROM portal_request_planner_details","INSERT INTO portal_requests(name) VALUES('x')","UPDATE portal_requests SET status='accepted'","SELECT submit_panel_planner_request('{}',gen_random_uuid(),'x',NULL,'x','[]')"])('anon cannot %s',async sql=>{
    await create();await db.exec('SET ROLE anon');await expect(db.exec(sql)).rejects.toThrow()
  })
  it.each([EMPLOYEE,OTHER_OWNER])('denies owner projection to unauthorized %s',async user=>{
    const r=await create();await role(db,user);expect(await rpc(db,'get_panel_planner_owner_details',{p_request_id:r.request_id})).toBeNull()
  })

  it('same-org admin can read details and atomically accept',async()=>{
    const r=await create();await db.query("UPDATE test_profiles SET role='admin' WHERE id=$1",[OWNER]);
    try{await role(db);expect((await rpc(db,'get_panel_planner_owner_details',{p_request_id:r.request_id})).consent_granted).toBe(true);expect((await rpc(db,'accept_portal_request_to_hunter',{p_request_id:r.request_id})).replayed).toBe(false)}
    finally{await db.exec('RESET ROLE');await db.query("UPDATE test_profiles SET role='owner' WHERE id=$1",[OWNER])}
  })
  it('acceptance fails closed when canonical tenant is unmapped',async()=>{
    const r=await create();await db.query('UPDATE organizations SET hunter_tenant_id=NULL WHERE id=$1',[ORG]);
    try{await role(db);await expect(rpc(db,'accept_portal_request_to_hunter',{p_request_id:r.request_id})).rejects.toThrow('hunter_tenant_unmapped')}
    finally{await db.exec('RESET ROLE');await db.query('UPDATE organizations SET hunter_tenant_id=$1 WHERE id=$2',[TENANT,ORG])}
  })
  it('acceptance requires membership in the mapped tenant',async()=>{
    const r=await create();await db.query('DELETE FROM user_tenants WHERE user_id=$1 AND tenant_id=$2',[OWNER,TENANT]);
    try{await role(db);await expect(rpc(db,'accept_portal_request_to_hunter',{p_request_id:r.request_id})).rejects.toThrow('hunter_tenant_membership_missing')}
    finally{await db.exec('RESET ROLE');await db.query('INSERT INTO user_tenants VALUES($1,$2)',[OWNER,TENANT])}
  })
  it('same-org owner safe projection has snapshot/consent but no secret/transport',async()=>{
    const r=await create();await role(db);const result=await rpc(db,'get_panel_planner_owner_details',{p_request_id:r.request_id})
    expect(result.snapshot).toEqual(fixtureWithKey(fixture.submission.idempotency_key))
    expect(result.customer_note).toBe('Please call after work');expect(result.consent_granted).toBe(true)
    expect(Object.keys(result)).not.toEqual(expect.arrayContaining(['recovery_token_hash','payload_digest','photo_transport']))
  })
  function fixtureWithKey(key){const p=clone(fixture);p.submission.idempotency_key=key;delete p.submission.idempotency_key;return p}
  it('owner cannot directly read table secret columns',async()=>{await create();await role(db);await expect(db.exec('SELECT recovery_token_hash FROM portal_request_planner_details')).rejects.toThrow()})
  it('public tracking retains exactly its existing safe projection',async()=>{
    const r=await create(envelope(1));await db.exec('SET ROLE anon')
    const view=await rpc(db,'get_portal_request_status',{p_id:r.request_id})
    expect(Object.keys(view).sort()).toEqual(['id','name','service_category','description','address','city','preferred_date','preferred_time','status','created_at'].sort())
    expect(JSON.stringify(view)).not.toMatch(/snapshot|consent|FilePaths|recovery|photo_manifest|idempotency/)
  })
  it('authorization replay stays stable and new keys rotate bounded current paths',async()=>{
    const b=envelope(2),r=await create(b),key=randomUUID();const first=await authorize(r,b,undefined,key)
    const again=await authorize(r,b,undefined,key);const fresh=await authorize(r,b)
    expect(again.authorization_id).toBe(first.authorization_id)
    expect(again.files).toEqual(first.files)
    for(let i=0;i<first.files.length;i++)expect(fresh.files[i].object_path).not.toBe(first.files[i].object_path)
    const oldReplay=await authorize(r,b,undefined,key);expect(oldReplay.files).toEqual(first.files)
    expect((await db.query('SELECT (SELECT count(*) FROM jsonb_object_keys(photo_transport->\'objects\')) n FROM portal_request_planner_details')).rows[0].n).toBe(2)
  })
  it('valid existing object reconciles an ambiguous upload without reallocation',async()=>{
    const b=envelope(1),r=await create(b),batch=await authorize(r,b);await storeFile(batch.files[0])
    const receipt=await finalize(args(r,batch),batch)
    expect(receipt.photos.state).toBe('complete')
    expect((await rpc(db,'get_panel_planner_customer_photos',{p_request_id:r.request_id,p_recovery_token:SECRET}))[0].object_path).toBe(batch.files[0].object_path)
  })
  it('invalid existing object recovers on a new path in the same saved request',async()=>{
    const b=envelope(1),r=await create(b),old=await authorize(r,b);await storeFile(old.files[0],{size:1})
    await expect(finalize(args(r,old),old)).rejects.toThrow('PHOTO_OBJECT_INVALID')
    expect((await recover(b)).request_state).toBe('saved')
    const next=await authorize(r,b);expect(next.files[0].object_path).not.toBe(old.files[0].object_path)
    await storeFile(next.files[0]);expect((await finalize(args(r,next),next)).photos.state).toBe('complete')
    expect((await db.query('SELECT count(*)::int n FROM portal_requests')).rows[0].n).toBe(1)
  })
  it('superseded authorization cannot finalize even when its object is valid',async()=>{
    const b=envelope(1),r=await create(b),old=await authorize(r,b);await storeFile(old.files[0]);await authorize(r,b)
    await expect(rpc(db,'prepare_panel_planner_finalization',args(r,old))).rejects.toThrow('PHOTO_OBJECT_INVALID')
    await expect(finalize(args(r,old),old)).rejects.toThrow('PHOTO_OBJECT_INVALID')
    await expect(finalize(args(r,old,[],true),old)).rejects.toThrow('PHOTO_OBJECT_INVALID')
    expect((await recover(b)).photos.registered_photo_ids).toEqual([])
  })
  it('rotation between prepare and finalize rejects stale verified bytes',async()=>{
    const b=envelope(1),r=await create(b),old=await authorize(r,b);await storeFile(old.files[0]);const a=args(r,old)
    expect((await rpc(db,'prepare_panel_planner_finalization',a)).files).toEqual(old.files)
    await authorize(r,b);await expect(finalize(a,old)).rejects.toThrow('PHOTO_OBJECT_INVALID')
  })
  it('registered IDs reject both same-key and new-key authorization',async()=>{
    const b=envelope(2),r=await create(b),key=randomUUID(),old=await authorize(r,b,undefined,key)
    await storeFile(old.files[0]);await finalize(args(r,old,[old.files[0].client_photo_id]),old)
    await expect(authorize(r,b,[old.files[0].client_photo_id])).rejects.toThrow('PHOTO_OBJECT_INVALID')
    await expect(authorize(r,b,undefined,key)).rejects.toThrow('PHOTO_OBJECT_INVALID')
  })
  it('retrying B after A registers preserves A metadata and bytes path',async()=>{
    const b=envelope(2),r=await create(b),old=await authorize(r,b);await storeFile(old.files[0]);await storeFile(old.files[1],{size:1})
    await finalize(args(r,old,[old.files[0].client_photo_id]),old)
    const before=await rpc(db,'get_panel_planner_customer_photos',{p_request_id:r.request_id,p_recovery_token:SECRET})
    const bad=await authorize(r,b,[old.files[1].client_photo_id]);await storeFile(bad.files[0],{size:1})
    await expect(finalize(args(r,bad),bad)).rejects.toThrow('PHOTO_OBJECT_INVALID')
    const next=await authorize(r,b,[old.files[1].client_photo_id]);await storeFile(next.files[0]);await finalize(args(r,next),next)
    const after=await rpc(db,'get_panel_planner_customer_photos',{p_request_id:r.request_id,p_recovery_token:SECRET})
    expect(after.find(f=>f.client_photo_id===before[0].client_photo_id)).toEqual(before[0]);expect(after).toHaveLength(2)
  })
  it('new-key retry does not renew original registration deadline',async()=>{
    const b=envelope(1),r=await create(b),old=await authorize(r,b);await db.exec("UPDATE test_clock SET t=t+interval '29 minutes'")
    const next=await authorize(r,b);expect(next.registration_deadline).toBe(old.registration_deadline)
    await db.exec("UPDATE test_clock SET t=t+interval '1 minute'")
    await expect(authorize(r,b)).rejects.toThrow('PHOTO_WINDOW_EXPIRED');await expect(finalize(args(r,next),next)).rejects.toThrow('PHOTO_WINDOW_EXPIRED')
  })
  it('cleanup retains superseded and current unregistered allocations but excludes registered',async()=>{
    const b=envelope(3),r=await create(b),old=await authorize(r,b);for(const f of old.files)await storeFile(f)
    await finalize(args(r,old,[old.files[0].client_photo_id]),old)
    const next=await authorize(r,b,[old.files[1].client_photo_id]);await storeFile(next.files[0]);await finalize(args(r,next),next)
    const current=await authorize(r,b,[old.files[2].client_photo_id]);await storeFile(current.files[0])
    // A UUID-shaped object under this request that was never allocated remains out of scope.
    await storeFile({...old.files[2],object_path:r.request_id+'/'+randomUUID()+'.png'})
    expect(await rpc(db,'panel_planner_orphan_paths')).toEqual([])
    await db.exec("UPDATE test_clock SET t=t+interval '24 hours'")
    expect((await rpc(db,'panel_planner_orphan_paths')).sort()).toEqual([old.files[1].object_path,old.files[2].object_path,current.files[0].object_path].sort())
  })
  it('failed new-key selection rolls back rotation and allocation history atomically',async()=>{
    const b=envelope(1),r=await create(b),old=await authorize(r,b)
    const before=(await db.query('SELECT photo_transport FROM portal_request_planner_details')).rows[0].photo_transport
    await expect(authorize(r,b,[old.files[0].client_photo_id,randomUUID()])).rejects.toThrow('PHOTO_OBJECT_INVALID')
    expect((await db.query('SELECT photo_transport FROM portal_request_planner_details')).rows[0].photo_transport).toEqual(before)
    expect((await db.query('SELECT count(*)::int n FROM portal_upload_authorizations')).rows[0].n).toBe(1)
  })

  it('rotation cannot transplant another request authorization or verified path',async()=>{
    const b=envelope(1),r=await create(b),old=await authorize(r,b),next=await authorize(r,b);await storeFile(next.files[0])
    const other=await create(envelope(1))
    await expect(finalize(args(other,next),next)).rejects.toThrow('PHOTO_OBJECT_INVALID')
    await expect(rpc(db,'finalize_panel_planner_photos',{...args(r,next),p_verified_objects:[{...next.files[0],object_path:other.request_id+'/'+randomUUID()+'.png',signature_verified:true}]})).rejects.toThrow('PHOTO_OBJECT_INVALID')
    expect((await recover(b)).photos.registered_photo_ids).toEqual([])
  })
  it('rotation of B leaves an unregistered A allocation valid in its original batch',async()=>{
    const b=envelope(2),r=await create(b),old=await authorize(r,b);await storeFile(old.files[0])
    const next=await authorize(r,b,[old.files[1].client_photo_id]);await storeFile(next.files[0])
    expect((await finalize(args(r,old,[old.files[0].client_photo_id]),old)).photos.state).toBe('partial')
    expect((await finalize(args(r,next),next)).photos.state).toBe('complete')
  })
  it('a failed upload before creation replays its key and can subsequently register',async()=>{
    const b=envelope(1),r=await create(b),key=randomUUID(),old=await authorize(r,b,undefined,key)
    await expect(finalize(args(r,old),old)).rejects.toThrow('PHOTO_OBJECT_INVALID')
    const replay=await authorize(r,b,undefined,key);expect(replay.authorization_id).toBe(old.authorization_id);expect(replay.files).toEqual(old.files)
    await storeFile(replay.files[0]);expect((await finalize(args(r,replay),replay)).photos.state).toBe('complete')
  })

  it('authorization key changed selection conflicts',async()=>{const b=envelope(2),r=await create(b),key=randomUUID();await authorize(r,b,[b.photo_manifest[0].client_photo_id],key);await expect(authorize(r,b,[b.photo_manifest[1].client_photo_id],key)).rejects.toThrow('FINALIZATION_CONFLICT')})
  it('substituted or duplicate photo IDs denied',async()=>{const b=envelope(1),r=await create(b);await expect(authorize(r,b,[randomUUID()])).rejects.toThrow('PHOTO_OBJECT_INVALID');await expect(authorize(r,b,[b.photo_manifest[0].client_photo_id,b.photo_manifest[0].client_photo_id])).rejects.toThrow('INVALID_PAYLOAD')})
  it('wrong recovery cannot authorize',async()=>{const b=envelope(1),r=await create(b);await expect(rpc(db,'authorize_panel_planner_photos',{p_request_id:r.request_id,p_recovery_token:WRONG,p_authorization_key:randomUUID(),p_photo_ids:[b.photo_manifest[0].client_photo_id]})).rejects.toThrow('CAPABILITY_INVALID')})
  it('missing object fails without changing pending state',async()=>{const b=envelope(1),r=await create(b),batch=await authorize(r,b);await expect(finalize(args(r,batch),batch)).rejects.toThrow('PHOTO_OBJECT_INVALID');expect((await recover(b)).photos.state).toBe('pending')})
  it('partial finalization then retry completes without a second request',async()=>{
    const b=envelope(2),r=await create(b),batch=await authorize(r,b);await storeFile(batch.files[0])
    const partial=await finalize(args(r,batch,[batch.files[0].client_photo_id]),batch);expect(partial.photos.state).toBe('partial')
    const next=await authorize(r,b,[batch.files[1].client_photo_id]);await storeFile(next.files[0])
    expect((await finalize(args(r,next),next)).photos.state).toBe('complete')
    const row=(await db.query('SELECT notes FROM portal_requests')).rows[0]
    expect((row.notes.match(/FilePaths:/g)||[]).length).toBe(1);expect(row.notes).toContain(batch.files[0].object_path);expect(row.notes).toContain(next.files[0].object_path)
    expect((await db.query('SELECT count(*)::int n FROM portal_requests')).rows[0].n).toBe(1)
  })
  it('selected multi-file batch is all-or-nothing',async()=>{
    const b=envelope(2),r=await create(b),batch=await authorize(r,b);await storeFile(batch.files[0])
    await expect(finalize(args(r,batch),batch)).rejects.toThrow('PHOTO_OBJECT_INVALID')
    expect((await recover(b)).photos.registered_photo_ids).toEqual([])
  })
  it('finalization lost response replay survives the 30m deadline without reopening writes',async()=>{
    const b=envelope(1),r=await create(b),batch=await authorize(r,b);await storeFile(batch.files[0]);const a=args(r,batch)
    const first=await finalize(a,batch);await db.exec("UPDATE test_clock SET t=t+interval '31 minutes'")
    const second=await finalize(a,batch);expect(second.replayed).toBe(true);expect(second.request_id).toBe(first.request_id)
    await expect(authorize(r,b)).rejects.toThrow('PHOTO_WINDOW_EXPIRED')
  })
  it('changed finalization replay conflicts',async()=>{const b=envelope(1),r=await create(b),batch=await authorize(r,b);await storeFile(batch.files[0]);const a=args(r,batch);await finalize(a,batch);a.p_close_photos=true;await expect(finalize(a,batch)).rejects.toThrow('FINALIZATION_CONFLICT')})
  it('close remaining photos keeps saved request',async()=>{const b=envelope(2),r=await create(b),batch=await authorize(r,b);await storeFile(batch.files[0]);const result=await finalize(args(r,batch,[batch.files[0].client_photo_id],true),batch);expect(result.photos.state).toBe('closed_without_all_photos');await expect(authorize(r,b,[batch.files[1].client_photo_id])).rejects.toThrow('PHOTO_REQUEST_CLOSED')})
  it.each([{size:10485761},{size:1},{mimetype:'application/pdf'},{size:null}])('bad stored metadata cannot register %j',async bad=>{
    const b=envelope(1),r=await create(b),batch=await authorize(r,b);await storeFile(batch.files[0],bad);await expect(finalize(args(r,batch),batch)).rejects.toThrow('PHOTO_OBJECT_INVALID')
  })
  it('tampered server verification path denied',async()=>{const b=envelope(1),r=await create(b),batch=await authorize(r,b);await storeFile(batch.files[0]);await expect(rpc(db,'finalize_panel_planner_photos',{...args(r,batch),p_verified_objects:[{...batch.files[0],object_path:randomUUID()+'/'+randomUUID()+'.png',signature_verified:true}]})).rejects.toThrow('PHOTO_OBJECT_INVALID')})
  it('cross-request authorization cannot finalize',async()=>{const b=envelope(1),r=await create(b),batch=await authorize(r,b);const second=await create(envelope(1));await expect(finalize(args(second,batch),batch)).rejects.toThrow('PHOTO_OBJECT_INVALID')})
  it('photo reads require the correct request capability',async()=>{
    const b=envelope(1),r=await create(b),batch=await authorize(r,b);await storeFile(batch.files[0]);await finalize(args(r,batch),batch)
    expect((await rpc(db,'get_panel_planner_customer_photos',{p_request_id:r.request_id,p_recovery_token:SECRET})).length).toBe(1)
    await expect(rpc(db,'get_panel_planner_customer_photos',{p_request_id:r.request_id,p_recovery_token:WRONG})).rejects.toThrow('CAPABILITY_INVALID')
  })
  it('expired writes still allow receipt recovery for 24h',async()=>{const b=envelope(1),r=await create(b);await db.exec("UPDATE test_clock SET t=t+interval '30 minutes'");await expect(authorize(r,b)).rejects.toThrow('PHOTO_WINDOW_EXPIRED');expect((await recover(b)).photos.state).toBe('expired');await db.exec("UPDATE test_clock SET t=t+interval '23 hours 30 minutes'");await expect(recover(b)).rejects.toThrow('REQUEST_UNAVAILABLE')})
  it('acceptance closes photo writes while keeping recovery',async()=>{const b=envelope(1),r=await create(b);await role(db);await rpc(db,'accept_portal_request_to_hunter',{p_request_id:r.request_id});await db.exec('RESET ROLE');expect((await recover(b)).photos.state).toBe('unavailable_after_acceptance');await expect(authorize(r,b)).rejects.toThrow('PHOTO_REQUEST_CLOSED')})
  it('acceptance and concurrent replays produce only one HUNTER lead',async()=>{
    const r=await create();await role(db);const results=await Promise.all(Array.from({length:6},()=>rpc(db,'accept_portal_request_to_hunter',{p_request_id:r.request_id})))
    expect(new Set(results.map(x=>x.lead_id)).size).toBe(1);expect(results.filter(x=>!x.replayed).length).toBe(1)
    await db.exec('RESET ROLE');expect((await db.query('SELECT count(*)::int n FROM hunter_leads')).rows[0].n).toBe(1)
    expect((await db.query('SELECT count(*)::int n FROM portal_request_planner_details')).rows[0].n).toBe(1)
  })
  it('HUNTER link failure rolls back lead insert',async()=>{
    const r=await create();await db.exec("CREATE FUNCTION public.test_reject_link() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test link failure'; END $$; CREATE TRIGGER test_reject_link BEFORE UPDATE ON portal_requests FOR EACH ROW EXECUTE FUNCTION test_reject_link();")
    await role(db);await expect(rpc(db,'accept_portal_request_to_hunter',{p_request_id:r.request_id})).rejects.toThrow('test link failure')
    await db.exec('RESET ROLE; DROP TRIGGER test_reject_link ON portal_requests; DROP FUNCTION test_reject_link()')
    expect((await db.query('SELECT count(*)::int n FROM hunter_leads')).rows[0].n).toBe(0)
  })
  it.each([EMPLOYEE,OTHER_OWNER])('unauthorized conversion denied %s',async user=>{const r=await create();await role(db,user);await expect(rpc(db,'accept_portal_request_to_hunter',{p_request_id:r.request_id})).rejects.toThrow('REQUEST_UNAVAILABLE')})
  it('canonical mapping and stored value profile preserved',async()=>{const r=await create();await db.query("INSERT INTO tenant_settings VALUES($1,'lead_value_profiles_v1',$2::jsonb)",[TENANT,JSON.stringify({version:1,profiles:[{id:'panel-profile',name:'Panel upgrade',serviceCategory:'panel_upgrade',minValue:1000,maxValue:3000}]})]);await role(db);await rpc(db,'accept_portal_request_to_hunter',{p_request_id:r.request_id});await db.exec('RESET ROLE');const row=(await db.query('SELECT * FROM hunter_leads')).rows[0];expect(row.tenant_id).toBe(TENANT);expect(row.estimated_value).toBe('2000');expect(row.lead_type).toBe('panel_upgrade')})
  it('24h cleanup excludes registered and unrelated objects',async()=>{
    const b=envelope(2),r=await create(b),batch=await authorize(r,b);for(const f of batch.files)await storeFile(f)
    await finalize(args(r,batch,[batch.files[0].client_photo_id]),batch)
    await db.query("INSERT INTO storage.objects(bucket_id,name,metadata,created_at) VALUES('portal-uploads',$1,'{}',planner_private.now())",[randomUUID()+'/'+randomUUID()+'.png'])
    expect(await rpc(db,'panel_planner_orphan_paths')).toEqual([])
    await db.exec("UPDATE test_clock SET t=t+interval '24 hours'")
    expect(await rpc(db,'panel_planner_orphan_paths')).toEqual([batch.files[1].object_path])
    expect((await db.query('SELECT public FROM storage.buckets')).rows[0].public).toBe(false)
  })
  it('90d digest expiry retains request and non-reusable key tombstone',async()=>{
    const b=envelope();await create(b);await db.exec("UPDATE test_clock SET t=t+interval '90 days'")
    expect(await rpc(db,'panel_planner_expire_technical_data')).toBe(1)
    await expect(create(b)).rejects.toThrow('IDEMPOTENCY_CONFLICT')
    expect((await db.query('SELECT count(*)::int n FROM portal_requests')).rows[0].n).toBe(1)
    expect((await db.query('SELECT snapshot,payload_digest,recovery_token_hash FROM portal_request_planner_details')).rows[0].snapshot).toEqual(b.planner_payload)
  })
  it('notification intents come from saved request and email presence',async()=>{await create();let events=await rpc(db,'claim_panel_planner_notifications');expect(events.length).toBe(1);expect(events[0].name).toBe('Planner Test');expect(events[0].event_type).toBe('owner_new_request')})
  it('failed notification never changes request saved',async()=>{const b=envelope();await create(b);const [event]=await rpc(db,'claim_panel_planner_notifications');await rpc(db,'complete_panel_planner_notification',{p_id:event.id,p_claim_token:event.claim_token,p_state:'failed',p_message_id:null});const receipt=await recover(b);expect(receipt.request_state).toBe('saved');expect(receipt.notifications.owner).toBe('failed')})
  it('rate counter rejects excess requests and expires window',async()=>{const hash='f'.repeat(64);for(let i=0;i<60;i++)expect(await rpc(db,'panel_planner_rate_limit',{p_bucket_hash:hash})).toBe(true);expect(await rpc(db,'panel_planner_rate_limit',{p_bucket_hash:hash})).toBe(false);await db.exec("UPDATE test_clock SET t=t+interval '10 minutes'");expect(await rpc(db,'panel_planner_rate_limit',{p_bucket_hash:hash})).toBe(true)})
  it('attribution fields preserved without putting snapshot into public description',async()=>{const b=envelope();b.planner_payload.attribution={utm_source:'google',gclid:'G1',gbraid:'B1',wbraid:'W1',utm_medium:'cpc',utm_campaign:'panel',utm_content:'ad',utm_term:'panel upgrade'};await create(b);const row=(await db.query('SELECT * FROM portal_requests')).rows[0];for(const[k,v]of Object.entries(b.planner_payload.attribution))expect(row[k]).toBe(v)})
})
describe('planner API, storage byte validation and legacy bypass protection',()=>{
  it('denies UUID-only legacy photo reads for planner rows',async()=>expect(await denyPlannerUuidRead(async()=>new Response(JSON.stringify([{request_id:randomUUID()}])), 'https://db.example',{},randomUUID())).toBe(true))
  it('preserves legacy non-planner photo reads',async()=>expect(await denyPlannerUuidRead(async()=>new Response('[]'),'https://db.example',{},randomUUID())).toBe(false))
  it('legacy planner detection fails closed',async()=>await expect(denyPlannerUuidRead(async()=>new Response('',{status:500}),'https://db.example',{},randomUUID())).rejects.toThrow('TEMPORARILY_UNAVAILABLE'))
  it('HTTP origin denied before backend access',async()=>{const h=makeHandler({backendFactory:()=>{throw Error('must not run')}});expect((await h({httpMethod:'POST',headers:{origin:'https://evil.example'},body:'{}'})).statusCode).toBe(403)})
  it('production preflight supported',async()=>{const h=makeHandler();expect((await h({httpMethod:'OPTIONS',headers:{origin:'https://poweronsolutionsllc.com'}})).statusCode).toBe(204)})
  it('database internals are hidden behind stable errors',async()=>{const h=makeHandler({backendFactory:()=>({rateHash:()=>'',rpc:async()=>{throw Error('password/internal SQL')}})});const result=await h({httpMethod:'POST',headers:{origin:'https://poweronsolutionsllc.com'},body:JSON.stringify(envelope())});expect(result.body).toContain('TEMPORARILY_UNAVAILABLE');expect(result.body).not.toContain('password')})
  const signatures=[
    ['image/jpeg',[255,216,255,224]],['image/png',[137,80,78,71,13,10,26,10]],
    ['image/webp',[82,73,70,70,24,0,0,0,87,69,66,80]]
  ]
  it.each(signatures)('verifies real %s signature',async(mime,bytes)=>{
    const f={client_photo_id:randomUUID(),object_path:randomUUID()+'/'+randomUUID()+'.png',mime_type:mime,size_bytes:32}
    const backend=runtime({SUPABASE_URL:'https://db.example',SUPABASE_SERVICE_ROLE_KEY:'server'},async(_url,opt)=>
      new Response(new Uint8Array(bytes),{status:206,headers:{'content-range':'bytes 0-31/32','content-type':mime}}))
    expect((await backend.verifyObject(f)).signature_verified).toBe(true)
  })
  it('rejects MIME spoofing by inspecting bytes',async()=>{
    const backend=runtime({SUPABASE_URL:'https://db.example',SUPABASE_SERVICE_ROLE_KEY:'server'},async(_url,opt)=>
      new Response('<svg></svg>',{status:206,headers:{'content-range':'bytes 0-31/32','content-type':'image/png'}}))
    await expect(backend.verifyObject({client_photo_id:randomUUID(),object_path:randomUUID()+'/'+randomUUID()+'.png',mime_type:'image/png',size_bytes:32})).rejects.toThrow('PHOTO_TYPE_INVALID')
  })
  it('rejects oversized actual object before reading its bytes',async()=>{
    const backend=runtime({SUPABASE_URL:'https://db.example',SUPABASE_SERVICE_ROLE_KEY:'server'},async()=>new Response('bytes',{headers:{'content-length':'10485761','content-type':'image/png'}}))
    await expect(backend.verifyObject({object_path:randomUUID()+'/'+randomUUID()+'.png',mime_type:'image/png',size_bytes:32})).rejects.toThrow('PHOTO_TOO_LARGE')
  })

  it('handles Storage ignoring Range with a bounded read',async()=>{
    let calls=0,canceled=false;
    const body=new ReadableStream({pull(controller){controller.enqueue(new Uint8Array([137,80,78,71,13,10,26,10,...Array(100).fill(0)]))},cancel(){canceled=true}})
    const backend=runtime({SUPABASE_URL:'https://db.example',SUPABASE_SERVICE_ROLE_KEY:'server'},async(_url,opt)=>{calls++;expect(opt.method).not.toBe('HEAD');expect(opt.headers.Range).toBe('bytes=0-31');return new Response(body,{headers:{'content-length':'108','content-type':'image/png'}})})
    expect((await backend.verifyObject({object_path:randomUUID()+'/'+randomUUID()+'.png',mime_type:'image/png',size_bytes:108})).signature_verified).toBe(true);expect(calls).toBe(1);expect(canceled).toBe(true)
  })
  it.each([null,'bytes 1-31/32','bytes 0-63/64','bytes 0-31/*'])('rejects invalid partial response metadata %s',range=>{
    const headers={'content-type':'image/png',...(range?{'content-range':range}:{})};
    const backend=runtime({SUPABASE_URL:'https://db.example',SUPABASE_SERVICE_ROLE_KEY:'server'},async()=>new Response('data',{status:206,headers}));
    return expect(backend.verifyObject({object_path:randomUUID()+'/'+randomUUID()+'.png',mime_type:'image/png',size_bytes:32})).rejects.toThrow('PHOTO_OBJECT_INVALID')
  })
  it('signed reads use exactly 300 seconds',async()=>{
    let captured
    const backend=runtime({SUPABASE_URL:'https://db.example',SUPABASE_SERVICE_ROLE_KEY:'server'},async(url,opt)=>{captured=JSON.parse(opt.body);return new Response(JSON.stringify({signedURL:'/object/sign/portal-uploads/test?token=x'}))})
    await backend.signRead({client_photo_id:randomUUID(),object_path:randomUUID()+'/'+randomUUID()+'.png'})
    expect(captured.expiresIn).toBe(300)
  })
})



describe('planner notification foundation',()=>{
  const {runMaintenance}=require('../../netlify/functions/lib/planner-maintenance.cjs')
  const env={RESEND_API_KEY:'provider-test',PANEL_PLANNER_OWNER_EMAIL:'owner@example.com',PANEL_PLANNER_FROM_EMAIL:'Power On <requests@example.com>'}
  function backend(events){
    const calls=[]
    return {calls,remove:async paths=>calls.push(['remove',paths]),rpc:async(name,args)=>{
      calls.push([name,args])
      if(name==='panel_planner_orphan_paths')return []
      if(name==='panel_planner_expire_technical_data')return 0
      if(name==='claim_panel_planner_notifications')return events
      if(name==='prepare_panel_planner_notification')return args.p_delivery_payload
      return true
    }}
  }
  const event=()=>({id:randomUUID(),claim_token:randomUUID(),request_id:randomUUID(),
    event_type:'owner_new_request',owner_email_fallback_allowed:true,name:'Trusted saved name',email:'customer@example.com',phone:'7605550100',description:'Panel request'})
  it('owner recipient comes only from backend config',async()=>{
    const e=event();e.recipient='attacker@example.com';const b=backend([e]);let sent
    const result=await runMaintenance({env,backend:b,fetcher:async(_url,opt)=>{sent=JSON.parse(opt.body);return new Response('{"id":"provider-id"}')}})
    expect(sent.to).toEqual(['owner@example.com']);expect(sent.text).toContain('Trusted saved name');expect(result.sent).toBe(1)
  })
  it('customer recipient comes from persisted request email',async()=>{
    const e=event();e.event_type='customer_submission_confirmation';const b=backend([e]);let sent
    await runMaintenance({env,backend:b,fetcher:async(_url,opt)=>{sent=JSON.parse(opt.body);return new Response('{"id":"provider-id"}')}})
    expect(sent.to).toEqual(['customer@example.com'])
  })
  it('provider retries use stable request/event idempotency key',async()=>{
    const e=event();const b=backend([e]);let key
    await runMaintenance({env,backend:b,fetcher:async(_url,opt)=>{key=opt.headers['Idempotency-Key'];return new Response('{"id":"provider-id"}')}})
    expect(key).toBe('panel-planner/'+e.request_id+'/owner_new_request')
  })
  it('provider failure is persisted without touching request creation',async()=>{
    const b=backend([event()]);const result=await runMaintenance({env,backend:b,fetcher:async()=>new Response('{"message":"bad config"}',{status:400})})
    expect(result.failed).toBe(1);expect(b.calls.some(([n,a])=>n==='complete_panel_planner_notification'&&a.p_state==='failed')).toBe(true)
    expect(b.calls.some(([n])=>n==='submit_panel_planner_request')).toBe(false)
  })
  it('ambiguous delivery remains claimed for bounded same-key retry',async()=>{
    const b=backend([event()]);const result=await runMaintenance({env,backend:b,fetcher:async()=>{throw Error('timeout')}})
    expect(result.uncertain).toBe(1);expect(b.calls.some(([n])=>n==='complete_panel_planner_notification')).toBe(false)
  })
  it('missing trusted owner config never sends to browser/customer substitute',async()=>{
    const b=backend([event()]);let invoked=false
    const result=await runMaintenance({env:{...env,PANEL_PLANNER_OWNER_EMAIL:''},backend:b,fetcher:async()=>{invoked=true}})
    expect(invoked).toBe(false);expect(result.failed).toBe(1)
  })
})
describe('planner HTTP action orchestration',()=>{
  let db
  beforeAll(async()=>{db=await database()},30000)
  beforeEach(async()=>{await reset(db)})
  afterAll(async()=>{await db?.close()})
  const request=b=>({httpMethod:'POST',headers:{origin:'https://poweronsolutionsllc.com'},body:JSON.stringify(b)})
  function handler(overrides={}){
    return makeHandler({backendFactory:()=>({
      rpc:(name,args)=>rpc(db,name,args).catch(e=>{throw new PlannerError(STATUS[e.message] ? e.message : 'TEMPORARILY_UNAVAILABLE')}),rateHash:()=> 'd'.repeat(64),
      signUpload:async file=>({...file,signed_upload_url:'https://storage.test/temporary'}),
      verifyObject:async file=>({...file,signature_verified:true}),
      signRead:async file=>({client_photo_id:file.client_photo_id,signed_url:'https://storage.test/private',expires_at:'short-lived'}),
      ...overrides
    })})
  }
  it('create then recover through actual HTTP dispatch and SQL',async()=>{
    const b=envelope();const h=handler();const created=await h(request(b));expect(created.statusCode).toBe(201)
    const receipt=JSON.parse(created.body)
    const recovered=await h(request({contract_version:1,action:'recover',site_key:SITE_A,idempotency_key:b.idempotency_key,recovery_token:SECRET}))
    expect(recovered.statusCode).toBe(200);expect(JSON.parse(recovered.body).request_id).toBe(receipt.request_id)
  })
  it('HTTP duplicate create does not create duplicate notification work',async()=>{
    const h=handler(),b=envelope();await h(request(b));const replay=await h(request(b))
    expect(replay.statusCode).toBe(200);expect(JSON.parse(replay.body).replayed).toBe(true)
    expect((await db.query('SELECT count(*)::int n FROM portal_planner_notification_events')).rows[0].n).toBe(1)
  })
  it('authorization Storage failure reports request saved',async()=>{
    const b=envelope(1),h=handler({signUpload:async()=>{throw Error('Storage timeout')}})
    const saved=JSON.parse((await h(request(b))).body)
    const result=await h(request({contract_version:1,action:'authorize_photos',request_id:saved.request_id,recovery_token:SECRET,
      authorization_key:randomUUID(),photo_ids:[b.photo_manifest[0].client_photo_id]}))
    expect(result.statusCode).toBe(503);expect(JSON.parse(result.body).error.request_state).toBe('saved')
    expect((await db.query('SELECT count(*)::int n FROM portal_requests')).rows[0].n).toBe(1)
  })
  it('photo deadline error reports saved and recovery remains available',async()=>{
    const h=handler(),b=envelope(1);const saved=JSON.parse((await h(request(b))).body)
    await db.exec("UPDATE test_clock SET t=t+interval '30 minutes'")
    const result=await h(request({contract_version:1,action:'authorize_photos',request_id:saved.request_id,recovery_token:SECRET,
      authorization_key:randomUUID(),photo_ids:[b.photo_manifest[0].client_photo_id]}))
    expect(result.statusCode).toBe(410);expect(JSON.parse(result.body).error).toMatchObject({code:'PHOTO_WINDOW_EXPIRED',request_state:'saved'})
  })
  it('anonymous raw service RPC execution remains denied',async()=>{
    await db.exec('SET ROLE anon')
    await expect(rpc(db,'recover_panel_planner_request',{p_idempotency_key:randomUUID(),p_recovery_token:SECRET,p_site_key:SITE_A})).rejects.toThrow('permission denied')
  })
})
