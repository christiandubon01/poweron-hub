-- 033_calendar_sync.sql
-- CHRONO Phase D Part 2: Google Calendar two-way sync
-- Adds google_event_id column to calendar_events so we can track which
-- internal jobs have been pushed to Google Calendar.

-- ── Add google_event_id to calendar_events ──────────────────────────────────
ALTER TABLE calendar_events
  ADD COLUMN IF NOT EXISTS google_event_id TEXT DEFAULT NULL;

-- Index for fast lookup of unsynced events (WHERE google_event_id IS NULL)
CREATE INDEX IF NOT EXISTS idx_calendar_events_gcal_id
  ON calendar_events (org_id, google_event_id)
  WHERE google_event_id IS NULL;

-- Index for fast lookup by google_event_id (for conflict checking)
CREATE INDEX IF NOT EXISTS idx_calendar_events_gcal_id_notnull
  ON calendar_events (google_event_id)
  WHERE google_event_id IS NOT NULL;

-- ── Comment ──────────────────────────────────────────────────────────────────
COMMENT ON COLUMN calendar_events.google_event_id IS
  'Google Calendar event ID after sync via CHRONO calendarSyncService. NULL = not yet synced.';

-- Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';
