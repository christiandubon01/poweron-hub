-- ============================================================================
-- Migration 022: Billing & Subscriptions Tables
-- Phase 07 — Stripe subscription gating backend
-- ============================================================================
-- Creates:
--   billing_customers  — maps orgs to Stripe customer IDs
--   subscriptions       — tracks active/trialing/canceled subscriptions per org
--   subscription_events — audit log for subscription lifecycle events
-- ============================================================================

-- ── billing_customers ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS billing_customers (
  id                  UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id              UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  stripe_customer_id  TEXT NOT NULL,
  email               TEXT,
  name                TEXT,
  metadata            JSONB DEFAULT '{}',
  created_at          TIMESTAMPTZ DEFAULT now(),
  updated_at          TIMESTAMPTZ DEFAULT now(),

  CONSTRAINT uq_billing_customers_org UNIQUE (org_id),
  CONSTRAINT uq_billing_customers_stripe UNIQUE (stripe_customer_id)
);

-- Index for Stripe webhook lookups
CREATE INDEX IF NOT EXISTS idx_billing_customers_stripe_id
  ON billing_customers(stripe_customer_id);

-- RLS
ALTER TABLE billing_customers ENABLE ROW LEVEL SECURITY;

CREATE POLICY billing_customers_org_read ON billing_customers
  FOR SELECT USING (
    org_id IN (SELECT profiles.org_id FROM profiles WHERE profiles.id = auth.uid())
  );

CREATE POLICY billing_customers_org_insert ON billing_customers
  FOR INSERT WITH CHECK (
    org_id IN (SELECT profiles.org_id FROM profiles WHERE profiles.id = auth.uid())
  );

CREATE POLICY billing_customers_org_update ON billing_customers
  FOR UPDATE USING (
    org_id IN (SELECT profiles.org_id FROM profiles WHERE profiles.id = auth.uid())
  );


-- ── subscriptions ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS subscriptions (
  id                      UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id                  UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  stripe_subscription_id  TEXT,
  stripe_customer_id      TEXT,
  status                  TEXT NOT NULL DEFAULT 'none'
    CHECK (status IN ('active','trialing','past_due','canceled','incomplete','none')),
  tier_slug               TEXT NOT NULL DEFAULT 'solo'
    CHECK (tier_slug IN ('solo','team','enterprise')),
  billing_interval        TEXT DEFAULT 'monthly'
    CHECK (billing_interval IN ('monthly','annual')),
  current_period_start    TIMESTAMPTZ,
  current_period_end      TIMESTAMPTZ,
  cancel_at_period_end    BOOLEAN DEFAULT false,
  canceled_at             TIMESTAMPTZ,
  trial_start             TIMESTAMPTZ,
  trial_end               TIMESTAMPTZ,
  metadata                JSONB DEFAULT '{}',
  created_at              TIMESTAMPTZ DEFAULT now(),
  updated_at              TIMESTAMPTZ DEFAULT now()
);

-- Only one active/trialing subscription per org
CREATE UNIQUE INDEX IF NOT EXISTS idx_subscriptions_org_active
  ON subscriptions(org_id)
  WHERE status IN ('active', 'trialing');

-- Stripe webhook lookups
CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_sub_id
  ON subscriptions(stripe_subscription_id);

CREATE INDEX IF NOT EXISTS idx_subscriptions_status
  ON subscriptions(status);

-- RLS
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY subscriptions_org_read ON subscriptions
  FOR SELECT USING (
    org_id IN (SELECT profiles.org_id FROM profiles WHERE profiles.id = auth.uid())
  );

CREATE POLICY subscriptions_org_insert ON subscriptions
  FOR INSERT WITH CHECK (
    org_id IN (SELECT profiles.org_id FROM profiles WHERE profiles.id = auth.uid())
  );

CREATE POLICY subscriptions_org_update ON subscriptions
  FOR UPDATE USING (
    org_id IN (SELECT profiles.org_id FROM profiles WHERE profiles.id = auth.uid())
  );


-- ── subscription_events ───────────────────────────────────────────────────────
-- Audit log for tracking subscription lifecycle (created, upgraded, canceled, etc.)

CREATE TABLE IF NOT EXISTS subscription_events (
  id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id            UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  subscription_id   UUID REFERENCES subscriptions(id) ON DELETE SET NULL,
  event_type        TEXT NOT NULL
    CHECK (event_type IN (
      'created','activated','upgraded','downgraded',
      'canceled','reactivated','past_due','payment_failed',
      'trial_started','trial_ended'
    )),
  from_tier         TEXT,
  to_tier           TEXT,
  stripe_event_id   TEXT,
  metadata          JSONB DEFAULT '{}',
  created_at        TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_subscription_events_org
  ON subscription_events(org_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_subscription_events_stripe
  ON subscription_events(stripe_event_id);

-- RLS
ALTER TABLE subscription_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY subscription_events_org_read ON subscription_events
  FOR SELECT USING (
    org_id IN (SELECT profiles.org_id FROM profiles WHERE profiles.id = auth.uid())
  );

-- Only server-side / service role can insert events
CREATE POLICY subscription_events_service_insert ON subscription_events
  FOR INSERT WITH CHECK (true);


-- ── Updated_at trigger ────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_billing_customers_updated_at
  BEFORE UPDATE ON billing_customers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_subscriptions_updated_at
  BEFORE UPDATE ON subscriptions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
