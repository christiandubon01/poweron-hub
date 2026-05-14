/**
 * src/features/blueprint-vr/blueprintToBuildingModel.ts
 *
 * Converts blueprint context (PDFs, documents, extracted text) into BlueprintBuildingModel.
 *
 * This adapter handles:
 * - Dimension extraction from architectural scales and dimension strings
 * - Parsing dimensions like 12'-6", 12' 6", 12 ft 6 in, 12.5', 150"
 * - Inferring room layouts and wall heights
 * - Providing deterministic fallbacks when exact data is missing
 * - Tracking confidence and warning signals
 */

import type {
  BlueprintBuildingModel,
  BuildingLevelModel,
  BuildingRoomModel,
  BuildingWallModel,
  BuildingOpeningModel,
  BuildingDimensionModel,
  BuildingElectricalAnchorModel,
} from './buildingModel'
import { createEmptyBuildingModel } from './buildingModel'
import type { MeasurementValue, Rectangle, Point2D, Bounds2D } from './measurementTypes'
import { createMeasurement } from './dimensionModel'
import type {
  BlueprintDimensionExtractionInput,
  BlueprintDimensionExtractionResult,
} from './blueprintDimensionExtractor'
import { extractBlueprintDimensions } from './blueprintDimensionExtractor'

// ─────────────────────────────────────────────────────────────────────────────
// Adapter Types
// ─────────────────────────────────────────────────────────────────────────────

export interface BlueprintToBuildingModelInput extends BlueprintDimensionExtractionInput {
  /** Override model ID; if not provided, one is generated */
  modelId?: string
  /** Override model name; if not provided, uses blueprint title or project name */
  modelName?: string
  /** Optional list of known electrical anchors to include in the model */
  electricalAnchors?: Array<{
    type: 'panel' | 'subpanel' | 'breaker' | 'outlet' | 'fixture' | 'disconnect' | 'other'
    position: Point2D
    roomId?: string
    heightAboveFloor?: number // in inches
  }>
}

export interface BlueprintToBuildingModelResult {
  /** The generated building model */
  model: BlueprintBuildingModel
  /** Extraction result with warnings and confidence */
  extraction: BlueprintDimensionExtractionResult
  /** List of any model-level warnings or issues */
  warnings: Array<{ severity: 'info' | 'warning' | 'error'; message: string }>
  /** Overall confidence 0–1 */
  confidence: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Wall creation
// ─────────────────────────────────────────────────────────────────────────────

function createWallsForRoom(
  roomId: string,
  bounds: Bounds2D,
  wallHeight: MeasurementValue,
  thickness?: MeasurementValue,
): BuildingWallModel[] {
  const { min, max } = bounds
  const wallThickness = thickness || createMeasurement(0.5, 'ft', 'default', 1)

  return [
    // North wall
    {
      id: `${roomId}_wall_n`,
      start: { x: min.x, y: max.y },
      end: { x: max.x, y: max.y },
      thickness: wallThickness,
      height: wallHeight,
      openings: [],
    },
    // South wall
    {
      id: `${roomId}_wall_s`,
      start: { x: min.x, y: min.y },
      end: { x: max.x, y: min.y },
      thickness: wallThickness,
      height: wallHeight,
      openings: [],
    },
    // East wall
    {
      id: `${roomId}_wall_e`,
      start: { x: max.x, y: min.y },
      end: { x: max.x, y: max.y },
      thickness: wallThickness,
      height: wallHeight,
      openings: [],
    },
    // West wall
    {
      id: `${roomId}_wall_w`,
      start: { x: min.x, y: min.y },
      end: { x: min.x, y: max.y },
      thickness: wallThickness,
      height: wallHeight,
      openings: [],
    },
  ]
}

// ─────────────────────────────────────────────────────────────────────────────
// Room creation from bounds
// ─────────────────────────────────────────────────────────────────────────────

function createRoomFromBounds(
  roomId: string,
  label: string,
  bounds: Bounds2D,
  wallHeight: MeasurementValue,
  metadata?: {
    type?: 'living' | 'bedroom' | 'kitchen' | 'bath' | 'utility' | 'garage' | 'other'
    floor?: number
  },
): BuildingRoomModel {
  const { min, max } = bounds
  const width = max.x - min.x
  const height = max.y - min.y
  const area = width * height

  return {
    id: roomId,
    label,
    bounds,
    area,
    height: wallHeight,
    walls: createWallsForRoom(roomId, bounds, wallHeight),
    electricalAnchors: [],
    visible: true,
    metadata: {
      type: metadata?.type,
      floor: metadata?.floor ?? 0,
    },
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Level creation
// ─────────────────────────────────────────────────────────────────────────────

function createLevelFromRooms(
  levelNumber: number,
  label: string,
  rooms: BuildingRoomModel[],
  footprint?: Rectangle,
): BuildingLevelModel {
  return {
    levelNumber,
    label,
    rooms,
    footprint,
    visible: true,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main conversion function
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Convert a blueprint document into a BlueprintBuildingModel.
 *
 * This function:
 * 1. Extracts dimensions and scale from blueprint metadata
 * 2. Infers room zones from the extracted footprint
 * 3. Creates a level with rooms, walls, and openings
 * 4. Associates electrical anchors if provided
 * 5. Returns the building model plus extraction details
 *
 * If no dimensions can be extracted, provides a deterministic fallback.
 */
export function convertBlueprintToModel(
  input: BlueprintToBuildingModelInput,
): BlueprintToBuildingModelResult {
  const warnings: Array<{ severity: 'info' | 'warning' | 'error'; message: string }> = []

  // Step 1: Extract dimensions and scale from blueprint
  const extraction = extractBlueprintDimensions(input)

  // Step 2: Build room models from extracted space
  const rooms: BuildingRoomModel[] = extraction.space.rooms.map((zone) => {
    return createRoomFromBounds(
      zone.id,
      zone.label,
      zone.bounds,
      extraction.space.wallHeight,
      {
        type: zone.label.toLowerCase() as
          | 'living'
          | 'bedroom'
          | 'kitchen'
          | 'bath'
          | 'utility'
          | 'garage'
          | 'other',
      },
    )
  })

  // Step 3: Associate electrical anchors with rooms
  const electricalAnchors: BuildingElectricalAnchorModel[] = []
  if (input.electricalAnchors && Array.isArray(input.electricalAnchors)) {
    for (const anchor of input.electricalAnchors) {
      // Find which room contains this point
      let roomId: string | undefined
      let roomLabel: string | undefined

      for (const room of rooms) {
        const { min, max } = room.bounds
        if (anchor.position.x >= min.x && anchor.position.x <= max.x &&
            anchor.position.y >= min.y && anchor.position.y <= max.y) {
          roomId = room.id
          roomLabel = room.label
          break
        }
      }

      const elecAnchor: BuildingElectricalAnchorModel = {
        id: `elec-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        type: anchor.type,
        position: anchor.position,
        roomId,
        roomLabel,
        heightAboveFloor: anchor.heightAboveFloor
          ? { value: anchor.heightAboveFloor, unit: 'in', display: `${anchor.heightAboveFloor}"`, confidence: 1, source: 'user' }
          : undefined,
        visible: true,
      }

      electricalAnchors.push(elecAnchor)

      // Also add to the room if found
      if (roomId) {
        const room = rooms.find((r) => r.id === roomId)
        if (room) {
          if (!room.electricalAnchors) room.electricalAnchors = []
          room.electricalAnchors.push(elecAnchor)
        }
      }
    }
  }

  // Step 4: Create the level
  const level = createLevelFromRooms(
    0,
    'Ground Floor',
    rooms,
    extraction.space.footprint,
  )

  // Step 5: Build the complete model
  const now = new Date().toISOString()
  const modelId = input.modelId || `model-${Date.now()}`
  const modelName = input.modelName || input.title || input.projectName || 'Blueprint Model'

  const model: BlueprintBuildingModel = {
    id: modelId,
    name: modelName,
    footprint: extraction.space.footprint,
    levels: [level],
    wallHeight: extraction.space.wallHeight,
    ceilingHeight: extraction.space.ceilingHeight,
    slabThickness: extraction.space.slabThickness,
    scale: extraction.space.scale,
    confidence: extraction.confidence,
    electricalAnchors,
    metadata: {
      createdAt: now,
      updatedAt: now,
      source: extraction.isFallback ? 'fallback' : 'extraction',
      sourceBlueprint: input.title,
      sourceProject: input.projectName,
      notes: extraction.isFallback
        ? 'Fallback model – exact dimensions unavailable'
        : 'Extracted from blueprint',
      displayLabel: `${input.projectName || 'Project'} – ${input.title || 'Blueprint'}`,
    },
  }

  // Step 6: Collect warnings
  for (const w of extraction.warnings) {
    warnings.push({
      severity: w.code === 'FALLBACK_USED' ? 'warning' : 'info',
      message: w.message,
    })
  }

  if (extraction.isFallback) {
    warnings.push({
      severity: 'warning',
      message: 'Building model is based on fallback dimensions. Consider refining with known building dimensions.',
    })
  }

  return {
    model,
    extraction,
    warnings,
    confidence: extraction.confidence,
  }
}

/**
 * Simple wrapper to convert a blueprint to a model, returning only the model.
 * Use this when you don't need extraction details.
 */
export function blueprintToModel(
  input: BlueprintToBuildingModelInput,
): BlueprintBuildingModel {
  const result = convertBlueprintToModel(input)
  return result.model
}
