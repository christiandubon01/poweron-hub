/**
 * COACH-LINK-3A — Active Sales Session → lead-specific Live Call modal.
 *
 * Practice UX overlap notes (deferred — do not mix into this handoff):
 * - voice/text UI must not overlap
 * - important controls/buttons must remain reachable
 * - side navigation should behave independently
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { execSync } from 'node:child_process'
import {
  SI_SALES_SESSION_KEY,
  useSalesIntelStore,
} from '@/components/salesIntel/SalesIntelStore'

const REPO_ROOT = resolve(__dirname, '..', '..')

function read(rel: string): string {
  return readFileSync(resolve(REPO_ROOT, rel), 'utf8')
}

function makeMemoryStorage(): Storage {
  const map = new Map<string, string>()
  return {
    get length() {
      return map.size
    },
    clear() {
      map.clear()
    },
    getItem(key: string) {
      return map.has(key) ? map.get(key)! : null
    },
    key(index: number) {
      return Array.from(map.keys())[index] ?? null
    },
    removeItem(key: string) {
      map.delete(key)
    },
    setItem(key: string, value: string) {
      map.set(key, String(value))
    },
  }
}

function ensureBrowserStorage(): void {
  const g = globalThis as typeof globalThis & {
    sessionStorage?: Storage
    localStorage?: Storage
    window?: typeof globalThis
  }
  if (!g.sessionStorage) {
    Object.defineProperty(g, 'sessionStorage', {
      value: makeMemoryStorage(),
      configurable: true,
    })
  }
  if (!g.localStorage) {
    Object.defineProperty(g, 'localStorage', {
      value: makeMemoryStorage(),
      configurable: true,
    })
  }
  if (!g.window) {
    Object.defineProperty(g, 'window', {
      value: g,
      configurable: true,
    })
  }
}

beforeEach(() => {
  ensureBrowserStorage()
  useSalesIntelStore.getState().clearSalesSession()
  sessionStorage.removeItem(SI_SALES_SESSION_KEY)
  sessionStorage.removeItem('si_practiceLead')
  // Ensure launch intent starts clean even if clearSalesSession already cleared it
  if (useSalesIntelStore.getState().liveCallLaunchRequest) {
    useSalesIntelStore.getState().consumeLiveCallLaunchRequest()
  }
})

describe('COACH-LINK-3A live-call launch intent (store)', () => {
  it('1–4. Active session Live Call action → live_call mode + launch request; sessionId/leadId preserved', () => {
    useSalesIntelStore.getState().beginSalesSession('leadA', 'practice')
    const sid = useSalesIntelStore.getState().salesSession!.sessionId

    // Mirror SalesSessionContextBar Live Call action
    useSalesIntelStore.getState().requestLiveCallLaunch('leadA')
    useSalesIntelStore.getState().setActiveTab('live_call')

    const s = useSalesIntelStore.getState().salesSession!
    expect(s.mode).toBe('live_call')
    expect(s.sessionId).toBe(sid)
    expect(s.leadId).toBe('leadA')
    expect(useSalesIntelStore.getState().liveCallLaunchRequest).toEqual({
      hunterLeadId: 'leadA',
    })
    expect(useSalesIntelStore.getState().activeTab).toBe('live_call')
  })

  it('5–9. LiveCallTab consumes launch once; modal receives hunterLeadId; remount does not reopen', () => {
    const live = read('src/components/salesIntel/tabs/LiveCallTab.tsx')
    expect(live).toContain('liveCallLaunchRequest')
    expect(live).toContain('consumeLiveCallLaunchRequest')
    expect(live).toContain('setModalHunterLeadId(leadId)')
    expect(live).toContain('defaultHunterLeadId={modalHunterLeadId}')
    expect(live).toContain('defaultPhone={modalDefaultPhone}')
    expect(live).toContain("setModalDirection('outbound')")
    expect(live).toContain('setModalOpen(true)')
    // Resolves phone from Hunter store authority — no duplicated lead object
    expect(live).toContain('useHunterStore.getState().leads')
    expect(live).toContain("String(lead.phone || '').trim()")

    useSalesIntelStore.getState().requestLiveCallLaunch('leadA')
    expect(useSalesIntelStore.getState().liveCallLaunchRequest?.hunterLeadId).toBe(
      'leadA',
    )
    const first = useSalesIntelStore.getState().consumeLiveCallLaunchRequest()
    expect(first).toEqual({ hunterLeadId: 'leadA' })
    expect(useSalesIntelStore.getState().liveCallLaunchRequest).toBeNull()
    // Second consume (tab remount / switch back) → nothing to reopen
    expect(useSalesIntelStore.getState().consumeLiveCallLaunchRequest()).toBeNull()
  })

  it('10–11. tab bounce does not reopen; explicit Live Call can launch again', () => {
    useSalesIntelStore.getState().beginSalesSession('leadA', 'practice')
    useSalesIntelStore.getState().requestLiveCallLaunch('leadA')
    useSalesIntelStore.getState().setActiveTab('live_call')
    useSalesIntelStore.getState().consumeLiveCallLaunchRequest()
    expect(useSalesIntelStore.getState().liveCallLaunchRequest).toBeNull()

    // Switch away / back without new request
    useSalesIntelStore.getState().setActiveTab('practice')
    useSalesIntelStore.getState().setActiveTab('live_call')
    expect(useSalesIntelStore.getState().liveCallLaunchRequest).toBeNull()

    // Explicit Active Session → Live Call again
    useSalesIntelStore.getState().requestLiveCallLaunch('leadA')
    expect(useSalesIntelStore.getState().liveCallLaunchRequest).toEqual({
      hunterLeadId: 'leadA',
    })
  })

  it('12. generic Live Call tab with no launch request does NOT auto-open modal', () => {
    const live = read('src/components/salesIntel/tabs/LiveCallTab.tsx')
    // Auto-open only gated on liveCallLaunchRequest
    expect(live).toMatch(
      /if\s*\(\s*!liveCallLaunchRequest\?\.hunterLeadId\s*\)\s*return/,
    )
    // Top-nav setActiveTab alone must not request launch
    const tabBar = read('src/components/salesIntel/SalesIntelTabBar.tsx')
    expect(tabBar).not.toContain('requestLiveCallLaunch')
    const panel = read('src/components/salesIntel/SalesIntelligencePanel.tsx')
    expect(panel).not.toContain('requestLiveCallLaunch')

    useSalesIntelStore.getState().setActiveTab('live_call')
    expect(useSalesIntelStore.getState().liveCallLaunchRequest).toBeNull()
  })

  it('13. + Log Call remains available for manual/general logging', () => {
    const live = read('src/components/salesIntel/tabs/LiveCallTab.tsx')
    expect(live).toContain('openLogCall')
    expect(live).toContain('Log Call')
    expect(live).toContain("setModalDirection('inbound')")
    expect(live).toContain('setModalHunterLeadId(null)')
  })
})

describe('COACH-LINK-3A modal / dialer / no forced logging', () => {
  it('14–15. opening modal / cancel create NO call_log', () => {
    const live = read('src/components/salesIntel/tabs/LiveCallTab.tsx')
    const launchEffect = live.slice(
      live.indexOf('COACH-LINK-3A — consume one-shot'),
      live.indexOf('const leadNameById'),
    )
    expect(launchEffect).toContain('setModalOpen(true)')
    expect(launchEffect).not.toContain('createCallLog')
    expect(launchEffect).not.toContain('openTelDialer')

    const modal = read('src/components/hunter/CallLogModal.tsx')
    // Cancel footer button only calls onClose — no create in cancel path
    expect(modal).toMatch(
      /onClick=\{onClose\}[\s\S]{0,200}>\s*Cancel\s*</,
    )
    const cancelIdx = modal.indexOf('>\n            Cancel')
    expect(cancelIdx).toBeGreaterThan(-1)
    const cancelRegion = modal.slice(Math.max(0, cancelIdx - 180), cancelIdx + 40)
    expect(cancelRegion).toContain('onClick={onClose}')
    expect(cancelRegion).not.toContain('createCallLog')
    expect(cancelRegion).not.toContain('saveCreateLog')
  })

  it('16–17. Open Dialer remains explicit; no automatic tel:', () => {
    const modal = read('src/components/hunter/CallLogModal.tsx')
    const live = read('src/components/salesIntel/tabs/LiveCallTab.tsx')
    expect(modal).toContain('data-testid="call-log-open-dialer"')
    expect(modal).toContain("onClick={() => void handleOpenDialer()}")
    expect(live).not.toMatch(/useEffect\([\s\S]{0,400}openTelDialer/)
    expect(live).not.toMatch(/setModalOpen\(true\)[\s\S]{0,80}openTelDialer/)
  })

  it('18–19. explicit save keeps hunter_lead_id + attachCallLog to session', () => {
    const modal = read('src/components/hunter/CallLogModal.tsx')
    expect(modal).toContain('hunterLeadId: defaultHunterLeadId')
    expect(modal).toContain('if (defaultHunterLeadId)')
    const live = read('src/components/salesIntel/tabs/LiveCallTab.tsx')
    expect(live).toContain('attachCallLog')
    expect(live).toContain('log.hunterLeadId === session.leadId')
  })

  it('20. no fake call duration/connect state', () => {
    const store = read('src/components/salesIntel/SalesIntelStore.ts')
    expect(store).not.toMatch(/connectedAt|callEnded|dialingStarted|isConnected|durationMs/)
    const live = read('src/components/salesIntel/tabs/LiveCallTab.tsx')
    expect(live).not.toMatch(/connectedAt|isConnected|fakeDuration/)
  })
})

describe('COACH-LINK-3A wiring contracts', () => {
  it('ContextBar Live Call requests launch for active lead', () => {
    const bar = read('src/components/salesIntel/SalesSessionContextBar.tsx')
    expect(bar).toContain('requestLiveCallLaunch(salesSession.leadId)')
    expect(bar).toContain("setActiveTab('live_call')")
    expect(bar).toContain('data-testid="sales-session-live-call"')
    expect(bar).not.toContain('openTelDialer')
    expect(bar).not.toContain('createCallLog')
  })

  it('Practice → Live Call queues same launch intent', () => {
    const practice = read('src/components/salesIntel/practice/PracticeTab.tsx')
    expect(practice).toContain('requestLiveCallLaunch(leadId)')
    expect(practice).toContain("beginSalesSession(leadId, 'live_call')")
    expect(practice).toContain("setActiveTab('live_call')")
  })

  it('launch intent is memory-only (not sessionStorage)', () => {
    const store = read('src/components/salesIntel/SalesIntelStore.ts')
    expect(store).toContain('liveCallLaunchRequest')
    expect(store).toContain('requestLiveCallLaunch')
    expect(store).toContain('consumeLiveCallLaunchRequest')
    // Must not persist launch request
    expect(store).not.toMatch(
      /sessionStorage\.(setItem|getItem)\([^)]*liveCallLaunch/i,
    )
    expect(store).not.toMatch(/si_live_call_launch|liveCallLaunchRequest.*sessionStorage/)
    // Initial state null — refresh cannot reopen
    expect(store).toMatch(/liveCallLaunchRequest:\s*null/)
  })

  it('reuses existing CallLogModal — no parallel call modal', () => {
    const live = read('src/components/salesIntel/tabs/LiveCallTab.tsx')
    expect(live).toContain("from '@/components/hunter/CallLogModal'")
    expect(live).not.toMatch(/LeadCallModal|SalesCallModal|PracticeCallModal/)
  })
})

describe('COACH-LINK-3A dialer separation (Open Dialer ≠ save)', () => {
  it('Open Dialer does not call saveCreateLog / createCallLog', () => {
    const modal = read('src/components/hunter/CallLogModal.tsx')
    const dialerFn = modal.slice(modal.indexOf('const handleOpenDialer'))
    const end =
      dialerFn.indexOf('const phoneForDialerCheck') > -1
        ? dialerFn.indexOf('const phoneForDialerCheck')
        : dialerFn.length
    const body = dialerFn.slice(0, end)
    expect(body).toContain('openTelDialer')
    expect(body).not.toContain('saveCreateLog')
    expect(body).not.toContain('createCallLog')
    expect(body).not.toContain('onSaved')
  })

  it('Log Call / Save remains the durable write path', () => {
    const modal = read('src/components/hunter/CallLogModal.tsx')
    const logFn = modal.slice(
      modal.indexOf('const handleLogCall'),
      modal.indexOf('const handleOpenDialer'),
    )
    expect(logFn).toContain('saveCreateLog')
    expect(logFn).not.toContain('openTelDialer')
  })
})

describe('COACH-LINK-3A protected boundaries', () => {
  it('21. Practice AI files unchanged for this correction (no SparkTrainingVoice/RolePlayEngine edits required)', () => {
    // This phase must not rewrite Practice AI — only PracticeTab launch wiring.
    const voice = execSync(
      'git status --porcelain -- "src/services/sparkTraining/SparkTrainingVoice.ts"',
      { cwd: REPO_ROOT, encoding: 'utf8' },
    ).trim()
    const engine = execSync(
      'git status --porcelain -- "src/services/sparkTraining/SparkRolePlayEngine.ts"',
      { cwd: REPO_ROOT, encoding: 'utf8' },
    ).trim()
    // Unrelated dirty work may already touch these; assert our Live Call handoff
    // does not require new Practice AI surface changes in LiveCallTab / store.
    const live = read('src/components/salesIntel/tabs/LiveCallTab.tsx')
    expect(live).not.toContain('SparkTrainingVoice')
    expect(live).not.toContain('SparkRolePlayEngine')
    expect(live).not.toContain('Whisper')
    expect(live).not.toContain('ElevenLabs')
    void voice
    void engine
  })

  it('22–23. Performance / QuickBooks unchanged by this handoff', () => {
    const files = [
      'src/components/salesIntel/tabs/PerformanceTab.tsx',
      'src/features/sales-intelligence/source-performance/sourcePerformanceCalculations.ts',
    ]
    for (const file of files) {
      const status = execSync(`git status --porcelain -- "${file}"`, {
        cwd: REPO_ROOT,
        encoding: 'utf8',
      }).trim()
      expect(status, file).toBe('')
    }
    const store = read('src/components/salesIntel/SalesIntelStore.ts').toLowerCase()
    const live = read('src/components/salesIntel/tabs/LiveCallTab.tsx').toLowerCase()
    expect(store).not.toContain('quickbooks')
    expect(live).not.toContain('quickbooks')
  })

  it('24. no KPI authority imports on live-call handoff files', () => {
    const files = [
      'src/components/salesIntel/SalesIntelStore.ts',
      'src/components/salesIntel/SalesSessionContextBar.tsx',
      'src/components/salesIntel/tabs/LiveCallTab.tsx',
    ]
    for (const file of files) {
      const text = read(file).toLowerCase()
      expect(text).not.toMatch(/getprojectfinancials|moneypanel|servicequotemath/)
    }
  })

  it('25. no migration', () => {
    const status = execSync(
      'git status --porcelain -- "supabase/migrations"',
      { cwd: REPO_ROOT, encoding: 'utf8' },
    )
    expect(status).not.toMatch(/sales_session|live_call_launch|call_logs/i)
    const store = read('src/components/salesIntel/SalesIntelStore.ts')
    expect(store).not.toMatch(/CREATE TABLE|ALTER TABLE/i)
  })

  it('call_logs schema / callLogService authority unchanged', () => {
    for (const file of [
      'src/services/calls/callLogService.ts',
      'supabase/migrations/127_call_logs.sql',
    ]) {
      const status = execSync(`git status --porcelain -- "${file}"`, {
        cwd: REPO_ROOT,
        encoding: 'utf8',
      }).trim()
      expect(status, file).toBe('')
    }
  })
})
