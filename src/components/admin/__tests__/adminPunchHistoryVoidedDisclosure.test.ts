/**
 * ADMIN-PUNCH-HISTORY-CLEANUP-1 — collapse voided punch audit history.
 * Source-level UI contract only. No RPC, schema, or calculation changes.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const read = (rel: string) => readFileSync(join(root, rel), 'utf8')

const modal = read('src/components/admin/AdminPunchHistoryModal.tsx')

function sectionIndex(label: string): number {
  const idx = modal.indexOf(label)
  expect(idx).toBeGreaterThanOrEqual(0)
  return idx
}

describe('Admin Punch History — section order', () => {
  it('renders Daily Summary → Time Sessions → Punches → Add Punch → Voided Punches', () => {
    const daily = sectionIndex('>Daily Summary<')
    const sessions = sectionIndex('>Time Sessions<')
    const punches = sectionIndex('>Punches<')
    const addPunch = sectionIndex('Add Punch (immediately after active punches)')
    const voided = sectionIndex('Voided Punches audit disclosure')

    expect(daily).toBeLessThan(sessions)
    expect(sessions).toBeLessThan(punches)
    expect(punches).toBeLessThan(addPunch)
    expect(addPunch).toBeLessThan(voided)
  })

  it('places Add Punch before the voided disclosure', () => {
    const addIdx = sectionIndex('Add Punch (immediately after active punches)')
    const voidedIdx = sectionIndex('Voided Punches ({voidedPunches.length})')
    expect(addIdx).toBeLessThan(voidedIdx)
  })
})

describe('Admin Punch History — Time Sessions empty state', () => {
  it('TIME SESSIONS heading always renders (not gated on sessions.length > 0)', () => {
    expect(modal).toContain('>Time Sessions<')
    // Heading must not be wrapped by sessions.length > 0 alone
    expect(modal).not.toMatch(/\{sessions\.length > 0 && \(\s*<div>\s*<p[^>]*>Time Sessions/)
  })

  it('shows compact empty state when no sessions remain', () => {
    expect(modal).toContain('No time sessions for this day')
    expect(modal).toContain('sessions.length === 0')
  })

  it('preserves project-only and assignment Time Session cards', () => {
    expect(modal).toContain('Project Only')
    expect(modal).toContain('Work Package')
    expect(modal).toContain('Attach Work Package')
    expect(modal).toContain('sess.work_package_name')
    expect(modal).toContain('!sess.assignment_id')
  })
})

describe('Admin Punch History — active vs voided filtering', () => {
  it('active PUNCHES list excludes voided records', () => {
    expect(modal).toContain('punches.filter(p => !p.is_void)')
    expect(modal).toContain('activePunches')
    expect(modal).toContain('activePunches.map')
  })

  it('active punches remain editable using existing controls', () => {
    expect(modal).toContain('aria-label="Edit punch"')
    expect(modal).toContain('aria-label="Void punch"')
    expect(modal).toContain('startEdit(punch)')
    expect(modal).toContain('voidPunch(punch.id)')
  })

  it('shows empty active punches state when none remain', () => {
    expect(modal).toContain('No active punches for this day')
    expect(modal).toContain('activePunches.length === 0')
  })

  it('Daily Summary remains unchanged', () => {
    expect(modal).toContain('Daily Summary')
    expect(modal).toContain('entry.clock_in_at')
    expect(modal).toContain('entry.paid_minutes')
    expect(modal).toContain('formatTime(entry.clock_out_at)')
  })
})

describe('Admin Punch History — Voided Punches disclosure', () => {
  it('shows Voided Punches (N) with the exact voided count', () => {
    expect(modal).toContain('Voided Punches ({voidedPunches.length})')
    expect(modal).toContain('punches.filter(p => p.is_void)')
  })

  it('is collapsed by default every time the modal opens', () => {
    expect(modal).toContain('const [voidedExpanded, setVoidedExpanded] = useState(false)')
    expect(modal).toContain('setVoidedExpanded(false)')
    expect(modal).toContain('aria-expanded={voidedExpanded}')
  })

  it('expanding displays all voided audit rows; collapsing hides them', () => {
    expect(modal).toContain('setVoidedExpanded(prev => !prev)')
    expect(modal).toContain('{voidedExpanded && (')
    expect(modal).toContain('voidedPunches.map')
  })

  it('voided rows have no edit or delete actions', () => {
    const voidedBlockStart = modal.indexOf('Voided Punches audit disclosure')
    expect(voidedBlockStart).toBeGreaterThanOrEqual(0)
    const voidedBlock = modal.slice(
      voidedBlockStart,
      modal.indexOf('Pending Punch Edit Requests', voidedBlockStart),
    )
    expect(voidedBlock).toContain('Voided')
    expect(voidedBlock).not.toContain('aria-label="Edit punch"')
    expect(voidedBlock).not.toContain('aria-label="Void punch"')
    expect(voidedBlock).not.toContain('startEdit(')
    expect(voidedBlock).not.toContain('voidPunch(')
  })

  it('visually distinguishes voided rows as inactive audit history', () => {
    expect(modal).toContain('opacity-50')
    expect(modal).toContain('line-through')
    expect(modal).toContain('bg-red-900/30 text-red-400')
  })

  it('uses an accessible disclosure pattern', () => {
    expect(modal).toContain('aria-expanded={voidedExpanded}')
    expect(modal).toContain('aria-controls="voided-punches-list"')
    expect(modal).toContain('focus-visible:ring-2')
    expect(modal).toContain('type="button"')
  })

  it('preserves chronological ordering by punched_at', () => {
    expect(modal).toContain('new Date(a.punched_at).getTime() - new Date(b.punched_at).getTime()')
    expect(modal).toContain('.sort(byPunchedAt)')
  })
})

describe('Admin Punch History — modal chrome preserved', () => {
  it('keeps Close button and contained scroll with many voided records', () => {
    expect(modal).toContain('aria-label="Close"')
    expect(modal).toContain('overflow-y-auto')
    expect(modal).toContain('max-h-[90vh]')
    expect(modal).toContain('max-w-lg')
    // Footer Close remains
    expect(modal).toMatch(/>\s*Close\s*</)
  })

  it('does not mix voided punches into the active list via pair UI', () => {
    expect(modal).not.toContain('replaces original')
    expect(modal).not.toContain("kind: 'pair'")
    expect(modal).not.toContain('renderItems')
  })
})
