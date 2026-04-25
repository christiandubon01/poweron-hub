import type { TLMAPermit } from "./types.ts";

export interface ParseResult {
  permits: TLMAPermit[];
  total_rows: number;
  current_page: number;
  total_pages: number;
}

// Decode HTML entities in extracted text
function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)));
}

// Strip HTML tags, decode entities, normalize whitespace
function cleanCell(s: string): string {
  return decodeEntities(
    s.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim()
  );
}

// Strip HTML tags but PRESERVE line breaks (for sqft breakdown column,
// which contains <br> tags or multi-line text separating each sqft item)
function cleanCellMultiline(s: string): string {
  return decodeEntities(
    s
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(?:p|div|li)>/gi, "\n")
      .replace(/<[^>]*>/g, " ")
      .split("\n")
      .map((line) => line.replace(/[ \t]+/g, " ").trim())
      .filter((l) => l.length > 0)
      .join("\n")
  );
}

// Parse sqft breakdown like:
//   "Garage 543.00\nResidence(s) 1715.00\nUtility 102.00"
// into: { garage: 543, residence: 1715, utility: 102 }
function parseSqftBreakdown(raw: string): Record<string, number> {
  const result: Record<string, number> = {};
  if (!raw || !raw.trim()) return result;
  const lines = raw.split(/\n+/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const match = trimmed.match(/^(.+?)\s+([\d,]+(?:\.\d+)?)$/);
    if (match) {
      const key = match[1]
        .toLowerCase()
        .replace(/\([^)]*\)/g, "")
        .replace(/[^a-z0-9\s]/g, "")
        .trim()
        .replace(/\s+/g, "_");
      const val = Math.round(parseFloat(match[2].replace(/,/g, "")));
      if (key && !isNaN(val)) result[key] = val;
    }
  }
  return result;
}

// Extract permit type code from label like "Residential Dwelling (BRS)" -> "BRS"
function extractPermitTypeCode(label: string): string {
  const match = label.match(/\(([A-Z]+)\)\s*$/);
  return match ? match[1] : "";
}

// Normalize date: "YYYY-MM-DD", "MM/DD/YYYY", or null
function normalizeDate(d: string): string | null {
  const trimmed = d.trim();
  if (!trimmed || trimmed === "N/A" || trimmed === "-") return null;
  // Already YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return trimmed.slice(0, 10);
  // MM/DD/YYYY -> YYYY-MM-DD
  const us = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (us) {
    const [, mm, dd, yyyy] = us;
    return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
  }
  return trimmed;
}

/**
 * Regex-based HTML parser for TLMA permit search results.
 *
 * Why regex and not DOM? deno_dom (the Deno-native HTML parser) failed to
 * locate the results table in TLMA's HTML, likely because TLMA's markup is
 * not strictly valid HTML5 (a <style> tag appears outside <head>). Real
 * browsers auto-correct this; deno_dom does not. Regex sidesteps the issue
 * entirely. The HTML structure is stable and deterministic, so this is fine.
 *
 * Column structure (confirmed via debug fetch on 2026-04-25):
 *   0: permit_number  (col-permit)
 *   1: permit_description  (col-desc)
 *   2: permit_status  (col-permit -- DUPLICATE class with 0)
 *   3: city  (col-city)
 *   4: street_name  (col-street)
 *   5: apn  (col-apn)
 *   6: tract  (col-tract)
 *   7: lot  (col-lot)
 *   8: permit_type_label  (col-type)
 *   9: sqft_by_type  (col-sqftbytype)
 *  10: total_sqft  (col-sqft)
 *  11: applied_date  (col-date)
 *  12: issued_date  (col-date -- DUPLICATE class with 11)
 *  13: finalized_date  (col-date -- DUPLICATE)
 *  14: expired_date  (col-date -- DUPLICATE)
 *  15: contact_name  (col-contact)
 *  16: contact_type  (col-contact -- DUPLICATE class with 15)
 *  17: contact_company  (col-contactcompany)
 *  18: contact_home_phone  (col-contact -- DUPLICATE)
 *  19: contact_business_phone  (col-contact -- DUPLICATE)
 *  20: contact_mobile  (col-contact -- DUPLICATE)
 *  21: project_name  (col-projectname)
 *  22: action button  (no class, ignored)
 *
 * Several classes appear multiple times across columns, so we extract by
 * POSITION within the row, not by class name.
 */
export function parseSearchResultsHTML(html: string): ParseResult {
  // Find the results table by class containing "results-table"
  const tableMatch = html.match(
    /<table[^>]*class="[^"]*results-table[^"]*"[^>]*>([\s\S]*?)<\/table>/i
  );
  if (!tableMatch) {
    console.log("[parser] No results table found in HTML -- returning empty");
    return { permits: [], total_rows: 0, current_page: 1, total_pages: 1 };
  }

  const tableHtml = tableMatch[1];

  // Find <tbody> inside the table
  const tbodyMatch = tableHtml.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/i);
  if (!tbodyMatch) {
    console.log("[parser] No tbody found in results table -- returning empty");
    return { permits: [], total_rows: 0, current_page: 1, total_pages: 1 };
  }

  const tbodyHtml = tbodyMatch[1];

  // Extract each <tr>...</tr> block
  const rowMatches = [...tbodyHtml.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];
  console.log(`[parser] Found ${rowMatches.length} rows in tbody`);

  const permits: TLMAPermit[] = [];

  for (let i = 0; i < rowMatches.length; i++) {
    const rowHtml = rowMatches[i][1];

    // Extract all <td>...</td> cells in order
    const cellMatches = [...rowHtml.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)];
    if (cellMatches.length === 0) continue;

    const cells = cellMatches.map((m) => m[1]);

    // Skip rows that don't have enough cells (header rows, separator rows, etc.)
    if (cells.length < 15) continue;

    try {
      const permitNumber = cleanCell(cells[0]);
      if (!permitNumber) continue;

      const permitDescription = cleanCell(cells[1]);
      const permitStatus = cleanCell(cells[2]);
      const city = cleanCell(cells[3]);
      const streetName = cleanCell(cells[4]);
      const apn = cleanCell(cells[5]);
      const tract = cleanCell(cells[6]) || null;
      const lot = cleanCell(cells[7]) || null;
      const permitTypeLabel = cleanCell(cells[8]);
      const sqftByTypeRaw = cleanCellMultiline(cells[9]);
      const totalSqftRaw = cleanCell(cells[10]);
      const appliedDate = normalizeDate(cleanCell(cells[11]));
      const issuedDate = normalizeDate(cleanCell(cells[12]));
      const finalizedDate = normalizeDate(cleanCell(cells[13]));
      const expiredDate = normalizeDate(cleanCell(cells[14]));
      const contactName = cleanCell(cells[15]) || null;
      const contactType = cleanCell(cells[16]) || null;
      const contactCompany = cleanCell(cells[17]) || null;
      const homePhone = cleanCell(cells[18]) || null;
      const businessPhone = cleanCell(cells[19]) || null;
      const mobilePhone = cleanCell(cells[20]) || null;
      const projectName = cleanCell(cells[21]) || null;

      // Sqft breakdown processing
      const sqftBreakdown = parseSqftBreakdown(sqftByTypeRaw);
      let totalSqft: number | null = null;
      if (totalSqftRaw) {
        const parsed = parseFloat(totalSqftRaw.replace(/,/g, ""));
        if (!isNaN(parsed)) totalSqft = Math.round(parsed);
      }
      // Fallback: sum breakdown values if total_sqft column was empty
      if (totalSqft === null && Object.keys(sqftBreakdown).length > 0) {
        totalSqft = Object.values(sqftBreakdown).reduce((a, b) => a + b, 0);
      }

      const permitTypeCode = extractPermitTypeCode(permitTypeLabel);

      permits.push({
        permit_number: permitNumber,
        permit_description: permitDescription,
        permit_status: permitStatus,
        city,
        street_name: streetName,
        apn,
        tract,
        lot,
        permit_type_label: permitTypeLabel,
        permit_type_code: permitTypeCode,
        sqft_breakdown: sqftBreakdown,
        total_sqft: totalSqft,
        applied_date: appliedDate,
        issued_date: issuedDate,
        finalized_date: finalizedDate,
        expired_date: expiredDate,
        contact_name: contactName,
        contact_type: contactType,
        contact_company: contactCompany,
        contact_home_phone: homePhone,
        contact_business_phone: businessPhone,
        contact_mobile: mobilePhone,
        project_name: projectName,
      });
    } catch (err) {
      console.log(
        `[parser] Warning: failed to parse row ${i}: ${(err as Error).message}`
      );
    }
  }

  // Pagination — extract from full HTML (not just table) since pagination
  // controls live outside the table.
  let totalRows = permits.length;
  let currentPage = 1;
  let totalPages = 1;

  const totalRowsMatch = html.match(/Total\s+Rows?\s*:\s*([\d,]+)/i);
  if (totalRowsMatch) {
    totalRows = parseInt(totalRowsMatch[1].replace(/,/g, ""), 10);
  }

  const pageOfMatch = html.match(/Page\s+(\d+)\s+of\s+(\d+)/i);
  if (pageOfMatch) {
    currentPage = parseInt(pageOfMatch[1], 10);
    totalPages = parseInt(pageOfMatch[2], 10);
  } else if (totalRows > 100) {
    // Heuristic: we request PageSize=100, so derive total pages from total rows
    totalPages = Math.ceil(totalRows / 100);
  }

  return {
    permits,
    total_rows: totalRows,
    current_page: currentPage,
    total_pages: totalPages,
  };
}
