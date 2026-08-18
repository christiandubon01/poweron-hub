/**
 * PERF-1 — Dedicated Performance tab navigation proofs.
 * Source Performance calculations must remain untouched.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { execSync } from 'node:child_process'
import {
  SALES_INTEL_TABS,
  type SalesIntelTab,
} from '@/components/salesIntel/SalesIntelStore'

const REPO_ROOT = resolve(__dirname, '..', '..')

function read(rel: string): string {
  return readFileSync(resolve(REPO_ROOT, rel), 'utf8')
}

const STORE = 'src/components/salesIntel/SalesIntelStore.ts'
const TABBAR = 'src/components/salesIntel/SalesIntelTabBar.tsx'
const PANEL = 'src/components/salesIntel/SalesIntelligencePanel.tsx'
const PERF_TAB = 'src/components/salesIntel/tabs/PerformanceTab.tsx'
const COACH_TAB = 'src/components/salesIntel/tabs/CoachTab.tsx'
const PRACTICE_TAB = 'src/components/salesIntel/tabs/PracticeTab.tsx'
const LIVE_CALL_TAB = 'src/components/salesIntel/tabs/LiveCallTab.tsx'
const LEADS_TAB = 'src/components/salesIntel/tabs/LeadsTab.tsx'
const PIPELINE_TAB = 'src/components/salesIntel/tabs/PipelineTab.tsx'
const REFERRALS_TAB = 'src/components/salesIntel/tabs/ReferralsTab.tsx'

const SOURCE_PERF_CALC =
  'src/features/sales-intelligence/source-performance/sourcePerformanceCalculations.ts'
const SOURCE_PERF_PANEL =
  'src/features/sales-intelligence/source-performance/SourcePerformancePanel.tsx'
const SOURCE_PERF_INDEX =
  'src/features/sales-intelligence/source-performance/index.ts'
const SOURCE_PERF_TYPES =
  'src/features/sales-intelligence/source-performance/sourcePerformanceTypes.ts'
const SOURCE_PERF_PORTAL =
  'src/features/sales-intelligence/source-performance/sourcePerformancePortalRecovery.ts'

const DIALER = 'src/services/calls/phoneNormalize.ts'
const CALL_LOG_SERVICE = 'src/services/calls/callLogService.ts'
const CALL_LOG_MODAL = 'src/components/hunter/CallLogModal.tsx'

describe('PERF-1 Performance tab registration', () => {
  it('1. SalesIntelTab accepts performance', () => {
    const src = read(STORE)
    expect(src).toMatch(/['"]performance['"]/)
    expect(SALES_INTEL_TABS).toContain('performance' as SalesIntelTab)
  })

  it('2. tab bar contains PERFORMANCE', () => {
    const src = read(TABBAR)
    expect(src).toMatch(/id:\s*['"]performance['"]/)
    expect(src).toMatch(/label:\s*['"]PERFORMANCE['"]/)
  })

  it('3. SalesIntelligencePanel routes performance correctly', () => {
    const src = read(PANEL)
    expect(src).toMatch(/case\s+['"]performance['"]/)
    expect(src).toMatch(/PerformanceTab/)
    expect(src).toMatch(/tabs\/PerformanceTab/)
  })

  it('4. PerformanceTab renders SourcePerformancePanel', () => {
    const src = read(PERF_TAB)
    expect(src).toContain('SourcePerformancePanel')
    expect(src).toContain('source-performance')
  })

  it('5. Coach no longer imports/renders SourcePerformancePanel', () => {
    const src = read(COACH_TAB)
    expect(src).not.toContain('SourcePerformancePanel')
    expect(src).not.toContain('source-performance')
  })

  it('6. Coach remains available', () => {
    const panel = read(PANEL)
    const bar = read(TABBAR)
    expect(panel).toMatch(/case\s+['"]coach['"]/)
    expect(bar).toMatch(/id:\s*['"]coach['"]/)
    expect(read(COACH_TAB)).toMatch(/Sales coaching and call review/)
  })

  it('7. Practice remains available', () => {
    expect(read(PANEL)).toMatch(/case\s+['"]practice['"]/)
    expect(read(TABBAR)).toMatch(/id:\s*['"]practice['"]/)
    expect(() => read(PRACTICE_TAB)).not.toThrow()
  })

  it('8. Live Call remains available', () => {
    expect(read(PANEL)).toMatch(/case\s+['"]live_call['"]/)
    expect(read(TABBAR)).toMatch(/id:\s*['"]live_call['"]/)
    expect(() => read(LIVE_CALL_TAB)).not.toThrow()
  })

  it('9. Leads remains available', () => {
    expect(read(PANEL)).toMatch(/case\s+['"]leads['"]/)
    expect(read(TABBAR)).toMatch(/id:\s*['"]leads['"]/)
    expect(() => read(LEADS_TAB)).not.toThrow()
  })

  it('10. Pipeline remains available', () => {
    expect(read(PANEL)).toMatch(/case\s+['"]pipeline['"]/)
    expect(read(TABBAR)).toMatch(/id:\s*['"]pipeline['"]/)
    expect(() => read(PIPELINE_TAB)).not.toThrow()
  })

  it('11. Referrals remains available', () => {
    expect(read(PANEL)).toMatch(/case\s+['"]referrals['"]/)
    expect(read(TABBAR)).toMatch(/id:\s*['"]referrals['"]/)
    expect(() => read(REFERRALS_TAB)).not.toThrow()
  })

  it('12. existing persisted tab values remain compatible', () => {
    const src = read(STORE)
    expect(src).toContain("localStorage.getItem('si_activeTab')")
    expect(src).toContain("localStorage.setItem('si_activeTab'")
    for (const tab of [
      'practice',
      'live_call',
      'leads',
      'pipeline',
      'coach',
      'referrals',
    ] as const) {
      expect(SALES_INTEL_TABS).toContain(tab)
    }
    expect(SALES_INTEL_TABS).toContain('performance')
  })
})

describe('PERF-1 protected boundaries', () => {
  it('13. source-performance calculation files are unchanged vs HEAD', () => {
    const files = [
      SOURCE_PERF_CALC,
      SOURCE_PERF_PANEL,
      SOURCE_PERF_INDEX,
      SOURCE_PERF_TYPES,
      SOURCE_PERF_PORTAL,
    ]
    for (const file of files) {
      const status = execSync(`git status --porcelain -- "${file}"`, {
        cwd: REPO_ROOT,
        encoding: 'utf8',
      }).trim()
      expect(status, `${file} must be unchanged`).toBe('')
    }
  })

  it('14. no KPI imports added on Performance / Coach hosts', () => {
    for (const file of [PERF_TAB, COACH_TAB, PANEL, TABBAR, STORE]) {
      const text = read(file)
      expect(text).not.toMatch(/getProjectFinancials|MoneyPanel|serviceQuoteMath/)
      expect(text).not.toMatch(/from\s+['"]@\/.*kpi/i)
    }
  })

  it('15. no QuickBooks imports added', () => {
    for (const file of [PERF_TAB, COACH_TAB, PANEL, TABBAR, STORE]) {
      expect(read(file).toLowerCase()).not.toContain('quickbooks')
    }
  })

  it('16. dialer code unchanged vs HEAD', () => {
    const status = execSync(`git status --porcelain -- "${DIALER}"`, {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    }).trim()
    expect(status).toBe('')
    expect(read(DIALER)).toContain('openTelDialer')
  })

  it('17. call-log code unchanged vs HEAD', () => {
    for (const file of [CALL_LOG_SERVICE, CALL_LOG_MODAL]) {
      const status = execSync(`git status --porcelain -- "${file}"`, {
        cwd: REPO_ROOT,
        encoding: 'utf8',
      }).trim()
      expect(status, `${file} must be unchanged`).toBe('')
    }
  })
})
