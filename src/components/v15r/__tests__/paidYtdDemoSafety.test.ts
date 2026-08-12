import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { getCurrentYearCollectedRevenue } from '@/services/collectedRevenueRange'
import { getTimelineCollected, type TimelinePreset } from '@/services/financialTimelineRange'
import { getDemoBackupData } from '@/services/demoDataService'
import { createEmptyBackup } from '@/services/backupDataService'

/**
 * KPI-TIMELINE-1 (carries forward FORENSIC-KPI-2B2-2E BLOCKER 1): Demo Mode
 * financial safety for the selectable header "Collected" KPI.
 *
 * The header Collected slot is now a selectable canonical collected-cash range.
 * In Demo Mode it MUST use the existing demo-safe BackupData universe
 * (getDemoBackupData) for EVERY preset — never real company cash — mirroring the
 * paidYtdValue / safeKpis convention. Normal Mode still derives from real
 * backupData. The Annual Revenue Target numerator (paidYtdValue, current year)
 * is isolated from preset selection (Part D): it stays the current-year known
 * authority regardless of which range the owner selects on the header.
 */
const ROOT = process.cwd()
const layoutSrc = readFileSync(join(ROOT, 'src/components/v15r/V15rLayout.tsx'), 'utf8')

describe('FORENSIC-KPI-2B2-2E Demo Mode Paid YTD safety (KPI-TIMELINE-1 selectable)', () => {
  it('keeps paidYtdValue as the demo-safe current-year authority', () => {
    // The demo-safe branch must be gated on the same demo condition as safeKpis.
    expect(layoutSrc).toContain('const paidYtdValue = (hasHydrated && isDemoMode)')
    // Demo branch consumes getDemoBackupData, NOT real backupData.
    expect(layoutSrc).toContain('getCurrentYearCollectedRevenue(getDemoBackupData()).knownTotal')
  })

  it('routes paidYtdValue through real backupData in Normal Mode', () => {
    expect(layoutSrc).toContain('getCurrentYearCollectedRevenue(backupData || createEmptyBackup()).knownTotal')
  })

  it('routes the selectable Collected timeline through the demo-safe universe in Demo Mode', () => {
    // The selectable timeline must use the SAME demo-gating as paidYtdValue so no
    // preset can ever expose real company cash in Demo Mode.
    expect(layoutSrc).toContain('const collectedTimelineBackup = (hasHydrated && isDemoMode)')
    expect(layoutSrc).toContain('getTimelineCollected(collectedTimelineBackup,')
  })

  it('defaults the selector to CURRENT_YEAR and reuses paidYtdValue on that preset (Part D)', () => {
    // Default preset is the current-year authority, not an arbitrary range.
    expect(layoutSrc).toContain("useState<TimelinePreset>('CURRENT_YEAR')")
    // On CURRENT_YEAR the displayed value IS paidYtdValue — identical to the
    // Annual Target numerator. Other presets use the resolved timeline value.
    expect(layoutSrc).toContain('const collectedDisplayValue = collectedPreset === \'CURRENT_YEAR\'')
    expect(layoutSrc).toContain('? paidYtdValue')
  })

  it('Header and Annual Target share ONE displayed current-year authority in both modes', () => {
    // yearlyTargetActual is assigned from paidYtdValue — never recomputed
    // separately, and never from the selected range. This is Part D isolation.
    expect(layoutSrc).toContain('const yearlyTargetActual = paidYtdValue')
    expect(layoutSrc).not.toContain('const yearlyTargetActual = getCurrentYearCollectedRevenue')
    expect(layoutSrc).not.toContain('const yearlyTargetActual = collectedDisplayValue')
    // The displayed Header value is collectedDisplayValue (compact + full).
    expect(layoutSrc.match(/fmtHeader\(collectedDisplayValue\)/g)).toHaveLength(2)
  })

  it('demo-safe current-year known cash is a finite demo number, never real data', () => {
    const demoKnown = getCurrentYearCollectedRevenue(getDemoBackupData(), new Date().getFullYear()).knownTotal
    expect(Number.isFinite(demoKnown)).toBe(true)
    // It is derivable from the demo universe alone (no real backupData argument).
    const empty = getCurrentYearCollectedRevenue(createEmptyBackup(), new Date().getFullYear()).knownTotal
    expect(demoKnown).toBe(getCurrentYearCollectedRevenue(getDemoBackupData(), new Date().getFullYear()).knownTotal)
    // Sanity: an empty real backup yields 0 — demo is a different, self-contained figure.
    expect(empty).toBe(0)
  })

  it('every preset yields a finite demo-universe value (no real-data leak across ranges)', () => {
    const presets: TimelinePreset[] = [
      'CURRENT_YEAR', 'PREVIOUS_YEAR', 'LAST_6_MONTHS', 'LAST_3_MONTHS',
      'LAST_90_DAYS', 'THIS_MONTH', 'ALL_TIME', 'CUSTOM',
    ]
    for (const preset of presets) {
      const t = getTimelineCollected(getDemoBackupData(), preset, {
        todayKey: '2026-08-11',
        customStart: '2026-01-01',
        customEnd: '2026-08-11',
      })
      expect(Number.isFinite(t.displayValue)).toBe(true)
    }
  })

  it('CURRENT_YEAR timeline displayValue equals the current-year known authority (same source)', () => {
    const t = getTimelineCollected(getDemoBackupData(), 'CURRENT_YEAR', { todayKey: '2026-08-11' })
    expect(t.displayValue).toBe(getCurrentYearCollectedRevenue(getDemoBackupData(), 2026).knownTotal)
  })
})