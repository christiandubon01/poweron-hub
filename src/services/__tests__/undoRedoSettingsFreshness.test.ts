import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const store = vi.hoisted(() => ({ current: null as any }))

vi.mock('@/services/backupDataService', () => ({
  getBackupData: vi.fn(() => store.current),
  saveBackupData: vi.fn((data) => {
    store.current = JSON.parse(JSON.stringify(data))
  }),
}))

import { initializeUndoRedo, pushState, redo, undo } from '@/services/undoRedoService'

const OLD = '2026-08-01T12:00:00.000Z'
const CURRENT = '2026-08-02T12:00:00.000Z'
const UNDO_TIME = '2026-08-03T12:00:00.000Z'
const REDO_TIME = '2026-08-04T12:00:00.000Z'

function backup(settings: Record<string, unknown>, projects: unknown[] = []) {
  return {
    version: '15.0',
    timestamp: OLD,
    settings,
    projects,
  }
}

describe('undo/redo settings freshness', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(CURRENT))
    store.current = null
    initializeUndoRedo()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('stamps undo and redo scalar changes at the time of each action', () => {
    store.current = backup({
      tax: 0.08,
      dayTarget: 4000,
      fieldUpdatedAt: { tax: OLD, dayTarget: OLD },
      fieldDeletedAt: {},
    })
    pushState()

    store.current = backup({
      tax: 0.09,
      dayTarget: 4000,
      fieldUpdatedAt: { tax: CURRENT, dayTarget: OLD },
      fieldDeletedAt: {},
    })

    vi.setSystemTime(new Date(UNDO_TIME))
    expect(undo()).toBe(true)
    expect(store.current.settings.tax).toBe(0.08)
    expect(store.current.settings.fieldUpdatedAt).toEqual({ tax: UNDO_TIME, dayTarget: OLD })

    vi.setSystemTime(new Date(REDO_TIME))
    expect(redo()).toBe(true)
    expect(store.current.settings.tax).toBe(0.09)
    expect(store.current.settings.fieldUpdatedAt).toEqual({ tax: REDO_TIME, dayTarget: OLD })
  })

  it('writes a current deletion tombstone when undo removes a top-level setting', () => {
    store.current = backup({
      dayTarget: 4000,
      fieldUpdatedAt: { dayTarget: OLD },
      fieldDeletedAt: {},
    })
    pushState()

    store.current = backup({
      company: 'Power On',
      dayTarget: 4000,
      fieldUpdatedAt: { company: CURRENT, dayTarget: OLD },
      fieldDeletedAt: {},
    })

    vi.setSystemTime(new Date(UNDO_TIME))
    expect(undo()).toBe(true)
    expect(store.current.settings).not.toHaveProperty('company')
    expect(store.current.settings.fieldUpdatedAt).toEqual({ dayTarget: OLD })
    expect(store.current.settings.fieldDeletedAt).toEqual({ company: UNDO_TIME })
  })

  it('does not refresh settings metadata when undo changes only non-settings data', () => {
    store.current = backup({
      overhead: { rent: 1000, insurance: 250 },
      fieldUpdatedAt: { overhead: CURRENT },
      fieldDeletedAt: {},
    }, [{ id: 'project-1', name: 'Before' }])
    pushState()

    store.current = backup({
      overhead: { insurance: 250, rent: 1000 },
      fieldUpdatedAt: { overhead: CURRENT },
      fieldDeletedAt: {},
    }, [{ id: 'project-1', name: 'After' }])

    vi.setSystemTime(new Date(UNDO_TIME))
    expect(undo()).toBe(true)
    expect(store.current.projects[0].name).toBe('Before')
    expect(store.current.settings.fieldUpdatedAt).toEqual({ overhead: CURRENT })
    expect(store.current.settings.fieldDeletedAt).toEqual({})

    vi.setSystemTime(new Date(REDO_TIME))
    expect(redo()).toBe(true)
    expect(store.current.projects[0].name).toBe('After')
    expect(store.current.settings.fieldUpdatedAt).toEqual({ overhead: CURRENT })
    expect(store.current.settings.fieldDeletedAt).toEqual({})
  })
})
