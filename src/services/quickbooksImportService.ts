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
  const apiKey = import.meta.env.VITE_ANTHROPIC_API_KEY

  if (!apiKey) {
    throw new Error('VITE_ANTHROPIC_API_KEY not set. Add it to your .env file.')
  }

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
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
    }),
  })

  if (!response.ok) {
    const errText = await response.text()
    throw new Error(`Claude API error (${response.status}): ${errText}`)
  }

  const result = await response.json()
  const text = result.content?.[0]?.text || ''

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
