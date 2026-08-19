/**
 * COACH-LINK-4B1 — Browser mic → Whisper → existing Live Coach textarea.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { execSync } from 'node:child_process'
import {
  LiveCallMicSession,
  MIC_BROWSER_DISCLAIMER,
  MIC_PERMISSION_FALLBACK,
  MIC_WHISPER_FALLBACK,
  mergeTranscriptIntoOwnerNote,
  pickSupportedRecorderMimeType,
  releaseMediaStream,
  transcribeLiveCallMicBlob,
} from '@/services/salesIntel/liveCallMicAssist'
import { buildLiveCoachPrompt } from '@/services/salesIntel/liveCallAssist'

const REPO_ROOT = resolve(__dirname, '..', '..')

function read(rel: string): string {
  return readFileSync(resolve(REPO_ROOT, rel), 'utf8')
}

function makeTrack() {
  return { stop: vi.fn() }
}

function makeStream(tracks = [makeTrack()]) {
  return {
    getTracks: () => tracks,
  } as unknown as MediaStream
}

class FakeMediaRecorder {
  static instances: FakeMediaRecorder[] = []
  static isTypeSupported = vi.fn(() => true)

  state: 'inactive' | 'recording' = 'inactive'
  mimeType: string
  ondataavailable: ((ev: BlobEvent) => void) | null = null
  onstop: (() => void) | null = null
  stream: MediaStream

  constructor(stream: MediaStream, opts?: { mimeType?: string }) {
    this.stream = stream
    this.mimeType = opts?.mimeType || 'audio/webm'
    FakeMediaRecorder.instances.push(this)
  }

  start() {
    this.state = 'recording'
  }

  stop() {
    this.state = 'inactive'
    this.ondataavailable?.({
      data: new Blob(['chunk'], { type: this.mimeType }),
    } as BlobEvent)
    this.onstop?.()
  }
}

describe('COACH-LINK-4B1 helpers', () => {
  afterEach(() => {
    FakeMediaRecorder.instances = []
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('mergeTranscriptIntoOwnerNote replaces empty, appends non-empty', () => {
    expect(mergeTranscriptIntoOwnerNote('', 'price is high')).toBe(
      'price is high',
    )
    expect(mergeTranscriptIntoOwnerNote('  typed  ', 'nine hundred cheaper')).toBe(
      '  typed\n\nnine hundred cheaper',
    )
    expect(mergeTranscriptIntoOwnerNote('keep me', '   ')).toBe('keep me')
  })

  it('releaseMediaStream stops all tracks', () => {
    const t1 = makeTrack()
    const t2 = makeTrack()
    releaseMediaStream(makeStream([t1, t2]))
    expect(t1.stop).toHaveBeenCalledTimes(1)
    expect(t2.stop).toHaveBeenCalledTimes(1)
    expect(() => releaseMediaStream(null)).not.toThrow()
  })

  it('pickSupportedRecorderMimeType prefers webm when supported', () => {
    expect(
      pickSupportedRecorderMimeType((t) => t === 'audio/webm'),
    ).toBe('audio/webm')
    expect(pickSupportedRecorderMimeType(() => false)).toBeUndefined()
  })

  it('LiveCallMicSession: getUserMedia only via start; audio constraint; one recorder', async () => {
    const track = makeTrack()
    const stream = makeStream([track])
    const getUserMedia = vi.fn(async (constraints: MediaStreamConstraints) => {
      expect(constraints).toEqual({ audio: true })
      return stream
    })

    vi.stubGlobal('MediaRecorder', FakeMediaRecorder)

    const session = new LiveCallMicSession()
    expect(session.isActive).toBe(false)
    await session.start(getUserMedia)
    expect(getUserMedia).toHaveBeenCalledTimes(1)
    expect(FakeMediaRecorder.instances).toHaveLength(1)
    expect(session.isActive).toBe(true)

    await expect(session.start(getUserMedia)).rejects.toThrow(
      /already active/i,
    )
    expect(getUserMedia).toHaveBeenCalledTimes(1)
    expect(FakeMediaRecorder.instances).toHaveLength(1)
  })

  it('stopAndCollect stops recorder, releases tracks, returns blob once', async () => {
    const track = makeTrack()
    const stream = makeStream([track])
    vi.stubGlobal('MediaRecorder', FakeMediaRecorder)

    const session = new LiveCallMicSession()
    await session.start(async () => stream)
    const blob = await session.stopAndCollect()
    expect(blob.size).toBeGreaterThan(0)
    expect(track.stop).toHaveBeenCalled()
    expect(session.isActive).toBe(false)
    expect(FakeMediaRecorder.instances[0].state).toBe('inactive')
  })

  it('cancel releases tracks and does not require Whisper', async () => {
    const track = makeTrack()
    const stream = makeStream([track])
    vi.stubGlobal('MediaRecorder', FakeMediaRecorder)

    const session = new LiveCallMicSession()
    await session.start(async () => stream)
    session.cancel()
    expect(track.stop).toHaveBeenCalled()
    expect(session.isActive).toBe(false)
  })

  it('permission denial surfaces fallback message', async () => {
    vi.stubGlobal('MediaRecorder', FakeMediaRecorder)
    const session = new LiveCallMicSession()
    await expect(
      session.start(async () => {
        throw new Error('Permission denied')
      }),
    ).rejects.toThrow()
    // Panel maps any start failure to MIC_PERMISSION_FALLBACK
    expect(MIC_PERMISSION_FALLBACK).toMatch(/Microphone unavailable/i)
    expect(MIC_PERMISSION_FALLBACK).toMatch(/still type/i)
  })

  it('transcribeLiveCallMicBlob uses shared Whisper authority', async () => {
    const whisper = await import('@/api/voice/whisper')
    const spy = vi
      .spyOn(whisper, 'transcribeWithWhisper')
      .mockResolvedValue({
        text: ' nine hundred cheaper ',
        language: 'en',
        duration: 1,
      })

    const text = await transcribeLiveCallMicBlob(
      new Blob(['x'], { type: 'audio/webm' }),
    )
    expect(text).toBe('nine hundred cheaper')
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy.mock.calls[0][0]).toBeInstanceOf(Blob)
  })
})

describe('COACH-LINK-4B1 panel contracts', () => {
  const panel = () =>
    read('src/components/salesIntel/liveCall/LiveCallAssistPanel.tsx')
  const mic = () => read('src/services/salesIntel/liveCallMicAssist.ts')
  const assist = () => read('src/services/salesIntel/liveCallAssist.ts')
  const live = () => read('src/components/salesIntel/tabs/LiveCallTab.tsx')

  it('1–2. no mic request on mount; Start Listening is explicit', () => {
    const src = panel()
    expect(src).not.toMatch(
      /useEffect\([\s\S]{0,500}getUserMedia/,
    )
    expect(src).not.toMatch(
      /useEffect\([\s\S]{0,500}handleStartListening/,
    )
    expect(src).not.toMatch(
      /useEffect\([\s\S]{0,500}micSessionRef\.current\.start/,
    )
    expect(src).toContain('data-testid="mic-start-listening"')
    expect(src).toContain('Start Listening')
    expect(src).toContain('handleStartListening')
    expect(src).toMatch(/onClick=\{\(\) => void handleStartListening\(\)\}/)
  })

  it('3–7. getUserMedia audio + MediaRecorder + release on stop/cancel/unmount', () => {
    const helper = mic()
    expect(helper).toContain('requestMic({ audio: true })')
    expect(helper).toContain('audio: true')
    expect(helper).toContain('new MediaRecorder')
    expect(helper).toContain('already active')
    expect(helper).toContain('releaseMediaStream')
    expect(helper).toContain('track.stop')
    expect(helper).toContain('stopAndCollect')
    expect(helper).toContain('cancel()')

    const src = panel()
    expect(src).toContain('Stop & Transcribe')
    expect(src).toContain('handleStopAndTranscribe')
    expect(src).toContain('handleCancelListening')
    expect(src).toContain('disposeMicSession')
    expect(src).toMatch(/return \(\) => \{\s*disposeMicSession\(\)/)
  })

  it('8–12. Whisper authority → same textarea; Coach Me unchanged; editable', () => {
    const helper = mic()
    expect(helper).toContain("from '@/api/voice/whisper'")
    expect(helper).toContain('transcribeWithWhisper')
    expect(helper).not.toContain('sparkTraining')
    expect(helper).not.toContain('localStorage')
    expect(helper).not.toContain('sessionStorage')

    const src = panel()
    expect(src).toContain('transcribeLiveCallMicBlob')
    expect(src).toContain('mergeTranscriptIntoOwnerNote')
    expect(src).toContain('setOwnerNote((prev) => mergeTranscriptIntoOwnerNote')
    expect(src).toContain('data-testid="live-coach-input"')
    expect(src).toContain('onChange={(e) => setOwnerNote(e.target.value)}')
    expect(src).toContain('handleCoachMe')
    expect(src).toContain('generateLiveCoachTip')
    // Mic does not invent a second coaching path
    expect(src).not.toMatch(/generateMicCoach|micCoachHistory|micHistory/)
  })

  it('13–14. same 4A conversation history; no separate mic history', () => {
    expect(assist()).toContain('buildLiveCoachPrompt')
    expect(panel()).toContain('setHistory((prev) => [')
    expect(panel()).not.toContain('micHistory')
    const { messages } = buildLiveCoachPrompt(
      {
        hunterLeadId: 'leadA',
        displayName: 'A',
        priorCalls: [],
      },
      [
        {
          role: 'user',
          content: 'Customer says price is high.',
        },
        {
          role: 'assistant',
          content: '{"signal":"PRICE"}',
        },
      ],
      'The other electrician is nine hundred dollars cheaper.',
    )
    expect(messages.some((m) => m.content.includes('price is high'))).toBe(
      true,
    )
    expect(
      messages.some((m) =>
        m.content.includes('nine hundred dollars cheaper'),
      ),
    ).toBe(true)
  })

  it('15–18. session/lead change clears mic; cancel skips Whisper', () => {
    const src = panel()
    expect(src).toMatch(
      /useEffect\(\(\) => \{[\s\S]*disposeMicSession\(\)[\s\S]*setOwnerNote\(''\)[\s\S]*\}, \[sessionId, hunterLeadId/,
    )
    expect(src).toContain('handleCancelListening')
    expect(src).toMatch(
      /handleCancelListening[\s\S]*disposeMicSession\(\)[\s\S]*setMicPhaseSafe\('idle'\)/,
    )
    // Cancel path must not call Whisper
    const cancelBlock = src.slice(
      src.indexOf('const handleCancelListening'),
      src.indexOf('const handleStopAndTranscribe'),
    )
    expect(cancelBlock).not.toContain('transcribeLiveCallMicBlob')
    expect(cancelBlock).not.toContain('transcribeWithWhisper')
  })

  it('19–21. permission + Whisper fallbacks; manual Coach Me remains', () => {
    const src = panel()
    expect(src).toContain('MIC_PERMISSION_FALLBACK')
    expect(src).toContain('MIC_WHISPER_FALLBACK')
    expect(MIC_PERMISSION_FALLBACK).toMatch(/Microphone unavailable/i)
    expect(MIC_PERMISSION_FALLBACK).toMatch(/still type/i)
    expect(MIC_WHISPER_FALLBACK).toMatch(/still type/i)
    expect(src).toContain('data-testid="coach-me-button"')
    expect(src).toContain('data-testid="live-coach-input"')
  })

  it('22–27. no persistence, no Phone Link claim, no continuous listening', () => {
    const src = panel()
    const helper = mic()
    for (const s of [src, helper]) {
      expect(s).not.toMatch(/localStorage|sessionStorage/)
      expect(s).not.toContain('createCallLog')
      expect(s).not.toContain('updateCallLog')
      expect(s).not.toMatch(/Phone Link Audio/i)
      expect(s).not.toContain('Call Recording')
      expect(s).not.toContain('Two-way Call Capture')
      expect(s).not.toContain('Customer Audio')
    }
    expect(src).toContain('Browser microphone')
    expect(src).toContain('MIC_BROWSER_DISCLAIMER')
    expect(src).toContain('data-testid="mic-assist-disclaimer"')
    expect(MIC_BROWSER_DISCLAIMER).toMatch(/device's microphone/i)
    expect(helper).toContain(MIC_BROWSER_DISCLAIMER)
    expect(src).not.toMatch(/setInterval\([\s\S]{0,80}transcribe/)
    expect(src).not.toMatch(/mediaRecorder\.start\(\s*\d+/)
    expect(helper).not.toMatch(/mediaRecorder\.start\(\s*\d+/)
    expect(src).not.toMatch(/handleCoachMe\(\)[\s\S]{0,40}transcrib/)
  })

  it('28–32. Prepare Call / Coach Me / CallLogModal / dialer / history protected', () => {
    const src = panel()
    expect(src).toContain('Prepare Call')
    expect(src).toContain('handlePrepareCall')
    expect(src).toContain('Coach Me')
    expect(src).toContain('LIVE_COACH_QUICK_CHIPS')
    expect(src).not.toContain('openTelDialer')
    expect(src).not.toContain('CallLogModal')

    const tab = live()
    expect(tab).toContain('CallLogModal')
    expect(tab).toContain('showOptionalDialer')
    expect(tab).toContain('openTelDialer')
    expect(tab).not.toMatch(/useEffect\([\s\S]{0,300}openTelDialer/)

    const recent = read('src/components/hunter/RecentCallsPanel.tsx')
    expect(recent).toContain('CALL_HISTORY_VISIBLE_ROWS')
    expect(recent).toContain('CALL_HISTORY_EMBEDDED_MAX_H_CLASS')
  })

  it('33–36. Practice / Performance / QBO / migrations untouched by 4B1', () => {
    for (const file of [
      'src/services/sparkTraining/SparkTrainingVoice.ts',
      'src/services/sparkTraining/SparkRolePlayEngine.ts',
      'src/components/salesIntel/practice/VoicePracticeView.tsx',
      'src/components/salesIntel/tabs/PerformanceTab.tsx',
      'src/features/sales-intelligence/source-performance/sourcePerformanceCalculations.ts',
      'src/services/calls/callLogService.ts',
      'src/components/hunter/CallLogModal.tsx',
      'netlify/functions/whisper.ts',
      'src/api/voice/whisper.ts',
    ]) {
      const status = execSync(`git status --porcelain -- "${file}"`, {
        cwd: REPO_ROOT,
        encoding: 'utf8',
      }).trim()
      expect(status, file).toBe('')
    }

    const mig = execSync(
      'git status --porcelain -- "supabase/migrations"',
      { cwd: REPO_ROOT, encoding: 'utf8' },
    )
    expect(mig).not.toMatch(/live_call|coach_link|mic_assist|4b1/i)

    // 4B1 files must not touch dirty AI backends
    expect(panel()).not.toContain('claudeProxy')
    expect(mic()).not.toContain('claudeProxy')
    expect(assist()).toContain("from '@/services/claudeProxy'")
  })

  it('mic states are explicit and non-continuous', () => {
    const src = panel()
    expect(src).toContain("'idle'")
    expect(src).toContain("'requesting'")
    expect(src).toContain("'recording'")
    expect(src).toContain("'transcribing'")
    expect(src).toContain("'error'")
    expect(src).toContain('data-testid="mic-stop-transcribe"')
    expect(src).toContain('data-testid="mic-cancel"')
    expect(src).toContain('data-testid="mic-transcribing"')
  })
})
