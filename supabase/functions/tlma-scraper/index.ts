import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { parseSearchResultsHTML } from "./parser.ts";
import { scorePermit } from "./scoring.ts";
import { createServiceClient, upsertLead } from "./supabase-client.ts";
import type { TLMAPermit, HunterLeadRow, DryRunReport, LiveRunReport } from "./types.ts";

// ----- CONSTANTS -----
const PERMIT_TYPES = [
  "Commercial Buildings (BNR)",
  "Tenant Improvement (BTI)",
  "Manufactured Buildings Commercial (BMN)",
  "Residential Dwelling (BRS)",
  "Residential Addition, Rehab (BAR)",
  "Accessory Building (BAS)",
  "Pool, Spa, Fountains (BSP)",
  "Manufactured Home Residential (BMR)",
];

const CITIES = [
  "COACHELLA",
  "INDIO",
  "LA QUINTA",
  "PALM DESERT",
  "PALM SPRINGS",
  "RANCHO MIRAGE",
  "DESERT HOT SPRINGS",
  "BERMUDA DUNES",
  "MECCA",
  "THERMAL",
  "THOUSAND PALMS",
  "WHITE WATER",
  "CATHEDRAL CITY",
];

const TLMA_BASE_URL = "https://publiclookup.rivco.org/";

// ----- MAIN HANDLER -----
serve(async (req: Request) => {
  const url = new URL(req.url);
  const dryRun = url.searchParams.get("dry_run") === "true";
  const daysBack = parseInt(url.searchParams.get("days_back") || "0", 10);
  // Default lookback = 7 days. Use ?days_back=90 for first-run backfill.
  const lookback = daysBack > 0 ? daysBack : 7;

  const tenantId = Deno.env.get("HUNTER_TENANT_ID");
  const userId = Deno.env.get("HUNTER_USER_ID");
  if (!tenantId || !userId) {
    return jsonResponse(500, {
      error: "HUNTER_TENANT_ID and HUNTER_USER_ID must be set in env",
    });
  }

  const startDate = new Date();
  startDate.setDate(startDate.getDate() - lookback);
  const startDateStr = startDate.toISOString().slice(0, 10);

  const errors: string[] = [];
  const allPermits: TLMAPermit[] = [];

  // ----- SEARCH MATRIX LOOP -----
  for (const permitType of PERMIT_TYPES) {
    for (const city of CITIES) {
      try {
        const params = new URLSearchParams({
          Page: "1",
          PageSize: "100",
          SortBy: "AppliedDate",
          SortDesc: "true",
          "Criteria.PermitType": permitType,
          "Criteria.City": city,
          "Criteria.AppliedDateStart": startDateStr,
        });
        const fetchUrl = TLMA_BASE_URL + "?" + params.toString();
        const resp = await fetch(fetchUrl, {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (HUNTER scraper for Power On Solutions LLC)",
          },
        });
        if (!resp.ok) {
          errors.push(`HTTP ${resp.status} for ${city} / ${permitType}`);
          continue;
        }
        const html = await resp.text();
        const parsed = parseSearchResultsHTML(html);

        for (const p of parsed.permits) {
          allPermits.push(p);
        }

        // Paginate: up to 5 pages per (type, city) combo
        const maxPages = Math.min(parsed.total_pages, 5);
        for (let page = 2; page <= maxPages; page++) {
          params.set("Page", String(page));
          const pageUrl = TLMA_BASE_URL + "?" + params.toString();
          const pageResp = await fetch(pageUrl, {
            headers: {
              "User-Agent":
                "Mozilla/5.0 (HUNTER scraper for Power On Solutions LLC)",
            },
          });
          if (!pageResp.ok) {
            errors.push(
              `HTTP ${pageResp.status} on page ${page} for ${city} / ${permitType}`
            );
            break;
          }
          const pageHtml = await pageResp.text();
          const pageParsed = parseSearchResultsHTML(pageHtml);
          for (const p of pageParsed.permits) {
            allPermits.push(p);
          }
        }

        // Polite 200ms delay between (type, city) combos
        await new Promise((r) => setTimeout(r, 200));
      } catch (err) {
        errors.push(
          `Exception for ${city} / ${permitType}: ${(err as Error).message}`
        );
      }
    }
  }

  // ----- DEDUP within this run -----
  const uniquePermits = new Map<string, TLMAPermit>();
  for (const p of allPermits) {
    if (p.permit_number && !uniquePermits.has(p.permit_number)) {
      uniquePermits.set(p.permit_number, p);
    }
  }

  // ----- SCORE everything -----
  const scored = Array.from(uniquePermits.values()).map((p) => ({
    permit: p,
    score: scorePermit(p),
  }));

  // ===== DRY RUN BRANCH =====
  if (dryRun) {
    const distribution = {
      elite: 0,
      strong: 0,
      qualified: 0,
      expansion: 0,
      archived: 0,
    };
    for (const s of scored) {
      distribution[s.score.score_tier]++;
    }

    const sample = scored
      .sort((a, b) => b.score.final_score - a.score.final_score)
      .slice(0, 20)
      .map((s) => ({
        permit_number: s.permit.permit_number,
        score: s.score.final_score,
        tier: s.score.score_tier,
        description: s.permit.permit_description.slice(0, 120),
        city: s.permit.city,
        permit_type: s.permit.permit_type_label,
        status: s.permit.permit_status,
        total_sqft: s.permit.total_sqft,
        contact_name: s.permit.contact_name,
        contact_company: s.permit.contact_company,
        transparency_notes: s.score.transparency_notes,
      }));

    const report: DryRunReport = {
      timestamp: new Date().toISOString(),
      dry_run: true,
      search_matrix_size: PERMIT_TYPES.length * CITIES.length,
      total_permits_fetched: allPermits.length,
      permits_after_dedup: uniquePermits.size,
      permits_above_score_threshold: scored.filter(
        (s) => s.score.final_score >= 30
      ).length,
      permits_below_score_threshold_archived: scored.filter(
        (s) => s.score.final_score < 30
      ).length,
      score_distribution: distribution,
      sample_permits: sample,
      errors,
    };
    return jsonResponse(200, report);
  }

  // ===== LIVE BRANCH =====
  const supabase = createServiceClient();
  let inserts = 0,
    updates = 0,
    lastSeenTouched = 0,
    revisionsLogged = 0;

  for (const s of scored) {
    try {
      const row: HunterLeadRow = buildHunterLeadRow(
        s.permit,
        s.score,
        tenantId,
        userId
      );
      const result = await upsertLead(supabase, row);
      if (result.action === "insert") inserts++;
      else if (result.action === "update") updates++;
      else lastSeenTouched++;
      revisionsLogged += result.revisions_written;
    } catch (err) {
      errors.push(
        `upsert failed for ${s.permit.permit_number}: ${(err as Error).message}`
      );
    }
  }

  const report: LiveRunReport = {
    timestamp: new Date().toISOString(),
    dry_run: false,
    search_matrix_size: PERMIT_TYPES.length * CITIES.length,
    total_permits_fetched: allPermits.length,
    inserts,
    updates,
    revisions_logged: revisionsLogged,
    last_seen_touched: lastSeenTouched,
    skipped_unchanged: lastSeenTouched,
    errors,
  };
  return jsonResponse(200, report);
});

// ----- HELPERS -----
function jsonResponse(status: number, body: object): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function buildHunterLeadRow(
  permit: TLMAPermit,
  score: ReturnType<typeof scorePermit>,
  tenantId: string,
  userId: string
): HunterLeadRow {
  const phone =
    permit.contact_business_phone ||
    permit.contact_mobile ||
    permit.contact_home_phone ||
    null;
  const permitUrl =
    TLMA_BASE_URL +
    "?" +
    new URLSearchParams({
      "Criteria.PermitNumber": permit.permit_number,
    }).toString();

  return {
    tenant_id: tenantId,
    user_id: userId,
    source: "tlma_riverside",
    source_tag: `permit_${permit.permit_type_code}`,
    lead_type: inferLeadType(permit.permit_type_code),
    contact_name: permit.contact_name,
    company_name: permit.contact_company,
    contact_company: permit.contact_company,
    contact_type_label: permit.contact_type,
    phone,
    email: null, // TLMA does not expose emails
    address: permit.street_name,
    city: permit.city,
    description: permit.permit_description,
    estimated_value: null, // TLMA does not show fee/valuation directly
    score: score.final_score,
    score_tier: score.score_tier,
    score_factors: {
      base_score: score.base_score,
      sqft_bonus: score.sqft_bonus,
      keyword_hits: score.keyword_hits,
      contact_signal_weight: score.contact_signal_weight,
      status_modifier: score.status_modifier,
      penalties: score.penalties,
      force_overrides: score.force_overrides,
      transparency_notes: score.transparency_notes,
    },
    status: score.final_score < 30 ? "archived" : "new",
    permit_number: permit.permit_number,
    permit_url: permitUrl,
    permit_type_code: permit.permit_type_code,
    permit_type_label: permit.permit_type_label,
    work_class_code: null, // not available in basic search; only on detail pages
    permit_status: permit.permit_status,
    total_sqft: permit.total_sqft,
    sqft_breakdown:
      permit.sqft_breakdown &&
      Object.keys(permit.sqft_breakdown).length > 0
        ? permit.sqft_breakdown
        : null,
    applied_date: permit.applied_date,
    issued_date: permit.issued_date,
    finalized_date: permit.finalized_date,
    expired_date: permit.expired_date,
  };
}

function inferLeadType(permitTypeCode: string): string {
  if (["BNR", "BTI", "BMN"].includes(permitTypeCode)) return "commercial";
  if (["BRS", "BAR", "BAS", "BMR"].includes(permitTypeCode)) return "residential";
  if (["BSP"].includes(permitTypeCode)) return "service";
  return "commercial";
}
