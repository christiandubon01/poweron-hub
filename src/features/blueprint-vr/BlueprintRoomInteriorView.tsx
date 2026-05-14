/**
 * src/features/blueprint-vr/BlueprintRoomInteriorView.tsx
 *
 * Immersive room interior view used by the Generate VR experience.
 *
 * Per-room geometry:
 *   - Reception / Entrance — reception counter, waiting seats
 *   - Styling Floor — chairs, mirrors, vanity bench
 *   - Restroom — sink, toilet
 *   - Utility / Panel — panel face, rack, conduit cues
 *   - Storage — shelving
 *   - Hallway / Circulation — clean walkway
 *   - Back Service Room — wash bay and counter
 *
 * Stage overlays differ for Underground / Rough In / Trim / Finished and use
 * the same component placement engine as the dollhouse so the room interior
 * stays in sync with the model.
 */

import React, { useMemo } from 'react'
import type { BlueprintBuildingModel, BuildingRoomModel } from './buildingModel'
import type { VRStage } from './types'
import { placeElectricalComponentsInModel } from './electrical3DPlacement'

export interface BlueprintRoomInteriorViewProps {
  model: BlueprintBuildingModel
  selectedRoomId?: string | null
  activeStage: VRStage
  showElectrical?: boolean
  showLabels?: boolean
  showDimensions?: boolean
  wallOpacity?: number
}

const STAGE_ACCENT: Record<VRStage, string> = {
  underground: '#E07020',
  roughIn: '#3B82F6',
  trim: '#22C55E',
  finished: '#06B6D4',
}

interface FurnitureItem {
  x: number
  y: number
  w: number
  h: number
  label: string
  fill?: string
  stroke?: string
}

// Canonical room interior canvas dimensions used by furniture coordinates.
const CANVAS_W = 360
const CANVAS_H = 270
// The floor "footprint" inside the canvas is the trapezoid bounded by these
// values, so we keep furniture coordinates within them.
const FLOOR_LEFT = 58
const FLOOR_RIGHT = 300
const FLOOR_TOP = 92
const FLOOR_BOTTOM = 232

function roleOf(room: BuildingRoomModel): string {
  const explicit = (room.metadata?.role || '').toString().toLowerCase()
  if (explicit) return explicit
  return `${room.metadata?.type || ''} ${room.label}`.toLowerCase()
}

function pickFurniture(room: BuildingRoomModel): FurnitureItem[] {
  const kind = roleOf(room)
  const labelLc = room.label.toLowerCase()

  // Treatment-room specific furniture (chair + mirror + side counter).
  // Detected from label so the elevation-sheet "Treatment Room #1/#2" rooms
  // read as actual treatment rooms, not back wash bays.
  if (labelLc.includes('treatment')) {
    return [
      { x: 138, y: 110, w: 84, h: 26, label: 'Mirror', fill: '#0a1018', stroke: '#d7c084' },
      { x: 152, y: 150, w: 56, h: 38, label: 'Treatment Chair', fill: '#1d2230', stroke: '#c4a873' },
      { x: 70, y: 195, w: 56, h: 28, label: 'Sink', fill: '#d7e2ef', stroke: '#86a8c4' },
      { x: 138, y: 195, w: 152, h: 26, label: 'Work Counter', fill: '#3a2e1f', stroke: '#c4a873' },
    ]
  }

  if (kind.includes('reception') || kind.includes('entrance')) {
    return [
      { x: 80, y: 195, w: 200, h: 30, label: 'Reception Counter', fill: '#231a12', stroke: '#c4a873' },
      { x: 90, y: 155, w: 40, h: 24, label: 'Sofa', fill: '#26303f', stroke: '#9a8d80' },
      { x: 140, y: 155, w: 28, h: 24, label: 'Chair', fill: '#26303f', stroke: '#9a8d80' },
      { x: 200, y: 155, w: 28, h: 24, label: 'Chair', fill: '#26303f', stroke: '#9a8d80' },
      { x: 244, y: 155, w: 36, h: 24, label: 'Side Tbl', fill: '#3a2e1f', stroke: '#c4a873' },
      { x: 270, y: 200, w: 22, h: 22, label: 'POS', fill: '#0a1018', stroke: '#86efac' },
    ]
  }
  if (kind.includes('waiting')) {
    return [
      { x: 70, y: 150, w: 60, h: 30, label: 'Sofa', fill: '#1f2735', stroke: '#9a8d80' },
      { x: 150, y: 150, w: 40, h: 26, label: 'Chair', fill: '#1f2735', stroke: '#9a8d80' },
      { x: 210, y: 150, w: 40, h: 26, label: 'Chair', fill: '#1f2735', stroke: '#9a8d80' },
      { x: 110, y: 200, w: 100, h: 18, label: 'Side Tbl', fill: '#3a2e1f', stroke: '#c4a873' },
      { x: 240, y: 200, w: 50, h: 18, label: 'Mag Rack', fill: '#3a2e1f', stroke: '#c4a873' },
    ]
  }
  if (
    kind.includes('styling') ||
    kind.includes('salon') ||
    kind === 'salon-station' ||
    kind.includes('service area')
  ) {
    return [
      // Left stations
      { x: 70, y: 105, w: 24, h: 30, label: 'Mirror', fill: '#0a1018', stroke: '#d7c084' },
      { x: 70, y: 145, w: 24, h: 24, label: 'Chair', fill: '#1d2230', stroke: '#c4a873' },
      { x: 100, y: 145, w: 38, h: 24, label: 'Vanity', fill: '#3a2e1f', stroke: '#c4a873' },
      { x: 70, y: 188, w: 24, h: 30, label: 'Mirror', fill: '#0a1018', stroke: '#d7c084' },
      { x: 70, y: 222, w: 24, h: 8, label: 'Drawer', fill: '#3a2e1f', stroke: '#c4a873' },
      // Right stations
      { x: 264, y: 105, w: 24, h: 30, label: 'Mirror', fill: '#0a1018', stroke: '#d7c084' },
      { x: 264, y: 145, w: 24, h: 24, label: 'Chair', fill: '#1d2230', stroke: '#c4a873' },
      { x: 220, y: 145, w: 38, h: 24, label: 'Vanity', fill: '#3a2e1f', stroke: '#c4a873' },
      { x: 264, y: 188, w: 24, h: 30, label: 'Mirror', fill: '#0a1018', stroke: '#d7c084' },
      // Central wash bowls
      { x: 156, y: 180, w: 22, h: 22, label: 'Bowl', fill: '#d7e2ef', stroke: '#86a8c4' },
      { x: 184, y: 180, w: 22, h: 22, label: 'Bowl', fill: '#d7e2ef', stroke: '#86a8c4' },
    ]
  }
  if (kind.includes('bath') || kind.includes('restroom')) {
    return [
      { x: 80, y: 152, w: 52, h: 28, label: 'Sink', fill: '#d7e2ef', stroke: '#86a8c4' },
      { x: 84, y: 110, w: 44, h: 26, label: 'Mirror', fill: '#0a1018', stroke: '#d7c084' },
      { x: 222, y: 152, w: 50, h: 64, label: 'Toilet', fill: '#eef3f8', stroke: '#86a8c4' },
      { x: 130, y: 195, w: 100, h: 22, label: 'Vanity', fill: '#3a2e1f', stroke: '#c4a873' },
    ]
  }
  if (kind.includes('utility') || kind.includes('panel')) {
    return [
      { x: 70, y: 110, w: 70, h: 96, label: 'Panel 200A', fill: '#101820', stroke: '#eab308' },
      { x: 160, y: 160, w: 80, h: 56, label: 'HVAC / WH', fill: '#1d2230', stroke: '#c4a873' },
      { x: 252, y: 160, w: 36, h: 22, label: 'Disconn.', fill: '#101820', stroke: '#eab308' },
      { x: 252, y: 195, w: 36, h: 22, label: 'Sub-Pnl', fill: '#101820', stroke: '#eab308' },
    ]
  }
  if (kind.includes('storage')) {
    return [
      { x: 70, y: 105, w: 24, h: 120, label: 'Shelves', fill: '#2b313c', stroke: '#9a8d80' },
      { x: 110, y: 105, w: 24, h: 120, label: 'Shelves', fill: '#2b313c', stroke: '#9a8d80' },
      { x: 260, y: 105, w: 24, h: 120, label: 'Shelves', fill: '#2b313c', stroke: '#9a8d80' },
      { x: 160, y: 160, w: 80, h: 28, label: 'Workbench', fill: '#3a2e1f', stroke: '#c4a873' },
    ]
  }
  if (kind.includes('hallway') || kind.includes('circulation')) {
    return [
      { x: 90, y: 138, w: 180, h: 12, label: 'Runner', fill: '#3a2e1f', stroke: '#c4a873' },
      { x: 90, y: 220, w: 180, h: 12, label: 'Runner', fill: '#3a2e1f', stroke: '#c4a873' },
    ]
  }
  if (kind === 'wash-station' || kind.includes('shampoo')) {
    return [
      { x: 80, y: 150, w: 48, h: 36, label: 'Bowl', fill: '#d7e2ef', stroke: '#86a8c4' },
      { x: 140, y: 150, w: 48, h: 36, label: 'Bowl', fill: '#d7e2ef', stroke: '#86a8c4' },
      { x: 80, y: 195, w: 108, h: 26, label: 'Wash Counter', fill: '#3a2e1f', stroke: '#c4a873' },
      { x: 220, y: 160, w: 64, h: 60, label: 'Equipment', fill: '#1d2230', stroke: '#c4a873' },
    ]
  }
  if (kind.includes('back') || kind.includes('service')) {
    return [
      { x: 80, y: 150, w: 56, h: 56, label: 'Wash Bay', fill: '#2a3140', stroke: '#86a8c4' },
      { x: 150, y: 160, w: 100, h: 28, label: 'Work Counter', fill: '#3a2e1f', stroke: '#c4a873' },
      { x: 150, y: 200, w: 100, h: 18, label: 'Drawer', fill: '#3a2e1f', stroke: '#c4a873' },
      { x: 260, y: 160, w: 30, h: 60, label: 'Equip.', fill: '#1d2230', stroke: '#c4a873' },
    ]
  }
  if (kind === 'office') {
    return [
      { x: 90, y: 160, w: 120, h: 40, label: 'Desk', fill: '#3a2e1f', stroke: '#c4a873' },
      { x: 130, y: 205, w: 32, h: 20, label: 'Chair', fill: '#1d2230', stroke: '#c4a873' },
      { x: 230, y: 130, w: 60, h: 92, label: 'Bookshelf', fill: '#2b313c', stroke: '#9a8d80' },
    ]
  }
  if (kind === 'conference') {
    return [
      { x: 90, y: 150, w: 180, h: 60, label: 'Conf Table', fill: '#3a2e1f', stroke: '#c4a873' },
      { x: 90, y: 130, w: 30, h: 18, label: 'Chair', fill: '#1d2230', stroke: '#c4a873' },
      { x: 130, y: 130, w: 30, h: 18, label: 'Chair', fill: '#1d2230', stroke: '#c4a873' },
      { x: 170, y: 130, w: 30, h: 18, label: 'Chair', fill: '#1d2230', stroke: '#c4a873' },
      { x: 210, y: 130, w: 30, h: 18, label: 'Chair', fill: '#1d2230', stroke: '#c4a873' },
    ]
  }
  return [
    { x: 80, y: 200, w: 100, h: 30, label: 'Counter', fill: '#1d2230', stroke: '#c4a873' },
    { x: 200, y: 200, w: 100, h: 30, label: 'Seating', fill: '#26303f', stroke: '#c4a873' },
  ]
}

interface CeilingFixture {
  cx: number
  cy: number
  kind: 'downlight' | 'track' | 'chandelier'
}

function ceilingFixturesFor(room: BuildingRoomModel): CeilingFixture[] {
  const kind = roleOf(room)
  const labelLc = room.label.toLowerCase()
  if (labelLc.includes('treatment')) {
    return [
      { cx: 130, cy: 56, kind: 'downlight' },
      { cx: 230, cy: 56, kind: 'downlight' },
    ]
  }
  if (kind === 'wash-station' || labelLc.includes('hair wash')) {
    return [
      { cx: 130, cy: 56, kind: 'downlight' },
      { cx: 230, cy: 56, kind: 'downlight' },
    ]
  }
  if (kind.includes('reception') || kind.includes('entrance')) {
    return [{ cx: 180, cy: 60, kind: 'chandelier' }]
  }
  if (kind.includes('styling') || kind.includes('salon')) {
    return [
      { cx: 110, cy: 56, kind: 'track' },
      { cx: 180, cy: 56, kind: 'track' },
      { cx: 250, cy: 56, kind: 'track' },
    ]
  }
  if (kind.includes('bath') || kind.includes('restroom')) {
    return [{ cx: 180, cy: 56, kind: 'downlight' }]
  }
  if (kind.includes('utility') || kind.includes('panel')) {
    return [
      { cx: 130, cy: 56, kind: 'downlight' },
      { cx: 230, cy: 56, kind: 'downlight' },
    ]
  }
  if (kind.includes('hallway') || kind.includes('circulation')) {
    return [
      { cx: 130, cy: 56, kind: 'downlight' },
      { cx: 230, cy: 56, kind: 'downlight' },
    ]
  }
  return [{ cx: 180, cy: 56, kind: 'downlight' }]
}

interface WallDeviceCue {
  x: number
  y: number
  label: string
  color: string
}

function wallDevicesFor(room: BuildingRoomModel): WallDeviceCue[] {
  const kind = roleOf(room)
  const labelLc = room.label.toLowerCase()

  if (labelLc.includes('treatment')) {
    return [
      { x: 78, y: 178, label: 'GFCI', color: '#22C55E' },
      { x: 286, y: 178, label: 'RCP', color: '#22C55E' },
      { x: 286, y: 115, label: 'SW', color: '#4ADE80' },
    ]
  }
  if (kind === 'wash-station' || kind.includes('shampoo') || labelLc.includes('hair wash')) {
    return [
      { x: 78, y: 178, label: 'GFCI', color: '#22C55E' },
      { x: 286, y: 178, label: 'GFCI', color: '#22C55E' },
      { x: 286, y: 115, label: 'SW', color: '#4ADE80' },
    ]
  }
  if (kind.includes('reception') || kind.includes('entrance')) {
    return [
      { x: 80, y: 178, label: 'RCP', color: '#22C55E' },
      { x: 286, y: 178, label: 'RCP', color: '#22C55E' },
      { x: 286, y: 115, label: 'SW', color: '#4ADE80' },
    ]
  }
  if (kind.includes('styling') || kind.includes('salon')) {
    return [
      { x: 62, y: 130, label: 'RCP', color: '#22C55E' },
      { x: 62, y: 180, label: 'RCP', color: '#22C55E' },
      { x: 296, y: 130, label: 'RCP', color: '#22C55E' },
      { x: 296, y: 180, label: 'RCP', color: '#22C55E' },
      { x: 62, y: 110, label: 'SW', color: '#4ADE80' },
    ]
  }
  if (kind.includes('bath') || kind.includes('restroom')) {
    return [
      { x: 82, y: 130, label: 'GFCI', color: '#22C55E' },
      { x: 286, y: 115, label: 'SW', color: '#4ADE80' },
    ]
  }
  if (kind.includes('utility') || kind.includes('panel')) {
    return [
      { x: 62, y: 115, label: 'SW', color: '#4ADE80' },
      { x: 286, y: 180, label: 'RCP', color: '#22C55E' },
    ]
  }
  return [
    { x: 62, y: 180, label: 'RCP', color: '#22C55E' },
    { x: 286, y: 180, label: 'RCP', color: '#22C55E' },
  ]
}

function floorTextureForRoom(room: BuildingRoomModel): string {
  const kind = roleOf(room)
  const labelLc = room.label.toLowerCase()
  if (labelLc.includes('treatment')) return 'url(#floor-tile)'
  if (kind === 'wash-station' || labelLc.includes('hair wash')) return 'url(#floor-tile)'
  if (kind.includes('reception') || kind.includes('entrance')) return 'url(#floor-marble)'
  if (kind.includes('bath') || kind.includes('restroom')) return 'url(#floor-tile)'
  if (kind.includes('utility') || kind.includes('panel') || kind.includes('storage'))
    return 'url(#floor-concrete)'
  if (kind.includes('hallway') || kind.includes('circulation')) return 'url(#floor-marble)'
  return 'url(#floor-marble)'
}

function wallFinishForRoom(room: BuildingRoomModel): string {
  const kind = roleOf(room)
  if (kind.includes('reception') || kind.includes('entrance')) return 'url(#wall-feature)'
  if (kind.includes('bath') || kind.includes('restroom')) return 'url(#wall-tile)'
  return 'url(#wall-polish)'
}

function stageOverlayLabel(stage: VRStage): string {
  switch (stage) {
    case 'underground':
      return 'Underground · below-slab conduits, floor boxes, ground rod'
    case 'roughIn':
      return 'Rough In · wall boxes, panel rough, conduit / MC runs'
    case 'trim':
      return 'Trim · receptacles, switches, cover plates, fixture trims'
    case 'finished':
      return 'Finished · as-built devices, circuit labels, panel directory'
  }
}

export default function BlueprintRoomInteriorView({
  model,
  selectedRoomId,
  activeStage,
  showElectrical = true,
  showLabels = true,
  showDimensions = true,
  wallOpacity = 0.86,
}: BlueprintRoomInteriorViewProps) {
  const room = useMemo(() => {
    const rooms = model.levels[0]?.rooms || []
    return rooms.find((r) => r.id === selectedRoomId) || rooms[0] || null
  }, [model, selectedRoomId])

  const roomElectrical = useMemo(() => {
    if (!room || !showElectrical) return []
    const all = placeElectricalComponentsInModel(model, activeStage)
    const { min, max } = room.bounds
    return all.filter(
      (comp) =>
        comp.worldPos.x >= min.x &&
        comp.worldPos.x <= max.x &&
        comp.worldPos.z >= min.y &&
        comp.worldPos.z <= max.y,
    )
  }, [model, room, activeStage, showElectrical])

  if (!room) {
    return (
      <div style={{ padding: 20, color: 'rgba(255,255,255,0.6)', fontFamily: 'monospace' }}>
        No room available for interior view.
      </div>
    )
  }

  const accent = STAGE_ACCENT[activeStage]
  const roomWidth = Math.max(8, room.bounds.max.x - room.bounds.min.x)
  const roomDepth = Math.max(8, room.bounds.max.y - room.bounds.min.y)
  const approxArea = room.area || roomWidth * roomDepth
  const wallFinish = wallFinishForRoom(room)
  const floorFinish = floorTextureForRoom(room)
  const furniture = pickFurniture(room)
  const ceilingFixtures = ceilingFixturesFor(room)
  const wallDevices = wallDevicesFor(room)
  const kind = roleOf(room)
  const showStorefront = kind.includes('reception') || kind.includes('entrance')

  return (
    <div
      style={{
        border: '1px solid rgba(0,229,204,0.15)',
        borderRadius: 8,
        overflow: 'hidden',
        background: '#070b12',
      }}
    >
      <svg viewBox="0 0 360 270" width="100%" style={{ display: 'block' }}>
        <defs>
          <linearGradient id="wall-polish" x1="0" x2="1">
            <stop offset="0%" stopColor={`rgba(245,240,235,${wallOpacity})`} />
            <stop offset="100%" stopColor={`rgba(223,218,210,${wallOpacity})`} />
          </linearGradient>
          <linearGradient id="wall-feature" x1="0" x2="1">
            <stop offset="0%" stopColor={`rgba(60,40,30,${wallOpacity})`} />
            <stop offset="100%" stopColor={`rgba(110,75,55,${wallOpacity})`} />
          </linearGradient>
          <pattern id="wall-tile" width="20" height="20" patternUnits="userSpaceOnUse">
            <rect width="20" height="20" fill={`rgba(220,230,238,${wallOpacity})`} />
            <path d="M0 10 L20 10 M10 0 L10 20" stroke="rgba(150,170,190,0.6)" strokeWidth="0.6" />
          </pattern>
          <pattern id="floor-marble" width="18" height="18" patternUnits="userSpaceOnUse">
            <rect width="18" height="18" fill="#ece7e1" />
            <path d="M0 6 C5 5, 8 8, 18 6 M0 13 C7 11, 12 15, 18 12" stroke="#d7d0c7" strokeWidth="0.7" fill="none" />
          </pattern>
          <pattern id="floor-tile" width="22" height="22" patternUnits="userSpaceOnUse">
            <rect width="22" height="22" fill="#e2e8ec" />
            <rect x="0.5" y="0.5" width="21" height="21" fill="none" stroke="#bcc5cf" strokeWidth="0.7" />
          </pattern>
          <pattern id="floor-concrete" width="22" height="22" patternUnits="userSpaceOnUse">
            <rect width="22" height="22" fill="#7e8593" />
            <path d="M0 6 L22 8 M2 18 L20 16" stroke="#65707d" strokeWidth="0.7" fill="none" />
          </pattern>
          <linearGradient id="ceiling-tone" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="rgba(232,224,210,0.95)" />
            <stop offset="100%" stopColor="rgba(202,194,180,0.85)" />
          </linearGradient>
        </defs>

        <rect x="0" y="0" width="360" height="270" fill="#0a1019" />

        {/* Ceiling */}
        <polygon points="30,42 328,42 300,72 58,72" fill="url(#ceiling-tone)" stroke="#b6ab9f" />
        {/* Left wall */}
        <polygon points="30,42 58,72 58,232 30,204" fill="rgba(214,205,192,0.78)" stroke="#9a8d80" />
        {/* Right wall */}
        <polygon points="328,42 300,72 300,232 328,204" fill="rgba(206,198,186,0.78)" stroke="#978979" />
        {/* Back wall */}
        <rect x="58" y="72" width="242" height="160" fill={wallFinish} stroke="#a69b8e" />
        {/* Floor */}
        <polygon points="58,232 300,232 328,204 30,204" fill={floorFinish} stroke="#c0b6aa" />

        {/* Door cue on back wall — only for non-reception rooms */}
        {!showStorefront && (
          <g>
            <rect x="170" y="120" width="22" height="108" fill="rgba(15,18,25,0.85)" stroke="#c4a873" />
            <path
              d="M 170 228 Q 178 200 192 192"
              fill="none"
              stroke="#c4a873"
              strokeWidth="1"
              strokeDasharray="3 2"
              opacity={0.6}
            />
          </g>
        )}

        {/* Storefront glass / sign for entry-style rooms. The "SALON SIGN"
            text is gated by showLabels so the toggle hides every text
            annotation in the room view. The accent-bar finish (gold/black
            trim) is preserved because the render references show it as a
            wall finish, not an opening. */}
        {showStorefront && (
          <g>
            <rect x="78" y="96" width="204" height="42" fill="rgba(180,210,255,0.22)" stroke="#9ec7f9" />
            <line x1="180" y1="96" x2="180" y2="138" stroke="#9ec7f9" strokeDasharray="2 2" />
            {/* Gold/black accent finish band — finish, not an opening. */}
            <rect x="60" y="82" width="240" height="6" fill="#1a1410" stroke="#c4a873" strokeWidth="0.8" />
            <rect x="60" y="138" width="240" height="4" fill="#c4a873" opacity="0.85" />
            {showLabels && (
              <text
                x="180"
                y="79"
                textAnchor="middle"
                fill="rgba(245,235,220,0.78)"
                fontFamily="monospace"
                fontSize="9"
                letterSpacing="2"
              >
                SALON SIGN
              </text>
            )}
          </g>
        )}

        {/* Subtle gold/black trim at the floor-to-wall junction. The render
            references treat this as accent trim, not a structural feature. */}
        {showStorefront && (
          <g pointerEvents="none">
            <line x1="58" y1="232" x2="300" y2="232" stroke="#c4a873" strokeWidth="1.2" opacity="0.7" />
            <line x1="30" y1="204" x2="58" y2="232" stroke="#c4a873" strokeWidth="0.8" opacity="0.6" />
            <line x1="328" y1="204" x2="300" y2="232" stroke="#c4a873" strokeWidth="0.8" opacity="0.6" />
          </g>
        )}

        {/* Wall device cues (receptacles / switches / gfci) */}
        {wallDevices.map((d, i) => (
          <g key={`wd-${i}`}>
            <rect
              x={d.x}
              y={d.y}
              width={9}
              height={11}
              fill="rgba(15,20,28,0.85)"
              stroke={d.color}
              strokeWidth={1.1}
              rx={1}
            />
            {showLabels && (
              <text
                x={d.x + 4.5}
                y={d.y + 18}
                textAnchor="middle"
                fontFamily="monospace"
                fontSize="6.5"
                fill="rgba(255,255,255,0.55)"
              >
                {d.label}
              </text>
            )}
          </g>
        ))}

        {/* Ceiling fixtures derived per room type */}
        {ceilingFixtures.map((fx, i) => {
          if (fx.kind === 'chandelier') {
            return (
              <g key={`fx-${i}`}>
                <line x1={fx.cx} y1={42} x2={fx.cx} y2={fx.cy} stroke="#c9ae78" />
                <circle cx={fx.cx} cy={fx.cy} r={11} fill="#f2dfb0" stroke="#d6b16a" />
                <circle cx={fx.cx} cy={fx.cy} r={5} fill="#fff2cc" />
              </g>
            )
          }
          if (fx.kind === 'track') {
            return (
              <g key={`fx-${i}`}>
                <line x1={fx.cx - 18} y1={fx.cy} x2={fx.cx + 18} y2={fx.cy} stroke="#d7c084" strokeWidth={3} />
                <circle cx={fx.cx - 12} cy={fx.cy + 4} r={2.5} fill="#f2dfb0" />
                <circle cx={fx.cx} cy={fx.cy + 4} r={2.5} fill="#f2dfb0" />
                <circle cx={fx.cx + 12} cy={fx.cy + 4} r={2.5} fill="#f2dfb0" />
              </g>
            )
          }
          return (
            <g key={`fx-${i}`}>
              <circle cx={fx.cx} cy={fx.cy} r={6} fill="#f2dfb0" stroke="#d6b16a" />
            </g>
          )
        })}

        {/* Furniture */}
        {furniture.map((item, idx) => (
          <g key={`${item.label}-${idx}`}>
            <rect
              x={item.x}
              y={item.y}
              width={item.w}
              height={item.h}
              fill={item.fill || 'rgba(19,24,35,0.78)'}
              stroke={item.stroke || '#c4a873'}
              strokeWidth={1.2}
              rx={2}
            />
            {showLabels && (
              <text
                x={item.x + item.w / 2}
                y={item.y + item.h / 2 + 3}
                textAnchor="middle"
                fill="rgba(240,237,232,0.78)"
                fontSize={8}
                fontFamily="monospace"
              >
                {item.label}
              </text>
            )}
          </g>
        ))}

        {/* Stage overlay: underground hint (below floor band) */}
        {showElectrical && activeStage === 'underground' && (
          <g>
            <line x1="50" y1="246" x2="310" y2="246" stroke={accent} strokeDasharray="4 3" strokeWidth="1.5" />
            <line x1="120" y1="246" x2="120" y2="234" stroke={accent} strokeDasharray="3 2" />
            <line x1="220" y1="246" x2="220" y2="234" stroke={accent} strokeDasharray="3 2" />
            {showLabels && (
              <text x="180" y="259" textAnchor="middle" fill={accent} fontSize={8.5} fontFamily="monospace">
                Below-Slab Conduit Run
              </text>
            )}
          </g>
        )}

        {/* Stage overlay: rough-in hint (wall boxes + panel face) */}
        {showElectrical && activeStage === 'roughIn' && (
          <g>
            <rect x="278" y="100" width="16" height="46" fill="rgba(0,0,0,0.5)" stroke={accent} />
            {showLabels && (
              <text x="286" y="93" textAnchor="middle" fill={accent} fontSize={7} fontFamily="monospace">
                PANEL
              </text>
            )}
            <line x1="290" y1="146" x2="290" y2="220" stroke={accent} strokeWidth="1.2" />
          </g>
        )}

        {/* Stage overlay: trim hint (cover plates over walls) */}
        {showElectrical && activeStage === 'trim' && (
          <g>
            <rect x="62" y="180" width="10" height="14" fill="rgba(0,0,0,0.7)" stroke={accent} />
            <rect x="280" y="180" width="10" height="14" fill="rgba(0,0,0,0.7)" stroke={accent} />
          </g>
        )}

        {/* Stage overlay: finished circuit/label markers */}
        {showElectrical && activeStage === 'finished' && (
          <g>
            {showLabels && (
              <>
                <text x="62" y="178" fontSize={7} fontFamily="monospace" fill={accent}>
                  CKT-A
                </text>
                <text x="278" y="178" fontSize={7} fontFamily="monospace" fill={accent}>
                  CKT-B
                </text>
              </>
            )}
            <line x1="178" y1="58" x2="178" y2="48" stroke={accent} strokeDasharray="2 2" />
            {showLabels && (
              <text x="178" y="42" textAnchor="middle" fontSize={6.5} fontFamily="monospace" fill={accent}>
                LT-FIN
              </text>
            )}
          </g>
        )}

        {/* Electrical components placed by stage engine */}
        {showElectrical &&
          roomElectrical.map((comp) => {
            const normalizedX = (comp.worldPos.x - room.bounds.min.x) / Math.max(1, roomWidth)
            const normalizedZ = (comp.worldPos.z - room.bounds.min.y) / Math.max(1, roomDepth)
            const x = 58 + normalizedX * 242
            const y =
              activeStage === 'underground'
                ? 224 - normalizedZ * 18
                : activeStage === 'roughIn'
                ? 200 - comp.worldPos.y * 10
                : activeStage === 'trim'
                ? 188 - comp.worldPos.y * 11
                : 172 - comp.worldPos.y * 10
            return (
              <g key={comp.id}>
                <circle cx={x} cy={y} r={3.6} fill={accent} stroke="rgba(255,255,255,0.4)" />
                {showLabels && (activeStage === 'finished' || activeStage === 'trim') && (
                  <text x={x + 6} y={y - 4} fill="rgba(190,236,255,0.9)" fontSize={7} fontFamily="monospace">
                    {comp.category}
                  </text>
                )}
              </g>
            )
          })}

        {showDimensions && (
          <g>
            <line x1="58" y1="248" x2="300" y2="248" stroke={accent} strokeWidth="1.2" />
            <line x1="58" y1="244" x2="58" y2="252" stroke={accent} />
            <line x1="300" y1="244" x2="300" y2="252" stroke={accent} />
            <text x="179" y="261" textAnchor="middle" fill={accent} fontSize={9} fontFamily="monospace">
              {roomWidth.toFixed(1)} ft × {roomDepth.toFixed(1)} ft
            </text>
          </g>
        )}
      </svg>

      <div
        style={{
          borderTop: '1px solid rgba(0,229,204,0.14)',
          padding: '8px 10px',
          display: 'flex',
          justifyContent: 'space-between',
          gap: 10,
          fontFamily: 'monospace',
        }}
      >
        <span style={{ color: 'rgba(255,255,255,0.75)', fontSize: 11 }}>
          {room.label} Interior · {stageOverlayLabel(activeStage)}
        </span>
        <span style={{ color: `${accent}cc`, fontSize: 10 }}>
          {activeStage.toUpperCase()} • ~{Math.round(approxArea)} sq ft
        </span>
      </div>
    </div>
  )
}
