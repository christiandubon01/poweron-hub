/**
 * src/features/blueprint-vr/BlueprintVRLegend.tsx
 *
 * Legend component for Blueprint VR electrical stages.
 * Displays component counts, color codes, and stage information.
 *
 * Used by Blueprint3DSpaceViewer to show electrical components by stage.
 */

import React from 'react'
import type { VRStage } from './types'
import { getComponentCountsByStage, getLegendEntriesByStage } from './electrical3DPlacement'
import type { BlueprintBuildingModel } from './buildingModel'

// ─── Props ────────────────────────────────────────────────────────────────────

export interface BlueprintVRLegendProps {
  stage: VRStage
  buildingModel?: BlueprintBuildingModel | null
  compact?: boolean
}

// ─── Stage Descriptions ───────────────────────────────────────────────────────

const STAGE_DESCRIPTIONS: Record<VRStage, string> = {
  underground: 'Foundation & below-grade electrical work',
  roughIn: 'Wall & framing phase installations',
  trim: 'Finish phase device & fixture installations',
  finished: 'Final as-built with circuit labels',
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function BlueprintVRLegend({
  stage,
  buildingModel,
  compact = false,
}: BlueprintVRLegendProps) {
  const legend = getLegendEntriesByStage(stage)
  const componentCounts = buildingModel ? getComponentCountsByStage(buildingModel) : null
  const stageCount = componentCounts?.[stage] ?? 0

  const description = STAGE_DESCRIPTIONS[stage]

  if (compact) {
    return (
      <div style={{
        display: 'flex',
        gap: 12,
        alignItems: 'center',
        flexWrap: 'wrap',
        fontSize: '0.75rem',
        fontFamily: 'monospace',
      }}>
        {legend.map((item, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <div style={{
              width: 7,
              height: 7,
              background: item.color,
              borderRadius: 1,
              flexShrink: 0,
            }} />
            <span style={{ color: 'rgba(255,255,255,0.45)' }}>
              {item.label}
            </span>
          </div>
        ))}
      </div>
    )
  }

  return (
    <div style={{
      padding: '12px 16px',
      background: 'rgba(255,255,255,0.03)',
      border: '1px solid rgba(255,255,255,0.1)',
      borderRadius: 4,
      fontFamily: 'monospace',
      fontSize: '0.85rem',
      color: 'rgba(255,255,255,0.7)',
    }}>
      {/* Stage description */}
      <div style={{ marginBottom: 10, fontSize: '0.8rem' }}>
        <div style={{ opacity: 0.6, marginBottom: 4 }}>
          {description}
        </div>
        <div style={{ fontSize: '0.9rem', fontWeight: 700, color: 'rgba(255,255,255,0.9)' }}>
          Total Components: <span style={{ color: '#00ddcc' }}>{stageCount}</span>
        </div>
      </div>

      {/* Legend items */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {legend.map((item, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{
              width: 10,
              height: 10,
              background: item.color,
              borderRadius: 2,
              flexShrink: 0,
              boxShadow: `0 0 4px ${item.color}80`,
            }} />
            <span style={{ color: 'rgba(255,255,255,0.6)' }}>
              {item.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
