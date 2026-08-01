/**
 * [UNIT] Time Session identity resolver — Project-only WO labeling.
 */

import { describe, expect, it } from 'vitest'
import {
  formatTimeSessionIdentityLine,
  resolveTimeSessionIdentity,
  timeSessionIdentityDisplayValue,
} from '@/services/timeSessionIdentity'

describe('[UNIT] resolveTimeSessionIdentity', () => {
  it('assignment-linked Project-only WO session → Work Order (not Work Package)', () => {
    const identity = resolveTimeSessionIdentity({
      assignmentId: 'assign-1',
      workPackageId: null,
      workPackageName: 'Install temporary power',
      projectName: "Rock'n Avenue",
    })
    expect(identity).toMatchObject({
      kind: 'work-order',
      label: 'Work Order',
      value: 'Install temporary power',
      isProjectOnly: false,
    })
    expect(identity.label).not.toBe('Work Package')
  })

  it('assignment-linked Blueprint-only WO session → Work Order', () => {
    const identity = resolveTimeSessionIdentity({
      assignmentId: 'assign-2',
      workPackageId: null,
      workPackageName: 'Site walkthrough',
      projectName: 'Alpha',
    })
    expect(identity.kind).toBe('work-order')
    expect(identity.label).toBe('Work Order')
    expect(identity.value).toBe('Site walkthrough')
  })

  it('assignment-linked Work Package WO session → primary Work Order', () => {
    const identity = resolveTimeSessionIdentity({
      assignmentId: 'assign-3',
      workPackageId: 'wp-1',
      workPackageName: 'Rough-in',
      projectName: 'Alpha',
    })
    expect(identity.kind).toBe('work-order')
    expect(identity.label).toBe('Work Order')
    expect(identity.value).toBe('Rough-in')
  })

  it('genuine Work Package context without assignment → Work Package', () => {
    const identity = resolveTimeSessionIdentity({
      assignmentId: null,
      workPackageId: 'wp-legacy',
      workPackageName: 'Trim',
      projectName: 'Beta',
    })
    expect(identity).toMatchObject({
      kind: 'work-package',
      label: 'Work Package',
      value: 'Trim',
      isProjectOnly: false,
    })
  })

  it('generic Project-only session without assignment → project-only', () => {
    const identity = resolveTimeSessionIdentity({
      assignmentId: null,
      workPackageId: null,
      workPackageName: null,
      projectName: 'Gamma',
    })
    expect(identity).toMatchObject({
      kind: 'project-only',
      label: 'Project',
      value: 'Gamma',
      isProjectOnly: true,
    })
    expect(timeSessionIdentityDisplayValue(identity)).toBe('Not assigned yet')
    expect(formatTimeSessionIdentityLine(identity)).toBe('Work Package: Not assigned yet')
  })

  it('nonempty work_package_name alone does not prove Work Package identity', () => {
    const identity = resolveTimeSessionIdentity({
      assignmentId: null,
      workPackageId: null,
      workPackageName: 'Looks like a package but is not',
      projectName: 'Delta',
    })
    expect(identity.kind).toBe('project-only')
    expect(identity.label).not.toBe('Work Package')
    expect(identity.isProjectOnly).toBe(true)
  })
})
