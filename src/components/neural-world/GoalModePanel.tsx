/**
 * GoalModePanel.tsx — NW45: Interactive video-game-style Goal Mode.
 *
 * Features:
 *  - Glassmorphic setup overlay (monthly income target + timeframe)
 *  - DataBridge + callClaude computes gap and returns structured missions
 *  - Missions: collect_ar | close_lead | upsell_project | add_subscription | reduce_cost
 *  - Dispatches nw:goal-mode-activate with missions for GoldenPathLayer
 *  - Goal state saved/restored via localStorage + Supabase neural_world_settings
 *  - GoalTrackerHUD renders persistent top-right progress bar while active
 *  - Mission click: detail panel with MARK COMPLETE (gold particles + NEXUS voice)
 *  - NEXUS coaching: every 3 completions + 60s idle prompt
 *  - EXIT GOAL: saves state, re-entering restores it
 *  - VIDEO GAME UX: HUD-style, animated transitions, min 14px text, zero overlap
 */

import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
} from 'react'
import { supabase } from '@/lib/supabase'
import { getWorldData } from './DataBridge'
import { callClaude } from '@/services/claudeProxy'
import { synthesizeWithElevenLabs, DEFAULT_VOICE_ID } from '@/api/voice/elevenLabs'

// ── Types ─────────────────────────────────────────────────────────────────────

export type MissionType =
  | 'collect_ar'
  | 'close_lead'
  | 'upsell_project'
  | 'add_subscription'
  | 'reduce_cost'

export interface GoalMission {
  id: string
  type: MissionType
  target_node_id?: string
  description: string
  estimated_value: number
  priority: 1 | 2 | 3 | 4 | 5
  completed?: boolean
}

export interface GoalState {
  active: boolean
  target: number          // monthly income target $
  current: number         // current monthly income $
  timeframe: 1 | 3 | 6 | 12
  missions: GoalMission[]
  completedIds: string[]
  activatedAt: number
  lastVoiceCoach: number  // timestamp of last coaching voice
  lastActivity: number    // timestamp of last user activity (for idle)
}

// ── Local storage key ─────────────────────────────────────────────────────────

const LS_KEY = 'nw45_goal_mode_state'

// ── Colors ────────────────────────────────────────────────────────────────────

const GOLD         = '#f59e0b'
const GOLD_DIM     = 'rgba(245,158,11,0.12)'
const GOLD_BORDER  = 'rgba(245,158,11,0.35)'
const GOLD_GLOW    = 'rgba(245,158,11,0.6)'
const RED_COLOR    = '#ef4444'
const AMBER_COLOR  = '#f59e0b'
const GREEN_COLOR  = '#22c55e'
const GLASS_BG     = 'rgba(6, 8, 20, 0.92)'
const GLASS_BORDER = 'rgba(245,158,11,0.30)'

// ── Priority helpers ──────────────────────────────────────────────────────────

function priorityColor(p: number): string {
  if (p <= 2) return RED_COLOR
  if (p === 3) return AMBER_COLOR
  return GREEN_COLOR
}

function priorityLabel(p: number): string {
  if (p === 1) return 'CRITICAL'
  if (p === 2) return 'URGENT'
  if (p === 3) return 'PRIORITY'
  if (p === 4) return 'BONUS'
  return 'OPTIONAL'
}

function missionIcon(type: MissionType): string {
  switch (type) {
    case 'collect_ar':       return '💰'
    case 'close_lead':       return '🎯'
    case 'upsell_project':   return '📈'
    case 'add_subscription': return '🔁'
    case 'reduce_cost':      return '✂️'
    default:                 return '◈'
  }
}

function fmt$(n: number): string {
  return '$' + Math.round(n).toLocaleString()
}

// ── NEXUS voice ───────────────────────────────────────────────────────────────

async function speakNexus(text: string) {
  try {
    const r = await synthesizeWithElevenLabs({ text, voice_id: DEFAULT_VOICE_ID })
    if (r.audioUrl) {
      const a = new Audio(r.audioUrl)
      a.volume = 0.85
      a.play().catch(() => {})
    }
  } catch { /* silent fail */ }
}

// ── Particle burst (CSS) helper ───────────────────────────────────────────────

function burstParticles(container: HTMLElement) {
  const N = 14
  for (let i = 0; i < N; i++) {
    const p = document.createElement('div')
    const angle = (i / N) * 360
    const dist  = 30 + Math.random() * 40
    p.style.cssText = `
      position:absolute;width:6px;height:6px;border-radius:50%;
      background:${GOLD};box-shadow:0 0 8px ${GOLD};
      left:50%;top:50%;transform:translate(-50%,-50%);
      pointer-events:none;z-index:999;
      animation:goalParticle 0.7s ease-out forwards;
      --angle:${angle}deg;--dist:${dist}px;
    `
    container.appendChild(p)
    setTimeout(() => p.remove(), 750)
  }
}

// ── LoadGoalState / SaveGoalState ─────────────────────────────────────────────

function loadGoalState(): GoalState | null {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (raw) return JSON.parse(raw) as GoalState
  } catch { /* ignore */ }
  return null
}

function saveGoalState(state: GoalState) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(state)) } catch { /* ignore */ }
}

async function persistToSupabase(completedIds: string[]) {
  try {
    const { data: { user } } = await (supabase as any).auth.getUser()
    if (!user) return
    const { data: profile } = await (supabase as any)
      .from('profiles').select('org_id').eq('id', user.id).single()
    const orgId = profile?.org_id
    if (!orgId) return
    const { data: existing } = await (supabase as any)
      .from('neural_world_settings')
      .select('id, settings')
      .eq('org_id', orgId)
      .maybeSingle()
    const patch = { goal_mode_completions: completedIds }
    if (existing?.id) {
      await (supabase as any)
        .from('neural_world_settings')
        .update({ settings: { ...(existing.settings ?? {}), ...patch } })
        .eq('id', existing.id)
    } else {
      await (supabase as any)
        .from('neural_world_settings')
        .insert({ org_id: orgId, settings: patch })
    }
  } catch { /* non-blocking */ }
}

// ── Compute current monthly income from DataBridge ───────────────────────────

function computeCurrentMonthlyIncome(): number {
  const data = getWorldData()
  // Use recentPaidAmount (last 30d) as proxy for monthly income
  const recent = data.accountingSignals?.recentPaidAmount ?? 0
  // Fallback: sum completed/approved projects amortized
  const projectIncome = data.projects.reduce((acc, p) => {
    if (p.status === 'completed' || p.status === 'approved') {
      return acc + (p.contract_value ?? 0) / 12
    }
    return acc
  }, 0)
  return recent > 0 ? recent : projectIncome
}

// ── Claude mission analysis ───────────────────────────────────────────────────

async function analyzeMissions(
  target: number,
  current: number,
  timeframe: number,
  signal?: AbortSignal,
): Promise<GoalMission[]> {
  const data = getWorldData()
  const gap  = Math.max(0, target - current)

  const systemPrompt = `You are NEXUS, the AI advisor for an electrical contractor business.
Analyze the business data and return structured JSON missions to help reach a monthly income goal.

Return ONLY valid JSON — an array of mission objects:
[
  {
    "id": "m1",
    "type": "collect_ar|close_lead|upsell_project|add_subscription|reduce_cost",
    "target_node_id": "optional project/lead id",
    "description": "Short action description (max 60 chars)",
    "estimated_value": 1234,
    "priority": 1
  }
]

Priority: 1=critical/urgent, 2=high, 3=medium, 4=bonus, 5=optional.
Types: collect_ar (chase overdue invoices), close_lead (close open estimates/leads),
       upsell_project (add scope to active project), add_subscription (recurring revenue),
       reduce_cost (cut overhead).
Generate 5-9 missions. Ensure total estimated_value >= gap.
Be specific about dollar amounts based on project/invoice data provided.`

  const projects = data.projects.slice(0, 12).map(p => ({
    id: p.id,
    name: p.name,
    status: p.status,
    contractValue: p.contract_value,
    phaseCompletion: p.phase_completion,
  }))
  const invoices = data.invoices.slice(0, 8).map(i => ({
    id: i.id,
    amount: i.amount,
    status: i.status,
    daysOld: i.created_at
      ? Math.floor((Date.now() - new Date(i.created_at).getTime()) / 86400000)
      : 0,
  }))

  const userMessage = `Business situation:
- Current monthly income: ${fmt$(current)}
- Monthly income TARGET: ${fmt$(target)}
- Income gap to close: ${fmt$(gap)}
- Timeframe: ${timeframe} month(s)
- Active projects (${projects.length}): ${JSON.stringify(projects)}
- Open invoices (${invoices.length}): ${JSON.stringify(invoices)}
- Overhead monthly: ${fmt$(data.accountingSignals?.overheadMonthly ?? 0)}
- AR over 30 days: ${data.accountingSignals?.arOver30Days?.length ?? 0} items

Generate missions to close the ${fmt$(gap)}/month gap.`

  const response = await callClaude({
    messages: [{ role: 'user', content: userMessage }],
    system: systemPrompt,
    max_tokens: 1200,
    signal,
  })

  const raw = response.content?.[0]?.text ?? '[]'
  // Extract JSON array
  const match = raw.match(/\[[\s\S]*\]/)
  if (!match) return fallbackMissions(gap)
  try {
    const parsed = JSON.parse(match[0]) as GoalMission[]
    return parsed.map((m, i) => ({
      ...m,
      id: m.id || `m${i + 1}`,
      completed: false,
    }))
  } catch {
    return fallbackMissions(gap)
  }
}

function fallbackMissions(gap: number): GoalMission[] {
  return [
    { id: 'm1', type: 'collect_ar',     description: 'Chase overdue AR invoices',           estimated_value: Math.round(gap * 0.4), priority: 1, completed: false },
    { id: 'm2', type: 'close_lead',     description: 'Close open estimate in pipeline',      estimated_value: Math.round(gap * 0.3), priority: 2, completed: false },
    { id: 'm3', type: 'upsell_project', description: 'Add scope to active project',          estimated_value: Math.round(gap * 0.2), priority: 3, completed: false },
    { id: 'm4', type: 'add_subscription', description: 'Offer maintenance contract',         estimated_value: Math.round(gap * 0.1), priority: 4, completed: false },
    { id: 'm5', type: 'reduce_cost',    description: 'Audit overhead — cut low-value spend', estimated_value: Math.round(gap * 0.05), priority: 5, completed: false },
  ]
}

// ── Progress bar color ────────────────────────────────────────────────────────

function progressBarColor(pct: number): string {
  if (pct < 35) return RED_COLOR
  if (pct < 70) return AMBER_COLOR
  return GREEN_COLOR
}

// ── GoalSetupPanel ─────────────────────────────────────────────────────────────

interface GoalSetupPanelProps {
  open: boolean
  onActivate: (target: number, timeframe: 1 | 3 | 6 | 12) => void
  onClose: () => void
  loading: boolean
}

export function GoalSetupPanel({ open, onActivate, onClose, loading }: GoalSetupPanelProps) {
  const [targetInput, setTargetInput] = useState('')
  const [timeframe, setTimeframe]     = useState<1 | 3 | 6 | 12>(3)

  const handleActivate = () => {
    const n = parseFloat(targetInput.replace(/[^0-9.]/g, ''))
    if (!n || n <= 0) return
    onActivate(n, timeframe)
  }

  if (!open) return null

  return (
    <div style={{
      position:        'fixed',
      inset:           0,
      zIndex:          120,
      display:         'flex',
      alignItems:      'center',
      justifyContent:  'center',
      background:      'rgba(0,0,0,0.65)',
      backdropFilter:  'blur(6px)',
      animation:       'goalFadeIn 0.25s ease',
    }}>
      <div style={{
        background:    GLASS_BG,
        border:        `1px solid ${GLASS_BORDER}`,
        borderRadius:  14,
        padding:       '32px 36px',
        width:         420,
        maxWidth:      '95vw',
        backdropFilter:'blur(24px)',
        boxShadow:     `0 0 60px rgba(245,158,11,0.15), 0 0 120px rgba(245,158,11,0.05)`,
        position:      'relative',
      }}>
        {/* Header */}
        <div style={{ marginBottom: 24 }}>
          <div style={{
            display:        'flex',
            alignItems:     'center',
            gap:            10,
            marginBottom:   8,
          }}>
            <span style={{ fontSize: 22 }}>🎯</span>
            <div>
              <div style={{
                color:        GOLD,
                fontSize:     16,
                fontFamily:   'monospace',
                fontWeight:   700,
                letterSpacing: 2,
              }}>
                GOAL MODE
              </div>
              <div style={{
                color:       'rgba(245,158,11,0.55)',
                fontSize:    11,
                fontFamily:  'monospace',
                letterSpacing: 1.5,
              }}>
                SET YOUR INCOME TARGET · NEXUS BUILDS THE PATH
              </div>
            </div>
          </div>
          <div style={{
            width:      '100%',
            height:     1,
            background: `linear-gradient(to right, ${GOLD_BORDER}, transparent)`,
          }} />
        </div>

        {/* Monthly Income Target */}
        <div style={{ marginBottom: 20 }}>
          <label style={{
            color:       'rgba(255,255,255,0.65)',
            fontSize:    13,
            fontFamily:  'monospace',
            letterSpacing: 1,
            display:     'block',
            marginBottom: 8,
          }}>
            MONTHLY INCOME TARGET
          </label>
          <div style={{ position: 'relative' }}>
            <span style={{
              position:   'absolute',
              left:       14,
              top:        '50%',
              transform:  'translateY(-50%)',
              color:      GOLD,
              fontSize:   18,
              fontFamily: 'monospace',
              fontWeight: 700,
              pointerEvents: 'none',
            }}>$</span>
            <input
              type="text"
              inputMode="numeric"
              value={targetInput}
              onChange={e => {
                const v = e.target.value.replace(/[^0-9]/g, '')
                setTargetInput(v ? Number(v).toLocaleString() : '')
              }}
              placeholder="25,000"
              style={{
                width:          '100%',
                background:     'rgba(255,255,255,0.04)',
                border:         `1px solid ${GOLD_BORDER}`,
                borderRadius:   7,
                color:          '#fff',
                fontSize:       22,
                fontFamily:     'monospace',
                fontWeight:     700,
                letterSpacing:  1,
                padding:        '12px 16px 12px 32px',
                outline:        'none',
                boxSizing:      'border-box',
                transition:     'border-color 0.2s',
              }}
              onFocus={e => { e.currentTarget.style.borderColor = GOLD }}
              onBlur={e  => { e.currentTarget.style.borderColor = GOLD_BORDER }}
            />
          </div>
        </div>

        {/* Timeframe dropdown */}
        <div style={{ marginBottom: 28 }}>
          <label style={{
            color:       'rgba(255,255,255,0.65)',
            fontSize:    13,
            fontFamily:  'monospace',
            letterSpacing: 1,
            display:     'block',
            marginBottom: 8,
          }}>
            TIMEFRAME
          </label>
          <select
            value={timeframe}
            onChange={e => setTimeframe(Number(e.target.value) as 1|3|6|12)}
            style={{
              width:       '100%',
              background:  'rgba(255,255,255,0.04)',
              border:      `1px solid ${GOLD_BORDER}`,
              borderRadius: 7,
              color:       '#fff',
              fontSize:    15,
              fontFamily:  'monospace',
              fontWeight:  600,
              letterSpacing: 1,
              padding:     '11px 14px',
              outline:     'none',
              cursor:      'pointer',
              appearance:  'none',
              boxSizing:   'border-box',
            }}
          >
            <option value={1}>1 month</option>
            <option value={3}>3 months</option>
            <option value={6}>6 months</option>
            <option value={12}>12 months</option>
          </select>
        </div>

        {/* Buttons */}
        <div style={{ display: 'flex', gap: 10 }}>
          <button
            onClick={handleActivate}
            disabled={loading || !targetInput}
            style={{
              flex:          1,
              background:    loading ? 'rgba(245,158,11,0.15)' : `linear-gradient(135deg, rgba(245,158,11,0.25), rgba(245,158,11,0.12))`,
              border:        `1px solid ${loading ? 'rgba(245,158,11,0.3)' : GOLD}`,
              borderRadius:  8,
              color:         loading ? 'rgba(245,158,11,0.5)' : GOLD,
              fontSize:      14,
              fontFamily:    'monospace',
              fontWeight:    700,
              letterSpacing: 2,
              padding:       '13px 0',
              cursor:        loading ? 'not-allowed' : 'pointer',
              transition:    'all 0.2s',
              display:       'flex',
              alignItems:    'center',
              justifyContent:'center',
              gap:           8,
            }}
          >
            {loading ? (
              <>
                <span style={{ animation: 'goalSpin 1s linear infinite', display: 'inline-block' }}>◌</span>
                ANALYZING...
              </>
            ) : (
              <>🎯 ACTIVATE GOAL MODE</>
            )}
          </button>
          <button
            onClick={onClose}
            style={{
              background:    'rgba(255,255,255,0.04)',
              border:        '1px solid rgba(255,255,255,0.12)',
              borderRadius:  8,
              color:         'rgba(255,255,255,0.45)',
              fontSize:      13,
              fontFamily:    'monospace',
              padding:       '13px 18px',
              cursor:        'pointer',
              letterSpacing: 1,
            }}
          >
            CANCEL
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Mission Detail Panel ───────────────────────────────────────────────────────

interface MissionDetailProps {
  mission: GoalMission | null
  onClose: () => void
  onComplete: (id: string, containerRef: React.RefObject<HTMLDivElement>) => void
}

function MissionDetailPanel({ mission, onClose, onComplete }: MissionDetailProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  if (!mission) return null

  const pc = priorityColor(mission.priority)

  return (
    <div style={{
      position:       'fixed',
      inset:          0,
      zIndex:         125,
      display:        'flex',
      alignItems:     'center',
      justifyContent: 'center',
      background:     'rgba(0,0,0,0.55)',
      backdropFilter: 'blur(4px)',
      animation:      'goalFadeIn 0.2s ease',
    }}>
      <div
        ref={containerRef}
        style={{
          background:    GLASS_BG,
          border:        `1px solid ${pc}50`,
          borderRadius:  12,
          padding:       '28px 32px',
          width:         380,
          maxWidth:      '92vw',
          backdropFilter:'blur(20px)',
          boxShadow:     `0 0 40px ${pc}20`,
          position:      'relative',
          overflow:      'hidden',
        }}
      >
        {/* Priority strip */}
        <div style={{
          position:   'absolute',
          top:        0,
          left:       0,
          right:      0,
          height:     3,
          background: `linear-gradient(to right, ${pc}, transparent)`,
        }} />

        {/* Mission icon + type */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <span style={{ fontSize: 24 }}>{missionIcon(mission.type)}</span>
          <div>
            <div style={{
              color:        pc,
              fontSize:     10,
              fontFamily:   'monospace',
              letterSpacing: 2,
              fontWeight:   700,
            }}>
              {priorityLabel(mission.priority)} · {mission.type.replace(/_/g, ' ').toUpperCase()}
            </div>
            <div style={{
              color:      '#fff',
              fontSize:   16,
              fontFamily: 'monospace',
              fontWeight: 700,
              marginTop:  3,
              lineHeight: 1.3,
            }}>
              {mission.description}
            </div>
          </div>
        </div>

        {/* Value */}
        <div style={{
          background:    GOLD_DIM,
          border:        `1px solid ${GOLD_BORDER}`,
          borderRadius:  8,
          padding:       '12px 16px',
          marginBottom:  20,
          display:       'flex',
          alignItems:    'center',
          justifyContent:'space-between',
        }}>
          <span style={{ color: 'rgba(255,255,255,0.55)', fontSize: 13, fontFamily: 'monospace', letterSpacing: 1 }}>
            ESTIMATED VALUE
          </span>
          <span style={{ color: GOLD, fontSize: 22, fontFamily: 'monospace', fontWeight: 700 }}>
            {fmt$(mission.estimated_value)}
          </span>
        </div>

        {/* Status */}
        {mission.completed ? (
          <div style={{
            textAlign:  'center',
            color:      GREEN_COLOR,
            fontSize:   15,
            fontFamily: 'monospace',
            fontWeight: 700,
            letterSpacing: 2,
            padding:    '12px 0',
          }}>
            ✓ MISSION COMPLETE
          </div>
        ) : (
          <button
            onClick={() => onComplete(mission.id, containerRef)}
            style={{
              width:         '100%',
              background:    `linear-gradient(135deg, rgba(245,158,11,0.25), rgba(245,158,11,0.10))`,
              border:        `1px solid ${GOLD}`,
              borderRadius:  8,
              color:         GOLD,
              fontSize:      14,
              fontFamily:    'monospace',
              fontWeight:    700,
              letterSpacing: 2,
              padding:       '13px 0',
              cursor:        'pointer',
              transition:    'all 0.15s',
              marginBottom:  10,
            }}
          >
            ⚡ MARK COMPLETE
          </button>
        )}

        <button
          onClick={onClose}
          style={{
            width:         '100%',
            background:    'transparent',
            border:        '1px solid rgba(255,255,255,0.10)',
            borderRadius:  7,
            color:         'rgba(255,255,255,0.40)',
            fontSize:      13,
            fontFamily:    'monospace',
            padding:       '9px 0',
            cursor:        'pointer',
            letterSpacing: 1,
          }}
        >
          CLOSE
        </button>
      </div>
    </div>
  )
}

// ── GoalTrackerHUD ─────────────────────────────────────────────────────────────

interface GoalTrackerHUDProps {
  goalState: GoalState
  onExit: () => void
  onMissionClick: (m: GoalMission) => void
  onNexusEncourage: () => void
}

export function GoalTrackerHUD({
  goalState,
  onExit,
  onMissionClick,
  onNexusEncourage,
}: GoalTrackerHUDProps) {
  const remaining   = goalState.missions.filter(m => !m.completed).length
  const earned      = goalState.missions
    .filter(m => m.completed)
    .reduce((s, m) => s + m.estimated_value, 0)
  const totalValue  = goalState.missions.reduce((s, m) => s + m.estimated_value, 0)
  const effective   = goalState.current + earned
  const pct         = goalState.target > 0 ? Math.min(100, Math.round((effective / goalState.target) * 100)) : 0
  const barColor    = progressBarColor(pct)

  return (
    <div style={{
      position:   'absolute',
      top:        14,
      right:      195,        // left of minimap
      zIndex:     50,
      width:      260,
      animation:  'goalSlideIn 0.3s ease',
    }}>
      {/* Progress bar block */}
      <div style={{
        background:    'rgba(6,8,20,0.90)',
        border:        `1px solid ${GOLD_BORDER}`,
        borderRadius:  8,
        padding:       '10px 12px',
        backdropFilter:'blur(12px)',
        boxShadow:     `0 0 20px rgba(245,158,11,0.10)`,
      }}>
        {/* Title row */}
        <div style={{
          display:       'flex',
          alignItems:    'center',
          justifyContent:'space-between',
          marginBottom:  7,
        }}>
          <div style={{
            color:      GOLD,
            fontSize:   10,
            fontFamily: 'monospace',
            fontWeight: 700,
            letterSpacing: 2,
          }}>
            🎯 GOAL MODE
          </div>
          <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
            {/* NEXUS encourage button */}
            <button
              onClick={onNexusEncourage}
              title="Ask NEXUS for encouragement"
              style={{
                background:  'transparent',
                border:      'none',
                color:       'rgba(245,158,11,0.6)',
                fontSize:    13,
                cursor:      'pointer',
                padding:     '0 3px',
                lineHeight:  1,
              }}
            >
              🤖
            </button>
            {/* Exit */}
            <button
              onClick={onExit}
              title="Exit Goal Mode"
              style={{
                background:  'transparent',
                border:      '1px solid rgba(255,255,255,0.12)',
                borderRadius: 4,
                color:       'rgba(255,255,255,0.40)',
                fontSize:    9,
                fontFamily:  'monospace',
                letterSpacing: 1,
                padding:     '2px 7px',
                cursor:      'pointer',
              }}
            >
              EXIT GOAL
            </button>
          </div>
        </div>

        {/* Value line */}
        <div style={{
          display:       'flex',
          alignItems:    'baseline',
          gap:           5,
          marginBottom:  5,
        }}>
          <span style={{ color: barColor, fontSize: 14, fontFamily: 'monospace', fontWeight: 700 }}>
            {fmt$(effective)}
          </span>
          <span style={{ color: 'rgba(255,255,255,0.35)', fontSize: 11, fontFamily: 'monospace' }}>
            / {fmt$(goalState.target)}
          </span>
          <span style={{ color: barColor, fontSize: 11, fontFamily: 'monospace', marginLeft: 'auto' }}>
            {pct}%
          </span>
        </div>

        {/* Progress bar */}
        <div style={{
          width:        '100%',
          height:       6,
          background:   'rgba(255,255,255,0.08)',
          borderRadius: 4,
          overflow:     'hidden',
          marginBottom: 7,
        }}>
          <div style={{
            width:        `${pct}%`,
            height:       '100%',
            background:   `linear-gradient(to right, ${barColor}aa, ${barColor})`,
            borderRadius: 4,
            transition:   'width 0.6s cubic-bezier(0.34, 1.56, 0.64, 1)',
            boxShadow:    `0 0 8px ${barColor}80`,
          }} />
        </div>

        {/* Missions row */}
        <div style={{
          color:      'rgba(255,255,255,0.45)',
          fontSize:   11,
          fontFamily: 'monospace',
          letterSpacing: 1,
        }}>
          {remaining} mission{remaining !== 1 ? 's' : ''} remaining
          {totalValue > 0 && (
            <span style={{ color: GOLD, marginLeft: 6 }}>
              · {fmt$(totalValue)} potential
            </span>
          )}
        </div>
      </div>

      {/* Mission list — top 3 incomplete */}
      <div style={{ marginTop: 4, display: 'flex', flexDirection: 'column', gap: 3 }}>
        {goalState.missions
          .filter(m => !m.completed)
          .sort((a, b) => a.priority - b.priority)
          .slice(0, 3)
          .map(m => (
            <button
              key={m.id}
              onClick={() => onMissionClick(m)}
              style={{
                display:       'flex',
                alignItems:    'center',
                gap:           7,
                background:    'rgba(6,8,20,0.88)',
                border:        `1px solid ${priorityColor(m.priority)}30`,
                borderLeft:    `3px solid ${priorityColor(m.priority)}`,
                borderRadius:  6,
                padding:       '7px 10px',
                cursor:        'pointer',
                textAlign:     'left',
                backdropFilter:'blur(8px)',
                transition:    'all 0.15s',
                width:         '100%',
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = `${priorityColor(m.priority)}15` }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(6,8,20,0.88)' }}
            >
              <span style={{ fontSize: 14, flexShrink: 0 }}>{missionIcon(m.type)}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  color:      '#fff',
                  fontSize:   11,
                  fontFamily: 'monospace',
                  fontWeight: 600,
                  overflow:   'hidden',
                  textOverflow:'ellipsis',
                  whiteSpace: 'nowrap',
                }}>
                  {m.description}
                </div>
                <div style={{
                  color:      priorityColor(m.priority),
                  fontSize:   10,
                  fontFamily: 'monospace',
                  letterSpacing: 0.5,
                }}>
                  {fmt$(m.estimated_value)} · P{m.priority}
                </div>
              </div>
              <span style={{ color: 'rgba(255,255,255,0.25)', fontSize: 11 }}>›</span>
            </button>
          ))}
      </div>
    </div>
  )
}

// ── SET GOAL button (exported for CommandHUD) ─────────────────────────────────

interface SetGoalButtonProps {
  active: boolean
  onClick: () => void
}

export function SetGoalButton({ active, onClick }: SetGoalButtonProps) {
  return (
    <button
      onClick={onClick}
      title={active ? 'Goal Mode active — click to view' : 'Set income goal and activate Goal Mode'}
      style={{
        display:       'flex',
        alignItems:    'center',
        gap:           5,
        padding:       '5px 10px',
        borderRadius:  5,
        border:        active ? `1px solid ${GOLD}` : `1px solid ${GOLD_BORDER}`,
        background:    active ? GOLD_DIM : 'rgba(5,3,0,0.75)',
        color:         active ? GOLD : 'rgba(245,158,11,0.65)',
        cursor:        'pointer',
        fontSize:      9,
        fontFamily:    'monospace',
        fontWeight:    700,
        letterSpacing: 1.5,
        backdropFilter:'blur(8px)',
        transition:    'all 0.15s',
        width:         'fit-content',
        boxShadow:     active ? `0 0 10px ${GOLD_GLOW}` : 'none',
        animation:     active ? 'goalPulseBtn 2s ease infinite' : 'none',
      }}
    >
      <span style={{ fontSize: 11 }}>🎯</span>
      {active ? 'GOAL ACTIVE' : 'SET GOAL'}
    </button>
  )
}

// ── Main GoalModeController ────────────────────────────────────────────────────

export default function GoalModeController() {
  const [setupOpen,  setSetupOpen]  = useState(false)
  const [loading,    setLoading]    = useState(false)
  const [goalState,  setGoalState]  = useState<GoalState | null>(() => {
    const s = loadGoalState()
    return s?.active ? s : null
  })
  const [selectedMission, setSelectedMission] = useState<GoalMission | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const completionCountRef = useRef(0)

  // Broadcast active state to GoldenPathLayer
  useEffect(() => {
    if (goalState?.active) {
      window.dispatchEvent(new CustomEvent('nw:goal-mode-activate', { detail: goalState }))
    } else {
      window.dispatchEvent(new CustomEvent('nw:goal-mode-deactivate'))
    }
  }, [goalState])

  // Listen for open-goal-setup from NEXUS Briefing
  useEffect(() => {
    function onOpen() { setSetupOpen(true) }
    window.addEventListener('nw:open-goal-setup', onOpen)
    return () => window.removeEventListener('nw:open-goal-setup', onOpen)
  }, [])

  // Idle coach: 60s after last activity
  useEffect(() => {
    if (!goalState?.active) return
    function resetIdle() {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current)
      idleTimerRef.current = setTimeout(async () => {
        const topMission = goalState?.missions
          .filter(m => !m.completed)
          .sort((a, b) => a.priority - b.priority)[0]
        if (topMission) {
          await speakNexus(`Still here. Fastest win right now: ${topMission.description}. That's ${fmt$(topMission.estimated_value)}.`)
        }
      }, 60000)
    }
    resetIdle()
    window.addEventListener('mousemove', resetIdle)
    window.addEventListener('keydown', resetIdle)
    return () => {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current)
      window.removeEventListener('mousemove', resetIdle)
      window.removeEventListener('keydown', resetIdle)
    }
  }, [goalState])

  // Handle activate
  const handleActivate = useCallback(async (target: number, timeframe: 1|3|6|12) => {
    setLoading(true)
    if (abortRef.current) abortRef.current.abort()
    abortRef.current = new AbortController()

    try {
      const current  = computeCurrentMonthlyIncome()
      const missions = await analyzeMissions(target, current, timeframe, abortRef.current.signal)

      const state: GoalState = {
        active:         true,
        target,
        current,
        timeframe,
        missions,
        completedIds:   [],
        activatedAt:    Date.now(),
        lastVoiceCoach: 0,
        lastActivity:   Date.now(),
      }
      setGoalState(state)
      saveGoalState(state)
      setSetupOpen(false)
      completionCountRef.current = 0

      // NEXUS voice activation
      const gap = Math.max(0, target - current)
      await speakNexus(`Goal Mode activated. Target: ${fmt$(target)} per month. Gap to close: ${fmt$(gap)}. ${missions.length} missions loaded. Golden path is live.`)
    } catch (err: any) {
      if (err?.name !== 'AbortError') {
        console.error('[GoalMode] analyze error:', err)
        setLoading(false)
      }
    } finally {
      setLoading(false)
    }
  }, [])

  // Handle mission complete
  const handleMissionComplete = useCallback(async (
    missionId: string,
    containerRef: React.RefObject<HTMLDivElement>,
  ) => {
    if (!goalState) return

    // Particle burst
    if (containerRef.current) {
      burstParticles(containerRef.current)
    }

    const mission = goalState.missions.find(m => m.id === missionId)
    const updated: GoalState = {
      ...goalState,
      missions:     goalState.missions.map(m => m.id === missionId ? { ...m, completed: true } : m),
      completedIds: [...goalState.completedIds, missionId],
      lastActivity: Date.now(),
    }
    setGoalState(updated)
    saveGoalState(updated)
    setSelectedMission(null)

    // Persist to Supabase
    persistToSupabase(updated.completedIds)

    // Dispatch waypoint complete event for GoldenPathLayer
    window.dispatchEvent(new CustomEvent('nw:goal-waypoint-complete', { detail: { missionId } }))

    // NEXUS voice
    if (mission) {
      await speakNexus(`Nice. ${fmt$(mission.estimated_value)} closer.`)
    }

    // Every 3 completions: coaching summary
    completionCountRef.current += 1
    if (completionCountRef.current % 3 === 0) {
      const completed = updated.missions.filter(m => m.completed)
      const totalEarned = completed.reduce((s, m) => s + m.estimated_value, 0)
      const remaining   = updated.missions.filter(m => !m.completed).length
      const elapsed     = (Date.now() - updated.activatedAt) / (1000 * 60 * 60 * 24 * 30)
      const pace        = elapsed > 0 ? Math.round(totalEarned / elapsed) : totalEarned

      setTimeout(async () => {
        await speakNexus(`${completionCountRef.current} missions done. ${fmt$(totalEarned)} recovered. ${remaining} remaining. At this pace, you hit target in ${Math.ceil(updated.target / pace)} months.`)
      }, 1500)
    }
  }, [goalState])

  // Exit goal mode
  const handleExit = useCallback(() => {
    if (goalState) {
      const saved: GoalState = { ...goalState, active: false }
      saveGoalState(saved)
    }
    setGoalState(null)
    setSelectedMission(null)
  }, [goalState])

  // NEXUS encouragement on demand
  const handleNexusEncourage = useCallback(async () => {
    if (!goalState) return
    const remaining = goalState.missions.filter(m => !m.completed)
    const top = remaining.sort((a, b) => a.priority - b.priority)[0]
    const earned = goalState.missions
      .filter(m => m.completed)
      .reduce((s, m) => s + m.estimated_value, 0)
    if (top) {
      await speakNexus(`You're ${fmt$(earned)} in. Next move: ${top.description}. Don't stop.`)
    } else {
      await speakNexus(`All missions complete. You crushed the goal. Respect.`)
    }
  }, [goalState])

  return (
    <>
      {/* CSS keyframes injected once */}
      <style>{`
        @keyframes goalFadeIn   { from { opacity:0; transform:scale(0.97) } to { opacity:1; transform:scale(1) } }
        @keyframes goalSlideIn  { from { opacity:0; transform:translateY(-8px) } to { opacity:1; transform:translateY(0) } }
        @keyframes goalSpin     { to   { transform:rotate(360deg) } }
        @keyframes goalPulseBtn { 0%,100% { box-shadow:0 0 8px rgba(245,158,11,0.4) } 50% { box-shadow:0 0 18px rgba(245,158,11,0.8) } }
        @keyframes goalParticle {
          0%   { transform:translate(-50%,-50%) }
          100% { transform:translate(calc(-50% + cos(var(--angle)) * var(--dist)), calc(-50% + sin(var(--angle)) * var(--dist))); opacity:0 }
        }
      `}</style>

      {/* Goal Setup Panel */}
      <GoalSetupPanel
        open={setupOpen && !goalState?.active}
        onActivate={handleActivate}
        onClose={() => setSetupOpen(false)}
        loading={loading}
      />

      {/* Persistent HUD while goal is active */}
      {goalState?.active && (
        <GoalTrackerHUD
          goalState={goalState}
          onExit={handleExit}
          onMissionClick={setSelectedMission}
          onNexusEncourage={handleNexusEncourage}
        />
      )}

      {/* Mission detail panel */}
      <MissionDetailPanel
        mission={selectedMission}
        onClose={() => setSelectedMission(null)}
        onComplete={handleMissionComplete}
      />

      {/* SET GOAL button exposed via custom event / ref — rendered in CommandHUD */}
    </>
  )
}

// ── Export trigger helper (for CommandHUD + NEXUS Briefing) ───────────────────

export function triggerGoalSetup() {
  window.dispatchEvent(new CustomEvent('nw:open-goal-setup'))
}

export function getGoalState(): GoalState | null {
  const s = loadGoalState()
  return s?.active ? s : null
}
