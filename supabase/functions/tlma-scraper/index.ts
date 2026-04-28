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

// Real Chrome on Windows headers � TLMA's WAF blocks generic / bot-shaped
// User-Agents. We send a complete browser-shaped header set including
// Accept, Accept-Language, Accept-Encoding, and Referer so the request
// looks like it came from a normal user navigating the site.
const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "gzip, deflate, br",
  "Referer": "https://publiclookup.rivco.org/",
  "Upgrade-Insecure-Requests": "1",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "same-origin",
  "Sec-Fetch-User": "?1",
};

// CORS headers — added in v9 to unblock browser-initiated calls
// (e.g. HunterPanel manual Scan Now). Purely additive: does not change
// scoring, parsing, dedup, or upsert logic.
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

// ----- MAIN HANDLER -----
serve(async (req: Request) => {
  // CORS preflight — must be first statement so browser fetch works.
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  const url = new URL(req.url);
  const dryRun = url.searchParams.get("dry_run") === "true";
  const debug = url.searchParams.get("debug") === "true";
  
  // DEBUG MODE — fetch one URL, return raw HTML for parser development
  if (debug) {
    const debugUrl = "https://publiclookup.rivco.org/?Page=1&PageSize=10&SortBy=AppliedDate&SortDesc=true&Criteria.PermitType=Residential+Dwelling+%28BRS%29&Criteria.City=PALM+DESERT&Criteria.AppliedDateStart=2026-04-01";
    try {
      const dr = await fetch(debugUrl, { headers: BROWSER_HEADERS });
      const dh = await dr.text();
      return new Response(JSON.stringify({
        url: debugUrl,
        status: dr.status,
        statusText: dr.statusText,
        contentType: dr.headers.get("content-type"),
        contentLength: dh.length,
        firstChars: dh.slice(0, 500),
        hasTable: dh.includes("<table"),
        hasPermit: dh.includes("permit") || dh.includes("Permit"),
        tableSnippet: dh.includes("<table") ? dh.slice(dh.indexOf("<table"), dh.indexOf("<table") + 2000) : null,
      }, null, 2), { headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
    } catch (e) {
      return new Response(JSON.stringify({ error: String(e) }), {
        status: 500,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }
  }
  const daysBack = parseInt(url.searchParams.get("days_back") || "0", 10);
  // Default lookback = 7 days. Use ?days_back=90 for first-run backfill.
  const lookback = daysBack > 0 ? daysBack : 7;

  // Optional ?city=NAME filter — limits scrape to ONE city per invocation
  // to stay under the Edge Function timeout. NAME must match a city in the
  // CITIES array (case-sensitive, spaces allowed). If absent, all 13 cities
  // are scraped (which often exceeds timeout for 90-day backfills).
  const cityFilter = url.searchParams.get("city");
  const citiesToScan = cityFilter
    ? CITIES.filter((c) => c.toUpperCase() === cityFilter.toUpperCase())
    : CITIES;

  if (cityFilter && citiesToScan.length === 0) {
    return jsonResponse(400, {
      error: "Unknown city: " + cityFilter,
      valid_cities: CITIES,
    });
  }

  const tenantId = Deno.env.get("HUNTER_TENANT_ID");
  const userId = Deno.env.get("HUNTER_USER_ID");
  if (!tenantId || !userId) {
    return jsonResponse(500, {
      error: "HUNTER_TENANT_ID and HUNTER_USER_ID must be set in env",
    });
  }

  // ----- RUN LOGGING (v9) -----
  // Write a row to cron_run_log at start (status=running) and update at end
  // with final status / counts. Purely additive — provides operational
  // visibility into the 13-city cron sweep. UI reads this table.
  const supabase = createServiceClient();
  const cityParam = url.searchParams.get("city") || "ALL_CITIES";
  const runSource =
    url.searchParams.get("source") === "manual" ? "manual" : "cron";
  const runStart = Date.now();

  let logId: string | null = null;
  // Skip cron_run_log insert for dry runs — dry_run is a developer tool and
  // doesn't reach the live-branch update, so we'd otherwise leave orphan
  // 'running' rows. This guard keeps cron_run_log dedicated to real runs.
  if (!dryRun) {
    try {
      const { data: logRow } = await supabase
        .from("cron_run_log")
        .insert({
          city: cityParam,
          run_source: runSource,
          status: "running",
          started_at: new Date(runStart).toISOString(),
        })
        .select("id")
        .single();
      logId = logRow?.id ?? null;
    } catch (_e) {
      // Log insert failed — proceed without run logging. Do not fail the run.
      logId = null;
    }
  }

  // Per-run counters tracked across both the city/permit_type fetch loop
  // and the upsert loop. These feed the cron_run_log update at the end.
  let newCount = 0;
  let updatedCount = 0;
  let errorCount = 0;
  let lastError: string | null = null;

  try {

  const startDate = new Date();
  startDate.setDate(startDate.getDate() - lookback);
  const startDateStr = startDate.toISOString().slice(0, 10);

  const errors: string[] = [];
  const allPermits: TLMAPermit[] = [];

  // ----- SEARCH MATRIX LOOP -----
  for (const permitType of PERMIT_TYPES) {
    for (const city of citiesToScan) {
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
          headers: BROWSER_HEADERS,
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
            headers: BROWSER_HEADERS,
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
        errorCount++;
        lastError = (err as Error).message;
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
      search_matrix_size: PERMIT_TYPES.length * citiesToScan.length,
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
  // Note: `supabase` was created at the top of the handler (v9 run logging).
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
      if (result.action === "insert") {
        inserts++;
        newCount++;
      } else if (result.action === "update") {
        updates++;
        updatedCount++;
      } else lastSeenTouched++;
      revisionsLogged += result.revisions_written;
    } catch (err) {
      errors.push(
        `upsert failed for ${s.permit.permit_number}: ${(err as Error).message}`
      );
      errorCount++;
      lastError = (err as Error).message;
    }
  }

  const report: LiveRunReport = {
    timestamp: new Date().toISOString(),
    dry_run: false,
    search_matrix_size: PERMIT_TYPES.length * citiesToScan.length,
    total_permits_fetched: allPermits.length,
    inserts,
    updates,
    revisions_logged: revisionsLogged,
    last_seen_touched: lastSeenTouched,
    skipped_unchanged: lastSeenTouched,
    errors,
  };

  // ----- RUN LOGGING (v9): final update -----
  if (logId) {
    const finalStatus =
      errorCount === 0
        ? "success"
        : newCount + updatedCount > 0
        ? "partial"
        : "failed";
    try {
      await supabase
        .from("cron_run_log")
        .update({
          completed_at: new Date().toISOString(),
          status: finalStatus,
          new_leads: newCount,
          updated_leads: updatedCount,
          errors: errorCount,
          error_message: lastError,
          duration_ms: Date.now() - runStart,
          permit_types_processed: PERMIT_TYPES.length,
        })
        .eq("id", logId);
    } catch (_e) {
      // Don't let log update failure poison the response.
    }
  }

  return jsonResponse(200, report);

  } catch (err) {
    // OUTERMOST catch — write a failed-status update so unhandled crashes
    // are recorded in cron_run_log instead of leaving the row at 'running'.
    if (logId) {
      try {
        await supabase
          .from("cron_run_log")
          .update({
            completed_at: new Date().toISOString(),
            status: "failed",
            errors: 1,
            error_message: (err as Error).message,
            duration_ms: Date.now() - runStart,
          })
          .eq("id", logId);
      } catch (_e) {
        // ignore — best-effort logging
      }
    }
    throw err;
  }
});

// ----- HELPERS -----
function jsonResponse(status: number, body: object): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
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
