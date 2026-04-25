import {
  DOMParser,
  Element,
} from "https://deno.land/x/deno_dom@v0.1.46/deno-dom-wasm.ts";
import type { TLMAPermit } from "./types.ts";

export interface ParseResult {
  permits: TLMAPermit[];
  total_rows: number;
  current_page: number;
  total_pages: number;
}

// Parse sqft breakdown string like:
//   "Garage 543.00\nResidence(s) 1715.00\nUtility 102.00"
// into: { garage: 543, residence: 1715, utility: 102 }
function parseSqftBreakdown(raw: string): Record<string, number> {
  const result: Record<string, number> = {};
  if (!raw || !raw.trim()) return result;
  const lines = raw.split(/\n|\r\n|\r/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    // Match: "Some Label(s) 1234.00"
    const match = trimmed.match(/^(.*?)\s+([\d]+(?:\.\d+)?)$/);
    if (match) {
      // Normalize key: lowercase, strip parens/special chars, trim
      const key = match[1]
        .toLowerCase()
        .replace(/\([^)]*\)/g, "")
        .replace(/[^a-z0-9\s]/g, "")
        .trim()
        .replace(/\s+/g, "_");
      const val = Math.round(parseFloat(match[2]));
      if (key) result[key] = val;
    }
  }
  return result;
}

// Extract permit type code from label like "Residential Dwelling (BRS)" → "BRS"
function extractPermitTypeCode(label: string): string {
  const match = label.match(/\(([A-Z]+)\)$/);
  return match ? match[1] : "";
}

// Safe text content from element
function getText(el: Element | null | undefined): string {
  return el?.textContent?.trim() ?? "";
}

// Get cell by class name within a row
function getCell(row: Element, className: string): Element | null {
  return row.querySelector(`td.${className}`) as Element | null;
}

export function parseSearchResultsHTML(html: string): ParseResult {
  const doc = new DOMParser().parseFromString(html, "text/html");
  if (!doc) {
    console.log("[parser] DOMParser returned null for HTML input");
    return { permits: [], total_rows: 0, current_page: 1, total_pages: 1 };
  }

  // Locate results table — try multiple selectors in preference order
  let table: Element | null =
    (doc.querySelector("table.results-table") as Element | null) ??
    (doc.querySelector("table#results") as Element | null) ??
    (doc.querySelector("table.table-results") as Element | null) ??
    (doc.querySelector("table") as Element | null);

  if (!table) {
    console.log("[parser] No results table found in HTML — returning empty");
    return { permits: [], total_rows: 0, current_page: 1, total_pages: 1 };
  }

  const tbody = table.querySelector("tbody") as Element | null;
  if (!tbody) {
    console.log("[parser] No tbody found in results table — returning empty");
    return { permits: [], total_rows: 0, current_page: 1, total_pages: 1 };
  }

  const rows = tbody.querySelectorAll("tr");
  const permits: TLMAPermit[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] as Element;
    const cells = row.querySelectorAll("td");
    if (!cells || cells.length === 0) continue;

    try {
      // Try class-based extraction first, fall back to positional
      const permitNumber =
        getText(getCell(row, "col-permit")) ||
        getText(cells[0] as Element);

      if (!permitNumber) continue; // skip empty rows

      const permitDescription =
        getText(getCell(row, "col-desc")) ||
        getText(cells[cells.length - 1] as Element);

      const city =
        getText(getCell(row, "col-city")) ||
        getText(cells[1] as Element);

      const streetName =
        getText(getCell(row, "col-street")) ||
        getText(cells[2] as Element);

      const permitTypeLabelRaw =
        getText(getCell(row, "col-type")) ||
        getText(cells[3] as Element);

      const apn =
        getText(getCell(row, "col-apn")) ||
        getText(cells[4] as Element);

      const tract =
        getText(getCell(row, "col-tract")) ||
        getText(cells[5] as Element) ||
        null;

      const lot =
        getText(getCell(row, "col-lot")) ||
        getText(cells[6] as Element) ||
        null;

      const sqftByTypeRaw =
        getText(getCell(row, "col-sqftbytype")) || "";

      const sqftTotalRaw =
        getText(getCell(row, "col-sqft")) || "";

      const sqftBreakdown = parseSqftBreakdown(sqftByTypeRaw);
      let totalSqft: number | null = null;
      if (sqftTotalRaw) {
        const parsed = parseFloat(sqftTotalRaw.replace(/,/g, ""));
        if (!isNaN(parsed)) totalSqft = Math.round(parsed);
      }
      // If total_sqft not in its own column, sum breakdown values
      if (totalSqft === null && Object.keys(sqftBreakdown).length > 0) {
        totalSqft = Object.values(sqftBreakdown).reduce((a, b) => a + b, 0);
      }

      // Dates — look for multiple date columns
      // col-date cells or cells[8..11]
      const dateCells = row.querySelectorAll("td.col-date");
      let appliedDate: string | null = null;
      let issuedDate: string | null = null;
      let finalizedDate: string | null = null;
      let expiredDate: string | null = null;

      if (dateCells && dateCells.length >= 4) {
        appliedDate = getText(dateCells[0] as Element) || null;
        issuedDate = getText(dateCells[1] as Element) || null;
        finalizedDate = getText(dateCells[2] as Element) || null;
        expiredDate = getText(dateCells[3] as Element) || null;
      } else if (dateCells && dateCells.length > 0) {
        // Fewer than 4 date cells — assign what we have
        appliedDate = getText(dateCells[0] as Element) || null;
        if (dateCells.length > 1) issuedDate = getText(dateCells[1] as Element) || null;
        if (dateCells.length > 2) finalizedDate = getText(dateCells[2] as Element) || null;
        if (dateCells.length > 3) expiredDate = getText(dateCells[3] as Element) || null;
      } else {
        // Fallback positional (columns 8-11 if present)
        const numCells = cells.length;
        if (numCells > 8) appliedDate = getText(cells[8] as Element) || null;
        if (numCells > 9) issuedDate = getText(cells[9] as Element) || null;
        if (numCells > 10) finalizedDate = getText(cells[10] as Element) || null;
        if (numCells > 11) expiredDate = getText(cells[11] as Element) || null;
      }

      // Normalize dates: ensure "YYYY-MM-DD" or null
      const normalizeDate = (d: string | null): string | null => {
        if (!d) return null;
        const trimmed = d.trim();
        if (!trimmed || trimmed === "N/A" || trimmed === "-") return null;
        return trimmed;
      };

      // Contact fields
      const contactName =
        getText(getCell(row, "col-contact")) || null;
      const contactCompanyRaw =
        getText(getCell(row, "col-contactcompany")) || null;
      const projectName =
        getText(getCell(row, "col-projectname")) || null;

      // Contact type may appear as a separate cell or embedded
      // Look for col-contacttype first; otherwise null
      const contactType =
        getText(row.querySelector("td.col-contacttype") as Element | null) ||
        null;

      // Phone fields (Home, Business, Mobile may be in separate cells)
      const homePhone =
        getText(row.querySelector("td.col-homephone") as Element | null) ||
        getText(row.querySelector("td.col-phone") as Element | null) ||
        null;
      const businessPhone =
        getText(row.querySelector("td.col-businessphone") as Element | null) ||
        null;
      const mobilePhone =
        getText(row.querySelector("td.col-mobile") as Element | null) ||
        getText(row.querySelector("td.col-mobilephone") as Element | null) ||
        null;

      // Permit status — may be a separate col or embedded in permit cell
      const permitStatusRaw =
        getText(row.querySelector("td.col-status") as Element | null) || "";

      const permitTypeLabel = permitTypeLabelRaw || "";
      const permitTypeCode = extractPermitTypeCode(permitTypeLabel);

      const permit: TLMAPermit = {
        permit_number: permitNumber,
        permit_description: permitDescription,
        permit_status: permitStatusRaw,
        city,
        street_name: streetName,
        apn,
        tract: tract || null,
        lot: lot || null,
        permit_type_label: permitTypeLabel,
        permit_type_code: permitTypeCode,
        sqft_breakdown: sqftBreakdown,
        total_sqft: totalSqft,
        applied_date: normalizeDate(appliedDate),
        issued_date: normalizeDate(issuedDate),
        finalized_date: normalizeDate(finalizedDate),
        expired_date: normalizeDate(expiredDate),
        contact_name: contactName,
        contact_type: contactType,
        contact_company: contactCompanyRaw,
        contact_home_phone: homePhone,
        contact_business_phone: businessPhone,
        contact_mobile: mobilePhone,
        project_name: projectName,
      };

      permits.push(permit);
    } catch (err) {
      console.log(
        `[parser] Warning: failed to parse row ${i}: ${(err as Error).message}`
      );
    }
  }

  // --- Pagination extraction ---
  let totalRows = permits.length;
  let currentPage = 1;
  let totalPages = 1;

  // Look for "Total Rows: N" text anywhere in the document
  const bodyText = doc.querySelector("body")?.textContent ?? "";

  const totalRowsMatch = bodyText.match(/Total\s+Rows?\s*:\s*([\d,]+)/i);
  if (totalRowsMatch) {
    totalRows = parseInt(totalRowsMatch[1].replace(/,/g, ""), 10);
  }

  // Look for "Page N of M" pattern
  const pageOfMatch = bodyText.match(/Page\s+(\d+)\s+of\s+(\d+)/i);
  if (pageOfMatch) {
    currentPage = parseInt(pageOfMatch[1], 10);
    totalPages = parseInt(pageOfMatch[2], 10);
  } else {
    // Try to find a pagination area — highlighted/active page button
    const activePage = doc.querySelector(
      ".pagination .active, .pager .current, [aria-current='page']"
    ) as Element | null;
    if (activePage) {
      const pageNum = parseInt(getText(activePage), 10);
      if (!isNaN(pageNum)) currentPage = pageNum;
    }

    // Try to determine total pages from last page link
    const pageLinks = doc.querySelectorAll(
      ".pagination a, .pager a, [data-page]"
    );
    if (pageLinks && pageLinks.length > 0) {
      let maxPage = 1;
      for (let i = 0; i < pageLinks.length; i++) {
        const linkText = getText(pageLinks[i] as Element);
        const pageNum = parseInt(linkText, 10);
        if (!isNaN(pageNum) && pageNum > maxPage) maxPage = pageNum;
      }
      if (maxPage > 1) totalPages = maxPage;
    }

    // Derive total pages from total rows / page size (assume 100 per page)
    if (totalPages === 1 && totalRows > 100) {
      totalPages = Math.ceil(totalRows / 100);
    }
  }

  return { permits, total_rows: totalRows, current_page: currentPage, total_pages: totalPages };
}
