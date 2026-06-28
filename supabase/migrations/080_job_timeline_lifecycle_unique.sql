-- ============================================================
-- Migration 080: job_timeline lifecycle unique constraint
--
-- Prevents duplicate lifecycle events per portal request.
-- Enables atomic upsert in portalService.ts via
-- INSERT ... ON CONFLICT (portal_request_id, event_type) DO UPDATE.
--
-- Safe to apply to a database that already has duplicate rows:
-- the DELETE step removes all but the earliest row per pair
-- before the constraint is added.
-- ============================================================

-- Step 1: Remove duplicate rows — keep the earliest (lowest id) per pair.
DELETE FROM job_timeline j1
USING job_timeline j2
WHERE j1.portal_request_id = j2.portal_request_id
  AND j1.event_type        = j2.event_type
  AND j1.id > j2.id;

-- Step 2: Add the unique constraint (idempotent via DROP IF EXISTS first).
ALTER TABLE job_timeline
  DROP CONSTRAINT IF EXISTS job_timeline_request_event_unique;

ALTER TABLE job_timeline
  ADD CONSTRAINT job_timeline_request_event_unique
  UNIQUE (portal_request_id, event_type);
