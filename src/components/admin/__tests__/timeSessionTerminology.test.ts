/**
 * TIME-SESSION-TERMINOLOGY-1 — owner-facing Time Session vs Work Order labels.
 * Source-level UI contract only. No RPC, schema, or calculation changes.
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

  it('assignment session displays Work Package label', () => {
    expect(modal).toContain('Work Package')
    expect(modal).toContain('sess.work_package_name')
  })

  it('project-only session displays Project Only', () => {
    expect(modal).toContain('Project Only')
    expect(modal).toContain('!sess.assignment_id')
  })

  it('project-only session displays Work Package: Not assigned yet', () => {
    expect(modal).toContain('Not assigned yet')
    expect(modal).toContain('Work Package')
  })

  it('Attach Work Package remains available', () => {
    expect(modal).toContain('Attach Work Package')
    expect(modal).toContain('adminAttachSessionAssignment')
  })

  it('no Time Session card is mislabeled as a Work Order', () => {
    // Section cards must not use Work Order as the session title/heading
    expect(modal).not.toMatch(/>Work Order</)
    expect(modal).toContain('Time Sessions')
    expect(modal).not.toContain('Work Order:')
  })
})

describe('Employee Clock — Time Session terminology', () => {
  it('keeps Assigned Work, Completed Today, Project Only, Work Package not-assigned', () => {
    expect(clock).toContain('Assigned Work')
    expect(clock).toContain('Completed Today')
    expect(clock).toContain('Project Only')
    expect(clock).toContain('Work Package: Not assigned yet')
    expect(clock).toContain('Not assigned yet')
  })

  it('labels the running clock period as a Time Session, not a Job or Work Order', () => {
    expect(clock).toContain('Current Time Session')
    expect(clock).toContain('Active Time Session')
    expect(clock).not.toMatch(/'Current Session'|"Current Session"|>Current Session</)
    expect(clock).not.toContain('Active Job')
    expect(clock).not.toContain('Work Order before clocking in')
  })

  it('completed Time Session cards show project + Work Package, not bare Session/Work Order', () => {
    expect(clock).toContain("s.project_name ?? 'Time Session'")
    expect(clock).toContain('Work Package: {s.work_package_name ?? \'Not assigned yet\'}')
    expect(clock).not.toContain("?? 'Session'")
  })
})

describe('My Time — Time Session terminology', () => {
  it('My Time panel remains a presentation shell without Work Order session labels', () => {
    expect(myTime).toContain('EmployeeTimeWeekBoard')
    expect(myTime).not.toContain('Work Order')
  })

  it('week board SessionCard uses Work Package / Project Only, not Session or Work Order', () => {
    expect(weekBoard).toContain('Work Package')
    expect(weekBoard).toContain('Not assigned yet')
    expect(weekBoard).toContain('Project Only')
    expect(weekBoard).not.toContain("?? 'Session'")
    expect(weekBoard).not.toMatch(/>Work Order</)
  })
})
