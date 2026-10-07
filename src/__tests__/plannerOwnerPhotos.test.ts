import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import { readFileSync } from 'node:fs'
const require=createRequire(import.meta.url)
const {registeredOwnerPhotos}=require('../../netlify/functions/lib/planner-owner-photos.cjs')
const id='00000000-0000-4000-8000-000000000001', photoId='00000000-0000-4000-8000-000000000002'
const path=`${id}/${photoId}.png`, obsolete=`${id}/00000000-0000-4000-8000-000000000003.png`
const details={photo_manifest:[{client_photo_id:photoId,category:'panel_label',caption:'Label caption'},{client_photo_id:'not-registered',category:'other_equipment',caption:'Hidden'}],photo_transport:{registered:{[photoId]:{object_path:path,mime_type:'image/png'}},objects:{[photoId]:obsolete},authorizations:{old:{files:[{object_path:obsolete}]}}}}
function endpoint({planner:anyPlanner=details,authorized=true,failed=false,contextFailed=false,signFailed=false,env={SUPABASE_URL:'https://db.example',SUPABASE_SERVICE_ROLE_KEY:'test-only'},origin}:any={}) {
  const exports:any={}, signed:string[]=[], fetches:string[]=[]
  const fetcher=async(url:string)=>{
    fetches.push(url)
    if(url.endsWith('/auth/v1/user'))return new Response(JSON.stringify({id:'owner'}),{status:authorized?200:403})
    if(url.includes('get_portal_attachment_context') && contextFailed)return new Response('{}',{status:503})
    if(url.includes('get_portal_attachment_context'))return new Response(JSON.stringify([{request_id:id,caller_organization_id:'org',request_organization_id:'org',notes:`FilePaths: ${obsolete}`}]))
    if(url.includes('portal_request_planner_details'))return new Response(JSON.stringify(anyPlanner ? [anyPlanner] : []),{status:failed?503:200})
    throw Error('Unexpected fetch')
  }
  runInNewContext(readFileSync('netlify/functions/portal-attachment-read.ts','utf8'),{
    exports,URL,process:{env},console,
    fetch:fetcher,require:(module:string)=>module==='@supabase/supabase-js' ? {createClient:()=>({storage:{from:()=>({createSignedUrl:async(p:string,ttl:number)=>{expect(ttl).toBe(300);signed.push(p);return signFailed ? {data:null,error:{message:'Storage unavailable'}} : {data:{signedUrl:'https://db.example/signed-photo'},error:null}}})}})} : require('../../netlify/functions/lib/planner-owner-photos.cjs'),
  })
  return {signed,fetches,handler:()=>exports.handler({httpMethod:'POST',headers:{Authorization:'Bearer owner-test-jwt',...(origin ? {origin} : {})},body:JSON.stringify({requestId:id})})}
}
describe('Authenticated Planner photo projection',()=>{
  it('selects registered manifest objects, never current/superseded allocations',()=>{
    expect(registeredOwnerPhotos(details,id,(p:string)=>p===path)).toEqual([{path,clientPhotoId:photoId,category:'panel_label',caption:'Label caption',mimeType:'image/png'}])
  })
  it('rejects cross-request paths and unsupported MIME before signing',()=>{
    expect(registeredOwnerPhotos({...details,photo_transport:{registered:{[photoId]:{object_path:'wrong/path',mime_type:'image/png'}}}},id,(p:string)=>p.startsWith(id+'/'))).toEqual([])
    expect(registeredOwnerPhotos({...details,photo_transport:{registered:{[photoId]:{object_path:path,mime_type:'text/html'}}}},id,()=>true)).toEqual([])
  })
  it('owner endpoint signs only registered photos and returns category/caption/id without paths',async()=>{
    const e=endpoint();const result=await e.handler();expect(result.statusCode).toBe(200);expect(e.signed).toEqual([path])
    const attachments=JSON.parse(result.body).attachments
    expect(attachments[0]).toMatchObject({clientPhotoId:photoId,category:'panel_label',caption:'Label caption',signedUrl:'https://db.example/signed-photo'})
    expect(result.body).not.toContain(path);expect(result.body).not.toContain(obsolete);expect(result.body).not.toContain('photo_transport')
  })
  it('authorization failure never looks up private details or signs objects',async()=>{
    const e=endpoint({authorized:false});expect((await e.handler()).statusCode).toBe(403);expect(e.signed).toEqual([]);expect(e.fetches.some(u=>u.includes('portal_request_planner_details'))).toBe(false)
  })
  it('unavailable Planner lookup fails closed rather than signing notes/allocations',async()=>{
    const e=endpoint({failed:true});expect((await e.handler()).statusCode).toBe(503);expect(e.signed).toEqual([])
  })
  it('supports the exact deploy-preview origin without weakening CORS',async()=>{
    const origin='https://deploy-preview-3--incomparable-croissant-a86c81.netlify.app'
    const e=endpoint({origin,env:{SUPABASE_URL:'https://db.example',SUPABASE_SERVICE_ROLE_KEY:'test-only',DEPLOY_PRIME_URL:origin}})
    const result=await e.handler();expect(result.statusCode).toBe(200)
    expect(result.headers['Access-Control-Allow-Origin']).toBe(origin)
    expect((await endpoint({origin:'https://untrusted.example'}).handler()).statusCode).toBe(403)
  })
  it('missing preview environment fails before auth, context or Storage access',async()=>{
    const e=endpoint({env:{}});const result=await e.handler()
    expect(result.statusCode).toBe(500);expect(JSON.parse(result.body).error).toBe('Server configuration error')
    expect(e.fetches).toEqual([]);expect(e.signed).toEqual([])
  })
  it('attachment-context failure stops before registered projection and signing',async()=>{
    const e=endpoint({contextFailed:true});expect((await e.handler()).statusCode).toBe(503)
    expect(e.fetches.some(u=>u.includes('portal_request_planner_details'))).toBe(false);expect(e.signed).toEqual([])
  })
  it('Storage signing failure yields safe metadata with null URL, never a public fallback',async()=>{
    const e=endpoint({signFailed:true});const result=await e.handler()
    expect(result.statusCode).toBe(200);expect(JSON.parse(result.body).attachments[0].signedUrl).toBeNull()
    expect(result.body).not.toContain(path);expect(result.body).not.toContain('object/public')
  })
  it('projects all three registered photos by ID with no allocation history in the response',async()=>{
    const manifest=Array.from({length:3},(_,i)=>({client_photo_id:`00000000-0000-4000-8000-00000000000${i+2}`,category:'panel_label',caption:`Photo ${i+1}`}))
    const registered=Object.fromEntries(manifest.map(p=>[p.client_photo_id,{object_path:`${id}/${p.client_photo_id}.png`,mime_type:'image/png'}]))
    const e=endpoint({planner:{photo_manifest:manifest,photo_transport:{registered,objects:{obsolete}}}})
    const result=await e.handler();expect(JSON.parse(result.body).attachments).toHaveLength(3);expect(e.signed).toHaveLength(3)
    for(const path of e.signed)expect(result.body).not.toContain(path)
  })
  it('ordinary owner attachments retain notes-based signing and generic metadata',async()=>{
    const e=endpoint({planner:null});const result=await e.handler();expect(e.signed).toEqual([obsolete]);expect(JSON.parse(result.body).attachments[0]).not.toHaveProperty('clientPhotoId')
  })
})
