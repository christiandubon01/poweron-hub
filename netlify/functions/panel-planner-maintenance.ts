// @ts-nocheck
// Scheduled-only server entry point. Request payloads cannot enable maintenance.
const {makeScheduledHandler}=require('./lib/planner-scheduler.cjs');
const invoke=makeScheduledHandler();
export default async () => {
  const result=await invoke();
  return new Response(result.body,{status:result.statusCode,headers:{'Content-Type':'application/json'}});
};
export const config={schedule:'*/5 * * * *'};
