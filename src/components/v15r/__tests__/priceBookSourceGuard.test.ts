import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearActiveTenantUser,
  getBackupData,
  markTenantDataReady,
  setActiveTenantUser,
} from '@/services/backupDataService'
import {
  getPriceBookSource,
  persistPriceBookBackup,
} from '@/components/v15r/V15rPriceBookPanel'

class MemoryStorage {
  private store = new Map<string, string>()

  getItem(key: string) {
    return this.store.has(key) ? this.store.get(key)! : null
  }

  setItem(key: string, value: string) {
    this.store.set(key, String(value))
  }

  removeItem(key: string) {
    this.store.delete(key)
  }

  clear() {
    this.store.clear()
  }

  key(index: number) {
    return Array.from(this.store.keys())[index] ?? null
  }

  get length() {
    return this.store.size
  }
}

const backupWithPriceBook = (id: string, name: string) => ({
  projects: [],
  logs: [],
  serviceLogs: [],
  settings: { markup: 30 },
  priceBook: [{ id, name, cat: 'Materials', cost: 1 }],
  weeklyData: [],
})

describe('Price Book authenticated source guard', () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: new MemoryStorage() })
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        dispatchEvent: vi.fn(),
      },
    })
    clearActiveTenantUser()
  })

  it('uses tenant BackupData instead of stale poweron_v2 when authenticated', () => {
    const userId = 'tenant-user'
    setActiveTenantUser(userId)
    markTenantDataReady(userId)

    localStorage.setItem('poweron_backup_data_tenant-user', JSON.stringify(backupWithPriceBook('tenant-item', 'Tenant Item')))
    localStorage.setItem('poweron_v2', JSON.stringify(backupWithPriceBook('stale-item', 'Stale Global Item')))

    const source = getPriceBookSource()

    expect(source.source).toBe('tenant_backup_data')
    expect(source.priceBookItems.map(item => item.id)).toEqual(['tenant-item'])
  })

  it('does not promote stale poweron_v2 into an authenticated tenant with no cache', () => {
    const userId = 'tenant-user'
    setActiveTenantUser(userId)
    markTenantDataReady(userId)
    localStorage.setItem('poweron_v2', JSON.stringify(backupWithPriceBook('stale-item', 'Stale Global Item')))

    const source = getPriceBookSource()

    expect(source).toMatchObject({ backup: null, priceBookItems: [], source: 'none' })
    expect(getBackupData(userId)).toBeNull()
    expect(localStorage.getItem('poweron_backup_data_tenant-user')).toBeNull()
  })

  it('persists authenticated Price Book edits through the tenant key and does not write poweron_v2', () => {
    const userId = 'tenant-user'
    setActiveTenantUser(userId)
    markTenantDataReady(userId)
    localStorage.setItem('poweron_v2', JSON.stringify(backupWithPriceBook('stale-item', 'Stale Global Item')))

    persistPriceBookBackup(backupWithPriceBook('saved-item', 'Saved Tenant Item') as any)

    const tenantRaw = localStorage.getItem('poweron_backup_data_tenant-user')
    expect(tenantRaw).not.toBeNull()
    expect(JSON.parse(tenantRaw!).priceBook.map((item: any) => item.id)).toEqual(['saved-item'])
    expect(JSON.parse(localStorage.getItem('poweron_v2')!).priceBook.map((item: any) => item.id)).toEqual(['stale-item'])
  })

  it('keeps unauthenticated legacy fallback available through the central BackupData API', () => {
    localStorage.setItem('poweron_v2', JSON.stringify(backupWithPriceBook('legacy-item', 'Legacy Item')))

    const source = getPriceBookSource()

    expect(source.source).toBe('poweron_backup_data')
    expect(source.priceBookItems.map(item => item.id)).toEqual(['legacy-item'])
  })
})
