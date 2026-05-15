/**
 * src/features/blueprint-vr/MeasuredPlanViewer.tsx
 *
 * CAD-style 2D measured plan viewer for the Generate VR experience.
 *
 * Renders:
 *  - Building footprint outline (exterior wall mass)
 *  - Interior partitions and thin station divider walls with kind-aware
 *    thickness and color
 *  - Doors with swing arcs, sliding hatches, and storefront / pass-through
 *    openings rendered as transparent glass bands
 *  - Room fills, labels, area labels, dimension annotations
 *  - Source / confidence badges including a clear "Inferred Source" mark
 *  - Selected room highlight and click → enter Room View
 *
 * The viewer is auto-sizing — it fills the parent width but locks the modal-
 * friendly aspect ratio so the long Beauty Salon plan does not leave wide
 * empty space.
 */

import React, { useMemo } from 'react'
import type {
  BlueprintBuildingModel,
  BuildingRoomModel,
  BuildingWallModel,
  BuildingOpeningModel,
  BlueprintProposedWallLayout,
  ProposedWallLayoutSegment,
  ProposedWallLayoutOpening,
} from './buildingModel'
import type { BlueprintPlan2DSourceMode, FullSetWallLayoutDebug } from './blueprintPlanScanner'
import type { VRStage } from './types'

export interface MeasuredPlanViewerProps {
  model?: BlueprintBuildingModel | null
  /** Full-set proposed wall layout (2D Plan wall-only mode). */
  proposedWallLayout?: BlueprintProposedWallLayout | null
  /** When wall extraction failed, show this instead of geometry. */
  wallLayoutFailureMessage?: string | null
  fullSetWallDebug?: FullSetWallLayoutDebug | null
  /** When true, do not render legacy room/electrical plan until wall props resolve. */
  suppressLegacyPlan2D?: boolean
  width?: number
  height?: number
  showDimensions?: boolean
  showRoomLabels?: boolean
  showAreaLabels?: boolean
  showBadges?: boolean
  className?: string
  selectedRoomId?: string | null
  onRoomSelect?: (roomId: string) => void
  activeStage?: VRStage
  showElectrical?: boolean
  plan2DSourceMode?: BlueprintPlan2DSourceMode
  calibratedSourceNote?: string
  traceDebug?: {
    rawLines: number
    mergedWalls: number
    openings: number
    roomCandidates: number
  } | null
}

// ─── helpers ─────────────────────────────────────────────────────────────

function calculateCanvasScale(
  modelWidth: number,
  modelHeight: number,
  canvasWidth: number,
  canvasHeight: number,
): { scalePerFoot: number; offsetX: number; offsetY: number } {
  const padding = 32
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

function formatFt(value: number): string {
  const ft = Math.floor(value)
  const inches = Math.round((value - ft) * 12)
  if (inches === 0) return `${ft}'-0"`
  return `${ft}'-${inches}"`
}

const STAGE_PLAN_ACCENT: Record<VRStage, string> = {
  underground: '#E07020',
  roughIn: '#3B82F6',
  trim: '#22C55E',
  finished: '#06B6D4',
}

interface WallStyle {
  stroke: string
  strokeWidth: number
  fill?: string
  dash?: string
}

interface FurnitureSymbol {
  shape: 'rect' | 'circle'
  widthFt: number
  depthFt: number
  fill: string
  stroke: string
  opacity: number
  shortLabel?: string
}

/**
 * Map an equipment hint kind to a tiny in-plan furniture symbol. Keeps the
 * 2D plan reading as a CAD-style architectural floor plan instead of just
 * colored room rectangles.
 */
function furnitureSymbol(
  kind: NonNullable<BuildingRoomModel['equipmentHints']>[number]['kind'],
): FurnitureSymbol | null {
  switch (kind) {
    case 'reception-counter':
      return { shape: 'rect', widthFt: 6, depthFt: 2, fill: '#2a2118', stroke: '#c4a873', opacity: 0.9, shortLabel: 'COUNTER' }
    case 'waiting-couch':
      return { shape: 'rect', widthFt: 4.5, depthFt: 2, fill: '#26303f', stroke: '#9a8d80', opacity: 0.9, shortLabel: 'SOFA' }
    case 'waiting-chair':
      return { shape: 'rect', widthFt: 1.8, depthFt: 1.8, fill: '#26303f', stroke: '#9a8d80', opacity: 0.9 }
    case 'side-table':
      return { shape: 'rect', widthFt: 1.4, depthFt: 1.4, fill: '#3a2e1f', stroke: '#c4a873', opacity: 0.85 }
    case 'styling-chair':
      return { shape: 'rect', widthFt: 2, depthFt: 2, fill: '#1d2230', stroke: '#c4a873', opacity: 0.85, shortLabel: 'CHAIR' }
    case 'styling-mirror':
      return { shape: 'rect', widthFt: 0.4, depthFt: 2.6, fill: '#0a1018', stroke: '#d7c084', opacity: 1, shortLabel: 'MIR' }
    case 'vanity-counter':
      return { shape: 'rect', widthFt: 2.6, depthFt: 1.4, fill: '#3a2e1f', stroke: '#c4a873', opacity: 0.85 }
    case 'wash-sink':
    case 'shampoo-bowl':
      return { shape: 'circle', widthFt: 2.2, depthFt: 2.2, fill: '#d7e2ef', stroke: '#86a8c4', opacity: 0.95, shortLabel: 'BOWL' }
    case 'restroom-sink':
      return { shape: 'rect', widthFt: 1.6, depthFt: 1.2, fill: '#d7e2ef', stroke: '#86a8c4', opacity: 0.95, shortLabel: 'SINK' }
    case 'toilet':
      return { shape: 'rect', widthFt: 1.4, depthFt: 2, fill: '#eef3f8', stroke: '#86a8c4', opacity: 0.95, shortLabel: 'WC' }
    case 'utility-panel':
      return { shape: 'rect', widthFt: 1.6, depthFt: 0.4, fill: '#101820', stroke: '#eab308', opacity: 1, shortLabel: 'PANEL' }
    case 'service-equipment':
      return { shape: 'rect', widthFt: 2, depthFt: 1.8, fill: '#1d2230', stroke: '#c4a873', opacity: 0.8 }
    case 'storage-shelving':
      return { shape: 'rect', widthFt: 1.2, depthFt: 4, fill: '#2b313c', stroke: '#9a8d80', opacity: 0.85, shortLabel: 'SHELF' }
    case 'storefront-sign':
      return { shape: 'rect', widthFt: 4, depthFt: 0.4, fill: '#6b4a26', stroke: '#c4a873', opacity: 0.7 }
    case 'decor-wall':
      return { shape: 'rect', widthFt: 4, depthFt: 0.4, fill: '#6b4a26', stroke: '#c4a873', opacity: 0.7 }
    case 'overhead-light':
    case 'track-light':
    case 'chandelier':
      return null
    default:
      return null
  }
}

function styleForWall(wall: BuildingWallModel, selected: boolean): WallStyle {
  const kind = wall.kind || 'partition'
  if (kind === 'exterior') {
    return { stroke: selected ? '#fff' : '#e0e6ed', strokeWidth: 4 }
  }
  if (kind === 'partition') {
    return { stroke: selected ? '#dde7f3' : '#b6c0cc', strokeWidth: 2.4 }
  }
  if (kind === 'divider') {
    return { stroke: '#9aa5b2', strokeWidth: 1.2, dash: '4 2' }
  }
  if (kind === 'glass') {
    return { stroke: '#9ec7f9', strokeWidth: 2.4, dash: '6 2' }
  }
  if (kind === 'pony') {
    return { stroke: '#a89c80', strokeWidth: 1.4, dash: '2 2' }
  }
  return { stroke: '#b6c0cc', strokeWidth: 2 }
}

// ─── opening rendering ───────────────────────────────────────────────────

function renderOpening(
  opening: BuildingOpeningModel,
  wall: BuildingWallModel,
  scalePerFoot: number,
  offsetX: number,
  offsetY: number,
  accent: string,
): JSX.Element | null {
  const ws = wall.start
  const we = wall.end
  const wallLen = Math.hypot(we.x - ws.x, we.y - ws.y)
  if (wallLen < 0.5) return null
  const posFt =
    opening.positionAlongWall.unit === 'ft'
      ? opening.positionAlongWall.value
      : opening.positionAlongWall.value / 12
  const t = Math.max(0, Math.min(1, posFt / wallLen))
  const cx = offsetX + (ws.x + (we.x - ws.x) * t) * scalePerFoot
  const cy = offsetY + (ws.y + (we.y - ws.y) * t) * scalePerFoot
  const widthFt =
    opening.width.unit === 'ft' ? opening.width.value : opening.width.value / 12
  const halfPx = (widthFt / 2) * scalePerFoot
  const dirX = (we.x - ws.x) / wallLen
  const dirY = (we.y - ws.y) / wallLen
  const nx = -dirY
  const ny = dirX
  const subtype = opening.subtype
  const isStorefront = subtype === 'window-storefront'
  const isPassThrough = subtype === 'pass-through'
  const isSliding = subtype === 'door-sliding' || subtype === 'door-pocket' || opening.swing === 'sliding'
  const isWindow = opening.type === 'window'

  // Cut the wall line beneath the opening with a contrasting fill.
  const ax = cx - dirX * halfPx
  const ay = cy - dirY * halfPx
  const bx = cx + dirX * halfPx
  const by = cy + dirY * halfPx

  if (isStorefront || (isWindow && !isPassThrough)) {
    return (
      <g key={opening.id}>
        <rect
          x={cx - halfPx}
          y={cy - 5}
          width={halfPx * 2}
          height={10}
          transform={`rotate(${(Math.atan2(dirY, dirX) * 180) / Math.PI}, ${cx}, ${cy})`}
          fill={isStorefront ? 'rgba(158,200,255,0.32)' : 'rgba(158,200,255,0.18)'}
          stroke="#9ec7f9"
          strokeWidth={1}
        />
      </g>
    )
  }

  if (isPassThrough) {
    return (
      <g key={opening.id}>
        <line x1={ax} y1={ay} x2={bx} y2={by} stroke="#0c1118" strokeWidth={6} />
        <line x1={ax} y1={ay} x2={bx} y2={by} stroke="#cdd6e2" strokeWidth={2} strokeDasharray="3 3" />
      </g>
    )
  }

  if (isSliding) {
    return (
      <g key={opening.id}>
        <line x1={ax} y1={ay} x2={bx} y2={by} stroke="#0c1118" strokeWidth={5} />
        <line x1={ax} y1={ay} x2={bx} y2={by} stroke="#c4a873" strokeWidth={1.5} strokeDasharray="2 1" />
        <polygon
          points={`${cx + dirX * 4},${cy + dirY * 4 - 4} ${cx + dirX * 4 + 4},${cy + dirY * 4} ${cx + dirX * 4},${cy + dirY * 4 + 4}`}
          fill="#c4a873"
        />
      </g>
    )
  }

  // Hinged door — draw the leaf line plus the swing arc
  const swing = opening.swing || 'right'
  const swingDeg = opening.swingDegrees ?? 90
  // Hinge is at one end of the opening (chosen by swing dir).
  const hingeAtStart = swing === 'left' || swing === 'double'
  const hx = hingeAtStart ? ax : bx
  const hy = hingeAtStart ? ay : by
  const leafLen = halfPx * 2
  // Outward normal direction (interior side of wall) — pick whichever side the
  // arc visually lives in. The plan view uses the +n direction.
  const outwardSign = swing === 'left' ? 1 : swing === 'double' ? 1 : -1
  const radius = leafLen
  const leafEndX = hx + (dirX * leafLen * Math.cos((swingDeg * Math.PI) / 180) + nx * outwardSign * radius * Math.sin((swingDeg * Math.PI) / 180))
  const leafEndY = hy + (dirY * leafLen * Math.cos((swingDeg * Math.PI) / 180) + ny * outwardSign * radius * Math.sin((swingDeg * Math.PI) / 180))
  const arcEndX = hx + nx * outwardSign * radius
  const arcEndY = hy + ny * outwardSign * radius

  return (
    <g key={opening.id}>
      {/* Door opening hole — paint over the wall in dark to show a gap */}
      <line x1={ax} y1={ay} x2={bx} y2={by} stroke="#0c1118" strokeWidth={5} />
      {/* Door leaf */}
      <line x1={hx} y1={hy} x2={leafEndX} y2={leafEndY} stroke="#c4a873" strokeWidth={2} />
      {/* Swing arc */}
      <path
        d={`M ${hx} ${hy} L ${leafEndX} ${leafEndY} A ${radius} ${radius} 0 0 ${outwardSign > 0 ? 0 : 1} ${arcEndX} ${arcEndY}`}
        fill="none"
        stroke={accent}
        strokeWidth={0.9}
        strokeDasharray="2 2"
        opacity={0.85}
      />
    </g>
  )
}

// ─── room ───────────────────────────────────────────────────────────────

function RoomElement({
  room,
  scalePerFoot,
  offsetX,
  offsetY,
  isSelected,
  showRoomLabels,
  showAreaLabels,
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
  onRoomSelect?: (roomId: string) => void
  accent: string
}): JSX.Element {
  const { bounds, area, label } = room
  const { min, max } = bounds
  const x1 = offsetX + min.x * scalePerFoot
  const y1 = offsetY + min.y * scalePerFoot
  const width = (max.x - min.x) * scalePerFoot
  const height = (max.y - min.y) * scalePerFoot

  return (
    <g>
      <rect
        x={x1}
        y={y1}
        width={width}
        height={height}
        fill={isSelected ? `${accent}33` : 'rgba(42,63,95,0.42)'}
        fillOpacity={isSelected ? 0.55 : 0.45}
        stroke={isSelected ? accent : 'rgba(74,144,226,0.55)'}
        strokeWidth={isSelected ? 2.6 : 1.4}
        rx={3}
        style={{ cursor: 'pointer' }}
        onClick={() => onRoomSelect?.(room.id)}
      />
      {showRoomLabels && (
        <text
          x={x1 + width / 2}
          y={y1 + height / 2 - 5}
          textAnchor="middle"
          fill={isSelected ? '#fff' : '#e0e6ed'}
          fontSize={Math.max(9, Math.min(13, width / 16))}
          fontWeight="bold"
          style={{ pointerEvents: 'none' }}
        >
          {label}
        </text>
      )}
      {showAreaLabels && area && height > 24 && (
        <text
          x={x1 + width / 2}
          y={y1 + height / 2 + 10}
          textAnchor="middle"
          fill="rgba(160,168,184,0.85)"
          fontSize={9}
          style={{ pointerEvents: 'none' }}
        >
          {Math.round(area)} sq ft
        </text>
      )}
    </g>
  )
}

// ─── component ───────────────────────────────────────────────────────────

function wallStyleFromSegment(seg: ProposedWallLayoutSegment, selected: boolean): WallStyle {
  const kind = seg.kind || 'partition'
  if (kind === 'exterior') {
    return { stroke: selected ? '#fff' : '#e8eef5', strokeWidth: 4.2 }
  }
  if (kind === 'glass') {
    return { stroke: '#9ec7f9', strokeWidth: 2.4, dash: '6 2' }
  }
  if (kind === 'divider') {
    return { stroke: '#9aa5b2', strokeWidth: 1.3, dash: '4 2' }
  }
  return { stroke: selected ? '#dde7f3' : '#b6c0cc', strokeWidth: 2.2 }
}

function tempWallFromSegment(seg: ProposedWallLayoutSegment): BuildingWallModel {
  const th = (seg.thicknessInches || (seg.exterior ? 6 : 4)) / 12
  return {
    id: seg.id,
    start: seg.start,
    end: seg.end,
    thickness: { value: th, unit: 'ft', display: '', confidence: 0.5, source: 'scanner' },
    height: { value: 9, unit: 'ft', display: "9'", confidence: 0.5, source: 'scanner' },
    openings: [],
    kind: seg.kind,
  }
}

function tempOpeningFromProposed(o: ProposedWallLayoutOpening): BuildingOpeningModel {
  return {
    id: o.id,
    type: o.type,
    positionAlongWall: { value: o.positionAlongWallFt, unit: 'ft', display: '', confidence: 0.5, source: 'scanner' },
    width: { value: o.widthFt, unit: 'ft', display: '', confidence: 0.5, source: 'scanner' },
    height: { value: o.type === 'window' ? 6 : 7, unit: 'ft', display: '', confidence: 0.5, source: 'scanner' },
    swing: o.swing,
    swingDegrees: o.swingDegrees ?? (o.type === 'door' ? 90 : 0),
    subtype: o.subtype,
  }
}

export const MeasuredPlanViewer: React.FC<MeasuredPlanViewerProps> = ({
  model,
  proposedWallLayout = null,
  wallLayoutFailureMessage = null,
  fullSetWallDebug = null,
  suppressLegacyPlan2D = false,
  width = 760,
  height = 430,
  showDimensions = true,
  showRoomLabels = true,
  showAreaLabels = true,
  showBadges = true,
  selectedRoomId = null,
  onRoomSelect,
  activeStage = 'roughIn',
  showElectrical = true,
  plan2DSourceMode,
  calibratedSourceNote,
  traceDebug = null,
  className,
}) => {
  const canvasSize = useMemo(
    () => ({ width: width || 760, height: height || 430 }),
    [width, height],
  )

  const accent = STAGE_PLAN_ACCENT[activeStage]

  if (suppressLegacyPlan2D && !proposedWallLayout && !wallLayoutFailureMessage) {
    return (
      <div className={className} style={{ position: 'relative', width: '100%' }}>
        <div
          style={{
            width: canvasSize.width,
            height: canvasSize.height,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: '#0d121b',
            borderRadius: 8,
            border: '1px solid rgba(0,229,204,0.18)',
            color: '#a8c4dc',
            fontFamily: 'monospace',
            fontSize: 12,
            textAlign: 'center',
            padding: 20,
          }}
        >
          Scanning proposed plan sheet(s) across the full PDF set for wall vectors…
        </div>
      </div>
    )
  }

  if (wallLayoutFailureMessage && !proposedWallLayout) {
    return (
      <div className={className} style={{ position: 'relative', width: '100%' }}>
        <div
          style={{
            width: canvasSize.width,
            height: canvasSize.height,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: '#0d121b',
            borderRadius: 8,
            border: '1px solid rgba(0,229,204,0.18)',
            color: '#e0e6ed',
            padding: 20,
            textAlign: 'center',
            fontFamily: 'monospace',
            fontSize: 12,
          }}
        >
          <p style={{ margin: '0 0 10px', color: '#ffb347' }}>{wallLayoutFailureMessage}</p>
          {fullSetWallDebug && (
            <div style={{ fontSize: 10, color: 'rgba(180,210,230,0.85)', lineHeight: 1.5, textAlign: 'left', maxWidth: 520 }}>
              <div>Pages scanned: {fullSetWallDebug.pagesScanned}</div>
              <div>Selected proposed plan pages: {fullSetWallDebug.selectedPlanPages.join(', ') || '—'}</div>
              <div>Raw lines: {fullSetWallDebug.rawLines} · Filtered wall lines: {fullSetWallDebug.filteredWallLines}</div>
              <div>Openings: {fullSetWallDebug.openings} · Doors: {fullSetWallDebug.doors} · Door swings: {fullSetWallDebug.doorSwings}</div>
              {fullSetWallDebug.rejectionReason && <div>Reason: {fullSetWallDebug.rejectionReason}</div>}
              {fullSetWallDebug.rejectedPageRoles?.length ? (
                <div>Rejected page roles (sample): {fullSetWallDebug.rejectedPageRoles.join(', ')}</div>
              ) : null}
            </div>
          )}
        </div>
        {showElectrical && (
          <div style={{ marginTop: 6, fontSize: 10, color: 'rgba(255,200,145,0.9)', fontFamily: 'monospace' }}>
            Electrical hidden in wall-layout mode.
          </div>
        )}
        {showBadges && (
          <div style={{ position: 'absolute', bottom: 10, left: 10, pointerEvents: 'none' }}>
            <div
              style={{
                backgroundColor: 'rgba(90,30,30,0.95)',
                color: '#ffb3b3',
                padding: '3px 7px',
                borderRadius: 4,
                fontSize: 10,
                border: '1px solid rgba(255,120,120,0.5)',
                fontFamily: 'monospace',
              }}
            >
              2D SOURCE: FULL-SET WALL TRACE FAILED
            </div>
          </div>
        )}
      </div>
    )
  }

  if (proposedWallLayout) {
    const b = proposedWallLayout.bounds
    const { scalePerFoot, offsetX, offsetY } = calculateCanvasScale(b.width, b.height, canvasSize.width, canvasSize.height)
    const wx = (x: number) => offsetX + (x - b.x) * scalePerFoot
    const wy = (y: number) => offsetY + (y - b.y) * scalePerFoot
    const segById = new Map(proposedWallLayout.segments.map((s) => [s.id, s]))
    const resolvedMode = plan2DSourceMode || 'full-set-proposed-wall-layout'
    const isOk = resolvedMode === 'full-set-proposed-wall-layout'

    return (
      <div className={className} style={{ position: 'relative', display: 'block', width: '100%' }}>
        {showElectrical && (
          <div
            style={{
              marginBottom: 6,
              fontSize: 10,
              color: 'rgba(255,200,145,0.95)',
              fontFamily: 'monospace',
            }}
          >
            Electrical hidden in wall-layout mode.
          </div>
        )}
        <svg
          width="100%"
          height={canvasSize.height}
          viewBox={`0 0 ${canvasSize.width} ${canvasSize.height}`}
          preserveAspectRatio="xMidYMid meet"
          style={{ backgroundColor: '#0d121b', borderRadius: 8, border: '1px solid rgba(0,229,204,0.18)', display: 'block' }}
        >
          <rect
            x={wx(b.x) - 2}
            y={wy(b.y) - 2}
            width={b.width * scalePerFoot + 4}
            height={b.height * scalePerFoot + 4}
            fill="rgba(74,90,114,0.12)"
            stroke="#5a6a7e"
            strokeWidth={1.5}
            rx={2}
          />
          {proposedWallLayout.segments.map((seg) => {
            const style = wallStyleFromSegment(seg, false)
            return (
              <line
                key={seg.id}
                x1={wx(seg.start.x)}
                y1={wy(seg.start.y)}
                x2={wx(seg.end.x)}
                y2={wy(seg.end.y)}
                stroke={style.stroke}
                strokeWidth={style.strokeWidth}
                strokeDasharray={style.dash}
                strokeLinecap="round"
              />
            )
          })}
          {proposedWallLayout.openings.map((o) => {
            const seg = segById.get(o.wallSegmentId)
            if (!seg) return null
            const wall = tempWallFromSegment(seg)
            const opening = tempOpeningFromProposed(o)
            const ox = offsetX - b.x * scalePerFoot
            const oy = offsetY - b.y * scalePerFoot
            return <g key={o.id}>{renderOpening(opening, wall, scalePerFoot, ox, oy, accent)}</g>
          })}
          {proposedWallLayout.doorSwingArcs.map((arc) => {
            const cx = wx(arc.hinge.x)
            const cy = wy(arc.hinge.y)
            const rPx = arc.radiusFt * scalePerFoot
            const sr = (arc.startAngleDeg * Math.PI) / 180
            const er = (arc.endAngleDeg * Math.PI) / 180
            const sx = cx + rPx * Math.cos(sr)
            const sy = cy + rPx * Math.sin(sr)
            const ex = cx + rPx * Math.cos(er)
            const ey = cy + rPx * Math.sin(er)
            const delta = ((er - sr + Math.PI * 3) % (Math.PI * 2)) - Math.PI
            const largeArc = Math.abs(delta) > Math.PI ? 1 : 0
            const sweep = delta > 0 ? 1 : 0
            return (
              <path
                key={arc.id}
                d={`M ${sx} ${sy} A ${rPx} ${rPx} 0 ${largeArc} ${sweep} ${ex} ${ey}`}
                fill="none"
                stroke={accent}
                strokeWidth={0.9}
                strokeDasharray="2 2"
                opacity={0.75}
              />
            )
          })}
          {showDimensions &&
            proposedWallLayout.dimensions.map((d) => (
              <g key={d.id}>
                <line
                  x1={wx(d.start.x)}
                  y1={wy(d.start.y)}
                  x2={wx(d.end.x)}
                  y2={wy(d.end.y)}
                  stroke={accent}
                  strokeWidth={1}
                />
                <text
                  x={(wx(d.start.x) + wx(d.end.x)) / 2}
                  y={wy(d.start.y) - 4}
                  textAnchor="middle"
                  fill={accent}
                  fontSize={9}
                  fontFamily="monospace"
                >
                  {d.label}
                </text>
              </g>
            ))}
          {(showRoomLabels || showAreaLabels) &&
            proposedWallLayout.labels.map((lb) => (
              <text
                key={lb.id}
                x={wx(lb.position.x)}
                y={wy(lb.position.y)}
                fill="#e0e6ed"
                fontSize={10}
                fontFamily="monospace"
                style={{ pointerEvents: 'none' }}
              >
                {lb.text}
              </text>
            ))}
        </svg>
        {showBadges && (
          <div
            style={{
              position: 'absolute',
              bottom: 10,
              left: 10,
              display: 'flex',
              gap: 8,
              flexWrap: 'wrap',
              pointerEvents: 'none',
            }}
          >
            <div
              style={{
                backgroundColor: isOk ? 'rgba(26,74,42,0.95)' : 'rgba(90,30,30,0.95)',
                color: isOk ? '#a0ffa0' : '#ffb3b3',
                padding: '3px 7px',
                borderRadius: 4,
                fontSize: 10,
                border: isOk ? '1px solid #4aff4a' : '1px solid rgba(255,120,120,0.5)',
                fontFamily: 'monospace',
              }}
            >
              {isOk ? '2D SOURCE: FULL-SET PROPOSED WALL LAYOUT' : '2D SOURCE: FULL-SET WALL TRACE FAILED'}
            </div>
            {fullSetWallDebug && (
              <div
                style={{
                  backgroundColor: 'rgba(20,28,38,0.95)',
                  color: '#9ec7f9',
                  padding: '3px 7px',
                  borderRadius: 4,
                  fontSize: 9,
                  border: '1px solid rgba(158,199,249,0.45)',
                  fontFamily: 'monospace',
                }}
              >
                DEBUG · pages {fullSetWallDebug.pagesScanned} · sel [{fullSetWallDebug.selectedPlanPages.join(',')}] · raw{' '}
                {fullSetWallDebug.rawLines} · walls {fullSetWallDebug.filteredWallLines} · op {fullSetWallDebug.openings} ·
                swings {fullSetWallDebug.doorSwings}
              </div>
            )}
          </div>
        )}
      </div>
    )
  }

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
          borderRadius: 8,
          color: '#a0a8b8',
          fontSize: 13,
          textAlign: 'center',
          padding: 20,
        }}
      >
        <div>
          <p style={{ margin: '0 0 8px' }}>No building model available</p>
          <p style={{ margin: 0, fontSize: 12, opacity: 0.7 }}>
            Pick a VR Source Set to drive the measured plan
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

  const allRooms: BuildingRoomModel[] = model.levels.flatMap((l) => l.rooms)
  const allWalls: Array<{ wall: BuildingWallModel; room: BuildingRoomModel }> =
    allRooms.flatMap((room) => room.walls.map((wall) => ({ wall, room })))

  const accent = STAGE_PLAN_ACCENT[activeStage]
  const resolvedPlan2DSourceMode = plan2DSourceMode
  const isFullSetWallOk = resolvedPlan2DSourceMode === 'full-set-proposed-wall-layout'
  const isFullSetWallFailed = resolvedPlan2DSourceMode === 'full-set-wall-trace-failed'

  // De-duplicate walls by canonical key so partition walls shared between two
  // rooms render once. Use endpoints as key.
  const dedupedWalls = new Map<string, { wall: BuildingWallModel; room: BuildingRoomModel; selected: boolean }>()
  for (const { wall, room } of allWalls) {
    const a = `${wall.start.x.toFixed(2)},${wall.start.y.toFixed(2)}`
    const b = `${wall.end.x.toFixed(2)},${wall.end.y.toFixed(2)}`
    const key = a < b ? `${a}|${b}` : `${b}|${a}`
    const current = dedupedWalls.get(key)
    if (!current) {
      dedupedWalls.set(key, { wall, room, selected: room.id === selectedRoomId })
    } else if (room.id === selectedRoomId) {
      dedupedWalls.set(key, { wall, room, selected: true })
    }
  }

  return (
    <div className={className} style={{ position: 'relative', display: 'block', width: '100%' }}>
      <svg
        width="100%"
        height={canvasSize.height}
        viewBox={`0 0 ${canvasSize.width} ${canvasSize.height}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ backgroundColor: '#0d121b', borderRadius: 8, border: '1px solid rgba(0,229,204,0.18)', display: 'block' }}
      >
        {/* Footprint border (exterior mass) */}
        <rect
          x={offsetX - 2}
          y={offsetY - 2}
          width={model.footprint.width * scalePerFoot + 4}
          height={model.footprint.height * scalePerFoot + 4}
          fill="rgba(74,90,114,0.22)"
          stroke="#e0e6ed"
          strokeWidth={4}
          rx={3}
        />

        {/* Room fills */}
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
            onRoomSelect={onRoomSelect}
            accent={accent}
          />
        ))}

        {/* Walls with kind-aware style */}
        {Array.from(dedupedWalls.values()).map(({ wall, selected }) => {
          const wx1 = offsetX + wall.start.x * scalePerFoot
          const wy1 = offsetY + wall.start.y * scalePerFoot
          const wx2 = offsetX + wall.end.x * scalePerFoot
          const wy2 = offsetY + wall.end.y * scalePerFoot
          const style = styleForWall(wall, selected)
          return (
            <g key={wall.id}>
              <line
                x1={wx1}
                y1={wy1}
                x2={wx2}
                y2={wy2}
                stroke={style.stroke}
                strokeWidth={style.strokeWidth}
                strokeDasharray={style.dash}
                strokeLinecap="round"
              />
            </g>
          )
        })}

        {/* Openings on top of walls so they cut visually */}
        {allWalls.map(({ wall }) =>
          wall.openings.map((opening) =>
            renderOpening(opening, wall, scalePerFoot, offsetX, offsetY, accent),
          ),
        )}

        {/* Wall thickness / kind annotation for the selected room — only when
            both Dimensions and Labels are enabled, so the "Show Labels" toggle
            consistently hides every text annotation in the plan. */}
        {showDimensions && showRoomLabels && selectedRoomId &&
          allWalls
            .filter(({ room }) => room.id === selectedRoomId)
            .slice(0, 4)
            .map(({ wall }, idx) => {
              const mx = offsetX + ((wall.start.x + wall.end.x) / 2) * scalePerFoot
              const my = offsetY + ((wall.start.y + wall.end.y) / 2) * scalePerFoot
              const tFt =
                wall.thickness.unit === 'ft'
                  ? wall.thickness.value
                  : wall.thickness.value / 12
              return (
                <text
                  key={`tk-${wall.id}-${idx}`}
                  x={mx}
                  y={my - 4}
                  textAnchor="middle"
                  fill="rgba(170,220,235,0.85)"
                  fontSize={8}
                  fontFamily="monospace"
                >
                  {wall.kind || 'partition'} · {(tFt * 12).toFixed(0)}"
                </text>
              )
            })}

        {/* Furniture / fixture footprint symbols. These map an equipment hint
            to a tiny rectangle so the 2D plan reads as a CAD plan and not just
            colored rectangles. Symbols are independent of the labels toggle —
            their text labels follow it. */}
        {allRooms.map((room) => {
          const hints = room.equipmentHints || []
          if (!hints.length) return null
          const w = room.bounds.max.x - room.bounds.min.x
          const d = room.bounds.max.y - room.bounds.min.y
          return (
            <g key={`furn-${room.id}`}>
              {hints.map((h, hi) => {
                const sym = furnitureSymbol(h.kind)
                if (!sym) return null
                const nx = h.positionNormalized?.x ?? 0.5
                const ny = h.positionNormalized?.y ?? 0.5
                const cx = offsetX + (room.bounds.min.x + nx * w) * scalePerFoot
                const cy = offsetY + (room.bounds.min.y + ny * d) * scalePerFoot
                const wPx = sym.widthFt * scalePerFoot
                const hPx = sym.depthFt * scalePerFoot
                return (
                  <g key={`${room.id}-furn-${hi}`} pointerEvents="none">
                    {sym.shape === 'circle' ? (
                      <circle
                        cx={cx}
                        cy={cy}
                        r={Math.max(2, Math.min(wPx, hPx) / 2)}
                        fill={sym.fill}
                        stroke={sym.stroke}
                        strokeWidth={0.8}
                        opacity={sym.opacity}
                      />
                    ) : (
                      <rect
                        x={cx - wPx / 2}
                        y={cy - hPx / 2}
                        width={wPx}
                        height={hPx}
                        rx={1.2}
                        fill={sym.fill}
                        stroke={sym.stroke}
                        strokeWidth={0.8}
                        opacity={sym.opacity}
                      />
                    )}
                    {showRoomLabels && (room.id === selectedRoomId) && sym.shortLabel && (
                      <text
                        x={cx}
                        y={cy + hPx / 2 + 8}
                        textAnchor="middle"
                        fill="rgba(220,230,240,0.7)"
                        fontSize={7}
                        fontFamily="monospace"
                      >
                        {sym.shortLabel}
                      </text>
                    )}
                  </g>
                )
              })}
            </g>
          )
        })}

        {/* Suite dimension lines */}
        {showDimensions && (
          <g>
            {/* Width */}
            <line
              x1={offsetX}
              y1={offsetY + model.footprint.height * scalePerFoot + 14}
              x2={offsetX + model.footprint.width * scalePerFoot}
              y2={offsetY + model.footprint.height * scalePerFoot + 14}
              stroke={accent}
              strokeWidth={1.2}
            />
            <text
              x={offsetX + (model.footprint.width * scalePerFoot) / 2}
              y={offsetY + model.footprint.height * scalePerFoot + 26}
              textAnchor="middle"
              fill={accent}
              fontSize={10}
              fontFamily="monospace"
            >
              {formatFt(model.footprint.width)} SUITE WIDTH
            </text>
            {/* Depth */}
            <line
              x1={offsetX + model.footprint.width * scalePerFoot + 14}
              y1={offsetY}
              x2={offsetX + model.footprint.width * scalePerFoot + 14}
              y2={offsetY + model.footprint.height * scalePerFoot}
              stroke={accent}
              strokeWidth={1.2}
            />
            <text
              x={offsetX + model.footprint.width * scalePerFoot + 22}
              y={offsetY + (model.footprint.height * scalePerFoot) / 2}
              textAnchor="start"
              transform={`rotate(90, ${offsetX + model.footprint.width * scalePerFoot + 22}, ${offsetY + (model.footprint.height * scalePerFoot) / 2})`}
              fill={accent}
              fontSize={10}
              fontFamily="monospace"
            >
              {formatFt(model.footprint.height)} SUITE DEPTH
            </text>
          </g>
        )}

        {/* Electrical anchor markers — label respects showRoomLabels so the
            "Show Labels" toggle hides every text annotation in the plan. */}
        {showElectrical &&
          model.electricalAnchors?.map((anchor) => {
            const x = offsetX + anchor.position.x * scalePerFoot
            const y = offsetY + anchor.position.y * scalePerFoot
            return (
              <g key={anchor.id}>
                <circle cx={x} cy={y} r={4} fill={accent} opacity={0.85} />
                {showRoomLabels && (
                  <text x={x + 6} y={y - 5} fill="rgba(255,255,255,0.65)" fontSize={8} fontFamily="monospace">
                    {anchor.type}
                  </text>
                )}
              </g>
            )
          })}
      </svg>

      {showBadges && (
        <div
          style={{
            position: 'absolute',
            bottom: 10,
            left: 10,
            display: 'flex',
            gap: 8,
            flexWrap: 'wrap',
            pointerEvents: 'none',
          }}
        >
          <div
            style={{
              backgroundColor: isFullSetWallOk
                ? 'rgba(26,74,42,0.95)'
                : isFullSetWallFailed
                  ? 'rgba(90,30,30,0.95)'
                  : 'rgba(42,63,95,0.95)',
              color: isFullSetWallOk ? '#a0ffa0' : isFullSetWallFailed ? '#ffb3b3' : '#a0d8ff',
              padding: '3px 7px',
              borderRadius: 4,
              fontSize: 10,
              border: isFullSetWallOk
                ? '1px solid #4aff4a'
                : isFullSetWallFailed
                  ? '1px solid rgba(255,120,120,0.5)'
                  : '1px solid #4a90e2',
              fontFamily: 'monospace',
            }}
          >
            {isFullSetWallOk
              ? '2D SOURCE: FULL-SET PROPOSED WALL LAYOUT'
              : isFullSetWallFailed
                ? '2D SOURCE: FULL-SET WALL TRACE FAILED'
                : '2D SOURCE: DEFAULT BUILDING MODEL'}
          </div>
          {calibratedSourceNote && (
            <div
              style={{
                backgroundColor: 'rgba(42,63,95,0.95)',
                color: '#cfe8ff',
                padding: '3px 7px',
                borderRadius: 4,
                fontSize: 9,
                border: '1px solid rgba(158,199,249,0.45)',
                fontFamily: 'monospace',
              }}
            >
              {calibratedSourceNote}
            </div>
          )}
          {traceDebug && (
            <div
              style={{
                backgroundColor: 'rgba(20,28,38,0.95)',
                color: '#9ec7f9',
                padding: '3px 7px',
                borderRadius: 4,
                fontSize: 10,
                border: '1px solid rgba(158,199,249,0.45)',
                fontFamily: 'monospace',
              }}
            >
              TRACE DEBUG: raw {traceDebug.rawLines} · walls {traceDebug.mergedWalls} · openings {traceDebug.openings} · rooms {traceDebug.roomCandidates}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default MeasuredPlanViewer
