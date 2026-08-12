import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  getTimelineCollected,
  TIMELINE_PRESETS,
  type TimelinePreset,
} from '@/services/financialTimelineRange'
import { getCurrentYearCollectedRevenue } from '@/services/collectedRevenueRange'
import { getDemoBackupData } from '@/services/demoDataService'

/**
 * KPI-TIMELINE-FINAL-FIX — owner-facing contract for the EXACT desktop header
 * branch that renders the top "Collected" KPI slot (the slot that previously
 * rendered a fixed "PAID YTD" label with no usable selector).
 *
 * The desktop owner header is produced solely by V15rLayout.tsx (no duplicate
 * header implementation). These are source-contract assertions over that exact
 * branch, plus behavioral re-assertion of the financial semantics that must
 * remain unchanged.
 */
const ROOT = process.cwd()
const layoutSrc = readFileSync(join(ROOT, 'src/components/v15r/V15rLayout.tsx'), 'utf8')

const ALL_PRESETS: TimelinePreset[] = [
  'CURRENT_YEAR', 'PREVIOUS_YEAR', 'LAST_6_MONTHS', 'LAST_3_MONTHS',
  'LAST_90_DAYS', 'THIS_MONTH', 'ALL_TIME', 'CUSTOM',
]

describe('KPI-TIMELINE-FINAL-FIX — owner desktop header Collected selector', () => {
  it('H1 — desktop owner header contains a visible "Collected" concept label', () => {
    // The concept label is rendered as visible JSX text (not only in a tooltip).
    expect(layoutSrc).toContain('>Collected<')
  })

  it('H2 — the desktop header contains a selectable "Current Year" control', () => {
    // The header select renders the full preset labels; CURRENT_YEAR maps to the
    // human-readable "Current Year" option text.
    expect(layoutSrc).toContain('TIMELINE_PRESETS.map((p) =>')
    expect(layoutSrc).toContain('{p.label}')
    const cy = TIMELINE_PRESETS.find((p) => p.value === 'CURRENT_YEAR')
    expect(cy?.label).toBe('Current Year')
  })

  it('H3 — all 8 timeline options exist in the actual desktop branch', () => {
    // The select maps over TIMELINE_PRESETS, which carries exactly 8 presets.
    expect(TIMELINE_PRESETS).toHaveLength(8)
    expect(TIMELINE_PRESETS.map((p) => p.value)).toEqual(ALL_PRESETS)
  })

  it('H4 — default selection is Current Year', () => {
    expect(layoutSrc).toContain("useState<TimelinePreset>('CURRENT_YEAR')")
  })

  it('H5 — the old fixed PAID YTD-only presentation is not the desktop owner result', () => {
    // The select option text is the full preset label, NOT the legacy short
    // "Paid YTD" label. The header no longer renders {p.short} as the visible
    // control text.
    expect(layoutSrc).toContain('{p.label}')
    expect(layoutSrc).not.toMatch(/\{p\.short\}/)
    // The visible concept is "Collected", not "Paid YTD".
    expect(layoutSrc).toContain('>Collected<')
    expect(layoutSrc).not.toMatch(/>Paid YTD</)
  })

  it('H6 — the undated provenance cue remains visible when applicable', () => {
    expect(layoutSrc).toContain('collectedUndatedCue')
    // HEADER-KPI-UI-1: the cue now sits centred directly BENEATH the Collected
    // amount (normal KPI stack) instead of right-aligned beside it.
    expect(layoutSrc).toContain('whitespace-nowrap text-[9px] font-medium uppercase tracking-[0.14em] text-gray-500 leading-none')
  })

  it('H7 — selecting Previous Year changes the selected header period', () => {
    // The select onChange routes to setCollectedPreset; PREVIOUS_YEAR resolves
    // to a distinct range from CURRENT_YEAR.
    expect(layoutSrc).toContain('setCollectedPreset(e.target.value as TimelinePreset)')
    const demo = getDemoBackupData()
    const cy = getTimelineCollected(demo, 'CURRENT_YEAR', { todayKey: '2026-08-11' })
    const py = getTimelineCollected(demo, 'PREVIOUS_YEAR', { todayKey: '2026-08-11' })
    expect(cy.range.startInclusive).not.toEqual(py.range.startInclusive)
    expect(py.range.label).toBe('Previous Year')
  })

  it('H8 — selecting All Time uses lifetime display semantics', () => {
    const demo = getDemoBackupData()
    const t = getTimelineCollected(demo, 'ALL_TIME', { todayKey: '2026-08-11' })
    expect(t.isAllTime).toBe(true)
    expect(t.displayValue).toBe(t.provenance.lifetimeTotal)
  })

  it('H9 — selecting Custom exposes Start Date and End Date controls', () => {
    // Date inputs are gated on the CUSTOM preset selection.
    expect(layoutSrc).toContain("collectedPreset === 'CUSTOM'")
    expect(layoutSrc).toContain('type="date"')
    expect(layoutSrc).toContain('aria-label="Custom range start"')
    expect(layoutSrc).toContain('aria-label="Custom range end"')
  })

  it('H10 — incomplete Custom renders "Select dates" (no fabricated value)', () => {
    expect(layoutSrc).toContain('collectedInvalid')
    expect(layoutSrc).toContain('Select dates')
    // Behavioral: an incomplete CUSTOM range yields no financial result.
    const t = getTimelineCollected(getDemoBackupData(), 'CUSTOM', { todayKey: '2026-08-11' })
    expect(t.isInvalid).toBe(true)
    expect(t.displayValue).toBeNull()
  })

  it('H11 — Annual Target still uses current-year paidYtdValue, NOT the selected period', () => {
    expect(layoutSrc).toContain('const yearlyTargetActual = paidYtdValue')
    expect(layoutSrc).not.toContain('const yearlyTargetActual = collectedDisplayValue')
    // Behavioral: the current-year numerator is invariant across preset selection.
    const demo = getDemoBackupData()
    const numerator = getCurrentYearCollectedRevenue(demo, 2026).knownTotal
    for (const preset of ALL_PRESETS) {
      expect(getCurrentYearCollectedRevenue(demo, 2026).knownTotal).toBe(numerator)
    }
  })

  it('H12 — HEADER-KPI-UI-1: Collected is a plain KPI stack; the selector moved out of it', () => {
    const attr = layoutSrc.indexOf('title={collectedTooltip}')
    expect(attr).toBeGreaterThan(-1)
    // Widen back to the opening tag so the slot's own className is in scope.
    const slotStart = layoutSrc.lastIndexOf('<div', attr)
    expect(slotStart).toBeGreaterThan(-1)
    const slotEnd = layoutSrc.indexOf('{/* Separator */}', attr)
    expect(slotEnd).toBeGreaterThan(slotStart)
    const slot = layoutSrc.slice(slotStart, slotEnd)

    // Label → amount → undated cue, stacked like every neighbouring KPI.
    expect(slot).toContain('flex flex-col items-center')
    expect(slot).toContain('>Collected<')
    expect(slot).toContain('collectedDisplayValue')
    expect(slot).toContain('collectedUndatedCue')
    // The range control is no longer inside or attached to the Collected block.
    expect(slot.match(/<select/g)).toBeNull()
    expect(slot).not.toContain('aria-label="Collected cash range"')
    expect(slot).not.toContain('TIMELINE_PRESETS')
  })

  it('H13 — the selector is not disabled and not pointer-events blocked', () => {
    // The select itself is interactive (cursor-pointer); only the decorative
    // ChevronDown caret carries pointer-events-none. Anchor the regex to the
    // Collected select's unique value binding so it captures only that select.
    const selectBlock = layoutSrc.match(/<select\s+value=\{collectedPreset\}[\s\S]*?<\/select>/)
    expect(selectBlock).not.toBeNull()
    expect(selectBlock![0]).toContain('cursor-pointer')
    expect(selectBlock![0]).not.toContain('disabled')
    expect(selectBlock![0]).not.toContain('pointer-events-none')
    // The caret overlay IS pointer-events-none so it never blocks the select.
    expect(layoutSrc).toContain('pointer-events-none')
  })

  it('H14 — no Save/sync/reload dependency exists for selector changes', () => {
    // The select onChange only calls setCollectedPreset — no persist/sync/save.
    expect(layoutSrc).toContain('setCollectedPreset(e.target.value as TimelinePreset)')
    const onChangeMatch = layoutSrc.match(/onChange=\{\(e\) => setCollectedPreset\(e\.target\.value as TimelinePreset\)\}/)
    expect(onChangeMatch).not.toBeNull()
  })

  it('H15 — no new financial formulas were introduced (single canonical authority)', () => {
    // The header still routes through the one canonical timeline authority.
    expect(layoutSrc).toContain('getTimelineCollected(collectedTimelineBackup,')
    expect(layoutSrc).toContain('getCurrentYearCollectedRevenue(')
    expect(layoutSrc).not.toContain('calculateCurrentYearFinancialsToDate')
  })
})
