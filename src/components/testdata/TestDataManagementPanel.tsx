/**
 * TestDataManagementPanel.tsx
 *
 * Settings → Data Management panel.
 * Only rendered when the parent gates via isOwner (V15rSettingsPanel handles gating).
 *
 * Buttons:
 *   • Load Test Data   — seeds 5 projects + 6 service calls (idempotent)
 *   • Clear Test Data  — removes all TD_* prefixed records
 *   • Verify Test Data — runs financial verification checks
 */

import React, { useState, useCallback } from 'react'
import {
  Database,
  Trash2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Loader2,
  ChevronDown,
  ChevronUp,
  FlaskConical,
} from 'lucide-react'
import {
  seedTestData,
  clearTestData,
  verifyTestData,
  hasTestData,
  type SeedResult,
  type ClearResult,
  type VerificationResult,
  type VerificationCheck,
} from '@/services/testdata/TestDataSeeder'

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatusBadge({ loaded }: { loaded: boolean }) {
  return (
    <span
      className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full"
      style={{
        backgroundColor: loaded ? '#0f2a1a' : '#1a1d27',
        color: loaded ? '#4ade80' : '#6b7280',
        border: `1px solid ${loaded ? '#16a34a55' : '#2a3040'}`,
      }}
    >
      <span
        className="w-1.5 h-1.5 rounded-full"
        style={{ backgroundColor: loaded ? '#22c55e' : '#4b5563' }}
      />
      {loaded ? 'LOADED' : 'NOT LOADED'}
    </span>
  )
}

function ActionButton({
  onClick,
  loading,
  disabled,
  variant,
  icon: Icon,
  label,
}: {
  onClick: () => void
  loading: boolean
  disabled: boolean
  variant: 'green' | 'red' | 'blue'
  icon: React.ElementType
  label: string
}) {
  const colors: Record<string, { bg: string; hover: string; text: string; border: string }> = {
    green: { bg: '#14532d', hover: '#166534', text: '#86efac', border: '#16a34a44' },
    red:   { bg: '#450a0a', hover: '#7f1d1d', text: '#fca5a5', border: '#dc262644' },
    blue:  { bg: '#0c1a2e', hover: '#1e3a5f', text: '#93c5fd', border: '#3b82f644' },
  }
  const c = colors[variant]

  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold transition-all duration-150"
      style={{
        backgroundColor: disabled ? '#1a1d27' : c.bg,
        color: disabled ? '#4b5563' : c.text,
        border: `1px solid ${disabled ? '#2a3040' : c.border}`,
        cursor: disabled || loading ? 'not-allowed' : 'pointer',
        minHeight: '40px',
        opacity: disabled ? 0.5 : 1,
      }}
      onMouseEnter={e => {
        if (!disabled && !loading) (e.currentTarget as HTMLButtonElement).style.backgroundColor = c.hover
      }}
      onMouseLeave={e => {
        if (!disabled && !loading) (e.currentTarget as HTMLButtonElement).style.backgroundColor = disabled ? '#1a1d27' : c.bg
      }}
    >
      {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Icon className="w-4 h-4" />}
      {label}
    </button>
  )
}

function CheckRow({ check }: { check: VerificationCheck }) {
  return (
    <div
      className="flex items-start gap-3 py-2.5 px-3 rounded-lg"
      style={{ backgroundColor: check.pass ? '#0a1f0f' : '#1f0a0a', border: `1px solid ${check.pass ? '#16a34a22' : '#dc262622'}` }}
    >
      {check.pass
        ? <CheckCircle2 className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: '#4ade80' }} />
        : <XCircle className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: '#f87171' }} />
      }
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium" style={{ color: check.pass ? '#86efac' : '#fca5a5' }}>
          {check.label}
        </p>
        <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-0.5">
          <span className="text-xs" style={{ color: '#6b7280' }}>
            Expected: <span style={{ color: '#9ca3af' }}>{check.expected}</span>
          </span>
          <span className="text-xs" style={{ color: '#6b7280' }}>
            Actual: <span style={{ color: check.pass ? '#86efac' : '#fca5a5' }}>{check.actual}</span>
          </span>
        </div>
        {check.note && (
          <p className="text-xs mt-0.5" style={{ color: '#6b7280' }}>{check.note}</p>
        )}
      </div>
    </div>
  )
}

// ─── Summary Table ────────────────────────────────────────────────────────────

function DataSummaryTable() {
  return (
    <div className="mt-3 space-y-1.5">
      <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: '#6b7280' }}>
        What gets loaded
      </p>
      <div className="rounded-lg overflow-hidden" style={{ border: '1px solid #2a3040' }}>
        <table className="w-full text-xs">
          <thead>
            <tr style={{ backgroundColor: '#1a1d27' }}>
              <th className="text-left px-3 py-2 font-semibold" style={{ color: '#9ca3af' }}>Project</th>
              <th className="text-right px-3 py-2 font-semibold" style={{ color: '#9ca3af' }}>Quote</th>
              <th className="text-right px-3 py-2 font-semibold" style={{ color: '#9ca3af' }}>Collected</th>
              <th className="text-right px-3 py-2 font-semibold hidden sm:table-cell" style={{ color: '#9ca3af' }}>Days</th>
              <th className="text-center px-3 py-2 font-semibold" style={{ color: '#9ca3af' }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {[
              { name: 'Martinez Kitchen Remodel', quote: '$25,000', collected: '$8,000', days: 8, status: 'active', color: '#fbbf24' },
              { name: 'Sunrise Dental Office TI', quote: '$12,000', collected: '$2,000', days: 4, status: 'active', color: '#fbbf24' },
              { name: 'Johnson ADU Electrical', quote: '$9,500', collected: '$7,000', days: 12, status: 'active', color: '#fbbf24' },
              { name: 'El Paseo Beauty Salon', quote: '$18,000', collected: '$5,000', days: 14, status: 'active + RFI', color: '#f97316' },
              { name: 'CV Apartments Panel Upgrades', quote: '$8,500', collected: '$8,500', days: 6, status: 'completed', color: '#4ade80' },
            ].map((row, i) => (
              <tr key={i} style={{ borderTop: '1px solid #1f2937', backgroundColor: i % 2 === 0 ? '#111318' : 'transparent' }}>
                <td className="px-3 py-2 font-medium" style={{ color: '#e5e7eb' }}>{row.name}</td>
                <td className="px-3 py-2 text-right" style={{ color: '#d1d5db' }}>{row.quote}</td>
                <td className="px-3 py-2 text-right" style={{ color: '#86efac' }}>{row.collected}</td>
                <td className="px-3 py-2 text-right hidden sm:table-cell" style={{ color: '#9ca3af' }}>{row.days}</td>
                <td className="px-3 py-2 text-center">
                  <span className="text-xs font-semibold" style={{ color: row.color }}>{row.status}</span>
                </td>
              </tr>
            ))}
            <tr style={{ borderTop: '1px solid #2a3040', backgroundColor: '#1a1d27' }}>
              <td className="px-3 py-2 font-bold" style={{ color: '#f3f4f6' }}>TOTAL (active)</td>
              <td className="px-3 py-2 text-right font-bold" style={{ color: '#93c5fd' }}>$64,500</td>
              <td className="px-3 py-2 text-right font-bold" style={{ color: '#86efac' }}>$22,000</td>
              <td className="px-3 py-2 hidden sm:table-cell" />
              <td className="px-3 py-2" />
            </tr>
          </tbody>
        </table>
      </div>

      <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
        {[
          { label: 'Service Calls', value: '6 (including 3 multi-day)' },
          { label: 'Total Svc Revenue', value: '$1,975.00' },
          { label: 'Field Log Entries', value: '44 individual daily records' },
          { label: 'Total Svc Cost', value: '$1,017.60' },
        ].map((item, i) => (
          <div key={i} className="flex justify-between px-3 py-2 rounded" style={{ backgroundColor: '#111318', border: '1px solid #1f2937' }}>
            <span style={{ color: '#6b7280' }}>{item.label}</span>
            <span className="font-medium" style={{ color: '#d1d5db' }}>{item.value}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Main Panel ───────────────────────────────────────────────────────────────

export default function TestDataManagementPanel() {
  const [loaded, setLoaded] = useState<boolean>(() => hasTestData())
  const [loadingAction, setLoadingAction] = useState<'seed' | 'clear' | 'verify' | null>(null)
  const [seedResult, setSeedResult] = useState<SeedResult | null>(null)
  const [clearResult, setClearResult] = useState<ClearResult | null>(null)
  const [verifyResult, setVerifyResult] = useState<VerificationResult | null>(null)
  const [showDetails, setShowDetails] = useState(false)
  const [showSummaryTable, setShowSummaryTable] = useState(false)

  const handleSeed = useCallback(() => {
    setLoadingAction('seed')
    setSeedResult(null)
    setClearResult(null)
    setVerifyResult(null)
    // Use setTimeout to allow React to render loading state
    setTimeout(() => {
      const result = seedTestData()
      setSeedResult(result)
      setLoaded(hasTestData())
      setLoadingAction(null)
    }, 50)
  }, [])

  const handleClear = useCallback(() => {
    setLoadingAction('clear')
    setSeedResult(null)
    setClearResult(null)
    setVerifyResult(null)
    setTimeout(() => {
      const result = clearTestData()
      setClearResult(result)
      setLoaded(hasTestData())
      setLoadingAction(null)
    }, 50)
  }, [])

  const handleVerify = useCallback(() => {
    setLoadingAction('verify')
    setVerifyResult(null)
    setTimeout(() => {
      const result = verifyTestData()
      setVerifyResult(result)
      setShowDetails(true)
      setLoadingAction(null)
    }, 50)
  }, [])

  return (
    <div
      className="rounded-xl p-5 space-y-4"
      style={{ backgroundColor: '#0d1117', border: '1px solid #2a3040' }}
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div
            className="flex items-center justify-center w-8 h-8 rounded-lg"
            style={{ backgroundColor: '#0c1a2e', border: '1px solid #1e3a5f' }}
          >
            <FlaskConical className="w-4 h-4" style={{ color: '#60a5fa' }} />
          </div>
          <div>
            <h3 className="text-sm font-bold" style={{ color: '#f3f4f6' }}>
              Data Management
            </h3>
            <p className="text-xs" style={{ color: '#6b7280' }}>
              Test data — owner only
            </p>
          </div>
        </div>
        <StatusBadge loaded={loaded} />
      </div>

      {/* Description */}
      <p className="text-xs leading-relaxed" style={{ color: '#9ca3af' }}>
        Load 5 fictitious projects and 6 multi-day service calls with full financial breakdowns.
        All records are tagged <code className="px-1 py-0.5 rounded text-xs" style={{ backgroundColor: '#1a1d27', color: '#93c5fd' }}>TD_</code> and
        can be removed without affecting your real data.
      </p>

      {/* Action Buttons */}
      <div className="flex flex-wrap gap-2">
        <ActionButton
          onClick={handleSeed}
          loading={loadingAction === 'seed'}
          disabled={loadingAction !== null}
          variant="green"
          icon={Database}
          label="Load Test Data"
        />
        <ActionButton
          onClick={handleClear}
          loading={loadingAction === 'clear'}
          disabled={loadingAction !== null || !loaded}
          variant="red"
          icon={Trash2}
          label="Clear Test Data"
        />
        <ActionButton
          onClick={handleVerify}
          loading={loadingAction === 'verify'}
          disabled={loadingAction !== null || !loaded}
          variant="blue"
          icon={CheckCircle2}
          label="Verify Totals"
        />
      </div>

      {/* Seed Result */}
      {seedResult && (
        <div
          className="flex items-start gap-2 p-3 rounded-lg text-xs"
          style={{
            backgroundColor: seedResult.success ? '#0a1f0f' : '#1f0a0a',
            border: `1px solid ${seedResult.success ? '#16a34a33' : '#dc262633'}`,
            color: seedResult.success ? '#86efac' : '#fca5a5',
          }}
        >
          {seedResult.success
            ? <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5" />
            : <XCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          }
          <span>{seedResult.message}</span>
        </div>
      )}

      {/* Clear Result */}
      {clearResult && (
        <div
          className="flex items-start gap-2 p-3 rounded-lg text-xs"
          style={{
            backgroundColor: clearResult.success ? '#0a1f0f' : '#1f0a0a',
            border: `1px solid ${clearResult.success ? '#16a34a33' : '#dc262633'}`,
            color: clearResult.success ? '#86efac' : '#fca5a5',
          }}
        >
          {clearResult.success
            ? <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5" />
            : <XCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          }
          <span>{clearResult.message}</span>
        </div>
      )}

      {/* Verification Result Summary */}
      {verifyResult && (
        <div
          className="p-3 rounded-lg"
          style={{
            backgroundColor: verifyResult.allPass ? '#0a1f0f' : '#1a1200',
            border: `1px solid ${verifyResult.allPass ? '#16a34a44' : '#d9770644'}`,
          }}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {verifyResult.allPass
                ? <CheckCircle2 className="w-4 h-4" style={{ color: '#4ade80' }} />
                : <AlertTriangle className="w-4 h-4" style={{ color: '#fb923c' }} />
              }
              <span className="text-xs font-semibold" style={{ color: verifyResult.allPass ? '#86efac' : '#fdba74' }}>
                {verifyResult.summary}
              </span>
            </div>
            <button
              onClick={() => setShowDetails(v => !v)}
              className="flex items-center gap-1 text-xs px-2 py-1 rounded"
              style={{ color: '#6b7280', backgroundColor: '#1a1d27' }}
            >
              {showDetails ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              {showDetails ? 'Hide' : 'Details'}
            </button>
          </div>

          {showDetails && (
            <div className="mt-3 space-y-2">
              {verifyResult.checks.map((check, i) => (
                <CheckRow key={i} check={check} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Summary Table Toggle */}
      <div>
        <button
          onClick={() => setShowSummaryTable(v => !v)}
          className="flex items-center gap-1.5 text-xs"
          style={{ color: '#6b7280' }}
        >
          {showSummaryTable ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          {showSummaryTable ? 'Hide' : 'Show'} project summary
        </button>
        {showSummaryTable && <DataSummaryTable />}
      </div>

      {/* Footer note */}
      <p className="text-xs" style={{ color: '#374151' }}>
        All test records use the <code style={{ color: '#4b5563' }}>TD_</code> ID prefix.
        They are isolated from your real data and safe to load and clear at any time.
      </p>
    </div>
  )
}
