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

function pickFurniture(room: BuildingRoomModel): FurnitureItem[] {
  const kind = `${room.metadata?.type || ''} ${room.label}`.toLowerCase()

  if (kind.includes('reception') || kind.includes('entrance')) {
    return [
      { x: 50, y: 190, w: 200, h: 36, label: 'Reception Counter', fill: '#1d2230', stroke: '#c4a873' },
      { x: 60, y: 158, w: 36, h: 24, label: 'Waiting', fill: '#26303f', stroke: '#9a8d80' },
      { x: 110, y: 158, w: 36, h: 24, label: 'Waiting', fill: '#26303f', stroke: '#9a8d80' },
      { x: 160, y: 158, w: 36, h: 24, label: 'Waiting', fill: '#26303f', stroke: '#9a8d80' },
      { x: 268, y: 198, w: 28, h: 22, label: 'Tablet', fill: '#0a1018', stroke: '#86efac' },
    ]
  }
  if (kind.includes('waiting')) {
    return [
      { x: 60, y: 158, w: 44, h: 26, label: 'Bench', fill: '#1f2735', stroke: '#9a8d80' },
      { x: 130, y: 158, w: 44, h: 26, label: 'Bench', fill: '#1f2735', stroke: '#9a8d80' },
      { x: 200, y: 158, w: 44, h: 26, label: 'Bench', fill: '#1f2735', stroke: '#9a8d80' },
      { x: 130, y: 200, w: 100, h: 18, label: 'Mag Rack', fill: '#3a2e1f', stroke: '#c4a873' },
    ]
  }
  if (kind.includes('styling') || kind.includes('salon') || kind.includes('service area')) {
    return [
      { x: 30, y: 100, w: 28, h: 30, label: 'Mirror', fill: '#0a1018', stroke: '#d7c084' },
      { x: 30, y: 150, w: 28, h: 26, label: 'Chair', fill: '#1d2230', stroke: '#c4a873' },
      { x: 30, y: 195, w: 28, h: 30, label: 'Mirror', fill: '#0a1018', stroke: '#d7c084' },
      { x: 80, y: 150, w: 90, h: 26, label: 'Vanity Bench', fill: '#3a2e1f', stroke: '#c4a873' },
      { x: 200, y: 100, w: 28, h: 30, label: 'Mirror', fill: '#0a1018', stroke: '#d7c084' },
      { x: 200, y: 150, w: 28, h: 26, label: 'Chair', fill: '#1d2230', stroke: '#c4a873' },
      { x: 200, y: 195, w: 28, h: 30, label: 'Mirror', fill: '#0a1018', stroke: '#d7c084' },
    ]
  }
  if (kind.includes('bath') || kind.includes('restroom')) {
    return [
      { x: 60, y: 150, w: 48, h: 30, label: 'Sink', fill: '#d7e2ef', stroke: '#86a8c4' },
      { x: 220, y: 158, w: 46, h: 60, label: 'Toilet', fill: '#eef3f8', stroke: '#86a8c4' },
      { x: 130, y: 198, w: 80, h: 26, label: 'Vanity', fill: '#3a2e1f', stroke: '#c4a873' },
    ]
  }
  if (kind.includes('utility') || kind.includes('panel')) {
    return [
      { x: 50, y: 130, w: 80, h: 110, label: 'Panel 200A', fill: '#101820', stroke: '#eab308' },
      { x: 160, y: 170, w: 86, h: 56, label: 'Equipment Rack', fill: '#1d2230', stroke: '#c4a873' },
      { x: 260, y: 200, w: 48, h: 24, label: 'Disconnect', fill: '#101820', stroke: '#eab308' },
    ]
  }
  if (kind.includes('storage')) {
    return [
      { x: 36, y: 130, w: 22, h: 110, label: 'Shelves', fill: '#2b313c', stroke: '#9a8d80' },
      { x: 90, y: 130, w: 22, h: 110, label: 'Shelves', fill: '#2b313c', stroke: '#9a8d80' },
      { x: 260, y: 130, w: 22, h: 110, label: 'Shelves', fill: '#2b313c', stroke: '#9a8d80' },
    ]
  }
  if (kind.includes('hallway') || kind.includes('circulation')) {
    return [
      { x: 30, y: 130, w: 296, h: 8, label: 'Runner', fill: '#3a2e1f', stroke: '#c4a873' },
      { x: 30, y: 230, w: 296, h: 8, label: 'Runner', fill: '#3a2e1f', stroke: '#c4a873' },
    ]
  }
  if (kind.includes('back') || kind.includes('service')) {
    return [
      { x: 40, y: 150, w: 60, h: 60, label: 'Wash Bay', fill: '#2a3140', stroke: '#86a8c4' },
      { x: 130, y: 160, w: 90, h: 30, label: 'Work Counter', fill: '#3a2e1f', stroke: '#c4a873' },
      { x: 240, y: 160, w: 60, h: 60, label: 'Equipment', fill: '#1d2230', stroke: '#c4a873' },
    ]
  }
  return [
    { x: 48, y: 200, w: 96, h: 34, label: 'Counter', fill: '#1d2230', stroke: '#c4a873' },
    { x: 172, y: 200, w: 96, h: 34, label: 'Seating', fill: '#26303f', stroke: '#c4a873' },
  ]
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
  const wallFinish = 'url(#wall-polish)'
  const floorFinish = 'url(#floor-marble)'
  const furniture = pickFurniture(room)

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
          <pattern id="floor-marble" width="18" height="18" patternUnits="userSpaceOnUse">
            <rect width="18" height="18" fill="#ece7e1" />
            <path d="M0 6 C5 5, 8 8, 18 6 M0 13 C7 11, 12 15, 18 12" stroke="#d7d0c7" strokeWidth="0.7" fill="none" />
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

        {/* Door cue on back wall */}
        <rect x="170" y="108" width="22" height="120" fill="rgba(15,18,25,0.85)" stroke="#c4a873" />
        {/* Window / storefront cue */}
        <rect x="92" y="92" width="64" height="32" fill="rgba(180,210,255,0.18)" stroke="#9ec7f9" />

        {/* Track / fixture lights on ceiling */}
        <circle cx="178" cy="54" r="9" fill="#f2dfb0" stroke="#d6b16a" />
        <line x1="178" y1="64" x2="178" y2="84" stroke="#c9ae78" />
        <line x1="100" y1="74" x2="258" y2="74" stroke="#d7c084" strokeWidth="3" />

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
            <text x="180" y="259" textAnchor="middle" fill={accent} fontSize={8.5} fontFamily="monospace">
              Below-Slab Conduit Run
            </text>
          </g>
        )}

        {/* Stage overlay: rough-in hint (wall boxes + panel face) */}
        {showElectrical && activeStage === 'roughIn' && (
          <g>
            <rect x="278" y="100" width="16" height="46" fill="rgba(0,0,0,0.5)" stroke={accent} />
            <text x="286" y="93" textAnchor="middle" fill={accent} fontSize={7} fontFamily="monospace">
              PANEL
            </text>
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
            <text x="62" y="178" fontSize={7} fontFamily="monospace" fill={accent}>
              CKT-A
            </text>
            <text x="278" y="178" fontSize={7} fontFamily="monospace" fill={accent}>
              CKT-B
            </text>
            <line x1="178" y1="58" x2="178" y2="48" stroke={accent} strokeDasharray="2 2" />
            <text x="178" y="42" textAnchor="middle" fontSize={6.5} fontFamily="monospace" fill={accent}>
              LT-FIN
            </text>
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
