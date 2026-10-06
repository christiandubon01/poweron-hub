'use strict';
const {PlannerError}=require('./planner-contract.cjs');
async function denyPlannerUuidRead(fetcher,base,headers,requestId) {
  // Fail closed on an unavailable/missing planner schema. Deploy migration before functions.
  const res=await fetcher(base+'/rest/v1/portal_request_planner_details?request_id=eq.'+
    encodeURIComponent(requestId)+'&select=request_id&limit=1',{headers,signal:AbortSignal.timeout(15000)});
  if(!res.ok)throw new PlannerError('TEMPORARILY_UNAVAILABLE');
  const rows=await res.json();
  if(!Array.isArray(rows))throw new PlannerError('TEMPORARILY_UNAVAILABLE');
  return rows.length>0;
}
module.exports={denyPlannerUuidRead};
