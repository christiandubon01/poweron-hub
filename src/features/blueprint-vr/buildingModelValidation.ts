/**
 * src/features/blueprint-vr/buildingModelValidation.ts
 *
 * Validation utilities for BlueprintBuildingModel.
 *
 * Provides:
 * - validateBuildingModel(model) — complete model validation
 * - validateRoomsInsideFootprint(model) — geometric bounds checking
 * - validateWallHeights(model) — height dimension validation
 * - validateDimensionsNonZero(model) — measurement non-zero checks
 * - validateElectricalAnchors(model) — electrical placement validation
 *
 * All validators return warnings/errors with severity and UI-friendly summaries.
 */

import type {
  BlueprintBuildingModel,
  BuildingRoomModel,
  BuildingLevelModel,
} from './buildingModel'

// ─────────────────────────────────────────────────────────────────────────────
// Validation Message Types
// ─────────────────────────────────────────────────────────────────────────────

export type ValidationSeverity = 'info' | 'warning' | 'error'

export interface ValidationMessage {
  severity: ValidationSeverity
  code: string
  field: string
  message: string
  details?: string
}

export interface ValidationResult {
  isValid: boolean
  messages: ValidationMessage[]
  errorCount: number
  warningCount: number
  infoCount: number
  summary: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Validation Helpers
// ─────────────────────────────────────────────────────────────────────────────

function createValidationResult(messages: ValidationMessage[]): ValidationResult {
  const errorCount = messages.filter((m) => m.severity === 'error').length
  const warningCount = messages.filter((m) => m.severity === 'warning').length
  const infoCount = messages.filter((m) => m.severity === 'info').length
  const isValid = errorCount === 0

  let summary = ''
  if (errorCount > 0) {
    summary = `${errorCount} error${errorCount !== 1 ? 's' : ''}`
  }
  if (warningCount > 0) {
    if (summary) summary += ', '
    summary += `${warningCount} warning${warningCount !== 1 ? 's' : ''}`
  }
  if (infoCount > 0 && errorCount === 0 && warningCount === 0) {
    summary = `${infoCount} info message${infoCount !== 1 ? 's' : ''}`
  }
  if (!summary) {
    summary = 'No issues found'
  }

  return {
    isValid,
    messages,
    errorCount,
    warningCount,
    infoCount,
    summary,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Specific Validators
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validate that all rooms fit within the building footprint.
 */
export function validateRoomsInsideFootprint(model: BlueprintBuildingModel): ValidationMessage[] {
  const messages: ValidationMessage[] = []
  const { footprint } = model

  if (footprint.width === 0 || footprint.height === 0) {
    messages.push({
      severity: 'warning',
      code: 'ZERO_FOOTPRINT',
      field: 'footprint',
      message: 'Building footprint has zero width or height',
      details: `Width: ${footprint.width} ft, Height: ${footprint.height} ft`,
    })
    return messages
  }

  for (const level of model.levels) {
    for (const room of level.rooms) {
      const { min, max } = room.bounds

      if (min.x < footprint.x || max.x > footprint.x + footprint.width) {
        messages.push({
          severity: 'warning',
          code: 'ROOM_OUTSIDE_FOOTPRINT_X',
          field: `${level.label}.${room.label}`,
          message: `Room "${room.label}" extends outside footprint bounds (X-axis)`,
          details: `Room X: [${min.x}, ${max.x}], Footprint X: [${footprint.x}, ${footprint.x + footprint.width}]`,
        })
      }

      if (min.y < footprint.y || max.y > footprint.y + footprint.height) {
        messages.push({
          severity: 'warning',
          code: 'ROOM_OUTSIDE_FOOTPRINT_Y',
          field: `${level.label}.${room.label}`,
          message: `Room "${room.label}" extends outside footprint bounds (Y-axis)`,
          details: `Room Y: [${min.y}, ${max.y}], Footprint Y: [${footprint.y}, ${footprint.y + footprint.height}]`,
        })
      }
    }
  }

  return messages
}

/**
 * Validate wall heights are reasonable.
 */
export function validateWallHeights(model: BlueprintBuildingModel): ValidationMessage[] {
  const messages: ValidationMessage[] = []

  // Global wall height check
  const globalHeightFt = model.wallHeight.unit === 'ft'
    ? model.wallHeight.value
    : model.wallHeight.value / 12 // convert from inches

  if (globalHeightFt < 7 || globalHeightFt > 15) {
    messages.push({
      severity: 'warning',
      code: 'UNUSUAL_WALL_HEIGHT',
      field: 'wallHeight',
      message: `Global wall height is unusual: ${model.wallHeight.display}`,
      details: `Standard residential: 8-10 ft, Commercial: 9-12 ft`,
    })
  }

  // Check individual room heights
  for (const level of model.levels) {
    for (const room of level.rooms) {
      const roomHeightFt = room.height.unit === 'ft'
        ? room.height.value
        : room.height.value / 12

      if (roomHeightFt < 7 || roomHeightFt > 15) {
        messages.push({
          severity: 'info',
          code: 'UNUSUAL_ROOM_HEIGHT',
          field: `${level.label}.${room.label}`,
          message: `Room "${room.label}" has unusual height: ${room.height.display}`,
        })
      }
    }
  }

  return messages
}

/**
 * Validate that dimensions are non-zero where required.
 */
export function validateDimensionsNonZero(model: BlueprintBuildingModel): ValidationMessage[] {
  const messages: ValidationMessage[] = []

  // Footprint
  if (model.footprint.width === 0 || model.footprint.height === 0) {
    messages.push({
      severity: 'error',
      code: 'ZERO_FOOTPRINT_DIMENSION',
      field: 'footprint',
      message: 'Building footprint width or height is zero',
      details: `Width: ${model.footprint.width}, Height: ${model.footprint.height}`,
    })
  }

  // Room dimensions
  for (const level of model.levels) {
    for (const room of level.rooms) {
      const { min, max } = room.bounds
      const width = max.x - min.x
      const height = max.y - min.y

      if (width === 0 || height === 0) {
        messages.push({
          severity: 'error',
          code: 'ZERO_ROOM_DIMENSION',
          field: `${level.label}.${room.label}`,
          message: `Room "${room.label}" has zero width or height`,
          details: `Width: ${width}, Height: ${height}`,
        })
      }

      // Wall check
      for (const wall of room.walls) {
        const wallLength = Math.sqrt(
          (wall.end.x - wall.start.x) ** 2 + (wall.end.y - wall.start.y) ** 2,
        )

        if (wallLength === 0) {
          messages.push({
            severity: 'warning',
            code: 'ZERO_WALL_LENGTH',
            field: `${level.label}.${room.label}.${wall.id}`,
            message: `Wall "${wall.id}" has zero length`,
          })
        }
      }
    }
  }

  // Wall height
  const wallHeightVal = model.wallHeight.unit === 'ft'
    ? model.wallHeight.value
    : model.wallHeight.value / 12

  if (wallHeightVal <= 0) {
    messages.push({
      severity: 'error',
      code: 'INVALID_WALL_HEIGHT',
      field: 'wallHeight',
      message: `Wall height is not positive: ${model.wallHeight.display}`,
    })
  }

  return messages
}

/**
 * Validate electrical anchors are within reasonable bounds.
 */
export function validateElectricalAnchors(model: BlueprintBuildingModel): ValidationMessage[] {
  const messages: ValidationMessage[] = []

  if (!model.electricalAnchors || model.electricalAnchors.length === 0) {
    return messages // No anchors is OK, return info message if needed
  }

  const { footprint } = model

  for (const anchor of model.electricalAnchors) {
    // Check position is within footprint
    if (
      anchor.position.x < footprint.x ||
      anchor.position.x > footprint.x + footprint.width ||
      anchor.position.y < footprint.y ||
      anchor.position.y > footprint.y + footprint.height
    ) {
      messages.push({
        severity: 'warning',
        code: 'ANCHOR_OUTSIDE_FOOTPRINT',
        field: `electrical.${anchor.id}`,
        message: `Electrical anchor "${anchor.id}" (${anchor.type}) is outside footprint`,
        details: `Position: (${anchor.position.x}, ${anchor.position.y})`,
      })
    }

    // Check panel is in a utility-type room
    if (anchor.type === 'panel' && anchor.roomLabel) {
      if (!anchor.roomLabel.toLowerCase().includes('utility') &&
          !anchor.roomLabel.toLowerCase().includes('electrical') &&
          !anchor.roomLabel.toLowerCase().includes('panel')) {
        messages.push({
          severity: 'info',
          code: 'PANEL_IN_NON_UTILITY_ROOM',
          field: `electrical.${anchor.id}`,
          message: `Main panel should typically be in a utility/electrical room, but is in: ${anchor.roomLabel}`,
        })
      }
    }

    // Validate height if present
    if (anchor.heightAboveFloor) {
      const heightIn = anchor.heightAboveFloor.unit === 'in'
        ? anchor.heightAboveFloor.value
        : anchor.heightAboveFloor.value * 12

      // Outlets typically 18" above floor, panels typically 48–60"
      if (anchor.type === 'outlet' && (heightIn < 12 || heightIn > 60)) {
        messages.push({
          severity: 'info',
          code: 'UNUSUAL_OUTLET_HEIGHT',
          field: `electrical.${anchor.id}`,
          message: `Outlet height is unusual: ${anchor.heightAboveFloor.display} (typical: 18")`,
        })
      }

      if (anchor.type === 'panel' && (heightIn < 36 || heightIn > 72)) {
        messages.push({
          severity: 'info',
          code: 'UNUSUAL_PANEL_HEIGHT',
          field: `electrical.${anchor.id}`,
          message: `Panel height is unusual: ${anchor.heightAboveFloor.display} (typical: 48-60")`,
        })
      }
    }
  }

  return messages
}

// ─────────────────────────────────────────────────────────────────────────────
// Composite Validator
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Comprehensive validation of a building model.
 * Runs all individual validators and returns aggregated results.
 */
export function validateBuildingModel(model: BlueprintBuildingModel): ValidationResult {
  const allMessages: ValidationMessage[] = []

  // Basic structure checks
  if (!model.levels || model.levels.length === 0) {
    allMessages.push({
      severity: 'warning',
      code: 'NO_LEVELS',
      field: 'levels',
      message: 'Model has no levels defined',
    })
  }

  // Run all validators
  allMessages.push(...validateDimensionsNonZero(model))
  allMessages.push(...validateRoomsInsideFootprint(model))
  allMessages.push(...validateWallHeights(model))
  allMessages.push(...validateElectricalAnchors(model))

  // Check confidence
  if (model.confidence < 0.2) {
    allMessages.push({
      severity: 'info',
      code: 'LOW_CONFIDENCE',
      field: 'metadata.confidence',
      message: `Model confidence is low: ${(model.confidence * 100).toFixed(0)}%`,
      details: 'This model was generated from limited blueprint data. Consider refining with known dimensions.',
    })
  }

  // Check for missing or empty rooms
  let totalRooms = 0
  for (const level of model.levels) {
    totalRooms += level.rooms.length
  }

  if (totalRooms === 0) {
    allMessages.push({
      severity: 'warning',
      code: 'NO_ROOMS',
      field: 'levels[].rooms',
      message: 'Model has no rooms defined',
    })
  }

  return createValidationResult(allMessages)
}

/**
 * Quick validation check — returns a simple pass/fail and summary.
 * Useful for progress indicators or quick UI feedback.
 */
export function isModelValid(model: BlueprintBuildingModel): boolean {
  const result = validateBuildingModel(model)
  return result.isValid
}

/**
 * Get validation summary string for UI display.
 */
export function getValidationSummary(model: BlueprintBuildingModel): string {
  const result = validateBuildingModel(model)
  return result.summary
}
