/**
 * src/features/blueprint-vr/buildingModelDefaults.ts
 *
 * Deterministic fallback building models for different layout types.
 * Used when exact blueprint dimensions are unavailable but we need a sensible default model.
 *
 * Supports:
 * - Residential layout (living/bedroom/kitchen/bath)
 * - Commercial suite layout (main/offices/conference/break)
 * - Salon / tenant improvement layout (service areas + reception)
 * - Multi-room utility/electrical layout
 * - Utility/electrical room with panel placement
 */

import type { BlueprintBuildingModel, BuildingRoomModel, BuildingLevelModel } from './buildingModel'
import type { MeasurementValue, Rectangle, Bounds2D } from './measurementTypes'
import { createMeasurement } from './dimensionModel'

// ─────────────────────────────────────────────────────────────────────────────
// Layout Type Detection
// ─────────────────────────────────────────────────────────────────────────────

export type DefaultLayoutType =
  | 'residential'
  | 'commercial'
  | 'salon'
  | 'utility'
  | 'electrical'
  | 'generic'

/**
 * Detect likely layout type from blueprint metadata.
 */
export function detectLayoutType(
  title?: string,
  projectName?: string,
  discipline?: string,
): DefaultLayoutType {
  const combined = `${title || ''} ${projectName || ''} ${discipline || ''}`.toLowerCase()

  // Salon / tenant improvement
  if (
    combined.includes('salon') ||
    combined.includes('spa') ||
    combined.includes('beauty') ||
    combined.includes('tenant')
  ) {
    return 'salon'
  }

  // Electrical / utility
  if (
    combined.includes('electrical') ||
    combined.includes('panel') ||
    combined.includes('utility') ||
    combined.includes('mep')
  ) {
    return 'electrical'
  }

  // Commercial
  if (
    combined.includes('office') ||
    combined.includes('commercial') ||
    combined.includes('suite') ||
    combined.includes('corporate')
  ) {
    return 'commercial'
  }

  // Residential
  if (
    combined.includes('residential') ||
    combined.includes('house') ||
    combined.includes('home') ||
    combined.includes('apartment')
  ) {
    return 'residential'
  }

  return 'generic'
}

// ─────────────────────────────────────────────────────────────────────────────
// Room creation helpers
// ─────────────────────────────────────────────────────────────────────────────

function createRoom(
  id: string,
  label: string,
  bounds: Bounds2D,
  wallHeight: MeasurementValue,
  type: 'living' | 'bedroom' | 'kitchen' | 'bath' | 'utility' | 'garage' | 'other',
): BuildingRoomModel {
  const { min, max } = bounds
  const width = max.x - min.x
  const height = max.y - min.y
  const area = width * height

  return {
    id,
    label,
    bounds,
    area,
    height: wallHeight,
    walls: createWallsForBounds(id, bounds, wallHeight),
    electricalAnchors: [],
    visible: true,
    metadata: {
      type,
      floor: 0,
    },
  }
}

function createWallsForBounds(id: string, bounds: Bounds2D, wallHeight: MeasurementValue) {
  const { min, max } = bounds
  const thickness = createMeasurement(0.5, 'ft', 'default', 1)

  return [
    { id: `${id}_wall_n`, start: { x: min.x, y: max.y }, end: { x: max.x, y: max.y }, thickness, height: wallHeight, openings: [] },
    { id: `${id}_wall_s`, start: { x: min.x, y: min.y }, end: { x: max.x, y: min.y }, thickness, height: wallHeight, openings: [] },
    { id: `${id}_wall_e`, start: { x: max.x, y: min.y }, end: { x: max.x, y: max.y }, thickness, height: wallHeight, openings: [] },
    { id: `${id}_wall_w`, start: { x: min.x, y: min.y }, end: { x: min.x, y: max.y }, thickness, height: wallHeight, openings: [] },
  ]
}

// ─────────────────────────────────────────────────────────────────────────────
// Layout definitions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Residential layout: 40 ft × 30 ft
 * - Main living area
 * - Kitchen
 * - Bedroom
 * - Bathroom
 * - Utility/Electrical
 */
function createResidentialLayout(wallHeight: MeasurementValue): BuildingRoomModel[] {
  const w = 40
  const h = 30

  return [
    createRoom('main', 'Living Room', { min: { x: 0, y: 0 }, max: { x: w * 0.6, y: h * 0.67 } }, wallHeight, 'living'),
    createRoom('kitchen', 'Kitchen', { min: { x: w * 0.6, y: 0 }, max: { x: w, y: h * 0.53 } }, wallHeight, 'kitchen'),
    createRoom('bedroom', 'Bedroom', { min: { x: 0, y: h * 0.67 }, max: { x: w * 0.5, y: h } }, wallHeight, 'bedroom'),
    createRoom('bath', 'Bathroom', { min: { x: w * 0.5, y: h * 0.67 }, max: { x: w * 0.8, y: h } }, wallHeight, 'bath'),
    createRoom('utility', 'Utility/Panel', { min: { x: w * 0.8, y: 0 }, max: { x: w, y: h } }, wallHeight, 'utility'),
  ]
}

/**
 * Commercial suite layout: 50 ft × 40 ft
 * - Main reception/lobby
 * - Conference room
 * - Office areas
 * - Break room
 * - Utility
 */
function createCommercialLayout(wallHeight: MeasurementValue): BuildingRoomModel[] {
  const w = 50
  const h = 40

  return [
    createRoom('reception', 'Reception', { min: { x: 0, y: 0 }, max: { x: w * 0.3, y: h * 0.6 } }, wallHeight, 'other'),
    createRoom('conference', 'Conference', { min: { x: w * 0.3, y: 0 }, max: { x: w * 0.7, y: h * 0.6 } }, wallHeight, 'other'),
    createRoom('office', 'Office', { min: { x: w * 0.7, y: 0 }, max: { x: w, y: h * 0.6 } }, wallHeight, 'other'),
    createRoom('break', 'Break Room', { min: { x: 0, y: h * 0.6 }, max: { x: w * 0.5, y: h } }, wallHeight, 'kitchen'),
    createRoom('utility', 'Utility/Panel', { min: { x: w * 0.5, y: h * 0.6 }, max: { x: w, y: h } }, wallHeight, 'utility'),
  ]
}

/**
 * Salon / tenant improvement layout: 35 ft × 25 ft
 * - Service area 1 (hair/nails/massage station)
 * - Service area 2
 * - Waiting/reception
 * - Bathroom
 * - Utility/Panel (electrical for styling stations)
 */
function createSalonLayout(wallHeight: MeasurementValue): BuildingRoomModel[] {
  const w = 35
  const h = 25

  return [
    createRoom('service1', 'Service Area 1', { min: { x: 0, y: 0 }, max: { x: w * 0.5, y: h * 0.65 } }, wallHeight, 'other'),
    createRoom('service2', 'Service Area 2', { min: { x: w * 0.5, y: 0 }, max: { x: w, y: h * 0.65 } }, wallHeight, 'other'),
    createRoom('waiting', 'Waiting/Reception', { min: { x: 0, y: h * 0.65 }, max: { x: w * 0.65, y: h } }, wallHeight, 'living'),
    createRoom('bath', 'Bathroom', { min: { x: w * 0.65, y: h * 0.65 }, max: { x: w, y: h } }, wallHeight, 'bath'),
  ]
}

/**
 * Utility / electrical room layout: 30 ft × 20 ft
 * Single large room with electrical panel, disconnect, subpanels
 */
function createUtilityLayout(wallHeight: MeasurementValue): BuildingRoomModel[] {
  const w = 30
  const h = 20

  return [
    createRoom('electrical', 'Electrical Panel Room', { min: { x: 0, y: 0 }, max: { x: w, y: h } }, wallHeight, 'utility'),
  ]
}

/**
 * Generic fallback layout: 40 ft × 30 ft
 * Simple rectangular space with one utility room
 */
function createGenericLayout(wallHeight: MeasurementValue): BuildingRoomModel[] {
  const w = 40
  const h = 30

  return [
    createRoom('main', 'Main Space', { min: { x: 0, y: 0 }, max: { x: w * 0.85, y: h } }, wallHeight, 'living'),
    createRoom('utility', 'Utility/Panel', { min: { x: w * 0.85, y: 0 }, max: { x: w, y: h } }, wallHeight, 'utility'),
  ]
}

// ─────────────────────────────────────────────────────────────────────────────
// Default model factory
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a default building model for the given layout type.
 *
 * @param layoutType The layout type to use
 * @param title Blueprint or project title (for naming)
 * @param projectName Project name (for display)
 * @returns A complete BlueprintBuildingModel with default dimensions
 */
export function createDefaultBuildingModel(
  layoutType: DefaultLayoutType = 'generic',
  title?: string,
  projectName?: string,
): BlueprintBuildingModel {
  const wallHeight = createMeasurement(9, 'ft', 'default', 0.5)
  const ceilingHeight = createMeasurement(9, 'ft', 'default', 0.5)
  const slabThickness = createMeasurement(4, 'in', 'default', 0.5)

  let rooms: BuildingRoomModel[]
  let footprint: Rectangle
  let name: string

  switch (layoutType) {
    case 'residential':
      rooms = createResidentialLayout(wallHeight)
      footprint = { x: 0, y: 0, width: 40, height: 30 }
      name = 'Residential Layout'
      break
    case 'commercial':
      rooms = createCommercialLayout(wallHeight)
      footprint = { x: 0, y: 0, width: 50, height: 40 }
      name = 'Commercial Suite'
      break
    case 'salon':
      rooms = createSalonLayout(wallHeight)
      footprint = { x: 0, y: 0, width: 35, height: 25 }
      name = 'Salon / Tenant Improvement'
      break
    case 'electrical':
    case 'utility':
      rooms = createUtilityLayout(wallHeight)
      footprint = { x: 0, y: 0, width: 30, height: 20 }
      name = 'Electrical Panel Room'
      break
    case 'generic':
    default:
      rooms = createGenericLayout(wallHeight)
      footprint = { x: 0, y: 0, width: 40, height: 30 }
      name = 'Generic Layout'
  }

  const level: BuildingLevelModel = {
    levelNumber: 0,
    label: 'Ground Floor',
    rooms,
    footprint,
    visible: true,
  }

  const now = new Date().toISOString()

  return {
    id: `default-${layoutType}-${Date.now()}`,
    name: title ? `${title} (${name})` : name,
    footprint,
    levels: [level],
    wallHeight,
    ceilingHeight,
    slabThickness,
    scale: {
      pixelsPerUnit: 1,
      unit: 'ft',
      source: 'default',
    },
    confidence: 0.2, // Low confidence since it's just a template
    metadata: {
      createdAt: now,
      updatedAt: now,
      source: 'fallback',
      sourceProject: projectName,
      sourceBlueprint: title,
      notes: `Default ${layoutType} layout – replace with actual blueprint dimensions`,
      displayLabel: `${projectName || 'Project'} – Default Layout`,
    },
  }
}

/**
 * Create a default model based on blueprint metadata, auto-detecting layout type.
 */
export function createAutoDetectedDefaultModel(
  title?: string,
  projectName?: string,
  discipline?: string,
): BlueprintBuildingModel {
  const layoutType = detectLayoutType(title, projectName, discipline)
  return createDefaultBuildingModel(layoutType, title, projectName)
}
