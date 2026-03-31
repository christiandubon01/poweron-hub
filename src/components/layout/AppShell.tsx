// @ts-nocheck
/**
 * AppShell — PowerOn Hub v15r-matching shell.
 *
 * Uses V15rLayout for the top bar + sidebar, renders all v15r panels.
 * AI agent panels are lazy-loaded to prevent import-time crashes.
 */

import React, { useState, useEffect, useMemo, Suspense, lazy } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { getBackupData } from '@/services/backupDataService'

// v15r layout shell
import V15rLayout from '@/components/v15r/V15rLayout'

// v15r panels — primary operational views (static imports — these are critical)
import V15rHome from '@/components/v15r/V15rHome'
import V15rProjectsPanel from '@/components/v15r/V15rProjectsPanel'
import V15rProjectInner from '@/components/v15r/V15rProjectInner'
import V15rFieldLogPanel from '@/components/v15r/V15rFieldLogPanel'
import V15rMoneyPanel from '@/components/v15r/V15rMoneyPanel'
import V15rIncomeCalc from '@/components/v15r/V15rIncomeCalc'
import V15rPriceBookPanel from '@/components/v15r/V15rPriceBookPanel'
import V15rLeadsPanel from '@/components/v15r/V15rLeadsPanel'
import V15rTemplatesPanel from '@/components/v15r/V15rTemplatesPanel'
import V15rSettingsPanel from '@/components/v15r/V15rSettingsPanel'
import V15rTeamPanel from '@/components/v15r/V15rTeamPanel'
import V15rDashboard from '@/components/v15r/V15rDashboard'
import V15rPricingIntelligencePanel from '@/components/v15r/V15rPricingIntelligencePanel'

// AI agent panels — lazy-loaded so import errors don't crash the main shell
const NexusChatPanel = lazy(() => import('@/components/nexus/NexusChatPanel').then(m => ({ default: m.NexusChatPanel })))
const MarketingPanel = lazy(() => import('@/components/spark/MarketingPanel').then(m => ({ default: m.MarketingPanel })))
const SchedulePanel  = lazy(() => import('@/components/chrono/SchedulePanel').then(m => ({ default: m.SchedulePanel })))
const CodePanel      = lazy(() => import('@/components/ohm/CodePanel').then(m => ({ default: m.CodePanel })))
const OhmCalculator  = lazy(() => import('@/components/ohm/Calculator').then(m => ({ default: m.Calculator })))
const ProposalFeed   = lazy(() => import('@/components/proposals/ProposalFeed').then(m => ({ default: m.ProposalFeed })))
const VoiceSettings  = lazy(() => import('@/components/voice/VoiceSettings').then(m => ({ default: m.VoiceSettings })))

// Activity log panel (lazy-loaded)
const ActivityPanel = lazy(() => import('@/components/ActivityPanel').then(m => ({ default: m.ActivityPanel })))

// GUARDIAN panel (lazy-loaded)
const GuardianPanel = lazy(() => import('@/components/guardian/GuardianPanel').then(m => ({ default: m.GuardianPanel })))

// Voice journal panel (lazy-loaded)
const JournalPanel = lazy(() => import('@/components/JournalPanel').then(m => ({ default: m.JournalPanel })))

// Lazy-load non-critical overlays
const VoiceActivationButton = lazy(() => import('@/components/voice/VoiceActivationButton').then(m => ({ default: m.VoiceActivationButton })))
const OnboardingModal = lazy(() => import('@/components/onboarding/OnboardingModal'))

// Loading fallback for lazy-loaded panels
function PanelLoading() {
  return (
    <div className="flex items-center justify-center w-full h-64">
      <div className="text-gray-500 text-sm">Loading panel...</div>
    </div>
  )
}


// ── AppShell ─────────────────────────────────────────────────────────────────

interface AppShellProps {
  children?: React.ReactNode
}

export function AppShell({ children }: AppShellProps) {
  const [activeView, setActiveView] = useState('home')
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null)
  const [projectTab, setProjectTab] = useState('estimate')
  const [showOnboarding, setShowOnboarding] = useState(false)

  let profile = null
  try {
    const auth = useAuth()
    profile = auth.profile
  } catch (e) {
    console.warn('[AppShell] useAuth failed, continuing without profile:', e)
  }

  // Show onboarding modal for new users
  useEffect(() => {
    if (profile && profile.onboarding_completed === false) {
      setShowOnboarding(true)
    }
  }, [profile])

  // NEXUS command "show snapshots" → navigate to settings panel
  useEffect(() => {
    function handleSnapshotCommand() {
      setActiveView('settings')
    }
    window.addEventListener('poweron:show-snapshots', handleSnapshotCommand)
    return () => window.removeEventListener('poweron:show-snapshots', handleSnapshotCommand)
  }, [])

  // NEXUS command "show activity" → navigate to activity panel
  useEffect(() => {
    function handleShowActivity() {
      setActiveView('activity')
    }
    window.addEventListener('poweron:show-activity', handleShowActivity)
    return () => window.removeEventListener('poweron:show-activity', handleShowActivity)
  }, [])

  // NEXUS command "show guardian" → navigate to guardian panel
  useEffect(() => {
    function handleShowGuardian() {
      setActiveView('guardian')
    }
    window.addEventListener('poweron:show-guardian', handleShowGuardian)
    return () => window.removeEventListener('poweron:show-guardian', handleShowGuardian)
  }, [])

  // NEXUS command "show journal" → navigate to voice journal panel
  useEffect(() => {
    function handleShowJournal() {
      setActiveView('journal')
    }
    window.addEventListener('poweron:show-journal', handleShowJournal)
    return () => window.removeEventListener('poweron:show-journal', handleShowJournal)
  }, [])

  // Handle navigation
  function handleNav(view: string) {
    // Project tab views that should NOT clear activeProjectId
    const projectTabViews = ['estimate', 'material-takeoff', 'progress', 'framework', 'rfi-tracker', 'coordination']
    if (!view.startsWith('project-') && !projectTabViews.includes(view)) {
      setActiveProjectId(null)
    }
    setActiveView(view)
  }

  // Handle project selection (opens project inner view)
  function handleSelectProject(projectId: string) {
    setActiveProjectId(projectId)
    setActiveView('project-inner')
    setProjectTab('estimate')
  }

  // Handle project close
  function handleCloseProject() {
    setActiveProjectId(null)
    setActiveView('projects')
  }

  // Look up active project name for sidebar display
  const activeProjectName = useMemo(() => {
    if (!activeProjectId) return null
    const backup = getBackupData()
    if (!backup) return null
    const project = (backup.projects || []).find(p => p.id === activeProjectId)
    return project ? project.name : null
  }, [activeProjectId])

  // ── Content routing ──────────────────────────────────────────────────────
  function renderContent() {
    if (children) return children

    // Project inner view (has its own tab routing)
    if (activeView === 'project-inner' && activeProjectId) {
      return (
        <V15rProjectInner
          projectId={activeProjectId}
          onClose={handleCloseProject}
          activeTab={projectTab}
          onTabChange={setProjectTab}
        />
      )
    }

    switch (activeView) {
      // v15r Workspace
      case 'home':            return <V15rHome />
      case 'projects':        return <V15rProjectsPanel onSelectProject={handleSelectProject} />
      case 'leads':           return <V15rLeadsPanel />
      case 'templates':       return <V15rTemplatesPanel />
      case 'pricing-intelligence': return <V15rPricingIntelligencePanel />
      case 'pricing-intel':        return <V15rPricingIntelligencePanel />

      // v15r Business
      case 'graph-dashboard': return <V15rDashboard />
      case 'field-log':       return <V15rFieldLogPanel />
      case 'money':           return <V15rMoneyPanel />
      case 'income-calc':     return <V15rIncomeCalc />
      case 'price-book':      return <V15rPriceBookPanel />
      case 'team':            return <V15rTeamPanel />
      case 'settings':        return <V15rSettingsPanel />

      // Project inner tabs (when navigated from sidebar)
      case 'estimate':
      case 'material-takeoff':
      case 'progress':
      case 'framework':
      case 'rfi-tracker':
      case 'coordination':
        if (activeProjectId) {
          return (
            <V15rProjectInner
              projectId={activeProjectId}
              onClose={handleCloseProject}
              activeTab={activeView}
              onTabChange={setProjectTab}
            />
          )
        }
        return <V15rProjectsPanel onSelectProject={handleSelectProject} />

      // AI agent panels (lazy-loaded with Suspense)
      case 'nexus':           return <Suspense fallback={<PanelLoading />}><NexusChatPanel /></Suspense>
      case 'marketing':       return <Suspense fallback={<PanelLoading />}><MarketingPanel /></Suspense>
      case 'calendar':        return <Suspense fallback={<PanelLoading />}><SchedulePanel /></Suspense>
      case 'compliance':      return <Suspense fallback={<PanelLoading />}><CodePanel /></Suspense>
      case 'calculator':      return <Suspense fallback={<PanelLoading />}><OhmCalculator /></Suspense>
      case 'scout':           return <Suspense fallback={<PanelLoading />}><ProposalFeed /></Suspense>
      case 'voice-settings':  return <Suspense fallback={<PanelLoading />}><VoiceSettings /></Suspense>
      case 'activity':        return <Suspense fallback={<PanelLoading />}><ActivityPanel /></Suspense>
      case 'guardian':        return <Suspense fallback={<PanelLoading />}><GuardianPanel /></Suspense>
      case 'journal':         return <Suspense fallback={<PanelLoading />}><JournalPanel /></Suspense>

      default:                return <V15rHome />
    }
  }

  return (
    <V15rLayout
      activeView={activeView}
      onNav={handleNav}
      activeProjectId={activeProjectId}
      activeProjectName={activeProjectName}
    >
      <ErrorBoundary>
        {renderContent()}
      </ErrorBoundary>

      {/* Floating NEXUS voice button — bottom right on all panels */}
      <Suspense fallback={null}>
        <VoiceActivationButton />
      </Suspense>

      {/* Onboarding modal — shown for new users */}
      {showOnboarding && (
        <Suspense fallback={null}>
          <OnboardingModal onComplete={() => setShowOnboarding(false)} />
        </Suspense>
      )}
    </V15rLayout>
  )
}
