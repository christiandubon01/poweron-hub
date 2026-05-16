// @ts-nocheck
/**
 * ProjectCard — shared project card component.
 * Extracted from V15rProjectsPanel so both the Projects tab and
 * Home tab Job Health section render the exact same card design,
 * data logic, and scanner helpers.
 */

import { Home, Building2, Wrench, Sun, Hammer, Store, FolderKanban, Edit3, Trash2, ArrowRight, RotateCcw, Eye, Archive } from 'lucide-react'
import {
  health,
  getOverallCompletion,
  getProjectFinancials,
  fmtK,
  pct,
} from '@/services/backupDataService'
import { getProjectDaysSinceLastMovement } from '@/utils/v15rProjectHealth'
import type { BackupProject } from '@/services/backupDataService'

// ── Project type accent config (matches V15rProjectsPanel exactly) ────────────
export const PROJECT_TYPE_STYLE: Record<string, { icon: any; gradient: string; border: string; glow: string; iconBg: string; iconColor: string; barGradient: string }> = {
  'Residential':      { icon: Home,         gradient: 'linear-gradient(135deg,#0f172a 0%,#020617 60%,rgba(13,42,30,0.6) 100%)',  border: 'rgba(45,212,191,0.22)',  glow: 'rgba(45,212,191,0.07)',  iconBg: 'rgba(45,212,191,0.13)',  iconColor: '#2dd4bf', barGradient: 'linear-gradient(90deg,rgba(45,212,191,0.6),rgba(52,211,153,1))' },
  'Commercial':       { icon: Building2,    gradient: 'linear-gradient(135deg,#0f172a 0%,#020617 60%,rgba(10,25,50,0.6) 100%)',   border: 'rgba(99,179,237,0.22)',  glow: 'rgba(99,179,237,0.07)',  iconBg: 'rgba(99,179,237,0.13)',  iconColor: '#63b3ed', barGradient: 'linear-gradient(90deg,rgba(59,130,246,0.6),rgba(99,179,237,1))' },
  'Service':          { icon: Wrench,       gradient: 'linear-gradient(135deg,#0f172a 0%,#020617 60%,rgba(50,20,5,0.6) 100%)',    border: 'rgba(251,146,60,0.22)',  glow: 'rgba(251,146,60,0.07)',  iconBg: 'rgba(251,146,60,0.13)',  iconColor: '#fb923c', barGradient: 'linear-gradient(90deg,rgba(251,146,60,0.6),rgba(249,115,22,1))' },
  'Solar':            { icon: Sun,          gradient: 'linear-gradient(135deg,#0f172a 0%,#020617 60%,rgba(50,35,5,0.6) 100%)',    border: 'rgba(251,191,36,0.22)',  glow: 'rgba(251,191,36,0.07)',  iconBg: 'rgba(251,191,36,0.13)',  iconColor: '#fbbf24', barGradient: 'linear-gradient(90deg,rgba(251,191,36,0.6),rgba(245,158,11,1))' },
  'New Construction': { icon: Hammer,       gradient: 'linear-gradient(135deg,#0f172a 0%,#020617 60%,rgba(30,10,60,0.6) 100%)',   border: 'rgba(139,92,246,0.22)',  glow: 'rgba(139,92,246,0.07)',  iconBg: 'rgba(139,92,246,0.13)', iconColor: '#8b5cf6', barGradient: 'linear-gradient(90deg,rgba(139,92,246,0.6),rgba(124,58,237,1))' },
  'Commercial TI':    { icon: Store,        gradient: 'linear-gradient(135deg,#0f172a 0%,#020617 60%,rgba(5,35,50,0.6) 100%)',    border: 'rgba(34,211,238,0.22)',  glow: 'rgba(34,211,238,0.07)',  iconBg: 'rgba(34,211,238,0.13)', iconColor: '#22d3ee', barGradient: 'linear-gradient(90deg,rgba(34,211,238,0.6),rgba(6,182,212,1))' },
}
export const PROJECT_TYPE_DEFAULT_STYLE = { icon: FolderKanban, gradient: 'linear-gradient(135deg,#0f172a 0%,#020617 60%,rgba(15,20,35,0.6) 100%)', border: 'rgba(148,163,184,0.18)', glow: 'rgba(148,163,184,0.06)', iconBg: 'rgba(148,163,184,0.10)', iconColor: '#94a3b8', barGradient: 'linear-gradient(90deg,rgba(52,211,153,0.6),rgba(52,211,153,1))' }

export const PROJ_GLARE_MS = 5200

function fmtDate(dateStr?: string): string {
  if (!dateStr) return ''
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// ── CSS animation injected once per page load ─────────────────────────────────
let _stylesInjected = false
function ensureProjectCardStyles() {
  if (_stylesInjected || typeof document === 'undefined') return
  _stylesInjected = true
  const el = document.createElement('style')
  el.id = 'proj-card-styles'
  el.textContent = `
    @keyframes proj-card-glare {
      0%   { transform: translateX(-120%) skewX(-18deg); opacity: 0; }
      12%  { opacity: 0.55; }
      50%  { opacity: 0.30; }
      88%  { opacity: 0; }
      100% { transform: translateX(220%) skewX(-18deg); opacity: 0; }
    }
    .proj-card-glare::before {
      content: '';
      position: absolute;
      top: 0; bottom: 0; left: 0;
      width: 40%;
      background: linear-gradient(
        115deg,
        rgba(255,255,255,0) 0%,
        rgba(255,255,255,0.04) 35%,
        rgba(255,255,255,0.10) 50%,
        rgba(255,255,255,0.04) 65%,
        rgba(255,255,255,0) 100%
      );
      animation: proj-card-glare ${PROJ_GLARE_MS}ms cubic-bezier(0.45,0.05,0.55,0.95) infinite;
      animation-delay: inherit;
      will-change: transform, opacity;
    }
    @media (prefers-reduced-motion: reduce) {
      .proj-card-glare::before { animation: none; opacity: 0; }
    }
  `
  document.head.appendChild(el)
}

// ── Component ─────────────────────────────────────────────────────────────────

interface ProjectCardProps {
  p: BackupProject
  backup: any
  bucket?: string
  highlightId?: string | null
  onSelect?: (id: string) => void
  onEdit?: () => void
  onMoveStatus?: (toStatus: string) => void
  onMarkLost?: () => void
  onArchive?: () => void
  onDelete?: () => void
  onCollect?: () => void
}

export function ProjectCard({
  p,
  backup,
  bucket = 'active',
  highlightId,
  onSelect,
  onEdit,
  onMoveStatus,
  onMarkLost,
  onArchive,
  onDelete,
  onCollect,
}: ProjectCardProps) {
  ensureProjectCardStyles()

  const h = health(p, backup)
  const o = getOverallCompletion(p, backup)
  const staleDays = getProjectDaysSinceLastMovement(p, backup)
  const openR = (p.rfis || []).filter((r: any) => r.status !== 'answered').length
  const fin = getProjectFinancials(p, backup)
  const paidPercent = fin.contract > 0 ? Math.min(100, Math.max(0, (fin.paid / fin.contract) * 100)) : 0

  const plannedLine = (p.plannedStart && p.plannedEnd)
    ? `Planned: ${fmtDate(p.plannedStart)} – ${fmtDate(p.plannedEnd)}`
    : null

  const ts = PROJECT_TYPE_STYLE[p.type] || PROJECT_TYPE_DEFAULT_STYLE
  const TypeIcon = ts.icon

  const hasActions = !!(onEdit || onDelete || onMoveStatus || onMarkLost || onArchive || onSelect)

  return (
    <div
      data-project-id={p.id}
      className={`relative overflow-hidden rounded-2xl transition-all duration-300 hover:-translate-y-0.5 ${highlightId === String(p.id) ? 'ring-2 ring-cyan-400/70' : ''}`}
      style={{
        background: ts.gradient,
        border: `1px solid ${ts.border}`,
        boxShadow: `0 4px 24px ${ts.glow}, 0 1px 6px rgba(0,0,0,0.45)`,
      }}
    >
      {/* Animated glare sweep */}
      <span
        aria-hidden="true"
        className="proj-card-glare pointer-events-none absolute inset-0 overflow-hidden rounded-2xl"
        style={{ animationDelay: `-${(parseInt(p.id.slice(-4), 36) || 0) % PROJ_GLARE_MS}ms` }}
      />

      <div className="relative z-10 p-4">
        {/* Header: icon + name/type + health */}
        <div className="flex items-start justify-between mb-3 gap-2">
          <div
            className="flex items-start gap-2.5 cursor-pointer flex-1 min-w-0"
            onClick={() => onSelect?.(p.id)}
          >
            {/* Type icon badge */}
            <div
              className="flex-shrink-0 w-8 h-8 rounded-xl flex items-center justify-center mt-0.5"
              style={{
                background: ts.iconBg,
                border: `1px solid ${ts.border}`,
                boxShadow: `0 0 10px ${ts.glow}`,
              }}
            >
              <TypeIcon size={14} style={{ color: ts.iconColor }} />
            </div>
            <div className="min-w-0">
              <div className="font-bold text-sm text-gray-100 leading-tight truncate">{p.name}</div>
              <div className="text-[10px] mt-0.5 font-medium" style={{ color: ts.iconColor }}>{p.type}</div>
              {plannedLine && (
                <div className="text-[9px] text-gray-500 mt-0.5">{plannedLine}</div>
              )}
            </div>
          </div>
          {/* Health score */}
          <div className="text-right flex-shrink-0">
            <div className="text-xl font-bold font-mono leading-none" style={{ color: h.clr }}>{h.sc}</div>
            <div className="text-[9px] text-gray-500 mt-0.5">Health</div>
          </div>
        </div>

        {/* Financial metrics */}
        <div className="grid grid-cols-3 gap-1.5 mb-2.5 text-[10px]">
          {[
            { label: 'Quoted',   value: fmtK(fin.contract), color: '#e5e7eb' },
            { label: 'Paid',     value: fmtK(fin.paid),     color: '#34d399' },
            { label: 'Exposure', value: fmtK(fin.risk),     color: '#f87171' },
          ].map(({ label, value, color }) => (
            <div
              key={label}
              className="rounded-lg p-1.5 text-center"
              style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}
            >
              <div className="text-gray-500 uppercase font-bold text-[9px]">{label}</div>
              <div className="font-mono font-semibold" style={{ color }}>{value}</div>
            </div>
          ))}
        </div>

        {/* Premium paid progress bar */}
        <div
          className="w-full h-1.5 rounded-full mb-2.5 overflow-hidden"
          style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.04)' }}
        >
          <div
            className="h-full rounded-full transition-all duration-700"
            style={{
              width: `${paidPercent}%`,
              background: ts.barGradient,
              boxShadow: paidPercent > 0 ? '0 0 6px rgba(52,211,153,0.45)' : 'none',
            }}
          />
        </div>

        {/* Status chips */}
        <div className="flex flex-wrap gap-1.5 mb-2.5">
          {staleDays === null ? (
            <span className="text-[9px] px-2 py-0.5 rounded-full font-semibold bg-slate-500/20 text-slate-400">no log yet</span>
          ) : (
            <span className={`text-[9px] px-2 py-0.5 rounded-full font-semibold ${
              staleDays >= 14 ? 'bg-red-500/20 text-red-400' : staleDays >= 7 ? 'bg-yellow-500/20 text-yellow-400' : 'bg-emerald-500/20 text-emerald-400'
            }`}>{staleDays}d stale</span>
          )}
          <span className="text-[9px] px-2 py-0.5 rounded-full font-semibold bg-blue-500/20 text-blue-400">
            {pct(Math.round(o))}
          </span>
          {openR > 0 && (
            <span className="text-[9px] px-2 py-0.5 rounded-full font-semibold bg-red-500/20 text-red-400">
              {openR} RFI
            </span>
          )}
          {bucket === 'completed' && (
            fin.AR > 0 ? (
              <span
                className="text-[9px] px-2 py-0.5 rounded-full font-semibold bg-orange-500/20 text-orange-400 border border-orange-500/30"
                title={`Outstanding balance: ${fmtK(fin.AR)}`}
              >
                🚨 UNPAID {fmtK(fin.AR)}
              </span>
            ) : (
              <span className="text-[9px] px-2 py-0.5 rounded-full font-semibold bg-emerald-500/20 text-emerald-400">
                ✓ Fully Paid
              </span>
            )
          )}
          {bucket === 'completed' && fin.contract - fin.paid > 0 && onCollect && (
            <button
              onClick={e => { e.stopPropagation(); onCollect() }}
              className="text-[9px] px-2 py-0.5 rounded-full font-bold bg-yellow-400/20 text-yellow-300 border border-yellow-400/40 hover:bg-yellow-400/30 transition-colors"
            >
              💰 Collect
            </button>
          )}
        </div>

        {/* Actions — only rendered when at least one action handler is provided */}
        {hasActions && (
          <div className="flex gap-1.5 pt-2" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
            {bucket !== 'completed' ? (
              <>
                {onEdit && (
                  <button
                    onClick={onEdit}
                    className="flex-1 text-[10px] px-2 py-1.5 rounded-lg font-semibold transition-colors hover:brightness-125"
                    style={{ background: 'rgba(255,255,255,0.07)', color: '#d1d5db', border: '1px solid rgba(255,255,255,0.08)' }}
                  >
                    <Edit3 size={10} className="inline mr-1" /> Edit
                  </button>
                )}
                {onSelect && (
                  <button
                    onClick={() => onSelect(p.id)}
                    className="text-[10px] px-2 py-1.5 rounded-lg font-semibold transition-colors hover:brightness-125"
                    style={{ background: 'rgba(255,255,255,0.04)', color: '#9ca3af', border: '1px solid rgba(255,255,255,0.06)' }}
                    title="Open project tabs"
                  >
                    <Eye size={10} />
                  </button>
                )}
                {onMoveStatus && (
                  <button
                    onClick={() => onMoveStatus(bucket === 'active' ? 'coming' : 'active')}
                    className="text-[10px] px-2 py-1.5 rounded-lg font-semibold transition-colors hover:brightness-125"
                    style={{ background: 'rgba(99,179,237,0.10)', color: '#63b3ed', border: '1px solid rgba(99,179,237,0.20)' }}
                  >
                    <ArrowRight size={10} className="inline mr-1" /> {bucket === 'active' ? 'Coming Up' : 'Active'}
                  </button>
                )}
                {bucket === 'coming' && onMarkLost && (
                  <button
                    onClick={onMarkLost}
                    className="text-[10px] px-2 py-1.5 rounded-lg font-semibold transition-colors hover:brightness-125"
                    style={{ background: 'rgba(251,191,36,0.10)', color: '#fcd34d', border: '1px solid rgba(251,191,36,0.20)' }}
                  >
                    Mark Lost
                  </button>
                )}
                {onArchive && (
                  <button
                    onClick={onArchive}
                    className="text-[10px] px-2 py-1.5 rounded-lg font-semibold transition-colors hover:brightness-125"
                    style={{ background: 'rgba(148,163,184,0.08)', color: '#cbd5e1', border: '1px solid rgba(148,163,184,0.15)' }}
                  >
                    <Archive size={10} />
                  </button>
                )}
                {onDelete && (
                  <button
                    onClick={onDelete}
                    className="text-[10px] px-2 py-1.5 rounded-lg font-semibold transition-colors hover:brightness-125"
                    style={{ background: 'rgba(239,68,68,0.08)', color: '#f87171', border: '1px solid rgba(239,68,68,0.15)' }}
                  >
                    <Trash2 size={10} />
                  </button>
                )}
              </>
            ) : (
              <>
                {onSelect && (
                  <button
                    onClick={() => onSelect(p.id)}
                    className="flex-1 text-[10px] px-2 py-1.5 rounded-lg font-semibold transition-colors hover:brightness-125"
                    style={{ background: 'rgba(255,255,255,0.07)', color: '#d1d5db', border: '1px solid rgba(255,255,255,0.08)' }}
                  >
                    <Eye size={10} className="inline mr-1" /> View Project
                  </button>
                )}
                {onMoveStatus && (
                  <button
                    onClick={() => onMoveStatus('active')}
                    className="text-[10px] px-2 py-1.5 rounded-lg font-semibold transition-colors hover:brightness-125"
                    style={{ background: 'rgba(99,179,237,0.10)', color: '#63b3ed', border: '1px solid rgba(99,179,237,0.20)' }}
                  >
                    <RotateCcw size={10} className="inline mr-1" /> Reactivate
                  </button>
                )}
                {onArchive && (
                  <button
                    onClick={onArchive}
                    className="text-[10px] px-2 py-1.5 rounded-lg font-semibold transition-colors hover:brightness-125"
                    style={{ background: 'rgba(148,163,184,0.08)', color: '#cbd5e1', border: '1px solid rgba(148,163,184,0.15)' }}
                  >
                    <Archive size={10} />
                  </button>
                )}
                {onDelete && (
                  <button
                    onClick={onDelete}
                    className="text-[10px] px-2 py-1.5 rounded-lg font-semibold transition-colors hover:brightness-125"
                    style={{ background: 'rgba(239,68,68,0.08)', color: '#f87171', border: '1px solid rgba(239,68,68,0.15)' }}
                  >
                    <Trash2 size={10} />
                  </button>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export default ProjectCard
