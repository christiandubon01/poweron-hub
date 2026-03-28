// @ts-nocheck
/**
 * receiptOCR.ts — Receipt scanning via Claude Vision API
 *
 * Takes a receipt image (base64), sends to Anthropic Claude with a structured
 * extraction prompt, and returns parsed line items for the Material Variance Tracker.
 *
 * Used by: ReceiptScanModal.tsx
 */

import type { ParsedLineItem, ParsedReceipt } from './receiptParser'
import { detectSource } from './receiptParser'

// ── Types ────────────────────────────────────────────────────────────────────

export interface OCRResult {
  success: boolean
  receipt: ParsedReceipt | null
  rawText?: string
  error?: string
}

// ── Core: Send Image to Claude Vision ────────────────────────────────────────

export async function scanReceiptImage(
  base64Image: string,
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp' = 'image/jpeg'
): Promise<OCRResult> {
  const apiKey = import.meta.env.VITE_ANTHROPIC_API_KEY

  if (!apiKey || apiKey === 'sk-ant-api03-...') {
    return {
      success: false,
      receipt: null,
      error: 'Anthropic API key not configured. Set VITE_ANTHROPIC_API_KEY in .env.local',
    }
  }

  try {
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
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: mimeType,
                data: base64Image,
              },
            },
            {
              type: 'text',
              text: `Extract all line items from this receipt. Return ONLY a JSON object (no markdown, no explanation) with this structure:

{
  "store_name": "Store Name",
  "store_location": "City, State",
  "receipt_date": "YYYY-MM-DD",
  "items": [
    { "name": "Item description", "qty": 1, "unit_cost": 12.99, "total": 12.99, "sku": "123456" }
  ],
  "subtotal": 25.98,
  "tax": 2.08,
  "total": 28.06
}

Rules:
- qty defaults to 1 if not shown
- unit_cost is the per-unit price
- total is qty × unit_cost
- sku is optional, include if visible
- If you can't read a value, use null
- receipt_date should be in YYYY-MM-DD format
- Return ONLY the JSON object, nothing else`,
            },
          ],
        }],
      }),
    })

    if (!response.ok) {
      const errText = await response.text()
      return {
        success: false,
        receipt: null,
        error: `Claude API error (${response.status}): ${errText.slice(0, 200)}`,
      }
    }

    const data = await response.json()
    const text = data.content?.[0]?.text || ''

    // Parse the JSON response
    const parsed = parseClaudeResponse(text)
    if (!parsed) {
      return {
        success: false,
        receipt: null,
        rawText: text,
        error: 'Could not parse receipt from image. Try a clearer photo.',
      }
    }

    return { success: true, receipt: parsed, rawText: text }

  } catch (err) {
    return {
      success: false,
      receipt: null,
      error: err instanceof Error ? err.message : 'OCR request failed',
    }
  }
}

// ── Parse Claude's JSON Response ─────────────────────────────────────────────

function parseClaudeResponse(text: string): ParsedReceipt | null {
  try {
    // Strip markdown code fences if present
    let json = text.trim()
    if (json.startsWith('```')) {
      json = json.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
    }

    const data = JSON.parse(json)

    const lineItems: ParsedLineItem[] = (data.items || []).map((item: any) => ({
      name: item.name || 'Unknown Item',
      qty: Number(item.qty) || 1,
      unit_cost: Number(item.unit_cost) || 0,
      total: Number(item.total) || (Number(item.qty || 1) * Number(item.unit_cost || 0)),
      sku: item.sku || undefined,
      category: undefined,
    }))

    const source = detectSource(data.store_name || '')

    return {
      source: source !== 'manual' ? source : detectStoreSource(data.store_name),
      receipt_date: data.receipt_date || new Date().toISOString().split('T')[0],
      line_items: lineItems,
      subtotal: Number(data.subtotal) || lineItems.reduce((s, i) => s + i.total, 0),
      tax: Number(data.tax) || 0,
      total: Number(data.total) || 0,
      store_name: data.store_name || undefined,
      store_location: data.store_location || undefined,
    }
  } catch {
    return null
  }
}

function detectStoreSource(name: string): ParsedReceipt['source'] {
  if (!name) return 'other'
  const lower = name.toLowerCase()
  if (lower.includes('home depot') || lower.includes('homedepot')) return 'home_depot'
  if (lower.includes('lowe')) return 'lowes'
  if (lower.includes('crawford')) return 'crawford'
  if (lower.includes('platt')) return 'platt'
  return 'other'
}

// ── File to Base64 helper ────────────────────────────────────────────────────

export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      // Strip data URL prefix: "data:image/jpeg;base64,..."
      const base64 = result.split(',')[1]
      resolve(base64)
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}
