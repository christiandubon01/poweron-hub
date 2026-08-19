/**
 * COACH-LINK-4A / 4B1 — Call Assist panel for Live Call (active Hunter lead only).
 *
 * PREPARE CALL → pre-call brief (explicit)
 * COACH ME → manual live coaching from owner input
 * MIC ASSIST (4B1) → browser mic → Whisper → same Live Coach textarea
 *
 * Transient state only — resets when sales session / lead changes.
 * Does not mutate Hunter leads or call_logs. Does not dial or auto-log.
 * Browser microphone only — not phone-system or two-way call capture.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { AlertCircle, Loader2, Mic, Sparkles } from 'lucide-react'
import {
  extractLeadAssistFacts,
  generateLiveCoachTip,
  generatePreCallBrief,
  LIVE_COACH_QUICK_CHIPS,
  type LeadAssistFacts,
  type LiveCoachHistoryTurn,
  type LiveCoachTip,
  type PreCallBrief,
} from '@/services/salesIntel/liveCallAssist'
import {
  LiveCallMicSession,
  MIC_BROWSER_DISCLAIMER,
  MIC_PERMISSION_FALLBACK,
  MIC_WHISPER_FALLBACK,
  mergeTranscriptIntoOwnerNote,
  transcribeLiveCallMicBlob,
  type MicAssistPhase,
} from '@/services/salesIntel/liveCallMicAssist'
import {
  fetchCallLogsForHunterLead,
  type CallLog,
} from '@/services/calls'

export interface LiveCallAssistPanelProps {
  sessionId: string
  hunterLeadId: string
  lead: Record<string, unknown> | null | undefined
}

export const LiveCallAssistPanel: React.FC<LiveCallAssistPanelProps> = ({
  sessionId,
  hunterLeadId,
  lead,
}) => {
  const [brief, setBrief] = useState<PreCallBrief | null>(null)
  const [briefLoading, setBriefLoading] = useState(false)
  const [briefError, setBriefError] = useState<string | null>(null)

  const [ownerNote, setOwnerNote] = useState('')
  const [tip, setTip] = useState<LiveCoachTip | null>(null)
  const [coachLoading, setCoachLoading] = useState(false)
  const [coachError, setCoachError] = useState<string | null>(null)
  const [history, setHistory] = useState<LiveCoachHistoryTurn[]>([])

  const [micPhase, setMicPhase] = useState<MicAssistPhase>('idle')
  const [micError, setMicError] = useState<string | null>(null)

  const briefAbort = useRef<AbortController | null>(null)
  const coachAbort = useRef<AbortController | null>(null)
  const priorCallsRef = useRef<CallLog[]>([])
  const micSessionRef = useRef<LiveCallMicSession | null>(null)
  const micPhaseRef = useRef<MicAssistPhase>('idle')

  const setMicPhaseSafe = useCallback((phase: MicAssistPhase) => {
    micPhaseRef.current = phase
    setMicPhase(phase)
  }, [])

  const disposeMicSession = useCallback(() => {
    micSessionRef.current?.cancel()
    micSessionRef.current = null
  }, [])

  // Reset transient coaching + mic when session or lead changes; release on unmount.
  useEffect(() => {
    briefAbort.current?.abort()
    coachAbort.current?.abort()
    briefAbort.current = null
    coachAbort.current = null
    disposeMicSession()
    setBrief(null)
    setBriefError(null)
    setBriefLoading(false)
    setOwnerNote('')
    setTip(null)
    setCoachError(null)
    setCoachLoading(false)
    setHistory([])
    priorCallsRef.current = []
    setMicError(null)
    setMicPhaseSafe('idle')

    return () => {
      disposeMicSession()
    }
  }, [sessionId, hunterLeadId, disposeMicSession, setMicPhaseSafe])

  const resolveFacts = useCallback(async (): Promise<LeadAssistFacts | null> => {
    let prior = priorCallsRef.current
    if (prior.length === 0) {
      try {
        prior = await fetchCallLogsForHunterLead(hunterLeadId, 8)
        priorCallsRef.current = prior
      } catch {
        prior = []
      }
    }
    return extractLeadAssistFacts(lead, prior)
  }, [hunterLeadId, lead])

  const handlePrepareCall = async () => {
    if (briefLoading) return
    setBriefError(null)
    setBriefLoading(true)
    briefAbort.current?.abort()
    const ac = new AbortController()
    briefAbort.current = ac
    try {
      const facts = await resolveFacts()
      if (!facts) {
        setBriefError('Could not resolve active Hunter lead.')
        return
      }
      const next = await generatePreCallBrief(facts, ac.signal)
      if (!ac.signal.aborted) setBrief(next)
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return
      setBriefError(
        err instanceof Error ? err.message : 'Prepare Call failed — retry.',
      )
    } finally {
      if (!ac.signal.aborted) setBriefLoading(false)
    }
  }

  const handleCoachMe = async (overrideNote?: string) => {
    if (coachLoading) return
    const note = (overrideNote ?? ownerNote).trim()
    if (!note) {
      setCoachError('Enter what the customer said first.')
      return
    }
    setCoachError(null)
    setCoachLoading(true)
    coachAbort.current?.abort()
    const ac = new AbortController()
    coachAbort.current = ac
    try {
      const facts = await resolveFacts()
      if (!facts) {
        setCoachError('Could not resolve active Hunter lead.')
        return
      }
      const next = await generateLiveCoachTip(facts, history, note, ac.signal)
      // RUNTIME-2: if the proxy already returned a tip, apply it. Do not discard
      // a finished success solely because a later abort raced the state update.
      setCoachError(null)
      setTip(next)
      setHistory((prev) => [
        ...prev,
        { role: 'user', content: note },
        {
          role: 'assistant',
          content: JSON.stringify(next),
        },
      ])
      if (!overrideNote) setOwnerNote('')
      else setOwnerNote(note)
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return
      setCoachError(
        err instanceof Error ? err.message : 'Coach Me failed — retry.',
      )
    } finally {
      setCoachLoading(false)
    }
  }

  const handleStartListening = async () => {
    const phase = micPhaseRef.current
    if (
      phase === 'requesting' ||
      phase === 'recording' ||
      phase === 'transcribing'
    ) {
      return
    }
    if (micSessionRef.current?.isActive) return

    setMicError(null)
    setMicPhaseSafe('requesting')
    const session = new LiveCallMicSession()
    micSessionRef.current = session
    try {
      await session.start()
      if (micSessionRef.current !== session) {
        session.cancel()
        return
      }
      setMicPhaseSafe('recording')
    } catch {
      session.cancel()
      if (micSessionRef.current === session) micSessionRef.current = null
      setMicError(MIC_PERMISSION_FALLBACK)
      setMicPhaseSafe('error')
    }
  }

  const handleCancelListening = () => {
    disposeMicSession()
    setMicError(null)
    setMicPhaseSafe('idle')
  }

  const handleStopAndTranscribe = async () => {
    if (micPhaseRef.current !== 'recording') return
    const session = micSessionRef.current
    if (!session) {
      setMicPhaseSafe('idle')
      return
    }

    setMicPhaseSafe('transcribing')
    setMicError(null)
    try {
      const blob = await session.stopAndCollect()
      if (micSessionRef.current === session) micSessionRef.current = null

      if (!blob.size) {
        setMicError(MIC_WHISPER_FALLBACK)
        setMicPhaseSafe('error')
        return
      }

      const transcript = await transcribeLiveCallMicBlob(blob)
      if (!transcript) {
        setMicError(MIC_WHISPER_FALLBACK)
        setMicPhaseSafe('error')
        return
      }

      setOwnerNote((prev) => mergeTranscriptIntoOwnerNote(prev, transcript))
      setMicPhaseSafe('idle')
    } catch {
      disposeMicSession()
      setMicError(MIC_WHISPER_FALLBACK)
      setMicPhaseSafe('error')
    }
  }

  const micBusy =
    micPhase === 'requesting' ||
    micPhase === 'recording' ||
    micPhase === 'transcribing'

  return (
    <div
      data-testid="live-call-assist"
      data-session-id={sessionId}
      data-hunter-lead-id={hunterLeadId}
      className="rounded-lg border border-emerald-500/25 bg-emerald-950/10 p-3 space-y-3"
    >
      <div className="flex items-center gap-2">
        <Sparkles size={14} className="text-emerald-400" />
        <h4 className="text-xs font-semibold text-emerald-300 uppercase tracking-wide">
          Call Assist
        </h4>
        <span className="text-[10px] text-zinc-500">
          Owner coaching only — not listening to the call
        </span>
      </div>

      {/* PRE-CALL */}
      <section data-testid="live-call-assist-precall" className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-[11px] font-semibold text-zinc-300 uppercase tracking-wide">
            Pre-Call
          </div>
          <button
            type="button"
            data-testid="prepare-call-button"
            disabled={briefLoading}
            onClick={() => void handlePrepareCall()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium bg-emerald-600/80 hover:bg-emerald-600 disabled:opacity-50 text-white"
          >
            {briefLoading ? (
              <>
                <Loader2 size={12} className="animate-spin" />
                Preparing…
              </>
            ) : (
              'Prepare Call'
            )}
          </button>
        </div>

        {briefError && (
          <div
            data-testid="prepare-call-error"
            className="flex items-start gap-2 rounded border border-red-800 bg-red-950/40 px-2 py-1.5 text-xs text-red-200"
          >
            <AlertCircle size={12} className="mt-0.5 shrink-0" />
            <span className="min-w-0">{briefError}</span>
            <button
              type="button"
              className="shrink-0 underline"
              onClick={() => void handlePrepareCall()}
            >
              Retry
            </button>
          </div>
        )}

        {brief && (
          <div
            data-testid="precall-brief"
            className="rounded border border-white/10 bg-slate-950/50 p-2.5 text-xs text-gray-300 space-y-2 max-h-56 overflow-y-auto overscroll-contain"
          >
            <BriefBlock label="Customer need" value={brief.customerNeed} />
            <BriefBlock label="Opening" value={brief.opening} />
            <BriefList label="Discovery" items={brief.discovery} />
            <BriefList label="Value angles" items={brief.valueAngles} />
            <BriefList
              label="Likely objections (hypothetical)"
              items={brief.likelyObjections}
            />
            <BriefList label="Upsell / expansion" items={brief.upsell} />
            <BriefBlock label="Close" value={brief.close} />
          </div>
        )}
      </section>

      {/* LIVE COACH */}
      <section data-testid="live-call-assist-live-coach" className="space-y-2">
        <div className="text-[11px] font-semibold text-zinc-300 uppercase tracking-wide">
          Live Coach
        </div>

        {/* MIC ASSIST (4B1) — browser mic only; one controlled segment */}
        <div
          data-testid="live-call-mic-assist"
          data-mic-phase={micPhase}
          className="rounded border border-white/10 bg-slate-950/40 p-2.5 space-y-2"
        >
          <div className="flex items-center gap-1.5">
            <Mic size={12} className="text-zinc-400" />
            <div className="text-[11px] font-semibold text-zinc-300 uppercase tracking-wide">
              Mic Assist
            </div>
            <span className="text-[10px] text-zinc-500">Browser microphone</span>
          </div>
          <p
            data-testid="mic-assist-disclaimer"
            className="text-[10px] text-zinc-500 leading-snug"
          >
            {MIC_BROWSER_DISCLAIMER}
          </p>

          {micPhase === 'idle' || micPhase === 'error' ? (
            <button
              type="button"
              data-testid="mic-start-listening"
              disabled={micBusy}
              onClick={() => void handleStartListening()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50 text-white"
            >
              Start Listening
            </button>
          ) : null}

          {micPhase === 'requesting' ? (
            <div
              data-testid="mic-requesting"
              className="inline-flex items-center gap-1.5 text-xs text-zinc-300"
            >
              <Loader2 size={12} className="animate-spin" />
              Requesting microphone…
            </div>
          ) : null}

          {micPhase === 'recording' ? (
            <div
              data-testid="mic-recording"
              className="flex flex-wrap items-center gap-2"
            >
              <span className="inline-flex items-center gap-1.5 text-xs text-red-300">
                <span className="inline-block h-2 w-2 rounded-full bg-red-500 animate-pulse" />
                Listening
              </span>
              <button
                type="button"
                data-testid="mic-stop-transcribe"
                onClick={() => void handleStopAndTranscribe()}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white"
              >
                Stop & Transcribe
              </button>
              <button
                type="button"
                data-testid="mic-cancel"
                onClick={handleCancelListening}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium border border-white/15 bg-white/5 text-zinc-300 hover:bg-white/10"
              >
                Cancel
              </button>
            </div>
          ) : null}

          {micPhase === 'transcribing' ? (
            <div
              data-testid="mic-transcribing"
              className="inline-flex items-center gap-1.5 text-xs text-zinc-300"
            >
              <Loader2 size={12} className="animate-spin" />
              Transcribing…
            </div>
          ) : null}

          {micError && (
            <div
              data-testid="mic-assist-error"
              className="flex items-start gap-2 rounded border border-amber-800/60 bg-amber-950/30 px-2 py-1.5 text-xs text-amber-100"
            >
              <AlertCircle size={12} className="mt-0.5 shrink-0" />
              <span className="min-w-0">{micError}</span>
            </div>
          )}
        </div>

        <label className="block text-[11px] text-zinc-400">
          What did the customer just say?
        </label>
        <textarea
          data-testid="live-coach-input"
          value={ownerNote}
          onChange={(e) => setOwnerNote(e.target.value)}
          rows={2}
          placeholder="e.g. price is too high"
          className="w-full px-2.5 py-2 rounded border border-white/10 bg-slate-950/60 text-sm text-white placeholder-zinc-500 resize-none"
        />
        <div className="flex flex-wrap gap-1.5">
          {LIVE_COACH_QUICK_CHIPS.map((chip) => (
            <button
              key={chip.label}
              type="button"
              data-testid="live-coach-quick-chip"
              disabled={coachLoading}
              onClick={() => {
                setOwnerNote(chip.text)
                void handleCoachMe(chip.text)
              }}
              className="px-2 py-0.5 rounded text-[10px] border border-white/15 bg-white/5 text-zinc-300 hover:bg-white/10 disabled:opacity-50"
            >
              {chip.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          data-testid="coach-me-button"
          disabled={coachLoading}
          onClick={() => void handleCoachMe()}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white"
        >
          {coachLoading ? (
            <>
              <Loader2 size={12} className="animate-spin" />
              Coaching…
            </>
          ) : (
            'Coach Me'
          )}
        </button>

        {coachError && (
          <div
            data-testid="coach-me-error"
            className="flex items-start gap-2 rounded border border-red-800 bg-red-950/40 px-2 py-1.5 text-xs text-red-200"
          >
            <AlertCircle size={12} className="mt-0.5 shrink-0" />
            <span className="min-w-0">{coachError}</span>
            <button
              type="button"
              className="shrink-0 underline"
              onClick={() => void handleCoachMe()}
            >
              Retry
            </button>
          </div>
        )}

        {tip && (
          <div
            data-testid="live-coach-tip"
            className="rounded border border-blue-500/30 bg-blue-950/30 p-2.5 text-xs text-gray-200 space-y-2"
          >
            <div>
              <div className="text-[10px] uppercase tracking-wider text-blue-300/80">
                Signal
              </div>
              <div className="font-semibold text-white" data-testid="coach-signal">
                {tip.signal}
              </div>
              <div className="text-[10px] text-zinc-500" data-testid="coach-category">
                {tip.category}
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-blue-300/80">
                Say next
              </div>
              <p className="text-sm text-white whitespace-pre-wrap">{tip.sayNext}</p>
            </div>
            {tip.strategy ? (
              <div>
                <div className="text-[10px] uppercase tracking-wider text-blue-300/80">
                  Strategy
                </div>
                <p className="text-zinc-300 whitespace-pre-wrap">{tip.strategy}</p>
              </div>
            ) : null}
            {tip.ask ? (
              <div>
                <div className="text-[10px] uppercase tracking-wider text-blue-300/80">
                  Ask
                </div>
                <p className="text-zinc-200">{tip.ask}</p>
              </div>
            ) : null}
            {tip.optionalOpportunity ? (
              <div>
                <div className="text-[10px] uppercase tracking-wider text-emerald-300/80">
                  Opportunity
                </div>
                <p className="text-emerald-100/90">{tip.optionalOpportunity}</p>
              </div>
            ) : null}
          </div>
        )}
      </section>
    </div>
  )
}

function BriefBlock({ label, value }: { label: string; value: string }) {
  if (!value) return null
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-zinc-500">{label}</div>
      <p className="text-gray-200 whitespace-pre-wrap">{value}</p>
    </div>
  )
}

function BriefList({ label, items }: { label: string; items: string[] }) {
  if (!items.length) return null
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-zinc-500">{label}</div>
      <ul className="list-disc pl-4 space-y-0.5 text-gray-300">
        {items.map((item, i) => (
          <li key={`${label}-${i}`}>{item}</li>
        ))}
      </ul>
    </div>
  )
}

export default LiveCallAssistPanel
