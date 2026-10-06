// Server-only runner. Both --run and the explicit enable switch are required.
import scheduler from '../netlify/functions/lib/planner-scheduler.cjs';
if(process.argv.includes('--run')) {
  const result=await scheduler.makeScheduledHandler()();
  if(result.statusCode!==200)process.exitCode=1;
} else {
  console.log(JSON.stringify({status:'disabled',maintenance_enabled:false,reason:'explicit_run_required'}));
}
