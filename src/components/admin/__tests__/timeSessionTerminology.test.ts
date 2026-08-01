/**
 * TIME-SESSION-TERMINOLOGY — Time Session vs Work Order labels.
 * Updated by WORK-ORDER-PROJECT-ONLY-R1: assignment-linked sessions are Work Orders.
 * Source-level UI contract only.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const read = (rel: string) => readFileSync(join(root, rel), 'utf8')

const modal = read('src/components/admin/AdminPunchHistoryModal.tsx')
const clock = read('src/components/employee/EmployeeTimeClock.tsx')
const myTime = read('src/components/employee/EmployeeMyTimePanel.tsx')
const weekBoard = read('src/components/employee/EmployeeTimeWeekBoard.tsx')
const resolver = read('src/services/timeSessionIdentity.ts')

describe('Shared Time Session identity resolver', () => {
  it('defines work-order / work-package / project-only kinds', () => {
    expect(resolver).toContain("export type TimeSessionIdentityKind = 'work-order' | 'work-package' | 'project-only'")
    expect(resolver).toContain("label: 'Work Order'")
    expect(resolver).toContain("label: 'Work Package'")
    expect(resolver).toContain("kind: 'project-only'")
  })

  it('does not infer Work Package from nonempty work_package_name alone', () => {
    expect(resolver).toContain('workPackageId')
    expect(resolver).toContain('assignmentId')
    expect(resolver).toContain('must not prove Work Package identity')
    expect(resolver).toContain('do not infer WP from a nonempty title alone')
  })
})

describe('Admin Punch History — Time Session terminology', () => {
  it('heading reads TIME SESSIONS', () => {
    expect(modal).toContain('>Time Sessions<')
    expect(modal).not.toMatch(/>Sessions</)
  })

  it('DAILY SUMMARY remains unchanged', () => {
    expect(modal).toContain('Daily Summary')
  })

  it('PUNCHES remains unchanged', () => {
    expect(modal).toContain('>Punches<')
  })

  it('assignment-linked sessions use resolveTimeSessionIdentity (Work Order label)', () => {
    expect(modal).toContain('resolveTimeSessionIdentity')
    expect(modal).toContain("identity.kind === 'project-only' ? 'Work Package' : identity.label")
    expect(modal).toContain('timeSessionIdentityDisplayValue(identity)')
  })

  it('project-only session displays Project Only when assignment_id is absent', () => {
    expect(modal).toContain('Project Only')
    expect(modal).toContain('identity.isProjectOnly')
  })

  it('project-only empty identity still uses Not assigned yet wording', () => {
    expect(modal).toContain('Not assigned yet')
  })

  it('Attach Work Package remains available for unbound project sessions', () => {
    expect(modal).toContain('Attach Work Package')
    expect(modal).toContain('adminAttachSessionAssignment')
  })
})

describe('Employee Clock — Time Session terminology', () => {
  it('keeps Assigned Work, Completed Today, Project Only, and resolver-based identity', () => {
    expect(clock).toContain('Assigned Work')
    expect(clock).toContain('Completed Today')
    expect(clock).toContain('Project Only')
    expect(clock).toContain('resolveTimeSessionIdentity')
    expect(clock).toContain('Work Package: Not assigned yet')
  })

  it('labels the running clock period as a Time Session, not a Job', () => {
    expect(clock).toContain('Current Time Session')
    expect(clock).toContain('Active Time Session')
    expect(clock).not.toMatch(/'Current Session'|"Current Session"|>Current Session</)
    expect(clock).not.toContain('Active Job')
    expect(clock).not.toContain('Work Order before clocking in')
  })

  it('completed Time Session cards use formatTimeSessionIdentityLine (Work Order when assigned)', () => {
    expect(clock).toContain('formatTimeSessionIdentityLine(identity)')
    expect(clock).toContain("identity.projectName ?? 'Time Session'")
    expect(clock).toContain('identity.isProjectOnly')
    expect(clock).not.toContain("?? 'Session'")
  })

  it('ready-to-clock assignment selection labels Work Order', () => {
    expect(clock).toContain('>Work Order<')
    expect(clock).toContain('selection.workPackageName')
  })
})

describe('My Time — Time Session terminology', () => {
  it('My Time panel remains a presentation shell', () => {
    expect(myTime).toContain('EmployeeTimeWeekBoard')
  })

  it('week board SessionCard uses resolver; Project Only when unbound', () => {
    expect(weekBoard).toContain('resolveTimeSessionIdentity')
    expect(weekBoard).toContain('timeSessionIdentityDisplayValue')
    expect(weekBoard).toContain('Project Only')
    expect(weekBoard).toContain("identity.kind === 'project-only' ? 'Work Package' : identity.label")
    expect(weekBoard).not.toContain("?? 'Session'")
  })
})
