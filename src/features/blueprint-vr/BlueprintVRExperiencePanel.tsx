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

import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react'
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
import Blueprint3DSpaceViewer, { computeBlueprintVRViewportPixels } from './Blueprint3DSpaceViewer'
import MeasuredPlanViewer from './MeasuredPlanViewer'
import BlueprintRoomInteriorView from './BlueprintRoomInteriorView'
import BlueprintVRSourceSelector from './BlueprintVRSourceSelector'
import type { SourceScanAccuracy } from './BlueprintVRSourceSelector'
import type { BlueprintBuildingModel } from './buildingModel'
import {
  scanBlueprintPlan,
  convertPlanScanToBuildingModel,
  scanBlueprintFullSet,
  mergeFullSetScanIntoBuildingModel,
  chooseBestFloorPlanSheet,
  classifySheetRole,
} from './blueprintPlanScanner'
import type {
  BlueprintPlanScanResult,
  BlueprintVRSourceSet,
  BlueprintFullSetScanResult,
} from './blueprintPlanScanner'
import type { PdfTracePayload as PdfTracePayloadType } from './pdfTraceTypes'
import type { PdfTracePayload } from './pdfTraceTypes'
import { buildBlueprintPdfRuntimeKey, extractTraceForBlueprintSheet } from './blueprintPdfTraceRuntimeBridge'
import {
  type BlueprintVRCacheIdentity,
  buildBlueprintVRCacheIdentityKey,
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
  /**
   * Runtime identity from the currently open Blueprint viewer.
   * Used to align provider lookups and scanner cache identity.
   */
  runtimeSourceIdentity?: {
    projectId?: string
    sourceSetId?: string
    sourceSetName?: string
    blueprintId?: string
    fileName?: string
    currentPageNumber?: number
    pageCount?: number
  }
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

/** Shared preview shell height; all view modes use the same outer workspace (~1.25× prior shell). */
const PREVIEW_SHELL_MIN_HEIGHT = 'clamp(650px, 70vh, 950px)'
const WALLS_VIEW_PLACEHOLDER_MIN_H = 750

const PLAN_ZOOM_MIN = 0.5
const PLAN_ZOOM_MAX = 4

// ── Subcomponent: 2D plan viewport (same pixel footprint as dollhouse) ─────

interface BvrMeasuredPlanScrollHostProps {
  zoom: number
  pan: { x: number; y: number }
  planDragging: boolean
  onWheelZoom: (e: WheelEvent) => void
  onPanMouseDown: (e: React.MouseEvent<HTMLDivElement>) => void
  /** Extra top inset so floating chrome (e.g. Proposed Walls header) does not cover the plan. */
  reserveTopPx?: number
  children: (dims: { w: number; h: number }) => React.ReactNode
}

function BvrMeasuredPlanScrollHost({
  zoom,
  pan,
  planDragging,
  onWheelZoom,
  onPanMouseDown,
  reserveTopPx = 0,
  children,
}: BvrMeasuredPlanScrollHostProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const clampRef = useRef<HTMLDivElement>(null)
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null)

  useEffect(() => {
    const el = hostRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect()
      setDims(computeBlueprintVRViewportPixels(r.width, r.height))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [reserveTopPx])

  useEffect(() => {
    const el = clampRef.current
    if (!el) return
    const fn = (e: WheelEvent) => {
      if (e.ctrlKey) return
      onWheelZoom(e)
    }
    el.addEventListener('wheel', fn, { passive: false })
    return () => el.removeEventListener('wheel', fn)
  }, [onWheelZoom, dims])

  return (
    <div
      ref={hostRef}
      style={{
        flex: 1,
        minHeight: 0,
        width: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        boxSizing: 'border-box',
        paddingTop: reserveTopPx,
      }}
    >
      {dims && (
        <div
          ref={clampRef}
          onMouseDown={onPanMouseDown}
          onContextMenu={(e) => {
            if (e.button === 1) e.preventDefault()
          }}
          title="Scroll wheel: zoom. Shift+drag or middle-click to pan when zoomed."
          style={{
            width: dims.w,
            height: dims.h,
            position: 'relative',
            overflow: 'hidden',
            flexShrink: 0,
            cursor: planDragging ? 'grabbing' : zoom > 1 ? 'grab' : 'default',
            touchAction: 'none',
          }}
        >
          <div
            style={{
              position: 'absolute',
              left: '50%',
              top: '50%',
              width: dims.w,
              height: dims.h,
              marginLeft: -dims.w / 2,
              marginTop: -dims.h / 2,
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              transformOrigin: 'center center',
            }}
          >
            {children(dims)}
          </div>
        </div>
      )}
    </div>
  )
}

interface BvrRoomViewportFrameProps {
  children: React.ReactNode
}

function BvrRoomViewportFrame({ children }: BvrRoomViewportFrameProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null)

  useEffect(() => {
    const el = hostRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect()
      setDims(computeBlueprintVRViewportPixels(r.width, r.height))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  return (
    <div
      ref={hostRef}
      style={{
        flex: 1,
        minHeight: 0,
        width: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {dims && (
        <div
          style={{
            width: dims.w,
            height: dims.h,
            minHeight: 0,
            overflow: 'hidden',
            flexShrink: 0,
          }}
        >
          {children}
        </div>
      )}
    </div>
  )
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

interface StageRailProps {
  stages: VRStage[]
  selectedStage: VRStage
  onSelectStage: (stage: VRStage) => void
}

function StageStageRail({ stages, selectedStage, onSelectStage }: StageRailProps) {
  return (
    <nav
      className="bvr7-stage-rail"
      aria-label="Construction stage"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        padding: '4px 0 0',
        border: 'none',
        borderRadius: 0,
        background: 'transparent',
        minWidth: 0,
        maxWidth: 'none',
        width: '100%',
        boxSizing: 'border-box',
        alignSelf: 'stretch',
        justifyContent: 'flex-start',
      }}
    >
      {stages.length === 0 ? (
        <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: 10, fontFamily: 'monospace' }}>
          No stages
        </div>
      ) : (
        stages.map((stage) => {
          const count = getCatalogItemsByStage(stage).length
          const isActive = selectedStage === stage
          return (
            <button
              key={stage}
              type="button"
              onClick={() => onSelectStage(stage)}
              style={{
                padding: '8px 8px',
                borderRadius: 4,
                border: isActive ? '2px solid #00ddcc' : '1px solid rgba(0,229,204,0.25)',
                background: isActive ? 'rgba(0,221,204,0.18)' : 'rgba(255,255,255,0.02)',
                color: isActive ? '#00ddcc' : 'rgba(255,255,255,0.55)',
                cursor: 'pointer',
                fontSize: 9.5,
                fontFamily: 'monospace',
                fontWeight: 700,
                letterSpacing: 0.6,
                textTransform: 'uppercase' as const,
                transition: 'all 0.15s',
                width: '100%',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 4,
                textAlign: 'center' as const,
                lineHeight: 1.15,
                boxShadow: isActive ? '0 0 12px rgba(0,221,204,0.2)' : undefined,
              }}
              onMouseEnter={(e) => {
                if (!isActive) {
                  const b = e.currentTarget as HTMLButtonElement
                  b.style.backgroundColor = 'rgba(0,229,204,0.08)'
                  b.style.borderColor = 'rgba(0,229,204,0.4)'
                }
              }}
              onMouseLeave={(e) => {
                if (!isActive) {
                  const b = e.currentTarget as HTMLButtonElement
                  b.style.backgroundColor = 'rgba(255,255,255,0.02)'
                  b.style.borderColor = 'rgba(0,229,204,0.25)'
                }
              }}
            >
              <span>{getStageLabelByType(stage)}</span>
              {count > 0 && (
                <span
                  style={{
                    fontSize: 8,
                    opacity: 0.75,
                    background: isActive ? 'rgba(0,221,204,0.25)' : 'rgba(255,255,255,0.08)',
                    borderRadius: 8,
                    padding: '1px 6px',
                  }}
                >
                  {count}
                </span>
              )}
            </button>
          )
        })
      )}
    </nav>
  )
}

// ── Subcomponent: Stage Item List ─────────────────────────────────────

function StageItemList({ stage }: { stage: VRStage }) {
  const [openBuckets, setOpenBuckets] = useState<Record<string, boolean>>({})
  const items = getCatalogItemsByStage(stage)

  const toggleBucket = useCallback((category: string) => {
    setOpenBuckets((prev) => ({ ...prev, [category]: !prev[category] }))
  }, [])

  useEffect(() => {
    setOpenBuckets({})
  }, [stage])

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
      {Object.entries(grouped).map(([category, catItems]) => {
        const expanded = Boolean(openBuckets[category])
        return (
        <div key={category}>
          <button
            type="button"
            onClick={() => toggleBucket(category)}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 10,
              marginTop: 10,
              marginBottom: expanded ? 6 : 2,
              padding: '8px 10px',
              borderRadius: 4,
              border: '1px solid rgba(0,229,204,0.14)',
              background: expanded ? 'rgba(0,229,204,0.06)' : 'rgba(255,255,255,0.02)',
              cursor: 'pointer',
              textAlign: 'left' as const,
            }}
          >
            <span
              style={{
                color: 'rgba(0,221,204,0.55)',
                fontSize: 8.5,
                fontFamily: 'monospace',
                letterSpacing: 1,
                textTransform: 'uppercase' as const,
                flex: '1 1 auto',
                minWidth: 0,
              }}
            >
              {category}
              <span style={{ marginLeft: 8, color: 'rgba(255,255,255,0.35)', fontSize: 9 }}>
                {catItems.length}
              </span>
            </span>
            <span
              style={{
                color: 'rgba(255,255,255,0.45)',
                fontSize: 11,
                fontFamily: 'monospace',
                flexShrink: 0,
              }}
              aria-hidden
            >
              {expanded ? '▾' : '▸'}
            </span>
          </button>

          {expanded &&
          catItems.map(item => (
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
        )
      })}
    </div>
  )
}

// ── Subcomponent: Scan Status Banner ─────────────────────────────────

function ScanStatusBanner({
  scan,
  fullSetScan,
  fromCache,
  sourceLabel,
  sourceType,
  traceRuntime,
  runtimeProviderDebug,
  cacheDebug,
}: {
  scan: BlueprintPlanScanResult
  fullSetScan?: BlueprintFullSetScanResult
  fromCache?: boolean
  sourceLabel?: string
  sourceType?: string
  traceRuntime?: {
    providerStatus: 'available' | 'missing' | 'error'
    selectedPageNumber: number | null
    operatorListStatus: 'available' | 'missing' | 'error' | 'unknown'
    textContentStatus: 'available' | 'missing' | 'error' | 'unknown'
    opsSource?: 'provider' | 'dynamic-import' | 'missing'
  }
  runtimeProviderDebug?: {
    requestedKey?: string
    registeredKeys?: string[]
    matchReason?: string
    matchedKey?: string
    registrySize?: number
    providerAgeSec?: number
    pdfDocReady?: boolean
    hasGetPage?: boolean
    lastUnregisterReason?: string
  }
  cacheDebug?: {
    mode: 'hit' | 'miss'
    key: string
    keyHash: string
    sourceIdentity: BlueprintVRCacheIdentity
    rescanCount: number
    scannedAt?: string
  }
}) {
  const top = scan.warnings.slice(0, 5)
  const resultKind = scan.scanResultKind || (scan.isFallback ? 'fallback' : 'measured-trace')
  const resultLabel =
    resultKind === 'measured-trace'
      ? 'Measured Trace'
      : resultKind === 'cached-inferred'
      ? 'Cached Inferred'
      : resultKind === 'inferred'
      ? 'Inferred'
      : 'Fallback'
  const accent =
    resultKind === 'measured-trace' ? '#7BE5D8' : resultKind === 'fallback' ? '#FF9966' : '#FFB347'
  const sheetCounts = fullSetScan?.sheetRoleCounts
  const confidenceBreakdown = scan.confidenceBreakdown || fullSetScan?.confidenceBreakdown
  const selectedFloorPlan = scan.selectedFloorPlanSheet || fullSetScan?.bestFloorPlanSheet || null
  const traceStatus = scan.traceStatus || 'missing'
  const scaleStatus = scan.scaleStatus || 'default'
  const debug = scan.traceDebugCounts || null
  const confidenceCapReason =
    debug?.confidenceCapReason ||
    confidenceBreakdown?.confidenceCapReason ||
    confidenceBreakdown?.reasons?.vectorTraceAvailable ||
    'No cap reason recorded.'

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
        <span style={{ color: accent, fontWeight: 700, letterSpacing: 0.8 }}>SCANNER STATUS</span>
        <span style={{ opacity: 0.6 }}>
          VR Source: {sourceLabel || 'Unknown'}{sourceType ? ` · ${sourceType}` : ''}
        </span>
        <span style={{ opacity: 0.5 }}>
          Scan Result: {fromCache && resultLabel !== 'Cached Inferred' ? `Cached ${resultLabel}` : resultLabel} · {(scan.confidence * 100).toFixed(0)}%
        </span>
      </div>

      <div style={{ opacity: 0.72, fontSize: 9.5, color: 'rgba(200,230,240,0.9)' }}>
        Selected floor plan: {selectedFloorPlan
          ? `Pg ${selectedFloorPlan.pageNumber} · ${selectedFloorPlan.sheetNumber || '(no #)'} · ${selectedFloorPlan.sheetTitle || '(no title)'} · ${Math.round(selectedFloorPlan.confidence * 100)}%`
          : 'Not selected (missing reliable floor-plan sheet metadata)'}
      </div>

      {sheetCounts && (
        <div style={{ opacity: 0.7, fontSize: 9.5, lineHeight: 1.45 }}>
          Roles: floor plan {sheetCounts.floorPlan} · electrical/power {sheetCounts.electricalPower} · rendering {sheetCounts.rendering} · interior elevation {sheetCounts.interiorElevation} · finish/material {sheetCounts.finishMaterial} · schedule {sheetCounts.schedule} · unknown {sheetCounts.unknown}
        </div>
      )}

      <div style={{ opacity: 0.7, fontSize: 9.5, lineHeight: 1.45 }}>
        Trace: {traceStatus} · Scale: {scaleStatus} · Geometry: walls {scan.walls.length}, openings {scan.openings.length}, rooms {scan.rooms.length}
      </div>
      <div style={{ opacity: 0.72, fontSize: 9.1, lineHeight: 1.45, color: 'rgba(180,225,240,0.9)' }}>
        Runtime provider: {traceRuntime?.providerStatus || debug?.runtimeProviderStatus || 'missing'} · Selected trace page: {traceRuntime?.selectedPageNumber || selectedFloorPlan?.pageNumber || 'n/a'}
      </div>
      <div style={{ opacity: 0.72, fontSize: 9.1, lineHeight: 1.45, color: 'rgba(180,225,240,0.9)' }}>
        Operator list: {traceRuntime?.operatorListStatus || debug?.operatorListStatus || 'unknown'} · Text content: {traceRuntime?.textContentStatus || debug?.textContentStatus || 'unknown'}
      </div>
      <div style={{ opacity: 0.72, fontSize: 9.1, lineHeight: 1.45, color: 'rgba(180,225,240,0.9)' }}>
        Raw lines {debug?.rawLines ?? 0} · Rectangles {debug?.rawRects ?? 0} · Polylines {debug?.rawPolylines ?? 0} · Text runs {debug?.rawTextRuns ?? 0}
      </div>
      <div style={{ opacity: 0.72, fontSize: 9.1, lineHeight: 1.45, color: 'rgba(180,225,240,0.9)' }}>
        Wall candidates {debug?.mergedWalls ?? scan.walls.length} · Room candidates {debug?.roomCandidates ?? scan.rooms.length}
      </div>
      <div style={{ opacity: 0.72, fontSize: 9.1, lineHeight: 1.45, color: 'rgba(255,200,145,0.95)' }}>
        Confidence cap reason: {confidenceCapReason}
      </div>
      {cacheDebug && (
        <div style={{ opacity: 0.72, fontSize: 9.1, lineHeight: 1.45, color: 'rgba(180,225,240,0.9)' }}>
          Cache {cacheDebug.mode.toUpperCase()} · key {cacheDebug.keyHash} · rescan #{cacheDebug.rescanCount}
          {cacheDebug.scannedAt ? ` · ${new Date(cacheDebug.scannedAt).toLocaleTimeString()}` : ''}
        </div>
      )}
      {cacheDebug && (
        <div style={{ opacity: 0.68, fontSize: 8.8, lineHeight: 1.4, color: 'rgba(170,210,225,0.9)' }}>
          Source identity: {cacheDebug.sourceIdentity.projectId || 'na'} · {cacheDebug.sourceIdentity.sourceSetId || cacheDebug.sourceIdentity.sourceSetName || 'na'} · {cacheDebug.sourceIdentity.blueprintId || 'na'} · page {cacheDebug.sourceIdentity.selectedFloorPlanPage || 'na'} / {cacheDebug.sourceIdentity.pageCount || 'na'} · {cacheDebug.sourceIdentity.scannerVersion || 'na'}
        </div>
      )}
      {runtimeProviderDebug?.requestedKey && (
        <div style={{ opacity: 0.72, fontSize: 9.1, lineHeight: 1.45, color: 'rgba(180,225,240,0.9)' }}>
          Requested provider key: {runtimeProviderDebug.requestedKey}
        </div>
      )}
      {runtimeProviderDebug?.registeredKeys && runtimeProviderDebug.registeredKeys.length > 0 && (
        <div style={{ opacity: 0.68, fontSize: 8.8, lineHeight: 1.4, color: 'rgba(170,210,225,0.9)' }}>
          Registered provider keys: {runtimeProviderDebug.registeredKeys.join(' | ')}
        </div>
      )}
      {runtimeProviderDebug?.requestedKey && (!runtimeProviderDebug.registeredKeys || runtimeProviderDebug.registeredKeys.length === 0) && (
        <div style={{ opacity: 0.68, fontSize: 8.8, lineHeight: 1.4, color: 'rgba(255,190,145,0.92)' }}>
          Registered provider keys: none
        </div>
      )}
      {runtimeProviderDebug?.matchReason && (
        <div style={{ opacity: 0.68, fontSize: 8.8, lineHeight: 1.4, color: 'rgba(255,190,145,0.92)' }}>
          Provider match reason: {runtimeProviderDebug.matchReason}
        </div>
      )}
      {runtimeProviderDebug?.matchedKey && (
        <div style={{ opacity: 0.68, fontSize: 8.8, lineHeight: 1.4, color: 'rgba(170,230,210,0.92)' }}>
          Matched provider key: {runtimeProviderDebug.matchedKey}
        </div>
      )}
      {traceRuntime?.opsSource && (
        <div style={{ opacity: 0.68, fontSize: 8.8, lineHeight: 1.4, color: 'rgba(170,230,210,0.92)' }}>
          OPS source: {traceRuntime.opsSource}
        </div>
      )}
      {runtimeProviderDebug?.registrySize !== undefined && (
        <div style={{ opacity: 0.68, fontSize: 8.8, lineHeight: 1.4, color: 'rgba(170,210,225,0.9)' }}>
          Registry size: {runtimeProviderDebug.registrySize}
          {' · '}Age: {runtimeProviderDebug.providerAgeSec !== undefined ? `${runtimeProviderDebug.providerAgeSec}s` : 'n/a'}
          {' · '}pdfDoc ready: {runtimeProviderDebug.pdfDocReady != null ? String(runtimeProviderDebug.pdfDocReady) : 'n/a'}
          {' · '}getPage available: {runtimeProviderDebug.hasGetPage != null ? (runtimeProviderDebug.hasGetPage ? 'yes' : 'no') : 'n/a'}
        </div>
      )}
      {runtimeProviderDebug?.lastUnregisterReason && (
        <div style={{ opacity: 0.68, fontSize: 8.8, lineHeight: 1.4, color: 'rgba(255,190,145,0.9)' }}>
          Last unregister reason: {runtimeProviderDebug.lastUnregisterReason}
        </div>
      )}
      {scan.traceAttempted && !scan.traceAvailable && (
        <div style={{ opacity: 0.72, fontSize: 9.4, color: 'rgba(255,180,140,0.95)' }}>
          Vector trace unavailable from current viewer context.
        </div>
      )}

      {confidenceBreakdown && (
        <div style={{ opacity: 0.72, fontSize: 9.2, lineHeight: 1.4, color: 'rgba(170,220,235,0.92)' }}>
          Confidence points ({confidenceBreakdown.totalPercent}%): source {confidenceBreakdown.items.sourceSetSelected} · classify {confidenceBreakdown.items.sheetsClassified} · floor plan {confidenceBreakdown.items.floorPlanSheetSelected} · scale {confidenceBreakdown.items.scaleDetected} · dimensions {confidenceBreakdown.items.dimensionsDetected} · trace {confidenceBreakdown.items.vectorTraceAvailable} · walls {confidenceBreakdown.items.wallCandidatesFound} · openings {confidenceBreakdown.items.openingsFound} · rooms {confidenceBreakdown.items.roomsValidated} · elevations {confidenceBreakdown.items.elevationsMatched} · electrical {confidenceBreakdown.items.electricalSheetsMatched}
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
  runtimeSourceIdentity,
}: BlueprintVRExperiencePanelProps) {
  const [activeStage, setActiveStage] = useState<VRStage>(STAGE_ORDER[0])
  const [viewMode, setViewMode] = useState<'plan' | 'dollhouse' | 'room' | 'walls'>('dollhouse')
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null)
  const [showElectrical, setShowElectrical] = useState(true)
  const [showDimensions, setShowDimensions] = useState(true)
  const [showLabels, setShowLabels] = useState(true)
  const [wallOpacity, setWallOpacity] = useState(0.82)
  const [cameraPreset, setCameraPreset] = useState<'top' | 'iso' | 'room'>('iso')
  const [viewMenuOpen, setViewMenuOpen] = useState(false)
  const viewMenuRef = useRef<HTMLDivElement>(null)
  const viewMenuButtonRef = useRef<HTMLButtonElement>(null)
  const [labelsMenuOpen, setLabelsMenuOpen] = useState(false)
  const labelsMenuRef = useRef<HTMLDivElement>(null)
  const labelsMenuButtonRef = useRef<HTMLButtonElement>(null)
  const [wallTransparencyOpen, setWallTransparencyOpen] = useState(false)
  const wallTransparencyButtonRef = useRef<HTMLButtonElement>(null)
  const wallTransparencyPopoverRef = useRef<HTMLDivElement>(null)
  const [planZoomScale, setPlanZoomScale] = useState(1)
  const [planPan, setPlanPan] = useState({ x: 0, y: 0 })
  const [planDragging, setPlanDragging] = useState(false)
  const planPanSessionRef = useRef<{ mx: number; my: number; px: number; py: number } | null>(null)
  const [scannerStatusExpanded, setScannerStatusExpanded] = useState(false)

  // ── Source-set state (project-level) ──────────────────────────────────
  const availableSets = availableSourceSets || []

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
  const [rescanCount, setRescanCount] = useState(0)
  const [lastScanAt, setLastScanAt] = useState<string | null>(null)

  // Multi-page full-set extraction state
  const [fullSetPageTraces, setFullSetPageTraces] = useState<Record<number, PdfTracePayloadType>>({})
  const [fullSetExtractionPhase, setFullSetExtractionPhase] = useState<'idle' | 'extracting' | 'done'>('idle')
  const [fullSetExtractionProgress, setFullSetExtractionProgress] = useState<{
    pagesTotal: number
    pagesExtracted: number
    targetPages: number[]
  }>({ pagesTotal: 0, pagesExtracted: 0, targetPages: [] })

  const [traceExtraction, setTraceExtraction] = useState<{
    selectedPageNumber: number | null
    payload: PdfTracePayload | null
    attempted: boolean
    available: boolean
    providerStatus: 'available' | 'missing' | 'error'
    operatorListStatus: 'available' | 'missing' | 'error' | 'unknown'
    textContentStatus: 'available' | 'missing' | 'error' | 'unknown'
    requestedKey?: string
    registeredKeys?: string[]
    matchReason?: string
    providerKey?: string
    providerMetadata?: Record<string, any>
    warnings: Array<{ code: string; message: string }>
  }>({
    selectedPageNumber: null,
    payload: null,
    attempted: false,
    available: false,
    providerStatus: 'missing',
    operatorListStatus: 'unknown',
    textContentStatus: 'unknown',
    requestedKey: undefined,
    registeredKeys: [],
    matchReason: undefined,
    providerKey: undefined,
    providerMetadata: undefined,
    warnings: [],
  })

  useEffect(() => {
    setSelectedSourceSetId(autoPickedSetId)
  }, [autoPickedSetId])

  const selectedSourceSet = useMemo<BlueprintVRSourceSet | null>(() => {
    if (!availableSets.length) return null
    return availableSets.find((s) => s.id === selectedSourceSetId) || availableSets[0]
  }, [availableSets, selectedSourceSetId])

  const scannerVersion = 'W3.10D'

  // Excludes currentPageNumber — page navigation should not trigger a full
  // re-extraction. The Rescan button handles that explicitly.
  const runtimeIdentityKey = [
    runtimeSourceIdentity?.projectId || '',
    runtimeSourceIdentity?.blueprintId || '',
    runtimeSourceIdentity?.sourceSetId || '',
    runtimeSourceIdentity?.sourceSetName || '',
    runtimeSourceIdentity?.fileName || '',
    runtimeSourceIdentity?.pageCount || '',
  ].join('|')

  useEffect(() => {
    let disposed = false

    const noTrace = {
      selectedPageNumber: null as number | null,
      payload: null as PdfTracePayloadType | null,
      attempted: false,
      available: false,
      providerStatus: 'missing' as const,
      operatorListStatus: 'unknown' as const,
      textContentStatus: 'unknown' as const,
      requestedKey: undefined as string | undefined,
      registeredKeys: [] as string[],
      matchReason: undefined as string | undefined,
      providerKey: undefined as string | undefined,
      providerMetadata: undefined as Record<string, any> | undefined,
      warnings: [] as Array<{ code: string; message: string }>,
    }

    if (!selectedSourceSet) {
      setTraceExtraction(noTrace)
      setFullSetPageTraces({})
      setFullSetExtractionPhase('idle')
      return
    }

    const sheets = selectedSourceSet.sheets || []
    // Build the provider key from the selected source set first, not from
    // runtimeSourceIdentity. The viewer registers its provider keyed by
    // blueprint.id = selectedItem.id, which equals selectedSourceSet.id when
    // the user has the correct set open. Using runtimeSourceIdentity first
    // caused the slip-sheets provider (9 pages) to be matched when the user
    // had previously clicked a different blueprint in the library.
    const runtimeRequestIdentity = {
      projectId: selectedSourceSet.projectId || projectId || runtimeSourceIdentity?.projectId,
      blueprintId: selectedSourceSet.id || sourceBlueprint.id || runtimeSourceIdentity?.blueprintId,
      sourceSetId: selectedSourceSet.id || runtimeSourceIdentity?.sourceSetId,
      sourceSetName: selectedSourceSet.name || runtimeSourceIdentity?.sourceSetName,
      fileName: selectedSourceSet.filePath || runtimeSourceIdentity?.fileName,
      pageCount: selectedSourceSet.totalPages || runtimeSourceIdentity?.pageCount,
    }
    const requestedRuntimeKey = buildBlueprintPdfRuntimeKey(runtimeRequestIdentity)

    // Choose the best floor plan sheet for the primary trace
    const best = chooseBestFloorPlanSheet(sheets)

    // Identify floor-plan candidate pages using sheet-role classification
    const floorPlanRoles = new Set(['floor_plan', 'partition_plan', 'dimension_plan'])
    const classifiedCandidates = sheets
      .map((sheet) => {
        const roles = classifySheetRole(sheet)
        const isFloorPlan = roles.some((r) => floorPlanRoles.has(r))
        return { sheet, isFloorPlan }
      })
      .filter((c) => c.isFloorPlan)

    // Build ordered target page list: best first, then other classified candidates
    const targetPageSet = new Set<number>()
    if (best) targetPageSet.add(best.pageNumber)
    for (const c of classifiedCandidates.slice(0, 7)) targetPageSet.add(c.sheet.pageNumber)
    // If no floor-plan candidates found via metadata, sample pages distributed
    // across the full document. For a 67-page Full Set this reaches page ~37
    // (floor plan area) rather than stopping at page 3.
    if (targetPageSet.size === 0) {
      const totalPgs = selectedSourceSet.totalPages || sheets.length || 1
      if (totalPgs <= 8) {
        for (let p = 1; p <= Math.min(5, totalPgs); p++) targetPageSet.add(p)
      } else {
        targetPageSet.add(1)
        targetPageSet.add(2)
        for (const pct of [0.20, 0.35, 0.50, 0.65, 0.80]) {
          const p = Math.max(1, Math.min(totalPgs, Math.round(totalPgs * pct)))
          targetPageSet.add(p)
        }
      }
      // Always include the currently-viewed page — user may have the floor
      // plan already open in the viewer.
      if (runtimeSourceIdentity?.currentPageNumber && runtimeSourceIdentity.currentPageNumber > 0) {
        targetPageSet.add(runtimeSourceIdentity.currentPageNumber)
      }
    }
    const targetPages = Array.from(targetPageSet).sort((a, b) => a - b)

    setLastScanAt(new Date().toISOString())
    setFullSetExtractionPhase('extracting')
    setFullSetExtractionProgress({ pagesTotal: targetPages.length, pagesExtracted: 0, targetPages })
    setTraceExtraction((prev) => ({
      ...prev,
      attempted: false,
      requestedKey: requestedRuntimeKey,
      selectedPageNumber: best?.pageNumber ?? null,
    }))

    void (async () => {
      const newTraces: Record<number, PdfTracePayloadType> = {}
      let primaryTraceSet = false

      for (let i = 0; i < targetPages.length; i++) {
        if (disposed) break
        const pageNumber = targetPages[i]
        const sheet = sheets.find((s) => s.pageNumber === pageNumber)

        const traceArgs = {
          ...runtimeRequestIdentity,
          pageNumber,
          sheetNumber: sheet?.sheetNumber,
          sheetTitle: sheet?.sheetTitle,
          existingPayload: sheet?.tracePayload || null,
        }

        // Initial attempt + up to 2 retries for the first page to give the
        // PDF runtime a chance to register before giving up.
        let runtimeTrace = await extractTraceForBlueprintSheet(traceArgs)
        if (!disposed && i === 0 && runtimeTrace.providerStatus === 'missing') {
          await new Promise<void>((r) => setTimeout(r, 160))
          if (!disposed) runtimeTrace = await extractTraceForBlueprintSheet(traceArgs)
        }
        if (!disposed && i === 0 && runtimeTrace.providerStatus === 'missing') {
          await new Promise<void>((r) => setTimeout(r, 320))
          if (!disposed) runtimeTrace = await extractTraceForBlueprintSheet(traceArgs)
        }

        if (disposed) break

        if (runtimeTrace.result.payload) {
          newTraces[pageNumber] = runtimeTrace.result.payload
        }

        // Update the primary traceExtraction state for the best floor-plan page
        const isPrimary = pageNumber === (best?.pageNumber ?? targetPages[0])
        if (isPrimary && !primaryTraceSet) {
          primaryTraceSet = true
          setTraceExtraction({
            selectedPageNumber: runtimeTrace.selectedPageNumber,
            payload: runtimeTrace.result.payload,
            attempted: true,
            available: Boolean(runtimeTrace.result.success),
            providerStatus: runtimeTrace.providerStatus,
            operatorListStatus: runtimeTrace.operatorListStatus,
            textContentStatus: runtimeTrace.textContentStatus,
            requestedKey: runtimeTrace.providerRequestedKey || requestedRuntimeKey,
            registeredKeys: runtimeTrace.providerRegisteredKeys || [],
            matchReason: runtimeTrace.providerMatchReason,
            providerKey: runtimeTrace.providerKey,
            providerMetadata: runtimeTrace.providerMetadata,
            warnings: runtimeTrace.result.warnings,
          })
        }

        setFullSetExtractionProgress((prev) => ({
          ...prev,
          pagesExtracted: prev.pagesExtracted + 1,
        }))
      }

      if (disposed) return

      // If the primary page was never found in the loop, emit a no-trace state
      if (!primaryTraceSet) {
        setTraceExtraction({ ...noTrace, attempted: true, requestedKey: requestedRuntimeKey })
      }

      setFullSetPageTraces(newTraces)
      setFullSetExtractionPhase('done')
    })()

    return () => {
      disposed = true
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSourceSet, rescanToken, projectId, runtimeIdentityKey, sourceBlueprint.id, sourceBlueprint.filePath])

  const sourceCacheIdentity = useMemo<BlueprintVRCacheIdentity>(
    () => ({
      projectId:
        selectedSourceSet?.projectId ||
        projectId ||
        runtimeSourceIdentity?.projectId ||
        projectNameProp ||
        job.outputManifest?.projectName ||
        'unknown-project',
      sourceSetId: selectedSourceSet?.id || runtimeSourceIdentity?.sourceSetId || null,
      sourceSetName: selectedSourceSet?.name || runtimeSourceIdentity?.sourceSetName || sourceBlueprint.name || null,
      blueprintId: selectedSourceSet?.id || runtimeSourceIdentity?.blueprintId || sourceBlueprint.id || null,
      fileName:
        selectedSourceSet?.filePath ||
        runtimeSourceIdentity?.fileName ||
        sourceBlueprint.filePath ||
        sourceBlueprint.name ||
        null,
      selectedFloorPlanPage:
        traceExtraction.selectedPageNumber ||
        runtimeSourceIdentity?.currentPageNumber ||
        null,
      pageCount:
        selectedSourceSet?.totalPages ||
        runtimeSourceIdentity?.pageCount ||
        null,
      scannerVersion,
    }),
    [
      selectedSourceSet,
      projectId,
      runtimeSourceIdentity,
      projectNameProp,
      job.outputManifest?.projectName,
      sourceBlueprint.name,
      sourceBlueprint.id,
      sourceBlueprint.filePath,
      traceExtraction.selectedPageNumber,
      scannerVersion,
    ],
  )

  const sourceKey = buildBlueprintVRCacheIdentityKey(sourceCacheIdentity)
  const userPickedSource = !!initialSourceSetId
  const projectNameForCache =
    projectNameProp || selectedSourceSet?.projectName || job.outputManifest?.projectName || sourceBlueprint.name

  // ── Cached model lookup. Recomputes only when key / rescan token changes ──
  const cacheKeyParts = `${sourceKey}::${rescanToken}`

  const { scanResult, fullSetScan, buildingModel, fromCache, cacheDebug } = useMemo(() => {
    // Only serve the cache when we haven't completed a fresh multi-page
    // extraction yet. Once fullSetExtractionPhase === 'done' we have real
    // (or definitively failed) trace data and must bypass the cache so the
    // scan reflects the actual extraction result.
    const allowCache = rescanToken === 0 && fullSetExtractionPhase !== 'done'
    const cached = allowCache ? getCachedProjectModel(sourceCacheIdentity) : undefined
    if (cached) {
      return {
        scanResult: cached.scan,
        fullSetScan: cached.fullSetScan,
        buildingModel: cached.model,
        fromCache: true,
        cacheDebug: {
          mode: 'hit' as const,
          key: cached.key,
          keyHash: cached.keyHash,
          sourceIdentity: cached.sourceIdentity,
          rescanCount,
          scannedAt: cached.generatedAt,
        },
      }
    }

    let scan: BlueprintPlanScanResult
    let fullScan: BlueprintFullSetScanResult | undefined
    let model: BlueprintBuildingModel

    // Attach all freshly extracted page traces to their respective sheets so
    // the full-set scanner can pick the best floor-plan trace from real data.
    const sourceSetForScan = selectedSourceSet
      ? {
          ...selectedSourceSet,
          sheets: selectedSourceSet.sheets.map((sheet) => {
            const freshTrace = fullSetPageTraces[sheet.pageNumber]
            const isPrimarySheet =
              traceExtraction.selectedPageNumber != null &&
              sheet.pageNumber === traceExtraction.selectedPageNumber
            return {
              ...sheet,
              tracePayload: freshTrace ?? (isPrimarySheet ? traceExtraction.payload : sheet.tracePayload),
              traceAttempted: freshTrace !== undefined || (isPrimarySheet ? traceExtraction.attempted : sheet.traceAttempted),
              traceWarnings: isPrimarySheet ? traceExtraction.warnings : sheet.traceWarnings,
            }
          }),
        }
      : null

    if (sourceSetForScan) {
      fullScan = scanBlueprintFullSet({
        projectName: projectNameForCache,
        sourceSet: sourceSetForScan,
        extractedText: job.outputManifest?.metadata?.description,
        multiPageTraces: fullSetPageTraces,
        totalPagesScanned: fullSetExtractionProgress.pagesExtracted || undefined,
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

    const stored = setCachedProjectModel(sourceCacheIdentity, {
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
      cacheDebug: {
        mode: 'miss' as const,
        key: stored.key,
        keyHash: stored.keyHash,
        sourceIdentity: stored.sourceIdentity,
        rescanCount,
        scannedAt: stored.generatedAt,
      },
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheKeyParts, traceExtraction, fullSetPageTraces, fullSetExtractionPhase, sourceCacheIdentity, rescanCount])

  const handleChangeSource = useCallback(
    (setId: string) => {
      setSelectedSourceSetId(setId)
      setSelectedRoomId(null)
      setRescanToken(0)
      setLastScanAt(new Date().toISOString())
      onSelectSourceSet?.(setId)
    },
    [onSelectSourceSet],
  )

  const handleRescan = useCallback(() => {
    clearCachedProjectModel(sourceCacheIdentity)
    setLastScanAt(new Date().toISOString())
    setRescanCount((n) => n + 1)
    setTraceExtraction((prev) => ({
      ...prev,
      attempted: false,
      available: false,
      providerStatus: 'missing',
    }))
    setFullSetPageTraces({})
    setFullSetExtractionPhase('idle')
    setFullSetExtractionProgress({ pagesTotal: 0, pagesExtracted: 0, targetPages: [] })
    setRescanToken((t) => t + 1)
  }, [sourceCacheIdentity])

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

  useEffect(() => {
    setPlanZoomScale(1)
    setPlanPan({ x: 0, y: 0 })
  }, [viewMode])

  useEffect(() => {
    if (!viewMenuOpen && !labelsMenuOpen && !wallTransparencyOpen) return
    const onDocMouseDown = (e: MouseEvent) => {
      const t = e.target as Node
      const inside =
        viewMenuRef.current?.contains(t) ||
        viewMenuButtonRef.current?.contains(t) ||
        labelsMenuRef.current?.contains(t) ||
        labelsMenuButtonRef.current?.contains(t) ||
        wallTransparencyPopoverRef.current?.contains(t) ||
        wallTransparencyButtonRef.current?.contains(t)
      if (!inside) {
        setViewMenuOpen(false)
        setLabelsMenuOpen(false)
        setWallTransparencyOpen(false)
      }
    }
    document.addEventListener('mousedown', onDocMouseDown)
    return () => document.removeEventListener('mousedown', onDocMouseDown)
  }, [viewMenuOpen, labelsMenuOpen, wallTransparencyOpen])

  useEffect(() => {
    if (!viewMenuOpen && !labelsMenuOpen && !wallTransparencyOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setViewMenuOpen(false)
        setLabelsMenuOpen(false)
        setWallTransparencyOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [viewMenuOpen, labelsMenuOpen, wallTransparencyOpen])

  useEffect(() => {
    if (!planDragging) return
    const mm = (ev: MouseEvent) => {
      const s = planPanSessionRef.current
      if (!s) return
      setPlanPan({
        x: s.px + (ev.clientX - s.mx),
        y: s.py + (ev.clientY - s.my),
      })
    }
    const mu = () => {
      planPanSessionRef.current = null
      setPlanDragging(false)
    }
    window.addEventListener('mousemove', mm)
    window.addEventListener('mouseup', mu)
    return () => {
      window.removeEventListener('mousemove', mm)
      window.removeEventListener('mouseup', mu)
    }
  }, [planDragging])

  // Compute honest scan accuracy classification for the source selector.
  const scanAccuracy: SourceScanAccuracy = useMemo(() => {
    const kind = scanResult.scanResultKind || (scanResult.isFallback ? 'fallback' : 'measured-trace')
    if (kind === 'measured-trace') return fromCache ? 'cached-measured' : 'measured'
    if (kind === 'fallback') return 'fallback'
    return fromCache ? 'cached-inferred' : 'inferred'
  }, [fromCache, scanResult.scanResultKind, scanResult.isFallback])

  const scanSummary = useMemo(() => {
    const w = Math.round(scanResult.footprint.width)
    const d = Math.round(scanResult.footprint.height)
    const rooms = scanResult.rooms.length
    return `${scanResult.layoutContext.replace(/-/g, ' ')} · ${w}'-0" W × ${d}'-0" D · ${rooms} rooms`
  }, [scanResult])

  const scannerStatusSummary = useMemo(() => {
    const scan = scanResult
    const resultKind = scan.scanResultKind || (scan.isFallback ? 'fallback' : 'measured-trace')
    const resultLabel =
      resultKind === 'measured-trace'
        ? 'Measured Trace'
        : resultKind === 'cached-inferred'
          ? 'Cached Inferred'
          : resultKind === 'inferred'
            ? 'Inferred'
            : 'Fallback'
    const pct = Math.round((scan.confidence || 0) * 100)
    const cacheBit = fromCache && resultLabel !== 'Cached Inferred' ? 'Cached ' : ''
    const src = selectedSourceSet?.name || sourceBlueprint.name
    return `${src} · ${cacheBit}${resultLabel} · ${pct}%`
  }, [scanResult, fromCache, selectedSourceSet, sourceBlueprint.name])

  // Always show all 4 stages from STAGE_ORDER — no dependency on manifest
  const visibleStages = [...STAGE_ORDER] as VRStage[]

  // Total item count across all stages
  const totalItems = visibleStages.reduce(
    (sum, st) => sum + getCatalogItemsByStage(st).length,
    0
  )

  const handlePlanZoomIn = useCallback(() => {
    setPlanZoomScale((z) => Math.min(PLAN_ZOOM_MAX, Math.round(z * 1.15 * 100) / 100))
  }, [])
  const handlePlanZoomOut = useCallback(() => {
    setPlanZoomScale((z) => Math.max(PLAN_ZOOM_MIN, Math.round((z / 1.15) * 100) / 100))
  }, [])
  const handlePlanZoomReset = useCallback(() => {
    setPlanZoomScale(1)
    setPlanPan({ x: 0, y: 0 })
  }, [])

  const handlePlanWheelZoom = useCallback((e: WheelEvent) => {
    if (e.ctrlKey) return
    e.preventDefault()
    e.stopPropagation()
    const factor = e.deltaY < 0 ? 1.08 : 0.93
    setPlanZoomScale((z) =>
      Math.round(Math.min(PLAN_ZOOM_MAX, Math.max(PLAN_ZOOM_MIN, z * factor)) * 100) / 100,
    )
  }, [])

  const handlePlanPanMouseDown = useCallback(
    (ev: React.MouseEvent<HTMLDivElement>) => {
      if (planZoomScale <= 1) return
      const panMouse = ev.button === 1 || (ev.button === 0 && ev.shiftKey)
      if (!panMouse) return
      if (ev.button === 1) ev.preventDefault()
      planPanSessionRef.current = { mx: ev.clientX, my: ev.clientY, px: planPan.x, py: planPan.y }
      setPlanDragging(true)
    },
    [planZoomScale, planPan],
  )

  return (
    <>
      <style>{`
        @keyframes bvr7-slide-in {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @keyframes bvr7-backdrop-fade {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        .bvr7-preview-stage-row {
          display: flex;
          flex-wrap: wrap;
          gap: 12px;
          align-items: stretch;
        }
        .bvr7-preview-column {
          flex: 1 1 320px;
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .bvr7-preview-shell {
          position: relative;
          flex: 1;
          width: 100%;
          min-height: ${PREVIEW_SHELL_MIN_HEIGHT};
          display: flex;
          flex-direction: column;
          align-items: stretch;
          justify-content: center;
          border-radius: 8px;
          overflow: hidden;
          background: #070b12;
          border: 1px solid rgba(0,229,204,0.2);
        }
        .bvr7-right-rail {
          display: flex;
          flex-direction: column;
          gap: 6px;
          padding: 12px 10px;
          border: 1px solid rgba(0,229,204,0.22);
          border-radius: 8px;
          background: rgba(6,12,20,0.92);
          min-width: 108px;
          max-width: 124px;
          flex: 0 0 auto;
          align-self: stretch;
          box-sizing: border-box;
        }
        @media (max-width: 880px) {
          .bvr7-right-rail {
            flex-direction: row !important;
            flex-wrap: wrap;
            flex: 1 1 100% !important;
            max-width: none !important;
            min-width: 0 !important;
            width: 100%;
            justify-content: center;
            align-self: stretch !important;
            align-items: flex-start;
          }
          .bvr7-stage-rail {
            flex-direction: row !important;
            flex-wrap: wrap;
            flex: 1 1 100% !important;
            max-width: none !important;
            min-width: 0 !important;
            width: 100%;
            justify-content: center;
            align-self: stretch !important;
          }
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

      {/* Panel container — spans workspace (sidebar inset → right edge) */}
      <div style={{
        position: 'fixed',
        top: '50%',
        left: 'max(10px, var(--v15r-workspace-inset-left, 0px))',
        right: 'max(10px, env(safe-area-inset-right, 0px))',
        transform: 'translateY(-50%)',
        width: 'auto',
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
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              gap: 8,
            }}>
              <span>
                VR Source: {selectedSourceSet?.name || sourceBlueprint.name}
                {selectedSourceSet?.type ? ` · ${selectedSourceSet.type}` : ''}
              </span>
              <span
                style={{
                  padding: '1px 6px',
                  borderRadius: 3,
                  background: (scanResult.scanResultKind === 'measured-trace')
                    ? 'rgba(123,229,216,0.10)'
                    : 'rgba(255,179,71,0.10)',
                  border: (scanResult.scanResultKind === 'measured-trace')
                    ? '1px solid rgba(123,229,216,0.4)'
                    : '1px solid rgba(255,179,71,0.4)',
                  color: (scanResult.scanResultKind === 'measured-trace') ? '#9EF0E2' : '#FFD0A0',
                  fontSize: 9,
                  letterSpacing: 0.6,
                  textTransform: 'uppercase',
                }}
              >
                Scan: {scanResult.scanResultKind === 'measured-trace' ? 'Measured Trace' : 'Inferred'} ·{' '}
                {Math.round((scanResult.confidence || 0) * 100)}%
              </span>
              <span style={{ color: 'rgba(0,221,204,0.4)' }}>
                {visibleStages.length} stages · {totalItems} catalog items
              </span>
              {fromCache && (
                <span
                  style={{
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

          {/* Blueprint VR controls (source selector + scanner status + preview) */}
          <div style={{ padding: '14px 16px 0', display: 'flex', flexDirection: 'column', gap: 10 }}>

            {availableSets.length > 0 && (
              <BlueprintVRSourceSelector
                sets={availableSets}
                selectedSetId={selectedSourceSet?.id || null}
                userSelected={userPickedSource}
                scanAccuracy={scanAccuracy}
                scanConfidence={scanResult.confidence}
                scanSummary={scanSummary}
                onSelect={handleChangeSource}
                onRegenerate={handleRescan}
              />
            )}

            <div
              style={{
                border: '1px solid rgba(0,229,204,0.22)',
                borderRadius: 6,
                overflow: 'hidden',
                background: 'rgba(8,14,22,0.5)',
              }}
            >
              <button
                type="button"
                onClick={() => setScannerStatusExpanded((v) => !v)}
                style={{
                  width: '100%',
                  display: 'flex',
                  flexWrap: 'wrap' as const,
                  alignItems: 'center',
                  gap: 10,
                  padding: '10px 12px',
                  border: 'none',
                  background: 'rgba(0,229,204,0.06)',
                  cursor: 'pointer',
                  textAlign: 'left' as const,
                  fontFamily: 'monospace',
                }}
              >
                <span style={{ color: '#00ddcc', fontWeight: 700, letterSpacing: 0.8, fontSize: 10, textTransform: 'uppercase' as const }}>
                  Scanner Status
                </span>
                <span style={{ flex: '1 1 220px', color: 'rgba(220,230,240,0.88)', fontSize: 10, lineHeight: 1.45 }}>
                  {scannerStatusSummary}
                </span>
                <span style={{ color: 'rgba(255,255,255,0.45)', fontSize: 9.5, fontWeight: 700, letterSpacing: 0.6 }}>
                  {scannerStatusExpanded ? '▾ Hide details' : '▸ Show details'}
                </span>
              </button>
              {scannerStatusExpanded && (
                <div style={{ padding: '0 10px 10px' }}>
                  <ScanStatusBanner
                    scan={scanResult}
                    fullSetScan={fullSetScan}
                    fromCache={fromCache}
                    sourceLabel={selectedSourceSet?.name || sourceBlueprint.name}
                    sourceType={selectedSourceSet?.type}
                    traceRuntime={{
                      providerStatus: traceExtraction.providerStatus,
                      selectedPageNumber: traceExtraction.selectedPageNumber,
                      operatorListStatus: traceExtraction.operatorListStatus,
                      textContentStatus: traceExtraction.textContentStatus,
                      opsSource: traceExtraction.payload?.runtime?.opsSource,
                    }}
                    runtimeProviderDebug={{
                      requestedKey: traceExtraction.requestedKey,
                      registeredKeys: traceExtraction.registeredKeys,
                      matchReason: traceExtraction.matchReason,
                      matchedKey: traceExtraction.providerKey,
                      registrySize: traceExtraction.providerMetadata?.registrySize,
                      providerAgeSec: traceExtraction.providerMetadata?.providerAgeSec,
                      pdfDocReady: traceExtraction.providerMetadata?.pdfDocReady,
                      hasGetPage: traceExtraction.providerMetadata?.hasGetPage,
                      lastUnregisterReason: traceExtraction.providerMetadata?.lastUnregisterReason,
                    }}
                    cacheDebug={
                      cacheDebug || {
                        mode: fromCache ? 'hit' : 'miss',
                        key: sourceKey,
                        keyHash: sourceKey.slice(0, 8),
                        sourceIdentity: sourceCacheIdentity,
                        rescanCount,
                        scannedAt: lastScanAt || undefined,
                      }
                    }
                  />
                </div>
              )}
            </div>

            <div className="bvr7-preview-stage-row">
              <div className="bvr7-preview-column">
                <div className="bvr7-preview-shell">
                  {(viewMode === 'plan' || viewMode === 'walls') && (
                    <div
                      style={{
                        position: 'absolute',
                        bottom: 10,
                        left: 10,
                        zIndex: 12,
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: 4,
                        alignItems: 'center',
                        padding: '4px 6px',
                        borderRadius: 6,
                        background: 'rgba(6,12,20,0.88)',
                        border: '1px solid rgba(0,229,204,0.28)',
                        pointerEvents: 'auto',
                      }}
                    >
                      <button
                        type="button"
                        onClick={handlePlanZoomOut}
                        style={{ ...controlButtonStyle(false), padding: '4px 8px', minWidth: 32 }}
                        title="Zoom out"
                      >
                        −
                      </button>
                      <button
                        type="button"
                        onClick={handlePlanZoomIn}
                        style={{ ...controlButtonStyle(false), padding: '4px 8px', minWidth: 32 }}
                        title="Zoom in"
                      >
                        +
                      </button>
                      <button
                        type="button"
                        onClick={handlePlanZoomReset}
                        style={{
                          ...controlButtonStyle(
                            planZoomScale !== 1 || planPan.x !== 0 || planPan.y !== 0,
                          ),
                          padding: '4px 8px',
                        }}
                        title="Reset zoom to fit"
                      >
                        Reset
                      </button>
                      <span
                        style={{
                          fontSize: 9,
                          fontFamily: 'monospace',
                          color: 'rgba(255,255,255,0.45)',
                          padding: '0 2px',
                          minWidth: 36,
                          textAlign: 'center',
                        }}
                      >
                        {Math.round(planZoomScale * 100)}%
                      </span>
                    </div>
                  )}
                  <div
                    style={{
                      flex: 1,
                      width: '100%',
                      minHeight: 0,
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'stretch',
                      justifyContent: 'center',
                    }}
                  >
            {viewMode === 'walls' && (() => {
              const traceCount = Object.keys(fullSetPageTraces).length
              const providerMissing = traceExtraction.providerStatus === 'missing'
              const isFallback = buildingModel.metadata?.source === 'fallback'
              const rawLines = scanResult.traceDebugCounts?.rawLines ?? 0
              const wallCount = scanResult.walls?.length ?? 0
              const openingCount = scanResult.openings?.length ?? 0
              const phase = fullSetExtractionPhase
              const pagesEx = fullSetExtractionProgress.pagesExtracted
              const pagesTotal = fullSetExtractionProgress.pagesTotal

              const headerRow = (
                <div style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '8px 10px',
                  background: 'rgba(0,229,204,0.06)',
                  borderBottom: '1px solid rgba(0,229,204,0.18)',
                  fontFamily: 'monospace', fontSize: 10,
                }}>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                    <span style={{ color: '#00ddcc', fontWeight: 700, letterSpacing: 0.8 }}>
                      FULL-SET PROPOSED WALL LAYOUT
                    </span>
                    {phase === 'extracting' && (
                      <span style={{ color: '#FFD700' }}>
                        Scanning {pagesEx}/{pagesTotal} pages…
                      </span>
                    )}
                    {phase === 'done' && !isFallback && (
                      <span style={{ color: '#7BE5D8' }}>
                        {pagesEx} pages scanned · {wallCount} walls · {openingCount} openings
                      </span>
                    )}
                    {phase === 'done' && isFallback && (
                      <span style={{ color: '#FF9999' }}>
                        {providerMissing ? 'Provider not available' : `0 vectors from ${pagesEx} pages`}
                      </span>
                    )}
                  </div>
                  <button onClick={handleRescan} style={controlButtonStyle(false)}>Rescan</button>
                </div>
              )

              // Extracting — show progress screen
              if (phase === 'extracting') {
                return (
                  <div style={{ border: '1px solid rgba(0,229,204,0.2)', borderRadius: 6, overflow: 'hidden', width: '100%' }}>
                    {headerRow}
                    <div style={{
                      minHeight: WALLS_VIEW_PLACEHOLDER_MIN_H, flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
                      justifyContent: 'center', background: '#0d121b', gap: 12,
                    }}>
                      <div style={{ color: '#FFD700', fontFamily: 'monospace', fontSize: 13, fontWeight: 700 }}>
                        SCANNING FULL SET
                      </div>
                      <div style={{ color: 'rgba(255,220,120,0.75)', fontFamily: 'monospace', fontSize: 11 }}>
                        Page {pagesEx} / {pagesTotal} — extracting vector geometry from floor-plan sheets
                      </div>
                      <div style={{
                        width: 280, height: 6, background: 'rgba(255,255,255,0.08)', borderRadius: 3, overflow: 'hidden',
                      }}>
                        <div style={{
                          height: '100%',
                          width: `${pagesTotal > 0 ? (pagesEx / pagesTotal) * 100 : 0}%`,
                          background: '#FFD700', borderRadius: 3,
                          transition: 'width 0.3s ease-out',
                        }} />
                      </div>
                      <div style={{ color: 'rgba(255,220,120,0.5)', fontFamily: 'monospace', fontSize: 9.5 }}>
                        target pages: {fullSetExtractionProgress.targetPages.join(', ') || 'classifying…'}
                      </div>
                    </div>
                  </div>
                )
              }

              // Done — provider was missing (can't blame the PDF)
              if (phase === 'done' && providerMissing && traceCount === 0) {
                return (
                  <div style={{ border: '1px solid rgba(255,140,0,0.3)', borderRadius: 6, overflow: 'hidden', width: '100%' }}>
                    {headerRow}
                    <div style={{
                      minHeight: WALLS_VIEW_PLACEHOLDER_MIN_H, flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
                      justifyContent: 'center', background: '#0d121b', gap: 10, padding: 24,
                    }}>
                      <div style={{ color: '#FF9966', fontFamily: 'monospace', fontSize: 13, fontWeight: 700 }}>
                        PDF RUNTIME NOT AVAILABLE
                      </div>
                      <div style={{ color: 'rgba(255,200,160,0.8)', fontFamily: 'monospace', fontSize: 10.5, textAlign: 'center', maxWidth: 440 }}>
                        The Blueprint Viewer runtime was not registered when the scan ran.
                        Make sure the correct PDF is open in the Blueprint Viewer, then click Rescan.
                      </div>
                      <div style={{ color: 'rgba(200,210,220,0.5)', fontFamily: 'monospace', fontSize: 9.5, textAlign: 'center', maxWidth: 440 }}>
                        Requested key: {traceExtraction.requestedKey || 'n/a'}
                      </div>
                      <div style={{ color: 'rgba(200,210,220,0.5)', fontFamily: 'monospace', fontSize: 9.5, textAlign: 'center', maxWidth: 440 }}>
                        Registered keys: {traceExtraction.registeredKeys?.length ? traceExtraction.registeredKeys.join(' | ') : 'none'}
                      </div>
                      <button onClick={handleRescan} style={{ ...controlButtonStyle(false), marginTop: 12, fontSize: 11 }}>
                        Rescan
                      </button>
                    </div>
                  </div>
                )
              }

              // Done — provider available but no vectors (rasterized PDF)
              if (phase === 'done' && !providerMissing && traceCount === 0 && isFallback) {
                return (
                  <div style={{ border: '1px solid rgba(255,80,80,0.3)', borderRadius: 6, overflow: 'hidden', width: '100%' }}>
                    {headerRow}
                    <div style={{
                      minHeight: WALLS_VIEW_PLACEHOLDER_MIN_H, flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
                      justifyContent: 'center', background: '#0d121b', gap: 10, padding: 24,
                    }}>
                      <div style={{ color: '#FF6666', fontFamily: 'monospace', fontSize: 13, fontWeight: 700 }}>
                        FULL-SET WALL EXTRACTION FAILED
                      </div>
                      <div style={{ color: 'rgba(255,200,160,0.8)', fontFamily: 'monospace', fontSize: 10.5, textAlign: 'center', maxWidth: 440 }}>
                        {pagesEx} page{pagesEx !== 1 ? 's' : ''} scanned · {rawLines} raw vector lines found.
                        The PDF appears to be image-based (rasterized scan). No line geometry was extractable.
                      </div>
                      <div style={{ color: 'rgba(200,210,220,0.5)', fontFamily: 'monospace', fontSize: 9.5, textAlign: 'center', maxWidth: 440 }}>
                        To extract real wall geometry, provide a vector PDF, DWG, DXF, or IFC source file.
                        Rasterized PDFs require server-side OCR or image-processing preprocessing.
                      </div>
                    </div>
                  </div>
                )
              }

              // Still idle (extraction hasn't started yet)
              if (phase === 'idle') {
                return (
                  <div style={{ border: '1px solid rgba(0,229,204,0.15)', borderRadius: 6, overflow: 'hidden', width: '100%' }}>
                    {headerRow}
                    <div style={{
                      minHeight: WALLS_VIEW_PLACEHOLDER_MIN_H, flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
                      justifyContent: 'center', background: '#0d121b', gap: 8,
                    }}>
                      <div style={{ color: 'rgba(255,255,255,0.35)', fontFamily: 'monospace', fontSize: 11 }}>
                        Waiting for source set…
                      </div>
                    </div>
                  </div>
                )
              }

              // Done — real geometry extracted
              return (
                <div
                  style={{
                    position: 'relative',
                    flex: 1,
                    minHeight: 0,
                    width: '100%',
                    display: 'flex',
                    flexDirection: 'column',
                    border: '1px solid rgba(0,229,204,0.2)',
                    borderRadius: 6,
                    overflow: 'hidden',
                    background: '#0d121b',
                  }}
                >
                  <div
                    style={{
                      position: 'absolute',
                      top: 6,
                      left: 8,
                      right: 8,
                      zIndex: 8,
                      display: 'flex',
                      justifyContent: 'center',
                      pointerEvents: 'none',
                    }}
                  >
                    <div style={{ pointerEvents: 'auto', width: '100%', maxWidth: 920 }}>{headerRow}</div>
                  </div>
                  <BvrMeasuredPlanScrollHost
                    reserveTopPx={48}
                    zoom={planZoomScale}
                    pan={planPan}
                    planDragging={planDragging}
                    onWheelZoom={handlePlanWheelZoom}
                    onPanMouseDown={handlePlanPanMouseDown}
                  >
                    {(dims) => (
                      <MeasuredPlanViewer
                        model={buildingModel}
                        width={dims.w}
                        height={dims.h}
                        selectedRoomId={selectedRoomId}
                        onRoomSelect={handleRoomEnter}
                        showDimensions={showDimensions}
                        showRoomLabels={showLabels}
                        showAreaLabels={false}
                        showElectrical={false}
                        wallOnlyMode={true}
                        roomInteractionStyle="subtle"
                        traceDebug={scanResult.traceDebugCounts || null}
                      />
                    )}
                  </BvrMeasuredPlanScrollHost>
                </div>
              )
            })()}

            {viewMode === 'plan' && (
              <BvrMeasuredPlanScrollHost
                zoom={planZoomScale}
                pan={planPan}
                planDragging={planDragging}
                onWheelZoom={handlePlanWheelZoom}
                onPanMouseDown={handlePlanPanMouseDown}
              >
                {(dims) => (
                  <MeasuredPlanViewer
                    model={buildingModel}
                    width={dims.w}
                    height={dims.h}
                    selectedRoomId={selectedRoomId}
                    onRoomSelect={handleRoomEnter}
                    activeStage={activeStage}
                    showDimensions={showDimensions}
                    showRoomLabels={showLabels}
                    showAreaLabels={showLabels}
                    showElectrical={showElectrical}
                    roomInteractionStyle="subtle"
                    traceDebug={scanResult.traceDebugCounts || null}
                  />
                )}
              </BvrMeasuredPlanScrollHost>
            )}

            {viewMode === 'dollhouse' && (
              <div style={{ flex: 1, minHeight: 0, width: '100%', display: 'flex', flexDirection: 'column' }}>
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
              </div>
            )}

            {viewMode === 'room' && (
              <BvrRoomViewportFrame>
                <BlueprintRoomInteriorView
                  model={buildingModel}
                  selectedRoomId={selectedRoomId || firstRoomId}
                  activeStage={activeStage}
                  showElectrical={showElectrical}
                  showDimensions={showDimensions}
                  showLabels={showLabels}
                  wallOpacity={wallOpacity}
                />
              </BvrRoomViewportFrame>
            )}
                  </div>
                </div>
                {viewMode === 'room' && (
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
                )}
              </div>
              <aside className="bvr7-right-rail" aria-label="Blueprint VR view and stage controls">
                <div style={{ position: 'relative', width: '100%' }}>
                  <button
                    ref={viewMenuButtonRef}
                    type="button"
                    aria-haspopup="menu"
                    aria-expanded={viewMenuOpen}
                    onClick={() => {
                      setLabelsMenuOpen(false)
                      setWallTransparencyOpen(false)
                      setViewMenuOpen((o) => !o)
                    }}
                    style={{ ...controlButtonStyle(viewMenuOpen), width: '100%', boxSizing: 'border-box' }}
                  >
                    View
                  </button>
                  {viewMenuOpen && (
                    <div
                      ref={viewMenuRef}
                      role="menu"
                      style={{
                        position: 'absolute',
                        top: '100%',
                        right: 0,
                        left: 'auto',
                        marginTop: 6,
                        minWidth: 200,
                        padding: '6px 0',
                        background: 'rgba(6,12,20,0.98)',
                        border: '1px solid rgba(0,229,204,0.35)',
                        borderRadius: 6,
                        boxShadow: '0 12px 40px rgba(0,0,0,0.65)',
                        zIndex: 1001,
                      }}
                    >
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setViewMode('walls')
                          setCameraPreset('top')
                          setViewMenuOpen(false)
                          setLabelsMenuOpen(false)
                          setWallTransparencyOpen(false)
                        }}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: 12,
                          width: '100%',
                          padding: '8px 12px',
                          border: 'none',
                          background: viewMode === 'walls' ? 'rgba(0,221,204,0.12)' : 'transparent',
                          color: viewMode === 'walls' ? '#00ddcc' : 'rgba(255,255,255,0.75)',
                          cursor: 'pointer',
                          fontSize: 10,
                          fontFamily: 'monospace',
                          fontWeight: 700,
                          letterSpacing: 0.6,
                          textTransform: 'uppercase' as const,
                          textAlign: 'left' as const,
                        }}
                      >
                        <span>Proposed Walls</span>
                        {viewMode === 'walls' ? <span aria-hidden>✓</span> : <span style={{ opacity: 0.25 }}> </span>}
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setViewMode('plan')
                          setCameraPreset('top')
                          setViewMenuOpen(false)
                          setLabelsMenuOpen(false)
                          setWallTransparencyOpen(false)
                        }}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: 12,
                          width: '100%',
                          padding: '8px 12px',
                          border: 'none',
                          background: viewMode === 'plan' ? 'rgba(0,221,204,0.12)' : 'transparent',
                          color: viewMode === 'plan' ? '#00ddcc' : 'rgba(255,255,255,0.75)',
                          cursor: 'pointer',
                          fontSize: 10,
                          fontFamily: 'monospace',
                          fontWeight: 700,
                          letterSpacing: 0.6,
                          textTransform: 'uppercase' as const,
                          textAlign: 'left' as const,
                        }}
                      >
                        <span>2D Plan</span>
                        {viewMode === 'plan' ? <span aria-hidden>✓</span> : <span style={{ opacity: 0.25 }}> </span>}
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setViewMode('dollhouse')
                          setCameraPreset('iso')
                          setViewMenuOpen(false)
                          setLabelsMenuOpen(false)
                          setWallTransparencyOpen(false)
                        }}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: 12,
                          width: '100%',
                          padding: '8px 12px',
                          border: 'none',
                          background: viewMode === 'dollhouse' ? 'rgba(0,221,204,0.12)' : 'transparent',
                          color: viewMode === 'dollhouse' ? '#00ddcc' : 'rgba(255,255,255,0.75)',
                          cursor: 'pointer',
                          fontSize: 10,
                          fontFamily: 'monospace',
                          fontWeight: 700,
                          letterSpacing: 0.6,
                          textTransform: 'uppercase' as const,
                          textAlign: 'left' as const,
                        }}
                      >
                        <span>3D Dollhouse</span>
                        {viewMode === 'dollhouse' ? <span aria-hidden>✓</span> : <span style={{ opacity: 0.25 }}> </span>}
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        disabled={!selectedRoomId && !firstRoomId}
                        onClick={() => {
                          setViewMode('room')
                          setCameraPreset('room')
                          if (!selectedRoomId) setSelectedRoomId(firstRoomId)
                          setViewMenuOpen(false)
                          setLabelsMenuOpen(false)
                          setWallTransparencyOpen(false)
                        }}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: 12,
                          width: '100%',
                          padding: '8px 12px',
                          border: 'none',
                          background: viewMode === 'room' ? 'rgba(0,221,204,0.12)' : 'transparent',
                          color:
                            !selectedRoomId && !firstRoomId
                              ? 'rgba(255,255,255,0.25)'
                              : viewMode === 'room'
                                ? '#00ddcc'
                                : 'rgba(255,255,255,0.75)',
                          cursor: !selectedRoomId && !firstRoomId ? 'not-allowed' : 'pointer',
                          fontSize: 10,
                          fontFamily: 'monospace',
                          fontWeight: 700,
                          letterSpacing: 0.6,
                          textTransform: 'uppercase' as const,
                          textAlign: 'left' as const,
                          opacity: !selectedRoomId && !firstRoomId ? 0.45 : 1,
                        }}
                      >
                        <span>Room View</span>
                        {viewMode === 'room' ? <span aria-hidden>✓</span> : <span style={{ opacity: 0.25 }}> </span>}
                      </button>
                      <div style={{ height: 1, margin: '4px 8px', background: 'rgba(0,229,204,0.12)' }} />
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          handleResetView()
                          setViewMenuOpen(false)
                          setLabelsMenuOpen(false)
                          setWallTransparencyOpen(false)
                        }}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: 12,
                          width: '100%',
                          padding: '8px 12px',
                          border: 'none',
                          background: 'transparent',
                          color: 'rgba(255,255,255,0.75)',
                          cursor: 'pointer',
                          fontSize: 10,
                          fontFamily: 'monospace',
                          fontWeight: 700,
                          letterSpacing: 0.6,
                          textTransform: 'uppercase' as const,
                          textAlign: 'left' as const,
                        }}
                      >
                        <span>Reset View</span>
                      </button>
                    </div>
                  )}
                </div>

                <div style={{ position: 'relative', width: '100%' }}>
                  <button
                    ref={labelsMenuButtonRef}
                    type="button"
                    aria-haspopup="menu"
                    aria-expanded={labelsMenuOpen}
                    onClick={() => {
                      setViewMenuOpen(false)
                      setWallTransparencyOpen(false)
                      setLabelsMenuOpen((o) => !o)
                    }}
                    style={{ ...controlButtonStyle(labelsMenuOpen), width: '100%', boxSizing: 'border-box' }}
                  >
                    Labels
                  </button>
                  {labelsMenuOpen && (
                    <div
                      ref={labelsMenuRef}
                      role="menu"
                      style={{
                        position: 'absolute',
                        top: '100%',
                        right: 0,
                        left: 'auto',
                        marginTop: 6,
                        minWidth: 220,
                        padding: '6px 0',
                        background: 'rgba(6,12,20,0.98)',
                        border: '1px solid rgba(0,229,204,0.35)',
                        borderRadius: 6,
                        boxShadow: '0 12px 40px rgba(0,0,0,0.65)',
                        zIndex: 1001,
                      }}
                    >
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setShowDimensions((v) => !v)
                          setLabelsMenuOpen(false)
                        }}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: 12,
                          width: '100%',
                          padding: '8px 12px',
                          border: 'none',
                          background: showDimensions ? 'rgba(0,221,204,0.12)' : 'transparent',
                          color: showDimensions ? '#00ddcc' : 'rgba(255,255,255,0.75)',
                          cursor: 'pointer',
                          fontSize: 10,
                          fontFamily: 'monospace',
                          fontWeight: 700,
                          letterSpacing: 0.6,
                          textTransform: 'uppercase' as const,
                          textAlign: 'left' as const,
                        }}
                      >
                        <span>Show Dimensions</span>
                        {showDimensions ? <span aria-hidden>✓</span> : <span style={{ opacity: 0.25 }}> </span>}
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setShowElectrical((v) => !v)
                          setLabelsMenuOpen(false)
                        }}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: 12,
                          width: '100%',
                          padding: '8px 12px',
                          border: 'none',
                          background: showElectrical ? 'rgba(0,221,204,0.12)' : 'transparent',
                          color: showElectrical ? '#00ddcc' : 'rgba(255,255,255,0.75)',
                          cursor: 'pointer',
                          fontSize: 10,
                          fontFamily: 'monospace',
                          fontWeight: 700,
                          letterSpacing: 0.6,
                          textTransform: 'uppercase' as const,
                          textAlign: 'left' as const,
                        }}
                      >
                        <span>Show Electrical</span>
                        {showElectrical ? <span aria-hidden>✓</span> : <span style={{ opacity: 0.25 }}> </span>}
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setShowLabels((v) => !v)
                          setLabelsMenuOpen(false)
                        }}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: 12,
                          width: '100%',
                          padding: '8px 12px',
                          border: 'none',
                          background: showLabels ? 'rgba(0,221,204,0.12)' : 'transparent',
                          color: showLabels ? '#00ddcc' : 'rgba(255,255,255,0.75)',
                          cursor: 'pointer',
                          fontSize: 10,
                          fontFamily: 'monospace',
                          fontWeight: 700,
                          letterSpacing: 0.6,
                          textTransform: 'uppercase' as const,
                          textAlign: 'left' as const,
                        }}
                      >
                        <span>Show Labels</span>
                        {showLabels ? <span aria-hidden>✓</span> : <span style={{ opacity: 0.25 }}> </span>}
                      </button>
                    </div>
                  )}
                </div>

                <StageStageRail
                  stages={visibleStages}
                  selectedStage={activeStage}
                  onSelectStage={setActiveStage}
                />

                <div style={{ position: 'relative', width: '100%', marginTop: 'auto' }}>
                  <button
                    ref={wallTransparencyButtonRef}
                    type="button"
                    aria-expanded={wallTransparencyOpen}
                    onClick={() => {
                      setViewMenuOpen(false)
                      setLabelsMenuOpen(false)
                      setWallTransparencyOpen((o) => !o)
                    }}
                    style={{
                      ...controlButtonStyle(wallTransparencyOpen),
                      width: '100%',
                      boxSizing: 'border-box',
                      whiteSpace: 'normal',
                      lineHeight: 1.15,
                      padding: '6px 6px',
                    }}
                  >
                    Wall Transparency
                  </button>
                  {wallTransparencyOpen && (
                    <div
                      ref={wallTransparencyPopoverRef}
                      style={{
                        position: 'absolute',
                        bottom: '100%',
                        right: 0,
                        left: 'auto',
                        marginBottom: 6,
                        width: 228,
                        padding: '10px 10px 12px',
                        background: 'rgba(6,12,20,0.98)',
                        border: '1px solid rgba(0,229,204,0.35)',
                        borderRadius: 6,
                        boxShadow: '0 12px 40px rgba(0,0,0,0.65)',
                        zIndex: 1002,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 10,
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                        <span style={smallLabelStyle}>Wall Transparency</span>
                        <span style={{ ...smallLabelStyle, color: '#00ddcc' }}>{Math.round(wallOpacity * 100)}%</span>
                      </div>
                      <input
                        type="range"
                        min={35}
                        max={95}
                        value={Math.round(wallOpacity * 100)}
                        onChange={(e) => setWallOpacity(Number(e.target.value) / 100)}
                        style={{ width: '100%' }}
                      />
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, justifyContent: 'center' }}>
                        <button type="button" onClick={() => setCameraPreset('top')} style={controlButtonStyle(cameraPreset === 'top')}>
                          Top
                        </button>
                        <button type="button" onClick={() => setCameraPreset('iso')} style={controlButtonStyle(cameraPreset === 'iso')}>
                          Iso
                        </button>
                        <button type="button" onClick={() => setCameraPreset('room')} style={controlButtonStyle(cameraPreset === 'room')}>
                          Room
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </aside>
            </div>
          </div>

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
