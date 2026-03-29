// @ts-nocheck
/**
 * V15rSettingsPanel — Comprehensive settings with 10 sections
 *
 * Sections:
 * 1. General / Business Identity
 * 2. Overhead Manager (4 sections)
 * 3. Phase Weights Editor
 * 4. Google Calendar URL
 * 5. AI Agent Settings
 * 6. Data & Sync Status
 * 7. Snapshot Manager
 * 8. Undo/Redo Configuration
 * 9. Export/Import
 * 10. MTO Phases
 */

import { useCallback, useMemo, useState, useRef, useEffect } from 'react'
import { Settings, Download, Upload, RotateCcw, Save, Trash2, AlertCircle, Sparkles, FileText, Check, X, Loader2, Moon, Sun, Image } from 'lucide-react'
import { getBackupData, saveBackupData, exportBackup, importBackupFromFile, isSupabaseConfigured, forceSyncToCloud, num, fmt, fmtK, pct, getProjectFinancials, getSnapshots, createSnapshot, restoreSnapshot, type BackupSettings, type BackupData, type DataSnapshot } from '@/services/backupDataService'
import { pushState, clear as clearHistory, setMaxHistoryDepth } from '@/services/undoRedoService'
import { extractFromPDF, mapToServiceLog, mapToProject, logImport, processBatch, type QBBatchItem, type QBExtractedData } from '@/services/quickbooksImportService'
import { VoiceSettings } from '@/components/voice/VoiceSettings'

function NoData() {
  return (
    <div className="flex items-center justify-center min-h-screen" style={{ backgroundColor: 'var(--bg-secondary)' }}>
      <div className="text-center">
        <p className="text-gray-400 text-lg">No backup data available</p>
        <p className="text-gray-600 text-sm mt-2">Import a backup to get started</p>
      </div>
    </div>
  )
}

function SettingCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border p-6" style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-secondary)' }}>
      <h2 className="text-lg font-bold mb-4" style={{ color: 'var(--text-primary)' }}>{title}</h2>
      {children}
    </div>
  )
}

export default function V15rSettingsPanel() {
  const backup = getBackupData()
  if (!backup) return <NoData />

  const [, setTick] = useState(0)
  const forceUpdate = useCallback(() => setTick(t => t + 1), [])

  const persist = useCallback(() => {
    const data = getBackupData()
    if (data) {
      pushState(data)
      data._lastSavedAt = new Date().toISOString()
      saveBackupData(data)
      forceUpdate()
    }
  }, [forceUpdate])

  const settings = backup.settings || {} as any

  const snapshots = useMemo(() => {
    if (!backup) return []
    try {
      const snaps = (backup as any).snapshots || {}
      return Object.entries(snaps).map(([name, data]: any) => ({
        id: name,
        name,
        date: data.timestamp || new Date().toISOString(),
        size: JSON.stringify(data.data || {}).length,
        data: JSON.stringify(data.data || {})
      }))
    } catch {
      return []
    }
  }, [backup])

  // Version History state
  const [versionSnapshots, setVersionSnapshots] = useState<DataSnapshot[]>([])
  const [showRestoreConfirm, setShowRestoreConfirm] = useState<string | null>(null)
  const [snapshotName, setSnapshotName] = useState('')

  // Load snapshots on mount
  useEffect(() => {
    setVersionSnapshots(getSnapshots())
  }, [])

  const handleSaveSnapshot = useCallback(() => {
    const name = prompt('Snapshot name:', new Date().toLocaleString())
    if (!name) return

    const data = getBackupData()
    if (!data) return

    // Store in backup.snapshots deep clone
    pushState(data)
    if (!(data as any).snapshots) (data as any).snapshots = {}
    const deepClone = JSON.parse(JSON.stringify(data))
    ;(data as any).snapshots[name] = {
      timestamp: new Date().toISOString(),
      data: deepClone
    }
    persist()
    alert(`Snapshot "${name}" saved ✓`)
  }, [persist])

  const handleRestoreSnapshot = useCallback((snap: any) => {
    if (!window.confirm(`Restore snapshot "${snap.name}"? Current state will be saved first.`)) return
    try {
      pushState(backup)
      const restored = JSON.parse(snap.data)
      saveBackupData(restored)
      forceUpdate()
      alert('Snapshot restored ✓')
    } catch (e) {
      alert('Failed to restore snapshot')
    }
  }, [backup, forceUpdate])

  const handleDeleteSnapshot = useCallback((snapId: string) => {
    if (!window.confirm('Delete this snapshot? Cannot be undone.')) return
    const data = getBackupData()
    if (data && (data as any).snapshots) {
      pushState(data)
      delete (data as any).snapshots[snapId]
      persist()
    }
  }, [persist])

  const handleExportBackup = useCallback(() => {
    const data = getBackupData()
    if (data) {
      pushState(data)
      exportBackup(data)
    }
  }, [])

  const handleImportBackup = useCallback(async () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json'
    input.onchange = async (e: any) => {
      const file = e.target.files?.[0]
      if (!file) return
      try {
        const { data, summary } = await importBackupFromFile(file)
        forceUpdate()
        const parts = Object.entries(summary.merged).map(([k, v]) => `${v} ${k}`).join(', ')
        alert(summary.total > 0 ? `Merged: ${parts} — existing data preserved ✓` : 'Import complete — no new records found (all duplicates)')
      } catch {
        alert('Failed to import backup')
      }
    }
    input.click()
  }, [forceUpdate])

  const handleResetDefaults = useCallback(() => {
    if (!window.confirm('Reset all settings to defaults? Cannot be undone.')) return
    if (!window.confirm('Really? This will reset EVERYTHING.')) return

    const data = getBackupData()
    if (data) {
      pushState(data)
      data.settings = {
        company: 'My Company',
        license: '',
        billRate: 95,
        defaultOHRate: 55,
        markup: 50,
        tax: 8.75,
        wasteDefault: 10,
        mileRate: 0.66,
        dayTarget: 361,
        amBlock: 420,
        pmBlock: 260,
        opCost: 42.45,
        salaryTarget: 12000,
        billableHrsYear: 936,
        annualTarget: 120000,
        phaseWeights: { Estimating: 5, Planning: 10, 'Site Prep': 15, 'Rough-in': 35, Finish: 25, Trim: 10 },
        mtoPhases: ['Underground', 'Rough In', 'Trim', 'Finish'],
        overhead: { essential: [], extra: [], loans: [], vehicle: [] },
        gcalUrl: '',
      } as any
      persist()
      alert('Settings reset ✓')
    }
  }, [persist])

  const phaseWeights = settings.phaseWeights || {}
  const mtoPhases = settings.mtoPhases || ['Underground', 'Rough In', 'Trim', 'Finish']
  const overhead = settings.overhead || { essential: [], extra: [], loans: [], vehicle: [] }

  // Calculate overhead totals
  const calcOverhead = () => {
    let monthlyTotal = 0
    Object.values(overhead).forEach((section: any) => {
      monthlyTotal += (section || []).reduce((s: number, item: any) => s + num(item.monthly || 0), 0)
    })
    const annualTotal = monthlyTotal * 12
    const billableHrs = num(settings.billableHrsYear || 936)
    const costPerHr = billableHrs > 0 ? annualTotal / billableHrs : 0
    return { monthlyTotal, annualTotal, costPerHr }
  }
  const overheadCalc = calcOverhead()

  const lastSync = backup._lastSavedAt ? new Date(backup._lastSavedAt).toLocaleString() : 'Never'
  const supabaseUp = isSupabaseConfigured()

  const phaseWeightTotal = Object.values(phaseWeights).reduce((s: number, v: any) => s + num(v), 0)

  // Theme handling
  const currentTheme = settings.theme || 'dark'
  const handleThemeToggle = useCallback(() => {
    const data = getBackupData()
    if (data) {
      pushState(data)
      const newTheme = currentTheme === 'dark' ? 'light' : 'dark'
      data.settings.theme = newTheme
      saveBackupData(data)
      // Apply theme class to document root for Tailwind dark: utilities
      const root = document.documentElement
      if (newTheme === 'dark') {
        root.classList.add('dark')
        root.classList.remove('light')
        root.setAttribute('data-theme', 'dark')
        document.body.classList.remove('lt')
      } else {
        root.classList.remove('dark')
        root.classList.add('light')
        root.setAttribute('data-theme', 'light')
        document.body.classList.add('lt')
      }
      // Save to dedicated key for fast inline-script access on next load
      localStorage.setItem('poweron_theme', newTheme)
      forceUpdate()
    }
  }, [currentTheme, forceUpdate])

  // Logo upload handlers
  const handleLogoUpload = useCallback((type: 'dark' | 'light', file: File) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      const base64 = e.target?.result as string
      const data = getBackupData()
      if (data) {
        pushState(data)
        if (type === 'dark') {
          data.settings.logoDark = base64
        } else {
          data.settings.logoLight = base64
        }
        saveBackupData(data)
        forceUpdate()
      }
    }
    reader.readAsDataURL(file)
  }, [forceUpdate])

  return (
    <div className="min-h-screen p-6 space-y-6" style={{ backgroundColor: 'var(--bg-secondary)' }}>
      {/* HEADER */}
      <div className="flex items-center gap-3 mb-8">
        <Settings size={32} className="text-blue-400" />
        <div>
          <h1 className="text-3xl font-bold text-gray-100">Settings Hub</h1>
          <p className="text-gray-500 text-sm mt-1">Business identity, overhead, sync, and configuration</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">

          {/* 0. THEME & BRANDING */}
          <SettingCard title="Theme & Branding">
            <div className="space-y-4">
              {/* Theme Toggle */}
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase mb-3">Light/Dark Theme</label>
                <button
                  onClick={handleThemeToggle}
                  className={`flex items-center gap-3 px-4 py-2 rounded font-medium transition-colors ${
                    currentTheme === 'dark'
                      ? 'bg-gray-800 text-gray-100 border border-gray-700'
                      : 'bg-blue-900/30 text-blue-300 border border-blue-700'
                  }`}
                >
                  {currentTheme === 'dark' ? (
                    <>
                      <Moon size={18} />
                      Dark Theme
                    </>
                  ) : (
                    <>
                      <Sun size={18} />
                      Light Theme
                    </>
                  )}
                </button>
              </div>

              {/* Dark Logo Upload */}
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase mb-2">Dark Logo (Base64)</label>
                <div className="flex flex-col gap-2">
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      if (file) handleLogoUpload('dark', file)
                    }}
                    className="block w-full text-sm text-gray-400 file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:text-sm file:font-semibold file:bg-blue-900 file:text-blue-300 hover:file:bg-blue-800"
                  />
                  {settings.logoDark && (
                    <div className="flex items-center gap-3 p-3 bg-gray-900 rounded border border-gray-700">
                      <Image size={16} className="text-gray-400" />
                      <span className="text-xs text-gray-400 truncate">Dark logo uploaded</span>
                      <img src={settings.logoDark} alt="Dark logo" className="h-8 object-contain ml-auto" />
                    </div>
                  )}
                </div>
              </div>

              {/* Light Logo Upload */}
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase mb-2">Light Logo (Base64)</label>
                <div className="flex flex-col gap-2">
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      if (file) handleLogoUpload('light', file)
                    }}
                    className="block w-full text-sm text-gray-400 file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:text-sm file:font-semibold file:bg-blue-900 file:text-blue-300 hover:file:bg-blue-800"
                  />
                  {settings.logoLight && (
                    <div className="flex items-center gap-3 p-3 bg-gray-900 rounded border border-gray-700">
                      <Image size={16} className="text-gray-400" />
                      <span className="text-xs text-gray-400 truncate">Light logo uploaded</span>
                      <img src={settings.logoLight} alt="Light logo" className="h-8 object-contain ml-auto" />
                    </div>
                  )}
                </div>
              </div>
            </div>
          </SettingCard>

          {/* 1. GENERAL / BUSINESS IDENTITY */}
          <SettingCard title="General / Business Identity">
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase mb-2">Company Name</label>
                <input
                  type="text"
                  value={settings.company || ''}
                  onChange={(e) => {
                    const data = getBackupData()
                    if (data) {
                      pushState(data)
                      data.settings.company = e.target.value
                      persist()
                    }
                  }}
                  className="w-full px-3 py-2 border rounded text-sm focus:border-blue-500 focus:outline-none theme-input"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase mb-2">Owner Name</label>
                <input
                  type="text"
                  value={settings.ownerName || ''}
                  onChange={(e) => {
                    const data = getBackupData()
                    if (data) {
                      pushState(data)
                      data.settings.ownerName = e.target.value
                      persist()
                    }
                  }}
                  className="w-full px-3 py-2 border rounded text-sm focus:border-blue-500 focus:outline-none theme-input"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase mb-2">License</label>
                <input
                  type="text"
                  value={settings.license || ''}
                  onChange={(e) => {
                    const data = getBackupData()
                    if (data) {
                      pushState(data)
                      data.settings.license = e.target.value
                      persist()
                    }
                  }}
                  className="w-full px-3 py-2 border rounded text-sm focus:border-blue-500 focus:outline-none theme-input"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase mb-2">Labor Rate ($/hr)</label>
                  <input
                    type="number"
                    value={settings.billRate || 95}
                    onChange={(e) => {
                      const data = getBackupData()
                      if (data) {
                        pushState(data)
                        data.settings.billRate = parseFloat(e.target.value) || 95
                        persist()
                      }
                    }}
                    className="w-full px-3 py-2 border rounded text-sm theme-input"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase mb-2">OH Rate ($/hr)</label>
                  <input
                    type="number"
                    value={settings.defaultOHRate || 55}
                    onChange={(e) => {
                      const data = getBackupData()
                      if (data) {
                        pushState(data)
                        data.settings.defaultOHRate = parseFloat(e.target.value) || 55
                        persist()
                      }
                    }}
                    className="w-full px-3 py-2 border rounded text-sm theme-input"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase mb-2">Mile Rate ($/mi)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={settings.mileRate || 0.66}
                    onChange={(e) => {
                      const data = getBackupData()
                      if (data) {
                        pushState(data)
                        data.settings.mileRate = parseFloat(e.target.value) || 0.66
                        persist()
                      }
                    }}
                    className="w-full px-3 py-2 border rounded text-sm theme-input"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase mb-2">Markup %</label>
                  <input
                    type="number"
                    value={settings.markup || 50}
                    onChange={(e) => {
                      const data = getBackupData()
                      if (data) {
                        pushState(data)
                        data.settings.markup = parseFloat(e.target.value) || 50
                        persist()
                      }
                    }}
                    className="w-full px-3 py-2 border rounded text-sm theme-input"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase mb-2">Tax %</label>
                  <input
                    type="number"
                    step="0.01"
                    value={settings.tax || 8.75}
                    onChange={(e) => {
                      const data = getBackupData()
                      if (data) {
                        pushState(data)
                        data.settings.tax = parseFloat(e.target.value) || 8.75
                        persist()
                      }
                    }}
                    className="w-full px-3 py-2 border rounded text-sm theme-input"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase mb-2">Waste %</label>
                  <input
                    type="number"
                    value={settings.wasteDefault || 10}
                    onChange={(e) => {
                      const data = getBackupData()
                      if (data) {
                        pushState(data)
                        data.settings.wasteDefault = parseFloat(e.target.value) || 10
                        persist()
                      }
                    }}
                    className="w-full px-3 py-2 border rounded text-sm theme-input"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase mb-2">Daily Target ($)</label>
                  <input
                    type="number"
                    value={settings.dayTarget || 361}
                    onChange={(e) => {
                      const data = getBackupData()
                      if (data) {
                        pushState(data)
                        data.settings.dayTarget = parseFloat(e.target.value) || 361
                        persist()
                      }
                    }}
                    className="w-full px-3 py-2 border rounded text-sm theme-input"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase mb-2">Billable Hrs/Yr</label>
                  <input
                    type="number"
                    value={settings.billableHrsYear || 936}
                    onChange={(e) => {
                      const data = getBackupData()
                      if (data) {
                        pushState(data)
                        data.settings.billableHrsYear = parseFloat(e.target.value) || 936
                        persist()
                      }
                    }}
                    className="w-full px-3 py-2 border rounded text-sm theme-input"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase mb-2">AM Block (min)</label>
                  <input
                    type="number"
                    value={settings.amBlock || 420}
                    onChange={(e) => {
                      const data = getBackupData()
                      if (data) {
                        pushState(data)
                        data.settings.amBlock = parseFloat(e.target.value) || 420
                        persist()
                      }
                    }}
                    className="w-full px-3 py-2 border rounded text-sm theme-input"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase mb-2">PM Block (min)</label>
                  <input
                    type="number"
                    value={settings.pmBlock || 260}
                    onChange={(e) => {
                      const data = getBackupData()
                      if (data) {
                        pushState(data)
                        data.settings.pmBlock = parseFloat(e.target.value) || 260
                        persist()
                      }
                    }}
                    className="w-full px-3 py-2 border rounded text-sm theme-input"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase mb-2">Salary Target ($/yr)</label>
                <input
                  type="number"
                  value={settings.salaryTarget || 12000}
                  onChange={(e) => {
                    const data = getBackupData()
                    if (data) {
                      pushState(data)
                      data.settings.salaryTarget = parseFloat(e.target.value) || 12000
                      persist()
                    }
                  }}
                  className="w-full px-3 py-2 border rounded text-sm theme-input"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase mb-2">Annual Revenue Target ($)</label>
                <input
                  type="number"
                  value={settings.annualTarget || 120000}
                  onChange={(e) => {
                    const data = getBackupData()
                    if (data) {
                      pushState(data)
                      data.settings.annualTarget = parseFloat(e.target.value) || 120000
                      persist()
                    }
                  }}
                  className="w-full px-3 py-2 border rounded text-sm theme-input"
                />
              </div>

              {(() => {
                const currentYear = new Date().getFullYear()
                const ytdRevenue = (backup.projects || []).reduce((sum, p) => {
                  const paidAmount = num(getProjectFinancials(p, backup).paid)
                  return sum + paidAmount
                }, 0) + (backup.serviceLogs || []).reduce((sum, log) => {
                  const logDate = new Date(log.date || '')
                  if (logDate.getFullYear() === currentYear) {
                    return sum + num(log.collected)
                  }
                  return sum
                }, 0)
                const annualTarget = num(settings.annualTarget || 120000)
                const ytdPct = annualTarget > 0 ? Math.min(100, Math.round((ytdRevenue / annualTarget) * 100)) : 0

                return (
                  <div className="space-y-3">
                    <div>
                      <label className="block text-xs font-semibold text-gray-500 uppercase mb-2">YTD Revenue</label>
                      <div className="w-full px-3 py-2 border rounded text-sm theme-input">
                        ${(ytdRevenue / 1000).toFixed(1)}k
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-gray-500 uppercase mb-2">Progress to Target</label>
                      <div className="w-full flex items-center gap-2 rounded p-3 border" style={{ backgroundColor: 'var(--bg-input)', borderColor: 'var(--border-secondary)' }}>
                        <div className="flex-1 h-3 bg-gray-700 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-gradient-to-r from-green-500 to-blue-500 transition-all"
                            style={{ width: `${ytdPct}%` }}
                          />
                        </div>
                        <span className="text-sm font-semibold text-gray-300 w-12 text-right">{ytdPct}%</span>
                      </div>
                    </div>
                  </div>
                )
              })()}

              {(() => {
                const personalIncomeGoal = num(settings.personalIncomeGoal || 0)
                const overheadPct = num(settings.overheadPct || 30)
                const currentYear = new Date().getFullYear()
                const now = new Date()
                const monthsElapsed = now.getMonth() + 1 + (now.getFullYear() - currentYear) * 12

                const totalPaidYTD = (backup.projects || []).reduce((sum, p) => {
                  const paidAmount = num(getProjectFinancials(p, backup).paid)
                  return sum + paidAmount
                }, 0) + (backup.serviceLogs || []).reduce((sum, log) => {
                  const logDate = new Date(log.date || '')
                  if (logDate.getFullYear() === currentYear) {
                    return sum + num(log.collected)
                  }
                  return sum
                }, 0)

                const requiredMonthlyRevenue = personalIncomeGoal > 0 ? personalIncomeGoal / (1 - overheadPct / 100) / 12 : 0
                const currentMonthlyPace = monthsElapsed > 0 ? totalPaidYTD / monthsElapsed : 0
                const isOnPace = currentMonthlyPace >= requiredMonthlyRevenue && personalIncomeGoal > 0

                return (
                  <div className="space-y-3 mt-4 pt-4 border-t border-gray-700">
                    <h3 className="text-sm font-semibold text-gray-300">Personal Income Goal</h3>

                    <div>
                      <label className="block text-xs font-semibold text-gray-500 uppercase mb-2">Annual Personal Income Goal ($)</label>
                      <input
                        type="number"
                        value={settings.personalIncomeGoal || 0}
                        onChange={(e) => {
                          const data = getBackupData()
                          if (data) {
                            pushState(data)
                            data.settings.personalIncomeGoal = parseFloat(e.target.value) || 0
                            saveBackupData(data)
                            forceUpdate()
                          }
                        }}
                        className="w-full px-3 py-2 border rounded text-sm theme-input"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-gray-500 uppercase mb-2">Overhead %</label>
                      <input
                        type="number"
                        value={settings.overheadPct || 30}
                        onChange={(e) => {
                          const data = getBackupData()
                          if (data) {
                            pushState(data)
                            data.settings.overheadPct = parseFloat(e.target.value) || 30
                            saveBackupData(data)
                            forceUpdate()
                          }
                        }}
                        className="w-full px-3 py-2 border rounded text-sm theme-input"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-gray-500 uppercase mb-2">Required Monthly Revenue</label>
                      <div className="w-full px-3 py-2 border rounded text-sm theme-input">
                        {personalIncomeGoal > 0 ? fmt(requiredMonthlyRevenue) : '—'}
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-gray-500 uppercase mb-2">Current Monthly Pace</label>
                      <div className={`w-full px-3 py-2 border rounded text-sm font-semibold ${isOnPace ? 'bg-green-900/20 border-green-600/30 text-green-300' : 'bg-red-900/20 border-red-600/30 text-red-300'}`}>
                        {monthsElapsed > 0 ? fmt(currentMonthlyPace) : '—'}
                      </div>
                    </div>
                  </div>
                )
              })()}
            </div>
          </SettingCard>

          {/* 2. OVERHEAD MANAGER */}
          <SettingCard title="Overhead Manager">
            <div className="space-y-5">
              <div className="grid grid-cols-4 gap-2 text-xs font-semibold text-gray-400 p-3 rounded" style={{ backgroundColor: 'var(--bg-input)' }}>
                <div>Essential: {fmt(num(Object.values(overhead.essential || []).reduce((s: number, i: any) => s + num(i.monthly), 0)))}</div>
                <div>Extra: {fmt(num(Object.values(overhead.extra || []).reduce((s: number, i: any) => s + num(i.monthly), 0)))}</div>
                <div>Loans: {fmt(num(Object.values(overhead.loans || []).reduce((s: number, i: any) => s + num(i.monthly), 0)))}</div>
                <div>Vehicle: {fmt(num(Object.values(overhead.vehicle || []).reduce((s: number, i: any) => s + num(i.monthly), 0)))}</div>
              </div>

              <div className="text-sm text-gray-300 bg-blue-900/20 border border-blue-700/30 p-3 rounded">
                Monthly: <span className="font-bold text-blue-300">{fmt(overheadCalc.monthlyTotal)}</span> | Annual: <span className="font-bold text-blue-300">{fmt(overheadCalc.annualTotal)}</span> | Real Cost/Hr: <span className="font-bold text-blue-300">{fmt(overheadCalc.costPerHr)}</span>
              </div>

              {(['essential', 'extra', 'loans', 'vehicle'] as const).map((key) => (
                <div key={key} className="rounded p-3 border" style={{ backgroundColor: 'var(--bg-input)', borderColor: 'var(--border-secondary)' }}>
                  <div className="flex justify-between items-center mb-3">
                    <h3 className="font-semibold text-gray-200 capitalize">{key}</h3>
                    <button
                      onClick={() => {
                        const name = prompt(`Add ${key} expense:`)
                        if (!name) return
                        const monthly = parseFloat(prompt('Monthly amount ($):', '0') || '0') || 0
                        const data = getBackupData()
                        if (data) {
                          pushState(data)
                          if (!data.settings.overhead) data.settings.overhead = { essential: [], extra: [], loans: [], vehicle: [] }
                          if (!data.settings.overhead[key]) data.settings.overhead[key] = []
                          data.settings.overhead[key].push({ id: Date.now().toString(), name, monthly })
                          persist()
                        }
                      }}
                      className="text-xs px-2 py-1 bg-blue-600/30 text-blue-300 rounded hover:bg-blue-600/40"
                    >
                      + Add
                    </button>
                  </div>
                  <div className="space-y-2 max-h-40 overflow-y-auto">
                    {(overhead[key] || []).map((item: any) => (
                      <div key={item.id} className="flex justify-between items-center text-sm p-2 rounded" style={{ backgroundColor: 'var(--bg-input)' }}>
                        <span className="text-gray-300">{item.name}</span>
                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            step="0.01"
                            value={item.monthly || 0}
                            onChange={(e) => {
                              const data = getBackupData()
                              if (data && data.settings.overhead && data.settings.overhead[key]) {
                                pushState(data)
                                const idx = data.settings.overhead[key].findIndex((x: any) => x.id === item.id)
                                if (idx >= 0) {
                                  data.settings.overhead[key][idx].monthly = parseFloat(e.target.value) || 0
                                  persist()
                                }
                              }
                            }}
                            className="w-20 px-2 py-1 bg-[var(--bg-primary)] border border-gray-600 rounded text-gray-100 text-xs"
                          />
                          <span className="text-gray-400 w-16 text-right">{fmt(num(item.monthly))}</span>
                          <button
                            onClick={() => {
                              const data = getBackupData()
                              if (data && data.settings.overhead && data.settings.overhead[key]) {
                                pushState(data)
                                data.settings.overhead[key] = data.settings.overhead[key].filter((x: any) => x.id !== item.id)
                                persist()
                              }
                            }}
                            className="text-xs text-red-400 hover:text-red-300"
                          >
                            ×
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </SettingCard>

          {/* 3. PHASE WEIGHTS EDITOR */}
          <SettingCard title="Phase Weights Editor">
            <div className="space-y-3">
              {Object.entries(phaseWeights).map(([phase, weight]) => (
                <div key={phase} className="flex items-center gap-3 p-3 rounded" style={{ backgroundColor: 'var(--bg-input)' }}>
                  <div className="w-3 h-3 rounded-full bg-blue-500 flex-shrink-0"></div>
                  <span className="text-sm text-gray-300 w-24">{phase}</span>
                  <input
                    type="range"
                    min="0"
                    max="50"
                    value={weight as number}
                    onChange={(e) => {
                      const data = getBackupData()
                      if (data) {
                        pushState(data)
                        data.settings.phaseWeights[phase] = parseInt(e.target.value) || 0
                        saveBackupData(data)
                        forceUpdate()
                      }
                    }}
                    className="flex-1"
                  />
                  <span className="text-sm font-bold text-blue-400 w-12 text-right">{(weight as number).toFixed(0)}%</span>
                  <button
                    onClick={() => {
                      const data = getBackupData()
                      if (data) {
                        pushState(data)
                        delete data.settings.phaseWeights[phase]
                        saveBackupData(data)
                        forceUpdate()
                      }
                    }}
                    className="text-red-400 hover:text-red-300"
                  >
                    ×
                  </button>
                </div>
              ))}
              <div className={`text-sm font-semibold p-2 rounded ${phaseWeightTotal === 100 ? 'bg-green-900/20 text-green-300' : 'bg-red-900/20 text-red-300'}`}>
                Total: {phaseWeightTotal}% {phaseWeightTotal === 100 ? '✓' : '⚠ should equal 100%'}
              </div>
              <button
                onClick={() => {
                  const data = getBackupData()
                  if (data && Object.keys(data.settings.phaseWeights).length > 0) {
                    pushState(data)
                    const numPhases = Object.keys(data.settings.phaseWeights).length
                    const baseWeight = Math.floor(100 / numPhases)
                    const remainder = 100 % numPhases
                    Object.entries(data.settings.phaseWeights).forEach(([ph], idx) => {
                      data.settings.phaseWeights[ph] = baseWeight + (idx < remainder ? 1 : 0)
                    })
                    saveBackupData(data)
                    forceUpdate()
                  }
                }}
                className="w-full px-3 py-2 bg-blue-600/30 hover:bg-blue-600/40 text-blue-300 rounded text-xs font-medium border border-blue-500/30"
              >
                Auto-Balance to 100%
              </button>
            </div>
          </SettingCard>

          {/* 4. GOOGLE CALENDAR URL */}
          <SettingCard title="Google Calendar URL">
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase mb-2">Embed URL</label>
              <textarea
                value={settings.gcalUrl || ''}
                onChange={(e) => {
                  const data = getBackupData()
                  if (data) {
                    pushState(data)
                    data.settings.gcalUrl = e.target.value
                    persist()
                  }
                }}
                placeholder="Paste Google Calendar embed URL"
                className="w-full h-20 px-3 py-2 border rounded text-xs resize-none focus:border-blue-500 focus:outline-none theme-input"
              />
            </div>
          </SettingCard>

          {/* 5. AI AGENT SETTINGS */}
          <SettingCard title="AI Agent Settings">
            <div className="space-y-4">
              <div className="p-3 rounded border" style={{ backgroundColor: 'var(--bg-input)', borderColor: 'var(--border-secondary)' }}>
                <p className="text-sm text-gray-300 mb-2">Anthropic API Key</p>
                <div className="flex items-center gap-3">
                  <div className={`w-3 h-3 rounded-full ${import.meta.env.VITE_ANTHROPIC_API_KEY ? 'bg-green-500' : 'bg-red-500'}`}></div>
                  <span className="text-xs text-gray-400">
                    {import.meta.env.VITE_ANTHROPIC_API_KEY ? 'Configured — QuickBooks PDF import enabled' : 'Not configured — set VITE_ANTHROPIC_API_KEY in .env'}
                  </span>
                </div>
              </div>
              <div className="p-3 rounded border" style={{ backgroundColor: 'var(--bg-input)', borderColor: 'var(--border-secondary)' }}>
                <p className="text-sm text-gray-300 mb-2">QuickBooks Integration</p>
                <div className="flex items-center gap-3">
                  <div className="w-3 h-3 rounded-full bg-yellow-500"></div>
                  <span className="text-xs text-gray-400">PDF import available — API sync coming in V3</span>
                </div>
              </div>
              <p className="text-xs text-gray-500 italic">💡 AI features (PDF extraction, estimate review, profit analysis) require VITE_ANTHROPIC_API_KEY in environment variables</p>
            </div>
          </SettingCard>

          {/* 6. DATA & SYNC */}
          <SettingCard title="Data & Sync">
            <div className="space-y-3">
              <div className="flex items-center gap-3 p-3 rounded" style={{ backgroundColor: 'var(--bg-input)' }}>
                <div className={`w-3 h-3 rounded-full ${supabaseUp ? 'bg-green-500' : 'bg-red-500'}`}></div>
                <div>
                  <p className="text-sm font-semibold text-gray-300">Supabase Status</p>
                  <p className="text-xs text-gray-500">{supabaseUp ? 'Configured' : 'Not configured'}</p>
                </div>
              </div>
              <div className="text-xs text-gray-400">
                <p className="font-semibold text-gray-300 mb-1">Last Sync</p>
                <p>{lastSync}</p>
              </div>
              {/* Save to Cloud button — forces immediate full sync */}
              <button
                onClick={async () => {
                  const btn = document.activeElement as HTMLButtonElement
                  if (btn) btn.disabled = true
                  const result = await forceSyncToCloud()
                  if (result.success) {
                    alert('Synced to cloud successfully!')
                  } else {
                    alert('Sync failed: ' + (result.error || 'Unknown error'))
                  }
                  if (btn) btn.disabled = false
                }}
                disabled={!supabaseUp}
                className="w-full px-3 py-2 bg-green-600/30 hover:bg-green-600/40 text-green-300 rounded text-xs font-medium border border-green-500/30 transition flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Save size={14} />
                Save to Cloud Now
              </button>
              <p className="text-xs text-gray-500">Forces an immediate full sync of all local data to Supabase. Use after making important changes like marking payments or updating project status.</p>
            </div>
          </SettingCard>

        </div>

        {/* RIGHT COLUMN */}
        <div className="space-y-6">

          {/* 7. SNAPSHOT MANAGER */}
          <SettingCard title="Snapshot Manager">
            <div className="space-y-3">
              <button
                onClick={handleSaveSnapshot}
                className="w-full px-3 py-2 bg-blue-600/30 hover:bg-blue-600/40 text-blue-300 rounded text-xs font-medium border border-blue-500/30 transition flex items-center justify-center gap-2"
              >
                <Save size={14} />
                Save Snapshot
              </button>
              <div className="max-h-64 overflow-y-auto space-y-2">
                {snapshots.length > 0 ? (
                  snapshots.map((snap: any) => (
                    <div key={snap.id} className="p-3 rounded border" style={{ backgroundColor: 'var(--bg-input)', borderColor: 'var(--border-secondary)' }}>
                      <p className="text-xs font-semibold text-gray-200">{snap.name}</p>
                      <p className="text-xs text-gray-500 mt-1">{new Date(snap.date).toLocaleString()}</p>
                      <div className="flex gap-2 mt-2">
                        <button
                          onClick={() => handleRestoreSnapshot(snap)}
                          className="flex-1 text-xs px-2 py-1 bg-green-600/30 hover:bg-green-600/40 text-green-300 rounded"
                        >
                          Restore
                        </button>
                        <button
                          onClick={() => handleDeleteSnapshot(snap.id)}
                          className="flex-1 text-xs px-2 py-1 bg-red-600/30 hover:bg-red-600/40 text-red-300 rounded"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="text-xs text-gray-500 text-center py-4">No snapshots</p>
                )}
              </div>
            </div>
          </SettingCard>

          {/* Version History */}
          <SettingCard title="Version History">
            <div className="space-y-4">
              {/* Create snapshot */}
              <div className="flex gap-2">
                <input
                  type="text"
                  value={snapshotName}
                  onChange={(e) => setSnapshotName(e.target.value)}
                  placeholder="Snapshot description..."
                  className="flex-1 px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-gray-200 text-sm placeholder-gray-500"
                />
                <button
                  onClick={() => {
                    if (snapshotName.trim()) {
                      createSnapshot(snapshotName.trim())
                      setVersionSnapshots(getSnapshots())
                      setSnapshotName('')
                    }
                  }}
                  className="px-4 py-2 bg-cyan-600/20 text-cyan-400 rounded-lg text-sm font-medium hover:bg-cyan-600/30"
                >
                  Save Snapshot
                </button>
              </div>

              {/* Quick Create Snapshot Now button */}
              <button
                onClick={() => {
                  createSnapshot(`Manual snapshot ${new Date().toLocaleTimeString()}`)
                  setVersionSnapshots(getSnapshots())
                  alert('Snapshot created successfully ✓')
                }}
                className="w-full px-4 py-2 bg-emerald-600/20 text-emerald-400 rounded-lg text-sm font-medium hover:bg-emerald-600/30 transition"
              >
                Create Snapshot Now
              </button>

              {/* Snapshot list */}
              <div className="space-y-2 max-h-80 overflow-y-auto">
                {versionSnapshots.length === 0 ? (
                  <p className="text-gray-500 text-sm text-center py-4">No snapshots yet</p>
                ) : (
                  versionSnapshots.slice(0, 10).map((snap) => (
                    <div key={snap.id} className="flex items-center justify-between p-3 bg-gray-900/50 border border-gray-700/50 rounded-lg">
                      <div>
                        <p className="text-gray-200 text-sm">{snap.changeSummary}</p>
                        <p className="text-gray-500 text-xs mt-1">
                          {new Date(snap.timestamp).toLocaleString()} — {snap.device}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        {showRestoreConfirm === snap.id ? (
                          <>
                            <button
                              onClick={() => {
                                restoreSnapshot(snap.id)
                                setShowRestoreConfirm(null)
                                window.location.reload()
                              }}
                              className="px-3 py-1.5 bg-red-600/20 text-red-400 rounded text-xs font-medium"
                            >
                              Confirm Restore
                            </button>
                            <button
                              onClick={() => setShowRestoreConfirm(null)}
                              className="px-3 py-1.5 bg-gray-700 text-gray-400 rounded text-xs"
                            >
                              Cancel
                            </button>
                          </>
                        ) : (
                          <button
                            onClick={() => setShowRestoreConfirm(snap.id)}
                            className="px-3 py-1.5 bg-gray-700/50 text-gray-400 rounded text-xs hover:text-gray-200"
                          >
                            Restore
                          </button>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </SettingCard>

          {/* 8. UNDO/REDO CONFIG */}
          <SettingCard title="Undo/Redo Config">
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase mb-2">Max History Depth</label>
                <input
                  type="number"
                  defaultValue={50}
                  onChange={(e) => {
                    const val = Math.max(1, parseInt(e.target.value) || 50)
                    setMaxHistoryDepth(val)
                  }}
                  min="1"
                  max="500"
                  className="w-full px-3 py-2 border rounded text-sm theme-input"
                />
              </div>
              <button
                onClick={() => {
                  if (window.confirm('Clear all undo/redo history?')) {
                    clearHistory()
                  }
                }}
                className="w-full px-3 py-2 bg-red-600/30 hover:bg-red-600/40 text-red-300 rounded text-xs font-medium border border-red-500/30"
              >
                Clear History
              </button>
            </div>
          </SettingCard>

          {/* 9. EXPORT/IMPORT */}
          <SettingCard title="Export / Import">
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={handleExportBackup}
                className="px-3 py-2 bg-blue-600/30 hover:bg-blue-600/40 text-blue-300 rounded text-xs font-medium border border-blue-500/30 flex items-center justify-center gap-1"
              >
                <Download size={12} />
                Export
              </button>
              <button
                onClick={handleImportBackup}
                className="px-3 py-2 bg-purple-600/30 hover:bg-purple-600/40 text-purple-300 rounded text-xs font-medium border border-purple-500/30 flex items-center justify-center gap-1"
              >
                <Upload size={12} />
                Import
              </button>
              <button
                onClick={handleResetDefaults}
                className="col-span-2 px-3 py-2 bg-red-600/30 hover:bg-red-600/40 text-red-300 rounded text-xs font-medium border border-red-500/30"
              >
                Reset to Defaults
              </button>
            </div>
          </SettingCard>

          {/* QUICKBOOKS BATCH IMPORT */}
          <QuickBooksBatchImport persist={persist} forceUpdate={forceUpdate} />

          {/* QUICKBOOKS INTEGRATION (FOUNDATION) */}
          <SettingCard title="QuickBooks Integration">
            <div className="space-y-3">
              <div className="flex items-center gap-3 p-3 rounded" style={{ backgroundColor: 'var(--bg-input)' }}>
                <div className="w-3 h-3 rounded-full bg-yellow-500"></div>
                <div>
                  <p className="text-sm font-semibold text-gray-300">Not connected — PDF import available</p>
                  <p className="text-xs text-gray-500 mt-1">Connect your QuickBooks account to automatically sync invoices and estimates. Requires QuickBooks Online API setup.</p>
                </div>
              </div>
              <button
                disabled
                className="w-full px-3 py-2 rounded text-xs font-medium border transition flex items-center justify-center gap-2 opacity-50 cursor-not-allowed"
                style={{ backgroundColor: 'rgba(99,102,241,0.1)', color: '#818cf8', borderColor: 'rgba(99,102,241,0.2)' }}
              >
                Connect QuickBooks — Coming in V3
              </button>
              <p className="text-[10px] text-gray-600 italic">
                OAuth 2.0 flow via Intuit platform. Set VITE_QUICKBOOKS_CLIENT_ID and VITE_QUICKBOOKS_CLIENT_SECRET in .env to enable.
              </p>
            </div>
          </SettingCard>

          {/* IMPORT HISTORY */}
          <ImportHistoryCard />

          {/* 10. MTO PHASES */}
          <SettingCard title="MTO Phases">
            <div className="space-y-2">
              {mtoPhases.map((phase: string, i: number) => (
                <div key={i} className="flex justify-between items-center text-sm p-2 rounded" style={{ backgroundColor: 'var(--bg-input)' }}>
                  <span className="text-gray-300">{phase}</span>
                  <button
                    onClick={() => {
                      const data = getBackupData()
                      if (data) {
                        pushState(data)
                        data.settings.mtoPhases = data.settings.mtoPhases.filter((_: string, idx: number) => idx !== i)
                        persist()
                      }
                    }}
                    className="text-red-400 hover:text-red-300"
                  >
                    ×
                  </button>
                </div>
              ))}
              <button
                onClick={() => {
                  const name = prompt('New MTO phase:')
                  if (!name) return
                  const data = getBackupData()
                  if (data) {
                    pushState(data)
                    if (!data.settings.mtoPhases) data.settings.mtoPhases = []
                    data.settings.mtoPhases.push(name)
                    persist()
                  }
                }}
                className="w-full text-xs px-2 py-2 bg-blue-600/30 text-blue-300 rounded hover:bg-blue-600/40 border border-blue-500/30"
              >
                + Add Phase
              </button>
            </div>
          </SettingCard>

          {/* NEXUS VOICE */}
          <SettingCard title="NEXUS Voice">
            <VoiceSettings />
          </SettingCard>

          {/* SYSTEM INFO */}
          <SettingCard title="System Info">
            <div className="space-y-2 text-xs text-gray-400">
              <p><span className="text-gray-500 font-semibold">Last Saved:</span> {lastSync}</p>
              <p><span className="text-gray-500 font-semibold">Projects:</span> {backup.projects?.length || 0}</p>
              <p><span className="text-gray-500 font-semibold">Logs:</span> {backup.logs?.length || 0}</p>
              <p><span className="text-gray-500 font-semibold">Snapshots:</span> {snapshots.length}</p>
              <p><span className="text-gray-500 font-semibold">Schema:</span> v{backup._schemaVersion || 0}</p>
              <p><span className="text-gray-500 font-semibold">Imports:</span> {(backup.imports || []).length}</p>
            </div>
          </SettingCard>

        </div>
      </div>
    </div>
  )
}

// ── QuickBooks Batch Import Sub-Component ────────────────────────────────────

function QuickBooksBatchImport({ persist, forceUpdate }: { persist: () => void; forceUpdate: () => void }) {
  const [batchItems, setBatchItems] = useState<QBBatchItem[]>([])
  const [processing, setProcessing] = useState(false)
  const [progress, setProgress] = useState({ current: 0, total: 0 })
  const [summary, setSummary] = useState<{ svc: number; proj: number; skipped: number } | null>(null)
  const batchFileRef = useRef<HTMLInputElement>(null)

  async function handleBatchSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []).filter(f => f.name.toLowerCase().endsWith('.pdf')).slice(0, 20)
    if (!files.length) return

    setProcessing(true)
    setSummary(null)
    setBatchItems(files.map(f => ({ filename: f.name, status: 'pending' })))

    const results = await processBatch(files, (idx, total, item) => {
      setProgress({ current: idx + 1, total })
      setBatchItems(prev => {
        const next = [...prev]
        next[idx] = { ...item }
        return next
      })
    })
    setBatchItems(results)
    setProcessing(false)
  }

  function toggleAccept(idx: number) {
    setBatchItems(prev => {
      const next = [...prev]
      const item = next[idx]
      if (item.status === 'extracted') item.status = 'accepted'
      else if (item.status === 'accepted') item.status = 'extracted'
      return next
    })
  }

  function skipItem(idx: number) {
    setBatchItems(prev => {
      const next = [...prev]
      next[idx].status = 'skipped'
      return next
    })
  }

  function importAllAccepted() {
    const backup = getBackupData()
    if (!backup) return
    pushState(backup)

    let svc = 0, proj = 0, skipped = 0
    for (const item of batchItems) {
      if (item.status !== 'accepted' || !item.extracted) {
        if (item.status === 'skipped') skipped++
        continue
      }
      const data = item.extracted
      if (data.documentType === 'invoice') {
        const entry = mapToServiceLog(data)
        ;(entry as any).source = 'quickbooks_import'
        if (!backup.serviceLogs) backup.serviceLogs = []
        const existingSvcIds = new Set((backup.serviceLogs || []).map((l: any) => l.id))
        if (entry.id && existingSvcIds.has(entry.id)) continue
        backup.serviceLogs.push(entry as any)
        logImport(backup, 'pdf', item.filename, 1, 'invoice', data.customerName, data.totalAmount)
        svc++
      } else {
        const project = mapToProject(data)
        project.source = 'quickbooks_import'
        if (!backup.projects) backup.projects = []
        const existingProjIds = new Set((backup.projects || []).map((p: any) => p.id))
        if (project.id && existingProjIds.has(project.id)) continue
        backup.projects.push(project)
        logImport(backup, 'pdf', item.filename, 1, 'estimate', data.customerName, data.totalAmount)
        proj++
      }
    }

    backup._lastSavedAt = new Date().toISOString()
    saveBackupData(backup)
    forceUpdate()
    setSummary({ svc, proj, skipped })
  }

  const accepted = batchItems.filter(i => i.status === 'accepted').length

  return (
    <SettingCard title="QuickBooks Batch Import">
      <div className="space-y-3">
        <p className="text-xs text-gray-500">Upload up to 20 QuickBooks PDF invoices/estimates for batch processing.</p>

        <button
          onClick={() => batchFileRef.current?.click()}
          disabled={processing}
          className="w-full px-3 py-2 rounded text-xs font-medium border transition flex items-center justify-center gap-2"
          style={{ backgroundColor: 'rgba(99,102,241,0.15)', color: '#818cf8', borderColor: 'rgba(99,102,241,0.3)' }}
        >
          {processing ? (
            <>
              <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />
              Processing {progress.current}/{progress.total}...
            </>
          ) : (
            <>
              <Upload size={14} />
              Select PDFs for Batch Import
            </>
          )}
        </button>
        <input
          ref={batchFileRef}
          type="file"
          accept=".pdf"
          multiple
          onChange={handleBatchSelect}
          style={{ display: 'none' }}
        />

        {/* Progress bar */}
        {processing && progress.total > 0 && (
          <div style={{ height: '4px', backgroundColor: '#1e2130', borderRadius: '2px', overflow: 'hidden' }}>
            <div
              style={{
                height: '100%',
                width: `${(progress.current / progress.total) * 100}%`,
                backgroundColor: '#6366f1',
                transition: 'width 0.3s',
                borderRadius: '2px',
              }}
            />
          </div>
        )}

        {/* Batch review list */}
        {batchItems.length > 0 && !processing && (
          <div className="space-y-1 max-h-64 overflow-y-auto">
            {batchItems.map((item, idx) => (
              <div key={idx} className="flex items-center justify-between rounded p-2 text-[10px]" style={{ backgroundColor: 'var(--bg-input)' }}>
                <div className="flex-1 min-w-0">
                  <div className="text-gray-300 font-medium truncate">{item.filename}</div>
                  {item.extracted && (
                    <div className="text-gray-500 truncate">
                      {item.extracted.documentType} — {item.extracted.customerName} — {fmt(item.extracted.totalAmount)}
                    </div>
                  )}
                  {item.error && <div className="text-red-400 truncate">{item.error}</div>}
                </div>
                <div className="flex items-center gap-1 ml-2 flex-shrink-0">
                  {item.status === 'extracted' && (
                    <>
                      <button onClick={() => toggleAccept(idx)} className="px-2 py-1 rounded bg-green-600/30 text-green-300 text-[9px]">Accept</button>
                      <button onClick={() => skipItem(idx)} className="px-2 py-1 rounded bg-gray-600/30 text-gray-400 text-[9px]">Skip</button>
                    </>
                  )}
                  {item.status === 'accepted' && (
                    <span className="px-2 py-1 rounded bg-green-600/20 text-green-400 text-[9px] font-bold flex items-center gap-1">
                      <Check size={10} /> Accepted
                    </span>
                  )}
                  {item.status === 'skipped' && (
                    <span className="px-2 py-1 rounded bg-gray-600/20 text-gray-500 text-[9px]">Skipped</span>
                  )}
                  {item.status === 'error' && (
                    <span className="px-2 py-1 rounded bg-red-600/20 text-red-400 text-[9px]">Error</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Import all accepted */}
        {accepted > 0 && !processing && (
          <button
            onClick={importAllAccepted}
            className="w-full px-3 py-2 rounded text-xs font-bold border transition flex items-center justify-center gap-2"
            style={{ backgroundColor: 'rgba(16,185,129,0.15)', color: '#10b981', borderColor: 'rgba(16,185,129,0.3)' }}
          >
            <Check size={14} />
            Import All Accepted ({accepted})
          </button>
        )}

        {/* Summary */}
        {summary && (
          <div className="rounded p-3 border border-green-600/30" style={{ backgroundColor: 'var(--bg-input)' }}>
            <p className="text-xs text-green-400 font-bold mb-1">Import Complete</p>
            <p className="text-[10px] text-gray-400">
              {summary.svc} service log{summary.svc !== 1 ? 's' : ''} imported, {summary.proj} project{summary.proj !== 1 ? 's' : ''} created, {summary.skipped} skipped
            </p>
          </div>
        )}

        <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
      </div>
    </SettingCard>
  )
}

// ── Import History Sub-Component ─────────────────────────────────────────────

function ImportHistoryCard() {
  const backup = getBackupData()
  const imports = (backup?.imports || []).sort((a: any, b: any) =>
    String(b.timestamp || '').localeCompare(String(a.timestamp || ''))
  )

  return (
    <SettingCard title="Import History">
      <div className="space-y-2">
        {imports.length > 0 ? (
          <div className="max-h-48 overflow-y-auto space-y-1">
            {imports.map((imp: any, i: number) => (
              <div key={imp.id || i} className="flex items-center justify-between rounded p-2 text-[10px]" style={{ backgroundColor: 'var(--bg-input)' }}>
                <div className="flex-1 min-w-0">
                  <div className="text-gray-300 font-medium truncate">
                    {imp.customerName || imp.filename || 'Unknown'}
                  </div>
                  <div className="text-gray-500 truncate">
                    {new Date(imp.timestamp).toLocaleDateString()} — {imp.source === 'pdf' ? 'PDF Import' : 'QB API'} — {imp.documentType}
                  </div>
                </div>
                <div className="text-right ml-2 flex-shrink-0">
                  <div className="font-mono text-green-400 text-xs">{fmt(imp.totalAmount || 0)}</div>
                  <div className="text-gray-500">{imp.records_created} record{imp.records_created !== 1 ? 's' : ''}</div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-gray-500 text-center py-4">No imports yet. Use PDF import from Field Log or Projects.</p>
        )}
      </div>
    </SettingCard>
  )
}
