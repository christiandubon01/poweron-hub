// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import SpendingExplorer from './SpendingExplorer'
import { DisplayColorsProvider } from '@/features/display-colors/DisplayColors'
import { parentColorKey, parentDisplayColor } from '@/features/display-colors/hierarchyColors'
import { CATEGORY_KEY } from '@/features/display-colors/palette'
import { categoryOptions, defaultHierarchy } from '@/finance/bankSpendingHierarchy'
import { buildSpendingReport, APPROVED_REPORTING_POLICY } from '@/services/bankProvider/spending/reporting'
import type { Options } from './useSpendingExplorer'
import type { ExplorerRow } from '@/services/bankProvider/spending/types'
import { DEFAULT_FILTERS } from './useSpendingExplorer'
import { projectReport, matchesExplorerFilters } from './reportProjection'
import type { ReportMode, ReportScope, SpendingReport } from '@/finance/bankSpendingReports'
vi.mock('@/services/authedFetch',()=>({authedJsonHeaders:async()=>({})}))
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true
const h={...defaultHierarchy(),available:true,writesEnabled:false}
const account={ref:'a',label:'Synthetic business checking',mask:'0000',ownership:'business' as const,mapped:true,mappedTo:'Business Checking',environment:'production' as const,financialAccountId:null}
const row=(id:string,amountMinor:number,key='materials',changes:Partial<ExplorerRow>&{removed?:boolean}={}):ExplorerRow & {removed?:boolean}=>({id,date:'2026-10-09',name:id,merchant:id,merchantKey:id,amountMinor,direction:amountMinor>0?'money_out':'money_in',pending:false,account,bucket:{key,label:key,state:'confirmed',confidence:'high',reasons:[]},relationship:{kind:'unknown',label:'Unknown',state:'none',target:null,confidence:null,reasons:[]},review:'confirmed',scope:{value:'business',source:'account'},unassigned:true,repeatedPattern:false,pattern:null,...changes})
const rows=[row('Bank fee',1500,'bank_finance_fees',{unassigned:false,relationship:{kind:'overhead',label:'General overhead',state:'confirmed',confidence:'high',target:null,reasons:[]}}),row('Adobe',4000,'software_subscriptions'),row('Fuel',6200,'fuel_vehicle'),row('Personal',8500,'personal_owner',{scope:{value:'personal',source:'owner'},unassigned:false}),row('Debt',50000,'other_needs_review',{unassigned:false,relationship:{kind:'debt',label:'Debt payment',state:'confirmed',confidence:'high',target:{type:'debt_account',id:'d',label:'Debt'},reasons:[]}}),row('Transfer',30000,'transfers',{unassigned:false,relationship:{kind:'transfer',label:'Transfer',state:'confirmed',confidence:'high',target:{type:'counterpart_tx',id:'other',label:null},reasons:[]}}),row('Refund',-4200,'refund',{unassigned:false}),row('Ignored',800,'bank_finance_fees',{review:'ignored',unassigned:false}),row('Pending',1000,'materials',{pending:true,unassigned:false}),row('Removed',900,'materials',{removed:true,unassigned:false})]
const scope:ReportScope={from:'2026-07-12',to:'2026-10-09',accounts:'mapped',environment:'production'}
const report=(mode:ReportMode,s=scope)=>buildSpendingReport(rows,mode,s,APPROVED_REPORTING_POLICY,{complete:true,reason:null},h)
const options:Options={buckets:categoryOptions(h),batchBuckets:[],accounts:[{ref:'a',label:'Synthetic checking',mask:'0000'}],projects:[],obligations:[],commitments:[],debts:[{id:'d',label:'Debt'}]}
const payload={asOf:'2026-10-09',environment:'production',accounts:'mapped',hierarchy:h,coverage:{complete:true,reason:null},draftScope:'unified-test',total:rows.length,rows:rows.filter(r=>!r.removed),options,meta:{hiddenUnmapped:0,olderThanPeriod:0},viewCounts:{all:rows.length,reviewed:8,review_queue:0,known_bills:1,unassigned:2,repeated_spending:0,needs_review:0},analytics:{asOf:'2026-10-09',windowDays:30,unassigned:{totalMinor:10200,count:2,previousMinor:0,deltaMinor:0,byBucket:[{key:'fuel_vehicle',label:'Fuel / Vehicle',totalMinor:6200,count:1},{key:'software_subscriptions',label:'Software',totalMinor:4000,count:1}]},knownBills:{totalMinor:0,count:0},pending:{totalMinor:1000,count:1},unclassified:{totalMinor:0,count:0},observations:[],suggestions:[]}}
let host:HTMLDivElement,root:Root,fetchMock:ReturnType<typeof vi.fn>,incomplete=false
const saveColor=vi.fn(async()=>({storage:'shared' as const}))
const flush=async()=>act(async()=>{await new Promise(r=>setTimeout(r,15))})
const click=async(el:HTMLElement)=>{await act(async()=>el.click());await flush()}
const q=(s:string)=>host.querySelector<HTMLElement>(s)!
async function mount(){
  incomplete=false;saveColor.mockClear()
  fetchMock=vi.fn(async(url:string,init?:RequestInit)=>{const params=new URL(String(url),'https://fixture.invalid').searchParams;let result:any=payload
    if(params.has('history'))result={history:[]}
    else if(params.has('report')){result=report(params.get('report') as ReportMode,{...scope,from:params.get('from')!,to:params.get('to')!,accounts:params.get('accounts') as 'mapped'|'all',account:params.get('account')??undefined});if(incomplete)result={...result,coverage:{complete:false,reason:'Synthetic source cap'},summary:null,groups:[],rows:[]}}
    return {ok:true,json:async()=>init?.method==='POST'?{}:result}
  });vi.stubGlobal('fetch',fetchMock)
  host=document.createElement('div');document.body.append(host);root=createRoot(host)
  await act(async()=>root.render(<DisplayColorsProvider store={{load:async()=>({storage:'shared',colors:{categories:{bank_finance_fees:'#7f68d6',fuel_vehicle:'#2f8fcf',parent_overhead:'#a8841f'},accounts:{}}}),set:saveColor}}><SpendingExplorer/></DisplayColorsProvider>));await flush();await flush()
}
afterEach(async()=>{if(root)await act(async()=>root.unmount());host?.remove();vi.unstubAllGlobals()})
describe('BANK-6G one unified Spending Explorer',()=>{
  it('replaces the review Snapshot/list in every population; no Reports mode or duplicate transaction list',async()=>{
    await mount();expect(host.textContent).not.toContain('Reports')
    for(const mode of ['business','all_money','unassigned']){
      await click(q(`[data-testid="spending-scope-${mode}"]`))
      expect(host.querySelectorAll('[data-testid="spending-snapshot"]')).toHaveLength(1)
      expect(host.querySelectorAll('[data-testid="spending-composition"]')).toHaveLength(1)
      expect(host.querySelectorAll('[data-testid="spending-list"]')).toHaveLength(1)
      expect(host.querySelector('[data-testid="spending-scope-caption"]')).toBeNull()
    }
    expect(fetchMock.mock.calls.filter(([,i])=>i?.method==='POST')).toEqual([])
  })
  it('drills parent -> leaf -> existing transaction detail, preserving colors and the custom-write gate',async()=>{
    await mount();await click(q('[data-testid="spending-scope-business"]'))
    const parent=q('[data-testid="report-breakdown-group"][data-bucket="overhead"]')
    expect(parent.querySelector('[data-testid="category-dot"]')?.getAttribute('data-color')).toBe('#a8841f')
    await click(parent)
    const leaf=q('[data-testid="report-breakdown-group"][data-bucket="bank_finance_fees"]')
    expect(leaf.querySelector('[data-testid="category-dot"]')?.getAttribute('data-color')).toBe('#7f68d6')
    await click(leaf);expect(host.querySelectorAll('[data-testid="spending-row"]')).toHaveLength(1)
    expect(q('[data-testid="report-drilldown"]').textContent).toContain('Posted out $15.00')
    await click(q('[data-testid="spending-row"] button'))
    expect(q('[data-testid="detail-evidence"]')).toBeTruthy()
    await click(q('[data-testid="detail-change-category"]'))
    expect(host.textContent).not.toContain('+ Create new category')
    expect(fetchMock.mock.calls.filter(([,i])=>i?.method==='POST')).toEqual([])
  })
  it('uses one Colors/Classification Settings workflow and persists parent colors through the existing store',async()=>{
    await mount();await click(q('[data-testid="spending-scope-business"]'));await click(q('[data-testid="spending-colors-toggle"]'))
    expect(host.querySelectorAll('[data-testid="colors-panel"]')).toHaveLength(1)
    expect(host.querySelectorAll('[data-testid="hierarchy-manager"]')).toHaveLength(1)
    expect(host.textContent).toContain('Management is read-only')
    expect((Array.from(host.querySelectorAll('button')).find(b=>b.textContent==='+ Create category') as HTMLButtonElement).disabled).toBe(true)
    const section=q('[aria-label="Parent bucket colors"]')
    await click(Array.from(section.querySelectorAll('button')).find(b=>b.textContent?.includes('Business Overhead'))!)
    const swatch=Array.from(section.querySelectorAll('button')).find(b=>b.getAttribute('aria-label')?.includes('Violet'))!
    await click(swatch)
    expect(saveColor).toHaveBeenCalledWith('category','parent_overhead','#7f68d6')
    expect(q('[data-testid="report-breakdown-group"][data-bucket="overhead"] [data-testid="category-dot"]').getAttribute('data-color')).toBe('#7f68d6')
  })
  it('keeps all-money lanes and ignored activity distinct, with pending/removed excluded from posted totals',async()=>{
    await mount();await click(q('[data-testid="spending-scope-all_money"]'))
    const full=report('all_money')
    expect(q('[data-testid="spending-total"]').textContent).toContain(`$${(full.summary!.outMinor/100).toLocaleString('en-US',{minimumFractionDigits:2})}`)
    expect(host.textContent).toContain('Personal & owner outflows');expect(host.textContent).toContain('Debt repayments');expect(host.textContent).toContain('Transfers')
    expect(q('[data-testid="ignored-subtotal"]').textContent).toContain('do not add again')
    await click(q('[data-testid="report-breakdown-group"][data-bucket="ignored"]'))
    await click(q('[data-testid="report-breakdown-group"][data-bucket="__ignored"]'))
    expect(host.querySelectorAll('[data-testid="spending-row"]')).toHaveLength(1)
    expect(q('[data-testid="report-drilldown"]').textContent).toContain('Posted out $8.00')
  })
  it('direction controls reconcile charts and transaction lists; back/clear preserve scope and colors',async()=>{
    await mount();await click(q('[data-testid="spending-scope-all_money"]'))
    const incoming=report('all_money').rows.filter(r=>r.amountMinor<0)
    await click(q('[data-testid="report-direction-in"]'))
    expect(q('[data-testid="spending-total"]').textContent).toContain('$42.00')
    expect(host.querySelectorAll('[data-testid="spending-row"]')).toHaveLength(incoming.length)
    expect(q('[data-testid="report-drilldown"]').textContent).toContain('Posted out $0.00 · In $42.00')
    expect(host.querySelector('[data-testid="report-breakdown-group"][data-bucket="debt"]')).toBeNull()
    await click(q('[data-testid="report-breakdown-group"][data-bucket="refund"]'))
    await click(q('[data-testid="report-breakdown-group"][data-bucket="refund"]'))
    await click(q('[data-testid="report-back"]'))
    expect(q('[aria-label="Bucket breadcrumb"]').textContent).toContain('Refunds')
    await click(q('[data-testid="report-clear-selection"]'))
    expect(q('[data-testid="report-direction-in"]').getAttribute('aria-pressed')).toBe('true')
    expect(q('[data-testid="report-date-account-scope"]').textContent).toContain('2026-07-12 — 2026-10-09')
    await click(q('[data-testid="report-direction-out"]'))
    expect(host.querySelectorAll('[data-testid="spending-row"]')).toHaveLength(report('all_money').rows.filter(r=>r.amountMinor>=0).length)
    expect(q('[data-testid="report-breakdown-group"][data-bucket="business"] [data-testid="category-dot"]').getAttribute('data-color')).toBeTruthy()
  })
  it('separates workflow and spending scope, and explains snapshot/report windows without changing them',async()=>{
    await mount()
    expect(q('[aria-label="Review mode"]').textContent).toContain('Explore')
    expect(q('[aria-label="Explorer scope"]').textContent).not.toContain('Transaction review')
    expect(host.textContent).toContain('Category review is an owner decision')
    expect(host.textContent).toContain('selected 90-day period')
    expect(q('[data-testid="spending-scope-caption"]').textContent).toContain('last 30 days')
    expect(q('[data-testid="review-date-account-scope"]').textContent).toContain('2026-07-12 — 2026-10-09')
  })
  it('withholds totals and lists when evidence coverage is incomplete',async()=>{
    await mount();incomplete=true;await click(q('[data-testid="spending-scope-business"]'))
    expect(host.textContent).toContain('Synthetic source cap')
    expect(host.querySelector('[data-testid="spending-total"]')).toBeNull()
    expect(host.querySelector('[data-testid="spending-list"]')).toBeNull()
  })
  it('scope requests use the same Explorer date/account controls without accepting a client environment',async()=>{
    await mount();await click(q('[data-testid="spending-scope-business"]'));await click(q('[data-testid="spending-period-30"]'))
    const requests=fetchMock.mock.calls.map(([url])=>new URL(String(url),'https://fixture.invalid').searchParams).filter(q=>q.has('report'))
    expect(requests[requests.length-1]?.get('from')).toBe('2026-09-10');expect(requests[requests.length-1]?.get('to')).toBe('2026-10-09');expect(requests[requests.length-1]?.get('environment')).toBeNull()
  })
  it.each(['all_money','business','unassigned'] as ReportMode[])('%s filtering reconciles displayed summary, parent/leaf and drill-down without mutation',mode=>{
    const original=report(mode),before=JSON.stringify(original)
    const projected=projectReport(original,r=>matchesExplorerFilters(r,{...DEFAULT_FILTERS,search:'Adobe'}))
    expect(projected.summary!.outMinor).toBe(projected.groups.reduce((n,g)=>n+g.outMinor,0))
    expect(projected.summary!.count).toBe(projected.rows.length)
    for(const g of projected.groups)expect(g.outMinor).toBe(g.children.reduce((n,c)=>n+c.outMinor,0))
    expect(JSON.stringify(original)).toBe(before)
  })
  it('parent display keys fit the existing color contract, never collide with a leaf, and inherit saved colors',()=>{
    const custom='custom_abcdefghijklmnopqrstuvwxyzabcdef'
    expect(CATEGORY_KEY.test(parentColorKey(custom))).toBe(true)
    expect(parentColorKey('materials')).not.toBe('materials')
    expect(parentDisplayColor('vehicle',h,k=>k==='fuel_vehicle'?'#2f8fcf':null)).toBe('#2f8fcf')
  })
})
