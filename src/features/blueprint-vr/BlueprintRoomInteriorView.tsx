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

function hasAnyToken(value: string, tokens: string[]): boolean {
  const normalized = value.toLowerCase()
  return tokens.some((token) => normalized.includes(token))
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
  const roomElectricalPoints = roomElectrical.map((comp) => {
    const normalizedX = (comp.worldPos.x - room.bounds.min.x) / Math.max(1, roomWidth)
    const normalizedZ = (comp.worldPos.z - room.bounds.min.y) / Math.max(1, roomDepth)
    const x = 58 + normalizedX * 242
    const floorY = 224 - normalizedZ * 18
    const wallY = 204 - comp.worldPos.y * 12 - normalizedZ * 5
    const ceilingY = 92 + normalizedZ * 10
    const text = `${comp.category} ${comp.label}`.toLowerCase()
    return {
      ...comp,
      text,
      x,
      floorY,
      wallY,
      ceilingY,
    }
  })

  const undergroundPoints = roomElectricalPoints.filter((comp) =>
    hasAnyToken(comp.text, ['conduit', 'floor box', 'service', 'ground']),
  )
  const roughWallBoxes = roomElectricalPoints.filter((comp) =>
    hasAnyToken(comp.text, ['device box', 'j-box', 'panel']),
  )
  const trimReceptacles = roomElectricalPoints.filter((comp) =>
    hasAnyToken(comp.text, ['receptacle']),
  )
  const trimSwitches = roomElectricalPoints.filter((comp) =>
    hasAnyToken(comp.text, ['switch']),
  )
  const trimFixtures = roomElectricalPoints.filter((comp) =>
    hasAnyToken(comp.text, ['fixture']),
  )
  const finishedDevices = roomElectricalPoints.filter((comp) =>
    hasAnyToken(comp.text, ['labeled device', 'as-built marker', 'light circuit']),
  )
  const isUtilityLikeRoom = hasAnyToken(`${room.label} ${room.metadata?.type || ''}`, ['utility', 'panel', 'service', 'electrical'])

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

        {showElectrical && activeStage === 'underground' && (
          <g>
            {undergroundPoints.length > 1 && (
              <polyline
                points={undergroundPoints.map((point) => `${point.x},${point.floorY}`).join(' ')}
                fill="none"
                stroke="#ff9b45"
                strokeWidth={2.6}
                strokeDasharray="8 4"
                opacity={0.9}
              />
            )}
            {undergroundPoints.map((comp, idx) => {
              const isFloorBox = hasAnyToken(comp.text, ['floor box'])
              const isService = hasAnyToken(comp.text, ['service', 'ground'])
              return (
                <g key={comp.id}>
                  {isFloorBox && (
                    <rect x={comp.x - 4.5} y={comp.floorY - 4.5} width={9} height={9} fill="#ffa040" stroke="#ffd1a8" strokeWidth={0.8} />
                  )}
                  {!isFloorBox && <circle cx={comp.x} cy={comp.floorY} r={3.2} fill="#e07020" stroke="#ffe7cc" strokeWidth={0.9} />}
                  {isService && (
                    <path
                      d={`M ${comp.x} ${comp.floorY - 10} L ${comp.x - 4} ${comp.floorY - 2} L ${comp.x + 4} ${comp.floorY - 2} Z`}
                      fill="#ff5252"
                      opacity={0.95}
                    />
                  )}
                  {idx % 2 === 0 && !isFloorBox && (
                    <circle cx={comp.x} cy={comp.floorY} r={6.4} fill="none" stroke="#ff8b5c" strokeDasharray="3 2" opacity={0.65} />
                  )}
                </g>
              )
            })}
            {showLabels && (
              <text x={64} y={216} fill="#ffbf8d" fontSize={8} fontFamily="monospace">
                Below slab / floor rough path
              </text>
            )}
          </g>
        )}

        {showElectrical && activeStage === 'roughIn' && (
          <g>
            {roughWallBoxes.map((comp, idx) => (
              <g key={comp.id}>
                <rect x={comp.x - 5} y={comp.wallY - 6} width={10} height={12} fill="rgba(59,130,246,0.2)" stroke="#60a5fa" strokeWidth={1.1} />
                {idx > 0 && (
                  <line
                    x1={roughWallBoxes[idx - 1].x}
                    y1={roughWallBoxes[idx - 1].wallY}
                    x2={comp.x}
                    y2={comp.wallY}
                    stroke="#93c5fd"
                    strokeWidth={1.4}
                    strokeDasharray="4 3"
                    opacity={0.85}
                  />
                )}
              </g>
            ))}
            {isUtilityLikeRoom && (
              <g>
                <rect x={266} y={130} width={20} height={38} fill="rgba(234,179,8,0.14)" stroke="#fbbf24" />
                <line x1={276} y1={130} x2={226} y2={106} stroke="#fbbf24" strokeDasharray="5 2" />
                {showLabels && (
                  <>
                    <text x={276} y={126} textAnchor="middle" fill="#fbbf24" fontSize={7} fontFamily="monospace">
                      PANEL
                    </text>
                    <text x={220} y={102} fill="#93c5fd" fontSize={7} fontFamily="monospace">
                      HOMERUN
                    </text>
                  </>
                )}
              </g>
            )}
          </g>
        )}

        {showElectrical && activeStage === 'trim' && (
          <g>
            {trimReceptacles.map((comp) => (
              <g key={comp.id}>
                <rect x={comp.x - 4} y={comp.wallY - 5} width={8} height={10} fill="rgba(34,197,94,0.2)" stroke="#22c55e" />
                <line x1={comp.x - 1.5} y1={comp.wallY - 2.5} x2={comp.x - 1.5} y2={comp.wallY + 2.5} stroke="#ccffe0" strokeWidth={0.7} />
                <line x1={comp.x + 1.5} y1={comp.wallY - 2.5} x2={comp.x + 1.5} y2={comp.wallY + 2.5} stroke="#ccffe0" strokeWidth={0.7} />
              </g>
            ))}
            {trimSwitches.map((comp) => (
              <g key={comp.id}>
                <rect x={comp.x - 3.8} y={comp.wallY - 3.8} width={7.6} height={7.6} fill="rgba(74,222,128,0.22)" stroke="#4ade80" />
                <text x={comp.x} y={comp.wallY + 2} textAnchor="middle" fill="#b7ffd1" fontSize={6.2} fontFamily="monospace">S</text>
              </g>
            ))}
            {trimFixtures.map((comp) => (
              <g key={comp.id}>
                <circle cx={comp.x} cy={comp.ceilingY} r={6} fill="rgba(134,239,172,0.2)" stroke="#86efac" />
                <line x1={comp.x - 4} y1={comp.ceilingY - 4} x2={comp.x + 4} y2={comp.ceilingY + 4} stroke="#ccffe0" strokeWidth={1} />
                <line x1={comp.x + 4} y1={comp.ceilingY - 4} x2={comp.x - 4} y2={comp.ceilingY + 4} stroke="#ccffe0" strokeWidth={1} />
              </g>
            ))}
          </g>
        )}

        {showElectrical && activeStage === 'finished' && (
          <g>
            {finishedDevices.map((comp, idx) => (
              <g key={comp.id}>
                <circle cx={comp.x} cy={comp.wallY} r={4.2} fill="rgba(6,182,212,0.22)" stroke="#67e8f9" strokeWidth={1.1} />
                <circle cx={comp.x} cy={comp.wallY} r={1.8} fill="#a78bfa" />
                {showLabels && (
                  <text x={comp.x + 6} y={comp.wallY - 5} fill={idx % 2 === 0 ? '#67e8f9' : '#d9b8ff'} fontSize={6.5} fontFamily="monospace">
                    CKT-{idx + 1}
                  </text>
                )}
              </g>
            ))}
            {isUtilityLikeRoom && showLabels && (
              <text x={268} y={122} textAnchor="middle" fill="#d9b8ff" fontSize={7} fontFamily="monospace">
                PANEL LABELS VERIFIED
              </text>
            )}
          </g>
        )}

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
