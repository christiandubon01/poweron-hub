import { createWireProfile, sanitizeWireProfile } from './wireProfileModel'
import type {
  WireDisplayStyle,
  WireInstallationFamily,
  WireProfile,
  WireProfileAllowedTool,
} from './types'

export type StarterWireProfileDefinition = {
  name: string
  installationFamily: WireInstallationFamily
  materialDescription?: string
  conductorDescription?: string
  displayColor: string
  displayWidth: number
  displayStyle: WireDisplayStyle
  wastePercent: number
  allowedTools: WireProfileAllowedTool[]
}

export type StarterWireProfileResult = {
  createdNames: string[]
  skippedNames: string[]
  failed: Array<{ name: string; error: string }>
  warnings: string[]
}

export const STARTER_WIRE_PROFILES: StarterWireProfileDefinition[] = [
  {
    name: 'NM-B 12/2 Copper',
    installationFamily: 'cable',
    materialDescription: 'NM-B cable',
    conductorDescription: '12/2 Copper',
    displayColor: '#facc15',
    displayWidth: 2,
    displayStyle: 'solid',
    wastePercent: 0,
    allowedTools: ['circuit-path', 'circuit-arc'],
  },
  {
    name: 'NM-B 12/3 Copper',
    installationFamily: 'cable',
    materialDescription: 'NM-B cable',
    conductorDescription: '12/3 Copper',
    displayColor: '#a855f7',
    displayWidth: 2,
    displayStyle: 'solid',
    wastePercent: 0,
    allowedTools: ['circuit-path', 'circuit-arc'],
  },
  {
    name: 'MC 12/2 Copper',
    installationFamily: 'mc',
    materialDescription: 'MC cable',
    conductorDescription: '12/2 Copper',
    displayColor: '#ef4444',
    displayWidth: 2,
    displayStyle: 'solid',
    wastePercent: 0,
    allowedTools: ['circuit-path', 'circuit-arc'],
  },
  {
    name: 'MC 10/2 Copper',
    installationFamily: 'mc',
    materialDescription: 'MC cable',
    conductorDescription: '10/2 Copper',
    displayColor: '#06b6d4',
    displayWidth: 2.5,
    displayStyle: 'solid',
    wastePercent: 0,
    allowedTools: ['circuit-path', 'circuit-arc'],
  },
  {
    name: 'Custom Raceway',
    installationFamily: 'raceway',
    materialDescription: 'Custom raceway',
    conductorDescription: 'Project-defined conductors',
    displayColor: '#64748b',
    displayWidth: 3,
    displayStyle: 'dashed',
    wastePercent: 0,
    allowedTools: ['circuit-path', 'circuit-arc'],
  },
]

export function normalizeWireProfileName(name: string): string {
  return String(name || '').trim().replace(/\s+/g, ' ').toLowerCase()
}

export function getMissingStarterWireProfiles(existingProfiles: Array<Pick<WireProfile, 'name'> | { name?: string }>): StarterWireProfileDefinition[] {
  const existingNames = new Set((Array.isArray(existingProfiles) ? existingProfiles : []).map((profile) => normalizeWireProfileName(profile.name || '')))
  return STARTER_WIRE_PROFILES.filter((starter) => !existingNames.has(normalizeWireProfileName(starter.name)))
}

export function buildStarterWireProfileCreateInput(projectId: string, starter: StarterWireProfileDefinition) {
  return {
    projectId,
    name: starter.name,
    installationFamily: starter.installationFamily,
    materialDescription: starter.materialDescription,
    conductorDescription: starter.conductorDescription,
    displayColor: starter.displayColor,
    displayWidth: starter.displayWidth,
    displayStyle: starter.displayStyle,
    wastePercent: starter.wastePercent,
    allowedTools: starter.allowedTools,
  }
}

export function starterDefinitionSanitizes(projectId: string, starter: StarterWireProfileDefinition): boolean {
  try {
    return !!sanitizeWireProfile(createWireProfile(buildStarterWireProfileCreateInput(projectId, starter)))
  } catch {
    return false
  }
}

export function summarizeStarterWireProfileResult(result: StarterWireProfileResult): { tone: 'success' | 'warning' | 'error'; text: string } {
  const created = result.createdNames.length
  const skipped = result.skippedNames.length
  const failed = result.failed.length
  const warnings = result.warnings.length
  if (created === 0 && failed === 0 && skipped > 0) {
    return { tone: warnings > 0 ? 'warning' : 'success', text: 'All starter profiles already exist.' }
  }
  const parts: string[] = []
  if (created > 0) parts.push(`Created ${created}`)
  if (skipped > 0) parts.push(`skipped ${skipped}`)
  if (failed > 0) parts.push(`failed ${failed}`)
  if (warnings > 0) parts.push(`${warnings} sync warning${warnings === 1 ? '' : 's'}`)
  if (parts.length === 0) return { tone: 'warning', text: 'No starter profiles were created.' }
  return {
    tone: failed > 0 ? 'error' : warnings > 0 || skipped > 0 ? 'warning' : 'success',
    text: `${parts.join(', ')}.`,
  }
}
