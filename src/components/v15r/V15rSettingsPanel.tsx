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
import { Settings, Download, Upload, RotateCcw, Save, Trash2, AlertCircle, Sparkles, FileText, Check, X, Loader2, Moon, Sun, Image, Copy, RefreshCw, Eye, EyeOff, Shield, Lock, TrendingUp, TrendingDown, Minus, BarChart2, Target, Zap, BookOpen, LogOut, UserPlus, Play, Square, Volume2, ChevronDown, ChevronRight, Plus } from 'lucide-react'
import DemoInvite from '@/components/admin/DemoInvite'
import { getLocalSkillMap, getLocalSkillSignals, getLocalDevelopmentLog, calculateDevelopmentRate, IDEAL_PROFILE, SKILL_DOMAINS } from '@/services/skillSignalExtractor'
import type { SkillDomain, StoredSkillSignal } from '@/services/skillSignalExtractor'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { useAuthStore } from '@/store/authStore'
import { verifyPasscode, setPasscode } from '@/lib/auth/passcode'
import { getBackupData, saveBackupData, saveBackupDataAndSync, exportBackup, importBackupFromFile, isSupabaseConfigured, forceSyncToCloud, num, fmt, fmtK, pct, getProjectFinancials, getSnapshots, createSnapshot, restoreSnapshot, getPhaseWeights, buildEqualPhaseWeights, type BackupSettings, type BackupData, type DataSnapshot } from '@/services/backupDataService'
import { getLocalOwnerProfile, saveLocalOwnerProfile, saveOwnerProfile, type CityLicense } from '@/services/ownerProfileService'
import { pushState } from '@/services/undoRedoService'
import { extractFromPDF, mapToServiceLog, mapToProject, logImport, processBatch, type QBBatchItem, type QBExtractedData } from '@/services/quickbooksImportService'
import { VoiceSettings } from '@/components/voice/VoiceSettings'
import SnapshotPanel from '@/components/SnapshotPanel'
import { createSnapshot as createCloudSnapshot } from '@/services/snapshotService'
import { ProposalQueue } from '@/components/ProposalQueue'
import { generateScoutSuggestions, queueScoutProposal } from '@/agents/scout'
import type { RawProposal } from '@/agents/scout'
import { subscribe as subscribeAgentEvent } from '@/services/agentEventBus'
import { useDemoStore } from '@/store/demoStore'
import { getProjectPhaseNames, DEFAULT_PROJECT_PHASES } from '@/utils/v15rProjectPhases'
import { DEMO_COMPANY, DEMO_OWNER, DEMO_LICENSE } from '@/services/demoDataService'
import {
  createMilestone,
  exportCurrentData,
  listMilestoneSnapshots,
  getMilestoneSnapshot,
  restoreMilestone,
  formatSizeBytes,
  type MilestoneSnapshotMeta,
  type SnapshotFilter,
} from '@/services/milestoneBackupService'
import TestDataManagementPanel from '@/components/testdata/TestDataManagementPanel'
import { HomeBaseSettings } from '@/components/settings/HomeBaseSettings'
import { CronStatusPanel } from '@/components/hunter/CronStatusPanel'
import {
  DEFAULT_SOLAR_ESTIMATE_SETTINGS,
  SOLAR_ESTIMATE_SETTINGS_STORAGE_KEY,
  getCombinedHourlyLaborRate,
  loadSolarEstimateSettings,
  saveSolarEstimateSettings,
  type LaborFormulaMode,
  type SolarEstimateSettings,
  type HardwareEntry,
  type HardwareIndexData,
} from '@/services/solarTraining/SolarEstimateSettings'

// ── Settings Hub visibility persistence (Phase R1) ──────────────────────────
const SETTINGS_HUB_VISIBILITY_KEY = 'poweron_settings_hub_visibility_v1'
const HUNTER_COMMAND_CENTER_COLLAPSED_KEY = 'poweron.settings.hunterCommandCenter.collapsed'
const SOLAR_ESTIMATE_SETTINGS_COLLAPSED_KEY = 'poweron.settings.solarEstimateSettings.collapsed'
const SOLAR_ESTIMATE_HARDWARE_INDEX_COLLAPSED_KEY = 'poweron.settings.solarEstimateHardwareIndex.collapsed'

type SettingsHubVisibility = {
  showBusinessSetup: boolean
  showOverheadManager: boolean
  showDataSyncCenter: boolean
  showAdminTools: boolean
  showActiveIntegrations: boolean
  showSecurityCenter: boolean
  showProjectsConfiguration: boolean
  showAIDevelopment: boolean
}

const SETTINGS_HUB_VISIBILITY_DEFAULTS: SettingsHubVisibility = {
  showBusinessSetup: true,
  showOverheadManager: false,
  showDataSyncCenter: false,
  showAdminTools: false,
  showActiveIntegrations: false,
  showSecurityCenter: false,
  showProjectsConfiguration: false,
  showAIDevelopment: false,
}

type ScoutStagedSuggestion = {
  id: string
  proposal: RawProposal
  selected: boolean
}

type ScoutScanHistoryItem = {
  id: string
  orgId: string
  title: string
  reason: string
  category: string
  impact_score: number
  risk_score: number
  status: 'not_selected' | 'dismissed' | 'rejected'
  createdAt: string
}

const SCOUT_SCAN_LIMIT_PER_24H = 10
const SCOUT_SCAN_WINDOW_MS = 24 * 60 * 60 * 1000
const SCOUT_SCAN_HISTORY_LIMIT = 100
const SCOUT_SCAN_HISTORY_PAGE_SIZE = 15
const scoutScanUsageKey = (orgId: string) => `poweron_scout_scan_usage:${orgId}`
const scoutScanHistoryKey = (orgId: string) => `poweron_scout_scan_history:${orgId}`

function normalizeScoutHistoryPart(value: unknown): string {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ')
}

function scoutScanHistoryStableKey(item: Pick<ScoutScanHistoryItem, 'title' | 'category' | 'orgId'>): string {
  return [
    normalizeScoutHistoryPart(item.orgId),
    normalizeScoutHistoryPart(item.category),
    normalizeScoutHistoryPart(item.title),
  ].join('|')
}

function dedupeScoutScanHistory(items: ScoutScanHistoryItem[]): ScoutScanHistoryItem[] {
  const seen = new Set<string>()
  const deduped: ScoutScanHistoryItem[] = []
  for (const item of items) {
    const key = scoutScanHistoryStableKey(item)
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(item)
    if (deduped.length >= SCOUT_SCAN_HISTORY_LIMIT) break
  }
  return deduped
}

function loadScoutScanUsage(orgId: string): number[] {
  try {
    const raw = localStorage.getItem(scoutScanUsageKey(orgId))
    const parsed = raw ? JSON.parse(raw) : []
    const cutoff = Date.now() - SCOUT_SCAN_WINDOW_MS
    return Array.isArray(parsed) ? parsed.filter((ts: unknown) => typeof ts === 'number' && ts >= cutoff) : []
  } catch {
    return []
  }
}

function saveScoutScanUsage(orgId: string, usage: number[]): void {
  try {
    const cutoff = Date.now() - SCOUT_SCAN_WINDOW_MS
    localStorage.setItem(scoutScanUsageKey(orgId), JSON.stringify(usage.filter(ts => ts >= cutoff)))
  } catch { /* non-critical */ }
}

function loadScoutScanHistory(orgId?: string): ScoutScanHistoryItem[] {
  if (!orgId) return []
  try {
    const raw = localStorage.getItem(scoutScanHistoryKey(orgId))
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed)
      ? dedupeScoutScanHistory(parsed
        .filter((item: any) => (item?.orgId === orgId || !item?.orgId) && item?.status !== 'queued')
        .map((item: any) => ({ ...item, orgId })))
      : []
  } catch {
    return []
  }
}

function saveScoutScanHistory(orgId: string, items: ScoutScanHistoryItem[]): void {
  try {
    localStorage.setItem(scoutScanHistoryKey(orgId), JSON.stringify(dedupeScoutScanHistory(items.map(item => ({ ...item, orgId })))))
  } catch { /* non-critical */ }
}

function loadSettingsHubVisibility(): SettingsHubVisibility {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(SETTINGS_HUB_VISIBILITY_KEY) : null
    if (!raw) return { ...SETTINGS_HUB_VISIBILITY_DEFAULTS }
    const parsed = JSON.parse(raw) as Partial<SettingsHubVisibility>
    return { ...SETTINGS_HUB_VISIBILITY_DEFAULTS, ...parsed }
  } catch {
    return { ...SETTINGS_HUB_VISIBILITY_DEFAULTS }
  }
}

function loadCollapsedState(key: string, fallback = false): boolean {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null
    if (raw == null) return fallback
    return raw === 'true'
  } catch {
    return fallback
  }
}

function saveCollapsedState(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, String(value))
  } catch {
    /* localStorage may be unavailable; ignore */
  }
}

// ── Synchronized diagonal glare (Phase R1) ──────────────────────────────────
// Cards whose section is open share a single animation phase. We achieve this
// with a negative animation-delay equal to (Date.now() % GLARE_ANIMATION_MS),
// so a card mounted mid-cycle joins at the current point, instead of starting
// its own animation timeline.
const GLARE_ANIMATION_MS = 4200
function getSyncedGlareDelay(): string {
  // Negative delay → CSS animation appears as if it began (Date.now() % period) ms ago.
  if (typeof Date === 'undefined') return '0ms'
  return `-${Date.now() % GLARE_ANIMATION_MS}ms`
}

function GlareOverlay({ active, resetKey }: { active: boolean; resetKey: number }) {
  const delayRef = useRef<string>(resetKey === 0 ? getSyncedGlareDelay() : '0ms')

  if (!active) return null

  return (
    <span
      aria-hidden="true"
      className="poweron-glare-sweep pointer-events-none absolute inset-0 overflow-hidden rounded-2xl"
      style={{ animationDelay: delayRef.current }}
    />
  )
}

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

function makeHardwareId() {
  return Math.random().toString(36).slice(2, 10)
}

function makeHardwareEntry(): HardwareEntry {
  return { id: makeHardwareId(), title: '', supplier: '', wattageSpec: '', price: '' }
}

const entryInputClass =
  'w-full rounded border border-slate-700/70 bg-slate-900/80 px-2 py-1 text-xs text-cyan-50 outline-none placeholder:text-slate-600 focus:border-cyan-400/40 focus:ring-1 focus:ring-cyan-400/15 min-w-0'

function EntrySection({ label, entries, onChange }: { label: string; entries: HardwareEntry[]; onChange: (e: HardwareEntry[]) => void }) {
  const addEntry = () => onChange([...entries, makeHardwareEntry()])
  const removeEntry = (id: string) => onChange(entries.filter(e => e.id !== id))
  const updateEntry = (id: string, field: keyof HardwareEntry, value: string) =>
    onChange(entries.map(e => (e.id === id ? { ...e, [field]: value } : e)))

  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">{label}</span>
        <button
          type="button"
          onClick={addEntry}
          className="flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-semibold text-cyan-300/80 border border-cyan-400/20 bg-cyan-950/30 hover:bg-cyan-950/60 hover:text-cyan-200 transition-colors"
        >
          <Plus size={10} />
          Add item
        </button>
      </div>
      {entries.length === 0 ? (
        <p className="text-[11px] text-slate-600 italic py-1 pl-1">No items yet.</p>
      ) : (
        <div className="space-y-1.5">
          <div className="grid gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-600 px-1" style={{ gridTemplateColumns: '1fr 1fr 1fr 1fr auto' }}>
            <span>Title</span><span>Supplier</span><span>Wattage / Spec</span><span>Price</span><span />
          </div>
          {entries.map(entry => (
            <div key={entry.id} className="grid gap-1.5 items-center" style={{ gridTemplateColumns: '1fr 1fr 1fr 1fr auto' }}>
              <input
                type="text"
                value={entry.title}
                onChange={ev => updateEntry(entry.id, 'title', ev.target.value)}
                placeholder="Title"
                className={entryInputClass}
              />
              <input
                type="text"
                value={entry.supplier}
                onChange={ev => updateEntry(entry.id, 'supplier', ev.target.value)}
                placeholder="Supplier"
                className={entryInputClass}
              />
              <input
                type="text"
                value={entry.wattageSpec}
                onChange={ev => updateEntry(entry.id, 'wattageSpec', ev.target.value)}
                placeholder="Wattage / Spec"
                className={entryInputClass}
              />
              <input
                type="text"
                value={entry.price}
                onChange={ev => updateEntry(entry.id, 'price', ev.target.value)}
                placeholder="Price"
                className={entryInputClass}
              />
              <button
                type="button"
                onClick={() => removeEntry(entry.id)}
                className="rounded p-1 text-slate-500 hover:text-rose-400 hover:bg-rose-950/30 transition-colors"
                aria-label="Remove entry"
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function HardwareIndexPanel({ index, onChange }: { index: HardwareIndexData; onChange: (idx: HardwareIndexData) => void }) {
  const [isCollapsed, setIsCollapsed] = useState(() => loadCollapsedState(SOLAR_ESTIMATE_HARDWARE_INDEX_COLLAPSED_KEY, true))

  useEffect(() => {
    saveCollapsedState(SOLAR_ESTIMATE_HARDWARE_INDEX_COLLAPSED_KEY, isCollapsed)
  }, [isCollapsed])

  const updateModules = (entries: HardwareEntry[]) => onChange({ ...index, solarModules: entries })
  const updateHw = (key: keyof HardwareIndexData['hardware']) => (entries: HardwareEntry[]) =>
    onChange({ ...index, hardware: { ...index.hardware, [key]: entries } })
  const updateEl = (key: keyof HardwareIndexData['electricalEquipment']) => (entries: HardwareEntry[]) =>
    onChange({ ...index, electricalEquipment: { ...index.electricalEquipment, [key]: entries } })

  const totalCount =
    index.solarModules.length +
    Object.values(index.hardware).reduce((s, a) => s + a.length, 0) +
    Object.values(index.electricalEquipment).reduce((s, a) => s + a.length, 0)

  return (
    <div className="mt-4 rounded-xl border border-cyan-400/10 bg-slate-950/50">
      <button
        type="button"
        onClick={() => setIsCollapsed(v => !v)}
        className="group flex w-full items-center gap-2 px-4 py-3 text-left"
        aria-expanded={!isCollapsed}
      >
        <span className="rounded border border-cyan-400/15 bg-cyan-400/8 p-1 text-cyan-300/80 transition-colors group-hover:border-cyan-400/30">
          {isCollapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
        </span>
        <span className="text-xs font-bold text-cyan-100">Hardware Index</span>
        {totalCount > 0 && (
          <span className="ml-1 rounded-full bg-cyan-900/50 border border-cyan-400/20 px-1.5 py-0.5 text-[10px] font-semibold text-cyan-300/80">
            {totalCount}
          </span>
        )}
        <span className="ml-auto text-[11px] text-slate-500">Panels · Racking · Electrical</span>
      </button>

      {!isCollapsed && (
        <div className="px-4 pb-4 space-y-5 border-t border-cyan-400/8 pt-4">

          {/* Solar Modules */}
          <div className="rounded-lg border border-slate-700/40 bg-slate-950/40 p-3">
            <p className="text-[11px] font-bold uppercase tracking-wider text-emerald-200/80 mb-3">Solar Modules</p>
            <EntrySection label="Modules" entries={index.solarModules} onChange={updateModules} />
          </div>

          {/* Hardware */}
          <div className="rounded-lg border border-slate-700/40 bg-slate-950/40 p-3">
            <p className="text-[11px] font-bold uppercase tracking-wider text-cyan-200/80 mb-3">Hardware</p>
            <div className="space-y-4">
              <EntrySection label="Flashings" entries={index.hardware.flashings} onChange={updateHw('flashings')} />
              <div className="border-t border-slate-800/60 pt-4">
                <EntrySection label="Legs" entries={index.hardware.legs} onChange={updateHw('legs')} />
              </div>
              <div className="border-t border-slate-800/60 pt-4">
                <EntrySection label="Rail" entries={index.hardware.rail} onChange={updateHw('rail')} />
              </div>
              <div className="border-t border-slate-800/60 pt-4">
                <EntrySection label="Spacers" entries={index.hardware.spacers} onChange={updateHw('spacers')} />
              </div>
              <div className="border-t border-slate-800/60 pt-4">
                <EntrySection label="End Caps" entries={index.hardware.endCaps} onChange={updateHw('endCaps')} />
              </div>
            </div>
          </div>

          {/* Electrical Equipment */}
          <div className="rounded-lg border border-slate-700/40 bg-slate-950/40 p-3">
            <p className="text-[11px] font-bold uppercase tracking-wider text-amber-200/80 mb-3">Electrical Equipment</p>
            <div className="space-y-4">
              <EntrySection label="Combiner Box" entries={index.electricalEquipment.combinerBox} onChange={updateEl('combinerBox')} />
              <div className="border-t border-slate-800/60 pt-4">
                <EntrySection label="Disconnects" entries={index.electricalEquipment.disconnects} onChange={updateEl('disconnects')} />
              </div>
              <div className="border-t border-slate-800/60 pt-4">
                <EntrySection label="Main Electrical Panels" entries={index.electricalEquipment.mainElectricalPanels} onChange={updateEl('mainElectricalPanels')} />
              </div>
            </div>
          </div>

          <p className="text-[11px] text-slate-600">Hardware Index does not affect cost math. For reference and planning only.</p>
        </div>
      )}
    </div>
  )
}

function SolarEstimateSettingsPanel() {
  const [settings, setSettings] = useState<SolarEstimateSettings>(() => loadSolarEstimateSettings())
  const [saveState, setSaveState] = useState<'idle' | 'saved'>('idle')
  const [isCollapsed, setIsCollapsed] = useState(() => loadCollapsedState(SOLAR_ESTIMATE_SETTINGS_COLLAPSED_KEY))
  const combinedHourlyRate = getCombinedHourlyLaborRate(settings)
  const laborFormulaMode: LaborFormulaMode = settings.laborFormulaMode ?? 'panelRate'

  useEffect(() => {
    saveCollapsedState(SOLAR_ESTIMATE_SETTINGS_COLLAPSED_KEY, isCollapsed)
  }, [isCollapsed])

  const updateSetting = (key: keyof SolarEstimateSettings, value: number) => {
    const next = saveSolarEstimateSettings({ ...settings, [key]: Number.isFinite(value) && value >= 0 ? value : 0 })
    setSettings(next)
    setSaveState('saved')
    window.setTimeout(() => setSaveState('idle'), 1800)
  }

  const updateLaborMode = (mode: LaborFormulaMode) => {
    const next = saveSolarEstimateSettings({ ...settings, laborFormulaMode: mode })
    setSettings(next)
    setSaveState('saved')
    window.setTimeout(() => setSaveState('idle'), 1800)
  }

  const resetDefaults = () => {
    const next = saveSolarEstimateSettings(DEFAULT_SOLAR_ESTIMATE_SETTINGS)
    setSettings(next)
    setSaveState('saved')
    window.setTimeout(() => setSaveState('idle'), 1800)
  }

  const updateHardwareIndex = (index: HardwareIndexData) => {
    const next = saveSolarEstimateSettings({ ...settings, hardwareIndex: index })
    setSettings(next)
    setSaveState('saved')
    window.setTimeout(() => setSaveState('idle'), 1800)
  }

  const inputClass =
    'mt-2 w-full rounded-lg border border-cyan-400/15 bg-slate-950/75 px-3 py-2 text-sm text-cyan-50 outline-none transition-colors placeholder:text-slate-600 focus:border-cyan-400/50 focus:ring-1 focus:ring-cyan-400/20'
  const disabledInputClass =
    'mt-2 w-full rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2 text-sm text-slate-600 outline-none cursor-not-allowed'

  const field = (key: keyof SolarEstimateSettings, label: string, hint?: string, disabled?: boolean) => (
    <label className={`block min-w-0 ${disabled ? 'opacity-50' : ''}`}>
      <span className="text-[11px] font-semibold uppercase tracking-wider text-cyan-200/75">{label}</span>
      {hint && <span className="ml-2 text-[10px] text-slate-500">{hint}</span>}
      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-[17px] text-xs text-slate-500">$</span>
        <input
          type="number"
          min="0"
          step="1"
          disabled={disabled}
          value={settings[key]}
          onChange={event => updateSetting(key, Number(event.target.value))}
          className={`${disabled ? disabledInputClass : inputClass} pl-7`}
        />
      </div>
    </label>
  )

  const numberField = (key: keyof SolarEstimateSettings, label: string, suffix: string, hint?: string, disabled?: boolean) => (
    <label className={`block min-w-0 ${disabled ? 'opacity-50' : ''}`}>
      <span className="text-[11px] font-semibold uppercase tracking-wider text-cyan-200/75">{label}</span>
      {hint && <span className="ml-2 text-[10px] text-slate-500">{hint}</span>}
      <div className="relative">
        <input
          type="number"
          min="0"
          step="1"
          disabled={disabled}
          value={settings[key]}
          onChange={event => updateSetting(key, Number(event.target.value))}
          className={`${disabled ? disabledInputClass : inputClass} pr-14`}
        />
        <span className="pointer-events-none absolute right-3 top-[17px] text-xs text-slate-500">{suffix}</span>
      </div>
    </label>
  )

  const formulaModeBtn = (mode: LaborFormulaMode, label: string) => (
    <button
      key={mode}
      type="button"
      onClick={() => updateLaborMode(mode)}
      className={`rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors ${
        laborFormulaMode === mode
          ? 'bg-cyan-700/60 text-cyan-100 shadow-sm'
          : 'text-slate-400 hover:text-slate-200'
      }`}
    >
      {label}
    </button>
  )

  return (
    <div className="rounded-2xl border border-emerald-400/15 bg-gradient-to-br from-slate-950/95 via-emerald-950/20 to-slate-950/90 p-4 shadow-inner shadow-emerald-950/20">
      <div className={`flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between ${isCollapsed ? '' : 'border-b border-emerald-400/10 pb-4'}`}>
        <div>
          <button
            type="button"
            onClick={() => setIsCollapsed(value => !value)}
            className="group flex min-w-0 items-center gap-2 text-left"
            aria-expanded={!isCollapsed}
          >
            <span className="rounded-lg border border-emerald-400/15 bg-emerald-400/10 p-1 text-emerald-200 transition-colors group-hover:border-emerald-400/35">
              {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
            </span>
            <h4 className="text-sm font-bold text-emerald-50">Solar Estimate Settings</h4>
          </button>
          <p className="mt-1 text-xs leading-5 text-slate-400">
            Local admin defaults for modeled/internal Solar Estimate install cost. Customer quote pricing remains separate.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={resetDefaults}
            className="rounded-lg border border-slate-700 bg-slate-950/70 px-3 py-1.5 text-[11px] font-semibold text-slate-300 transition-colors hover:border-emerald-400/40 hover:text-emerald-200"
          >
            Reset defaults
          </button>
        </div>
      </div>

      {!isCollapsed && (
      <>
      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <div className="rounded-xl border border-cyan-400/10 bg-slate-950/60 p-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-cyan-200/80">Labor</p>
            <div className="flex items-center gap-0.5 rounded-lg border border-slate-700/80 bg-slate-900/70 p-0.5">
              {formulaModeBtn('hourlyCrew', 'Hourly crew labor')}
              {formulaModeBtn('panelRate', 'Panel labor rate')}
            </div>
          </div>
          <div className="mt-3 rounded-lg border border-cyan-400/10 bg-slate-950/45 p-3">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Hourly crew labor rates</p>
            <div className="mt-3 grid gap-3 md:grid-cols-3">
              {field('installer1HourlyRate', 'Installer 1 hourly rate', undefined, laborFormulaMode === 'panelRate')}
              {field('installer2HourlyRate', 'Installer 2 hourly rate', undefined, laborFormulaMode === 'panelRate')}
              {field('crewLeadHourlyRate', 'Crew lead hourly rate', undefined, laborFormulaMode === 'panelRate')}
            </div>
            <div className={`mt-3 rounded-lg border border-emerald-400/15 bg-emerald-950/15 p-3 ${laborFormulaMode === 'panelRate' ? 'opacity-50' : ''}`}>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-emerald-200/75">Combined crew labor rate</p>
              <p className="mt-1 text-xl font-semibold text-emerald-100">
                {combinedHourlyRate.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })}/hr
              </p>
              <p className="mt-1 text-[11px] leading-4 text-slate-500">Installer 1 + Installer 2 + Crew Lead hourly rates.</p>
            </div>
            {laborFormulaMode === 'hourlyCrew' && (
              <p className="mt-2 text-[11px] leading-4 text-amber-400/70">
                Hourly crew mode is saved for future labor-hour modeling. Panel rate is used in cost math until labor hours are defined.
              </p>
            )}
          </div>
          <div className="mt-3 rounded-lg border border-amber-400/10 bg-slate-950/45 p-3">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-amber-200/75">Panel labor rate</p>
            <p className="mt-1 text-[11px] leading-4 text-slate-500">Separate from the hourly crew total; used as panel count times labor-only panel cost.</p>
            <div className="mt-3">
              {field('panelInstallLaborCost', 'Cost per panel installed', 'labor only', laborFormulaMode === 'hourlyCrew')}
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-cyan-400/10 bg-slate-950/60 p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-cyan-200/80">Mobility and Delivery</p>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            {field('baseMobilityCost', 'Base mobility cost')}
            {field('mobilityCostPerMile', 'Cost per mile')}
            {numberField('mobilityFreeMiles', 'Free miles threshold', 'mi')}
            {field('flatDeliveryCost', 'Flat delivery cost')}
            {field('deliveryCostPerMile', 'Delivery cost per mile')}
          </div>
        </div>

        <div className="rounded-xl border border-cyan-400/10 bg-slate-950/60 p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-cyan-200/80">Electrical Upgrades</p>
          <p className="mt-1 text-[11px] text-slate-400">Applied in Summary only when the corresponding toggle is enabled in System Config.</p>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            {field('mainPanelUpgradeCost', 'Main panel upgrade cost')}
            {field('evChargerAdditionCost', 'EV Charger Addition Cost')}
          </div>
        </div>

        <div className="rounded-xl border border-cyan-400/10 bg-slate-950/60 p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-cyan-200/80">Permit Cost by Size</p>
          <p className="mt-1 text-[11px] text-slate-400">Small, medium, and large system-size ranges for permit cost defaults.</p>
          <div className="mt-3 grid gap-3 md:grid-cols-3">
            {field('smallPermitCost', 'Small system', '3–7 kW')}
            {field('mediumPermitCost', 'Medium system', '7–15 kW')}
            {field('largePermitCost', 'Large system', '15–30 kW')}
          </div>
        </div>

        <div className="rounded-xl border border-cyan-400/10 bg-slate-950/60 p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-cyan-200/80">Labor Hours per System</p>
          <p className="mt-1 text-[11px] text-slate-400">Used when Hourly crew labor is selected. Matches the same system-size tiers.</p>
          <div className="mt-3 grid gap-3 md:grid-cols-3">
            {numberField('laborHoursSmall', 'Small System', 'hrs', '3–7 kW')}
            {numberField('laborHoursMedium', 'Medium System', 'hrs', '7–15 kW')}
            {numberField('laborHoursLarge', 'Large System', 'hrs', '15–30 kW')}
          </div>
        </div>

        <div className="rounded-xl border border-cyan-400/10 bg-slate-950/60 p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-cyan-200/80">Blueprint Cost by Size</p>
          <p className="mt-1 text-[11px] text-slate-400">Uses the same small, medium, and large system-size ranges.</p>
          <div className="mt-3 grid gap-3 md:grid-cols-3">
            {field('smallBlueprintCost', 'Small system', '3–7 kW')}
            {field('mediumBlueprintCost', 'Medium system', '7–15 kW')}
            {field('largeBlueprintCost', 'Large system', '15-30 kW')}
          </div>
        </div>
      </div>

      <HardwareIndexPanel
        index={settings.hardwareIndex}
        onChange={updateHardwareIndex}
      />

      <div className="mt-4 flex flex-col gap-2 rounded-xl border border-emerald-400/10 bg-emerald-950/10 p-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs leading-5 text-slate-400">
          Stored locally at <span className="font-mono text-emerald-200">{SOLAR_ESTIMATE_SETTINGS_STORAGE_KEY}</span>.
        </p>
        <span className={`text-xs font-semibold ${saveState === 'saved' ? 'text-emerald-200' : 'text-slate-500'}`}>
          {saveState === 'saved' ? 'Saved locally' : 'Local only'}
        </span>
      </div>
      </>
      )}
    </div>
  )
}

// ── NEXUS Voice selector (10 curated voices) ─────────────────────────────────
const NEXUS_VOICES = [
  { id: 'gOkFV1JMCt0G0n9xmBwV', name: 'Oxley',      descriptor: 'Calm focused professional',  gender: 'Male'   },
  { id: 'NFG5qt843uXKj4pFvR7C', name: 'Adam Stone', descriptor: 'Clear direct field-ready',    gender: 'Male'   },
  { id: '6WjhCXzqp2hnSqFtrG8P', name: 'Marcus',     descriptor: 'Confident authoritative',     gender: 'Male'   },
  { id: '21m00Tcm4TlvDq8ikWAM', name: 'Rachel',     descriptor: 'Calm professional',           gender: 'Female' },
  { id: 'AZnzlk1XvdvUeBnXmlld', name: 'Domi',       descriptor: 'Strong confident',            gender: 'Female' },
  { id: 'EXAVITQu4vr4xnSDxMaL', name: 'Bella',      descriptor: 'Warm friendly',               gender: 'Female' },
  { id: 'ThT5KcBeYPX3keUQqHPh', name: 'Nia',        descriptor: 'Upbeat energetic',            gender: 'Female' },
  { id: 'yoZ06aMxZnX8TkCVKLEy', name: 'Sam',        descriptor: 'Raspy authoritative',         gender: 'Male'   },
  { id: 'CYw35i4Wn5qWUFPfRwi7', name: 'Dave',       descriptor: 'Casual conversational',       gender: 'Male'   },
  { id: 'ErXwobaYiN019PkySvjV', name: 'Antoni',     descriptor: 'Well-rounded',                gender: 'Male'   },
]
const NEXUS_VOICE_KEY = 'poweron_nexus_voice'
const NEXUS_VOICE_DEFAULT = 'gOkFV1JMCt0G0n9xmBwV' // Oxley

function NexusVoiceSelector() {
  const [selectedId, setSelectedId] = useState<string>(() => {
    try { return localStorage.getItem(NEXUS_VOICE_KEY) || NEXUS_VOICE_DEFAULT } catch { return NEXUS_VOICE_DEFAULT }
  })
  const [playingId, setPlayingId] = useState<string | null>(null)
  const [loadingId, setLoadingId] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const { user } = useAuth()

  const stopAudio = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current = null
    }
    if (window.speechSynthesis) window.speechSynthesis.cancel()
    setPlayingId(null)
    setLoadingId(null)
  }, [])

  const handleSelect = useCallback((voiceId: string) => {
    setSelectedId(voiceId)
    setSaved(false)
    try {
      // Write to both keys so voice.ts picks it up immediately
      localStorage.setItem(NEXUS_VOICE_KEY, voiceId)
      localStorage.setItem('nexus_voice_id', voiceId)
    } catch { /* ignore */ }
    const voice = NEXUS_VOICES.find(v => v.id === voiceId)
    console.log('[NexusVoiceSelector] Voice selected:', voice?.name, voiceId)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }, [])

  const handlePlaySample = useCallback(async (voice: typeof NEXUS_VOICES[0]) => {
    if (playingId === voice.id) { stopAudio(); return }
    stopAudio()
    setLoadingId(voice.id)

    const sampleText = 'Hello, I am your NEXUS assistant.'

    // Call speak Netlify function proxy
    try {
      const res = await fetch('/.netlify/functions/speak', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ voiceId: voice.id, text: sampleText }),
      })
      if (res.ok) {
        const { audio } = await res.json()
        const binary = atob(audio)
        const bytes  = new Uint8Array(binary.length)
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
        const blob = new Blob([bytes], { type: 'audio/mpeg' })
        const url  = URL.createObjectURL(blob)
        const audioEl = document.createElement('audio') as HTMLAudioElement
        audioEl.playsInline = true
        audioEl.src = url
        audioEl.oncanplaythrough = () => { setLoadingId(null); setPlayingId(voice.id); audioEl.play().catch(() => { URL.revokeObjectURL(url); fallbackSpeak() }) }
        audioEl.onended = () => { setPlayingId(null); URL.revokeObjectURL(url) }
        audioEl.onerror = () => { setLoadingId(null); URL.revokeObjectURL(url); fallbackSpeak() }
        audioEl.load()
        audioRef.current = audioEl
        return
      }
    } catch { /* fall through to browser TTS */ }

    fallbackSpeak()

    function fallbackSpeak() {
      if (!window.speechSynthesis) { setLoadingId(null); return }
      const utt = new SpeechSynthesisUtterance(sampleText)
      utt.onstart = () => { setLoadingId(null); setPlayingId(voice.id) }
      utt.onend   = () => setPlayingId(null)
      utt.onerror = () => { setPlayingId(null); setLoadingId(null) }
      window.speechSynthesis.speak(utt)
    }
  }, [playingId, stopAudio])

  // Sync to Supabase user_preferences when selection changes
  useEffect(() => {
    if (!user?.id) return
    ;(async () => {
      try {
        const { error } = await supabase.from('user_preferences').upsert({ user_id: user.id, nexus_voice_id: selectedId, updated_at: new Date().toISOString() })
        if (error) console.error(error)
      } catch(err) { console.error(err) }
    })()
  }, [selectedId, user?.id])

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 mb-1">
        <Volume2 className="w-4 h-4 text-emerald-400" />
        <p className="text-sm text-gray-400">Choose the voice NEXUS uses for all spoken responses</p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {NEXUS_VOICES.map(voice => {
          const isSelected = selectedId === voice.id
          const isPlaying  = playingId  === voice.id
          const isLoading  = loadingId  === voice.id
          const isFemale   = voice.gender === 'Female'
          return (
            <div
              key={voice.id}
              className={`flex flex-col gap-2 p-3 rounded-xl border transition-all cursor-pointer ${isSelected ? 'border-emerald-500/60 bg-emerald-500/10' : 'border-gray-700/60 bg-gray-800/30 hover:border-gray-600'}`}
              onClick={() => handleSelect(voice.id)}
            >
              <div className="flex items-center gap-2">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0 ${isSelected ? 'bg-emerald-500/20 text-emerald-400' : 'bg-gray-700 text-gray-400'}`}>
                  {voice.name[0]}
                </div>
                <div className="flex-1 min-w-0">
                  <div className={`text-sm font-semibold truncate ${isSelected ? 'text-emerald-300' : 'text-gray-200'}`}>{voice.name}</div>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${isFemale ? 'bg-pink-500/20 text-pink-300' : 'bg-blue-500/20 text-blue-300'}`}>
                      {voice.gender}
                    </span>
                  </div>
                </div>
                {isSelected && <Check className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />}
              </div>
              <div className="text-xs text-gray-500 leading-tight">{voice.descriptor}</div>
              <div className="flex items-center justify-between">
                <button
                  onClick={e => { e.stopPropagation(); handlePlaySample(voice) }}
                  disabled={isLoading}
                  className={`flex items-center gap-1 text-xs px-2 py-1 rounded-lg transition-colors ${isLoading ? 'bg-gray-700 text-gray-500 cursor-wait' : isPlaying ? 'bg-cyan-600 text-white' : 'bg-gray-700 text-gray-400 hover:bg-gray-600 hover:text-gray-200'}`}
                  title={isPlaying ? 'Stop' : 'Play sample'}
                >
                  {isLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : isPlaying ? <Square className="w-3 h-3" /> : <Play className="w-3 h-3" />}
                  <span>{isLoading ? 'Loading…' : isPlaying ? 'Stop' : 'Play Sample'}</span>
                </button>
              </div>
            </div>
          )
        })}
      </div>
      {saved && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-xs font-medium">
          <Check className="w-3.5 h-3.5" /> Voice saved — NEXUS will use this voice for all responses
        </div>
      )}
      <p className="text-xs text-gray-600 mt-1">Selection is saved immediately to localStorage and synced to your profile.</p>
    </div>
  )
}

// ── Admin Template Switcher ───────────────────────────────────────────────────

const ADMIN_TEMPLATE_OPTIONS = [
  { value: 'electrical',         label: 'Electrical (default)' },
  { value: 'plumbing',           label: 'Plumbing'             },
  { value: 'gc',                 label: 'General Contractor'   },
  { value: 'medical-billing',    label: 'Medical Billing'      },
  { value: 'mechanic',           label: 'Mechanic'             },
  { value: 'electrical-supplier',label: 'Electrical Supplier'  },
]

const PREVIEW_KEY = 'poweron_preview_industry'

function AdminTemplateSwitcherCard() {
  const [selected, setSelected] = useState<string>(() => {
    try { return sessionStorage.getItem(PREVIEW_KEY) || 'electrical' } catch { return 'electrical' }
  })
  const isPreviewActive = (() => {
    try { return !!sessionStorage.getItem(PREVIEW_KEY) } catch { return false }
  })()

  function handlePreview() {
    try {
      sessionStorage.setItem(PREVIEW_KEY, selected)
      window.location.reload()
    } catch { /* ignore */ }
  }

  function handleReset() {
    try {
      sessionStorage.removeItem(PREVIEW_KEY)
      window.location.reload()
    } catch { /* ignore */ }
  }

  return (
    <SettingCard title="Industry Template Preview">
      <div className="space-y-4">
        <p className="text-xs text-gray-400">
          Load any industry template to audit demo data. Your real data is never modified. Resets on next login.
        </p>
        {isPreviewActive && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-yellow-400/10 border border-yellow-400/40 text-yellow-300 text-xs font-semibold">
            🔍 Preview active: <span className="font-bold">{ADMIN_TEMPLATE_OPTIONS.find(o => o.value === ((() => { try { return sessionStorage.getItem(PREVIEW_KEY) } catch { return '' } })()))?.label || selected}</span>
          </div>
        )}
        <div>
          <label className="block text-xs font-semibold text-gray-500 uppercase mb-2">Template</label>
          <select
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            className="w-full px-3 py-2 rounded border text-sm theme-input outline-none"
            style={{ backgroundColor: 'var(--bg-input)', borderColor: 'var(--border-secondary)', color: 'var(--text-primary)' }}
          >
            {ADMIN_TEMPLATE_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
        <div className="flex gap-3">
          <button
            onClick={handlePreview}
            className="flex-1 px-4 py-2 bg-yellow-500 hover:bg-yellow-400 text-black text-sm font-bold rounded transition-colors"
          >
            Preview Template
          </button>
          <button
            onClick={handleReset}
            className="flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-gray-200 text-sm font-bold rounded transition-colors"
          >
            Reset to My Data
          </button>
        </div>
      </div>
    </SettingCard>
  )
}


function DataSyncCenter({
  backup,
  user,
  supabaseUp,
  lastSync,
  onExport,
  onImport,
  onResetDefaults,
}: {
  backup: BackupData
  user: any
  supabaseUp: boolean
  lastSync: string
  onExport: () => void
  onImport: () => void
  onResetDefaults: () => void
}) {
  const [syncing, setSyncing] = useState(false)
  const [syncMessage, setSyncMessage] = useState<string | null>(null)
  const [showDiagnostics, setShowDiagnostics] = useState(false)
  const [showDangerZone, setShowDangerZone] = useState(false)

  const projects = backup.projects || []
  const serviceLogs = backup.serviceLogs || []
  const logs = backup.logs || []
  const dataSizeBytes = (() => {
    try { return new Blob([JSON.stringify(backup)]).size } catch { return JSON.stringify(backup || {}).length }
  })()
  const dataSizeMb = (dataSizeBytes / 1024 / 1024).toFixed(2)

  const handleSaveLiveData = async () => {
    setSyncing(true)
    setSyncMessage(null)
    try {
      const result = await forceSyncToCloud()
      setSyncMessage(result.success ? 'Live data saved to Supabase.' : `Sync failed: ${result.error || 'Unknown error'}`)
    } catch (err: any) {
      setSyncMessage(`Sync failed: ${err?.message || 'Unknown error'}`)
    } finally {
      setSyncing(false)
    }
  }

  return (
    <SettingCard title="Data & Sync Center">
      <div className="space-y-6 rounded-2xl border border-cyan-400/20 bg-gradient-to-br from-slate-950/70 via-blue-950/25 to-slate-950/80 p-4 shadow-2xl shadow-blue-950/30">
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-cyan-400/10 bg-slate-950/40 p-3">
          <span className={`text-[11px] px-2.5 py-1 rounded-full border font-semibold ${
            supabaseUp
              ? 'bg-emerald-500/15 text-emerald-200 border-emerald-400/30 shadow-sm shadow-emerald-950'
              : 'bg-red-500/10 text-red-300 border-red-500/30'
          }`}>
            {supabaseUp ? 'Cloud Sync Done' : 'Supabase not configured'}
          </span>
          {user?.email === 'christian@poweronsolutionsllc.com' && (
            <>
              <span className="text-[11px] px-2.5 py-1 rounded-full border border-cyan-400/15 bg-slate-900/70 text-gray-400">
                app_state: poweron_v2
              </span>
              <span className="text-[11px] px-2.5 py-1 rounded-full border border-cyan-400/15 bg-slate-900/70 text-gray-400">
                Restore backend: snapshots table
              </span>
            </>
          )}
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="p-3 rounded-xl border border-cyan-400/15 bg-slate-950/60 shadow-inner shadow-blue-950/20">
            <p className="text-[10px] uppercase tracking-wider text-cyan-200/60 font-bold">Last Sync</p>
            <p className="text-sm font-bold text-gray-100 mt-1 truncate">{lastSync}</p>
          </div>
          <div className="p-3 rounded-xl border border-cyan-400/15 bg-slate-950/60 shadow-inner shadow-blue-950/20">
            <p className="text-[10px] uppercase tracking-wider text-cyan-200/60 font-bold">Projects</p>
            <p className="text-lg font-bold text-gray-100 mt-1">{projects.length}</p>
          </div>
          <div className="p-3 rounded-xl border border-cyan-400/15 bg-slate-950/60 shadow-inner shadow-blue-950/20">
            <p className="text-[10px] uppercase tracking-wider text-cyan-200/60 font-bold">Service Logs</p>
            <p className="text-lg font-bold text-gray-100 mt-1">{serviceLogs.length}</p>
          </div>
          <div className="p-3 rounded-xl border border-cyan-400/15 bg-slate-950/60 shadow-inner shadow-blue-950/20">
            <p className="text-[10px] uppercase tracking-wider text-cyan-200/60 font-bold">Data Size</p>
            <p className="text-lg font-bold text-gray-100 mt-1">{dataSizeMb} MB</p>
          </div>
        </div>

        {syncMessage && (
          <div className={`text-xs px-3 py-2 rounded-xl border ${
            syncMessage.startsWith('Sync failed')
              ? 'bg-red-500/10 text-red-300 border-red-500/25'
              : 'bg-emerald-500/10 text-emerald-300 border-emerald-500/25'
          }`}>
            {syncMessage}
          </div>
        )}

        <div className="rounded-xl border border-cyan-400/10 bg-slate-950/45 p-3">
          <h3 className="text-[11px] font-bold uppercase tracking-wider text-cyan-200/70 mb-3">Live Data Actions</h3>
          <div className="grid grid-cols-2 gap-2.5">
            <button
              onClick={handleSaveLiveData}
              disabled={!supabaseUp || syncing}
              className="px-3 py-2.5 rounded-lg text-xs font-semibold border transition flex items-center justify-center gap-2 bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-200 border-emerald-400/30 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {syncing ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
              Save Live Data Now
            </button>
            <button
              onClick={() => {
                window.dispatchEvent(new CustomEvent('poweron:snapshots-refresh'))
                window.location.reload()
              }}
              className="px-3 py-2.5 rounded-lg text-xs font-semibold border transition flex items-center justify-center gap-2 bg-cyan-500/15 hover:bg-cyan-500/25 text-cyan-200 border-cyan-400/30"
            >
              <RefreshCw size={12} />
              Refresh App View
            </button>
            <button
              onClick={onExport}
              className="px-3 py-2.5 rounded-lg text-xs font-semibold border transition flex items-center justify-center gap-2 bg-blue-500/15 hover:bg-blue-500/25 text-blue-200 border-blue-400/30"
            >
              <Download size={12} />
              Export Current Data
            </button>
            <button
              onClick={onImport}
              className="px-3 py-2.5 rounded-lg text-xs font-semibold border transition flex items-center justify-center gap-2 bg-indigo-500/15 hover:bg-indigo-500/25 text-indigo-200 border-indigo-400/30"
            >
              <Upload size={12} />
              Import Backup File
            </button>
          </div>
          <p className="text-[10px] text-gray-500 mt-3">
            Live data actions affect the current tenant state. Restore points are separate safety backups.
          </p>
        </div>

        <div className="rounded-xl border border-cyan-400/10 bg-slate-950/45 p-3">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="text-[11px] font-bold uppercase tracking-wider text-cyan-200/70">Restore Points</h3>
              <p className="text-[10px] text-gray-500 mt-0.5">Preview, pin, delete, or restore point-in-time backups.</p>
            </div>
          </div>
          <div className="rounded-xl border border-cyan-400/15 bg-slate-950/70 p-3 shadow-inner shadow-blue-950/30">
            <SnapshotPanel />
          </div>
        </div>

        <div className="space-y-2">
          <button
            onClick={() => setShowDiagnostics(v => !v)}
            className="w-full px-3 py-2.5 rounded-xl border border-cyan-400/15 bg-slate-950/50 hover:bg-slate-900/70 text-gray-300 text-xs font-semibold flex items-center justify-between transition-colors"
          >
            <span>Advanced Diagnostics</span>
            <span>{showDiagnostics ? 'Hide' : 'Show'}</span>
          </button>
          {showDiagnostics && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
              <div className="p-3 rounded-xl border border-cyan-400/10 bg-slate-950/50">
                <p className="text-cyan-200/60 uppercase text-[10px] font-bold tracking-wider">User Email</p>
                <p className="text-gray-300 mt-1 break-all">{user?.email || 'Unknown'}</p>
              </div>
              <div className="p-3 rounded-xl border border-cyan-400/10 bg-slate-950/50">
                <p className="text-cyan-200/60 uppercase text-[10px] font-bold tracking-wider">User ID</p>
                <p className="text-gray-300 mt-1">
                  {user?.id ? `${user.id.slice(0, 8)}…${user.id.slice(-6)}` : 'Unknown'}
                </p>
              </div>
              <div className="p-3 rounded-xl border border-cyan-400/10 bg-slate-950/50">
                <p className="text-cyan-200/60 uppercase text-[10px] font-bold tracking-wider">Counts</p>
                <p className="text-gray-300 mt-1">{projects.length} projects · {serviceLogs.length} service logs · {logs.length} field logs</p>
              </div>
            </div>
          )}

          <button
            onClick={() => setShowDangerZone(v => !v)}
            className="w-full px-3 py-2.5 rounded-xl border border-red-900/40 bg-red-950/20 hover:bg-red-950/30 text-red-300 text-xs font-semibold flex items-center justify-between transition-colors"
          >
            <span>Danger Zone</span>
            <span>{showDangerZone ? 'Hide' : 'Show'}</span>
          </button>
          {showDangerZone && (
            <div className="rounded-xl border border-red-900/40 bg-red-950/20 p-3">
              <p className="text-xs text-red-300 mb-2">
                Reset only app settings to defaults. This does not replace the dedicated Restore Points system.
              </p>
              <button
                onClick={onResetDefaults}
                className="w-full px-3 py-2 bg-red-600/30 hover:bg-red-600/40 text-red-300 rounded text-xs font-medium border border-red-500/30"
              >
                Reset Settings to Defaults
              </button>
            </div>
          )}
        </div>
      </div>
    </SettingCard>
  )
}

export default function V15rSettingsPanel() {
  const backup = getBackupData()
  if (!backup) return <NoData />

  const [, setTick] = useState(0)
  const forceUpdate = useCallback(() => setTick(t => t + 1), [])
  const settings = backup.settings || {} as any

  // Auth (for owner role check)
  const { isOwner, user, profile: authProfile } = useAuth()

  const [showBetaInviteModal, setShowBetaInviteModal] = useState(false)
  const [, setHideTick] = useState(0)
  const [scoutScanning, setScoutScanning] = useState(false)
  const [scoutQueueing, setScoutQueueing] = useState(false)
  const [scoutScanMessage, setScoutScanMessage] = useState('')
  const [scoutSuggestions, setScoutSuggestions] = useState<ScoutStagedSuggestion[]>([])
  const [scoutScanHistory, setScoutScanHistory] = useState<ScoutScanHistoryItem[]>(() => loadScoutScanHistory())
  const [scoutScanHistoryVisible, setScoutScanHistoryVisible] = useState(SCOUT_SCAN_HISTORY_PAGE_SIZE)
  const [proposalQueueKey, setProposalQueueKey] = useState(0)
  // Demo Mode store
  const { isDemoMode, enableDemoMode, disableDemoMode } = useDemoStore()
  const [showDemoConfirm, setShowDemoConfirm] = useState(false)
  const [showExitDemoModal, setShowExitDemoModal] = useState(false)
  const [gcalUrlDraft, setGcalUrlDraft] = useState(settings.gcalUrl || '')
  // ── Settings Hub visibility (Phase R1) ────────────────────────────────────
  // Persisted via localStorage key SETTINGS_HUB_VISIBILITY_KEY.
  // Defaults: only Business Setup is visible by default; all other sections
  // start hidden so the Hub opens compact and the user opens what they need.
  const [
    {
      showBusinessSetup,
      showOverheadManager,
      showDataSyncCenter,
      showAdminTools,
      showActiveIntegrations,
      showSecurityCenter,
      showProjectsConfiguration,
      showAIDevelopment,
    },
    setSettingsHubVisibility,
  ] = useState<SettingsHubVisibility>(() => loadSettingsHubVisibility())
  const [glareSyncKey, setGlareSyncKey] = useState(0)
  const [hunterCommandCenterCollapsed, setHunterCommandCenterCollapsed] = useState(() =>
    loadCollapsedState(HUNTER_COMMAND_CENTER_COLLAPSED_KEY)
  )
  useEffect(() => {
    try {
      localStorage.setItem(
        SETTINGS_HUB_VISIBILITY_KEY,
        JSON.stringify({
          showBusinessSetup,
          showOverheadManager,
          showDataSyncCenter,
          showAdminTools,
          showActiveIntegrations,
          showSecurityCenter,
          showProjectsConfiguration,
          showAIDevelopment,
        }),
      )
    } catch {
      /* localStorage may be unavailable (privacy mode); ignore */
    }
  }, [
    showBusinessSetup,
    showOverheadManager,
    showDataSyncCenter,
    showAdminTools,
    showActiveIntegrations,
    showSecurityCenter,
    showProjectsConfiguration,
    showAIDevelopment,
  ])
  useEffect(() => {
    saveCollapsedState(HUNTER_COMMAND_CENTER_COLLAPSED_KEY, hunterCommandCenterCollapsed)
  }, [hunterCommandCenterCollapsed])
  useEffect(() => {
    setScoutScanHistory(loadScoutScanHistory(authProfile?.org_id))
    setScoutScanHistoryVisible(SCOUT_SCAN_HISTORY_PAGE_SIZE)
  }, [authProfile?.org_id])
  const restartSettingsHubGlare = () => setGlareSyncKey(key => key + 1)
  const setShowBusinessSetup = (next: boolean | ((prev: boolean) => boolean)) => {
    setSettingsHubVisibility(prev => ({ ...prev, showBusinessSetup: typeof next === 'function' ? (next as (p: boolean) => boolean)(prev.showBusinessSetup) : next }))
    restartSettingsHubGlare()
  }
  const setShowOverheadManager = (next: boolean | ((prev: boolean) => boolean)) => {
    setSettingsHubVisibility(prev => ({ ...prev, showOverheadManager: typeof next === 'function' ? (next as (p: boolean) => boolean)(prev.showOverheadManager) : next }))
    restartSettingsHubGlare()
  }
  const setShowDataSyncCenter = (next: boolean | ((prev: boolean) => boolean)) => {
    setSettingsHubVisibility(prev => ({ ...prev, showDataSyncCenter: typeof next === 'function' ? (next as (p: boolean) => boolean)(prev.showDataSyncCenter) : next }))
    restartSettingsHubGlare()
  }
  const setShowAdminTools = (next: boolean | ((prev: boolean) => boolean)) => {
    setSettingsHubVisibility(prev => ({ ...prev, showAdminTools: typeof next === 'function' ? (next as (p: boolean) => boolean)(prev.showAdminTools) : next }))
    restartSettingsHubGlare()
  }
  const setShowActiveIntegrations = (next: boolean | ((prev: boolean) => boolean)) => {
    setSettingsHubVisibility(prev => ({ ...prev, showActiveIntegrations: typeof next === 'function' ? (next as (p: boolean) => boolean)(prev.showActiveIntegrations) : next }))
    restartSettingsHubGlare()
  }
  const setShowSecurityCenter = (next: boolean | ((prev: boolean) => boolean)) => {
    setSettingsHubVisibility(prev => ({ ...prev, showSecurityCenter: typeof next === 'function' ? (next as (p: boolean) => boolean)(prev.showSecurityCenter) : next }))
    restartSettingsHubGlare()
  }
  const setShowProjectsConfiguration = (next: boolean | ((prev: boolean) => boolean)) => {
    setSettingsHubVisibility(prev => ({ ...prev, showProjectsConfiguration: typeof next === 'function' ? (next as (p: boolean) => boolean)(prev.showProjectsConfiguration) : next }))
    restartSettingsHubGlare()
  }
  const setShowAIDevelopment = (next: boolean | ((prev: boolean) => boolean)) => {
    setSettingsHubVisibility(prev => ({ ...prev, showAIDevelopment: typeof next === 'function' ? (next as (p: boolean) => boolean)(prev.showAIDevelopment) : next }))
    restartSettingsHubGlare()
  }
  const runAIDevelopmentScoutScan = useCallback(async () => {
    const orgId = authProfile?.org_id
    if (!orgId || scoutScanning) return

    const usage = loadScoutScanUsage(orgId)
    const remaining = SCOUT_SCAN_LIMIT_PER_24H - usage.length
    if (remaining <= 0) {
      setScoutScanMessage('Scan limit reached: 10 suggestions in 24h.')
      return
    }

    setScoutScanning(true)
    setScoutScanMessage('')
    try {
      const targetCount = Math.min(5, remaining)
      console.info('[Settings] Starting SCOUT suggestion scan', { orgId, targetCount, remaining })
      const result = await generateScoutSuggestions(orgId, { targetCount })
      const staged = result.suggestions.map((proposal, index) => ({
        id: `${result.runId}-${index}`,
        proposal,
        selected: true,
      }))
      setScoutSuggestions(staged)
      saveScoutScanUsage(orgId, [...usage, ...staged.map(() => Date.now())])
      setScoutScanMessage(`Scan complete: ${staged.length} suggestion${staged.length === 1 ? '' : 's'} ready.`)
    } catch (err) {
      console.error('[Settings] SCOUT scan failed:', { orgId, error: err })
      const message = err instanceof Error ? err.message : String(err)
      const compactReason = message.includes('Claude proxy unavailable')
        ? 'Claude proxy unavailable'
        : message.includes('invalid JSON')
          ? 'analyzer returned invalid JSON'
          : 'try again in a moment'
      setScoutScanMessage(`Scan failed: ${compactReason}.`)
    } finally {
      setScoutScanning(false)
    }
  }, [authProfile?.org_id, scoutScanning])
  const toggleScoutSuggestion = useCallback((id: string) => {
    setScoutSuggestions(prev => prev.map(item => item.id === id ? { ...item, selected: !item.selected } : item))
  }, [])

  const addScoutScanHistoryItems = useCallback((orgId: string, items: ScoutScanHistoryItem[]) => {
    setScoutScanHistory(prev => {
      const nextHistory = dedupeScoutScanHistory([...items, ...prev])
      saveScoutScanHistory(orgId, nextHistory)
      return nextHistory
    })
  }, [])

  const makeScoutScanHistoryItem = useCallback((
    orgId: string,
    item: ScoutStagedSuggestion,
    status: ScoutScanHistoryItem['status'],
    reason?: string,
    idSuffix = status,
  ): ScoutScanHistoryItem => ({
    id: `${item.id}-${idSuffix}`,
    orgId,
    title: item.proposal.title,
    reason: reason || item.proposal.reasoning || item.proposal.description,
    category: item.proposal.category,
    impact_score: item.proposal.impact_score,
    risk_score: item.proposal.risk_score,
    status,
    createdAt: new Date().toISOString(),
  }), [])

  const queueScoutSuggestion = useCallback(async (itemId: string) => {
    const orgId = authProfile?.org_id
    if (!orgId || scoutQueueing) return
    const item = scoutSuggestions.find(candidate => candidate.id === itemId)
    if (!item) return

    setScoutQueueing(true)
    try {
      const result = await queueScoutProposal(orgId, item.proposal)
      if (result.passed) {
        setScoutSuggestions(prev => prev.filter(candidate => candidate.id !== itemId))
        setProposalQueueKey(key => key + 1)
        setScoutScanMessage('Suggestion moved to Proposal Queue.')
      } else {
        setScoutSuggestions(prev => prev.filter(candidate => candidate.id !== itemId))
        addScoutScanHistoryItems(orgId, [
          makeScoutScanHistoryItem(orgId, item, 'rejected', result.rejectionReason || 'Rejected by SCOUT verification', result.proposalId || 'rejected'),
        ])
        setScoutScanMessage(`Suggestion rejected by verification: ${result.rejectionReason || 'not approved'}.`)
      }
    } catch (err) {
      console.error('[Settings] Queue SCOUT suggestion failed:', { orgId, error: err })
      setScoutScanMessage('Queue failed: try again in a moment.')
    } finally {
      setScoutQueueing(false)
    }
  }, [authProfile?.org_id, scoutQueueing, scoutSuggestions, addScoutScanHistoryItems, makeScoutScanHistoryItem])

  const dismissScoutSuggestion = useCallback((itemId: string) => {
    const orgId = authProfile?.org_id
    if (!orgId) return
    const item = scoutSuggestions.find(candidate => candidate.id === itemId)
    if (!item) return
    setScoutSuggestions(prev => prev.filter(candidate => candidate.id !== itemId))
    addScoutScanHistoryItems(orgId, [makeScoutScanHistoryItem(orgId, item, 'dismissed')])
    setScoutScanMessage('Suggestion dismissed and saved to Recent Scan History.')
  }, [authProfile?.org_id, scoutSuggestions, addScoutScanHistoryItems, makeScoutScanHistoryItem])

  const moveSelectedScoutSuggestionsToQueue = useCallback(async () => {
    const orgId = authProfile?.org_id
    if (!orgId || scoutQueueing || scoutSuggestions.length === 0) return

    const selected = scoutSuggestions.filter(item => item.selected)
    if (selected.length === 0) {
      setScoutScanMessage('Select at least one suggestion to queue.')
      return
    }

    setScoutQueueing(true)
    try {
      const rejected: ScoutScanHistoryItem[] = []
      const queuedIds: string[] = []
      const rejectedIds: string[] = []

      for (const item of selected) {
        const result = await queueScoutProposal(orgId, item.proposal)
        if (result.passed) queuedIds.push(item.id)
        else {
          rejectedIds.push(item.id)
          rejected.push(makeScoutScanHistoryItem(orgId, item, 'rejected', result.rejectionReason || 'Rejected by SCOUT verification', result.proposalId || 'rejected'))
        }
      }

      if (rejected.length > 0) addScoutScanHistoryItems(orgId, rejected)
      const handledIds = new Set([...queuedIds, ...rejectedIds])
      setScoutSuggestions(prev => prev.filter(item => !handledIds.has(item.id)))
      setProposalQueueKey(key => key + 1)
      setScoutScanMessage(`Moved ${queuedIds.length} to queue${rejected.length ? `, ${rejected.length} rejected by verification` : ''}.`)
    } catch (err) {
      console.error('[Settings] Queue selected SCOUT suggestions failed:', { orgId, error: err })
      setScoutScanMessage('Queue failed: try again in a moment.')
    } finally {
      setScoutQueueing(false)
    }
  }, [authProfile?.org_id, scoutQueueing, scoutSuggestions, addScoutScanHistoryItems, makeScoutScanHistoryItem])
  const [openOverheadCategory, setOpenOverheadCategory] = useState<'essential' | 'extra' | 'loans' | 'vehicle'>('essential')
  const [overheadEntryModes, setOverheadEntryModes] = useState<Record<string, 'monthly' | 'yearly'>>({})

const persist = useCallback((mutatedData?: BackupData) => {
  const data = mutatedData || getBackupData()
  if (data) {
    if (!mutatedData) pushState(data)
    data._lastSavedAt = new Date().toISOString()
    saveBackupDataAndSync(data, 'settings')
    forceUpdate()
  }
}, [forceUpdate])

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
    persist(data)
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
      persist(data)
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
    const confirmed = window.confirm(
      'Import Backup File?\n\nA restore point will be created before import so you can roll back if needed.'
    )
    if (!confirmed) return

    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json'

    input.onchange = async (e: any) => {
      const file = e.target.files?.[0]
      if (!file) return

      try {
        const beforeImportData = getBackupData()

        if (beforeImportData) {
          const snapshot = await createCloudSnapshot(
            `Pre-import restore point — ${new Date().toLocaleString('en-US', {
              month: 'short',
              day: 'numeric',
              hour: 'numeric',
              minute: '2-digit',
              hour12: true,
            })}`,
            beforeImportData as any
          )

          if (snapshot) {
            window.dispatchEvent(new CustomEvent('poweron:snapshots-refresh'))
          }
        }

        const { summary } = await importBackupFromFile(file)

        const syncResult = await forceSyncToCloud()
        forceUpdate()

        const parts = Object.entries(summary.merged)
          .map(([k, v]) => `${v} ${k}`)
          .join(', ')

        const importMsg = summary.total > 0
          ? `Merged: ${parts} — existing data preserved ✓`
          : 'Import complete — no new records found (all duplicates)'

        const syncMsg = syncResult.success
          ? '\n\nLive data synced to Supabase ✓'
          : `\n\nImport completed, but cloud sync failed: ${syncResult.error || 'Unknown error'}`

        alert(importMsg + syncMsg)
      } catch (err) {
        console.error('[DataSyncCenter] Import failed:', err)
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
        opCost: 0,
        salaryTarget: 12000,
        billableHrsYear: 936,
        annualTarget: 120000,
        phaseWeights: { Estimating: 5, Planning: 10, 'Site Prep': 15, 'Rough-in': 35, Finish: 25, Trim: 10 },
        mtoPhases: [...DEFAULT_PROJECT_PHASES],
        overhead: { essential: [], extra: [], loans: [], vehicle: [] },
        gcalUrl: '',
      } as any
      persist(data)
      alert('Settings reset ✓')
    }
  }, [persist])

  const handleUpdateGoogleCalendarUrl = useCallback(() => {
    const data = getBackupData()
    if (data) {
      pushState(data)
      data.settings.gcalUrl = gcalUrlDraft
      persist(data)
    }
  }, [gcalUrlDraft, persist])

  const effectivePhaseWeights = getPhaseWeights(backup)
  const workflowPhasesForList = getProjectPhaseNames(backup)
  const phaseWeights = effectivePhaseWeights
  const mtoPhases = workflowPhasesForList
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
  const connectedIntegrations = 1 + (settings.gcalUrl ? 1 : 0)
  const isAdminOwner = user?.email === 'christian@poweronsolutionsllc.com'

  const phaseWeightTotal = Object.values(phaseWeights).reduce((s: number, v: any) => s + num(v), 0)

  // Theme handling
  const currentTheme = settings.theme || 'dark'
  const brandName = settings.company || 'My Company'
  const brandPreviewLogo = currentTheme === 'dark'
    ? settings.logoDark || settings.logoLight
    : settings.logoLight || settings.logoDark
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
      // G3 fix: dispatch storage event so V15rLayout refreshes its backupData
      // (same-tab storage events don't fire automatically)
      window.dispatchEvent(new Event('storage'))
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

  const hasWideExpandedPanel =
    (isAdminOwner && showAdminTools) ||
    showActiveIntegrations ||
    showBusinessSetup ||
    showOverheadManager ||
    showProjectsConfiguration ||
    showAIDevelopment ||
    showDataSyncCenter
  const hasCompactExpandedPanel = showBusinessSetup || showSecurityCenter
  const expandedLayoutClass = hasWideExpandedPanel && hasCompactExpandedPanel
    ? 'grid grid-cols-1 xl:grid-cols-[minmax(0,1.85fr)_minmax(320px,1fr)] gap-6 items-start'
    : 'grid grid-cols-1 gap-6 items-start'
  const compactColumnClass = hasWideExpandedPanel && hasCompactExpandedPanel
    ? 'space-y-6 xl:sticky xl:top-6'
    : 'space-y-6 xl:max-w-[520px]'

  return (
    <div className="min-h-screen p-6 space-y-6" style={{ backgroundColor: 'var(--bg-secondary)' }}>
      {/* Phase R1: synchronized diagonal glare sweep — local keyframes.
          The sweep runs across the full GLARE_ANIMATION_MS period; cards mounted
          mid-cycle use a negative animation-delay (see getSyncedGlareDelay) so
          every open card animates in lockstep. */}
      <style>{`
        @keyframes poweron-glare-sweep {
          0%   { transform: translateX(-120%) skewX(-18deg); opacity: 0; }
          12%  { opacity: 0.75; }
          50%  { opacity: 0.55; }
          88%  { opacity: 0; }
          100% { transform: translateX(220%) skewX(-18deg); opacity: 0; }
        }
        .poweron-glare-sweep::before {
          content: '';
          position: absolute;
          top: 0;
          bottom: 0;
          left: 0;
          width: 38%;
          background: linear-gradient(
            115deg,
            rgba(255, 255, 255, 0) 0%,
            rgba(165, 243, 252, 0.12) 35%,
            rgba(207, 250, 254, 0.45) 50%,
            rgba(165, 243, 252, 0.12) 65%,
            rgba(255, 255, 255, 0) 100%
          );
          filter: blur(0.5px);
          animation-name: poweron-glare-sweep;
          animation-duration: ${GLARE_ANIMATION_MS}ms;
          animation-timing-function: cubic-bezier(0.45, 0.05, 0.55, 0.95);
          animation-iteration-count: infinite;
          animation-delay: inherit;
          will-change: transform, opacity;
        }
        @media (prefers-reduced-motion: reduce) {
          .poweron-glare-sweep::before { animation: none; opacity: 0; }
        }
      `}</style>
      {/* HEADER */}
      <div className="mb-8 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Settings size={32} className="text-blue-400" />
          <div>
            <h1 className="text-3xl font-bold text-gray-100">Settings Hub</h1>
            <p className="text-gray-500 text-sm mt-1">Business identity, overhead, sync, and configuration</p>
          </div>
        </div>
        {isAdminOwner && (
          <button
            type="button"
            onClick={() => setShowAdminTools(v => !v)}
            className="flex items-center gap-2 rounded-full border border-cyan-400/25 bg-slate-950/70 px-4 py-2 text-xs font-semibold text-cyan-200 shadow-lg shadow-blue-950/20 transition-colors hover:bg-cyan-400/10"
          >
            <span className={`h-2.5 w-2.5 rounded-full ${showAdminTools ? 'bg-emerald-300 shadow-[0_0_12px_rgba(52,211,153,0.75)] animate-pulse' : 'bg-gray-600'}`} />
            <Shield size={14} />
            {showAdminTools ? 'Admin Tools On' : 'Admin Tools Off'}
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4 items-stretch">
        <div className="relative flex h-full flex-col rounded-2xl border border-cyan-400/20 bg-gradient-to-br from-slate-900 via-slate-950 to-blue-950/70 p-4 shadow-lg shadow-blue-950/20 overflow-hidden">
          <GlareOverlay key={`business-${glareSyncKey}`} active={showBusinessSetup} resetKey={glareSyncKey} />
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-cyan-300/80">Business Profile</p>
              <h3 className="mt-2 text-base font-bold text-gray-100 truncate">{settings.company || 'My Company'}</h3>
            </div>
            <div className="rounded-xl border border-cyan-400/25 bg-cyan-400/10 p-2 text-cyan-300">
              <BookOpen size={18} />
            </div>
          </div>
          <div className="mt-4 space-y-1 text-xs text-gray-400">
            <p className="truncate">License: <span className="text-gray-200">{settings.license || 'Not set'}</span></p>
            <p>OH Rate: <span className="text-gray-200">{fmt(num(settings.defaultOHRate || overheadCalc.costPerHr || 0))}/hr</span></p>
          </div>
          <div className="mt-auto pt-4 flex flex-col gap-3">
            <span className={`self-start rounded-full border px-2 py-1 text-[10px] font-semibold ${showBusinessSetup ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-200' : 'border-gray-700 bg-gray-800/60 text-gray-500'}`}>
              {showBusinessSetup ? 'Setup visible' : 'Setup hidden'}
            </span>
            <button
              type="button"
              onClick={() => setShowBusinessSetup(v => !v)}
              className="w-full rounded-lg border border-cyan-400/25 bg-cyan-400/10 px-3 py-2 text-xs font-semibold text-cyan-200 hover:bg-cyan-400/15 transition-colors"
            >
              {showBusinessSetup ? 'Hide Business Setup' : 'Show Business Setup'}
            </button>
          </div>
        </div>

        <div className="relative flex h-full flex-col rounded-2xl border border-blue-400/20 bg-gradient-to-br from-slate-900 via-slate-950 to-blue-950/70 p-4 shadow-lg shadow-blue-950/20 overflow-hidden">
          <GlareOverlay key={`overhead-${glareSyncKey}`} active={showOverheadManager} resetKey={glareSyncKey} />
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-blue-300/80">Overhead Target</p>
              <h3 className="mt-2 text-base font-bold text-gray-100">{fmt(overheadCalc.monthlyTotal)}/mo</h3>
            </div>
            <div className="rounded-xl border border-blue-400/25 bg-blue-400/10 p-2 text-blue-300">
              <Target size={18} />
            </div>
          </div>
          <div className="mt-4 space-y-1 text-xs text-gray-400">
            <p>Annual: <span className="text-gray-200">{fmt(overheadCalc.annualTotal)}</span></p>
            <p>Real Cost/Hr: <span className="text-gray-200">{fmt(overheadCalc.costPerHr)}</span></p>
          </div>
          <div className="mt-auto pt-4 flex flex-col gap-3">
            <span className={`self-start rounded-full border px-2 py-1 text-[10px] font-semibold ${showOverheadManager ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-200' : 'border-gray-700 bg-gray-800/60 text-gray-500'}`}>
              {showOverheadManager ? 'Manager visible' : 'Manager hidden'}
            </span>
            <button
              type="button"
              onClick={() => setShowOverheadManager(v => !v)}
              className="w-full rounded-lg border border-blue-400/25 bg-blue-400/10 px-3 py-2 text-xs font-semibold text-blue-200 hover:bg-blue-400/15 transition-colors"
            >
              {showOverheadManager ? 'Hide Overhead Manager' : 'Show Overhead Manager'}
            </button>
          </div>
        </div>

        <div className="relative flex h-full flex-col rounded-2xl border border-emerald-400/20 bg-gradient-to-br from-slate-900 via-slate-950 to-cyan-950/60 p-4 shadow-lg shadow-blue-950/20 overflow-hidden">
          <GlareOverlay key={`data-sync-${glareSyncKey}`} active={showDataSyncCenter} resetKey={glareSyncKey} />
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-emerald-300/80">Data Sync Health</p>
              <h3 className="mt-2 text-base font-bold text-gray-100">{supabaseUp ? '98%' : 'Local'}</h3>
            </div>
            <div className="rounded-xl border border-emerald-400/25 bg-emerald-400/10 p-2 text-emerald-300">
              <RefreshCw size={18} />
            </div>
          </div>
          <div className="mt-4 space-y-1 text-xs text-gray-400">
            <p>{supabaseUp ? 'Cloud ready' : 'Supabase not configured'}</p>
            <p className="truncate">Last sync: <span className="text-gray-200">{lastSync}</span></p>
          </div>
          <div className="mt-auto pt-4 flex flex-col gap-3">
            <span className={`self-start rounded-full border px-2 py-1 text-[10px] font-semibold ${showDataSyncCenter ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-200' : 'border-gray-700 bg-gray-800/60 text-gray-500'}`}>
              {showDataSyncCenter ? 'Sync center visible' : 'Sync center hidden'}
            </span>
            <button
              type="button"
              onClick={() => setShowDataSyncCenter(v => !v)}
              className="w-full rounded-lg border border-emerald-400/25 bg-emerald-400/10 px-3 py-2 text-xs font-semibold text-emerald-200 hover:bg-emerald-400/15 transition-colors"
            >
              {showDataSyncCenter ? 'Hide Data & Sync Center' : 'Show Data & Sync Center'}
            </button>
          </div>
        </div>

        <div className="relative flex h-full flex-col rounded-2xl border border-sky-400/20 bg-gradient-to-br from-slate-900 via-slate-950 to-blue-950/70 p-4 shadow-lg shadow-blue-950/20 overflow-hidden">
          <GlareOverlay key={`integrations-${glareSyncKey}`} active={showActiveIntegrations} resetKey={glareSyncKey} />
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-sky-300/80">Active Integrations</p>
              <h3 className="mt-2 text-base font-bold text-gray-100">{connectedIntegrations}/4</h3>
            </div>
            <div className="rounded-xl border border-sky-400/25 bg-sky-400/10 p-2 text-sky-300">
              <Zap size={18} />
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-1.5 text-[10px] font-semibold">
            <span className="rounded-full border border-cyan-400/20 bg-cyan-400/10 px-2 py-1 text-cyan-200">QuickBooks</span>
            <span className={`rounded-full border px-2 py-1 ${settings.gcalUrl ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-200' : 'border-gray-700 bg-gray-800/60 text-gray-500'}`}>Google Calendar</span>
          </div>
          {false && (
          <div className="mt-4 rounded-xl border border-sky-400/20 bg-sky-950/30 p-3">
            <label className="block text-[10px] font-semibold uppercase tracking-wider text-sky-200/80 mb-2">
              Google Calendar Embed Code / URL
            </label>
            <textarea
              value={gcalUrlDraft}
              onChange={(e) => setGcalUrlDraft(e.target.value)}
              placeholder="Paste Google Calendar embed URL"
              className="w-full h-16 px-3 py-2 rounded-lg border border-sky-400/20 bg-slate-950/70 text-xs text-gray-100 placeholder:text-gray-600 resize-none focus:border-sky-400/50 focus:outline-none"
            />
            <p className="mt-2 text-[10px] leading-snug text-gray-500">
              Google Calendar → Settings → Integrate calendar → copy the embed code or public URL, then paste it here to render your calendar.
            </p>
            <button
              type="button"
              onClick={handleUpdateGoogleCalendarUrl}
              className="mt-3 w-full rounded-lg border border-sky-400/25 bg-sky-400/10 px-3 py-2 text-xs font-semibold text-sky-200 hover:bg-sky-400/15 transition-colors"
            >
              Update URL
            </button>
          </div>
          )}
          <div className="mt-auto pt-4 flex flex-col gap-3">
            <span className={`self-start rounded-full border px-2 py-1 text-[10px] font-semibold ${showActiveIntegrations ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-200' : 'border-gray-700 bg-gray-800/60 text-gray-500'}`}>
              {showActiveIntegrations ? 'Integrations visible' : 'Integrations hidden'}
            </span>
            <button
              type="button"
              onClick={() => setShowActiveIntegrations(v => !v)}
              className="w-full rounded-lg border border-sky-400/25 bg-sky-400/10 px-3 py-2 text-xs font-semibold text-sky-200 hover:bg-sky-400/15 transition-colors"
            >
              {showActiveIntegrations ? 'Hide Integrations' : 'Show Integrations'}
            </button>
          </div>
        </div>

        <div className="relative flex h-full flex-col rounded-2xl border border-indigo-400/20 bg-gradient-to-br from-slate-900 via-slate-950 to-indigo-950/70 p-4 shadow-lg shadow-blue-950/20 overflow-hidden">
          <GlareOverlay key={`security-${glareSyncKey}`} active={showSecurityCenter} resetKey={glareSyncKey} />
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-indigo-300/80">Security Status</p>
              <h3 className="mt-2 text-base font-bold text-gray-100">Locked</h3>
            </div>
            <div className="rounded-xl border border-indigo-400/25 bg-indigo-400/10 p-2 text-indigo-300">
              <Lock size={18} />
            </div>
          </div>
          <div className="mt-4 space-y-1 text-xs text-gray-400">
            <p>App secured</p>
            <p className="text-gray-500">Passcode protection enabled</p>
          </div>
          <div className="mt-auto pt-4 flex flex-col gap-3">
            <span className={`self-start rounded-full border px-2 py-1 text-[10px] font-semibold ${showSecurityCenter ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-200' : 'border-gray-700 bg-gray-800/60 text-gray-500'}`}>
              {showSecurityCenter ? 'Security center visible' : 'Security center hidden'}
            </span>
            <button
              type="button"
              onClick={() => setShowSecurityCenter(v => !v)}
              className="w-full rounded-lg border border-indigo-400/25 bg-indigo-400/10 px-3 py-2 text-xs font-semibold text-indigo-200 hover:bg-indigo-400/15 transition-colors"
            >
              {showSecurityCenter ? 'Hide Security Center' : 'Show Security Center'}
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-stretch">
        <div className="relative flex h-full flex-col rounded-2xl border border-cyan-400/20 bg-gradient-to-br from-slate-900 via-slate-950 to-cyan-950/60 p-4 shadow-lg shadow-blue-950/20 overflow-hidden">
          <GlareOverlay key={`projects-${glareSyncKey}`} active={showProjectsConfiguration} resetKey={glareSyncKey} />
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-cyan-300/80">Projects Configuration</p>
              <h3 className="mt-2 text-base font-bold text-gray-100">Project workflow setup</h3>
            </div>
            <div className="rounded-xl border border-cyan-400/25 bg-cyan-400/10 p-2 text-cyan-300">
              <BarChart2 size={18} />
            </div>
          </div>
          <p className="mt-4 text-xs leading-relaxed text-gray-400">
            Phase weights, MTO phases, and project workflow setup
          </p>
          <div className="mt-auto pt-4 flex flex-col gap-3">
            <span className={`self-start rounded-full border px-2 py-1 text-[10px] font-semibold ${showProjectsConfiguration ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-200' : 'border-gray-700 bg-gray-800/60 text-gray-500'}`}>
              {showProjectsConfiguration ? 'Project setup visible' : 'Project setup hidden'}
            </span>
            <button
              type="button"
              onClick={() => setShowProjectsConfiguration(v => !v)}
              className="w-full rounded-lg border border-cyan-400/25 bg-cyan-400/10 px-3 py-2 text-xs font-semibold text-cyan-200 hover:bg-cyan-400/15 transition-colors"
            >
              {showProjectsConfiguration ? 'Hide Projects Configuration' : 'Show Projects Configuration'}
            </button>
          </div>
        </div>

        <div className="relative flex h-full flex-col rounded-2xl border border-sky-400/20 bg-gradient-to-br from-slate-900 via-slate-950 to-blue-950/70 p-4 shadow-lg shadow-blue-950/20 overflow-hidden">
          <GlareOverlay key={`ai-${glareSyncKey}`} active={showAIDevelopment} resetKey={glareSyncKey} />
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-sky-300/80">AI Development</p>
              <h3 className="mt-2 text-base font-bold text-gray-100">AI Development</h3>
            </div>
            <div className="rounded-xl border border-sky-400/25 bg-sky-400/10 p-2 text-sky-300">
              <Sparkles size={18} />
            </div>
          </div>
          <p className="mt-4 text-xs leading-relaxed text-gray-400">
            Proposals, NEXUS profile, voice, and skill intelligence
          </p>
          <div className="mt-auto pt-4 flex flex-col gap-3">
            <span className={`self-start rounded-full border px-2 py-1 text-[10px] font-semibold ${showAIDevelopment ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-200' : 'border-gray-700 bg-gray-800/60 text-gray-500'}`}>
              {showAIDevelopment ? 'AI tools visible' : 'AI tools hidden'}
            </span>
            <button
              type="button"
              onClick={() => setShowAIDevelopment(v => !v)}
              className="w-full rounded-lg border border-sky-400/25 bg-sky-400/10 px-3 py-2 text-xs font-semibold text-sky-200 hover:bg-sky-400/15 transition-colors"
            >
              {showAIDevelopment ? 'Hide AI Development' : 'Show AI Development'}
            </button>
          </div>
        </div>
      </div>

      <div className={expandedLayoutClass}>
        <div className="space-y-6">
          {/* HUNTER Operations — Home Base + cron run status */}
          {isAdminOwner && showAdminTools && (
          <SettingCard title="HUNTER Operations">
            <div className="rounded-2xl border border-cyan-400/15 bg-gradient-to-br from-slate-950/95 via-blue-950/30 to-slate-950/90 p-5 shadow-2xl shadow-cyan-950/20">
              <div className={`flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between ${hunterCommandCenterCollapsed ? '' : 'mb-5 border-b border-cyan-400/10 pb-4'}`}>
                <div>
                  <button
                    type="button"
                    onClick={() => setHunterCommandCenterCollapsed(value => !value)}
                    className="group flex min-w-0 items-center gap-2 text-left"
                    aria-expanded={!hunterCommandCenterCollapsed}
                  >
                    <span className="rounded-lg border border-cyan-400/15 bg-cyan-400/10 p-1 text-cyan-200 transition-colors group-hover:border-cyan-400/35">
                      {hunterCommandCenterCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                    </span>
                    <h3 className="text-lg font-bold text-cyan-50">HUNTER Command Center</h3>
                  </button>
                  <p className="mt-1 text-sm text-slate-400">Home base, lead radius, and scheduled source runs.</p>
                </div>
                <span className="w-fit rounded-full border border-cyan-400/20 bg-cyan-400/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-cyan-200">
                  Admin tools
                </span>
              </div>

              {!hunterCommandCenterCollapsed && (
              <div className="flex flex-col gap-4">
                <div className="rounded-2xl border border-cyan-400/10 bg-slate-950/70 p-4 shadow-inner shadow-blue-950/30">
                  <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-cyan-200/80">
                    Home Base
                  </h4>
                  <HomeBaseSettings />
                </div>

                <div className="rounded-2xl border border-cyan-400/10 bg-slate-950/70 p-4 shadow-inner shadow-blue-950/30">
                  <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-cyan-200/80">
                    Cron Run Status
                  </h4>
                  <div className="[&_button]:mb-2 [&_button]:rounded-xl [&_button]:border [&_button]:border-cyan-400/10 [&_button]:bg-slate-950/60 [&_button]:shadow-sm [&_button]:shadow-blue-950/20 [&_button:hover]:bg-cyan-400/10 [&_svg]:shrink-0 [&_span]:tabular-nums [&_span.font-medium]:text-cyan-50">
                    <CronStatusPanel />
                  </div>
                </div>
              </div>
              )}
            </div>

            <div className="mt-4">
              <SolarEstimateSettingsPanel />
            </div>
          </SettingCard>
          )}

          {/* ACTIVE INTEGRATIONS */}
          {showActiveIntegrations && (
          <SettingCard title="Active Integrations">
            <div className="space-y-4 rounded-2xl border border-sky-400/15 bg-gradient-to-br from-slate-950/70 via-blue-950/20 to-slate-950/80 p-4 shadow-2xl shadow-blue-950/25">
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                <div className="rounded-xl border border-sky-400/15 bg-slate-950/60 p-4 shadow-inner shadow-blue-950/20">
                  <div className="flex items-center justify-between gap-3 border-b border-sky-400/10 pb-3 mb-3">
                    <div>
                      <h3 className="text-sm font-bold text-gray-100">Google Calendar</h3>
                      <p className="text-xs text-gray-500 mt-0.5">Render your public calendar inside PowerOn.</p>
                    </div>
                    <span className={`rounded-full border px-2 py-1 text-[11px] font-semibold ${settings.gcalUrl ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-200' : 'border-gray-700 bg-gray-800/60 text-gray-500'}`}>
                      {settings.gcalUrl ? 'Connected' : 'Not connected'}
                    </span>
                  </div>
                  <label className="block text-[10px] font-semibold uppercase tracking-wider text-sky-200/80 mb-2">
                    Google Calendar Embed Code / URL
                  </label>
                  <textarea
                    value={gcalUrlDraft}
                    onChange={(e) => setGcalUrlDraft(e.target.value)}
                    placeholder="Paste Google Calendar embed URL"
                    className="w-full h-20 px-3 py-2 rounded-lg border border-sky-400/20 bg-slate-950/70 text-xs text-gray-100 placeholder:text-gray-600 resize-none focus:border-sky-400/50 focus:outline-none"
                  />
                  <p className="mt-2 text-[10px] leading-snug text-gray-500">
                    Google Calendar → Settings → Integrate calendar → copy the embed code or public URL, then paste it here to render your calendar.
                  </p>
                  <button
                    type="button"
                    onClick={handleUpdateGoogleCalendarUrl}
                    className="mt-3 w-full rounded-lg border border-sky-400/25 bg-sky-400/10 px-3 py-2 text-xs font-semibold text-sky-200 hover:bg-sky-400/15 transition-colors"
                  >
                    Update URL
                  </button>
                </div>

                <div className="rounded-xl border border-cyan-400/15 bg-slate-950/60 p-4 shadow-inner shadow-blue-950/20">
                  <div className="flex items-center justify-between gap-3 border-b border-cyan-400/10 pb-3 mb-3">
                    <div>
                      <h3 className="text-sm font-bold text-gray-100">AI Agent / Anthropic</h3>
                      <p className="text-xs text-gray-500 mt-0.5">Supports PDF extraction, estimate review, and profit analysis.</p>
                    </div>
                    <span className={`rounded-full border px-2 py-1 text-[11px] font-semibold ${(import.meta.env.DEV ? import.meta.env.VITE_ANTHROPIC_API_KEY : true) ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-200' : 'border-red-400/20 bg-red-500/10 text-red-200'}`}>
                      {(import.meta.env.DEV ? import.meta.env.VITE_ANTHROPIC_API_KEY : true) ? 'Configured' : 'Not configured'}
                    </span>
                  </div>
                  <div className="rounded-lg border border-cyan-400/10 bg-slate-950/70 p-3">
                    <p className="text-sm text-gray-300 mb-2">Anthropic API Key</p>
                    <div className="flex items-center gap-3">
                      <div className={`w-3 h-3 rounded-full ${(import.meta.env.DEV ? import.meta.env.VITE_ANTHROPIC_API_KEY : true) ? 'bg-green-500' : 'bg-red-500'}`}></div>
                      <span className="text-xs text-gray-400">
                        {(import.meta.env.DEV ? import.meta.env.VITE_ANTHROPIC_API_KEY : true) ? 'Configured — QuickBooks PDF import enabled' : 'Not configured — set VITE_ANTHROPIC_API_KEY in .env'}
                      </span>
                    </div>
                  </div>
                  <p className="mt-3 text-xs text-gray-500 italic">AI features require VITE_ANTHROPIC_API_KEY in environment variables.</p>
                </div>

                <div className="rounded-xl border border-blue-400/15 bg-slate-950/60 p-4 shadow-inner shadow-blue-950/20">
                  <div className="flex items-center justify-between gap-3 border-b border-blue-400/10 pb-3 mb-3">
                    <div>
                      <h3 className="text-sm font-bold text-gray-100">QuickBooks Integration</h3>
                      <p className="text-xs text-gray-500 mt-0.5">API sync foundation for invoices and estimates.</p>
                    </div>
                    <span className="rounded-full border border-yellow-400/20 bg-yellow-500/10 px-2 py-1 text-[11px] font-semibold text-yellow-200">Coming soon</span>
                  </div>
                  <div className="flex items-center gap-3 rounded-lg border border-blue-400/10 bg-slate-950/70 p-3">
                    <div className="w-3 h-3 rounded-full bg-yellow-500"></div>
                    <div>
                      <p className="text-sm font-semibold text-gray-300">Not connected — PDF import available</p>
                      <p className="text-xs text-gray-500 mt-1">Connect your QuickBooks account to automatically sync invoices and estimates. Requires QuickBooks Online API setup.</p>
                    </div>
                  </div>
                  <button
                    disabled
                    className="mt-3 w-full px-3 py-2 rounded text-xs font-medium border transition flex items-center justify-center gap-2 opacity-50 cursor-not-allowed"
                    style={{ backgroundColor: 'rgba(99,102,241,0.1)', color: '#818cf8', borderColor: 'rgba(99,102,241,0.2)' }}
                  >
                    Connect QuickBooks — Coming in V3
                  </button>
                  <p className="mt-2 text-[10px] text-gray-600 italic">
                    OAuth 2.0 flow via Intuit platform. Set VITE_QUICKBOOKS_CLIENT_ID and VITE_QUICKBOOKS_CLIENT_SECRET in .env to enable.
                  </p>
                </div>

                <div className="rounded-xl border border-indigo-400/15 bg-slate-950/60 p-4 shadow-inner shadow-blue-950/20">
                  <div className="flex items-center justify-between gap-3 border-b border-indigo-400/10 pb-3 mb-3">
                    <div>
                      <h3 className="text-sm font-bold text-gray-100">QuickBooks Batch Import</h3>
                      <p className="text-xs text-gray-500 mt-0.5">Extract invoice and estimate PDFs into PowerOn records.</p>
                    </div>
                    <span className="rounded-full border border-cyan-400/20 bg-cyan-400/10 px-2 py-1 text-[11px] font-semibold text-cyan-100">PDF import</span>
                  </div>
                  <QuickBooksBatchImport persist={persist} forceUpdate={forceUpdate} embedded />
                </div>
              </div>
            </div>
          </SettingCard>
          )}

          {showBusinessSetup && (
          <>
          {/* 1. GENERAL / BUSINESS IDENTITY */}
          <SettingCard title="General / Business Identity">
            <div className="space-y-4 rounded-2xl border border-cyan-400/15 bg-gradient-to-br from-slate-950/70 via-blue-950/20 to-slate-950/80 p-4 shadow-2xl shadow-blue-950/25 [&_input]:h-9 [&_input]:border-cyan-400/20 [&_input]:bg-slate-950/70 [&_input]:text-gray-100 [&_input]:focus:border-cyan-300/60">
              <div className="rounded-xl border border-cyan-400/10 bg-slate-950/55 p-4">
                <div className="flex items-center justify-between gap-3 border-b border-cyan-400/10 pb-3 mb-3">
                  <div>
                    <h3 className="text-sm font-bold text-gray-100">Business profile</h3>
                    <p className="text-xs text-gray-500 mt-0.5">Core business identity used across app documents.</p>
                  </div>
                  <span className="rounded-full border border-cyan-400/20 bg-cyan-400/10 px-2 py-1 text-[11px] font-semibold text-cyan-100">Identity</span>
                </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
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
                      persist(data)
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
                      persist(data)
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
                      persist(data)
                    }
                  }}
                  className="w-full px-3 py-2 border rounded text-sm focus:border-blue-500 focus:outline-none theme-input"
                />
              </div>
              </div>
              </div>

              <div className="rounded-xl border border-cyan-400/10 bg-slate-950/55 p-4">
                <div className="flex items-center justify-between gap-3 border-b border-cyan-400/10 pb-3 mb-3">
                  <div>
                    <h3 className="text-sm font-bold text-gray-100">Rates & pricing</h3>
                    <p className="text-xs text-gray-500 mt-0.5">Hourly, mileage, markup, tax, and waste defaults.</p>
                  </div>
                  <span className="rounded-full border border-blue-400/20 bg-blue-400/10 px-2 py-1 text-[11px] font-semibold text-blue-100">Pricing</span>
                </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase mb-2">Bill Rate ($/hr)</label>
                  <input
                    type="number"
                    value={settings.billRate || 95}
                    onChange={(e) => {
                      const data = getBackupData()
                      if (data) {
                        pushState(data)
                        data.settings.billRate = parseFloat(e.target.value) || 95
                        persist(data)
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
                        persist(data)
                      }
                    }}
                    className="w-full px-3 py-2 border rounded text-sm theme-input"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase mb-2">Owner Labor Cost ($/hr)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={settings.opCost || ''}
                    onChange={(e) => {
                      const data = getBackupData()
                      if (data) {
                        pushState(data)
                        data.settings.opCost = parseFloat(e.target.value) || 0
                        persist(data)
                      }
                    }}
                    className="w-full px-3 py-2 border rounded text-sm theme-input"
                  />
                </div>
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
                        persist(data)
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
                        persist(data)
                      }
                    }}
                    className="w-full px-3 py-2 border rounded text-sm theme-input"
                  />
                </div>
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
                        persist(data)
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
                        persist(data)
                      }
                    }}
                    className="w-full px-3 py-2 border rounded text-sm theme-input"
                  />
                </div>
              </div>
              </div>

              <div className="rounded-xl border border-cyan-400/10 bg-slate-950/55 p-4">
                <div className="flex items-center justify-between gap-3 border-b border-cyan-400/10 pb-3 mb-3">
                  <div>
                    <h3 className="text-sm font-bold text-gray-100">Targets</h3>
                    <p className="text-xs text-gray-500 mt-0.5">Daily, annual, and schedule planning targets.</p>
                  </div>
                  <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2 py-1 text-[11px] font-semibold text-emerald-100">Goals</span>
                </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
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
                        persist(data)
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
                        persist(data)
                      }
                    }}
                    className="w-full px-3 py-2 border rounded text-sm theme-input"
                  />
                </div>
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
                        persist(data)
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
                        persist(data)
                      }
                    }}
                    className="w-full px-3 py-2 border rounded text-sm theme-input"
                  />
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
                      persist(data)
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
                      persist(data)
                    }
                  }}
                  className="w-full px-3 py-2 border rounded text-sm theme-input"
                />
              </div>
              </div>
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
                  <div className="rounded-xl border border-cyan-400/10 bg-gradient-to-br from-slate-950/70 to-cyan-950/20 p-4">
                    <div className="flex items-center justify-between gap-3 border-b border-cyan-400/10 pb-3 mb-3">
                      <div>
                        <h3 className="text-sm font-bold text-gray-100">Progress</h3>
                        <p className="text-xs text-gray-500 mt-0.5">Year-to-date revenue against the annual target.</p>
                      </div>
                      <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2 py-1 text-[11px] font-semibold text-emerald-100">{ytdPct}%</span>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-gray-500 uppercase mb-2">YTD Revenue</label>
                      <div className="w-full px-3 py-2 border border-cyan-400/20 rounded-lg text-sm font-semibold bg-slate-950/70 text-gray-100">
                        ${(ytdRevenue / 1000).toFixed(1)}k
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-gray-500 uppercase mb-2">Progress to Target</label>
                      <div className="w-full flex items-center gap-2 rounded-lg p-3 border border-cyan-400/20 bg-slate-950/70">
                        <div className="flex-1 h-3 bg-slate-800 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-gradient-to-r from-emerald-400 to-cyan-400 transition-all"
                            style={{ width: `${ytdPct}%` }}
                          />
                        </div>
                        <span className="text-sm font-semibold text-gray-300 w-12 text-right">{ytdPct}%</span>
                      </div>
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
                  <div className="rounded-xl border border-cyan-400/10 bg-slate-950/55 p-4">
                    <div className="flex items-center justify-between gap-3 border-b border-cyan-400/10 pb-3 mb-3">
                      <div>
                        <h3 className="text-sm font-bold text-gray-100">Personal Income Goal</h3>
                        <p className="text-xs text-gray-500 mt-0.5">Revenue needed to support owner income after overhead.</p>
                      </div>
                      <span className={`rounded-full border px-2 py-1 text-[11px] font-semibold ${isOnPace ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-100' : 'border-amber-400/25 bg-amber-400/10 text-amber-100'}`}>
                        {isOnPace ? 'On pace' : 'Watch pace'}
                      </span>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
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
                      <div className="w-full px-3 py-2 border border-cyan-400/20 rounded-lg text-sm font-semibold bg-slate-950/70 text-gray-100">
                        {personalIncomeGoal > 0 ? fmt(requiredMonthlyRevenue) : '—'}
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-gray-500 uppercase mb-2">Current Monthly Pace</label>
                      <div className={`w-full px-3 py-2 border rounded-lg text-sm font-semibold ${isOnPace ? 'bg-emerald-900/20 border-emerald-500/30 text-emerald-200' : 'bg-amber-900/20 border-amber-500/30 text-amber-200'}`}>
                        {monthsElapsed > 0 ? fmt(currentMonthlyPace) : '—'}
                      </div>
                    </div>
                    </div>
                  </div>
                )
              })()}
            </div>
          </SettingCard>
          </>
          )}

          {/* 2. OVERHEAD MANAGER */}
          {showOverheadManager && (
          <SettingCard title="Overhead Manager">
            <div className="space-y-5 rounded-2xl border border-cyan-400/15 bg-gradient-to-br from-slate-950/70 via-blue-950/20 to-slate-950/80 p-4 shadow-2xl shadow-blue-950/25">
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
                {(['essential', 'extra', 'loans', 'vehicle'] as const).map((key) => {
                  const categoryItems = overhead[key] || []
                  const total = fmt(num(Object.values(categoryItems).reduce((s: number, i: any) => s + num(i.monthly), 0)))
                  const isOpen = openOverheadCategory === key
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setOpenOverheadCategory(key)}
                      className={`rounded-xl border p-4 text-left transition-colors ${
                        isOpen
                          ? 'border-cyan-300/50 bg-cyan-400/10 shadow-lg shadow-cyan-950/20'
                          : 'border-cyan-400/15 bg-slate-950/60 hover:bg-slate-900/70'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <p className="text-sm font-bold text-gray-100 capitalize">{key}</p>
                        {isOpen && (
                          <span className="rounded-full border border-cyan-400/25 bg-cyan-400/10 px-2 py-0.5 text-[10px] font-semibold text-cyan-100">Open</span>
                        )}
                      </div>
                      <p className="text-xl font-bold text-cyan-100 mt-2">{total}</p>
                      <p className="text-xs text-gray-400 mt-2">{categoryItems.length} expense{categoryItems.length === 1 ? '' : 's'}</p>
                    </button>
                  )
                })}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="rounded-xl border border-cyan-400/15 bg-slate-950/60 p-3 shadow-inner shadow-blue-950/20">
                  <p className="text-[10px] uppercase tracking-wider text-cyan-200/60 font-bold">Monthly Overhead</p>
                  <p className="mt-1 text-lg font-bold text-cyan-100">{fmt(overheadCalc.monthlyTotal)}</p>
                </div>
                <div className="rounded-xl border border-blue-400/15 bg-blue-950/20 p-3 shadow-inner shadow-blue-950/20">
                  <p className="text-[10px] uppercase tracking-wider text-blue-200/60 font-bold">Annual Overhead</p>
                  <p className="mt-1 text-lg font-bold text-blue-100">{fmt(overheadCalc.annualTotal)}</p>
                </div>
                <div className="rounded-xl border border-emerald-400/15 bg-emerald-950/15 p-3 shadow-inner shadow-blue-950/20">
                  <p className="text-[10px] uppercase tracking-wider text-emerald-200/60 font-bold">Real Cost / Hr</p>
                  <p className="mt-1 text-lg font-bold text-emerald-100">{fmt(overheadCalc.costPerHr)}</p>
                </div>
              </div>

              {(['essential', 'extra', 'loans', 'vehicle'] as const).filter((key) => key === openOverheadCategory).map((key) => {
                const bucketMonthlyTotal = num(Object.values(overhead[key] || []).reduce((s: number, i: any) => s + num(i.monthly), 0))
                return (
                <div key={key} className="rounded-xl border border-cyan-400/15 bg-slate-950/55 shadow-inner shadow-blue-950/20 overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setOpenOverheadCategory(key)}
                    className="flex w-full justify-between items-center p-4 border-b border-cyan-400/10 text-left"
                  >
                    <div>
                      <h3 className="font-bold text-gray-100 capitalize">{key}</h3>
                      <p className="text-xs text-gray-500 mt-0.5">{(overhead[key] || []).length} expense{(overhead[key] || []).length === 1 ? '' : 's'}</p>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <span className="rounded-full border border-cyan-400/20 bg-cyan-400/10 px-2 py-1 text-[11px] font-semibold text-cyan-100">{fmt(bucketMonthlyTotal)} / mo</span>
                      <span className="rounded-full border border-blue-400/20 bg-blue-400/10 px-2 py-1 text-[11px] font-semibold text-blue-100">{fmt(bucketMonthlyTotal * 12)} / yr</span>
                    </div>
                  </button>
                  <div className="p-4">
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
                          persist(data)
                        }
                      }}
                      className="text-xs px-3 py-1.5 border border-cyan-400/25 bg-cyan-400/10 text-cyan-100 rounded-lg hover:bg-cyan-400/15 font-semibold transition-colors"
                    >
                      + Add
                    </button>
                  </div>
                  <div className="px-4 pb-4">
                    <div className="grid grid-cols-[minmax(220px,1fr)_150px_130px_130px_40px] gap-2 px-3 py-2 text-[10px] uppercase tracking-wider text-cyan-200/60 font-bold border border-cyan-400/10 border-b-0 rounded-t-lg bg-slate-950/70">
                      <span>Expense Name</span>
                      <span className="text-center">Mode</span>
                      <span className="text-center">Monthly</span>
                      <span className="text-center">Yearly</span>
                      <span />
                    </div>
                  <div className={`rounded-b-lg border border-cyan-400/10 bg-slate-950/40 ${(overhead[key] || []).length > 15 ? 'max-h-96 overflow-y-auto' : ''}`}>
                    {(overhead[key] || []).length === 0 && (
                      <div className="px-3 py-4 text-sm text-gray-500">No expenses yet.</div>
                    )}
                    {(overhead[key] || []).map((item: any) => (
                      <div key={item.id} className="grid grid-cols-[minmax(220px,1fr)_150px_130px_130px_40px] items-center gap-2 text-sm px-3 py-2.5 border-b last:border-b-0 border-cyan-400/10 bg-slate-900/45">
                        <span className="text-gray-300 truncate">{item.name}</span>
                          <div className="flex w-32 justify-self-center rounded-lg border border-cyan-400/15 bg-slate-950/70 p-0.5">
                            {(['monthly', 'yearly'] as const).map((mode) => {
                              const isActive = (overheadEntryModes[item.id] || 'monthly') === mode
                              return (
                                <button
                                  key={mode}
                                  type="button"
                                  onClick={() => setOverheadEntryModes(prev => ({ ...prev, [item.id]: mode }))}
                                  className={`flex-1 rounded-md px-2 py-1 text-[10px] font-semibold capitalize transition-colors ${
                                    isActive ? 'bg-cyan-400/15 text-cyan-100' : 'text-gray-500 hover:text-gray-300'
                                  }`}
                                >
                                  {mode}
                                </button>
                              )
                            })}
                          </div>
                          <input
                            type="number"
                            step="0.01"
                            value={(overheadEntryModes[item.id] || 'monthly') === 'monthly' ? item.monthly || 0 : num(item.monthly).toFixed(2)}
                            readOnly={(overheadEntryModes[item.id] || 'monthly') === 'yearly'}
                            onChange={(e) => {
                              const data = getBackupData()
                              if (data && data.settings.overhead && data.settings.overhead[key]) {
                                pushState(data)
                                const idx = data.settings.overhead[key].findIndex((x: any) => x.id === item.id)
                                if (idx >= 0) {
                                  data.settings.overhead[key][idx].monthly = parseFloat(e.target.value) || 0
                                  persist(data)
                                }
                              }
                            }}
                            className={`w-28 justify-self-center px-2 py-1 border rounded-lg text-xs text-center focus:outline-none ${
                              (overheadEntryModes[item.id] || 'monthly') === 'monthly'
                                ? 'bg-slate-950/80 border-cyan-400/20 text-gray-100 focus:border-cyan-300/60'
                                : 'bg-slate-900/50 border-slate-700/70 text-gray-500 cursor-not-allowed'
                            }`}
                          />
                          <input
                            type="number"
                            step="0.01"
                            value={(num(item.monthly) * 12).toFixed(2)}
                            readOnly={(overheadEntryModes[item.id] || 'monthly') === 'monthly'}
                            onChange={(e) => {
                              const data = getBackupData()
                              if (data && data.settings.overhead && data.settings.overhead[key]) {
                                pushState(data)
                                const idx = data.settings.overhead[key].findIndex((x: any) => x.id === item.id)
                                if (idx >= 0) {
                                  data.settings.overhead[key][idx].monthly = (parseFloat(e.target.value) || 0) / 12
                                  persist(data)
                                }
                              }
                            }}
                            className={`w-28 justify-self-center px-2 py-1 border rounded-lg text-xs text-center focus:outline-none ${
                              (overheadEntryModes[item.id] || 'monthly') === 'yearly'
                                ? 'bg-slate-950/80 border-cyan-400/20 text-gray-100 focus:border-cyan-300/60'
                                : 'bg-slate-900/50 border-slate-700/70 text-gray-500 cursor-not-allowed'
                            }`}
                          />
                          <button
                            onClick={() => {
                              const data = getBackupData()
                              if (data && data.settings.overhead && data.settings.overhead[key]) {
                                pushState(data)
                                data.settings.overhead[key] = data.settings.overhead[key].filter((x: any) => x.id !== item.id)
                                persist(data)
                              }
                            }}
                            className="h-7 w-7 rounded-lg border border-red-400/15 bg-red-500/10 text-xs text-red-300 hover:bg-red-500/15 hover:text-red-200 transition-colors"
                          >
                            ×
                          </button>
                      </div>
                    ))}
                  </div>
                  </div>
                </div>
                )
              })}
            </div>
          </SettingCard>
          )}

          {/* PROJECTS CONFIGURATION */}
          {showProjectsConfiguration && (
          <SettingCard title="Projects Configuration">
            <div className="space-y-4 rounded-2xl border border-cyan-400/15 bg-gradient-to-br from-slate-950/70 via-blue-950/20 to-slate-950/80 p-4 shadow-2xl shadow-blue-950/25">
              <div className="flex items-center justify-between gap-3 border-b border-cyan-400/10 pb-3">
                <div>
                  <h3 className="text-sm font-bold text-gray-100">Project workflow setup</h3>
                  <p className="text-xs text-gray-500 mt-0.5">Shared project phases for Progress, phase weights, and MTO labels.</p>
                </div>
                <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${phaseWeightTotal === 100 ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-200' : 'border-amber-400/20 bg-amber-400/10 text-amber-200'}`}>
                  Total: {phaseWeightTotal}%
                </span>
              </div>

              <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.35fr)_minmax(280px,0.65fr)] gap-4">
                <div className="rounded-xl border border-blue-400/15 bg-slate-950/60 p-4 shadow-inner shadow-blue-950/20">
                  <div className="flex items-center justify-between gap-3 mb-3">
                    <div>
                      <h4 className="text-sm font-bold text-gray-100">Phase Weights Editor</h4>
                      <p className="text-xs text-gray-500 mt-0.5">Balance project phase percentages.</p>
                    </div>
                    <span className={`rounded-full border px-2 py-1 text-[11px] font-semibold ${phaseWeightTotal === 100 ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-200' : 'border-red-400/20 bg-red-400/10 text-red-200'}`}>
                      {phaseWeightTotal === 100 ? 'Balanced' : 'Needs 100%'}
                    </span>
                  </div>
                  <div className="space-y-2">
                    {workflowPhasesForList.map((phase: string) => {
                      const weight = num((phaseWeights as any)[phase] || 0)
                      return (
                      <div key={phase} className="grid grid-cols-[minmax(90px,0.8fr)_minmax(120px,1fr)_64px_32px] items-center gap-3 rounded-lg border border-blue-400/10 bg-slate-900/60 px-3 py-2">
                        <span className="truncate text-sm font-medium text-gray-200">{phase}</span>
                        <input
                          type="range"
                          min="0"
                          max="50"
                          value={weight as number}
                          onChange={(e) => {
                            const data = getBackupData()
                            if (!data) return
                            pushState(data)
                            const merged = { ...getPhaseWeights(data), [phase]: parseInt(e.target.value, 10) || 0 }
                            data.settings.phaseWeights = merged
                            const keys = Object.keys(merged)
                            const prev = Array.isArray(data.settings.mtoPhases) ? data.settings.mtoPhases : []
                            data.settings.mtoPhases = [...prev.filter(k => keys.includes(k)), ...keys.filter(k => !prev.includes(k))]
                            persist(data)
                          }}
                          className="w-full accent-cyan-400"
                        />
                        <span className="text-right text-sm font-bold text-cyan-300">{(weight as number).toFixed(0)}%</span>
                        <button
                          onClick={() => {
                            const data = getBackupData()
                            if (!data) return
                            pushState(data)
                            const w = { ...getPhaseWeights(data) }
                            delete w[phase]
                            if (Object.keys(w).length === 0) {
                              data.settings.phaseWeights = {}
                              data.settings.mtoPhases = []
                            } else {
                              data.settings.phaseWeights = w
                              const prev = Array.isArray(data.settings.mtoPhases) ? data.settings.mtoPhases : []
                              const next = prev.filter(p => p in w)
                              for (const k of Object.keys(w)) {
                                if (!next.includes(k)) next.push(k)
                              }
                              data.settings.mtoPhases = next
                            }
                            persist(data)
                          }}
                          className="h-7 w-7 rounded-lg border border-red-400/15 bg-red-500/10 text-xs text-red-300 hover:bg-red-500/15 hover:text-red-200 transition-colors"
                        >
                          X
                        </button>
                      </div>
                      )
                    })}
                  </div>
                  <div className={`mt-3 rounded-lg border px-3 py-2 text-sm font-semibold ${phaseWeightTotal === 100 ? 'border-emerald-400/15 bg-emerald-400/10 text-emerald-200' : 'border-red-400/15 bg-red-400/10 text-red-200'}`}>
                    Total: {phaseWeightTotal}% {phaseWeightTotal === 100 ? 'Balanced' : 'should equal 100%'}
                  </div>
                  <button
                    onClick={() => {
                      const data = getBackupData()
                      if (!data) return
                      const keys = getProjectPhaseNames(data)
                      if (keys.length === 0) return
                      pushState(data)
                      if (!data.settings.phaseWeights) data.settings.phaseWeights = {}
                      const numPhases = keys.length
                      const baseWeight = Math.floor(100 / numPhases)
                      const remainder = 100 % numPhases
                      keys.forEach((ph, idx) => {
                        data.settings.phaseWeights[ph] = baseWeight + (idx < remainder ? 1 : 0)
                      })
                      data.settings.mtoPhases = [...keys]
                      persist(data)
                    }}
                    className="mt-3 w-full rounded-lg border border-cyan-400/25 bg-cyan-400/10 px-3 py-2 text-xs font-semibold text-cyan-200 hover:bg-cyan-400/15 transition-colors"
                  >
                    Auto-Balance to 100%
                  </button>
                </div>

                <div className="rounded-xl border border-cyan-400/15 bg-slate-950/60 p-4 shadow-inner shadow-blue-950/20">
                  <div className="flex items-center justify-between gap-3 mb-3">
                    <div>
                      <h4 className="text-sm font-bold text-gray-100">Project phases</h4>
                      <p className="text-xs text-gray-500 mt-0.5">Phase names (same list as Progress and MTO).</p>
                    </div>
                    <span className="rounded-full border border-cyan-400/20 bg-cyan-400/10 px-2 py-1 text-[11px] font-semibold text-cyan-100">
                      {workflowPhasesForList.length} phases
                    </span>
                  </div>
                  <div className="space-y-2">
                    {workflowPhasesForList.map((phase: string, i: number) => (
                      <div key={`${phase}-${i}`} className="flex items-center justify-between gap-3 rounded-lg border border-cyan-400/10 bg-slate-900/60 px-3 py-2 text-sm">
                        <span className="truncate font-medium text-gray-200">{phase}</span>
                        <button
                          onClick={() => {
                            const data = getBackupData()
                            if (!data) return
                            pushState(data)
                            const w = { ...getPhaseWeights(data) }
                            delete w[phase]
                            if (Object.keys(w).length === 0) {
                              data.settings.phaseWeights = {}
                              data.settings.mtoPhases = []
                            } else {
                              data.settings.phaseWeights = w
                              const prev = Array.isArray(data.settings.mtoPhases) ? data.settings.mtoPhases : []
                              const next = prev.filter(p => p in w)
                              for (const k of Object.keys(w)) {
                                if (!next.includes(k)) next.push(k)
                              }
                              data.settings.mtoPhases = next
                            }
                            persist(data)
                          }}
                          className="h-7 w-7 rounded-lg border border-red-400/15 bg-red-500/10 text-xs text-red-300 hover:bg-red-500/15 hover:text-red-200 transition-colors"
                        >
                          X
                        </button>
                      </div>
                    ))}
                  </div>
                  <button
                    onClick={() => {
                      const name = prompt('New project phase:')
                      if (!name || !String(name).trim()) return
                      const trimmed = String(name).trim()
                      const data = getBackupData()
                      if (!data) return
                      if (getProjectPhaseNames(data).some(ph => ph.toLowerCase() === trimmed.toLowerCase())) {
                        alert('That phase already exists.')
                        return
                      }
                      pushState(data)
                      if (!data.settings.mtoPhases) data.settings.mtoPhases = []
                      if (!data.settings.phaseWeights) data.settings.phaseWeights = {}
                      data.settings.mtoPhases.push(trimmed)
                      const pw = data.settings.phaseWeights
                      if (Object.keys(pw).length === 0) {
                        Object.assign(pw, buildEqualPhaseWeights(data.settings.mtoPhases))
                      } else {
                        pw[trimmed] = 0
                      }
                      persist(data)
                    }}
                    className="mt-3 w-full rounded-lg border border-cyan-400/25 bg-cyan-400/10 px-3 py-2 text-xs font-semibold text-cyan-200 hover:bg-cyan-400/15 transition-colors"
                  >
                    + Add Phase
                  </button>
                </div>
              </div>
            </div>
          </SettingCard>
          )}

          {/* AI DEVELOPMENT */}
          {showAIDevelopment && (
          <div className="space-y-4 rounded-2xl border border-sky-400/15 bg-gradient-to-br from-slate-950/70 via-blue-950/20 to-slate-950/80 p-4 shadow-2xl shadow-blue-950/25">
              <div className="flex items-center justify-between gap-3 border-b border-sky-400/10 pb-3">
                <div>
                  <h3 className="text-sm font-bold text-gray-100">AI development workspace</h3>
                  <p className="text-xs text-gray-500 mt-0.5">Proposals, NEXUS profile, voice, and skill intelligence.</p>
                </div>
                <span className="rounded-full border border-sky-400/20 bg-sky-400/10 px-3 py-1 text-xs font-semibold text-sky-100">
                  NEXUS tools
                </span>
              </div>

              <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                <div className="rounded-xl border border-sky-400/15 bg-slate-950/60 p-4 shadow-inner shadow-blue-950/20" data-section="proposals">
                  <div className="flex items-center justify-between gap-3 border-b border-sky-400/10 pb-3 mb-3">
                    <div>
                      <h4 className="text-sm font-bold text-gray-100">Proposals</h4>
                      <p className="text-xs text-gray-500 mt-0.5">MiroFish proposal queue.</p>
                    </div>
                    <div className="flex flex-col items-end gap-1.5">
                      <button
                        type="button"
                        onClick={runAIDevelopmentScoutScan}
                        disabled={scoutScanning || !authProfile?.org_id}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-400/25 bg-cyan-400/10 px-3 py-1.5 text-[11px] font-semibold text-cyan-100 transition-colors hover:bg-cyan-400/15 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <RefreshCw size={12} className={scoutScanning ? 'animate-spin' : ''} />
                        {scoutScanning ? 'Scanning' : 'Scan Now'}
                      </button>
                      {scoutScanMessage && (
                        <span className={`text-[10px] ${scoutScanMessage.includes('failed') ? 'text-red-300' : 'text-emerald-300'}`}>
                          {scoutScanMessage}
                        </span>
                      )}
                    </div>
                  </div>
                  {scoutSuggestions.length > 0 && (
                    <div className="mb-3 rounded-xl border border-cyan-400/15 bg-slate-950/70 p-3 shadow-inner shadow-blue-950/20">
                      <div className="mb-2 flex items-center justify-between gap-3">
                        <div>
                          <p className="text-xs font-bold text-cyan-100">Scan suggestions</p>
                          <p className="text-[10px] text-slate-500">Choose which suggestions become queue items.</p>
                        </div>
                        <button
                          type="button"
                          onClick={moveSelectedScoutSuggestionsToQueue}
                          disabled={scoutQueueing || scoutSuggestions.every(item => !item.selected)}
                          className="rounded-lg border border-emerald-400/25 bg-emerald-400/10 px-3 py-1.5 text-[10px] font-semibold text-emerald-100 transition-colors hover:bg-emerald-400/15 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {scoutQueueing ? 'Moving...' : 'Move Selected to Queue'}
                        </button>
                      </div>
                      <div className="space-y-2">
                        {scoutSuggestions.map(item => (
                          <div key={item.id} className="flex gap-2 rounded-lg border border-slate-700/60 bg-slate-950/70 p-2 text-left">
                            <label className="mt-1 flex h-3.5 w-3.5 flex-shrink-0 items-center justify-center">
                              <input
                                type="checkbox"
                                checked={item.selected}
                                onChange={() => toggleScoutSuggestion(item.id)}
                                className="h-3.5 w-3.5 accent-cyan-400"
                                aria-label={`Select ${item.proposal.title}`}
                              />
                            </label>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <p className="truncate text-xs font-semibold text-slate-200">{item.proposal.title}</p>
                                <span className="ml-auto rounded-full border border-cyan-400/20 bg-cyan-400/10 px-2 py-0.5 text-[9px] font-semibold text-cyan-200">
                                  {item.proposal.category}
                                </span>
                              </div>
                              <p className="mt-1 line-clamp-2 text-[11px] text-slate-500">{item.proposal.reasoning || item.proposal.description}</p>
                              <div className="mt-1 flex gap-2 text-[10px] text-slate-600">
                                <span>Impact {item.proposal.impact_score}/10</span>
                                <span>Risk {item.proposal.risk_score}/10</span>
                              </div>
                              <div className="mt-2 flex flex-wrap gap-2">
                                <button
                                  type="button"
                                  onClick={() => queueScoutSuggestion(item.id)}
                                  disabled={scoutQueueing}
                                  className="inline-flex items-center gap-1 rounded-md border border-emerald-400/25 bg-emerald-400/10 px-2.5 py-1 text-[10px] font-semibold text-emerald-100 transition-colors hover:bg-emerald-400/15 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  <Check size={11} />
                                  Queue
                                </button>
                                <button
                                  type="button"
                                  onClick={() => dismissScoutSuggestion(item.id)}
                                  disabled={scoutQueueing}
                                  className="inline-flex items-center gap-1 rounded-md border border-slate-600/70 bg-slate-800/40 px-2.5 py-1 text-[10px] font-semibold text-slate-300 transition-colors hover:bg-slate-700/60 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  <Trash2 size={11} />
                                  Dismiss
                                </button>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  <ProposalQueue key={proposalQueueKey} maxHeight="600px" />
                  {scoutScanHistory.length > 0 && (
                    <div className="mt-3 rounded-xl border border-slate-700/60 bg-slate-950/50 p-3">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Recent scan history</p>
                        <span className="text-[10px] text-slate-600">{Math.min(scoutScanHistoryVisible, scoutScanHistory.length)} / {scoutScanHistory.length}</span>
                      </div>
                      <div className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
                        {scoutScanHistory.slice(0, scoutScanHistoryVisible).map(item => (
                          <div key={item.id} className="flex items-center gap-2 text-[10px]">
                            <span className={`h-1.5 w-1.5 rounded-full ${item.status === 'rejected' ? 'bg-red-400' : item.status === 'dismissed' ? 'bg-amber-400' : 'bg-slate-500'}`} />
                            <span className="min-w-0 flex-1 truncate text-slate-400">{item.title}</span>
                            <span className="capitalize text-slate-600">{item.status.replace('_', ' ')}</span>
                          </div>
                        ))}
                      </div>
                      {scoutScanHistoryVisible < Math.min(SCOUT_SCAN_HISTORY_LIMIT, scoutScanHistory.length) && (
                        <button
                          type="button"
                          onClick={() => setScoutScanHistoryVisible(count => Math.min(count + SCOUT_SCAN_HISTORY_PAGE_SIZE, SCOUT_SCAN_HISTORY_LIMIT, scoutScanHistory.length))}
                          className="mt-2 w-full rounded-lg border border-slate-700/70 bg-slate-900/60 px-3 py-1.5 text-[10px] font-semibold text-slate-300 transition-colors hover:bg-slate-800/80"
                        >
                          Show 15 more
                        </button>
                      )}
                    </div>
                  )}
                </div>

                <div>
                  <SkillIntelligenceCard orgId={authProfile?.org_id} refreshKey={proposalQueueKey} />
                </div>
              </div>

              <div className="rounded-xl border border-blue-400/15 bg-slate-950/60 p-4 shadow-inner shadow-blue-950/20">
                <OwnerProfileCard />
              </div>

              <div className="rounded-xl border border-indigo-400/15 bg-slate-950/60 p-4 shadow-inner shadow-blue-950/20">
                <div className="flex items-center justify-between gap-3 border-b border-indigo-400/10 pb-3 mb-3">
                  <div>
                    <h4 className="text-sm font-bold text-gray-100">NEXUS Voice</h4>
                    <p className="text-xs text-gray-500 mt-0.5">Voice selection and sample playback.</p>
                  </div>
                  <span className="rounded-full border border-indigo-400/20 bg-indigo-400/10 px-2 py-1 text-[11px] font-semibold text-indigo-100">Voice</span>
                </div>
                <NexusVoiceSelector />
              </div>
            </div>
          )}

          {/* 3. PHASE WEIGHTS EDITOR */}
          {false && (
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
          )}

          {/* 5. AI AGENT SETTINGS */}
          {false && (
          <SettingCard title="AI Agent Settings">
            <div className="space-y-4">
              <div className="p-3 rounded border" style={{ backgroundColor: 'var(--bg-input)', borderColor: 'var(--border-secondary)' }}>
                <p className="text-sm text-gray-300 mb-2">Anthropic API Key</p>
                <div className="flex items-center gap-3">
                  <div className={`w-3 h-3 rounded-full ${(import.meta.env.DEV ? import.meta.env.VITE_ANTHROPIC_API_KEY : true) ? 'bg-green-500' : 'bg-red-500'}`}></div>
                  <span className="text-xs text-gray-400">
                    {(import.meta.env.DEV ? import.meta.env.VITE_ANTHROPIC_API_KEY : true) ? 'Configured — QuickBooks PDF import enabled' : 'Not configured — set VITE_ANTHROPIC_API_KEY in .env'}
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

          )}

          {/* 6. DATA & SYNC CENTER */}
          {showDataSyncCenter && (
          <DataSyncCenter
            backup={backup}
            user={user}
            supabaseUp={supabaseUp}
            lastSync={lastSync}
            onExport={handleExportBackup}
            onImport={handleImportBackup}
            onResetDefaults={handleResetDefaults}
          />
          )}

        </div>

        {/* RIGHT COLUMN */}
        <div className={compactColumnClass}>

          {/* MiroFish Proposal Queue */}
          {false && (
          <div data-section="proposals">
            <SettingCard title="Proposals">
              <ProposalQueue maxHeight="600px" />
            </SettingCard>
          </div>
          )}

          {/* QUICKBOOKS BATCH IMPORT */}
          {false && <QuickBooksBatchImport persist={persist} forceUpdate={forceUpdate} />}

          {/* QUICKBOOKS INTEGRATION (FOUNDATION) */}
          {false && (
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

          )}

          {/* 10. MTO PHASES */}
          {false && (
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
                        persist(data)
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
                    persist(data)
                  }
                }}
                className="w-full text-xs px-2 py-2 bg-blue-600/30 text-blue-300 rounded hover:bg-blue-600/40 border border-blue-500/30"
              >
                + Add Phase
              </button>
            </div>
          </SettingCard>
          )}

          {/* MY DEVELOPMENT — SKILL INTELLIGENCE */}
          {false && (
          <SkillIntelligenceCard orgId={authProfile?.org_id} refreshKey={proposalQueueKey} />
          )}

          {/* MY PROFILE */}
          {false && (
          <OwnerProfileCard />
          )}

          {/* NEXUS VOICE */}
          {false && (
          <SettingCard title="NEXUS Voice">
            <NexusVoiceSelector />
          </SettingCard>
          )}

          {showBusinessSetup && (
          <SettingCard title="Theme & Branding">
            <div className="space-y-4 rounded-2xl border border-cyan-400/15 bg-gradient-to-br from-slate-950/70 via-blue-950/20 to-slate-950/80 p-4 shadow-2xl shadow-blue-950/25 [&_input]:min-h-9">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="rounded-xl border border-cyan-400/10 bg-slate-950/55 p-4">
                  <div className="flex items-center justify-between gap-3 border-b border-cyan-400/10 pb-3 mb-3">
                    <div>
                      <h3 className="text-sm font-bold text-gray-100">Brand Preview</h3>
                      <p className="text-xs text-gray-500 mt-0.5">How your company identity appears in PowerOn.</p>
                    </div>
                    <span className="rounded-full border border-cyan-400/20 bg-cyan-400/10 px-2 py-1 text-[11px] font-semibold text-cyan-100">
                      {currentTheme === 'dark' ? 'Dark mode' : 'Light mode'}
                    </span>
                  </div>
                  <div className="flex min-h-[92px] items-center gap-4 rounded-lg border border-cyan-400/10 bg-slate-950/70 p-3">
                    <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl border border-cyan-400/20 bg-cyan-400/10">
                      {brandPreviewLogo ? (
                        <img src={brandPreviewLogo} alt={`${brandName} logo preview`} className="max-h-12 max-w-12 object-contain" />
                      ) : (
                        <Sparkles size={24} className="text-cyan-200" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-cyan-200/60">Current Brand</p>
                      <h3 className="mt-1 truncate text-xl font-bold text-gray-100">{brandName}</h3>
                      <p className="mt-1 text-xs text-gray-500">{brandPreviewLogo ? 'Logo asset ready' : 'Default brand mark shown'}</p>
                    </div>
                  </div>
                </div>

                <div className="rounded-xl border border-cyan-400/10 bg-slate-950/55 p-4">
                  <div className="flex items-center justify-between gap-3 border-b border-cyan-400/10 pb-3 mb-3">
                    <div>
                      <h3 className="text-sm font-bold text-gray-100">Appearance</h3>
                      <p className="text-xs text-gray-500 mt-0.5">Switch the app theme style.</p>
                    </div>
                  </div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase mb-3">Light/Dark Theme</label>
                  <button
                    onClick={handleThemeToggle}
                    className={`flex w-full items-center justify-between gap-3 rounded-xl border px-4 py-3 text-sm font-semibold transition-colors ${
                      currentTheme === 'dark'
                        ? 'border-cyan-400/20 bg-slate-900/80 text-gray-100 hover:bg-slate-900'
                        : 'border-sky-300/50 bg-sky-100 text-blue-700 hover:bg-sky-200'
                    }`}
                  >
                    <span className="flex items-center gap-3">
                      {currentTheme === 'dark' ? <Moon size={18} /> : <Sun size={18} />}
                      {currentTheme === 'dark' ? 'Dark Theme' : 'Light Theme'}
                    </span>
                    <span className="rounded-full border border-current/20 px-2 py-1 text-[10px] uppercase tracking-wider">
                      Active
                    </span>
                  </button>
                </div>
              </div>

              <div className="rounded-xl border border-cyan-400/10 bg-slate-950/55 p-4">
                <div className="flex items-center justify-between gap-3 border-b border-cyan-400/10 pb-3 mb-3">
                  <div>
                    <h3 className="text-sm font-bold text-gray-100">Logo Assets</h3>
                    <p className="text-xs text-gray-500 mt-0.5">Upload the logo variants used across light and dark surfaces.</p>
                  </div>
                  <Image size={18} className="text-cyan-300" />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="flex flex-col rounded-lg border border-cyan-400/10 bg-slate-950/70 p-3">
                    <label className="block text-xs font-semibold text-gray-500 uppercase mb-2">Dark Logo (Base64)</label>
                    <div className="flex h-full flex-col gap-2">
                      <input
                        type="file"
                        accept="image/*"
                        onChange={(e) => {
                          const file = e.target.files?.[0]
                          if (file) handleLogoUpload('dark', file)
                        }}
                        className="block w-full text-sm text-gray-400 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-blue-900 file:text-blue-300 hover:file:bg-blue-800"
                      />
                      {settings.logoDark && (
                        <div className="flex min-h-12 items-center gap-3 rounded-lg border border-cyan-400/10 bg-slate-900/70 p-3">
                          <Image size={16} className="text-cyan-300" />
                          <span className="text-xs text-gray-400 truncate">Dark logo uploaded</span>
                          <img src={settings.logoDark} alt="Dark logo" className="h-8 object-contain ml-auto" />
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-col rounded-lg border border-cyan-400/10 bg-slate-950/70 p-3">
                    <label className="block text-xs font-semibold text-gray-500 uppercase mb-2">Light Logo (Base64)</label>
                    <div className="flex h-full flex-col gap-2">
                      <input
                        type="file"
                        accept="image/*"
                        onChange={(e) => {
                          const file = e.target.files?.[0]
                          if (file) handleLogoUpload('light', file)
                        }}
                        className="block w-full text-sm text-gray-400 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-blue-900 file:text-blue-300 hover:file:bg-blue-800"
                      />
                      {settings.logoLight && (
                        <div className="flex min-h-12 items-center gap-3 rounded-lg border border-cyan-400/10 bg-slate-900/70 p-3">
                          <Image size={16} className="text-blue-300" />
                          <span className="text-xs text-gray-400 truncate">Light logo uploaded</span>
                          <img src={settings.logoLight} alt="Light logo" className="h-8 object-contain ml-auto" />
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </SettingCard>
          )}

          {showSecurityCenter && (
          <div className="space-y-4 rounded-2xl border border-indigo-400/15 bg-gradient-to-br from-slate-950/70 via-indigo-950/15 to-slate-950/80 p-3 shadow-2xl shadow-blue-950/20">
            <div className="flex items-center justify-between gap-3 px-1">
              <div>
                <h3 className="text-sm font-bold text-gray-100">Security Center</h3>
                <p className="text-xs text-gray-500 mt-0.5">Access, demo, test data, and owner controls.</p>
              </div>
              <span className="rounded-full border border-indigo-400/20 bg-indigo-400/10 px-2 py-1 text-[11px] font-semibold text-indigo-100">Protected</span>
            </div>
          {/* AUDIT ACCESS */}
          <AuditAccessCard />

          {/* SECURITY — CHANGE PASSCODE */}
          <SecurityCard />

          {/* BETA ACCESS — owner only */}
          {isOwner && (
            <SettingCard title="Beta Access">
              <div className="space-y-3">
                <p className="text-sm text-gray-400">
                  Invite beta demo users directly from your phone. They receive a magic link,
                  get assigned a demo tier, and have their account auto-populated with sample
                  projects and service calls so they can experience the app immediately.
                </p>
                <button
                  onClick={() => setShowBetaInviteModal(true)}
                  className="flex items-center gap-2 px-4 py-3 rounded-xl bg-green-600 hover:bg-green-500 text-white text-sm font-semibold transition w-full justify-center"
                  style={{ minHeight: '44px' }}
                >
                  <UserPlus className="w-4 h-4" />
                  Invite Beta User
                </button>
              </div>
            </SettingCard>
          )}

          {/* BETA INVITE MODAL */}
          {showBetaInviteModal && isOwner && user?.id && (
            <DemoInvite
              onClose={() => setShowBetaInviteModal(false)}
              inviterUserId={user.id}
            />
          )}

          {/* DATA MANAGEMENT – owner only: load / clear / verify test data */}
          {isOwner && (
            <SettingCard title="Data Management">
              <TestDataManagementPanel />
              <div className="mt-4 pt-4 border-t border-gray-700/50">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold text-gray-100">Hide My Data</p>
                    <p className="text-xs text-gray-500 mt-0.5">Masks all financial figures in the header bar. Persists until toggled off.</p>
                  </div>
                  <button
                    onClick={() => {
                      const current = localStorage.getItem('poweron_hide_finances') === 'true'
                      localStorage.setItem('poweron_hide_finances', String(!current))
                      window.dispatchEvent(new Event('poweron-hide-finances-changed'))
                      setHideTick(t => t + 1)
                    }}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${
                      localStorage.getItem('poweron_hide_finances') === 'true' ? 'bg-emerald-500' : 'bg-gray-600'
                    }`}
                  >
                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      localStorage.getItem('poweron_hide_finances') === 'true' ? 'translate-x-6' : 'translate-x-1'
                    }`} />
                  </button>
                </div>
              </div>
            </SettingCard>
          )}

          {/* DEMO MODE */}
          <SettingCard title="Demo Mode">
            <div className="space-y-4">
              {/* Status row */}
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                    Enable Demo Mode
                  </p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    Replaces all real data with generic placeholders. Your actual data is never modified.
                  </p>
                </div>
                <button
                  onClick={() => {
                    if (!isDemoMode) {
                      setShowDemoConfirm(true)
                    } else {
                      setShowExitDemoModal(true)
                    }
                  }}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${
                    isDemoMode ? 'bg-amber-500' : 'bg-gray-600'
                  }`}
                  title={isDemoMode ? 'Disable Demo Mode' : 'Enable Demo Mode'}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      isDemoMode ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>

              {/* Active status */}
              {isDemoMode && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-500/15 border border-amber-500/30">
                  <span className="text-amber-400 text-sm">⚠</span>
                  <div className="flex-1">
                    <p className="text-xs font-semibold text-amber-300">Demo Mode Active</p>
                    <p className="text-[10px] text-amber-400/80 mt-0.5">
                      Showing: {DEMO_COMPANY} · {DEMO_OWNER} · {DEMO_LICENSE}
                    </p>
                  </div>
                  <button
                    onClick={() => setShowExitDemoModal(true)}
                    className="text-xs text-amber-300 hover:text-amber-100 font-semibold px-2 py-1 rounded transition-colors"
                  >
                    Exit
                  </button>
                </div>
              )}

              {/* Confirmation dialog (inline) — enable demo */}
              {showDemoConfirm && !isDemoMode && (
                <div className="rounded-lg border border-amber-500/40 p-4 space-y-3" style={{ backgroundColor: 'var(--bg-input)' }}>
                  <p className="text-sm font-bold text-amber-300">Switch to Demo Mode?</p>
                  <p className="text-xs text-gray-400">
                    All panels will show sample data until you disable this. Your actual data is never modified or deleted.
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => {
                        enableDemoMode()
                        setShowDemoConfirm(false)
                      }}
                      className="flex-1 px-3 py-2 text-xs font-semibold rounded bg-amber-500 hover:bg-amber-400 text-white transition-colors"
                    >
                      Enable Demo Mode
                    </button>
                    <button
                      onClick={() => setShowDemoConfirm(false)}
                      className="px-3 py-2 text-xs font-semibold rounded bg-gray-700 hover:bg-gray-600 text-gray-300 transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          </SettingCard>

          {/* Exit Demo Mode confirmation modal — portal-style overlay */}
          {showExitDemoModal && (
            <div
              style={{
                position: 'fixed',
                inset: 0,
                zIndex: 99999,
                backgroundColor: 'rgba(0,0,0,0.65)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '16px',
              }}
            >
              <div
                style={{
                  backgroundColor: '#111827',
                  border: '1px solid #374151',
                  borderRadius: '12px',
                  padding: '28px 24px',
                  maxWidth: '360px',
                  width: '100%',
                  boxShadow: '0 24px 64px rgba(0,0,0,0.6)',
                }}
              >
                <h2 style={{ color: '#f9fafb', fontSize: '18px', fontWeight: 700, marginBottom: '10px' }}>
                  Exit Demo Mode?
                </h2>
                <p style={{ color: '#d1d5db', fontSize: '14px', lineHeight: '1.5', marginBottom: '8px' }}>
                  Exiting Demo Mode will reload the app and require you to sign in again.
                </p>
                <p style={{ color: '#9ca3af', fontSize: '12px', lineHeight: '1.5', marginBottom: '24px' }}>
                  Anyone currently viewing this demo will lose access.
                </p>
                <div style={{ display: 'flex', gap: '10px' }}>
                  <button
                    onClick={() => setShowExitDemoModal(false)}
                    style={{
                      flex: 1,
                      padding: '10px 16px',
                      borderRadius: '8px',
                      border: '1px solid #4b5563',
                      backgroundColor: 'transparent',
                      color: '#d1d5db',
                      fontSize: '14px',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    Stay in Demo
                  </button>
                  <button
                    onClick={() => {
                      disableDemoMode()
                      try { localStorage.removeItem('poweron-demo-mode') } catch { /* ignore */ }
                      window.location.reload()
                    }}
                    style={{
                      flex: 1,
                      padding: '10px 16px',
                      borderRadius: '8px',
                      border: 'none',
                      backgroundColor: '#ef4444',
                      color: '#fff',
                      fontSize: '14px',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    Exit &amp; Sign In
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ADMIN TEMPLATE SWITCHER — only visible when logged-in user matches VITE_ADMIN_EMAIL */}
          {user?.email && user.email === (import.meta.env.VITE_ADMIN_EMAIL as string) && (
            <AdminTemplateSwitcherCard />
          )}
          </div>
          )}

        </div>
      </div>
    </div>
  )
}

// ── Audit Access Sub-Component ───────────────────────────────────────────────
// Allows the owner to generate a shareable read-only audit URL.
// Token stored in profiles.audit_token; flag in profiles.audit_access_enabled.

const AUDIT_BASE_URL = 'https://incomparable-croissant-a86c81.netlify.app'

function AuditAccessCard() {
  const { user } = useAuth()
  const [auditToken, setAuditToken]     = useState<string | null>(null)
  const [auditEnabled, setAuditEnabled] = useState(false)
  const [loading, setLoading]           = useState(true)
  const [saving, setSaving]             = useState(false)
  const [copied, setCopied]             = useState(false)
  const [toast, setToast]               = useState<string | null>(null)

  const showToast = (msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(null), 2500)
  }

  // Load current audit settings from Supabase
  useEffect(() => {
    if (!user?.id) return
    setLoading(true)
    ;(async () => {
      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('audit_token, audit_access_enabled')
          .eq('id', user.id)
          .single()
        if (error) console.error(error)
        if (data) {
          setAuditToken(data.audit_token || null)
          setAuditEnabled(data.audit_access_enabled || false)
          // Auto-generate token if none exists
          if (!data.audit_token) {
            generateAndSaveToken(false)
          }
        }
      } catch(err) { console.error(err) }
      setLoading(false)
    })()
  }, [user?.id])

  function newUUID(): string {
    return crypto.randomUUID
      ? crypto.randomUUID()
      : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
          const r = (Math.random() * 16) | 0
          return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
        })
  }

  async function generateAndSaveToken(showFeedback = true) {
    if (!user?.id) return
    const token = newUUID()
    setSaving(true)
    const { error } = await supabase
      .from('profiles')
      .update({ audit_token: token } as any)
      .eq('id', user.id)
    setSaving(false)
    if (!error) {
      setAuditToken(token)
      if (showFeedback) showToast('New audit token generated')
    } else {
      if (showFeedback) showToast('Failed to save token')
    }
  }

  async function toggleAuditEnabled() {
    if (!user?.id) return
    const next = !auditEnabled
    setSaving(true)
    const { error } = await supabase
      .from('profiles')
      .update({ audit_access_enabled: next } as any)
      .eq('id', user.id)
    setSaving(false)
    if (!error) {
      setAuditEnabled(next)
      showToast(next ? 'Audit access enabled' : 'Audit access disabled')
    } else {
      showToast('Failed to update setting')
    }
  }

  function copyAuditURL() {
    if (!auditToken) return
    const url = `${AUDIT_BASE_URL}?audit=${auditToken}`
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true)
      showToast('Audit URL copied!')
      setTimeout(() => setCopied(false), 2000)
    })
  }

  const auditURL = auditToken ? `${AUDIT_BASE_URL}?audit=${auditToken}` : null

  return (
    <SettingCard title="Audit Access">
      {toast && (
        <div className="mb-3 px-3 py-2 rounded text-xs font-semibold bg-green-900/40 text-green-300 border border-green-700/40">
          {toast}
        </div>
      )}

      <div className="space-y-4">
        <p className="text-xs text-gray-400">
          Share a read-only view of the app with an accountant, bookkeeper, or auditor.
          The audit URL bypasses the passcode screen and loads the app in read-only mode.
        </p>

        {/* Enable / Disable toggle */}
        <div className="flex items-center justify-between">
          <label className="text-sm text-gray-300 font-medium">Audit access</label>
          <button
            onClick={toggleAuditEnabled}
            disabled={saving || loading}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${auditEnabled ? 'bg-green-600' : 'bg-gray-600'} disabled:opacity-50`}
          >
            <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${auditEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
          </button>
        </div>

        {/* Token display */}
        {loading ? (
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <Loader2 size={12} className="animate-spin" /> Loading…
          </div>
        ) : (
          <>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase mb-2">Audit Token</label>
              <div className="flex items-center gap-2">
                <div
                  className="flex-1 px-3 py-2 rounded text-xs font-mono text-gray-300 truncate select-all"
                  style={{ backgroundColor: 'var(--bg-input)', border: '1px solid var(--border-secondary)' }}
                >
                  {auditToken || '—'}
                </div>
                <button
                  onClick={() => generateAndSaveToken(true)}
                  disabled={saving}
                  title="Regenerate token (invalidates old URL)"
                  className="px-2 py-2 rounded text-xs bg-yellow-900/30 text-yellow-300 border border-yellow-700/30 hover:bg-yellow-900/50 disabled:opacity-50 flex items-center gap-1"
                >
                  <RefreshCw size={12} className={saving ? 'animate-spin' : ''} />
                  Regenerate
                </button>
              </div>
            </div>

            {/* Audit URL */}
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase mb-2">Audit URL</label>
              <div className="flex items-center gap-2">
                <div
                  className="flex-1 px-3 py-2 rounded text-xs font-mono text-gray-400 truncate"
                  style={{ backgroundColor: 'var(--bg-input)', border: '1px solid var(--border-secondary)' }}
                >
                  {auditURL || '—'}
                </div>
                <button
                  onClick={copyAuditURL}
                  disabled={!auditToken || saving}
                  className="px-3 py-2 rounded text-xs font-semibold bg-blue-900/30 text-blue-300 border border-blue-700/30 hover:bg-blue-900/50 disabled:opacity-50 flex items-center gap-1"
                >
                  {copied ? <Check size={12} /> : <Copy size={12} />}
                  {copied ? 'Copied!' : 'Copy URL'}
                </button>
              </div>
            </div>

            {!auditEnabled && (
              <p className="text-xs text-yellow-500">
                ⚠ Audit access is currently disabled. Enable the toggle above to allow access.
              </p>
            )}
          </>
        )}
      </div>
    </SettingCard>
  )
}


// ── Security Sub-Component — Change Passcode ─────────────────────────────────

const CODE_LEN = 6

function SecurityCard() {
  const { user, profile } = useAuth()
  const { lockApp, signOut } = useAuthStore()
  const [showModal, setShowModal]                   = useState(false)
  const [currentCode, setCurrentCode]               = useState('')
  const [newCode, setNewCode]                       = useState('')
  const [confirmCode, setConfirmCode]               = useState('')
  const [step, setStep]                             = useState<'current' | 'new' | 'confirm'>('current')
  const [error, setError]                           = useState<string | null>(null)
  const [saving, setSaving]                         = useState(false)
  const [successToast, setSuccessToast]             = useState(false)
  const [showSignoutEverywhere, setShowSignoutEverywhere] = useState(false)
  const [signingOutAll, setSigningOutAll]           = useState(false)
  const [showDeviceLogoutConfirm, setShowDeviceLogoutConfirm] = useState(false)

  function openModal() {
    setShowModal(true)
    setStep('current')
    setCurrentCode('')
    setNewCode('')
    setConfirmCode('')
    setError(null)
  }

  function closeModal() {
    setShowModal(false)
    setStep('current')
    setCurrentCode('')
    setNewCode('')
    setConfirmCode('')
    setError(null)
  }

  async function handleSubmit() {
    if (!user || !profile) return
    setError(null)

    if (step === 'current') {
      if (currentCode.length !== CODE_LEN) { setError('Enter your current 6-digit passcode'); return }
      setSaving(true)
      const result = await verifyPasscode(user.id, profile.org_id, currentCode)
      setSaving(false)
      if (result.success) {
        setStep('new')
      } else {
        setError('Incorrect passcode. Please try again.')
        setCurrentCode('')
      }
      return
    }

    if (step === 'new') {
      if (!/^\d{6}$/.test(newCode)) { setError('New passcode must be exactly 6 digits'); return }
      setStep('confirm')
      return
    }

    if (step === 'confirm') {
      if (newCode !== confirmCode) { setError('Passcodes do not match'); setConfirmCode(''); return }
      setSaving(true)
      const result = await setPasscode(user.id, newCode)
      setSaving(false)
      if (result.success) {
        closeModal()
        setSuccessToast(true)
        setShowSignoutEverywhere(true)
        setTimeout(() => {
          setSuccessToast(false)
          setShowSignoutEverywhere(false)
        }, 12000)
      } else {
        setError(result.error || 'Failed to save passcode')
      }
    }
  }

  const stepLabel = step === 'current' ? 'Current Passcode' : step === 'new' ? 'New Passcode' : 'Confirm New Passcode'
  const stepSub   = step === 'current' ? 'Enter your current 6-digit passcode to verify identity'
                  : step === 'new'     ? 'Enter your new 6-digit passcode'
                  : 'Re-enter your new passcode to confirm'
  const codeValue = step === 'current' ? currentCode : step === 'new' ? newCode : confirmCode
  const setCode   = step === 'current' ? setCurrentCode : step === 'new' ? setNewCode : setConfirmCode

  return (
    <SettingCard title="Security">
      {successToast && (
        <div className="mb-3 px-3 py-2 rounded text-xs font-semibold bg-green-900/40 text-green-300 border border-green-700/40">
          ✓ Passcode updated successfully
        </div>
      )}

      {showSignoutEverywhere && (
        <div className="mb-3 px-3 py-2 rounded text-xs bg-yellow-900/30 text-yellow-300 border border-yellow-700/40 flex items-center justify-between gap-3">
          <span>PIN updated. Sign out of other devices?</span>
          <button
            disabled={signingOutAll}
            onClick={async () => {
              setSigningOutAll(true)
              await supabase.auth.signOut({ scope: 'global' })
              setSigningOutAll(false)
              setShowSignoutEverywhere(false)
            }}
            className="flex-shrink-0 px-2 py-1 rounded text-xs font-bold bg-yellow-700/50 hover:bg-yellow-700/80 text-yellow-100 transition-colors flex items-center gap-1"
          >
            {signingOutAll ? <Loader2 size={10} className="animate-spin" /> : null}
            Sign Out Everywhere
          </button>
        </div>
      )}

      <div className="space-y-3">
        <p className="text-xs text-gray-400">
          Secure your session or change your access credentials.
        </p>
        
        <button
          onClick={openModal}
          className="w-full flex items-center gap-2 px-4 py-2 rounded text-sm font-semibold bg-blue-900/30 text-blue-300 border border-blue-700/30 hover:bg-blue-900/50 transition-colors"
        >
          <Lock size={14} />
          Change Passcode
        </button>

        {/* ── LOCK HUB (DAILY USE) ── */}
        <button
          onClick={async () => await lockApp()}
          className="w-full flex items-center gap-2 px-4 py-2.5 rounded text-sm font-bold bg-blue-600 text-white hover:bg-blue-700 transition-colors shadow-lg shadow-blue-900/20"
        >
          <Zap size={14} fill="currentColor" />
          LOCK HUB (DAILY USE)
        </button>

        <button
          onClick={() => setShowDeviceLogoutConfirm(true)}
          className="w-full flex items-center gap-2 px-4 py-2 rounded text-sm font-semibold bg-red-900/20 text-red-400 border border-red-700/30 hover:bg-red-900/40 transition-colors"
        >
          <LogOut size={14} />
          Sign Out of This Device
        </button>
      </div>

      {/* Device logout confirm dialog */}
      {showDeviceLogoutConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ backgroundColor: 'rgba(0,0,0,0.7)' }}
          onClick={(e) => { if (e.target === e.currentTarget) setShowDeviceLogoutConfirm(false) }}
        >
          <div
            className="w-full max-w-xs mx-4 rounded-2xl p-6 space-y-5"
            style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-secondary)' }}
          >
            <div className="flex items-center gap-3">
              <LogOut size={20} className="text-red-400 flex-shrink-0" />
              <h3 className="text-base font-bold text-gray-100">Sign out of PowerOn Hub?</h3>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setShowDeviceLogoutConfirm(false)}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-gray-400 hover:text-gray-200 transition-colors"
                style={{ backgroundColor: 'var(--bg-input)' }}
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  setShowDeviceLogoutConfirm(false)
                  await signOut()
                }}
                className="flex-1 py-2.5 rounded-xl text-sm font-bold bg-red-600 text-white hover:bg-red-700 transition-colors"
              >
                Sign Out
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Change Passcode Modal */}
      {showModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ backgroundColor: 'rgba(0,0,0,0.7)' }}
          onClick={(e) => { if (e.target === e.currentTarget) closeModal() }}
        >
          <div
            className="w-full max-w-sm mx-4 rounded-2xl p-6 space-y-5"
            style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-secondary)' }}
          >
            {/* Modal header */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Shield size={18} className="text-blue-400" />
                <h3 className="text-base font-bold text-gray-100">Change Passcode</h3>
              </div>
              <button onClick={closeModal} className="text-gray-500 hover:text-gray-300">
                <X size={18} />
              </button>
            </div>

            {/* Step indicator */}
            <div className="flex gap-1">
              {(['current', 'new', 'confirm'] as const).map((s) => (
                <div
                  key={s}
                  className={`flex-1 h-1 rounded-full transition-colors ${step === s || (s === 'current' && step !== 'current') || (s === 'new' && step === 'confirm') ? 'bg-blue-500' : 'bg-gray-700'}`}
                />
              ))}
            </div>

            <div>
              <p className="text-sm font-semibold text-gray-200 mb-1">{stepLabel}</p>
              <p className="text-xs text-gray-500 mb-3">{stepSub}</p>

              <input
                type="password"
                inputMode="numeric"
                maxLength={CODE_LEN}
                value={codeValue}
                onChange={(e) => {
                  const v = e.target.value.replace(/\D/g, '').slice(0, CODE_LEN)
                  setCode(v)
                  setError(null)
                }}
                onKeyDown={(e) => { if (e.key === 'Enter') handleSubmit() }}
                placeholder="••••••"
                autoFocus
                className="w-full px-4 py-3 rounded-xl text-center text-xl font-bold tracking-widest text-gray-100 focus:outline-none"
                style={{ backgroundColor: 'var(--bg-input)', border: '2px solid var(--border-secondary)' }}
              />

              {error && (
                <p className="mt-2 text-xs text-red-400 flex items-center gap-1">
                  <AlertCircle size={12} /> {error}
                </p>
              )}
            </div>

            {/* Actions */}
            <div className="flex gap-3">
              <button
                onClick={closeModal}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-gray-400 hover:text-gray-200 transition-colors"
                style={{ backgroundColor: 'var(--bg-input)' }}
              >
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={saving || codeValue.length !== CODE_LEN}
                className="flex-1 py-2.5 rounded-xl text-sm font-bold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
              >
                {saving
                  ? <Loader2 size={14} className="animate-spin" />
                  : step === 'confirm' ? <Check size={14} /> : null
                }
                {saving ? 'Saving…' : step === 'confirm' ? 'Save Passcode' : 'Next'}
              </button>
            </div>
          </div>
        </div>
      )}
    </SettingCard>
  )
}


// ── QuickBooks Batch Import Sub-Component ────────────────────────────────────

function QuickBooksBatchImport({ persist, forceUpdate, embedded = false }: { persist: () => void; forceUpdate: () => void; embedded?: boolean }) {
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

  const content = (
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
  )

  return embedded ? content : (
    <SettingCard title="QuickBooks Batch Import">
      {content}
    </SettingCard>
  )
}

// ── Skill Intelligence Sub-Component ─────────────────────────────────────────

const SKILL_LABELS: Record<SkillDomain, string> = {
  field_execution:      'Field Execution',
  estimating:           'Estimating',
  project_management:   'Project Management',
  business_development: 'Business Development',
  financial_literacy:   'Financial Literacy',
  permitting_compliance:'Permitting & Compliance',
  crew_management:      'Crew Management',
  client_communication: 'Client Communication',
  technical_knowledge:  'Technical Knowledge',
  systems_thinking:     'Systems Thinking',
}

function scoreColor(score: number, target: number): string {
  const gap = target - score
  if (gap <= 10) return '#22c55e'   // green
  if (gap <= 25) return '#eab308'   // yellow
  return '#ef4444'                   // red
}

function ScoreBar({ domain, score, target }: { domain: SkillDomain; score: number; target: number }) {
  const color = scoreColor(score, target)
  const gap = Math.max(0, target - score)
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span style={{ color: 'var(--text-primary)' }} className="font-medium">{SKILL_LABELS[domain]}</span>
        <span style={{ color }} className="font-bold">{score}<span className="text-gray-500 font-normal">/{target}</span></span>
      </div>
      <div className="relative h-3 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--bg-input)' }}>
        {/* Target outline */}
        <div
          className="absolute top-0 left-0 h-full rounded-full border-2 opacity-30"
          style={{ width: `${target}%`, borderColor: color }}
        />
        {/* Current score fill */}
        <div
          className="absolute top-0 left-0 h-full rounded-full transition-all duration-500"
          style={{ width: `${score}%`, backgroundColor: color }}
        />
      </div>
      {gap > 0 && (
        <p className="text-[10px] text-gray-500">Gap: {gap} pts to target</p>
      )}
    </div>
  )
}

function VelocityCard({ domain, score, velocity }: { domain: SkillDomain; score: number; velocity: number }) {
  const TrendIcon = velocity > 0.5 ? TrendingUp : velocity < -0.5 ? TrendingDown : Minus
  const trendColor = velocity > 0.5 ? 'text-green-400' : velocity < -0.5 ? 'text-red-400' : 'text-gray-400'

  return (
    <div className="rounded-lg p-3 border" style={{ backgroundColor: 'var(--bg-input)', borderColor: 'var(--border-secondary)' }}>
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>{SKILL_LABELS[domain]}</span>
        <TrendIcon size={14} className={trendColor} />
      </div>
      <div className="flex items-baseline gap-2">
        <span className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>{score}</span>
        <span className={`text-xs font-semibold ${trendColor}`}>
          {velocity > 0 ? '+' : ''}{velocity.toFixed(1)} pts/30d
        </span>
      </div>
    </div>
  )
}

function PriorityCard({ rank, domain, score, target }: { rank: number; domain: SkillDomain; score: number; target: number }) {
  const gap = target - score
  const ideal = IDEAL_PROFILE[domain]
  const nextSteps: Record<SkillDomain, string> = {
    field_execution:      'Log more field work with detailed notes. Seek complex commercial or multi-phase jobs.',
    estimating:           'Build 3+ estimates with material breakdowns. Track wins/losses with reasons.',
    project_management:   'Start using RFI tracking and milestone billing on active projects.',
    business_development: 'Reach out to 2 GC contacts this week. Update your estimate conversion rate.',
    financial_literacy:   'Review AR aging report. Match job costing to estimates weekly.',
    permitting_compliance:'Pull your next permit independently. Log NEC code lookups in journal.',
    crew_management:      'Document crew onboarding process. Track labor cost per job.',
    client_communication: 'Send a scope summary to your next client before starting. Log outcomes.',
    technical_knowledge:  'Complete a solar or EV charger install. Document technical specs in journal.',
    systems_thinking:     'Create one repeatable checklist or template this week.',
  }

  return (
    <div className="rounded-lg p-4 border-l-4" style={{ backgroundColor: 'var(--bg-card)', borderLeftColor: rank === 1 ? '#ef4444' : rank === 2 ? '#eab308' : '#3b82f6', borderTop: '1px solid var(--border-secondary)', borderRight: '1px solid var(--border-secondary)', borderBottom: '1px solid var(--border-secondary)' }}>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xs font-bold text-gray-500">#{rank}</span>
        <Target size={14} className="text-blue-400" />
        <span className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{SKILL_LABELS[domain]}</span>
        <span className="ml-auto text-xs text-red-400 font-semibold">-{gap} pts</span>
      </div>
      <p className="text-[11px] text-gray-400 mb-2">{ideal?.description}</p>
      <div className="flex items-start gap-2">
        <Zap size={12} className="text-yellow-400 mt-0.5 flex-shrink-0" />
        <p className="text-[11px] text-yellow-300">{nextSteps[domain]}</p>
      </div>
    </div>
  )
}

const ELECTRICIAN_OWNER_BASELINE_SKILLS = [
  { name: 'Estimating accuracy', score: 54, detail: 'Suggested baseline for estimate quality and win/loss learning' },
  { name: 'Project aging control', score: 50, detail: 'Suggested baseline for keeping active work from drifting' },
  { name: 'Change order discipline', score: 48, detail: 'Suggested baseline for scope control and margin protection' },
  { name: 'Permit / inspection readiness', score: 52, detail: 'Suggested baseline for city approvals and inspection prep' },
  { name: 'Crew scheduling', score: 46, detail: 'Suggested baseline for dispatch, capacity, and labor planning' },
  { name: 'Material planning', score: 49, detail: 'Suggested baseline for procurement and price-book awareness' },
  { name: 'Cash flow follow-up', score: 47, detail: 'Suggested baseline for AR aging and payment cadence' },
  { name: 'Client communication', score: 56, detail: 'Suggested baseline for expectations, updates, and closeout' },
]

function skillStatus(score: number): 'Strong' | 'Improving' | 'Watch' | 'Needs attention' {
  if (score >= 78) return 'Strong'
  if (score >= 62) return 'Improving'
  if (score >= 45) return 'Watch'
  return 'Needs attention'
}

function inferSkillRowsFromBusinessData(backup: BackupData | null, proposalHistory: any[]) {
  const projects = backup?.projects || []
  const serviceLogs = backup?.serviceLogs || backup?.service_logs || []
  const fieldLogs = backup?.fieldLogs || backup?.field_logs || backup?.logs || []
  const invoices = backup?.invoices || []
  const imports = backup?.imports || []
  const joinedText = JSON.stringify({ projects, serviceLogs, fieldLogs, proposalHistory, imports }).toLowerCase()
  const activeProjects = projects.filter((p: any) => !['complete', 'completed', 'closed', 'done'].includes(String(p.status || '').toLowerCase()))
  const proposals = proposalHistory || []
  const now = Date.now()
  const MS_30D = 30 * 24 * 60 * 60 * 1000
  const recentProposalCount = proposals.filter((p: any) => new Date(p.created_at || p.updated_at || 0).getTime() >= now - MS_30D).length

  const specs = [
    {
      domain: 'estimating' as SkillDomain,
      name: 'Estimating accuracy',
      score: 42 + Math.min(28, proposals.length * 4 + imports.length * 2) + (joinedText.includes('estimate') || joinedText.includes('quote') ? 10 : 0),
      detail: `${proposals.length} proposal${proposals.length === 1 ? '' : 's'} and ${imports.length} import${imports.length === 1 ? '' : 's'} reviewed`,
    },
    {
      domain: 'project_management' as SkillDomain,
      name: 'Project aging control',
      score: 40 + Math.min(32, activeProjects.length * 6 + fieldLogs.length),
      detail: `${activeProjects.length} active project${activeProjects.length === 1 ? '' : 's'} in current data`,
    },
    {
      domain: 'project_management' as SkillDomain,
      name: 'Change order discipline',
      score: 38 + (joinedText.includes('change order') || joinedText.includes('scope') ? 28 : 8) + Math.min(16, proposals.length * 2),
      detail: joinedText.includes('change order') || joinedText.includes('scope') ? 'Scope/change-order language found' : 'No direct change-order history found',
    },
    {
      domain: 'permitting_compliance' as SkillDomain,
      name: 'Permit / inspection readiness',
      score: 40 + (joinedText.includes('permit') ? 18 : 0) + (joinedText.includes('inspection') || joinedText.includes('inspector') ? 18 : 0),
      detail: joinedText.includes('permit') || joinedText.includes('inspection') ? 'Permit/inspection activity found' : 'Limited permit evidence found',
    },
    {
      domain: 'crew_management' as SkillDomain,
      name: 'Crew scheduling',
      score: 42 + (joinedText.includes('crew') || joinedText.includes('schedule') || joinedText.includes('dispatch') ? 24 : 6) + Math.min(12, activeProjects.length * 2),
      detail: 'Inferred from active workload and scheduling language',
    },
    {
      domain: 'field_execution' as SkillDomain,
      name: 'Material planning',
      score: 40 + (joinedText.includes('material') ? 24 : 0) + Math.min(20, fieldLogs.length * 2),
      detail: `${fieldLogs.length} field/service log${fieldLogs.length === 1 ? '' : 's'} reviewed`,
    },
    {
      domain: 'financial_literacy' as SkillDomain,
      name: 'Cash flow follow-up',
      score: 40 + Math.min(24, invoices.length * 4) + (joinedText.includes('invoice') || joinedText.includes('payment') || joinedText.includes('aging') ? 18 : 0),
      detail: `${invoices.length} invoice record${invoices.length === 1 ? '' : 's'} in backup data`,
    },
    {
      domain: 'client_communication' as SkillDomain,
      name: 'Client communication',
      score: 44 + (joinedText.includes('client') || joinedText.includes('customer') || joinedText.includes('gc') ? 22 : 8) + Math.min(12, recentProposalCount * 2),
      detail: recentProposalCount > 0 ? `${recentProposalCount} recent proposal activity item${recentProposalCount === 1 ? '' : 's'}` : 'Inferred from customer/project records',
    },
  ]

  return specs
    .filter(spec => spec.score >= 50 || proposals.length > 0 || projects.length > 0 || serviceLogs.length > 0 || fieldLogs.length > 0)
    .map(spec => ({
      id: `derived-${spec.name}`,
      name: spec.name,
      source: 'Accepted AI' as const,
      score: Math.max(30, Math.min(92, Math.round(spec.score))),
      detail: spec.detail,
      status: skillStatus(spec.score),
      trend: recentProposalCount > 0 ? 'improving' : 'stable',
    }))
}

function SkillIntelligenceCard({ orgId, refreshKey }: { orgId?: string; refreshKey?: number }) {
  const [skillMap, setSkillMap] = useState(() => getLocalSkillMap(orgId))
  const [signals, setSignals] = useState<StoredSkillSignal[]>(() => getLocalSkillSignals(orgId))
  const [ownerProfile, setOwnerProfile] = useState(() => getLocalOwnerProfile())
  const [proposalHistory, setProposalHistory] = useState<any[]>([])
  const [analyzingSkills, setAnalyzingSkills] = useState(false)
  const [skillMessage, setSkillMessage] = useState('')

  const refreshSkillIntelligence = useCallback(async () => {
    setAnalyzingSkills(true)
    setSkillMessage('')
    try {
      setSkillMap(getLocalSkillMap(orgId))
      setSignals(getLocalSkillSignals(orgId))
      setOwnerProfile(getLocalOwnerProfile())
      if (orgId) {
        const { data, error } = await supabase
          .from('agent_proposals')
          .select('id,title,description,category,status,source_data,created_at,updated_at')
          .eq('org_id', orgId)
          .in('status', ['confirmed', 'completed'])
          .order('created_at', { ascending: false })
          .limit(50)
        if (error) {
          console.warn('[SkillIntelligence] Proposal history refresh failed:', error)
        } else {
          setProposalHistory(data || [])
        }
      }
      setSkillMessage('Skill map refreshed')
    } catch (err) {
      console.warn('[SkillIntelligence] Refresh failed:', err)
      setSkillMessage('Skill refresh failed')
    } finally {
      setAnalyzingSkills(false)
      setTimeout(() => setSkillMessage(''), 3000)
    }
  }, [orgId])

  useEffect(() => {
    refreshSkillIntelligence()
  }, [refreshSkillIntelligence, refreshKey])

  useEffect(() => {
    if (!orgId) return
    return subscribeAgentEvent('PROPOSAL_APPROVED' as any, (event: any) => {
      if (event?.payload?.orgId && event.payload.orgId !== orgId) return
      refreshSkillIntelligence()
    })
  }, [orgId, refreshSkillIntelligence])

  // Calculate velocities (30-day score gains)
  const velocities = useMemo(() => {
    const now = Date.now()
    const MS_30D = 30 * 24 * 60 * 60 * 1000
    const result: Record<string, number> = {}
    for (const domain of SKILL_DOMAINS) {
      const recent = signals.filter(
        s => s.skill === domain && new Date(s.timestamp).getTime() >= now - MS_30D
      )
      const SIGNAL_DELTA: Record<string, number> = { positive_1: 1, positive_2: 2, positive_3: 3, learning_1: 0.5, learning_2: 0.5, learning_3: 0.5 }
      result[domain] = recent.reduce((sum, s) => sum + (SIGNAL_DELTA[`${s.signal}_${s.strength}`] || 0), 0)
    }
    return result
  }, [signals])

  // Sort by velocity (fastest improving first)
  const skillsByVelocity = useMemo(() => {
    return [...SKILL_DOMAINS].sort((a, b) => (velocities[b] || 0) - (velocities[a] || 0))
  }, [velocities])

  // Top 3 priority gaps (largest gap to ideal)
  const top3Gaps = useMemo(() => {
    return [...SKILL_DOMAINS]
      .sort((a, b) => {
        const gapA = (IDEAL_PROFILE[a]?.target ?? 80) - (skillMap[a]?.score ?? 0)
        const gapB = (IDEAL_PROFILE[b]?.target ?? 80) - (skillMap[b]?.score ?? 0)
        return gapB - gapA
      })
      .slice(0, 3)
  }, [skillMap])

  // Recent signals (last 20, newest first)
  const recentSignals = useMemo(() => {
    return [...signals]
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, 20)
  }, [signals])

  const skillRows = useMemo(() => {
    const manualRows = ownerProfile.skill_inventory.map((name: string) => ({
      id: `manual-${name}`,
      name,
      source: 'Manual' as const,
      score: 60,
      detail: 'Owner profile',
      status: 'Improving' as const,
      trend: 'stable',
    }))

    const aiRows = SKILL_DOMAINS
      .filter(domain => (skillMap[domain]?.score ?? 0) > 0 || signals.some(s => s.skill === domain))
      .map(domain => {
        const score = Math.round(skillMap[domain]?.score ?? 0)
        const evidenceCount = signals.filter(s => s.skill === domain).length
        return {
          id: `ai-${domain}`,
          name: SKILL_LABELS[domain],
          source: 'Active AI' as const,
          score,
          detail: evidenceCount === 1 ? '1 signal' : `${evidenceCount} signals`,
          status: skillStatus(score),
          trend: (velocities[domain] || 0) > 0.5 ? 'improving' : (velocities[domain] || 0) < -0.5 ? 'degrading' : 'stable',
        }
      })

    const derivedRows = inferSkillRowsFromBusinessData(getBackupData(), proposalHistory)
      .filter(row => !aiRows.some(ai => ai.name === row.name))
    const baselineRows = ELECTRICIAN_OWNER_BASELINE_SKILLS.map(row => ({
      id: `suggested-${row.name}`,
      name: row.name,
      source: 'Suggested' as const,
      score: row.score,
      detail: row.detail,
      status: skillStatus(row.score),
      trend: 'stable',
    }))

    const intelligenceRows = aiRows.length + derivedRows.length > 0
      ? [...aiRows, ...derivedRows].slice(0, 10)
      : baselineRows

    return [...manualRows, ...intelligenceRows].slice(0, 16)
  }, [ownerProfile.skill_inventory, signals, skillMap, velocities, proposalHistory])

  const hasData = skillRows.length > 0

  if (!hasData) {
    return (
      <div className="flex h-[600px] flex-col rounded-2xl border border-cyan-400/15 bg-gradient-to-br from-slate-950/95 via-blue-950/25 to-slate-950/90 p-4 shadow-2xl shadow-cyan-950/20">
          <div className="flex items-start justify-between gap-3 border-b border-cyan-400/10 pb-3">
            <div>
              <h3 className="text-sm font-bold text-cyan-50">Skill progress map</h3>
              <p className="mt-0.5 text-xs text-slate-500">Manual skills and AI-recognized signals.</p>
            </div>
            <span className="rounded-full border border-cyan-400/20 bg-cyan-400/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-cyan-200">
              Waiting
            </span>
          </div>

          <div className="flex flex-1 flex-col justify-center">
            <div className="mx-auto w-full max-w-sm rounded-xl border border-slate-700/60 bg-slate-950/70 p-4 shadow-inner shadow-blue-950/20">
              <div className="mb-4 flex items-center justify-center gap-2 text-slate-400">
                <BarChart2 size={18} className="text-cyan-300/70" />
                <p className="text-sm font-semibold text-slate-300">No skill signals captured yet</p>
              </div>
              <div className="space-y-2">
                {[68, 45, 78, 32, 56].map((width, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <div className="h-2 w-16 rounded bg-slate-800/80" />
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-800/90">
                      <div className="h-full rounded-full bg-cyan-400/20" style={{ width: `${width}%` }} />
                    </div>
                  </div>
                ))}
              </div>
              <p className="mt-4 text-center text-xs text-slate-600">
                Use NEXUS chat, save journal entries, or log field notes to begin capturing skill evidence.
              </p>
            </div>
          </div>
        </div>
    )
  }

  return (
    <div className="flex h-[600px] flex-col rounded-2xl border border-cyan-400/15 bg-gradient-to-br from-slate-950/95 via-blue-950/25 to-slate-950/90 p-4 shadow-2xl shadow-cyan-950/20">
        <div className="flex items-start justify-between gap-3 border-b border-cyan-400/10 pb-3">
          <div>
            <h3 className="text-sm font-bold text-cyan-50">Skill progress map</h3>
            <p className="mt-0.5 text-xs text-slate-500">Manual skills and AI-recognized signals.</p>
          </div>
          <div className="flex flex-wrap justify-end gap-1.5">
            <button
              type="button"
              onClick={refreshSkillIntelligence}
              disabled={analyzingSkills}
              className="inline-flex items-center gap-1 rounded-lg border border-cyan-400/25 bg-cyan-400/10 px-2 py-1 text-[10px] font-semibold text-cyan-100 transition-colors hover:bg-cyan-400/15 disabled:cursor-not-allowed disabled:opacity-50"
              title="Refresh skills"
            >
              <RefreshCw size={11} className={analyzingSkills ? 'animate-spin' : ''} />
              {analyzingSkills ? 'Analyzing' : 'Refresh Skills'}
            </button>
            <span className="rounded-full border border-slate-500/20 bg-slate-500/10 px-2 py-1 text-[10px] font-semibold text-slate-300">
              {skillRows.filter(row => row.source === 'Manual').length} Manual
            </span>
            <span className="rounded-full border border-cyan-400/20 bg-cyan-400/10 px-2 py-1 text-[10px] font-semibold text-cyan-200">
              {skillRows.filter(row => row.source === 'Active AI' || row.source === 'Accepted AI').length} Active AI
            </span>
            <span className="rounded-full border border-amber-400/20 bg-amber-400/10 px-2 py-1 text-[10px] font-semibold text-amber-200">
              {skillRows.filter(row => row.source === 'Suggested').length} Suggested
            </span>
          </div>
        </div>
        {skillMessage && (
          <div className={`mt-2 text-right text-[10px] ${skillMessage.includes('failed') ? 'text-red-300' : 'text-emerald-300'}`}>
            {skillMessage}
          </div>
        )}

        <div className="mt-3 min-h-0 flex-1 overflow-y-auto pr-1">
          <div className="space-y-2">
            {skillRows.map(row => (
              <div key={row.id} className="rounded-xl border border-cyan-400/10 bg-slate-950/70 p-3 shadow-inner shadow-blue-950/20">
                <div className="mb-2 flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-xs font-semibold text-slate-200">{row.name}</span>
                  <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                    row.source === 'Manual'
                      ? 'border-slate-400/20 bg-slate-400/10 text-slate-300'
                      : row.source === 'Suggested'
                        ? 'border-amber-400/20 bg-amber-400/10 text-amber-200'
                        : row.source === 'Accepted AI'
                          ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-200'
                          : 'border-cyan-400/20 bg-cyan-400/10 text-cyan-200'
                  }`}>
                    {row.source}
                  </span>
                  <span className="w-10 text-right text-[11px] font-semibold text-cyan-100">{row.score}%</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-slate-800/90">
                  <div
                    className={`h-full rounded-full ${row.source === 'Manual' ? 'bg-slate-400/70' : row.source === 'Suggested' ? 'bg-gradient-to-r from-amber-300 to-yellow-200' : 'bg-gradient-to-r from-cyan-400 to-sky-300'}`}
                    style={{ width: `${Math.max(8, Math.min(100, row.score))}%` }}
                  />
                </div>
                <div className="mt-2 flex items-center justify-between text-[10px] text-slate-600">
                  <span>{row.detail}</span>
                  <span className="flex items-center gap-2">
                    <span className="font-semibold text-slate-400">{row.status}</span>
                    {row.trend && <span className="capitalize">{row.trend}</span>}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {recentSignals.length > 0 && (
          <div className="mt-3 border-t border-cyan-400/10 pt-3">
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-slate-300">
              <BookOpen size={13} className="text-cyan-300" />
              Recent evidence
            </div>
            <div className="space-y-1.5">
              {recentSignals.slice(0, 3).map((s, i) => {
                const date = new Date(s.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                return (
                  <div key={i} className="rounded-lg border border-slate-700/60 bg-slate-950/70 px-2.5 py-2 text-[11px]">
                    <div className="flex items-center gap-2 text-slate-500">
                      <span className="font-semibold text-cyan-200">{SKILL_LABELS[s.skill as SkillDomain] || s.skill}</span>
                      <span>{s.source?.replace('_', ' ')}</span>
                      <span className="ml-auto">{date}</span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-slate-400">{s.evidence}</p>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {false && (
        <div className="space-y-8">

        {/* SECTION 1: Skill Map Bar Chart */}
        <div>
          <h3 className="text-sm font-bold text-blue-400 mb-4 flex items-center gap-2">
            <BarChart2 size={16} />
            Skill Map vs Ideal Profile
          </h3>
          <div className="space-y-4">
            {SKILL_DOMAINS.map(domain => (
              <ScoreBar
                key={domain}
                domain={domain}
                score={skillMap[domain]?.score ?? 0}
                target={IDEAL_PROFILE[domain]?.target ?? 80}
              />
            ))}
          </div>
          <div className="flex items-center gap-4 mt-3 text-[10px] text-gray-500">
            <span className="flex items-center gap-1"><span className="w-3 h-1 bg-green-500 rounded inline-block" />Within 10 pts</span>
            <span className="flex items-center gap-1"><span className="w-3 h-1 bg-yellow-500 rounded inline-block" />11-25 pts behind</span>
            <span className="flex items-center gap-1"><span className="w-3 h-1 bg-red-500 rounded inline-block" />25+ pts behind</span>
          </div>
        </div>

        {/* SECTION 2: Development Velocity */}
        <div>
          <h3 className="text-sm font-bold text-green-400 mb-4 flex items-center gap-2">
            <TrendingUp size={16} />
            Development Velocity (sorted by 30-day gain)
          </h3>
          <div className="grid grid-cols-2 gap-2">
            {skillsByVelocity.map(domain => (
              <VelocityCard
                key={domain}
                domain={domain}
                score={skillMap[domain]?.score ?? 0}
                velocity={velocities[domain] || 0}
              />
            ))}
          </div>
        </div>

        {/* SECTION 3: Top 3 Priorities */}
        <div>
          <h3 className="text-sm font-bold text-orange-400 mb-4 flex items-center gap-2">
            <Target size={16} />
            Top 3 Development Priorities
          </h3>
          <div className="space-y-3">
            {top3Gaps.map((domain, idx) => (
              <PriorityCard
                key={domain}
                rank={idx + 1}
                domain={domain}
                score={skillMap[domain]?.score ?? 0}
                target={IDEAL_PROFILE[domain]?.target ?? 80}
              />
            ))}
          </div>
        </div>

        {/* SECTION 4: Evidence Log */}
        <div>
          <h3 className="text-sm font-bold text-purple-400 mb-4 flex items-center gap-2">
            <BookOpen size={16} />
            Recent Skill Signals Captured
          </h3>
          {recentSignals.length === 0 ? (
            <p className="text-gray-500 text-xs">No signals yet. Use NEXUS, journal, or field logs to start capturing.</p>
          ) : (
            <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
              {recentSignals.map((s, i) => {
                const signalColor = s.signal === 'positive' ? 'text-green-400' : s.signal === 'gap' ? 'text-red-400' : 'text-yellow-400'
                const signalLabel = s.signal === 'positive' ? '✓' : s.signal === 'gap' ? '!' : '→'
                const date = new Date(s.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                return (
                  <div key={i} className="rounded p-2 border text-[11px]" style={{ backgroundColor: 'var(--bg-input)', borderColor: 'var(--border-secondary)' }}>
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`font-bold ${signalColor}`}>{signalLabel}</span>
                      <span className="text-blue-300 font-semibold">{SKILL_LABELS[s.skill as SkillDomain] || s.skill}</span>
                      <span className="text-gray-600">·</span>
                      <span className="text-gray-500 capitalize">{s.source?.replace('_', ' ')}</span>
                      <span className="ml-auto text-gray-600">{date}</span>
                    </div>
                    <p className="text-gray-400 leading-snug">{s.evidence}</p>
                  </div>
                )
              })}
            </div>
          )}
        </div>
        </div>
        )}
      </div>
  )
}
// ── Owner Profile Sub-Component ──────────────────────────────────────────────

/**
 * OwnerProfileCard — "My Profile" section in Settings
 *
 * Stores strategic context (skills, gaps, city licenses, open permits, goals,
 * bandwidth) in the owner_profile Supabase table AND in localStorage so NEXUS
 * can inject it into its system prompt without a blocking async call.
 */
function OwnerProfileCard() {
  const [profile, setProfile] = useState(() => getLocalOwnerProfile())
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState('')

  // Tag input helpers
  const [skillInput, setSkillInput] = useState('')
  const [gapInput, setGapInput] = useState('')
  const [goalInput, setGoalInput] = useState('')

  // City license form
  const [licenseCity, setLicenseCity] = useState('')
  const [licenseStatus, setLicenseStatus] = useState<'active' | 'pending' | 'needed'>('active')

  // Derive a stable org_id from the Supabase URL env var (project ref = first subdomain segment)
  const orgId = (() => {
    try {
      const url = import.meta.env.VITE_SUPABASE_URL || ''
      const match = url.match(/https?:\/\/([^.]+)/)
      return match ? match[1] : 'local'
    } catch { return 'local' }
  })()

  const persist = useCallback(async (updated: typeof profile) => {
    setProfile(updated)
    saveLocalOwnerProfile(updated)
    setSaving(true)
    setSaveMsg('')
    const { ok, error } = await saveOwnerProfile(orgId, updated)
    setSaving(false)
    setSaveMsg(ok ? 'Saved ✓' : `Saved locally (cloud: ${error})`)
    setTimeout(() => setSaveMsg(''), 3000)
  }, [orgId])

  // ── Tag helpers ───────────────────────────────────────────────────────────

  const addTag = (field: 'skill_inventory' | 'knowledge_gaps' | 'business_goals', value: string) => {
    const v = value.trim()
    if (!v) return
    const updated = { ...profile, [field]: [...profile[field], v] }
    persist(updated)
  }

  const removeTag = (field: 'skill_inventory' | 'knowledge_gaps' | 'business_goals', idx: number) => {
    const updated = { ...profile, [field]: profile[field].filter((_: any, i: number) => i !== idx) }
    persist(updated)
  }

  // ── City license helpers ──────────────────────────────────────────────────

  const addLicense = () => {
    const city = licenseCity.trim()
    if (!city) return
    const entry: CityLicense = { city, status: licenseStatus }
    const updated = { ...profile, active_city_licenses: [...profile.active_city_licenses, entry] }
    setLicenseCity('')
    persist(updated)
  }

  const removeLicense = (idx: number) => {
    const updated = { ...profile, active_city_licenses: profile.active_city_licenses.filter((_: any, i: number) => i !== idx) }
    persist(updated)
  }


  // ── Tag input key handler ─────────────────────────────────────────────────

  const onTagKey = (e: React.KeyboardEvent<HTMLInputElement>, field: 'skill_inventory' | 'knowledge_gaps' | 'business_goals', value: string, clear: () => void) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      addTag(field, value)
      clear()
    }
  }

  // ── Shared status badge ───────────────────────────────────────────────────

  const statusColor = (s: string) =>
    s === 'active' ? 'bg-green-600/20 text-green-400 border-green-600/30'
    : s === 'pending' ? 'bg-yellow-600/20 text-yellow-400 border-yellow-600/30'
    : 'bg-gray-600/20 text-gray-400 border-gray-600/30'

  return (
    <div className="rounded-2xl border border-cyan-400/15 bg-gradient-to-br from-slate-950/95 via-blue-950/25 to-slate-950/90 p-4 shadow-2xl shadow-cyan-950/20">
        <div className="mb-4 flex flex-col gap-3 border-b border-cyan-400/10 pb-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h3 className="text-base font-bold text-cyan-50">Strategic Context for NEXUS</h3>
            <p className="mt-1 text-xs text-slate-400">Skills, gaps, registrations, goals, and current capacity.</p>
          </div>
          <span className="w-fit rounded-full border border-cyan-400/20 bg-cyan-400/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-cyan-200">
            Local-first profile
          </span>
        </div>

        {/* Save status */}
        {(saving || saveMsg) && (
          <div className={`mb-4 text-xs px-3 py-1.5 rounded-lg border ${saving ? 'text-blue-300 border-blue-400/30 bg-blue-900/20' : 'text-green-300 border-green-400/30 bg-green-900/20'}`}>
            {saving ? 'Saving…' : saveMsg}
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">

        {/* Skills inventory */}
        <div className="rounded-xl border border-cyan-400/10 bg-slate-950/70 p-3 shadow-inner shadow-blue-950/20">
          <label className="block text-xs font-semibold text-cyan-200/80 uppercase mb-2 tracking-wider">Skills Inventory</label>
          <p className="text-[10px] text-gray-600 mb-2">Things you can do. e.g. "Service work", "Rough-in", "Solar installation", "Commercial TI"</p>
          <div className="flex flex-wrap gap-1.5 mb-2">
            {profile.skill_inventory.map((skill: string, i: number) => (
              <span key={i} className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-blue-600/20 text-blue-300 border border-blue-600/30">
                {skill}
                <button onClick={() => removeTag('skill_inventory', i)} className="text-blue-500 hover:text-blue-200 ml-0.5">×</button>
              </span>
            ))}
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={skillInput}
              onChange={e => setSkillInput(e.target.value)}
              onKeyDown={e => onTagKey(e, 'skill_inventory', skillInput, () => setSkillInput(''))}
              placeholder="Type skill + Enter"
              className="flex-1 text-xs px-3 py-2 rounded border theme-input"
            />
            <button
              onClick={() => { addTag('skill_inventory', skillInput); setSkillInput('') }}
              className="text-xs px-3 py-2 bg-blue-600/30 text-blue-300 rounded border border-blue-500/30 hover:bg-blue-600/40"
            >+ Add</button>
          </div>
        </div>

        {/* Knowledge gaps */}
        <div className="rounded-xl border border-amber-400/10 bg-slate-950/70 p-3 shadow-inner shadow-blue-950/20">
          <label className="block text-xs font-semibold text-amber-200/80 uppercase mb-2 tracking-wider">Knowledge Gaps / Actively Learning</label>
          <p className="text-[10px] text-gray-600 mb-2">Things you're learning or need to develop. e.g. "Permitting", "Load calculations", "Arc flash"</p>
          <div className="flex flex-wrap gap-1.5 mb-2">
            {profile.knowledge_gaps.map((gap: string, i: number) => (
              <span key={i} className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-yellow-600/20 text-yellow-300 border border-yellow-600/30">
                {gap}
                <button onClick={() => removeTag('knowledge_gaps', i)} className="text-yellow-500 hover:text-yellow-200 ml-0.5">×</button>
              </span>
            ))}
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={gapInput}
              onChange={e => setGapInput(e.target.value)}
              onKeyDown={e => onTagKey(e, 'knowledge_gaps', gapInput, () => setGapInput(''))}
              placeholder="Type gap + Enter"
              className="flex-1 text-xs px-3 py-2 rounded border theme-input"
            />
            <button
              onClick={() => { addTag('knowledge_gaps', gapInput); setGapInput('') }}
              className="text-xs px-3 py-2 bg-yellow-600/30 text-yellow-300 rounded border border-yellow-500/30 hover:bg-yellow-600/40"
            >+ Add</button>
          </div>
        </div>

        {/* City Licenses */}
        <div className="rounded-xl border border-emerald-400/10 bg-slate-950/70 p-3 shadow-inner shadow-blue-950/20">
          <label className="block text-xs font-semibold text-emerald-200/80 uppercase mb-2 tracking-wider">City Licenses / Registrations</label>
          <div className="space-y-1.5 mb-3">
            {profile.active_city_licenses.length === 0 && (
              <p className="text-[10px] text-gray-600 italic">No cities added yet.</p>
            )}
            {profile.active_city_licenses.map((lic: CityLicense, i: number) => (
              <div key={i} className="flex items-center justify-between text-xs px-3 py-1.5 rounded border" style={{ backgroundColor: 'var(--bg-input)', borderColor: 'var(--border-secondary)' }}>
                <span className="text-gray-300 font-medium">{lic.city}</span>
                <div className="flex items-center gap-2">
                  <span className={`px-2 py-0.5 rounded text-[10px] border ${statusColor(lic.status)}`}>{lic.status}</span>
                  <button onClick={() => removeLicense(i)} className="text-gray-600 hover:text-red-400">×</button>
                </div>
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={licenseCity}
              onChange={e => setLicenseCity(e.target.value)}
              placeholder="City name"
              className="flex-1 text-xs px-3 py-2 rounded border theme-input"
            />
            <select
              value={licenseStatus}
              onChange={e => setLicenseStatus(e.target.value as any)}
              className="text-xs px-2 py-2 rounded border theme-input"
            >
              <option value="active">Active</option>
              <option value="pending">Pending</option>
              <option value="needed">Needed</option>
            </select>
            <button
              onClick={addLicense}
              className="text-xs px-3 py-2 bg-green-600/30 text-green-300 rounded border border-green-500/30 hover:bg-green-600/40"
            >+ Add</button>
          </div>
        </div>


        {/* Business Goals */}
        <div className="rounded-xl border border-sky-400/10 bg-slate-950/70 p-3 shadow-inner shadow-blue-950/20">
          <label className="block text-xs font-semibold text-sky-200/80 uppercase mb-2 tracking-wider">Business Goals</label>
          <p className="text-[10px] text-gray-600 mb-2">e.g. "Hit $150K active pipeline before hiring", "Close MTZ Solar RMO"</p>
          <div className="space-y-1.5 mb-2">
            {profile.business_goals.map((goal: string, i: number) => (
              <div key={i} className="flex items-center justify-between text-xs px-3 py-1.5 rounded border" style={{ backgroundColor: 'var(--bg-input)', borderColor: 'var(--border-secondary)' }}>
                <span className="text-gray-300">{goal}</span>
                <button onClick={() => removeTag('business_goals', i)} className="text-gray-600 hover:text-red-400">×</button>
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={goalInput}
              onChange={e => setGoalInput(e.target.value)}
              onKeyDown={e => onTagKey(e, 'business_goals', goalInput, () => setGoalInput(''))}
              placeholder="Type goal + Enter"
              className="flex-1 text-xs px-3 py-2 rounded border theme-input"
            />
            <button
              onClick={() => { addTag('business_goals', goalInput); setGoalInput('') }}
              className="text-xs px-3 py-2 bg-emerald-600/30 text-emerald-300 rounded border border-emerald-500/30 hover:bg-emerald-600/40"
            >+ Add</button>
          </div>
        </div>

        {/* Bandwidth Notes */}
        <div className="rounded-xl border border-violet-400/10 bg-slate-950/70 p-3 shadow-inner shadow-blue-950/20 lg:col-span-2">
          <label className="block text-xs font-semibold text-violet-200/80 uppercase mb-2 tracking-wider">Current Bandwidth / Constraints</label>
          <p className="text-[10px] text-gray-600 mb-2">Free-text. e.g. "Running solo, maxed at 2 active projects" or "Looking to add 1 helper by Q3"</p>
          <textarea
            value={profile.bandwidth_notes}
            onChange={e => {
              const updated = { ...profile, bandwidth_notes: e.target.value }
              setProfile(updated)
              saveLocalOwnerProfile(updated)
            }}
            onBlur={async () => {
              setSaving(true)
              const { ok } = await saveOwnerProfile(orgId, profile)
              setSaving(false)
              setSaveMsg(ok ? 'Saved ✓' : 'Saved locally')
              setTimeout(() => setSaveMsg(''), 3000)
            }}
            rows={3}
            placeholder="Describe your current capacity and any constraints…"
            className="w-full text-xs px-3 py-2 rounded border theme-input resize-none"
          />
        </div>

        </div>
      </div>
  )
}

// ── B21: Milestone Backup + Change History Sub-Component ─────────────────────

function MilestoneBackupCard() {
  const [snapshots, setSnapshots] = useState<MilestoneSnapshotMeta[]>([])
  const [filter, setFilter] = useState<SnapshotFilter>('all')
  const [milestoneLabel, setMilestoneLabel] = useState('')
  const [loading, setLoading] = useState(false)
  const [loadingSnaps, setLoadingSnaps] = useState(false)
  const [restoreTarget, setRestoreTarget] = useState<MilestoneSnapshotMeta | null>(null)
  const [restoreConfirmText, setRestoreConfirmText] = useState('')
  const [restoring, setRestoring] = useState(false)
  const [statusMsg, setStatusMsg] = useState('')

  const loadSnapshots = useCallback(async (f: SnapshotFilter = filter) => {
    setLoadingSnaps(true)
    const data = await listMilestoneSnapshots(f)
    setSnapshots(data)
    setLoadingSnaps(false)
  }, [filter])

  useEffect(() => {
    loadSnapshots(filter)
  }, [filter])

  const handleExportNow = useCallback(() => {
    exportCurrentData()
    setStatusMsg('Export downloaded ✓')
    setTimeout(() => setStatusMsg(''), 3000)
  }, [])

  const handleCreateMilestone = useCallback(async () => {
    const label = milestoneLabel.trim() || `Milestone ${new Date().toLocaleDateString()}`
    setLoading(true)
    const saved = await createMilestone(label)
    setLoading(false)
    if (saved) {
      setStatusMsg('Milestone saved + downloaded ✓')
      setMilestoneLabel('')
      loadSnapshots(filter)
    } else {
      setStatusMsg('Downloaded locally (Supabase save failed)')
    }
    setTimeout(() => setStatusMsg(''), 4000)
  }, [milestoneLabel, filter, loadSnapshots])

  const handleRestoreClick = useCallback((snap: MilestoneSnapshotMeta) => {
    setRestoreTarget(snap)
    setRestoreConfirmText('')
  }, [])

  const handleConfirmRestore = useCallback(async () => {
    if (!restoreTarget || restoreConfirmText !== 'RESTORE') return
    setRestoring(true)
    const full = await getMilestoneSnapshot(restoreTarget.id)
    if (!full) {
      setRestoring(false)
      setStatusMsg('Failed to fetch snapshot data')
      setTimeout(() => setStatusMsg(''), 3000)
      return
    }
    restoreMilestone(full)
    // restoreMilestone calls window.location.reload() — this line won't be reached
    setRestoring(false)
  }, [restoreTarget, restoreConfirmText])

  const triggerLabel = (t: string) => {
    const map: Record<string, string> = {
      project_created: 'Project Created',
      project_updated: 'Project Updated',
      project_deleted: 'Project Deleted',
      field_log_added: 'Field Log Added',
      service_log_added: 'Service Log Added',
      service_status_changed: 'Service Status',
      invoice_created: 'Invoice Created',
      invoice_paid: 'Invoice Paid',
      phase_changed: 'Phase Changed',
      lead_status_changed: 'Lead Status',
      manual: 'Manual',
      weekly_auto: 'Weekly Auto',
    }
    return map[t] || t
  }

  const FILTERS: { key: SnapshotFilter; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'manual', label: 'Manual' },
    { key: 'auto', label: 'Auto' },
    { key: 'weekly', label: 'Weekly' },
  ]

  return (
    <SettingCard title="Backup and Restore">
      <div className="space-y-4">

        {/* Status message */}
        {statusMsg && (
          <div className="text-xs text-emerald-400 px-3 py-2 rounded bg-emerald-500/10 border border-emerald-500/20">
            {statusMsg}
          </div>
        )}

        {/* Export Now */}
        <div>
          <button
            onClick={handleExportNow}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-blue-600/25 hover:bg-blue-600/35 text-blue-300 rounded text-xs font-medium border border-blue-500/30 transition"
          >
            <Download size={12} />
            Export Now
          </button>
          <p className="text-[10px] text-gray-600 mt-1">Downloads current app state as JSON immediately. No Supabase write.</p>
        </div>

        {/* Create Milestone */}
        <div className="space-y-2">
          <label className="block text-xs font-semibold text-gray-400 uppercase">Create Milestone</label>
          <div className="flex gap-2">
            <input
              type="text"
              value={milestoneLabel}
              onChange={e => setMilestoneLabel(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleCreateMilestone() }}
              placeholder="Milestone label (optional)…"
              className="flex-1 text-xs px-3 py-2 rounded border theme-input"
            />
            <button
              onClick={handleCreateMilestone}
              disabled={loading}
              className="flex items-center gap-1 px-3 py-2 bg-emerald-600/25 hover:bg-emerald-600/35 text-emerald-300 rounded text-xs font-medium border border-emerald-500/30 disabled:opacity-50 transition"
            >
              {loading ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
              Save + Download
            </button>
          </div>
          <p className="text-[10px] text-gray-600">Saves to Supabase and triggers a JSON file download.</p>
        </div>

        {/* Filter tabs */}
        <div>
          <div className="flex gap-1 mb-2">
            {FILTERS.map(f => (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={`px-2 py-1 rounded text-[10px] font-medium border transition ${
                  filter === f.key
                    ? 'bg-cyan-600/30 text-cyan-300 border-cyan-500/40'
                    : 'bg-transparent text-gray-500 border-gray-700/50 hover:text-gray-300'
                }`}
              >
                {f.label}
              </button>
            ))}
            <button
              onClick={() => loadSnapshots(filter)}
              className="ml-auto px-2 py-1 text-gray-500 hover:text-gray-300 transition"
              title="Refresh"
            >
              <RefreshCw size={10} />
            </button>
          </div>

          {/* Snapshot history table */}
          <div className="rounded border overflow-hidden" style={{ borderColor: 'var(--border-secondary)' }}>
            <div className="grid text-[10px] font-semibold text-gray-500 uppercase px-3 py-1.5 border-b" style={{ gridTemplateColumns: '1fr 1.5fr 1fr 0.6fr auto', borderColor: 'var(--border-secondary)', backgroundColor: 'var(--bg-input)' }}>
              <span>Date</span>
              <span>Label</span>
              <span>Trigger</span>
              <span>Size</span>
              <span></span>
            </div>

            {loadingSnaps ? (
              <div className="flex items-center justify-center py-6 text-gray-600 text-xs gap-2">
                <Loader2 size={12} className="animate-spin" />
                Loading…
              </div>
            ) : snapshots.length === 0 ? (
              <div className="text-center py-6 text-xs text-gray-600">No snapshots found</div>
            ) : (
              <div className="max-h-72 overflow-y-auto">
                {snapshots.map(snap => (
                  <div
                    key={snap.id}
                    className="grid items-center px-3 py-2 border-b text-xs hover:bg-white/5 transition"
                    style={{ gridTemplateColumns: '1fr 1.5fr 1fr 0.6fr auto', borderColor: 'var(--border-secondary)' }}
                  >
                    <span className="text-gray-400 text-[10px]">
                      {new Date(snap.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit', hour: '2-digit', minute: '2-digit' })}
                    </span>
                    <span className="text-gray-300 truncate text-[10px] pr-2" title={snap.label}>{snap.label}</span>
                    <span className="text-[9px] px-1.5 py-0.5 rounded font-medium w-fit" style={{
                      backgroundColor: snap.trigger_event === 'manual' ? 'rgba(99,102,241,0.2)' : snap.trigger_event === 'weekly_auto' ? 'rgba(245,158,11,0.15)' : 'rgba(16,185,129,0.15)',
                      color: snap.trigger_event === 'manual' ? '#a5b4fc' : snap.trigger_event === 'weekly_auto' ? '#fbbf24' : '#6ee7b7',
                    }}>
                      {triggerLabel(snap.trigger_event)}
                    </span>
                    <span className="text-gray-500 text-[10px]">{formatSizeBytes(snap.size_bytes)}</span>
                    <button
                      onClick={() => handleRestoreClick(snap)}
                      className="text-[10px] px-2 py-1 bg-amber-600/20 hover:bg-amber-600/30 text-amber-300 rounded border border-amber-500/30 transition"
                    >
                      Restore
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Restore confirmation modal (inline) */}
        {restoreTarget && (
          <div className="rounded-lg border border-red-500/40 p-4 space-y-3 mt-2" style={{ backgroundColor: 'var(--bg-input)' }}>
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-sm font-bold text-red-300">Confirm Restore</p>
                <p className="text-[10px] text-gray-400 mt-0.5">"{restoreTarget.label}"</p>
                <p className="text-[10px] text-gray-500 mt-1">
                  This will overwrite ALL current localStorage data with this snapshot and reload the app.
                </p>
              </div>
              <button onClick={() => setRestoreTarget(null)} className="text-gray-500 hover:text-gray-300 mt-0.5">
                <X size={14} />
              </button>
            </div>
            <div>
              <p className="text-[10px] text-gray-500 mb-1">Type <span className="font-mono font-bold text-red-400">RESTORE</span> to confirm:</p>
              <input
                type="text"
                value={restoreConfirmText}
                onChange={e => setRestoreConfirmText(e.target.value)}
                placeholder="RESTORE"
                className="w-full text-xs px-3 py-2 rounded border theme-input font-mono"
                autoFocus
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleConfirmRestore}
                disabled={restoreConfirmText !== 'RESTORE' || restoring}
                className="flex-1 flex items-center justify-center gap-1 px-3 py-2 text-xs font-semibold rounded bg-red-600 hover:bg-red-500 text-white disabled:opacity-40 disabled:cursor-not-allowed transition"
              >
                {restoring ? <Loader2 size={12} className="animate-spin" /> : null}
                Restore + Reload
              </button>
              <button
                onClick={() => setRestoreTarget(null)}
                className="px-3 py-2 text-xs text-gray-400 rounded border border-gray-700/50 hover:text-gray-200 transition"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

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

