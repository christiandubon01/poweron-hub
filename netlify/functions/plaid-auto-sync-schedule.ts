// @ts-nocheck
/**
 * PLAID-2A · Scheduled safety net, every 6 hours (production deploys only). It KICKS OFF the background worker for every healthy PRODUCTION Plaid Item of
 * every organization (service role, no user session); a scheduled function's short limit is why it does not do the work itself. Only if the platform
 * will not accept the kick does it run a few bounded sync steps inline. Request payloads cannot change what it does: it takes no input.
 * Sandbox Items are never listed. Pattern: panel-planner-maintenance.ts.
 */
import { AUTO_SYNC_SWEEP_BUDGET_MS, autoSyncBaseUrl, autoSyncEnabled, buildAutoSyncDeps, kickOffItemSync, runAutoSyncForItem, runScheduledSweep } from '../../src/services/bankProvider/autoSync'
import { createBankConnectionRepo } from '../../src/services/bankProvider/bankConnectionRepo'
import { loadPlaidConfig } from '../../src/services/bankProvider/plaidConfig'
import { resumableSyncEnabled, safeLog, serviceClient } from './bank/plaidAuth'

export function buildSweep(overrides = {}) {
  return async () => {
    const env = overrides.env ?? process.env
    const reply = (status, extra = {}) => ({ status, ...extra })
    if (!autoSyncEnabled(env)) { safeLog({ event: 'bank.autosync.sweep', outcome: 'disabled' }); return reply('disabled') }
    if (!resumableSyncEnabled(env)) { safeLog({ event: 'bank.autosync.sweep', code: 'resumable_sync_off' }); return reply('resumable_sync_off') }
    try {
      if (loadPlaidConfig(env).environment !== 'production') { safeLog({ event: 'bank.autosync.sweep', outcome: 'not_production' }); return reply('not_production') }
      const svc = (overrides.serviceClient ?? serviceClient)()
      if (!svc) return reply('failed', { code: 'no_client' })
      const items = await (overrides.listItems ?? (() => createBankConnectionRepo(svc).listSyncableItems('production')))()
      const baseUrl = autoSyncBaseUrl(env), serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY ?? ''
      let deps
      const summary = await runScheduledSweep({
        items, budgetMs: AUTO_SYNC_SWEEP_BUDGET_MS,
        kick: itemId => (overrides.kick ?? kickOffItemSync)({ baseUrl, serviceRoleKey, itemId }),
        runInline: (item, budgetMs) => (overrides.run ?? runAutoSyncForItem)(deps ??= (overrides.buildDeps ?? buildAutoSyncDeps)(svc, env, safeLog), item, { budgetMs }),
      })
      safeLog({ event: 'bank.autosync.sweep', outcome: 'completed', detail: 'considered=' + summary.considered + ';kicked=' + summary.kicked + ';inline=' + summary.inline + ';skipped=' + summary.skipped })
      return reply('completed', summary)
    } catch {
      safeLog({ event: 'bank.autosync.sweep', code: 'failed' })
      return reply('failed', { code: 'sweep_failed' })
    }
  }
}
const sweep = buildSweep()
export default async () => new Response(JSON.stringify(await sweep()), { status: 200, headers: { 'Content-Type': 'application/json' } })
export const config = { schedule: '0 */6 * * *' }
