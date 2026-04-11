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
import { Settings, Download, Upload, RotateCcw, Save, Trash2, AlertCircle, Sparkles, FileText, Check, X, Loader2, Moon, Sun, Image, Copy, RefreshCw, Eye, EyeOff, Shield, Lock, TrendingUp, TrendingDown, Minus, BarChart2, Target, Zap, BookOpen, LogOut, UserPlus, Play, Square, Volume2 } from 'lucide-react'
import DemoInvite from '@/components/admin/DemoInvite'
import { getLocalSkillMap, getLocalSkillSignals, getLocalDevelopmentLog, calculateDevelopmentRate, IDEAL_PROFILE, SKILL_DOMAINS } from '@/services/skillSignalExtractor'
import type { SkillDomain, StoredSkillSignal } from '@/services/skillSignalExtractor'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { useAuthStore } from '@/store/authStore'
import { verifyPasscode, setPasscode } from '@/lib/auth/passcode'
import { getBackupData, saveBackupData, exportBackup, importBackupFromFile, isSupabaseConfigured, forceSyncToCloud, num, fmt, fmtK, pct, getProjectFinancials, getSnapshots, createSnapshot, restoreSnapshot, type BackupSettings, type BackupData, type DataSnapshot } from '@/services/backupDataService'
import { getLocalOwnerProfile, saveLocalOwnerProfile, saveOwnerProfile, type CityLicense, type OpenPermit } from '@/services/ownerProfileService'
import { pushState, clear as clearHistory, setMaxHistoryDepth } from '@/services/undoRedoService'
import { extractFromPDF, mapToServiceLog, mapToProject, logImport, processBatch, type QBBatchItem, type QBExtractedData } from '@/services/quickbooksImportService'
import { VoiceSettings } from '@/components/voice/VoiceSettings'
import SnapshotPanel from '@/components/SnapshotPanel'
import { ProposalQueue } from '@/components/ProposalQueue'
import { useDemoStore } from '@/store/demoStore'
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

export default function V15rSettingsPanel() {
  const backup = getBackupData()
  if (!backup) return <NoData />

  const [, setTick] = useState(0)
  const forceUpdate = useCallback(() => setTick(t => t + 1), [])

  // Auth (for owner role check)
  const { isOwner, user } = useAuth()

  // Beta Access invite modal
  const [showBetaInviteModal, setShowBetaInviteModal] = useState(false)

  // Demo Mode store
  const { isDemoMode, enableDemoMode, disableDemoMode } = useDemoStore()
  const [showDemoConfirm, setShowDemoConfirm] = useState(false)
  const [showExitDemoModal, setShowExitDemoModal] = useState(false)

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
                      : 'bg-sky-100 text-blue-700 border border-sky-300'
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

          {/* Cloud Snapshot History (Supabase-backed) */}
          <SettingCard title="Cloud Snapshot History">
            <SnapshotPanel />
          </SettingCard>

          {/* MiroFish Proposal Queue */}
          <div data-section="proposals">
            <SettingCard title="Proposals">
              <ProposalQueue maxHeight="600px" />
            </SettingCard>
          </div>

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

          {/* B21 — BACKUP AND RESTORE */}
          <MilestoneBackupCard />

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

          {/* MY DEVELOPMENT — SKILL INTELLIGENCE */}
          <SkillIntelligenceCard />

          {/* MY PROFILE */}
          <OwnerProfileCard />

          {/* NEXUS VOICE */}
          <SettingCard title="NEXUS Voice">
            <NexusVoiceSelector />
          </SettingCard>

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

          {/* DATA MANAGEMENT — owner only: load / clear / verify test data */}
          {isOwner && (
            <SettingCard title="Data Management">
              <TestDataManagementPanel />
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
  const signOut = useAuthStore(s => s.signOut)
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
          Change the 6-digit passcode used to unlock the app.
        </p>
        <button
          onClick={openModal}
          className="flex items-center gap-2 px-4 py-2 rounded text-sm font-semibold bg-blue-900/30 text-blue-300 border border-blue-700/30 hover:bg-blue-900/50 transition-colors"
        >
          <Lock size={14} />
          Change Passcode
        </button>

        <button
          onClick={() => setShowDeviceLogoutConfirm(true)}
          className="flex items-center gap-2 px-4 py-2 rounded text-sm font-semibold bg-red-900/20 text-red-400 border border-red-700/30 hover:bg-red-900/40 transition-colors"
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
                  localStorage.removeItem('poweron_pin_hash')
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

function SkillIntelligenceCard() {
  const [skillMap] = useState(() => getLocalSkillMap())
  const [signals] = useState(() => getLocalSkillSignals())
  const [, setTick] = useState(0)

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

  const hasData = SKILL_DOMAINS.some(d => (skillMap[d]?.score ?? 0) > 0)

  if (!hasData) {
    return (
      <SettingCard title="My Development — Skill Intelligence">
        <div className="text-center py-8">
          <BarChart2 size={40} className="mx-auto text-gray-600 mb-3" />
          <p className="text-gray-400 text-sm font-medium">No skill signals captured yet</p>
          <p className="text-gray-600 text-xs mt-1">
            Use NEXUS chat, save journal entries, or log field notes — skill signals are captured automatically.
          </p>
        </div>
      </SettingCard>
    )
  }

  return (
    <SettingCard title="My Development — Skill Intelligence">
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
    </SettingCard>
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

  // Open permit form
  const [permitProject, setPermitProject] = useState('')
  const [permitCity, setPermitCity] = useState('')
  const [permitNumber, setPermitNumber] = useState('')
  const [permitStatus, setPermitStatus] = useState('')

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

  // ── Open permit helpers ───────────────────────────────────────────────────

  const addPermit = () => {
    const projectName = permitProject.trim()
    const city = permitCity.trim()
    if (!projectName || !city) return
    const entry: OpenPermit = {
      projectName,
      city,
      permitNumber: permitNumber.trim() || '—',
      status: permitStatus.trim() || 'Open',
    }
    const updated = { ...profile, open_permits: [...profile.open_permits, entry] }
    setPermitProject('')
    setPermitCity('')
    setPermitNumber('')
    setPermitStatus('')
    persist(updated)
  }

  const removePermit = (idx: number) => {
    const updated = { ...profile, open_permits: profile.open_permits.filter((_: any, i: number) => i !== idx) }
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
    <SettingCard title="My Profile — Strategic Context for NEXUS">
      <div className="space-y-6">

        {/* Save status */}
        {(saving || saveMsg) && (
          <div className={`text-xs px-3 py-1.5 rounded border ${saving ? 'text-blue-400 border-blue-500/30 bg-blue-900/20' : 'text-green-400 border-green-500/30 bg-green-900/20'}`}>
            {saving ? 'Saving…' : saveMsg}
          </div>
        )}

        {/* Skills inventory */}
        <div>
          <label className="block text-xs font-semibold text-gray-500 uppercase mb-2">Skills Inventory</label>
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
        <div>
          <label className="block text-xs font-semibold text-gray-500 uppercase mb-2">Knowledge Gaps / Actively Learning</label>
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
        <div>
          <label className="block text-xs font-semibold text-gray-500 uppercase mb-2">City Licenses / Registrations</label>
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

        {/* Open Permits */}
        <div>
          <label className="block text-xs font-semibold text-gray-500 uppercase mb-2">Open Permits</label>
          <div className="space-y-1.5 mb-3">
            {profile.open_permits.length === 0 && (
              <p className="text-[10px] text-gray-600 italic">No open permits tracked.</p>
            )}
            {profile.open_permits.map((pmt: OpenPermit, i: number) => (
              <div key={i} className="flex items-center justify-between text-xs px-3 py-1.5 rounded border" style={{ backgroundColor: 'var(--bg-input)', borderColor: 'var(--border-secondary)' }}>
                <div>
                  <span className="text-gray-200 font-medium">{pmt.projectName}</span>
                  <span className="text-gray-500 ml-2">{pmt.city}</span>
                  {pmt.permitNumber !== '—' && <span className="text-gray-600 ml-2">#{pmt.permitNumber}</span>}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-gray-500 italic">{pmt.status}</span>
                  <button onClick={() => removePermit(i)} className="text-gray-600 hover:text-red-400">×</button>
                </div>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2 mb-2">
            <input
              type="text"
              value={permitProject}
              onChange={e => setPermitProject(e.target.value)}
              placeholder="Project name"
              className="text-xs px-3 py-2 rounded border theme-input"
            />
            <input
              type="text"
              value={permitCity}
              onChange={e => setPermitCity(e.target.value)}
              placeholder="City"
              className="text-xs px-3 py-2 rounded border theme-input"
            />
            <input
              type="text"
              value={permitNumber}
              onChange={e => setPermitNumber(e.target.value)}
              placeholder="Permit # (optional)"
              className="text-xs px-3 py-2 rounded border theme-input"
            />
            <input
              type="text"
              value={permitStatus}
              onChange={e => setPermitStatus(e.target.value)}
              placeholder="Status (e.g. Open, Finaled)"
              className="text-xs px-3 py-2 rounded border theme-input"
            />
          </div>
          <button
            onClick={addPermit}
            className="text-xs px-3 py-2 bg-purple-600/30 text-purple-300 rounded border border-purple-500/30 hover:bg-purple-600/40"
          >+ Add Permit</button>
        </div>

        {/* Business Goals */}
        <div>
          <label className="block text-xs font-semibold text-gray-500 uppercase mb-2">Business Goals</label>
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
        <div>
          <label className="block text-xs font-semibold text-gray-500 uppercase mb-2">Current Bandwidth / Constraints</label>
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
    </SettingCard>
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
