# tlma-scraper — Supabase Edge Function

## Purpose

Scrapes Riverside County TLMA (Transportation and Land Management Agency) public permit lookup at `https://publiclookup.rivco.org/` to find **General Contractors** who pulled **building permits** on projects large enough to need a C-10 electrical subcontractor.

Runs on a schedule, scores each permit 0–100 using a transparent rule engine, deduplicates against existing `hunter_leads` rows, and writes new rows or updates existing ones. All detected field changes are written as audit rows to `hunter_lead_revisions`.

**Operator:** Christian Dubon — C-10 Electrical Contractor, Coachella Valley, CA

---

## Files

| File | Purpose |
|------|---------|
| `index.ts` | Entry point, HTTP handler, search matrix loop, orchestration |
| `types.ts` | TypeScript interfaces: `TLMAPermit`, `ScoreResult`, `HunterLeadRow`, report types |
| `scoring.ts` | Pure-function scoring engine — no I/O, fully testable |
| `parser.ts` | HTML parsing with `deno_dom` — extracts structured `TLMAPermit` objects |
| `supabase-client.ts` | Service-role Supabase client, dedup/upsert logic, revision logging |
| `README.md` | This file |

---

## Schema Dependency

Requires migration `070_tlma_scraper_schema.sql` (already applied to production).

New columns on `hunter_leads`:
- `permit_number`, `permit_url`, `permit_type_code`, `permit_type_label`
- `work_class_code`, `permit_status`, `total_sqft`, `sqft_breakdown`
- `applied_date`, `issued_date`, `finalized_date`, `expired_date`
- `contact_company`, `contact_type_label`, `last_seen_at`, `revision_count`

New table `hunter_lead_revisions`:
- Per-field change audit log with `(tenant_id, lead_id, field_name, old_value, new_value, detected_at, source)`

---

## Deploy

```bash
supabase functions deploy tlma-scraper --no-verify-jwt
```

> `--no-verify-jwt` is required so the function can be invoked from a cron job without a user JWT.

---

## Required Secrets

Set these once per project:

```bash
supabase secrets set HUNTER_TENANT_ID=31a60821-2796-41fa-b48d-d7df59e48198
supabase secrets set HUNTER_USER_ID=6a5c2d43-cf37-45ff-9f22-d4d315683cf8
```

These are also needed (auto-populated by Supabase, but confirm they exist):

```bash
supabase secrets set SUPABASE_URL=https://edxxbtyugohtowvslbfo.supabase.co
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=<your-service-role-key>
```

---

## Invocation

### Dry Run (safe — no DB writes, returns JSON report)

```bash
curl "https://edxxbtyugohtowvslbfo.supabase.co/functions/v1/tlma-scraper?dry_run=true"
```

### Dry Run — 90-Day Backfill Preview

```bash
curl "https://edxxbtyugohtowvslbfo.supabase.co/functions/v1/tlma-scraper?dry_run=true&days_back=90"
```

> **Always run dry_run=true first** before the first live run to validate parsing and scoring output.

### Live Run (7-day default lookback)

```bash
curl "https://edxxbtyugohtowvslbfo.supabase.co/functions/v1/tlma-scraper"
```

### Live Run — 90-Day Backfill

```bash
curl "https://edxxbtyugohtowvslbfo.supabase.co/functions/v1/tlma-scraper?days_back=90"
```

---

## Query Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `dry_run` | `false` | If `true`, returns report JSON without writing to DB |
| `days_back` | `7` | How many days back to set `Criteria.AppliedDateStart` |

---

## Search Matrix

The function iterates a matrix of **8 permit types × 13 cities = 104 combos**.

**Permit types searched:**
- Commercial Buildings (BNR)
- Tenant Improvement (BTI)
- Manufactured Buildings Commercial (BMN)
- Residential Dwelling (BRS)
- Residential Addition, Rehab (BAR)
- Accessory Building (BAS)
- Pool, Spa, Fountains (BSP)
- Manufactured Home Residential (BMR)

**Cities (Coachella Valley):**
COACHELLA, INDIO, LA QUINTA, PALM DESERT, PALM SPRINGS, RANCHO MIRAGE, DESERT HOT SPRINGS, BERMUDA DUNES, MECCA, THERMAL, THOUSAND PALMS, WHITE WATER, CATHEDRAL CITY

---

## Scoring Rules Summary

**Base scores by permit type code:**

| Code | Type | Base Score |
|------|------|-----------|
| BNR | Commercial Buildings | 70 |
| BTI | Tenant Improvement | 65 |
| BMN | Mfg Buildings Commercial | 60 |
| BRS | Residential Dwelling | 55 |
| BAR | Residential Add/Rehab | 50 |
| BAS | Accessory Building | 50 |
| BSP | Pool/Spa/Fountains | 40 |
| BMR | Mfg Home Residential | 35 |

**Sqft bonuses:** >5000 sqft → +25 | 2000–5000 → +15 | 1000–1999 → +5

**Keyword bonuses (30+ rules):** Direct electrical signals (EV charger +18, solar +15, panel upgrade +20), lighting (commercial lighting +18), HOA/public (+12), project type (ADU +12, remodel +8).

**Penalties:** owner-builder (-25), DIY (-20), self-perform (-15)

**Contact modifiers:** GC company name (+15), Engineer contact (+5), Architecture firm (+10), Owner/no company (-10)

**Status modifiers:** Issued (+10), Plan Check (+5), Finalized (-50), Expired (-100)

**Score clamped 0–100, then 5 force-override rules applied:**
1. Commercial (BNR/BTI), Issued, ≥2000 sqft → floor 75
2. Direct electrical signal keyword → floor 60
3. Project >4000 sqft → floor 60
4. Finalized or Expired → ceiling 20
5. Owner contact with no company → ceiling 35

**Score tiers:** elite (≥85) | strong (≥75) | qualified (≥60) | expansion (≥30) | archived (<30)

**Hybrid filter:** Permits with final score < 30 are written with `status = 'archived'`.

---

## Rate Limiting & Politeness

- 200ms delay between each (permit type, city) combo
- Maximum 5 pages fetched per combo (at 100 rows/page = 500 permits max per combo)
- User-Agent: `Mozilla/5.0 (HUNTER scraper for Power On Solutions LLC)`

---

## Troubleshooting

### "No results table found" in logs

The TLMA site may have changed its HTML structure. Inspect `https://publiclookup.rivco.org/` and update the table selector in `parser.ts`. Current selectors tried in order: `table.results-table`, `table#results`, `table.table-results`, `table` (first found).

### Parsing errors for specific rows

Check console logs for `[parser] Warning: failed to parse row N`. The parser is defensive and skips malformed rows — it will not throw. Inspect the actual HTML from a TLMA search to verify column class names.

### Low permit counts / 0 results

- Verify `days_back` covers the expected date range
- Check that `Criteria.AppliedDateStart` format (`YYYY-MM-DD`) matches what TLMA expects
- Try fetching the URL manually: `https://publiclookup.rivco.org/?Criteria.City=INDIO&Criteria.PermitType=Residential+Dwelling+%28BRS%29&...`

### DB write errors

- Confirm migration 070 is applied: `SELECT column_name FROM information_schema.columns WHERE table_name = 'hunter_leads' AND column_name = 'permit_number';`
- Confirm `hunter_lead_revisions` table exists and RLS policy mirrors `hunter_leads`
- Confirm `SUPABASE_SERVICE_ROLE_KEY` is set correctly (service role bypasses RLS)

### Scoring seems off

All scoring is in `scoring.ts` — pure functions with no side effects. Add test inputs by calling `scorePermit(permit)` with a mock `TLMAPermit` object. The `transparency_notes` array in the returned `ScoreResult` explains every point added, subtracted, and any force-override applied.

### HUNTER_TENANT_ID / HUNTER_USER_ID not set

The function will return HTTP 500 immediately with: `{"error": "HUNTER_TENANT_ID and HUNTER_USER_ID must be set in env"}`. Set the secrets and redeploy.
