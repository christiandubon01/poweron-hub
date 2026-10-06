'use strict';
const crypto = require('node:crypto');
const {PlannerError, STATUS, MAX_BYTES} = require('./planner-contract.cjs');
function runtime(env = process.env, fetcher = fetch) {
  const base = (env.SUPABASE_URL || env.VITE_SUPABASE_URL || '').replace(/\/$/,'');
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key || !base.startsWith('https://')) throw new PlannerError('TEMPORARILY_UNAVAILABLE');
  const headers = {apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'};
  async function rpc(name,args) {
    let response; try {
      response=await fetcher(base+'/rest/v1/rpc/'+name,{method:'POST',headers,body:JSON.stringify(args),signal:AbortSignal.timeout(15000)});
    } catch { throw new PlannerError('TEMPORARILY_UNAVAILABLE'); }
    const data=await response.json().catch(()=>null);
    if (!response.ok) throw new PlannerError(STATUS[data?.message] ? data.message : 'TEMPORARILY_UNAVAILABLE');
    return data;
  }
  function objectUrl(path) {
    if (!/^[0-9a-f-]{36}\/[0-9a-f-]{36}\.(jpg|png|webp)$/.test(path)) throw new PlannerError('PHOTO_OBJECT_INVALID');
    return base+'/storage/v1/object/portal-uploads/'+path;
  }
  function signedUrl(data, upload) {
    const raw = data.url || data.signedURL || data.signedUrl;
    let url;
    if (raw) url = raw.startsWith('http') ? new URL(raw) : new URL(raw.startsWith('/object/') ? '/storage/v1'+raw : raw,base);
    else if (upload && data.token) url = new URL(upload+'?token='+encodeURIComponent(data.token));
    else throw new PlannerError('TEMPORARILY_UNAVAILABLE');
    if (url.origin !== new URL(base).origin || !url.pathname.startsWith('/storage/v1/object/')) throw new PlannerError('TEMPORARILY_UNAVAILABLE');
    return url.toString();
  }
  async function signUpload(file) {
    const url=base+'/storage/v1/object/upload/sign/portal-uploads/'+file.object_path;
    const response=await fetcher(url,{method:'POST',headers,body:JSON.stringify({upsert:false}),signal:AbortSignal.timeout(15000)});
    if(!response.ok) throw new PlannerError('TEMPORARILY_UNAVAILABLE');
    const data=await response.json(); const signed=signedUrl(data,url);
    let expires = Date.now()+7200000;
    try { const token=data.token || new URL(signed).searchParams.get('token'); const claims=JSON.parse(Buffer.from(token.split('.')[1],'base64url').toString()); if(Number.isFinite(claims.exp))expires=claims.exp*1000; } catch { /* documented Storage default */ }
    return {...file,signed_upload_url:signed,signed_upload_expires_at:new Date(expires).toISOString(),method:'PUT',content_type:file.mime_type};
  }
  async function verifyObject(file) {
    const url=objectUrl(file.object_path);
    // Storage GET supports Range; its object routes do not expose HEAD.
    const response=await fetcher(url,{headers:{...headers,Range:'bytes=0-31'},signal:AbortSignal.timeout(15000)});
    const reject=async(code)=>{await response.body?.cancel().catch(()=>{});throw new PlannerError(code);};
    if(!response.ok || !response.body) return reject('PHOTO_OBJECT_INVALID');
    const range=response.headers.get('content-range');
    const match=range?.match(/^bytes 0-([0-9]+)\/([0-9]+)$/);
    if(response.status===206 && (!match || Number(match[1])>31)) return reject('PHOTO_OBJECT_INVALID');
    const length=response.headers.get('content-length');
    const size=response.status===206 ? Number(match[2]) : length===null ? NaN : Number(length);
    const mime=(response.headers.get('content-type')||'').split(';')[0].trim();
    if(!Number.isSafeInteger(size)||size<=0) return reject('PHOTO_OBJECT_INVALID');
    if(size>MAX_BYTES) return reject('PHOTO_TOO_LARGE');
    if(size!==file.size_bytes || mime!==file.mime_type) return reject('PHOTO_OBJECT_INVALID');
    // Bound even a Storage/proxy response that ignores Range.
    const reader=response.body.getReader(); const chunks=[]; let bytes=0;
    try { while(bytes<32) {const read=await reader.read();if(read.done)break;const part=read.value.slice(0,32-bytes);chunks.push(Buffer.from(part));bytes+=part.length;} }
    finally {await reader.cancel().catch(()=>{});}
    const b=Buffer.concat(chunks);
    const valid = mime==='image/jpeg' ? b.length>=3 && b[0]===255 && b[1]===216 && b[2]===255 :
      mime==='image/png' ? b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) :
      mime==='image/webp' && b.subarray(0,4).toString()==='RIFF' && b.subarray(8,12).toString()==='WEBP';
    if(!valid) throw new PlannerError('PHOTO_TYPE_INVALID');
    return {client_photo_id:file.client_photo_id,object_path:file.object_path,mime_type:mime,size_bytes:size,signature_verified:true};
  }
  async function signRead(file) {
    objectUrl(file.object_path);
    const response=await fetcher(base+'/storage/v1/object/sign/portal-uploads/'+file.object_path,
      {method:'POST',headers,body:JSON.stringify({expiresIn:300}),signal:AbortSignal.timeout(15000)});
    if(!response.ok) throw new PlannerError('TEMPORARILY_UNAVAILABLE');
    return {client_photo_id:file.client_photo_id,signed_url:signedUrl(await response.json()),
      expires_at:new Date(Date.now()+300000).toISOString()};
  }
  async function remove(paths) {
    for(const path of paths)objectUrl(path);
    if(!paths.length)return;
    const response=await fetcher(base+'/storage/v1/object/portal-uploads',{method:'DELETE',headers,
      body:JSON.stringify({prefixes:paths}),signal:AbortSignal.timeout(20000)});
    if(!response.ok)throw new PlannerError('TEMPORARILY_UNAVAILABLE');
  }
  function rateHash(ip) {return crypto.createHmac('sha256',key).update('panel-planner-rate:'+ip).digest('hex');}
  return {rpc,signUpload,verifyObject,signRead,remove,rateHash};
}
module.exports={runtime};
