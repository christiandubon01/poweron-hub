import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { importBackupFromFile } from '@/services/backupDataService'
import {
  mergeSettingsByField,
  prepareSettingsForExplicitReplacement,
  stampSettingsFields,
} from '@/services/settingsScopeMerge'

const OLD = '2026-08-01T12:00:00.000Z'
const CURRENT = '2026-08-02T12:00:00.000Z'
const NOW = '2026-08-03T12:00:00.000Z'

class MemoryStorage implements Storage {
  private readonly data = new Map<string, string>()

  get length() { return this.data.size }
  clear() { this.data.clear() }
  getItem(key: string) { return this.data.get(key) ?? null }
  key(index: number) { return [...this.data.keys()][index] ?? null }
  removeItem(key: string) { this.data.delete(key) }
  setItem(key: string, value: string) { this.data.set(key, String(value)) }
}

function backupWithSettings(settings: Record<string, unknown>) {
  return {
    version: '15.0',
    timestamp: OLD,
    settings,
    projects: [],
    customers: [],
    changeOrders: [],
    activities: [],
    employees: [],
    tasks: [],
    timeEntries: [],
    invoices: [],
    expenses: [],
    estimates: [],
    opportunities: [],
  }
}

describe('SYNC-02B settings writer coverage', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(NOW))
    vi.stubGlobal('localStorage', new MemoryStorage())
    vi.stubGlobal('window', { dispatchEvent: vi.fn() })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('Team billable-hours writer stamps the field and uses settings-scoped persistence', () => {
    const teamPanelPath = fileURLToPath(new URL('../../components/v15r/V15rTeamPanel.tsx', import.meta.url))
    const source = readFileSync(teamPanelPath, 'utf8')

    expect(source).toMatch(
      /billableHrsYear\s*=\s*num\(e\.target\.value\)[\s\S]*?stampSettingsFields\(backup\.settings, \['billableHrsYear'\]\)[\s\S]*?saveBackupDataAndSync\(backup, 'settings'\)/,
    )
  })

  it('preserves an unrelated newer remote setting alongside a Team billable-hours edit', () => {
    const local = {
      mileRate: 0.65,
      billableHrsYear: 1800,
      fieldUpdatedAt: { mileRate: OLD, billableHrsYear: OLD },
      fieldDeletedAt: {},
    }
    stampSettingsFields(local, ['billableHrsYear'], NOW)

    const merged = mergeSettingsByField(local, {
      mileRate: 0.75,
      billableHrsYear: 1700,
      fieldUpdatedAt: { mileRate: CURRENT, billableHrsYear: OLD },
      fieldDeletedAt: {},
    })

    expect(merged.mileRate).toBe(0.75)
    expect(merged.billableHrsYear).toBe(1800)
    expect(merged.fieldUpdatedAt).toEqual({ mileRate: CURRENT, billableHrsYear: NOW })
  })

  it('restores changed scalar and grouped values with new timestamps while preserving unrelated freshness', () => {
    const restored = prepareSettingsForExplicitReplacement(
      {
        tax: 0.08,
        phaseWeights: { rough: 40, trim: 60 },
        dayTarget: 4000,
        fieldUpdatedAt: { tax: CURRENT, phaseWeights: CURRENT, dayTarget: OLD },
        fieldDeletedAt: {},
      },
      {
        tax: 0.09,
        phaseWeights: { rough: 50, trim: 50 },
        dayTarget: 4000,
        fieldUpdatedAt: { tax: OLD, phaseWeights: OLD, dayTarget: OLD },
        fieldDeletedAt: { tax: '2099-01-01T00:00:00.000Z' },
      },
      NOW,
    )

    expect(restored.tax).toBe(0.09)
    expect(restored.phaseWeights).toEqual({ rough: 50, trim: 50 })
    expect(restored.fieldUpdatedAt).toEqual({ tax: NOW, phaseWeights: NOW, dayTarget: OLD })
    expect(restored.fieldDeletedAt).toEqual({})
  })

  it('wires the active SnapshotPanel restore path through explicit replacement freshness', () => {
    const snapshotPanelPath = fileURLToPath(new URL('../../components/SnapshotPanel.tsx', import.meta.url))
    const source = readFileSync(snapshotPanelPath, 'utf8')

    expect(source).toMatch(
      /const currentData = getBackupData\(\)[\s\S]*?const restorePayload = getSnapshotRestorePayload[\s\S]*?restorePayload\.settings = prepareSettingsForExplicitReplacement\([\s\S]*?currentData[\s\S]*?restorePayload\.settings[\s\S]*?saveBackupDataAndSync\(restorePayload as any, 'snapshotRestore'\)/,
    )
  })

  it('creates a current tombstone when a snapshot-style replacement removes a field', () => {
    const restored = prepareSettingsForExplicitReplacement(
      {
        company: 'Power On',
        dayTarget: 4000,
        fieldUpdatedAt: { company: CURRENT, dayTarget: OLD },
        fieldDeletedAt: {},
      },
      {
        dayTarget: 4000,
        fieldUpdatedAt: { company: OLD, dayTarget: OLD },
        fieldDeletedAt: { company: OLD },
      },
      NOW,
    )

    expect(restored).not.toHaveProperty('company')
    expect(restored.fieldUpdatedAt).toEqual({ dayTarget: OLD })
    expect(restored.fieldDeletedAt).toEqual({ company: NOW })
  })

  it('does not restamp an equivalent settings replacement', () => {
    const restored = prepareSettingsForExplicitReplacement(
      {
        overhead: { rent: 1000, insurance: 250 },
        phaseWeights: ['rough', 'trim'],
        fieldUpdatedAt: { overhead: CURRENT, phaseWeights: CURRENT },
        fieldDeletedAt: {},
      },
      {
        overhead: { insurance: 250, rent: 1000 },
        phaseWeights: ['rough', 'trim'],
        fieldUpdatedAt: { overhead: OLD, phaseWeights: OLD },
        fieldDeletedAt: {},
      },
      NOW,
    )

    expect(restored.fieldUpdatedAt).toEqual({ overhead: CURRENT, phaseWeights: CURRENT })
    expect(restored.fieldDeletedAt).toEqual({})
  })

  it('adopts a missing imported setting at import time and ignores imported metadata', async () => {
    localStorage.setItem('poweron_backup_data', JSON.stringify(backupWithSettings({
      company: 'Current Company',
      fieldUpdatedAt: { company: CURRENT },
      fieldDeletedAt: {},
    })))

    const file = {
      text: async () => JSON.stringify({
        settings: {
          mileRate: 0.75,
          fieldUpdatedAt: { mileRate: OLD, company: OLD },
          fieldDeletedAt: { company: '2099-01-01T00:00:00.000Z' },
        },
      }),
    } as File

    const result = await importBackupFromFile(file)

    expect(result.data.settings.company).toBe('Current Company')
    expect(result.data.settings.mileRate).toBe(0.75)
    expect(result.data.settings.fieldUpdatedAt).toEqual({ company: CURRENT, mileRate: NOW })
    expect(result.data.settings.fieldDeletedAt).toEqual({})
  })

  it('leaves an existing setting and its freshness untouched during additive import', async () => {
    localStorage.setItem('poweron_backup_data', JSON.stringify(backupWithSettings({
      company: 'Current Company',
      fieldUpdatedAt: { company: CURRENT },
      fieldDeletedAt: {},
    })))

    const file = {
      text: async () => JSON.stringify({
        settings: {
          company: 'Imported Company',
          fieldUpdatedAt: { company: '2099-01-01T00:00:00.000Z' },
          fieldDeletedAt: { company: '2099-01-01T00:00:00.000Z' },
        },
      }),
    } as File

    const result = await importBackupFromFile(file)

    expect(result.data.settings.company).toBe('Current Company')
    expect(result.data.settings.fieldUpdatedAt).toEqual({ company: CURRENT })
    expect(result.data.settings.fieldDeletedAt).toEqual({})
  })
})
