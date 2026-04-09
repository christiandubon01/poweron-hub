/**
 * LegendPanel.tsx — NW37: Visual legend for all unlabeled Neural World objects.
 *
 * HUD button: "LEGEND" rendered in top-left area near the ? instructional button.
 * Opens a 350px slide-in panel from the left — dark glass, scrollable, 7 collapsible
 * sections with color-coded headers. Same HUD style as InstructionalOverlay.
 *
 * SECTIONS:
 *   1. Terrain & Structures  (amber)
 *   2. Agents                (teal)
 *   3. Human Workers         (amber-warm)
 *   4. Data Flows            (green)
 *   5. Fog Layers            (purple)
 *   6. Automation Flows      (cyan)
 *   7. Special Effects       (gold)
 */

import React, { useState, useCallback } from 'react'

// ── Types ─────────────────────────────────────────────────────────────────────

interface LegendItem {
  color: string
  icon: string
  name: string
  desc: string
  dimmed?: boolean
}

interface LegendSection {
  id: string
  title: string
  icon: string
  headerColor: string
  headerBg: string
  borderColor: string
  items: LegendItem[]
}

// ── Data ──────────────────────────────────────────────────────────────────────

// ── Mountain Materials section ────────────────────────────────────────────────
// NW38: each swatch uses a CSS gradient to mimic metallic/gem appearance

interface MaterialSwatch {
  gradient: string   // CSS background (linear-gradient for metallic look)
  glow:     string   // box-shadow color
  name:     string
  desc:     string
}

const MATERIAL_SWATCHES: MaterialSwatch[] = [
  {
    gradient: 'linear-gradient(135deg, #2a2a4e 0%, #1a1a2e 40%, #0a0a15 70%, #2a2a4e 100%)',
    glow:     '#1a1a2e',
    name:     'OBSIDIAN — Risk',
    desc:     'Open RFIs, unknowns, unclear scope. Shrinks as questions resolve. Starts at 60–70% of new mountains.',
  },
  {
    gradient: 'linear-gradient(135deg, #ff3380 0%, #E0115F 45%, #800030 75%, #ff3380 100%)',
    glow:     '#E0115F',
    name:     'RUBY — Expenses',
    desc:     'Materials purchased, labor logged, overhead allocated. Never disappears — permanent cost record.',
  },
  {
    gradient: 'linear-gradient(135deg, #7aeea0 0%, #50C878 45%, #206040 75%, #7aeea0 100%)',
    glow:     '#50C878',
    name:     'EMERALD — Management',
    desc:     'Scheduling, compliance, crew dispatch, inspections. Thickest during rough-in. Thins at trim.',
  },
  {
    gradient: 'linear-gradient(135deg, #ffe566 0%, #FFD700 40%, #8a6a00 70%, #ffe566 100%)',
    glow:     '#FFD700',
    name:     'GOLD — Earned Revenue',
    desc:     'Billable completed work. Grows as phases finish. Converts from diamond when BLUEPRINT marks phases complete.',
  },
  {
    gradient: 'linear-gradient(135deg, #e8faff 0%, #B9F2FF 40%, #5aaabb 70%, #e8faff 100%)',
    glow:     '#B9F2FF',
    name:     'DIAMOND — Unbilled Potential',
    desc:     'Contract value not yet earned. Always on top. Shrinks as work completes. Zero at project end.',
  },
]

const LEGEND_SECTIONS: LegendSection[] = [
  {
    id: 'terrain',
    title: 'TERRAIN & STRUCTURES',
    icon: '⛰',
    headerColor: '#FF9900',
    headerBg: 'rgba(255,153,0,0.12)',
    borderColor: 'rgba(255,153,0,0.3)',
    items: [
      { color: '#FF9900', icon: '△', name: 'Mountain', desc: 'Project. Height = contract value' },
      { color: '#990000', icon: '▲', name: 'Mountain — Estimating', desc: 'Dark red: project in estimating phase' },
      { color: '#FF0000', icon: '▲', name: 'Mountain — Planning', desc: 'Red: project in planning phase' },
      { color: '#FF9900', icon: '▲', name: 'Mountain — Site Prep', desc: 'Orange: project in site preparation' },
      { color: '#93C47D', icon: '▲', name: 'Mountain — Rough-in', desc: 'Light green: project in rough-in phase' },
      { color: '#38761D', icon: '▲', name: 'Mountain — Finish', desc: 'Forest green: project in finish phase' },
      { color: '#274E13', icon: '▲', name: 'Mountain — Trim', desc: 'Dark green: project in trim phase' },
      { color: '#884422', icon: '▽', name: 'Canyon', desc: 'Material cost depth at mountain base. Deeper = higher material ratio' },
      { color: '#cc88ff', icon: '▼', name: 'AR Stalactite', desc: 'Unpaid invoice hanging above project. Length = days outstanding' },
      { color: '#FFB347', icon: '〰', name: 'RFI Fault Line', desc: 'Open compliance question (jagged amber line). Flickers with age' },
      { color: '#aaddff', icon: '▭', name: 'Subscription Tower', desc: 'Hub subscriber. Cylinder height determined by subscription tier' },
      { color: '#ff88aa', icon: '◉', name: 'MRR Mountain', desc: 'Monthly Recurring Revenue total (pulsing sphere)' },
      { color: '#880000', icon: '⬤', name: 'Churn Pool', desc: 'Cancelled subscriber. Dark red disc that fades over 30 days' },
      { color: '#FFD700', icon: '⬛', name: 'OPERATOR Monument', desc: 'You. Obelisk + gold sphere. The bridge between both businesses' },
      { color: '#6688aa', icon: '⬡', name: 'Fortress', desc: 'Command center. Walled compound with NDA gate and IP wall integrated' },
    ],
  },
  {
    id: 'agents',
    title: 'AGENTS',
    icon: '◆',
    headerColor: '#00e5cc',
    headerBg: 'rgba(0,229,204,0.1)',
    borderColor: 'rgba(0,229,204,0.3)',
    items: [
      { color: '#e0ffff', icon: '◉', name: 'NEXUS', desc: 'Orchestrator. White-teal, large orb. Sweeps all domains every 45s' },
      { color: '#00eeff', icon: '◉', name: 'PULSE', desc: 'Cyan orb. Financial dashboards and KPI alerts' },
      { color: '#4488ff', icon: '◉', name: 'BLUEPRINT', desc: 'Blue orb. Project execution and phase management' },
      { color: '#ffee00', icon: '◉', name: 'SPARK', desc: 'Yellow orb. Lead acquisition and outreach' },
      { color: '#FFD700', icon: '◉', name: 'VAULT', desc: 'Gold orb. Estimating and pricing' },
      { color: '#44ff88', icon: '◉', name: 'LEDGER', desc: 'Green orb. Invoicing and collections' },
      { color: '#aa44ff', icon: '◉', name: 'CHRONO', desc: 'Purple orb. Scheduling and calendar' },
      { color: '#ff8800', icon: '◉', name: 'OHM', desc: 'Orange orb. NEC/CEC compliance' },
      { color: '#ff3333', icon: '◉', name: 'GUARDIAN', desc: 'Red orb. Perimeter security patrol' },
      { color: '#00e5cc', icon: '◉', name: 'SCOUT', desc: 'Teal orb. System analysis, high altitude sweeps' },
      { color: '#224488', icon: '◉', name: 'ECHO', desc: 'Dark blue orb. Memory and context management' },
      { color: '#445566', icon: '◉', name: 'HUNTER (planned)', desc: 'Planned agent — shown dimmer until activated', dimmed: true },
      { color: '#445566', icon: '◉', name: 'ATLAS (planned)', desc: 'Planned agent — shown dimmer until activated', dimmed: true },
      { color: '#445566', icon: '◉', name: 'NEGOTIATE (planned)', desc: 'Planned agent — shown dimmer until activated', dimmed: true },
      { color: '#445566', icon: '◉', name: 'SENTINEL (planned)', desc: 'Planned agent — shown dimmer until activated', dimmed: true },
    ],
  },
  {
    id: 'workers',
    title: 'HUMAN WORKERS',
    icon: '◎',
    headerColor: '#FFB347',
    headerBg: 'rgba(255,179,71,0.1)',
    borderColor: 'rgba(255,179,71,0.3)',
    items: [
      { color: '#FFB347', icon: '◎', name: 'Worker', desc: 'Human worker. Amber orb moving at ground level. Walks at 4 u/s' },
      { color: '#FFD700', icon: '♛', name: 'Manager', desc: 'Amber orb with crown marker. Observes domains, does not carry data cubes' },
      { color: '#996633', icon: '◎', name: 'Off Shift', desc: 'Dimmed amber orb at domain edge. Off shift or disengaged' },
      { color: '#ff8888', icon: '◎', name: 'Fatigued Worker', desc: 'Amber orb with red tint. Has completed 6+ tasks this shift' },
    ],
  },
  {
    id: 'dataflows',
    title: 'DATA FLOWS',
    icon: '⟳',
    headerColor: '#00ff88',
    headerBg: 'rgba(0,255,136,0.1)',
    borderColor: 'rgba(0,255,136,0.3)',
    items: [
      { color: '#00ff88', icon: '●', name: 'Payment Sphere', desc: 'Payment collected. Traveling green sphere — size = payment amount' },
      { color: '#ff8800', icon: '●', name: 'Material Sphere', desc: 'Material purchase flowing to project. Incoming orange sphere' },
      { color: '#ffee00', icon: '●', name: 'Lead Sphere', desc: 'Active lead. Yellow sphere traveling outward from SPARK domain' },
      { color: '#ff3333', icon: '◌', name: 'Invoice Pulse', desc: 'Invoice aging. Red wireframe expanding pulse — intensity = overdue severity' },
      { color: '#4488ff', icon: '●', name: 'Subscriber Sphere', desc: 'New subscriber. Blue sphere traveling from NDA gate to tower' },
      { color: '#00e5cc', icon: '●', name: 'Crew Dispatch', desc: 'Crew dispatching between projects. Teal sphere along ridge' },
      { color: '#FFD700', icon: '◆', name: 'Katsuro Packet', desc: 'Katsuro handoff data. Gold packet traveling from Katsuro to NEXUS' },
      { color: '#8899ff', icon: '▪', name: 'Data Cube', desc: 'Task result carried by agent. Small box colored to match agent' },
    ],
  },
  {
    id: 'fog',
    title: 'FOG LAYERS',
    icon: '🌫',
    headerColor: '#9966ff',
    headerBg: 'rgba(153,102,255,0.1)',
    borderColor: 'rgba(153,102,255,0.3)',
    items: [
      { color: '#ff4444', icon: '▒', name: 'Red Mist', desc: 'Revenue fog: unbilled exposure. Areas with uncollected revenue' },
      { color: '#ff8800', icon: '▒', name: 'Orange Mist', desc: 'Revenue fog: pending invoices awaiting payment' },
      { color: '#00cc66', icon: '▒', name: 'Green Mist', desc: 'Revenue fog: collected payments. Healthy revenue zone' },
      { color: '#FFB347', icon: '▒', name: 'Amber Mist', desc: 'Security fog: protected areas with full coverage' },
      { color: '#cc2222', icon: '▒', name: 'Red-Gap Mist', desc: 'Security fog: areas with missing or incomplete protection' },
      { color: '#aa66ee', icon: '▒', name: 'Purple Mist', desc: 'Bandwidth fog: where your time and attention concentrates' },
      { color: '#00bbaa', icon: '▒', name: 'Teal Mist', desc: 'Improvement fog: optimization opportunities awaiting action' },
    ],
  },
  {
    id: 'automation',
    title: 'AUTOMATION FLOWS',
    icon: '⚙',
    headerColor: '#00d4ff',
    headerBg: 'rgba(0,212,255,0.1)',
    borderColor: 'rgba(0,212,255,0.3)',
    items: [
      { color: '#ffdd44', icon: '◇', name: 'Trigger', desc: 'Automation start event. Diamond pulsing on ground' },
      { color: '#ff8844', icon: '◻', name: 'Condition', desc: 'IF/ELSE branch. Rotated box on ground' },
      { color: '#44aaff', icon: '▪', name: 'Action', desc: 'Task execution. Box on ground colored to match agent' },
      { color: '#88ff88', icon: '●', name: 'Transform', desc: 'Data modification. Small sphere on ground' },
      { color: '#aa88ff', icon: '○', name: 'Wait', desc: 'Timed delay. Torus (ring shape) on ground' },
      { color: '#44ff88', icon: '▲', name: 'Result — Success', desc: 'Successful outcome. Green cone pointing upward' },
      { color: '#ff4444', icon: '▲', name: 'Result — Failure', desc: 'Failed outcome. Red cone pointing upward' },
      { color: '#00d4ff', icon: '—', name: 'Flow Path', desc: 'Automation flow path on ground. Brighter glow = more active flow' },
      { color: '#ffffff', icon: '|', name: 'Handoff Beam', desc: 'Automation-to-agent handoff. Vertical beam from ground to sky' },
    ],
  },
  {
    id: 'effects',
    title: 'SPECIAL EFFECTS',
    icon: '✦',
    headerColor: '#FFD700',
    headerBg: 'rgba(255,215,0,0.1)',
    borderColor: 'rgba(255,215,0,0.3)',
    items: [
      { color: '#FFD700', icon: '✦', name: 'Gold Particles', desc: 'High-margin project or payment. Rising gold particle burst' },
      { color: '#ff3333', icon: '◌', name: 'Red Pulse', desc: 'Failure or critical alert. Expanding pulse visible from distance' },
      { color: '#FFD700', icon: '✦', name: 'Gold Flash', desc: 'Human-AI collaboration moment at handoff point' },
      { color: '#00aa44', icon: '〰', name: 'River Gradient', desc: 'Cash flow health. Red=exposure, green=collected. Gradient along river' },
      { color: '#ffcc44', icon: '☀', name: 'Sun Brightness', desc: 'Business health indicator. Amber sun=Solutions business, Blue sun=Hub' },
      { color: '#aaaaff', icon: '≋', name: 'Fog Ripple', desc: 'Visual distortion created when an agent passes through a fog layer' },
    ],
  },
]

// ── MountainMaterialsSection — NW38 ──────────────────────────────────────────

function MountainMaterialsSection() {
  const [open, setOpen] = useState(true)

  return (
    <div style={{ marginBottom: 8 }}>
      {/* Section header */}
      <button
        onClick={() => setOpen(prev => !prev)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '7px 10px',
          borderRadius: 5,
          border: '1px solid rgba(185,242,255,0.35)',
          background: 'rgba(185,242,255,0.08)',
          cursor: 'pointer',
          fontFamily: 'monospace',
          transition: 'all 0.15s',
          textAlign: 'left',
        }}
      >
        <span style={{ fontSize: 14 }}>💎</span>
        <span style={{
          flex: 1,
          color: '#B9F2FF',
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: 1.5,
          textTransform: 'uppercase',
          textShadow: '0 0 6px rgba(185,242,255,0.4)',
        }}>
          MOUNTAIN MATERIALS
        </span>
        <span style={{
          color: '#B9F2FF',
          fontSize: 10,
          opacity: 0.7,
          transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
          transition: 'transform 0.2s',
          display: 'inline-block',
        }}>
          ▾
        </span>
      </button>

      {open && (
        <div style={{
          marginTop: 3,
          display: 'flex',
          flexDirection: 'column',
          gap: 3,
          paddingLeft: 4,
          paddingRight: 4,
        }}>
          {/* Layer order label */}
          <div style={{
            padding: '4px 8px',
            color: 'rgba(255,255,255,0.28)',
            fontSize: 9,
            fontFamily: 'monospace',
            letterSpacing: 0.8,
          }}>
            BOTTOM → TOP: obsidian · ruby · emerald · gold · diamond
          </div>

          {MATERIAL_SWATCHES.map((sw, i) => (
            <div
              key={i}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 8,
                padding: '5px 8px',
                borderRadius: 4,
                background: 'rgba(255,255,255,0.025)',
                transition: 'background 0.1s',
              }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLDivElement).style.background = 'rgba(255,255,255,0.055)'
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLDivElement).style.background = 'rgba(255,255,255,0.025)'
              }}
            >
              {/* Metallic gradient swatch */}
              <div style={{
                width: 20,
                height: 20,
                minWidth: 20,
                borderRadius: 3,
                background: sw.gradient,
                boxShadow: `0 0 8px ${sw.glow}88, inset 0 1px 0 rgba(255,255,255,0.2)`,
                marginTop: 1,
                flexShrink: 0,
              }} />

              {/* Text */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  color: 'rgba(255,255,255,0.85)',
                  fontSize: 11,
                  fontFamily: 'monospace',
                  fontWeight: 700,
                  letterSpacing: 0.3,
                  lineHeight: 1.3,
                }}>
                  {sw.name}
                </div>
                <div style={{
                  color: 'rgba(255,255,255,0.4)',
                  fontSize: 10,
                  fontFamily: 'monospace',
                  letterSpacing: 0.2,
                  lineHeight: 1.4,
                  marginTop: 1,
                }}>
                  {sw.desc}
                </div>
              </div>
            </div>
          ))}

          {/* Transformation arrow */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '5px 8px',
            borderRadius: 4,
            background: 'rgba(255,215,0,0.04)',
            border: '1px solid rgba(255,215,0,0.12)',
          }}>
            <div style={{
              width: 20,
              height: 20,
              minWidth: 20,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 13,
              flexShrink: 0,
            }}>
              ⟳
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                color: 'rgba(255,215,0,0.8)',
                fontSize: 11,
                fontFamily: 'monospace',
                fontWeight: 700,
                letterSpacing: 0.3,
              }}>
                Diamond → Gold
              </div>
              <div style={{
                color: 'rgba(255,255,255,0.35)',
                fontSize: 10,
                fontFamily: 'monospace',
                lineHeight: 1.4,
                marginTop: 1,
              }}>
                When BLUEPRINT marks a phase complete, a ripple wave converts diamond cap into gold. 2 second animation.
              </div>
            </div>
          </div>

          {/* Collapse animation note */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '5px 8px',
            borderRadius: 4,
            background: 'rgba(255,215,0,0.04)',
            border: '1px solid rgba(255,215,0,0.12)',
          }}>
            <div style={{
              width: 20,
              height: 20,
              minWidth: 20,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 13,
              flexShrink: 0,
            }}>
              ✦
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                color: 'rgba(255,215,0,0.8)',
                fontSize: 11,
                fontFamily: 'monospace',
                fontWeight: 700,
                letterSpacing: 0.3,
              }}>
                Project Complete
              </div>
              <div style={{
                color: 'rgba(255,255,255,0.35)',
                fontSize: 10,
                fontFamily: 'monospace',
                lineHeight: 1.4,
                marginTop: 1,
              }}>
                Gold flows to river · Ruby scatters · Emerald dissolves · Diamond shatters upward. A small gold monument remains.
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── CollapsibleSection sub-component ─────────────────────────────────────────

interface SectionProps {
  section: LegendSection
  defaultOpen: boolean
}

function CollapsibleSection({ section, defaultOpen }: SectionProps) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <div style={{ marginBottom: 8 }}>
      {/* Section header */}
      <button
        onClick={() => setOpen(prev => !prev)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '7px 10px',
          borderRadius: 5,
          border: `1px solid ${section.borderColor}`,
          background: section.headerBg,
          cursor: 'pointer',
          fontFamily: 'monospace',
          transition: 'all 0.15s',
          textAlign: 'left',
        }}
      >
        <span style={{ fontSize: 14 }}>{section.icon}</span>
        <span style={{
          flex: 1,
          color: section.headerColor,
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: 1.5,
          textTransform: 'uppercase',
          textShadow: `0 0 6px ${section.headerColor}55`,
        }}>
          {section.title}
        </span>
        <span style={{
          color: section.headerColor,
          fontSize: 10,
          opacity: 0.7,
          transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
          transition: 'transform 0.2s',
          display: 'inline-block',
        }}>
          ▾
        </span>
      </button>

      {/* Section items */}
      {open && (
        <div style={{
          marginTop: 3,
          display: 'flex',
          flexDirection: 'column',
          gap: 3,
          paddingLeft: 4,
          paddingRight: 4,
        }}>
          {section.items.map((item, i) => (
            <div
              key={i}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 8,
                padding: '5px 8px',
                borderRadius: 4,
                background: 'rgba(255,255,255,0.025)',
                opacity: item.dimmed ? 0.45 : 1,
                transition: 'background 0.1s',
              }}
              onMouseEnter={e => {
                if (!item.dimmed) (e.currentTarget as HTMLDivElement).style.background = 'rgba(255,255,255,0.055)'
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLDivElement).style.background = 'rgba(255,255,255,0.025)'
              }}
            >
              {/* Color swatch */}
              <div style={{
                width: 20,
                height: 20,
                minWidth: 20,
                borderRadius: 3,
                background: item.color,
                boxShadow: `0 0 6px ${item.color}55`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 11,
                color: 'rgba(0,0,0,0.6)',
                fontWeight: 700,
                marginTop: 1,
              }}>
                <span style={{ fontSize: 10, color: 'rgba(0,0,0,0.55)', lineHeight: 1 }}>{item.icon}</span>
              </div>

              {/* Text */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  color: item.dimmed ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.85)',
                  fontSize: 11,
                  fontFamily: 'monospace',
                  fontWeight: 700,
                  letterSpacing: 0.3,
                  lineHeight: 1.3,
                }}>
                  {item.name}
                </div>
                <div style={{
                  color: item.dimmed ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.4)',
                  fontSize: 10,
                  fontFamily: 'monospace',
                  letterSpacing: 0.2,
                  lineHeight: 1.4,
                  marginTop: 1,
                }}>
                  {item.desc}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── LegendButton (exported for use in CommandHUD) ─────────────────────────────

interface LegendButtonProps {
  open: boolean
  onClick: () => void
}

export function LegendButton({ open, onClick }: LegendButtonProps) {
  return (
    <button
      onClick={onClick}
      title="Visual Legend — all objects and effects explained"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 5,
        padding: '5px 10px',
        borderRadius: 5,
        border: open
          ? '1px solid rgba(255,215,0,0.75)'
          : '1px solid rgba(255,215,0,0.35)',
        background: open
          ? 'rgba(255,215,0,0.18)'
          : 'rgba(5,4,0,0.75)',
        color: open ? '#FFD700' : 'rgba(255,215,0,0.65)',
        cursor: 'pointer',
        fontSize: 9,
        fontFamily: 'monospace',
        fontWeight: 700,
        letterSpacing: 1.5,
        backdropFilter: 'blur(8px)',
        transition: 'all 0.15s',
        width: 'fit-content',
        boxShadow: open ? '0 0 10px rgba(255,215,0,0.2)' : 'none',
      }}
    >
      <span style={{ fontSize: 11 }}>◈</span>
      LEGEND
    </button>
  )
}

// ── LegendPanel (main component) ─────────────────────────────────────────────

interface LegendPanelProps {
  open: boolean
  onClose: () => void
}

export default function LegendPanel({ open, onClose }: LegendPanelProps) {
  const handleBackdropClick = useCallback(() => {
    onClose()
  }, [onClose])

  if (!open) return null

  return (
    <>
      {/* ── CSS animations ─────────────────────────────────────────────────── */}
      <style>{`
        @keyframes nw-legend-slide-in {
          from { transform: translateX(-100%); opacity: 0; }
          to   { transform: translateX(0);    opacity: 1; }
        }
        @keyframes nw-legend-slide-out {
          from { transform: translateX(0);    opacity: 1; }
          to   { transform: translateX(-100%); opacity: 0; }
        }
      `}</style>

      {/* ── Backdrop ───────────────────────────────────────────────────────── */}
      <div
        onClick={handleBackdropClick}
        style={{
          position: 'absolute',
          inset: 0,
          background: 'rgba(0,0,0,0.55)',
          zIndex: 40,
          cursor: 'pointer',
        }}
      />

      {/* ── Slide-in panel ─────────────────────────────────────────────────── */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          bottom: 0,
          width: '100%',
          maxWidth: 350,
          zIndex: 45,
          display: 'flex',
          flexDirection: 'column',
          background: 'rgba(4,8,12,0.97)',
          backdropFilter: 'blur(12px)',
          borderRight: '1px solid rgba(255,215,0,0.12)',
          boxShadow: '4px 0 32px rgba(0,0,0,0.75)',
          animation: 'nw-legend-slide-in 0.28s cubic-bezier(0.25,0.46,0.45,0.94) both',
        }}
      >
        {/* Panel header */}
        <div style={{
          padding: '16px 16px 12px',
          borderBottom: '1px solid rgba(255,215,0,0.15)',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          flexShrink: 0,
        }}>
          <span style={{
            color: '#FFD700',
            fontSize: 18,
            filter: 'drop-shadow(0 0 6px rgba(255,215,0,0.5))',
          }}>◈</span>
          <div style={{ flex: 1 }}>
            <div style={{
              color: '#FFD700',
              fontSize: 12,
              fontFamily: 'monospace',
              fontWeight: 700,
              letterSpacing: 2,
              textTransform: 'uppercase',
              textShadow: '0 0 8px rgba(255,215,0,0.4)',
            }}>
              VISUAL LEGEND
            </div>
            <div style={{
              color: 'rgba(255,255,255,0.35)',
              fontSize: 9,
              fontFamily: 'monospace',
              letterSpacing: 1,
              marginTop: 2,
            }}>
              ALL OBJECTS &amp; EFFECTS EXPLAINED
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
              fontSize: 10,
              fontFamily: 'monospace',
              letterSpacing: 1,
              transition: 'all 0.15s',
            }}
            onMouseEnter={e => {
              const t = e.currentTarget
              t.style.background = 'rgba(255,80,80,0.15)'
              t.style.borderColor = 'rgba(255,80,80,0.4)'
              t.style.color = '#ff6666'
            }}
            onMouseLeave={e => {
              const t = e.currentTarget
              t.style.background = 'rgba(255,255,255,0.05)'
              t.style.borderColor = 'rgba(255,255,255,0.15)'
              t.style.color = 'rgba(255,255,255,0.6)'
            }}
          >
            ✕ CLOSE
          </button>
        </div>

        {/* Scrollable content */}
        <div style={{
          flex: 1,
          overflowY: 'auto',
          padding: 12,
          scrollbarWidth: 'thin',
          scrollbarColor: 'rgba(255,215,0,0.2) transparent',
        }}>
          {/* ── NW38: Mountain Materials section ─────────────────────────── */}
          <MountainMaterialsSection />

          {LEGEND_SECTIONS.map((section, idx) => (
            <CollapsibleSection
              key={section.id}
              section={section}
              defaultOpen={idx === 0}
            />
          ))}
        </div>

        {/* Footer */}
        <div style={{
          padding: '10px 16px',
          borderTop: '1px solid rgba(255,215,0,0.1)',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          flexShrink: 0,
        }}>
          {/* NW-TUTORIAL: REPLAY TOUR button */}
          <button
            onClick={() => {
              onClose()
              window.dispatchEvent(new CustomEvent('nw:tour-start'))
            }}
            style={{
              width: '100%',
              padding: '7px 14px',
              borderRadius: 5,
              border: '1px solid rgba(0,220,200,0.3)',
              background: 'rgba(0,220,200,0.07)',
              color: '#00ddcc',
              cursor: 'pointer',
              fontSize: 10,
              fontFamily: 'monospace',
              letterSpacing: 1.5,
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              transition: 'all 0.15s',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.background = 'rgba(0,220,200,0.15)'
              e.currentTarget.style.borderColor = 'rgba(0,220,200,0.55)'
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = 'rgba(0,220,200,0.07)'
              e.currentTarget.style.borderColor = 'rgba(0,220,200,0.3)'
            }}
          >
            <span>▶</span> REPLAY TOUR
          </button>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}>
            <span style={{
              color: 'rgba(255,255,255,0.2)',
              fontSize: 9,
              fontFamily: 'monospace',
              letterSpacing: 0.8,
            }}>
              {LEGEND_SECTIONS.reduce((a, s) => a + s.items.length, 0)} OBJECTS DOCUMENTED
            </span>
            <button
              onClick={onClose}
              style={{
                padding: '5px 14px',
                borderRadius: 4,
                border: '1px solid rgba(255,215,0,0.35)',
                background: 'rgba(255,215,0,0.08)',
                color: '#FFD700',
                cursor: 'pointer',
                fontSize: 9,
                fontFamily: 'monospace',
                letterSpacing: 1.5,
                transition: 'all 0.15s',
              }}
              onMouseEnter={e => {
                e.currentTarget.style.background = 'rgba(255,215,0,0.18)'
              }}
              onMouseLeave={e => {
                e.currentTarget.style.background = 'rgba(255,215,0,0.08)'
              }}
            >
              RETURN TO WORLD
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
