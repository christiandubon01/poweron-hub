// Server-only runner. Review/configure scheduler before deployment.
import maintenance from '../netlify/functions/lib/planner-maintenance.cjs';
if (process.argv.includes('--run')) {
  console.log(JSON.stringify(await maintenance.runMaintenance()));
} else {
  console.log('Use --run only in the reviewed backend job environment.');
}
