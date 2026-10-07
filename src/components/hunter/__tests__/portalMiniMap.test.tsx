// @vitest-environment happy-dom
import React, {act} from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {MiniMap} from '../PortalInbox'
const mock=vi.hoisted(()=>({load:vi.fn()}))
vi.mock('@/utils/googleMapsLoader',()=>({GOOGLE_MAPS_BROWSER_KEY:'test-key',loadV15rGoogleMapsScript:mock.load}))
vi.mock('@/lib/supabase',()=>({supabase:{}}))
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true
let host:HTMLDivElement,root:Root,tiles:()=>void,geocode:(r:any,s:string)=>void
const render=async()=>{await act(async()=>root.render(<MiniMap address="Test address" city="Test city" />))}
beforeEach(()=>{
  host=document.createElement('div');document.body.appendChild(host);root=createRoot(host)
  vi.useFakeTimers();mock.load.mockReset();mock.load.mockResolvedValue(undefined)
  ;(window as any).google={maps:{Map:class {addListener(_e:string,fn:()=>void){tiles=fn;return {remove:vi.fn()}}setCenter(){}},Geocoder:class {geocode(_args:any,fn:any){geocode=fn}},Marker:class {},Size:class {},Point:class {}}}
})
afterEach(()=>{act(()=>root.unmount());host.remove();vi.useRealTimers();delete (window as any).google})
const canvas=()=>host.querySelector('[data-testid="portal-mini-map"]') as HTMLElement
describe('Portal MiniMap unavailable presentation',()=>{
  it('reserves no blank space until a located map has loaded tiles',async()=>{
    await render();expect(canvas().style.height).toBe('0px')
    await act(async()=>geocode([{geometry:{location:{}}}],'OK'));expect(canvas().style.height).toBe('0px')
    await act(async()=>tiles());expect(canvas().style.height).toBe('180px');expect(canvas().getAttribute('aria-hidden')).toBe('false')
  })
  it('collapses when geocoding fails or map tiles never render',async()=>{
    await render();await act(async()=>geocode([],'ZERO_RESULTS'));await act(async()=>tiles())
    await act(async()=>vi.advanceTimersByTime(10000));expect(canvas().style.height).toBe('0px')
  })
  it('leaves no empty rectangle when the script fails',async()=>{
    delete (window as any).google;mock.load.mockRejectedValue(new Error('script unavailable'))
    await render();expect(canvas().style.height).toBe('0px');expect(canvas().getAttribute('aria-hidden')).toBe('true')
  })
  it('collapses on map initialization errors',async()=>{
    ;(window as any).google.maps.Map=class {constructor(){throw Error('map unavailable')}}
    await render();expect(canvas().style.height).toBe('0px')
  })
})
