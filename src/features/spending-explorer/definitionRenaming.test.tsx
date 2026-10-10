// @vitest-environment happy-dom
import {act} from 'react'
import {createRoot,type Root} from 'react-dom/client'
import {afterEach,describe,it,expect,vi} from 'vitest'
import {HierarchyProvider,type DefinitionEdit,useHierarchy} from './HierarchyProvider'
import {HierarchyManager} from './HierarchyManager'
import {defaultHierarchy,categoryOptions} from '@/finance/bankSpendingHierarchy'
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true
let root:Root,host:HTMLDivElement
const h=()=>({...defaultHierarchy(),available:true,writesEnabled:true})
async function click(label:string){await act(async()=>{const b=[...host.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')===label||b.textContent?.trim()===label);expect(b).toBeTruthy();b!.click()})}
async function name(value:string){await act(async()=>{const el=host.querySelector('input[maxlength="80"]')!;Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value')!.set!.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}))})}
function Choices(){const {hierarchy}=useHierarchy();return <output>{categoryOptions(hierarchy).map(c=>c.label).join('|')}</output>}
async function mount(save: (edit:DefinitionEdit)=>Promise<string>){host=document.createElement('div');document.body.append(host);root=createRoot(host);await act(async()=>root.render(<HierarchyProvider value={h()} saveDefinition={save}><HierarchyManager/><Choices/></HierarchyProvider>))}
afterEach(async()=>{if(root)await act(async()=>root.unmount());host?.remove()})
describe('existing Classification Settings rename controls',()=>{
 it('makes every parent/leaf editable, saves a built-in override with unchanged key and updates category choices',async()=>{
  const save=vi.fn(async(e:DefinitionEdit)=>e.key!);await mount(save)
  expect(host.querySelectorAll('[aria-label^="Edit / Rename parent bucket"]')).toHaveLength(h().parents.length)
  expect(host.querySelectorAll('[aria-label^="Edit / Rename category"]')).toHaveLength(h().categories.length)
  await click('Edit / Rename category Bank / Finance Fees');expect(host.textContent).toContain('built-in key and financial meaning stay unchanged')
  expect(host.querySelector('[data-testid="color-picker"]')).toBeTruthy()
  await name('Bank Charges');await act(async()=>host.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})))
  expect(save).toHaveBeenCalledWith(expect.objectContaining({key:'bank_finance_fees',name:'Bank Charges',parentKey:'overhead'}))
  expect(host.querySelector('output')!.textContent).toContain('Bank Charges');expect(host.querySelector('[role="status"]')!.textContent).toContain('Classification saved')
 })
 it('Cancel writes nothing; duplicate names are rejected before save and retain the editor',async()=>{
  const save=vi.fn(async(e:DefinitionEdit)=>e.key!);await mount(save)
  await click('Edit / Rename parent bucket Vehicle Expenses');await name('New Name');await click('Cancel');expect(save).not.toHaveBeenCalled()
  await click('Edit / Rename parent bucket Vehicle Expenses');await name(' business   overhead ')
  await act(async()=>host.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})))
  expect(host.querySelector('[role="alert"]')!.textContent).toContain('already used');expect(save).not.toHaveBeenCalled()
 })
})
