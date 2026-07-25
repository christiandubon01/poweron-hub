import {
  WIRE_DISPLAY_STYLES,
  WIRE_INSTALLATION_FAMILIES,
  WIRE_PROFILE_ALLOWED_TOOLS,
} from './wireProfileModel'
import type {
  WireDisplayStyle,
  WireInstallationFamily,
  WireProfileAllowedTool,
} from './types'

export type WireProfileDraft = {
  name: string
  installationFamily: WireInstallationFamily | string
  materialDescription?: string
  conductorDescription?: string
  displayColor: string
  displayWidth: number | string
  displayStyle: WireDisplayStyle | string
  wastePercent: number | string
  unitCost?: number | string
  costReference?: string
  allowedTools: Array<WireProfileAllowedTool | string>
}

export type WireProfileDraftErrors = Partial<Record<keyof WireProfileDraft, string>>

export type WireProfileDraftValidationResult = {
  valid: boolean
  errors: WireProfileDraftErrors
  value?: {
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
  }
}

const HEX_COLOR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/
const FAMILY_SET = new Set<string>(WIRE_INSTALLATION_FAMILIES)
const STYLE_SET = new Set<string>(WIRE_DISPLAY_STYLES)
const TOOL_SET = new Set<string>(WIRE_PROFILE_ALLOWED_TOOLS)

function trimOptional(value: unknown): string | undefined {
  const trimmed = String(value ?? '').trim()
  return trimmed || undefined
}

export function defaultWireProfileDraft(): WireProfileDraft {
  return {
    name: '',
    installationFamily: 'cable',
    materialDescription: '',
    conductorDescription: '',
    displayColor: '#facc15',
    displayWidth: 2,
    displayStyle: 'solid',
    wastePercent: 0,
    unitCost: '',
    costReference: '',
    allowedTools: ['circuit-path', 'circuit-arc'],
  }
}

export function validateWireProfileDraft(draft: WireProfileDraft): WireProfileDraftValidationResult {
  const errors: WireProfileDraftErrors = {}
  const name = String(draft.name ?? '').trim()
  const installationFamily = String(draft.installationFamily ?? '').trim()
  const displayColor = String(draft.displayColor ?? '').trim()
  const displayStyle = String(draft.displayStyle ?? '').trim()
  const displayWidth = Number(draft.displayWidth)
  const wastePercent = draft.wastePercent === '' ? Number.NaN : Number(draft.wastePercent)
  const hasUnitCost = draft.unitCost !== undefined && draft.unitCost !== null && String(draft.unitCost).trim() !== ''
  const unitCost = hasUnitCost ? Number(draft.unitCost) : undefined
  const allowedTools = Array.from(new Set(
    (Array.isArray(draft.allowedTools) ? draft.allowedTools : [])
      .map((tool) => String(tool || '').trim())
      .filter(Boolean)
  ))

  if (!name) errors.name = 'Profile name is required.'
  if (!FAMILY_SET.has(installationFamily)) errors.installationFamily = 'Choose a supported installation family.'
  if (!HEX_COLOR_RE.test(displayColor)) errors.displayColor = 'Use a supported hex color.'
  if (!Number.isFinite(displayWidth) || displayWidth <= 0) errors.displayWidth = 'Display width must be greater than zero.'
  if (!STYLE_SET.has(displayStyle)) errors.displayStyle = 'Choose a supported display style.'
  if (!Number.isFinite(wastePercent) || wastePercent < 0) errors.wastePercent = 'Waste percent cannot be below 0.'
  else if (wastePercent > 100) errors.wastePercent = 'Waste percent cannot exceed 100.'
  if (hasUnitCost && (unitCost == null || !Number.isFinite(unitCost) || unitCost < 0)) errors.unitCost = 'Unit cost must be zero or greater.'
  if (allowedTools.length === 0) errors.allowedTools = 'Choose at least one allowed tool.'
  else if (allowedTools.some((tool) => !TOOL_SET.has(tool))) errors.allowedTools = 'Choose supported allowed tools.'

  if (Object.keys(errors).length > 0) return { valid: false, errors }

  return {
    valid: true,
    errors: {},
    value: {
      name,
      installationFamily: installationFamily as WireInstallationFamily,
      materialDescription: trimOptional(draft.materialDescription),
      conductorDescription: trimOptional(draft.conductorDescription),
      displayColor,
      displayWidth,
      displayStyle: displayStyle as WireDisplayStyle,
      wastePercent,
      ...(unitCost != null ? { unitCost } : {}),
      costReference: trimOptional(draft.costReference),
      allowedTools: allowedTools as WireProfileAllowedTool[],
    },
  }
}
