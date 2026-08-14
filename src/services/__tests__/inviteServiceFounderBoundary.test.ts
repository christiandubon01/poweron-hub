import { beforeEach, describe, expect, it, vi } from 'vitest'

const deps = vi.hoisted(() => ({
  rpc: vi.fn(),
  fetch: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn(async () => ({ data: { session: { access_token: 'founder-jwt' } } })),
    },
    rpc: (...args: any[]) => deps.rpc(...args),
  },
}))

import { markInviteAccepted, revokeInvite, sendInvite, validateInviteToken } from '../inviteService'

beforeEach(() => {
  deps.rpc.mockReset()
  deps.fetch.mockReset()
  ;(globalThis as any).fetch = deps.fetch
})

describe('COMM-PROD-4 beta invite authority', () => {
  it('authenticates founder invite creation at the server boundary', async () => {
    deps.fetch.mockResolvedValue({ ok: true, json: async () => ({ success: true, inviteId: 'invite-1' }) })

    await expect(sendInvite('pilot@example.test', 'Electrical')).resolves.toMatchObject({ success: true, inviteId: 'invite-1' })

    expect(deps.fetch).toHaveBeenCalledWith('/.netlify/functions/sendInvite', expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer founder-jwt' }),
    }))
  })

  it('validates only through the token-scoped RPC', async () => {
    deps.rpc.mockResolvedValue({
      data: { valid: true, invite: { id: 'invite-current', email: 'pilot@example.test', status: 'pending' } },
      error: null,
    })

    await expect(validateInviteToken('token-long-enough')).resolves.toMatchObject({
      valid: true,
      invite: { id: 'invite-current' },
    })
    expect(deps.rpc).toHaveBeenCalledWith('validate_beta_invite', { p_token: 'token-long-enough' })
  })

  it('links acceptance through the authenticated RPC and surfaces a failed write', async () => {
    deps.rpc.mockResolvedValueOnce({ data: { success: true }, error: null })
    await expect(markInviteAccepted('token-long-enough')).resolves.toBeUndefined()
    expect(deps.rpc).toHaveBeenCalledWith('accept_beta_invite', { p_token: 'token-long-enough' })

    deps.rpc.mockResolvedValueOnce({ data: { success: false, reason: 'email_mismatch' }, error: null })
    await expect(markInviteAccepted('token-long-enough')).rejects.toThrow('email_mismatch')
  })

  it('routes revocation through the founder-only report function', async () => {
    deps.fetch.mockResolvedValue({ ok: true, text: async () => '' })

    await expect(revokeInvite('invite-1')).resolves.toEqual({ success: true })

    const [, init] = deps.fetch.mock.calls[0]
    expect(init.headers.Authorization).toBe('Bearer founder-jwt')
    expect(JSON.parse(init.body)).toEqual({ action: 'founder_revoke_beta_invite', inviteId: 'invite-1' })
  })
})
