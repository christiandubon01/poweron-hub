import type { EmployeeAnimationPresentationV1 } from './employeeAnimationPresentation'

export type WorkOrderPayloadV1 = {
  schemaVersion: 1
  workOrderVersion: number
  identity: {
    assignmentId: string
    orgId: string
    projectId: string
    projectName: string
    /** Absent for Project-only / Blueprint-only Work Orders. */
    workPackageId?: string
    /** Absent for Project-only Work Orders. */
    blueprintSetId?: string
    blueprintTitle?: string
    dueDate?: string
    sourcePageNumber?: number
    createdAt: string
    createdBy: string
  }
  source: {
    workPackageUpdatedAt?: string
    animationSceneRevision?: number
    sourceFingerprint: string
  }
  scope: {
    title: string
    description: string
    crewNotes?: string
  }
  workOrderInstructions?: string
  labor: {
    roughInHours: number
    trimHours: number
    testingHours: number
    cleanupHours: number
    totalHours: number
  }
  items: Array<{
    sourceId?: string
    name: string
    quantity: number
    unit?: string
    note?: string
    pageNumber?: number
  }>
  electricalSymbols: Array<{
    shapeKind: string
    name: string
    category?: string
    quantity: number
  }>
  wireQuantities: Array<{
    wireProfileId?: string
    profileName: string
    materialDescription?: string
    length: number
    unit: string
  }>
  animationRoute: null | {
    name?: string
    sourceLabel?: string
    steps: Array<{
      order: number
      label: string
      deviceType?: string
      branch?: string
    }>
    terminalLabels?: string[]
  }
  animationPresentation?: EmployeeAnimationPresentationV1 | null
}

export type WorkOrderPayloadV1Draft = Omit<
  WorkOrderPayloadV1,
  'schemaVersion' | 'workOrderVersion' | 'identity'
> & {
  identity: Omit<
    WorkOrderPayloadV1['identity'],
    'assignmentId' | 'orgId' | 'createdAt' | 'createdBy'
  >
}

export type WorkOrderServerIdentity = {
  assignmentId: string
  orgId: string
  createdAt: string
  createdBy: string
}
