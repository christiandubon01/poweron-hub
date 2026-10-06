// Planner-specific public entry point; privileged dependencies stay server-side.
// @ts-ignore CommonJS backend utility is bundled by Netlify esbuild.
import planner from './lib/planner-handler.cjs'
export const handler = planner.makeHandler()
