/**
 * src/features/blueprint-vr/BlueprintVRExperiencePanel.tsx
 *
 * Blueprint VR Experience Panel — modal that opens after Generate VR is clicked.
 *
 * Fixed:
 *  - Stage tabs always show all 4 stages (from STAGE_ORDER, not from manifest)
 *  - Item list populated from electrical catalog (getCatalogItemsByStage)
 *  - Progress bar wired to job.progress (updated by the generation hook)
 *  - Scene viewer uses BlueprintVRLandscapeViewer (SVG floor plan, no Math.random)
 *  - Item count badges on stage tabs
 *  - Category grouping in item list
 */

import React, { useState, useCallback, useMemo, useEffect } from 'react'
import type {
  VRStage,
  BlueprintSource,
  VRGenerationJob,
} from './types'
import {
  STAGE_ORDER,
  getStageLabelByType,
  getStageDescription,
} from './stages'
import { getCatalogItemsByStage } from './electricalCatalog'
import type { ElectricalCatalogItem } from './electricalCatalog'
import Blueprint3DSpaceViewer from './Blueprint3DSpaceViewer'
import MeasuredPlanViewer from './MeasuredPlanViewer'
import BlueprintRoomInteriorView from './BlueprintRoomInteriorView'
import BlueprintVRSourceSelector from './BlueprintVRSourceSelector'
import type { BlueprintBuildingModel } from './buildingModel'
import {
  scanBlueprintPlan,
  convertPlanScanToBuildingModel,
  scanBlueprintFullSet,
  mergeFullSetScanIntoBuildingModel,
} from './blueprintPlanScanner'
import type {
  BlueprintPlanScanResult,
  BlueprintVRSourceSet,
  BlueprintFullSetScanResult,
} from './blueprintPlanScanner'
import {
  getCachedProjectModel,
  setCachedProjectModel,
  clearCachedProjectModel,
} from './blueprintVRProjectModelCache'

// ── Types ────────────────────────────────────────────────────────────

interface BlueprintVRExperiencePanelProps {
  job: VRGenerationJob
  sourceBlueprint: BlueprintSource
  onClose: () => void
  /** Project id used to key the model cache. */
  projectId?: string
  /** Project name used in the cache key when no id is available. */
  projectName?: string
  /**
   * Available blueprint sets for this project. When provided, the panel
   * surfaces a source-set selector and uses the full-set scanner to drive
   * the model.
   */
  availableSourceSets?: BlueprintVRSourceSet[]
  /**
   * Pre-selected source set id (e.g. the user's last choice). When omitted
   * the panel auto-picks a Full Set if available.
   */
  initialSourceSetId?: string | null
  /**
   * Notified when the user picks a different source set. Allows the parent
   * (e.g. BlueprintAI) to persist the choice for the project.
   */
  onSelectSourceSet?: (setId: string) => void
}

function controlButtonStyle(active: boolean): React.CSSProperties {
  return {
    padding: '5px 10px',
    borderRadius: 4,
    border: `1px solid ${active ? '#00ddcc' : 'rgba(255,255,255,0.16)'}`,
    background: active ? 'rgba(0,221,204,0.14)' : 'rgba(255,255,255,0.02)',
    color: active ? '#00ddcc' : 'rgba(255,255,255,0.6)',
    cursor: 'pointer',
    fontSize: 10,
    fontFamily: 'monospace',
    fontWeight: 700,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  }
}

const smallLabelStyle: React.CSSProperties = {
  color: 'rgba(255,255,255,0.55)',
  fontSize: 9.5,
  fontFamily: 'monospace',
  letterSpacing: 0.5,
  textTransform: 'uppercase',
}

// ── Subcomponent: Progress Region ────────────────────────────────────

function ProgressRegion({ progress, status }: { progress?: number; status: string }) {
  const pct       = progress ?? 0
  const isComplete = status === 'complete' || pct >= 100

  const statusMsg = isComplete
    ? 'Generated staged VR preview from blueprint PDF intelligence'
    : pct > 0
    ? `Building staged construction visualization... ${pct}%`
    : 'Initializing VR generation from blueprint context...'

  return (
    <div style={{
      padding: '12px 16px',
      borderBottom: '1px solid rgba(0,229,204,0.15)',
      display: 'flex',
      flexDirection: 'column',
      gap: 6,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{
          color: 'rgba(255,255,255,0.55)',
          fontSize: 10,
          fontFamily: 'monospace',
          letterSpacing: 0.8,
          textTransform: 'uppercase' as const,
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
        width: '100%', height: 6, borderRadius: 3,
        background: 'rgba(255,255,255,0.05)',
        border: '1px solid rgba(0,229,204,0.2)',
        overflow: 'hidden',
      }}>
        <div style={{
          height: '100%',
          width: `${pct}%`,
          background: isComplete
            ? 'linear-gradient(90deg, #00ddcc 0%, #00ff88 100%)'
            : 'linear-gradient(90deg, #FFD700 0%, #FF9900 100%)',
          transition: 'width 0.35s ease-out',
          boxShadow: isComplete
            ? '0 0 8px rgba(0,221,204,0.5)'
            : '0 0 8px rgba(255,215,0,0.4)',
          borderRadius: 3,
        }} />
      </div>

      {/* Status message */}
      <div style={{
        color: isComplete ? 'rgba(0,221,204,0.7)' : 'rgba(255,255,255,0.35)',
        fontSize: 9.5,
        fontFamily: 'monospace',
        letterSpacing: 0.3,
      }}>
        {statusMsg}
      </div>
    </div>
  )
}

// ── Subcomponent: Stage Tabs ──────────────────────────────────────────

interface StageTabsProps {
  stages: VRStage[]
  selectedStage: VRStage
  onSelectStage: (stage: VRStage) => void
}

function StageTabs({ stages, selectedStage, onSelectStage }: StageTabsProps) {
  return (
    <div style={{
      display: 'flex',
      gap: 2,
      padding: '10px 16px',
      borderBottom: '1px solid rgba(0,229,204,0.15)',
      overflowX: 'auto' as const,
      scrollbarWidth: 'thin' as const,
      scrollbarColor: 'rgba(0,229,204,0.2) transparent',
    }}>
      {stages.length === 0 ? (
        <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: 10, fontFamily: 'monospace' }}>
          No stages available
        </div>
      ) : (
        stages.map(stage => {
          const count     = getCatalogItemsByStage(stage).length
          const isActive  = selectedStage === stage
          return (
            <button
              key={stage}
              onClick={() => onSelectStage(stage)}
              style={{
                padding: '5px 11px',
                borderRadius: 4,
                border: isActive ? '1px solid #00ddcc' : '1px solid rgba(0,229,204,0.25)',
                background: isActive ? 'rgba(0,221,204,0.15)' : 'rgba(255,255,255,0.02)',
                color: isActive ? '#00ddcc' : 'rgba(255,255,255,0.5)',
                cursor: 'pointer',
                fontSize: 10,
                fontFamily: 'monospace',
                fontWeight: 700,
                letterSpacing: 0.8,
                textTransform: 'uppercase' as const,
                transition: 'all 0.15s',
                whiteSpace: 'nowrap' as const,
                flexShrink: 0,
                display: 'flex',
                alignItems: 'center',
                gap: 5,
              }}
              onMouseEnter={e => {
                if (!isActive) {
                  const b = e.currentTarget as HTMLButtonElement
                  b.style.backgroundColor = 'rgba(0,229,204,0.08)'
                  b.style.borderColor = 'rgba(0,229,204,0.4)'
                }
              }}
              onMouseLeave={e => {
                if (!isActive) {
                  const b = e.currentTarget as HTMLButtonElement
                  b.style.backgroundColor = 'rgba(255,255,255,0.02)'
                  b.style.borderColor = 'rgba(0,229,204,0.25)'
                }
              }}
            >
              {getStageLabelByType(stage)}
              {count > 0 && (
                <span style={{
                  fontSize: 8,
                  opacity: 0.65,
                  background: isActive ? 'rgba(0,221,204,0.2)' : 'rgba(255,255,255,0.08)',
                  borderRadius: 8,
                  padding: '1px 5px',
                }}>
                  {count}
                </span>
              )}
            </button>
          )
        })
      )}
    </div>
  )
}

// ── Subcomponent: Stage Item List ─────────────────────────────────────

function StageItemList({ stage }: { stage: VRStage }) {
  const items = getCatalogItemsByStage(stage)

  if (items.length === 0) {
    return (
      <div style={{
        padding: '24px 16px',
        textAlign: 'center' as const,
        color: 'rgba(255,255,255,0.3)',
        fontSize: 11,
        fontFamily: 'monospace',
      }}>
        No catalog items for this stage
      </div>
    )
  }

  // Group by category
  const grouped: Record<string, ElectricalCatalogItem[]> = {}
  for (const item of items) {
    if (!grouped[item.category]) grouped[item.category] = []
    grouped[item.category].push(item)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', padding: '8px 16px 12px' }}>
      {Object.entries(grouped).map(([category, catItems]) => (
        <div key={category}>
          {/* Category header */}
          <div style={{
            color: 'rgba(0,221,204,0.45)',
            fontSize: 8.5,
            fontFamily: 'monospace',
            letterSpacing: 1,
            textTransform: 'uppercase' as const,
            marginTop: 10,
            marginBottom: 4,
            paddingBottom: 3,
            borderBottom: '1px solid rgba(0,229,204,0.1)',
          }}>
            {category}
            <span style={{ marginLeft: 6, color: 'rgba(255,255,255,0.2)', fontSize: 8 }}>
              ({catItems.length})
            </span>
          </div>

          {/* Items in this category */}
          {catItems.map(item => (
            <div
              key={item.id}
              style={{
                padding: '6px 10px',
                borderRadius: 3,
                background: 'rgba(255,255,255,0.02)',
                border: '1px solid rgba(0,229,204,0.08)',
                marginBottom: 3,
                cursor: 'default',
              }}
              onMouseEnter={e => {
                const d = e.currentTarget as HTMLDivElement
                d.style.backgroundColor = 'rgba(0,229,204,0.06)'
                d.style.borderColor = 'rgba(0,229,204,0.25)'
              }}
              onMouseLeave={e => {
                const d = e.currentTarget as HTMLDivElement
                d.style.backgroundColor = 'rgba(255,255,255,0.02)'
                d.style.borderColor = 'rgba(0,229,204,0.08)'
              }}
            >
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 8,
              }}>
                <div style={{
                  color: 'rgba(255,255,255,0.8)',
                  fontSize: 11,
                  fontFamily: 'monospace',
                  fontWeight: 600,
                }}>
                  {item.label}
                </div>
                <div style={{
                  color: 'rgba(0,221,204,0.45)',
                  fontSize: 8.5,
                  fontFamily: 'monospace',
                  whiteSpace: 'nowrap' as const,
                  flexShrink: 0,
                }}>
                  {item.renderHints.assetCategory}
                </div>
              </div>
              {item.description && (
                <div style={{
                  color: 'rgba(255,255,255,0.32)',
                  fontSize: 9.5,
                  fontFamily: 'monospace',
                  lineHeight: 1.3,
                  marginTop: 2,
                }}>
                  {item.description}
                </div>
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

// ── Subcomponent: Scan Status Banner ─────────────────────────────────

function ScanStatusBanner({
  scan,
  fullSetScan,
}: {
  scan: BlueprintPlanScanResult
  fullSetScan?: BlueprintFullSetScanResult
}) {
  const top = scan.warnings.slice(0, 3)
  const accent = scan.isFallback ? '#FFB347' : '#7BE5D8'
  const labelText = scan.isFallback ? 'SCAN · INFERRED' : 'SCAN · MEASURED'
  const sheetSummary = fullSetScan
    ? `${fullSetScan.classifications.length} sheets · ` +
      `${fullSetScan.bestFloorPlanSheet ? 'floor plan ✓' : 'no floor-plan sheet'} · ` +
      `${fullSetScan.bestElectricalSheets.length} electrical · ` +
      `${fullSetScan.bestRenderingSheets.length} render`
    : null
  return (
    <div
      style={{
        background: 'rgba(8,14,22,0.65)',
        border: `1px solid ${accent}44`,
        borderRadius: 4,
        padding: '8px 10px',
        fontFamily: 'monospace',
        fontSize: 10,
        color: 'rgba(220,230,240,0.85)',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ color: accent, fontWeight: 700, letterSpacing: 0.8 }}>{labelText}</span>
        <span style={{ opacity: 0.6 }}>
          {scan.layoutContext.replace(/-/g, ' ')} · {(scan.confidence * 100).toFixed(0)}% confidence
        </span>
        <span style={{ opacity: 0.5 }}>
          {Math.round(scan.footprint.width)}'-0" W × {Math.round(scan.footprint.height)}'-0" D · {scan.rooms.length} rooms
        </span>
      </div>
      {sheetSummary && (
        <div style={{ opacity: 0.65, fontSize: 9.5, color: 'rgba(170,220,235,0.85)' }}>
          Full-set scan: {sheetSummary}
        </div>
      )}
      {top.map((w, i) => (
        <div key={i} style={{ opacity: 0.7, fontSize: 9.5, lineHeight: 1.35 }}>
          • {w.message}
        </div>
      ))}
    </div>
  )
}

// ── Subcomponent: Room Nav Strip ─────────────────────────────────────

interface RoomNavStripProps {
  rooms: Array<{ id: string; label: string }>
  selectedRoomId: string | null
  onSelect: (roomId: string) => void
  onBackToDollhouse: () => void
  onBackToPlan: () => void
}

function RoomNavStrip({ rooms, selectedRoomId, onSelect, onBackToDollhouse, onBackToPlan }: RoomNavStripProps) {
  return (
    <div
      style={{
        marginTop: 8,
        display: 'flex',
        flexWrap: 'wrap',
        gap: 6,
        padding: '8px 10px',
        background: 'rgba(8,14,22,0.55)',
        border: '1px solid rgba(0,229,204,0.18)',
        borderRadius: 4,
        alignItems: 'center',
      }}
    >
      <button onClick={onBackToDollhouse} style={controlButtonStyle(false)}>
        ← Dollhouse
      </button>
      <button onClick={onBackToPlan} style={controlButtonStyle(false)}>
        ← 2D Plan
      </button>
      <span style={{ ...smallLabelStyle, marginLeft: 4 }}>Rooms</span>
      {rooms.map((r) => (
        <button
          key={r.id}
          onClick={() => onSelect(r.id)}
          style={controlButtonStyle(selectedRoomId === r.id)}
        >
          {r.label}
        </button>
      ))}
    </div>
  )
}

// ── Main Component ────────────────────────────────────────────────────

export default function BlueprintVRExperiencePanel({
  job,
  sourceBlueprint,
  onClose,
  projectId,
  projectName: projectNameProp,
  availableSourceSets,
  initialSourceSetId,
  onSelectSourceSet,
}: BlueprintVRExperiencePanelProps) {
  const [activeStage, setActiveStage] = useState<VRStage>(STAGE_ORDER[0])
  const [viewMode, setViewMode] = useState<'plan' | 'dollhouse' | 'room'>('dollhouse')
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null)
  const [showElectrical, setShowElectrical] = useState(true)
  const [showDimensions, setShowDimensions] = useState(true)
  const [showLabels, setShowLabels] = useState(true)
  const [wallOpacity, setWallOpacity] = useState(0.82)
  const [cameraPreset, setCameraPreset] = useState<'top' | 'iso' | 'room'>('iso')

  // ── Source-set state (project-level) ──────────────────────────────────
  const availableSets = availableSourceSets || []
  const projectKey = projectId || projectNameProp || job.outputManifest?.projectName || 'project'

  // Auto-pick: prefer a Full Set; fall back to the initial / first set.
  const autoPickedSetId = useMemo(() => {
    if (initialSourceSetId && availableSets.some((s) => s.id === initialSourceSetId)) {
      return initialSourceSetId
    }
    const fullSet = availableSets.find((s) => (s.type || '').toLowerCase().includes('full set'))
    if (fullSet) return fullSet.id
    return availableSets[0]?.id || null
  }, [availableSets, initialSourceSetId])

  const [selectedSourceSetId, setSelectedSourceSetId] = useState<string | null>(autoPickedSetId)
  const [rescanToken, setRescanToken] = useState(0)

  useEffect(() => {
    setSelectedSourceSetId(autoPickedSetId)
  }, [autoPickedSetId])

  const selectedSourceSet = useMemo<BlueprintVRSourceSet | null>(() => {
    if (!availableSets.length) return null
    return availableSets.find((s) => s.id === selectedSourceSetId) || availableSets[0]
  }, [availableSets, selectedSourceSetId])

  const sourceKey = selectedSourceSet?.id || sourceBlueprint.id || 'active-sheet'
  const sourceIsInferred = !initialSourceSetId
  const projectNameForCache =
    projectNameProp || selectedSourceSet?.projectName || job.outputManifest?.projectName || sourceBlueprint.name

  // ── Cached model lookup. Recomputes only when key / rescan token changes ──
  const cacheKeyParts = `${projectKey}::${sourceKey}::${rescanToken}`

  const { scanResult, fullSetScan, buildingModel, fromCache } = useMemo(() => {
    const cached = rescanToken === 0
      ? getCachedProjectModel(projectKey, sourceKey)
      : undefined
    if (cached) {
      return {
        scanResult: cached.scan,
        fullSetScan: cached.fullSetScan,
        buildingModel: cached.model,
        fromCache: true,
      }
    }

    let scan: BlueprintPlanScanResult
    let fullScan: BlueprintFullSetScanResult | undefined
    let model: BlueprintBuildingModel

    if (selectedSourceSet) {
      fullScan = scanBlueprintFullSet({
        projectName: projectNameForCache,
        sourceSet: selectedSourceSet,
        extractedText: job.outputManifest?.metadata?.description,
      })
      scan = fullScan.planScan
      const base = convertPlanScanToBuildingModel(scan)
      model = mergeFullSetScanIntoBuildingModel(fullScan, base)
    } else {
      scan = scanBlueprintPlan({
        projectName: projectNameForCache,
        blueprintTitle: sourceBlueprint.name,
        fileName: sourceBlueprint.filePath,
        extractedText: job.outputManifest?.metadata?.description,
      })
      model = convertPlanScanToBuildingModel(scan)
    }

    const stored = setCachedProjectModel(projectKey, sourceKey, {
      model,
      scan,
      fullSetScan: fullScan,
      sourceSetLabel: selectedSourceSet?.name,
    })
    return {
      scanResult: stored.scan,
      fullSetScan: stored.fullSetScan,
      buildingModel: stored.model,
      fromCache: false,
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheKeyParts])

  const handleChangeSource = useCallback(
    (setId: string) => {
      setSelectedSourceSetId(setId)
      setSelectedRoomId(null)
      setRescanToken(0)
      onSelectSourceSet?.(setId)
    },
    [onSelectSourceSet],
  )

  const handleRescan = useCallback(() => {
    clearCachedProjectModel(projectKey, sourceKey)
    setRescanToken((t) => t + 1)
  }, [projectKey, sourceKey])

  const handleBackdropClick = useCallback(() => { onClose() }, [onClose])
  const firstRoomId = buildingModel.levels[0]?.rooms[0]?.id || null

  useEffect(() => {
    if (!selectedRoomId && firstRoomId) {
      setSelectedRoomId(firstRoomId)
    }
  }, [selectedRoomId, firstRoomId])

  const handleRoomSelect = useCallback((roomId: string) => {
    setSelectedRoomId(roomId)
    // From the 3D dollhouse, room click should focus that room without forcing
    // the user out of 3D. Plan view → click moves into Room View.
    setCameraPreset((prev) => (prev === 'top' ? 'room' : prev === 'room' ? 'room' : 'room'))
    setViewMode((prev) => (prev === 'plan' ? 'room' : prev === 'room' ? 'room' : 'dollhouse'))
  }, [])

  const handleRoomEnter = useCallback((roomId: string) => {
    setSelectedRoomId(roomId)
    setViewMode('room')
    setCameraPreset('room')
  }, [])

  const handleResetView = useCallback(() => {
    setViewMode('dollhouse')
    setSelectedRoomId(firstRoomId)
    setCameraPreset('iso')
    setWallOpacity(0.82)
  }, [firstRoomId])

  // Always show all 4 stages from STAGE_ORDER — no dependency on manifest
  const visibleStages = [...STAGE_ORDER] as VRStage[]

  // Total item count across all stages
  const totalItems = visibleStages.reduce(
    (sum, st) => sum + getCatalogItemsByStage(st).length,
    0
  )

  return (
    <>
      <style>{`
        @keyframes bvr7-slide-in {
          from { transform: translateY(20px); opacity: 0; }
          to   { transform: translateY(0);    opacity: 1; }
        }
        @keyframes bvr7-backdrop-fade {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
      `}</style>

      {/* Backdrop */}
      <div
        onClick={handleBackdropClick}
        style={{
          position: 'fixed', inset: 0,
          background: 'rgba(0,0,0,0.6)',
          zIndex: 998,
          cursor: 'pointer',
          animation: 'bvr7-backdrop-fade 0.2s ease-out',
        }}
      />

      {/* Panel container */}
      <div style={{
        position: 'fixed',
        top: '50%', left: '50%',
        transform: 'translate(-50%, -50%)',
        width: 'min(96vw, 960px)',
        maxHeight: '94vh',
        background: 'rgba(4,8,12,0.97)',
        backdropFilter: 'blur(12px)',
        borderRadius: 8,
        border: '1px solid rgba(0,229,204,0.2)',
        boxShadow: '0 20px 60px rgba(0,0,0,0.8), 0 0 30px rgba(0,229,204,0.08)',
        display: 'flex',
        flexDirection: 'column' as const,
        zIndex: 999,
        animation: 'bvr7-slide-in 0.3s cubic-bezier(0.25,0.46,0.45,0.94)',
        boxSizing: 'border-box' as const,
      }}>

        {/* Header */}
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
              fontSize: 15,
              fontFamily: 'monospace',
              fontWeight: 700,
              letterSpacing: 2,
              textTransform: 'uppercase' as const,
              textShadow: '0 0 8px rgba(0,229,204,0.35)',
              marginBottom: 4,
            }}>
              Blueprint VR Experience
            </div>
            <div style={{
              color: 'rgba(255,255,255,0.45)',
              fontSize: 10.5,
              fontFamily: 'monospace',
              letterSpacing: 0.6,
            }}>
              VR Source: {selectedSourceSet?.name || sourceBlueprint.name}
              {selectedSourceSet?.type ? ` · ${selectedSourceSet.type}` : ''}
              <span style={{ marginLeft: 12, color: 'rgba(0,221,204,0.4)' }}>
                {visibleStages.length} stages · {totalItems} catalog items
              </span>
              {fromCache && (
                <span
                  style={{
                    marginLeft: 10,
                    padding: '1px 6px',
                    borderRadius: 3,
                    background: 'rgba(123,229,216,0.12)',
                    border: '1px solid rgba(123,229,216,0.3)',
                    color: 'rgba(123,229,216,0.9)',
                    fontSize: 9,
                    letterSpacing: 0.4,
                  }}
                >
                  CACHED MODEL
                </span>
              )}
            </div>
          </div>

          <button
            onClick={onClose}
            style={{
              padding: '5px 12px',
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

        {/* Progress region */}
        <ProgressRegion progress={job.progress} status={job.status} />

        {/* Scrollable content */}
        <div style={{
          flex: 1,
          overflowY: 'auto' as const,
          overflowX: 'hidden',
          display: 'flex',
          flexDirection: 'column' as const,
          scrollbarWidth: 'thin' as const,
          scrollbarColor: 'rgba(0,229,204,0.2) transparent',
        }}>

          {/* Planner-style view controls */}
          <div style={{ padding: '14px 16px 0', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button
                onClick={() => { setViewMode('plan'); setCameraPreset('top') }}
                style={controlButtonStyle(viewMode === 'plan')}
              >
                2D Plan
              </button>
              <button
                onClick={() => { setViewMode('dollhouse'); setCameraPreset('iso') }}
                style={controlButtonStyle(viewMode === 'dollhouse')}
              >
                3D Dollhouse
              </button>
              <button
                onClick={() => { setViewMode('room'); setCameraPreset('room'); if (!selectedRoomId) setSelectedRoomId(firstRoomId) }}
                style={controlButtonStyle(viewMode === 'room')}
                disabled={!selectedRoomId && !firstRoomId}
              >
                Room View
              </button>
              <button onClick={handleResetView} style={controlButtonStyle(false)}>
                Reset View
              </button>
              <button onClick={() => setShowDimensions((v) => !v)} style={controlButtonStyle(showDimensions)}>
                Show Dimensions
              </button>
              <button onClick={() => setShowElectrical((v) => !v)} style={controlButtonStyle(showElectrical)}>
                Show Electrical
              </button>
              <button onClick={() => setShowLabels((v) => !v)} style={controlButtonStyle(showLabels)}>
                Show Labels
              </button>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={smallLabelStyle}>Wall Transparency</span>
              <input
                type="range"
                min={35}
                max={95}
                value={Math.round(wallOpacity * 100)}
                onChange={(e) => setWallOpacity(Number(e.target.value) / 100)}
                style={{ flex: 1 }}
              />
              <span style={smallLabelStyle}>{Math.round(wallOpacity * 100)}%</span>
              <button onClick={() => setCameraPreset('top')} style={controlButtonStyle(cameraPreset === 'top')}>Top</button>
              <button onClick={() => setCameraPreset('iso')} style={controlButtonStyle(cameraPreset === 'iso')}>Iso</button>
              <button onClick={() => setCameraPreset('room')} style={controlButtonStyle(cameraPreset === 'room')}>Room</button>
            </div>

            {availableSets.length > 0 && (
              <BlueprintVRSourceSelector
                sets={availableSets}
                selectedSetId={selectedSourceSet?.id || null}
                inferred={sourceIsInferred}
                onSelect={handleChangeSource}
                onRegenerate={handleRescan}
              />
            )}

            <ScanStatusBanner scan={scanResult} fullSetScan={fullSetScan} />

            {viewMode === 'plan' && (
              <MeasuredPlanViewer
                model={buildingModel}
                width={760}
                height={430}
                selectedRoomId={selectedRoomId}
                onRoomSelect={handleRoomEnter}
                activeStage={activeStage}
                showDimensions={showDimensions}
                showRoomLabels={showLabels}
                showAreaLabels={showLabels}
                showElectrical={showElectrical}
              />
            )}

            {viewMode === 'dollhouse' && (
              <Blueprint3DSpaceViewer
                buildingModel={buildingModel}
                activeStage={activeStage}
                selectedRoomId={selectedRoomId}
                onRoomSelect={handleRoomSelect}
                showElectrical={showElectrical}
                showDimensions={showDimensions}
                showLabels={showLabels}
                wallOpacity={wallOpacity}
                cameraPreset={cameraPreset}
              />
            )}

            {viewMode === 'room' && (
              <>
                <BlueprintRoomInteriorView
                  model={buildingModel}
                  selectedRoomId={selectedRoomId || firstRoomId}
                  activeStage={activeStage}
                  showElectrical={showElectrical}
                  showDimensions={showDimensions}
                  showLabels={showLabels}
                  wallOpacity={wallOpacity}
                />
                <RoomNavStrip
                  rooms={buildingModel.levels[0]?.rooms || []}
                  selectedRoomId={selectedRoomId}
                  onSelect={(rid) => setSelectedRoomId(rid)}
                  onBackToDollhouse={() => {
                    setViewMode('dollhouse')
                    setCameraPreset('iso')
                  }}
                  onBackToPlan={() => {
                    setViewMode('plan')
                    setCameraPreset('top')
                  }}
                />
              </>
            )}
          </div>

          {/* Stage tabs */}
          <StageTabs
            stages={visibleStages}
            selectedStage={activeStage}
            onSelectStage={setActiveStage}
          />

          {/* Stage description */}
          <div style={{
            padding: '8px 16px',
            background: 'rgba(0,229,204,0.03)',
            borderBottom: '1px solid rgba(0,229,204,0.1)',
          }}>
            <div style={{
              color: 'rgba(255,255,255,0.4)',
              fontSize: 10,
              fontFamily: 'monospace',
              lineHeight: 1.5,
              letterSpacing: 0.3,
            }}>
              {getStageDescription(activeStage)}
            </div>
            <div style={{
              marginTop: 4,
              color: 'rgba(0,221,204,0.5)',
              fontSize: 9,
              fontFamily: 'monospace',
            }}>
              {getCatalogItemsByStage(activeStage).length} items in this stage
            </div>
          </div>

          {/* Stage item list */}
          <StageItemList stage={activeStage} />
        </div>

        {/* Footer */}
        <div style={{
          padding: '10px 16px',
          borderTop: '1px solid rgba(0,229,204,0.15)',
          background: 'rgba(255,255,255,0.01)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          flexShrink: 0,
        }}>
          <div style={{
            color: 'rgba(255,255,255,0.3)',
            fontSize: 9,
            fontFamily: 'monospace',
            letterSpacing: 0.4,
          }}>
            Generated staged VR preview from blueprint PDF intelligence
            {job.outputManifest?.metadata?.description && (
              <span style={{ marginLeft: 8, color: 'rgba(0,221,204,0.3)' }}>
                · {job.outputManifest.metadata.description}
              </span>
            )}
          </div>

          <button
            onClick={onClose}
            style={{
              padding: '5px 14px',
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
              const b = e.currentTarget as HTMLButtonElement
              b.style.backgroundColor = 'rgba(0,229,204,0.18)'
              b.style.borderColor = 'rgba(0,229,204,0.6)'
            }}
            onMouseLeave={e => {
              const b = e.currentTarget as HTMLButtonElement
              b.style.backgroundColor = 'rgba(0,229,204,0.08)'
              b.style.borderColor = 'rgba(0,229,204,0.35)'
            }}
          >
            DONE
          </button>
        </div>
      </div>
    </>
  )
}
