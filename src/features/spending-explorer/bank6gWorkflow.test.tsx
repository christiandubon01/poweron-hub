// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { HierarchyProvider, categoryOptions, type DefinitionEdit } from './HierarchyProvider'
import { BucketPicker } from './BucketPicker'
import { TransactionRow } from './TransactionRow'
import { ReportView } from './SpendingReports'
import { defaultHierarchy } from '@/services/bankProvider/spending/hierarchy'
import { APPROVED_REPORTING_POLICY, buildSpendingReport } from '@/services/bankProvider/spending/reporting'
import type { ExplorerRow } from '@/services/bankProvider/spending/types'
vi.mock('@/services/authedFetch',()=>({ authedJsonHeaders:async()=>({}) }))
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
let root:Root | null = null, container:HTMLDivElement
const flush = async()=> act(async()=> { await new Promise(r=>setTimeout(r,5)) })
afterEach(async()=>{ if(root) await act(async()=>root!.unmount()); root=null; container?.remove() })
const mount = async(el:React.ReactNode)=> { container=document.createElement('div');document.body.appendChild(container);root=createRoot(container);await act(async()=>root!.render(el));await flush() }
const click = async(text:string)=> { const el=[...container.querySelectorAll('button')].find(b=>b.textContent?.trim()===text);expect(el).toBeTruthy();await act(async()=>el!.click());await flush() }
const hierarchy=()=>({...defaultHierarchy(),available:true,writesEnabled:true})
describe('BANK-6G creation and reporting interactions',()=>{
  it('persists a reusable leaf without approving anything; Apply remains a separate existing decision',async()=>{
    const h=hierarchy(),save=vi.fn(async(_edit:DefinitionEdit)=> 'custom_maintenance'),apply=vi.fn(),close=vi.fn()
    await mount(<HierarchyProvider value={h} saveDefinition={save}><BucketPicker open options={categoryOptions(h)} currentKey="bank_finance_fees" onApply={apply} onClose={close}/></HierarchyProvider>)
    await click('+ Create new category')
    const input=container.querySelector<HTMLInputElement>('input[maxlength="80"]')!
    await act(async()=>{ const setter=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value')!.set!;setter.call(input,'Maintenance');input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true})) });await flush()
    // happy-dom input events differ from a browser; submit with the React-controlled input through its native tracker.
    expect(container.querySelector('form')).toBeTruthy()
    await act(async()=>container.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));await flush()
    expect(save).toHaveBeenCalledTimes(1)
    expect(save.mock.calls[0][0]).toMatchObject({type:'category',name:'Maintenance'})
    expect(apply).not.toHaveBeenCalled()
    expect(container.textContent).toContain('Maintenance')
    await click('Apply');expect(apply).toHaveBeenCalledWith('custom_maintenance')
  })
  it('offers no new writes when the schema/gate is unavailable and cancellation sends no assignment',async()=>{
    const h=defaultHierarchy(),save=vi.fn(),apply=vi.fn()
    await mount(<HierarchyProvider value={h} saveDefinition={save}><BucketPicker open options={categoryOptions(h)} currentKey="materials" onApply={apply} onClose={()=>{}}/></HierarchyProvider>)
    expect(container.textContent).not.toContain('+ Create new category')
    await act(async()=>container.querySelector<HTMLButtonElement>('[aria-label="Close without changes"]')!.click())
    expect(save).not.toHaveBeenCalled();expect(apply).not.toHaveBeenCalled()
  })
  it('disables expense-category creation in a money-in picker',async()=>{
    const h=hierarchy()
    await mount(<HierarchyProvider value={h}><BucketPicker open allowCustom={false} options={categoryOptions(h).filter(b=>b.flow==='in')} currentKey={null} onApply={()=>{}} onClose={()=>{}}/></HierarchyProvider>)
    expect(container.textContent).not.toContain('+ Create new category')
  })
  it('drills ignored activity into exact evidence and explains its subtotal is already included',async()=>{
    const row:ExplorerRow={id:'ignored',date:'2026-10-09',name:'Ignored fee',merchant:'Ignored fee',merchantKey:'ignored_fee',amountMinor:1500,direction:'money_out',pending:false,account:{ref:'a',label:'Business checking',mask:null,ownership:'business',mappedTo:'Business checking',mapped:true,environment:'production',financialAccountId:null},bucket:{key:'bank_finance_fees',label:'Bank Fees',state:'confirmed',confidence:'high',reasons:[]},relationship:{kind:'overhead',label:'General overhead',state:'confirmed',confidence:'high',reasons:[],target:null},review:'ignored',scope:{value:'business',source:'owner'},unassigned:false,repeatedPattern:false,pattern:null}
    const r=buildSpendingReport([row],'all_money',{from:'2026-10-01',to:'2026-10-09',accounts:'mapped',environment:'production'},APPROVED_REPORTING_POLICY,{complete:true,reason:null})
    await mount(<ReportView report={r} renderRow={row=><TransactionRow key={row.id} row={row} options={{buckets:categoryOptions(r.hierarchy),accounts:[],obligations:[],commitments:[],debts:[],projects:[]}} busy={false} onDecide={async()=>{}} loadHistory={async()=>[]} selectable={false} selected={false} onToggle={()=>{}}/>}/>)
    expect(container.querySelector('[data-testid="ignored-subtotal"]')?.textContent).toContain('do not add again')
    await act(async()=>container.querySelector<HTMLButtonElement>('[data-testid="report-breakdown-group"]')!.click());await flush()
    await act(async()=>container.querySelector<HTMLButtonElement>('[data-testid="report-breakdown-group"]')!.click());await flush()
    expect(container.querySelectorAll('[data-testid="report-drilldown"] li')).toHaveLength(1)
    expect(container.querySelector('[data-testid="report-drilldown"]')?.textContent).toContain('Ignored · cash movement only, no expense allocation')
    expect(container.querySelector('[data-testid="report-drilldown"]')?.textContent).not.toContain('General overhead')
  })
})
