/** Local synthetic acceptance only. Render actual Explorer; delegate existing BANK-6G fixtures. */
import '../bank6g/preview'
const base=window.fetch
let matching:any[]=[],h:any
async function init(){
 const response=await base('/.netlify/functions/plaid-spending?report=all_money&from=2026-07-12&to=2026-10-09&accounts=mapped')
 const report=await response.json(),seed=report.rows[0]
 h={...report.hierarchy,writesEnabled:true,categories:[...report.hierarchy.categories,{key:'custom_debt_fees',name:'Debt-related fees',parentKey:'overhead',builtin:false,archived:false}]}
 matching=[seed,{...seed,id:'synthetic_related_two',date:'2026-10-08',amountMinor:3500},{...seed,id:'synthetic_old_related',date:'2024-01-01',amountMinor:3500}].map((r,i)=>({...r,revision:{category:`synthetic_category_${i}`,relationship:[],ignored:null,amountMinor:r.amountMinor,pending:false,removed:false,date:r.date,accountRef:r.account.ref,name:r.name,merchantName:r.merchant}}))
}
const ready=init()
window.fetch=async(input,init)=>{
 const url=String(input),q=new URL(url,location.origin).searchParams
 if(!url.startsWith('/.netlify/functions/plaid-spending'))throw Error('Synthetic preview blocks external requests.')
 if(q.has('related')){await ready;const historical=q.get('historical')==='1',rows=matching.filter(r=>historical||r.date>=(q.get('from')??'2026-07-12'));return Response.json({rows,total:rows.length,complete:true,reason:null,identity:q.get('match')==='description'?'Exact description: WELLS FARGO MONTHLY SERVICE FEE':'WELLS FARGO MONTHLY SERVICE FEE (synthetic bank merchant)',grouping:q.get('match')??'merchant',historical,from:historical?'1900-01-01':q.get('from'),to:q.get('to'),accounts:'mapped',hierarchy:h,batchAvailable:true})}
 if(init?.method==='POST'){
  await ready;const body=JSON.parse(String(init.body)),selection=body.selection??[]
  if(body.action==='preview_categories')return Response.json({batchAvailable:true,preview:selection.map((s:any)=>({id:s.id,row:matching.find(r=>r.id===s.id),proposed:body.category,eligible:true,reason:null}))})
  if(body.action==='confirm_categories'){
   for(const s of selection){const r=matching.find(r=>r.id===s.id);r.bucket={...r.bucket,key:body.category,label:h.categories.find((c:any)=>c.key===body.category)?.name,state:'confirmed'};r.revision.category=`synthetic_saved_${r.id}`}
   return Response.json({results:selection.map((s:any)=>({id:s.id,outcome:'changed'}))})
  }
  throw Error('Only synthetic category-only preview/confirmation is simulated.')
 }
 return base(input,init)
}
