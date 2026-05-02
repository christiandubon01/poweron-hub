-- ============================================================
-- Migration 075: Customer Portal Tables
-- PORTAL-PHASE1-MAY02-2026-1
-- ============================================================
-- Tables:
--   portal_requests      -- homeowner/GC service request submissions
--   job_timeline         -- milestone events visible to customer
--   technician_location  -- GPS pings written by tech, read by customer
--   portal_users         -- future customer accounts (stub, role='customer')
-- ============================================================

-- ── portal_requests ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS portal_requests (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at        timestamptz NOT NULL DEFAULT now(),

  -- Contact info (no account required Phase 1)
  name              text NOT NULL,
  phone             text,
  email             text,
  address           text,
  city              text,

  -- Request details
  request_type      text NOT NULL DEFAULT 'homeowner',
  -- 'homeowner' | 'gc' | 'sub'
  service_category  text,
  -- 'residential' | 'commercial' | 'solar' | 'maintenance' | 'other'
  description       text,
  preferred_date    date,
  preferred_time    text,

  -- Status lifecycle
  status            text NOT NULL DEFAULT 'new',
  -- 'new' | 'reviewed' | 'scheduled' | 'in_progress' | 'completed' | 'closed'

  -- Link to hunter_leads once converted
  hunter_lead_id    uuid REFERENCES hunter_leads(id) ON DELETE SET NULL,

  -- Source tag — always 'customer_portal' for HUNTER filter chip
  source            text NOT NULL DEFAULT 'customer_portal',

  -- Optional tenant scope (for future multi-tenant)
  tenant_id         uuid,

  -- Metadata
  notes             text,
  submitted_ip      text
);

-- ── job_timeline ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS job_timeline (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at        timestamptz NOT NULL DEFAULT now(),

  portal_request_id uuid NOT NULL REFERENCES portal_requests(id) ON DELETE CASCADE,

  -- Milestone data
  event_type        text NOT NULL,
  -- 'request_received' | 'estimate_sent' | 'scheduled' | 'on_my_way'
  -- | 'arrived' | 'work_started' | 'work_completed' | 'invoice_sent' | 'closed'
  title             text NOT NULL,
  description       text,
  event_time        timestamptz NOT NULL DEFAULT now(),

  -- Who triggered the event
  triggered_by      text DEFAULT 'system'
  -- 'system' | 'owner' | 'crew'
);

-- ── technician_location ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS technician_location (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  portal_request_id uuid NOT NULL REFERENCES portal_requests(id) ON DELETE CASCADE,

  -- GPS coords from navigator.geolocation.watchPosition()
  latitude          double precision NOT NULL,
  longitude         double precision NOT NULL,

  -- Only live when tech is en route
  is_active         boolean NOT NULL DEFAULT true,

  -- Who is moving
  technician_name   text
);

-- ── portal_users ─────────────────────────────────────────────
-- Phase 1 stub. Not used yet — placeholder for future customer accounts.
CREATE TABLE IF NOT EXISTS portal_users (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at        timestamptz NOT NULL DEFAULT now(),

  email             text UNIQUE,
  phone             text,
  name              text,
  role              text NOT NULL DEFAULT 'customer',

  -- Links to Supabase auth when accounts go live
  auth_user_id      uuid UNIQUE
);

-- ============================================================
-- Indexes
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_portal_requests_status
  ON portal_requests(status);

CREATE INDEX IF NOT EXISTS idx_portal_requests_hunter_lead
  ON portal_requests(hunter_lead_id);

CREATE INDEX IF NOT EXISTS idx_job_timeline_request
  ON job_timeline(portal_request_id, event_time DESC);

CREATE INDEX IF NOT EXISTS idx_technician_location_request
  ON technician_location(portal_request_id, updated_at DESC);

-- ============================================================
-- RLS Policies
-- ============================================================

-- portal_requests: anyone can INSERT (public form), only authenticated
-- users (owner) can SELECT/UPDATE/DELETE
ALTER TABLE portal_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "portal_requests_public_insert"
  ON portal_requests FOR INSERT
  TO anon
  WITH CHECK (true);

CREATE POLICY "portal_requests_auth_all"
  ON portal_requests FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- job_timeline: public can SELECT (customer tracks their job),
-- authenticated can INSERT/UPDATE/DELETE
ALTER TABLE job_timeline ENABLE ROW LEVEL SECURITY;

CREATE POLICY "job_timeline_public_read"
  ON job_timeline FOR SELECT
  TO anon
  USING (true);

CREATE POLICY "job_timeline_auth_write"
  ON job_timeline FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- technician_location: public can SELECT (customer sees GPS marker),
-- authenticated can INSERT/UPDATE/DELETE
ALTER TABLE technician_location ENABLE ROW LEVEL SECURITY;

CREATE POLICY "technician_location_public_read"
  ON technician_location FOR SELECT
  TO anon
  USING (true);

CREATE POLICY "technician_location_auth_write"
  ON technician_location FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- portal_users: authenticated only, full control
ALTER TABLE portal_users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "portal_users_auth_all"
  ON portal_users FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- ============================================================
-- Realtime: enable for GPS tracking channel
-- ============================================================
ALTER PUBLICATION supabase_realtime ADD TABLE technician_location;
ALTER PUBLICATION supabase_realtime ADD TABLE job_timeline;
