/**
 * src/features/blueprint-vr/electrical3DPlacement.ts
 *
 * Electrical 3D placement engine for Blueprint VR.
 * Places Power On electrical construction stages inside Planner5D-style 3D space.
 *
 * Stages:
 *   - underground: below-slab conduits, floor boxes, grounding
 *   - roughIn: wall boxes, conduit runs, panels, homeruns
 *   - trim: outlets, switches, fixtures, covers
 *   - finished: labeled devices, circuits, as-built markers
 *
 * All placement is deterministic, geometry-based, no external APIs.
 */

import type { VRStage } from './types'
import type { BlueprintBuildingModel, BuildingWallModel, BuildingOpeningModel } from './buildingModel'
import type { GeoShape, Pt } from './spaceGeometry'

// ─── Electrical Component Models ────────────────────────────────────────────

export interface ElectricalComponent {
  id: string
  label: string
  stage: VRStage
  category: string
  worldPos: { x: number; z: number; y: number } // world coordinates
  screenPos: Pt // isometric screen coordinates
  color: string
  size: number // visual radius in px
  description?: string
}

export interface ElectricalPlacementGroup {
  stage: VRStage
  components: ElectricalComponent[]
  shapes: GeoShape[]
}

/**
 * Electrical placement hints for component positioning logic.
 */
export interface ElectricalPlacementHints {
  panelWallIndex?: number // which wall to place panel on
  receptaclesPerWall?: number
  switchesPerOpening?: number
  lightingPerRoom?: number
}

// ─── Placement Constants ────────────────────────────────────────────────────

const UNDERGROUND_COLORS = {
  conduit: '#E07020',
  serviceGround: '#FF5252',
  floorBox: '#FFA040',
  slab: '#FF8C42',
  conductor: '#FF6B6B',
}

const ROUGHIN_COLORS = {
  deviceBox: '#3B82F6',
  panel: '#EAB308',
  jbox: '#93C5FD',
  conduit: '#60A5FA',
  homerun: '#FBBF24',
}

const TRIM_COLORS = {
  receptacle: '#22C55E',
  switch: '#4ADE80',
  fixture: '#86EFAC',
  cover: '#34D399',
}

const FINISHED_COLORS = {
  device: '#06B6D4',
  circuit: '#A78BFA',
  path: '#67E8F9',
  marker: '#5B21B6',
}

// ─── World-to-Screen Projection (mirrors spaceGeometry) ──────────────────────

const SCALE = 8
const ISO_X = SCALE * Math.cos(Math.PI / 6)  // ≈ 6.928
const ISO_Y = SCALE * Math.sin(Math.PI / 6)  // ≈ 4.0
const ISO_H = 14

const BASE_CX = 260
const BASE_CY = 160

function worldToScreen(x: number, z: number, y: number): Pt {
  return {
    sx: (x - z) * ISO_X + BASE_CX,
    sy: (x + z) * ISO_Y - y * ISO_H + BASE_CY,
  }
}

// ─── Placement Helpers ──────────────────────────────────────────────────────

/**
 * Place components on wall faces (receptacles, switches, etc.)
 * Wall faces are vertical surfaces with world coordinates mapping to screen.
 */
function placeComponentsOnWall(
  wall: BuildingWallModel,
  count: number,
  color: string,
  stage: VRStage,
  category: string,
  baseHeight: number = 1.5,
): ElectricalComponent[] {
  const components: ElectricalComponent[] = []
  
  if (count <= 0) return components
  
  // Distribute components along wall length (2D plane x,y where y is depth)
  const wallLength = Math.hypot(
    wall.end.x - wall.start.x,
    wall.end.y - wall.start.y,
  )
  
  for (let i = 1; i <= count; i++) {
    const t = i / (count + 1)
    const worldX = wall.start.x + (wall.end.x - wall.start.x) * t
    const worldY_2D = wall.start.y + (wall.end.y - wall.start.y) * t
    const worldY_3D = baseHeight
    
    // Map 2D building coords to 3D world (x, y_2D -> x, z; y_3D -> y)
    const screenPos = worldToScreen(worldX, worldY_2D, worldY_3D)
    
    components.push({
      id: `${category}-wall-${i}`,
      label: `${category} #${i}`,
      stage,
      category,
      worldPos: { x: worldX, z: worldY_2D, y: worldY_3D },
      screenPos,
      color,
      size: 4,
    })
  }
  
  return components
}

/**
 * Place components on floor (floor boxes, slab boxes, etc.)
 */
function placeComponentsOnFloor(
  model: BlueprintBuildingModel,
  count: number,
  color: string,
  stage: VRStage,
  category: string,
  verticalOffset: number = 0.1,
): ElectricalComponent[] {
  const components: ElectricalComponent[] = []
  
  if (count <= 0) return components
  
  const level = model.levels[0]
  if (!level) return components
  
  const room = level.rooms[0]
  if (!room) return components
  
  // Place around floor in grid pattern using bounds
  const { min, max } = room.bounds
  const width = max.x - min.x
  const depth = max.y - min.y
  
  const cols = Math.ceil(Math.sqrt(count))
  const rows = Math.ceil(count / cols)
  
  const colSpacing = width / (cols + 1)
  const rowSpacing = depth / (rows + 1)
  
  let idx = 0
  for (let row = 1; row <= rows && idx < count; row++) {
    for (let col = 1; col <= cols && idx < count; col++) {
      const worldX = min.x + col * colSpacing
      const worldZ = min.y + row * rowSpacing
      const worldY = verticalOffset
      
      const screenPos = worldToScreen(worldX, worldZ, worldY)
      
      components.push({
        id: `${category}-floor-${idx}`,
        label: `${category} #${idx}`,
        stage,
        category,
        worldPos: { x: worldX, z: worldZ, y: worldY },
        screenPos,
        color,
        size: 3,
      })
      
      idx++
    }
  }
  
  return components
}

/**
 * Place components near wall openings (doors, windows)
 */
function placeComponentsNearOpenings(
  walls: BuildingWallModel[],
  count: number,
  color: string,
  stage: VRStage,
  category: string,
  heightOffset: number = 1.2,
): ElectricalComponent[] {
  const components: ElectricalComponent[] = []
  
  if (count <= 0 || walls.length === 0) return components
  
  // Collect all openings from all walls
  const allOpenings: Array<{ wall: BuildingWallModel; opening: BuildingOpeningModel }> = []
  for (const wall of walls) {
    for (const opening of wall.openings) {
      allOpenings.push({ wall, opening })
    }
  }
  
  if (allOpenings.length === 0) return components
  
  const perOpening = Math.ceil(count / allOpenings.length)
  let idx = 0
  
  for (const { wall, opening } of allOpenings) {
    if (idx >= count) break
    
    // Calculate position along wall
    const posAlongWall = opening.positionAlongWall.value
    const wallLen = Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y)
    const t = posAlongWall / wallLen
    
    const baseX = wall.start.x + (wall.end.x - wall.start.x) * t
    const baseZ = wall.start.y + (wall.end.y - wall.start.y) * t
    
    // Place switches/outlets around opening
    for (let i = 0; i < perOpening && idx < count; i++) {
      const offset = (i - perOpening / 2) * 1.5
      const worldX = baseX + offset * 0.3
      const worldZ = baseZ + offset * 0.3
      const worldY = heightOffset
      
      const screenPos = worldToScreen(worldX, worldZ, worldY)
      
      components.push({
        id: `${category}-opening-${idx}`,
        label: `${category} #${idx}`,
        stage,
        category,
        worldPos: { x: worldX, z: worldZ, y: worldY },
        screenPos,
        color,
        size: 3,
      })
      
      idx++
    }
  }
  
  return components
}

/**
 * Place components on ceiling (fixtures, etc.)
 */
function placeComponentsOnCeiling(
  model: BlueprintBuildingModel,
  count: number,
  color: string,
  stage: VRStage,
  category: string,
): ElectricalComponent[] {
  const components: ElectricalComponent[] = []
  
  if (count <= 0) return components
  
  const level = model.levels[0]
  if (!level) return components
  
  const ceilingHeight = model.ceilingHeight.value - 1
  
  const room = level.rooms[0]
  if (!room) return components
  
  // Center points for each room
  const { min, max } = room.bounds
  const width = max.x - min.x
  const depth = max.y - min.y
  const centerX = min.x + width / 2
  const centerZ = min.y + depth / 2
  
  // Place fixtures in grid on ceiling
  const cols = Math.ceil(Math.sqrt(count))
  const rows = Math.ceil(count / cols)
  
  const colSpacing = width * 0.7 / (cols + 1)
  const rowSpacing = depth * 0.7 / (rows + 1)
  
  let idx = 0
  for (let row = 1; row <= rows && idx < count; row++) {
    for (let col = 1; col <= cols && idx < count; col++) {
      const worldX = centerX - width * 0.35 + col * colSpacing
      const worldZ = centerZ - depth * 0.35 + row * rowSpacing
      const worldY = ceilingHeight
      
      const screenPos = worldToScreen(worldX, worldZ, worldY)
      
      components.push({
        id: `${category}-ceiling-${idx}`,
        label: `${category} #${idx}`,
        stage,
        category,
        worldPos: { x: worldX, z: worldZ, y: worldY },
        screenPos,
        color,
        size: 3,
      })
      
      idx++
    }
  }
  
  return components
}

/**
 * Place electrical panel on utility/electrical room wall
 */
function placeElectricalPanel(
  model: BlueprintBuildingModel,
  color: string,
  stage: VRStage,
): ElectricalComponent[] {
  const level = model.levels[0]
  if (!level) return []
  
  const room = level.rooms[0]
  if (!room || room.walls.length === 0) return []
  
  // Place panel on first wall, elevated to typical height (4 ft center)
  const wall = room.walls[0]
  
  const centerX = (wall.start.x + wall.end.x) / 2
  const centerZ = (wall.start.y + wall.end.y) / 2
  const panelHeight = 4
  
  const screenPos = worldToScreen(centerX, centerZ, panelHeight)
  
  return [
    {
      id: 'panel-main',
      label: 'Main Panel 200A',
      stage,
      category: 'Panel',
      worldPos: { x: centerX, z: centerZ, y: panelHeight },
      screenPos,
      color,
      size: 6,
      description: 'Main electrical panel',
    },
  ]
}

/**
 * Place conduit runs between components
 */
function placeConduitRuns(
  fromPos: { x: number; z: number; y: number },
  toPos: { x: number; z: number; y: number },
  color: string,
  stage: VRStage,
): GeoShape[] {
  const shapes: GeoShape[] = []
  
  const fromScreen = worldToScreen(fromPos.x, fromPos.z, fromPos.y)
  const toScreen = worldToScreen(toPos.x, toPos.z, toPos.y)
  
  // Conduit line
  shapes.push({
    kind: 'line',
    id: `conduit-${fromPos.x}-${fromPos.z}`,
    x1: fromScreen.sx,
    y1: fromScreen.sy,
    x2: toScreen.sx,
    y2: toScreen.sy,
    stroke: color,
    strokeWidth: 2,
    opacity: 0.7,
    zOrder: 10,
    strokeDasharray: '4,2',
  })
  
  return shapes
}

// ─── Main Placement Functions by Stage ──────────────────────────────────────

/**
 * Place underground electrical components
 */
export function placeUndergroundStage(
  model: BlueprintBuildingModel,
  hints?: ElectricalPlacementHints,
): ElectricalComponent[] {
  const components: ElectricalComponent[] = []
  
  // Underground conduits below slab
  components.push(...placeComponentsOnFloor(
    model,
    6,
    UNDERGROUND_COLORS.conduit,
    'underground',
    'PVC Conduit',
    -2, // below slab
  ))
  
  // Floor boxes
  components.push(...placeComponentsOnFloor(
    model,
    4,
    UNDERGROUND_COLORS.floorBox,
    'underground',
    'Floor Box',
    -1.5,
  ))
  
  // Service entrance and grounding
  components.push(...placeComponentsOnFloor(
    model,
    2,
    UNDERGROUND_COLORS.serviceGround,
    'underground',
    'Service / Ground',
    -3,
  ))
  
  return components
}

/**
 * Place rough-in stage electrical components
 */
export function placeRoughInStage(
  model: BlueprintBuildingModel,
  hints?: ElectricalPlacementHints,
): ElectricalComponent[] {
  const components: ElectricalComponent[] = []
  
  // Main panel on wall
  components.push(...placeElectricalPanel(model, ROUGHIN_COLORS.panel, 'roughIn'))
  
  // Device boxes on walls (framing height ~1.5-2 ft)
  const level = model.levels[0]
  if (level) {
    for (const room of level.rooms) {
      for (const wall of room.walls) {
        components.push(...placeComponentsOnWall(
          wall,
          3,
          ROUGHIN_COLORS.deviceBox,
          'roughIn',
          'Device Box',
          1.5,
        ))
      }
    }
  }
  
  // Junction boxes
  components.push(...placeComponentsOnFloor(
    model,
    4,
    ROUGHIN_COLORS.jbox,
    'roughIn',
    'J-Box',
    3,
  ))
  
  return components
}

/**
 * Place trim stage electrical components
 */
export function placeTrimStage(
  model: BlueprintBuildingModel,
  hints?: ElectricalPlacementHints,
): ElectricalComponent[] {
  const components: ElectricalComponent[] = []
  
  // Receptacles on walls (standard height 18")
  const level = model.levels[0]
  if (level) {
    for (const room of level.rooms) {
      for (const wall of room.walls) {
        components.push(...placeComponentsOnWall(
          wall,
          4,
          TRIM_COLORS.receptacle,
          'trim',
          'Receptacle',
          1.5,
        ))
      }
    }
  }
  
  // Switches near openings
  if (level) {
    const allWalls: BuildingWallModel[] = []
    for (const room of level.rooms) {
      allWalls.push(...room.walls)
    }
    components.push(...placeComponentsNearOpenings(
      allWalls,
      3,
      TRIM_COLORS.switch,
      'trim',
      'Switch',
      1.2,
    ))
  }
  
  // Lighting fixtures on ceiling
  components.push(...placeComponentsOnCeiling(
    model,
    4,
    TRIM_COLORS.fixture,
    'trim',
    'Fixture',
  ))
  
  return components
}

/**
 * Place finished/as-built stage electrical components
 */
export function placeFinishedStage(
  model: BlueprintBuildingModel,
  hints?: ElectricalPlacementHints,
): ElectricalComponent[] {
  const components: ElectricalComponent[] = []
  
  // All trim devices with circuit labels
  const level = model.levels[0]
  if (level) {
    for (const room of level.rooms) {
      for (const wall of room.walls) {
        components.push(...placeComponentsOnWall(
          wall,
          4,
          FINISHED_COLORS.device,
          'finished',
          'Labeled Device',
          1.5,
        ))
      }
    }
  }
  
  // Lighting circuits
  components.push(...placeComponentsOnCeiling(
    model,
    4,
    FINISHED_COLORS.circuit,
    'finished',
    'Light Circuit',
  ))
  
  // As-built markers
  components.push(...placeComponentsOnFloor(
    model,
    2,
    FINISHED_COLORS.marker,
    'finished',
    'As-Built Marker',
    0.2,
  ))
  
  return components
}

/**
 * Master function: place all electrical components for a stage
 */
export function placeElectricalComponentsInModel(
  model: BlueprintBuildingModel,
  activeStage: VRStage,
  hints?: ElectricalPlacementHints,
): ElectricalComponent[] {
  switch (activeStage) {
    case 'underground':
      return placeUndergroundStage(model, hints)
    case 'roughIn':
      return placeRoughInStage(model, hints)
    case 'trim':
      return placeTrimStage(model, hints)
    case 'finished':
      return placeFinishedStage(model, hints)
    default:
      return []
  }
}

/**
 * Get all components for all stages (for filtering/legend)
 */
export function getAllStageComponentsByType(
  model: BlueprintBuildingModel,
): Record<VRStage, ElectricalComponent[]> {
  return {
    underground: placeUndergroundStage(model),
    roughIn: placeRoughInStage(model),
    trim: placeTrimStage(model),
    finished: placeFinishedStage(model),
  }
}

/**
 * Get component counts by stage for legend/summary
 */
export function getComponentCountsByStage(
  model: BlueprintBuildingModel,
): Record<VRStage, number> {
  const allByStage = getAllStageComponentsByType(model)
  return {
    underground: allByStage.underground.length,
    roughIn: allByStage.roughIn.length,
    trim: allByStage.trim.length,
    finished: allByStage.finished.length,
  }
}

/**
 * Get stage-specific legend entries
 */
export function getLegendEntriesByStage(stage: VRStage): Array<{ color: string; label: string }> {
  switch (stage) {
    case 'underground':
      return [
        { color: UNDERGROUND_COLORS.conduit, label: 'PVC Conduit' },
        { color: UNDERGROUND_COLORS.serviceGround, label: 'Service / Ground' },
        { color: UNDERGROUND_COLORS.floorBox, label: 'Floor Box' },
      ]
    case 'roughIn':
      return [
        { color: ROUGHIN_COLORS.deviceBox, label: 'Device Box' },
        { color: ROUGHIN_COLORS.panel, label: 'Panel 200A' },
        { color: ROUGHIN_COLORS.jbox, label: 'J-Box / EMT' },
      ]
    case 'trim':
      return [
        { color: TRIM_COLORS.receptacle, label: 'Receptacle' },
        { color: TRIM_COLORS.switch, label: 'Switch' },
        { color: TRIM_COLORS.fixture, label: 'Light Fixture' },
      ]
    case 'finished':
      return [
        { color: FINISHED_COLORS.device, label: 'Labeled Device' },
        { color: FINISHED_COLORS.circuit, label: 'Light Circuit' },
        { color: FINISHED_COLORS.path, label: 'Circuit Path' },
      ]
  }
}
