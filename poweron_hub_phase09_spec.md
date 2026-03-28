# PowerOn Hub — Phase 09 Implementation Spec
## ECHO · Voice Interface · Speech-to-Text & Text-to-Speech
### v2.0 Blueprint · 12-Agent Architecture · Weeks 22–24

---

## Table of Contents

1. Overview & Architecture Summary
2. ECHO Agent — Detailed Design
3. Voice Processing Pipeline
4. Database Migrations
5. Frontend Components & UI
6. Integration Points with NEXUS Classifier
7. API Endpoints & Voice Session Management
8. Testing Strategy & Validation
9. File Tree After Phase 09
10. What Phase 10 Expects from Phase 09

---

## 1. Overview & Architecture Summary

Phase 09 introduces **ECHO**, the 12th agent in the PowerOn Hub ecosystem. ECHO is a voice interface layer that sits on top of the existing NEXUS routing system, enabling field personnel to interact with the hub using natural voice commands. This is critical for electrical contractors working on job sites where hands are busy and eyes are focused on installations.

### Phase 09 Scope

| Component | Owner | Key Responsibility |
|-----------|-------|-------------------|
| Voice Capture & Audio Pipeline | Field Supervisor | Record audio, preprocessing, noise management |
| Speech-to-Text (Whisper) | Voice Layer | Convert voice to text via OpenAI Whisper API |
| NEXUS Routing Integration | Voice Layer | Pass transcribed text to existing classifier |
| Text-to-Speech (ElevenLabs) | Voice Layer | Convert agent responses back to natural speech |
| Voice Memo Manager | Documentation | Record, store, and attach memos to projects |
| Voice Session History | Audit Trail | Track all voice interactions with transcripts |
| Push-to-Talk UI | Mobile Experience | Hold-to-record button with visual feedback |
| Hands-Free Mode | Field Operations | Wake-word activation ("Hey NEXUS") with background processing |
| Voice Preferences | User Settings | Per-user voice selection, speed, language, wake word enable/disable |
| Audio Preprocessing | Signal Processing | High-pass filter, noise gate for job site environments |

### Tech Stack Additions for Phase 09

- **Voice Capture**: Web Audio API (getUserMedia) with AudioContext
- **Speech-to-Text**: OpenAI Whisper API (whisper-1 model)
- **Text-to-Speech**: ElevenLabs API (multi-voice, configurable speed)
- **Audio Storage**: Supabase Storage (audio_url references in voice_memos)
- **Real-time Feedback**: WebSocket via Supabase Realtime for live transcription
- **Client-side Audio Processing**: Tone.js for preprocessing, Web Audio API for capture
- **React Hooks**: useAudio (custom), useVoiceSession (custom), useVoicePreferences (custom)

---

## 2. ECHO Agent — Detailed Design

### 2.1 ECHO Architecture Diagram

```
┌─────────────────────────────────────────────────────────┐
│                   Voice Input (User)                     │
│                                                           │
│  Microphone → Audio Capture → [Preprocessing]            │
│               (Web Audio API)   (Filters, Noise Gate)     │
└─────────────────────────┬───────────────────────────────┘
                          │
                          ↓
        ┌────────────────────────────────┐
        │  ECHO Voice Processor           │
        │  - Audio encoding to WAV        │
        │  - Whisper API call            │
        │  - Transcript parsing           │
        └────────────┬───────────────────┘
                     │
                     ↓ (Transcribed Text)
        ┌────────────────────────────────┐
        │  NEXUS Classifier              │
        │  - Agent routing               │
        │  - Intent classification       │
        └────────────┬───────────────────┘
                     │
                     ↓ (Text Response)
        ┌────────────────────────────────┐
        │  Target Agent (SCOUT, PULSE,   │
        │   VAULT, LEDGER, BLUEPRINT,    │
        │   OHM, CHRONO, SPARK, etc)     │
        │  - Process request             │
        │  - Generate text response      │
        └────────────┬───────────────────┘
                     │
                     ↓ (Response Text)
        ┌────────────────────────────────┐
        │  ECHO Text-to-Speech           │
        │  - ElevenLabs API call         │
        │  - Audio generation            │
        │  - Voice preferences applied   │
        └────────────┬───────────────────┘
                     │
                     ↓
┌─────────────────────────────────────────────────────────┐
│                  Audio Output (User)                     │
│                                                           │
│  Speaker/Headphones ← Audio Playback ← [ElevenLabs MP3] │
└─────────────────────────────────────────────────────────┘
```

### 2.2 Voice Capabilities by Scenario

**Scenario 1: Field Tech Asking for Material Info**
- Tech: "Hey NEXUS, what's the wire size for a 30-amp circuit on this job?"
- ECHO captures → Whisper transcribes → NEXUS routes to OHM → OHM calculates → ECHO plays response

**Scenario 2: Recording a Site Memo**
- Tech: "Create a voice memo: Conduit run delayed due to concrete pour. Reschedule for tomorrow."
- ECHO captures → Whisper transcribes → saved as voice_memo with transcript → attached to project

**Scenario 3: Quick Project Status Check**
- Tech: "What's the status of the Palm Desert hospital job?"
- ECHO captures → Whisper transcribes → NEXUS routes to PULSE → PULSE retrieves dashboard data → ECHO plays summary

**Scenario 4: Hands-Free Compliance Check**
- Tech: "Hey NEXUS, is this installation code compliant?"
- Wake-word detected (device listener) → ECHO records → Whisper transcribes → NEXUS routes to OHM → compliance response played

---

## 3. Voice Processing Pipeline

### 3.1 Audio Capture & Preprocessing

```typescript
// src/agents/echo/audioCapture.ts

import { Tone } from 'tone';

export interface AudioPreprocessConfig {
  highPassFrequency: number; // Default 80 Hz (removes HVAC hum)
  noiseGateThreshold: number; // Default -40 dB
  targetSampleRate: number; // 16000 Hz for Whisper
  maxDuration: number; // 5 minutes
}

export class AudioCapture {
  private audioContext: AudioContext;
  private mediaStream: MediaStream | null = null;
  private processor: ScriptProcessorNode | null = null;
  private highPass: BiquadFilterNode;
  private analyser: AnalyserNode;

  constructor(config: AudioPreprocessConfig) {
    this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    this.highPass = this.audioContext.createBiquadFilter();
    this.highPass.type = 'highpass';
    this.highPass.frequency.value = config.highPassFrequency;

    this.analyser = this.audioContext.createAnalyser();
    this.analyser.fftSize = 2048;
  }

  async startCapture(): Promise<void> {
    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: false,
          sampleRate: 16000
        }
      });

      const source = this.audioContext.createMediaStreamSource(this.mediaStream);
      source.connect(this.highPass);
      this.highPass.connect(this.analyser);
    } catch (error) {
      console.error('Failed to access microphone:', error);
      throw new Error('Microphone access denied');
    }
  }

  stopCapture(): void {
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(track => track.stop());
      this.mediaStream = null;
    }
  }

  async getAudioBlob(): Promise<Blob> {
    // Implementation captures audio and returns WAV blob
    // Uses recorder.js or similar library
    return new Blob([], { type: 'audio/wav' });
  }

  getNoiseLevel(): number {
    const dataArray = new Uint8Array(this.analyser.frequencyBinCount);
    this.analyser.getByteFrequencyData(dataArray);
    const average = dataArray.reduce((a, b) => a + b) / dataArray.length;
    return average;
  }
}
```

### 3.2 Whisper Integration

```typescript
// src/agents/echo/whisperSTT.ts

export interface WhisperResponse {
  text: string;
  language: string;
  duration: number;
}

export class WhisperSTT {
  private apiEndpoint = '/api/anthropic/v1/audio/transcriptions';

  async transcribe(
    audioBlob: Blob,
    language?: string
  ): Promise<WhisperResponse> {
    const formData = new FormData();
    formData.append('file', audioBlob, 'audio.wav');
    formData.append('model', 'whisper-1');
    if (language) {
      formData.append('language', language);
    }
    formData.append('temperature', '0.2');

    const response = await fetch(this.apiEndpoint, {
      method: 'POST',
      headers: {
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: formData
    });

    if (!response.ok) {
      throw new Error(`Whisper API error: ${response.statusText}`);
    }

    return response.json();
  }
}
```

### 3.3 ElevenLabs Text-to-Speech

```typescript
// src/agents/echo/elevenLabsTTS.ts

export interface ElevenLabsVoice {
  voice_id: string;
  name: string;
  category: 'premade' | 'cloned';
  settings: {
    stability: number; // 0-1
    similarity_boost: number; // 0-1
  };
}

export interface TTSConfig {
  voice_id: string;
  model_id: string; // 'eleven_monolingual_v1' or 'eleven_multilingual_v2'
  speed: number; // 0.5-2.0
  language: string;
}

export class ElevenLabsTTS {
  private apiKey: string;
  private apiEndpoint = 'https://api.elevenlabs.io/v1/text-to-speech';

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async synthesize(text: string, config: TTSConfig): Promise<Blob> {
    const url = `${this.apiEndpoint}/${config.voice_id}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'xi-api-key': this.apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        text,
        model_id: config.model_id,
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75
        }
      })
    });

    if (!response.ok) {
      throw new Error(`ElevenLabs API error: ${response.statusText}`);
    }

    return response.blob();
  }

  async getAvailableVoices(): Promise<ElevenLabsVoice[]> {
    const response = await fetch('https://api.elevenlabs.io/v1/voices', {
      headers: {
        'xi-api-key': this.apiKey
      }
    });

    if (!response.ok) {
      throw new Error('Failed to fetch voices');
    }

    const data = await response.json();
    return data.voices;
  }
}
```

### 3.4 Voice Session Orchestrator

```typescript
// src/agents/echo/voiceProcessor.ts

export interface VoiceSessionRecord {
  id: string;
  org_id: string;
  user_id: string;
  started_at: string;
  ended_at: string | null;
  duration_seconds: number;
  transcript: string;
  agent_responses: Array<{
    agent_name: string;
    response_text: string;
    timestamp: string;
  }>;
  status: 'active' | 'completed' | 'error';
}

export class VoiceProcessor {
  private audioCapture: AudioCapture;
  private whisper: WhisperSTT;
  private elevenLabs: ElevenLabsTTS;
  private supabaseClient: SupabaseClient;
  private currentSession: VoiceSessionRecord | null = null;
  private recordingStartTime: number = 0;

  constructor(supabaseClient: SupabaseClient, elevenLabsApiKey: string) {
    this.audioCapture = new AudioCapture({
      highPassFrequency: 80,
      noiseGateThreshold: -40,
      targetSampleRate: 16000,
      maxDuration: 300000 // 5 minutes
    });
    this.whisper = new WhisperSTT();
    this.elevenLabs = new ElevenLabsTTS(elevenLabsApiKey);
    this.supabaseClient = supabaseClient;
  }

  async startSession(userId: string, orgId: string): Promise<VoiceSessionRecord> {
    await this.audioCapture.startCapture();
    this.recordingStartTime = Date.now();

    this.currentSession = {
      id: crypto.randomUUID(),
      org_id: orgId,
      user_id: userId,
      started_at: new Date().toISOString(),
      ended_at: null,
      duration_seconds: 0,
      transcript: '',
      agent_responses: [],
      status: 'active'
    };

    return this.currentSession;
  }

  async processVoiceCommand(
    audioBlob: Blob,
    preferences: VoicePreferences
  ): Promise<string> {
    if (!this.currentSession) {
      throw new Error('No active voice session');
    }

    try {
      // 1. Transcribe audio
      const whisperResponse = await this.whisper.transcribe(
        audioBlob,
        preferences.stt_language
      );

      this.currentSession.transcript += ' ' + whisperResponse.text;

      // 2. Route through NEXUS classifier
      const classifierResponse = await fetch('/api/nexus/classify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'anthropic-dangerous-direct-browser-access': 'true'
        },
        body: JSON.stringify({
          text: whisperResponse.text,
          org_id: this.currentSession.org_id,
          user_id: this.currentSession.user_id,
          context: 'voice_command'
        })
      });

      const classification = await classifierResponse.json();

      // 3. Route to target agent
      const agentResponse = await this.routeToAgent(classification);

      // 4. Convert response to speech
      const audioBlob = await this.elevenLabs.synthesize(
        agentResponse.response_text,
        {
          voice_id: preferences.tts_voice,
          model_id: 'eleven_multilingual_v2',
          speed: preferences.tts_speed,
          language: preferences.stt_language
        }
      );

      // 5. Log in session history
      this.currentSession.agent_responses.push({
        agent_name: classification.agent_name,
        response_text: agentResponse.response_text,
        timestamp: new Date().toISOString()
      });

      // 6. Play audio response
      await this.playAudio(audioBlob);

      return agentResponse.response_text;
    } catch (error) {
      console.error('Voice command processing error:', error);
      this.currentSession.status = 'error';
      throw error;
    }
  }

  async endSession(): Promise<VoiceSessionRecord> {
    this.audioCapture.stopCapture();

    if (!this.currentSession) {
      throw new Error('No active session to end');
    }

    this.currentSession.ended_at = new Date().toISOString();
    this.currentSession.duration_seconds =
      Math.floor((Date.now() - this.recordingStartTime) / 1000);
    this.currentSession.status = 'completed';

    // Save session to database
    const { error } = await this.supabaseClient
      .from('voice_sessions')
      .insert([this.currentSession]);

    if (error) {
      console.error('Failed to save voice session:', error);
    }

    return this.currentSession;
  }

  private async routeToAgent(classification: any): Promise<{ response_text: string }> {
    // Routes to appropriate agent based on classification
    // Returns agent response
    return { response_text: 'Agent response here' };
  }

  private async playAudio(audioBlob: Blob): Promise<void> {
    const url = URL.createObjectURL(audioBlob);
    const audio = new Audio(url);
    return new Promise((resolve) => {
      audio.onended = () => resolve();
      audio.play().catch(err => console.error('Audio playback error:', err));
    });
  }
}
```

---

## 4. Database Migrations

### 4.1 Voice Sessions Table

```sql
-- migrations/20250327000001_create_voice_sessions.sql

CREATE TABLE IF NOT EXISTS voice_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  started_at timestamp with time zone NOT NULL DEFAULT now(),
  ended_at timestamp with time zone,
  duration_seconds integer,
  transcript text,
  agent_responses jsonb DEFAULT '[]'::jsonb,
  status varchar(20) DEFAULT 'active',
  created_at timestamp with time zone DEFAULT now()
);

CREATE INDEX idx_voice_sessions_org_id ON voice_sessions(org_id);
CREATE INDEX idx_voice_sessions_user_id ON voice_sessions(user_id);
CREATE INDEX idx_voice_sessions_created_at ON voice_sessions(created_at);

ALTER TABLE voice_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own voice sessions"
  ON voice_sessions FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create own voice sessions"
  ON voice_sessions FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Organization admins can view all org sessions"
  ON voice_sessions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM org_members om
      WHERE om.org_id = voice_sessions.org_id
      AND om.user_id = auth.uid()
      AND om.role IN ('admin', 'manager')
    )
  );
```

### 4.2 Voice Memos Table

```sql
-- migrations/20250327000002_create_voice_memos.sql

CREATE TABLE IF NOT EXISTS voice_memos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id uuid REFERENCES projects(id) ON DELETE SET NULL,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  audio_url text NOT NULL,
  transcript text,
  duration_seconds numeric,
  memo_type varchar(50) DEFAULT 'general', -- 'general', 'defect', 'observation', 'action_item'
  tags text[] DEFAULT '{}',
  created_at timestamp with time zone DEFAULT now()
);

CREATE INDEX idx_voice_memos_org_id ON voice_memos(org_id);
CREATE INDEX idx_voice_memos_project_id ON voice_memos(project_id);
CREATE INDEX idx_voice_memos_user_id ON voice_memos(user_id);
CREATE INDEX idx_voice_memos_created_at ON voice_memos(created_at);

ALTER TABLE voice_memos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view project voice memos"
  ON voice_memos FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM projects p
      WHERE p.id = voice_memos.project_id
      AND p.org_id = (SELECT org_id FROM auth.users WHERE id = auth.uid())
    )
    OR user_id = auth.uid()
  );

CREATE POLICY "Users can create voice memos"
  ON voice_memos FOR INSERT
  WITH CHECK (auth.uid() = user_id);
```

### 4.3 Voice Preferences Table

```sql
-- migrations/20250327000003_create_voice_preferences.sql

CREATE TABLE IF NOT EXISTS voice_preferences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  tts_voice varchar(100) DEFAULT 'Rachel', -- ElevenLabs voice name
  tts_speed numeric DEFAULT 1.0 CHECK (tts_speed >= 0.5 AND tts_speed <= 2.0),
  stt_language varchar(10) DEFAULT 'en', -- ISO 639-1 language code
  wake_word_enabled boolean DEFAULT false,
  wake_word varchar(50) DEFAULT 'Hey NEXUS',
  noise_suppression boolean DEFAULT true,
  auto_play_response boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

ALTER TABLE voice_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own preferences"
  ON voice_preferences FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can update own preferences"
  ON voice_preferences FOR UPDATE
  USING (auth.uid() = user_id);
```

---

## 5. Frontend Components & UI

### 5.1 Voice Button Component

```typescript
// src/components/echo/VoiceButton.tsx

import React, { useState, useRef, useCallback } from 'react';
import { useVoiceSession } from '@/hooks/useVoiceSession';
import { Microphone, Square, Loader } from 'lucide-react';

interface VoiceButtonProps {
  onTranscript?: (text: string) => void;
  disabled?: boolean;
}

export const VoiceButton: React.FC<VoiceButtonProps> = ({ onTranscript, disabled = false }) => {
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [noise, setNoise] = useState(0);
  const recordingRef = useRef<number | null>(null);
  const { processVoiceCommand } = useVoiceSession();

  const handleMouseDown = useCallback(async () => {
    setIsRecording(true);
    setIsProcessing(false);
    // Start recording logic
  }, []);

  const handleMouseUp = useCallback(async () => {
    setIsRecording(false);
    setIsProcessing(true);
    // Get audio blob and process
    try {
      const audioBlob = new Blob([], { type: 'audio/wav' });
      const transcript = await processVoiceCommand(audioBlob);
      onTranscript?.(transcript);
    } finally {
      setIsProcessing(false);
    }
  }, [processVoiceCommand, onTranscript]);

  return (
    <div className="flex flex-col items-center gap-4">
      <button
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onTouchStart={handleMouseDown}
        onTouchEnd={handleMouseUp}
        disabled={disabled || isProcessing}
        className={`relative inline-flex items-center justify-center w-16 h-16 rounded-full transition-all ${
          isRecording
            ? 'bg-red-500 shadow-lg scale-110'
            : isProcessing
            ? 'bg-yellow-500 shadow-lg'
            : 'bg-emerald-600 hover:bg-emerald-700 shadow-md'
        } disabled:opacity-50 disabled:cursor-not-allowed`}
      >
        {isProcessing ? (
          <Loader className="w-8 h-8 text-white animate-spin" />
        ) : isRecording ? (
          <Square className="w-8 h-8 text-white animate-pulse" />
        ) : (
          <Microphone className="w-8 h-8 text-white" />
        )}
      </button>

      {isRecording && (
        <div className="flex gap-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="w-1 h-8 bg-emerald-600 rounded-full animate-pulse"
              style={{ animationDelay: `${i * 0.1}s` }}
            />
          ))}
        </div>
      )}

      {noise > 0 && isRecording && (
        <p className="text-sm text-gray-400">Noise level: {Math.round(noise)}%</p>
      )}
    </div>
  );
};
```

### 5.2 Voice Memo List Component

```typescript
// src/components/echo/VoiceMemoList.tsx

import React, { useEffect, useState } from 'react';
import { Play, Pause, Trash2, Tag } from 'lucide-react';
import { supabase } from '@/lib/supabase';

interface VoiceMemo {
  id: string;
  transcript: string;
  audio_url: string;
  duration_seconds: number;
  memo_type: string;
  tags: string[];
  created_at: string;
}

export const VoiceMemoList: React.FC<{ projectId?: string }> = ({ projectId }) => {
  const [memos, setMemos] = useState<VoiceMemo[]>([]);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadMemos();
  }, [projectId]);

  const loadMemos = async () => {
    try {
      let query = supabase.from('voice_memos').select('*');
      if (projectId) {
        query = query.eq('project_id', projectId);
      }
      const { data, error } = await query.order('created_at', { ascending: false });
      if (error) throw error;
      setMemos(data || []);
    } finally {
      setLoading(false);
    }
  };

  const handlePlay = (audioUrl: string, id: string) => {
    if (playingId === id) {
      setPlayingId(null);
    } else {
      const audio = new Audio(audioUrl);
      audio.onended = () => setPlayingId(null);
      audio.play();
      setPlayingId(id);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this voice memo?')) return;
    const { error } = await supabase.from('voice_memos').delete().eq('id', id);
    if (!error) {
      setMemos(memos.filter(m => m.id !== id));
    }
  };

  if (loading) {
    return <div className="text-gray-400">Loading memos...</div>;
  }

  return (
    <div className="space-y-4">
      {memos.length === 0 ? (
        <p className="text-gray-500">No voice memos yet</p>
      ) : (
        memos.map(memo => (
          <div
            key={memo.id}
            className="bg-gray-800 rounded-lg p-4 space-y-3 border border-gray-700"
          >
            <div className="flex items-center justify-between">
              <div className="flex-1">
                <button
                  onClick={() => handlePlay(memo.audio_url, memo.id)}
                  className="flex items-center gap-2 text-emerald-400 hover:text-emerald-300 transition"
                >
                  {playingId === memo.id ? (
                    <Pause className="w-5 h-5" />
                  ) : (
                    <Play className="w-5 h-5" />
                  )}
                  <span className="text-sm font-medium">
                    {Math.round(memo.duration_seconds)}s
                  </span>
                </button>
              </div>
              <button
                onClick={() => handleDelete(memo.id)}
                className="text-gray-400 hover:text-red-400 transition"
              >
                <Trash2 className="w-5 h-5" />
              </button>
            </div>
            {memo.tags && memo.tags.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {memo.tags.map(tag => (
                  <span
                    key={tag}
                    className="inline-flex items-center gap-1 px-2 py-1 bg-gray-700 text-gray-300 rounded text-xs"
                  >
                    <Tag className="w-3 h-3" />
                    {tag}
                  </span>
                ))}
              </div>
            )}
            {memo.transcript && (
              <p className="text-sm text-gray-300 italic">{memo.transcript}</p>
            )}
            <p className="text-xs text-gray-500">
              {new Date(memo.created_at).toLocaleString()}
            </p>
          </div>
        ))
      )}
    </div>
  );
};
```

### 5.3 Voice Settings Component

```typescript
// src/components/echo/VoiceSettings.tsx

import React, { useEffect, useState } from 'react';
import { Settings, Volume2, Zap } from 'lucide-react';
import { supabase } from '@/lib/supabase';

interface VoicePreferences {
  id: string;
  tts_voice: string;
  tts_speed: number;
  stt_language: string;
  wake_word_enabled: boolean;
  wake_word: string;
  noise_suppression: boolean;
}

const AVAILABLE_VOICES = [
  'Rachel', 'Clyde', 'Domi', 'Bella', 'Antoni', 'Elli', 'Josh', 'Arnold',
  'Adam', 'Sam', 'Matilda', 'Ivy', 'Roger', 'Grace', 'Liam', 'Natasha'
];

const LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Spanish' },
  { code: 'fr', label: 'French' },
  { code: 'de', label: 'German' },
  { code: 'it', label: 'Italian' }
];

export const VoiceSettings: React.FC = () => {
  const [preferences, setPreferences] = useState<VoicePreferences | null>(null);
  const [testingVoice, setTestingVoice] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadPreferences();
  }, []);

  const loadPreferences = async () => {
    const { data, error } = await supabase
      .from('voice_preferences')
      .select('*')
      .single();
    if (!error && data) {
      setPreferences(data);
    }
  };

  const updatePreference = async (key: keyof VoicePreferences, value: any) => {
    if (!preferences) return;
    setSaving(true);
    try {
      const updated = { ...preferences, [key]: value };
      const { error } = await supabase
        .from('voice_preferences')
        .update({ [key]: value })
        .eq('id', preferences.id);
      if (!error) {
        setPreferences(updated);
      }
    } finally {
      setSaving(false);
    }
  };

  const testVoice = async () => {
    if (!preferences) return;
    setTestingVoice(true);
    try {
      const response = await fetch('/api/echo/test-voice', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'anthropic-dangerous-direct-browser-access': 'true'
        },
        body: JSON.stringify({
          voice_id: preferences.tts_voice,
          speed: preferences.tts_speed,
          text: 'This is a test of the voice synthesis system.'
        })
      });
      const audioBlob = await response.blob();
      const audio = new Audio(URL.createObjectURL(audioBlob));
      await audio.play();
    } finally {
      setTestingVoice(false);
    }
  };

  if (!preferences) {
    return <div className="text-gray-400">Loading settings...</div>;
  }

  return (
    <div className="space-y-6 bg-gray-800 rounded-lg p-6 border border-gray-700">
      <div className="flex items-center gap-2 mb-6">
        <Settings className="w-6 h-6 text-emerald-400" />
        <h2 className="text-lg font-semibold text-white">Voice Settings</h2>
      </div>

      {/* Voice Selection */}
      <div>
        <label className="flex items-center gap-2 text-sm font-medium text-gray-300 mb-2">
          <Volume2 className="w-4 h-4" />
          Voice
        </label>
        <select
          value={preferences.tts_voice}
          onChange={(e) => updatePreference('tts_voice', e.target.value)}
          className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded text-white"
        >
          {AVAILABLE_VOICES.map(voice => (
            <option key={voice} value={voice}>{voice}</option>
          ))}
        </select>
        <button
          onClick={testVoice}
          disabled={testingVoice || saving}
          className="mt-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-sm disabled:opacity-50"
        >
          {testingVoice ? 'Testing...' : 'Test Voice'}
        </button>
      </div>

      {/* Speed Control */}
      <div>
        <label className="text-sm font-medium text-gray-300 mb-2 block">
          Speech Speed: {preferences.tts_speed.toFixed(1)}x
        </label>
        <input
          type="range"
          min="0.5"
          max="2.0"
          step="0.1"
          value={preferences.tts_speed}
          onChange={(e) => updatePreference('tts_speed', parseFloat(e.target.value))}
          className="w-full"
        />
      </div>

      {/* Language Selection */}
      <div>
        <label className="text-sm font-medium text-gray-300 mb-2 block">
          Language
        </label>
        <select
          value={preferences.stt_language}
          onChange={(e) => updatePreference('stt_language', e.target.value)}
          className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded text-white"
        >
          {LANGUAGES.map(lang => (
            <option key={lang.code} value={lang.code}>{lang.label}</option>
          ))}
        </select>
      </div>

      {/* Wake Word Settings */}
      <div className="space-y-3">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={preferences.wake_word_enabled}
            onChange={(e) => updatePreference('wake_word_enabled', e.target.checked)}
            className="w-4 h-4 rounded"
          />
          <span className="text-sm font-medium text-gray-300">Enable Wake Word</span>
        </label>
        {preferences.wake_word_enabled && (
          <input
            type="text"
            value={preferences.wake_word}
            onChange={(e) => updatePreference('wake_word', e.target.value)}
            placeholder="e.g., Hey NEXUS"
            className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded text-white text-sm"
          />
        )}
      </div>

      {/* Noise Suppression */}
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={preferences.noise_suppression}
          onChange={(e) => updatePreference('noise_suppression', e.target.checked)}
          className="w-4 h-4 rounded"
        />
        <span className="text-sm font-medium text-gray-300">Noise Suppression</span>
      </label>

      {saving && <p className="text-sm text-emerald-400">Saving...</p>}
    </div>
  );
};
```

---

## 6. Integration Points with NEXUS Classifier

### 6.1 Voice Command Routing

When ECHO transcribes a voice command, it sends the text to NEXUS, which performs intent classification and routes to the appropriate agent:

```typescript
// src/agents/nexus/voiceRouter.ts

export async function routeVoiceCommand(
  text: string,
  orgId: string,
  userId: string
): Promise<{ agent_name: string; target_handler: string; confidence: number }> {
  const response = await fetch('/api/nexus/classify', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify({
      text,
      org_id: orgId,
      user_id: userId,
      context: 'voice_command',
      available_agents: [
        'SCOUT', 'VAULT', 'PULSE', 'LEDGER', 'BLUEPRINT',
        'OHM', 'CHRONO', 'SPARK', 'CONDUCTOR', 'ORACLE'
      ]
    })
  });

  return response.json();
}
```

### 6.2 Agent Response Adaptation for Voice

Each agent can return a `voice_summary` field in addition to standard response data:

```typescript
// Example PULSE dashboard response adapted for voice

{
  "agent": "PULSE",
  "standard_response": { /* full dashboard data */ },
  "voice_summary": "The Palm Desert hospital job is 65 percent complete. Current phase is rough-in electrical. Two inspections passed, one permit holds signature from city. Three crew members on site."
}
```

---

## 7. API Endpoints & Voice Session Management

### 7.1 Voice Endpoints

```typescript
// src/api/echo/index.ts

// POST /api/echo/transcribe — Submit audio for transcription
export async function handleTranscribe(req: Request): Promise<Response> {
  const formData = await req.formData();
  const audioBlob = formData.get('audio') as Blob;
  const language = (formData.get('language') as string) || 'en';

  // Calls Whisper API
  // Returns { text: string, language: string, duration: number }
}

// POST /api/echo/synthesize — Convert text to speech
export async function handleSynthesize(req: Request): Promise<Response> {
  const { text, voice_id, speed, language } = await req.json();

  // Calls ElevenLabs API
  // Returns audio/mp3 blob
}

// POST /api/echo/voice-command — Full voice command processing
export async function handleVoiceCommand(req: Request): Promise<Response> {
  const { audio_blob, user_id, org_id, preferences } = await req.json();

  // 1. Transcribe with Whisper
  // 2. Route through NEXUS
  // 3. Process with target agent
  // 4. Convert response to speech
  // 5. Return audio and transcript
}

// GET /api/echo/sessions/{sessionId} — Retrieve voice session
export async function handleGetSession(req: Request): Promise<Response> {
  // Returns VoiceSessionRecord with full transcript and agent responses
}

// GET /api/echo/memos — List voice memos
export async function handleListMemos(req: Request): Promise<Response> {
  // Filters by project_id if provided
  // Returns paginated VoiceMemo[]
}

// POST /api/echo/memos — Create new voice memo
export async function handleCreateMemo(req: Request): Promise<Response> {
  const { audio_url, transcript, project_id, memo_type, tags } = await req.json();

  // Stores memo and returns VoiceMemo
}
```

---

## 8. Testing Strategy & Validation

### 8.1 Unit Tests

- **AudioCapture**: Mock getUserMedia, test filter frequency responses
- **WhisperSTT**: Mock API responses, test error handling
- **ElevenLabsTTS**: Test voice synthesis with different parameters
- **VoiceProcessor**: End-to-end mock of transcription → routing → synthesis

### 8.2 Integration Tests

- **Voice Session Lifecycle**: Create session → record → process → end session
- **Database Persistence**: Verify voice_sessions and voice_memos stored correctly with RLS
- **Agent Routing**: Voice command routes to correct agent via NEXUS classifier

### 8.3 Field Testing

- Job site audio quality validation with real construction equipment noise
- Whisper accuracy on field terminology (conduit, breaker, etc.)
- ElevenLabs response latency (target: <3 seconds)

---

## 9. File Tree After Phase 09

```
src/
├── agents/echo/
│   ├── audioCapture.ts
│   ├── whisperSTT.ts
│   ├── elevenLabsTTS.ts
│   ├── voiceProcessor.ts
│   ├── memoManager.ts
│   ├── sessionManager.ts
│   └── index.ts
├── components/echo/
│   ├── VoiceButton.tsx
│   ├── VoiceMemoList.tsx
│   ├── VoiceSettings.tsx
│   ├── VoiceIndicator.tsx
│   └── index.ts
├── hooks/
│   ├── useVoiceSession.ts
│   ├── useVoicePreferences.ts
│   └── useAudioCapture.ts
├── api/echo/
│   ├── transcribe.ts
│   ├── synthesize.ts
│   ├── voice-command.ts
│   ├── sessions.ts
│   ├── memos.ts
│   └── index.ts
└── types/echo.ts

migrations/
├── 20250327000001_create_voice_sessions.sql
├── 20250327000002_create_voice_memos.sql
└── 20250327000003_create_voice_preferences.sql
```

---

## 10. What Phase 10 Expects from Phase 09

Phase 10 will assume:

1. **ECHO voice layer is production-ready** with Whisper and ElevenLabs integration working reliably
2. **Voice sessions are logged and auditable** with full transcripts stored in Supabase
3. **Voice memos can be attached to projects** and retrieved via project_id filter
4. **User voice preferences are persisted** and applied consistently across TTS/STT calls
5. **NEXUS classifier accepts voice context** and routes voice commands appropriately
6. **Audio preprocessing handles job site noise** with configurable filtering
7. **API endpoints are secured** with RLS and org_id validation
8. **Wake-word detection framework is in place** (ElevenLabs Wake Word detection or similar service)

Phase 10 will extend ECHO's reach to mobile (iOS/Android via Capacitor) and desktop (Windows via Tauri) platforms, making voice commands available across all deployment targets.

---

**Phase 09 Complete — ECHO Voice Layer Ready for Cross-Platform Deployment**
