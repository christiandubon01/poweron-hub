/**
 * utils/watermark.ts
 * V3-22 — Watermark System
 *
 * Core watermark text generation and rendering utilities.
 * Canvas rendering is baked into the pixel layer — not removable via CSS/DOM.
 */

// ─── Text Generation ──────────────────────────────────────────────────────────

/**
 * Formats a Date as MM/DD/YYYY for watermark display.
 */
export function formatWatermarkDate(d: Date = new Date()): string {
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${mm}/${dd}/${yyyy}`;
}

/**
 * Generates the standard watermark text.
 * Format: "[Company Name] · PowerOn Hub · [MM/DD/YYYY]"
 */
export function generateWatermarkText(companyName: string, date: string): string {
  return `${companyName} · PowerOn Hub · ${date}`;
}

/**
 * Generates the Demo Mode watermark text.
 * Format: "⚠ DEMO MODE · [Company Name] · PowerOn Hub · [MM/DD/YYYY]"
 */
export function generateDemoWatermarkText(companyName: string, date: string): string {
  return `⚠ DEMO MODE · ${companyName} · PowerOn Hub · ${date}`;
}

// ─── Canvas Rendering ─────────────────────────────────────────────────────────

export interface WatermarkCanvasOptions {
  /** Font size in px. Default: 10 */
  fontSize?: number;
  /** Opacity 0–1. Default: 0.3 */
  opacity?: number;
  /** CSS color string. Default: '#3a3a3a' (dark theme) */
  color?: string;
  /** Padding from bottom-right edge in px. Default: 8 */
  padding?: number;
}

/**
 * Renders watermark text directly into a canvas context at the bottom-right.
 * Baked into the pixel data — cannot be removed via CSS or DOM inspection.
 */
export function renderWatermarkToCanvas(
  canvas: HTMLCanvasElement,
  text: string,
  options?: WatermarkCanvasOptions,
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const { fontSize = 10, opacity = 0.3, color = '#3a3a3a', padding = 8 } = options ?? {};

  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.fillStyle = color;
  ctx.font = `${fontSize}px system-ui, -apple-system, sans-serif`;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'bottom';
  ctx.fillText(text, canvas.width - padding, canvas.height - padding);
  ctx.restore();
}

// ─── PDF Export ───────────────────────────────────────────────────────────────

/**
 * Stamps the PowerOn Hub watermark into every page of a PDF document.
 * Wire to pdf-lib or jsPDF at integration time.
 *
 * @param pdfDoc  - The PDF document object (pdf-lib PDFDocument or jsPDF instance)
 * @param companyName - Company name to embed
 */
export function embedWatermarkInPDF(pdfDoc: unknown, companyName: string): void {
  const date = formatWatermarkDate();
  const text = generateWatermarkText(companyName, date);

  // Integration stub — replace with pdf-lib implementation:
  //
  // const pages = (pdfDoc as PDFDocument).getPages();
  // const font  = await pdfDoc.embedFont(StandardFonts.Helvetica);
  // for (const page of pages) {
  //   const { width } = page.getSize();
  //   page.drawText(text, {
  //     x: width - 8 - font.widthOfTextAtSize(text, 7),
  //     y: 10,
  //     size: 7,
  //     font,
  //     color: rgb(0.23, 0.23, 0.23),
  //     opacity: 0.35,
  //   });
  // }

  // Wire to pdf-lib at integration time; stub logs intent in dev
  console.debug('[Watermark] embedWatermarkInPDF stub →', text, typeof pdfDoc);
}

// ─── Excel Export ─────────────────────────────────────────────────────────────

/**
 * Adds a hidden "_Watermark" sheet to an Excel workbook with branding metadata.
 * The sheet is stamped into the file itself — not an overlay.
 * Wire to exceljs or SheetJS at integration time.
 *
 * @param workbook    - The workbook object (exceljs Workbook or SheetJS WorkBook)
 * @param companyName - Company name to embed
 */
export function addWatermarkSheet(workbook: unknown, companyName: string): void {
  const date = formatWatermarkDate();
  const text = generateWatermarkText(companyName, date);

  // Integration stub — replace with exceljs implementation:
  //
  // const ws = (workbook as ExcelJS.Workbook).addWorksheet('_Watermark');
  // ws.state = 'veryHidden';
  // ws.getCell('A1').value = text;
  // ws.getCell('A2').value = `Generated: ${new Date().toISOString()}`;
  // ws.getCell('A3').value = 'PowerOn Hub — poweron.io';

  // Wire to exceljs at integration time; stub logs intent in dev
  console.debug('[Watermark] addWatermarkSheet stub →', text, typeof workbook);
}
