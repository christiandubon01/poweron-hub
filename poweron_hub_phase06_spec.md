# PowerOn Hub — Phase 06 Implementation Spec
## Voice Interface — Whisper & ElevenLabs Integration
### v2.0 Voice Commands & Responses · 11-Agent Architecture · Weeks 13–15

---

## Table of Contents

1. Overview & Architecture Summary
2. Voice Subsystem Design
3. Speech-to-Text (Whisper) Integration
4. Text-to-Speech (ElevenLabs) Integration
5. Wake Word Detection & Voice Activation
6. Voice Command Routing & Execution
7. Database Schema Extensions
8. Voice Preferences & Multi-User Support
9. Field Mode & Hands-Free Operations
10. Voice Memo Recording & Transcription
11. Integration Points with 11 Agents
12. Testing Strategy & Validation
13. File Tree After Phase 06
14. What Phase 07 Expects from Phase 06

---

## 1. Overview & Architecture Summary

Phase 06 introduces a voice interface layer that enables hands-free interaction with PowerOn Hub across all 11 agents. This phase integrates OpenAI's Whisper API for speech-to-text, ElevenLabs for text-to-speech, and implements wake word detection for field mode activation.

**Key Capabilities**:
- Voice commands routed through NEXUS classifier to any agent
- Automatic speech recognition (ASR) with job-site noise cancellation
- Natural language responses read aloud in user-selected voices
- Field mode for crew in noisy environments (push-to-talk)
- Voice memos attached to projects/field logs
- Response caching for common queries
- Per-user voice preferences (speed, voice selection, language)

**Use Cases**:
- "Hey NEXUS, show my leads for today" → SPARK lead list read aloud
- "CHRONO, schedule me with John at 2pm tomorrow" → Calendar confirmation read
- "Voice memo: Job at Palm Springs took 3 hours" → Transcribed and attached to job log
- Crew in field: Push-to-talk "Mark this as complete" → Job status updated

### Tech Stack for Phase 06

| Component | Provider | Purpose |
|-----------|----------|---------|
| Speech-to-Text | OpenAI Whisper API | Transcribe voice commands; job-site noise handling |
| Text-to-Speech | ElevenLabs | Natural-sounding response delivery; multiple voices |
| Wake Word Detection | Porcupine (or custom ML) | Local on-device activation ("Hey NEXUS") |
| Audio Preprocessing | Web Audio API + Noise Suppression | Real-time noise filtering |
| Voice Memos | Blob storage (Cloudflare R2 or S3) | Store audio files; link to entities |
| Database | Supabase PostgreSQL | voice_sessions, voice_memos, voice_preferences, voice_responses |

### Architecture Diagram

```
User speaks
    ↓
Wake word detection ("Hey NEXUS")
    ↓
Audio preprocessing (noise suppression)
    ↓
Whisper API: Convert speech → text
    ↓
NEXUS Classifier: Route to agent (SPARK, CHRONO, etc.)
    ↓
Agent executes command (e.g., list leads, schedule job)
    ↓
Generate response text
    ↓
ElevenLabs: Convert text → speech
    ↓
Cache response; play audio to user
    ↓
Log to voice_sessions for audit
```

---

## 2. Voice Subsystem Design

### 2.1 Voice Session Lifecycle

```
[INACTIVE] → [LISTENING] → [TRANSCRIBING] → [PROCESSING] → [RESPONDING] → [COMPLETE]
                 ↑                                              ↓
                 ↓________________________________________________↓
                           (loop on user interrupt)
```

### 2.2 Voice System Architecture

```typescript
// src/services/voice.ts - Core voice subsystem

interface VoiceSession {
  id: string;
  org_id: string;
  user_id: string;
  device_id: string;
  
  // Lifecycle
  started_at: string;
  ended_at?: string;
  duration_seconds: number;
  
  // Audio input
  raw_audio_blob_url?: string;
  audio_duration_seconds: number;
  noise_level_db?: number;
  
  // Speech-to-text
  transcript_raw: string;
  transcript_confidence: number; // 0-1
  language: string; // 'en-US'
  
  // Processing
  detected_intent: string; // 'list_leads', 'schedule_event', etc.
  target_agent: string; // 'SPARK', 'CHRONO', 'NEXUS'
  agent_response: string; // JSON or plain text
  
  // Text-to-speech
  response_audio_url?: string;
  response_voice_id: string; // ElevenLabs voice ID
  response_duration_seconds?: number;
  
  // Metadata
  mode: 'normal' | 'field' | 'push_to_talk';
  status: 'listening' | 'transcribing' | 'processing' | 'responding' | 'complete' | 'error';
  error?: string;
  
  created_at: string;
}

export class VoiceSubsystem {
  private audioContext: AudioContext;
  private mediaRecorder: MediaRecorder;
  private wakeWordDetector: any; // Porcupine instance
  private noiseSuppressionProcessor?: AudioWorkletNode;
  
  async initialize(): Promise<void> {
    // Initialize audio context, wake word detector, noise suppression
  }
  
  async startListening(mode: 'normal' | 'field' | 'push_to_talk'): Promise<void> {
    // Start recording audio; activate wake word detection if mode !== push_to_talk
  }
  
  async stopListening(): Promise<void> {
    // Stop recording; collect audio blob
  }
  
  async transcribeAudio(audioBlob: Blob): Promise<{ text: string; confidence: number }> {
    // Call Whisper API with noise preprocessing
  }
  
  async classifyIntent(transcript: string): Promise<{ agent: string; intent: string }> {
    // Route to NEXUS classifier to determine target agent and intent
  }
  
  async executeAgentCommand(agent: string, intent: string, transcript: string): Promise<string> {
    // Call agent API (SPARK, CHRONO, VAULT, etc.) and return response
  }
  
  async synthesizeResponse(text: string, voiceId: string): Promise<{ audioUrl: string; duration: number }> {
    // Call ElevenLabs API; return audio URL and duration
  }
  
  async playResponse(audioUrl: string): Promise<void> {
    // Stream audio to user's speaker
  }
  
  async saveVoiceSession(session: VoiceSession): Promise<void> {
    // Persist session to database; link to related entities
  }
}
```

---

## 3. Speech-to-Text (Whisper) Integration

### 3.1 Whisper API Implementation

```typescript
// src/api/voice/whisper.ts

export interface WhisperRequest {
  audio: Blob;
  language?: string; // 'en'
  temperature?: number; // 0-1
  timestamp_granularities?: ('segment' | 'word')[];
}

export interface WhisperResponse {
  text: string;
  language: string;
  duration: number; // seconds
  segments?: Array<{
    id: number;
    seek: number;
    start: number; // seconds
    end: number;
    text: string;
    avg_logprob: number;
    compression_ratio: number;
    no_speech_prob: number;
  }>;
}

export async function transcribeWithWhisper(
  audioBlob: Blob,
  options: { language?: string; noise_db?: number } = {}
): Promise<WhisperResponse> {
  const formData = new FormData();
  formData.append('file', audioBlob);
  formData.append('model', 'whisper-1');
  formData.append('language', options.language || 'en');
  formData.append('timestamp_granularities', 'segment');
  
  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${import.meta.env.VITE_OPENAI_API_KEY}`,
    },
    body: formData,
  });
  
  if (!response.ok) {
    throw new Error(`Whisper API error: ${response.statusText}`);
  }
  
  return response.json();
}
```

### 3.2 Audio Preprocessing for Job Sites

```typescript
// src/services/audioPreprocessing.ts

interface AudioPreprocessingOptions {
  targetSampleRate?: number; // 16000 for Whisper
  noiseSuppressionStrength?: number; // 0-1
  enableVAD?: boolean; // Voice Activity Detection
  echoCancellation?: boolean;
}

export class AudioPreprocessor {
  private audioContext: AudioContext;
  private noiseGate: GainNode;
  private analyser: AnalyserNode;
  
  constructor() {
    this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
  }
  
  async preprocess(
    audioBlob: Blob,
    options: AudioPreprocessingOptions = {}
  ): Promise<Blob> {
    const arrayBuffer = await audioBlob.arrayBuffer();
    const audioData = await this.audioContext.decodeAudioData(arrayBuffer);
    
    // Resample to 16kHz for Whisper
    const targetSampleRate = options.targetSampleRate || 16000;
    if (audioData.sampleRate !== targetSampleRate) {
      return this.resample(audioData, targetSampleRate);
    }
    
    // Noise suppression: Simple high-pass filter + noise gate
    if (options.noiseSuppressionStrength !== undefined) {
      const filtered = this.applyHighPassFilter(audioData, 80); // Remove low-freq noise
      return this.applyNoiseGate(filtered, options.noiseSuppressionStrength);
    }
    
    return audioBlob;
  }
  
  private resample(audioData: AudioBuffer, targetSampleRate: number): Blob {
    // Use offline audio context for resampling
    const offlineContext = new OfflineAudioContext(
      audioData.numberOfChannels,
      audioData.length * (targetSampleRate / audioData.sampleRate),
      targetSampleRate
    );
    
    const source = offlineContext.createBufferSource();
    source.buffer = audioData;
    source.connect(offlineContext.destination);
    source.start(0);
    
    return offlineContext.startRendering().then((renderedBuffer) => {
      return this.audioBufferToBlob(renderedBuffer);
    });
  }
  
  private applyHighPassFilter(audioData: AudioBuffer, cutoffHz: number): AudioBuffer {
    // Simple 1st-order high-pass filter implementation
    const output = new Float32Array(audioData.length);
    const channels = [];
    
    for (let ch = 0; ch < audioData.numberOfChannels; ch++) {
      channels.push(audioData.getChannelData(ch));
    }
    
    // Nyquist frequency
    const nyquist = audioData.sampleRate / 2;
    const normalizedCutoff = cutoffHz / nyquist;
    
    // Very simple high-pass: subtract low-pass
    for (let ch = 0; ch < audioData.numberOfChannels; ch++) {
      const input = channels[ch];
      const filtered = new Float32Array(input.length);
      
      let prevOutput = 0;
      const alpha = normalizedCutoff / (1 + normalizedCutoff);
      
      for (let i = 0; i < input.length; i++) {
        const output = alpha * (prevOutput + input[i] - (i > 0 ? input[i - 1] : 0));
        filtered[i] = output;
        prevOutput = output;
      }
    }
    
    return audioData; // Simplified; real impl would modify buffer in place
  }
  
  private applyNoiseGate(audioData: AudioBuffer, threshold: number): Blob {
    // Simple noise gate: silence samples below threshold * max amplitude
    const channels = [];
    for (let ch = 0; ch < audioData.numberOfChannels; ch++) {
      channels.push(audioData.getChannelData(ch));
    }
    
    const maxAmplitude = Math.max(...channels.map(ch => Math.max(...Array.from(ch))));
    const gateThreshold = maxAmplitude * (1 - threshold);
    
    for (let ch = 0; ch < audioData.numberOfChannels; ch++) {
      const channel = channels[ch];
      for (let i = 0; i < channel.length; i++) {
        if (Math.abs(channel[i]) < gateThreshold) {
          channel[i] = 0;
        }
      }
    }
    
    return this.audioBufferToBlob(audioData);
  }
  
  private audioBufferToBlob(audioBuffer: AudioBuffer): Blob {
    const numberOfChannels = audioBuffer.numberOfChannels;
    const sampleRate = audioBuffer.sampleRate;
    const format = 'audio/wav';
    const bitDepth = 16;
    
    const bytesPerSample = bitDepth / 8;
    const blockAlign = numberOfChannels * bytesPerSample;
    
    const channels = [];
    for (let ch = 0; ch < numberOfChannels; ch++) {
      channels.push(audioBuffer.getChannelData(ch));
    }
    
    const interleaved = this.interleaveChannels(channels);
    const wav = this.encodeWAV(interleaved, sampleRate, numberOfChannels, bitDepth);
    
    return new Blob([wav], { type: format });
  }
  
  private interleaveChannels(channels: Float32Array[]): Float32Array {
    const totalLength = channels[0].length * channels.length;
    const interleaved = new Float32Array(totalLength);
    let index = 0;
    
    for (let i = 0; i < channels[0].length; i++) {
      for (let ch = 0; ch < channels.length; ch++) {
        interleaved[index++] = channels[ch][i];
      }
    }
    
    return interleaved;
  }
  
  private encodeWAV(
    samples: Float32Array,
    sampleRate: number,
    numChannels: number,
    bitDepth: number
  ): ArrayBuffer {
    const bytesPerSample = bitDepth / 8;
    const blockAlign = numChannels * bytesPerSample;
    
    const buffer = new ArrayBuffer(44 + samples.length * bytesPerSample);
    const view = new DataView(buffer);
    
    // WAV header
    const writeString = (offset: number, string: string) => {
      for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
      }
    };
    
    writeString(0, 'RIFF');
    view.setUint32(4, 36 + samples.length * bytesPerSample, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true); // Subchunk1Size
    view.setUint16(20, 1, true); // AudioFormat (1 = PCM)
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * blockAlign, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitDepth, true);
    writeString(36, 'data');
    view.setUint32(40, samples.length * bytesPerSample, true);
    
    // Convert float samples to PCM
    let offset = 44;
    const volume = 0.8;
    for (let i = 0; i < samples.length; i++) {
      const s = Math.max(-1, Math.min(1, samples[i])) * volume;
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
      offset += 2;
    }
    
    return buffer;
  }
}
```

---

## 4. Text-to-Speech (ElevenLabs) Integration

### 4.1 ElevenLabs API Implementation

```typescript
// src/api/voice/elevenLabs.ts

export interface ElevenLabsVoice {
  voice_id: string;
  name: string;
  category: 'premade' | 'cloned';
  settings?: {
    stability: number; // 0-1
    similarity_boost: number; // 0-1
  };
}

export interface TTSRequest {
  text: string;
  voice_id: string;
  model_id?: string; // 'eleven_monolingual_v1', 'eleven_multilingual_v2'
  voice_settings?: {
    stability: number;
    similarity_boost: number;
  };
}

export interface TTSResponse {
  audio_url: string;
  duration_seconds: number;
  characters_processed: number;
}

const AVAILABLE_VOICES: Record<string, ElevenLabsVoice> = {
  adam: { voice_id: '2BXzm1TsP3u5H8M9K2L1', name: 'Adam', category: 'premade' },
  arnold: { voice_id: '5C2F5Z7B1M9A3K8L0Y6X', name: 'Arnold', category: 'premade' },
  bella: { voice_id: '8Z9L2M7K3A1B5C9X0Y8W', name: 'Bella', category: 'premade' },
  domi: { voice_id: '1X5K8M2L9B3A7C0Y6Z4W', name: 'Domi', category: 'premade' },
};

export async function synthesizeWithElevenLabs(request: TTSRequest): Promise<TTSResponse> {
  const apiKey = import.meta.env.VITE_ELEVEN_LABS_API_KEY;
  
  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${request.voice_id}`,
    {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text: request.text,
        model_id: request.model_id || 'eleven_monolingual_v1',
        voice_settings: request.voice_settings || {
          stability: 0.75,
          similarity_boost: 0.75,
        },
      }),
    }
  );
  
  if (!response.ok) {
    throw new Error(`ElevenLabs API error: ${response.statusText}`);
  }
  
  const audioBlob = await response.blob();
  const audioUrl = URL.createObjectURL(audioBlob);
  
  // Estimate duration based on text length (rough heuristic)
  const wordsPerMinute = 150;
  const words = request.text.split(' ').length;
  const estimatedDuration = (words / wordsPerMinute) * 60;
  
  return {
    audio_url: audioUrl,
    duration_seconds: estimatedDuration,
    characters_processed: request.text.length,
  };
}
```

---

## 5. Wake Word Detection & Voice Activation

### 5.1 Wake Word Integration

```typescript
// src/services/wakeWordDetector.ts

import PorcupineManager from '@picovoice/porcupine-web';

export class WakeWordDetector {
  private porcupineManager?: any;
  private isListening = false;
  
  async initialize(accessKey: string): Promise<void> {
    // Initialize Porcupine for "Hey NEXUS" wake word
    this.porcupineManager = await PorcupineManager.create(
      accessKey,
      ['hey NEXUS'], // Custom wake phrase
      (keywordIndex: number) => {
        console.log(`Wake word detected: ${keywordIndex}`);
        this.onWakeWordDetected();
      }
    );
  }
  
  async start(): Promise<void> {
    if (this.porcupineManager && !this.isListening) {
      await this.porcupineManager.start();
      this.isListening = true;
    }
  }
  
  async stop(): Promise<void> {
    if (this.porcupineManager && this.isListening) {
      await this.porcupineManager.stop();
      this.isListening = false;
    }
  }
  
  async release(): Promise<void> {
    if (this.porcupineManager) {
      await this.porcupineManager.release();
    }
  }
  
  private onWakeWordDetected(): void {
    // Emit event or callback
    window.dispatchEvent(new CustomEvent('wakeWordDetected'));
  }
}
```

---

## 6. Voice Command Routing & Execution

### 6.1 Intent Classification

```typescript
// src/api/voice/routing.ts

export interface IntentClassification {
  agent: 'NEXUS' | 'SPARK' | 'CHRONO' | 'VAULT' | 'BLUEPRINT' | 'OHM' | 'LEDGER' | 'SCOUT' | 'PULSE';
  intent: string; // e.g., 'list_leads', 'schedule_event', 'get_estimate'
  confidence: number; // 0-1
  parameters: Record<string, any>; // Extracted entities (date, time, person, etc.)
}

export async function classifyVoiceIntent(transcript: string): Promise<IntentClassification> {
  const response = await fetch('/api/anthropic/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 300,
      system: `You are a voice intent classifier for PowerOn Hub (electrical contracting software).
Classify user voice commands into agent + intent + parameters.

Agents: NEXUS (manager), SPARK (sales), CHRONO (scheduling), VAULT (estimates), 
        BLUEPRINT (projects), OHM (code), LEDGER (finance), SCOUT (analyzer), PULSE (dashboard)

Return JSON: { "agent": "...", "intent": "...", "confidence": 0.9, "parameters": {...} }`,
      messages: [
        {
          role: 'user',
          content: `Classify this voice command: "${transcript}"`,
        },
      ],
    }),
  });
  
  const data = await response.json() as any;
  const content = data.content?.[0]?.text || '';
  
  try {
    const jsonMatch = content.match(/\{.*\}/s);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  } catch (e) {
    console.error('Intent classification parse error:', e);
  }
  
  return {
    agent: 'NEXUS',
    intent: 'unknown',
    confidence: 0,
    parameters: {},
  };
}
```

### 6.2 Agent Command Execution

```typescript
// src/services/voiceCommandExecutor.ts

export class VoiceCommandExecutor {
  async executeCommand(
    agent: string,
    intent: string,
    parameters: Record<string, any>,
    userContext: { org_id: string; user_id: string }
  ): Promise<string> {
    switch (agent) {
      case 'SPARK':
        return this.executeSPARKCommand(intent, parameters, userContext);
      case 'CHRONO':
        return this.executeCHRONOCommand(intent, parameters, userContext);
      case 'VAULT':
        return this.executeVAULTCommand(intent, parameters, userContext);
      case 'BLUEPRINT':
        return this.executeBLUEPRINTCommand(intent, parameters, userContext);
      default:
        return 'Command not recognized. Please try again.';
    }
  }
  
  private async executeSPARKCommand(
    intent: string,
    params: Record<string, any>,
    ctx: { org_id: string; user_id: string }
  ): Promise<string> {
    switch (intent) {
      case 'list_leads':
        const leads = await fetch(`/api/spark/leads?org_id=${ctx.org_id}&status=${params.status || 'new'}`)
          .then(r => r.json());
        return `You have ${leads.length} leads. The first is ${leads[0]?.name || 'none'}.`;
      
      case 'lead_status':
        const lead = await fetch(`/api/spark/leads/${params.lead_id}`).then(r => r.json());
        return `Lead ${lead.name} is in ${lead.status} status.`;
      
      default:
        return 'SPARK command not recognized.';
    }
  }
  
  private async executeCHRONOCommand(
    intent: string,
    params: Record<string, any>,
    ctx: { org_id: string; user_id: string }
  ): Promise<string> {
    switch (intent) {
      case 'schedule_event':
        const event = await fetch('/api/chrono/events', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            org_id: ctx.org_id,
            title: params.title,
            event_type: 'appointment',
            start_time: params.start_time,
            end_time: params.end_time,
          }),
        }).then(r => r.json());
        return `Event "${event.title}" scheduled for ${params.start_time}.`;
      
      case 'list_today_jobs':
        const today = new Date().toISOString().split('T')[0];
        const jobs = await fetch(`/api/chrono/events?org_id=${ctx.org_id}&date=${today}`)
          .then(r => r.json());
        return `You have ${jobs.length} jobs scheduled today.`;
      
      default:
        return 'CHRONO command not recognized.';
    }
  }
  
  private async executeVAULTCommand(intent: string, params: any, ctx: any): Promise<string> {
    return 'VAULT command received.';
  }
  
  private async executeBLUEPRINTCommand(intent: string, params: any, ctx: any): Promise<string> {
    return 'BLUEPRINT command received.';
  }
}
```

---

## 7. Database Schema Extensions

```sql
-- migration: 2025-04-02-phase06-voice.sql

CREATE TABLE voice_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  user_id UUID NOT NULL REFERENCES employees(id),
  device_id VARCHAR(255),
  
  mode VARCHAR(20) NOT NULL, -- normal, field, push_to_talk
  status VARCHAR(20) NOT NULL, -- listening, transcribing, processing, responding, complete, error
  
  started_at TIMESTAMP DEFAULT NOW(),
  ended_at TIMESTAMP,
  duration_seconds INTEGER,
  
  raw_audio_url VARCHAR(500),
  audio_duration_seconds DECIMAL(6,2),
  noise_level_db DECIMAL(5,2),
  
  transcript_raw TEXT,
  transcript_confidence DECIMAL(3,2),
  language VARCHAR(10) DEFAULT 'en-US',
  
  detected_intent VARCHAR(255),
  target_agent VARCHAR(50),
  agent_response TEXT,
  
  response_audio_url VARCHAR(500),
  response_voice_id VARCHAR(100),
  response_duration_seconds DECIMAL(6,2),
  
  error_message TEXT,
  
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  
  CONSTRAINT mode_valid CHECK (mode IN ('normal', 'field', 'push_to_talk')),
  CONSTRAINT status_valid CHECK (status IN ('listening', 'transcribing', 'processing', 'responding', 'complete', 'error'))
);

CREATE INDEX idx_voice_sessions_org_id ON voice_sessions(org_id);
CREATE INDEX idx_voice_sessions_user_id ON voice_sessions(user_id);
CREATE INDEX idx_voice_sessions_created_at ON voice_sessions(created_at);
CREATE INDEX idx_voice_sessions_status ON voice_sessions(status);

CREATE TABLE voice_memos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  user_id UUID NOT NULL REFERENCES employees(id),
  
  title VARCHAR(255),
  transcript TEXT NOT NULL,
  transcript_confidence DECIMAL(3,2),
  
  audio_url VARCHAR(500),
  audio_duration_seconds DECIMAL(6,2),
  
  -- Attachment to entity
  related_entity_type VARCHAR(50), -- project, field_log, lead, etc.
  related_entity_id UUID,
  
  is_public BOOLEAN DEFAULT FALSE,
  
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_voice_memos_org_id ON voice_memos(org_id);
CREATE INDEX idx_voice_memos_related_entity ON voice_memos(related_entity_type, related_entity_id);

CREATE TABLE voice_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  user_id UUID NOT NULL REFERENCES employees(id),
  
  enabled BOOLEAN DEFAULT TRUE,
  
  -- TTS preferences
  tts_voice_id VARCHAR(100) DEFAULT '2BXzm1TsP3u5H8M9K2L1', -- Adam voice
  tts_speed DECIMAL(2,1) DEFAULT 1.0, -- 0.5-2.0
  tts_language VARCHAR(10) DEFAULT 'en-US',
  
  -- ASR preferences
  asr_language VARCHAR(10) DEFAULT 'en-US',
  noise_suppression_strength DECIMAL(2,1) DEFAULT 0.7, -- 0-1
  
  -- Voice activation
  wake_word_enabled BOOLEAN DEFAULT TRUE,
  wake_word_phrase VARCHAR(100) DEFAULT 'Hey NEXUS',
  
  -- Field mode
  field_mode_enabled BOOLEAN DEFAULT TRUE,
  push_to_talk_enabled BOOLEAN DEFAULT FALSE,
  push_to_talk_key VARCHAR(20), -- 'space', 'ctrl+space', etc.
  
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  
  UNIQUE(org_id, user_id)
);

CREATE INDEX idx_voice_preferences_org_id ON voice_preferences(org_id);
```

---

## 8. Voice Preferences UI Component

```typescript
// src/components/voice/VoicePreferences.tsx

export interface VoicePreferencesProps {
  orgId: string;
  userId: string;
}

export function VoicePreferences({ orgId, userId }: VoicePreferencesProps) {
  const [prefs, setPrefs] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  
  const voices = [
    { id: '2BXzm1TsP3u5H8M9K2L1', name: 'Adam', gender: 'male' },
    { id: '8Z9L2M7K3A1B5C9X0Y8W', name: 'Bella', gender: 'female' },
    { id: '5C2F5Z7B1M9A3K8L0Y6X', name: 'Arnold', gender: 'male' },
    { id: '1X5K8M2L9B3A7C0Y6Z4W', name: 'Domi', gender: 'female' },
  ];
  
  useEffect(() => {
    fetch(`/api/voice/preferences?org_id=${orgId}&user_id=${userId}`)
      .then(r => r.json())
      .then(setPrefs);
  }, [orgId, userId]);
  
  const handleSave = async () => {
    setSaving(true);
    await fetch(`/api/voice/preferences`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ org_id: orgId, user_id: userId, ...prefs }),
    });
    setSaving(false);
  };
  
  if (!prefs) return <div>Loading...</div>;
  
  return (
    <div className="bg-gray-900 p-6 rounded-lg space-y-6">
      <div>
        <h3 className="text-emerald-400 font-bold mb-4">Voice Settings</h3>
        
        <div className="space-y-4">
          <div>
            <label className="text-gray-300 block mb-2">Voice</label>
            <select
              value={prefs.tts_voice_id}
              onChange={(e) => setPrefs({ ...prefs, tts_voice_id: e.target.value })}
              className="bg-gray-800 text-gray-100 p-2 rounded w-full"
            >
              {voices.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          </div>
          
          <div>
            <label className="text-gray-300 block mb-2">Speech Speed: {prefs.tts_speed}x</label>
            <input
              type="range"
              min="0.5"
              max="2"
              step="0.1"
              value={prefs.tts_speed}
              onChange={(e) => setPrefs({ ...prefs, tts_speed: parseFloat(e.target.value) })}
              className="w-full"
            />
          </div>
          
          <div className="flex items-center space-x-2">
            <input
              type="checkbox"
              checked={prefs.wake_word_enabled}
              onChange={(e) => setPrefs({ ...prefs, wake_word_enabled: e.target.checked })}
              className="rounded"
            />
            <label className="text-gray-300">Enable Wake Word ("Hey NEXUS")</label>
          </div>
          
          <div className="flex items-center space-x-2">
            <input
              type="checkbox"
              checked={prefs.push_to_talk_enabled}
              onChange={(e) => setPrefs({ ...prefs, push_to_talk_enabled: e.target.checked })}
              className="rounded"
            />
            <label className="text-gray-300">Push-to-Talk Mode (for noisy environments)</label>
          </div>
        </div>
      </div>
      
      <button
        onClick={handleSave}
        disabled={saving}
        className="bg-emerald-500 hover:bg-emerald-600 text-white font-bold py-2 px-4 rounded disabled:opacity-50"
      >
        {saving ? 'Saving...' : 'Save Preferences'}
      </button>
    </div>
  );
}
```

---

## 9. Field Mode & Hands-Free Operations

Field mode enables hands-free voice interaction in noisy environments (job sites). Key features:
- Push-to-talk activation (hardware button or keyboard shortcut)
- Real-time audio visualization (waveform)
- Reduced latency (response priority)
- Text display (in case audio fails)
- Status indicators (listening, processing, responding)

---

## 10. Voice Memo Recording & Transcription

```typescript
// src/components/voice/VoiceMemoRecorder.tsx

export interface VoiceMemoRecorderProps {
  orgId: string;
  userId: string;
  relatedEntityType?: string;
  relatedEntityId?: string;
}

export function VoiceMemoRecorder({
  orgId,
  userId,
  relatedEntityType,
  relatedEntityId,
}: VoiceMemoRecorderProps) {
  const [recording, setRecording] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [saving, setSaving] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  
  const startRecording = async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mediaRecorder = new MediaRecorder(stream);
    
    mediaRecorder.ondataavailable = (event) => {
      audioChunksRef.current.push(event.data);
    };
    
    mediaRecorder.onstop = async () => {
      const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
      audioChunksRef.current = [];
      
      // Transcribe
      const formData = new FormData();
      formData.append('file', audioBlob);
      formData.append('model', 'whisper-1');
      
      const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${import.meta.env.VITE_OPENAI_API_KEY}` },
        body: formData,
      });
      
      const result = await response.json() as any;
      setTranscript(result.text || '');
    };
    
    mediaRecorder.start();
    mediaRecorderRef.current = mediaRecorder;
    setRecording(true);
  };
  
  const stopRecording = () => {
    mediaRecorderRef.current?.stop();
    setRecording(false);
  };
  
  const saveMemo = async () => {
    setSaving(true);
    await fetch('/api/voice/memos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        org_id: orgId,
        user_id: userId,
        transcript,
        related_entity_type: relatedEntityType,
        related_entity_id: relatedEntityId,
      }),
    });
    setSaving(false);
    setTranscript('');
  };
  
  return (
    <div className="bg-gray-800 p-4 rounded-lg">
      <div className="flex gap-2 mb-4">
        <button
          onClick={recording ? stopRecording : startRecording}
          className={`px-4 py-2 rounded text-white font-bold ${
            recording ? 'bg-red-600 hover:bg-red-700' : 'bg-emerald-500 hover:bg-emerald-600'
          }`}
        >
          {recording ? 'Stop Recording' : 'Start Voice Memo'}
        </button>
      </div>
      
      {transcript && (
        <div className="space-y-2">
          <textarea
            value={transcript}
            onChange={(e) => setTranscript(e.target.value)}
            className="w-full h-24 bg-gray-900 text-gray-100 p-2 rounded"
            placeholder="Transcribed memo..."
          />
          <button
            onClick={saveMemo}
            disabled={saving}
            className="bg-emerald-500 hover:bg-emerald-600 text-white font-bold py-2 px-4 rounded disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save Memo'}
          </button>
        </div>
      )}
    </div>
  );
}
```

---

## 11. Integration Points with 11 Agents

All 11 agents can accept voice commands routed through NEXUS classifier:

- **NEXUS**: Route all voice commands; provide aggregated voice responses
- **SPARK**: List leads, update status, draft responses
- **CHRONO**: Schedule events, list today's jobs, crew dispatch
- **VAULT**: Get estimates, cost analysis
- **BLUEPRINT**: Project status, phase progress, RFI list
- **OHM**: Code questions, compliance checks
- **LEDGER**: Invoice status, expense reports
- **SCOUT**: Analyze data trends, market insights
- **PULSE**: Dashboard summary, KPI voice reports
- **Plus 2 more agents in Phase 07+**

---

## 12. Testing Strategy & Validation

**Voice Unit Tests**:
- Whisper API transcription accuracy (known test phrases)
- ElevenLabs TTS generation (response audio playback)
- Wake word detection (trigger on "Hey NEXUS", ignore false positives)
- Intent classification (all major agent intents)
- Audio preprocessing (noise suppression effectiveness)

**Integration Tests**:
- Voice command → agent execution → TTS response (full pipeline)
- Field mode with simulated background noise
- Push-to-talk activation and deactivation
- Voice memo recording and transcription
- Preference persistence and application

**E2E Voice Flows**:
1. "Hey NEXUS, show my leads" → transcribed → SPARK queried → leads read aloud
2. "Schedule me with John at 2pm tomorrow" → CHRONO event created → confirmation read
3. Voice memo recorded on job site → transcribed → attached to project

---

## 13. File Tree After Phase 06

```
src/
├── services/
│   ├── voice.ts (NEW: Core VoiceSubsystem class)
│   ├── audioPreprocessing.ts (NEW: Audio filtering, resampling)
│   ├── wakeWordDetector.ts (NEW: Porcupine integration)
│   └── voiceCommandExecutor.ts (NEW: Command routing & execution)
├── api/
│   ├── voice/ (NEW)
│   │   ├── whisper.ts (Speech-to-text)
│   │   ├── elevenLabs.ts (Text-to-speech)
│   │   └── routing.ts (Intent classification)
│   └── ... (existing)
├── components/
│   ├── voice/ (NEW)
│   │   ├── VoiceActivation.tsx (Wake word UI)
│   │   ├── VoicePreferences.tsx (Settings)
│   │   ├── VoiceMemoRecorder.tsx (Memo UI)
│   │   ├── FieldModeInterface.tsx (Noisy environment UI)
│   │   └── VoiceSessionLog.tsx (Session history)
│   └── ... (existing)
└── ... (existing)
```

---

## 14. What Phase 07 Expects from Phase 06

1. **Stable voice APIs**: Whisper transcription, ElevenLabs TTS, intent routing all reliable.

2. **Wake word detection**: "Hey NEXUS" activation working consistently; minimal false positives.

3. **Audio quality**: Field mode noise suppression effective at job sites (80+ dB background).

4. **Intent classification**: All 11 agents' major intents recognized and routed correctly.

5. **Response caching**: Common queries (e.g., "list today's jobs") cached and served without API latency.

6. **Voice session logging**: All interactions logged for audit, QA, and continuous improvement.

7. **Preference system**: User voice preferences (speed, voice, language) applied consistently.

**Phase 07 (Cross-Platform)** will extend voice features to iOS, Android, and Windows native apps using Capacitor.js and Electron, with native audio APIs replacing Web Audio API.
