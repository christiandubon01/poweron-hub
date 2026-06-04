/**
 * V15rAppBrainTab.tsx - Admin App Brain | Phase 2 Three.js MVP
 *
 * Admin-only via V15rLayout nav (isAdmin + owner) + AppShell route.
 * Static architecture map only: no customer data, mutations, or live git claims.
 */

import { useMemo, useState } from 'react'
import { Cpu, GitBranch, Layers, Network, ShieldAlert, Sparkles } from 'lucide-react'
import V15rAppBrainScene from './V15rAppBrainScene'
import {
  APP_BRAIN_CATEGORY_META,
  APP_BRAIN_EDGES,
  APP_BRAIN_NODES,
  APP_BRAIN_RISK_META,
  getAppBrainNode,
  type AppBrainNode,
  type AppBrainNodeCategory,
  type AppBrainRiskLevel,
} from './appBrainMap'

const ROADMAP = [
  { phase: 'Phase 2', title: '3D neural render', detail: 'Static architecture MVP with interactive nodes' },
  { phase: 'Phase 3', title: 'Architecture manifest', detail: 'Generated repo structure and clusters' },
  { phase: 'Phase 4', title: 'Git / commit live updates', detail: 'Changed files and activity overlay' },
  { phase: 'Phase 5', title: 'Agent overlap detection', detail: 'Safe work zones for concurrent agents' },
] as const

const CATEGORY_ORDER: AppBrainNodeCategory[] = [
  'shell',
  'core',
  'admin',
  'project',
  'field',
  'blueprint',
  'materials',
  'ai',
  'shared',
  'data',
]

function riskCount(riskLevel: AppBrainRiskLevel): number {
  return APP_BRAIN_NODES.filter((node) => node.riskLevel === riskLevel).length
}

function StatusCards() {
  const statusCards = [
    { label: 'Components', value: String(APP_BRAIN_NODES.length), hint: 'Static architecture nodes', accent: '#22d3ee' },
    { label: 'Connections', value: String(APP_BRAIN_EDGES.length), hint: 'Mapped dependency links', accent: '#34d399' },
    { label: 'Shared systems', value: String(APP_BRAIN_NODES.filter((node) => node.category === 'shared' || node.category === 'data').length), hint: 'Services, stores, persistence', accent: '#a78bfa' },
    { label: 'Risk zones', value: String(riskCount('high')), hint: 'Manual risk markers', accent: '#fbbf24' },
  ]

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {statusCards.map((card) => (
        <div
          key={card.label}
          className="rounded-xl p-4"
          style={{
            background: 'linear-gradient(145deg, rgba(15,23,42,0.82), rgba(3,7,18,0.72))',
            border: `1px solid ${card.accent}24`,
            boxShadow: `0 0 28px ${card.accent}0d`,
          }}
        >
          <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-1">{card.label}</p>
          <p className="text-2xl font-bold font-mono" style={{ color: card.accent }}>{card.value}</p>
          <p className="text-[11px] text-gray-500 mt-2">{card.hint}</p>
        </div>
      ))}
    </div>
  )
}

function CategoryLegend() {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
      {CATEGORY_ORDER.map((category) => {
        const meta = APP_BRAIN_CATEGORY_META[category]
        return (
          <div
            key={category}
            className="flex items-center gap-2 rounded-lg px-2.5 py-2"
            style={{
              background: 'rgba(3,7,18,0.46)',
              border: `1px solid ${meta.color}24`,
            }}
          >
            <span
              className="h-2.5 w-2.5 rounded-full shrink-0"
              style={{ backgroundColor: meta.color, boxShadow: `0 0 12px ${meta.color}` }}
            />
            <span className="text-[10px] text-gray-400 truncate">{meta.label}</span>
          </div>
        )
      })}
    </div>
  )
}

function Inspector({ node }: { node: AppBrainNode | null }) {
  const categoryMeta = node ? APP_BRAIN_CATEGORY_META[node.category] : null
  const riskMeta = node ? APP_BRAIN_RISK_META[node.riskLevel] : null

  return (
    <aside
      className="rounded-2xl p-4 flex flex-col gap-4"
      style={{
        background: 'linear-gradient(180deg, rgba(12,18,34,0.9), rgba(3,7,18,0.86))',
        border: '1px solid rgba(167,139,250,0.15)',
        boxShadow: '0 8px 32px rgba(0,0,0,0.35)',
      }}
    >
      <h2 className="text-sm font-semibold text-gray-200 flex items-center gap-2">
        <Layers size={16} style={{ color: '#a78bfa' }} />
        Brain Inspector
      </h2>

      {node && categoryMeta && riskMeta ? (
        <div className="space-y-4">
          <div
            className="rounded-xl p-4"
            style={{
              background: `linear-gradient(145deg, ${categoryMeta.glow}, rgba(3,7,18,0.72))`,
              border: `1px solid ${categoryMeta.color}33`,
            }}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[10px] uppercase tracking-widest font-semibold" style={{ color: categoryMeta.color }}>
                  {categoryMeta.label}
                </p>
                <h3 className="text-xl font-bold text-gray-50 mt-1">{node.label}</h3>
              </div>
              <span
                className="text-[10px] uppercase tracking-wider font-mono px-2 py-1 rounded-full"
                style={{
                  color: riskMeta.color,
                  backgroundColor: `${riskMeta.color}14`,
                  border: `1px solid ${riskMeta.color}33`,
                }}
              >
                {riskMeta.label} risk
              </span>
            </div>
            <p className="text-xs text-gray-300 leading-relaxed mt-3">{node.description}</p>
          </div>

          <div>
            <p className="text-[10px] uppercase tracking-widest text-gray-500 mb-2">Related files</p>
            <div className="space-y-1.5">
              {node.relatedFiles.map((file) => (
                <div
                  key={file}
                  className="text-[11px] font-mono rounded-lg px-2 py-1.5 text-gray-300"
                  style={{ background: 'rgba(15,23,42,0.7)', border: '1px solid rgba(148,163,184,0.12)' }}
                >
                  {file}
                </div>
              ))}
            </div>
          </div>

          <div>
            <p className="text-[10px] uppercase tracking-widest text-gray-500 mb-2">Connections</p>
            <div className="flex flex-wrap gap-1.5">
              {node.connections.map((connectionId) => {
                const connectedNode = getAppBrainNode(connectionId)
                return (
                  <span
                    key={connectionId}
                    className="text-[10px] rounded-full px-2 py-1"
                    style={{ color: '#cbd5e1', background: 'rgba(30,41,59,0.72)', border: '1px solid rgba(148,163,184,0.14)' }}
                  >
                    {connectedNode?.label ?? connectionId}
                  </span>
                )
              })}
            </div>
          </div>
        </div>
      ) : (
        <div
          className="flex-1 min-h-[280px] rounded-xl flex flex-col items-center justify-center text-center px-4 py-8"
          style={{ background: 'rgba(7,11,20,0.8)', border: '1px dashed rgba(167,139,250,0.25)' }}
        >
          <ShieldAlert size={28} className="mb-3 opacity-40" style={{ color: '#a78bfa' }} />
          <p className="text-xs text-gray-400">Click a glowing node to inspect architecture details, related files, risk, and connections.</p>
          <p className="text-[10px] text-gray-600 mt-2 font-mono">Hover previews / click locks selection</p>
        </div>
      )}
    </aside>
  )
}

export default function V15rAppBrainTab() {
  const [selectedNodeId, setSelectedNodeId] = useState<string>('app-brain')
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null)
  const activeNode = useMemo(
    () => getAppBrainNode(hoveredNodeId) ?? getAppBrainNode(selectedNodeId),
    [hoveredNodeId, selectedNodeId],
  )

  return (
    <div
      className="w-full min-h-full overflow-auto"
      style={{ background: 'linear-gradient(165deg, #050814 0%, #0a1020 45%, #05070d 100%)', color: '#e5e7eb' }}
    >
      <div className="max-w-[1480px] mx-auto px-4 sm:px-6 py-6 space-y-6">
        <header className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
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
          <div className="flex flex-wrap gap-2">
            <span
              className="text-[10px] font-mono uppercase tracking-wider px-3 py-1.5 rounded-lg"
              style={{ color: '#67e8f9', backgroundColor: 'rgba(34,211,238,0.08)', border: '1px solid rgba(34,211,238,0.22)' }}
            >
              Phase 2 / static architecture MVP
            </span>
            <span
              className="text-[10px] font-mono uppercase tracking-wider px-3 py-1.5 rounded-lg"
              style={{ color: '#94a3b8', backgroundColor: 'rgba(148,163,184,0.08)', border: '1px solid rgba(148,163,184,0.2)' }}
            >
              Generated manifests and git overlays later
            </span>
          </div>
        </header>

        <StatusCards />

        <div className="grid grid-cols-1 xl:grid-cols-[1fr_360px] gap-4">
          <section
            className="rounded-2xl p-4 sm:p-5 flex flex-col gap-4"
            style={{
              background: 'linear-gradient(180deg, rgba(12,18,34,0.9), rgba(3,7,18,0.82))',
              border: '1px solid rgba(34,211,238,0.14)',
              boxShadow: '0 8px 36px rgba(0,0,0,0.42)',
            }}
          >
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <h2 className="text-sm font-semibold text-gray-200 flex items-center gap-2">
                <Sparkles size={16} style={{ color: '#22d3ee' }} />
                3D neural app map
              </h2>
              <span className="text-[10px] text-gray-500 font-mono">Static map / no live repo scan yet</span>
            </div>

            <div
              className="rounded-xl overflow-hidden min-h-[420px]"
              style={{
                background:
                  'radial-gradient(circle at 50% 44%, rgba(34,211,238,0.1), transparent 48%), linear-gradient(180deg, #070b14 0%, #030712 100%)',
                border: '1px solid rgba(34,211,238,0.16)',
                boxShadow: 'inset 0 0 80px rgba(34,211,238,0.05), 0 0 40px rgba(34,211,238,0.08)',
              }}
            >
              <V15rAppBrainScene
                selectedNodeId={selectedNodeId}
                hoveredNodeId={hoveredNodeId}
                onSelectNode={setSelectedNodeId}
                onHoverNode={setHoveredNodeId}
              />
            </div>

            <CategoryLegend />

            <p className="text-xs text-gray-500 leading-relaxed">
              This is a static architecture MVP built with the existing Three.js dependency. Nodes, connections, and risk markers are typed map data for Phase 2; generated repo manifests, changed-file activity, and live git overlays are intentionally deferred.
            </p>
          </section>

          <Inspector node={activeNode} />
        </div>

        <section
          className="rounded-2xl p-4 sm:p-5"
          style={{
            background: 'linear-gradient(180deg, rgba(12,18,34,0.88), rgba(3,7,18,0.76))',
            border: '1px solid rgba(52,211,153,0.12)',
          }}
        >
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-4">
            <h2 className="text-sm font-semibold text-gray-200 flex items-center gap-2">
              <GitBranch size={16} style={{ color: '#34d399' }} />
              Phase roadmap
            </h2>
            <span className="text-[10px] text-gray-500 font-mono flex items-center gap-1.5">
              <Network size={12} />
              Architecture data is static in this release
            </span>
          </div>
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
