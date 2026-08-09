import { describe, expect, it, vi } from 'vitest'
import { completeDeferredHydration } from '../postPinHydrationService'

const applied = {
  success: true,
  merged: true,
  status: 'applied' as const,
}

const deferred = {
  success: true,
  merged: false,
  status: 'deferred_pending_local' as const,
}

describe('SYNC-08 deferred hydration coordinator', () => {
  it('leaves a completed hydration alone', async () => {
    const reconcilePendingLocalSave = vi.fn()
    const requestRemoteRefresh = vi.fn()

    await expect(completeDeferredHydration(applied, {
      reconcilePendingLocalSave,
      hasPendingLocalSave: () => false,
      requestRemoteRefresh,
    })).resolves.toEqual(applied)

    expect(reconcilePendingLocalSave).not.toHaveBeenCalled()
    expect(requestRemoteRefresh).not.toHaveBeenCalled()
  })

  it('awaits one guarded pending reconciliation and then requests one guarded refresh', async () => {
    let pending = true
    const order: string[] = []
    const reconcilePendingLocalSave = vi.fn(async () => {
      order.push('reconcile')
      pending = false
      return { success: true }
    })
    const requestRemoteRefresh = vi.fn(async () => {
      order.push('refresh')
      return null
    })

    const result = await completeDeferredHydration(deferred, {
      reconcilePendingLocalSave,
      hasPendingLocalSave: () => pending,
      requestRemoteRefresh,
    })

    expect(result).toMatchObject({
      success: true,
      merged: true,
      status: 'applied',
      reconciledPendingLocal: true,
    })
    expect(order).toEqual(['reconcile', 'refresh'])
    expect(reconcilePendingLocalSave).toHaveBeenCalledTimes(1)
    expect(requestRemoteRefresh).toHaveBeenCalledTimes(1)
  })

  it('does not refresh or loop when guarded reconciliation fails', async () => {
    const reconcilePendingLocalSave = vi.fn(async () => ({ success: false, error: 'offline' }))
    const requestRemoteRefresh = vi.fn()

    await expect(completeDeferredHydration(deferred, {
      reconcilePendingLocalSave,
      hasPendingLocalSave: () => true,
      requestRemoteRefresh,
    })).rejects.toThrow('offline')

    expect(reconcilePendingLocalSave).toHaveBeenCalledTimes(1)
    expect(requestRemoteRefresh).not.toHaveBeenCalled()
  })

  it('does not refresh when pending markers did not clear after a reported success', async () => {
    const reconcilePendingLocalSave = vi.fn(async () => ({ success: true }))
    const requestRemoteRefresh = vi.fn()

    await expect(completeDeferredHydration(deferred, {
      reconcilePendingLocalSave,
      hasPendingLocalSave: () => true,
      requestRemoteRefresh,
    })).rejects.toThrow('still waiting')

    expect(reconcilePendingLocalSave).toHaveBeenCalledTimes(1)
    expect(requestRemoteRefresh).not.toHaveBeenCalled()
  })
})
