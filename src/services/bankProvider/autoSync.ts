/**
 * src/services/bankProvider/autoSync.ts
 *
 * SERVER-ONLY (PLAID-2A). Automatic bank sync for PRODUCTION Items, started by a verified Plaid webhook or by the 6-hour scheduled safety net, with NO user session.
 *
 *   NO SECOND SYNC ENGINE. The work is the existing resumable sync (resumableSync.ts) called in a loop. Every step claims the Item's lease with the same
 *   compare-and-set the owner's Sync button uses, so a webhook run, a scheduled run and a manual press can never sync one Item at the same time: the loser
 *   gets a 409 and simply stops (the staged run is durable, so whoever holds the lease continues it).
 *
 *   COST: this path calls /transactions/sync only (through resumableSyncStep). It never refreshes (/transactions/refresh) and never asks for real-time
 *   balances (/accounts/balance/get): both are billed per call, and neither is reachable from here.
 *
 *   AUTH between functions: the webhook and the schedule only KICK OFF work; the background function does it. The kick is signed with an HMAC whose key is
 *   DERIVED from the service-role key (never the key itself), bound to the Item id and a timestamp, and accepted for 5 minutes.
 *
 *   SYSTEM ACTOR: the sync RPCs take no user id and write no user columns (staging, evidence, Item state, webhook events), and the credential is bound to
 *   (organization, provider, provider item id) only. So the actor's user id is a fixed marker that is never persisted; nothing is inserted into auth.users.
 */
import { createHmac, timingSafeEqual } from 'node:crypto'
import { BankConnectionError, UUID, type BankActor, type BankConnectionDeps } from './bankConnectionService'
import { resumableSyncStep, type ResumableSyncDeps } from './resumableSync'
import { loadPlaidConfig } from './plaidConfig'
import { loadBankTokenEncryptionKey } from './providerTokenCrypto'
import { createPlaidSdkPort } from './plaidPort'
import { createBankConnectionRepo } from './bankConnectionRepo'
import { createBankAccountRepo } from './bankAccountRepo'
import { createBankSyncRepo } from './bankSyncRepo'
import { createSyncStagingRepo } from './syncStagingRepo'
import { createPendingContinuityRepo } from './pendingContinuityRepo'
import { SYNC_LEASE_MS } from './bankSyncService'

export const AUTO_SYNC_ACTOR_USER_ID = '00000000-0000-4000-8000-000000002a01'
export const AUTO_SYNC_SIGNATURE_WINDOW_MS = 5 * 60 * 1000
export const AUTO_SYNC_BACKGROUND_PATH = '/.netlify/functions/plaid-auto-sync-background'
/** Netlify background functions run up to 15 minutes; stop cleanly well before that. */
export const AUTO_SYNC_BUDGET_MS = 12 * 60 * 1000
/** A scheduled function has a short limit (~30 s): the sweep only kicks off work and uses at most this much of it. */
export const AUTO_SYNC_SWEEP_BUDGET_MS = 22_000
export const AUTO_SYNC_MAX_ITEMS_PER_SWEEP = 25
const MAX_STEPS = 400
const KEY_LABEL = 'poweron:plaid-auto-sync:v1'

type Env = Record<string, string | undefined>
/** Kill switch: automatic sync does nothing unless this is exactly "true". */
export const autoSyncEnabled = (env: Env = process.env) => (env.PLAID_AUTO_SYNC_ENABLED ?? '').trim() === 'true'
const flag = (env: Env, name: string) => (env[name] ?? '').trim() === 'true'

export const autoSyncActor = (organizationId: string): BankActor => ({ organizationId, userId: AUTO_SYNC_ACTOR_USER_ID, role: 'owner' })

// ── request signing ───────────────────────────────────────────────────────────────────────────────────────────────
const subKey = (serviceRoleKey: string) => createHmac('sha256', serviceRoleKey).update(KEY_LABEL).digest()
const mac = (serviceRoleKey: string, itemId: string, timestamp: string) => createHmac('sha256', subKey(serviceRoleKey)).update(`${itemId}.${timestamp}`).digest('hex')

export function signAutoSyncRequest(serviceRoleKey: string, itemId: string, nowMs: number = Date.now()): { timestamp: string; signature: string } {
  if (!serviceRoleKey) throw new Error('auto sync signing key missing')
  const timestamp = String(nowMs)
  return { timestamp, signature: mac(serviceRoleKey, itemId, timestamp) }
}

export function verifyAutoSyncRequest(serviceRoleKey: string, input: { itemId: unknown; timestamp: unknown; signature: unknown }, nowMs: number = Date.now()): boolean {
  if (!serviceRoleKey || typeof input.itemId !== 'string' || !UUID.test(input.itemId)) return false
  if (typeof input.timestamp !== 'string' || !/^\d{10,16}$/.test(input.timestamp)) return false
  if (typeof input.signature !== 'string' || !/^[0-9a-f]{64}$/.test(input.signature)) return false
  if (Math.abs(nowMs - Number(input.timestamp)) > AUTO_SYNC_SIGNATURE_WINDOW_MS) return false
  const expected = Buffer.from(mac(serviceRoleKey, input.itemId, input.timestamp), 'hex')
  const given = Buffer.from(input.signature, 'hex')
  return expected.length === given.length && timingSafeEqual(expected, given)
}

// ── kick-off (webhook and schedule) ───────────────────────────────────────────────────────────────────────────────
/** The site's own origin: the webhook URL's origin when configured, otherwise Netlify's URL variable. Null = unknown (nothing is called). */
export function autoSyncBaseUrl(env: Env = process.env): string | null {
  for (const raw of [env.PLAID_WEBHOOK_URL, env.URL]) {
    try { if (raw) { const u = new URL(raw.trim()); if (u.protocol === 'https:') return u.origin } } catch { /* try the next */ }
  }
  return null
}

/**
 * POST a signed request to the background function. 'accepted' = the platform took it (a background function answers 202 at once); 'unavailable' = no
 * route, no key, an error or a timeout, so the caller may fall back (the schedule) or rely on the stored nudge (the webhook). Never throws.
 */
export async function kickOffItemSync(input: { baseUrl: string | null; serviceRoleKey: string; itemId: string; fetcher?: typeof fetch; now?: () => number; timeoutMs?: number }): Promise<'accepted' | 'unavailable'> {
  if (!input.baseUrl || !input.serviceRoleKey) return 'unavailable'
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), input.timeoutMs ?? 3000)
  try {
    const { timestamp, signature } = signAutoSyncRequest(input.serviceRoleKey, input.itemId, (input.now ?? Date.now)())
    const res = await (input.fetcher ?? fetch)(`${input.baseUrl}${AUTO_SYNC_BACKGROUND_PATH}`, {
      method: 'POST', signal: controller.signal,
      headers: { 'Content-Type': 'application/json', 'x-poweron-ts': timestamp, 'x-poweron-sig': signature },
      body: JSON.stringify({ itemId: input.itemId }),
    })
    return res.status === 202 || res.status === 200 ? 'accepted' : 'unavailable'
  } catch { return 'unavailable' } finally { clearTimeout(timer) }
}

// ── the runner ────────────────────────────────────────────────────────────────────────────────────────────────────
export type AutoSyncOutcome = 'complete' | 'busy' | 'login_required' | 'budget' | 'error'
export interface AutoSyncResult { outcome: AutoSyncOutcome; steps: number; code?: string }

/** Runs bounded resumable steps for ONE Item until the update is applied, the lease is held by someone else, or the budget ends. Never throws. */
export async function runAutoSyncForItem(deps: ResumableSyncDeps, item: { id: string; organizationId: string }, opts: { budgetMs?: number; now?: () => number } = {}): Promise<AutoSyncResult> {
  const now = opts.now ?? Date.now
  const deadline = now() + (opts.budgetMs ?? AUTO_SYNC_BUDGET_MS)
  const actor = autoSyncActor(item.organizationId)
  let steps = 0
  while (now() < deadline && steps < MAX_STEPS) {
    try {
      const out = await resumableSyncStep(deps, actor, { itemId: item.id })
      steps += 1
      if (!out.more) return { outcome: 'complete', steps }
    } catch (error) {
      if (error instanceof BankConnectionError) {
        if (error.code === 'conflict') return { outcome: 'busy', steps }
        if (error.code === 'login_required') return { outcome: 'login_required', steps, code: error.code }
        return { outcome: 'error', steps, code: error.code }
      }
      return { outcome: 'error', steps, code: 'unexpected' }
    }
  }
  return { outcome: 'budget', steps }
}

// ── the scheduled sweep ───────────────────────────────────────────────────────────────────────────────────────────
export interface SweepSummary { considered: number; kicked: number; inline: number; skipped: number }

/**
 * One scheduled pass over every healthy production Item (all organizations). Each Item is kicked off to the background function; only if the platform
 * does not accept that does the sweep run bounded steps itself with the time it has left (the work is durable either way).
 */
export async function runScheduledSweep(input: {
  items: Array<{ id: string; organizationId: string }>
  kick: (itemId: string) => Promise<'accepted' | 'unavailable'>
  runInline: (item: { id: string; organizationId: string }, budgetMs: number) => Promise<AutoSyncResult>
  now?: () => number
  budgetMs?: number
  maxItems?: number
}): Promise<SweepSummary> {
  const now = input.now ?? Date.now
  const deadline = now() + (input.budgetMs ?? AUTO_SYNC_SWEEP_BUDGET_MS)
  const list = input.items.slice(0, input.maxItems ?? AUTO_SYNC_MAX_ITEMS_PER_SWEEP)
  const summary: SweepSummary = { considered: list.length, kicked: 0, inline: 0, skipped: 0 }
  for (const item of list) {
    if (now() >= deadline - 1000) { summary.skipped += 1; continue }
    if ((await input.kick(item.id)) === 'accepted') { summary.kicked += 1; continue }
    const left = deadline - now() - 2000
    if (left < 3000) { summary.skipped += 1; continue }
    await input.runInline(item, left)
    summary.inline += 1
  }
  summary.skipped += input.items.length - list.length
  return summary
}

// ── dependency wiring (service role, no user) ─────────────────────────────────────────────────────────────────────
type Svc = { from: (table: string) => any; rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: any; error: any }> }

/** Production only: throws if the server is not configured for Production, so a Sandbox Item can never be synced automatically. */
export function buildAutoSyncDeps(svc: Svc, env: Env = process.env, log?: BankConnectionDeps['log']): ResumableSyncDeps {
  const config = loadPlaidConfig(env)
  if (config.environment !== 'production') throw new BankConnectionError('conflict', 409, 'Automatic sync is for Production only.')
  const key = loadBankTokenEncryptionKey(env)
  return {
    plaid: createPlaidSdkPort(config), repo: createBankConnectionRepo(svc as any), accounts: createBankAccountRepo(svc as any),
    sync: createBankSyncRepo(svc as any, { auditEnabled: flag(env, 'PLAID_SYNC_AUDIT_ENABLED') }), key, environment: config.environment, log,
    backgroundSyncEnabled: false, syncLeaseMs: SYNC_LEASE_MS, resumableSyncEnabled: true,
    staging: createSyncStagingRepo(svc as any),
    pendingContinuityEnabled: flag(env, 'PLAID_PENDING_CONTINUITY_ENABLED'), continuity: createPendingContinuityRepo(svc as any),
  } as ResumableSyncDeps
}
