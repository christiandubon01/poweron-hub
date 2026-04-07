// @ts-nocheck
/**
 * useNEXUSAudio — B49 Live Audio Pipeline
 *
 * Wires real Web Audio API FFT data to the visual suite.
 * Accepts a mic MediaStream and a TTS HTMLAudioElement.
 * Falls back to sine-wave simulation when both are null.
 */

import { useRef, useEffect, useState } from 'react'

export interface AudioBands {
  bass: number    // 0-1, average of FFT bins 0-7
  mid: number     // 0-1, average of FFT bins 8-63
  high: number    // 0-1, average of FFT bins 64-127
  isLive: boolean // true when real audio active
}

const FALLBACK: AudioBands = { bass: 0, mid: 0, high: 0, isLive: false }

export function useNEXUSAudio(
  micStream: MediaStream | null,
  ttsElement: HTMLAudioElement | null,
): AudioBands {
  const [bands, setBands] = useState<AudioBands>(FALLBACK)

  // Audio node refs — never triggers re-renders
  const ctxRef           = useRef<AudioContext | null>(null)
  const analyserRef      = useRef<AnalyserNode | null>(null)
  const dataArrayRef     = useRef<Uint8Array | null>(null)
  const micSourceRef     = useRef<MediaStreamAudioSourceNode | null>(null)
  const ttsSourceRef     = useRef<MediaElementAudioSourceNode | null>(null)
  const ttsElementRef    = useRef<HTMLAudioElement | null>(null)  // guard ref
  const rafRef           = useRef<number>(0)
  const tRef             = useRef<number>(0)  // fallback time accumulator

  // Smoothed output values
  const smoothRef = useRef({ bass: 0, mid: 0, high: 0 })

  const micStreamRef  = useRef<MediaStream | null>(null)
  const ttsElRef      = useRef<HTMLAudioElement | null>(null)

  // Keep refs in sync with latest props without stale closure issues
  micStreamRef.current = micStream
  ttsElRef.current     = ttsElement

  useEffect(() => {
    let running = true

    function getOrCreateCtx(): AudioContext {
      if (!ctxRef.current || ctxRef.current.state === 'closed') {
        ctxRef.current = new AudioContext()
        const analyser = ctxRef.current.createAnalyser()
        analyser.fftSize = 256
        analyser.smoothingTimeConstant = 0.8
        analyser.connect(ctxRef.current.destination)
        analyserRef.current = analyser
        dataArrayRef.current = new Uint8Array(analyser.frequencyBinCount)
      }
      return ctxRef.current
    }

    function connectMic(stream: MediaStream) {
      if (micSourceRef.current) {
        try { micSourceRef.current.disconnect() } catch {}
      }
      const ctx = getOrCreateCtx()
      const src = ctx.createMediaStreamSource(stream)
      // Do NOT connect to destination — avoids feedback loop
      src.connect(analyserRef.current!)
      micSourceRef.current = src
    }

    function connectTTS(el: HTMLAudioElement) {
      // Guard: calling createMediaElementSource twice throws InvalidStateError
      if (ttsElementRef.current === el) return
      ttsElementRef.current = el
      const ctx = getOrCreateCtx()
      try {
        const src = ctx.createMediaElementSource(el)
        // Connect to destination so audio still plays
        src.connect(analyserRef.current!)
        src.connect(ctx.destination)
        ttsSourceRef.current = src
      } catch (e) {
        // InvalidStateError: already connected via another context — ignore
        console.warn('[useNEXUSAudio] createMediaElementSource failed:', e)
      }
    }

    function lerp(cur: number, target: number): number {
      return cur + (target - cur) * 0.08
    }

    function avgBins(arr: Uint8Array, from: number, to: number): number {
      let sum = 0
      const end = Math.min(to, arr.length - 1)
      for (let i = from; i <= end; i++) sum += arr[i]
      return sum / (end - from + 1) / 255
    }

    function tick() {
      if (!running) return

      const curMic = micStreamRef.current
      const curTTS = ttsElRef.current
      const hasLive = !!(curMic || curTTS)

      let targetBass: number
      let targetMid: number
      let targetHigh: number

      if (hasLive) {
        if (curMic && !micSourceRef.current) connectMic(curMic)
        if (curTTS && ttsElementRef.current !== curTTS) connectTTS(curTTS)

        if (analyserRef.current && dataArrayRef.current) {
          analyserRef.current.getByteFrequencyData(dataArrayRef.current)
          const d = dataArrayRef.current
          targetBass = avgBins(d, 0, 7)
          targetMid  = avgBins(d, 8, 63)
          targetHigh = avgBins(d, 64, 127)
        } else {
          targetBass = 0; targetMid = 0; targetHigh = 0
        }
      } else {
        // Fallback sine-wave simulation (mirrors VisualSuitePanel defaults)
        tRef.current += 0.016  // ~60fps increment
        const t = tRef.current
        targetBass = 0.3 + 0.6 * Math.abs(Math.sin(t * 1.1)) * Math.abs(Math.sin(t * 0.37))
        targetMid  = 0.2 + 0.6 * Math.abs(Math.sin(t * 2.3 + 1.2))
        targetHigh = 0.15 + 0.5 * Math.abs(Math.sin(t * 5.1 + 2.4))
      }

      // Lerp smoothing
      const s = smoothRef.current
      s.bass = lerp(s.bass, targetBass)
      s.mid  = lerp(s.mid,  targetMid)
      s.high = lerp(s.high, targetHigh)

      setBands({ bass: s.bass, mid: s.mid, high: s.high, isLive: hasLive })

      rafRef.current = requestAnimationFrame(tick)
    }

    rafRef.current = requestAnimationFrame(tick)

    return () => {
      running = false
      cancelAnimationFrame(rafRef.current)

      // Disconnect all nodes
      try { micSourceRef.current?.disconnect() }  catch {}
      try { ttsSourceRef.current?.disconnect() }  catch {}
      try { analyserRef.current?.disconnect() }   catch {}
      try { ctxRef.current?.close() }             catch {}

      micSourceRef.current  = null
      ttsSourceRef.current  = null
      ttsElementRef.current = null
      analyserRef.current   = null
      ctxRef.current        = null
    }
  }, []) // run once; reads latest props via refs

  return bands
}
