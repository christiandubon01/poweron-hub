import React, { useEffect, useMemo, useState } from 'react'
import type { BlueprintBuildingModel } from './buildingModel'
import type { VRStage } from './types'
import { placeElectricalComponentsInModel } from './electrical3DPlacement'
import BlueprintVRLegend from './BlueprintVRLegend'

type CameraPreset = 'top' | 'iso' | 'room'

export interface Blueprint3DSpaceViewerProps {
  buildingModel?: BlueprintBuildingModel | null
  activeStage: VRStage
  selectedRoomId?: string | null
  onRoomSelect?: (roomId: string) => void
  showElectrical?: boolean
  showDimensions?: boolean
  showLabels?: boolean
  wallOpacity?: number
  cameraPreset?: CameraPreset
  showCeiling?: boolean
  resetViewNonce?: number
}

const STAGE_COLOR: Record<VRStage, string> = {
  underground: '#E07020',
  roughIn: '#3B82F6',
  trim: '#22C55E',
  finished: '#06B6D4',
}

interface CameraState {
  orbitYaw: number
  orbitPitch: number
  zoom: number
}

interface ModelBounds {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
  centerX: number
  centerZ: number
}

const CAMERA_PRESETS: Record<CameraPreset, CameraState> = {
  top: { orbitYaw: 0, orbitPitch: 1.34, zoom: 0.92 },
  iso: { orbitYaw: -0.78, orbitPitch: 0.7, zoom: 1 },
  room: { orbitYaw: -0.16, orbitPitch: 0.32, zoom: 1.18 },
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function getRoomFill(label: string): string {
  const l = label.toLowerCase()
  if (l.includes('reception') || l.includes('waiting')) return '#c7b299'
  if (l.includes('service') || l.includes('salon')) return '#e7d9cf'
  if (l.includes('utility') || l.includes('electrical')) return '#5f6c7f'
  return '#9ca8b6'
}

function getModelBounds(rooms: Array<{ bounds: { min: { x: number; y: number }; max: { x: number; y: number } } }>): ModelBounds {
  let minX = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let minZ = Number.POSITIVE_INFINITY
  let maxZ = Number.NEGATIVE_INFINITY

  for (const room of rooms) {
    minX = Math.min(minX, room.bounds.min.x)
    maxX = Math.max(maxX, room.bounds.max.x)
    minZ = Math.min(minZ, room.bounds.min.y)
    maxZ = Math.max(maxZ, room.bounds.max.y)
  }

  if (!Number.isFinite(minX) || !Number.isFinite(maxX) || !Number.isFinite(minZ) || !Number.isFinite(maxZ)) {
    return { minX: 0, maxX: 40, minZ: 0, maxZ: 30, centerX: 20, centerZ: 15 }
  }

  return {
    minX,
    maxX,
    minZ,
    maxZ,
    centerX: (minX + maxX) / 2,
    centerZ: (minZ + maxZ) / 2,
  }
}

function projectPoint(
  x: number,
  z: number,
  y: number,
  bounds: ModelBounds,
  cameraState: CameraState,
): { x: number; y: number } {
  const relX = x - bounds.centerX
  const relZ = z - bounds.centerZ

  const cosYaw = Math.cos(cameraState.orbitYaw)
  const sinYaw = Math.sin(cameraState.orbitYaw)
  const yawX = relX * cosYaw - relZ * sinYaw
  const yawZ = relX * sinYaw + relZ * cosYaw

  const cosPitch = Math.cos(cameraState.orbitPitch)
  const sinPitch = Math.sin(cameraState.orbitPitch)
  const pitchY = y * cosPitch - yawZ * sinPitch
  const depth = y * sinPitch + yawZ * cosPitch

  const zoom = cameraState.zoom
  const baseX = 310
  const baseY = 220
  const xScale = 12 * zoom
  const depthScale = 6.7 * zoom
  const yScale = 18 * zoom

  return {
    x: baseX + yawX * xScale,
    y: baseY + depth * depthScale - pitchY * yScale,
  }
}

export default function Blueprint3DSpaceViewer({
  buildingModel,
  activeStage,
  selectedRoomId = null,
  onRoomSelect,
  showElectrical = true,
  showDimensions = true,
  showLabels = true,
  wallOpacity = 0.8,
  cameraPreset = 'iso',
  showCeiling = false,
  resetViewNonce,
}: Blueprint3DSpaceViewerProps) {
  const level = buildingModel?.levels[0]
  const rooms = level?.rooms || []
  const stageColor = STAGE_COLOR[activeStage]
  const initialCamera = CAMERA_PRESETS[cameraPreset]
  const [orbitYaw, setOrbitYaw] = useState(initialCamera.orbitYaw)
  const [orbitPitch, setOrbitPitch] = useState(initialCamera.orbitPitch)
  const [zoom, setZoom] = useState(initialCamera.zoom)
  const [isDragging, setIsDragging] = useState(false)
  const [lastPointer, setLastPointer] = useState<{ x: number; y: number } | null>(null)
  const [hoveredRoomId, setHoveredRoomId] = useState<string | null>(null)
  const modelBounds = useMemo(() => getModelBounds(rooms), [rooms])

  useEffect(() => {
    const next = CAMERA_PRESETS[cameraPreset]
    setOrbitYaw(next.orbitYaw)
    setOrbitPitch(next.orbitPitch)
    setZoom(next.zoom)
  }, [cameraPreset, resetViewNonce])

  const electrical = useMemo(() => {
    if (!buildingModel || !showElectrical) return []
    return placeElectricalComponentsInModel(buildingModel, activeStage)
  }, [buildingModel, showElectrical, activeStage])

  if (!buildingModel || rooms.length === 0) {
    return (
      <div style={{ padding: 20, borderRadius: 8, border: '1px solid rgba(0,229,204,0.15)', color: 'rgba(255,255,255,0.65)', fontFamily: 'monospace' }}>
        3D dollhouse view is unavailable because the building model has no rooms.
      </div>
    )
  }

  const ceilingHeight = buildingModel.ceilingHeight.unit === 'ft'
    ? buildingModel.ceilingHeight.value
    : buildingModel.ceilingHeight.value / 12

  const currentCamera: CameraState = {
    orbitYaw,
    orbitPitch,
    zoom,
  }

  const handlePointerDown: React.PointerEventHandler<SVGSVGElement> = (event) => {
    event.currentTarget.setPointerCapture(event.pointerId)
    setIsDragging(true)
    setLastPointer({ x: event.clientX, y: event.clientY })
  }

  const handlePointerMove: React.PointerEventHandler<SVGSVGElement> = (event) => {
    if (!isDragging || !lastPointer) return
    const dx = event.clientX - lastPointer.x
    const dy = event.clientY - lastPointer.y
    setOrbitYaw((value) => value + dx * 0.008)
    setOrbitPitch((value) => clamp(value - dy * 0.005, 0.18, 1.36))
    setLastPointer({ x: event.clientX, y: event.clientY })
  }

  const stopDragging: React.PointerEventHandler<SVGSVGElement> = (event) => {
    try {
      event.currentTarget.releasePointerCapture(event.pointerId)
    } catch {
      // no-op: pointer may already be released
    }
    setIsDragging(false)
    setLastPointer(null)
  }

  const handleWheel: React.WheelEventHandler<HTMLDivElement> = (event) => {
    event.preventDefault()
    setZoom((value) => clamp(value - event.deltaY * 0.0014, 0.65, 1.8))
  }

  return (
    <div
      onWheel={handleWheel}
      style={{ border: '1px solid rgba(0,229,204,0.14)', borderRadius: 8, overflow: 'hidden', background: '#070b12' }}
    >
      <svg
        viewBox="0 0 620 420"
        width="100%"
        style={{ display: 'block', cursor: isDragging ? 'grabbing' : 'grab', touchAction: 'none' }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={stopDragging}
        onPointerLeave={stopDragging}
      >
        <defs>
          <pattern id="floor-grid" width="20" height="20" patternUnits="userSpaceOnUse">
            <rect width="20" height="20" fill="#1a2330" />
            <path d="M20 0H0V20" fill="none" stroke="rgba(255,255,255,0.06)" />
          </pattern>
        </defs>
        <rect x="0" y="0" width="620" height="420" fill="#0a121d" />

        <polygon
          points="60,330 560,330 520,365 100,365"
          fill="url(#floor-grid)"
          stroke="rgba(210,220,230,0.28)"
          strokeWidth="1.2"
        />

        {rooms.map((room) => {
          const { min, max } = room.bounds
          const p1 = projectPoint(min.x, min.y, 0, modelBounds, currentCamera)
          const p2 = projectPoint(max.x, min.y, 0, modelBounds, currentCamera)
          const p3 = projectPoint(max.x, max.y, 0, modelBounds, currentCamera)
          const p4 = projectPoint(min.x, max.y, 0, modelBounds, currentCamera)

          const t1 = projectPoint(min.x, min.y, ceilingHeight, modelBounds, currentCamera)
          const t2 = projectPoint(max.x, min.y, ceilingHeight, modelBounds, currentCamera)
          const t3 = projectPoint(max.x, max.y, ceilingHeight, modelBounds, currentCamera)
          const t4 = projectPoint(min.x, max.y, ceilingHeight, modelBounds, currentCamera)

          const selected = selectedRoomId === room.id
          const hovered = hoveredRoomId === room.id
          const baseFill = getRoomFill(room.label)
          const floorOpacity = selected ? 0.76 : hovered ? 0.58 : 0.45

          return (
            <g key={room.id}>
              <polygon
                points={`${p1.x},${p1.y} ${p2.x},${p2.y} ${p3.x},${p3.y} ${p4.x},${p4.y}`}
                fill={baseFill}
                opacity={floorOpacity}
                stroke={selected ? stageColor : hovered ? 'rgba(255,255,255,0.75)' : 'rgba(220,230,238,0.35)'}
                strokeWidth={selected ? 3 : hovered ? 2.2 : 1}
              />
              {(selected || hovered) && (
                <polygon
                  points={`${p1.x},${p1.y} ${p2.x},${p2.y} ${p3.x},${p3.y} ${p4.x},${p4.y}`}
                  fill={selected ? `${stageColor}33` : 'rgba(255,255,255,0.08)'}
                  stroke="none"
                />
              )}
              <polygon
                points={`${p4.x},${p4.y} ${p3.x},${p3.y} ${t3.x},${t3.y} ${t4.x},${t4.y}`}
                fill="rgba(236,232,225,0.32)"
                opacity={wallOpacity}
                stroke="rgba(255,255,255,0.24)"
                strokeWidth="1"
              />
              <polygon
                points={`${p3.x},${p3.y} ${p2.x},${p2.y} ${t2.x},${t2.y} ${t3.x},${t3.y}`}
                fill="rgba(206,201,190,0.3)"
                opacity={wallOpacity}
                stroke="rgba(255,255,255,0.22)"
                strokeWidth="1"
              />
              {showCeiling && (
                <polygon
                  points={`${t1.x},${t1.y} ${t2.x},${t2.y} ${t3.x},${t3.y} ${t4.x},${t4.y}`}
                  fill="rgba(246,243,238,0.18)"
                  stroke="rgba(240,236,230,0.25)"
                />
              )}
              <line x1={p4.x} y1={p4.y} x2={p3.x} y2={p3.y} stroke="#d2b48c" strokeWidth="2" opacity="0.75" />
              <line x1={p3.x} y1={p3.y} x2={t3.x} y2={t3.y} stroke="rgba(160,180,200,0.3)" strokeWidth="1.4" strokeDasharray="5 3" />
              {room.walls.flatMap((wall) => {
                const dx = wall.end.x - wall.start.x
                const dz = wall.end.y - wall.start.y
                const len = Math.hypot(dx, dz) || 1
                return wall.openings.map((opening) => {
                  const t = Math.min(1, Math.max(0, opening.positionAlongWall.value / len))
                  const ox = wall.start.x + dx * t
                  const oz = wall.start.y + dz * t
                  const o = projectPoint(ox, oz, opening.type === 'door' ? 1 : 4, modelBounds, currentCamera)
                  return (
                    <g key={`${room.id}-${wall.id}-${opening.id}`}>
                      <line
                        x1={o.x - 8}
                        y1={o.y}
                        x2={o.x + 8}
                        y2={o.y}
                        stroke={opening.type === 'door' ? '#f0d4aa' : '#9ec8ff'}
                        strokeWidth={2}
                        strokeDasharray="3 2"
                      />
                    </g>
                  )
                })
              })}
              <polygon
                points={`${p1.x},${p1.y} ${p2.x},${p2.y} ${p3.x},${p3.y} ${p4.x},${p4.y}`}
                fill="transparent"
                style={{ cursor: 'pointer' }}
                onMouseEnter={() => setHoveredRoomId(room.id)}
                onMouseLeave={() => setHoveredRoomId((current) => (current === room.id ? null : current))}
                onClick={() => onRoomSelect?.(room.id)}
              />
              {showLabels && (
                <text
                  x={(p1.x + p3.x) / 2}
                  y={(p1.y + p3.y) / 2}
                  textAnchor="middle"
                  fill="rgba(255,255,255,0.84)"
                  fontSize={10}
                  fontFamily="monospace"
                >
                  {room.label}
                </text>
              )}
            </g>
          )
        })}

        {rooms.map((room, idx) => {
          const cX = (room.bounds.min.x + room.bounds.max.x) / 2
          const cZ = (room.bounds.min.y + room.bounds.max.y) / 2
          const p = projectPoint(cX, cZ, 0.6, modelBounds, currentCamera)
          const isReception = room.label.toLowerCase().includes('reception') || room.label.toLowerCase().includes('waiting')
          const isSalon = room.label.toLowerCase().includes('service') || room.label.toLowerCase().includes('salon')
          const isUtility = room.label.toLowerCase().includes('utility') || room.label.toLowerCase().includes('electrical')
          return (
            <g key={`${room.id}-furniture-${idx}`} opacity={0.9}>
              {isReception && (
                <>
                  <rect x={p.x - 36} y={p.y - 8} width={72} height={16} fill="#232c38" stroke="#c39b58" />
                  <circle cx={p.x + 52} cy={p.y + 10} r={8} fill="#232c38" stroke="#c39b58" />
                </>
              )}
              {isSalon && (
                <>
                  <rect x={p.x - 32} y={p.y - 8} width={24} height={16} fill="#1a1f2b" stroke="#c39b58" />
                  <rect x={p.x - 2} y={p.y - 8} width={24} height={16} fill="#1a1f2b" stroke="#c39b58" />
                  <rect x={p.x + 28} y={p.y - 8} width={24} height={16} fill="#1a1f2b" stroke="#c39b58" />
                </>
              )}
              {isUtility && <rect x={p.x - 12} y={p.y - 22} width={24} height={34} fill="#111722" stroke="#9db4c8" />}
            </g>
          )
        })}

        {showElectrical &&
          electrical.map((comp) => {
            const pp = projectPoint(comp.worldPos.x, comp.worldPos.z, Math.max(0, comp.worldPos.y), modelBounds, currentCamera)
            return (
              <g key={comp.id}>
                <circle cx={pp.x} cy={pp.y} r={3.4} fill={stageColor} stroke="rgba(255,255,255,0.38)" />
                {activeStage === 'finished' && showLabels && (
                  <text x={pp.x + 5} y={pp.y - 6} fill="rgba(177,239,255,0.88)" fontSize={7}>
                    {comp.category}
                  </text>
                )}
              </g>
            )
          })}

        {showDimensions && (
          <g>
            <line x1="110" y1="390" x2="430" y2="390" stroke={stageColor} />
            <line x1="110" y1="385" x2="110" y2="395" stroke={stageColor} />
            <line x1="430" y1="385" x2="430" y2="395" stroke={stageColor} />
            <text x="270" y="405" textAnchor="middle" fill={stageColor} fontSize={10} fontFamily="monospace">
              {buildingModel.footprint.width} ft width
            </text>
          </g>
        )}
      </svg>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '7px 10px', borderTop: '1px solid rgba(0,229,204,0.12)' }}>
        <div style={{ color: 'rgba(255,255,255,0.7)', fontFamily: 'monospace', fontSize: 10 }}>
          Click a room to enter Room View
        </div>
        <div style={{ color: `${stageColor}c9`, fontFamily: 'monospace', fontSize: 10 }}>
          {activeStage.toUpperCase()} • YAW {orbitYaw.toFixed(2)} • ZOOM {zoom.toFixed(2)}x
        </div>
      </div>
      <div style={{ padding: '0 10px 10px' }}>
        <BlueprintVRLegend stage={activeStage} buildingModel={buildingModel} compact />
      </div>
    </div>
  )
}
