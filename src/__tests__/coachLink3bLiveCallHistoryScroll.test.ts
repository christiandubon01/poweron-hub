/**
 * COACH-LINK-3B — Live Call history shows ~10 rows, then internal scroll.
 * UI viewport only — does not truncate fetch / call_logs authority.
 */

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { execSync } from 'node:child_process'
import {
  CALL_HISTORY_EMBEDDED_MAX_H_CLASS,
  CALL_HISTORY_VISIBLE_ROWS,
} from '@/components/hunter/RecentCallsPanel'

const REPO_ROOT = resolve(__dirname, '..', '..')

function read(rel: string): string {
  return readFileSync(resolve(REPO_ROOT, rel), 'utf8')
}

describe('COACH-LINK-3B Live Call history 10-row scroll', () => {
  const recent = () => read('src/components/hunter/RecentCallsPanel.tsx')
  const live = () => read('src/components/salesIntel/tabs/LiveCallTab.tsx')

  it('1. 0 calls renders safely (empty state path intact)', () => {
    const src = live()
    expect(src).toContain('live-call-empty-state')
    expect(src).toContain('No calls logged yet.')
    expect(src).toContain('!loading && !hasCalls')
  })

  it('2–4. 1–10 / exactly-10 / 11+ — all fetched rows mapped; no slice/truncate', () => {
    const src = recent()
    expect(src).toContain('calls.map((c)')
    expect(src).not.toMatch(/calls\.slice\s*\(\s*0\s*,\s*10\s*\)/)
    expect(src).not.toMatch(/\.slice\s*\(\s*0\s*,\s*CALL_HISTORY/)
    expect(src).not.toMatch(/calls\.filter[\s\S]{0,40}length/)
    expect(CALL_HISTORY_VISIBLE_ROWS).toBe(10)
    expect(src).toContain('CALL_HISTORY_VISIBLE_ROWS')
    expect(src).toContain('data-testid="call-history-row"')
  })

  it('5. history list gets internal vertical scrolling after max visible height', () => {
    const src = recent()
    expect(src).toContain(CALL_HISTORY_EMBEDDED_MAX_H_CLASS)
    expect(src).toContain('overflow-y-auto')
    expect(src).toContain('call-history-scroll-body')
    expect(src).toMatch(/embedded\s*\?\s*CALL_HISTORY_EMBEDDED_MAX_H_CLASS/)
    // ~10-row calc present
    expect(CALL_HISTORY_EMBEDDED_MAX_H_CLASS).toContain('calc(10*')
    expect(CALL_HISTORY_EMBEDDED_MAX_H_CLASS).toContain('70vh')
  })

  it('6. Call History header is outside/above the scrolling body', () => {
    const src = live()
    const headerIdx = src.indexOf('data-testid="live-call-history-header"')
    const panelIdx = src.indexOf('<RecentCallsPanel')
    expect(headerIdx).toBeGreaterThan(-1)
    expect(panelIdx).toBeGreaterThan(headerIdx)
    expect(src).toContain('Call History')
    // Scroll lives in RecentCallsPanel list, not wrapping the header
    const historyBlock = src.slice(
      src.indexOf('data-testid="live-call-history"'),
      src.indexOf('<CallLogModal'),
    )
    expect(historyBlock).toContain('live-call-history-header')
    expect(historyBlock).toContain('RecentCallsPanel')
    expect(historyBlock).not.toMatch(
      /live-call-history-header[\s\S]*overflow-y-auto[\s\S]*Call History/,
    )
  })

  it('7. newest-first / current ordering unchanged', () => {
    const svc = read('src/services/calls/callLogService.ts')
    const fetchFn = svc.slice(svc.indexOf('export async function fetchRecentCallLogs'))
    expect(fetchFn).toContain(".order('occurred_at', { ascending: false })")
    // LiveCallTab does not re-sort
    expect(live()).not.toMatch(/calls\.sort\(|\.sort\(/)
  })

  it('8. no call-log query authority changed (still fetchRecentCallLogs(40))', () => {
    expect(live()).toContain('fetchRecentCallLogs(40)')
    expect(live()).not.toContain('fetchRecentCallLogs(10)')
    const status = execSync(
      'git status --porcelain -- "src/services/calls/callLogService.ts"',
      { cwd: REPO_ROOT, encoding: 'utf8' },
    ).trim()
    expect(status).toBe('')
  })

  it('9. no call rows deleted/truncated in UI map', () => {
    const src = recent()
    expect(src).toContain('{calls.map((c) => {')
    expect(src).not.toContain('calls.slice')
    expect(src).not.toMatch(/MAX_ROWS|visibleCalls|displayCalls/)
  })

  it('10. generic Log Call still works', () => {
    const src = live()
    expect(src).toContain('openLogCall')
    expect(src).toContain('Log Call')
    expect(src).toContain("setModalDirection('inbound')")
  })

  it('11. lead-specific modal launch still works (COACH-LINK-3A intact)', () => {
    const src = live()
    expect(src).toContain('liveCallLaunchRequest')
    expect(src).toContain('consumeLiveCallLaunchRequest')
    expect(src).toContain('defaultHunterLeadId={modalHunterLeadId}')
    // Context bar still launches
    const bar = read('src/components/salesIntel/SalesSessionContextBar.tsx')
    expect(bar).toContain('requestLiveCallLaunch(salesSession.leadId)')
  })

  it('12. optional dialer behavior unchanged', () => {
    const modal = read('src/components/hunter/CallLogModal.tsx')
    expect(modal).toContain('handleOpenDialer')
    expect(modal).toContain('openTelDialer')
    expect(modal).toContain('data-testid="call-log-open-dialer"')
    const recentSrc = recent()
    expect(recentSrc).toContain('onOpenDialer')
    expect(recentSrc).toContain('data-testid="call-history-open-dialer"')
    expect(live()).toContain('onOpenDialer={handleHistoryOpenDialer}')
  })

  it('13. no migration', () => {
    const status = execSync(
      'git status --porcelain -- "supabase/migrations"',
      { cwd: REPO_ROOT, encoding: 'utf8' },
    )
    expect(status).not.toMatch(/call_logs|call_history/i)
  })

  it('14. no QuickBooks/KPI changes', () => {
    for (const file of [
      'src/components/hunter/RecentCallsPanel.tsx',
      'src/components/salesIntel/tabs/LiveCallTab.tsx',
    ]) {
      const text = read(file).toLowerCase()
      expect(text).not.toContain('quickbooks')
      expect(text).not.toMatch(/getprojectfinancials|moneypanel|servicequotemath/)
    }
  })
})
