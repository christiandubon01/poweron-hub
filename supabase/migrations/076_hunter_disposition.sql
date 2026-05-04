-- Migration 076: Hunter Lead Disposition Tracking
-- Adds disposition fields to hunter_leads for archive routing

ALTER TABLE hunter_leads
  ADD COLUMN IF NOT EXISTS disposition TEXT,
  ADD COLUMN IF NOT EXISTS disposition_detail TEXT,
  ADD COLUMN IF NOT EXISTS disposition_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_hunter_leads_disposition ON hunter_leads(disposition);
