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

function pickFurniture(room: BuildingRoomModel): Array<{ x: number; y: number; w: number; h: number; label: string }> {
  const kind = `${room.metadata?.type || ''} ${room.label}`.toLowerCase()
  if (kind.includes('reception') || kind.includes('waiting')) {
    return [
      { x: 36, y: 190, w: 160, h: 42, label: 'Reception Counter' },
      { x: 230, y: 222, w: 40, h: 32, label: 'Seat' },
      { x: 286, y: 222, w: 40, h: 32, label: 'Seat' },
    ]
  }
  if (kind.includes('service') || kind.includes('salon') || kind.includes('vanity')) {
    return [
      { x: 42, y: 186, w: 78, h: 30, label: 'Styling Station' },
      { x: 138, y: 186, w: 78, h: 30, label: 'Styling Station' },
      { x: 236, y: 186, w: 70, h: 30, label: 'Vanity' },
    ]
  }
  if (kind.includes('utility') || kind.includes('electrical')) {
    return [
      { x: 38, y: 168, w: 56, h: 86, label: 'Panel' },
      { x: 112, y: 188, w: 70, h: 50, label: 'Utility Rack' },
    ]
  }
  return [
    { x: 48, y: 202, w: 96, h: 34, label: 'Counter' },
    { x: 172, y: 202, w: 96, h: 34, label: 'Seating' },
  ]
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
    <div style={{ border: '1px solid rgba(0,229,204,0.15)', borderRadius: 8, overflow: 'hidden', background: '#070b12' }}>
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
        </defs>

        <rect x="0" y="0" width="360" height="270" fill="#0a1019" />

        <polygon points="30,42 328,42 300,72 58,72" fill={wallFinish} stroke="#b6ab9f" />
        <polygon points="30,42 58,72 58,232 30,204" fill="rgba(214,205,192,0.78)" stroke="#9a8d80" />
        <polygon points="328,42 300,72 300,232 328,204" fill="rgba(206,198,186,0.78)" stroke="#978979" />
        <rect x="58" y="72" width="242" height="160" fill={wallFinish} stroke="#a69b8e" />
        <polygon points="58,232 300,232 328,204 30,204" fill={floorFinish} stroke="#c0b6aa" />

        <rect x="264" y="108" width="28" height="66" fill="rgba(20,20,20,0.55)" stroke="#d6b16a" />
        <rect x="132" y="96" width="46" height="34" fill="rgba(180,210,255,0.15)" stroke="#9ec7f9" />

        <circle cx="178" cy="54" r="9" fill="#f2dfb0" stroke="#d6b16a" />
        <line x1="178" y1="64" x2="178" y2="84" stroke="#c9ae78" />
        <line x1="112" y1="74" x2="248" y2="74" stroke="#d7c084" strokeWidth="3" />

        {furniture.map((item, idx) => (
          <g key={`${item.label}-${idx}`}>
            <rect x={item.x} y={item.y} width={item.w} height={item.h} fill="rgba(19,24,35,0.75)" stroke="#c4a873" />
            {showLabels && (
              <text x={item.x + item.w / 2} y={item.y + item.h / 2 + 4} textAnchor="middle" fill="rgba(240,237,232,0.7)" fontSize={8}>
                {item.label}
              </text>
            )}
          </g>
        ))}

        {showElectrical &&
          roomElectrical.map((comp) => {
            const normalizedX = (comp.worldPos.x - room.bounds.min.x) / Math.max(1, roomWidth)
            const normalizedZ = (comp.worldPos.z - room.bounds.min.y) / Math.max(1, roomDepth)
            const x = 58 + normalizedX * 242
            const y =
              activeStage === 'underground'
                ? 224 - normalizedZ * 18
                : activeStage === 'roughIn'
                ? 198 - comp.worldPos.y * 10
                : activeStage === 'trim'
                ? 186 - comp.worldPos.y * 11
                : 170 - comp.worldPos.y * 10
            return (
              <g key={comp.id}>
                <circle cx={x} cy={y} r={3.6} fill={accent} stroke="rgba(255,255,255,0.4)" />
                {showLabels && activeStage === 'finished' && (
                  <text x={x + 6} y={y - 4} fill="rgba(190,236,255,0.9)" fontSize={7}>
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
              {roomWidth.toFixed(1)} ft
            </text>
          </g>
        )}
      </svg>

      <div style={{ borderTop: '1px solid rgba(0,229,204,0.14)', padding: '8px 10px', display: 'flex', justifyContent: 'space-between', gap: 10, fontFamily: 'monospace' }}>
        <span style={{ color: 'rgba(255,255,255,0.75)', fontSize: 11 }}>
          {room.label} Interior
        </span>
        <span style={{ color: `${accent}cc`, fontSize: 10 }}>
          {activeStage.toUpperCase()} • ~{Math.round(approxArea)} sq ft
        </span>
      </div>
    </div>
  )
}
