import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()
const FUNCTION_SOURCE = readFileSync(join(ROOT, 'netlify/functions/pilot-telemetry.ts'), 'utf8')

const CONTRACTOR_ORG_A = '845802cf-76f3-4fe5-bfaf-5692ff81922c'
const POWERON_ORG_B = '2443697b-0000-4000-8000-000000000001'
const ACTOR_USER_ID = 'actor-dual-identity-1'
const OWNED_SESSION_ID = 'b20c5e1a-owned-session-1'
const OTHER_USER_SESSION_ID = 'other-user-session-9'

type SessionRow = {
  session_id: string
  user_id: string
  org_id: string
  ended_at?: string | null
} | null

type ProfileRow = {
  id: string
  org_id: string
  role: string
  is_active: boolean
} | null

type EmployeeRow = {
  id: string
  org_id: string
  active: boolean
  accepted_at: string | null
  portal_access?: Record<string, unknown>
}

const state = {
  profile: null as ProfileRow,
  employeeProfiles: [] as EmployeeRow[],
  sessionsByKey: new Map<string, SessionRow>(),
  inserts: [] as Array<Record<string, unknown>>,
}

function sessionKey(sessionId: string, userId: string) {
  return `${sessionId}::${userId}`
}

function makeThenableBuilder(resolve: () => Promise<{ data: any; error: any }>) {
  const builder: any = {
    select() { return builder },
    eq() { return builder },
    insert(row: any) {
      state.inserts.push(row)
      return Promise.resolve({ data: row, error: null })
    },
    maybeSingle() { return resolve() },
    then(onFulfilled: any, onRejected: any) {
      return resolve().then(onFulfilled, onRejected)
    },
  }
  return builder
}

function createMockSupabase() {
  return {
    from(table: string) {
      if (table === 'profiles') {
        return makeThenableBuilder(async () => ({ data: state.profile, error: null }))
      }
      if (table === 'employee_profiles') {
        const builder: any = {
          select() { return builder },
          eq() { return builder },
          then(onFulfilled: any, onRejected: any) {
            return Promise.resolve({ data: state.employeeProfiles, error: null }).then(onFulfilled, onRejected)
          },
        }
        return builder
      }
      if (table === 'user_sessions') {
        let sessionIdFilter = ''
        let userIdFilter = ''
        const builder: any = {
          select() { return builder },
          eq(column: string, value: string) {
            if (column === 'session_id') sessionIdFilter = String(value)
            if (column === 'user_id') userIdFilter = String(value)
            return builder
          },
          maybeSingle() {
            const row = state.sessionsByKey.get(sessionKey(sessionIdFilter, userIdFilter)) ?? null
            return Promise.resolve({ data: row, error: null })
          },
        }
        return builder
      }
      if (table === 'pilot_telemetry_events') {
        return {
          insert(row: any) {
            state.inserts.push(row)
            return Promise.resolve({ data: row, error: null })
          },
        }
      }
      throw new Error(`Unexpected table: ${table}`)
    },
  }
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => createMockSupabase(),
}))

vi.mock('@upstash/redis', () => ({
  Redis: class {
    constructor() {}
  },
}))

import {
  handleTrackEvent,
  resolveProductUsageSessionContext,
} from '../../netlify/functions/pilot-telemetry'

function trackBody(payload: Record<string, unknown>) {
  return {
    httpMethod: 'POST',
    body: JSON.stringify(payload),
  }
}

function parse(response: { statusCode: number; body: string }) {
  return {
    statusCode: response.statusCode,
    body: JSON.parse(response.body),
  }
}

beforeEach(() => {
  process.env.SUPABASE_URL = 'https://example.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test-key'
  state.profile = {
    id: ACTOR_USER_ID,
    org_id: CONTRACTOR_ORG_A,
    role: 'owner',
    is_active: true,
  }
  state.employeeProfiles = []
  state.sessionsByKey = new Map()
  state.inserts = []
})

describe('GUARDIAN-3B4A resolveProductUsageSessionContext', () => {
  it('returns owned session org and ignores ended_at for immutable binding', async () => {
    state.sessionsByKey.set(sessionKey(OWNED_SESSION_ID, ACTOR_USER_ID), {
      session_id: OWNED_SESSION_ID,
      user_id: ACTOR_USER_ID,
      org_id: CONTRACTOR_ORG_A,
      ended_at: '2026-08-15T09:00:00.000Z',
    })

    const ctx = await resolveProductUsageSessionContext(
      createMockSupabase(),
      ACTOR_USER_ID,
      OWNED_SESSION_ID,
    )
    expect(ctx).toEqual({
      sessionId: OWNED_SESSION_ID,
      organizationId: CONTRACTOR_ORG_A,
    })
  })

  it('rejects spoofed session belonging to another user', async () => {
    state.sessionsByKey.set(sessionKey(OTHER_USER_SESSION_ID, 'other-user'), {
      session_id: OTHER_USER_SESSION_ID,
      user_id: 'other-user',
      org_id: POWERON_ORG_B,
    })

    const ctx = await resolveProductUsageSessionContext(
      createMockSupabase(),
      ACTOR_USER_ID,
      OTHER_USER_SESSION_ID,
    )
    expect(ctx).toBeNull()
  })

  it('rejects nonexistent session_id and missing session_id', async () => {
    expect(await resolveProductUsageSessionContext(createMockSupabase(), ACTOR_USER_ID, 'missing')).toBeNull()
    expect(await resolveProductUsageSessionContext(createMockSupabase(), ACTOR_USER_ID, null)).toBeNull()
    expect(await resolveProductUsageSessionContext(createMockSupabase(), ACTOR_USER_ID, '')).toBeNull()
  })
})

describe('GUARDIAN-3B4A handleTrackEvent product-usage org attribution', () => {
  it('1. normal canonical owner: owned session org A → module_entered stored org A', async () => {
    state.sessionsByKey.set(sessionKey(OWNED_SESSION_ID, ACTOR_USER_ID), {
      session_id: OWNED_SESSION_ID,
      user_id: ACTOR_USER_ID,
      org_id: CONTRACTOR_ORG_A,
    })

    const result = parse(await handleTrackEvent(
      trackBody({
        action: 'track_event',
        eventName: 'module_entered',
        module: 'projects',
        metadata: {
          session_id: OWNED_SESSION_ID,
          device_id: 'device-1',
          projectName: 'SECRET',
        },
      }),
      { id: ACTOR_USER_ID, email: 'owner@example.com' },
    ))

    expect(result).toEqual({ statusCode: 200, body: { ok: true } })
    expect(state.inserts).toHaveLength(1)
    expect(state.inserts[0].organization_id).toBe(CONTRACTOR_ORG_A)
    expect(state.inserts[0].event_name).toBe('module_entered')
    expect(state.inserts[0].metadata).toEqual({
      session_id: OWNED_SESSION_ID,
      device_id: 'device-1',
    })
  })

  it('2-4. dual identity: employee org B cannot override owned session org A for module_entered', async () => {
    state.profile = {
      id: ACTOR_USER_ID,
      org_id: CONTRACTOR_ORG_A,
      role: 'owner',
      is_active: true,
    }
    state.employeeProfiles = [{
      id: 'emp-poweron-1',
      org_id: POWERON_ORG_B,
      active: true,
      accepted_at: '2026-01-01T00:00:00.000Z',
      portal_access: { time_tracking: true },
    }]
    state.sessionsByKey.set(sessionKey(OWNED_SESSION_ID, ACTOR_USER_ID), {
      session_id: OWNED_SESSION_ID,
      user_id: ACTOR_USER_ID,
      org_id: CONTRACTOR_ORG_A,
    })

    const result = parse(await handleTrackEvent(
      trackBody({
        eventName: 'module_entered',
        module: 'blueprint',
        metadata: { session_id: OWNED_SESSION_ID, device_id: 'device-1' },
      }),
      { id: ACTOR_USER_ID },
    ))

    expect(result.statusCode).toBe(200)
    expect(state.inserts[0].organization_id).toBe(CONTRACTOR_ORG_A)
    expect(state.inserts[0].organization_id).not.toBe(POWERON_ORG_B)
    expect(state.inserts[0].actor_kind).toBe('employee')
    expect(state.inserts[0].actor_employee_profile_id).toBe('emp-poweron-1')
  })

  it('3. dual identity engagement_window uses owned session org A', async () => {
    state.employeeProfiles = [{
      id: 'emp-poweron-1',
      org_id: POWERON_ORG_B,
      active: true,
      accepted_at: '2026-01-01T00:00:00.000Z',
    }]
    state.sessionsByKey.set(sessionKey(OWNED_SESSION_ID, ACTOR_USER_ID), {
      session_id: OWNED_SESSION_ID,
      user_id: ACTOR_USER_ID,
      org_id: CONTRACTOR_ORG_A,
    })

    const result = parse(await handleTrackEvent(
      trackBody({
        eventName: 'engagement_window',
        module: 'projects',
        metadata: {
          duration_seconds: 42,
          session_id: OWNED_SESSION_ID,
          device_id: 'device-1',
          customerName: 'blocked',
        },
      }),
      { id: ACTOR_USER_ID },
    ))

    expect(result).toEqual({ statusCode: 200, body: { ok: true } })
    expect(state.inserts[0].organization_id).toBe(CONTRACTOR_ORG_A)
    expect(state.inserts[0].event_name).toBe('engagement_window')
    expect(state.inserts[0].metadata).toEqual({
      duration_seconds: 42,
      session_id: OWNED_SESSION_ID,
      device_id: 'device-1',
    })
  })

  it('5. spoofed session belonging to another user is dropped', async () => {
    state.employeeProfiles = [{
      id: 'emp-poweron-1',
      org_id: POWERON_ORG_B,
      active: true,
      accepted_at: '2026-01-01T00:00:00.000Z',
    }]
    state.sessionsByKey.set(sessionKey(OTHER_USER_SESSION_ID, 'other-user'), {
      session_id: OTHER_USER_SESSION_ID,
      user_id: 'other-user',
      org_id: POWERON_ORG_B,
    })

    const result = parse(await handleTrackEvent(
      trackBody({
        eventName: 'module_entered',
        module: 'home',
        metadata: { session_id: OTHER_USER_SESSION_ID },
      }),
      { id: ACTOR_USER_ID },
    ))

    expect(result).toEqual({
      statusCode: 200,
      body: { ok: true, skipped: true, reason: 'session_attribution_unavailable' },
    })
    expect(state.inserts).toHaveLength(0)
  })

  it('6-7. nonexistent or missing session_id is dropped without employee-org fallback', async () => {
    state.employeeProfiles = [{
      id: 'emp-poweron-1',
      org_id: POWERON_ORG_B,
      active: true,
      accepted_at: '2026-01-01T00:00:00.000Z',
    }]

    const missing = parse(await handleTrackEvent(
      trackBody({
        eventName: 'module_entered',
        module: 'home',
        metadata: { session_id: 'does-not-exist' },
      }),
      { id: ACTOR_USER_ID },
    ))
    expect(missing.body.skipped).toBe(true)
    expect(state.inserts).toHaveLength(0)

    const omitted = parse(await handleTrackEvent(
      trackBody({
        eventName: 'module_entered',
        module: 'home',
        metadata: { device_id: 'device-1' },
      }),
      { id: ACTOR_USER_ID },
    ))
    expect(omitted.body).toEqual({
      ok: true,
      skipped: true,
      reason: 'session_attribution_unavailable',
    })
    expect(state.inserts).toHaveLength(0)
  })

  it('8. ended owned session still attributes final engagement_window', async () => {
    state.sessionsByKey.set(sessionKey(OWNED_SESSION_ID, ACTOR_USER_ID), {
      session_id: OWNED_SESSION_ID,
      user_id: ACTOR_USER_ID,
      org_id: CONTRACTOR_ORG_A,
      ended_at: '2026-08-15T09:00:00.000Z',
    })

    const result = parse(await handleTrackEvent(
      trackBody({
        eventName: 'engagement_window',
        module: 'money',
        metadata: {
          duration_seconds: 9,
          session_id: OWNED_SESSION_ID,
          device_id: 'device-1',
        },
      }),
      { id: ACTOR_USER_ID },
    ))

    expect(result.statusCode).toBe(200)
    expect(state.inserts[0].organization_id).toBe(CONTRACTOR_ORG_A)
  })

  it('9. inactive/revoked actor still denied', async () => {
    state.profile = {
      id: ACTOR_USER_ID,
      org_id: CONTRACTOR_ORG_A,
      role: 'owner',
      is_active: false,
    }
    state.sessionsByKey.set(sessionKey(OWNED_SESSION_ID, ACTOR_USER_ID), {
      session_id: OWNED_SESSION_ID,
      user_id: ACTOR_USER_ID,
      org_id: CONTRACTOR_ORG_A,
    })

    const result = parse(await handleTrackEvent(
      trackBody({
        eventName: 'module_entered',
        module: 'home',
        metadata: { session_id: OWNED_SESSION_ID },
      }),
      { id: ACTOR_USER_ID },
    ))

    expect(result).toEqual({
      statusCode: 403,
      body: { error: 'Access unavailable.' },
    })
    expect(state.inserts).toHaveLength(0)
  })

  it('10. arbitrary business metadata remains stripped', async () => {
    state.sessionsByKey.set(sessionKey(OWNED_SESSION_ID, ACTOR_USER_ID), {
      session_id: OWNED_SESSION_ID,
      user_id: ACTOR_USER_ID,
      org_id: CONTRACTOR_ORG_A,
    })

    await handleTrackEvent(
      trackBody({
        eventName: 'module_entered',
        module: 'projects',
        metadata: {
          session_id: OWNED_SESSION_ID,
          device_id: 'device-1',
          project_id: 'p-1',
          customerName: 'Acme',
          estimateTotal: 999,
          route: '/secret',
        },
      }),
      { id: ACTOR_USER_ID },
    )

    expect(state.inserts[0].metadata).toEqual({
      session_id: OWNED_SESSION_ID,
      device_id: 'device-1',
    })
  })

  it('11. non-product telemetry continues through existing actor-resolution path', async () => {
    state.employeeProfiles = [{
      id: 'emp-poweron-1',
      org_id: POWERON_ORG_B,
      active: true,
      accepted_at: '2026-01-01T00:00:00.000Z',
    }]
    state.sessionsByKey.set(sessionKey(OWNED_SESSION_ID, ACTOR_USER_ID), {
      session_id: OWNED_SESSION_ID,
      user_id: ACTOR_USER_ID,
      org_id: CONTRACTOR_ORG_A,
    })

    const result = parse(await handleTrackEvent(
      trackBody({
        eventName: 'blueprint_opened',
        module: 'blueprint',
        metadata: { session_id: OWNED_SESSION_ID },
      }),
      { id: ACTOR_USER_ID },
    ))

    expect(result).toEqual({ statusCode: 200, body: { ok: true } })
    expect(state.inserts[0].event_name).toBe('blueprint_opened')
    // Existing authority: employee membership still wins for non-product events.
    expect(state.inserts[0].organization_id).toBe(POWERON_ORG_B)
  })

  it('12. single-identity owner telemetry behavior unchanged for non-product events', async () => {
    const result = parse(await handleTrackEvent(
      trackBody({
        eventName: 'login_success',
        module: 'auth',
      }),
      { id: ACTOR_USER_ID },
    ))

    expect(result).toEqual({ statusCode: 200, body: { ok: true } })
    expect(state.inserts[0].organization_id).toBe(CONTRACTOR_ORG_A)
    expect(state.inserts[0].actor_kind).toBe('owner_admin')
  })
})

describe('GUARDIAN-3B4A wiring contracts', () => {
  it('uses a narrow product-usage session helper and does not globally rewrite resolveActorContext', () => {
    expect(FUNCTION_SOURCE).toContain('resolveProductUsageSessionContext')
    expect(FUNCTION_SOURCE).toContain("reason: 'session_attribution_unavailable'")
    expect(FUNCTION_SOURCE).toContain('product.metadata?.session_id')
    expect(FUNCTION_SOURCE).toMatch(/if \(employeeProfile\?\.org_id\) \{[\s\S]*organizationId: String\(employeeProfile\.org_id\)/)
    expect(FUNCTION_SOURCE).toContain('isProductUsageTelemetryEventName(eventName)')
    expect(FUNCTION_SOURCE.indexOf('resolveProductUsageSessionContext')).toBeGreaterThan(
      FUNCTION_SOURCE.indexOf('async function resolveActorContext'),
    )
  })
})
