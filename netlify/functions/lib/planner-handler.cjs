// @ts-nocheck
// Public planner adapter. Service credentials remain exclusively server-side.
const {validateEnvelope,allowedOrigins,PlannerError,STATUS}=require('./planner-contract.cjs');
const {runtime}=require('./planner-runtime.cjs');
function makeHandler({env=process.env,backendFactory=()=>runtime(env)}={}) {
  return async (event) => {
    const origin=event.headers?.origin || event.headers?.Origin;
    const headers={'Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin',
      'Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type'};
    const respond=(status,body)=>({statusCode:status,headers,body:JSON.stringify(body)});
    const denied=()=>respond(403,{contract_version:1,error:{code:'ORIGIN_DENIED',retryable:false}});
    if(!origin || typeof origin!=='string') return denied();
    if(!allowedOrigins(env).has(origin)) {
      // Exact-match against enabled site integrations' origins; any lookup failure fails closed.
      let known=false;
      try { const list=await backendFactory().rpc('portal_site_allowed_origins',{}); known=Array.isArray(list)&&list.includes(origin); } catch { known=false; }
      if(!known) return denied();
    }
    headers['Access-Control-Allow-Origin']=origin;
    if(event.httpMethod==='OPTIONS')return {statusCode:204,headers,body:''};
    if(event.httpMethod!=='POST')return respond(405,{contract_version:1,error:{code:'INVALID_PAYLOAD',retryable:false}});
    let body, savedRequestId;
    try {
      const raw=event.isBase64Encoded ? Buffer.from(event.body||'','base64').toString('utf8') : event.body||'';
      if(Buffer.byteLength(raw)>262144)throw new PlannerError('SNAPSHOT_TOO_LARGE');
      try{body=JSON.parse(raw);}catch{throw new PlannerError('INVALID_PAYLOAD');}
      validateEnvelope(body);
      const backend=backendFactory();
      // Netlify sets this reserved connection header. Never persist the raw IP.
      const rate=await backend.rpc('panel_planner_rate_limit',{p_bucket_hash:backend.rateHash(event.headers?.['x-nf-client-connection-ip']||'unknown')});
      if(!rate)throw new PlannerError('RATE_LIMITED');
      const b=body;let result;
      switch(b.action) {
        case 'create':
          result=await backend.rpc('submit_panel_planner_request',{
            p_payload:b.planner_payload,p_idempotency_key:b.idempotency_key,p_recovery_token:b.recovery_token,
            p_customer_note:b.customer_note,p_consent_version:b.consent_version,p_photo_manifest:b.photo_manifest,
            p_site_key:b.site_key,p_origin:origin});
          break;
        case 'recover':
          result=await backend.rpc('recover_panel_planner_request',{p_idempotency_key:b.idempotency_key,p_recovery_token:b.recovery_token,
            p_site_key:b.site_key,p_origin:origin});
          break;
        case 'authorize_photos': {
          const batch=await backend.rpc('authorize_panel_planner_photos',{p_request_id:b.request_id,
            p_recovery_token:b.recovery_token,p_authorization_key:b.authorization_key,p_photo_ids:b.photo_ids});
          savedRequestId=b.request_id;
          const uploads=[];for(const file of batch.files)uploads.push(await backend.signUpload(file));
          result={contract_version:1,request_id:batch.request_id,authorization_id:batch.authorization_id,
            replayed:batch.replayed,registration_deadline:batch.registration_deadline,uploads};
          break;
        }
        case 'finalize_photos': {
          const args={p_request_id:b.request_id,p_recovery_token:b.recovery_token,p_finalization_key:b.finalization_key,
            p_authorization_id:b.authorization_id,p_photo_ids:b.photo_ids,p_close_photos:b.close_photos};
          const prepared=await backend.rpc('prepare_panel_planner_finalization',args);
          if(prepared.replayed){result={...prepared.receipt,replayed:true};break;}
          savedRequestId=b.request_id;
          const verified=[];for(const file of prepared.files)verified.push(await backend.verifyObject(file));
          result=await backend.rpc('finalize_panel_planner_photos',{...args,p_verified_objects:verified});
          break;
        }
        case 'read_photos': {
          const files=await backend.rpc('get_panel_planner_customer_photos',{p_request_id:b.request_id,p_recovery_token:b.recovery_token});
          const photos=[];for(const file of files)photos.push(await backend.signRead(file));
          result={contract_version:1,request_id:b.request_id,photos};break;
        }
      }
      return respond(b.action==='create'&&!result.replayed ? 201 : 200,result);
    } catch(err) {
      const code=STATUS[err?.code] ? err.code : 'TEMPORARILY_UNAVAILABLE';
      // Never forward SQL, PostgREST, provider, stack, contact, or capability data.
      if (['PHOTO_WINDOW_EXPIRED','PHOTO_REQUEST_CLOSED'].includes(code)) savedRequestId=body?.request_id;
      return respond(STATUS[code],{contract_version:1,error:{code,retryable:['TEMPORARILY_UNAVAILABLE','RATE_LIMITED'].includes(code),
        ...(savedRequestId ? {request_state:'saved',request_id:savedRequestId} : {})}});
    }
  };
}
module.exports={makeHandler};
