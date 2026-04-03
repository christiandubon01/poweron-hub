// @ts-nocheck
/**
 * MTO Material Summary PDF Export Service
 *
 * Matches the old HTML app "Material Summary" export format exactly.
 * Uses window.open() + window.print() — no additional PDF library needed.
 * (pdfjs-dist is a reader-only library; the existing supplier-safe export in
 *  V15rEstimateMTO.tsx already uses this approach, so we follow the same pattern.)
 *
 * DO NOT TOUCH: src/store/authStore.ts, netlify.toml,
 *               src/services/backupDataService.ts, vite.config.ts,
 *               src/components/v15r/charts/SVGCharts.tsx
 */

// ─── Types ────────────────────────────────────────────────────────────────────

interface MTORow {
  id: string
  phase?: string
  matId?: string
  name?: string
  qty?: number | string
  unit?: string
  material_family?: string
  [key: string]: unknown
}

interface PriceBookItem {
  id: string
  name?: string
  unit?: string
  cat?: string
  [key: string]: unknown
}

interface ProjectForExport {
  id: string
  name?: string
  type?: string
  mtoRows?: MTORow[]
}

interface SummarizedRow {
  name: string
  totalQty: number
  unit: string
  materialFamily: string
}

// ─── Material Family Mapping ───────────────────────────────────────────────────

const FAMILY_MAP: Array<[RegExp, string]> = [
  [/EMT|PVC|Conduit|Flex/i,                            'Raceway / Conduit'],
  [/Box|Enclosure/i,                                   'Boxes / Enclosures'],
  [/Breaker|Panel|Disconnect|Fuse/i,                   'Breakers / Panels / Disconnects'],
  [/MC Cable|Wire|Cable|AWG|Conductor/i,               'Conductors / Cable'],
  [/Receptacle|Switch|Dimmer|Cover|Plate|GFCI|Sensor/i,'Devices / Controls'],
  [/Fixture|LED|Light|Transformer/i,                   'Lighting'],
  [/Strap|Hanger|Bushing|Holder|Screw/i,              'Hardware / Support'],
]

function getMaterialFamily(itemName: string, existingFamily?: string): string {
  if (existingFamily && existingFamily.trim()) return existingFamily.trim()
  const name = itemName || ''
  for (const [pattern, family] of FAMILY_MAP) {
    if (pattern.test(name)) return family
  }
  return 'Miscellaneous'
}

// ─── Deduplication ────────────────────────────────────────────────────────────

function deduplicateMTORows(
  mtoRows: MTORow[],
  priceBook: PriceBookItem[],
): SummarizedRow[] {
  // Build a fast price-book lookup map
  const pbMap = new Map<string, PriceBookItem>()
  ;(priceBook || []).forEach(item => {
    if (item.id) pbMap.set(item.id, item)
  })

  // Group by exact item name — sum quantities
  const grouped = new Map<string, { totalQty: number; unit: string; materialFamily: string }>()

  ;(mtoRows || []).forEach(row => {
    const pbItem = row.matId ? pbMap.get(row.matId) : null
    const name   = (row.name || pbItem?.name || 'Unknown Item').trim()
    const unit   = (row.unit || pbItem?.unit || 'EA').trim()
    const qty    = typeof row.qty === 'number'
      ? row.qty
      : parseFloat(String(row.qty ?? 0)) || 0

    const existing = grouped.get(name)
    if (existing) {
      existing.totalQty += qty
    } else {
      grouped.set(name, {
        totalQty: qty,
        unit,
        materialFamily: getMaterialFamily(name, row.material_family as string | undefined),
      })
    }
  })

  // Convert to array and sort alphabetically
  const result: SummarizedRow[] = []
  grouped.forEach((val, name) => {
    result.push({ name, ...val })
  })
  result.sort((a, b) => a.name.localeCompare(b.name))
  return result
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function escHtml(str: string): string {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function fmtQty(qty: number): string {
  // Show whole numbers without decimals; otherwise 2 decimal places
  return Number.isInteger(qty) ? String(qty) : qty.toFixed(2)
}

function todayStr(): string {
  return new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

// ─── Main Export ──────────────────────────────────────────────────────────────

export function exportMaterialSummaryPDF(
  project: ProjectForExport,
  priceBook: PriceBookItem[] = [],
): void {
  const mtoRows     = project.mtoRows || []
  const totalMTORows = mtoRows.length
  const summarized  = deduplicateMTORows(mtoRows, priceBook)
  const uniqueCount = summarized.length
  const totalQtyAll = summarized.reduce((s, r) => s + r.totalQty, 0)
  const today       = todayStr()
  const projectName = project.name || 'Unnamed Project'
  const projectType = project.type || ''

  const tableRows = summarized.length > 0
    ? summarized.map(row => `
        <tr>
          <td class="item-cell">${escHtml(row.name)}</td>
          <td class="qty-cell">${fmtQty(row.totalQty)}</td>
          <td class="unit-cell">${escHtml(row.unit)}</td>
          <td class="family-cell">${escHtml(row.materialFamily)}</td>
        </tr>`).join('\n')
    : `<tr><td colspan="4" style="text-align:center;color:#999;padding:24px 0">
         No MTO items found for this project.
       </td></tr>`

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Material Summary — ${escHtml(projectName)}</title>
  <style>
    /* ── Reset ── */
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    /* ── Base ── */
    body {
      font-family: Arial, Helvetica, sans-serif;
      font-size: 11px;
      color: #1a1a1a;
      padding: 28px 32px;
      background: #fff;
    }

    /* ── Print button (screen only) ── */
    .no-print {
      margin-bottom: 18px;
    }
    .print-btn {
      padding: 8px 22px;
      background: #1a1a1a;
      color: #fff;
      border: none;
      border-radius: 4px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
    }
    .print-btn:hover { background: #333; }

    /* ── Page header ── */
    .page-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 18px;
      padding-bottom: 14px;
      border-bottom: 2px solid #1a1a1a;
    }
    .header-left .company-name {
      font-size: 18px;
      font-weight: 700;
      letter-spacing: -0.3px;
    }
    .header-left .company-sub {
      font-size: 10px;
      color: #555;
      margin-top: 3px;
    }
    .header-right {
      text-align: right;
    }
    .header-right .doc-title {
      font-size: 18px;
      font-weight: 700;
      letter-spacing: -0.3px;
    }
    .header-right .doc-sub {
      font-size: 10px;
      color: #555;
      margin-top: 3px;
    }

    /* ── Project info bar ── */
    .project-bar {
      display: flex;
      border: 1px solid #999;
      border-radius: 2px;
      margin-bottom: 16px;
      overflow: hidden;
    }
    .project-col {
      flex: 1;
      padding: 10px 16px;
      border-right: 1px solid #ccc;
    }
    .project-col:last-child { border-right: none; }
    .col-label {
      font-size: 9px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.9px;
      color: #777;
      margin-bottom: 4px;
    }
    .col-value {
      font-size: 15px;
      font-weight: 700;
      color: #1a1a1a;
      line-height: 1.2;
    }
    .col-note {
      font-size: 9px;
      color: #666;
      margin-top: 3px;
    }

    /* ── Table header bar ── */
    .table-header-bar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      background: #1a1a1a;
      color: #fff;
      padding: 8px 12px;
    }
    .tbar-left  { font-size: 11px; font-weight: 700; letter-spacing: 0.4px; }
    .tbar-right { font-size: 10px; opacity: 0.85; }

    /* ── Main table ── */
    table { width: 100%; border-collapse: collapse; }

    thead tr { background: #efefef; }
    th {
      text-align: left;
      padding: 7px 10px;
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.6px;
      border-bottom: 1px solid #ccc;
    }
    td {
      padding: 6px 10px;
      border-bottom: 1px solid #e6e6e6;
      vertical-align: top;
    }
    tbody tr:nth-child(even) td { background: #fafafa; }
    tbody tr:hover td { background: #f4f8ff; }

    .item-cell   { width: 38%; font-weight: 500; }
    .qty-cell    { width: 12%; text-align: right; font-family: 'Courier New', Courier, monospace; }
    .unit-cell   { width: 10%; color: #555; }
    .family-cell { width: 40%; color: #444; }

    th.qty-cell { text-align: right; }

    /* ── Footer ── */
    .page-footer {
      margin-top: 22px;
      padding-top: 10px;
      border-top: 1px solid #ccc;
      font-size: 9px;
      color: #666;
      text-align: center;
      letter-spacing: 0.2px;
    }

    /* ── Print overrides ── */
    @media print {
      body { padding: 0; }
      .no-print { display: none !important; }
      @page {
        margin: 14mm 12mm;
        size: letter portrait;
      }
      tbody tr:hover td { background: inherit; }
    }
  </style>
</head>
<body>

  <!-- Print / Save button (hidden on print) -->
  <div class="no-print">
    <button class="print-btn" onclick="window.print()">🖨&nbsp; Print / Save as PDF</button>
  </div>

  <!-- ── HEADER ── -->
  <div class="page-header">
    <div class="header-left">
      <div class="company-name">Power On Solutions, LLC</div>
      <div class="company-sub">Material Take Off export &middot; summarized supplier format</div>
    </div>
    <div class="header-right">
      <div class="doc-title">MATERIAL SUMMARY</div>
      <div class="doc-sub">One combined quantity per item</div>
      <div class="doc-sub">Date: ${today}</div>
    </div>
  </div>

  <!-- ── PROJECT INFO BAR ── -->
  <div class="project-bar">
    <div class="project-col">
      <div class="col-label">Project</div>
      <div class="col-value">${escHtml(projectName)}</div>
      <div class="col-note">${escHtml(projectType)}</div>
    </div>
    <div class="project-col">
      <div class="col-label">Unique Items</div>
      <div class="col-value">${uniqueCount}</div>
      <div class="col-note">rolled up from ${totalMTORows} MTO row${totalMTORows !== 1 ? 's' : ''}</div>
    </div>
    <div class="project-col">
      <div class="col-label">Total Quantity</div>
      <div class="col-value">${fmtQty(totalQtyAll)}</div>
      <div class="col-note">all item quantities combined</div>
    </div>
  </div>

  <!-- ── TABLE HEADER BAR ── -->
  <div class="table-header-bar">
    <span class="tbar-left">SUMMARIZED ITEM QUANTITIES</span>
    <span class="tbar-right">${uniqueCount} unique item${uniqueCount !== 1 ? 's' : ''}</span>
  </div>

  <!-- ── MAIN TABLE ── -->
  <table>
    <thead>
      <tr>
        <th class="item-cell">Item / Description</th>
        <th class="qty-cell">Total QTY</th>
        <th class="unit-cell">Unit</th>
        <th class="family-cell">Material Family</th>
      </tr>
    </thead>
    <tbody>
      ${tableRows}
    </tbody>
  </table>

  <!-- ── FOOTER ── -->
  <div class="page-footer">
    Power On Solutions, LLC &middot; C-10 Electrical Contractor &middot; Desert Hot Springs, CA &middot; (760) 623-8962
    &nbsp;&nbsp;&nbsp;Material List &middot; ${today}
  </div>

</body>
</html>`

  const w = window.open('', '_blank', 'width=960,height=720,scrollbars=yes')
  if (w) {
    w.document.write(html)
    w.document.close()
  } else {
    // Fallback if popup was blocked: trigger via blob URL
    const blob = new Blob([html], { type: 'text/html' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.target   = '_blank'
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 5000)
  }
}
