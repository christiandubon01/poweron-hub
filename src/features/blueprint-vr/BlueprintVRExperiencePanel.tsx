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
import type { SourceScanAccuracy } from './BlueprintVRSourceSelector'
import type { BlueprintBuildingModel } from './buildingModel'
import {
  scanBlueprintPlan,
  convertPlanScanToBuildingModel,
  scanBlueprintFullSet,
  mergeFullSetScanIntoBuildingModel,
  chooseBestFloorPlanSheet,
} from './blueprintPlanScanner'
import type {
  BlueprintPlanScanResult,
  BlueprintVRSourceSet,
  BlueprintFullSetScanResult,
  BlueprintActivePageScanSnapshot,
} from './blueprintPlanScanner'
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
  /** Serializable active-page scan snapshot from the Blueprint PDF viewer. */
  activePageScanSnapshot?: BlueprintActivePageScanSnapshot | null
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
  fromCache,
  sourceLabel,
  sourceType,
  traceRuntime,
  runtimeProviderDebug,
  cacheDebug,
  plan2DScan,
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
  plan2DScan?: BlueprintPlanScanResult
}) {
  const top = scan.warnings.slice(0, 5)
  const plan2DSourceMode = plan2DScan?.plan2DSourceMode || scan.plan2DSourceMode
  const traceRejectionReason = plan2DScan?.traceRejectionReason || scan.traceRejectionReason
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
      {plan2DSourceMode && (
        <div style={{ opacity: 0.78, fontSize: 9.4, lineHeight: 1.45, color: 'rgba(255,216,160,0.95)' }}>
          Primary 2D source: {plan2DSourceMode === 'ap01-calibrated-model' ? 'AP-01 calibrated model' : 'Direct PDF trace'}
        </div>
      )}
      {traceRejectionReason && plan2DSourceMode === 'ap01-calibrated-model' && (
        <div style={{ opacity: 0.78, fontSize: 9.4, lineHeight: 1.45, color: 'rgba(255,200,145,0.95)' }}>
          Direct PDF trace available but rejected for primary plan: {traceRejectionReason}
        </div>
      )}
      {plan2DSourceMode === 'ap01-calibrated-model' && (
        <div style={{ opacity: 0.78, fontSize: 9.4, lineHeight: 1.45, color: 'rgba(255,216,160,0.95)' }}>
          Using AP-01 calibrated model.
        </div>
      )}
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
  activePageScanSnapshot = null,
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

  const runtimeIdentityKey = [
    runtimeSourceIdentity?.projectId || '',
    runtimeSourceIdentity?.blueprintId || '',
    runtimeSourceIdentity?.sourceSetId || '',
    runtimeSourceIdentity?.sourceSetName || '',
    runtimeSourceIdentity?.fileName || '',
    runtimeSourceIdentity?.pageCount || '',
    runtimeSourceIdentity?.currentPageNumber || '',
  ].join('|')

  useEffect(() => {
    let disposed = false
    if (!selectedSourceSet) {
      setTraceExtraction({
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
      return
    }
    const best = chooseBestFloorPlanSheet(selectedSourceSet.sheets || [])
    const bestSourceSheet = best
      ? selectedSourceSet.sheets.find((s) => s.pageNumber === best.pageNumber) || null
      : null
    if (!best || !bestSourceSheet) {
      setTraceExtraction({
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
        warnings: [{ code: 'NO_FLOOR_PLAN_SHEET', message: 'No canonical floor-plan sheet selected for trace extraction.' }],
      })
      return
    }
    const runtimeRequestIdentity = {
      projectId: runtimeSourceIdentity?.projectId || selectedSourceSet.projectId || projectId,
      blueprintId: runtimeSourceIdentity?.blueprintId || selectedSourceSet.id || sourceBlueprint.id,
      sourceSetId: runtimeSourceIdentity?.sourceSetId || selectedSourceSet.id,
      sourceSetName: runtimeSourceIdentity?.sourceSetName || selectedSourceSet.name,
      fileName: runtimeSourceIdentity?.fileName || selectedSourceSet.filePath || bestSourceSheet.fileName,
      pageCount: runtimeSourceIdentity?.pageCount || selectedSourceSet.totalPages,
    }
    const requestedRuntimeKey = buildBlueprintPdfRuntimeKey(runtimeRequestIdentity)
    setLastScanAt(new Date().toISOString())
    setTraceExtraction((prev) => ({
      ...prev,
      attempted: false,
      requestedKey: requestedRuntimeKey,
      registeredKeys: prev.registeredKeys || [],
      matchReason: prev.matchReason,
      providerMetadata: prev.providerMetadata,
      selectedPageNumber: best.pageNumber,
    }))
    void (async () => {
      const traceArgs = {
        ...runtimeRequestIdentity,
        pageNumber: best.pageNumber,
        sheetNumber: best.sheetNumber,
        sheetTitle: best.sheetTitle,
        existingPayload: bestSourceSheet.tracePayload || null,
      }
      let runtimeTrace = await extractTraceForBlueprintSheet(traceArgs)
      if (!disposed && runtimeTrace.providerStatus === 'missing') {
        await new Promise<void>((r) => setTimeout(r, 150))
        if (disposed) return
        runtimeTrace = await extractTraceForBlueprintSheet(traceArgs)
      }
      if (!disposed && runtimeTrace.providerStatus === 'missing') {
        await new Promise<void>((r) => setTimeout(r, 300))
        if (disposed) return
        runtimeTrace = await extractTraceForBlueprintSheet(traceArgs)
      }
      if (disposed) return
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
    const cached = rescanToken === 0
      ? getCachedProjectModel(sourceCacheIdentity)
      : undefined
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

    const sourceSetForScan = selectedSourceSet
      ? {
          ...selectedSourceSet,
          sheets: selectedSourceSet.sheets.map((sheet) =>
            traceExtraction.selectedPageNumber &&
            sheet.pageNumber === traceExtraction.selectedPageNumber
              ? {
                  ...sheet,
                  tracePayload: traceExtraction.payload,
                  traceAttempted: traceExtraction.attempted,
                  traceWarnings: traceExtraction.warnings,
                }
              : sheet,
          ),
        }
      : null

    if (sourceSetForScan) {
      fullScan = scanBlueprintFullSet({
        projectName: projectNameForCache,
        sourceSet: sourceSetForScan,
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
  }, [cacheKeyParts, traceExtraction, sourceCacheIdentity, rescanCount])

  const plan2DScan = useMemo<BlueprintPlanScanResult>(() => {
    const sheetIndex = (selectedSourceSet?.sheets || []).map((sheet) => ({
      pageNumber: sheet.pageNumber,
      sheetNumber: sheet.sheetNumber,
      sheetTitle: sheet.sheetTitle,
      sheetLabel: sheet.sheetLabel,
      discipline: sheet.discipline,
    }))
    return scanBlueprintPlan({
      projectName: projectNameForCache,
      blueprintTitle: selectedSourceSet?.name || sourceBlueprint.name,
      fileName: selectedSourceSet?.filePath || sourceBlueprint.filePath,
      activePageNumber:
        traceExtraction.selectedPageNumber ||
        activePageScanSnapshot?.currentPageNumber ||
        runtimeSourceIdentity?.currentPageNumber,
      totalPages: selectedSourceSet?.totalPages || runtimeSourceIdentity?.pageCount,
      extractedText: job.outputManifest?.metadata?.description,
      sheetIndex,
      pageSnapshot: activePageScanSnapshot,
      tracePayload: traceExtraction.payload,
      traceAttempted: traceExtraction.attempted,
      traceWarnings: [
        ...traceExtraction.warnings,
        ...((activePageScanSnapshot?.extractionWarnings || []).map((warning) => ({
          code: warning.code,
          message: warning.message,
        }))),
      ],
    })
  }, [
    activePageScanSnapshot,
    job.outputManifest?.metadata?.description,
    projectNameForCache,
    rescanToken,
    runtimeSourceIdentity?.currentPageNumber,
    runtimeSourceIdentity?.pageCount,
    selectedSourceSet,
    sourceBlueprint.filePath,
    sourceBlueprint.name,
    traceExtraction,
  ])

  const plan2DBuildingModel = useMemo(
    () => convertPlanScanToBuildingModel(plan2DScan),
    [plan2DScan],
  )

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
                userSelected={userPickedSource}
                scanAccuracy={scanAccuracy}
                scanConfidence={scanResult.confidence}
                scanSummary={scanSummary}
                onSelect={handleChangeSource}
                onRegenerate={handleRescan}
              />
            )}

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
              plan2DScan={plan2DScan}
            />

            {viewMode === 'plan' && (
              <MeasuredPlanViewer
                model={plan2DBuildingModel}
                width={760}
                height={430}
                selectedRoomId={selectedRoomId}
                onRoomSelect={handleRoomEnter}
                activeStage={activeStage}
                showDimensions={showDimensions}
                showRoomLabels={showLabels}
                showAreaLabels={showLabels}
                showElectrical={showElectrical}
                plan2DSourceMode={plan2DScan.plan2DSourceMode}
                calibratedSourceNote={plan2DScan.calibratedSourceNote}
                traceDebug={plan2DScan.traceDebugCounts || null}
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
