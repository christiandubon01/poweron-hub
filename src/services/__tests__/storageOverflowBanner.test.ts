import { describe, expect, it } from 'vitest'
import {
  isSameGeneration,
  shouldClearOverflowWarningOnLocalPersistence,
  shouldClearOverflowWarningOnSync,
  shouldMarkDurableOnPersist,
} from '@/services/storageOverflowBanner'

const A = '0000000000000000001:tab-a'
const B = '0000000000000000002:tab-a'

describe('overflow persistence generation correlation', () => {
  it('requires exact generation identity', () => {
    expect(isSameGeneration(A, A)).toBe(true)
    expect(isSameGeneration(B, A)).toBe(false)
    expect(isSameGeneration(null, A)).toBe(false)
    expect(isSameGeneration(A, null)).toBe(false)
  })

  it('an older sync cannot clear a newer warning even if it completed later', () => {
    expect(shouldClearOverflowWarningOnSync(B, A)).toBe(false)
    expect(shouldClearOverflowWarningOnSync(B, B)).toBe(true)
  })

  it('only the exact IndexedDB snapshot marks that warning durable', () => {
    expect(shouldMarkDurableOnPersist(B, A)).toBe(false)
    expect(shouldMarkDurableOnPersist(B, B)).toBe(true)
  })

  it('generic data refresh events cannot clear an overflow warning', () => {
    expect(shouldClearOverflowWarningOnLocalPersistence(B, undefined, B)).toBe(false)
    expect(shouldClearOverflowWarningOnLocalPersistence(B, 'remote-refresh', B)).toBe(false)
    expect(shouldClearOverflowWarningOnLocalPersistence(B, 'localStorage', A)).toBe(false)
    expect(shouldClearOverflowWarningOnLocalPersistence(B, 'localStorage', B)).toBe(true)
  })
})
