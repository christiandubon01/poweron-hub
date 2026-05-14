/**
 * src/features/blueprint-vr/BlueprintVRExperiencePanel.tsx
 *
 * BVR7: Blueprint VR Experience Panel
 *
 * Panel/modal shell that opens after the VR generation is complete.
 * Provides:
 *   - Title and source blueprint/PDF reference
 *   - Stage selector/tabs for viewing different construction phases
 *   - Progress region (integrated with BVR6 if available)
 *   - Scene preview placeholder area
 *   - Item list for the selected stage
 *   - Clear messaging about blueprint PDF intelligence origin
 *
 * Does NOT integrate into Blueprint AI page — that is handled separately.
 * No external API calls. Uses Three.js for canvas if available, but not react-three-fiber.
 */

import React, { useState, useCallback } from 'react'
import type {
  VRStage,
  BlueprintSource,
  VRGenerationJob,
  VRSceneManifest,
  StageItem,
} from './types'
import {
  STAGE_ORDER,
  getStageLabelByType,
  getStageDescription,
} from './stages'

// ── Types ────────────────────────────────────────────────────────────────

interface BlueprintVRExperiencePanelProps {
  /** VR generation job with output manifest */
  job: VRGenerationJob
  /** Blueprint source that was used to generate the VR */
  sourceBlueprint: BlueprintSource
  /** Called when user closes the panel */
  onClose: () => void
}

// ── Subcomponent: Progress Region ────────────────────────────────────────

/**
 * Simple progress bar display.
 * Designed to integrate with BVR6 progress component when available.
 */
function ProgressRegion({ progress, status }: { progress?: number; status: string }) {
  const pct = progress ?? 0
  const isComplete = status === 'complete'

  return (
    <div style={{
      padding: '12px 16px',
      borderBottom: '1px solid rgba(0,229,204,0.15)',
      display: 'flex',
      flexDirection: 'column',
      gap: 8,
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <span style={{
          color: 'rgba(255,255,255,0.6)',
          fontSize: 10,
          fontFamily: 'monospace',
          letterSpacing: 0.8,
          textTransform: 'uppercase',
        }}>
          Generation Progress
        </span>
        <span style={{
          color: isComplete ? '#00ddcc' : '#FFD700',
          fontSize: 11,
          fontFamily: 'monospace',
          fontWeight: 700,
          letterSpacing: 0.5,
        }}>
          {isComplete ? '✓ Complete' : `${pct}%`}
        </span>
      </div>

      {/* Progress bar */}
      <div style={{
        width: '100%',
        height: 6,
        borderRadius: 3,
        background: 'rgba(255,255,255,0.05)',
        border: '1px solid rgba(0,229,204,0.2)',
        overflow: 'hidden',
        position: 'relative',
      }}>
        <div
          style={{
            height: '100%',
            width: `${pct}%`,
            background: isComplete
              ? 'linear-gradient(90deg, #00ddcc 0%, #00ff88 100%)'
              : 'linear-gradient(90deg, #FFD700 0%, #FF9900 100%)',
            transition: 'width 0.3s ease-out',
            boxShadow: isComplete
              ? '0 0 8px rgba(0,221,204,0.5)'
              : '0 0 8px rgba(255,215,0,0.4)',
            borderRadius: 3,
          }}
        />
      </div>
    </div>
  )
}

// ── Subcomponent: Scene Preview Placeholder ──────────────────────────────

/**
 * Canvas placeholder for VR scene preview.
 * Renders an isometric-style 3D construction landscape with colored electrical components.
 */
function ScenePreviewArea({ manifest }: { manifest?: any }) {
  // Build a simple isometric 3D visualization using SVG
  const svgWidth = 400
  const svgHeight = 280
  
  // Convert 3D coordinates to isometric 2D
  const toIsometric = (x: number, y: number, z: number) => {
    const iso_x = (x - z) * 0.866 // cos(30°)
    const iso_y = (x + z) * 0.5 - y
    return { x: svgWidth / 2 + iso_x * 15, y: svgHeight / 2 + iso_y * 15 }
  }

  // Stage color mapping
  const stageColors: Record<string, string> = {
    underground: '#FF6B6B', // Red for underground
    roughIn: '#FFD93D',     // Yellow for rough in
    trim: '#6BCB77',        // Green for trim
    finished: '#4D96FF',    // Blue for finished
  }

  // Generate visual elements for each stage
  const visualElements = []
  const items = manifest?.stages || []
  
  // Add ground plane
  visualElements.push({
    key: 'ground',
    type: 'polygon',
    points: [
      toIsometric(0, 0, 0),
      toIsometric(4, 0, 0),
      toIsometric(4, 0, 4),
      toIsometric(0, 0, 4),
    ],
    fill: '#1a1a2e',
    stroke: 'rgba(0,229,204,0.3)',
  })

  // Add building footprint (simple box)
  const footprintPoints = [
    toIsometric(0.5, 0, 0.5),
    toIsometric(3.5, 0, 0.5),
    toIsometric(3.5, 3, 0.5),
    toIsometric(0.5, 3, 0.5),
  ]
  visualElements.push({
    key: 'footprint',
    type: 'polygon',
    points: footprintPoints,
    fill: '#2d3561',
    stroke: 'rgba(0,229,204,0.5)',
  })

  // Add components for each stage
  let componentIndex = 0
  for (const item of items) {
    const stageColor = stageColors[item.stage] || '#808080'
    
    // Add 2-3 visual blocks per stage
    for (let i = 0; i < 3; i++) {
      const x = 1 + (componentIndex % 2) * 2 + Math.random() * 0.5
      const y = 0.5 + (i * 0.7)
      const z = 1 + ((componentIndex / 2) % 2) * 1.5 + Math.random() * 0.5
      
      const p1 = toIsometric(x, y, z)
      const p2 = toIsometric(x + 0.4, y, z)
      const p3 = toIsometric(x + 0.4, y, z + 0.4)
      const p4 = toIsometric(x, y, z + 0.4)
      const p5 = toIsometric(x, y + 0.4, z)
      
      visualElements.push({
        key: `component-${item.stage}-${i}`,
        type: 'box3d',
        x: x, y: y, z: z,
        size: 0.4,
        color: stageColor,
        opacity: 0.8,
        points: [p1, p2, p3, p4, p5],
      })
      componentIndex++
    }
  }

  return (
    <div style={{
      width: '100%',
      height: 280,
      background: 'linear-gradient(135deg, rgba(0,229,204,0.04) 0%, rgba(255,215,0,0.04) 100%)',
      border: '1px solid rgba(0,229,204,0.15)',
      borderRadius: 6,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      position: 'relative',
      overflow: 'hidden',
      flexDirection: 'column',
      padding: 8,
      boxSizing: 'border-box',
    }}>
      <svg
        width={svgWidth}
        height={svgHeight}
        style={{
          background: 'linear-gradient(180deg, rgba(13,14,20,0.8) 0%, rgba(13,14,20,0.95) 100%)',
          border: '1px solid rgba(0,229,204,0.1)',
          borderRadius: 4,
        }}
      >
        <defs>
          <filter id="glow">
            <feGaussianBlur stdDeviation="2" result="coloredBlur" />
            <feMerge>
              <feMergeNode in="coloredBlur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Draw ground and footprint */}
        {visualElements
          .filter(el => ['polygon'].includes(el.type))
          .map((el, idx) => (
            <polygon
              key={el.key}
              points={el.points.map((p: any) => `${p.x},${p.y}`).join(' ')}
              fill={el.fill}
              stroke={el.stroke}
              strokeWidth="0.5"
              opacity="0.6"
            />
          ))}

        {/* Draw 3D boxes for electrical components */}
        {visualElements
          .filter(el => el.type === 'box3d')
          .map((el) => {
            const p1 = el.points[0]
            const p2 = el.points[1]
            const p3 = el.points[2]
            const p4 = el.points[3]
            const p5 = el.points[4]
            
            return (
              <g key={el.key} filter="url(#glow)" opacity={el.opacity}>
                {/* Front face */}
                <polygon
                  points={`${p1.x},${p1.y} ${p2.x},${p2.y} ${p3.x},${p3.y} ${p4.x},${p4.y}`}
                  fill={el.color}
                  stroke={el.color}
                  strokeWidth="0.5"
                />
                {/* Top face */}
                <polygon
                  points={`${p1.x},${p1.y} ${p2.x},${p2.y} ${p5.x},${p5.y}`}
                  fill={el.color}
                  stroke={el.color}
                  strokeWidth="0.5"
                  opacity="0.7"
                />
                {/* Side face */}
                <polygon
                  points={`${p2.x},${p2.y} ${p3.x},${p3.y} ${p5.x},${p5.y}`}
                  fill={el.color}
                  stroke={el.color}
                  strokeWidth="0.5"
                  opacity="0.5"
                />
              </g>
            )
          })}

        {/* Add grid lines for reference */}
        {[0, 1, 2, 3, 4].map((i) => {
          const p1 = toIsometric(i, 0, 0)
          const p2 = toIsometric(i, 0, 4)
          return (
            <line
              key={`grid-x-${i}`}
              x1={p1.x}
              y1={p1.y}
              x2={p2.x}
              y2={p2.y}
              stroke="rgba(0,229,204,0.08)"
              strokeWidth="0.3"
            />
          )
        })}
        {[0, 1, 2, 3, 4].map((i) => {
          const p1 = toIsometric(0, 0, i)
          const p2 = toIsometric(4, 0, i)
          return (
            <line
              key={`grid-z-${i}`}
              x1={p1.x}
              y1={p1.y}
              x2={p2.x}
              y2={p2.y}
              stroke="rgba(0,229,204,0.08)"
              strokeWidth="0.3"
            />
          )
        })}

        {/* Title */}
        <text
          x={svgWidth / 2}
          y={20}
          textAnchor="middle"
          fill="rgba(0,221,204,0.6)"
          fontSize="11"
          fontFamily="monospace"
          fontWeight="700"
          letterSpacing="1"
        >
          CONSTRUCTION LANDSCAPE
        </text>
      </svg>

      {/* Legend */}
      <div style={{
        display: 'flex',
        gap: 12,
        marginTop: 8,
        fontSize: 10,
        fontFamily: 'monospace',
        flexWrap: 'wrap',
        justifyContent: 'center',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <div style={{ width: 8, height: 8, background: '#FF6B6B', borderRadius: 1 }} />
          <span style={{ color: 'rgba(255,255,255,0.6)' }}>Underground</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <div style={{ width: 8, height: 8, background: '#FFD93D', borderRadius: 1 }} />
          <span style={{ color: 'rgba(255,255,255,0.6)' }}>Rough In</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <div style={{ width: 8, height: 8, background: '#6BCB77', borderRadius: 1 }} />
          <span style={{ color: 'rgba(255,255,255,0.6)' }}>Trim</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <div style={{ width: 8, height: 8, background: '#4D96FF', borderRadius: 1 }} />
          <span style={{ color: 'rgba(255,255,255,0.6)' }}>Finished</span>
        </div>
      </div>
    </div>
  )
}

// ── Subcomponent: Stage Tabs ─────────────────────────────────────────────

interface StageTabs {
  stages: VRStage[]
  selectedStage: VRStage
  onSelectStage: (stage: VRStage) => void
}

function StageTabs({ stages, selectedStage, onSelectStage }: StageTabs) {
  return (
    <div style={{
      display: 'flex',
      gap: 2,
      padding: '12px 16px',
      borderBottom: '1px solid rgba(0,229,204,0.15)',
      overflowX: 'auto',
      scrollbarWidth: 'thin',
      scrollbarColor: 'rgba(0,229,204,0.2) transparent',
    }}>
      {stages.length === 0 ? (
        <div style={{
          color: 'rgba(255,255,255,0.3)',
          fontSize: 10,
          fontFamily: 'monospace',
        }}>
          No stages available
        </div>
      ) : (
        stages.map(stage => (
          <button
            key={stage}
            onClick={() => onSelectStage(stage)}
            style={{
              padding: '6px 12px',
              borderRadius: 4,
              border: selectedStage === stage
                ? '1px solid #00ddcc'
                : '1px solid rgba(0,229,204,0.25)',
              background: selectedStage === stage
                ? 'rgba(0,221,204,0.15)'
                : 'rgba(255,255,255,0.02)',
              color: selectedStage === stage
                ? '#00ddcc'
                : 'rgba(255,255,255,0.5)',
              cursor: 'pointer',
              fontSize: 10,
              fontFamily: 'monospace',
              fontWeight: 700,
              letterSpacing: 0.8,
              textTransform: 'uppercase',
              transition: 'all 0.15s',
              whiteSpace: 'nowrap',
              flexShrink: 0,
            }}
            onMouseEnter={e => {
              if (selectedStage !== stage) {
                const btn = e.currentTarget as HTMLButtonElement
                btn.style.backgroundColor = 'rgba(0,229,204,0.08)'
                btn.style.borderColor = 'rgba(0,229,204,0.4)'
              }
            }}
            onMouseLeave={e => {
              if (selectedStage !== stage) {
                const btn = e.currentTarget as HTMLButtonElement
                btn.style.backgroundColor = 'rgba(255,255,255,0.02)'
                btn.style.borderColor = 'rgba(0,229,204,0.25)'
              }
            }}
          >
            {getStageLabelByType(stage)}
          </button>
        ))
      )}
    </div>
  )
}

// ── Subcomponent: Stage Item List ────────────────────────────────────────

interface StageItemListProps {
  items: StageItem[]
  stage: VRStage
}

function StageItemList({ items, stage }: StageItemListProps) {
  const stageItems = items.filter(item => item.stage === stage)

  if (stageItems.length === 0) {
    return (
      <div style={{
        padding: '24px 16px',
        textAlign: 'center',
        color: 'rgba(255,255,255,0.3)',
        fontSize: 11,
        fontFamily: 'monospace',
      }}>
        No items for this stage
      </div>
    )
  }

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      gap: 4,
      padding: '12px 16px',
    }}>
      {stageItems.map(item => (
        <div
          key={item.id}
          style={{
            padding: '8px 12px',
            borderRadius: 4,
            background: 'rgba(255,255,255,0.02)',
            border: '1px solid rgba(0,229,204,0.1)',
            transition: 'all 0.15s',
            cursor: 'pointer',
          }}
          onMouseEnter={e => {
            const div = e.currentTarget as HTMLDivElement
            div.style.backgroundColor = 'rgba(0,229,204,0.08)'
            div.style.borderColor = 'rgba(0,229,204,0.3)'
          }}
          onMouseLeave={e => {
            const div = e.currentTarget as HTMLDivElement
            div.style.backgroundColor = 'rgba(255,255,255,0.02)'
            div.style.borderColor = 'rgba(0,229,204,0.1)'
          }}
        >
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
            marginBottom: 4,
          }}>
            <div style={{
              color: 'rgba(255,255,255,0.85)',
              fontSize: 11,
              fontFamily: 'monospace',
              fontWeight: 700,
              letterSpacing: 0.3,
            }}>
              {item.label}
            </div>
            {item.sourceConfidence !== undefined && (
              <div style={{
                color: 'rgba(0,221,204,0.7)',
                fontSize: 9,
                fontFamily: 'monospace',
                letterSpacing: 0.5,
              }}>
                {item.sourceConfidence}% confidence
              </div>
            )}
          </div>

          {item.notes && (
            <div style={{
              color: 'rgba(255,255,255,0.4)',
              fontSize: 10,
              fontFamily: 'monospace',
              lineHeight: 1.3,
              marginBottom: 4,
            }}>
              {item.notes}
            </div>
          )}

          {item.sourcePage && (
            <div style={{
              color: 'rgba(255,255,255,0.25)',
              fontSize: 9,
              fontFamily: 'monospace',
            }}>
              Page {item.sourcePage}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

// ── Main Component ───────────────────────────────────────────────────────

/**
 * BlueprintVRExperiencePanel
 *
 * Main panel component for viewing and interacting with the generated VR experience.
 * Opens after the "Generate VR" operation completes with a manifest.
 */
export default function BlueprintVRExperiencePanel({
  job,
  sourceBlueprint,
  onClose,
}: BlueprintVRExperiencePanelProps) {
  const [selectedStage, setSelectedStage] = useState<VRStage>(
    STAGE_ORDER[0] || 'underground'
  )

  const handleBackdropClick = useCallback(() => {
    onClose()
  }, [onClose])

  // Extract data from manifest
  const manifest = job.outputManifest
  const allStages = manifest?.stages.map(s => s.stage) ?? []
  const uniqueStages = Array.from(new Set(allStages)) as VRStage[]
  const stageItems = manifest?.stages ?? []

  // Ensure selectedStage is valid
  if (!uniqueStages.includes(selectedStage) && uniqueStages.length > 0) {
    setSelectedStage(uniqueStages[0])
  }

  return (
    <>
      {/* ── CSS Animations ─────────────────────────────────────────────── */}
      <style>{`
        @keyframes bvr7-slide-in {
          from {
            transform: translateY(20px);
            opacity: 0;
          }
          to {
            transform: translateY(0);
            opacity: 1;
          }
        }
        @keyframes bvr7-backdrop-fade {
          from {
            opacity: 0;
          }
          to {
            opacity: 1;
          }
        }
      `}</style>

      {/* ── Backdrop ───────────────────────────────────────────────────── */}
      <div
        onClick={handleBackdropClick}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.6)',
          zIndex: 998,
          cursor: 'pointer',
          animation: 'bvr7-backdrop-fade 0.2s ease-out',
        }}
      />

      {/* ── Panel Container ────────────────────────────────────────────── */}
      <div
        style={{
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width: 'min(90vw, 800px)',
          maxHeight: '90vh',
          background: 'rgba(4,8,12,0.97)',
          backdropFilter: 'blur(12px)',
          borderRadius: 8,
          border: '1px solid rgba(0,229,204,0.2)',
          boxShadow: '0 20px 60px rgba(0,0,0,0.8), 0 0 30px rgba(0,229,204,0.1)',
          display: 'flex',
          flexDirection: 'column',
          zIndex: 999,
          animation: 'bvr7-slide-in 0.3s cubic-bezier(0.25,0.46,0.45,0.94)',
          boxSizing: 'border-box',
        }}
      >
        {/* ── Panel Header ────────────────────────────────────────────── */}
        <div style={{
          padding: '16px 20px',
          borderBottom: '1px solid rgba(0,229,204,0.15)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          flexShrink: 0,
        }}>
          <div style={{ flex: 1 }}>
            <div style={{
              color: '#00ddcc',
              fontSize: 16,
              fontFamily: 'monospace',
              fontWeight: 700,
              letterSpacing: 2,
              textTransform: 'uppercase',
              textShadow: '0 0 8px rgba(0,229,204,0.4)',
              marginBottom: 4,
            }}>
              Blueprint VR Experience
            </div>
            <div style={{
              color: 'rgba(255,255,255,0.5)',
              fontSize: 11,
              fontFamily: 'monospace',
              letterSpacing: 0.8,
            }}>
              Source: {sourceBlueprint.name}
            </div>
          </div>

          {/* Close button */}
          <button
            onClick={onClose}
            style={{
              padding: '6px 12px',
              borderRadius: 4,
              border: '1px solid rgba(255,255,255,0.15)',
              background: 'rgba(255,255,255,0.05)',
              color: 'rgba(255,255,255,0.6)',
              cursor: 'pointer',
              fontSize: 12,
              fontFamily: 'monospace',
              fontWeight: 700,
              letterSpacing: 1,
              transition: 'all 0.15s',
            }}
            onMouseEnter={e => {
              const t = e.currentTarget as HTMLButtonElement
              t.style.backgroundColor = 'rgba(255,80,80,0.15)'
              t.style.borderColor = 'rgba(255,80,80,0.4)'
              t.style.color = '#ff6666'
            }}
            onMouseLeave={e => {
              const t = e.currentTarget as HTMLButtonElement
              t.style.backgroundColor = 'rgba(255,255,255,0.05)'
              t.style.borderColor = 'rgba(255,255,255,0.15)'
              t.style.color = 'rgba(255,255,255,0.6)'
            }}
          >
            ✕ CLOSE
          </button>
        </div>

        {/* ── Progress Region (from BVR6) ────────────────────────────── */}
        <ProgressRegion progress={job.progress} status={job.status} />

        {/* ── Scrollable Content ─────────────────────────────────────── */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            overflowX: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            scrollbarWidth: 'thin',
            scrollbarColor: 'rgba(0,229,204,0.2) transparent',
          }}
        >
          {/* Scene Preview */}
          <div style={{ padding: '16px' }}>
            <ScenePreviewArea manifest={manifest} />
          </div>

          {/* Stage Tabs */}
          <StageTabs
            stages={uniqueStages}
            selectedStage={selectedStage}
            onSelectStage={setSelectedStage}
          />

          {/* Stage Description */}
          <div style={{
            padding: '12px 16px',
            background: 'rgba(0,229,204,0.03)',
            borderBottom: '1px solid rgba(0,229,204,0.1)',
          }}>
            <div style={{
              color: 'rgba(255,255,255,0.45)',
              fontSize: 10,
              fontFamily: 'monospace',
              lineHeight: 1.5,
              letterSpacing: 0.3,
            }}>
              {getStageDescription(selectedStage)}
            </div>
          </div>

          {/* Stage Items List */}
          <StageItemList items={stageItems} stage={selectedStage} />
        </div>

        {/* ── Panel Footer ────────────────────────────────────────────── */}
        <div style={{
          padding: '12px 16px',
          borderTop: '1px solid rgba(0,229,204,0.15)',
          background: 'rgba(255,255,255,0.01)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          flexShrink: 0,
        }}>
          <div style={{
            color: 'rgba(255,255,255,0.35)',
            fontSize: 9,
            fontFamily: 'monospace',
            letterSpacing: 0.5,
          }}>
            Preview generated from blueprint PDF intelligence
          </div>

          <button
            onClick={onClose}
            style={{
              padding: '6px 14px',
              borderRadius: 4,
              border: '1px solid rgba(0,229,204,0.35)',
              background: 'rgba(0,229,204,0.08)',
              color: '#00ddcc',
              cursor: 'pointer',
              fontSize: 11,
              fontFamily: 'monospace',
              fontWeight: 700,
              letterSpacing: 1,
              transition: 'all 0.15s',
            }}
            onMouseEnter={e => {
              const btn = e.currentTarget as HTMLButtonElement
              btn.style.backgroundColor = 'rgba(0,229,204,0.18)'
              btn.style.borderColor = 'rgba(0,229,204,0.6)'
            }}
            onMouseLeave={e => {
              const btn = e.currentTarget as HTMLButtonElement
              btn.style.backgroundColor = 'rgba(0,229,204,0.08)'
              btn.style.borderColor = 'rgba(0,229,204,0.35)'
            }}
          >
            DONE
          </button>
        </div>
      </div>
    </>
  )
}
