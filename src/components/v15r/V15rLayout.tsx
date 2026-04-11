// @ts-nocheck
import React, { useState, useEffect, useRef, useMemo } from 'react'
import {
  LayoutDashboard,
  FolderKanban,
  Users,
  FileStack,
  TrendingUp,
  BarChart3,
  ClipboardList,
  DollarSign,
  Calculator,
  BookOpen,
  Settings,
  Download,
  Upload,
  Clock,
  Zap,
  Undo2,
  Redo2,
  Mic,
  Mic2,
  Menu,
  X,
  Activity,
  ShieldAlert,
  ChevronDown,
  VolumeX,
  Volume2,
  Layers,
  LogOut,
  Plus,
  Brain,
  GitBranch,
  Phone,
  Scissors,
  Lock,
  Map,
  HardHat,
  FlaskConical,
  Terminal,
  Trophy,
  Pin,
  Building2,
  Globe,
} from 'lucide-react'
import { useAuthStore } from '@/store/authStore'
import { getBackupData, saveBackupData, importBackupFromFile, exportBackup, getKPIs, syncToSupabase, loadFromSupabase, isSupabaseConfigured, startPeriodicSync, forceSyncToCloud, getLastSyncMeta, type BackupData } from '@/services/backupDataService'
import { useDemoStore } from '@/store/demoStore'
import templates from '@/config/templates/index'
import { getDemoKPIs, DEMO_SERVICE_NET, DEMO_COMPANY } from '@/services/demoDataService'
import { undo, redo, canUndo, canRedo } from '@/services/undoRedoService'
import { initEventBus } from '@/services/agentEventBus'
import { subscribeNexusToEvents } from '@/agents/nexus'
import { subscribeLedgerToEvents } from '@/agents/ledger'
import { initPulseBusSubscriptions } from '@/agents/pulse'
import { initAlertEngine } from '@/services/proactiveAlertService'
import { initSparkBusListeners } from '@/agents/spark'
// NOTE: voice.ts intentionally NOT imported in QuickCaptureButton — mic uses MediaRecorder API only
import { synthesizeWithElevenLabs } from '@/api/voice/elevenLabs'
import { callClaude, extractText as claudeExtractText } from '@/services/claudeProxy'
// B32 — Multi-User Role Permission Foundation
import { getUserRole, canAccess, logAuditDecision, type B32Role, type B32Feature } from '@/services/rolePermissionService'

/** Header metric formatter — precise rounding for all KPI pills.
 *  <$1k → exact ($471) | $1k–$9.9k → one decimal ($1.4k) | $10k–$99k → one decimal ($14.7k) | $100k+ → whole ($105k)
 */
function fmtHeader(v: number): string {
  const n = Number(v || 0)
  const abs = Math.abs(n)
  const sign = n < 0 ? '-' : ''
  if (abs >= 100000) {
    return sign + '$' + Math.round(abs / 1000) + 'k'
  }
  if (abs >= 1000) {
    // floor to one decimal place (avoid rounding $1,471 up to $1.5k when user expects $1.4k)
    return sign + '$' + (Math.floor(abs / 100) / 10).toFixed(1) + 'k'
  }
  return sign + '$' + Math.round(abs)
}

interface V15rLayoutProps {
  activeView: string
  onNav: (view: string) => void
  activeProjectId?: string | null
  activeProjectName?: string | null
  children?: React.ReactNode
}

export default function V15rLayout({ activeView, onNav, activeProjectId, activeProjectName, children }: V15rLayoutProps) {
  const [backupData, setBackupData] = useState<BackupData | null>(null)
  const [kpis, setKpis] = useState<any>(null)

  // Demo Mode — display layer swap
  const { isDemoMode, hasHydrated } = useDemoStore()
  const [currentTime, setCurrentTime] = useState<string>('')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [toastMessage, setToastMessage] = useState<string | null>(null)
  const [windowWidth, setWindowWidth] = useState(typeof window !== 'undefined' ? window.innerWidth : 1920)
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    if (typeof window === 'undefined') return true
    const saved = localStorage.getItem('sidebar_expanded')
    if (saved !== null) return saved === 'true'
    return window.innerWidth >= 1024
  })
  // B50: Desktop sidebar collapse (Windows/desktop only, viewport > 1024px)
  const [desktopCollapsed, setDesktopCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false
    return localStorage.getItem('sidebar_collapsed') === 'true'
  })

  // Collapsible section states — persisted per section to localStorage
  const [sectionWorkspace, setSectionWorkspace] = useState(() => {
    if (typeof window === 'undefined') return true
    const saved = localStorage.getItem('nav_section_workspace')
    return saved !== null ? saved === 'true' : true
  })
  const [sectionBusiness, setSectionBusiness] = useState(() => {
    if (typeof window === 'undefined') return true
    const saved = localStorage.getItem('nav_section_business')
    return saved !== null ? saved === 'true' : true
  })
  const [sectionTeam, setSectionTeam] = useState(() => {
    if (typeof window === 'undefined') return true
    const saved = localStorage.getItem('nav_section_team')
    return saved !== null ? saved === 'true' : true
  })
  const [sectionIntelligence, setSectionIntelligence] = useState(() => {
    if (typeof window === 'undefined') return true
    const saved = localStorage.getItem('nav_section_intelligence')
    return saved !== null ? saved === 'true' : true
  })
  const [sectionOperations, setSectionOperations] = useState(() => {
    if (typeof window === 'undefined') return true
    const saved = localStorage.getItem('nav_section_operations')
    return saved !== null ? saved === 'true' : true
  })
  const [sectionAdmin, setSectionAdmin] = useState(() => {
    if (typeof window === 'undefined') return true
    const saved = localStorage.getItem('nav_section_admin')
    return saved !== null ? saved === 'true' : true
  })
  // B64 — Admin sub-bucket collapse states (4 buckets)
  const [sectionAdminCmd, setSectionAdminCmd] = useState(() => {
    if (typeof window === 'undefined') return true
    const saved = localStorage.getItem('nav_section_admin_cmd')
    return saved !== null ? saved === 'true' : true // default open
  })
  const [sectionAdminPersonal, setSectionAdminPersonal] = useState(() => {
    if (typeof window === 'undefined') return false
    const saved = localStorage.getItem('nav_section_admin_personal')
    return saved !== null ? saved === 'true' : false // default collapsed
  })
  const [sectionAdminViz, setSectionAdminViz] = useState(() => {
    if (typeof window === 'undefined') return false
    const saved = localStorage.getItem('nav_section_admin_viz')
    return saved !== null ? saved === 'true' : false // default collapsed
  })
  const [sectionAdminBiz, setSectionAdminBiz] = useState(() => {
    if (typeof window === 'undefined') return false
    const saved = localStorage.getItem('nav_section_admin_biz')
    return saved !== null ? saved === 'true' : false // default collapsed
  })
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false)
  const signOut = useAuthStore(s => s.signOut)
  const authUser = useAuthStore(s => s.user)
  const adminEmail = import.meta.env.VITE_ADMIN_EMAIL as string | undefined
  const isAdmin = !!(authUser?.email && adminEmail && authUser.email === adminEmail)

  // ── B32 | Multi-User Role Foundation ────────────────────────────────────────
  // Resolve the current user's B32 org role. Defaults to 'owner' so the
  // single-user experience is unchanged; expands to full multi-user gating
  // once the org_members table is populated via the invite flow.
  const [b32Role, setB32Role] = useState<B32Role>('owner')
  useEffect(() => {
    const resolved = getUserRole(authUser?.id ?? '', authUser?.email ?? '')
    setB32Role(resolved)
    // Log session start to audit_decisions
    if (authUser?.id) {
      logAuditDecision({
        user_id: authUser.id,
        role: resolved,
        action: 'session_start',
        entity_type: 'auth',
        description: `User session started as ${resolved}`,
      })
    }
  }, [authUser?.id, authUser?.email])

  /**
   * filterByRole — filters a nav item list to only those allowed for the current role.
   * Composes with filterByTemplate for preview mode support.
   * Falls back to showing all items if feature key is not in B32Feature union (safe default).
   */
  function filterByRole<T extends { view: string }>(items: T[]): T[] {
    return items.filter((item) => canAccess(b32Role, item.view as B32Feature))
  }

  // ── B26 | Template Preview Gating ────────────────────────────────────────
  // When poweron_preview_industry is set in sessionStorage, only sidebar panels
  // present in the template's visiblePanels array are rendered. ADMIN section
  // is hidden entirely regardless of email match.
  const TEMPLATE_PANEL_TO_VIEWS: Record<string, string[]> = {
    'home':                  ['home'],
    'projects':              ['projects'],
    'leads':                 ['leads'],
    'templates':             ['templates'],
    'pricing-intelligence':  ['pricing-intelligence', 'pricing-intel'],
    'estimate':              ['estimate'],
    'field-logs':            ['field-log'],
    'graph-dashboard':       ['graph-dashboard'],
    'money':                 ['money'],
    'collections':           ['money'],
    'price-book':            ['price-book'],
    'settings':              ['settings'],
    'blueprints':            ['blueprint-ai'],
    'blueprint-ai':          ['blueprint-ai'],
    'nexus':                 ['nexus'],
    'team':                  ['team'],
    'crew-portal':           ['crew-portal', 'crew-portal-v3'],
    'guardian':              ['guardian'],
    'compliance':            ['compliance'],
    'voice-hub':             ['voice-hub'],
    'activity':              ['activity'],
    'agent-mode-selector':   ['agent-mode-selector'],
    'material-intelligence': ['material-intelligence'],
    'vault-estimate':        ['vault-estimate'],
    'demo-mode':             ['demo-mode'],
    'service-calls':         ['money'],
  }

  const { previewAllowedViews, isPreviewMode } = useMemo(() => {
    try {
      const previewIndustry = sessionStorage.getItem('poweron_preview_industry')
      if (!previewIndustry) return { previewAllowedViews: null, isPreviewMode: false }
      const tmpl = templates[previewIndustry]
      if (!tmpl || !Array.isArray(tmpl.visiblePanels)) return { previewAllowedViews: null, isPreviewMode: false }
      const allowed = new Set<string>()
      for (const panelId of tmpl.visiblePanels) {
        const views = TEMPLATE_PANEL_TO_VIEWS[panelId] || [panelId]
        views.forEach(v => allowed.add(v))
      }
      return { previewAllowedViews: allowed, isPreviewMode: true }
    } catch {
      return { previewAllowedViews: null, isPreviewMode: false }
    }
  }, [])

  function filterByTemplate<T extends { view: string }>(items: T[]): T[] {
    if (!previewAllowedViews) return items
    return items.filter(item => previewAllowedViews.has(item.view))
  }
  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'synced' | 'failed'>('idle')
  const [lastSyncTime, setLastSyncTime] = useState<string>('')
  const [lastSyncDevice, setLastSyncDevice] = useState<string>('')
  // H3: online/offline state
  const [isOnline, setIsOnline] = useState<boolean>(typeof navigator !== 'undefined' ? navigator.onLine : true)
  // Session 14: offline queue count from service worker
  const [offlineQueueCount, setOfflineQueueCount] = useState<number>(0)
  const [showOfflineToast, setShowOfflineToast] = useState<boolean>(false)
  const [offlineToastMsg, setOfflineToastMsg] = useState<string>('')

  // ── Responsive breakpoints ────────────────────────────────────────────────
  // CRITICAL: These MUST be declared before any useEffect that references them.
  // Declaring them after useEffect causes a TDZ (Temporal Dead Zone) crash in
  // Vite production builds: "Cannot access 'I' before initialization" where 'I'
  // is the minified name for isMobile.
  const isMobile = windowWidth < 768
  const isTablet = windowWidth >= 768 && windowWidth < 1024
  const isDesktop = windowWidth >= 1024

  // Initialize and refresh data
  useEffect(() => {
    const refresh = () => {
      const data = getBackupData()
      setBackupData(data)
      if (data) {
        setKpis(getKPIs(data))
      }
    }

    refresh()

    // Listen for storage changes from other tabs (cross-tab)
    const handleStorageChange = () => refresh()
    window.addEventListener('storage', handleStorageChange)

    // Listen for same-tab saves dispatched by saveBackupData (e.g. status changes, deletions)
    // so the pipeline KPI in the header updates in real time without a page reload.
    const handleDataSaved = () => refresh()
    window.addEventListener('poweron-data-saved', handleDataSaved)

    // Clean up listeners on unmount
    return () => {
      window.removeEventListener('storage', handleStorageChange)
      window.removeEventListener('poweron-data-saved', handleDataSaved)
    }
  }, [])

  // Load from Supabase on mount (after auth)
  useEffect(() => {
    if (!isSupabaseConfigured()) {
      setSyncStatus('failed')
      return
    }

    setSyncStatus('syncing')
    loadFromSupabase().then(result => {
      if (result.success) {
        setSyncStatus('synced')
        setLastSyncTime(new Date().toLocaleTimeString())
        // Update device info from sync metadata
        const meta = getLastSyncMeta()
        if (meta?.savedBy) {
          const deviceLabel = meta.savedBy.split('_')[0] || meta.savedBy
          setLastSyncDevice(deviceLabel)
        }
        if (result.merged) {
          // Remote was newer — refresh local state
          const data = getBackupData()
          setBackupData(data)
          if (data) setKpis(getKPIs(data))
          const deviceLabel = result.fromDevice ? result.fromDevice.split('_')[0] : 'cloud'
          setToastMessage(`Loaded latest from cloud (saved by ${deviceLabel})`)
          setTimeout(() => setToastMessage(null), 5000)
        }
      } else {
        setSyncStatus('failed')
        console.warn('[layout] Supabase load failed:', result.error)
      }
    }).catch(() => setSyncStatus('failed'))
  }, [])

  // Periodic sync to Supabase (30s via startPeriodicSync + legacy fallback)
  useEffect(() => {
    if (!isSupabaseConfigured()) return

    // Start the new 30s debounced periodic sync from Issue 5
    const stopSync = startPeriodicSync()

    // Also keep a status-polling interval for UI indicators
    const interval = setInterval(() => {
      syncToSupabase().then(result => {
        if (result.success) {
          setSyncStatus('synced')
          setLastSyncTime(new Date().toLocaleTimeString())
          const meta = getLastSyncMeta()
          if (meta?.savedBy) setLastSyncDevice(meta.savedBy.split('_')[0] || '')
        } else {
          setSyncStatus('failed')
        }
      }).catch(() => setSyncStatus('failed'))
    }, 30000) // every 30 seconds (aligned with new sync interval)

    return () => { stopSync(); clearInterval(interval) }
  }, [])

  // Initialize Phase B event bus + agent subscriptions
  useEffect(() => {
    initEventBus()
    const unsubNexus  = subscribeNexusToEvents()
    const unsubLedger = subscribeLedgerToEvents()
    const unsubPulse  = initPulseBusSubscriptions()
    const unsubSpark  = initSparkBusListeners()
    const unsubAlerts = initAlertEngine()
    console.log('[Layout] Event bus initialized, NEXUS + LEDGER + PULSE + SPARK + ALERTS subscribed')
    return () => { unsubNexus(); unsubLedger(); unsubPulse(); unsubSpark(); unsubAlerts() }
  }, [])

  // Track window width for responsive breakpoints
  useEffect(() => {
    const handleResize = () => {
      const w = window.innerWidth
      setWindowWidth(w)
      // Auto-close overlay sidebar when resizing to desktop
      if (w >= 1024) setSidebarOpen(true)
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  // Clock tick
  useEffect(() => {
    const updateTime = () => {
      const now = new Date()
      const hours = now.getHours() % 12 || 12
      const minutes = String(now.getMinutes()).padStart(2, '0')
      const ampm = now.getHours() >= 12 ? 'PM' : 'AM'
      setCurrentTime(`${hours}:${minutes} ${ampm}`)
    }
    updateTime()
    const interval = setInterval(updateTime, 1000)
    return () => clearInterval(interval)
  }, [])

  // Apply theme (light/dark toggle) — sync data-theme attr + Tailwind dark class + body.lt
  useEffect(() => {
    if (backupData?.settings?.theme) {
      const theme = backupData.settings.theme
      document.documentElement.setAttribute('data-theme', theme)
      document.documentElement.classList.toggle('dark', theme !== 'light')
      document.documentElement.classList.toggle('light', theme === 'light')
      document.body.classList.toggle('lt', theme === 'light')
    }
  }, [backupData?.settings?.theme])

  // Persist sidebar state
  useEffect(() => {
    if (!isMobile) {
      localStorage.setItem('sidebar_expanded', String(sidebarOpen))
    }
  }, [sidebarOpen, isMobile])

  // B52: Listen for sidebar-collapse events from VisualSuiteStandalone
  useEffect(() => {
    const handler = (e: CustomEvent) => {
      const collapse = e.detail as boolean
      setDesktopCollapsed(collapse)
      localStorage.setItem('sidebar_collapsed', String(collapse))
      if (collapse && (isMobile || isTablet)) setSidebarOpen(false)
    }
    window.addEventListener('poweron:sidebar-collapse', handler as EventListener)
    return () => window.removeEventListener('poweron:sidebar-collapse', handler as EventListener)
  }, [isMobile, isTablet])

  // Keyboard shortcuts for undo/redo
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement as any
      const isTextInput = activeEl?.tagName === 'INPUT' ||
                          activeEl?.tagName === 'TEXTAREA' ||
                          activeEl?.tagName === 'SELECT' ||
                          activeEl?.contentEditable === 'true'

      if (isTextInput) return

      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault()
        if (canUndo()) {
          const success = undo()
          if (success) {
            const data = getBackupData()
            setBackupData(data)
            if (data) setKpis(getKPIs(data))
            setToastMessage('↶ Undo')
            setTimeout(() => setToastMessage(null), 4000)
          }
        }
      }

      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault()
        if (canRedo()) {
          const success = redo()
          if (success) {
            const data = getBackupData()
            setBackupData(data)
            if (data) setKpis(getKPIs(data))
            setToastMessage('↷ Redo')
            setTimeout(() => setToastMessage(null), 4000)
          }
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  // ── Active connectivity check — verifies Supabase is reachable, not just
  //    that navigator.onLine is true (which only reflects local network status).
  const checkActualConnectivity = async (): Promise<boolean> => {
    if (!navigator.onLine) return false
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 4000)
      // HEAD request to Supabase REST root — any HTTP response means reachable
      const res = await fetch(
        'https://edxxbtyugohtowvslbfo.supabase.co/rest/v1/',
        { method: 'HEAD', signal: controller.signal, cache: 'no-store' }
      )
      clearTimeout(timeoutId)
      // 401 is expected (no anon key on REST root) — still means Supabase is reachable
      return res.status < 600 // any valid HTTP response = Supabase reachable
    } catch (e) {
      // B34 Fix 4: Fail silently with console.warn instead of propagating (Supabase HEAD → 401)
      console.warn('[connectivity] Supabase HEAD check failed silently:', e)
      return false
    }
  }

  // H3: online/offline listeners
  useEffect(() => {
    const handleOnline = async () => {
      // Confirm Supabase is actually reachable before declaring online
      const actuallyOnline = await checkActualConnectivity()
      setIsOnline(actuallyOnline)
      if (actuallyOnline && navigator.serviceWorker?.controller) {
        navigator.serviceWorker.controller.postMessage({ type: 'SYNC_NOW' })
        // Also re-check queue length after flush attempt
        setTimeout(() => {
          navigator.serviceWorker?.controller?.postMessage({ type: 'GET_QUEUE_LENGTH' })
        }, 2000)
      }
    }
    const handleOffline = () => setIsOnline(false)
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  // Flush SW queue on app focus (visibilitychange) — ensures the queue drains
  // even when the device stayed online throughout and the 'online' event
  // never fired to trigger SYNC_NOW.
  useEffect(() => {
    const handleVisibilityChange = async () => {
      if (document.visibilityState !== 'visible') return
      // Ask SW for current queue length first
      if (navigator.serviceWorker?.controller) {
        navigator.serviceWorker.controller.postMessage({ type: 'GET_QUEUE_LENGTH' })
      }
      // If online, flush any pending SW queue entries
      const online = await checkActualConnectivity()
      setIsOnline(online)
      if (online && navigator.serviceWorker?.controller) {
        navigator.serviceWorker.controller.postMessage({ type: 'SYNC_NOW' })
      }
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange)
  }, [])

  // Session 14: listen for service worker offline queue messages
  useEffect(() => {
    if (!navigator.serviceWorker) return
    const handleSWMessage = (event: MessageEvent) => {
      if (!event.data) return
      if (event.data.type === 'FIELD_LOG_QUEUED_OFFLINE') {
        setOfflineQueueCount(event.data.queueLength || 1)
        setOfflineToastMsg(`Saved offline — will sync when connected (${event.data.queueLength} pending)`)
        setShowOfflineToast(true)
        setTimeout(() => setShowOfflineToast(false), 5000)
      }
      if (event.data.type === 'FIELD_LOG_SYNC_COMPLETE') {
        const { synced, failed } = event.data
        setOfflineQueueCount(failed || 0)
        if (synced > 0) {
          setOfflineToastMsg(
            failed > 0
              ? `Synced ${synced} entries — ${failed} still pending`
              : `✅ All offline entries synced (${synced})`
          )
          setShowOfflineToast(true)
          setTimeout(() => setShowOfflineToast(false), 4000)
        }
      }
      // Handle QUEUE_LENGTH response from GET_QUEUE_LENGTH request
      if (event.data.type === 'QUEUE_LENGTH') {
        setOfflineQueueCount(event.data.length || 0)
      }
    }
    navigator.serviceWorker.addEventListener('message', handleSWMessage)
    // Ask SW for current queue length on mount
    if (navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({ type: 'GET_QUEUE_LENGTH' })
    }
    return () => navigator.serviceWorker.removeEventListener('message', handleSWMessage)
  }, [])

  // Periodic SW queue flush — every 60s, if items are pending and device is online,
  // send SYNC_NOW to drain the queue without requiring an offline→online transition.
  useEffect(() => {
    if (!navigator.serviceWorker) return
    const flushInterval = setInterval(async () => {
      if (!navigator.serviceWorker?.controller) return
      // Always refresh queue length
      navigator.serviceWorker.controller.postMessage({ type: 'GET_QUEUE_LENGTH' })
      // If there are queued items and we're online, flush them
      if (navigator.onLine) {
        navigator.serviceWorker.controller.postMessage({ type: 'SYNC_NOW' })
      }
    }, 60_000)
    return () => clearInterval(flushInterval)
  }, [])

  // poweron:show-proposals — navigate to Settings (Proposals section)
  useEffect(() => {
    const handleShowProposals = () => {
      onNav('settings')
      // Brief delay to let the settings panel mount, then scroll to Proposals card
      setTimeout(() => {
        const el = document.querySelector('[data-section="proposals"]')
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }, 300)
    }
    document.addEventListener('poweron:show-proposals', handleShowProposals)
    return () => document.removeEventListener('poweron:show-proposals', handleShowProposals)
  }, [onNav])

  // NW15: Listen for cross-view navigation events (e.g. Neural World link from BusinessOverview)
  useEffect(() => {
    function handlePowerOnNav(e: Event) {
      const ev = e as CustomEvent<{ view: string }>
      if (ev.detail?.view) onNav(ev.detail.view)
    }
    window.addEventListener('poweron:nav', handlePowerOnNav)
    return () => window.removeEventListener('poweron:nav', handlePowerOnNav)
  }, [onNav])

  // Relative time formatter for "Saved"
  const getRelativeTime = (isoString: string): string => {
    const date = new Date(isoString)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffSecs = Math.floor(diffMs / 1000)
    const diffMins = Math.floor(diffSecs / 60)
    const diffHours = Math.floor(diffMins / 60)
    const diffDays = Math.floor(diffHours / 24)

    if (diffSecs < 60) return 'just now'
    if (diffMins < 60) return `${diffMins}m ago`
    if (diffHours < 24) return `${diffHours}h ago`
    return `${diffDays}d ago`
  }

  // Download backup — uses exportBackup() for consistent PowerOn_Backup_[timestamp].json format
  const handleBackupDownload = () => {
    if (!backupData) return
    const projectCount = (backupData.projects || []).length
    const logCount = (backupData.logs || []).length
    const serviceLogCount = (backupData.serviceLogs || []).length
    setToastMessage(`Backup exported — ${projectCount} projects, ${logCount} service logs, ${serviceLogCount} leads`)
    setTimeout(() => setToastMessage(null), 4000)
    exportBackup(backupData)
  }

  // Handle import
  const handleImportClick = () => {
    fileInputRef.current?.click()
  }

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    try {
      const { data, summary } = await importBackupFromFile(file)
      setBackupData(data)
      setKpis(getKPIs(data))

      // Build merge summary message
      const parts = Object.entries(summary.merged)
        .map(([key, count]) => `${count} ${key}`)
        .join(', ')
      const message = parts
        ? `Imported ${parts} — existing data preserved`
        : 'Import complete — no new records found (all duplicates)'

      setToastMessage(message)
      setTimeout(() => setToastMessage(null), 4000)

      // Reset input
      if (fileInputRef.current) fileInputRef.current.value = ''
    } catch (err) {
      console.error('Failed to import backup:', err)
      setToastMessage('Failed to import backup')
      setTimeout(() => setToastMessage(null), 4000)
    }
  }

  // Gracefully handle missing backup — render full layout with defaults instead of blocking
  const settings = backupData?.settings || {} as any
  const lastSaved = backupData?._lastSavedAt || new Date().toISOString()
  const _rawKpis = kpis || { pipeline: 0, paid: 0, billed: 0, exposure: 0, svcUnbilled: 0, openRfis: 0, totalHours: 0, activeProjects: 0 }

  // Demo Mode: swap KPIs and company name for display only — real data unchanged
  const safeKpis = (hasHydrated && isDemoMode) ? getDemoKPIs() : _rawKpis

  // Calculate percentage for revenue target progress
  const annualTarget = (isDemoMode ? 480000 : backupData?.settings?.annualTarget) || 120000
  const revenueTargetPct = Math.min(100, Math.round((safeKpis.paid / annualTarget) * 100))

  // SERVICE NET = Total Quoted - Material - Mileage from service calls
  const serviceNet = isDemoMode ? DEMO_SERVICE_NET : (() => {
    const svcLogs = backupData?.serviceLogs || []
    const mileRate = backupData?.settings?.mileRate || 0.66
    let totalQuoted = 0, totalMaterial = 0, totalMileage = 0
    svcLogs.forEach((l: any) => {
      totalQuoted += Number(l.quoted || 0)
      totalMaterial += Number(l.mat || 0)
      totalMileage += Number(l.miles || 0) * mileRate
    })
    return totalQuoted - totalMaterial - totalMileage
  })()

  // Responsive breakpoints
  const isCompact = windowWidth < 1200
  const showTargetBar = windowWidth >= 1400

  // Responsive sidebar modes (declared above, near useState for windowWidth)

  // B50: Desktop collapse support
  const effectiveDesktopCollapsed = isDesktop && desktopCollapsed
  const toggleDesktopCollapse = () => {
    const next = !desktopCollapsed
    setDesktopCollapsed(next)
    localStorage.setItem('sidebar_collapsed', String(next))
  }

  // Sidebar width
  const sidebarWidth = isMobile ? 280 : isDesktop ? (effectiveDesktopCollapsed ? 48 : 224) : (sidebarOpen ? 224 : 64)
  const showLabels = isDesktop ? !effectiveDesktopCollapsed : sidebarOpen
  const isOverlay = isMobile || (isTablet && sidebarOpen)

  // Workspace nav items
  const workspaceItems = [
    { label: 'Home', icon: LayoutDashboard, view: 'home' },
    { label: 'Projects', icon: FolderKanban, view: 'projects' },
    { label: 'Leads', icon: Users, view: 'leads' },
    { label: 'Templates', icon: FileStack, view: 'templates' },
    { label: 'Pricing Intelligence', icon: TrendingUp, view: 'pricing-intelligence' },
  ]

  // Project nav items (only shown when activeProjectId is set)
  const projectItems = [
    { label: 'Estimate', view: 'estimate' },
    { label: 'Material Takeoff', view: 'material-takeoff' },
    { label: 'Progress', view: 'progress' },
    { label: 'Project Framework', view: 'framework' },
    { label: 'RFI Tracker', view: 'rfi-tracker' },
    { label: 'Coordination', view: 'coordination' },
  ]

  // Business nav items — B14 restructure
  const businessItems = [
    { label: 'Graph Dashboard', icon: BarChart3, view: 'graph-dashboard' },
    { label: 'Field Log', icon: ClipboardList, view: 'field-log' },
    { label: 'Money', icon: DollarSign, view: 'money' },
    { label: 'Price Book', icon: BookOpen, view: 'price-book' },
    { label: 'Settings', icon: Settings, view: 'settings' },
  ]

  // Operations nav items — B14 new section
  const operationsItems = [
    { label: 'Blueprint AI', icon: Map, view: 'blueprint-ai' },
    { label: 'VAULT Estimate', icon: Lock, view: 'vault-estimate' },
    { label: 'Demo Mode', icon: Zap, view: 'demo-mode' },
  ]

  // Team nav items (people + compliance)
  const teamItems = [
    { label: 'Team', icon: Users, view: 'team' },
    { label: 'Crew Portal', icon: HardHat, view: 'crew-portal' },
    { label: 'Guardian', icon: ShieldAlert, view: 'guardian' },
    { label: 'Guardian Dashboard', icon: ShieldAlert, view: 'guardian-dashboard' },
  ]

  // Intelligence nav items — B14 restructure (Voice Hub replaces 3 items)
  const intelligenceItems = [
    { label: 'OHM', icon: Zap, view: 'compliance' },
    { label: 'Voice Hub', icon: Mic2, view: 'voice-hub' },
    { label: 'Activity', icon: Activity, view: 'activity' },
    { label: 'Agent Mode Selector', icon: Layers, view: 'agent-mode-selector' },
    { label: 'Material Intelligence', icon: Brain, view: 'material-intelligence' },
  ]

  // B64 — Admin nav items reorganized into 4 collapsible buckets
  // BUCKET 1 — COMMAND (default open, purple border)
  const adminBucket1 = [
    { label: 'NEXUS ADMIN', icon: Mic, view: 'nexus-voice', badge: 'ADMIN ONLY', subtitle: null, purple: true },
    { label: 'Sales Intelligence', icon: Brain, view: 'sales-intelligence', badge: 'NEW', subtitle: 'Practice · Leads · Pipeline' },
    { label: 'GUARDIAN View', icon: ShieldAlert, view: 'guardian-view', badge: null, subtitle: null },
    { label: 'Diagnostics', icon: Terminal, view: 'diagnostics', badge: 'NEW', subtitle: null },
    { label: 'Portal Lead Inbox', icon: Phone, view: 'portal-lead-inbox', badge: 'NEW', subtitle: null },
    { label: 'Security', icon: Lock, view: 'security', badge: 'ADMIN', subtitle: null },
    { label: 'n8n Automation', icon: GitBranch, view: 'n8n-automation', badge: null, subtitle: null },
  ]
  // BUCKET 2 — PERSONAL TOOLS (default collapsed, gold border)
  const adminBucket2 = [
    { label: 'Debt Killer', icon: Scissors, view: 'debt-killer', badge: null, subtitle: null },
    { label: 'Solar Income', icon: Calculator, view: 'income-calc', badge: null, subtitle: null },
    { label: 'Solar Training', icon: FlaskConical, view: 'solar-training', badge: 'NEW', subtitle: 'NEM 3.0 · Quiz · Progress' },
    { label: 'Wins Log', icon: Trophy, view: 'wins-log', badge: 'B51', subtitle: null },
    { label: 'Pinned Insights', icon: Pin, view: 'pinned-insights', badge: 'B52', subtitle: null },
    { label: 'Billing', icon: Building2, view: 'billing', badge: 'NEW', subtitle: 'Subscription & Plans' },
  ]
  // BUCKET 3 — VISUALIZATION (default collapsed, teal border)
  const adminBucket3 = [
    { label: 'ORB LAB', icon: FlaskConical, view: 'viz-lab', badge: 'B42', subtitle: null },
    { label: 'Visual Suite', icon: Layers, view: 'visual-suite', badge: 'B48', subtitle: null },
    { label: 'SPARK Live Call', icon: Phone, view: 'spark-live-call', badge: 'Preview', subtitle: null },
    // Neural Map — Electrical: sidebar link to Command Center (neural_map tab)
    { label: 'Neural Map — Electrical', icon: Map, view: 'admin-command-center', badge: null, subtitle: 'Command Center' },
    // Neural Map — Combined: sidebar link to Viz Lab (Combined tab, placeholder B67)
    { label: 'Neural Map — Combined', icon: Brain, view: 'viz-lab', badge: 'B67', subtitle: 'Viz Lab · Combined' },
    // NW1 — Neural World: 3D immersive visualization
    { label: 'Neural World', icon: Globe, view: 'neural-world', badge: 'NW1', subtitle: null },
  ]
  // BUCKET 4 — BUSINESS OVERVIEW (default collapsed, green border)
  const adminBucket4 = [
    { label: 'Business Overview', icon: Building2, view: 'business-overview', badge: 'B68', subtitle: 'placeholder' },
  ]

  // Toggle and close helpers
  const toggleSidebar = () => setSidebarOpen(prev => !prev)
  const closeSidebar = () => { if (isMobile || isTablet) setSidebarOpen(false) }
  const handleNavClick = (view: string) => {
    if (view === 'nexus-voice') {
      window.dispatchEvent(new CustomEvent('poweron:open-nexus-drawer'))
      if (isMobile) setSidebarOpen(false)
      return
    }
    if (view === 'wins-log') {
      window.dispatchEvent(new CustomEvent('poweron:open-wins-log'))
      if (isMobile) setSidebarOpen(false)
      return
    }
    if (view === 'pinned-insights') {
      window.dispatchEvent(new CustomEvent('poweron:open-pinned-insights'))
      if (isMobile) setSidebarOpen(false)
      return
    }
    // B52: Auto-collapse sidebar when entering visual-suite fullscreen mode
    // NW7b: Also auto-collapse for neural-world
    if (view === 'visual-suite' || view === 'neural-world') {
      if (!isMobile) {
        setDesktopCollapsed(true)
        localStorage.setItem('sidebar_collapsed', 'true')
      }
      if (isMobile || isTablet) setSidebarOpen(false)
    }
    onNav(view)
    if (isMobile) setSidebarOpen(false)
  }

  return (
    <div className="flex h-screen overflow-hidden" style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)' }}>
      {/* H3 + Session 14: Offline banner */}
      {!isOnline && (
        <div className="fixed top-0 left-0 right-0 z-[9999] flex items-center justify-center gap-2 px-4 py-2 bg-yellow-500/90 text-yellow-900 text-xs font-semibold backdrop-blur-sm">
          <span>⚠</span>
          <span>Offline — field log & NEC lookup available{offlineQueueCount > 0 ? ` · ${offlineQueueCount} entries queued` : ''}</span>
        </div>
      )}

      {/* Session 14: Offline queue toast */}
      {showOfflineToast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[9999] px-4 py-2.5 bg-gray-900 border border-yellow-500/50 text-yellow-300 text-xs font-medium rounded-xl shadow-xl backdrop-blur-sm flex items-center gap-2 pointer-events-none">
          <span>📶</span>
          <span>{offlineToastMsg}</span>
        </div>
      )}
      {/* MOBILE/TABLET OVERLAY BACKDROP */}
      {isOverlay && sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 transition-opacity"
          onClick={closeSidebar}
        />
      )}

      {/* LEFT SIDEBAR */}
      <aside
        className={`fixed left-0 top-0 h-screen flex flex-col z-[60] transition-all duration-300 ${
          isMobile
            ? (sidebarOpen ? 'translate-x-0' : '-translate-x-full')
            : ''
        }`}
        style={{
          width: sidebarWidth,
          transition: 'width 200ms ease',
          backgroundColor: 'var(--bg-primary)',
          borderRight: '1px solid var(--border-primary)',
        }}
      >
        {/* Logo / Company Name */}
        <div className="px-4 py-5 border-b flex items-center justify-center" style={{ borderColor: 'var(--border-primary)', minHeight: 72 }}>
          {showLabels ? (
            <div className="flex items-center justify-between w-full">
              <div className="flex-1 flex justify-center">
                {settings.theme === 'light' && settings.logoLight ? (
                  <img src={settings.logoLight} alt="Logo" style={{ height: 48, maxWidth: 160, objectFit: 'contain' }} />
                ) : settings.theme !== 'light' && settings.logoDark ? (
                  <img src={settings.logoDark} alt="Logo" style={{ height: 48, maxWidth: 160, objectFit: 'contain' }} />
                ) : (
                  <div className="flex items-center gap-2">
                    <Zap size={22} className={isDemoMode ? 'text-amber-400' : 'text-green-400'} />
                    <span className="text-base font-bold tracking-tight" style={{ color: 'var(--text-primary)' }}>
                      {isDemoMode ? DEMO_COMPANY : (settings.company || 'PowerOn Solutions')}
                    </span>
                  </div>
                )}
              </div>
              {(isMobile || isTablet) && (
                <button onClick={closeSidebar} className="p-1 ml-2 text-gray-400 hover:text-white flex-shrink-0">
                  <X size={20} />
                </button>
              )}
            </div>
          ) : (
            <div className="w-full flex justify-center">
              <Zap size={26} className="text-green-400" />
            </div>
          )}
        </div>

        {/* Sidebar content */}
        <div className="flex-1 overflow-y-auto">

          {/* Helper: render a collapsible section */}
          {/* WORKSPACE Section */}
          <div className="pt-4">
            {showLabels ? (
              <button
                onClick={() => {
                  const next = !sectionWorkspace
                  setSectionWorkspace(next)
                  localStorage.setItem('nav_section_workspace', String(next))
                }}
                className="w-full flex items-center justify-between px-4 py-2 min-h-[36px] group"
                style={{ touchAction: 'manipulation' }}
              >
                <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-muted, #6b7280)' }}>Workspace</span>
                <ChevronDown
                  size={14}
                  style={{
                    color: 'var(--text-muted, #6b7280)',
                    transition: 'transform 0.2s',
                    transform: sectionWorkspace ? 'rotate(0deg)' : 'rotate(-90deg)',
                    flexShrink: 0,
                  }}
                />
              </button>
            ) : null}
            {sectionWorkspace && (
              <nav className="space-y-1">
                {filterByRole(filterByTemplate(workspaceItems)).map((item) => {
                  const Icon = item.icon
                  const isActive = activeView === item.view
                  return (
                    <button
                      key={item.view}
                      onClick={() => handleNavClick(item.view)}
                      title={!showLabels ? item.label : undefined}
                      className={`w-full flex items-center ${showLabels ? 'gap-3 px-4' : 'justify-center px-2'} py-3 min-h-[44px] text-sm transition-colors ${
                        isActive
                          ? 'bg-emerald-500/15 dark:bg-gray-800 border-l-2 border-[#10b981] text-emerald-800 dark:text-white'
                          : 'text-gray-400 hover:text-gray-300 border-l-2 border-transparent'
                      }`}
                    >
                      <Icon size={18} />
                      {showLabels && <span>{item.label}</span>}
                    </button>
                  )
                })}
              </nav>
            )}
          </div>

          {/* ACTIVE PROJECT Section (conditional) */}
          {activeProjectId && (
            <div className="pt-6 border-t border-gray-700">
              <div className={showLabels ? 'px-4 py-2' : 'px-2 py-2 text-center'}>
                {showLabels ? (
                  <>
                    <div className="text-xs font-bold text-gray-500 uppercase tracking-wider">Active Project</div>
                    {activeProjectName && (
                      <div className="text-xs text-[#10b981] font-medium mt-1 truncate">{activeProjectName}</div>
                    )}
                  </>
                ) : (
                  <div className="text-xs text-gray-500 font-bold">PRJ</div>
                )}
              </div>
              <nav className="space-y-1">
                {projectItems.map((item) => {
                  const isHighlighted = activeView === item.view ||
                    (activeView === 'project-inner' && item.view === 'estimate')
                  return (
                    <button
                      key={item.view}
                      onClick={() => handleNavClick(item.view)}
                      title={!showLabels ? item.label : undefined}
                      className={`w-full flex items-center ${showLabels ? 'gap-3 px-4' : 'justify-center px-2'} py-3 min-h-[44px] text-sm transition-colors ${
                        isHighlighted
                          ? 'bg-emerald-500/15 dark:bg-gray-800 border-l-2 border-[#10b981] text-emerald-800 dark:text-white'
                          : 'text-gray-400 hover:text-gray-300 border-l-2 border-transparent hover:border-gray-600'
                      }`}
                    >
                      {showLabels ? (
                        <span>{item.label}</span>
                      ) : (
                        <span className="text-[10px]">{item.label.substring(0, 3)}</span>
                      )}
                    </button>
                  )
                })}
              </nav>
            </div>
          )}

          {/* BUSINESS Section */}
          <div className="pt-6 border-t border-gray-700">
            {showLabels ? (
              <button
                onClick={() => {
                  const next = !sectionBusiness
                  setSectionBusiness(next)
                  localStorage.setItem('nav_section_business', String(next))
                }}
                className="w-full flex items-center justify-between px-4 py-2 min-h-[36px] group"
                style={{ touchAction: 'manipulation' }}
              >
                <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-muted, #6b7280)' }}>Business</span>
                <ChevronDown
                  size={14}
                  style={{
                    color: 'var(--text-muted, #6b7280)',
                    transition: 'transform 0.2s',
                    transform: sectionBusiness ? 'rotate(0deg)' : 'rotate(-90deg)',
                    flexShrink: 0,
                  }}
                />
              </button>
            ) : null}
            {sectionBusiness && (
              <nav className="space-y-1">
                {filterByRole(filterByTemplate(businessItems)).map((item) => {
                  const Icon = item.icon
                  const isActive = activeView === item.view
                  return (
                    <button
                      key={item.view}
                      onClick={() => handleNavClick(item.view)}
                      title={!showLabels ? item.label : undefined}
                      className={`w-full flex items-center ${showLabels ? 'gap-3 px-4' : 'justify-center px-2'} py-3 min-h-[44px] text-sm transition-colors ${
                        isActive
                          ? 'bg-emerald-500/15 dark:bg-gray-800 border-l-2 border-[#10b981] text-emerald-800 dark:text-white'
                          : 'text-gray-400 hover:text-gray-300 border-l-2 border-transparent hover:border-gray-600'
                      }`}
                    >
                      <Icon size={18} />
                      {showLabels && <span>{item.label}</span>}
                    </button>
                  )
                })}
              </nav>
            )}
          </div>

          {/* OPERATIONS Section — B14 */}
          <div className="pt-6 border-t border-gray-700">
            {showLabels ? (
              <button
                onClick={() => {
                  const next = !sectionOperations
                  setSectionOperations(next)
                  localStorage.setItem('nav_section_operations', String(next))
                }}
                className="w-full flex items-center justify-between px-4 py-2 min-h-[36px] group"
                style={{ touchAction: 'manipulation' }}
              >
                <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-muted, #6b7280)' }}>Operations</span>
                <ChevronDown
                  size={14}
                  style={{
                    color: 'var(--text-muted, #6b7280)',
                    transition: 'transform 0.2s',
                    transform: sectionOperations ? 'rotate(0deg)' : 'rotate(-90deg)',
                    flexShrink: 0,
                  }}
                />
              </button>
            ) : null}
            {sectionOperations && (
              <nav className="space-y-1">
                {filterByRole(filterByTemplate(operationsItems)).map((item) => {
                  const Icon = item.icon
                  const isActive = activeView === item.view
                  return (
                    <button
                      key={item.view}
                      onClick={() => handleNavClick(item.view)}
                      title={!showLabels ? item.label : undefined}
                      className={`w-full flex items-center ${showLabels ? 'gap-3 px-4' : 'justify-center px-2'} py-3 min-h-[44px] text-sm transition-colors ${
                        isActive
                          ? 'bg-emerald-500/15 dark:bg-gray-800 border-l-2 border-[#10b981] text-emerald-800 dark:text-white'
                          : 'text-gray-400 hover:text-gray-300 border-l-2 border-transparent hover:border-gray-600'
                      }`}
                    >
                      <Icon size={18} />
                      {showLabels && <span>{item.label}</span>}
                    </button>
                  )
                })}
              </nav>
            )}
          </div>

          {/* TEAM Section */}
          <div className="pt-6 border-t border-gray-700">
            {showLabels ? (
              <button
                onClick={() => {
                  const next = !sectionTeam
                  setSectionTeam(next)
                  localStorage.setItem('nav_section_team', String(next))
                }}
                className="w-full flex items-center justify-between px-4 py-2 min-h-[36px] group"
                style={{ touchAction: 'manipulation' }}
              >
                <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-muted, #6b7280)' }}>Team</span>
                <ChevronDown
                  size={14}
                  style={{
                    color: 'var(--text-muted, #6b7280)',
                    transition: 'transform 0.2s',
                    transform: sectionTeam ? 'rotate(0deg)' : 'rotate(-90deg)',
                    flexShrink: 0,
                  }}
                />
              </button>
            ) : null}
            {sectionTeam && (
              <nav className="space-y-1">
                {filterByRole(filterByTemplate(teamItems)).map((item) => {
                  const Icon = item.icon
                  const isActive = activeView === item.view
                  return (
                    <button
                      key={item.view}
                      onClick={() => handleNavClick(item.view)}
                      title={!showLabels ? item.label : undefined}
                      className={`w-full flex items-center ${showLabels ? 'gap-3 px-4' : 'justify-center px-2'} py-3 min-h-[44px] text-sm transition-colors ${
                        isActive
                          ? 'bg-emerald-500/15 dark:bg-gray-800 border-l-2 border-[#10b981] text-emerald-800 dark:text-white'
                          : 'text-gray-400 hover:text-gray-300 border-l-2 border-transparent hover:border-gray-600'
                      }`}
                    >
                      <Icon size={18} />
                      {showLabels && <span>{item.label}</span>}
                    </button>
                  )
                })}
              </nav>
            )}
          </div>

          {/* INTELLIGENCE Section */}
          <div className="pt-6 border-t border-gray-700">
            {showLabels ? (
              <button
                onClick={() => {
                  const next = !sectionIntelligence
                  setSectionIntelligence(next)
                  localStorage.setItem('nav_section_intelligence', String(next))
                }}
                className="w-full flex items-center justify-between px-4 py-2 min-h-[36px] group"
                style={{ touchAction: 'manipulation' }}
              >
                <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-muted, #6b7280)' }}>Intelligence</span>
                <ChevronDown
                  size={14}
                  style={{
                    color: 'var(--text-muted, #6b7280)',
                    transition: 'transform 0.2s',
                    transform: sectionIntelligence ? 'rotate(0deg)' : 'rotate(-90deg)',
                    flexShrink: 0,
                  }}
                />
              </button>
            ) : null}
            {sectionIntelligence && (
              <nav className="space-y-1">
                {filterByRole(filterByTemplate(intelligenceItems)).map((item) => {
                  const Icon = item.icon
                  const isActive = activeView === item.view
                  return (
                    <button
                      key={item.view}
                      onClick={() => handleNavClick(item.view)}
                      title={!showLabels ? item.label : undefined}
                      className={`w-full flex items-center ${showLabels ? 'gap-3 px-4' : 'justify-center px-2'} py-3 min-h-[44px] text-sm transition-colors ${
                        isActive
                          ? 'bg-emerald-500/15 dark:bg-gray-800 border-l-2 border-[#10b981] text-emerald-800 dark:text-white'
                          : 'text-gray-400 hover:text-gray-300 border-l-2 border-transparent hover:border-gray-600'
                      }`}
                    >
                      <Icon size={18} />
                      {showLabels && <span>{item.label}</span>}
                    </button>
                  )
                })}
              </nav>
            )}
          </div>

          {/* ADMIN Section — B14 + B32 | visible only to owner (email match + role gate) */}
          {/* B64 — reorganized into 4 collapsible buckets */}
          {isAdmin && !isPreviewMode && b32Role === 'owner' && (
            <div className="pt-4 border-t border-yellow-800/40">

              {/* Helper: renders one admin bucket with colored border accent */}
              {[
                {
                  key: 'cmd',
                  label: 'COMMAND',
                  border: '#a855f7',
                  open: sectionAdminCmd,
                  toggle: () => { const n = !sectionAdminCmd; setSectionAdminCmd(n); localStorage.setItem('nav_section_admin_cmd', String(n)) },
                  items: adminBucket1,
                  activeBg: 'rgba(168,85,247,0.15)',
                  activeBorder: '#a855f7',
                  activeText: '#d8b4fe',
                  idleText: '#c084fc',
                  idleHover: '#e9d5ff',
                  badgeBg: '#7c3aed',
                },
                {
                  key: 'personal',
                  label: 'PERSONAL TOOLS',
                  border: '#ca8a04',
                  open: sectionAdminPersonal,
                  toggle: () => { const n = !sectionAdminPersonal; setSectionAdminPersonal(n); localStorage.setItem('nav_section_admin_personal', String(n)) },
                  items: adminBucket2,
                  activeBg: 'rgba(202,138,4,0.15)',
                  activeBorder: '#ca8a04',
                  activeText: '#fde68a',
                  idleText: '#d97706',
                  idleHover: '#fef08a',
                  badgeBg: '#ca8a04',
                },
                {
                  key: 'viz',
                  label: 'VISUALIZATION',
                  border: '#0d9488',
                  open: sectionAdminViz,
                  toggle: () => { const n = !sectionAdminViz; setSectionAdminViz(n); localStorage.setItem('nav_section_admin_viz', String(n)) },
                  items: adminBucket3,
                  activeBg: 'rgba(13,148,136,0.15)',
                  activeBorder: '#0d9488',
                  activeText: '#99f6e4',
                  idleText: '#2dd4bf',
                  idleHover: '#ccfbf1',
                  badgeBg: '#0f766e',
                },
                {
                  key: 'biz',
                  label: 'BUSINESS OVERVIEW',
                  border: '#16a34a',
                  open: sectionAdminBiz,
                  toggle: () => { const n = !sectionAdminBiz; setSectionAdminBiz(n); localStorage.setItem('nav_section_admin_biz', String(n)) },
                  items: adminBucket4,
                  activeBg: 'rgba(22,163,74,0.15)',
                  activeBorder: '#16a34a',
                  activeText: '#bbf7d0',
                  idleText: '#4ade80',
                  idleHover: '#dcfce7',
                  badgeBg: '#15803d',
                },
              ].map((bucket) => (
                <div
                  key={bucket.key}
                  className="mb-1"
                  style={{ borderLeft: showLabels ? `3px solid ${bucket.border}` : 'none' }}
                >
                  {showLabels && (
                    <button
                      onClick={bucket.toggle}
                      className="w-full flex items-center justify-between px-3 py-1.5 min-h-[32px] group"
                      style={{ touchAction: 'manipulation' }}
                    >
                      <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase', color: bucket.border }}>{bucket.label}</span>
                      <ChevronDown
                        size={12}
                        style={{
                          color: bucket.border,
                          transition: 'transform 0.2s',
                          transform: bucket.open ? 'rotate(0deg)' : 'rotate(-90deg)',
                          flexShrink: 0,
                        }}
                      />
                    </button>
                  )}
                  {bucket.open && (
                    <nav className="space-y-0.5 pb-1">
                      {bucket.items.map((item) => {
                        const Icon = item.icon
                        const isActive = activeView === item.view
                        const isPurpleNexus = item.purple === true
                        return (
                          <button
                            key={`${bucket.key}-${item.view}-${item.label}`}
                            onClick={() => handleNavClick(item.view)}
                            title={!showLabels ? item.label : undefined}
                            className={`w-full flex items-center ${showLabels ? 'gap-3 px-4' : 'justify-center px-2'} py-2.5 min-h-[40px] text-sm transition-colors`}
                            style={{
                              borderLeft: showLabels ? 'none' : undefined,
                              backgroundColor: isActive ? bucket.activeBg : undefined,
                              borderBottom: isActive ? `1px solid ${bucket.activeBorder}20` : undefined,
                            }}
                          >
                            <Icon
                              size={16}
                              style={{ color: isActive ? bucket.activeText : isPurpleNexus ? '#a855f7' : bucket.idleText, flexShrink: 0 }}
                            />
                            {showLabels && (
                              <span
                                className="flex items-center gap-2 flex-1 truncate"
                                style={{ color: isActive ? bucket.activeText : isPurpleNexus ? '#c084fc' : bucket.idleText, fontSize: 12 }}
                              >
                                {item.label}
                                {item.badge && (
                                  <span
                                    style={{
                                      fontSize: 8,
                                      fontWeight: 800,
                                      letterSpacing: '0.05em',
                                      padding: '1px 4px',
                                      borderRadius: 3,
                                      backgroundColor: isPurpleNexus ? '#7c3aed' : bucket.badgeBg,
                                      color: '#fff',
                                      textTransform: 'uppercase',
                                      whiteSpace: 'nowrap',
                                      flexShrink: 0,
                                    }}
                                  >
                                    {item.badge}
                                  </span>
                                )}
                              </span>
                            )}
                          </button>
                        )
                      })}
                    </nav>
                  )}
                </div>
              ))}

            </div>
          )}

        </div>

        {/* ── B50: Desktop Collapse Toggle — only on viewport > 1024px ─── */}
        {isDesktop && (
          <div className="px-2 py-2 flex-shrink-0">
            <button
              onClick={toggleDesktopCollapse}
              title={effectiveDesktopCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              className={`w-full flex items-center ${showLabels ? 'gap-3 px-4' : 'justify-center px-2'} py-2 min-h-[36px] text-xs transition-colors rounded text-gray-500 hover:text-gray-300 hover:bg-gray-800`}
              style={{ fontSize: 11 }}
            >
              {effectiveDesktopCollapsed ? (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 18l6-6-6-6"/></svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6"/></svg>
              )}
              {showLabels && <span>Collapse</span>}
            </button>
          </div>
        )}

        {/* ── Logout Button — pinned to sidebar bottom ────────────────── */}
        <div className="border-t border-gray-700 px-2 py-3 flex-shrink-0">
          <button
            onClick={() => setShowLogoutConfirm(true)}
            title={!showLabels ? 'Sign Out' : undefined}
            className={`w-full flex items-center ${showLabels ? 'gap-3 px-4' : 'justify-center px-2'} py-3 min-h-[44px] text-sm transition-colors rounded text-gray-400 hover:text-red-400 hover:bg-red-500/10 border-l-2 border-transparent hover:border-red-500`}
          >
            <LogOut size={18} />
            {showLabels && <span>Sign Out</span>}
          </button>
        </div>

        {/* ── Logout Confirm Dialog ───────────────────────────────────── */}
        {showLogoutConfirm && (
          <div
            className="fixed inset-0 z-[200] flex items-center justify-center"
            style={{ backgroundColor: 'rgba(0,0,0,0.7)' }}
            onClick={(e) => { if (e.target === e.currentTarget) setShowLogoutConfirm(false) }}
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
                  onClick={() => setShowLogoutConfirm(false)}
                  className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-gray-400 hover:text-gray-200 transition-colors"
                  style={{ backgroundColor: 'var(--bg-input)' }}
                >
                  Cancel
                </button>
                <button
                  onClick={async () => {
                    setShowLogoutConfirm(false)
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

      </aside>

      {/* MAIN LAYOUT */}
      {/* B52: fullscreen override when visual-suite is active */}
      <div
        className="flex flex-col flex-1 transition-all duration-300"
        style={activeView === 'visual-suite' || activeView === 'neural-world'
          ? { position: 'fixed', inset: 0, zIndex: 55, marginLeft: 0 }
          : { marginLeft: isMobile ? 0 : sidebarWidth }
        }
      >
        {/* TOP BAR — hidden in visual-suite fullscreen */}
        {activeView === 'visual-suite' || activeView === 'neural-world' ? null : (
        <header className="fixed top-0 right-0 flex flex-col z-[50] transition-all duration-300" style={{ left: isMobile ? 0 : sidebarWidth, transition: 'left 200ms ease', backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-primary)' }}>
          {/* ROW 1: KPI Pills (grouped with vertical layout) */}
          <div className="h-16 flex items-center justify-between px-4 md:px-6 border-b" style={{ borderColor: 'var(--border-primary)' }}>
            {/* LEFT: Hamburger + KPI Pills */}
            <div className="flex items-center gap-4 md:gap-8">
              {/* Hamburger menu button (mobile + tablet) */}
              {!isDesktop && (
                <button
                  onClick={toggleSidebar}
                  className="p-2 text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition-colors"
                  title="Toggle sidebar"
                >
                  <Menu size={22} />
                </button>
              )}
              {/* REVENUE GROUP */}
              <div className="flex items-center gap-6">
                {/* PIPELINE */}
                <div className="flex flex-col items-center min-w-[80px]" title={isCompact ? 'Pipeline' : undefined}>
                  {isCompact ? (
                    <span className="text-sm font-bold text-green-400">{fmtHeader(safeKpis.pipeline)}</span>
                  ) : (
                    <>
                      <span className="text-[8px] font-bold uppercase text-gray-500">Pipeline</span>
                      <span className="text-base font-bold text-green-400">
                        {fmtHeader(safeKpis.pipeline)}
                      </span>
                    </>
                  )}
                </div>

                {/* PAID */}
                <div className="flex flex-col items-center min-w-[80px]" title={isCompact ? 'Paid' : undefined}>
                  {isCompact ? (
                    <span className="text-sm font-bold text-green-400">{fmtHeader(safeKpis.paid)}</span>
                  ) : (
                    <>
                      <span className="text-[8px] font-bold uppercase text-gray-500">Paid</span>
                      <span className="text-base font-bold text-green-400">
                        {fmtHeader(safeKpis.paid)}
                      </span>
                    </>
                  )}
                </div>

                {/* Separator */}
                <div className={`h-10 w-px bg-gray-700 ${isCompact ? 'hidden' : ''}`} />
              </div>

              {/* RISK GROUP */}
              <div className="flex items-center gap-6">
                {/* EXPOSURE */}
                <div className="flex flex-col items-center min-w-[70px]" title={isCompact ? 'Exposure' : undefined}>
                  {isCompact ? (
                    <span className="text-sm font-bold text-red-400">{fmtHeader(safeKpis.exposure)}</span>
                  ) : (
                    <>
                      <span className="text-[8px] font-bold uppercase text-gray-500">Exposure</span>
                      <span className="text-base font-bold text-red-400">
                        {fmtHeader(safeKpis.exposure)}
                      </span>
                    </>
                  )}
                </div>

                {/* SVC UNBILLED */}
                <div className="flex flex-col items-center min-w-[70px]" title={isCompact ? 'Svc Unbilled' : undefined}>
                  {isCompact ? (
                    <span className="text-sm font-bold text-yellow-400">{fmtHeader(safeKpis.svcUnbilled)}</span>
                  ) : (
                    <>
                      <span className="text-[8px] font-bold uppercase text-gray-500">Svc Unbilled</span>
                      <span className="text-base font-bold text-yellow-400">
                        {fmtHeader(safeKpis.svcUnbilled)}
                      </span>
                    </>
                  )}
                </div>

                {/* Separator */}
                <div className={`h-10 w-px bg-gray-700 ${isCompact ? 'hidden' : ''}`} />
              </div>

              {/* STATUS GROUP */}
              <div className="flex items-center gap-6">
                {/* OPEN PROJECTS */}
                <div className="flex flex-col items-center min-w-[70px]" title={isCompact ? 'Open Projects' : undefined}>
                  {isCompact ? (
                    <span className="text-sm font-bold text-blue-400">{safeKpis.activeProjects}</span>
                  ) : (
                    <>
                      <span className="text-[8px] font-bold uppercase text-gray-500">Open Projects</span>
                      <span className="text-base font-bold text-blue-400">
                        {safeKpis.activeProjects}
                      </span>
                    </>
                  )}
                </div>

                {/* OPEN RFIs */}
                <div className="flex flex-col items-center min-w-[70px]" title={isCompact ? 'Open RFIs' : undefined}>
                  {isCompact ? (
                    <span className="text-sm font-bold text-purple-400">{safeKpis.openRfis}</span>
                  ) : (
                    <>
                      <span className="text-[8px] font-bold uppercase text-gray-500">Open RFIs</span>
                      <span className="text-base font-bold text-purple-400">
                        {safeKpis.openRfis}
                      </span>
                    </>
                  )}
                </div>

                {/* Separator */}
                <div className={`h-10 w-px bg-gray-700 ${isCompact ? 'hidden' : ''}`} />

                {/* SERVICE NET */}
                <div className="flex flex-col items-center min-w-[70px]" title={isCompact ? 'Service Net' : undefined}>
                  {isCompact ? (
                    <span className={`text-sm font-bold ${serviceNet >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{fmtHeader(serviceNet)}</span>
                  ) : (
                    <>
                      <span className="text-[8px] font-bold uppercase text-gray-500">Service Net</span>
                      <span className={`text-base font-bold ${serviceNet >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {fmtHeader(serviceNet)}
                      </span>
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* RIGHT: Status + Buttons */}
            <div className="flex items-center gap-4">
              {/* Saved + Sync indicator — tap to retry on failure */}
              <button
                className="flex items-center gap-2 hover:opacity-80 transition-opacity"
                title={syncStatus === 'failed' ? 'Tap to retry sync' : syncStatus === 'synced' ? 'Synced to cloud' : 'Sync pending...'}
                onClick={async () => {
                  if (syncStatus === 'failed' || syncStatus === 'idle') {
                    setSyncStatus('syncing')
                    const result = await forceSyncToCloud()
                    if (result.success) {
                      setSyncStatus('synced')
                      setLastSyncTime(new Date().toLocaleTimeString())
                      setToastMessage('Synced to cloud')
                      setTimeout(() => setToastMessage(null), 3000)
                    } else {
                      setSyncStatus('failed')
                      setToastMessage('Sync failed — ' + (result.error || 'check connection'))
                      setTimeout(() => setToastMessage(null), 4000)
                    }
                  }
                }}
              >
                <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${
                  syncStatus === 'synced' ? 'bg-green-500' :
                  syncStatus === 'syncing' ? 'bg-yellow-500 animate-pulse' :
                  syncStatus === 'failed' ? 'bg-red-500' :
                  'bg-gray-500'
                }`} />
                {/* Sync label — hidden on mobile to prevent overflow */}
                <span className={`text-xs flex-shrink-0 hidden md:inline ${syncStatus === 'failed' ? 'text-red-400' : syncStatus === 'syncing' ? 'text-yellow-400' : 'text-gray-400'}`}>
                  {syncStatus === 'synced' && lastSyncTime
                    ? `Synced${lastSyncDevice ? ` by ${lastSyncDevice}` : ''} · ${lastSyncTime}`
                    : syncStatus === 'syncing' ? 'Pending sync...'
                    : syncStatus === 'failed' ? 'Sync failed — tap to retry'
                    : `Saved ${getRelativeTime(lastSaved)}`}
                </span>
              </button>

              {/* Session 14: Connection status indicator */}
              <div
                className="flex items-center gap-1.5 flex-shrink-0"
                title={
                  isOnline
                    ? offlineQueueCount > 0
                      ? `Online — ${offlineQueueCount} entries pending sync`
                      : 'Online — all features available'
                    : `Offline — field log & NEC lookup available (${offlineQueueCount} entries queued)`
                }
              >
                <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
                  isOnline && offlineQueueCount === 0
                    ? 'bg-green-500'
                    : isOnline && offlineQueueCount > 0
                    ? 'bg-yellow-400 animate-pulse'
                    : 'bg-red-500'
                }`} />
                {!isMobile && (
                  <span className={`text-xs flex-shrink-0 ${
                    isOnline && offlineQueueCount === 0 ? 'text-green-400' :
                    isOnline && offlineQueueCount > 0  ? 'text-yellow-400' :
                    'text-red-400'
                  }`}>
                    {isOnline && offlineQueueCount === 0 && 'Online'}
                    {isOnline && offlineQueueCount > 0  && `Syncing (${offlineQueueCount})`}
                    {!isOnline && 'Offline'}
                  </span>
                )}
              </div>

              {/* Daily Target */}
              {!isMobile && (
                <div className="text-xs text-gray-400">
                  Daily Target: <span className="text-green-400 font-semibold">${settings.dayTarget || 0}</span>
                </div>
              )}

              {/* +Log Button */}
              <button
                onClick={() => onNav('field-log')}
                className="px-3 py-1.5 bg-[#10b981] text-white text-sm font-medium rounded-full hover:bg-green-600 transition-colors flex items-center gap-1"
              >
                <Zap size={14} />
                +Log
              </button>

              {/* NW15: Neural World quick-launch — PULSE panel shortcut */}
              {!isMobile && (
                <button
                  onClick={() => onNav('neural-world')}
                  title="Neural World — 3D Business Visualization"
                  className="px-3 py-1.5 text-xs font-medium rounded-full transition-colors flex items-center gap-1 flex-shrink-0"
                  style={{
                    background: 'rgba(0,229,204,0.12)',
                    border: '1px solid rgba(0,229,204,0.35)',
                    color: '#00e5cc',
                  }}
                >
                  <Globe size={13} />
                  Neural World
                </button>
              )}

              {/* Undo Button */}
              {!isMobile && (
                <button
                  onClick={() => {
                    if (canUndo()) {
                      const success = undo()
                      if (success) {
                        const data = getBackupData()
                        setBackupData(data)
                        if (data) setKpis(getKPIs(data))
                        setToastMessage('↶ Undo')
                        setTimeout(() => setToastMessage(null), 4000)
                      }
                    }
                  }}
                  disabled={!canUndo()}
                  className="p-1.5 text-gray-400 hover:text-gray-300 hover:bg-gray-800 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  title="Undo (Ctrl+Z)"
                >
                  <Undo2 size={18} />
                </button>
              )}

              {/* Redo Button */}
              {!isMobile && (
                <button
                  onClick={() => {
                    if (canRedo()) {
                      const success = redo()
                      if (success) {
                        const data = getBackupData()
                        setBackupData(data)
                        if (data) setKpis(getKPIs(data))
                        setToastMessage('↷ Redo')
                        setTimeout(() => setToastMessage(null), 4000)
                      }
                    }
                  }}
                  disabled={!canRedo()}
                  className="p-1.5 text-gray-400 hover:text-gray-300 hover:bg-gray-800 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  title="Redo (Ctrl+Y)"
                >
                  <Redo2 size={18} />
                </button>
              )}

              {/* Backup Button */}
              {!isMobile && (
                <button
                  onClick={handleBackupDownload}
                  className="p-1.5 text-gray-400 hover:text-gray-300 hover:bg-gray-800 rounded transition-colors"
                  title="Download backup"
                >
                  <Download size={18} />
                </button>
              )}

              {/* Import Button */}
              {!isMobile && (
                <button
                  onClick={handleImportClick}
                  className="p-1.5 text-gray-400 hover:text-gray-300 hover:bg-gray-800 rounded transition-colors"
                  title="Import backup"
                >
                  <Upload size={18} />
                </button>
              )}

              {/* Hidden file input */}
              <input
                ref={fileInputRef}
                type="file"
                accept=".json"
                onChange={handleFileSelect}
                className="hidden"
              />

              {/* Time */}
              <div className="flex items-center gap-1 text-gray-400 text-sm">
                <Clock size={16} />
                <span>{currentTime}</span>
              </div>
            </div>
          </div>

          {/* ROW 2: TARGET Progress Bar */}
          {showTargetBar && (
          <div className="h-3 flex items-center px-6 bg-gradient-to-r from-green-500 via-green-600 to-blue-500 relative overflow-hidden" title={`${revenueTargetPct}% of $${(annualTarget / 1000).toFixed(0)}k annual target ($${(safeKpis.paid / 1000).toFixed(1)}k collected)`}>
            {/* Filled portion (progress) */}
            <div
              className="absolute left-0 top-0 h-full bg-gradient-to-r from-green-400 to-blue-400 transition-all"
              style={{ width: `${revenueTargetPct}%` }}
            />
            {/* Unfilled portion */}
            <div
              className="absolute top-0 h-full bg-gray-700"
              style={{ left: `${revenueTargetPct}%`, right: 0 }}
            />
          </div>
          )}
        </header>
        )} {/* end conditional header — not shown in visual-suite fullscreen */}

        {/* CONTENT AREA — B52: fullscreen when visual-suite, otherwise normal */}
        <main
          className="flex-1"
          style={activeView === 'visual-suite' || activeView === 'neural-world'
            ? { display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden', backgroundColor: '#000' }
            : { backgroundColor: 'var(--bg-secondary)', marginTop: showTargetBar ? '5rem' : '4rem', overflowX: 'auto', overflowY: 'auto', minWidth: 320, display: 'flex', flexDirection: 'column' }
          }
        >
          <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            {children}
          </div>
        </main>

        {/* Toast Notification — hidden in fullscreen mode */}
        {toastMessage && activeView !== 'visual-suite' && activeView !== 'neural-world' && (
          <div className="fixed bottom-6 left-1/2 transform -translate-x-1/2 text-white px-4 py-2 rounded-lg shadow-lg z-50 animate-pulse" style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-primary)' }}>
            {toastMessage}
          </div>
        )}

        {/* Copyright Footer — hidden in fullscreen mode */}
        {activeView !== 'visual-suite' && activeView !== 'neural-world' && (
          <div className="text-center text-[10px] text-gray-600 py-2" style={{ backgroundColor: 'var(--bg-secondary)' }}>
            &copy; 2026 Power On Solutions LLC &middot; PowerOn Hub V3.0
          </div>
        )}
      </div>

      {/* ── Quick Capture Floating Button (bottom-left) ── */}
      <QuickCaptureButton backupData={backupData} onNav={onNav} setToastMessage={setToastMessage} />
    </div>
  )
}

// ── QUICK CAPTURE COMPONENT ──────────────────────────────────────────────────
function QuickCaptureButton({ backupData, onNav, setToastMessage }: { backupData: BackupData | null, onNav: (v: string) => void, setToastMessage: (m: string | null) => void }) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [domain, setDomain] = useState('Field Ops')
  const [selectedProject, setSelectedProject] = useState('')
  const [saving, setSaving] = useState(false)
  const [recording, setRecording] = useState(false)
  const [voiceError, setVoiceError] = useState<string | null>(null)
  const [silenceCountdown, setSilenceCountdown] = useState<number | null>(null)  // null = not in silence, >0 = countdown
  const [muted, setMuted] = useState(() => localStorage.getItem('nexus_mute') === 'true')

  // ── General tab AI routing state ──────────────────────────────────────────
  type RoutingState = 'idle' | 'routing' | 'confirm' | 'manual_override'
  const [routingState, setRoutingState] = useState<RoutingState>('idle')
  const [routingResult, setRoutingResult] = useState<{
    project_id: string | null
    project_name: string | null
    category: string
    confidence: 'high' | 'medium' | 'low'
    reasoning: string
  } | null>(null)
  const [routingError, setRoutingError] = useState<string | null>(null)
  const [manualRouteProjectId, setManualRouteProjectId] = useState('')
  const [manualRouteCategory, setManualRouteCategory] = useState('Field Ops')
  const routingAbortRef = useRef<AbortController | null>(null)

  // MediaRecorder refs — direct recording without voice.ts
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const silenceTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const analyserStreamRef = useRef<MediaStream | null>(null)
  const analyserCtxRef = useRef<AudioContext | null>(null)
  const silenceStartRef = useRef<number | null>(null)

  const projects = (backupData?.projects || []).filter((p: any) => p.status === 'active')

  useEffect(() => {
    if (open && projects.length > 0 && !selectedProject) {
      setSelectedProject(projects[0].id)
    }
  }, [open])

  // Reset routing state whenever the domain tab changes
  useEffect(() => {
    setRoutingState('idle')
    setRoutingResult(null)
    setRoutingError(null)
    routingAbortRef.current?.abort()
  }, [domain])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopSilenceDetection()
      mediaRecorderRef.current?.stream?.getTracks().forEach(t => t.stop())
    }
  }, [])

  // ── Silence detection — AudioContext AnalyserNode ─────────────────────────
  // Request a second getUserMedia purely for level analysis. Gracefully degrades.
  function startSilenceDetection() {
    if (!navigator.mediaDevices?.getUserMedia) return
    navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
      analyserStreamRef.current = stream
      try {
        const ctx = new (window.AudioContext || (window as any).webkitAudioContext)()
        analyserCtxRef.current = ctx
        const analyser = ctx.createAnalyser()
        analyser.fftSize = 512
        const source = ctx.createMediaStreamSource(stream)
        source.connect(analyser)
        const dataArray = new Uint8Array(analyser.frequencyBinCount)
        silenceStartRef.current = null

        silenceTimerRef.current = setInterval(() => {
          analyser.getByteFrequencyData(dataArray)
          const avg = dataArray.reduce((a, v) => a + v, 0) / dataArray.length  // 0–255 scale
          console.log('[QuickCapture] audio level avg:', avg.toFixed(1))

          if (avg < 8) {   // below silence threshold
            if (silenceStartRef.current === null) {
              silenceStartRef.current = Date.now()
            }
            const elapsed = Date.now() - silenceStartRef.current
            const remaining = Math.max(0, 2500 - elapsed) / 1000
            setSilenceCountdown(remaining)
            if (elapsed >= 2500) {
              console.log('[QuickCapture] Auto-stop: 2.5s silence detected')
              stopSilenceDetection()
              // Stop own MediaRecorder directly — no voice.ts dependency
              if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
                mediaRecorderRef.current.stop()
              }
            }
          } else {
            // Audio detected — reset silence timer
            silenceStartRef.current = null
            setSilenceCountdown(null)
          }
        }, 100)
      } catch (ctxErr) {
        console.warn('[QuickCapture] AnalyserNode setup failed:', ctxErr)
        stream.getTracks().forEach(t => t.stop())
        analyserStreamRef.current = null
      }
    }).catch(err => {
      console.warn('[QuickCapture] Silence detection getUserMedia failed (graceful):', err)
    })
  }

  function stopSilenceDetection() {
    if (silenceTimerRef.current) {
      clearInterval(silenceTimerRef.current)
      silenceTimerRef.current = null
    }
    if (analyserStreamRef.current) {
      analyserStreamRef.current.getTracks().forEach(t => t.stop())
      analyserStreamRef.current = null
    }
    if (analyserCtxRef.current && analyserCtxRef.current.state !== 'closed') {
      analyserCtxRef.current.close().catch(() => {})
      analyserCtxRef.current = null
    }
    silenceStartRef.current = null
    setSilenceCountdown(null)
  }

  // ── iOS AudioContext inline unlock — synchronous, no voice.ts dependency ──
  function unlockAudioContextInline(): void {
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext
      if (!AudioCtx) return
      const ctx = new AudioCtx()
      // ctx.resume() called synchronously in same call stack as user gesture (iOS requirement)
      if (ctx.state === 'suspended') ctx.resume()
      // Play silent buffer to fully satisfy iOS autoplay gate
      const buf = ctx.createBuffer(1, 1, 22050)
      const src = ctx.createBufferSource()
      src.buffer = buf
      src.connect(ctx.destination)
      src.start(0)
      // Close after unlock — we only needed it for the gesture gate
      setTimeout(() => ctx.close().catch(() => {}), 500)
    } catch { /* ignore — non-iOS browsers don't need this */ }
  }

  // ── handleMicTap — MediaRecorder API only, zero connection to voice.ts ──────
  async function handleMicTap() {
    // Synchronous AudioContext unlock — must be first call in tap handler for iOS
    unlockAudioContextInline()

    if (recording) {
      console.log('[QuickCapture] Manual stop recording')
      stopSilenceDetection()
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
        mediaRecorderRef.current.stop()
      }
      setRecording(false)
    } else {
      console.log('[QuickCapture] Starting recording')
      setOpen(true)
      setVoiceError(null)

      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        audioChunksRef.current = []

        const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm'
          : MediaRecorder.isTypeSupported('audio/mp4') ? 'audio/mp4'
          : ''
        const mr = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
        mediaRecorderRef.current = mr

        mr.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data) }

        mr.onstop = async () => {
          stream.getTracks().forEach(t => t.stop())
          setRecording(false)
          setSilenceCountdown(null)

          const recordedMime = mr.mimeType || mimeType || 'audio/webm'
          const audioBlob = new Blob(audioChunksRef.current, { type: recordedMime })
          audioChunksRef.current = []

          if (audioBlob.size < 1000) {
            setVoiceError('Recording too short — speak clearly and try again.')
            setTimeout(() => setVoiceError(null), 4000)
            return
          }

          // POST to /.netlify/functions/whisper — no voice.ts, no agentBus, no NEXUS
          try {
            const arrayBuffer = await audioBlob.arrayBuffer()
            const uint8 = new Uint8Array(arrayBuffer)
            let binary = ''
            for (let i = 0; i < uint8.byteLength; i++) binary += String.fromCharCode(uint8[i])
            const base64 = btoa(binary)
            const ext = recordedMime.includes('mp4') ? 'mp4' : recordedMime.includes('ogg') ? 'ogg' : 'webm'

            const res = await fetch('/.netlify/functions/whisper', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ audio: base64, filename: `capture.${ext}`, language: 'en' }),
            })
            if (!res.ok) throw new Error(`Whisper error ${res.status}`)
            const data = await res.json()
            const transcriptText = (data.text || '').trim()
            if (transcriptText) {
              setText(transcriptText)
              setVoiceError(null)
            } else {
              setVoiceError('No speech detected. Speak clearly and try again.')
              setTimeout(() => setVoiceError(null), 4000)
            }
          } catch (err: any) {
            console.error('[QuickCapture] Whisper error:', err?.message)
            setVoiceError('Transcription failed — type your note manually.')
            setTimeout(() => setVoiceError(null), 5000)
          }
        }

        mr.start(100)
        setRecording(true)
        startSilenceDetection()
        console.log('[QuickCapture] MediaRecorder started (isolated from voice.ts)')
      } catch (err: any) {
        const isPermDenied = err?.name === 'NotAllowedError' || err?.message?.includes('Permission')
        setVoiceError(isPermDenied
          ? 'Microphone access blocked. Allow mic permission in browser settings.'
          : `Mic error: ${err?.message || 'unknown'}`)
        setTimeout(() => setVoiceError(null), 5000)
      }
    }
  }

  // ── Mute toggle — localStorage 'nexus_mute' ───────────────────────────────
  function toggleMute() {
    setMuted(prev => {
      const next = !prev
      localStorage.setItem('nexus_mute', String(next))
      return next
    })
  }

  // ── AI routing for General tab ────────────────────────────────────────────
  async function routeWithAI() {
    const noteText = text.trim()
    if (!noteText) return

    setRoutingState('routing')
    setRoutingError(null)

    const abortCtrl = new AbortController()
    routingAbortRef.current = abortCtrl

    // 3-second hard timeout — fall back to manual if exceeded
    const timeoutId = setTimeout(() => {
      abortCtrl.abort()
      setRoutingState('manual_override')
      setRoutingError('Auto-routing unavailable — please route manually')
    }, 3000)

    try {
      const projectsList = projects.map((p: any) => ({ id: p.id, name: p.name }))
      const response = await callClaude({
        system: 'You are a routing assistant for an electrical contractor\'s operations platform. Given a note, return ONLY a JSON object with no markdown, no explanation: {"project_id": "uuid or null", "project_name": "string or null", "category": "App Dev|Field Ops|Business|Personal", "confidence": "high|medium|low", "reasoning": "one sentence max"}',
        messages: [{ role: 'user', content: `Projects available: ${JSON.stringify(projectsList)}. Note to classify: "${noteText}"` }],
        max_tokens: 200,
        signal: abortCtrl.signal,
      })
      clearTimeout(timeoutId)
      const responseText = claudeExtractText(response)
      // Strip any markdown code fences if present
      const cleaned = responseText.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/, '').trim()
      const parsed = JSON.parse(cleaned)
      setRoutingResult(parsed)
      setRoutingState('confirm')
    } catch (err: any) {
      clearTimeout(timeoutId)
      if (err?.name === 'AbortError') return // timeout already handled
      console.warn('[QuickCapture] AI routing failed:', err?.message)
      setRoutingState('manual_override')
      setRoutingError('Auto-routing unavailable — please route manually')
    }
  }

  async function handleCapture() {
    if (!text.trim()) return

    // General tab: if routing hasn't started yet, kick off AI routing instead of saving
    if (domain === 'General' && routingState === 'idle') {
      await routeWithAI()
      return
    }

    setSaving(true)
    const capturedText = text.trim()

    // Determine routing metadata based on domain + routing state
    let saveProjectId = selectedProject || 'general'
    let saveProjectName = projects.find((p: any) => p.id === selectedProject)?.name || 'General'
    let saveDomain = domain
    let saveRouting: 'ai' | 'manual' | 'direct' = 'direct'
    let saveAiConfidence: 'high' | 'medium' | 'low' | null = null
    let saveAiReasoning: string | null = null

    if (domain === 'General') {
      if (routingState === 'confirm' && routingResult) {
        saveProjectId = routingResult.project_id || 'general'
        saveProjectName = routingResult.project_name || 'General'
        saveDomain = routingResult.category
        saveRouting = 'ai'
        saveAiConfidence = routingResult.confidence
        saveAiReasoning = routingResult.reasoning
      } else if (routingState === 'manual_override') {
        saveProjectId = manualRouteProjectId || 'general'
        saveProjectName = projects.find((p: any) => p.id === manualRouteProjectId)?.name || 'General'
        saveDomain = manualRouteCategory
        saveRouting = 'manual'
      }
    }

    try {
      const backup = getBackupData()
      if (!backup) return
      if (!backup.fieldObservationCards) backup.fieldObservationCards = []
      backup.fieldObservationCards.push({
        id: 'foc_' + Date.now(),
        project_id: saveProjectId,
        project_name: saveProjectName,
        source: 'text',
        observed_condition: capturedText,
        urgency: 'before_next_mobilization',
        status: 'open',
        ai_summary: saveDomain + ': ' + capturedText.slice(0, 120),
        routing: saveRouting,
        ai_confidence: saveAiConfidence,
        ai_reasoning: saveAiReasoning,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      saveBackupData(backup)
      setToastMessage('Saved to ' + saveDomain)
      setTimeout(() => setToastMessage(null), 3000)
      setText('')
      setOpen(false)
      // Reset routing state
      setRoutingState('idle')
      setRoutingResult(null)
      setRoutingError(null)

      // Non-blocking ElevenLabs TTS confirmation — only when NOT muted
      // FIX: re-read nexus_mute fresh from localStorage at CALL TIME (not stale component state)
      // This catches mute toggles from other components (NexusDrawerPanel, etc.)
      const isMutedNow = localStorage.getItem('nexus_mute') === 'true'
      if (!isMutedNow) {
        ;(async () => {
          try {
            const voiceId = localStorage.getItem('nexus_voice_id') || 'pNInz6obpgDQGcFmaJgB'
            const speechRate = parseFloat(localStorage.getItem('nexus_speech_rate') || '1.0')
            console.log('[QuickCapture] TTS confirm — voice:', voiceId, 'rate:', speechRate)
            const ttsResult = await synthesizeWithElevenLabs({
              text: 'Captured. ' + capturedText.slice(0, 80),
              voice_id: voiceId,
              speed: speechRate,
            })
            const audio = new Audio(ttsResult.audioUrl)
            audio.play().catch(() => {})
          } catch {
            // WebSpeech fallback
            try {
              const u = new SpeechSynthesisUtterance('Captured.')
              window.speechSynthesis?.speak(u)
            } catch { /* ignore */ }
          }
        })()
      } else {
        console.log('[QuickCapture] TTS muted (nexus_mute=true at call time) — skipping capture confirmation')
      }
    } finally {
      setSaving(false)
    }
  }

  const domains = ['App Dev', 'Field Ops', 'Business', 'Personal', 'General']

  // Context-aware project selector logic
  const showProjectSelector = domain === 'Field Ops' || domain === 'Business'
  const projectRequired = domain === 'Field Ops'
  const captureDisabled = !text.trim() || saving || (projectRequired && !selectedProject) || routingState === 'routing'

  return (
    <>
      {/* Floating button — bottom-left */}
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-6 left-6 w-14 h-14 rounded-full bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg z-50 flex items-center justify-center transition-colors"
        title="Quick log"
      >
        <Plus size={24} />
      </button>

      {/* Bottom sheet */}
      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center" onClick={() => { setOpen(false); setRoutingState('idle'); setRoutingResult(null); setRoutingError(null) }}>
          <div className="absolute inset-0 bg-black/40" />
          <div
            className="relative w-full max-w-lg border-t border-gray-700 rounded-t-2xl p-5 space-y-4 animate-slide-up" style={{ backgroundColor: 'var(--bg-card)' }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header row */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 min-w-0">
                <h3 className="text-sm font-bold flex-shrink-0" style={{ color: 'var(--text-primary)' }}>Quick Capture</h3>
                {/* Listening / countdown indicator */}
                {recording && (
                  <span className="text-[11px] text-red-400 animate-pulse truncate">
                    {silenceCountdown !== null
                      ? `Stopping in ${silenceCountdown.toFixed(1)}s…`
                      : '● Listening…'}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                {/* Mute toggle — suppresses TTS confirmation on Capture */}
                <button
                  onClick={toggleMute}
                  className={`w-9 h-9 rounded-full flex items-center justify-center transition-colors ${
                    muted
                      ? 'bg-gray-800 text-amber-400 hover:bg-gray-700'
                      : 'bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700'
                  }`}
                  title={muted ? 'TTS muted — tap to unmute' : 'Mute TTS confirmation'}
                >
                  {muted ? <VolumeX size={15} /> : <Volume2 size={15} />}
                </button>
                {/* Mic button — unlockAudioContext called synchronously at top of handleMicTap */}
                <button
                  onClick={handleMicTap}
                  className={`w-9 h-9 rounded-full flex items-center justify-center transition-colors ${
                    recording
                      ? 'bg-red-500 text-white animate-pulse'
                      : 'bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700'
                  }`}
                  title={recording ? 'Stop recording' : 'Dictate observation'}
                >
                  <Mic size={16} />
                </button>
                <button onClick={() => { setOpen(false); setRoutingState('idle'); setRoutingResult(null); setRoutingError(null) }} className="text-gray-400 hover:text-white"><X size={18} /></button>
              </div>
            </div>

            {/* Voice error banner — shows inside Quick Capture panel, not just NEXUS */}
            {voiceError && (
              <div className="px-3 py-2 text-xs text-red-300 bg-red-950/40 border border-red-900/50 rounded-lg flex items-center gap-2">
                <span className="flex-shrink-0">⚠</span>
                <span>{voiceError}</span>
              </div>
            )}

            {/* Project selector — visible only for Field Ops (required) and Business (optional) */}
            {showProjectSelector && (
              <div className="relative">
                <select
                  value={selectedProject}
                  onChange={(e) => setSelectedProject(e.target.value)}
                  className="w-full px-3 py-2.5 text-xs bg-gray-900 border border-gray-700 rounded-lg text-gray-200 appearance-none"
                >
                  {!projectRequired && <option value="">No specific project</option>}
                  {projects.map((p: any) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
                <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
                {projectRequired && !selectedProject && (
                  <p className="text-[10px] text-amber-400 mt-1 pl-1">⚠ Select a project before capturing</p>
                )}
              </div>
            )}

            {/* Domain chips */}
            <div className="flex gap-2 flex-wrap">
              {domains.map((d) => (
                <button
                  key={d}
                  onClick={() => setDomain(d)}
                  className={`text-[10px] px-3 py-1.5 rounded-full font-semibold transition-colors ${
                    domain === d
                      ? 'bg-emerald-600 text-white'
                      : 'bg-gray-800 text-gray-400 hover:text-gray-200'
                  }`}
                >
                  {d}
                </button>
              ))}
            </div>

            {/* Text input */}
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="What did you observe or want to capture?"
              rows={3}
              className="w-full px-3 py-2.5 text-sm bg-gray-900 border border-gray-700 rounded-lg text-gray-200 placeholder-gray-600 resize-none"
              autoFocus
            />

            {/* AI Routing Result UI — General tab only, shown after user taps Capture */}
            {domain === 'General' && routingState !== 'idle' && (
              <div className="space-y-2">
                {routingState === 'routing' && (
                  <div className="px-3 py-2.5 text-xs text-gray-300 bg-gray-800/60 border border-gray-700 rounded-lg flex items-center gap-2">
                    <span className="inline-block animate-spin text-emerald-400 font-bold">⟳</span>
                    <span>NEXUS is routing your note…</span>
                  </div>
                )}

                {routingState === 'confirm' && routingResult && (
                  <div className={`px-3 py-2.5 rounded-lg border ${
                    routingResult.confidence === 'high'
                      ? 'bg-emerald-950/40 border-emerald-800/60'
                      : routingResult.confidence === 'medium'
                      ? 'bg-yellow-950/40 border-yellow-800/60'
                      : 'bg-gray-800/60 border-gray-700'
                  }`}>
                    <p className="text-xs font-semibold text-gray-100 mb-0.5">
                      NEXUS suggests: {routingResult.project_name || 'No specific project'} → {routingResult.category}
                    </p>
                    <p className="text-[10px] text-gray-400 italic mb-2">{routingResult.reasoning}</p>
                    <div className="flex gap-2">
                      <button
                        onClick={handleCapture}
                        disabled={saving}
                        className="flex-1 py-2 text-xs font-bold bg-emerald-600 hover:bg-emerald-500 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded-lg transition-colors"
                      >
                        {saving ? 'Saving…' : 'Confirm'}
                      </button>
                      <button
                        onClick={() => { setRoutingState('manual_override'); setManualRouteProjectId(''); setManualRouteCategory('Field Ops') }}
                        className="flex-1 py-2 text-xs font-bold bg-gray-700 hover:bg-gray-600 text-gray-200 rounded-lg transition-colors"
                      >
                        Change
                      </button>
                    </div>
                  </div>
                )}

                {routingState === 'manual_override' && (
                  <div className="space-y-2">
                    {routingError && (
                      <div className="px-3 py-2 text-xs text-amber-300 bg-amber-950/40 border border-amber-900/50 rounded-lg flex items-center gap-2">
                        <span className="flex-shrink-0">⚠</span>
                        <span>{routingError}</span>
                      </div>
                    )}
                    <div className="flex gap-2">
                      <div className="relative flex-1">
                        <select
                          value={manualRouteProjectId}
                          onChange={(e) => setManualRouteProjectId(e.target.value)}
                          className="w-full px-3 py-2 text-xs bg-gray-900 border border-gray-700 rounded-lg text-gray-200 appearance-none"
                        >
                          <option value="">No specific project</option>
                          {projects.map((p: any) => (
                            <option key={p.id} value={p.id}>{p.name}</option>
                          ))}
                        </select>
                        <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
                      </div>
                      <div className="relative flex-1">
                        <select
                          value={manualRouteCategory}
                          onChange={(e) => setManualRouteCategory(e.target.value)}
                          className="w-full px-3 py-2 text-xs bg-gray-900 border border-gray-700 rounded-lg text-gray-200 appearance-none"
                        >
                          {['App Dev', 'Field Ops', 'Business', 'Personal'].map((cat) => (
                            <option key={cat} value={cat}>{cat}</option>
                          ))}
                        </select>
                        <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Capture button — hidden when routing confirm UI is active (uses Confirm button instead) */}
            {!(domain === 'General' && routingState === 'confirm') && (
              <button
                onClick={handleCapture}
                disabled={captureDisabled}
                className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 disabled:bg-gray-700 disabled:text-gray-500 text-white text-sm font-bold rounded-lg transition-colors"
              >
                {saving ? 'Saving…'
                  : routingState === 'routing' ? 'Routing…'
                  : domain === 'General' && routingState === 'idle' ? 'Capture & Route'
                  : 'Capture'}
              </button>
            )}
          </div>
        </div>
      )}
    </>
  )
}
