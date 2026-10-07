import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import { readFileSync } from 'node:fs'
const require=createRequire(import.meta.url)
const {registeredOwnerPhotos}=require('../../netlify/functions/lib/planner-owner-photos.cjs')
const id='00000000-0000-4000-8000-000000000001', photoId='00000000-0000-4000-8000-000000000002'
const path=`${id}/${photoId}.png`, obsolete=`${id}/00000000-0000-4000-8000-000000000003.png`
const details={photo_manifest:[{client_photo_id:photoId,category:'panel_label',caption:'Label caption'},{client_photo_id:'not-registered',category:'other_equipment',caption:'Hidden'}],photo_transport:{registered:{[photoId]:{object_path:path,mime_type:'image/png'}},objects:{[photoId]:obsolete},authorizations:{old:{files:[{object_path:obsolete}]}}}}
function endpoint({planner:anyPlanner=details,authorized=true,failed=false}:any={}) {
  const exports:any={}, signed:string[]=[], fetches:string[]=[]
  const fetcher=async(url:string)=>{
    fetches.push(url)
    if(url.endsWith('/auth/v1/user'))return new Response(JSON.stringify({id:'owner'}),{status:authorized?200:403})
    if(url.includes('get_portal_attachment_context'))return new Response(JSON.stringify([{request_id:id,caller_organization_id:'org',request_organization_id:'org',notes:`FilePaths: ${obsolete}`}]))
    if(url.includes('portal_request_planner_details'))return new Response(JSON.stringify(anyPlanner ? [anyPlanner] : []),{status:failed?503:200})
    throw Error('Unexpected fetch')
  }
  runInNewContext(readFileSync('netlify/functions/portal-attachment-read.ts','utf8'),{
    exports,URL,process:{env:{SUPABASE_URL:'https://db.example',SUPABASE_SERVICE_ROLE_KEY:'test-only'}},console,
    fetch:fetcher,require:(module:string)=>module==='@supabase/supabase-js' ? {createClient:()=>({storage:{from:()=>({createSignedUrl:async(p:string,ttl:number)=>{expect(ttl).toBe(300);signed.push(p);return {data:{signedUrl:'https://db.example/signed-photo'},error:null}}})}})} : require('../../netlify/functions/lib/planner-owner-photos.cjs'),
  })
  return {signed,fetches,handler:()=>exports.handler({httpMethod:'POST',headers:{Authorization:'Bearer owner-test-jwt'},body:JSON.stringify({requestId:id})})}
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
  it('ordinary owner attachments retain notes-based signing and generic metadata',async()=>{
    const e=endpoint({planner:null});const result=await e.handler();expect(e.signed).toEqual([obsolete]);expect(JSON.parse(result.body).attachments[0]).not.toHaveProperty('clientPhotoId')
  })
})
