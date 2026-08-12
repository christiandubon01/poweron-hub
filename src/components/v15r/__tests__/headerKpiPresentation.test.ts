import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { TIMELINE_PRESETS, type TimelinePreset } from '@/services/financialTimelineRange'

/**
 * HEADER-KPI-UI-1 — owner-requested top-header PRESENTATION contract.
 *
 * Three changes, presentation only:
 *   1. Collected renders as a normal vertical KPI (label / amount / undated cue).
 *   2. The collected-cash range selector moved to its own slot after Service Net.
 *   3. Daily Target stacks: target on the primary line, Today / Remaining /
 *      progress on a smaller secondary line beneath it.
 *
 * No KPI calculation, no cash authority and no timeline semantic changes here —
 * the guards at the bottom pin that down.
 */

const ROOT = process.cwd()
function src(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf8')
}

const LAYOUT = 'src/components/v15r/V15rLayout.tsx'
const layoutSrc = src(LAYOUT)

/** Widen an attribute hit back to the opening tag of its element. */
function fromOpeningTag(attrIndex: number): number {
  const open = layoutSrc.lastIndexOf('<div', attrIndex)
  expect(open).toBeGreaterThan(-1)
  return open
}

/** The Collected KPI slot. */
function collectedSlot(): string {
  const attr = layoutSrc.indexOf('title={collectedTooltip}')
  expect(attr).toBeGreaterThan(-1)
  const start = fromOpeningTag(attr)
  const end = layoutSrc.indexOf('{/* Separator */}', attr)
  expect(end).toBeGreaterThan(start)
  return layoutSrc.slice(start, end)
}

/** The moved range-selector slot. */
function rangeSlot(): string {
  const attr = layoutSrc.indexOf('title="Collected cash range"')
  expect(attr).toBeGreaterThan(-1)
  return layoutSrc.slice(fromOpeningTag(attr), attr + 2600)
}

/** The Daily Target block. */
function dailyTargetBlock(): string {
  const start = layoutSrc.indexOf('data-testid="header-daily-target"')
  expect(start).toBeGreaterThan(-1)
  const end = layoutSrc.indexOf('{/* +Log Button */}', start)
  expect(end).toBeGreaterThan(start)
  return layoutSrc.slice(start, end)
}

describe('HEADER-KPI-UI-1 — Collected as a normal KPI', () => {
  it('HEADER-1: the Collected label still renders', () => {
    expect(collectedSlot()).toContain('>Collected<')
    // Same label treatment as the neighbouring KPIs (Pipeline, Service Net…).
    expect(collectedSlot()).toContain('text-[8px] font-bold uppercase text-gray-500')
  })

  it('HEADER-2: the Collected main numeric value still renders', () => {
    const slot = collectedSlot()
    expect(slot).toContain('fmtHeader(collectedDisplayValue)')
    // Prominent, and the same size class the neighbouring KPI amounts use.
    expect(slot).toContain('text-base font-bold')
    // Incomplete Custom still refuses to fabricate a number.
    expect(slot).toContain("collectedInvalid ? 'Select dates'")
    // Privacy masking survived the restructure.
    expect(slot).toContain("hideFinances ? '••••'")
  })

  it('HEADER-3: the undated amount still renders beneath the Collected value', () => {
    const slot = collectedSlot()
    const valueIdx = slot.indexOf('fmtHeader(collectedDisplayValue)')
    const cueIdx = slot.indexOf('{collectedUndatedCue}')
    expect(valueIdx).toBeGreaterThan(-1)
    expect(cueIdx).toBeGreaterThan(valueIdx) // below the amount, not beside it
    // Secondary treatment: smaller and muted.
    expect(slot).toContain('text-[9px] font-medium uppercase')
    // Vertical stack, so "beneath" is a layout fact and not just source order.
    expect(slot).toContain('flex flex-col items-center')
  })

  it('HEADER-4: the range selector is no longer inside the Collected block', () => {
    const slot = collectedSlot()
    expect(slot.match(/<select/g)).toBeNull()
    expect(slot).not.toContain('collectedPreset')
    expect(slot).not.toContain('TIMELINE_PRESETS')
    expect(slot).not.toContain('ChevronDown')
    // The Custom date inputs travelled with the selector too.
    expect(slot).not.toContain('aria-label="Custom range start"')
    expect(slot).not.toContain('aria-label="Custom range end"')
  })
})

describe('HEADER-KPI-UI-1 — range selector position', () => {
  it('HEADER-5: the selector renders after the Service Net KPI', () => {
    const serviceNetIdx = layoutSrc.indexOf('{/* SERVICE NET */}')
    const rangeIdx = layoutSrc.indexOf('title="Collected cash range"')
    const collectedIdx = layoutSrc.indexOf('title={collectedTooltip}')
    expect(serviceNetIdx).toBeGreaterThan(-1)
    expect(rangeIdx).toBeGreaterThan(serviceNetIdx)   // after Service Net
    expect(rangeIdx).toBeGreaterThan(collectedIdx)    // and after Collected
    // Exactly one collected-range select in the whole header.
    expect(layoutSrc.match(/aria-label="Collected cash range"/g)).toHaveLength(1)
    // It is its own slot, styled like the neighbouring header cells.
    expect(rangeSlot()).toContain('flex flex-col items-center')
  })

  it('HEADER-6: Current Year remains the selected label for the current-year range', () => {
    expect(layoutSrc).toContain("useState<TimelinePreset>('CURRENT_YEAR')")
    expect(TIMELINE_PRESETS.find((p) => p.value === 'CURRENT_YEAR')?.label).toBe('Current Year')
    // The control still renders full period labels, not the legacy short form.
    expect(rangeSlot()).toContain('{p.label}')
    expect(rangeSlot()).not.toContain('{p.short}')
  })

  it('HEADER-7: every preset and the Custom behaviour survived the move', () => {
    const slot = rangeSlot()
    expect(slot).toContain('TIMELINE_PRESETS.map((p) =>')
    expect(slot).toContain('value={collectedPreset}')
    expect(slot).toContain('setCollectedPreset(e.target.value as TimelinePreset)')
    // Custom start/end inputs moved WITH the selector.
    expect(slot).toContain("collectedPreset === 'CUSTOM'")
    expect(slot).toContain('aria-label="Custom range start"')
    expect(slot).toContain('aria-label="Custom range end"')
    expect(slot).toContain('setCustomStart(e.target.value)')
    expect(slot).toContain('setCustomEnd(e.target.value)')
    // All 8 presets are still the single source of the option list.
    const expected: TimelinePreset[] = [
      'CURRENT_YEAR', 'PREVIOUS_YEAR', 'LAST_6_MONTHS', 'LAST_3_MONTHS',
      'LAST_90_DAYS', 'THIS_MONTH', 'ALL_TIME', 'CUSTOM',
    ]
    expect(TIMELINE_PRESETS.map((p) => p.value)).toEqual(expected)
    // Still interactive: not disabled, caret still the only inert element.
    const selectBlock = layoutSrc.match(/<select\s+value=\{collectedPreset\}[\s\S]*?<\/select>/)
    expect(selectBlock).not.toBeNull()
    expect(selectBlock![0]).toContain('cursor-pointer')
    expect(selectBlock![0]).not.toContain('disabled')
    expect(selectBlock![0]).not.toContain('pointer-events-none')
  })
})

describe('HEADER-KPI-UI-1 — Daily Target two-line stack', () => {
  it('HEADER-8: the Daily Target value still renders on the primary line', () => {
    const block = dailyTargetBlock()
    expect(block).toContain('Daily Target:')
    expect(block).toContain('fmt(dailyTargetTruth.targetValue || 0)')
    expect(block).toContain('text-green-400 font-semibold')
    // The unconfigured state is untouched.
    expect(block).toContain('Not configured')
  })

  it('HEADER-9: Today still renders', () => {
    const block = dailyTargetBlock()
    expect(block).toContain('Today:')
    expect(block).toContain('fmt(dailyTargetTruth.actualCollected)')
  })

  it('HEADER-10: Remaining still renders', () => {
    const block = dailyTargetBlock()
    expect(block).toContain('Remaining:')
    expect(block).toContain('fmt(dailyTargetRemaining)')
    // The progress indicator was preserved, not dropped for spacing.
    expect(block).toContain('dailyTargetTruth.progressPct ?? 0')
    // The over-target surplus is still owner-visible when it exists.
    expect(block).toContain('dailyTargetOver > 0')
    expect(block).toContain('fmt(dailyTargetOver)')
  })

  it('HEADER-11: Today / Remaining sit on a secondary line BELOW Daily Target', () => {
    const block = dailyTargetBlock()
    const primaryIdx = block.indexOf('Daily Target:')
    const secondaryIdx = block.indexOf('data-testid="header-daily-target-secondary"')
    const todayIdx = block.indexOf('Today:')
    const remainingIdx = block.indexOf('Remaining:')
    expect(primaryIdx).toBeGreaterThan(-1)
    expect(secondaryIdx).toBeGreaterThan(primaryIdx)
    expect(todayIdx).toBeGreaterThan(secondaryIdx)
    expect(remainingIdx).toBeGreaterThan(todayIdx)
    // Two distinct block-level lines, the second visibly secondary.
    expect(block).toContain('mt-0.5 text-[11px]')
    // Readable, not shrunk into illegibility.
    expect(block).not.toMatch(/text-\[[0-9]px\]/)
  })

  it('HEADER-11: Remaining and the surplus are a display split of the ONE locked figure', () => {
    // businessGoalTruth.difference = actualCollected − targetValue. The header
    // shows its two halves; it does not recompute either side from raw cash.
    expect(layoutSrc).toContain('Math.max(0, -dailyTargetTruth.difference)')
    expect(layoutSrc).toContain('Math.max(0, dailyTargetTruth.difference)')
    // Behaviour of that split, both directions.
    const remaining = (difference: number) => Math.max(0, -difference)
    const over = (difference: number) => Math.max(0, difference)
    expect(remaining(-500)).toBe(500)   // target 500, collected 0
    expect(over(-500)).toBe(0)
    expect(remaining(200)).toBe(0)      // target 500, collected 700
    expect(over(200)).toBe(200)
    expect(remaining(0)).toBe(0)        // exactly on target
    expect(over(0)).toBe(0)
  })
})

describe('HEADER-KPI-UI-1 — guards', () => {
  it('HEADER-12: no KPI calculation or helper was altered', () => {
    // The header still routes through the same canonical authorities.
    expect(layoutSrc).toContain('getTimelineCollected(collectedTimelineBackup,')
    expect(layoutSrc).toContain('getCurrentYearCollectedRevenue(')
    expect(layoutSrc).toContain('buildBusinessGoalTruth(')
    expect(layoutSrc).toContain('collectedTimeline.provenance.unknownDateTotal')
    // No new formula sneaked into the header.
    expect(layoutSrc).not.toContain('calculateCurrentYearFinancialsToDate')
    // Annual Target still uses current-year paid YTD, not the selected preset.
    expect(layoutSrc).toContain('const yearlyTargetActual = paidYtdValue')
  })

  it('HEADER-13/14: Project Log and Service Call files are not involved', () => {
    for (const rel of [
      'src/components/v15r/ProjectLogFinancialPanel.tsx',
      'src/components/v15r/ProjectLogModalLayout.tsx',
      'src/components/v15r/ServiceCallModalLayout.tsx',
    ]) {
      const s = src(rel)
      expect(s).not.toContain('collectedPreset')
      expect(s).not.toContain('dailyTargetTruth')
      expect(s).not.toContain('V15rLayout')
    }
    expect(layoutSrc).not.toContain('ProjectLogFinancialPanel')
    expect(layoutSrc).not.toContain('ProjectLogModalLayout')
    expect(layoutSrc).not.toContain('ServiceCallModalLayout')
  })

  it('HEADER-15: financial authority services still expose their canonical entry points', () => {
    expect(src('src/services/collectedRevenueRange.ts')).toContain('export function getCurrentYearCollectedRevenue')
    expect(src('src/services/financialTimelineRange.ts')).toContain('export function getTimelineCollected')
    expect(src('src/services/businessGoalTruth.ts')).toContain('difference: dailyDifference')
    // The daily difference authority itself is unchanged.
    expect(src('src/services/businessGoalTruth.ts'))
      .toContain('num(dailyActualCollected - dayTargetValue)')
  })
})
