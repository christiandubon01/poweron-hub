-- ============================================================================
-- Migration 021: Phase 06 — Voice Tables (ECHO Agent)
-- Creates voice_sessions, voice_memos, voice_preferences for the ECHO voice
-- subsystem. Supports wake-word detection, STT/TTS pipeline, and field mode.
-- ============================================================================

-- ── voice_sessions ──────────────────────────────────────────────────────────
-- Logs every voice interaction through the pipeline

CREATE TABLE IF NOT EXISTS voice_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  user_id UUID NOT NULL REFERENCES profiles(id),
  device_id VARCHAR(255),

  mode VARCHAR(20) NOT NULL DEFAULT 'normal',
  status VARCHAR(20) NOT NULL DEFAULT 'listening',

  started_at TIMESTAMPTZ DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  duration_seconds INTEGER,

  -- Audio input
  raw_audio_url VARCHAR(500),
  audio_duration_seconds DECIMAL(6,2),
  noise_level_db DECIMAL(5,2),

  -- Speech-to-text
  transcript_raw TEXT,
  transcript_confidence DECIMAL(3,2),
  language VARCHAR(10) DEFAULT 'en-US',

  -- Classification & routing
  detected_intent VARCHAR(255),
  target_agent VARCHAR(50),
  agent_response TEXT,

  -- Text-to-speech
  response_audio_url VARCHAR(500),
  response_voice_id VARCHAR(100),
  response_duration_seconds DECIMAL(6,2),

  -- Error tracking
  error_message TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT voice_session_mode_valid
    CHECK (mode IN ('normal', 'field', 'push_to_talk')),
  CONSTRAINT voice_session_status_valid
    CHECK (status IN ('listening', 'recording', 'transcribing', 'processing', 'responding', 'complete', 'error'))
);

CREATE INDEX IF NOT EXISTS idx_voice_sessions_org_id ON voice_sessions(org_id);
CREATE INDEX IF NOT EXISTS idx_voice_sessions_user_id ON voice_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_voice_sessions_created_at ON voice_sessions(created_at);
CREATE INDEX IF NOT EXISTS idx_voice_sessions_status ON voice_sessions(status);
CREATE INDEX IF NOT EXISTS idx_voice_sessions_target_agent ON voice_sessions(target_agent);

ALTER TABLE voice_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "voice_sessions_org_read"
  ON voice_sessions FOR SELECT
  USING (org_id IN (SELECT profiles.org_id FROM profiles WHERE profiles.id = auth.uid()));

CREATE POLICY "voice_sessions_org_insert"
  ON voice_sessions FOR INSERT
  WITH CHECK (org_id IN (SELECT profiles.org_id FROM profiles WHERE profiles.id = auth.uid()));


-- ── voice_memos ─────────────────────────────────────────────────────────────
-- Voice memos recorded by crew, linked to projects/field logs/leads

CREATE TABLE IF NOT EXISTS voice_memos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  user_id UUID NOT NULL REFERENCES profiles(id),

  title VARCHAR(255),
  transcript TEXT NOT NULL,
  transcript_confidence DECIMAL(3,2),

  audio_url VARCHAR(500),
  audio_duration_seconds DECIMAL(6,2),

  -- Polymorphic attachment to any entity
  related_entity_type VARCHAR(50),  -- 'project', 'field_log', 'lead', 'invoice', etc.
  related_entity_id UUID,

  is_public BOOLEAN DEFAULT FALSE,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_voice_memos_org_id ON voice_memos(org_id);
CREATE INDEX IF NOT EXISTS idx_voice_memos_user_id ON voice_memos(user_id);
CREATE INDEX IF NOT EXISTS idx_voice_memos_related_entity
  ON voice_memos(related_entity_type, related_entity_id);
CREATE INDEX IF NOT EXISTS idx_voice_memos_created_at ON voice_memos(created_at);

ALTER TABLE voice_memos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "voice_memos_org_read"
  ON voice_memos FOR SELECT
  USING (org_id IN (SELECT profiles.org_id FROM profiles WHERE profiles.id = auth.uid()));

CREATE POLICY "voice_memos_org_insert"
  ON voice_memos FOR INSERT
  WITH CHECK (org_id IN (SELECT profiles.org_id FROM profiles WHERE profiles.id = auth.uid()));

CREATE POLICY "voice_memos_org_update"
  ON voice_memos FOR UPDATE
  USING (org_id IN (SELECT profiles.org_id FROM profiles WHERE profiles.id = auth.uid()));


-- ── voice_preferences ───────────────────────────────────────────────────────
-- Per-user voice settings (voice selection, speed, language, wake word, etc.)

CREATE TABLE IF NOT EXISTS voice_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  user_id UUID NOT NULL REFERENCES profiles(id),

  enabled BOOLEAN DEFAULT TRUE,

  -- TTS preferences
  tts_voice_id VARCHAR(100) DEFAULT 'pNInz6obpgDQGcFmaJgB',  -- Adam voice
  tts_speed DECIMAL(2,1) DEFAULT 1.0,  -- 0.5 – 2.0
  tts_language VARCHAR(10) DEFAULT 'en-US',

  -- ASR preferences
  asr_language VARCHAR(10) DEFAULT 'en-US',
  noise_suppression_strength DECIMAL(2,1) DEFAULT 0.7,  -- 0 – 1

  -- Voice activation
  wake_word_enabled BOOLEAN DEFAULT TRUE,
  wake_word_phrase VARCHAR(100) DEFAULT 'Hey NEXUS',

  -- Field mode
  field_mode_enabled BOOLEAN DEFAULT TRUE,
  push_to_talk_enabled BOOLEAN DEFAULT FALSE,
  push_to_talk_key VARCHAR(20),  -- 'Space', 'Ctrl+Space', etc.

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT voice_prefs_unique_user UNIQUE(org_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_voice_preferences_org_id ON voice_preferences(org_id);
CREATE INDEX IF NOT EXISTS idx_voice_preferences_user_id ON voice_preferences(user_id);

ALTER TABLE voice_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "voice_preferences_own_read"
  ON voice_preferences FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "voice_preferences_own_insert"
  ON voice_preferences FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "voice_preferences_own_update"
  ON voice_preferences FOR UPDATE
  USING (user_id = auth.uid());


-- ── voice_response_cache ────────────────────────────────────────────────────
-- Cache common voice responses to reduce API latency

CREATE TABLE IF NOT EXISTS voice_response_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),

  -- Cache key: normalized intent + parameters hash
  cache_key VARCHAR(255) NOT NULL,
  target_agent VARCHAR(50) NOT NULL,
  intent VARCHAR(255) NOT NULL,

  -- Cached response
  response_text TEXT NOT NULL,
  response_audio_url VARCHAR(500),
  voice_id VARCHAR(100),

  -- Cache metadata
  hit_count INTEGER DEFAULT 0,
  last_hit_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL,

  created_at TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT voice_cache_unique_key UNIQUE(org_id, cache_key)
);

CREATE INDEX IF NOT EXISTS idx_voice_cache_org_key ON voice_response_cache(org_id, cache_key);
CREATE INDEX IF NOT EXISTS idx_voice_cache_expires ON voice_response_cache(expires_at);

ALTER TABLE voice_response_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "voice_cache_org_read"
  ON voice_response_cache FOR SELECT
  USING (org_id IN (SELECT profiles.org_id FROM profiles WHERE profiles.id = auth.uid()));

CREATE POLICY "voice_cache_org_insert"
  ON voice_response_cache FOR INSERT
  WITH CHECK (org_id IN (SELECT profiles.org_id FROM profiles WHERE profiles.id = auth.uid()));
