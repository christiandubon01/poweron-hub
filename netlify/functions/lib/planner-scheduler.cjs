'use strict';
const {runMaintenance}=require('./planner-maintenance.cjs');
const {runtime}=require('./planner-runtime.cjs');
function makeScheduledHandler({env=process.env,run=runMaintenance,backendFactory=runtime,fetcher=fetch,log=console,budgetMs=20000}={}) {
  return async () => {
    const reply=(statusCode,body)=>({statusCode,body:JSON.stringify(body)});
    if(env.PANEL_PLANNER_MAINTENANCE_ENABLED!=='true') {
      const result={status:'disabled',maintenance_enabled:false};
      log.info(JSON.stringify({event:'panel_planner_maintenance',...result}));
      return reply(200,result);
    }
    // Stay below the Scheduled Function limit and well inside the five-minute claim lease.
    const controller=new AbortController();let stage='configuration';
    const timer=setTimeout(()=>controller.abort(),Math.max(1,Math.min(budgetMs,20000)));
    const boundedFetch=(url,options={})=>fetcher(url,{...options,
      signal:AbortSignal.any([controller.signal,...(options.signal?[options.signal]:[])])});
    log.info(JSON.stringify({event:'panel_planner_maintenance',status:'started'}));
    try {
      const result=await run({env,backend:backendFactory(env,boundedFetch),fetcher:boundedFetch,
        onStage:value=>{stage=value;}});
      const counts=Object.fromEntries(['orphans_removed','technical_records_expired','sent','failed','uncertain']
        .map(key=>[key,Number.isSafeInteger(result[key])?result[key]:0]));
      const output={status:'completed',maintenance_enabled:true,...counts};
      log.info(JSON.stringify({event:'panel_planner_maintenance',...output}));
      return reply(200,output);
    } catch {
      const output={status:'failed',code:controller.signal.aborted?'MAINTENANCE_BUDGET_EXHAUSTED':'MAINTENANCE_RUN_FAILED',stage};
      // Never log provider/SQL exceptions, addresses, payloads, capabilities or credentials.
      log.error(JSON.stringify({event:'panel_planner_maintenance',...output}));
      return reply(500,output);
    } finally {clearTimeout(timer);}
  };
}
module.exports={makeScheduledHandler};
