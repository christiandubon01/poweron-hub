// @ts-nocheck
import {describe,it,expect,vi} from 'vitest'
import {createRequire} from 'node:module'
const require=createRequire(import.meta.url)
const {makeScheduledHandler}=require('../../netlify/functions/lib/planner-scheduler.cjs')
const logger=()=>({info:vi.fn(),error:vi.fn()})
describe('Planner maintenance scheduler safety boundary',()=>{
  it.each([undefined,'false','FALSE','TRUE','true ','1','yes','',false])('disabled switch %j does not initialize clients or perform work',async value=>{
    const run=vi.fn(()=>{throw Error('must not run')}),backendFactory=vi.fn(()=>{throw Error('must not initialize')}),fetcher=vi.fn(),log=logger()
    const handler=makeScheduledHandler({env:{PANEL_PLANNER_MAINTENANCE_ENABLED:value},run,backendFactory,fetcher,log})
    const response=await handler({body:JSON.stringify({enabled:true}),headers:{authorization:'untrusted'}})
    expect(response.statusCode).toBe(200);expect(JSON.parse(response.body)).toEqual({status:'disabled',maintenance_enabled:false})
    expect(run).not.toHaveBeenCalled();expect(backendFactory).not.toHaveBeenCalled();expect(fetcher).not.toHaveBeenCalled();expect(log.error).not.toHaveBeenCalled()
  })
  it('enabled empty maintenance executes the real logic without email delivery',async()=>{
    const calls=[],fetcher=vi.fn(()=>{throw Error('no email allowed')}),log=logger()
    const backend={rpc:async name=>{calls.push(name);if(name==='panel_planner_orphan_paths')return [];if(name==='panel_planner_expire_technical_data')return 0;if(name==='claim_panel_planner_notifications')return [];throw Error('unexpected RPC')},remove:async paths=>{calls.push('remove');expect(paths).toEqual([])}}
    const handler=makeScheduledHandler({env:{PANEL_PLANNER_MAINTENANCE_ENABLED:'true'},backendFactory:()=>backend,fetcher,log})
    const result=await handler();expect(result.statusCode).toBe(200)
    expect(JSON.parse(result.body)).toMatchObject({status:'completed',sent:0,failed:0,uncertain:0,orphans_removed:0,technical_records_expired:0})
    expect(calls).toEqual(['panel_planner_orphan_paths','remove','panel_planner_expire_technical_data','claim_panel_planner_notifications']);expect(fetcher).not.toHaveBeenCalled()
  })
  it('failure logs identify stage without exposing provider or SQL secrets',async()=>{
    const log=logger(),secret='private-address@example.test password=secret-token'
    const handler=makeScheduledHandler({env:{PANEL_PLANNER_MAINTENANCE_ENABLED:'true'},backendFactory:()=>({rpc:async()=>{throw Error(secret)}}),log})
    const r=await handler();expect(r.statusCode).toBe(500);expect(JSON.parse(r.body)).toEqual({status:'failed',code:'MAINTENANCE_RUN_FAILED',stage:'orphan_discovery'})
    expect(JSON.stringify([...log.info.mock.calls,...log.error.mock.calls])).not.toContain(secret);expect(log.error).toHaveBeenCalledOnce()
  })
  it('execution budget aborts backend fetches before the scheduled timeout',async()=>{
    const log=logger();let observed
    const fetcher=vi.fn(async(_url,options)=>{observed=options.signal;return new Promise((_resolve,reject)=>options.signal.addEventListener('abort',()=>reject(Error('secret provider details')),{once:true}))})
    const handler=makeScheduledHandler({env:{PANEL_PLANNER_MAINTENANCE_ENABLED:'true'},budgetMs:10,fetcher,backendFactory:(_env,limitedFetch)=>({rpc:()=>limitedFetch('https://backend.test')}) ,log})
    const r=await handler();expect(r.statusCode).toBe(500);expect(observed.aborted).toBe(true);expect(JSON.parse(r.body).code).toBe('MAINTENANCE_BUDGET_EXHAUSTED');expect(JSON.stringify(log.error.mock.calls)).not.toContain('secret provider details')
  })
})
