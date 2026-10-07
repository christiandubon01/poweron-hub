import {afterEach, describe, expect, it, vi} from 'vitest'
import {fetchAttachmentSignedUrls} from '../portalStorageService'
const photo={displayName:'Photo',mimeType:'image/png',signedUrl:'https://storage.example/sign/photo?token=PRIVATE_SIGNED_TOKEN',expiresAt:null,clientPhotoId:'photo-one'}
const jwt='PRIVATE_OWNER_JWT'
function response(body:unknown,status=200){const mock=vi.fn(async(_url:string,_options?:RequestInit)=>new Response(JSON.stringify(body),{status}));vi.stubGlobal('fetch',mock);return mock}
afterEach(()=>vi.unstubAllGlobals())
describe('Compatible attachment signed reads',()=>{
  it('returns registered signed photo metadata and sends JWT only in the authorization header',async()=>{
    const mock=response({attachments:[photo,photo,photo]})
    expect(await fetchAttachmentSignedUrls('request',jwt)).toEqual([photo,photo,photo])
    expect(mock.mock.calls[0][0]).toBe('/.netlify/functions/portal-attachment-read')
    expect(mock.mock.calls[0][1]).toMatchObject({headers:{Authorization:`Bearer ${jwt}`},body:JSON.stringify({requestId:'request'})})
  })
  it('retains safe metadata when signing is unavailable',async()=>{
    response({attachments:[{...photo,signedUrl:null}]})
    expect(await fetchAttachmentSignedUrls('request',jwt)).toEqual([{...photo,signedUrl:null}])
  })
  it('returns an empty array for rejected reads without exposing server error text',async()=>{
    response({error:'PRIVATE_SECRET PRIVATE_PATH'},403)
    expect(await fetchAttachmentSignedUrls('request',jwt)).toEqual([])
  })
  it('returns an empty array for network failures without exposing exception text',async()=>{
    vi.stubGlobal('fetch',vi.fn(async()=>{throw Error('PRIVATE_SECRET')}))
    expect(await fetchAttachmentSignedUrls('request',jwt)).toEqual([])
  })
})
