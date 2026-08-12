import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PROJECT_LOG_MODAL_SUBTITLE } from '@/components/v15r/ProjectLogModalLayout'

/**
 * PROJECT-LOG-UI-2B — dual-compartment Project Log modal contract.
 *
 * New (V15rFieldLogPanel) and Edit (V15rProjectLogsTab) must share ONE shell:
 * left = field entry, right = live financial control, with a header and footer
 * that span the full modal width and compartments that scroll independently.
 */

const ROOT = process.cwd()
function src(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf8')
}

const NEW_MODAL = 'src/components/v15r/V15rFieldLogPanel.tsx'
const EDIT_MODAL = 'src/components/v15r/V15rProjectLogsTab.tsx'
const LAYOUT = 'src/components/v15r/ProjectLogModalLayout.tsx'
const MODALS = [NEW_MODAL, EDIT_MODAL] as const

/** The slice of a modal file that sits inside the layout's `right={...}` prop. */
function rightSlice(source: string): string {
  const from = source.indexOf('right={')
  const to = source.indexOf('left={', from)
  expect(from).toBeGreaterThan(-1)
  expect(to).toBeGreaterThan(from)
  return source.slice(from, to)
}

/** Everything from the layout's `left={...}` prop onward. */
function leftSlice(source: string): string {
  const from = source.indexOf('left={')
  expect(from).toBeGreaterThan(-1)
  return source.slice(from)
}

/**
 * Everything between "the Project Log modal opens" and the shared layout tag.
 *
 * Scoped deliberately: V15rFieldLogPanel also hosts the Service Log modal,
 * which keeps its own (out-of-scope) shell. Only this window may be asserted
 * free of hand-rolled modal chrome.
 */
function shellPrefix(source: string): string {
  const openIdx = source.indexOf('showProjForm && (')
  const layoutIdx = source.indexOf('<ProjectLogModalLayout', openIdx)
  expect(openIdx).toBeGreaterThan(-1)
  expect(layoutIdx).toBeGreaterThan(openIdx)
  return source.slice(openIdx, layoutIdx)
}

describe('PROJECT-LOG-UI-2B — dual-compartment modal', () => {
  it('LAYOUT-1: New renders the dual-compartment shell', () => {
    const s = src(NEW_MODAL)
    expect(s).toContain("import ProjectLogModalLayout from './ProjectLogModalLayout'")
    expect(s).toContain('<ProjectLogModalLayout')
    expect(s).toMatch(/mode=\{editLogId \? 'edit' : 'new'\}/)
  })

  it('LAYOUT-2: Edit renders the dual-compartment shell', () => {
    const s = src(EDIT_MODAL)
    expect(s).toContain("import ProjectLogModalLayout from './ProjectLogModalLayout'")
    expect(s).toContain('<ProjectLogModalLayout')
    expect(s).toMatch(/mode=\{editLogId \? 'edit' : 'new'\}/)
  })

  it('LAYOUT-3: New and Edit use the SAME layout component — no duplicated shell', () => {
    for (const rel of MODALS) {
      const s = src(rel)
      // Exactly one modal shell per file, and it is the shared one.
      expect(s.match(/<ProjectLogModalLayout/g)).toHaveLength(1)
      // The old hand-rolled shell is gone from both callers: no private
      // overlay, no private footer buttons, no private glare keyframes.
      expect(s).not.toContain('projectLogModalGlare')
      expect(s).not.toContain("editLogId ? 'Update Log' : 'Save Log'")
      expect(s).not.toContain("editLogId ? 'Edit Project Log' : 'New Project Log'")
      // The Project Log modal's root element IS the shared layout — there is no
      // hand-rolled overlay/card in front of it any more.
      const prefix = shellPrefix(s)
      expect(prefix).not.toContain('backdropFilter')
      expect(prefix).not.toContain('fixed inset-0')
      expect(prefix).not.toContain("maxHeight: '90vh'")
    }
    // Every one of those responsibilities now lives in exactly one file.
    const layout = src(LAYOUT)
    expect(layout).toContain('projectLogModalGlare')
    expect(layout).toContain("isEdit ? 'Update Log' : 'Save Log'")
    expect(layout).toContain("isEdit ? 'Edit Project Log' : 'New Project Log'")
    expect(layout).toContain('backdropFilter')
  })

  it('LAYOUT-4: the LEFT compartment holds only field-entry controls', () => {
    for (const rel of MODALS) {
      const s = src(rel)
      const left = leftSlice(s)
      // Every owner-facing entry field is on the left.
      for (const field of [
        'Job Context', 'Time + Cost Inputs', 'Notes + Proof',
        '>Project<', '>Phase<', '>Date<', '>Employee<',
        '>Hours<', '>Miles RT<', '>Collected $<', '>Store<',
        '>Emergency Mat Info<', '>Detail Link<', '>Work Performed<',
      ]) {
        expect(left, `${rel} left is missing ${field}`).toContain(field)
      }
      // ...and no financial content bleeds into it.
      expect(left).not.toContain('<ProjectLogFinancialPanel')
      expect(left).not.toContain('Project Budget vs Actual Cost')
    }
  })

  it('LAYOUT-5: the RIGHT compartment holds the live financial control panel', () => {
    for (const rel of MODALS) {
      const s = src(rel)
      const right = rightSlice(s)
      expect(right).toContain('<ProjectLogFinancialPanel')
      expect(right).toContain('inputs={{ hrs: flHrs, miles: flMiles, mat: flMat, collected: flCollected }}')
      expect(right).toContain('editLogId={editLogId}')
      // Exactly one financial panel per modal, and it is on the right.
      expect(s.match(/<ProjectLogFinancialPanel/g)).toHaveLength(1)
      // No entry field sneaks into the financial compartment.
      for (const field of ['>Hours<', '>Miles RT<', '>Work Performed<']) {
        expect(right).not.toContain(field)
      }
    }
  })

  it('LAYOUT-6: the header spans the full modal width, above both compartments', () => {
    const layout = src(LAYOUT)
    const headerIdx = layout.indexOf('data-testid="project-log-modal-header"')
    const bodyIdx = layout.indexOf('data-testid="project-log-modal-body"')
    expect(headerIdx).toBeGreaterThan(-1)
    expect(headerIdx).toBeLessThan(bodyIdx)
    // It is a sibling of the body, not nested inside a compartment.
    expect(layout.indexOf('data-testid="project-log-modal-left"')).toBeGreaterThan(bodyIdx)
    expect(layout).toContain('<ClipboardList size={20} />')
    expect(layout).toContain('aria-label="Close project log modal"')
    expect(PROJECT_LOG_MODAL_SUBTITLE)
      .toBe('Log labor, materials, mileage, collection, and work performed.')
  })

  it('LAYOUT-7: one shared footer spans the full modal width, below both compartments', () => {
    const layout = src(LAYOUT)
    const bodyIdx = layout.indexOf('data-testid="project-log-modal-body"')
    const footerIdx = layout.indexOf('data-testid="project-log-modal-footer"')
    expect(footerIdx).toBeGreaterThan(bodyIdx)
    // Cancel left, Save/Update right — and only ONE of each in the whole modal.
    expect(layout.match(/>\s*Cancel\s*</g)).toHaveLength(1)
    expect(layout.match(/isEdit \? 'Update Log' : 'Save Log'/g)).toHaveLength(1)
    expect(layout).toContain('onClick={onSave}')
  })

  it('LAYOUT-8: header and footer never scroll away, so Save/Update stays reachable', () => {
    const layout = src(LAYOUT)
    // Both chrome rows are flex-none; only the body flexes and scrolls.
    const header = layout.slice(layout.indexOf('data-testid="project-log-modal-header"') - 400, layout.indexOf('data-testid="project-log-modal-header"'))
    const footer = layout.slice(layout.indexOf('data-testid="project-log-modal-footer"') - 400, layout.indexOf('data-testid="project-log-modal-footer"'))
    expect(header).toContain('flex-shrink-0')
    expect(footer).toContain('flex-shrink-0')
    // min-h-0 is what actually lets the body shrink instead of pushing the
    // footer off the bottom of a flex column.
    expect(layout).toContain('relative flex min-h-0 flex-1 flex-col overflow-y-auto xl:flex-row xl:overflow-hidden')
    expect(layout).toContain("maxHeight: '92vh'")
  })

  it('LAYOUT-9/10: each compartment owns its own scrollbar on wide layouts', () => {
    const layout = src(LAYOUT)
    expect(layout).toContain('className="flex-none px-5 py-5 xl:min-h-0 xl:w-[44%] xl:overflow-y-auto"')
    expect(layout).toContain('xl:min-h-0 xl:w-[56%] xl:overflow-y-auto')
    // Wide: the body itself does not scroll, so the two panes are independent.
    expect(layout).toContain('xl:overflow-hidden')
    // Cards do not add a third nested scrollbar.
    expect(layout).not.toMatch(/overflow-y-auto[^"]*\boverflow-y-auto\b/)
  })

  it('LAYOUT-11: narrow layouts stack left-then-right with a single scrollbar', () => {
    const layout = src(LAYOUT)
    // Below xl the body is a scrolling column; at xl it becomes a static row.
    expect(layout).toMatch(/flex-col overflow-y-auto xl:flex-row xl:overflow-hidden/)
    // Left is authored first, so it stacks above right.
    expect(layout.indexOf('project-log-modal-left'))
      .toBeLessThan(layout.indexOf('project-log-modal-right'))
    // The compartments are full width until the breakpoint.
    expect(layout).not.toMatch(/\sw-\[(44|56)%\]/)
    expect(layout).toContain('border-t border-cyan-300/10 px-5 py-5 xl:min-h-0')
    expect(layout).toContain('xl:border-l xl:border-t-0')
  })

  it('the modal is substantially wider than the old single column, with visible margins', () => {
    const layout = src(LAYOUT)
    expect(layout).toContain("width: 'min(94vw, 1560px)'")
    // Never edge-to-edge, and never the old max-w-5xl single column.
    expect(layout).not.toContain('100vw')
    expect(layout).not.toContain('max-w-5xl')
    // The Project Log modal no longer carries the old single-column cap.
    // (Scoped: the Service Log modal in V15rFieldLogPanel keeps its own shell.)
    for (const rel of MODALS) {
      expect(shellPrefix(src(rel))).not.toContain('max-w-5xl')
    }
  })

  it('the layout owns no financial formula and no form state', () => {
    const layout = src(LAYOUT)
    for (const forbidden of [
      'buildProjectLogFinancials',
      'resolveProjectLaborSource',
      'calculateProjectFinancials',
      'useState',
      'saveBackupData',
      'localStorage',
      'supabase',
      'pushState(',
      'mileRate',
    ]) {
      expect(layout, `layout must not reference ${forbidden}`).not.toContain(forbidden)
    }
    // It only forwards the callers' handlers.
    expect(layout).toContain('onSave: () => void')
    expect(layout).toContain('onClose: () => void')
  })
})
