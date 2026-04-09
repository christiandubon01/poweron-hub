/**
 * ProjectionNarrator.tsx — NW34: NEXUS-guided domain walkthrough narrator.
 *
 * After world reshape, NEXUS walks through each affected domain:
 *   - Camera auto-flies to domain
 *   - Narration text displayed at bottom center (subtitle style)
 *   - ElevenLabs Oxley voice plays audio
 *   - ESC to skip all, Space to pause/resume
 *
 * After walkthrough: summary HUD card at bottom-center with financial projection.
 *
 * Emits:
 *   nw:narrator-fly-to  — { target: string, index: number } — camera fly request
 *
 * Listens:
 *   nw:projection-narrate — { steps: NarratorStep[] } — start narration
 */

import React, { useState, useEffect, useRef, useCallback } from 'react'
import { synthesizeWithElevenLabs, DEFAULT_VOICE_ID } from '@/api/voice/elevenLabs'

// ── Types ──────────────────────────────────────────────────────────────────────

export interface NarratorStep {
  domain: string
  target_id: string       // camera fly-to target name
  text: string            // narration text
  duration_ms?: number    // default 9000
}

export interface ProjectionSummary {
  monthly_revenue: number
  monthly_cost: number
  net_monthly: number
  roi_months: number
  risks: string[]
  opportunities: string[]
  scenario_label: string
}

// ── Component ──────────────────────────────────────────────────────────────────

export default function ProjectionNarrator() {
  const [steps, setSteps]             = useState<NarratorStep[]>([])
  const [currentIdx, setCurrentIdx]   = useState(0)
  const [active, setActive]           = useState(false)
  const [paused, setPaused]           = useState(false)
  const [subtitleText, setSubtitleText] = useState('')
  const [subtitleVisible, setSubtitleVisible] = useState(false)
  const [summary, setSummary]         = useState<ProjectionSummary | null>(null)
  const [summaryVisible, setSummaryVisible] = useState(false)
  const [audioLoading, setAudioLoading] = useState(false)

  const pausedRef      = useRef(false)
  const audioRef       = useRef<HTMLAudioElement | null>(null)
  const stepTimerRef   = useRef<ReturnType<typeof setTimeout> | null>(null)
  const abortRef       = useRef<AbortController | null>(null)

  // ── Keyboard handlers ──────────────────────────────────────────────────────
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.code === 'Escape' && active) {
        stopNarration()
      }
      if (e.code === 'Space' && active) {
        e.preventDefault()
        togglePause()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

  // ── Start narration event ──────────────────────────────────────────────────
  useEffect(() => {
    function onNarrate(e: Event) {
      const ev = e as CustomEvent<{ steps: NarratorStep[]; summary?: ProjectionSummary }>
      if (!ev.detail?.steps?.length) return
      setSteps(ev.detail.steps)
      if (ev.detail.summary) setSummary(ev.detail.summary)
      setCurrentIdx(0)
      setActive(true)
      setSummaryVisible(false)
      setPaused(false)
      pausedRef.current = false
    }
    window.addEventListener('nw:projection-narrate', onNarrate)
    return () => window.removeEventListener('nw:projection-narrate', onNarrate)
  }, [])

  // ── Drive narration steps ──────────────────────────────────────────────────
  useEffect(() => {
    if (!active || steps.length === 0) return
    if (currentIdx >= steps.length) {
      // All done — show summary
      setSubtitleVisible(false)
      setActive(false)
      if (summary) setSummaryVisible(true)
      return
    }

    const step = steps[currentIdx]
    const duration = step.duration_ms ?? 9000

    // Request camera fly
    window.dispatchEvent(new CustomEvent('nw:narrator-fly-to', {
      detail: { target: step.target_id, index: currentIdx },
    }))

    // Show subtitle
    setSubtitleText(step.text)
    setSubtitleVisible(true)

    // Speak via ElevenLabs
    speakStep(step.text)

    // Advance after duration (unless paused/stopped)
    stepTimerRef.current = setTimeout(() => {
      if (pausedRef.current) return
      setCurrentIdx(i => i + 1)
    }, duration)

    return () => {
      if (stepTimerRef.current) clearTimeout(stepTimerRef.current)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, currentIdx, steps])

  const speakStep = useCallback(async (text: string) => {
    // Stop any current audio
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current = null
    }
    abortRef.current?.abort()
    abortRef.current = new AbortController()

    setAudioLoading(true)
    try {
      const result = await synthesizeWithElevenLabs({
        text,
        voice_id: DEFAULT_VOICE_ID,
        voice_settings: {
          stability: 0.55,
          similarity_boost: 0.82,
          style: 0.3,
          use_speaker_boost: true,
        },
      })
      const audio = new Audio(result.audioUrl)
      audioRef.current = audio
      audio.play().catch(() => {})
    } catch {
      // Non-blocking — narration continues without audio
    } finally {
      setAudioLoading(false)
    }
  }, [])

  const stopNarration = useCallback(() => {
    if (stepTimerRef.current) clearTimeout(stepTimerRef.current)
    audioRef.current?.pause()
    audioRef.current = null
    abortRef.current?.abort()
    setActive(false)
    setSubtitleVisible(false)
    if (summary) setSummaryVisible(true)
  }, [summary])

  const togglePause = useCallback(() => {
    setPaused(p => {
      const next = !p
      pausedRef.current = next
      if (next) {
        // pause audio + timer
        audioRef.current?.pause()
        if (stepTimerRef.current) clearTimeout(stepTimerRef.current)
      } else {
        // resume audio
        audioRef.current?.play().catch(() => {})
        // resume step timer from beginning of step (simplified — re-advance)
        const step = steps[currentIdx]
        const remaining = (step?.duration_ms ?? 9000) * 0.4 // resume from ~60% done
        stepTimerRef.current = setTimeout(() => {
          if (!pausedRef.current) setCurrentIdx(i => i + 1)
        }, remaining)
      }
      return next
    })
  }, [currentIdx, steps])

  const progress = steps.length > 0 ? ((currentIdx) / steps.length) * 100 : 0

  return (
    <>
      {/* ── SUBTITLE BAR (bottom-center, above camera controls) ── */}
      {subtitleVisible && (
        <div
          style={{
            position: 'absolute',
            bottom: 220,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 35,
            maxWidth: 680,
            width: '90%',
            pointerEvents: 'none',
            animation: 'nw-fade-in 0.4s ease',
          }}
        >
          {/* Domain label */}
          {steps[currentIdx] && (
            <div style={{
              textAlign: 'center',
              color: '#ffb432',
              fontFamily: 'monospace',
              fontSize: 9,
              letterSpacing: 2,
              fontWeight: 700,
              marginBottom: 5,
              opacity: 0.8,
            }}>
              {audioLoading && <span style={{ marginRight: 6 }}>◌</span>}
              NEXUS · DOMAIN {currentIdx + 1}/{steps.length} · {steps[currentIdx]?.domain?.toUpperCase()}
              {paused && <span style={{ marginLeft: 8, color: '#ff9944' }}>⏸ PAUSED</span>}
            </div>
          )}

          {/* Subtitle text */}
          <div style={{
            background: 'rgba(4,8,16,0.82)',
            backdropFilter: 'blur(10px)',
            border: '1px solid rgba(255,180,50,0.25)',
            borderRadius: 8,
            padding: '12px 18px',
            color: 'rgba(255,255,255,0.9)',
            fontFamily: 'monospace',
            fontSize: 14,
            lineHeight: 1.65,
            textAlign: 'center',
            textShadow: '0 1px 3px rgba(0,0,0,0.8)',
          }}>
            {subtitleText}
          </div>

          {/* Progress bar */}
          <div style={{
            height: 2,
            background: 'rgba(255,255,255,0.1)',
            borderRadius: 2,
            marginTop: 6,
            overflow: 'hidden',
          }}>
            <div style={{
              height: '100%',
              width: `${progress}%`,
              background: '#ffb432',
              borderRadius: 2,
              transition: 'width 0.5s linear',
            }} />
          </div>

          {/* Controls hint */}
          <div style={{
            textAlign: 'center',
            marginTop: 4,
            color: 'rgba(255,255,255,0.25)',
            fontFamily: 'monospace',
            fontSize: 9,
            letterSpacing: 1,
          }}>
            SPACE pause · ESC skip
          </div>
        </div>
      )}

      {/* ── PROJECTION SUMMARY CARD (bottom-center, after walkthrough) ── */}
      {summaryVisible && summary && (
        <div
          style={{
            position: 'absolute',
            bottom: 170,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 35,
            width: 580,
            maxWidth: '92%',
            animation: 'nw-slide-up 0.45s cubic-bezier(0.22,0.61,0.36,1)',
          }}
        >
          <div style={{
            background: 'rgba(4,8,16,0.88)',
            backdropFilter: 'blur(16px)',
            border: '1px solid rgba(255,180,50,0.3)',
            borderRadius: 10,
            padding: '16px 20px',
          }}>
            {/* Header */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 12,
            }}>
              <div>
                <div style={{
                  color: '#ffb432',
                  fontFamily: 'monospace',
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: 2,
                }}>
                  PROJECTION SUMMARY
                </div>
                <div style={{
                  color: 'rgba(255,255,255,0.4)',
                  fontFamily: 'monospace',
                  fontSize: 9,
                  letterSpacing: 1,
                  marginTop: 2,
                }}>
                  {summary.scenario_label}
                </div>
              </div>
              <button
                onClick={() => setSummaryVisible(false)}
                style={{
                  background: 'none',
                  border: '1px solid rgba(255,255,255,0.12)',
                  borderRadius: 4,
                  color: 'rgba(255,255,255,0.35)',
                  cursor: 'pointer',
                  fontSize: 10,
                  padding: '2px 7px',
                  fontFamily: 'monospace',
                }}
              >
                ✕
              </button>
            </div>

            {/* Financial grid */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(4,1fr)',
              gap: 10,
              marginBottom: 12,
            }}>
              {[
                { label: 'MONTHLY REVENUE', value: `$${summary.monthly_revenue.toLocaleString()}`, color: '#00ff88' },
                { label: 'MONTHLY COST',    value: `$${summary.monthly_cost.toLocaleString()}`,    color: '#ff6644' },
                { label: 'NET IMPACT',
                  value: `${summary.net_monthly >= 0 ? '+' : ''}$${summary.net_monthly.toLocaleString()}`,
                  color: summary.net_monthly >= 0 ? '#00ff88' : '#ff4444',
                },
                { label: 'TIME TO ROI',    value: summary.roi_months > 0 ? `${summary.roi_months}mo` : '—', color: '#ffb432' },
              ].map(({ label, value, color }) => (
                <div key={label} style={{
                  background: 'rgba(255,255,255,0.04)',
                  border: '1px solid rgba(255,255,255,0.08)',
                  borderRadius: 6,
                  padding: '8px 10px',
                  textAlign: 'center',
                }}>
                  <div style={{
                    color: 'rgba(255,255,255,0.4)',
                    fontFamily: 'monospace',
                    fontSize: 8,
                    letterSpacing: 1,
                    marginBottom: 4,
                  }}>{label}</div>
                  <div style={{
                    color,
                    fontFamily: 'monospace',
                    fontSize: 15,
                    fontWeight: 700,
                  }}>{value}</div>
                </div>
              ))}
            </div>

            {/* Risks + Opportunities */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div>
                <div style={{
                  color: '#ff6644',
                  fontFamily: 'monospace',
                  fontSize: 9,
                  letterSpacing: 1.5,
                  fontWeight: 700,
                  marginBottom: 5,
                }}>
                  ⚠ KEY RISKS
                </div>
                {summary.risks.slice(0, 3).map((r, i) => (
                  <div key={i} style={{
                    color: 'rgba(255,255,255,0.6)',
                    fontFamily: 'monospace',
                    fontSize: 10,
                    lineHeight: 1.5,
                    paddingLeft: 10,
                    position: 'relative',
                    marginBottom: 3,
                  }}>
                    <span style={{
                      position: 'absolute', left: 0, color: '#ff6644',
                    }}>·</span>
                    {r}
                  </div>
                ))}
              </div>
              <div>
                <div style={{
                  color: '#00ff88',
                  fontFamily: 'monospace',
                  fontSize: 9,
                  letterSpacing: 1.5,
                  fontWeight: 700,
                  marginBottom: 5,
                }}>
                  ✦ OPPORTUNITIES
                </div>
                {summary.opportunities.slice(0, 3).map((o, i) => (
                  <div key={i} style={{
                    color: 'rgba(255,255,255,0.6)',
                    fontFamily: 'monospace',
                    fontSize: 10,
                    lineHeight: 1.5,
                    paddingLeft: 10,
                    position: 'relative',
                    marginBottom: 3,
                  }}>
                    <span style={{
                      position: 'absolute', left: 0, color: '#00ff88',
                    }}>·</span>
                    {o}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
