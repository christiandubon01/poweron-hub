import { describe, expect, it } from 'vitest'
import {
  isAtLeastAsNew,
  shouldClearOverflowWarningOnSync,
  shouldMarkDurableOnPersist,
} from '@/services/storageOverflowBanner'

const T0 = '2026-10-14T06:00:00.000Z'
const T1 = '2026-10-14T06:05:00.000Z'
const T2 = '2026-10-14T06:10:00.000Z'

describe('isAtLeastAsNew', () => {
  it('true when equal or newer, false when older', () => {
    expect(isAtLeastAsNew(T2, T1)).toBe(true)
    expect(isAtLeastAsNew(T1, T1)).toBe(true)
    expect(isAtLeastAsNew(T0, T1)).toBe(false)
  })
  it('false for missing values (never claim without evidence)', () => {
    expect(isAtLeastAsNew(null, T1)).toBe(false)
    expect(isAtLeastAsNew(T1, null)).toBe(false)
    expect(isAtLeastAsNew(undefined, undefined)).toBe(false)
  })
})

describe('shouldClearOverflowWarningOnSync', () => {
  it('clears when the confirmed sync covered the warned edit or a later one', () => {
    expect(shouldClearOverflowWarningOnSync(T1, T1)).toBe(true)
    expect(shouldClearOverflowWarningOnSync(T1, T2)).toBe(true)
  })
  it('does NOT clear when an older in-flight sync completes for an earlier snapshot', () => {
    // Warning raised for edit at T2; a sync that pushed the T1 snapshot finishes later.
    expect(shouldClearOverflowWarningOnSync(T2, T1)).toBe(false)
  })
  it('does nothing when there is no pending warning', () => {
    expect(shouldClearOverflowWarningOnSync(null, T2)).toBe(false)
  })
})

describe('shouldMarkDurableOnPersist', () => {
  it('upgrades to durable when the IDB mirror confirmed the warned edit or later', () => {
    expect(shouldMarkDurableOnPersist(T1, T1)).toBe(true)
    expect(shouldMarkDurableOnPersist(T1, T2)).toBe(true)
  })
  it('does NOT upgrade on a stale persist confirmation for an earlier edit', () => {
    expect(shouldMarkDurableOnPersist(T2, T1)).toBe(false)
  })
  it('does nothing when there is no pending warning', () => {
    expect(shouldMarkDurableOnPersist(null, T1)).toBe(false)
  })
})
