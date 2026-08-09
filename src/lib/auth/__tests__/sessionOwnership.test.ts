import { beforeEach, describe, expect, it, vi } from 'vitest'

const sessionDeps = vi.hoisted(() => ({
  sessionStoreCall: vi.fn(),
}))

vi.mock('@/lib/auth/sessionStoreClient', () => ({
  sessionStoreCall: (...args: any[]) => sessionDeps.sessionStoreCall(...args),
}))

import { createAppSession, destroyAppSession, validateAppSession } from '../session'

class MemoryStorage {
  private values = new Map<string, string>()
  get length(): number { return this.values.size }
  clear(): void { this.values.clear() }
  getItem(key: string): string | null { return this.values.get(key) ?? null }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null }
  removeItem(key: string): void { this.values.delete(key) }
  setItem(key: string, value: string): void { this.values.set(String(key), String(value)) }
}

const deviceInfo = { platform: 'web', userAgent: 'test', appVersion: 'test' }

beforeEach(() => {
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: new MemoryStorage() })
  sessionDeps.sessionStoreCall.mockReset()
})

describe('app-session operation ownership', () => {
  it('does not let a stale session creation replace a newer stored session', async () => {
    sessionStorage.setItem('poweron-session-id', 'session-b')
    sessionDeps.sessionStoreCall
      .mockResolvedValueOnce({ sessionId: 'session-a' })
      .mockResolvedValueOnce({ ok: true })

    const created = await createAppSession({
      userId: 'owner-1', orgId: 'org-1', role: 'owner', deviceInfo,
      isCurrent: () => false,
    })

    expect(created).toBe('session-a')
    expect(sessionStorage.getItem('poweron-session-id')).toBe('session-b')
    expect(sessionDeps.sessionStoreCall).toHaveBeenNthCalledWith(2, 'session.destroy', {
      sessionId: 'session-a',
    })
  })

  it('destroys only the expected old session and preserves the newer storage owner', async () => {
    sessionStorage.setItem('poweron-session-id', 'session-b')
    sessionDeps.sessionStoreCall.mockResolvedValue({ ok: true })

    await destroyAppSession('session-a')

    expect(sessionDeps.sessionStoreCall).toHaveBeenCalledWith('session.destroy', {
      sessionId: 'session-a',
    })
    expect(sessionStorage.getItem('poweron-session-id')).toBe('session-b')
  })

  it('removes storage when targeted cleanup still owns the stored session', async () => {
    sessionStorage.setItem('poweron-session-id', 'session-a')
    sessionDeps.sessionStoreCall.mockResolvedValue({ ok: true })

    await destroyAppSession('session-a')

    expect(sessionStorage.getItem('poweron-session-id')).toBeNull()
  })

  it('validates the expected operation session instead of whichever ID is current', async () => {
    sessionStorage.setItem('poweron-session-id', 'session-b')
    sessionDeps.sessionStoreCall.mockResolvedValue({ session: null })

    await validateAppSession('session-a')

    expect(sessionDeps.sessionStoreCall).toHaveBeenCalledWith('session.validate', {
      sessionId: 'session-a',
    })
  })
})
