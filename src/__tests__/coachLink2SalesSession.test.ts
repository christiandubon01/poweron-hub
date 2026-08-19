/**
 * COACH-LINK-2 — Shared Sales Session context proofs.
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

/** Minimal Storage polyfill for node vitest runs. */
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
})

describe('COACH-LINK-2 sales session store', () => {
  it('1. sales session initially null', () => {
    expect(useSalesIntelStore.getState().salesSession).toBeNull()
  })

  it('2. beginSalesSession(leadA, practice) creates session', () => {
    useSalesIntelStore.getState().beginSalesSession('leadA', 'practice')
    const s = useSalesIntelStore.getState().salesSession
    expect(s).not.toBeNull()
    expect(s!.leadId).toBe('leadA')
    expect(s!.mode).toBe('practice')
    expect(s!.sessionId).toBeTruthy()
    expect(s!.callLogId).toBeNull()
    expect(s!.startedAt).toBeTruthy()
  })

  it('3. changing activeTab does not destroy session', () => {
    useSalesIntelStore.getState().beginSalesSession('leadA', 'practice')
    const id = useSalesIntelStore.getState().salesSession!.sessionId
    useSalesIntelStore.getState().setActiveTab('leads')
    expect(useSalesIntelStore.getState().salesSession?.sessionId).toBe(id)
    expect(useSalesIntelStore.getState().salesSession?.leadId).toBe('leadA')
  })

  it('4. Practice → Live Call mode change preserves sessionId + leadId', () => {
    useSalesIntelStore.getState().beginSalesSession('leadA', 'practice')
    const id = useSalesIntelStore.getState().salesSession!.sessionId
    useSalesIntelStore.getState().setActiveTab('live_call')
    const s = useSalesIntelStore.getState().salesSession!
    expect(s.sessionId).toBe(id)
    expect(s.leadId).toBe('leadA')
    expect(s.mode).toBe('live_call')
  })

  it('5. Live Call → Coach preserves same lead', () => {
    useSalesIntelStore.getState().beginSalesSession('leadA', 'live_call')
    useSalesIntelStore.getState().setActiveTab('coach')
    expect(useSalesIntelStore.getState().salesSession?.leadId).toBe('leadA')
    expect(useSalesIntelStore.getState().salesSession?.mode).toBe('coach')
  })

  it('6. begin with different leadB replaces session', () => {
    useSalesIntelStore.getState().beginSalesSession('leadA', 'practice')
    const firstId = useSalesIntelStore.getState().salesSession!.sessionId
    useSalesIntelStore.getState().beginSalesSession('leadB', 'live_call')
    const s = useSalesIntelStore.getState().salesSession!
    expect(s.leadId).toBe('leadB')
    expect(s.sessionId).not.toBe(firstId)
    expect(s.mode).toBe('live_call')
    expect(s.callLogId).toBeNull()
  })

  it('7. clearSalesSession removes only transient session', () => {
    useSalesIntelStore.getState().beginSalesSession('leadA', 'practice')
    useSalesIntelStore.getState().clearSalesSession()
    expect(useSalesIntelStore.getState().salesSession).toBeNull()
    expect(sessionStorage.getItem(SI_SALES_SESSION_KEY)).toBeNull()
  })

  it('8. navigateToLeadPractice establishes shared context', () => {
    useSalesIntelStore.getState().navigateToLeadPractice('leadA')
    const s = useSalesIntelStore.getState().salesSession!
    expect(s.leadId).toBe('leadA')
    expect(s.mode).toBe('practice')
    expect(useSalesIntelStore.getState().activeTab).toBe('practice')
  })

  it('9. legacy si_practiceLead compatibility still works', () => {
    useSalesIntelStore.getState().navigateToLeadPractice('leadA')
    expect(sessionStorage.getItem('si_practiceLead')).toBe('leadA')
  })

  it('22. changing mode does not clear callLogId', () => {
    useSalesIntelStore.getState().beginSalesSession('leadA', 'live_call')
    useSalesIntelStore.getState().attachCallLog('call-1')
    useSalesIntelStore.getState().setSalesSessionMode('coach')
    expect(useSalesIntelStore.getState().salesSession?.callLogId).toBe('call-1')
    useSalesIntelStore.getState().setActiveTab('practice')
    expect(useSalesIntelStore.getState().salesSession?.callLogId).toBe('call-1')
    expect(useSalesIntelStore.getState().salesSession?.mode).toBe('practice')
  })

  it('23. session persistence is sessionStorage only (not database)', () => {
    useSalesIntelStore.getState().beginSalesSession('leadA', 'practice')
    const raw = sessionStorage.getItem(SI_SALES_SESSION_KEY)
    expect(raw).toBeTruthy()
    expect(JSON.parse(raw!).leadId).toBe('leadA')
    const storeSrc = read('src/components/salesIntel/SalesIntelStore.ts')
    expect(storeSrc).toContain("sessionStorage.setItem(SI_SALES_SESSION_KEY")
    expect(storeSrc).not.toMatch(/\.from\(['"]sales_sessions['"]\)/)
    expect(storeSrc).not.toMatch(/CREATE TABLE/i)
  })

  it('same lead begin reuses sessionId', () => {
    useSalesIntelStore.getState().beginSalesSession('leadA', 'practice')
    const id = useSalesIntelStore.getState().salesSession!.sessionId
    useSalesIntelStore.getState().beginSalesSession('leadA', 'live_call')
    expect(useSalesIntelStore.getState().salesSession!.sessionId).toBe(id)
    expect(useSalesIntelStore.getState().salesSession!.mode).toBe('live_call')
  })
})

describe('COACH-LINK-2 Hunter Call / dialer / UI wiring', () => {
  it('10–11. Hunter CALL establishes live_call context and keeps CallLogModal', () => {
    const panel = read('src/components/hunter/HunterPanel.tsx')
    expect(panel).toMatch(/beginSalesSession\([\s\S]*['"]live_call['"]\)/)
    expect(panel).toContain('CallLogModal')
    expect(panel).toContain('showOptionalDialer')
    expect(panel).toContain('setCallModalOpen(true)')
  })

  it('12. Open Dialer remains optional', () => {
    const modal = read('src/components/hunter/CallLogModal.tsx')
    expect(modal).toMatch(/never automatic|Optional Open Dialer|showOptionalDialer/)
    expect(modal).toContain('handleOpenDialer')
  })

  it('13. openTelDialer source unchanged vs HEAD', () => {
    const status = execSync(
      'git status --porcelain -- "src/services/calls/phoneNormalize.ts"',
      { cwd: REPO_ROOT, encoding: 'utf8' },
    ).trim()
    expect(status).toBe('')
  })

  it('14. no fake connect/end state introduced', () => {
    const store = read('src/components/salesIntel/SalesIntelStore.ts')
    expect(store).not.toMatch(/connectedAt|callEnded|dialingStarted|isConnected/)
    const bar = read('src/components/salesIntel/SalesSessionContextBar.tsx')
    expect(bar).not.toMatch(/connected|call ended|duration/i)
  })

  it('15. ContextBar resolves current lead from Hunter authority', () => {
    const bar = read('src/components/salesIntel/SalesSessionContextBar.tsx')
    expect(bar).toContain('useHunterStore')
    expect(bar).toContain('salesSession.leadId')
    expect(bar).not.toMatch(/salesSession\.lead\b|fullLead|hunterLeadObject/)
  })

  it('16. Practice displays active lead context', () => {
    expect(read('src/components/salesIntel/tabs/PracticeTab.tsx')).toContain(
      'SalesSessionContextBar',
    )
  })

  it('17. Live Call displays active lead context', () => {
    expect(read('src/components/salesIntel/tabs/LiveCallTab.tsx')).toContain(
      'SalesSessionContextBar',
    )
  })

  it('18. Coach displays active lead context', () => {
    expect(read('src/components/salesIntel/tabs/CoachTab.tsx')).toContain(
      'SalesSessionContextBar',
    )
  })

  it('19. Coach with no active session shows neutral empty state', () => {
    const coach = read('src/components/salesIntel/tabs/CoachTab.tsx')
    expect(coach).toContain('coach-no-session')
    expect(coach).toMatch(/No active sales session/)
  })

  it('20. Practice with no lead still works as general Practice', () => {
    const host = read('src/components/salesIntel/tabs/PracticeTab.tsx')
    expect(host).toContain('PracticeTabImpl')
    expect(host).not.toMatch(/if\s*\(\s*!salesSession/)
    expect(read('src/components/salesIntel/practice/PracticeTab.tsx')).toContain(
      'BEGIN PRACTICE',
    )
  })

  it('21. Live Call with no lead still works as call-log workspace', () => {
    const live = read('src/components/salesIntel/tabs/LiveCallTab.tsx')
    expect(live).toContain('Log Call')
    expect(live).toContain('fetchRecentCallLogs')
    expect(live).not.toMatch(/if\s*\(\s*!salesSession[\s\S]*return null/)
  })
})

describe('COACH-LINK-2 protected boundaries', () => {
  it('24–25. Performance tab / source-performance unchanged vs HEAD', () => {
    const files = [
      'src/components/salesIntel/tabs/PerformanceTab.tsx',
      'src/features/sales-intelligence/source-performance/sourcePerformanceCalculations.ts',
      'src/features/sales-intelligence/source-performance/SourcePerformancePanel.tsx',
      'src/features/sales-intelligence/source-performance/index.ts',
    ]
    for (const file of files) {
      const status = execSync(`git status --porcelain -- "${file}"`, {
        cwd: REPO_ROOT,
        encoding: 'utf8',
      }).trim()
      expect(status, file).toBe('')
    }
  })

  it('26–27. no QuickBooks / KPI imports on new SI session files', () => {
    const files = [
      'src/components/salesIntel/SalesIntelStore.ts',
      'src/components/salesIntel/SalesSessionContextBar.tsx',
      'src/components/salesIntel/tabs/CoachTab.tsx',
      'src/components/salesIntel/tabs/PracticeTab.tsx',
      'src/components/salesIntel/tabs/LiveCallTab.tsx',
    ]
    for (const file of files) {
      const text = read(file).toLowerCase()
      expect(text).not.toContain('quickbooks')
      expect(text).not.toMatch(/getprojectfinancials|moneypanel|servicequotemath/)
    }
  })

  it('28. no migration', () => {
    const status = execSync(
      'git status --porcelain -- "supabase/migrations"',
      { cwd: REPO_ROOT, encoding: 'utf8' },
    )
    // Unrelated dirty migrations may exist; this phase must not add sales_session SQL.
    expect(status).not.toMatch(/sales_session/i)
    const store = read('src/components/salesIntel/SalesIntelStore.ts')
    expect(store).not.toMatch(/CREATE TABLE|ALTER TABLE/i)
  })

  it('call_logs / dialer service untouched vs HEAD; CallLogModal dialer narrow-split allowed', () => {
    const files = [
      'src/services/calls/callLogService.ts',
      'src/services/calls/phoneNormalize.ts',
    ]
    for (const file of files) {
      const status = execSync(`git status --porcelain -- "${file}"`, {
        cwd: REPO_ROOT,
        encoding: 'utf8',
      }).trim()
      expect(status, file).toBe('')
    }
    // CallLogModal may receive COACH-LINK-3A dialer≠save separation; keep optional dialer
    const modal = read('src/components/hunter/CallLogModal.tsx')
    expect(modal).toContain('showOptionalDialer')
    expect(modal).toContain('handleOpenDialer')
    expect(modal).toContain('openTelDialer')
  })

  it('callLogId linkage uses existing onSaved callback only', () => {
    const panel = read('src/components/hunter/HunterPanel.tsx')
    const live = read('src/components/salesIntel/tabs/LiveCallTab.tsx')
    expect(panel).toContain('attachCallLog')
    expect(live).toContain('attachCallLog')
    // CallLogModal contract — still optional dialer, onSaved(log)
    const modal = read('src/components/hunter/CallLogModal.tsx')
    expect(modal).toContain('onSaved')
    expect(modal).toContain('showOptionalDialer')
  })
})
