/**
 * CT-CORE-1 §36 service-boundary tests: the REAL controlTowerService against
 * a fake Supabase client (no network). Covers the duplicate-request contract
 * (UNIQUE (organization_id, client_request_id) → the existing row is reused,
 * so the same request is never executed twice) and fail-closed auth/org rules.
 */
import { describe, expect, it, vi } from 'vitest'

const holder = vi.hoisted(() => ({ client: undefined as undefined | Record<PropertyKey, unknown> }))
vi.mock('../../lib/supabase', () => ({
  supabase: new Proxy({}, { get: (_target, property) => holder.client?.[property] }),
}))

import { ControlTowerServiceError, fetchScopePackRows, insertControlRequest, resolveControlTowerContext } from './controlTowerService'
import type { ControlRequestRow } from './controlTowerService'
import { IMPORT_SCOPE_PACK_MAX_PAYLOAD_BYTES } from './scopePack/bounds'
import { parseHandoffDocument, QBO_HANDOFF_FIXTURE } from './scopePack/handoffParser'
import { createHash } from 'node:crypto'

const EXISTING_ROW: ControlRequestRow = {
  id: 'row-1',
  request_type: 'create_plan',
  client_request_id: 'dup-id',
  repo_key: 'repo-key-1',
  status: 'pending',
  payload: { scope: 'Create the smoke marker file' },
  result: null,
  error: null,
  created_at: '2026-09-16T00:00:00Z',
}

function requestTableFake(existingRows: ControlRequestRow[], onInsert: () => { code: string; message: string }) {
  let existingFetches = 0
  const client: Record<PropertyKey, unknown> = {
    auth: { getUser: async () => ({ data: { user: { id: 'user-1' } }, error: null }) },
    rpc: async () => ({ data: 'org-1', error: null }),
    from: (table: string) => {
      expect(table).toBe('agent_control_requests')
      return {
        insert: () => ({ select: () => ({ single: async () => ({ data: null, error: onInsert() }) }) }),
        select: () => ({ eq: () => ({ eq: async () => {
          existingFetches += 1
          return { data: existingRows, error: null }
        } }) }),
      }
    },
  }
  return { client, existingFetches: () => existingFetches }
}

describe('CT-CORE-1 control request submission', () => {
  it('reuses the existing request row on a duplicate submit — the same request is never executed twice', async () => {
    let inserts = 0
    const fake = requestTableFake([EXISTING_ROW], () => { inserts += 1; return { code: '23505', message: 'duplicate key value violates unique constraint' } })
    holder.client = fake.client
    const row = await insertControlRequest({ organizationId: 'org-1', repoKey: 'repo-key-1', requestType: 'create_plan', clientRequestId: 'dup-id', payload: { scope: 'Create the smoke marker file' } })
    expect(inserts).toBe(1) // only ONE insert ever reached the table
    expect(fake.existingFetches()).toBe(1) // the duplicate resolved to the existing row
    expect(row).toEqual(EXISTING_ROW) // same request — not executed twice
  })

  it('fails honestly when the insert fails for a non-duplicate reason', async () => {
    const fake = requestTableFake([EXISTING_ROW], () => ({ code: '42501', message: 'new row violates row-level security policy' }))
    holder.client = fake.client
    await expect(insertControlRequest({ organizationId: 'org-1', repoKey: 'repo-key-1', requestType: 'create_plan', clientRequestId: 'other-id', payload: { scope: 'x' } }))
      .rejects.toMatchObject({ code: 'insert_failed' })
    expect(fake.existingFetches()).toBe(0) // no dedupe lookup for a non-duplicate failure
  })
})

function validImportPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    title: 'QBO',
    sourceFilename: 'qbo.md',
    sourceHash: 'a'.repeat(64),
    intent: 'truth',
    roadmapPhases: [],
    ownerDecisions: ['Keep the audit read-only'],
    supersededDecisions: ['Old silent-write rule'],
    forceNewVersion: true,
    ...overrides,
  }
}

function refusingClient(): { inserts: () => number } {
  let inserts = 0
  holder.client = {
    from: () => {
      inserts += 1
      throw new Error('persisted')
    },
  }
  return { inserts: () => inserts }
}

describe('ATB-5 import_scope_pack request + Scope Pack list', () => {
  it('submits a bounded import_scope_pack without raw source fields', async () => {
    const inserted: Record<string, unknown>[] = []
    holder.client = {
      from: (table: string) => {
        expect(table).toBe('agent_control_requests')
        return {
          insert: (values: Record<string, unknown>) => {
            inserted.push(values)
            return { select: () => ({ single: async () => ({ data: { ...EXISTING_ROW, request_type: 'import_scope_pack', payload: values.payload }, error: null }) }) }
          },
        }
      },
    }
    await insertControlRequest({
      organizationId: 'org-1',
      repoKey: 'repo-key-1',
      requestType: 'import_scope_pack',
      clientRequestId: 'import-1',
      payload: validImportPayload(),
    })
    expect(inserted[0].request_type).toBe('import_scope_pack')
    expect(JSON.stringify(inserted[0].payload)).not.toMatch(/rawText|filePath|sourceText/)
    expect((inserted[0].payload as Record<string, unknown>).ownerDecisions).toEqual(['Keep the audit read-only'])
    expect((inserted[0].payload as Record<string, unknown>).forceNewVersion).toBe(true)
  })

  it('accepts the normal handoff parser draft before persistence', async () => {
    const text = QBO_HANDOFF_FIXTURE
    const parsed = parseHandoffDocument({
      filename: 'poweron-qbo-handoff.md',
      sourceHash: createHash('sha256').update(text, 'utf8').digest('hex'),
      text,
      byteLength: new TextEncoder().encode(text).byteLength,
    })
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const inserted: Record<string, unknown>[] = []
    holder.client = {
      from: () => ({
        insert: (values: Record<string, unknown>) => {
          inserted.push(values)
          return { select: () => ({ single: async () => ({ data: { ...EXISTING_ROW, request_type: 'import_scope_pack', payload: values.payload }, error: null }) }) }
        },
      }),
    }
    await insertControlRequest({
      organizationId: 'org-1',
      repoKey: 'repo-key-1',
      requestType: 'import_scope_pack',
      clientRequestId: 'import-qbo',
      payload: parsed.draft as unknown as Record<string, unknown>,
    })
    expect(inserted).toHaveLength(1)
  })

  it.each([
    ['rawText', { rawText: 'SECRET HANDOFF' }],
    ['contents', { contents: 'SECRET HANDOFF' }],
    ['localPath', { localPath: 'C:\\\\handoff.md' }],
    ['filePath', { filePath: 'C:\\\\handoff.md' }],
    ['unknown top-level', { extraNote: 'nope' }],
    ['nested draft', { draft: { title: 'nested dump' } }],
  ])('rejects %s before the request row is inserted', async (_label, extra) => {
    const client = refusingClient()
    await expect(insertControlRequest({
      organizationId: 'org-1',
      repoKey: 'repo-key-1',
      requestType: 'import_scope_pack',
      clientRequestId: 'import-bad',
      payload: validImportPayload(extra),
    })).rejects.toMatchObject({ code: 'payload_rejected' })
    expect(client.inserts()).toBe(0)
  })

  it('rejects an oversized structured import payload before persistence', async () => {
    const client = refusingClient()
    const payload = validImportPayload({ intent: 'x'.repeat(IMPORT_SCOPE_PACK_MAX_PAYLOAD_BYTES) })
    expect(new TextEncoder().encode(JSON.stringify(payload)).length).toBeGreaterThan(IMPORT_SCOPE_PACK_MAX_PAYLOAD_BYTES)
    await expect(insertControlRequest({
      organizationId: 'org-1',
      repoKey: 'repo-key-1',
      requestType: 'import_scope_pack',
      clientRequestId: 'import-huge',
      payload,
    })).rejects.toMatchObject({ code: 'payload_rejected' })
    expect(client.inserts()).toBe(0)
  })

  it('accepts a character-maximum structured contract under the size bound', async () => {
    const fill = (count: number, char = 'a') => char.repeat(count)
    const phases = Array.from({ length: 24 }, (_, index) => ({
      id: `${index}`.padStart(64, 'p'),
      title: fill(160),
      goal: fill(800),
      executionIntent: 'implementation' as const,
    }))
    const item = fill(800)
    const payload = validImportPayload({
      title: fill(160),
      sourceFilename: `${fill(257)}.md`,
      sourceHash: fill(64),
      historicalCheckpoint: fill(200),
      intent: fill(4000),
      foundationClaims: Array(32).fill(item),
      lockedRules: Array(32).fill(item),
      doNotTouch: Array(32).fill(item),
      roadmapPhases: phases,
      currentPhaseId: phases[0].id,
      acceptanceCriteria: Array(24).fill(item),
      ownerDecisions: Array(24).fill(item),
      supersededDecisions: Array(24).fill(item),
      knownRisks: Array(16).fill(item),
      relatedAppAreas: Array(16).fill(fill(200)),
      runtimeAcceptanceRequired: true,
      forceNewVersion: true,
    })
    const bytes = new TextEncoder().encode(JSON.stringify(payload)).length
    expect(bytes).toBeLessThanOrEqual(IMPORT_SCOPE_PACK_MAX_PAYLOAD_BYTES)
    expect(bytes).toBeLessThan(256 * 1024)
    const inserted: unknown[] = []
    holder.client = {
      from: () => ({
        insert: (values: Record<string, unknown>) => {
          inserted.push(values)
          return { select: () => ({ single: async () => ({ data: { ...EXISTING_ROW, request_type: 'import_scope_pack', payload: values.payload }, error: null }) }) }
        },
      }),
    }
    await insertControlRequest({
      organizationId: 'org-1',
      repoKey: 'repo-key-1',
      requestType: 'import_scope_pack',
      clientRequestId: 'import-max',
      payload,
    })
    expect(inserted).toHaveLength(1)
  })

  it('leaves create_plan payloads on the existing insert path', async () => {
    const inserted: Record<string, unknown>[] = []
    holder.client = {
      from: () => ({
        insert: (values: Record<string, unknown>) => {
          inserted.push(values)
          return { select: () => ({ single: async () => ({ data: { ...EXISTING_ROW, payload: values.payload }, error: null }) }) }
        },
      }),
    }
    await insertControlRequest({
      organizationId: 'org-1',
      repoKey: 'repo-key-1',
      requestType: 'create_plan',
      clientRequestId: 'plan-1',
      payload: { scope: 'Create the smoke marker file', note: 'existing shape' },
    })
    expect(inserted[0].request_type).toBe('create_plan')
    expect(inserted[0].payload).toEqual({ scope: 'Create the smoke marker file', note: 'existing shape' })
  })

  it('lists Scope Packs for the current org and repo only', async () => {
    const eqs: Array<[string, string]> = []
    holder.client = {
      from: (table: string) => {
        expect(table).toBe('agent_scope_packs')
        return {
          select: () => ({
            eq: (column: string, value: string) => {
              eqs.push([column, value])
              return {
                eq: (column2: string, value2: string) => {
                  eqs.push([column2, value2])
                  return { order: async () => ({ data: [], error: null }) }
                },
              }
            },
          }),
        }
      },
    }
    await fetchScopePackRows('org-1', '0123456789abcdef')
    expect(eqs).toEqual([['organization_id', 'org-1'], ['repo_key', '0123456789abcdef']])
  })
})

describe('CT-CORE-1 context resolution (fail closed)', () => {
  it('resolves the authenticated user and their active organization', async () => {
    holder.client = {
      auth: { getUser: async () => ({ data: { user: { id: 'user-1' } }, error: null }) },
      rpc: async () => ({ data: 'org-1', error: null }),
    }
    await expect(resolveControlTowerContext()).resolves.toEqual({ userId: 'user-1', organizationId: 'org-1' })
  })

  it('fails closed without an authenticated session', async () => {
    holder.client = { auth: { getUser: async () => ({ data: { user: null }, error: { message: 'no session' } }) } }
    await expect(resolveControlTowerContext()).rejects.toMatchObject({ code: 'unauthenticated' })
    await expect(resolveControlTowerContext()).rejects.toBeInstanceOf(ControlTowerServiceError)
  })

  it('fails closed without an active organization', async () => {
    holder.client = {
      auth: { getUser: async () => ({ data: { user: { id: 'user-1' } }, error: null }) },
      rpc: async () => ({ data: null, error: null }),
    }
    await expect(resolveControlTowerContext()).rejects.toMatchObject({ code: 'org_missing' })
  })
})