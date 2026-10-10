// @vitest-environment happy-dom
import {act} from 'react'
import {createRoot,type Root} from 'react-dom/client'
import {afterEach,describe,it,expect,vi} from 'vitest'
import {RelatedTransactions,relatedRequest} from './RelatedTransactions'
import {defaultHierarchy,categoryOptions} from '@/finance/bankSpendingHierarchy'
import type {RelatedResult,RelatedRow} from '@/finance/relatedTransactions'
vi.mock('@/services/authedFetch',()=>({authedJsonHeaders:async()=>({'Content-Type':'application/json'})}))
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true
const h={...defaultHierarchy(),available:true,writesEnabled:true};h.categories.push({key:'custom_debt_fees',name:'Debt-related fees',parentKey:'overhead',builtin:false,archived:false})
const row=(n:number):RelatedRow=>({id:`r${n}`,date:'2026-10-09',name:`ACME ${n}`,merchant:'Acme',amountMinor:1500,direction:'money_out',pending:false,account:{ref:'a',label:'Synthetic checking',mask:'0000',ownership:'business',mapped:true,mappedTo:'Business checking',environment:'production'},bucket:{key:'bank_finance_fees',label:'Bank / Finance Fees',state:'confirmed',confidence:'high',reasons:[]},relationship:{kind:'unknown',label:'Unknown',state:'none',confidence:null,target:null,reasons:[]},review:'confirmed',scope:{value:'business',source:'account'},unassigned:true,repeatedPattern:false,pattern:null,revision:{category:`category${n}`,relationship:[],ignored:null,amountMinor:1500,pending:false,removed:false,date:'2026-10-09',accountRef:'a',name:`ACME ${n}`,merchantName:'Acme'}})
let root:Root,host:HTMLDivElement,fetchMock:ReturnType<typeof vi.fn>,fixture:RelatedResult
const q=(s:string)=>host.querySelector<HTMLElement>(s)!
const flush=async()=>act(async()=>{await new Promise(r=>setTimeout(r,10))})
const click=async(el:HTMLElement)=>{await act(async()=>el.click());await flush()}
const textButton=(s:string)=>Array.from(host.querySelectorAll('button')).find(b=>b.textContent?.trim()===s)!
const posts=()=>fetchMock.mock.calls.filter(([,init])=>init?.method==='POST').map(([,init])=>JSON.parse(init.body))
async function mount(n=2,available=true,complete=true){
 fixture={rows:Array.from({length:n},(_,i)=>row(i)),total:complete?n:null,complete,reason:complete?null:'Synthetic cap',identity:'ACME',grouping:'merchant',historical:false,from:'2026-09-10',to:'2026-10-09',accounts:'mapped',hierarchy:h,batchAvailable:available}
 fetchMock=vi.fn(async(_url:string,init?:RequestInit)=>{
  const body=init?.body?JSON.parse(String(init.body)):null
  const out=!body?fixture:body.action==='preview_categories'?{batchAvailable:fixture.batchAvailable,preview:body.selection.map((s:any)=>({id:s.id,row:fixture.rows.find(r=>r.id===s.id),proposed:body.category,eligible:true,reason:null}))}:{results:body.selection.map((s:any,i:number)=>({id:s.id,outcome:i===0?'changed':'conflict',reason:i===0?undefined:'Refresh and preview'}))}
  return {ok:true,json:async()=>out}
 });vi.stubGlobal('fetch',fetchMock);host=document.createElement('div');document.body.append(host);root=createRoot(host)
 await act(async()=>root.render(<RelatedTransactions seed={row(0)} scope={{from:'2026-09-10',to:'2026-10-09',accounts:'mapped',population:'business'}} options={{buckets:categoryOptions(h),accounts:[],projects:[],obligations:[],commitments:[],debts:[]}} onClose={()=>{}} onDecide={vi.fn()} loadHistory={async()=>[]} onChanged={()=>{}}/>));await flush();await flush()
}
afterEach(async()=>{if(root)await act(async()=>root.unmount());host?.remove();vi.unstubAllGlobals()})
async function choose(){await click(textButton('Choose category'));await click(q('[data-option="custom_debt_fees"]'));await click(textButton('Apply'))}
describe('BANK-6H selection, preview, write-gate and classification clarity',()=>{
 it('does not serialize absent parent/leaf selections as literal undefined filters',async()=>{
  await mount();await relatedRequest({related:'r0',parent:undefined as unknown as string,leaf:undefined as unknown as string,direction:'out'})
  const url=fetchMock.mock.calls[fetchMock.mock.calls.length-1][0]
  expect(url).not.toContain('undefined');expect(url).not.toContain('parent=');expect(url).toContain('direction=out')
 })
 it('selects only visible records, caps 100 honestly, preserves selection through pagination and clears without writes',async()=>{
  await mount(120);await click(q('[data-testid="related-select-all"]'));expect(q('[data-testid="related-selection-summary"]').textContent).toContain('50 selected')
  await click(textButton('Show next 50 matching records'));expect(q('[data-testid="related-selection-summary"]').textContent).toContain('50 selected')
  await click(q('[data-testid="related-select-all"]'));expect(q('[data-testid="related-selection-summary"]').textContent).toContain('100 selected')
  await click(textButton('Show next 50 matching records'));expect((q('[data-testid="related-select-all"]') as HTMLButtonElement).disabled).toBe(true)
  await click(textButton('Clear selection'));expect(q('[data-testid="related-selection-summary"]').textContent).toContain('0 selected');expect(posts()).toEqual([])
 })
 it('selects individual records and displays the exact before/proposed preview; only explicit confirmation sends changes',async()=>{
  await mount();await click(q('[data-testid="spending-select"]'));await choose()
  expect(posts()).toEqual([]);await click(textButton('Preview exact changes'))
  expect(posts()).toHaveLength(1);expect(posts()[0].action).toBe('preview_categories')
  expect(q('[data-testid="related-preview"]').textContent).toContain('Bank / Finance Fees (confirmed) → Proposed: Debt-related fees')
  expect(q('[data-testid="related-preview"]').textContent).toContain('Financial link: Unknown · none · unchanged')
  await click(textButton('Confirm category changes'));expect(posts()[1]).toMatchObject({action:'confirm_categories',confirmed:true,selection:[{id:'r0',expected:row(0).revision}]})
  expect(posts()[1]).not.toHaveProperty('rememberTransactionIds');expect(q('[data-testid="related-results"]').textContent).toContain('1 saved or already matching')
 })
 it('keeps batch save disabled until checked replacement is installed, while related browsing and preview work',async()=>{
  await mount(2,false);await click(q('[data-testid="related-select-all"]'));await choose();await click(textButton('Preview exact changes'))
  expect((textButton('Confirm category changes') as HTMLButtonElement).disabled).toBe(true)
  expect(q('[data-testid="related-write-gate"]').textContent).toContain('concurrent-edit protection')
  await click(textButton('Confirm category changes'));expect(posts().filter(p=>p.action==='confirm_categories')).toEqual([])
 })
 it('discloses broader history explicitly and clears current selection/proposal on grouping or scope changes',async()=>{
  await mount();await click(q('[data-testid="related-select-all"]'));await choose();await click(textButton('All matching history in these accounts'))
  expect(host.textContent).toContain('Broader scope: all dates and both directions')
  expect(q('[data-testid="related-selection-summary"]').textContent).toContain('0 selected')
  expect(fetchMock.mock.calls[fetchMock.mock.calls.length-1]?.[0]).toContain('historical=1');expect(posts()).toEqual([])
 })
 it('does not present complete matching totals or actionable batches for incomplete evidence',async()=>{
  await mount(2,true,false);expect(host.textContent).toContain('Synthetic cap');expect(host.querySelector('[data-testid="related-selection-summary"]')).toBeNull();expect(textButton('Choose category')).toBeUndefined()
 })
 it('keeps account ownership, parent/leaf and unresolved financial relationships separate after a confirmed category',async()=>{
  await mount();const card=q('[data-testid="spending-row"]')
  expect(card.textContent).toContain('Business account');expect(card.textContent).toContain('Parent: Business Overhead');expect(card.textContent).toContain('Category');expect(card.textContent).toContain('Financial link unresolved')
  expect(Array.from(card.querySelectorAll('[data-testid="spending-chip"]')).map(c=>c.textContent)).not.toContain('Business')
 })
 it('reports each partial outcome and clears selection; retries require a new explicit preview',async()=>{
  await mount();await click(q('[data-testid="related-select-all"]'));await choose();await click(textButton('Preview exact changes'));await click(textButton('Confirm category changes'))
  expect(q('[data-testid="related-results"]').textContent).toContain('1 not saved');expect(q('[data-testid="related-results"]').textContent).toContain('r1 · conflict');expect(q('[data-testid="related-selection-summary"]').textContent).toContain('0 selected')
 })
})
