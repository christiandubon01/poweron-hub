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
import MeasuredPlanViewer, { MeasuredPlanViewerBadgeHud } from './MeasuredPlanViewer'
import BlueprintRoomInteriorView from './BlueprintRoomInteriorView'
import BlueprintVRSourceSelector from './BlueprintVRSourceSelector'
import type { SourceScanAccuracy } from './BlueprintVRSourceSelector'
import type { BlueprintBuildingModel } from './buildingModel'
import {
  scanBlueprintPlan,
  convertPlanScanToBuildingModel,
  buildScanResultFromVisionExtraction,
  enumerateFullSourceSetSheets,
} from './blueprintPlanScanner'
import type {
  BlueprintPlanScanResult,
  BlueprintVRSourceSet,
  BlueprintFullSetScanResult,
} from './blueprintPlanScanner'
import { buildBlueprintPdfRuntimeKey } from './blueprintPdfTraceRuntimeBridge'
import type {
  BlueprintPdfRuntimeLookup,
  PdfRuntimeProviderMatchTier,
} from './blueprintPdfTraceRuntimeBridge'
import {
  classifyAllPagesBatched,
  hashFile,
  loadPdfArrayBuffer,
  openPdfDocument,
  rasterizePdfPageToBase64,
  callExtract,
  type VisionPageClassification,
} from './blueprintVisionClient'
import {
  type BlueprintVRCacheIdentity,
  buildBlueprintVRCacheIdentityKey,
  clearCachedProjectModel,
} from './blueprintVRProjectModelCache'
import { useBlueprintVisionPipeline } from './useBlueprintVisionPipeline'

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

/** Larger square-style chrome actions (Change Source / Rescan / header Rescan). */
function vrSquareChromeButtonStyle(): React.CSSProperties {
  return {
    minHeight: 42,
    minWidth: 44,
    padding: '0 16px',
    boxSizing: 'border-box',
    borderRadius: 6,
    border: '1px solid rgba(0,221,204,0.35)',
    background: 'rgba(0,221,204,0.08)',
    color: 'rgba(245,250,255,0.92)',
    cursor: 'pointer',
    fontSize: 11,
    fontFamily: 'monospace',
    fontWeight: 800,
    letterSpacing: 0.65,
    textTransform: 'uppercase' as const,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    lineHeight: 1.1,
    transition: 'background 0.12s ease, border-color 0.12s ease, color 0.12s ease, box-shadow 0.12s ease',
    boxShadow: '0 0 0 0 transparent',
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
/** Pixels of movement before a primary-button drag is treated as pan (room clicks use short drags). */
const PLAN_PAN_DRAG_THRESHOLD_PX = 5

type PlanPanPointerSession =
  | { mode: 'pending'; startX: number; startY: number; originPanX: number; originPanY: number }
  | {
      mode: 'active'
      anchorX: number
      anchorY: number
      originPanX: number
      originPanY: number
      moved: boolean
    }

// ── Subcomponent: 2D plan viewport (same pixel footprint as dollhouse) ─────

interface BvrMeasuredPlanScrollHostProps {
  zoom: number
  pan: { x: number; y: number }
  planDragging: boolean
  onWheelZoom: (e: WheelEvent) => void
  onPanMouseDown: (e: React.MouseEvent<HTMLDivElement>) => void
  /** Swallow room clicks after a pan gesture (capture phase, same pattern as PDF viewer suppression). */
  onPlanClickCapture?: (e: React.MouseEvent<HTMLDivElement>) => void
  /** Extra top inset so floating chrome (e.g. Proposed Walls header) does not cover the plan. */
  reserveTopPx?: number
  /** Rendered above the plan, outside the zoom/pan transform (viewport-fixed HUD). */
  viewportBadgeHud?: React.ReactNode
  children: (dims: { w: number; h: number }) => React.ReactNode
}

function BvrMeasuredPlanScrollHost({
  zoom,
  pan,
  planDragging,
  onWheelZoom,
  onPanMouseDown,
  onPlanClickCapture,
  reserveTopPx = 0,
  viewportBadgeHud,
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
      // Match Blueprint PDF viewer: own the wheel over the plan so the modal/page
      // does not scroll; wheel zoom uses non-passive preventDefault.
      onWheelZoom(e)
    }
    el.addEventListener('wheel', fn, { passive: false })
    return () => el.removeEventListener('wheel', fn)
  }, [onWheelZoom, dims])

  const pannable =
    zoom !== 1 || Math.abs(pan.x) > 0.5 || Math.abs(pan.y) > 0.5

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
          onClickCapture={onPlanClickCapture}
          onContextMenu={(e) => {
            if (e.button === 1) e.preventDefault()
          }}
          title="Scroll wheel: zoom in/out. Click-drag to pan when zoomed. Shift+drag or middle mouse also pans."
          style={{
            width: dims.w,
            height: dims.h,
            position: 'relative',
            overflow: 'hidden',
            flexShrink: 0,
            cursor: planDragging ? 'grabbing' : pannable ? 'grab' : 'default',
            touchAction: 'none',
            userSelect: 'none' as const,
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
              pointerEvents: planDragging ? 'none' : 'auto',
            }}
          >
            {children(dims)}
          </div>
          {viewportBadgeHud ? (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                pointerEvents: 'none',
                zIndex: 6,
              }}
            >
              {viewportBadgeHud}
            </div>
          ) : null}
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
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <span style={{
          color: 'rgba(255,255,255,0.96)',
          fontSize: 13,
          fontFamily: 'monospace',
          fontWeight: 800,
          letterSpacing: 1.1,
          textTransform: 'uppercase' as const,
          lineHeight: 1.25,
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
        marginTop: 10,
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

function pickDefinedTrimmedString(...candidates: Array<string | undefined | null>): string | undefined {
  for (const c of candidates) {
    const s = String(c ?? '').trim()
    if (s) return s
  }
  return undefined
}

function pickPositiveIntPageCount(...candidates: Array<number | undefined | null>): number | undefined {
  for (const c of candidates) {
    const n = Math.floor(Number(c))
    if (Number.isFinite(n) && n > 0) return n
  }
  return undefined
}

/** UI-facing scan kind: never shows measured/canonical when geometry is fallback-derived. */
function effectiveScanDisplayKind(scan: BlueprintPlanScanResult): 'fallback' | 'inferred' | 'cached-inferred' | 'measured-trace' {
  if (scan.isFallback || scan.scanResultKind === 'fallback') return 'fallback'
  const k = scan.scanResultKind
  if (k === 'measured-trace') return 'measured-trace'
  if (k === 'cached-inferred') return 'cached-inferred'
  if (k === 'inferred') return 'inferred'
  return 'fallback'
}

// ── Subcomponent: Scan Status Banner ─────────────────────────────────

function ScanStatusBanner({
  scan,
  fullSetScan,
  fromCache,
  sourceLabel,
  sourceType,
  viewerCurrentPage,
  traceRuntime,
  runtimeProviderDebug,
  cacheDebug,
  engineDebug,
}: {
  scan: BlueprintPlanScanResult
  fullSetScan?: BlueprintFullSetScanResult
  fromCache?: boolean
  sourceLabel?: string
  sourceType?: string
  viewerCurrentPage?: number | null
  traceRuntime?: {
    providerStatus: 'available' | 'partial' | 'missing' | 'error'
    providerMatchTier?: PdfRuntimeProviderMatchTier
    providerRequestedKey?: string
    providerMatchedKey?: string
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
    matchTier?: PdfRuntimeProviderMatchTier
    registrySize?: number
    providerAgeSec?: number
    pdfDocReady?: boolean
    hasGetPage?: boolean
    lastUnregisterReason?: string
  }
  cacheDebug?: {
    mode: 'hit' | 'miss' | 'bypass'
    key: string
    keyHash: string
    sourceIdentity: BlueprintVRCacheIdentity
    rescanCount: number
    scannedAt?: string
  }
  engineDebug?: {
    extractionPhase: 'idle' | 'extracting' | 'done'
    targetPages: number[]
    pageRangeLabel?: string
    totalPagesScanned?: number
    providerMatchTier: PdfRuntimeProviderMatchTier | 'unknown'
    cacheMode: 'hit' | 'miss' | 'bypass'
    fallbackUsed: boolean
    traceUsable: boolean
    confidencePct: number
    blockerSummary: string
  }
}) {
  const top = scan.warnings.slice(0, 5)
  const displayKind = effectiveScanDisplayKind(scan)
  const resultKind = displayKind
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
  const debug = (scan.traceDebugCounts || null) as Record<string, unknown> | null
  const confidenceCapReason = String(
    debug?.confidenceCapReason ||
      confidenceBreakdown?.confidenceCapReason ||
      confidenceBreakdown?.reasons?.vectorTraceAvailable ||
      'No cap reason recorded.',
  )

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
      <div style={{ opacity: 0.78, fontSize: 9.2, lineHeight: 1.45, color: 'rgba(200,235,255,0.92)' }}>
        Engine: phase {engineDebug?.extractionPhase ?? 'n/a'} · pages{' '}
        {engineDebug?.pageRangeLabel ||
          (engineDebug?.targetPages?.length
            ? engineDebug.targetPages.length > 18
              ? `${engineDebug.targetPages[0]}…${engineDebug.targetPages[engineDebug.targetPages.length - 1]} (${engineDebug.targetPages.length})`
              : `[${engineDebug.targetPages.join(', ')}]`
            : '—')}{' '}
        · scanned {engineDebug?.totalPagesScanned ?? '—'} · provider tier {engineDebug?.providerMatchTier ?? 'unknown'}{' '}
        · cache {engineDebug?.cacheMode ?? cacheDebug?.mode ?? 'n/a'} · fallback {engineDebug?.fallbackUsed ? 'yes' : 'no'} · trace usable{' '}
        {engineDebug?.traceUsable ? 'yes' : 'no'} · confidence {engineDebug?.confidencePct ?? Math.round((scan.confidence || 0) * 100)}% · blockers:{' '}
        {engineDebug?.blockerSummary || 'none'}
      </div>
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
          : 'Not selected (missing eligible wall-plan source page after full-set classification)'}
      </div>

      {fullSetScan && fullSetScan.pageClassifications.length > 0 && (
        <div style={{ opacity: 0.74, fontSize: 9.1, lineHeight: 1.45, color: 'rgba(185,235,225,0.95)' }}>
          W1B · pages scanned {fullSetScan.totalPagesScanned}
          {fullSetScan.canonicalSelectionAmbiguous ? ' · canonical ambiguous' : ''} · sel. conf.{' '}
          {Math.round((fullSetScan.canonicalSelectionConfidence || 0) * 100)}% · roles (non-zero):{' '}
          {Object.entries(fullSetScan.pageRoleCounts || {})
            .filter(([, n]) => n > 0)
            .map(([k, n]) => `${k.replace(/_/g, ' ')}=${n}`)
            .join(' · ') || '—'}
        </div>
      )}
      {fullSetScan && fullSetScan.rankedWallPlanCandidates.length > 0 && (
        <div style={{ opacity: 0.72, fontSize: 9, lineHeight: 1.4, color: 'rgba(175,225,245,0.92)' }}>
          Top wall-source:{' '}
          {fullSetScan.rankedWallPlanCandidates
            .slice(0, 5)
            .map((r) => `p${r.pageNumber} ${r.role} (#${r.rank})`)
            .join(' · ')}
        </div>
      )}
      {fullSetScan && fullSetScan.canonicalWallPlanPages.length > 0 && (
        <div style={{ opacity: 0.72, fontSize: 9, lineHeight: 1.4, color: 'rgba(160,240,220,0.95)' }}>
          Canonical wall source:{' '}
          {fullSetScan.canonicalWallPlanPages.map((c) => `p${c.pageNumber} (${c.role})`).join(' · ')}
        </div>
      )}
      {(fullSetScan?.classificationWarnings?.length || fullSetScan?.classificationBlockers?.length) ? (
        <div style={{ opacity: 0.7, fontSize: 8.8, lineHeight: 1.4, color: 'rgba(255,205,160,0.92)' }}>
          {fullSetScan?.classificationBlockers?.length ? `Blockers: ${fullSetScan.classificationBlockers.join('; ')}. ` : ''}
          {fullSetScan?.classificationWarnings?.length ? `Warnings: ${fullSetScan.classificationWarnings.join('; ')}` : ''}
        </div>
      ) : null}

      {sheetCounts && (
        <div style={{ opacity: 0.7, fontSize: 9.5, lineHeight: 1.45 }}>
          Roles: floor plan {sheetCounts.floorPlan} · electrical/power {sheetCounts.electricalPower} · rendering {sheetCounts.rendering} · interior elevation {sheetCounts.interiorElevation} · finish/material {sheetCounts.finishMaterial} · schedule {sheetCounts.schedule} · unknown {sheetCounts.unknown}
        </div>
      )}

      <div style={{ opacity: 0.7, fontSize: 9.5, lineHeight: 1.45 }}>
        Trace: {traceStatus} · Scale: {scaleStatus} · Geometry: walls {scan.walls.length}, openings {scan.openings.length}, rooms {scan.rooms.length}
      </div>
      <div style={{ opacity: 0.72, fontSize: 9.1, lineHeight: 1.45, color: 'rgba(180,225,240,0.9)' }}>
        Runtime provider: {String(traceRuntime?.providerStatus || 'missing')}
        {traceRuntime?.providerMatchTier ? ` (${String(traceRuntime.providerMatchTier)})` : ''}{' '}
        · Selected trace page: {traceRuntime?.selectedPageNumber || selectedFloorPlan?.pageNumber || 'n/a'}
        {viewerCurrentPage != null && Number.isFinite(viewerCurrentPage) ? (
          <>
            {' '}
            · Open viewer page: {viewerCurrentPage}
          </>
        ) : null}
      </div>
      {(traceRuntime?.providerMatchTier === 'partial' ||
        runtimeProviderDebug?.matchTier === 'partial' ||
        traceRuntime?.providerStatus === 'partial') && (
        <div
          style={{
            marginTop: 2,
            padding: '6px 8px',
            borderRadius: 4,
            background: 'rgba(255,153,102,0.12)',
            border: '1px solid rgba(255,153,102,0.42)',
            color: '#FFBB88',
            fontSize: 9.5,
            lineHeight: 1.45,
            fontWeight: 700,
          }}
        >
          Partial PDF runtime match — verify the open PDF matches this source set.
        </div>
      )}
      <div style={{ opacity: 0.72, fontSize: 9.1, lineHeight: 1.45, color: 'rgba(180,225,240,0.9)' }}>
        Operator list: {String(traceRuntime?.operatorListStatus || debug?.operatorListStatus || 'unknown')} · Text content: {String(traceRuntime?.textContentStatus || debug?.textContentStatus || 'unknown')}
      </div>
      <div style={{ opacity: 0.72, fontSize: 9.1, lineHeight: 1.45, color: 'rgba(180,225,240,0.9)' }}>
        Raw lines {Number(debug?.rawLines ?? 0)} · Rooms {Number(debug?.roomCandidates ?? scan.rooms.length)} · Walls {Number(debug?.mergedWalls ?? scan.walls.length)}
      </div>
      <div style={{ opacity: 0.72, fontSize: 9.1, lineHeight: 1.45, color: 'rgba(180,225,240,0.9)' }}>
        Wall candidates {Number(debug?.mergedWalls ?? scan.walls.length)} · Room candidates {Number(debug?.roomCandidates ?? scan.rooms.length)}
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
      {runtimeProviderDebug?.requestedKey && (
        <div style={{ opacity: 0.72, fontSize: 9.1, lineHeight: 1.45, color: 'rgba(255,210,160,0.95)' }}>
          Provider match tier: {runtimeProviderDebug.matchTier ?? 'pending'}
        </div>
      )}
      {runtimeProviderDebug?.matchReason && (
        <div style={{ opacity: 0.68, fontSize: 8.8, lineHeight: 1.4, color: 'rgba(255,190,145,0.92)' }}>
          Provider match reason: {runtimeProviderDebug.matchReason}
        </div>
      )}
      {(traceRuntime?.providerMatchedKey || runtimeProviderDebug?.matchedKey) && (
        <div style={{ opacity: 0.68, fontSize: 8.8, lineHeight: 1.4, color: 'rgba(170,230,210,0.92)' }}>
          Matched provider key: {traceRuntime?.providerMatchedKey || runtimeProviderDebug?.matchedKey}
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

function BvrSelectFloorPlanPlaceholder({ message }: { message: string }) {
  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        width: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px 24px',
        boxSizing: 'border-box',
      }}
    >
      <div
        style={{
          maxWidth: 420,
          padding: '14px 16px',
          borderRadius: 8,
          background: 'rgba(10,18,28,0.92)',
          border: '1px solid rgba(0,229,204,0.35)',
          textAlign: 'center',
          fontFamily: 'monospace',
          fontSize: 11,
          lineHeight: 1.55,
          color: 'rgba(232,240,255,0.92)',
        }}
      >
        <div style={{ fontWeight: 700, color: '#00ddcc' }}>{message}</div>
        <div style={{ color: 'rgba(232,240,255,0.78)' }}></div>
      </div>
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
  const [viewMode, setViewMode] = useState<'plan' | 'dollhouse' | 'room' | 'walls'>('walls')
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
  const roomEntryModalRef = useRef<HTMLDivElement>(null)
  const [roomEntryConfirm, setRoomEntryConfirm] = useState<{ roomId: string; label: string } | null>(null)
  const [planZoomScale, setPlanZoomScale] = useState(1)
  const [planPan, setPlanPan] = useState({ x: 0, y: 0 })
  const [planDragging, setPlanDragging] = useState(false)
  const planPanSessionRef = useRef<PlanPanPointerSession | null>(null)
  const planPanRef = useRef(planPan)
  const planPanWindowCleanupRef = useRef<null | (() => void)>(null)
  const roomClickSuppressRef = useRef(false)
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

  useEffect(() => {
    setSelectedSourceSetId(autoPickedSetId)
  }, [autoPickedSetId])

  useEffect(() => {
    if (!availableSets.length) return
    if (selectedSourceSetId != null && !availableSets.some((s) => s.id === selectedSourceSetId)) {
      setSelectedSourceSetId(autoPickedSetId ?? availableSets[0]?.id ?? null)
    }
  }, [availableSets, selectedSourceSetId, autoPickedSetId])

  const selectedSourceSet = useMemo<BlueprintVRSourceSet | null>(() => {
    if (!availableSets.length) return null
    return availableSets.find((s) => s.id === selectedSourceSetId) || availableSets[0]
  }, [availableSets, selectedSourceSetId])

  const scannerVersion = 'VISION-1'

  const enumeratedPageCount = useMemo(
    () => (selectedSourceSet ? enumerateFullSourceSetSheets(selectedSourceSet).length : null),
    [selectedSourceSet],
  )

  const providerLookupIdentity = useMemo((): BlueprintPdfRuntimeLookup => {
    const r = runtimeSourceIdentity
    return {
      projectId: pickDefinedTrimmedString(r?.projectId, selectedSourceSet?.projectId, projectId),
      blueprintId: pickDefinedTrimmedString(r?.blueprintId, selectedSourceSet?.id, sourceBlueprint.id),
      sourceSetId: pickDefinedTrimmedString(r?.sourceSetId, selectedSourceSet?.id, sourceBlueprint.id),
      sourceSetName: pickDefinedTrimmedString(r?.sourceSetName, selectedSourceSet?.name, sourceBlueprint.name),
      fileName: pickDefinedTrimmedString(r?.fileName, selectedSourceSet?.filePath, sourceBlueprint.filePath),
      pageCount: pickPositiveIntPageCount(
        r?.pageCount,
        selectedSourceSet?.totalPages,
        enumeratedPageCount ?? undefined,
      ),
    }
  }, [
    runtimeSourceIdentity?.projectId,
    runtimeSourceIdentity?.blueprintId,
    runtimeSourceIdentity?.sourceSetId,
    runtimeSourceIdentity?.sourceSetName,
    runtimeSourceIdentity?.fileName,
    runtimeSourceIdentity?.pageCount,
    selectedSourceSet?.id,
    selectedSourceSet?.projectId,
    selectedSourceSet?.name,
    selectedSourceSet?.filePath,
    selectedSourceSet?.totalPages,
    projectId,
    sourceBlueprint.id,
    sourceBlueprint.name,
    sourceBlueprint.filePath,
    enumeratedPageCount,
  ])

  const providerLookupKey = useMemo(
    () => buildBlueprintPdfRuntimeKey(providerLookupIdentity),
    [providerLookupIdentity],
  )

  const projectNameForCache =
    projectNameProp || selectedSourceSet?.projectName || job.outputManifest?.projectName || sourceBlueprint.name

  const baseSourceCacheIdentity = useMemo<BlueprintVRCacheIdentity>(
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
      selectedFloorPlanPage: null,
      pageCount:
        enumeratedPageCount ??
        selectedSourceSet?.totalPages ??
        runtimeSourceIdentity?.pageCount ??
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
      enumeratedPageCount,
      scannerVersion,
    ],
  )

  const visionPipeline = useBlueprintVisionPipeline({
    selectedSourceSet,
    projectName: projectNameForCache,
    sourceCacheIdentity: baseSourceCacheIdentity,
    rescanToken,
  })

  const sourceCacheIdentity = useMemo<BlueprintVRCacheIdentity>(
    () => ({
      ...baseSourceCacheIdentity,
      selectedFloorPlanPage: visionPipeline.selectedFloorPlanPage,
    }),
    [baseSourceCacheIdentity, visionPipeline.selectedFloorPlanPage],
  )

  const sourceKey = buildBlueprintVRCacheIdentityKey(sourceCacheIdentity)
  const userPickedSource = !!initialSourceSetId


  // ── Cached model lookup. Recomputes only when key / rescan token changes ──
  const cacheKeyParts = `${sourceKey}::${rescanToken}`

  const {
    scanResult,
    buildingModel,
    fromCache,
    cacheDebug,
    selectedFloorPlanPage,
    pageClassifications,
    isClassifying,
    isExtracting,
    classifyProgress,
    visionError,
    sheetPickerOpen,
    setSheetPickerOpen,
    selectFloorPlanPage,
    clearSessionModelCache,
    enumeratedSheets,
    hasVisionGeometry,
  } = visionPipeline

  const canRender3D = hasVisionGeometry

  useEffect(() => {
    if (!canRender3D && (viewMode === 'dollhouse' || viewMode === 'room')) {
      setViewMode('walls')
    }
  }, [canRender3D, viewMode])

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
    clearSessionModelCache()
    setLastScanAt(new Date().toISOString())
    setRescanCount((n) => n + 1)
    setRescanToken((t) => t + 1)
  }, [clearSessionModelCache])

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
    // the user out of 3D.
    setCameraPreset((prev) => (prev === 'top' ? 'room' : prev === 'room' ? 'room' : 'room'))
    setViewMode((prev) => {
      if (!canRender3D) return 'walls'
      if (prev === 'plan') return 'room'
      if (prev === 'room') return 'room'
      return 'dollhouse'
    })
  }, [canRender3D])

  const handleRoomEnter = useCallback((roomId: string) => {
    if (effectiveScanDisplayKind(scanResult) !== 'measured-trace') {
      setViewMode('walls')
      return
    }
    setSelectedRoomId(roomId)
    setViewMode('room')
    setCameraPreset('room')
  }, [scanResult])

  const handlePlanRoomEntryIntent = useCallback((roomId: string) => {
    if (effectiveScanDisplayKind(scanResult) !== 'measured-trace') return
    const room = buildingModel.levels.flatMap((l) => l.rooms).find((r) => r.id === roomId)
    const label = room?.label?.trim() || 'This room'
    setRoomEntryConfirm({ roomId, label })
  }, [buildingModel, scanResult])

  const handleResetView = useCallback(() => {
    setViewMode(canRender3D ? 'dollhouse' : 'walls')
    setSelectedRoomId(firstRoomId)
    setCameraPreset('iso')
    setWallOpacity(0.82)
  }, [firstRoomId, canRender3D])

  useEffect(() => {
    setPlanZoomScale(1)
    setPlanPan({ x: 0, y: 0 })
  }, [viewMode])

  useEffect(() => {
    setRoomEntryConfirm(null)
  }, [viewMode])

  useEffect(() => {
    planPanRef.current = planPan
  }, [planPan])

  useEffect(() => {
    return () => {
      planPanWindowCleanupRef.current?.()
      planPanWindowCleanupRef.current = null
    }
  }, [])

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
    if (!roomEntryConfirm) return
    const onDocMouseDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (roomEntryModalRef.current?.contains(t)) return
      setRoomEntryConfirm(null)
    }
    document.addEventListener('mousedown', onDocMouseDown)
    return () => document.removeEventListener('mousedown', onDocMouseDown)
  }, [roomEntryConfirm])

  useEffect(() => {
    if (!viewMenuOpen && !labelsMenuOpen && !wallTransparencyOpen && !roomEntryConfirm) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (roomEntryConfirm) {
          setRoomEntryConfirm(null)
          return
        }
        setViewMenuOpen(false)
        setLabelsMenuOpen(false)
        setWallTransparencyOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [viewMenuOpen, labelsMenuOpen, wallTransparencyOpen, roomEntryConfirm])

  const scannerRuntimeProviderDebug = useMemo(
    () => ({
      requestedKey: providerLookupKey,
      registeredKeys: [] as string[],
      matchReason: 'Vision pipeline',
      matchedKey: undefined,
      matchTier: undefined as PdfRuntimeProviderMatchTier | undefined,
      registrySize: 0,
    }),
    [providerLookupKey],
  )

  // Compute honest scan accuracy classification for the source selector.
  const scanAccuracy: SourceScanAccuracy = useMemo(() => {
    const kind = effectiveScanDisplayKind(scanResult)
    if (kind === 'measured-trace') return fromCache ? 'cached-measured' : 'measured'
    if (kind === 'fallback') return 'fallback'
    return fromCache ? 'cached-inferred' : 'inferred'
  }, [fromCache, scanResult])

  const scanSummary = useMemo(() => {
    const w = Math.round(scanResult.footprint.width)
    const d = Math.round(scanResult.footprint.height)
    const rooms = scanResult.rooms.length
    return `${scanResult.layoutContext.replace(/-/g, ' ')} · ${w}'-0" W × ${d}'-0" D · ${rooms} rooms`
  }, [scanResult])

  const scannerEngineDebug = useMemo(
    (): {
      extractionPhase: 'idle' | 'extracting' | 'done'
      targetPages: number[]
      pageRangeLabel?: string
      totalPagesScanned?: number
      providerMatchTier: 'unknown'
      cacheMode: 'hit' | 'miss' | 'bypass'
      fallbackUsed: boolean
      traceUsable: boolean
      confidencePct: number
      blockerSummary: string
    } => ({
      extractionPhase: (isClassifying || isExtracting ? 'extracting' : 'done') as 'idle' | 'extracting' | 'done',
      targetPages: [],
      pageRangeLabel: '',
      totalPagesScanned: enumeratedPageCount ?? undefined,
      providerMatchTier: 'unknown' as const,
      cacheMode: cacheDebug.mode,
      fallbackUsed: effectiveScanDisplayKind(scanResult) === 'fallback',
      traceUsable:
        Boolean(scanResult.traceAvailable) &&
        !scanResult.isFallback &&
        (scanResult.traceLines?.length ?? 0) > 0,
      confidencePct: Math.round((scanResult.confidence || 0) * 100),
      blockerSummary:
        scanResult.warnings
          .slice(0, 3)
          .map((w) => w.code)
          .join(', ') || 'none',
    }),
    [isClassifying, isExtracting, enumeratedPageCount, scanResult, cacheDebug.mode],
  )

  useEffect(() => {
    if (typeof console === 'undefined' || !console.info) return
    console.info('[BlueprintVR][cache]', cacheDebug.mode, {
      keyHash: cacheDebug.keyHash,
      extractionPhase: isClassifying ? 'extracting' : isExtracting ? 'extracting' : 'done',
      fromCache,
    })
    console.info('[BlueprintVR][vision]', {
      page: selectedFloorPlanPage,
      classifying: isClassifying,
      extracting: isExtracting,
    })
  }, [cacheDebug.mode, cacheDebug.keyHash, isClassifying, isExtracting, fromCache, selectedFloorPlanPage])

  const scannerStatusSummary = useMemo(() => {
    const scan = scanResult
    const resultKind = effectiveScanDisplayKind(scan)
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

  const headerScanKind = useMemo(() => effectiveScanDisplayKind(scanResult), [scanResult])

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
    e.preventDefault()
    e.stopPropagation()
    const el = e.currentTarget as HTMLElement
    const rect = el.getBoundingClientRect()
    const px = e.clientX - rect.left
    const py = e.clientY - rect.top
    const cx = rect.width / 2
    const cy = rect.height / 2
    const factor = e.deltaY < 0 ? 1.08 : 0.93
    setPlanZoomScale((prevZ) => {
      const nextZ =
        Math.round(Math.min(PLAN_ZOOM_MAX, Math.max(PLAN_ZOOM_MIN, prevZ * factor)) * 100) / 100
      if (Math.abs(nextZ - prevZ) < 0.00001) return prevZ
      setPlanPan((prevPan) => ({
        x: prevPan.x + (px - cx) * (1 - nextZ / prevZ),
        y: prevPan.y + (py - cy) * (1 - nextZ / prevZ),
      }))
      return nextZ
    })
  }, [])

  const handlePlanClickCapture = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!roomClickSuppressRef.current) return
    roomClickSuppressRef.current = false
    e.stopPropagation()
  }, [])

  const handlePlanPanMouseDown = useCallback(
    (ev: React.MouseEvent<HTMLDivElement>) => {
      planPanWindowCleanupRef.current?.()
      planPanWindowCleanupRef.current = null

      if (ev.button === 1) ev.preventDefault()

      const ox = planPanRef.current.x
      const oy = planPanRef.current.y

      const armWindowPan = () => {
        const onMove = (e: MouseEvent) => {
          const s = planPanSessionRef.current
          if (!s) return
          if (s.mode === 'pending') {
            if (Math.hypot(e.clientX - s.startX, e.clientY - s.startY) < PLAN_PAN_DRAG_THRESHOLD_PX) return
            const nextPan = {
              x: s.originPanX + (e.clientX - s.startX),
              y: s.originPanY + (e.clientY - s.startY),
            }
            planPanSessionRef.current = {
              mode: 'active',
              anchorX: s.startX,
              anchorY: s.startY,
              originPanX: s.originPanX,
              originPanY: s.originPanY,
              moved: true,
            }
            planPanRef.current = nextPan
            setPlanPan(nextPan)
            setPlanDragging(true)
            return
          }
          const a = planPanSessionRef.current
          if (!a || a.mode !== 'active') return
          const nextPan = {
            x: a.originPanX + (e.clientX - a.anchorX),
            y: a.originPanY + (e.clientY - a.anchorY),
          }
          if (
            !a.moved &&
            (Math.abs(nextPan.x - planPanRef.current.x) > 1.5 ||
              Math.abs(nextPan.y - planPanRef.current.y) > 1.5)
          ) {
            a.moved = true
          }
          planPanRef.current = nextPan
          setPlanPan(nextPan)
        }
        const onUp = () => {
          const s = planPanSessionRef.current
          if (s?.mode === 'active' && s.moved) {
            roomClickSuppressRef.current = true
          }
          planPanSessionRef.current = null
          setPlanDragging(false)
          planPanWindowCleanupRef.current?.()
          planPanWindowCleanupRef.current = null
        }
        window.addEventListener('mousemove', onMove)
        window.addEventListener('mouseup', onUp)
        planPanWindowCleanupRef.current = () => {
          window.removeEventListener('mousemove', onMove)
          window.removeEventListener('mouseup', onUp)
        }
      }

      if (ev.button === 1 || (ev.button === 0 && ev.shiftKey)) {
        planPanSessionRef.current = {
          mode: 'active',
          anchorX: ev.clientX,
          anchorY: ev.clientY,
          originPanX: ox,
          originPanY: oy,
          moved: false,
        }
        setPlanDragging(true)
        armWindowPan()
        return
      }

      if (ev.button !== 0) return

      const canPrimary =
        planZoomScale !== 1 ||
        Math.abs(planPan.x) > 0.5 ||
        Math.abs(planPan.y) > 0.5
      if (!canPrimary) return

      planPanSessionRef.current = {
        mode: 'pending',
        startX: ev.clientX,
        startY: ev.clientY,
        originPanX: ox,
        originPanY: oy,
      }
      armWindowPan()
    },
    [planZoomScale, planPan.x, planPan.y],
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
                  background: headerScanKind === 'measured-trace'
                    ? 'rgba(123,229,216,0.10)'
                    : 'rgba(255,179,71,0.10)',
                  border: headerScanKind === 'measured-trace'
                    ? '1px solid rgba(123,229,216,0.4)'
                    : '1px solid rgba(255,179,71,0.4)',
                  color: headerScanKind === 'measured-trace' ? '#9EF0E2' : '#FFD0A0',
                  fontSize: 9,
                  letterSpacing: 0.6,
                  textTransform: 'uppercase',
                }}
              >
                Scan:{' '}
                {headerScanKind === 'measured-trace'
                  ? 'Measured Trace'
                  : headerScanKind === 'fallback'
                    ? 'Fallback layout'
                    : headerScanKind === 'cached-inferred'
                      ? 'Cached inferred'
                      : 'Inferred'}{' '}
                · {Math.round((scanResult.confidence || 0) * 100)}%
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

            {availableSets.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                {isClassifying && (
                  <span style={{ fontFamily: 'monospace', fontSize: 10, color: '#FFD700' }}>
                    Classifying sheets… {classifyProgress.done}/{classifyProgress.total}
                  </span>
                )}
                {isExtracting && (
                  <span style={{ fontFamily: 'monospace', fontSize: 10, color: '#FFD700' }}>
                    Extracting geometry…
                  </span>
                )}
                {!isClassifying && !isExtracting && (
                  <button
                    type="button"
                    onClick={() => setSheetPickerOpen(true)}
                    disabled={pageClassifications.length === 0}
                    style={vrSquareChromeButtonStyle()}
                  >
                    Select Floor Plan Sheet
                  </button>
                )}
              </div>
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

                    fromCache={fromCache}
                    sourceLabel={selectedSourceSet?.name || sourceBlueprint.name}
                    sourceType={selectedSourceSet?.type}
                    viewerCurrentPage={runtimeSourceIdentity?.currentPageNumber ?? null}
                    traceRuntime={{
                      providerStatus: 'missing',
                      selectedPageNumber: selectedFloorPlanPage,
                      operatorListStatus: 'unknown',
                      textContentStatus: 'unknown',
                    }}
                    runtimeProviderDebug={scannerRuntimeProviderDebug}
                    engineDebug={scannerEngineDebug}
                    cacheDebug={cacheDebug}
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
                        style={{ ...controlButtonStyle(false), padding: '8px 12px', minWidth: 40, minHeight: 40 }}
                        title="Zoom out"
                      >
                        −
                      </button>
                      <button
                        type="button"
                        onClick={handlePlanZoomIn}
                        style={{ ...controlButtonStyle(false), padding: '8px 12px', minWidth: 40, minHeight: 40 }}
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
                          padding: '8px 10px',
                          minHeight: 40,
                          minWidth: 72,
                          fontSize: 9,
                          lineHeight: 1.15,
                        }}
                        title="Reset zoom to fit and center"
                      >
                        Reset Zoom
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
            {viewMode === 'walls' && (
              !hasVisionGeometry ? (
                <div style={{ border: '1px solid rgba(0,229,204,0.2)', borderRadius: 6, overflow: 'hidden', width: '100%' }}>
                  <div style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '8px 10px',
                    background: 'rgba(0,229,204,0.06)',
                    borderBottom: '1px solid rgba(0,229,204,0.18)',
                    fontFamily: 'monospace', fontSize: 10,
                  }}>
                    <span style={{ color: '#00ddcc', fontWeight: 700 }}>FLOOR PLAN GEOMETRY</span>
                    <div style={{ display: 'flex', gap: 8 }}>
                      {isClassifying && (
                        <span style={{ color: '#FFD700' }}>
                          Classifying sheets… {classifyProgress.done}/{classifyProgress.total}
                        </span>
                      )}
                      {isExtracting && <span style={{ color: '#FFD700' }}>Extracting geometry…</span>}
                      {!isClassifying && !isExtracting && (
                        <button type="button" onClick={() => setSheetPickerOpen(true)} style={vrSquareChromeButtonStyle()}>
                          Select Floor Plan Sheet
                        </button>
                      )}
                      <button type="button" onClick={handleRescan} style={vrSquareChromeButtonStyle()}>Rescan</button>
                    </div>
                  </div>
                  <BvrSelectFloorPlanPlaceholder message={
                    isClassifying
                      ? 'Classifying sheets…'
                      : isExtracting
                        ? 'Extracting geometry…'
                        : 'Select a floor plan sheet to begin.'
                  } />
                  {visionError && (
                    <div style={{ padding: 8, color: '#ff8888', fontFamily: 'monospace', fontSize: 10 }}>{visionError}</div>
                  )}
                </div>
              ) : (
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
                  <div style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '8px 10px',
                    background: 'rgba(0,229,204,0.06)',
                    borderBottom: '1px solid rgba(0,229,204,0.18)',
                    fontFamily: 'monospace', fontSize: 10,
                  }}>
                    <span style={{ color: '#00ddcc', fontWeight: 700 }}>
                      VISION FLOOR PLAN · Pg {selectedFloorPlanPage}
                    </span>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button type="button" onClick={() => setSheetPickerOpen(true)} style={vrSquareChromeButtonStyle()}>
                        Select Floor Plan Sheet
                      </button>
                      <button type="button" onClick={handleRescan} style={vrSquareChromeButtonStyle()}>
                        Rescan
                      </button>
                    </div>
                  </div>
                  <BvrMeasuredPlanScrollHost
                    reserveTopPx={48}
                    zoom={planZoomScale}
                    pan={planPan}
                    planDragging={planDragging}
                    onWheelZoom={handlePlanWheelZoom}
                    onPanMouseDown={handlePlanPanMouseDown}
                    onPlanClickCapture={handlePlanClickCapture}
                    viewportBadgeHud={
                      <MeasuredPlanViewerBadgeHud
                        model={buildingModel}
                        wallOnlyMode
                        traceDebug={scanResult.traceDebugCounts || null}
                      />
                    }
                  >
                    {(dims) => (
                      <MeasuredPlanViewer
                        model={buildingModel}
                        width={dims.w}
                        height={dims.h}
                        selectedRoomId={selectedRoomId}
                        onPlanRoomEntryIntent={handlePlanRoomEntryIntent}
                        showDimensions={showDimensions}
                        showRoomLabels={showLabels}
                        showAreaLabels={false}
                        showElectrical={false}
                        wallOnlyMode={true}
                        activeStage={activeStage}
                        roomInteractionStyle="subtle"
                        traceDebug={scanResult.traceDebugCounts || null}
                        renderBadgesInTransformedLayer={false}
                      />
                    )}
                  </BvrMeasuredPlanScrollHost>
                </div>
              ))}

            {viewMode === 'plan' && !hasVisionGeometry && (
              <BvrSelectFloorPlanPlaceholder message="Select a floor plan sheet to begin." />
            )}
            {viewMode === 'plan' && hasVisionGeometry && (
              <BvrMeasuredPlanScrollHost
                zoom={planZoomScale}
                pan={planPan}
                planDragging={planDragging}
                onWheelZoom={handlePlanWheelZoom}
                onPanMouseDown={handlePlanPanMouseDown}
                onPlanClickCapture={handlePlanClickCapture}
                viewportBadgeHud={
                  <MeasuredPlanViewerBadgeHud
                    model={buildingModel}
                    wallOnlyMode={false}
                    traceDebug={scanResult.traceDebugCounts || null}
                  />
                }
              >
                {(dims) => (
                  <MeasuredPlanViewer
                    model={buildingModel}
                    width={dims.w}
                    height={dims.h}
                    selectedRoomId={selectedRoomId}
                    onPlanRoomEntryIntent={handlePlanRoomEntryIntent}
                    activeStage={activeStage}
                    showDimensions={showDimensions}
                    showRoomLabels={showLabels}
                    showAreaLabels={showLabels}
                    showElectrical={showElectrical}
                    roomInteractionStyle="subtle"
                    traceDebug={scanResult.traceDebugCounts || null}
                    renderBadgesInTransformedLayer={false}
                  />
                )}
              </BvrMeasuredPlanScrollHost>
            )}

            {roomEntryConfirm && (
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  zIndex: 1500,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: 'rgba(2,6,12,0.48)',
                }}
                onMouseDown={(e) => {
                  if (e.target === e.currentTarget) setRoomEntryConfirm(null)
                }}
              >
                <div
                  ref={roomEntryModalRef}
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="bvr-room-entry-title"
                  onMouseDown={(e) => e.stopPropagation()}
                  style={{
                    minWidth: 268,
                    maxWidth: 340,
                    padding: '16px 18px',
                    borderRadius: 8,
                    background: 'rgba(10,18,28,0.98)',
                    border: '1px solid rgba(0,229,204,0.38)',
                    boxShadow: '0 16px 48px rgba(0,0,0,0.75)',
                  }}
                >
                  <div
                    id="bvr-room-entry-title"
                    style={{
                      fontFamily: 'monospace',
                      fontSize: 12,
                      color: 'rgba(232,240,255,0.95)',
                      marginBottom: 4,
                      lineHeight: 1.45,
                    }}
                  >
                    Open Room View for{' '}
                    <span style={{ color: '#00ddcc', fontWeight: 700 }}>&quot;{roomEntryConfirm.label}&quot;</span>?
                  </div>
                  <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      onClick={() => setRoomEntryConfirm(null)}
                      style={{ ...controlButtonStyle(false), padding: '8px 14px', fontSize: 11 }}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        handleRoomEnter(roomEntryConfirm.roomId)
                        setRoomEntryConfirm(null)
                      }}
                      style={{ ...controlButtonStyle(true), padding: '8px 14px', fontSize: 11 }}
                    >
                      Take me there
                    </button>
                  </div>
                </div>
              </div>
            )}

            {viewMode === 'dollhouse' && (
              <div style={{ flex: 1, minHeight: 0, width: '100%', display: 'flex', flexDirection: 'column' }}>
                {canRender3D ? (
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
                ) : (
                  <BvrSelectFloorPlanPlaceholder message="Select a floor plan sheet to begin." />
                )}
              </div>
            )}

            {viewMode === 'room' && (
              <div style={{ flex: 1, minHeight: 0, width: '100%', display: 'flex', flexDirection: 'column' }}>
                {canRender3D ? (
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
                ) : (
                  <BvrSelectFloorPlanPlaceholder message="Select a floor plan sheet to begin." />
                )}
              </div>
            )}
                  </div>
                </div>
                {viewMode === 'room' && canRender3D && (
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
                        disabled={!canRender3D}
                        onClick={() => {
                          if (!canRender3D) return
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
                          cursor: !canRender3D ? 'not-allowed' : 'pointer',
                          fontSize: 10,
                          fontFamily: 'monospace',
                          fontWeight: 700,
                          letterSpacing: 0.6,
                          textTransform: 'uppercase' as const,
                          textAlign: 'left' as const,
                          opacity: !canRender3D ? 0.45 : 1,
                        }}
                      >
                        <span>3D Dollhouse</span>
                        {viewMode === 'dollhouse' ? <span aria-hidden>✓</span> : <span style={{ opacity: 0.25 }}> </span>}
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        disabled={!canRender3D || (!selectedRoomId && !firstRoomId)}
                        onClick={() => {
                          if (!canRender3D) return
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
                            (!canRender3D || (!selectedRoomId && !firstRoomId))
                              ? 'rgba(255,255,255,0.25)'
                              : viewMode === 'room'
                                ? '#00ddcc'
                                : 'rgba(255,255,255,0.75)',
                          cursor: !canRender3D || (!selectedRoomId && !firstRoomId) ? 'not-allowed' : 'pointer',
                          fontSize: 10,
                          fontFamily: 'monospace',
                          fontWeight: 700,
                          letterSpacing: 0.6,
                          textTransform: 'uppercase' as const,
                          textAlign: 'left' as const,
                          opacity: !canRender3D || (!selectedRoomId && !firstRoomId) ? 0.45 : 1,
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
    {sheetPickerOpen && (
      <div
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 2000,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'rgba(2,6,12,0.72)',
        }}
        onMouseDown={() => setSheetPickerOpen(false)}
      >
        <div
          role="dialog"
          aria-modal="true"
          onMouseDown={(e) => e.stopPropagation()}
          style={{
            width: 'min(720px, 92vw)',
            maxHeight: '80vh',
            overflow: 'auto',
            background: 'rgba(10,18,28,0.98)',
            border: '1px solid rgba(0,229,204,0.4)',
            borderRadius: 8,
            padding: 16,
            fontFamily: 'monospace',
            fontSize: 11,
          }}
        >
          <div style={{ color: '#00ddcc', fontWeight: 700, marginBottom: 12, letterSpacing: 0.8 }}>
            SELECT FLOOR PLAN SHEET
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ color: 'rgba(200,220,240,0.7)', textAlign: 'left' }}>
                <th style={{ padding: '6px 8px' }}>Pg</th>
                <th style={{ padding: '6px 8px' }}>Sheet #</th>
                <th style={{ padding: '6px 8px' }}>Title</th>
                <th style={{ padding: '6px 8px' }}>Role</th>
                <th style={{ padding: '6px 8px' }}>Conf</th>
              </tr>
            </thead>
            <tbody>
              {enumeratedSheets.map((sheet: import('./blueprintPlanScanner').BlueprintVRSourceSheet) => {
                const cls = pageClassifications.find((c: import('./blueprintVisionClient').VisionPageClassification) => c.pageNumber === sheet.pageNumber)
                return (
                  <tr
                    key={sheet.pageNumber}
                    onClick={() => void selectFloorPlanPage(sheet.pageNumber)}
                    style={{
                      cursor: isExtracting ? 'wait' : 'pointer',
                      borderTop: '1px solid rgba(255,255,255,0.06)',
                      background:
                        selectedFloorPlanPage === sheet.pageNumber
                          ? 'rgba(0,229,204,0.12)'
                          : 'transparent',
                    }}
                  >
                    <td style={{ padding: '8px' }}>{sheet.pageNumber}</td>
                    <td style={{ padding: '8px' }}>{sheet.sheetNumber || '—'}</td>
                    <td style={{ padding: '8px' }}>{sheet.sheetTitle || sheet.sheetLabel || '—'}</td>
                    <td style={{ padding: '8px' }}>{cls?.role || '—'}</td>
                    <td style={{ padding: '8px' }}>
                      {cls ? `${Math.round(cls.confidence * 100)}%` : '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    )}

    </>
  )
}
