// @ts-nocheck
import React, { useState, useEffect, useRef } from 'react'
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
  Menu,
  X,
} from 'lucide-react'
import { getBackupData, saveBackupData, importBackupFromFile, exportBackup, getKPIs, syncToSupabase, loadFromSupabase, isSupabaseConfigured, startPeriodicSync, forceSyncToCloud, getLastSyncMeta, type BackupData } from '@/services/backupDataService'
import { undo, redo, canUndo, canRedo } from '@/services/undoRedoService'
import { initEventBus } from '@/services/agentEventBus'
import { subscribeNexusToEvents } from '@/agents/nexus'
import { subscribeLedgerToEvents } from '@/agents/ledger'

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
  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'synced' | 'failed'>('idle')
  const [lastSyncTime, setLastSyncTime] = useState<string>('')
  const [lastSyncDevice, setLastSyncDevice] = useState<string>('')

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

    // Listen for storage changes from other components (e.g., Field Log saves)
    const handleStorageChange = () => refresh()
    window.addEventListener('storage', handleStorageChange)

    // Clean up listener on unmount
    return () => {
      window.removeEventListener('storage', handleStorageChange)
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
    const unsubNexus = subscribeNexusToEvents()
    const unsubLedger = subscribeLedgerToEvents()
    console.log('[Layout] Event bus initialized, NEXUS + LEDGER subscribed')
    return () => { unsubNexus(); unsubLedger() }
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
  const safeKpis = kpis || { pipeline: 0, paid: 0, billed: 0, exposure: 0, svcUnbilled: 0, openRfis: 0, totalHours: 0, activeProjects: 0 }

  // Calculate percentage for revenue target progress
  const annualTarget = backupData?.settings?.annualTarget || 120000
  const revenueTargetPct = Math.min(100, Math.round((safeKpis.paid / annualTarget) * 100))

  // SERVICE NET = Total Quoted - Material - Mileage from service calls
  const serviceNet = (() => {
    const svcLogs = backupData?.serviceLogs || []
    const mileRate = backupData?.settings?.mileRate || 0.66
    let totalQuoted = 0, totalMaterial = 0, totalMileage = 0
    svcLogs.forEach((l: any) => {
      totalQuoted += Number(l.quoted || 0)
      totalMaterial += Number(l.materialCost || l.material || 0)
      totalMileage += Number(l.mileage || 0) * mileRate
    })
    return totalQuoted - totalMaterial - totalMileage
  })()

  // Responsive breakpoints
  const isCompact = windowWidth < 1200
  const showTargetBar = windowWidth >= 1400

  // Responsive sidebar modes (declared above, near useState for windowWidth)

  // Sidebar width
  const sidebarWidth = isMobile ? 280 : isDesktop ? 224 : (sidebarOpen ? 224 : 64)
  const showLabels = isDesktop || sidebarOpen
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

  // Business nav items
  const businessItems = [
    { label: 'Graph Dashboard', icon: BarChart3, view: 'graph-dashboard' },
    { label: 'Field Log', icon: ClipboardList, view: 'field-log' },
    { label: 'Money', icon: DollarSign, view: 'money' },
    { label: 'Solar Income', icon: Calculator, view: 'income-calc' },
    { label: 'Price Book', icon: BookOpen, view: 'price-book' },
    { label: 'Team', icon: Users, view: 'team' },
    { label: 'Settings', icon: Settings, view: 'settings' },
  ]

  // Toggle and close helpers
  const toggleSidebar = () => setSidebarOpen(prev => !prev)
  const closeSidebar = () => { if (isMobile || isTablet) setSidebarOpen(false) }
  const handleNavClick = (view: string) => {
    onNav(view)
    if (isMobile) setSidebarOpen(false)
  }

  return (
    <div className="flex h-screen text-white overflow-hidden" style={{ backgroundColor: 'var(--bg-secondary)' }}>
      {/* MOBILE/TABLET OVERLAY BACKDROP */}
      {isOverlay && sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 transition-opacity"
          onClick={closeSidebar}
        />
      )}

      {/* LEFT SIDEBAR */}
      <aside
        className={`fixed left-0 top-0 h-screen flex flex-col z-50 transition-all duration-300 ${
          isMobile
            ? (sidebarOpen ? 'translate-x-0' : '-translate-x-full')
            : ''
        }`}
        style={{
          width: isMobile ? 280 : (isTablet ? (sidebarOpen ? 224 : 64) : 224),
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
                    <Zap size={22} className="text-green-400" />
                    <span className="text-base font-bold tracking-tight" style={{ color: 'var(--text-primary)' }}>{settings.company || 'PowerOn Solutions'}</span>
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
          {/* WORKSPACE Section */}
          <div className="pt-4">
            {showLabels && <div className="px-4 py-2 text-xs font-bold text-gray-500 uppercase tracking-wider">Workspace</div>}
            <nav className="space-y-1">
              {workspaceItems.map((item) => {
                const Icon = item.icon
                const isActive = activeView === item.view
                return (
                  <button
                    key={item.view}
                    onClick={() => handleNavClick(item.view)}
                    title={!showLabels ? item.label : undefined}
                    className={`w-full flex items-center ${showLabels ? 'gap-3 px-4' : 'justify-center px-2'} py-2.5 text-sm transition-colors ${
                      isActive
                        ? 'bg-gray-800 border-l-2 border-[#10b981] text-white'
                        : 'text-gray-400 hover:text-gray-300 border-l-2 border-transparent'
                    }`}
                  >
                    <Icon size={18} />
                    {showLabels && <span>{item.label}</span>}
                  </button>
                )
              })}
            </nav>
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
                      className={`w-full flex items-center ${showLabels ? 'gap-3 px-4' : 'justify-center px-2'} py-2.5 text-sm transition-colors ${
                        isHighlighted
                          ? 'bg-gray-800 border-l-2 border-[#10b981] text-white'
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
            {showLabels && <div className="px-4 py-2 text-xs font-bold text-gray-500 uppercase tracking-wider">Business</div>}
            <nav className="space-y-1">
              {businessItems.map((item) => {
                const Icon = item.icon
                const isActive = activeView === item.view
                return (
                  <button
                    key={item.view}
                    onClick={() => handleNavClick(item.view)}
                    title={!showLabels ? item.label : undefined}
                    className={`w-full flex items-center ${showLabels ? 'gap-3 px-4' : 'justify-center px-2'} py-2.5 text-sm transition-colors ${
                      isActive
                        ? 'bg-gray-800 border-l-2 border-[#10b981] text-white'
                        : 'text-gray-400 hover:text-gray-300 border-l-2 border-transparent hover:border-gray-600'
                    }`}
                  >
                    <Icon size={18} />
                    {showLabels && <span>{item.label}</span>}
                  </button>
                )
              })}
            </nav>
          </div>
        </div>
      </aside>

      {/* MAIN LAYOUT */}
      <div className="flex flex-col flex-1 transition-all duration-300" style={{ marginLeft: isMobile ? 0 : (isTablet ? (sidebarOpen ? 0 : 64) : 224) }}>
        {/* TOP BAR - TWO ROWS */}
        <header className="fixed top-0 right-0 flex flex-col z-30 transition-all duration-300" style={{ left: isMobile ? 0 : (isTablet ? (sidebarOpen ? 0 : 64) : 224), backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-primary)' }}>
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
                    <span className="text-sm font-bold text-green-400">${(safeKpis.pipeline / 1000).toFixed(0)}k</span>
                  ) : (
                    <>
                      <span className="text-[8px] font-bold uppercase text-gray-500">Pipeline</span>
                      <span className="text-base font-bold text-green-400">
                        ${(safeKpis.pipeline / 1000).toFixed(0)}k
                      </span>
                    </>
                  )}
                </div>

                {/* PAID */}
                <div className="flex flex-col items-center min-w-[80px]" title={isCompact ? 'Paid' : undefined}>
                  {isCompact ? (
                    <span className="text-sm font-bold text-green-400">${(safeKpis.paid / 1000).toFixed(0)}k</span>
                  ) : (
                    <>
                      <span className="text-[8px] font-bold uppercase text-gray-500">Paid</span>
                      <span className="text-base font-bold text-green-400">
                        ${(safeKpis.paid / 1000).toFixed(0)}k
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
                    <span className="text-sm font-bold text-red-400">${(safeKpis.exposure / 1000).toFixed(0)}k</span>
                  ) : (
                    <>
                      <span className="text-[8px] font-bold uppercase text-gray-500">Exposure</span>
                      <span className="text-base font-bold text-red-400">
                        ${(safeKpis.exposure / 1000).toFixed(0)}k
                      </span>
                    </>
                  )}
                </div>

                {/* SVC UNBILLED */}
                <div className="flex flex-col items-center min-w-[70px]" title={isCompact ? 'Svc Unbilled' : undefined}>
                  {isCompact ? (
                    <span className="text-sm font-bold text-yellow-400">${Math.round(safeKpis.svcUnbilled / 1000)}k</span>
                  ) : (
                    <>
                      <span className="text-[8px] font-bold uppercase text-gray-500">Svc Unbilled</span>
                      <span className="text-base font-bold text-yellow-400">
                        ${Math.round(safeKpis.svcUnbilled / 1000)}k
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
                    <span className={`text-sm font-bold ${serviceNet >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>${(serviceNet / 1000).toFixed(0)}k</span>
                  ) : (
                    <>
                      <span className="text-[8px] font-bold uppercase text-gray-500">Service Net</span>
                      <span className={`text-base font-bold ${serviceNet >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        ${(serviceNet / 1000).toFixed(0)}k
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
                <div className={`w-2 h-2 rounded-full ${
                  syncStatus === 'synced' ? 'bg-green-500' :
                  syncStatus === 'syncing' ? 'bg-yellow-500 animate-pulse' :
                  syncStatus === 'failed' ? 'bg-red-500' :
                  'bg-gray-500'
                }`} />
                <span className={`text-xs ${syncStatus === 'failed' ? 'text-red-400' : syncStatus === 'syncing' ? 'text-yellow-400' : 'text-gray-400'}`}>
                  {syncStatus === 'synced' && lastSyncTime
                    ? `Synced${lastSyncDevice ? ` by ${lastSyncDevice}` : ''} · ${lastSyncTime}`
                    : syncStatus === 'syncing' ? 'Pending sync...'
                    : syncStatus === 'failed' ? 'Sync failed — tap to retry'
                    : `Saved ${getRelativeTime(lastSaved)}`}
                </span>
              </button>

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

        {/* CONTENT AREA */}
        <main className="flex-1 overflow-auto" style={{ backgroundColor: 'var(--bg-secondary)', marginTop: showTargetBar ? '5rem' : '4rem' }}>
          {children}
        </main>

        {/* Toast Notification */}
        {toastMessage && (
          <div className="fixed bottom-6 left-1/2 transform -translate-x-1/2 text-white px-4 py-2 rounded-lg shadow-lg z-50 animate-pulse" style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-primary)' }}>
            {toastMessage}
          </div>
        )}
      </div>
    </div>
  )
}
