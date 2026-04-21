// @ts-nocheck
/**
 * V15rPriceBookPanel.tsx — Price Book Management Panel (v15r FAITHFUL PORT)
 *
 * Features:
 * - Items grouped by category (cat field)
 * - Table columns: Name | Source | Unit | Cost | Client Price | Notes/Spec | Product ID | Actions
 * - NO supplier cost column — replaced with Notes/Spec field
 * - Notes field: free text per item (outdoor rated, 20A only, Home Depot SKU #12345, etc)
 * - Product ID column: shows pidBlock or pidBand or id
 * - Client price = cost × (1 + markup/100)
 * - Expand/collapse categories
 * - Add/edit/delete items
 * - Search/filter by name
 * - Copy Client Price button per row
 * - AI Suggest button per category
 */

import { useMemo, useState, useEffect, useCallback, useRef } from 'react'
import { ChevronDown, ChevronUp, Plus, Search, Edit2, Trash2, AlertCircle, Copy, Sparkles, ExternalLink, Upload, FileText, FileSpreadsheet, X, Check, Download } from 'lucide-react'
import { getBackupData, saveBackupData, markChanged, type BackupData, type BackupPriceBookItem } from '@/services/backupDataService'
import { pushState } from '@/services/undoRedoService'
import { callClaude, extractText } from '@/services/claudeProxy'

// ── CDN LOADERS ──────────────────────────────────────────────────────────────

/** Load PDF.js from CDN for text extraction */
function loadPdfJs(): Promise<any> {
  if ((window as any).pdfjsLib) return Promise.resolve((window as any).pdfjsLib)
  return new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.0.379/build/pdf.min.mjs'
    s.type = 'module'
    s.onload = () => {
      // pdf.min.mjs sets pdfjsLib on globalThis in module builds — fallback to dynamic import
      setTimeout(() => resolve((window as any).pdfjsLib), 100)
    }
    s.onerror = () => reject(new Error('Failed to load PDF.js'))
    document.head.appendChild(s)
  })
}

/** Load Papa Parse from CDN for CSV parsing */
function loadPapaParse(): Promise<any> {
  if ((window as any).Papa) return Promise.resolve((window as any).Papa)
  return new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = 'https://cdn.jsdelivr.net/npm/papaparse@5.4.1/papaparse.min.js'
    s.onload = () => resolve((window as any).Papa)
    s.onerror = () => reject(new Error('Failed to load Papa Parse'))
    document.head.appendChild(s)
  })
}

/** Load SheetJS from CDN for Excel parsing */
function loadSheetJS(): Promise<any> {
  if ((window as any).XLSX) return Promise.resolve((window as any).XLSX)
  return new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js'
    s.onload = () => resolve((window as any).XLSX)
    s.onerror = () => reject(new Error('Failed to load SheetJS'))
    document.head.appendChild(s)
  })
}

// ── IMPORT TYPES ─────────────────────────────────────────────────────────────

interface ImportRow {
  name: string
  cost: number
  unit: string
  cat: string
  src: string
  selected: boolean
}

// ── PDF TEXT PARSER ──────────────────────────────────────────────────────────

async function parsePriceBookPDF(file: File): Promise<ImportRow[]> {
  // Use a UMD build that actually sets window.pdfjsLib
  if (!(window as any).pdfjsLib) {
    await new Promise<void>((resolve, reject) => {
      const s = document.createElement('script')
      s.src = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js'
      s.onload = () => {
        const lib = (window as any).pdfjsLib
        if (lib) lib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js'
        resolve()
      }
      s.onerror = () => reject(new Error('Failed to load PDF.js'))
      document.head.appendChild(s)
    })
  }
  const pdfjsLib = (window as any).pdfjsLib
  if (!pdfjsLib) throw new Error('PDF.js not available')

  const arrayBuffer = await file.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise
  const allLines: string[] = []

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const textContent = await page.getTextContent()
    const items = textContent.items as any[]
    // Group items by y-position to reconstruct lines
    const lineMap: Record<number, string[]> = {}
    items.forEach((item: any) => {
      const y = Math.round(item.transform[5])
      if (!lineMap[y]) lineMap[y] = []
      lineMap[y].push(item.str)
    })
    const sortedYs = Object.keys(lineMap).map(Number).sort((a, b) => b - a)
    sortedYs.forEach(y => {
      const line = lineMap[y].join(' ').trim()
      if (line) allLines.push(line)
    })
  }

  // Heuristic: try to parse table-like lines
  // Look for lines containing a price pattern ($X.XX or just X.XX)
  const pricePattern = /\$?\d+\.\d{2}/
  const rows: ImportRow[] = []

  allLines.forEach((line, idx) => {
    const priceMatch = line.match(pricePattern)
    if (!priceMatch) return

    const cost = parseFloat(priceMatch[0].replace('$', ''))
    if (cost <= 0 || cost > 100000) return

    // Extract name: everything before the price
    const priceIdx = line.indexOf(priceMatch[0])
    let name = line.substring(0, priceIdx).trim()
    // Extract unit from after the price (common patterns: EA, FT, RL, LF, BOX, etc.)
    const afterPrice = line.substring(priceIdx + priceMatch[0].length).trim()
    const unitMatch = afterPrice.match(/^(EA|FT|RL|LF|BOX|PKG|ROLL|SET|PC|PR|BG|CS|CT|CY|DZ|GL|LB|OZ|PL|SF|SY|EACH|FOOT|FEET|PAIR)/i)
    const unit = unitMatch ? unitMatch[1].toUpperCase() : 'EA'

    // Clean up name
    name = name.replace(/[\t|]+/g, ' ').replace(/\s{2,}/g, ' ').trim()
    if (name.length < 2 || name.length > 200) return

    rows.push({
      name,
      cost,
      unit,
      cat: 'PDF Imported',
      src: file.name.replace(/\.pdf$/i, ''),
      selected: true,
    })
  })

  return rows
}

// ── CSV / EXCEL PARSER ──────────────────────────────────────────────────────

interface ColumnMapping {
  name: number | null
  cost: number | null
  unit: number | null
  cat: number | null
  src: number | null
}

const HEADER_ALIASES: Record<keyof ColumnMapping, string[]> = {
  name: ['name', 'item', 'description', 'product', 'material', 'item name', 'product name', 'desc'],
  cost: ['price', 'cost', 'rate', 'unit price', 'unit cost', 'amount', 'each'],
  unit: ['unit', 'uom', 'unit of measure', 'measure', 'units'],
  cat: ['category', 'cat', 'group', 'type', 'section'],
  src: ['supplier', 'src', 'vendor', 'source', 'store', 'brand'],
}

function autoDetectColumns(headers: string[]): { mapping: ColumnMapping, confident: boolean } {
  const mapping: ColumnMapping = { name: null, cost: null, unit: null, cat: null, src: null }
  const lowerHeaders = headers.map(h => (h || '').toLowerCase().trim())

  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
    const idx = lowerHeaders.findIndex(h => aliases.includes(h))
    if (idx >= 0) mapping[field as keyof ColumnMapping] = idx
  }

  // Confident if we at least found name and cost
  const confident = mapping.name !== null && mapping.cost !== null
  return { mapping, confident }
}

async function parseCSV(file: File): Promise<{ headers: string[], rows: string[][] }> {
  const Papa = await loadPapaParse()
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      complete: (result: any) => {
        const data = result.data as string[][]
        if (data.length < 2) return reject(new Error('CSV has no data rows'))
        resolve({ headers: data[0], rows: data.slice(1).filter((r: string[]) => r.some(c => c && c.trim())) })
      },
      error: (err: any) => reject(err),
    })
  })
}

async function parseExcel(file: File): Promise<{ headers: string[], rows: string[][] }> {
  const XLSX = await loadSheetJS()
  const arrayBuffer = await file.arrayBuffer()
  const workbook = XLSX.read(arrayBuffer, { type: 'array' })
  const firstSheet = workbook.Sheets[workbook.SheetNames[0]]
  const data: string[][] = XLSX.utils.sheet_to_json(firstSheet, { header: 1, defval: '' })
  if (data.length < 2) throw new Error('Spreadsheet has no data rows')
  return { headers: data[0].map(String), rows: data.slice(1).filter((r: string[]) => r.some(c => c && String(c).trim())) }
}

function applyMapping(rows: string[][], mapping: ColumnMapping): ImportRow[] {
  return rows.map(row => {
    const name = mapping.name !== null ? (row[mapping.name] || '').trim() : ''
    const costRaw = mapping.cost !== null ? row[mapping.cost] : '0'
    const cost = parseFloat(String(costRaw).replace(/[$,]/g, '')) || 0
    const unit = mapping.unit !== null ? (row[mapping.unit] || 'EA').trim() : 'EA'
    const cat = mapping.cat !== null ? (row[mapping.cat] || 'Imported').trim() : 'Imported'
    const src = mapping.src !== null ? (row[mapping.src] || '').trim() : ''
    return { name, cost, unit, cat: cat || 'Imported', src, selected: true }
  }).filter(r => r.name.length >= 2 && r.cost > 0)
}

// ── IMPORT PREVIEW MODAL ────────────────────────────────────────────────────

function ImportPreviewModal({
  items,
  onConfirm,
  onCancel,
  onToggle,
  onToggleAll,
}: {
  items: ImportRow[]
  onConfirm: () => void
  onCancel: () => void
  onToggle: (idx: number) => void
  onToggleAll: (val: boolean) => void
}) {
  const selectedCount = items.filter(i => i.selected).length
  const allSelected = selectedCount === items.length

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-[var(--bg-secondary)] border border-gray-700 rounded-xl max-w-3xl w-full max-h-[80vh] flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-700">
          <div>
            <h3 className="text-lg font-bold text-gray-100">Import Preview</h3>
            <p className="text-xs text-gray-400 mt-0.5">{selectedCount} of {items.length} items selected</p>
          </div>
          <button onClick={onCancel} className="p-1.5 hover:bg-gray-700 rounded-lg transition text-gray-400 hover:text-gray-200">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Table */}
        <div className="flex-1 overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-[var(--bg-card)]">
              <tr className="text-xs text-gray-400 uppercase">
                <th className="px-4 py-2 text-left w-10">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={(e) => onToggleAll(e.target.checked)}
                    className="w-4 h-4 rounded accent-emerald-500"
                  />
                </th>
                <th className="px-2 py-2 text-left">Item Name</th>
                <th className="px-2 py-2 text-left">Category</th>
                <th className="px-2 py-2 text-right">Cost</th>
                <th className="px-2 py-2 text-left">Unit</th>
                <th className="px-2 py-2 text-left">Supplier</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, idx) => (
                <tr
                  key={idx}
                  className={`border-t border-gray-700/50 ${item.selected ? '' : 'opacity-40'} hover:bg-gray-800/30 transition`}
                >
                  <td className="px-4 py-2">
                    <input
                      type="checkbox"
                      checked={item.selected}
                      onChange={() => onToggle(idx)}
                      className="w-4 h-4 rounded accent-emerald-500"
                    />
                  </td>
                  <td className="px-2 py-2 text-gray-200">{item.name}</td>
                  <td className="px-2 py-2 text-gray-400">{item.cat}</td>
                  <td className="px-2 py-2 text-right text-emerald-400 font-mono">${item.cost.toFixed(2)}</td>
                  <td className="px-2 py-2 text-gray-400">{item.unit}</td>
                  <td className="px-2 py-2 text-gray-400">{item.src}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-gray-700">
          <button
            onClick={onCancel}
            className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-lg text-sm font-medium transition"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={selectedCount === 0}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg text-sm font-medium flex items-center gap-2 transition"
          >
            <Check className="w-4 h-4" />
            Import {selectedCount} Items
          </button>
        </div>
      </div>
    </div>
  )
}

// ── COLUMN MAPPING MODAL ────────────────────────────────────────────────────

function ColumnMappingModal({
  headers,
  mapping,
  onConfirm,
  onCancel,
  onChangeMapping,
}: {
  headers: string[]
  mapping: ColumnMapping
  onConfirm: () => void
  onCancel: () => void
  onChangeMapping: (field: keyof ColumnMapping, colIdx: number | null) => void
}) {
  const fields: { key: keyof ColumnMapping, label: string, required: boolean }[] = [
    { key: 'name', label: 'Item Name', required: true },
    { key: 'cost', label: 'Cost / Price', required: true },
    { key: 'unit', label: 'Unit (UOM)', required: false },
    { key: 'cat', label: 'Category', required: false },
    { key: 'src', label: 'Supplier / Source', required: false },
  ]

  const canConfirm = mapping.name !== null && mapping.cost !== null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-[var(--bg-secondary)] border border-gray-700 rounded-xl max-w-lg w-full shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-700">
          <div>
            <h3 className="text-lg font-bold text-gray-100">Map Columns</h3>
            <p className="text-xs text-gray-400 mt-0.5">Assign spreadsheet columns to price book fields</p>
          </div>
          <button onClick={onCancel} className="p-1.5 hover:bg-gray-700 rounded-lg transition text-gray-400 hover:text-gray-200">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-3">
          {fields.map(f => (
            <div key={f.key} className="flex items-center justify-between gap-4">
              <label className="text-sm text-gray-300 w-36 flex-shrink-0">
                {f.label} {f.required && <span className="text-red-400">*</span>}
              </label>
              <select
                value={mapping[f.key] ?? ''}
                onChange={(e) => onChangeMapping(f.key, e.target.value === '' ? null : Number(e.target.value))}
                className="flex-1 px-3 py-2 bg-[var(--bg-input)] border border-gray-600 rounded-lg text-sm text-[var(--text-primary)] focus:outline-none focus:border-emerald-500"
              >
                <option value="">— Skip —</option>
                {headers.map((h, i) => (
                  <option key={i} value={i}>{h || `Column ${i + 1}`}</option>
                ))}
              </select>
            </div>
          ))}
        </div>

        <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-gray-700">
          <button onClick={onCancel} className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-lg text-sm font-medium transition">
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={!canConfirm}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg text-sm font-medium transition"
          >
            Apply Mapping
          </button>
        </div>
      </div>
    </div>
  )
}

// ── CATEGORY RESOLUTION ─────────────────────────────────────────────────────

function resolveCategory(item: any): string {
  if (item.cat && item.cat !== 'PDF Imported') return item.cat
  const name = (item.name || '').toLowerCase()
  if (/romex|thhn|mc cable|awg|stranded|nm-b|uf-b/.test(name)) return 'Wire'
  if (/emt|pvc|flex|conduit|rigid|liquidtight/.test(name)) return 'Conduit'
  if (/\bbox\b|enclosure|junction/.test(name)) return 'Boxes'
  if (/breaker|panel|disconnect|loadcenter|load center/.test(name)) return 'Panels & Disconnects'
  if (/receptacle|switch|gfci|dimmer|outlet|toggle/.test(name)) return 'Devices'
  if (/fitting|connector|coupling|strap|clamp|bushing/.test(name)) return 'Conduit Fittings'
  return item.cat || 'Uncategorized'
}

// ── UTILITY FUNCTION ────────────────────────────────────────────────────────

function num(val: any): number {
  const n = parseFloat(val)
  return isNaN(n) ? 0 : n
}

/**
 * getPriceBookSource — Reads price book data from localStorage.
 * The old HTML app stores data under key 'poweron_v2' (with data.priceBook as a flat array).
 * The React app stores under 'poweron_backup_data'.
 * Try 'poweron_v2' first, fall back to 'poweron_backup_data'.
 */
function getPriceBookSource(): { backup: BackupData | null, priceBookItems: BackupPriceBookItem[], source: string } {
  // 1. Try poweron_v2 key first (HTML app's localStorage key)
  try {
    const v2Raw = localStorage.getItem('poweron_v2')
    if (v2Raw) {
      const v2Data = JSON.parse(v2Raw)
      if (v2Data && Array.isArray(v2Data.priceBook) && v2Data.priceBook.length > 0) {
        console.log('[PriceBook] Loaded from poweron_v2 key — items:', v2Data.priceBook.length)
        return { backup: v2Data as BackupData, priceBookItems: v2Data.priceBook, source: 'poweron_v2' }
      }
    }
  } catch (e) {
    console.warn('[PriceBook] Failed to parse poweron_v2:', e)
  }

  // 2. Fall back to poweron_backup_data key (React app's localStorage key)
  const backup = getBackupData()
  if (!backup) return { backup: null, priceBookItems: [], source: 'none' }

  const rawPB = backup.priceBook
  const items: BackupPriceBookItem[] = Array.isArray(rawPB) ? rawPB : []
  console.log('[PriceBook] Loaded from poweron_backup_data key — items:', items.length)
  return { backup, priceBookItems: items, source: 'poweron_backup_data' }
}

export default function V15rPriceBookPanel() {
  // ── Reactive backup data ────────────────────────────────────────────────
  const [pbSource, setPbSource] = useState(() => getPriceBookSource())

  const refreshBackup = useCallback(() => {
    setPbSource(getPriceBookSource())
  }, [])

  useEffect(() => {
    const onStorage = () => refreshBackup()
    window.addEventListener('storage', onStorage)
    const timer = setInterval(refreshBackup, 2000)
    const deferred = setTimeout(refreshBackup, 1500)
    return () => {
      window.removeEventListener('storage', onStorage)
      clearInterval(timer)
      clearTimeout(deferred)
    }
  }, [refreshBackup])

  const backup = pbSource.backup
  const priceBookItems = pbSource.priceBookItems

  if (!backup) return <NoData />

  const settings = backup.settings || {}
  const markup = settings.markup ?? 30 // pulled from Settings tab; 30% default only if unset

  const [searchQuery, setSearchQuery] = useState('')
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set())
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editNotes, setEditNotes] = useState('')
  const [editingNameId, setEditingNameId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  const [editingPriceId, setEditingPriceId] = useState<string | null>(null)
  const [editingPrice, setEditingPrice] = useState('')
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)
  const [aiSuggestion, setAiSuggestion] = useState<string | null>(null)
  const [aiLoading, setAiLoading] = useState(false)

  // ── Import state ──────────────────────────────────────────────────────────
  const pdfInputRef = useRef<HTMLInputElement>(null)
  const csvInputRef = useRef<HTMLInputElement>(null)
  const [importItems, setImportItems] = useState<ImportRow[] | null>(null)
  const [importLoading, setImportLoading] = useState(false)
  const [importToast, setImportToast] = useState<string | null>(null)
  // Column mapping state for CSV/Excel
  const [mappingHeaders, setMappingHeaders] = useState<string[] | null>(null)
  const [mappingRows, setMappingRows] = useState<string[][] | null>(null)
  const [columnMapping, setColumnMapping] = useState<ColumnMapping>({ name: null, cost: null, unit: null, cat: null, src: null })

  // ── PDF import handler ────────────────────────────────────────────────────
  const handlePdfImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (pdfInputRef.current) pdfInputRef.current.value = ''
    setImportLoading(true)
    try {
      const rows = await parsePriceBookPDF(file)
      if (rows.length === 0) {
        setImportToast('No items could be extracted from this PDF')
        setTimeout(() => setImportToast(null), 4000)
      } else {
        setImportItems(rows)
      }
    } catch (err: any) {
      console.error('[PriceBook] PDF parse error:', err)
      setImportToast('Failed to parse PDF: ' + (err.message || 'Unknown error'))
      setTimeout(() => setImportToast(null), 4000)
    }
    setImportLoading(false)
  }

  // ── CSV/Excel import handler ──────────────────────────────────────────────
  const handleCsvExcelImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (csvInputRef.current) csvInputRef.current.value = ''
    setImportLoading(true)
    try {
      const ext = file.name.split('.').pop()?.toLowerCase()
      let headers: string[]
      let rows: string[][]

      if (ext === 'csv' || ext === 'tsv') {
        const result = await parseCSV(file)
        headers = result.headers
        rows = result.rows
      } else {
        const result = await parseExcel(file)
        headers = result.headers
        rows = result.rows
      }

      // Auto-detect columns
      const { mapping, confident } = autoDetectColumns(headers)

      if (confident) {
        // Directly show preview
        const parsed = applyMapping(rows, mapping)
        if (parsed.length === 0) {
          setImportToast('No valid items found in file')
          setTimeout(() => setImportToast(null), 4000)
        } else {
          setImportItems(parsed)
        }
      } else {
        // Show column mapping modal
        setMappingHeaders(headers)
        setMappingRows(rows)
        setColumnMapping(mapping)
      }
    } catch (err: any) {
      console.error('[PriceBook] CSV/Excel parse error:', err)
      setImportToast('Failed to parse file: ' + (err.message || 'Unknown error'))
      setTimeout(() => setImportToast(null), 4000)
    }
    setImportLoading(false)
  }

  // ── Column mapping confirm ────────────────────────────────────────────────
  const handleMappingConfirm = () => {
    if (!mappingRows) return
    const parsed = applyMapping(mappingRows, columnMapping)
    setMappingHeaders(null)
    setMappingRows(null)
    if (parsed.length === 0) {
      setImportToast('No valid items found with this mapping')
      setTimeout(() => setImportToast(null), 4000)
    } else {
      setImportItems(parsed)
    }
  }

  // ── Import confirm: merge into priceBook ──────────────────────────────────
  const handleImportConfirm = () => {
    if (!importItems || !backup) return
    const selected = importItems.filter(i => i.selected)
    if (selected.length === 0) return

    pushState()

    // Build existing name+src set for dedup
    const existing = new Set(
      priceBookItems.map(i => `${(i.name || '').toLowerCase()}|${(i.src || '').toLowerCase()}`)
    )

    const newItems: BackupPriceBookItem[] = []
    selected.forEach((item, idx) => {
      const key = `${item.name.toLowerCase()}|${item.src.toLowerCase()}`
      if (existing.has(key)) return // skip duplicate
      existing.add(key)
      newItems.push({
        id: `pdf_${Date.now()}_${idx}`,
        cat: item.cat,
        name: item.name,
        cost: item.cost,
        src: item.src,
        unit: item.unit,
        pack: 1,
        waste: 0,
        link: '',
        pidBand: '',
        pidBlock: '',
        legacyId: `pdf_${Date.now()}_${idx}`,
        notes: '',
      })
    })

    // Merge into backup.priceBook
    if (Array.isArray(backup.priceBook)) {
      backup.priceBook = [...backup.priceBook, ...newItems]
    } else {
      backup.priceBook = [...priceBookItems, ...newItems]
    }

    // Save to poweron_v2 + poweron_backup_data
    persistPriceBook()
    // Mark changed — 30s periodic sync (startPeriodicSync) will handle Supabase write
    markChanged('priceBook')

    setImportItems(null)
    refreshBackup()

    setImportToast(`${newItems.length} items added to Price Book — saved`)
    setTimeout(() => setImportToast(null), 5000)
  }

  // ── Import preview toggle handlers ────────────────────────────────────────
  const handleToggleImportItem = (idx: number) => {
    if (!importItems) return
    const updated = [...importItems]
    updated[idx] = { ...updated[idx], selected: !updated[idx].selected }
    setImportItems(updated)
  }

  const handleToggleAllImport = (val: boolean) => {
    if (!importItems) return
    setImportItems(importItems.map(i => ({ ...i, selected: val })))
  }

  // Filter items by search query
  const filteredItems = useMemo(() => {
    if (!searchQuery.trim()) return priceBookItems
    const query = searchQuery.toLowerCase()
    return priceBookItems.filter((item) => {
      const name = (item.name || '').toLowerCase()
      const cat = (item.cat || '').toLowerCase()
      const src = (item.src || '').toLowerCase()
      return name.includes(query) || cat.includes(query) || src.includes(query)
    })
  }, [priceBookItems, searchQuery])

  // Group filtered items by category using resolveCategory
  const groupedItems = useMemo(() => {
    const grouped: Record<string, BackupPriceBookItem[]> = {}
    filteredItems.forEach((item) => {
      const cat = resolveCategory(item)
      if (!grouped[cat]) grouped[cat] = []
      grouped[cat].push(item)
    })
    return Object.keys(grouped)
      .sort()
      .reduce((acc, cat) => {
        acc[cat] = grouped[cat]
        return acc
      }, {} as Record<string, BackupPriceBookItem[]>)
  }, [filteredItems])

  const categories = Object.keys(groupedItems)

  const toggleCategory = (cat: string) => {
    const newSet = new Set(expandedCategories)
    if (newSet.has(cat)) {
      newSet.delete(cat)
    } else {
      newSet.add(cat)
    }
    setExpandedCategories(newSet)
  }

  const toggleExpandAll = () => {
    if (expandedCategories.size === categories.length) {
      setExpandedCategories(new Set())
    } else {
      setExpandedCategories(new Set(categories))
    }
  }

  // Calculate customer price with markup
  const getClientPrice = (cost: number) => {
    return cost * (1 + markup / 100)
  }

  // Get source badge color
  const getSourceColor = (src: string) => {
    const s = (src || '').toLowerCase()
    if (s.includes('crawford')) return 'bg-green-500/20 text-green-400 border-green-500/30'
    if (s.includes('home depot')) return 'bg-orange-500/20 text-orange-400 border-orange-500/30'
    if (s.includes('lowes') || s.includes('lowe')) return 'bg-blue-500/20 text-blue-400 border-blue-500/30'
    if (s.includes('elec') || s.includes('supplier')) return 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30'
    return 'bg-gray-500/20 text-gray-400 border-gray-500/30'
  }

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      alert('Copied: ' + text)
    })
  }

  const handleSupplierLink = (item: BackupPriceBookItem) => {
    // Check if item.link is a valid URL (starts with http/https)
    if (item.link && (item.link.startsWith('http://') || item.link.startsWith('https://'))) {
      window.open(item.link, '_blank')
    } else {
      // Construct a Google search URL for the item name + "electrical supplier"
      const searchQuery = encodeURIComponent(item.name + ' electrical supplier')
      const googleSearchUrl = `https://www.google.com/search?q=${searchQuery}`
      window.open(googleSearchUrl, '_blank')
    }
  }

  const startEditing = (item: BackupPriceBookItem) => {
    setEditingId(item.id)
    setEditNotes(item.notes || '')
  }

  /** Persist price book changes to the correct localStorage key */
  const persistPriceBook = () => {
    if (pbSource.source === 'poweron_v2') {
      try {
        localStorage.setItem('poweron_v2', JSON.stringify(backup))
      } catch (e) {
        console.error('[PriceBook] Failed to save to poweron_v2:', e)
      }
    }
    // Always also save to React backup key for consistency
    saveBackupData(backup)
  }

  const saveNotes = (id: string) => {
    pushState()
    if (!Array.isArray(backup.priceBook)) backup.priceBook = []
    const idx = (backup.priceBook as any[]).findIndex((item: any) => item.id === id)
    if (idx >= 0) (backup.priceBook as any[])[idx].notes = editNotes
    persistPriceBook()
    setEditingId(null)
    refreshBackup()
  }

  const deleteItem = (id: string) => {
    if (!confirm('Delete this item?')) return
    pushState()
    if (!Array.isArray(backup.priceBook)) backup.priceBook = []
    backup.priceBook = (backup.priceBook as any[]).filter((item: any) => item.id !== id)
    persistPriceBook()
    refreshBackup()
  }

  return (
    <div className="space-y-4 p-5 min-h-screen bg-[var(--bg-secondary)]">
      {/* HEADER */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-100 mb-1">Price Book</h1>
          <p className="text-sm text-gray-400">{priceBookItems.length} total items</p>
        </div>
        <button className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-medium flex items-center gap-2 transition">
          <Plus className="w-4 h-4" />
          Add Item
        </button>
      </div>

      {/* HIDDEN FILE INPUTS */}
      <input ref={pdfInputRef} type="file" accept=".pdf" className="hidden" onChange={handlePdfImport} />
      <input ref={csvInputRef} type="file" accept=".csv,.xlsx,.xls,.tsv" className="hidden" onChange={handleCsvExcelImport} />

      {/* SEARCH + CONTROLS */}
      <div className="bg-[var(--bg-card)] rounded-lg p-4 space-y-3">
        <div className="flex gap-3 flex-wrap">
          <div className="flex-1 relative min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
            <input
              type="text"
              placeholder="Search price book..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-3 py-2 bg-[var(--bg-secondary)] border border-gray-600 rounded-lg text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-emerald-500"
            />
          </div>
          <button
            onClick={toggleExpandAll}
            className="px-3 py-2 bg-[var(--bg-secondary)] border border-gray-600 hover:border-gray-500 rounded-lg text-sm text-gray-300 transition flex items-center gap-1"
          >
            {expandedCategories.size === categories.length ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            {expandedCategories.size === categories.length ? 'Collapse' : 'Expand'} All
          </button>
          <button
            onClick={() => pdfInputRef.current?.click()}
            disabled={importLoading}
            className="px-3 py-2 bg-blue-600/20 border border-blue-500/30 hover:bg-blue-600/30 rounded-lg text-sm text-blue-300 transition flex items-center gap-1.5 disabled:opacity-40"
          >
            <FileText className="w-4 h-4" />
            Import PDF
          </button>
          <button
            onClick={() => csvInputRef.current?.click()}
            disabled={importLoading}
            className="px-3 py-2 bg-purple-600/20 border border-purple-500/30 hover:bg-purple-600/30 rounded-lg text-sm text-purple-300 transition flex items-center gap-1.5 disabled:opacity-40"
          >
            <FileSpreadsheet className="w-4 h-4" />
            Import CSV / Excel
          </button>
          <button
            onClick={() => {
              const data = JSON.stringify({ priceBook: backup.priceBook || [] }, null, 2)
              const blob = new Blob([data], { type: 'application/json' })
              const url = URL.createObjectURL(blob)
              const a = document.createElement('a')
              a.href = url
              a.download = `pricebook_backup_${new Date().toISOString().slice(0, 10)}.json`
              a.click()
              URL.revokeObjectURL(url)
            }}
            className="px-3 py-2 bg-gray-700/50 text-gray-300 rounded-lg text-xs hover:bg-gray-600/50 flex items-center gap-1.5"
          >
            <Download className="w-3.5 h-3.5" /> Export
          </button>
        </div>
        <p className="text-xs text-gray-400">
          Showing {filteredItems.length} of {priceBookItems.length} items
          {importLoading && <span className="ml-2 text-yellow-400 animate-pulse">Parsing file...</span>}
        </p>
      </div>

      {/* IMPORT TOAST */}
      {importToast && (
        <div className="fixed top-4 right-4 z-50 bg-emerald-600/90 text-white px-4 py-3 rounded-lg text-sm font-medium shadow-lg flex items-center gap-2 animate-fade-in">
          <Check className="w-4 h-4" />
          {importToast}
        </div>
      )}

      {/* IMPORT PREVIEW MODAL */}
      {importItems && (
        <ImportPreviewModal
          items={importItems}
          onConfirm={handleImportConfirm}
          onCancel={() => setImportItems(null)}
          onToggle={handleToggleImportItem}
          onToggleAll={handleToggleAllImport}
        />
      )}

      {/* COLUMN MAPPING MODAL */}
      {mappingHeaders && (
        <ColumnMappingModal
          headers={mappingHeaders}
          mapping={columnMapping}
          onConfirm={handleMappingConfirm}
          onCancel={() => { setMappingHeaders(null); setMappingRows(null) }}
          onChangeMapping={(field, colIdx) => setColumnMapping(prev => ({ ...prev, [field]: colIdx }))}
        />
      )}

      {/* AI SUGGESTION DISPLAY */}
      {aiSuggestion && (
        <div className="mt-3 p-3 bg-purple-900/20 border border-purple-500/20 rounded-lg">
          <div className="flex justify-between items-start mb-2">
            <span className="text-purple-400 text-xs font-medium">AI Price Analysis</span>
            <button onClick={() => setAiSuggestion(null)} className="text-gray-500 hover:text-gray-300"><X className="w-3.5 h-3.5" /></button>
          </div>
          <p className="text-gray-300 text-sm whitespace-pre-wrap">{aiSuggestion}</p>
        </div>
      )}

      {/* CATEGORIES */}
      <div className="space-y-3">
        {categories.length === 0 ? (
          <div className="bg-[var(--bg-card)] rounded-lg p-8 text-center">
            <AlertCircle className="w-12 h-12 text-gray-500 mx-auto mb-3" />
            <p className="text-gray-400">No items match your search</p>
          </div>
        ) : (
          categories.map((cat) => {
            const items = groupedItems[cat] || []
            const isExpanded = expandedCategories.has(cat)

            return (
              <div key={cat} className="bg-[var(--bg-card)] rounded-lg overflow-hidden">
                {/* CATEGORY HEADER */}
                <button
                  onClick={() => toggleCategory(cat)}
                  className="w-full px-4 py-3 flex items-center justify-between hover:bg-[var(--bg-card)] hover:brightness-110 transition"
                >
                  <div className="flex items-center gap-3 flex-1 text-left">
                    {isExpanded ? <ChevronUp className="w-5 h-5 text-gray-400" /> : <ChevronDown className="w-5 h-5 text-gray-400" />}
                    <span className="font-medium text-gray-100">{cat}</span>
                  </div>
                  <div className="flex items-center gap-4 text-sm text-gray-400">
                    <span className="bg-[var(--bg-secondary)] px-2 py-1 rounded">{items.length} items</span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        setSelectedCategory(cat)
                        setAiLoading(true)
                        ;(async () => {
                          try {
                            const categoryItems = items
                            const itemSummary = categoryItems.slice(0, 20).map(i => `${i.name}: $${num(i.cost)}`).join(', ')
                            const response = await callClaude({
                              system: 'You are a pricing advisor for Power On Solutions, a C-10 electrical contractor in Coachella Valley, CA. Give concise, actionable advice.',
                              messages: [{ role: 'user', content: `Category: ${cat}\nItems: ${itemSummary}\n\nSuggest price optimizations, identify missing items for this category, and flag items that may be outdated in price. Keep response under 200 words.` }],
                              max_tokens: 512,
                            })
                            setAiSuggestion(extractText(response))
                          } catch {
                            setAiSuggestion('Analysis unavailable')
                          }
                          setAiLoading(false)
                        })()
                      }}
                      disabled={aiLoading}
                      className="px-2 py-1 bg-purple-600/20 text-purple-400 text-xs rounded font-semibold hover:bg-purple-600/30 flex items-center gap-1 disabled:opacity-50"
                    >
                      <Sparkles className="w-3 h-3" />
                      {aiLoading ? 'Analyzing...' : 'AI Suggest'}
                    </button>
                  </div>
                </button>

                {/* CATEGORY ITEMS */}
                {isExpanded && (
                  <div className="border-t border-gray-700">
                    {/* TABLE HEADER */}
                    <div className="px-4 py-2 bg-[var(--bg-secondary)] grid grid-cols-12 gap-3 text-xs font-semibold text-gray-400 uppercase">
                      <div className="col-span-2">Name</div>
                      <div className="col-span-1.5">Source</div>
                      <div className="col-span-0.75">Cost</div>
                      <div className="col-span-0.75">Client Price</div>
                      <div className="col-span-3">Notes / Spec</div>
                      <div className="col-span-1.5">Product ID</div>
                      <div className="col-span-2.25">Actions</div>
                    </div>

                    {/* TABLE ROWS */}
                    {items.map((item) => {
                      const clientPrice = getClientPrice(item.cost || 0)
                      const pidDisplay = item.pidBlock || item.pidBand || item.id || '—'
                      const isEditing = editingId === item.id

                      return (
                        <div key={item.id} className="px-4 py-3 border-t border-gray-700 grid grid-cols-12 gap-3 items-center text-sm hover:bg-[var(--bg-card)] hover:brightness-110 transition">
                          <div className="col-span-2 text-gray-100 font-medium">
                            {editingNameId === item.id ? (
                              <input
                                autoFocus
                                type="text"
                                value={editingName}
                                onChange={(e) => setEditingName(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    const trimmed = editingName.trim()
                                    if (trimmed !== '') {
                                      const updated = (backup.priceBook || []).map(pb => pb.id === item.id ? { ...pb, name: trimmed } : pb)
                                      saveBackupData({ ...backup, priceBook: updated })
                                      refreshBackup()
                                    }
                                    setEditingNameId(null)
                                  }
                                  if (e.key === 'Escape') setEditingNameId(null)
                                }}
                                onBlur={() => {
                                  const trimmed = editingName.trim()
                                  if (trimmed !== '' && trimmed !== (item.name || '')) {
                                    const updated = (backup.priceBook || []).map(pb => pb.id === item.id ? { ...pb, name: trimmed } : pb)
                                    saveBackupData({ ...backup, priceBook: updated })
                                    refreshBackup()
                                  }
                                  setEditingNameId(null)
                                }}
                                className="w-full px-2 py-1 bg-[var(--bg-secondary)] border border-gray-600 rounded text-sm text-gray-100 focus:outline-none focus:border-emerald-500"
                              />
                            ) : (
                              <span
                                onClick={() => { setEditingNameId(item.id); setEditingName(item.name || '') }}
                                className="cursor-pointer hover:text-emerald-400 transition"
                                title="Click to edit name"
                              >
                                {item.name || '—'}
                              </span>
                            )}
                          </div>
                          <div className="col-span-1.5">
                            <span className={`inline-block px-2 py-1 rounded text-xs font-medium border ${getSourceColor(item.src)}`}>
                              {(!item.src || item.src === 'PDF Import' || item.src === 'PDF Imported') ? 'N/A' : item.src}
                            </span>
                          </div>
                          <div className="col-span-0.75">
                            {editingPriceId === item.id ? (
                              <input
                                autoFocus
                                type="number"
                                value={editingPrice}
                                onChange={(e) => setEditingPrice(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    const updated = (backup.priceBook || []).map(pb => pb.id === item.id ? { ...pb, cost: num(editingPrice) } : pb)
                                    saveBackupData({ ...backup, priceBook: updated })
                                    setEditingPriceId(null)
                                    refreshBackup()
                                  }
                                  if (e.key === 'Escape') setEditingPriceId(null)
                                }}
                                onBlur={() => {
                                  if (editingPrice !== '') {
                                    const updated = (backup.priceBook || []).map(pb => pb.id === item.id ? { ...pb, cost: num(editingPrice) } : pb)
                                    saveBackupData({ ...backup, priceBook: updated })
                                  }
                                  setEditingPriceId(null)
                                }}
                                className="w-20 px-2 py-0.5 bg-gray-900 border border-cyan-500/50 rounded text-gray-200 text-xs"
                                placeholder="$0.00"
                              />
                            ) : num(item.cost) === 0 ? (
                              <span
                                onClick={() => { setEditingPriceId(item.id); setEditingPrice('') }}
                                className="text-xs px-1.5 py-0.5 bg-yellow-500/20 text-yellow-400 rounded cursor-pointer hover:bg-yellow-500/30"
                                title="Click to set price"
                              >
                                No price
                              </span>
                            ) : (
                              <div
                                onClick={() => { setEditingPriceId(item.id); setEditingPrice(String(item.cost)) }}
                                className="text-blue-400 font-medium text-xs cursor-pointer hover:text-blue-300"
                                title="Click to edit cost"
                              >
                                ${(item.cost || 0).toFixed(2)}
                              </div>
                            )}
                          </div>
                          <div className="col-span-0.75 text-emerald-400 font-medium text-xs">
                            {num(item.cost) > 0 ? `$${clientPrice.toFixed(2)}` : '—'}
                          </div>
                          <div className="col-span-3">
                            {isEditing ? (
                              <input
                                type="text"
                                value={editNotes}
                                onChange={(e) => setEditNotes(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    saveNotes(item.id)
                                  }
                                }}
                                onBlur={() => saveNotes(item.id)}
                                placeholder="e.g., outdoor rated, 20A only, SKU #12345"
                                className="w-full px-2 py-1 bg-[var(--bg-secondary)] border border-gray-600 rounded text-xs text-gray-100 placeholder-gray-500 focus:outline-none focus:border-emerald-500"
                              />
                            ) : (
                              <span
                                onClick={() => startEditing(item)}
                                className="text-gray-400 text-xs cursor-pointer hover:text-gray-300 transition"
                              >
                                {item.notes || '—'}
                              </span>
                            )}
                          </div>
                          <div className="col-span-1.5 text-gray-400 font-mono text-xs break-all">{pidDisplay}</div>
                          <div className="col-span-2.25 flex items-center gap-1.5">
                            <button
                              onClick={() => handleSupplierLink(item)}
                              className="p-1.5 hover:bg-[var(--bg-secondary)] rounded transition text-gray-400 hover:text-blue-400"
                              title="Visit supplier link or search for item"
                            >
                              <ExternalLink className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => copyToClipboard(clientPrice.toFixed(2))}
                              className="p-1.5 hover:bg-[var(--bg-secondary)] rounded transition text-gray-400 hover:text-emerald-400 flex items-center gap-1"
                              title="Copy client price to clipboard"
                            >
                              <Copy className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => startEditing(item)}
                              className="p-1.5 hover:bg-[var(--bg-secondary)] rounded transition text-gray-400 hover:text-gray-300"
                              title="Edit notes"
                            >
                              <Edit2 className="w-4 h-4" />
                            </button>
                            {isEditing && (
                              <button
                                onClick={() => saveNotes(item.id)}
                                className="px-2 py-1 bg-emerald-600/30 text-emerald-300 text-xs rounded hover:bg-emerald-600/40 transition"
                              >
                                Save
                              </button>
                            )}
                            <button
                              onClick={() => deleteItem(item.id)}
                              className="p-1.5 hover:bg-red-500/10 rounded transition text-gray-400 hover:text-red-400"
                              title="Delete item"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>

      {/* FOOTER INFO */}
      <div className="bg-[var(--bg-card)] rounded-lg p-4 text-xs text-gray-400 space-y-2">
        <p><strong>Markup Setting:</strong> {markup}% (client price = cost × {((1 + markup / 100)).toFixed(2)})</p>
        <p><strong>Source Colors:</strong> Crawford (green) · Home Depot (orange) · Lowes (blue) · Elec Supplier (cyan)</p>
      </div>
    </div>
  )
}

function NoData() {
  return (
    <div className="flex items-center justify-center min-h-screen bg-[var(--bg-secondary)]">
      <div className="text-center">
        <AlertCircle className="w-12 h-12 text-gray-500 mx-auto mb-4" />
        <p className="text-gray-400">No backup data available</p>
      </div>
    </div>
  )
}
