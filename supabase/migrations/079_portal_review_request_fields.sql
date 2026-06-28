-- ============================================================
-- Migration 079: Portal Review Request Tracking
-- Adds nullable, additive fields used after a live portal request is completed.
-- ============================================================

ALTER TABLE portal_requests
  ADD COLUMN IF NOT EXISTS completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS review_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS review_request_sent_to text,
  ADD COLUMN IF NOT EXISTS review_request_status text,
  ADD COLUMN IF NOT EXISTS review_request_error text,
  ADD COLUMN IF NOT EXISTS review_request_last_attempt_at timestamptz;

