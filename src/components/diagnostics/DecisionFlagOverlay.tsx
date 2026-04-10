// @ts-nocheck
/**
 * DecisionFlagOverlay — Bad-Decision Interrupt for PowerOn Hub
 *
 * Surfaces decision flags from BadDecisionDetector in two modes:
 *
 *   RED flag   → Full-screen modal. Cannot be dismissed without reading.
 *                Shows: what you're about to do, why it's risky, the math,
 *                and a better alternative.
 *                Buttons: "I understand the risk — proceed" | "Cancel" | "Show me alternatives"
 *                Requires explicit acknowledgement, which is written to the audit trail.
 *
 *   AMBER flag → Dismissible banner at top of screen.
 *                Shows: concern, suggestion, one-tap dismiss.
 *
 * All interactions are logged to localStorage via logDecisionAudit().
 * The system asks "Are you thinking about this the right way?" on every RED flag.
 *
 * Usage
 *   <DecisionFlagOverlay
 *     result={assessmentResult}
 *     action="quote_job"
 *     jobLabel="Henderson Remodel"
 *     onProceed={() => handleSubmit()}
 *     onCancel={() => setShowModal(false)}
 *   />
 *
 * The overlay renders nothing when result.flags is empty.
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import {
  AlertTriangle,
  XCircle,
  CheckCircle,
  ChevronDown,
  ChevronUp,
  ArrowRight,
  Shield,
  DollarSign,
  Clock,
  Brain,
  X,
} from 'lucide-react'
import {
  logDecisionAudit,
  type DecisionResult,
  type DecisionFlag,
  type DecisionAuditEntry,
  type DecisionActionType,
  type FinancialHealth,
} from '@/services/diagnostics/BadDecisionDetector'

// ─── Palette ──────────────────────────────────────────────────────────────────

const RED    = '#ef4444'
const AMBER  = '#f59e0b'
const GREEN  = '#22c55e'
const DARK   = '#0f172a'
const PANEL  = '#1e293b'
const BORDER = 'rgba(255,255,255,0.08)'
const TEXT   = '#e2e8f0'
const MUTED  = '#94a3b8'

// ─── Props ────────────────────────────────────────────────────────────────────

export interface DecisionFlagOverlayProps {
  /** Full result from assessDecision(). */
  result: DecisionResult
  /** Action type — stored in audit log. */
  action: DecisionActionType
  /** Human-readable job or decision label. */
  jobLabel?: string
  /**
   * Called when the user confirms they understand the risk and want to proceed.
   * Only fires after RED acknowledgement or when no RED flags exist.
   */
  onProceed: () => void
  /** Called when the user cancels the action. */
  onCancel: () => void
  /** Optional — called when user taps "Show me alternatives". */
  onShowAlternatives?: () => void
}

// ─── Math panel ───────────────────────────────────────────────────────────────

function MathPanel({ math }: { math?: string }) {
  if (!math) return null
  return (
    <div style={{
      background: 'rgba(0,0,0,0.3)',
      border: `1px solid ${BORDER}`,
      borderRadius: 6,
      padding: '10px 14px',
      fontFamily: 'monospace',
      fontSize: 12,
      color: '#7dd3fc',
      marginTop: 8,
      lineHeight: 1.6,
    }}>
      {math}
    </div>
  )
}

// ─── Single flag card (inside RED modal) ─────────────────────────────────────

function FlagCard({ flag, index }: { flag: DecisionFlag; index: number }) {
  const [expanded, setExpanded] = useState(index === 0)
  const borderColor = flag.severity === 'RED' ? RED : AMBER

  return (
    <div style={{
      border: `1px solid ${borderColor}40`,
      borderLeft: `3px solid ${borderColor}`,
      borderRadius: 8,
      background: `${borderColor}08`,
      marginBottom: 10,
      overflow: 'hidden',
    }}>
      {/* Header */}
      <button
        onClick={() => setExpanded(e => !e)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '10px 14px',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        <AlertTriangle size={14} color={borderColor} />
        <span style={{ flex: 1, fontWeight: 600, fontSize: 13, color: TEXT }}>
          {flag.title}
        </span>
        <span style={{
          fontSize: 9,
          fontWeight: 700,
          color: borderColor,
          background: `${borderColor}18`,
          padding: '2px 7px',
          borderRadius: 99,
          letterSpacing: 1,
          textTransform: 'uppercase',
        }}>
          {flag.severity}
        </span>
        {expanded
          ? <ChevronUp size={14} color={MUTED} />
          : <ChevronDown size={14} color={MUTED} />
        }
      </button>

      {/* Body */}
      {expanded && (
        <div style={{ padding: '0 14px 14px' }}>
          <p style={{ fontSize: 13, color: TEXT, lineHeight: 1.65, margin: '0 0 10px' }}>
            {flag.message}
          </p>

          <MathPanel math={flag.math} />

          {flag.suggestion && (
            <div style={{
              marginTop: 10,
              display: 'flex',
              gap: 8,
              alignItems: 'flex-start',
            }}>
              <ArrowRight size={13} color={GREEN} style={{ marginTop: 2, flexShrink: 0 }} />
              <p style={{ fontSize: 12, color: '#86efac', margin: 0, lineHeight: 1.6 }}>
                {flag.suggestion}
              </p>
            </div>
          )}

          <div style={{ marginTop: 8, fontSize: 10, color: MUTED, fontFamily: 'monospace' }}>
            rule: {flag.ruleId} · {flag.category}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Financial health snapshot (shown in RED overlay) ────────────────────────

function HealthSnapshot({ health }: { health: FinancialHealth }) {
  const fmt = (n: number) => '$' + n.toLocaleString('en-US', { maximumFractionDigits: 0 })

  return (
    <div style={{
      border: `1px solid ${BORDER}`,
      borderRadius: 8,
      background: 'rgba(0,0,0,0.2)',
      padding: '12px 14px',
      marginBottom: 16,
    }}>
      <div style={{
        fontSize: 10,
        fontWeight: 700,
        color: MUTED,
        letterSpacing: 1,
        textTransform: 'uppercase',
        marginBottom: 10,
        display: 'flex',
        alignItems: 'center',
        gap: 6,
      }}>
        <Shield size={10} />
        Financial Snapshot
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <Metric label="Total AR" value={fmt(health.arTotal)} accent={health.arTotal > 50_000 ? RED : GREEN} />
        <Metric label="Monthly Burn" value={fmt(health.monthlyBurnRate)} accent={AMBER} />
        {health.biggestDebtor && (
          <Metric
            label="Biggest Debtor"
            value={health.biggestDebtor}
            sub={fmt(health.biggestDebtorAmount)}
            accent={RED}
          />
        )}
      </div>

      {/* AR aging */}
      {health.arAging.some(b => b.amount > 0) && (
        <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: 10, color: MUTED, marginBottom: 6 }}>AR Aging</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {health.arAging.filter(b => b.amount > 0).map(b => (
              <div key={b.label} style={{
                background: 'rgba(0,0,0,0.3)',
                borderRadius: 6,
                padding: '4px 8px',
                fontSize: 11,
              }}>
                <span style={{ color: MUTED }}>{b.label}: </span>
                <span style={{ color: TEXT, fontWeight: 600 }}>{fmt(b.amount)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function Metric({
  label, value, sub, accent,
}: {
  label: string
  value: string
  sub?: string
  accent?: string
}) {
  return (
    <div style={{
      background: 'rgba(0,0,0,0.2)',
      borderRadius: 6,
      padding: '6px 10px',
    }}>
      <div style={{ fontSize: 10, color: MUTED, marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 700, color: accent || TEXT }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: MUTED }}>{sub}</div>}
    </div>
  )
}

// ─── RED flag modal ───────────────────────────────────────────────────────────

function RedFlagModal({
  flags,
  health,
  jobLabel,
  onProceed,
  onCancel,
  onShowAlternatives,
}: {
  flags: DecisionFlag[]
  health: FinancialHealth
  jobLabel?: string
  onProceed: () => void
  onCancel: () => void
  onShowAlternatives?: () => void
}) {
  const [acknowledged, setAcknowledged] = useState(false)
  const [checkboxPulsing, setCheckboxPulsing] = useState(false)
  const topRef = useRef<HTMLDivElement>(null)

  // Scroll modal to top on mount
  useEffect(() => {
    topRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [])

  function handleProceedAttempt() {
    if (!acknowledged) {
      setCheckboxPulsing(true)
      setTimeout(() => setCheckboxPulsing(false), 600)
      return
    }
    onProceed()
  }

  const redFlags   = flags.filter(f => f.severity === 'RED')
  const amberFlags = flags.filter(f => f.severity === 'AMBER')

  return (
    // Full-screen backdrop
    <div style={{
      position: 'fixed',
      inset: 0,
      zIndex: 9999,
      background: 'rgba(0,0,0,0.88)',
      backdropFilter: 'blur(4px)',
      display: 'flex',
      alignItems: 'flex-start',
      justifyContent: 'center',
      overflowY: 'auto',
      padding: '24px 16px 48px',
    }}>
      <div
        ref={topRef}
        style={{
          width: '100%',
          maxWidth: 640,
          background: PANEL,
          border: `2px solid ${RED}40`,
          borderRadius: 16,
          overflow: 'hidden',
          boxShadow: `0 0 60px ${RED}30`,
        }}
      >
        {/* Header strip */}
        <div style={{
          background: `linear-gradient(135deg, ${RED}22, transparent)`,
          borderBottom: `1px solid ${RED}30`,
          padding: '20px 24px',
          display: 'flex',
          gap: 14,
          alignItems: 'flex-start',
        }}>
          <div style={{
            width: 40,
            height: 40,
            borderRadius: '50%',
            background: `${RED}20`,
            border: `2px solid ${RED}50`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}>
            <XCircle size={20} color={RED} />
          </div>
          <div>
            <div style={{
              fontSize: 10,
              fontWeight: 700,
              color: RED,
              letterSpacing: 2,
              textTransform: 'uppercase',
              marginBottom: 4,
            }}>
              Decision Risk Alert
            </div>
            <h2 style={{
              margin: 0,
              fontSize: 18,
              fontWeight: 700,
              color: TEXT,
              lineHeight: 1.3,
            }}>
              Are you thinking about this the right way?
            </h2>
            {jobLabel && (
              <div style={{ marginTop: 4, fontSize: 12, color: MUTED }}>
                Action: <span style={{ color: TEXT }}>{jobLabel}</span>
              </div>
            )}
          </div>
        </div>

        {/* Body */}
        <div style={{ padding: '20px 24px' }}>
          {/* Intro */}
          <p style={{
            margin: '0 0 16px',
            fontSize: 13,
            color: MUTED,
            lineHeight: 1.65,
            borderLeft: `3px solid ${RED}60`,
            paddingLeft: 12,
          }}>
            The system has flagged <strong style={{ color: TEXT }}>
              {redFlags.length} critical issue{redFlags.length !== 1 ? 's' : ''}
            </strong> with this decision.
            {' '}You cannot proceed without reviewing them.
            {' '}This is not a blocker — it is a checkpoint.
          </p>

          {/* Financial snapshot */}
          <HealthSnapshot health={health} />

          {/* RED flags */}
          {redFlags.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div style={{
                fontSize: 10,
                fontWeight: 700,
                color: RED,
                letterSpacing: 1,
                textTransform: 'uppercase',
                marginBottom: 8,
              }}>
                ⛔ Critical Issues
              </div>
              {redFlags.map((f, i) => <FlagCard key={f.ruleId} flag={f} index={i} />)}
            </div>
          )}

          {/* AMBER flags (if any) */}
          {amberFlags.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div style={{
                fontSize: 10,
                fontWeight: 700,
                color: AMBER,
                letterSpacing: 1,
                textTransform: 'uppercase',
                marginBottom: 8,
              }}>
                ⚠ Warnings
              </div>
              {amberFlags.map((f, i) => <FlagCard key={f.ruleId} flag={f} index={i} />)}
            </div>
          )}

          {/* Acknowledgement checkbox */}
          <div
            onClick={() => setAcknowledged(a => !a)}
            style={{
              display: 'flex',
              gap: 12,
              alignItems: 'flex-start',
              cursor: 'pointer',
              padding: '14px 16px',
              border: `1px solid ${acknowledged ? RED + '60' : BORDER}`,
              borderRadius: 8,
              background: acknowledged ? `${RED}10` : 'rgba(0,0,0,0.15)',
              marginBottom: 16,
              animation: checkboxPulsing ? 'pulse 0.3s ease' : undefined,
              userSelect: 'none',
            }}
          >
            <div style={{
              width: 18,
              height: 18,
              borderRadius: 4,
              border: `2px solid ${acknowledged ? RED : MUTED}`,
              background: acknowledged ? `${RED}30` : 'transparent',
              flexShrink: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginTop: 1,
            }}>
              {acknowledged && <CheckCircle size={11} color={RED} />}
            </div>
            <span style={{ fontSize: 13, color: TEXT, lineHeight: 1.55 }}>
              I have read the above warnings. I understand the specific financial risks.
              I am proceeding with full knowledge of the consequences.
            </span>
          </div>

          {/* Action buttons */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <button
              onClick={handleProceedAttempt}
              style={{
                width: '100%',
                padding: '12px 16px',
                borderRadius: 8,
                border: `1px solid ${acknowledged ? RED + '60' : BORDER}`,
                background: acknowledged ? `${RED}20` : 'rgba(0,0,0,0.2)',
                color: acknowledged ? RED : MUTED,
                fontSize: 13,
                fontWeight: 600,
                cursor: acknowledged ? 'pointer' : 'not-allowed',
                transition: 'all 0.2s',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
              }}
            >
              <AlertTriangle size={13} />
              I understand the risk — proceed
            </button>

            {onShowAlternatives && (
              <button
                onClick={onShowAlternatives}
                style={{
                  width: '100%',
                  padding: '11px 16px',
                  borderRadius: 8,
                  border: `1px solid ${BORDER}`,
                  background: 'rgba(255,255,255,0.04)',
                  color: '#7dd3fc',
                  fontSize: 13,
                  fontWeight: 500,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                }}
              >
                <Brain size={13} />
                Show me alternatives
              </button>
            )}

            <button
              onClick={onCancel}
              style={{
                width: '100%',
                padding: '11px 16px',
                borderRadius: 8,
                border: `1px solid ${BORDER}`,
                background: 'transparent',
                color: MUTED,
                fontSize: 13,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
              }}
            >
              <X size={13} />
              Cancel — go back
            </button>
          </div>

          {/* Audit note */}
          <div style={{
            marginTop: 16,
            fontSize: 10,
            color: MUTED,
            textAlign: 'center',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 5,
          }}>
            <Clock size={9} />
            This decision and your response will be logged to the audit trail.
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── AMBER banner ─────────────────────────────────────────────────────────────

function AmberBanner({
  flags,
  onDismiss,
}: {
  flags: DecisionFlag[]
  onDismiss: () => void
}) {
  const [expanded, setExpanded] = useState(false)

  if (flags.length === 0) return null

  const primary = flags[0]

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      zIndex: 8000,
      background: `linear-gradient(135deg, ${AMBER}22, ${AMBER}10)`,
      borderBottom: `2px solid ${AMBER}40`,
      padding: '0',
    }}>
      {/* Main row */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '10px 16px',
      }}>
        <AlertTriangle size={15} color={AMBER} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <span style={{ fontWeight: 600, fontSize: 13, color: TEXT }}>
            {primary.title}
          </span>
          {!expanded && (
            <span style={{ fontSize: 12, color: MUTED, marginLeft: 8 }}>
              {primary.suggestion?.slice(0, 80)}…
            </span>
          )}
        </div>

        {flags.length > 1 && (
          <span style={{
            fontSize: 10,
            color: AMBER,
            background: `${AMBER}20`,
            borderRadius: 99,
            padding: '2px 7px',
            fontWeight: 700,
            flexShrink: 0,
          }}>
            +{flags.length - 1} more
          </span>
        )}

        <button
          onClick={() => setExpanded(e => !e)}
          style={{
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            color: MUTED,
            display: 'flex',
            alignItems: 'center',
            padding: 4,
          }}
        >
          {expanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
        </button>

        <button
          onClick={onDismiss}
          style={{
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            color: MUTED,
            display: 'flex',
            alignItems: 'center',
            padding: 4,
          }}
        >
          <X size={15} />
        </button>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div style={{
          borderTop: `1px solid ${BORDER}`,
          padding: '12px 16px',
          background: 'rgba(0,0,0,0.25)',
        }}>
          {flags.map((f, i) => (
            <div key={f.ruleId} style={{ marginBottom: i < flags.length - 1 ? 12 : 0 }}>
              <div style={{
                fontWeight: 600,
                fontSize: 12,
                color: AMBER,
                marginBottom: 4,
                display: 'flex',
                gap: 6,
                alignItems: 'center',
              }}>
                <DollarSign size={11} />
                {f.title}
              </div>
              <p style={{ margin: '0 0 6px', fontSize: 12, color: TEXT, lineHeight: 1.6 }}>
                {f.message}
              </p>
              {f.math && <MathPanel math={f.math} />}
              {f.suggestion && (
                <div style={{ marginTop: 6, fontSize: 12, color: '#86efac', display: 'flex', gap: 6 }}>
                  <ArrowRight size={11} style={{ flexShrink: 0, marginTop: 2 }} />
                  {f.suggestion}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * DecisionFlagOverlay
 *
 * Renders nothing when result.flags is empty.
 * Renders full-screen modal when RED flags exist.
 * Renders top banner when only AMBER flags exist.
 *
 * All user interactions are logged to the local audit trail.
 */
export function DecisionFlagOverlay({
  result,
  action,
  jobLabel,
  onProceed,
  onCancel,
  onShowAlternatives,
}: DecisionFlagOverlayProps) {
  const [amberDismissed, setAmberDismissed] = useState(false)

  const redFlags   = result.flags.filter(f => f.severity === 'RED')
  const amberFlags = result.flags.filter(f => f.severity === 'AMBER')

  const hasRed   = redFlags.length > 0
  const hasAmber = amberFlags.length > 0 && !amberDismissed

  // Write audit entry after user acts
  const writeAudit = useCallback((proceeded: boolean, acknowledgedReds: boolean) => {
    const entry: DecisionAuditEntry = {
      id: Math.random().toString(36).slice(2),
      timestamp: new Date().toISOString(),
      action,
      jobLabel,
      flags: result.flags.map(f => ({
        ruleId: f.ruleId,
        severity: f.severity,
        title: f.title,
      })),
      proceeded,
      acknowledgedReds,
    }
    logDecisionAudit(entry)
  }, [action, jobLabel, result.flags])

  function handleProceed() {
    writeAudit(true, hasRed)
    onProceed()
  }

  function handleCancel() {
    writeAudit(false, false)
    onCancel()
  }

  function handleDismissAmber() {
    writeAudit(true, false)
    setAmberDismissed(true)
  }

  // Nothing to show
  if (result.flags.length === 0) return null

  // RED flag: full-screen modal takes priority
  if (hasRed) {
    return (
      <RedFlagModal
        flags={result.flags}
        health={result.financialSnapshot}
        jobLabel={jobLabel}
        onProceed={handleProceed}
        onCancel={handleCancel}
        onShowAlternatives={onShowAlternatives}
      />
    )
  }

  // AMBER only: top banner
  if (hasAmber) {
    return (
      <AmberBanner
        flags={amberFlags}
        onDismiss={handleDismissAmber}
      />
    )
  }

  return null
}

export default DecisionFlagOverlay
