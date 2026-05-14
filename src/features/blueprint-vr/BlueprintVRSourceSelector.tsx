/**
 * src/features/blueprint-vr/BlueprintVRSourceSelector.tsx
 *
 * Lightweight selector for the project-level "VR Source Set" used by the
 * Generate VR experience. The user can:
 *  - See which blueprint set is currently driving the VR render.
 *  - Change to another set (e.g. "Full Set" instead of an "Electrical Only" set).
 *  - Confirm the inferred source when no explicit choice has been made.
 *
 * Stateless / controlled — the selected id and onChange come from the parent
 * panel which owns the project-level cache key.
 */

import React, { useMemo, useState, useCallback } from 'react'
import type { BlueprintVRSourceSet } from './blueprintPlanScanner'

/**
 * Honest scan-accuracy classifications. The selector never claims an
 * "exact scan" — that signal must come from a real vector / OCR pipeline.
 * Until that lands, the panel passes one of:
 *  - 'inferred'           — context-derived deterministic layout
 *  - 'measured'           — refined from real trace data
 *  - 'cached-inferred'    — inferred but loaded from project cache
 *  - 'cached-measured'    — measured + cached
 *  - 'fallback'           — generic fallback layout (no project context)
 */
export type SourceScanAccuracy =
  | 'inferred'
  | 'measured'
  | 'cached-inferred'
  | 'cached-measured'
  | 'fallback'

export interface BlueprintVRSourceSelectorProps {
  sets: BlueprintVRSourceSet[]
  selectedSetId: string | null
  /**
   * Whether the user has explicitly chosen this source set. When `false`,
   * the panel notes the source as auto-picked. This is independent of the
   * scan result accuracy.
   */
  userSelected?: boolean
  /** Scan accuracy classification for the current model. */
  scanAccuracy?: SourceScanAccuracy
  /** Overall confidence (0–1) reported by the scanner. */
  scanConfidence?: number
  /** Optional short scan summary line (e.g. "salon tenant suite · 7 rooms"). */
  scanSummary?: string
  onSelect: (setId: string) => void
  onRegenerate?: () => void
  compact?: boolean
}

function scanAccuracyLabel(acc: SourceScanAccuracy): string {
  switch (acc) {
    case 'measured':
      return 'Measured trace'
    case 'cached-measured':
      return 'Cached measured model'
    case 'inferred':
      return 'Inferred model'
    case 'cached-inferred':
      return 'Cached inferred model'
    case 'fallback':
    default:
      return 'Deterministic fallback'
  }
}

function scanAccuracyAccent(acc: SourceScanAccuracy): string {
  if (acc === 'measured' || acc === 'cached-measured') return '#7be5d8'
  if (acc === 'fallback') return '#FF9966'
  return '#FFB347'
}

function setTypeLabel(set: BlueprintVRSourceSet): string {
  if (!set.type) return 'Set'
  return set.type
}

function setSubtitle(set: BlueprintVRSourceSet): string {
  const sheets = set.sheets?.length || 0
  if (sheets > 0) {
    return `${sheets} sheet${sheets === 1 ? '' : 's'} · ${setTypeLabel(set)}`
  }
  if (set.totalPages && set.totalPages > 0) {
    return `${set.totalPages} pages · ${setTypeLabel(set)}`
  }
  return setTypeLabel(set)
}

export default function BlueprintVRSourceSelector({
  sets,
  selectedSetId,
  userSelected = false,
  scanAccuracy = 'inferred',
  scanConfidence,
  scanSummary,
  onSelect,
  onRegenerate,
  compact = false,
}: BlueprintVRSourceSelectorProps) {
  const [expanded, setExpanded] = useState(false)
  const selected = useMemo(
    () => sets.find((s) => s.id === selectedSetId) || sets[0] || null,
    [sets, selectedSetId],
  )

  const handleToggle = useCallback(() => setExpanded((v) => !v), [])
  const handlePick = useCallback(
    (id: string) => {
      onSelect(id)
      setExpanded(false)
    },
    [onSelect],
  )

  const fullSetCandidate = useMemo(
    () =>
      sets.find((s) => (s.type || '').toLowerCase().includes('full set')) ||
      null,
    [sets],
  )

  const accent = '#7be5d8'
  const accentSoft = 'rgba(123,229,216,0.18)'
  const accentBorder = 'rgba(123,229,216,0.32)'
  const scanTone = scanAccuracyAccent(scanAccuracy)
  const scanLabel = scanAccuracyLabel(scanAccuracy)
  const confidencePct =
    typeof scanConfidence === 'number'
      ? `${Math.round(Math.max(0, Math.min(1, scanConfidence)) * 100)}%`
      : null

  if (!selected || sets.length === 0) {
    return (
      <div
        style={{
          padding: '8px 10px',
          border: '1px dashed rgba(255,255,255,0.18)',
          borderRadius: 4,
          fontFamily: 'monospace',
          fontSize: 10.5,
          color: 'rgba(255,255,255,0.55)',
        }}
      >
        No blueprint sets available for this project. Upload a Full Set to drive
        Generate VR.
      </div>
    )
  }

  return (
    <div
      style={{
        background: 'rgba(8,14,22,0.55)',
        border: `1px solid ${accentBorder}`,
        borderRadius: 6,
        padding: compact ? '6px 8px' : '10px 12px',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        fontFamily: 'monospace',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 10,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <span
            style={{
              fontSize: 9,
              letterSpacing: 1,
              textTransform: 'uppercase',
              color: accent,
            }}
          >
            VR SOURCE{userSelected ? '' : ' · Auto-picked'}
          </span>
          <span style={{ fontSize: 11.5, color: 'rgba(245,250,250,0.92)', fontWeight: 700 }}>
            {selected.name}
          </span>
          <span style={{ fontSize: 9.5, color: 'rgba(255,255,255,0.55)' }}>
            {setSubtitle(selected)}
            {selected.projectName ? ` · ${selected.projectName}` : ''}
          </span>
          <span
            style={{
              marginTop: 4,
              fontSize: 9,
              letterSpacing: 1,
              textTransform: 'uppercase',
              color: scanTone,
            }}
          >
            SCAN RESULT · {scanLabel}
            {confidencePct ? ` · ${confidencePct} confidence` : ''}
          </span>
          {scanSummary && (
            <span style={{ fontSize: 9.5, color: 'rgba(255,255,255,0.55)' }}>{scanSummary}</span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          {fullSetCandidate && fullSetCandidate.id !== selected.id && (
            <button
              onClick={() => handlePick(fullSetCandidate.id)}
              style={primaryButton(accent, accentSoft)}
              title="Use the project's Full Set as the VR source"
            >
              Use Full Set
            </button>
          )}
          <button onClick={handleToggle} style={secondaryButton()}>
            {expanded ? 'Hide Sources' : 'Change Source'}
          </button>
          {onRegenerate && (
            <button onClick={onRegenerate} style={secondaryButton()} title="Rescan from this source set">
              Rescan
            </button>
          )}
        </div>
      </div>

      {expanded && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
            marginTop: 4,
          }}
        >
          {sets.map((set) => {
            const isSelected = set.id === selected.id
            return (
              <button
                key={set.id}
                onClick={() => handlePick(set.id)}
                style={{
                  textAlign: 'left',
                  padding: '6px 8px',
                  borderRadius: 4,
                  background: isSelected ? accentSoft : 'rgba(255,255,255,0.02)',
                  border: `1px solid ${isSelected ? accent : 'rgba(255,255,255,0.1)'}`,
                  color: isSelected ? accent : 'rgba(240,245,250,0.85)',
                  cursor: 'pointer',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 6,
                  fontFamily: 'monospace',
                  fontSize: 10.5,
                }}
              >
                <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                  <span style={{ fontWeight: 700 }}>{set.name}</span>
                  <span style={{ fontSize: 9.5, opacity: 0.7 }}>{setSubtitle(set)}</span>
                </span>
                <span
                  style={{
                    fontSize: 9,
                    letterSpacing: 0.6,
                    color: isSelected ? accent : 'rgba(255,255,255,0.45)',
                  }}
                >
                  {isSelected ? 'SELECTED' : 'USE'}
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

function primaryButton(accent: string, soft: string): React.CSSProperties {
  return {
    padding: '4px 9px',
    borderRadius: 4,
    border: `1px solid ${accent}`,
    background: soft,
    color: accent,
    cursor: 'pointer',
    fontFamily: 'monospace',
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  }
}

function secondaryButton(): React.CSSProperties {
  return {
    padding: '4px 9px',
    borderRadius: 4,
    border: '1px solid rgba(255,255,255,0.18)',
    background: 'rgba(255,255,255,0.04)',
    color: 'rgba(255,255,255,0.7)',
    cursor: 'pointer',
    fontFamily: 'monospace',
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  }
}
