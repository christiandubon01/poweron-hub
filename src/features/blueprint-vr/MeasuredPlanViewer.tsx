/**
 * src/features/blueprint-vr/MeasuredPlanViewer.tsx
 *
 * CAD-style 2D measured plan viewer for Planner5D-style Generate VR.
 *
 * Renders:
 * - Rooms, walls, dimensions
 * - Room labels and area labels
 * - Scale badge, confidence badge, fallback indicator
 * - Blueprint AI visual style (dark theme)
 * - Empty states only when completely unavailable
 */

import React, { useMemo } from 'react'
import type { BlueprintBuildingModel, BuildingRoomModel } from './buildingModel'
import type { VRStage } from './types'

export interface MeasuredPlanViewerProps {
  /** Building model to display */
  model?: BlueprintBuildingModel | null
  /** Canvas size (will use aspect ratio to fill parent) */
  width?: number
  height?: number
  /** Show dimension annotations on walls */
  showDimensions?: boolean
  /** Show room labels */
  showRoomLabels?: boolean
  /** Show area labels */
  showAreaLabels?: boolean
  /** Show confidence/scale badges */
  showBadges?: boolean
  /** Custom CSS class */
  className?: string
  /** Currently selected room id */
  selectedRoomId?: string | null
  /** Called when a room is clicked */
  onRoomSelect?: (roomId: string) => void
  /** Current stage for plan tinting */
  activeStage?: VRStage
  /** Show electrical anchors on plan */
  showElectrical?: boolean
}

/**
 * Calculate appropriate scale (SVG units per foot) based on model footprint.
 */
function calculateCanvasScale(
  modelWidth: number,
  modelHeight: number,
  canvasWidth: number,
  canvasHeight: number,
): { scalePerFoot: number; offsetX: number; offsetY: number } {
  const padding = 40
  const availableWidth = canvasWidth - padding * 2
  const availableHeight = canvasHeight - padding * 2

  const scaleX = availableWidth / modelWidth
  const scaleY = availableHeight / modelHeight
  const scalePerFoot = Math.min(scaleX, scaleY)

  const scaledWidth = modelWidth * scalePerFoot
  const scaledHeight = modelHeight * scalePerFoot
  const offsetX = padding + (availableWidth - scaledWidth) / 2
  const offsetY = padding + (availableHeight - scaledHeight) / 2

  return { scalePerFoot, offsetX, offsetY }
}

/**
 * Format a measurement value for display on dimension lines.
 */
function formatMeasurement(value: number, unit: string): string {
  if (unit === 'ft') {
    const ft = Math.floor(value)
    const inches = Math.round((value - ft) * 12)
    if (inches === 0) return `${ft}'`
    return `${ft}' ${inches}"`
  }
  if (unit === 'in') {
    return `${Math.round(value)}"`
  }
  return `${value.toFixed(1)} ${unit}`
}

/**
 * Render a single room as SVG.
 */
const STAGE_PLAN_ACCENT: Record<VRStage, string> = {
  underground: '#E07020',
  roughIn: '#3B82F6',
  trim: '#22C55E',
  finished: '#06B6D4',
}

function RoomElement({
  room,
  scalePerFoot,
  offsetX,
  offsetY,
  isSelected,
  showRoomLabels,
  showAreaLabels,
  showDimensions,
  onRoomSelect,
  accent,
}: {
  room: BuildingRoomModel
  scalePerFoot: number
  offsetX: number
  offsetY: number
  isSelected: boolean
  showRoomLabels: boolean
  showAreaLabels: boolean
  showDimensions: boolean
  onRoomSelect?: (roomId: string) => void
  accent: string
}): JSX.Element {
  const { bounds, walls, label, area } = room
  const { min, max } = bounds

  const x1 = offsetX + min.x * scalePerFoot
  const y1 = offsetY + min.y * scalePerFoot
  const width = (max.x - min.x) * scalePerFoot
  const height = (max.y - min.y) * scalePerFoot

  return (
    <g key={room.id}>
      {/* Room fill */}
      <rect
        x={x1}
        y={y1}
        width={width}
        height={height}
        fill={isSelected ? `${accent}55` : '#2a3f5f'}
        fillOpacity={isSelected ? 0.38 : 0.25}
        stroke={isSelected ? accent : '#4a90e2'}
        strokeWidth={isSelected ? 3 : 1.8}
        rx={4}
        style={{ cursor: 'pointer' }}
        onClick={() => onRoomSelect?.(room.id)}
      />

      {/* Room label */}
      {showRoomLabels && (
        <text
          x={x1 + width / 2}
          y={y1 + height / 2 - 8}
          textAnchor="middle"
          fill="#e0e6ed"
          fontSize={12}
          fontWeight="bold"
        >
          {label}
        </text>
      )}

      {/* Area label */}
      {showAreaLabels && area && (
        <text
          x={x1 + width / 2}
          y={y1 + height / 2 + 12}
          textAnchor="middle"
          fill="#a0a8b8"
          fontSize={10}
        >
          {Math.round(area)} sq ft
        </text>
      )}

      {/* Walls with dimension annotations */}
      {walls.map((wall) => {
        const wx1 = offsetX + wall.start.x * scalePerFoot
        const wy1 = offsetY + wall.start.y * scalePerFoot
        const wx2 = offsetX + wall.end.x * scalePerFoot
        const wy2 = offsetY + wall.end.y * scalePerFoot

        const length = Math.sqrt((wall.end.x - wall.start.x) ** 2 + (wall.end.y - wall.start.y) ** 2)
        const lengthFt = formatMeasurement(length, wall.height.unit)

        return (
          <g key={wall.id}>
            {/* Wall line */}
            <line x1={wx1} y1={wy1} x2={wx2} y2={wy2} stroke={isSelected ? '#f5f8ff' : '#e0e6ed'} strokeWidth={2} />

            {/* Wall dimension label (offset above/below) */}
            {showDimensions && (
              <text
                x={(wx1 + wx2) / 2}
                y={(wy1 + wy2) / 2 - 8}
                textAnchor="middle"
                fill="#90b0d0"
                fontSize={9}
                opacity={0.8}
              >
                {lengthFt}
              </text>
            )}
          </g>
        )
      })}
    </g>
  )
}

/**
 * Measured Plan Viewer Component
 */
export const MeasuredPlanViewer: React.FC<MeasuredPlanViewerProps> = ({
  model,
  width = 800,
  height = 600,
  showDimensions = true,
  showRoomLabels = true,
  showAreaLabels = true,
  showBadges = true,
  selectedRoomId = null,
  onRoomSelect,
  activeStage = 'roughIn',
  showElectrical = true,
  className,
}) => {
  const canvasSize = useMemo(
    () => ({
      width: width || 800,
      height: height || 600,
    }),
    [width, height],
  )

  // If no model or empty footprint, show empty state
  if (!model || model.footprint.width === 0 || model.footprint.height === 0) {
    return (
      <div
        className={className}
        style={{
          width: canvasSize.width,
          height: canvasSize.height,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#1a1f2e',
          borderRadius: '8px',
          color: '#a0a8b8',
          fontSize: '14px',
          textAlign: 'center',
          padding: '20px',
        }}
      >
        <div>
          <p style={{ margin: '0 0 8px' }}>No building model available</p>
          <p style={{ margin: 0, fontSize: '12px', opacity: 0.7 }}>
            Extract or provide blueprint dimensions to display the measured plan
          </p>
        </div>
      </div>
    )
  }

  const { scalePerFoot, offsetX, offsetY } = calculateCanvasScale(
    model.footprint.width,
    model.footprint.height,
    canvasSize.width,
    canvasSize.height,
  )

  // Collect all rooms from all levels
  const allRooms: BuildingRoomModel[] = model.levels.flatMap((level) => level.rooms)

  return (
    <div className={className} style={{ position: 'relative', display: 'inline-block' }}>
      {/* SVG Canvas */}
      <svg
        width={canvasSize.width}
        height={canvasSize.height}
        style={{
          backgroundColor: '#1a1f2e',
          borderRadius: '8px',
          border: '1px solid #4a90e2',
        }}
      >
        {/* Building footprint outline */}
        <rect
          x={offsetX}
          y={offsetY}
          width={model.footprint.width * scalePerFoot}
          height={model.footprint.height * scalePerFoot}
          fill="none"
          stroke="#e0e6ed"
          strokeWidth={3}
          opacity={0.5}
        />

        {/* Rooms */}
        {allRooms.map((room) => (
          <RoomElement
            key={room.id}
            room={room}
            scalePerFoot={scalePerFoot}
            offsetX={offsetX}
            offsetY={offsetY}
            isSelected={selectedRoomId === room.id}
            showRoomLabels={showRoomLabels}
            showAreaLabels={showAreaLabels}
            showDimensions={showDimensions}
            onRoomSelect={onRoomSelect}
            accent={STAGE_PLAN_ACCENT[activeStage]}
          />
        ))}

        {showElectrical && model.electricalAnchors?.map((anchor) => {
          const x = offsetX + anchor.position.x * scalePerFoot
          const y = offsetY + anchor.position.y * scalePerFoot
          return (
            <g key={anchor.id}>
              <circle cx={x} cy={y} r={4} fill={STAGE_PLAN_ACCENT[activeStage]} opacity={0.85} />
              {showRoomLabels && (
                <text x={x + 6} y={y - 6} fill="rgba(255,255,255,0.65)" fontSize={8} fontFamily="monospace">
                  {anchor.type}
                </text>
              )}
            </g>
          )
        })}
      </svg>

      {/* Badges */}
      {showBadges && (
        <div
          style={{
            position: 'absolute',
            bottom: 12,
            left: 12,
            display: 'flex',
            gap: '8px',
            flexWrap: 'wrap',
          }}
        >
          {/* Scale badge */}
          <div
            style={{
              backgroundColor: '#2a3f5f',
              color: '#a0d8ff',
              padding: '4px 8px',
              borderRadius: '4px',
              fontSize: '11px',
              border: '1px solid #4a90e2',
            }}
          >
            Scale: {model.scale.pixelsPerUnit} px/ft
          </div>

          {/* Confidence badge */}
          <div
            style={{
              backgroundColor: model.confidence >= 0.5 ? '#2a5f2a' : '#5f4a2a',
              color: model.confidence >= 0.5 ? '#a0ffa0' : '#ffd0a0',
              padding: '4px 8px',
              borderRadius: '4px',
              fontSize: '11px',
              border: `1px solid ${model.confidence >= 0.5 ? '#4aff4a' : '#ff8a4a'}`,
            }}
          >
            {model.metadata.source === 'fallback' ? 'Fallback Model' : `Confidence: ${(model.confidence * 100).toFixed(0)}%`}
          </div>
        </div>
      )}
    </div>
  )
}

export default MeasuredPlanViewer
