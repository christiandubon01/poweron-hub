/**
 * src/features/blueprint-vr/Blueprint3DSpaceViewer.tsx
 *
 * Planner5D-style isometric 3D space renderer for the Generate VR modal.
 *
 * Renders a full building model from above-right-front (NE isometric):
 *   - floor slab with room zones and grid
 *   - extruded exterior + partition walls with visible thickness
 *   - horizontal & vertical dimension annotations
 *   - stage-specific electrical components in 3D positions
 *
 * Pure SVG — no canvas, no three.js, no external deps.
 * All geometry computed deterministically by spaceGeometry.ts.
 */

import React, { useState, useMemo } from 'react'
import type { BuildingSpace } from './dimensionModel'
import type { BlueprintBuildingModel } from './buildingModel'
import type { VRStage } from './types'
import {
  buildSpaceGeometry,
  compileBuildingModelToGeometry,
  type GeoShape,
  type GeoPoly,
  type GeoLine,
  type GeoCircle,
  type GeoText,
  type GeoDim,
} from './spaceGeometry'
import {
  placeElectricalComponentsInModel,
  getLegendEntriesByStage,
  getComponentCountsByStage,
  type ElectricalComponent,
} from './electrical3DPlacement'

// ─── Props ────────────────────────────────────────────────────────────────────

export interface Blueprint3DSpaceViewerProps {
  buildingSpace?: BuildingSpace | null
  buildingModel?: BlueprintBuildingModel | null
  activeStage: VRStage
  show2DMode?: boolean
}

// ─── Stage theme colors ───────────────────────────────────────────────────────

const STAGE_THEME: Record<VRStage, { p: string; label: string }> = {
  underground: { p: '#E07020', label: 'UNDERGROUND PHASE' },
  roughIn:     { p: '#3B82F6', label: 'ROUGH IN PHASE'   },
  trim:        { p: '#22C55E', label: 'TRIM PHASE'        },
  finished:    { p: '#06B6D4', label: 'FINISHED PHASE'    },
}

const STAGE_LEGEND: Record<VRStage, Array<{ color: string; label: string }>> = {
  underground: [
    { color: '#E07020', label: 'PVC Conduit' },
    { color: '#FF5252', label: 'Service / GND' },
    { color: '#FFA040', label: 'Floor Box' },
  ],
  roughIn: [
    { color: '#3B82F6', label: 'Device Box' },
    { color: '#EAB308', label: 'Panel 200A' },
    { color: '#93C5FD', label: 'J-Box / EMT' },
  ],
  trim: [
    { color: '#22C55E', label: 'Receptacle' },
    { color: '#4ADE80', label: 'Switch' },
    { color: '#86EFAC', label: 'Light Fixture' },
  ],
  finished: [
    { color: '#06B6D4', label: 'Labeled Device' },
    { color: '#A78BFA', label: 'Light Circuit' },
    { color: '#67E8F9', label: 'Circuit Path' },
  ],
}

// ─── Shape Renderers ──────────────────────────────────────────────────────────

function RenderPoly({ s }: { s: GeoPoly }) {
  const pts = s.pts.map(p => `${p.sx.toFixed(1)},${p.sy.toFixed(1)}`).join(' ')
  return (
    <polygon
      key={s.id}
      points={pts}
      fill={s.fill}
      stroke={s.stroke}
      strokeWidth={s.strokeWidth}
      opacity={s.opacity}
      strokeDasharray={s.strokeDasharray}
    />
  )
}

function RenderLine({ s }: { s: GeoLine }) {
  return (
    <line
      key={s.id}
      x1={s.x1.toFixed(1)} y1={s.y1.toFixed(1)}
      x2={s.x2.toFixed(1)} y2={s.y2.toFixed(1)}
      stroke={s.stroke}
      strokeWidth={s.strokeWidth}
      opacity={s.opacity}
      strokeDasharray={s.strokeDasharray}
      strokeLinecap="round"
    />
  )
}

function RenderCircle({ s }: { s: GeoCircle }) {
  return (
    <circle
      key={s.id}
      cx={s.cx.toFixed(1)} cy={s.cy.toFixed(1)} r={s.r}
      fill={s.fill} stroke={s.stroke} strokeWidth={s.strokeWidth}
      opacity={s.opacity}
    />
  )
}

function RenderText({ s }: { s: GeoText }) {
  return (
    <text
      key={s.id}
      x={s.x.toFixed(1)} y={s.y.toFixed(1)}
      fill={s.fill}
      fontSize={s.fontSize}
      fontWeight={s.fontWeight}
      textAnchor={s.textAnchor ?? 'start'}
      dominantBaseline={s.dominantBaseline ?? 'auto'}
      fontFamily={s.fontFamily ?? 'monospace'}
      letterSpacing={s.letterSpacing}
      opacity={s.opacity}
    >
      {s.text}
    </text>
  )
}

function Shape({ s }: { s: GeoShape }) {
  switch (s.kind) {
    case 'poly':   return <RenderPoly   s={s} />
    case 'line':   return <RenderLine   s={s} />
    case 'circle': return <RenderCircle s={s} />
    case 'text':   return <RenderText   s={s} />
  }
}

// ─── Electrical Component Renderer ────────────────────────────────────────────

function ElectricalComponentDot({ comp }: { comp: ElectricalComponent }) {
  return (
    <g key={comp.id}>
      {/* Component dot */}
      <circle
        cx={comp.screenPos.sx.toFixed(1)}
        cy={comp.screenPos.sy.toFixed(1)}
        r={comp.size}
        fill={comp.color}
        stroke="rgba(255,255,255,0.3)"
        strokeWidth={0.8}
        opacity={0.85}
        style={{ filter: `drop-shadow(0 0 2px ${comp.color}40)` }}
      />
      
      {/* Label on hover */}
      <title>{comp.label}</title>
    </g>
  )
}

// ─── Dimension Renderer ───────────────────────────────────────────────────────

function DimAnnotation({ d }: { d: GeoDim }) {
  return (
    <g opacity={0.85}>
      {/* Main dimension line with enhanced styling */}
      <line
        x1={d.line[0].sx.toFixed(1)} y1={d.line[0].sy.toFixed(1)}
        x2={d.line[1].sx.toFixed(1)} y2={d.line[1].sy.toFixed(1)}
        stroke={d.stroke} strokeWidth={1.2} strokeLinecap="round"
      />
      {/* Tick marks */}
      <line
        x1={d.tick1[0].sx.toFixed(1)} y1={d.tick1[0].sy.toFixed(1)}
        x2={d.tick1[1].sx.toFixed(1)} y2={d.tick1[1].sy.toFixed(1)}
        stroke={d.stroke} strokeWidth={1.2}
      />
      <line
        x1={d.tick2[0].sx.toFixed(1)} y1={d.tick2[0].sy.toFixed(1)}
        x2={d.tick2[1].sx.toFixed(1)} y2={d.tick2[1].sy.toFixed(1)}
        stroke={d.stroke} strokeWidth={1.2}
      />
      {/* Label with subtle background */}
      <text
        x={d.labelPt.sx.toFixed(1)} y={d.labelPt.sy.toFixed(1)}
        fill={d.stroke}
        fontSize={7.5}
        fontFamily="monospace"
        fontWeight="700"
        textAnchor="middle"
        dominantBaseline="middle"
        letterSpacing={0.5}
      >
        {d.labelText}
      </text>
    </g>
  )
}

// ─── Badge Renderer ───────────────────────────────────────────────────────────

function Badge({ x, y, label, value, color, inferred }: {
  x: number; y: number; label: string; value: string; color: string; inferred: boolean
}) {
  return (
    <g>
      <text x={x} y={y} fill="rgba(255,255,255,0.35)" fontSize={6.5}
        fontFamily="monospace" letterSpacing={0.5}>
        {label}
      </text>
      <text x={x + 38} y={y} fill={color} fontSize={7}
        fontFamily="monospace" fontWeight="700" textAnchor="end">
        {value}
      </text>
      {inferred && (
        <text x={x + 42} y={y} fill="rgba(255,200,0,0.5)" fontSize={5.5}
          fontFamily="monospace">
          ~
        </text>
      )}
    </g>
  )
}

// ─── Stage Indicator Bar ──────────────────────────────────────────────────────

function StageBar({ stage, vw }: { stage: VRStage; vw: number }) {
  const theme = STAGE_THEME[stage]
  return (
    <g>
      <rect x={0} y={0} width={vw} height={17} fill={`${theme.p}14`} />
      <text
        x={vw / 2} y={11}
        fill={theme.p}
        fontSize={8}
        fontWeight="700"
        fontFamily="monospace"
        textAnchor="middle"
        letterSpacing={2}
      >
        ◆ {theme.label} — 3D BUILDING SPACE ◆
      </text>
    </g>
  )
}

// ─── Control Button ───────────────────────────────────────────────────────────

function ToggleBtn({
  active, label, color, onClick,
}: {
  active: boolean; label: string; color: string; onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '4px 10px',
        borderRadius: 3,
        border: `1px solid ${active ? color : 'rgba(255,255,255,0.15)'}`,
        background: active ? `${color}18` : 'rgba(255,255,255,0.02)',
        color: active ? color : 'rgba(255,255,255,0.4)',
        cursor: 'pointer',
        fontSize: 9,
        fontFamily: 'monospace',
        fontWeight: 700,
        letterSpacing: 0.8,
        textTransform: 'uppercase' as const,
        transition: 'all 0.15s',
        flexShrink: 0,
      }}
    >
      {active ? '✓ ' : ''}{label}
    </button>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function Blueprint3DSpaceViewer({
  buildingSpace,
  buildingModel,
  activeStage,
  show2DMode = false,
}: Blueprint3DSpaceViewerProps) {
  const [showDims, setShowDims]   = useState(true)
  const [showElec, setShowElec]   = useState(true)
  const [showLabels, setShowLabels] = useState(true)
  const [is3DMode, setIs3DMode]   = useState(!show2DMode)

  // Prefer building model geometry if available, fall back to BuildingSpace
  const geo = useMemo(() => {
    if (buildingModel) {
      const compiled = compileBuildingModelToGeometry(buildingModel)
      return {
        vw: compiled.vw,
        vh: compiled.vh,
        baseShapes: compiled.shapes,
        compsByStage: {
          underground: [],
          roughIn: [],
          trim: [],
          finished: [],
        },
        dims: compiled.dims,
        badges: compiled.badges,
        bldg: { W: buildingModel.footprint.width, D: buildingModel.footprint.height, H: buildingModel.wallHeight.value, ceilH: buildingModel.ceilingHeight.value, slabIn: buildingModel.slabThickness?.value || 4 },
        isInferred: buildingModel.confidence < 0.8,
      }
    }
    return buildSpaceGeometry(buildingSpace)
  }, [buildingSpace, buildingModel])

  // Electrical components by stage
  const electricalByStage = useMemo(() => {
    if (!buildingModel) return { underground: [], roughIn: [], trim: [], finished: [] }
    
    const result = {
      underground: placeElectricalComponentsInModel(buildingModel, 'underground'),
      roughIn: placeElectricalComponentsInModel(buildingModel, 'roughIn'),
      trim: placeElectricalComponentsInModel(buildingModel, 'trim'),
      finished: placeElectricalComponentsInModel(buildingModel, 'finished'),
    }
    return result
  }, [buildingModel])

  const { vw, vh, baseShapes, compsByStage, dims, badges, bldg, isInferred } = geo
  const theme = STAGE_THEME[activeStage]
  // Use legend from placement engine if available, fall back to hardcoded legend
  const dynamicLegend = buildingModel ? getLegendEntriesByStage(activeStage) : STAGE_LEGEND[activeStage]
  const legend = dynamicLegend

  // Separate out text labels from base shapes for toggle support
  const nonLabelBase = baseShapes.filter(s => !(s.kind === 'text' && s.id.startsWith('rl-')))
  const labelBase    = baseShapes.filter(s =>   s.kind === 'text' && s.id.startsWith('rl-'))

  // Use electrical components from placement engine
  const stageElecComps = buildingModel ? electricalByStage[activeStage] : []
  const stageComps = compsByStage[activeStage]

  return (
    <div style={{
      width: '100%',
      background: '#06080F',
      borderRadius: 6,
      overflow: 'hidden',
      border: '1px solid rgba(0,229,204,0.12)',
    }}>
      {/* ── SVG viewport ─── */}
      <svg
        viewBox={`0 0 ${vw} ${vh}`}
        width="100%"
        style={{ display: 'block' }}
        preserveAspectRatio="xMidYMid meet"
        aria-label={`Planner5D-style 3D building model — ${theme.label}`}
      >
        <defs>
          {/* Background grid pattern */}
          <pattern id="bg3d-grid" x="0" y="0" width="24" height="24" patternUnits="userSpaceOnUse">
            <path d="M 24 0 L 0 0 0 24" fill="none" stroke="rgba(0,229,204,0.03)" strokeWidth="0.5" />
          </pattern>
          {/* Glow filter for stage indicator */}
          <filter id="glow3d" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="2" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>

        {/* Background */}
        <rect width={vw} height={vh} fill="url(#bg3d-grid)" />

        {/* Stage indicator bar */}
        <StageBar stage={activeStage} vw={vw} />

        {/* ── Floor + walls (always visible) ─── */}
        <g id="base">
          {nonLabelBase.map((s, i) => <Shape key={`base-${s.id}-${i}`} s={s} />)}
        </g>

        {/* ── Room labels (toggle) ─── */}
        {showLabels && (
          <g id="room-labels">
            {labelBase.map((s, i) => <Shape key={`lbl-${s.id}-${i}`} s={s} />)}
          </g>
        )}

        {/* ── Electrical components (toggle) ─── */}
        {showElec && (
          <g id="electrical">
            {/* Legacy shape components */}
            {stageComps.map((s, i) => <Shape key={`ec-${s.id}-${i}`} s={s} />)}
            {/* New placement engine components */}
            {stageElecComps.map((comp, i) => <ElectricalComponentDot key={`comp-${comp.id}-${i}`} comp={comp} />)}
          </g>
        )}

        {/* ── Dimension annotations (toggle) ─── */}
        {showDims && (
          <g id="dimensions">
            {dims.map(d => <DimAnnotation key={d.id} d={d} />)}
          </g>
        )}

        {/* ── Building info badges (top-left) ─── */}
        <g id="badges" opacity={0.9}>
          {badges.map((b, i) => (
            <Badge key={i} {...b} />
          ))}
          {isInferred && (
            <text x={12} y={100} fill="rgba(255,200,0,0.4)" fontSize={5.5}
              fontFamily="monospace">
              ~ inferred from context
            </text>
          )}
        </g>

        {/* ── North arrow ─── */}
        <text x={vw - 6} y={26} fill="rgba(255,255,255,0.2)"
          fontSize={8} fontFamily="monospace" textAnchor="end">
          ↑N
        </text>

        {/* ── Scale bar (bottom-left) ─── */}
        <g opacity={0.5}>
          <line x1={12} y1={vh - 10} x2={92} y2={vh - 10}
            stroke="rgba(255,255,255,0.3)" strokeWidth={1} />
          <line x1={12} y1={vh - 14} x2={12} y2={vh - 6}
            stroke="rgba(255,255,255,0.3)" strokeWidth={1} />
          <line x1={92} y1={vh - 14} x2={92} y2={vh - 6}
            stroke="rgba(255,255,255,0.3)" strokeWidth={1} />
          <text x={52} y={vh - 2} fill="rgba(255,255,255,0.25)"
            fontSize={6} fontFamily="monospace" textAnchor="middle">
            {`${bldg.W}'-0" SCALE`}
          </text>
        </g>

        {/* ── "3D SPACE" watermark badge ─── */}
        <g opacity={0.55}>
          <rect x={vw - 70} y={vh - 22} width={62} height={14}
            rx={2} fill="rgba(0,229,204,0.06)" stroke="rgba(0,229,204,0.2)" strokeWidth={0.8} />
          <text x={vw - 39} y={vh - 12}
            fill="rgba(0,221,204,0.7)" fontSize={7}
            fontFamily="monospace" fontWeight="700" textAnchor="middle" letterSpacing={1}>
            3D ISO VIEW
          </text>
        </g>
      </svg>

      {/* ── Controls strip ─── */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '6px 12px',
        borderTop: `1px solid ${theme.p}20`,
        background: `${theme.p}08`,
        flexWrap: 'wrap',
      }}>
        {show2DMode && (
          <ToggleBtn active={is3DMode} label="3D View" color="#00ddcc" onClick={() => setIs3DMode(v => !v)} />
        )}
        <ToggleBtn active={showDims}   label="Dimensions" color="#00ddcc" onClick={() => setShowDims(v => !v)} />
        <ToggleBtn active={showElec}   label="Electrical" color={theme.p}  onClick={() => setShowElec(v => !v)} />
        <ToggleBtn active={showLabels} label="Labels"     color="#a0a8c0"  onClick={() => setShowLabels(v => !v)} />

        {/* Legend */}
        <div style={{
          marginLeft: 'auto',
          display: 'flex',
          gap: 12,
          alignItems: 'center',
          flexWrap: 'wrap',
        }}>
          {legend.map((item, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <div style={{
                width: 7, height: 7, background: item.color,
                borderRadius: 1, flexShrink: 0,
              }} />
              <span style={{
                color: 'rgba(255,255,255,0.45)',
                fontSize: 8.5,
                fontFamily: 'monospace',
              }}>
                {item.label}
              </span>
            </div>
          ))}
          <div style={{
            color: `${theme.p}bb`,
            fontSize: 9,
            fontFamily: 'monospace',
            fontWeight: 700,
            letterSpacing: 0.6,
          }}>
            {theme.label.split(' ')[0]}
          </div>
        </div>
      </div>
    </div>
  )
}
