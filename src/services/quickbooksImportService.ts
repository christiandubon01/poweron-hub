// @ts-nocheck
/**
 * quickbooksImportService.ts — QuickBooks PDF Import Service
 *
 * Handles:
 *  - PDF → base64 conversion
 *  - Claude API extraction of invoice/estimate data
 *  - Mapping extracted data to PowerOn service log or project records
 *  - Batch import with progress tracking
 *  - Import history logging
 *
 * OAuth 2.0 QuickBooks API flow (foundation for V3):
 *  - Authorization: https://oauth.platform.intuit.com/op/v1/
 *  - Invoices: https://quickbooks.api.intuit.com/v3/company/{realmId}/query
 *  - VITE_QUICKBOOKS_CLIENT_ID and VITE_QUICKBOOKS_CLIENT_SECRET required
 */

import { getBackupData, saveBackupData, num, type BackupData, type BackupServiceLog } from './backupDataService'
import { callClaude, extractText } from './claudeProxy'

// ── Types ────────────────────────────────────────────────────────────────────

export interface QBExtractedData {
  documentType: 'invoice' | 'estimate'
  entityName: string
  customerName: string
  customerAddress: string
  date: string
  dueDate: string | null
  totalAmount: number
  balanceDue: number
  paymentStatus: 'paid' | 'partial' | 'overdue' | 'pending'
  lineItems: Array<{ description: string; amount: number }>
  jobType: string
  notes: string
  isMultiBuilding: boolean
}

export interface QBImportRecord {
  id: string
  timestamp: string
  source: 'pdf' | 'quickbooks_api'
  filename: string
  records_created: number
  user_confirmed: boolean
  documentType: 'invoice' | 'estimate'
  customerName: string
  totalAmount: number
}

export interface QBBatchItem {
  filename: string
  status: 'pending' | 'processing' | 'extracted' | 'accepted' | 'skipped' | 'error'
  extracted?: QBExtractedData
  error?: string
}

// ── Claude API extraction prompt ─────────────────────────────────────────────

const EXTRACTION_SYSTEM_PROMPT = `You are extracting structured data from a QuickBooks invoice or estimate PDF. Extract and return ONLY valid JSON with these fields:
* documentType: 'invoice' or 'estimate'
* entityName: the company name on the document (Power On Solutions LLC or Dubon Service LLC)
* customerName: bill-to name
* customerAddress: bill-to address
* date: document date in YYYY-MM-DD format
* dueDate: due date in YYYY-MM-DD format or null
* totalAmount: total numeric value
* balanceDue: balance due numeric value (0 if paid)
* paymentStatus: 'paid', 'partial', 'overdue', or 'pending'
* lineItems: array of {description, amount} for each non-zero line item
* jobType: best guess at job type from: 'GFCI/Receptacles', 'Panel/Service', 'EV Charger', 'Remodel', 'Ceiling Fan', 'Low Voltage', 'Commercial', 'Troubleshooting', 'Other'
* notes: any note to customer text
* isMultiBuilding: true if this appears to be a large commercial/multi-unit project
Return only the JSON object, no other text.`

// ── PDF to base64 ────────────────────────────────────────────────────────────

export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      // Strip the data URL prefix to get raw base64
      const base64 = result.split(',')[1] || result
      resolve(base64)
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

// ── Claude API call ──────────────────────────────────────────────────────────

export async function extractFromPDF(file: File): Promise<QBExtractedData> {
  const base64 = await fileToBase64(file)

  const result = await callClaude({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2048,
    system: EXTRACTION_SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'document',
            source: {
              type: 'base64',
              media_type: 'application/pdf',
              data: base64,
            },
          },
          {
            type: 'text',
            text: 'Extract the invoice/estimate data from this QuickBooks PDF document. Return only the JSON object.',
          },
        ],
      },
    ],
  })

  const text = extractText(result)

  // Parse JSON — handle potential markdown code blocks
  const jsonStr = text.replace(/^```json?\s*/i, '').replace(/\s*```$/i, '').trim()
  let parsed: QBExtractedData
  try {
    parsed = JSON.parse(jsonStr)
  } catch (e) {
    throw new Error(`Failed to parse Claude response as JSON: ${text.slice(0, 200)}`)
  }

  // Normalize
  parsed.totalAmount = num(parsed.totalAmount)
  parsed.balanceDue = num(parsed.balanceDue)
  if (!parsed.lineItems) parsed.lineItems = []
  if (!parsed.jobType) parsed.jobType = 'Other'
  if (!parsed.paymentStatus) parsed.paymentStatus = 'pending'

  return parsed
}

// ── Map extracted data to Service Log entry ──────────────────────────────────

export function mapToServiceLog(data: QBExtractedData): Partial<BackupServiceLog> {
  const collected = data.totalAmount - data.balanceDue
  let payStatus = 'N'
  if (data.paymentStatus === 'paid') payStatus = 'Y'
  else if (data.paymentStatus === 'partial') payStatus = 'P'
  else payStatus = 'N'

  // Map QB job type to our job types
  const jobTypeMap: Record<string, string> = {
    'GFCI/Receptacles': 'GFCI / Receptacles',
    'Panel/Service': 'Panel / Service',
    'EV Charger': 'EV Charger',
    'Low Voltage': 'Low Voltage',
    'Commercial': 'Other',
    'Troubleshooting': 'Troubleshoot',
    'Remodel': 'Other',
    'Ceiling Fan': 'Lighting',
    'Other': 'Other',
  }

  const firstLine = (data.lineItems?.[0]?.description || '').slice(0, 200)

  return {
    id: 'svc' + Date.now() + Math.random().toString(36).slice(2, 6),
    date: data.date || new Date().toISOString().slice(0, 10),
    customer: data.customerName || 'Unknown',
    address: data.customerAddress || '',
    jtype: jobTypeMap[data.jobType] || 'Other',
    hrs: 0,
    miles: 0,
    quoted: data.totalAmount,
    mat: 0,
    collected: collected,
    payStatus: payStatus,
    balanceDue: data.balanceDue,
    store: '',
    notes: firstLine,
    adjustments: [],
    source: 'quickbooks_import',
  }
}

// ── Map extracted data to Project ────────────────────────────────────────────

export function mapToProject(data: QBExtractedData): any {
  const projectType = data.isMultiBuilding ? 'commercial' : 'service'
  const scopeNotes = data.lineItems.map(li => `${li.description} — $${li.amount}`).join('\n')

  return {
    id: 'proj' + Date.now() + Math.random().toString(36).slice(2, 6),
    name: `${data.customerName} — ${data.jobType}`,
    type: projectType,
    status: 'coming',
    contract: data.totalAmount,
    billed: 0,
    paid: 0,
    mileRT: 30,
    miDays: 0,
    phases: {},
    logs: [],
    finance: {},
    rfis: [],
    coord: {},
    tasks: {},
    ohRows: [],
    matRows: [],
    mtoRows: [],
    laborRows: [],
    lastMove: new Date().toISOString().slice(0, 10),
    scopeNotes: scopeNotes,
    source: 'quickbooks_import',
  }
}

// ── Import history logging ───────────────────────────────────────────────────

export function logImport(
  backup: BackupData,
  source: 'pdf' | 'quickbooks_api',
  filename: string,
  records_created: number,
  documentType: 'invoice' | 'estimate',
  customerName: string,
  totalAmount: number,
) {
  if (!Array.isArray(backup.imports)) backup.imports = []
  backup.imports.push({
    id: 'imp' + Date.now() + Math.random().toString(36).slice(2, 6),
    timestamp: new Date().toISOString(),
    source,
    filename,
    records_created,
    user_confirmed: true,
    documentType,
    customerName,
    totalAmount,
  })
}

// ── Batch processing ─────────────────────────────────────────────────────────

export async function processBatch(
  files: File[],
  onProgress: (index: number, total: number, item: QBBatchItem) => void,
): Promise<QBBatchItem[]> {
  const items: QBBatchItem[] = files.map(f => ({
    filename: f.name,
    status: 'pending' as const,
  }))

  for (let i = 0; i < files.length; i++) {
    items[i].status = 'processing'
    onProgress(i, files.length, items[i])

    try {
      const extracted = await extractFromPDF(files[i])
      items[i].extracted = extracted
      items[i].status = 'extracted'
    } catch (err) {
      items[i].status = 'error'
      items[i].error = err instanceof Error ? err.message : String(err)
    }

    onProgress(i, files.length, items[i])
  }

  return items
}

// ── QBO CSV/Excel Export Parsing ─────────────────────────────────────────

/**
 * Parsed row from QBO Invoice List or Payments export.
 */
export interface QBOParsedRow {
  customer: string
  invoiceNumber: string
  invoiceDate: string
  dueDate: string
  amount: number
  balance: number
  status: 'Paid' | 'Partial' | 'Open' | 'Voided'
  transactionType: string
  memo: string
}

/**
 * Parse a QBO CSV text (Invoice List or Payments format).
 * Returns an array of parsed rows, skipping voided and zero-amount rows.
 *
 * Invoice List headers: Date, Transaction type, Num, Name, Memo/Description, Due date, Amount, Open balance
 * Payments format: customer name is a grouped header row, then Date, Transaction type, Memo/Description, Transaction number, Amount
 */
export function parseQBOCSV(csvText: string): QBOParsedRow[] {
  const lines = csvText.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
  if (lines.length < 2) return []

  const results: QBOParsedRow[] = []

  // Detect format by checking header row
  const headerLine = lines[0].toLowerCase()
  const isInvoiceList = headerLine.includes('num') && headerLine.includes('name') && headerLine.includes('open balance')

  if (isInvoiceList) {
    // ── Invoice List format ──────────────────────────────────────────
    const headers = parseCSVLine(lines[0])
    const colMap = mapQBOHeaders(headers)

    for (let i = 1; i < lines.length; i++) {
      const cols = parseCSVLine(lines[i])
      if (cols.length < 3) continue

      const memo = getCol(cols, colMap, 'memo') || ''
      const amount = parseFloat(getCol(cols, colMap, 'amount') || '0') || 0
      const balance = parseFloat(getCol(cols, colMap, 'balance') || '0') || 0

      // Skip voided rows
      if (memo.toLowerCase().includes('voided')) continue
      // Skip zero-amount rows
      if (amount === 0) continue

      const status = balance === 0 ? 'Paid' : (balance < amount ? 'Partial' : 'Open')

      results.push({
        customer: getCol(cols, colMap, 'name') || 'Unknown',
        invoiceNumber: getCol(cols, colMap, 'num') || '',
        invoiceDate: getCol(cols, colMap, 'date') || '',
        dueDate: getCol(cols, colMap, 'dueDate') || '',
        amount,
        balance,
        status,
        transactionType: getCol(cols, colMap, 'transactionType') || 'Invoice',
        memo,
      })
    }
  } else {
    // ── Payments format ──────────────────────────────────────────────
    // Customer name as grouped header row, then data rows
    let currentCustomer = ''

    for (let i = 0; i < lines.length; i++) {
      const cols = parseCSVLine(lines[i])

      // Skip header rows (contain "Date" and "Transaction type")
      if (cols[0]?.toLowerCase() === 'date' && cols.length >= 3) continue

      // If the line has only 1 populated column and doesn't look like a date, it's a customer group header
      const populatedCols = cols.filter(c => c.trim() !== '')
      if (populatedCols.length === 1 && !looksLikeDate(cols[0])) {
        currentCustomer = cols[0].trim()
        continue
      }

      // Data row: Date, Transaction type, Memo/Description, Transaction number, Amount
      if (cols.length >= 5 && looksLikeDate(cols[0])) {
        const memo = cols[2] || ''
        const amount = parseFloat(cols[4] || '0') || 0

        if (memo.toLowerCase().includes('voided')) continue
        if (amount === 0) continue

        results.push({
          customer: currentCustomer || 'Unknown',
          invoiceNumber: cols[3] || '',
          invoiceDate: cols[0] || '',
          dueDate: '',
          amount,
          balance: 0,
          status: 'Paid',
          transactionType: cols[1] || 'Payment',
          memo,
        })
      }
    }
  }

  return results
}

// ── CSV line parser (handles quoted fields) ──────────────────────────────

function parseCSVLine(line: string): string[] {
  const result: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"'
        i++
      } else {
        inQuotes = !inQuotes
      }
    } else if (ch === ',' && !inQuotes) {
      result.push(current.trim())
      current = ''
    } else {
      current += ch
    }
  }
  result.push(current.trim())
  return result
}

function looksLikeDate(val: string): boolean {
  if (!val) return false
  return /^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(val.trim()) || /^\d{4}-\d{2}-\d{2}$/.test(val.trim())
}

interface QBOColMap {
  date: number
  transactionType: number
  num: number
  name: number
  memo: number
  dueDate: number
  amount: number
  balance: number
}

function mapQBOHeaders(headers: string[]): QBOColMap {
  const map: QBOColMap = { date: -1, transactionType: -1, num: -1, name: -1, memo: -1, dueDate: -1, amount: -1, balance: -1 }
  headers.forEach((h, i) => {
    const lh = h.toLowerCase().trim()
    if (lh === 'date') map.date = i
    else if (lh === 'transaction type' || lh === 'type') map.transactionType = i
    else if (lh === 'num' || lh === 'number') map.num = i
    else if (lh === 'name' || lh === 'customer') map.name = i
    else if (lh.includes('memo') || lh.includes('description')) map.memo = i
    else if (lh === 'due date' || lh === 'due') map.dueDate = i
    else if (lh === 'amount' || lh === 'total') map.amount = i
    else if (lh.includes('open balance') || lh === 'balance') map.balance = i
  })
  return map
}

function getCol(cols: string[], map: QBOColMap, field: keyof QBOColMap): string {
  const idx = map[field]
  return idx >= 0 && idx < cols.length ? cols[idx] : ''
}

/**
 * Map parsed QBO rows to app_state service log entries.
 */
export function mapQBORowsToServiceLogs(rows: QBOParsedRow[]): Partial<BackupServiceLog>[] {
  return rows.map(row => {
    const collected = row.amount - row.balance
    let payStatus = 'N'
    if (row.status === 'Paid') payStatus = 'Y'
    else if (row.status === 'Partial') payStatus = 'P'

    return {
      id: 'svc' + Date.now() + Math.random().toString(36).slice(2, 6),
      date: row.invoiceDate || new Date().toISOString().slice(0, 10),
      customer: row.customer,
      address: '',
      jtype: 'Other',
      hrs: 0,
      miles: 0,
      quoted: row.amount,
      mat: 0,
      collected,
      payStatus,
      balanceDue: row.balance,
      store: '',
      notes: row.memo || `Invoice #${row.invoiceNumber}`,
      adjustments: [],
      source: 'quickbooks_csv_import',
    }
  })
}
