import {afterEach, describe, expect, it, vi} from 'vitest'
import {fetchAttachmentSignedUrls, fetchAttachmentSignedUrlsDetailed, formatAttachmentDiagnostic, isNetlifyDeployPreview} from '../portalStorageService'
const photo={displayName:'Photo',mimeType:'image/png',signedUrl:'https://storage.example/sign/photo?token=PRIVATE_SIGNED_TOKEN',expiresAt:null,clientPhotoId:'photo-one'}
const jwt='PRIVATE_OWNER_JWT'
function response(body:unknown,status=200){const mock=vi.fn(async(_url:string,_options?:RequestInit)=>new Response(JSON.stringify(body),{status}));vi.stubGlobal('fetch',mock);return mock}
afterEach(()=>vi.unstubAllGlobals())
describe('Safe owner attachment diagnostics',()=>{
  it('keeps the public array API compatible on success and failure',async()=>{
    response({attachments:[photo]});expect(await fetchAttachmentSignedUrls('request',jwt)).toEqual([photo])
    response({error:'Server configuration error'},500);expect(await fetchAttachmentSignedUrls('request',jwt)).toEqual([])
    vi.stubGlobal('fetch',vi.fn(async()=>{throw Error('secret')}));expect(await fetchAttachmentSignedUrls('request')).toEqual([])
  })
  it('sends the owner JWT only in the header and reports successful counts',async()=>{
    const mock=response({attachments:[photo,photo,photo]})
    const result=await fetchAttachmentSignedUrlsDetailed('request',jwt)
    expect(result).toMatchObject({httpStatus:200,result:'ok',attachmentCount:3,signedUrlCount:3})
    expect(result.attachments[0].signedUrl).toBe(photo.signedUrl)
    expect(mock.mock.calls[0][1]).toMatchObject({headers:{Authorization:`Bearer ${jwt}`},body:JSON.stringify({requestId:'request'})})
    expect(formatAttachmentDiagnostic(result)).toBe('Preview diagnostic: HTTP 200 · 3 attachments · 3 signed URLs')
  })
  it('reports registered metadata with missing/partial signed URLs',async()=>{
    response({attachments:Array.from({length:3},()=>({...photo,signedUrl:null}))})
    const result=await fetchAttachmentSignedUrlsDetailed('request',jwt)
    expect(result).toMatchObject({httpStatus:200,result:'signed_url_missing',attachmentCount:3,signedUrlCount:0})
    expect(formatAttachmentDiagnostic(result)).toBe('Preview diagnostic: HTTP 200 · 3 attachments · 0 signed URLs')
    response({attachments:[photo,{...photo,signedUrl:null}]});expect((await fetchAttachmentSignedUrlsDetailed('request',jwt)).result).toBe('signed_url_missing')
  })
  it.each([
    [403,'Unauthorized','forbidden','Forbidden'],[401,'Unauthorized','unauthorized','Unauthorized'],
    [404,'Request unavailable','request_unavailable','Request unavailable'],
    [500,'Server configuration error','server_configuration','Server configuration'],
    [503,'Request unavailable','request_unavailable','Request unavailable'],
    [500,'PRIVATE_OWNER_JWT https://storage.example/sign/secret request/private.png','server_error','Server error'],
  ])('normalizes HTTP %s to a fixed safe label',async(status,error,result,label)=>{
    response({error},status as number)
    const read=await fetchAttachmentSignedUrlsDetailed('request',jwt)
    expect(read).toMatchObject({httpStatus:status,result,attachments:[],attachmentCount:0,signedUrlCount:0})
    expect(formatAttachmentDiagnostic(read)).toBe(`Preview diagnostic: HTTP ${status} · ${label}`)
  })
  it('does not classify arbitrary configuration-like error strings as known configuration failures',async()=>{
    response({error:'Server configuration error: PRIVATE_SECRET'},500)
    const read=await fetchAttachmentSignedUrlsDetailed('request',jwt)
    expect(read.result).toBe('server_error');expect(JSON.stringify(read)).not.toContain('PRIVATE_SECRET')
  })
  it('reports fetch exceptions without retaining their error message',async()=>{
    vi.stubGlobal('fetch',vi.fn(async()=>{throw Error(jwt+photo.signedUrl)}))
    const read=await fetchAttachmentSignedUrlsDetailed('request',jwt)
    expect(read.result).toBe('network_error');expect(read.httpStatus).toBeNull()
    expect(formatAttachmentDiagnostic(read)).toBe('Preview diagnostic: Network request failed')
    expect(JSON.stringify(read)).not.toContain(jwt)
  })
  it('distinguishes invalid JSON/attachment shapes from a network failure',async()=>{
    vi.stubGlobal('fetch',vi.fn(async()=>new Response('not-json',{status:200})))
    expect((await fetchAttachmentSignedUrlsDetailed('request',jwt)).result).toBe('invalid_response')
    response({attachments:[{signedUrl:photo.signedUrl}]});expect((await fetchAttachmentSignedUrlsDetailed('request',jwt)).result).toBe('invalid_response')
  })
  it('excludes raw path/transport/recovery extras and never formats credentials or signed URLs',async()=>{
    response({attachments:[{...photo,object_path:'PRIVATE_PATH',recovery_token_hash:'PRIVATE_HASH'}],error:jwt})
    const read=await fetchAttachmentSignedUrlsDetailed('request',jwt)
    expect(read.attachments[0]).not.toHaveProperty('object_path');expect(read.attachments[0]).not.toHaveProperty('recovery_token_hash')
    const formatted=formatAttachmentDiagnostic(read)
    for(const value of [jwt,photo.signedUrl,'PRIVATE_SIGNED_TOKEN','PRIVATE_PATH','PRIVATE_HASH','Authorization'])expect(formatted).not.toContain(value)
    expect(formatAttachmentDiagnostic({...read,result:'__proto__'} as any)).toContain('Invalid response')
  })
  it('requires owner credentials and never makes an anonymous diagnostic request',async()=>{
    const mock=response({attachments:[]});expect((await fetchAttachmentSignedUrlsDetailed('request','')).result).toBe('unauthorized');expect(mock).not.toHaveBeenCalled()
  })
  it('limits diagnostic eligibility to Netlify deploy-preview hosts',()=>{
    expect(isNetlifyDeployPreview('deploy-preview-3--incomparable-croissant-a86c81.netlify.app')).toBe(true)
    for(const host of ['app.poweronsolutionsllc.com','localhost','deploy-preview-3.example.com'])expect(isNetlifyDeployPreview(host)).toBe(false)
  })
})
