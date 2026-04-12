/**
 * ThreatMonitorPanel.tsx — SEC4 Threat Monitoring Dashboard
 *
 * Continuous threat monitoring dashboard for PowerOn Hub.
 * Shows stack component health, CVE alerts, auto-generated patch sessions,
 * and a live security posture score.
 *
 * Colour coding:
 *  Green  → no known vulnerabilities
 *  Amber  → Low / Medium CVE
 *  Red    → High / Critical CVE
 */

import React, { useState, useCallback, useEffect } from 'react'
import {
  ShieldCheck,
  ShieldAlert,
  ShieldOff,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Clock,
  Zap,
  Code2,
  Server,
  Cpu,
  Smartphone,
  Database,
  Globe,
  ChevronDown,
  ChevronUp,
  Send,
} from 'lucide-react'
import {
  checkVulnerabilities,
  getSecurityPosture,
  getNextScanDate,
  STACK_COMPONENTS,
  type FullScanResult,
  type SecurityPosture,
  type ComponentScanResult,
  type PatchSession,
  type Severity,
  type StackComponent,
} from '@/services/security/ThreatMonitor'

// ── Helpers ───────────────────────────────────────────────────────────────────

function severityBg(severity: Severity): string {
  switch (severity) {
    case 'Critical': return 'bg-red-900/40 border border-red-500/60'
    case 'High':     return 'bg-orange-900/40 border border-orange-500/60'
    case 'Medium':   return 'bg-yellow-900/40 border border-yellow-500/60'
    case 'Low':      return 'bg-green-900/30 border border-green-500/40'
    default:         return 'bg-gray-800/40 border border-gray-700/40'
  }
}

function severityText(severity: Severity): string {
  switch (severity) {
    case 'Critical': return 'text-red-400'
    case 'High':     return 'text-orange-400'
    case 'Medium':   return 'text-yellow-400'
    case 'Low':      return 'text-green-400'
    default:         return 'text-gray-400'
  }
}

function severityDot(severity: Severity): string {
  switch (severity) {
    case 'Critical': return 'bg-red-500'
    case 'High':     return 'bg-orange-500'
    case 'Medium':   return 'bg-yellow-400'
    case 'Low':      return 'bg-green-400'
    default:         return 'bg-gray-500'
  }
}

function gradeColor(grade: SecurityPosture['grade']): string {
  switch (grade) {
    case 'A': return 'text-green-400'
    case 'B': return 'text-blue-400'
    case 'C': return 'text-yellow-400'
    case 'D': return 'text-orange-400'
    case 'F': return 'text-red-400'
  }
}

function scoreRingColor(score: number): string {
  if (score >= 90) return '#22c55e'
  if (score >= 75) return '#3b82f6'
  if (score >= 60) return '#eab308'
  if (score >= 45) return '#f97316'
  return '#ef4444'
}

function categoryIcon(category: StackComponent['category']): React.ReactNode {
  const cls = 'w-3.5 h-3.5'
  switch (category) {
    case 'frontend': return <Code2    className={cls} />
    case 'build':    return <Zap      className={cls} />
    case 'state':    return <Cpu      className={cls} />
    case 'backend':  return <Database className={cls} />
    case 'ai':       return <Cpu      className={cls} />
    case 'infra':    return <Server   className={cls} />
    case 'mobile':   return <Smartphone className={cls} />
    default:         return <Globe    className={cls} />
  }
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString('en-US', {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    })
  } catch { return iso }
}

// ── Score Ring ────────────────────────────────────────────────────────────────

interface ScoreRingProps {
  score: number
  grade: SecurityPosture['grade']
  size?: number
}

function ScoreRing({ score, grade, size = 96 }: ScoreRingProps) {
  const r   = (size - 12) / 2
  const circ = 2 * Math.PI * r
  const fill  = circ * (1 - score / 100)
  const color = scoreRingColor(score)

  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2} cy={size / 2} r={r}
          fill="none" strokeWidth={8}
          stroke="rgba(255,255,255,0.08)"
        />
        <circle
          cx={size / 2} cy={size / 2} r={r}
          fill="none" strokeWidth={8}
          stroke={color}
          strokeDasharray={circ}
          strokeDashoffset={fill}
          strokeLinecap="round"
          style={{ transition: 'stroke-dashoffset 0.8s ease' }}
        />
      </svg>
      <div className="absolute flex flex-col items-center">
        <span className="text-xl font-bold text-white leading-none">{score}</span>
        <span className={`text-sm font-semibold ${gradeColor(grade)}`}>{grade}</span>
      </div>
    </div>
  )
}

// ── Component Row ─────────────────────────────────────────────────────────────

interface ComponentRowProps {
  result: ComponentScanResult
}

function ComponentRow({ result }: ComponentRowProps) {
  const [expanded, setExpanded] = useState(false)
  const { component, vulnerabilities, highestSeverity } = result

  const statusIcon =
    highestSeverity === 'None'     ? <CheckCircle2 className="w-4 h-4 text-green-400" /> :
    highestSeverity === 'Low'      ? <ShieldCheck  className="w-4 h-4 text-green-400" /> :
    highestSeverity === 'Medium'   ? <AlertTriangle className="w-4 h-4 text-yellow-400" /> :
    highestSeverity === 'High'     ? <ShieldAlert  className="w-4 h-4 text-orange-400" /> :
                                     <ShieldOff    className="w-4 h-4 text-red-400" />

  const rowBg =
    highestSeverity === 'None'   || highestSeverity === 'Low'
      ? 'bg-gray-800/30 border-gray-700/40'
      : highestSeverity === 'Medium'
      ? 'bg-yellow-900/20 border-yellow-700/40'
      : 'bg-red-900/20 border-red-700/40'

  return (
    <div className={`rounded-lg border ${rowBg} transition-all`}>
      <button
        className="w-full flex items-center gap-3 px-3 py-2.5 text-left"
        onClick={() => vulnerabilities.length > 0 && setExpanded(!expanded)}
      >
        <span className="text-gray-400">{categoryIcon(component.category)}</span>
        <span className="flex-1 text-sm font-medium text-white">{component.name}</span>
        <span className="text-xs text-gray-500 font-mono mr-2">v{component.version}</span>
        {statusIcon}
        {vulnerabilities.length > 0 && (
          <span className={`text-xs font-bold ml-1 ${severityText(highestSeverity)}`}>
            {vulnerabilities.length} CVE{vulnerabilities.length > 1 ? 's' : ''}
          </span>
        )}
        {vulnerabilities.length > 0 && (
          expanded
            ? <ChevronUp   className="w-3.5 h-3.5 text-gray-500 ml-1" />
            : <ChevronDown className="w-3.5 h-3.5 text-gray-500 ml-1" />
        )}
      </button>

      {expanded && vulnerabilities.length > 0 && (
        <div className="px-3 pb-3 space-y-2">
          {vulnerabilities.map((cve) => (
            <div
              key={cve.cveId}
              className={`rounded-md px-3 py-2 text-xs space-y-1 ${severityBg(cve.severity)}`}
            >
              <div className="flex items-center gap-2">
                <span className={`font-bold font-mono ${severityText(cve.severity)}`}>
                  {cve.cveId}
                </span>
                <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase ${severityText(cve.severity)} bg-black/30`}>
                  {cve.severity}
                </span>
                <span className="text-gray-500 ml-auto">CVSS {cve.cvssScore.toFixed(1)}</span>
              </div>
              <p className="text-gray-300 leading-relaxed">{cve.description}</p>
              {cve.patchNotes && (
                <p className="text-blue-300">
                  <span className="font-semibold">Fix: </span>{cve.patchNotes}
                </p>
              )}
              {cve.affectedFiles && (
                <p className="text-gray-500">
                  Files: {cve.affectedFiles.join(' · ')}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Patch Session Card ────────────────────────────────────────────────────────

interface PatchCardProps {
  session: PatchSession
}

function PatchCard({ session }: PatchCardProps) {
  const [copied, setCopied] = useState(false)

  const copy = useCallback(() => {
    navigator.clipboard.writeText(session.prompt).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }, [session.prompt])

  return (
    <div className="rounded-lg border border-orange-600/40 bg-orange-900/20 p-3 space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-orange-600/30 text-orange-300">
          {session.priority}
        </span>
        <span className="text-xs font-mono text-orange-300 font-semibold">{session.cveId}</span>
        <span className="ml-auto text-xs text-gray-500">{fmtDate(session.createdAt)}</span>
      </div>
      <p className="text-xs text-gray-300 leading-relaxed line-clamp-3">{session.prompt}</p>
      <button
        onClick={copy}
        className="flex items-center gap-1.5 text-xs text-blue-400 hover:text-blue-300 transition-colors"
      >
        <Send className="w-3 h-3" />
        {copied ? 'Copied!' : 'Copy Cowork Prompt'}
      </button>
    </div>
  )
}

// ── Alert Feed Item ───────────────────────────────────────────────────────────

interface AlertFeedItemProps {
  cve: { cveId: string; title: string; severity: Severity; publishedAt: string; affectedComponent: string }
}

function AlertFeedItem({ cve }: AlertFeedItemProps) {
  return (
    <div className={`flex items-start gap-2.5 px-3 py-2 rounded-lg ${severityBg(cve.severity)}`}>
      <span className={`mt-0.5 w-2 h-2 rounded-full flex-shrink-0 ${severityDot(cve.severity)}`} />
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold text-white truncate">{cve.title}</p>
        <p className="text-[11px] text-gray-400">
          {cve.cveId} · {cve.affectedComponent} · {cve.publishedAt}
        </p>
      </div>
      <span className={`text-[10px] font-bold uppercase flex-shrink-0 ${severityText(cve.severity)}`}>
        {cve.severity}
      </span>
    </div>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────

export function ThreatMonitorPanel() {
  const [scanResult,  setScanResult]  = useState<FullScanResult  | null>(null)
  const [posture,     setPosture]     = useState<SecurityPosture | null>(null)
  const [scanning,    setScanning]    = useState(false)
  const [lastScanAt,  setLastScanAt]  = useState<string | null>(null)
  const [activeTab,   setActiveTab]   = useState<'components' | 'alerts' | 'patches'>('components')
  const [error,       setError]       = useState<string | null>(null)

  // Run scan
  const runScan = useCallback(async () => {
    setScanning(true)
    setError(null)
    try {
      const result = await checkVulnerabilities()
      const post   = await getSecurityPosture(result)
      setScanResult(result)
      setPosture(post)
      setLastScanAt(result.completedAt)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Scan failed')
    } finally {
      setScanning(false)
    }
  }, [])

  // Auto-scan on mount
  useEffect(() => {
    runScan()
  }, [runScan])

  // Collect all CVE alerts chronologically
  const allAlerts = scanResult
    ? scanResult.components
        .flatMap((r) => r.vulnerabilities)
        .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime())
    : []

  const nextScan = lastScanAt ? getNextScanDate(lastScanAt) : null

  // ── Summary counts ─────────────────────────────────────────────────────────
  const counts = scanResult
    ? { c: scanResult.criticalCount, h: scanResult.highCount, m: scanResult.mediumCount, l: scanResult.lowCount }
    : null

  return (
    <div className="flex flex-col h-full bg-gray-900 text-white overflow-hidden">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800 flex-shrink-0">
        <div className="flex items-center gap-2.5">
          <ShieldAlert className="w-5 h-5 text-orange-400" />
          <div>
            <h2 className="text-sm font-bold text-white leading-none">Threat Monitor</h2>
            <p className="text-[11px] text-gray-500 mt-0.5">CVE · GitHub Advisory · Snyk · OWASP</p>
          </div>
        </div>
        <button
          onClick={runScan}
          disabled={scanning}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-blue-600 hover:bg-blue-500 disabled:opacity-50 transition-colors text-xs font-semibold"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${scanning ? 'animate-spin' : ''}`} />
          {scanning ? 'Scanning…' : 'Scan Now'}
        </button>
      </div>

      {/* ── Error ──────────────────────────────────────────────────────────── */}
      {error && (
        <div className="mx-4 mt-3 p-2.5 rounded-lg bg-red-900/40 border border-red-600/40 text-xs text-red-300">
          {error}
        </div>
      )}

      {/* ── Posture + Stats row ─────────────────────────────────────────────── */}
      <div className="flex items-center gap-4 px-4 py-3 border-b border-gray-800 flex-shrink-0">

        {/* Score ring */}
        <div className="flex-shrink-0">
          {posture
            ? <ScoreRing score={posture.score} grade={posture.grade} />
            : (
              <div className="w-24 h-24 rounded-full border-4 border-gray-700 flex items-center justify-center">
                <span className="text-xs text-gray-500">{scanning ? '…' : '—'}</span>
              </div>
            )
          }
        </div>

        <div className="flex-1 min-w-0 space-y-2">
          <p className="text-xs font-semibold text-gray-300">Security Posture Score</p>

          {/* Severity summary */}
          {counts && (
            <div className="flex flex-wrap gap-2">
              {[
                { label: 'Critical', count: counts.c, color: 'text-red-400',    bg: 'bg-red-900/30' },
                { label: 'High',     count: counts.h, color: 'text-orange-400', bg: 'bg-orange-900/30' },
                { label: 'Medium',   count: counts.m, color: 'text-yellow-400', bg: 'bg-yellow-900/30' },
                { label: 'Low',      count: counts.l, color: 'text-green-400',  bg: 'bg-green-900/20' },
              ].map((s) => (
                <span
                  key={s.label}
                  className={`flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold ${s.bg} ${s.color}`}
                >
                  {s.count} {s.label}
                </span>
              ))}
            </div>
          )}

          {/* Scan timing */}
          <div className="flex items-center gap-3 text-[11px] text-gray-500">
            <span className="flex items-center gap-1">
              <Clock className="w-3 h-3" />
              Last scan: {lastScanAt ? fmtDate(lastScanAt) : '—'}
            </span>
            {nextScan && (
              <span className="flex items-center gap-1">
                Next: {fmtDate(nextScan)}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* ── Posture breakdown (mini) ─────────────────────────────────────────── */}
      {posture && (
        <div className="px-4 py-2 border-b border-gray-800 flex-shrink-0">
          <div className="grid grid-cols-2 gap-x-4 gap-y-1">
            {posture.breakdown.map((b) => (
              <div key={b.label} className="flex items-center gap-2">
                {b.passed
                  ? <CheckCircle2 className="w-3 h-3 text-green-400 flex-shrink-0" />
                  : <XCircle      className="w-3 h-3 text-red-400 flex-shrink-0" />
                }
                <span className="text-[11px] text-gray-400 truncate">{b.label}</span>
                <span className="ml-auto text-[11px] text-gray-500">{b.score}/{b.maxScore}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Tabs ────────────────────────────────────────────────────────────── */}
      <div className="flex border-b border-gray-800 flex-shrink-0">
        {([
          { id: 'components', label: `Stack (${STACK_COMPONENTS.length})` },
          { id: 'alerts',     label: `Alerts (${allAlerts.length})` },
          { id: 'patches',    label: `Patches (${scanResult?.patchSessions.length ?? 0})` },
        ] as const).map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex-1 py-2 text-xs font-semibold transition-colors ${
              activeTab === tab.id
                ? 'text-blue-400 border-b-2 border-blue-500'
                : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── Tab Content ─────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">

        {/* Components tab */}
        {activeTab === 'components' && (
          <>
            {scanResult
              ? scanResult.components.map((r) => (
                  <ComponentRow key={r.component.id} result={r} />
                ))
              : STACK_COMPONENTS.map((c) => (
                  <div
                    key={c.id}
                    className="flex items-center gap-3 rounded-lg border border-gray-700/40 bg-gray-800/30 px-3 py-2.5"
                  >
                    <span className="text-gray-400">{categoryIcon(c.category)}</span>
                    <span className="flex-1 text-sm text-white">{c.name}</span>
                    <span className="text-xs text-gray-500 font-mono">v{c.version}</span>
                    {scanning && <RefreshCw className="w-3.5 h-3.5 text-gray-600 animate-spin" />}
                  </div>
                ))
            }
          </>
        )}

        {/* Alerts tab */}
        {activeTab === 'alerts' && (
          <>
            {allAlerts.length === 0
              ? (
                <div className="flex flex-col items-center justify-center py-12 gap-3 text-center">
                  <ShieldCheck className="w-10 h-10 text-green-400" />
                  <p className="text-sm font-semibold text-green-400">No Threats Detected</p>
                  <p className="text-xs text-gray-500">All monitored stack components are clear.</p>
                </div>
              )
              : allAlerts.map((cve) => (
                  <AlertFeedItem key={`${cve.cveId}-${cve.affectedComponent}`} cve={cve} />
                ))
            }
          </>
        )}

        {/* Patches tab */}
        {activeTab === 'patches' && (
          <>
            {!scanResult || scanResult.patchSessions.length === 0
              ? (
                <div className="flex flex-col items-center justify-center py-12 gap-3 text-center">
                  <CheckCircle2 className="w-10 h-10 text-green-400" />
                  <p className="text-sm font-semibold text-green-400">No Urgent Patches Queued</p>
                  <p className="text-xs text-gray-500">Patch sessions are auto-generated for Critical and High CVEs.</p>
                </div>
              )
              : (
                <>
                  <p className="text-[11px] text-gray-500 mb-1">
                    {scanResult.patchSessions.length} patch session{scanResult.patchSessions.length > 1 ? 's' : ''} ready to dispatch.
                    Copy any prompt into a Cowork session to apply the fix.
                  </p>
                  {scanResult.patchSessions.map((session) => (
                    <PatchCard key={session.sessionId} session={session} />
                  ))}
                </>
              )
            }
          </>
        )}
      </div>

      {/* ── Footer ──────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-4 py-2 border-t border-gray-800 flex-shrink-0 text-[11px] text-gray-600">
        <span>Sources: NVD · GitHub Advisory · Snyk · OWASP</span>
        <span>SEC4 · PowerOn Hub</span>
      </div>

    </div>
  )
}

export default ThreatMonitorPanel
