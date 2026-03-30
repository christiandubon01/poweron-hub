-- Migration 034: SPARK Full Automation — leads + email_campaigns tables
-- Phase E: Google Business, lead capture, email campaigns
-- Created: 2026-03-29

-- ─────────────────────────────────────────────────────────────────
-- LEADS TABLE
-- Captures inbound leads from Google, website, referrals, ads, manual entry
-- ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS leads (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  name              TEXT NOT NULL,
  phone             TEXT,
  email             TEXT,
  source            TEXT CHECK (source IN ('google','website','referral','manual','ad')) DEFAULT 'manual',
  service_requested TEXT,
  status            TEXT CHECK (status IN ('new','contacted','quoted','won','lost')) DEFAULT 'new',
  follow_up_date    DATE,
  notes             TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────────
-- EMAIL CAMPAIGNS TABLE
-- Stores campaign drafts, schedule, and delivery metrics
-- ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS email_campaigns (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  subject            TEXT NOT NULL,
  body               TEXT NOT NULL,
  recipient_segment  TEXT,
  status             TEXT CHECK (status IN ('draft','scheduled','sent','cancelled')) DEFAULT 'draft',
  scheduled_at       TIMESTAMPTZ,
  sent_at            TIMESTAMPTZ,
  open_count         INT DEFAULT 0,
  click_count        INT DEFAULT 0,
  created_at         TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────────
-- ROW LEVEL SECURITY
-- ─────────────────────────────────────────────────────────────────

ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_campaigns ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist to avoid conflicts on re-run
DO $$
BEGIN
  DROP POLICY IF EXISTS "Users own leads" ON leads;
  DROP POLICY IF EXISTS "Users own email_campaigns" ON email_campaigns;
END $$;

CREATE POLICY "Users own leads"
  ON leads FOR ALL
  USING (auth.uid() = user_id);

CREATE POLICY "Users own email_campaigns"
  ON email_campaigns FOR ALL
  USING (auth.uid() = user_id);

-- ─────────────────────────────────────────────────────────────────
-- INDEXES for performance
-- ─────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_leads_user_id     ON leads (user_id);
CREATE INDEX IF NOT EXISTS idx_leads_status      ON leads (status);
CREATE INDEX IF NOT EXISTS idx_leads_source      ON leads (source);
CREATE INDEX IF NOT EXISTS idx_leads_follow_up   ON leads (follow_up_date) WHERE follow_up_date IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_email_campaigns_user_id ON email_campaigns (user_id);
CREATE INDEX IF NOT EXISTS idx_email_campaigns_status  ON email_campaigns (status);
