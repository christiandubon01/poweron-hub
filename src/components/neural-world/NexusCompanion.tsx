/**
 * NexusCompanion.tsx — NW26: NEXUS walk-along AI companion.
 *
 * Three modes (toggle button cycles between them):
 *   OFF          — companion disabled
 *   VOICE_ONLY   — no avatar; responds when you look at things
 *   AVATAR_VOICE — visible 3D figure walks with you + responds
 *
 * VISION SYSTEM:
 *   Every 2 seconds, casts a ray from camera center forward.
 *   If it hits a clickable node and the user has been looking at the same
 *   node for 3+ seconds, NEXUS speaks via callNexus() + ElevenLabs.
 *   Subtitle text shown at bottom center for 5 seconds.
 *
 * PROACTIVE OBSERVATIONS:
 *   Every 60 seconds (only when camera y < 30, i.e. FP or TP mode),
 *   NEXUS makes an unprompted observation about business health.
 *
 * CONVERSATION MODE:
 *   Press T → small text input appears at bottom center.
 *   Type question → NEXUS responds via callNexus() with full Neural World
 *   context (camera position, visible metrics, nearby nodes).
 *   Response is both spoken and shown as subtitle.
 *
 * Uses WorldContext (must be rendered inside WorldEngine).
 */

import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
} from 'react'
import * as THREE from 'three'
import { useWorldContext } from './WorldContext'
import { NexusCompanionAvatar } from './NexusCompanionAvatar'
import { callNexus } from '@/services/claudeProxy'
import { synthesizeWithElevenLabs, DEFAULT_VOICE_ID } from '@/api/voice/elevenLabs'
import { getWorldData } from './DataBridge'
import type { NexusRequest } from '@/agents/nexusPromptEngine'

// ── Types ──────────────────────────────────────────────────────────────────────

type CompanionMode = 'OFF' | 'VOICE_ONLY' | 'AVATAR_VOICE'

// ── Static node info lookup ────────────────────────────────────────────────────

interface NodeMeta {
  name: string
  type: string
}

const STATIC_NODE_META: Record<string, NodeMeta> = {
  VAULT:        { name: 'VAULT',              type: 'Agent — Project Intelligence' },
  LEDGER:       { name: 'LEDGER',             type: 'Agent — Accounts Receivable' },
  OHM:          { name: 'OHM',                type: 'Agent — Overhead Monitor' },
  CHRONO:       { name: 'CHRONO',             type: 'Agent — Schedule Intelligence' },
  BLUEPRINT:    { name: 'BLUEPRINT',          type: 'Agent — Blueprint AI' },
  SPARK:        { name: 'SPARK',              type: 'Agent — Lead Intelligence' },
  SCOUT:        { name: 'SCOUT',              type: 'Agent — Market Scout' },
  ECHO:         { name: 'ECHO',               type: 'Agent — Context Memory' },
  ATLAS:        { name: 'ATLAS',              type: 'Agent — Business Atlas' },
  NEXUS:        { name: 'NEXUS',              type: 'Agent — AI Orchestration Brain' },
  MTZ_PLATEAU:  { name: 'MTZ Solar Plateau',  type: 'Revenue Terrain — Solar Income' },
  NDA_GATE:     { name: 'NDA Gate',           type: 'Access Control — Subscriber Entry' },
  IP_FORTRESS:  { name: 'IP Fortress',        type: 'Defense Structure — IP Protection' },
  MRR_MOUNTAIN: { name: 'MRR Mountain',       type: 'Revenue Terrain — Monthly Recurring Revenue' },
}

function resolveNodeMeta(nodeId: string): NodeMeta {
  if (STATIC_NODE_META[nodeId]) return STATIC_NODE_META[nodeId]
  if (nodeId.startsWith('project_')) {
    const data = getWorldData()
    const raw  = nodeId.replace('project_', '')
    const proj = data.projects.find(p => p.id === raw)
    return {
      name: proj?.name ?? raw.slice(0, 24),
      type: `Project Mountain — ${(proj?.status ?? 'unknown').replace('_', ' ').toUpperCase()}`,
    }
  }
  if (nodeId.startsWith('sub_tower_')) {
    const tier = nodeId.replace('sub_tower_', '').toUpperCase()
    return { name: `${tier} Subscription Tower`, type: 'Revenue Structure — Hub Subscription' }
  }
  return { name: nodeId, type: 'World Node' }
}

// ── Proactive observation templates ───────────────────────────────────────────

type ProactiveTemplate = (data: ReturnType<typeof getWorldData>) => string | null

const PROACTIVE_TEMPLATES: ProactiveTemplate[] = [
  // AR stalactite age
  (data) => {
    const unpaid = data.invoices.filter(
      inv => inv.status !== 'paid' && inv.status !== 'cancelled' && inv.created_at != null,
    )
    if (unpaid.length === 0) return null
    const oldest = unpaid.slice().sort((a, b) => {
      return new Date(a.created_at!).getTime() - new Date(b.created_at!).getTime()
    })[0]
    if (!oldest.created_at) return null
    const days = Math.floor((Date.now() - new Date(oldest.created_at).getTime()) / 86400000)
    if (days < 20) return null
    const proj = data.projects.find(p => p.id === oldest.project_id)
    const name = proj?.name ?? 'a project'
    return `That AR stalactite on ${name} is getting long — ${days} days unpaid.`
  },

  // SPARK tower — lead activity
  (data) => {
    const recentLeads = data.projects.filter(p => {
      if (p.status !== 'lead' || !p.created_at) return false
      return (Date.now() - new Date(p.created_at).getTime()) < 7 * 86400000
    })
    if (recentLeads.length > 0) return null  // active leads — nothing to flag
    const totalLeads = data.projects.filter(p => p.status === 'lead').length
    if (totalLeads === 0) return 'The SPARK tower is quiet — no leads in the pipeline.'
    return 'The SPARK tower is quiet — no new leads this week.'
  },

  // Revenue river
  (data) => {
    const { recentPaidAmount } = data.accountingSignals
    if (recentPaidAmount <= 0) return 'Revenue river is running low — no payments cleared recently.'
    return `Revenue river is flowing strong today — $${Math.round(recentPaidAmount).toLocaleString()} cleared in the last 30 days.`
  },

  // Active project health
  (data) => {
    const active  = data.projects.filter(p => p.status === 'in_progress')
    if (active.length === 0) return null
    const unhealthy = active.filter(p => p.health_score < 70)
    if (unhealthy.length === 0) return `${active.length} active project${active.length > 1 ? 's' : ''} — all health scores looking solid.`
    return `${unhealthy.length} of your active projects have health scores below 70 — might be worth a check-in.`
  },
]

// ── Constants ──────────────────────────────────────────────────────────────────

const GAZE_TRIGGER_MS   = 3000   // ms before NEXUS speaks about a gazed node
const VISION_SCAN_MS    = 2000   // raycasting interval
const SUBTITLE_SHOW_MS  = 5000   // how long subtitle stays visible
const PROACTIVE_WAIT_MS = 60000  // proactive observation interval
const ORBIT_Y_THRESHOLD = 30     // camera y above this = orbit (no proactive obs)

// ── Styles ─────────────────────────────────────────────────────────────────────

const FONT = 'monospace'
const TEAL = '#00e5cc'

// ── Component ──────────────────────────────────────────────────────────────────

export function NexusCompanion() {
  const { scene, camera } = useWorldContext()

  // ── Companion mode ────────────────────────────────────────────────────────

  const [mode, setMode]   = useState<CompanionMode>('OFF')
  const modeRef           = useRef<CompanionMode>('OFF')
  useEffect(() => { modeRef.current = mode }, [mode])

  // ── Speaking state ────────────────────────────────────────────────────────

  const [speaking, setSpeaking] = useState(false)

  // ── Subtitle ──────────────────────────────────────────────────────────────

  const [subtitle,        setSubtitle]        = useState('')
  const [subtitleVisible, setSubtitleVisible] = useState(false)
  const subtitleTimerRef  = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Avatar head-turn target ───────────────────────────────────────────────

  const [targetNodeWorldPos, setTargetNodeWorldPos] = useState<THREE.Vector3 | null>(null)

  // ── Gaze tracking ─────────────────────────────────────────────────────────

  const gazeNodeIdRef       = useRef<string | null>(null)
  const gazeSinceRef        = useRef<number>(0)
  const lastScanRef         = useRef<number>(0)
  const lastSpokeNodeRef    = useRef<string | null>(null)

  // ── Proactive observations ────────────────────────────────────────────────

  const lastProactiveRef    = useRef<number>(Date.now())
  const proactiveIdxRef     = useRef<number>(0)

  // ── Busy guard (prevents overlapping API calls) ───────────────────────────

  const nexusBusyRef        = useRef(false)

  // ── Raycaster ─────────────────────────────────────────────────────────────

  const raycasterRef        = useRef(new THREE.Raycaster())

  // ── Conversation mode ─────────────────────────────────────────────────────

  const [chatOpen,  setChatOpen]  = useState(false)
  const [chatInput, setChatInput] = useState('')
  const [chatBusy,  setChatBusy]  = useState(false)
  const chatInputRef = useRef<HTMLInputElement>(null)

  // ── Cycle mode (toggle button) ─────────────────────────────────────────────

  const cycleMode = useCallback(() => {
    setMode(prev => {
      if (prev === 'OFF')        return 'VOICE_ONLY'
      if (prev === 'VOICE_ONLY') return 'AVATAR_VOICE'
      return 'OFF'
    })
  }, [])

  // ── T-key: open/close conversation input ─────────────────────────────────

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.code === 'KeyT' && !e.ctrlKey && !e.altKey && !e.metaKey) {
        if (modeRef.current === 'OFF') return
        const tag = (document.activeElement as HTMLElement | null)?.tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA') return
        setChatOpen(prev => !prev)
      }
      if (e.code === 'Escape') {
        setChatOpen(false)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  // Focus input when chat opens; clear when it closes
  useEffect(() => {
    if (chatOpen) {
      setTimeout(() => chatInputRef.current?.focus(), 60)
    } else {
      setChatInput('')
    }
  }, [chatOpen])

  // ── Show subtitle helper ──────────────────────────────────────────────────

  const showSubtitle = useCallback((text: string) => {
    setSubtitle(text)
    setSubtitleVisible(true)
    if (subtitleTimerRef.current) clearTimeout(subtitleTimerRef.current)
    subtitleTimerRef.current = setTimeout(() => setSubtitleVisible(false), SUBTITLE_SHOW_MS)
  }, [])

  // ── speakNexus: synthesise text + show subtitle ───────────────────────────

  const speakNexus = useCallback(async (text: string): Promise<void> => {
    if (nexusBusyRef.current) return
    nexusBusyRef.current = true
    setSpeaking(true)
    showSubtitle(text)
    try {
      await synthesizeWithElevenLabs({ text, voice_id: DEFAULT_VOICE_ID })
    } catch {
      // ElevenLabs may not be available — subtitle still shows
    } finally {
      setSpeaking(false)
      nexusBusyRef.current = false
    }
  }, [showSubtitle])

  // ── queryAndSpeak: callNexus + synthesise + subtitle ─────────────────────

  const queryAndSpeak = useCallback(async (query: string): Promise<void> => {
    if (nexusBusyRef.current) return
    nexusBusyRef.current = true
    setSpeaking(true)
    try {
      const req: NexusRequest = {
        query,
        agentMode: 'NEXUS',
        sessionContext:
          'Context: Neural World NEXUS walk-along companion. ' +
          'Respond in 2–3 sentences. Conversational, voice-ready. No markdown. No bullet points.',
      }
      const response   = await callNexus(req)
      const speakText  = (response.speak ?? (response as { response?: string }).response ?? 'Analysis complete.').trim()

      showSubtitle(speakText)
      try {
        await synthesizeWithElevenLabs({ text: speakText, voice_id: DEFAULT_VOICE_ID })
      } catch {
        // Non-blocking — subtitle already shown
      }
    } catch (err) {
      console.warn('[NexusCompanion] queryAndSpeak error:', err)
    } finally {
      setSpeaking(false)
      nexusBusyRef.current = false
    }
  }, [showSubtitle])

  // ── Vision scan + proactive obs via nw:frame ──────────────────────────────

  useEffect(() => {
    function onFrame() {
      if (modeRef.current === 'OFF') return

      const now = performance.now()

      // ── Proactive observations every 60 s (FP / TP only) ──────────────────

      if (
        now - lastProactiveRef.current > PROACTIVE_WAIT_MS &&
        camera.position.y < ORBIT_Y_THRESHOLD &&
        !nexusBusyRef.current
      ) {
        lastProactiveRef.current = now
        const data      = getWorldData()
        let message: string | null = null

        for (let i = 0; i < PROACTIVE_TEMPLATES.length; i++) {
          const idx = (proactiveIdxRef.current + i) % PROACTIVE_TEMPLATES.length
          const msg = PROACTIVE_TEMPLATES[idx](data)
          if (msg) {
            message            = msg
            proactiveIdxRef.current = (idx + 1) % PROACTIVE_TEMPLATES.length
            break
          }
        }
        if (message) {
          speakNexus(message)
          return  // skip vision scan this tick
        }
      }

      // ── Vision scan every 2 s ──────────────────────────────────────────────

      if (now - lastScanRef.current < VISION_SCAN_MS) return
      lastScanRef.current = now

      // Collect hit-mesh targets from scene (tagged by NodeClickSystem)
      const targets: THREE.Object3D[] = []
      scene.traverse((obj) => {
        if (obj instanceof THREE.Mesh && obj.userData.nodeId) {
          targets.push(obj)
        }
      })

      if (targets.length === 0) return

      // Ray from camera center (NDC 0,0 = screen centre)
      raycasterRef.current.setFromCamera(new THREE.Vector2(0, 0), camera)
      const hits = raycasterRef.current.intersectObjects(targets, false)

      if (hits.length > 0) {
        const nodeId = hits[0].object.userData.nodeId as string

        if (nodeId === gazeNodeIdRef.current) {
          // Same node — check whether 3 s gaze threshold reached
          const gazeDuration = now - gazeSinceRef.current

          if (
            gazeDuration >= GAZE_TRIGGER_MS &&
            lastSpokeNodeRef.current !== nodeId &&
            !nexusBusyRef.current
          ) {
            lastSpokeNodeRef.current = nodeId
            const info = resolveNodeMeta(nodeId)
            const data = getWorldData()

            // Build context query
            const proj = nodeId.startsWith('project_')
              ? data.projects.find(p => `project_${p.id}` === nodeId)
              : null

            const metricsCtx = proj
              ? `Contract value: $${proj.contract_value.toLocaleString()}. ` +
                `Health score: ${proj.health_score}%. ` +
                `Phase: ${Math.round(proj.phase_completion)}% complete. ` +
                `Status: ${proj.status.replace('_', ' ')}.`
              : ''

            const query =
              `The user is looking at ${info.name} which is ${info.type}. ` +
              `${metricsCtx} ` +
              `Explain what this means for the business in 2–3 sentences.`

            // Drive avatar head toward this node
            const nodeWorldPos = hits[0].object.position.clone()
            setTargetNodeWorldPos(nodeWorldPos)
            setTimeout(() => setTargetNodeWorldPos(null), 8000)

            queryAndSpeak(query)
          }
        } else {
          // New node entered gaze
          gazeNodeIdRef.current = nodeId
          gazeSinceRef.current  = now
          // Allow NEXUS to re-speak if user looks away and back
          if (lastSpokeNodeRef.current === nodeId) {
            lastSpokeNodeRef.current = null
          }
        }
      } else {
        // Nothing in crosshair — reset gaze
        gazeNodeIdRef.current = null
        gazeSinceRef.current  = 0
      }
    }

    window.addEventListener('nw:frame', onFrame)
    return () => window.removeEventListener('nw:frame', onFrame)
  }, [scene, camera, queryAndSpeak, speakNexus])

  // ── Chat submit ───────────────────────────────────────────────────────────

  const handleChatSubmit = useCallback(async () => {
    const q = chatInput.trim()
    if (!q || chatBusy || nexusBusyRef.current) return

    setChatBusy(true)
    setChatOpen(false)
    setChatInput('')

    // Inject Neural World context
    const data     = getWorldData()
    const camPos   = camera.position
    const active   = data.projects.filter(p => p.status === 'in_progress')
    const recentAR = data.accountingSignals.recentPaidAmount
    const signals  = data.accountingSignals

    const context =
      `Neural World session. ` +
      `Camera at (${Math.round(camPos.x)}, ${Math.round(camPos.y)}, ${Math.round(camPos.z)}). ` +
      `Active projects: ${active.length}. ` +
      `Recent 30-day revenue: $${Math.round(recentAR).toLocaleString()}. ` +
      `Active crew: ${signals.activeCrewCount}. ` +
      `AR over 30 days: ${signals.arOver30Days.length} invoice(s). ` +
      `User question: ${q}`

    try {
      await queryAndSpeak(context)
    } finally {
      setChatBusy(false)
    }
  }, [chatInput, chatBusy, camera, queryAndSpeak])

  // ── Cleanup ───────────────────────────────────────────────────────────────

  useEffect(() => {
    return () => {
      if (subtitleTimerRef.current) clearTimeout(subtitleTimerRef.current)
    }
  }, [])

  // ── Derived display values ────────────────────────────────────────────────

  const modeLabel  =
    mode === 'OFF'         ? 'NEXUS: OFF'    :
    mode === 'VOICE_ONLY'  ? 'NEXUS: VOICE'  : 'NEXUS: AVATAR'

  const modeColor  =
    mode === 'OFF' ? 'rgba(0,229,204,0.35)' :
    mode === 'VOICE_ONLY' ? 'rgba(0,229,204,0.72)' : TEAL

  const modeBg     =
    mode === 'OFF' ? 'rgba(0,8,12,0.78)' : 'rgba(0,28,36,0.88)'

  const modeBorder =
    mode === 'OFF' ? 'rgba(0,229,204,0.22)' : 'rgba(0,229,204,0.65)'

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <>
      {/* ── 3D Avatar (only in AVATAR_VOICE mode) ────────────────────────── */}
      <NexusCompanionAvatar
        visible={mode === 'AVATAR_VOICE'}
        speaking={speaking}
        targetNodeWorldPos={targetNodeWorldPos}
      />

      {/* ── Mode toggle button ────────────────────────────────────────────── */}
      <button
        onClick={cycleMode}
        title="Cycle NEXUS companion: OFF → VOICE ONLY → AVATAR+VOICE"
        style={{
          position:       'absolute',
          bottom:         72,
          left:           14,
          zIndex:         35,
          display:        'flex',
          alignItems:     'center',
          gap:            6,
          background:     modeBg,
          border:         `1px solid ${modeBorder}`,
          borderRadius:   6,
          color:          modeColor,
          fontSize:       9,
          fontFamily:     FONT,
          fontWeight:     700,
          letterSpacing:  1.5,
          padding:        '7px 12px',
          cursor:         'pointer',
          backdropFilter: 'blur(8px)',
          transition:     'all 0.15s',
          boxShadow:      mode !== 'OFF' ? '0 0 12px rgba(0,229,204,0.18)' : 'none',
        }}
      >
        <span style={{ fontSize: 13 }}>◈</span>
        {modeLabel}
        {speaking && (
          <span
            style={{
              display:         'inline-block',
              width:           7,
              height:          7,
              borderRadius:    '50%',
              background:      TEAL,
              boxShadow:       `0 0 6px ${TEAL}`,
              animation:       'nw-glow-pulse 0.55s ease-in-out infinite',
              flexShrink:      0,
            }}
          />
        )}
      </button>

      {/* ── [T] talk hint ─────────────────────────────────────────────────── */}
      {mode !== 'OFF' && !chatOpen && (
        <div
          style={{
            position:      'absolute',
            bottom:        108,
            left:          14,
            zIndex:        35,
            fontSize:      8,
            fontFamily:    FONT,
            color:         'rgba(0,229,204,0.38)',
            letterSpacing: 1,
            pointerEvents: 'none',
          }}
        >
          [T] talk to NEXUS
        </div>
      )}

      {/* ── Subtitle bar ─────────────────────────────────────────────────── */}
      {subtitleVisible && subtitle && mode !== 'OFF' && (
        <div
          style={{
            position:      'absolute',
            bottom:        26,
            left:          '50%',
            transform:     'translateX(-50%)',
            zIndex:        35,
            pointerEvents: 'none',
            maxWidth:      580,
            width:         'calc(100vw - 60px)',
            textAlign:     'center',
          }}
        >
          <div
            style={{
              background:    'rgba(0,12,18,0.92)',
              border:        '1px solid rgba(0,229,204,0.55)',
              borderRadius:  7,
              padding:       '8px 20px',
              fontFamily:    FONT,
              fontSize:      12,
              color:         '#cceedd',
              letterSpacing: 0.3,
              lineHeight:    1.55,
              backdropFilter:'blur(10px)',
              boxShadow:     '0 0 22px rgba(0,229,204,0.1)',
            }}
          >
            <span style={{ color: TEAL, opacity: 0.65, marginRight: 8 }}>◈ NEXUS</span>
            {subtitle}
          </div>
        </div>
      )}

      {/* ── Conversation input panel ──────────────────────────────────────── */}
      {chatOpen && mode !== 'OFF' && (
        <div
          style={{
            position:  'absolute',
            bottom:    26,
            left:      '50%',
            transform: 'translateX(-50%)',
            zIndex:    42,
            width:     500,
            maxWidth:  'calc(100vw - 32px)',
          }}
        >
          <div
            style={{
              background:    'rgba(0,12,20,0.96)',
              border:        `1px solid rgba(0,229,204,0.75)`,
              borderRadius:  9,
              padding:       '10px 14px',
              backdropFilter:'blur(16px)',
              boxShadow:     '0 0 32px rgba(0,229,204,0.18)',
            }}
          >
            <div
              style={{
                fontSize:      9,
                fontFamily:    FONT,
                color:         'rgba(0,229,204,0.55)',
                letterSpacing: 2,
                marginBottom:  8,
              }}
            >
              ◈ ASK NEXUS — [Enter] send · [Esc] close
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              <input
                ref={chatInputRef}
                value={chatInput}
                onChange={e => setChatInput(e.target.value)}
                onKeyDown={e => {
                  if (e.code === 'Enter')  { e.preventDefault(); handleChatSubmit() }
                  if (e.code === 'Escape') { setChatOpen(false) }
                  e.stopPropagation()  // prevent NW camera from capturing WASD
                }}
                placeholder="Ask anything about your business…"
                style={{
                  flex:         1,
                  background:   'rgba(0,25,35,0.82)',
                  border:       '1px solid rgba(0,229,204,0.32)',
                  borderRadius: 5,
                  color:        '#cceedd',
                  fontSize:     12,
                  fontFamily:   FONT,
                  padding:      '7px 11px',
                  outline:      'none',
                  letterSpacing: 0.2,
                }}
              />
              <button
                onClick={handleChatSubmit}
                disabled={chatBusy || !chatInput.trim()}
                style={{
                  background:   chatBusy ? 'rgba(0,70,55,0.55)' : 'rgba(0,190,150,0.22)',
                  border:       `1px solid rgba(0,229,204,0.62)`,
                  borderRadius: 5,
                  color:        TEAL,
                  fontSize:     10,
                  fontFamily:   FONT,
                  fontWeight:   700,
                  letterSpacing: 1,
                  padding:      '7px 15px',
                  cursor:       chatBusy ? 'wait' : 'pointer',
                  flexShrink:   0,
                  opacity:      chatInput.trim() ? 1 : 0.5,
                }}
              >
                {chatBusy ? '…' : 'ASK'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
