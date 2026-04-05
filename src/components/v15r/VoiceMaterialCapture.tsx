// @ts-nocheck
/**
 * VoiceMaterialCapture — Voice-driven material entry for field log forms.
 *
 * Mic button sits inline next to the Materials $ input.
 * On tap: starts recording via MediaRecorder, shows pulsing indicator.
 * Auto-stops after 3 seconds of silence (or manual tap to stop).
 * Sends audio to Whisper → transcription → Claude for material extraction.
 * Shows editable item list with price book match suggestions.
 * "Use These Materials" populates the parent form via onConfirm().
 *
 * Renders as a col-span-2 md:col-span-3 grid item so it spans the full
 * grid row, replacing the plain Materials $ input div.
 *
 * Session scope: field log voice material capture — B18.
 * Do NOT modify: voice pipeline agent logic (VoiceActivationButton, voice service).
 */

import { useState, useRef, useCallback, useEffect } from 'react'
import { Mic, MicOff, Loader, Check, Trash2, Edit3, X } from 'lucide-react'
import { transcribeWithWhisper } from '@/api/voice/whisper'
import { callClaude, extractText } from '@/services/claudeProxy'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface MaterialItem {
  id: string
  quantity: number
  unit: string
  name: string
  priceBookMatch: string | null   // matched price book item name
  priceBookId: string | null
  unitCost: number                // 0 if no match
  confidence: 'high' | 'medium' | 'low' | 'none'
  editing: boolean
}

export interface PriceBookEntry {
  id: string
  name?: string
  description?: string
  unit?: string
  unitCost?: number
  cost?: number
}

type CaptureStatus = 'idle' | 'recording' | 'transcribing' | 'parsing' | 'reviewing' | 'error'

// ── Constants ──────────────────────────────────────────────────────────────────

const SILENCE_THRESHOLD    = 0.012   // RMS amplitude below which = silence
const SILENCE_DURATION_MS  = 3000    // 3 s of silence → auto-stop

// ── Helpers ───────────────────────────────────────────────────────────────────

function uid() {
  return Math.random().toString(36).slice(2, 9)
}

/** Build Claude prompt for material extraction */
function buildMaterialExtractionPrompt(transcript: string, priceBook: PriceBookEntry[]): string {
  const pbSample = priceBook
    .slice(0, 80)
    .map(p => `${p.id}: ${p.name || p.description || ''} (${p.unit || 'ea'}, $${p.unitCost ?? p.cost ?? 0})`)
    .join('\n')

  return `The user described materials used on a job site. Extract a clean list of materials mentioned.

USER TRANSCRIPT:
"${transcript}"

PRICE BOOK SAMPLE (${priceBook.length} total items):
${pbSample}

For each material item identified, extract:
- quantity (number)
- unit (e.g. "ea", "ft", "roll", "box", "lb") — infer from context if not stated
- name (clean item name, capitalized)
- priceBookMatch (price book item name if fuzzy-matched, else null) — allow for mispronunciation and abbreviations
- priceBookId (price book id string if matched, else null)
- unitCost (unit cost from price book if matched, else 0)
- confidence: "high" if clear match, "medium" if probable, "low" if uncertain, "none" if no match

Respond with ONLY a valid JSON array, no explanation:
[{"quantity": 28, "unit": "ea", "name": "Deep Metal Box", "priceBookMatch": "2G Deep Metal Box", "priceBookId": "pb123", "unitCost": 4.50, "confidence": "high"}, ...]`
}

/** Parse Claude response, tolerating markdown code fences */
function parseMaterialsJson(raw: string): Omit<MaterialItem, 'id' | 'editing'>[] | null {
  try {
    const stripped = raw.replace(/```json|```/g, '').trim()
    const arr = JSON.parse(stripped)
    if (!Array.isArray(arr)) return null
    return arr
  } catch {
    return null
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

interface VoiceMaterialCaptureProps {
  /** Current numeric value of the Materials $ input */
  value: string
  /** Called when the user types in the input */
  onChange: (val: string) => void
  /** Price book items for fuzzy matching */
  priceBook: PriceBookEntry[]
  /**
   * Called when user taps "Use These Materials".
   * @param total — calculated total material cost
   * @param note  — human-readable item list for saving to entry notes
   */
  onConfirm: (total: number, note: string) => void
  /** Optional extra className on the outer wrapper */
  className?: string
}

export default function VoiceMaterialCapture({
  value,
  onChange,
  priceBook,
  onConfirm,
  className = '',
}: VoiceMaterialCaptureProps) {
  const [status, setStatus]   = useState<CaptureStatus>('idle')
  const [items, setItems]     = useState<MaterialItem[]>([])
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [silenceProgress, setSilenceProgress] = useState(0)   // 0-1

  // Recording refs
  const mediaRecorderRef    = useRef<MediaRecorder | null>(null)
  const audioChunksRef      = useRef<Blob[]>([])
  const streamRef           = useRef<MediaStream | null>(null)

  // Silence detection refs
  const audioCtxRef         = useRef<AudioContext | null>(null)
  const analyserRef         = useRef<AnalyserNode | null>(null)
  const silenceStreamRef    = useRef<MediaStream | null>(null)
  const silenceStartRef     = useRef(0)
  const rafRef              = useRef<number | null>(null)

  // ── Silence detection ────────────────────────────────────────────────────────

  const stopSilenceDetection = useCallback(() => {
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null }
    if (silenceStreamRef.current) { silenceStreamRef.current.getTracks().forEach(t => t.stop()); silenceStreamRef.current = null }
    if (audioCtxRef.current) { try { audioCtxRef.current.close() } catch {} audioCtxRef.current = null }
    analyserRef.current   = null
    silenceStartRef.current = 0
    setSilenceProgress(0)
  }, [])

  const startSilenceDetection = useCallback((stream: MediaStream, onSilence: () => void) => {
    try {
      const audioCtx = new AudioContext()
      audioCtxRef.current = audioCtx
      const source = audioCtx.createMediaStreamSource(stream)
      const analyser = audioCtx.createAnalyser()
      analyser.fftSize = 512
      source.connect(analyser)
      analyserRef.current = analyser
      const buf = new Float32Array(analyser.fftSize)

      const check = () => {
        if (!analyserRef.current) return
        analyserRef.current.getFloatTimeDomainData(buf)
        let sumSq = 0
        for (let i = 0; i < buf.length; i++) sumSq += buf[i] * buf[i]
        const rms = Math.sqrt(sumSq / buf.length)

        if (rms < SILENCE_THRESHOLD) {
          if (silenceStartRef.current === 0) silenceStartRef.current = Date.now()
          const elapsed = Date.now() - silenceStartRef.current
          setSilenceProgress(Math.min(elapsed / SILENCE_DURATION_MS, 1))
          if (elapsed >= SILENCE_DURATION_MS) {
            onSilence()
            return
          }
        } else {
          silenceStartRef.current = 0
          setSilenceProgress(0)
        }

        rafRef.current = requestAnimationFrame(check)
      }
      rafRef.current = requestAnimationFrame(check)
    } catch (e) {
      console.warn('[VoiceMaterial] Silence detection failed:', e)
    }
  }, [])

  // Clean up on unmount
  useEffect(() => () => {
    stopSilenceDetection()
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop()
    }
    if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop())
  }, [stopSilenceDetection])

  // ── Recording lifecycle ───────────────────────────────────────────────────────

  const stopRecordingAndProcess = useCallback(async () => {
    stopSilenceDetection()
    const recorder = mediaRecorderRef.current
    if (!recorder || recorder.state === 'inactive') return

    setStatus('transcribing')

    await new Promise<void>(resolve => {
      recorder.onstop = () => resolve()
      recorder.stop()
    })

    const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' })
    audioChunksRef.current = []

    if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null }

    // ── Transcribe via Whisper ──────────────────────────────────────────────
    let transcript = ''
    try {
      const result = await transcribeWithWhisper(audioBlob, {
        language: 'en',
        prompt: 'Electrical materials: boxes, conduit, MC cable, connectors, breakers, wire.',
      })
      transcript = result.text?.trim() || ''
    } catch (e: any) {
      console.error('[VoiceMaterial] Whisper error:', e)
      setStatus('error')
      setErrorMsg('Could not transcribe. Try again or type manually.')
      return
    }

    if (!transcript) {
      setStatus('error')
      setErrorMsg('No speech detected. Try again or type manually.')
      return
    }

    // ── Parse via Claude ────────────────────────────────────────────────────
    setStatus('parsing')
    try {
      const prompt = buildMaterialExtractionPrompt(transcript, priceBook)
      const response = await callClaude({
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 1024,
      })
      const raw = extractText(response)
      const parsed = parseMaterialsJson(raw)

      if (!parsed || parsed.length === 0) {
        setStatus('error')
        setErrorMsg('Could not parse materials. Try again or type manually.')
        return
      }

      setItems(parsed.map(item => ({
        ...item,
        id: uid(),
        editing: false,
        quantity: Number(item.quantity) || 1,
        unitCost: Number(item.unitCost) || 0,
        priceBookMatch: item.priceBookMatch || null,
        priceBookId: item.priceBookId || null,
        confidence: item.confidence || 'none',
      })))
      setStatus('reviewing')
    } catch (e: any) {
      console.error('[VoiceMaterial] Claude parse error:', e)
      setStatus('error')
      setErrorMsg('Could not parse materials. Try again or type manually.')
    }
  }, [priceBook, stopSilenceDetection])

  const startRecording = useCallback(async () => {
    setErrorMsg(null)
    setItems([])

    // iOS fallback: if MediaRecorder not available, show text-input hint
    if (typeof MediaRecorder === 'undefined') {
      setStatus('error')
      setErrorMsg('Recording not supported on this device. Describe materials used...')
      return
    }

    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
    } catch (e: any) {
      setStatus('error')
      setErrorMsg('Microphone access denied. Type materials manually.')
      return
    }

    audioChunksRef.current = []
    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : MediaRecorder.isTypeSupported('audio/webm')
        ? 'audio/webm'
        : ''

    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
    mediaRecorderRef.current = recorder
    recorder.ondataavailable = e => { if (e.data.size > 0) audioChunksRef.current.push(e.data) }
    recorder.start(250)

    setStatus('recording')

    startSilenceDetection(stream, () => stopRecordingAndProcess())
  }, [startSilenceDetection, stopRecordingAndProcess])

  const handleMicPress = useCallback(() => {
    if (status === 'recording') {
      stopRecordingAndProcess()
    } else if (status === 'idle' || status === 'error') {
      startRecording()
    }
  }, [status, startRecording, stopRecordingAndProcess])

  // ── Item editing ──────────────────────────────────────────────────────────────

  const updateItem = (id: string, patch: Partial<MaterialItem>) => {
    setItems(prev => prev.map(it => it.id === id ? { ...it, ...patch } : it))
  }
  const deleteItem = (id: string) => setItems(prev => prev.filter(it => it.id !== id))

  const totalCost = items.reduce((sum, it) => sum + (it.quantity * it.unitCost), 0)

  const handleConfirm = () => {
    const note = '=== Voice Materials ===\n' + items.map(it => {
      const cost = it.quantity * it.unitCost
      const matchStr = it.priceBookMatch ? ` → ${it.priceBookMatch}` : ''
      return `${it.quantity} ${it.unit} ${it.name}${matchStr} @ $${it.unitCost.toFixed(2)}/ea = $${cost.toFixed(2)}`
    }).join('\n') + `\nTotal: $${totalCost.toFixed(2)}`

    onConfirm(totalCost, note)
    setItems([])
    setStatus('idle')
  }

  const handleDismiss = () => {
    setItems([])
    setStatus('idle')
    setErrorMsg(null)
  }

  // ── Confidence chip style ─────────────────────────────────────────────────────

  const chipStyle = (confidence: MaterialItem['confidence']) => {
    if (confidence === 'high' || confidence === 'medium') {
      return 'bg-emerald-800/60 text-emerald-300 border border-emerald-600/40'
    }
    if (confidence === 'low') {
      return 'bg-yellow-800/60 text-yellow-300 border border-yellow-600/40'
    }
    return 'bg-gray-700 text-gray-400 border border-gray-600/40'
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  const isRecording   = status === 'recording'
  const isProcessing  = status === 'transcribing' || status === 'parsing'
  const isReviewing   = status === 'reviewing'
  const isError       = status === 'error'

  return (
    <div className={`col-span-2 md:col-span-3 ${className}`}>
      {/* ── Materials $ label + input + mic button ── */}
      <label className="text-[9px] text-gray-500 uppercase font-bold">Materials $</label>
      <div
        className="flex gap-1 mt-0.5"
        style={isRecording ? {
          outline: '2px solid rgba(239,68,68,0.7)',
          borderRadius: '6px',
          animation: 'vmcPulse 1.2s ease-in-out infinite',
        } : {}}
      >
        <input
          type="number"
          step="0.01"
          value={value}
          onChange={e => onChange(e.target.value)}
          className="flex-1 bg-[var(--bg-primary)] border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-200"
          placeholder="0.00"
        />

        {/* Mic button */}
        <button
          type="button"
          onClick={handleMicPress}
          disabled={isProcessing || isReviewing}
          title={isRecording ? 'Tap to stop recording' : 'Tap to record materials'}
          style={{
            width: '32px',
            height: '32px',
            borderRadius: '6px',
            border: '1.5px solid',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            cursor: isProcessing || isReviewing ? 'not-allowed' : 'pointer',
            transition: 'all 0.2s ease',
            background: isRecording
              ? 'rgba(239,68,68,0.18)'
              : 'rgba(34,197,94,0.12)',
            borderColor: isRecording
              ? 'rgba(239,68,68,0.7)'
              : 'rgba(34,197,94,0.5)',
            color: isRecording ? '#ef4444' : '#22c55e',
            opacity: isProcessing || isReviewing ? 0.5 : 1,
          }}
          aria-label={isRecording ? 'Stop recording' : 'Record materials by voice'}
        >
          {isProcessing
            ? <Loader size={13} className="animate-spin text-green-400" />
            : isRecording
              ? <MicOff size={13} />
              : <Mic size={13} />
          }
        </button>
      </div>

      {/* ── Silence progress bar (only while recording) ── */}
      {isRecording && silenceProgress > 0 && (
        <div className="mt-1" style={{ height: '3px', background: 'rgba(255,255,255,0.1)', borderRadius: '2px', overflow: 'hidden' }}>
          <div style={{
            height: '100%',
            width: `${silenceProgress * 100}%`,
            background: silenceProgress > 0.7 ? '#ef4444' : '#eab308',
            borderRadius: '2px',
            transition: 'width 0.1s linear',
          }} />
        </div>
      )}

      {/* ── Status line ── */}
      {isProcessing && (
        <div className="mt-1.5 text-[10px] text-green-400 flex items-center gap-1">
          <Loader size={10} className="animate-spin" />
          {status === 'transcribing' ? 'Transcribing audio…' : 'Identifying materials…'}
        </div>
      )}
      {isRecording && (
        <div className="mt-1.5 text-[10px] text-red-400 flex items-center gap-1">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
          Recording — tap mic to stop, or pause for 3 s
        </div>
      )}

      {/* ── Error state ── */}
      {isError && errorMsg && (
        <div className="mt-1.5 text-[10px] text-yellow-400 bg-yellow-900/20 border border-yellow-700/30 rounded px-2 py-1.5 flex items-start gap-1.5">
          <span className="shrink-0 mt-0.5">⚠</span>
          <span>{errorMsg}</span>
          <button
            onClick={handleDismiss}
            className="ml-auto text-gray-500 hover:text-gray-300"
          >
            <X size={10} />
          </button>
        </div>
      )}

      {/* ── Reviewing: item list ── */}
      {isReviewing && items.length > 0 && (
        <div className="mt-2 rounded-lg border border-gray-700 bg-[var(--bg-primary)] overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-3 py-1.5 bg-[var(--bg-card)] border-b border-gray-700">
            <span className="text-[9px] uppercase font-bold text-green-400 tracking-wider">Voice Materials — Review</span>
            <button onClick={handleDismiss} className="text-gray-500 hover:text-gray-300" title="Dismiss">
              <X size={11} />
            </button>
          </div>

          {/* Item list */}
          <div className="divide-y divide-gray-800">
            {items.map(item => (
              <div key={item.id} className="px-3 py-2">
                {item.editing ? (
                  /* Edit mode row */
                  <div className="flex flex-wrap gap-1.5 items-center">
                    <input
                      type="number"
                      value={item.quantity}
                      onChange={e => updateItem(item.id, { quantity: parseFloat(e.target.value) || 0 })}
                      className="w-14 bg-[var(--bg-card)] border border-gray-600 rounded px-1.5 py-0.5 text-xs text-gray-200"
                      placeholder="Qty"
                    />
                    <input
                      value={item.unit}
                      onChange={e => updateItem(item.id, { unit: e.target.value })}
                      className="w-12 bg-[var(--bg-card)] border border-gray-600 rounded px-1.5 py-0.5 text-xs text-gray-200"
                      placeholder="unit"
                    />
                    <input
                      value={item.name}
                      onChange={e => updateItem(item.id, { name: e.target.value })}
                      className="flex-1 bg-[var(--bg-card)] border border-gray-600 rounded px-1.5 py-0.5 text-xs text-gray-200"
                      placeholder="Item name"
                    />
                    <input
                      type="number"
                      value={item.unitCost}
                      onChange={e => updateItem(item.id, { unitCost: parseFloat(e.target.value) || 0 })}
                      className="w-16 bg-[var(--bg-card)] border border-gray-600 rounded px-1.5 py-0.5 text-xs text-gray-200"
                      placeholder="$/ea"
                    />
                    <button
                      onClick={() => updateItem(item.id, { editing: false })}
                      className="text-green-400 hover:text-green-300"
                      title="Done"
                    >
                      <Check size={12} />
                    </button>
                  </div>
                ) : (
                  /* Display mode row */
                  <div className="flex items-center gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-[11px] font-semibold text-gray-200 font-mono">
                          {item.quantity} {item.unit}
                        </span>
                        <span className="text-[11px] text-gray-300">{item.name}</span>
                        {item.priceBookMatch && (
                          <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium ${chipStyle(item.confidence)}`}>
                            {item.confidence === 'low' ? '?' : '✓'} {item.priceBookMatch}
                          </span>
                        )}
                      </div>
                      <div className="text-[9px] text-gray-500 mt-0.5 font-mono">
                        @ ${item.unitCost.toFixed(2)}/ea = ${(item.quantity * item.unitCost).toFixed(2)}
                        {!item.priceBookMatch && item.unitCost === 0 && (
                          <span className="text-yellow-500 ml-1">— set cost manually above</span>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={() => updateItem(item.id, { editing: true })}
                      className="text-gray-500 hover:text-blue-400 shrink-0"
                      title="Edit"
                    >
                      <Edit3 size={11} />
                    </button>
                    <button
                      onClick={() => deleteItem(item.id)}
                      className="text-gray-500 hover:text-red-400 shrink-0"
                      title="Delete"
                    >
                      <Trash2 size={11} />
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Footer: total + confirm */}
          <div className="px-3 py-2 bg-[var(--bg-card)] border-t border-gray-700 flex items-center justify-between">
            <div className="text-[10px] text-gray-400 font-mono">
              Total: <span className="text-green-400 font-bold">${totalCost.toFixed(2)}</span>
              {totalCost === 0 && (
                <span className="text-yellow-500 ml-2">Edit unit costs above for total</span>
              )}
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleDismiss}
                className="px-2 py-1 rounded bg-gray-700 text-gray-300 text-[10px] hover:bg-gray-600"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirm}
                className="px-2.5 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-[10px] font-semibold"
              >
                Use These Materials
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CSS animation for pulsing red border when recording */}
      <style>{`
        @keyframes vmcPulse {
          0%, 100% { outline-color: rgba(239,68,68,0.7); }
          50%       { outline-color: rgba(239,68,68,0.25); }
        }
      `}</style>
    </div>
  )
}
