/**
 * V15rAppBrainTab.tsx - Admin App Brain | Phase 1 foundation
 *
 * Premium command-center shell for the future 3D neural architecture map.
 * Admin-only via V15rLayout nav (isAdmin + owner) + AppShell route.
 * No customer data, mutations, or live metrics in Phase 1.
 */

import { Cpu, GitBranch, Layers, ShieldAlert, Sparkles } from 'lucide-react'

const STATUS_CARDS = [
  { label: 'Components', hint: 'Repo modules & views', accent: '#22d3ee' },
  { label: 'Connections', hint: 'Imports & data flow', accent: '#34d399' },
  { label: 'Shared systems', hint: 'Services & stores', accent: '#a78bfa' },
  { label: 'Risk zones', hint: 'Overlap & coupling', accent: '#fbbf24' },
] as const

const ROADMAP = [
  { phase: 'Phase 2', title: '3D neural render', detail: 'Rotational app graph with glowing nodes' },
  { phase: 'Phase 3', title: 'Architecture manifest', detail: 'Generated repo structure & clusters' },
  { phase: 'Phase 4', title: 'Git / commit live updates', detail: 'Changed files & activity overlay' },
  { phase: 'Phase 5', title: 'Agent overlap detection', detail: 'Safe work zones for concurrent agents' },
] as const

function NeuralMapPlaceholder() {
  const nodes = [
    { x: 22, y: 28, r: 5, delay: 0 },
    { x: 48, y: 18, r: 6, delay: 0.4 },
    { x: 72, y: 32, r: 5, delay: 0.8 },
    { x: 35, y: 55, r: 4, delay: 1.2 },
    { x: 58, y: 48, r: 7, delay: 0.6 },
    { x: 78, y: 62, r: 5, delay: 1.0 },
    { x: 18, y: 68, r: 4, delay: 1.4 },
    { x: 50, y: 72, r: 6, delay: 0.2 },
  ]

  return (
    <div
      className="relative w-full h-full min-h-[280px] rounded-xl overflow-hidden"
      style={{
        background: 'radial-gradient(ellipse 80% 60% at 50% 45%, rgba(34,211,238,0.08) 0%, transparent 70%), linear-gradient(180deg, #0c1222 0%, #070b14 100%)',
        border: '1px solid rgba(34,211,238,0.15)',
        boxShadow: 'inset 0 0 60px rgba(34,211,238,0.04), 0 0 40px rgba(34,211,238,0.06)',
      }}
    >
      <svg className="absolute inset-0 w-full h-full" viewBox="0 0 100 100" preserveAspectRatio="none">
        <defs>
          <linearGradient id="appBrainLineGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#22d3ee" stopOpacity="0.5" />
            <stop offset="100%" stopColor="#a78bfa" stopOpacity="0.35" />
          </linearGradient>
        </defs>
        {[
          [22, 28, 48, 18],
          [48, 18, 72, 32],
          [48, 18, 58, 48],
          [35, 55, 58, 48],
          [58, 48, 78, 62],
          [18, 68, 35, 55],
          [50, 72, 58, 48],
          [72, 32, 78, 62],
        ].map(([x1, y1, x2, y2], i) => (
          <line
            key={i}
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
            stroke="url(#appBrainLineGrad)"
            strokeWidth="0.35"
            strokeDasharray="2 1.5"
            opacity={0.7}
            className="app-brain-pulse-line"
            style={{ animationDelay: `${i * 0.15}s` }}
          />
        ))}
        {nodes.map((n, i) => (
          <g key={i}>
            <circle cx={n.x} cy={n.y} r={n.r * 1.8} fill="rgba(34,211,238,0.12)" className="app-brain-node-glow" style={{ animationDelay: `${n.delay}s` }} />
            <circle cx={n.x} cy={n.y} r={n.r * 0.55} fill="#22d3ee" opacity={0.9} className="app-brain-node-core" style={{ animationDelay: `${n.delay}s` }} />
          </g>
        ))}
      </svg>
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage: 'linear-gradient(rgba(34,211,238,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(34,211,238,0.04) 1px, transparent 1px)',
          backgroundSize: '24px 24px',
        }}
      />
      <div className="absolute bottom-3 left-0 right-0 flex justify-center">
        <span
          className="text-[10px] font-mono uppercase tracking-widest px-3 py-1 rounded-full"
          style={{ color: '#67e8f9', backgroundColor: 'rgba(34,211,238,0.1)', border: '1px solid rgba(34,211,238,0.25)' }}
        >
          Phase 1 - visual foundation
        </span>
      </div>
      <style>{`
        @keyframes appBrainPulseLine {
          0%, 100% { stroke-opacity: 0.35; }
          50% { stroke-opacity: 0.85; }
        }
        @keyframes appBrainNodeGlow {
          0%, 100% { opacity: 0.5; transform-origin: center; }
          50% { opacity: 1; }
        }
        @keyframes appBrainNodeCore {
          0%, 100% { opacity: 0.7; }
          50% { opacity: 1; }
        }
        .app-brain-pulse-line { animation: appBrainPulseLine 3s ease-in-out infinite; }
        .app-brain-node-glow { animation: appBrainNodeGlow 2.5s ease-in-out infinite; }
        .app-brain-node-core { animation: appBrainNodeCore 2s ease-in-out infinite; }
      `}</style>
    </div>
  )
}

export default function V15rAppBrainTab() {
  return (
    <div
      className="w-full min-h-full overflow-auto"
      style={{ background: 'linear-gradient(165deg, #060a12 0%, #0a1020 45%, #070b14 100%)', color: '#e5e7eb' }}
    >
      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-6 space-y-6">
        <header className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Cpu size={20} style={{ color: '#22d3ee' }} />
              <span className="text-[10px] font-bold uppercase tracking-[0.2em]" style={{ color: '#22d3ee' }}>
                Admin / Architecture
              </span>
            </div>
            <h1 className="text-2xl font-bold text-gray-50 tracking-tight">App Brain</h1>
            <p className="text-sm text-gray-400 mt-1">Live architecture brain for Power On Hub</p>
          </div>
          <span
            className="self-start sm:self-auto text-[10px] font-mono uppercase tracking-wider px-3 py-1.5 rounded-lg"
            style={{ color: '#94a3b8', backgroundColor: 'rgba(148,163,184,0.08)', border: '1px solid rgba(148,163,184,0.2)' }}
          >
            Foundation / no live data yet
          </span>
        </header>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {STATUS_CARDS.map((card) => (
            <div
              key={card.label}
              className="rounded-xl p-4"
              style={{
                background: 'rgba(15,23,42,0.7)',
                border: `1px solid ${card.accent}22`,
                boxShadow: `0 0 24px ${card.accent}08`,
              }}
            >
              <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-1">{card.label}</p>
              <p className="text-lg font-bold font-mono" style={{ color: card.accent }}>Planned</p>
              <p className="text-[11px] text-gray-500 mt-2">{card.hint}</p>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-[1fr_300px] gap-4">
          <section
            className="rounded-2xl p-4 sm:p-5 flex flex-col gap-4"
            style={{
              background: 'rgba(12,18,34,0.85)',
              border: '1px solid rgba(34,211,238,0.12)',
              boxShadow: '0 8px 32px rgba(0,0,0,0.35)',
            }}
          >
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-gray-200 flex items-center gap-2">
                <Sparkles size={16} style={{ color: '#22d3ee' }} />
                3D neural app map
              </h2>
              <span className="text-[10px] text-gray-500 font-mono">Coming in Phase 2</span>
            </div>
            <NeuralMapPlaceholder />
            <p className="text-xs text-gray-500 leading-relaxed">
              Premium rotational neural map of app areas, components, and connections. Phase 1 establishes the command shell only - no Three.js graph or repo ingestion yet.
            </p>
          </section>

          <aside
            className="rounded-2xl p-4 flex flex-col gap-4"
            style={{
              background: 'rgba(12,18,34,0.85)',
              border: '1px solid rgba(167,139,250,0.15)',
              boxShadow: '0 8px 32px rgba(0,0,0,0.35)',
            }}
          >
            <h2 className="text-sm font-semibold text-gray-200 flex items-center gap-2">
              <Layers size={16} style={{ color: '#a78bfa' }} />
              Brain Inspector
            </h2>
            <div
              className="flex-1 min-h-[200px] rounded-xl flex flex-col items-center justify-center text-center px-4 py-8"
              style={{ background: 'rgba(7,11,20,0.8)', border: '1px dashed rgba(167,139,250,0.25)' }}
            >
              <ShieldAlert size={28} className="mb-3 opacity-40" style={{ color: '#a78bfa' }} />
              <p className="text-xs text-gray-400">Select a node on the map to inspect component details, dependencies, and risk context.</p>
              <p className="text-[10px] text-gray-600 mt-2 font-mono">Inspector activates with Phase 2 map</p>
            </div>
          </aside>
        </div>

        <section
          className="rounded-2xl p-4 sm:p-5"
          style={{
            background: 'rgba(12,18,34,0.85)',
            border: '1px solid rgba(52,211,153,0.12)',
          }}
        >
          <h2 className="text-sm font-semibold text-gray-200 flex items-center gap-2 mb-4">
            <GitBranch size={16} style={{ color: '#34d399' }} />
            Phase roadmap
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {ROADMAP.map((item, i) => (
              <div
                key={item.title}
                className="rounded-xl p-3"
                style={{
                  background: i === 0 ? 'rgba(34,211,238,0.06)' : 'rgba(15,23,42,0.5)',
                  border: i === 0 ? '1px solid rgba(34,211,238,0.25)' : '1px solid rgba(55,65,81,0.4)',
                }}
              >
                <span className="text-[9px] font-bold uppercase tracking-wider" style={{ color: i === 0 ? '#22d3ee' : '#6b7280' }}>
                  {item.phase}
                </span>
                <p className="text-sm font-medium text-gray-200 mt-1">{item.title}</p>
                <p className="text-[11px] text-gray-500 mt-1 leading-snug">{item.detail}</p>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}
