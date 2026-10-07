import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
const require=createRequire(import.meta.url)
const {buildPlannerOwnerEmail}=require('../../netlify/functions/lib/planner-owner-email.cjs')
const {runMaintenance}=require('../../netlify/functions/lib/planner-maintenance.cjs')
const event={id:'event-id',claim_token:'claim-id',request_id:'request-id',event_type:'owner_new_request',owner_email:'app@poweronsolutionsllc.com',name:'<Customer & "Name">',phone:'<phone>',email:'<email>',address:'<address>',city:'<city>',description:'<script>bad()</script>',display_name:'Power On Solutions',created_at:'2026-10-07T12:00:00Z',tracking_base_url:'https://app.poweronsolutionsllc.com',snapshot:'PRIVATE_SNAPSHOT',object_path:'PRIVATE_PATH',recovery_token_hash:'PRIVATE_SECRET'}
const env={RESEND_API_KEY:'test-only',PANEL_PLANNER_FROM_EMAIL:'Power On Solutions <app@poweronsolutionsllc.com>',PANEL_PLANNER_OWNER_EMAIL:'wrong@example.com'}
const ownerApp='https://app.poweronsolutionsllc.com/'
const tracking='https://app.poweronsolutionsllc.com/portal/track/request-id'
function backend(events: any[]) {
  let frozen:any=null
  const calls:any[]=[]
  return {calls,remove:async()=>{},rpc:async(name:string,args:any)=>{
    calls.push([name,args]);if(name==='panel_planner_orphan_paths')return [];if(name==='panel_planner_expire_technical_data')return 0
    if(name==='claim_panel_planner_notifications')return events
    if(name==='prepare_panel_planner_notification')return frozen ||= args.p_delivery_payload
    return true
  }}
}
describe('Planner owner email presentation and durable delivery',()=>{
  it('uses Portal lead-alert palette/cards/gold strip/CTA, badges, logo and footer',()=>{
    const mail=buildPlannerOwnerEmail(event)
    expect(mail.subject).toBe('New Panel Planner Lead — <Customer & "Name"> | Panel Upgrade')
    for(const value of ['#0f172a','#1e293b','#334155','#f59e0b','NEW LEAD','PANEL PLANNER','CONTACT','REQUEST','C-10 License #1151468','Automated Panel Planner lead alert','alt="Power On Solutions LLC"','role="presentation"','max-width:600px','width="100%"'])expect(mail.html).toContain(value)
    expect(mail.text).toContain('Professional review requested');expect(mail.text).toContain(ownerApp);expect(mail.html).toContain(`href="${ownerApp}"`)
    expect(mail.html).toMatch(/>Open in Power On Hub →<\/a>/)
    expect(mail.html).not.toContain('/portal/track/');expect(mail.text).not.toContain('/portal/track/')
  })
  it('escapes every contact/context cell and excludes private snapshot/transport/secrets',()=>{
    const mail=buildPlannerOwnerEmail(event)
    for(const value of ['Customer &amp; &quot;Name&quot;','&lt;phone&gt;','&lt;email&gt;','&lt;address&gt;','&lt;city&gt;','&lt;script&gt;'])expect(mail.html).toContain(value)
    expect(mail.html).not.toContain('<script>')
    for(const value of ['PRIVATE_PATH','PRIVATE_SECRET','PRIVATE_SNAPSHOT'])expect(JSON.stringify(mail)).not.toContain(value)
  })
  it('uses safe customer fallback and a fixed owner app CTA regardless of customer tracking configuration',()=>{
    const mail=buildPlannerOwnerEmail({...event,name:null,tracking_base_url:'https://customer.example'})
    expect(mail.subject).toContain('Customer | Panel Upgrade')
    expect(mail.html).toContain(`href="${ownerApp}"`);expect(mail.text).toContain(`Open in Power On Hub → ${ownerApp}`)
    expect(mail.html).not.toContain('customer.example')
  })
  it('freezes HTML/text before first send and preserves identical payload/key on retry despite config changes',async()=>{
    const b=backend([event]);const payloads:string[]=[],keys:string[]=[]
    const fetcher=async(_url:string,opt:any)=>{expect(b.calls[b.calls.length-1][0]).toBe('prepare_panel_planner_notification');payloads.push(opt.body);keys.push(opt.headers['Idempotency-Key']);return new Response('{}',{status:500})}
    await runMaintenance({env,backend:b,fetcher})
    const originalName=event.name
    event.name='Changed name'
    await runMaintenance({env:{...env,PANEL_PLANNER_FROM_EMAIL:'Changed <other@example.com>'},backend:b,fetcher})
    event.name=originalName
    expect(payloads[1]).toBe(payloads[0]);expect(keys).toEqual(['panel-planner/request-id/owner_new_request','panel-planner/request-id/owner_new_request'])
    const mail=JSON.parse(payloads[0]);expect(mail.to).toEqual(['app@poweronsolutionsllc.com']);expect(mail.from).toBe(env.PANEL_PLANNER_FROM_EMAIL);expect(mail.html).toContain(`href="${ownerApp}"`);expect(mail.text).toContain(`Open in Power On Hub → ${ownerApp}`)
    expect(mail.html).not.toContain('/portal/track/');expect(mail.text).not.toContain('/portal/track/')
  })
  it('retains customer confirmation payload exactly, without owner HTML',async()=>{
    const customer={...event,event_type:'customer_submission_confirmation',name:'Customer',email:'customer@example.com'};let sent:any
    await runMaintenance({env,backend:backend([customer]),fetcher:async(_url:string,opt:any)=>{sent=JSON.parse(opt.body);return new Response('{"id":"mock-id"}')}})
    expect(sent).toEqual({from:env.PANEL_PLANNER_FROM_EMAIL,to:['customer@example.com'],subject:'We received your request — Power On Solutions',text:['Hi Customer,','Your service request is saved.',tracking,'Optional photo delivery is tracked separately.','Power On Solutions'].join('\n')})
  })
  it('keeps the normal Portal owner alert on the authenticated app homepage',()=>{
    const normal=readFileSync('netlify/functions/notify-new-lead.ts','utf8')
    expect(normal).toContain('href="https://app.poweronsolutionsllc.com/"')
  })
  it('leaves scheduler disabled by default and terminal historical events excluded from claim SQL',()=>{
    const scheduler=readFileSync('netlify/functions/lib/planner-scheduler.cjs','utf8');expect(scheduler).toContain("env.PANEL_PLANNER_MAINTENANCE_ENABLED!=='true'")
    const sql=readFileSync('supabase/migrations/150_panel_planner_site_routing.sql','utf8');expect(sql).toContain("WHERE state='pending' OR (state='sending'")
    expect(sql).not.toContain("WHERE state='failed'")
  })
})
