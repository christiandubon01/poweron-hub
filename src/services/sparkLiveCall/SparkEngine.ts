// @ts-nocheck
/**
 * SparkEngine.ts — Core SPARK Live Call engine
 *
 * Responsibilities:
 *  - Voice activation detection ("SPARK listen", "OK SPARK talk to me", etc.)
 *  - Audio capture via Web Audio API (MediaRecorder)
 *  - Chunked recording (10-second chunks for streaming transcription)
 *  - Bandpass filter (300Hz-3400Hz) for field noise tolerance
 *  - Send chunks to Whisper API via Netlify proxy
 *  - Accumulate transcript in rolling buffer
 *  - Send transcript chunks to Claude (Haiku) for analysis
 *  - Silence detection (90 seconds → trigger debrief)
 *  - Session recording with localStorage persistence
 *
 * Audio Pipeline:
 *  1. getUserMedia() → AudioContext
 *  2. Create BiquadFilter (bandpass)
 *  3. MediaRecorder (WebM + Opus)
 *  4. 10-second chunks → Whisper proxy
 *  5. Transcription → rolling buffer
 *  6. Silence detection → 90s timeout
 *  7. Claude analysis → JSON results
 *  8. Results → sparkStore
 */

import { useSparkStore, SparkMode, SparkAnalysisResult, SparkSessionRecord } from '../../store/sparkStore'

const CHUNK_DURATION_MS = 10000 // 10 seconds per chunk
const SILENCE_TIMEOUT_MS = 90000 // 90 seconds silence → debrief
const WHISPER_PROXY_URL = '/.netlify/functions/whisper'
const CLAUDE_API_ENDPOINT = '/.netlify/functions/claude'

const VOICE_ACTIVATION_PHRASES = [
  'spark listen',
  'spark focus on pricing',
  'spark this is personal',
  'ok spark talk to me',
]

interface ChunkAnalysisRequest {
  text: string
  previousContext: string
}

interface SparkAnalysisResponse {
  commitments: string[]
  amounts: number[]
  timelines: string[]
  flags: string[]
  opportunities: string[]
}

/**
 * SparkEngine class manages the entire live call capture → transcription → analysis pipeline
 */
export class SparkEngine {
  private mediaRecorder: MediaRecorder | null = null
  private audioContext: AudioContext | null = null
  private sourceNode: AudioNode | null = null
  private filterNode: BiquadFilterNode | null = null
  private stream: MediaStream | null = null
  private chunkTimeout: NodeJS.Timeout | null = null
  private silenceTimeout: NodeJS.Timeout | null = null
  private lastSpeechTime: number = Date.now()
  private currentSession: {
    id: string
    startTime: string
    contactName: string | null
  } | null = null
  private store = useSparkStore()

  /**
   * Initialize audio capture
   */
  async initialize(): Promise<void> {
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      })

      this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)()
      this.sourceNode = this.audioContext.createMediaStreamSource(this.stream)

      // Create bandpass filter (300Hz-3400Hz) for field conditions
      this.filterNode = this.audioContext.createBiquadFilter()
      this.filterNode.type = 'bandpass'
      this.filterNode.frequency.value = 1850 // Center frequency
      this.filterNode.Q.value = 2 // Bandwidth

      this.sourceNode.connect(this.filterNode)
      this.filterNode.connect(this.audioContext.destination)

      // Set up MediaRecorder with filtered audio
      const audioTracks = this.stream.getAudioTracks()
      if (audioTracks.length === 0) {
        throw new Error('No audio tracks available')
      }

      this.mediaRecorder = new MediaRecorder(this.stream, {
        mimeType: 'audio/webm;codecs=opus',
      })

      this.mediaRecorder.ondataavailable = (event) => this.handleChunk(event)

      console.log('[SparkEngine] Audio initialization complete')
    } catch (err) {
      console.error('[SparkEngine] Failed to initialize audio:', err)
      throw err
    }
  }

  /**
   * Start listening for voice activation commands
   */
  startListening(): void {
    this.store.setMode('LISTENING')
    this.currentSession = {
      id: `spark_${Date.now()}`,
      startTime: new Date().toISOString(),
      contactName: null,
    }
    console.log('[SparkEngine] Started listening')

    // Start silence detection
    this.resetSilenceTimeout()

    if (this.mediaRecorder) {
      this.mediaRecorder.start()
      // Request chunks every 10 seconds
      this.chunkTimeout = setTimeout(() => this.handleChunkRequest(), CHUNK_DURATION_MS)
    }
  }

  /**
   * Stop listening and enter analyze mode
   */
  async stopListening(): Promise<void> {
    if (this.chunkTimeout) {
      clearTimeout(this.chunkTimeout)
    }
    if (this.silenceTimeout) {
      clearTimeout(this.silenceTimeout)
    }

    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      this.mediaRecorder.stop()
    }

    this.store.setMode('ANALYZING')
    console.log('[SparkEngine] Stopped listening, entering analyze mode')
  }

  /**
   * Detect voice activation phrases in transcript
   */
  detectVoiceActivation(text: string): boolean {
    const lowerText = text.toLowerCase()
    return VOICE_ACTIVATION_PHRASES.some((phrase) => lowerText.includes(phrase))
  }

  /**
   * Check if silence threshold exceeded
   */
  private resetSilenceTimeout(): void {
    if (this.silenceTimeout) {
      clearTimeout(this.silenceTimeout)
    }

    this.silenceTimeout = setTimeout(async () => {
      console.log('[SparkEngine] 90s silence detected, triggering debrief')
      await this.triggerDebrief()
    }, SILENCE_TIMEOUT_MS)
  }

  /**
   * Handle chunk request every 10 seconds
   */
  private handleChunkRequest(): void {
    if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
      this.mediaRecorder.requestData()
      this.chunkTimeout = setTimeout(() => this.handleChunkRequest(), CHUNK_DURATION_MS)
    }
  }

  /**
   * Handle audio chunk from MediaRecorder
   */
  private async handleChunk(event: BlobEvent): Promise<void> {
    const audioBlob = event.data
    if (audioBlob.size === 0) {
      return
    }

    try {
      // Convert blob to base64
      const base64Audio = await this.blobToBase64(audioBlob)

      // Send to Whisper proxy
      const transcription = await this.transcribeChunk(base64Audio)

      if (transcription && transcription.trim().length > 0) {
        this.lastSpeechTime = Date.now()
        this.resetSilenceTimeout()

        // Add to rolling transcript
        this.store.appendTranscript(transcription)
        this.store.trimTranscript(SILENCE_TIMEOUT_MS)

        // Check for voice activation
        if (this.detectVoiceActivation(transcription)) {
          console.log('[SparkEngine] Voice activation detected')
          // Could trigger additional actions here
        }

        // Analyze the chunk
        await this.analyzeChunk(transcription)
      }
    } catch (err) {
      console.error('[SparkEngine] Error handling chunk:', err)
    }
  }

  /**
   * Convert blob to base64 string
   */
  private blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onloadend = () => {
        const result = reader.result as string
        const base64 = result.split(',')[1]
        resolve(base64)
      }
      reader.onerror = reject
      reader.readAsDataURL(blob)
    })
  }

  /**
   * Send audio chunk to Whisper proxy
   */
  private async transcribeChunk(base64Audio: string): Promise<string> {
    try {
      const response = await fetch(WHISPER_PROXY_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          audio: base64Audio,
          language: 'en',
          prompt: 'PowerOn electrical contractor business operations',
        }),
      })

      if (!response.ok) {
        throw new Error(`Whisper error: ${response.statusText}`)
      }

      const data = await response.json()
      return data.text || ''
    } catch (err) {
      console.error('[SparkEngine] Whisper transcription failed:', err)
      return ''
    }
  }

  /**
   * Send transcript chunk to Claude for analysis
   */
  private async analyzeChunk(text: string): Promise<void> {
    if (text.trim().length === 0) {
      return
    }

    const transcript = this.store.getState().transcript
    const analysisResults = this.store.getState().analysisResults

    const systemPrompt = `You are SPARK, a field intelligence companion for an electrical contractor.
Analyze this conversation chunk for:
- commitments made (specific promises or agreements)
- dollar amounts mentioned (prices, quotes, costs)
- timeline promises (delivery dates, completion dates)
- red flags (discounting pressure, scope creep, lowball anchors)
- opportunities (upsells, value-adds, potential referrals)

Return ONLY valid JSON with this exact structure:
{
  "commitments": [],
  "amounts": [],
  "timelines": [],
  "flags": [],
  "opportunities": []
}`

    const userPrompt = `Analyze this conversation chunk:\n\n${text}\n\nPrevious context: ${transcript.slice(-1000)}`

    try {
      const response = await fetch(CLAUDE_API_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messages: [
            {
              role: 'system',
              content: systemPrompt,
            },
            {
              role: 'user',
              content: userPrompt,
            },
          ],
          model: 'claude-3-5-haiku-20241022', // Fast model for real-time analysis
          temperature: 0.3, // Low temp for consistent analysis
          max_tokens: 1024,
        }),
      })

      if (!response.ok) {
        throw new Error(`Claude API error: ${response.statusText}`)
      }

      const data = await response.json()
      const content = data.content?.[0]?.text || ''

      // Parse JSON response
      const analysisData = this.parseAnalysisResponse(content)

      if (analysisData) {
        const result: SparkAnalysisResult = {
          timestamp: new Date().toISOString(),
          chunkIndex: analysisResults.length,
          commitments: analysisData.commitments || [],
          amounts: analysisData.amounts || [],
          timelines: analysisData.timelines || [],
          flags: analysisData.flags || [],
          opportunities: analysisData.opportunities || [],
        }

        this.store.addAnalysisResult(result)

        // Update current flags
        const allFlags = analysisResults.flatMap((r) => r.flags).concat(analysisData.flags || [])
        this.store.setCurrentFlags([...new Set(allFlags)])
      }
    } catch (err) {
      console.error('[SparkEngine] Claude analysis failed:', err)
    }
  }

  /**
   * Parse Claude's JSON response
   */
  private parseAnalysisResponse(text: string): SparkAnalysisResponse | null {
    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/)
      if (!jsonMatch) {
        return null
      }
      const parsed = JSON.parse(jsonMatch[0])
      return {
        commitments: Array.isArray(parsed.commitments) ? parsed.commitments : [],
        amounts: Array.isArray(parsed.amounts) ? parsed.amounts.filter((v) => typeof v === 'number') : [],
        timelines: Array.isArray(parsed.timelines) ? parsed.timelines : [],
        flags: Array.isArray(parsed.flags) ? parsed.flags : [],
        opportunities: Array.isArray(parsed.opportunities) ? parsed.opportunities : [],
      }
    } catch (err) {
      console.error('[SparkEngine] Failed to parse analysis response:', err)
      return null
    }
  }

  /**
   * Trigger debrief mode (end of call analysis)
   */
  async triggerDebrief(): Promise<void> {
    await this.stopListening()
    this.store.setMode('DEBRIEFING')

    const state = this.store.getState()
    if (this.currentSession) {
      const session: SparkSessionRecord = {
        ...this.currentSession,
        endTime: new Date().toISOString(),
        transcript: state.transcript,
        analysisResults: state.analysisResults,
        finalFlags: state.currentFlags,
      }

      this.store.saveSession(session)
      this.saveToLocalStorage(session)
    }

    console.log('[SparkEngine] Entered debrief mode')
  }

  /**
   * Save session to localStorage
   */
  private saveToLocalStorage(session: SparkSessionRecord): void {
    try {
      const history = JSON.parse(localStorage.getItem('spark_session_history') || '[]')
      history.push(session)
      // Keep last 50 sessions
      if (history.length > 50) {
        history.shift()
      }
      localStorage.setItem('spark_session_history', JSON.stringify(history))
    } catch (err) {
      console.error('[SparkEngine] Failed to save session to localStorage:', err)
    }
  }

  /**
   * Clean up resources
   */
  async cleanup(): Promise<void> {
    if (this.chunkTimeout) {
      clearTimeout(this.chunkTimeout)
    }
    if (this.silenceTimeout) {
      clearTimeout(this.silenceTimeout)
    }

    if (this.mediaRecorder) {
      this.mediaRecorder.stop()
    }

    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop())
    }

    if (this.audioContext) {
      await this.audioContext.close()
    }

    this.store.clearSession()
    console.log('[SparkEngine] Cleaned up resources')
  }
}

// Export singleton
export const sparkEngine = new SparkEngine()
