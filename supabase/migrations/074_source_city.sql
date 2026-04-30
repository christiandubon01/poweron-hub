-- Schema 074: add source_city and portal_url to hunter_leads
-- Required by city-scraper to distinguish city portal leads from TLMA leads
-- Dedup key is (permit_number, source_city) not just permit_number
-- HUNTER-CITY-SCRAPER-APR30-2026-1

ALTER TABLE hunter_leads ADD COLUMN IF NOT EXISTS source_city text;
ALTER TABLE hunter_leads ADD COLUMN IF NOT EXISTS portal_url text;
ALTER TABLE hunter_leads ADD COLUMN IF NOT EXISTS run_source text;

-- Backfill existing TLMA leads
UPDATE hunter_leads SET source_city = 'TLMA' WHERE source_city IS NULL;
UPDATE hunter_leads SET run_source = 'cron' WHERE run_source IS NULL;

-- Index for efficient dedup lookups
CREATE INDEX IF NOT EXISTS idx_hunter_leads_permit_city
  ON hunter_leads (permit_number, source_city);
