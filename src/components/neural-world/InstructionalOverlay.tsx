/**
 * InstructionalOverlay.tsx — NW21: Interactive instructional overlay for Neural World.
 *
 * Teaches users how to read the 3D data landscape.
 *
 * Features:
 * - ? button in top-left HUD area (rendered alongside CommandHUD title)
 * - When open: dims 3D world to 40% opacity behind full-height left panel
 * - Panel slides in from left, max width 400px, full height, scrollable
 * - 7 sections with animated color-coded collapsible headers
 * - Each section shows animated icon/color swatch describing elements
 * - First-time experience: auto-open for 3s showing WELCOME, then pulse ? for 10s
 */

import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
} from 'react'

// ── localStorage flag ─────────────────────────────────────────────────────────

const FIRST_TIME_KEY = 'nw_instructional_overlay_seen'

// ── Section definitions ───────────────────────────────────────────────────────

interface SectionItem {
  icon: string
  color: string
  label: string
  desc: string
}

interface SectionDef {
  id: string
  title: string
  headerColor: string
  headerBg: string
  borderColor: string
  icon: string
  items: SectionItem[]
}

const SECTIONS: SectionDef[] = [
  {
    id: 'welcome',
    title: 'WELCOME',
    headerColor: '#00ff88',
    headerBg: 'rgba(0,255,136,0.12)',
    borderColor: 'rgba(0,255,136,0.35)',
    icon: '🌍',
    items: [
      {
        icon: '◎',
        color: '#00ff88',
        label: 'Living World',
        desc: 'This is your business as a living world. Every shape, color, and movement represents real operational data.',
      },
      {
        icon: '▣',
        color: '#ffcc44',
        label: 'West Continent',
        desc: 'Your Field Operations — projects, crews, invoices, and client relationships.',
      },
      {
        icon: '◆',
        color: '#4488ff',
        label: 'East Continent',
        desc: 'Your Software Platform — subscribers, MRR, AI agents, and IP.',
      },
      {
        icon: '✦',
        color: '#ffd700',
        label: 'Founders Valley',
        desc: 'The bridge where both businesses meet. The dual suns represent each side\'s health.',
      },
    ],
  },
  {
    id: 'west',
    title: 'WEST CONTINENT — YOUR FIELD OPERATIONS',
    headerColor: '#ffaa33',
    headerBg: 'rgba(255,160,50,0.12)',
    borderColor: 'rgba(255,160,50,0.35)',
    icon: '⛰',
    items: [
      {
        icon: '▲',
        color: '#ff8833',
        label: 'Mountains = Active Projects',
        desc: 'Height = contract value. Color = project health. Tall bright peaks are healthy high-value projects.',
      },
      {
        icon: '▽',
        color: '#cc6622',
        label: 'Canyon Depth = Material Cost Ratio',
        desc: 'Deeper canyons at base = more material-heavy project cost structure.',
      },
      {
        icon: '〰',
        color: '#ffcc66',
        label: 'Labor Ridges = Crew Connections',
        desc: 'Ridge lines connecting projects share the same crew. Same color = same crew.',
      },
      {
        icon: '⟁',
        color: '#ff4444',
        label: 'AR Stalactites = Unpaid Invoices',
        desc: 'Hanging above projects. Length = invoice age. They dissolve when paid.',
      },
      {
        icon: '⚡',
        color: '#ff6633',
        label: 'RFI Fault Lines = Open RFIs',
        desc: 'Flicker with age. Heal visually when resolved.',
      },
      {
        icon: '💡',
        color: '#ffffaa',
        label: 'Job Site Markers',
        desc: 'Glowing lights above active projects showing crew count and hours worked.',
      },
      {
        icon: '◭',
        color: '#88ffcc',
        label: 'Customer Territories',
        desc: 'Colored terrain zones per client. Weather = relationship health. Clear sky = healthy. Storm = degrading.',
      },
    ],
  },
  {
    id: 'east',
    title: 'EAST CONTINENT — YOUR SOFTWARE PLATFORM',
    headerColor: '#4499ff',
    headerBg: 'rgba(68,153,255,0.12)',
    borderColor: 'rgba(68,153,255,0.35)',
    icon: '🏙',
    items: [
      {
        icon: '▐',
        color: '#66aaff',
        label: 'Subscription Towers',
        desc: 'Customer tiers: Solo / Growth / Pro / Pro+ / Enterprise. Height = tier value.',
      },
      {
        icon: '△',
        color: '#88ddff',
        label: 'MRR Mountain',
        desc: 'Monthly Recurring Revenue peak. Height scales in real-time with your MRR.',
      },
      {
        icon: '○',
        color: '#882222',
        label: 'Churn Pools',
        desc: 'Dark red pools where cancelled subscribers were. Fade over 30 days.',
      },
      {
        icon: '⬛',
        color: '#00ddbb',
        label: 'Agent Activity Grid',
        desc: 'Teal cells pulse when AI agents are active and processing.',
      },
      {
        icon: '⛔',
        color: '#ff3333',
        label: 'NDA Gate',
        desc: 'Entry barrier. Red spheres = unsigned users. Green spheres = signed.',
      },
      {
        icon: '🏛',
        color: '#aaaacc',
        label: 'IP Fortress',
        desc: 'Wall along continent edge. Height = number of IP filings and protections.',
      },
    ],
  },
  {
    id: 'founders',
    title: 'FOUNDERS VALLEY — THE BRIDGE',
    headerColor: '#ffd700',
    headerBg: 'rgba(255,215,0,0.10)',
    borderColor: 'rgba(255,215,0,0.35)',
    icon: '✦',
    items: [
      {
        icon: '✧',
        color: '#ffd700',
        label: 'Golden Shimmer Ground',
        desc: 'Where both businesses meet. The valley glows with the blend of both sun energies.',
      },
      {
        icon: '☀',
        color: '#ff8040',
        label: 'Amber Sun = Solutions Revenue',
        desc: 'Rises in the west. Brightness = PowerOn Solutions LLC revenue health.',
      },
      {
        icon: '☀',
        color: '#80c0ff',
        label: 'Blue Sun = Hub Health',
        desc: 'Rises in the east. Brightness = PowerOn Hub subscription health.',
      },
      {
        icon: '⚖',
        color: '#ffee88',
        label: 'Sun Dominance Meter',
        desc: 'Which business is currently stronger. Balanced suns = balanced businesses.',
      },
      {
        icon: '🏅',
        color: '#ffd700',
        label: 'V3 Complete Badge',
        desc: 'Appears on first entry into Founders Valley. A milestone marker.',
      },
    ],
  },
  {
    id: 'flows',
    title: 'DATA FLOWS',
    headerColor: '#00ddcc',
    headerBg: 'rgba(0,220,200,0.10)',
    borderColor: 'rgba(0,220,200,0.35)',
    icon: '⟳',
    items: [
      {
        icon: '●',
        color: '#00ff88',
        label: 'Green Spheres = Payments',
        desc: 'Payments traveling toward HQ from project sites.',
      },
      {
        icon: '●',
        color: '#ff8833',
        label: 'Orange Spheres = Materials',
        desc: 'Materials flowing out to active project sites.',
      },
      {
        icon: '●',
        color: '#ffff44',
        label: 'Yellow Spheres = Leads',
        desc: 'New leads coming in from SPARK live call intelligence.',
      },
      {
        icon: '●',
        color: '#ff3333',
        label: 'Red Pulses = Aging Invoices',
        desc: 'AR pulses that grow more urgent as invoice age increases.',
      },
      {
        icon: '●',
        color: '#4499ff',
        label: 'Blue Spheres = New Subscribers',
        desc: 'New software subscribers joining the platform.',
      },
      {
        icon: '●',
        color: '#00ddcc',
        label: 'Teal Spheres = Crew Dispatching',
        desc: 'Crew being dispatched and moving between project sites.',
      },
    ],
  },
  {
    id: 'warnings',
    title: 'WHAT TO LOOK FOR',
    headerColor: '#ff4444',
    headerBg: 'rgba(255,68,68,0.12)',
    borderColor: 'rgba(255,68,68,0.35)',
    icon: '⚠',
    items: [
      {
        icon: '⬇',
        color: '#ff6644',
        label: 'Mountains Shrinking',
        desc: 'Projects losing value or going over budget. Watch for rapidly declining peaks.',
      },
      {
        icon: '⟁',
        color: '#ff4444',
        label: 'Long AR Stalactites',
        desc: 'Invoices aging past 30 days. Growing stalactites need immediate attention.',
      },
      {
        icon: '⛈',
        color: '#8866aa',
        label: 'Storm Weather Over Territories',
        desc: 'Client relationship degrading. Follow up before it becomes a crisis.',
      },
      {
        icon: '○',
        color: '#882222',
        label: 'Churn Pools Appearing',
        desc: 'Subscribers cancelling. Dark pools signal platform health issues.',
      },
      {
        icon: '☀',
        color: '#ffaa44',
        label: 'Imbalanced Sun Brightness',
        desc: 'One business significantly outpacing the other. Rebalance focus and resources.',
      },
    ],
  },
  {
    id: 'controls',
    title: 'CONTROLS QUICK REFERENCE',
    headerColor: '#cc88ff',
    headerBg: 'rgba(200,136,255,0.10)',
    borderColor: 'rgba(200,136,255,0.35)',
    icon: '⌨',
    items: [
      {
        icon: '↕',
        color: '#cc88ff',
        label: 'WASD = Move',
        desc: 'W/S forward/back, A/D strafe left/right.',
      },
      {
        icon: '↑',
        color: '#cc88ff',
        label: 'Space = Up  ·  Q = Down',
        desc: 'Vertical movement in first-person and third-person modes.',
      },
      {
        icon: '⚡',
        color: '#ffaaff',
        label: 'Shift = Toggle Sprint',
        desc: 'Press Shift to toggle between normal and sprint speeds.',
      },
      {
        icon: '🖱',
        color: '#aa88ff',
        label: 'Scroll = Speed / Zoom',
        desc: 'In FP/TP: adjusts travel speed. In Orbit: zooms camera in/out.',
      },
      {
        icon: '☝',
        color: '#cc99ff',
        label: 'Click Any Structure',
        desc: 'Click on mountains, towers, or other structures to see detail data.',
      },
      {
        icon: '⬡',
        color: '#aa88dd',
        label: 'Layers Panel',
        desc: 'Left-side layer toggles control what data is visible in the world.',
      },
      {
        icon: '⚙',
        color: '#9977cc',
        label: 'Settings Gear',
        desc: 'Bottom-right gear icon: adjust sensitivity, speed, and invert axes.',
      },
    ],
  },
]

// ── Section component ─────────────────────────────────────────────────────────

interface SectionProps {
  section: SectionDef
  defaultOpen?: boolean
}

function Section({ section, defaultOpen = false }: SectionProps) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <div
      style={{
        marginBottom: 8,
        borderRadius: 8,
        overflow: 'hidden',
        border: `1px solid ${section.borderColor}`,
        background: 'rgba(0,0,0,0.4)',
      }}
    >
      {/* Header */}
      <button
        onClick={() => setOpen(v => !v)}
        style={{
          width: '100%',
          padding: '10px 14px',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          background: open ? section.headerBg : 'rgba(0,0,0,0.2)',
          border: 'none',
          cursor: 'pointer',
          textAlign: 'left',
          transition: 'background 0.2s',
        }}
      >
        <span style={{
          fontSize: 18,
          lineHeight: 1,
          filter: open ? 'brightness(1.2)' : 'brightness(0.7)',
          transition: 'filter 0.2s',
        }}>
          {section.icon}
        </span>
        <span style={{
          flex: 1,
          color: open ? section.headerColor : 'rgba(255,255,255,0.55)',
          fontSize: 10,
          fontFamily: 'monospace',
          fontWeight: 700,
          letterSpacing: 1.5,
          textTransform: 'uppercase',
          transition: 'color 0.2s',
          textShadow: open ? `0 0 10px ${section.headerColor}88` : 'none',
        }}>
          {section.title}
        </span>
        <span style={{
          color: open ? section.headerColor : 'rgba(255,255,255,0.3)',
          fontSize: 14,
          transition: 'transform 0.2s, color 0.2s',
          transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
          display: 'inline-block',
        }}>
          ▾
        </span>
      </button>

      {/* Body */}
      <div style={{
        maxHeight: open ? 1200 : 0,
        overflow: 'hidden',
        transition: 'max-height 0.3s ease',
      }}>
        <div style={{ padding: '8px 14px 12px' }}>
          {section.items.map((item, idx) => (
            <div
              key={idx}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 10,
                marginBottom: 10,
                paddingBottom: 10,
                borderBottom: idx < section.items.length - 1
                  ? `1px solid rgba(255,255,255,0.05)`
                  : 'none',
              }}
            >
              {/* Color swatch / icon */}
              <div style={{
                minWidth: 28,
                height: 28,
                borderRadius: 6,
                background: `${item.color}22`,
                border: `1px solid ${item.color}66`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 14,
                color: item.color,
                flexShrink: 0,
                boxShadow: `0 0 8px ${item.color}33`,
              }}>
                {item.icon}
              </div>
              <div>
                <div style={{
                  color: item.color,
                  fontSize: 10,
                  fontFamily: 'monospace',
                  fontWeight: 600,
                  letterSpacing: 0.8,
                  marginBottom: 2,
                }}>
                  {item.label}
                </div>
                <div style={{
                  color: 'rgba(255,255,255,0.65)',
                  fontSize: 11,
                  lineHeight: 1.5,
                  fontFamily: 'sans-serif',
                }}>
                  {item.desc}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export function InstructionalOverlay() {
  const [panelOpen, setPanelOpen] = useState(false)
  const [pulseBtn, setPulseBtn] = useState(false)
  const [welcomeOnlyMode, setWelcomeOnlyMode] = useState(false)
  const pulseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const collapseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── First-time experience ──────────────────────────────────────────────────
  useEffect(() => {
    const seen = localStorage.getItem(FIRST_TIME_KEY)
    if (!seen) {
      // Auto-open showing only WELCOME for 3 seconds
      setWelcomeOnlyMode(true)
      setPanelOpen(true)

      collapseTimerRef.current = setTimeout(() => {
        // Collapse after 3 seconds
        setPanelOpen(false)
        setWelcomeOnlyMode(false)
        // Mark as seen
        try { localStorage.setItem(FIRST_TIME_KEY, '1') } catch { /* ignore */ }
        // Pulse ? button for 10 seconds
        setPulseBtn(true)
        pulseTimerRef.current = setTimeout(() => {
          setPulseBtn(false)
        }, 10_000)
      }, 3_000)
    }

    return () => {
      if (collapseTimerRef.current) clearTimeout(collapseTimerRef.current)
      if (pulseTimerRef.current) clearTimeout(pulseTimerRef.current)
    }
  }, [])

  const handleOpen = useCallback(() => {
    setPulseBtn(false)
    if (pulseTimerRef.current) clearTimeout(pulseTimerRef.current)
    setWelcomeOnlyMode(false)
    setPanelOpen(true)
  }, [])

  const handleClose = useCallback(() => {
    setPanelOpen(false)
    setWelcomeOnlyMode(false)
  }, [])

  // Sections to show (welcome-only mode shows only first section)
  const visibleSections = welcomeOnlyMode ? SECTIONS.slice(0, 1) : SECTIONS

  return (
    <>
      {/* ── CSS keyframes injected once ───────────────────────────────────── */}
      <style>{`
        @keyframes nw-overlay-btn-pulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(0,255,136,0.0); transform: scale(1); }
          50% { box-shadow: 0 0 0 8px rgba(0,255,136,0.25); transform: scale(1.08); }
        }
        @keyframes nw-overlay-panel-slide-in {
          from { transform: translateX(-100%); opacity: 0; }
          to   { transform: translateX(0);    opacity: 1; }
        }
        @keyframes nw-overlay-panel-slide-out {
          from { transform: translateX(0);    opacity: 1; }
          to   { transform: translateX(-100%); opacity: 0; }
        }
        @keyframes nw-overlay-header-glow {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.75; }
        }
      `}</style>

      {/* ── Dim backdrop (only when panel open) ───────────────────────────── */}
      {panelOpen && (
        <div
          onClick={handleClose}
          style={{
            position: 'absolute',
            inset: 0,
            background: 'rgba(0,0,0,0.60)',
            zIndex: 40,
            cursor: 'pointer',
          }}
        />
      )}

      {/* ── Slide-in panel ────────────────────────────────────────────────── */}
      {panelOpen && (
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            bottom: 0,
            width: '100%',
            maxWidth: 400,
            zIndex: 45,
            display: 'flex',
            flexDirection: 'column',
            background: 'rgba(4,10,8,0.96)',
            backdropFilter: 'blur(12px)',
            borderRight: '1px solid rgba(0,255,136,0.15)',
            boxShadow: '4px 0 32px rgba(0,0,0,0.7)',
            animation: 'nw-overlay-panel-slide-in 0.28s cubic-bezier(0.25,0.46,0.45,0.94) both',
          }}
        >
          {/* Panel header */}
          <div style={{
            padding: '16px 16px 12px',
            borderBottom: '1px solid rgba(0,255,136,0.15)',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            flexShrink: 0,
          }}>
            <span style={{
              color: '#00ff88',
              fontSize: 18,
              filter: 'drop-shadow(0 0 6px rgba(0,255,136,0.6))',
            }}>🌍</span>
            <div style={{ flex: 1 }}>
              <div style={{
                color: '#00ff88',
                fontSize: 12,
                fontFamily: 'monospace',
                fontWeight: 700,
                letterSpacing: 2,
                textTransform: 'uppercase',
                textShadow: '0 0 8px rgba(0,255,136,0.4)',
              }}>
                NEURAL WORLD GUIDE
              </div>
              <div style={{
                color: 'rgba(255,255,255,0.4)',
                fontSize: 9,
                fontFamily: 'monospace',
                letterSpacing: 1,
                marginTop: 2,
              }}>
                {welcomeOnlyMode ? 'WELCOME' : 'DATA READING TUTORIAL'}
              </div>
            </div>
            {/* Close button */}
            <button
              onClick={handleClose}
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

          {/* Scrollable sections */}
          <div style={{
            flex: 1,
            overflowY: 'auto',
            padding: 12,
            scrollbarWidth: 'thin',
            scrollbarColor: 'rgba(0,255,136,0.2) transparent',
          }}>
            {visibleSections.map((section, idx) => (
              <Section
                key={section.id}
                section={section}
                defaultOpen={idx === 0}
              />
            ))}
          </div>

          {/* Footer */}
          {!welcomeOnlyMode && (
            <div style={{
              padding: '10px 16px',
              borderTop: '1px solid rgba(0,255,136,0.1)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexShrink: 0,
            }}>
              <span style={{
                color: 'rgba(255,255,255,0.25)',
                fontSize: 9,
                fontFamily: 'monospace',
                letterSpacing: 1,
              }}>
                7 SECTIONS · NEURAL WORLD v3
              </span>
              <button
                onClick={handleClose}
                style={{
                  padding: '4px 14px',
                  borderRadius: 4,
                  border: '1px solid rgba(0,255,136,0.3)',
                  background: 'rgba(0,255,136,0.08)',
                  color: '#00ff88',
                  cursor: 'pointer',
                  fontSize: 9,
                  fontFamily: 'monospace',
                  letterSpacing: 1.5,
                  transition: 'all 0.15s',
                }}
              >
                RETURN TO WORLD
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── ? trigger button (always visible, positioned top-left) ────────── */}
      {!panelOpen && (
        <button
          onClick={handleOpen}
          style={{
            position: 'absolute',
            top: 14,
            left: 14,
            zIndex: 35,
            width: 28,
            height: 28,
            borderRadius: 6,
            border: pulseBtn
              ? '1px solid rgba(0,255,136,0.8)'
              : '1px solid rgba(0,255,136,0.35)',
            background: pulseBtn
              ? 'rgba(0,255,136,0.18)'
              : 'rgba(0,0,0,0.6)',
            color: '#00ff88',
            cursor: 'pointer',
            fontSize: 14,
            fontFamily: 'monospace',
            fontWeight: 700,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backdropFilter: 'blur(6px)',
            transition: 'background 0.2s, border-color 0.2s',
            animation: pulseBtn ? 'nw-overlay-btn-pulse 1.2s ease-in-out infinite' : 'none',
          }}
          title="Neural World Guide"
          aria-label="Open Neural World instructional guide"
        >
          ?
        </button>
      )}
    </>
  )
}

export default InstructionalOverlay
