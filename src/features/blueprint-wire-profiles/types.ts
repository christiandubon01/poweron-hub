export type WireInstallationFamily =
  | 'cable'
  | 'mc'
  | 'raceway'
  | 'feeder'
  | 'custom'

export type WireDisplayStyle =
  | 'solid'
  | 'dashed'
  | 'dotted'

export type WireProfileAllowedTool = 'circuit-path' | 'circuit-arc'

export interface WireProfile {
  id: string
  projectId: string
  name: string
  installationFamily: WireInstallationFamily
  materialDescription?: string
  conductorDescription?: string
  displayColor: string
  displayWidth: number
  displayStyle: WireDisplayStyle
  wastePercent: number
  unitCost?: number
  costReference?: string
  allowedTools: WireProfileAllowedTool[]
  isArchived: boolean
  createdAt: string
  updatedAt: string
  deletedAt?: string
  deletedBy?: string
}

export type WireProfileResolutionStatus =
  | 'ASSIGNED_ACTIVE'
  | 'ASSIGNED_ARCHIVED'
  | 'UNASSIGNED'
  | 'MISSING'

export interface WireProfileResolution {
  status: WireProfileResolutionStatus
  profileId: string | null
  profile?: WireProfile
}
