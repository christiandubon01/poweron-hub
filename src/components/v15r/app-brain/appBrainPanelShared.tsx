import type { ReactNode } from 'react'
import { BookMarked } from 'lucide-react'
import type { FrictionLevel } from './appBrainRulesTypes'
import { APP_BRAIN_SEED_SOURCE_NOTE } from './appBrainSeedData'

export const FRICTION_META: Record<FrictionLevel, { label: string; color: string }> = {
  silent: { label: 'Silent', color: '#94a3b8' },
  warn: { label: 'Warn', color: '#facc15' },
  confirm: { label: 'Confirm', color: '#fb923c' },
  block: { label: 'Block', color: '#fb7185' },
}

export function panelSectionStyle(accent = 'rgba(34,211,238,0.12)') {
  return {
    background: 'linear-gradient(145deg, rgba(12,18,34,0.88), rgba(3,7,18,0.78))',
    border: `1px solid ${accent}`,
  }
}

export function ReadOnlyBadge() {
  return (
    <span
      className="text-[10px] font-mono uppercase tracking-wider px-3 py-1.5 rounded-lg"
      style={{ color: '#94a3b8', background: 'rgba(148,163,184,0.08)', border: '1px solid rgba(148,163,184,0.18)' }}
    >
      Read-only · static seed
    </span>
  )
}

export function SeedSourceNote() {
  return (
    <p className="text-[11px] text-gray-500 leading-relaxed font-mono">{APP_BRAIN_SEED_SOURCE_NOTE}</p>
  )
}

export function AppBrainPanelShell({
  title,
  subtitle,
  icon,
  accent = '#22d3ee',
  children,
}: {
  title: string
  subtitle: string
  icon: ReactNode
  accent?: string
  children: ReactNode
}) {
  return (
    <section className="rounded-2xl p-4 sm:p-5 space-y-4" style={panelSectionStyle(`${accent}22`)}>
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span style={{ color: accent }}>{icon}</span>
            <p className="text-[10px] uppercase tracking-[0.2em] font-bold" style={{ color: accent }}>
              Control Tower
            </p>
          </div>
          <h2 className="text-lg font-semibold text-gray-100">{title}</h2>
          <p className="text-xs text-gray-500 mt-1">{subtitle}</p>
        </div>
        <ReadOnlyBadge />
      </div>
      <SeedSourceNote />
      {children}
    </section>
  )
}

export function StatCard({ label, value, color }: { label: string; value: string | number; color: string }) {
  return (
    <div className="rounded-xl p-3" style={{ background: 'rgba(3,7,18,0.56)', border: `1px solid ${color}24` }}>
      <p className="text-[10px] uppercase tracking-wider text-gray-500">{label}</p>
      <p className="text-xl font-mono font-bold mt-1" style={{ color }}>{value}</p>
    </div>
  )
}

export function FrictionPill({ friction }: { friction: FrictionLevel }) {
  const meta = FRICTION_META[friction]
  return (
    <span
      className="text-[10px] uppercase tracking-wider font-mono px-2 py-1 rounded-full"
      style={{ color: meta.color, backgroundColor: `${meta.color}14`, border: `1px solid ${meta.color}33` }}
    >
      {meta.label}
    </span>
  )
}

export function EmptyState({ message }: { message: string }) {
  return (
    <div
      className="rounded-xl p-6 flex flex-col items-center justify-center text-center"
      style={{ background: 'rgba(7,11,20,0.8)', border: '1px dashed rgba(148,163,184,0.25)' }}
    >
      <BookMarked size={24} className="mb-2 opacity-40 text-gray-500" />
      <p className="text-sm text-gray-400">{message}</p>
    </div>
  )
}
