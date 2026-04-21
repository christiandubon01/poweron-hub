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
import { ChevronDown, ChevronUp, Plus, Search, Edit2, Trash2, AlertCircle, Copy, Sparkles, ExternalLink, Upload, FileText, FileSpreadsheet, X, Check, Download, RefreshCw, GripVertical } from 'lucide-react'
import { getBackupData, saveBackupData, markChanged, type BackupData, type BackupPriceBookItem } from '@/services/backupDataService'
import { pushState } from '@/services/undoRedoService'
import { callClaude, extractText } from '@/services/claudeProxy'
import { DndContext, closestCenter, PointerSensor, KeyboardSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, arrayMove, sortableKeyboardCoordinates, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

/** Sortable row wrapper — drag handle floats on left edge, inner grid layout unaffected */
function SortableRow({ id, className, children }: { id: string; className?: string; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }
  return (
    <div ref={setNodeRef} style={style} className={`relative ${className || ''}`}>
      <button
        {...attributes}
        {...listeners}
        type="button"
        className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-3 p-1 cursor-grab active:cursor-grabbing text-gray-400 hover:text-emerald-400 z-10"
        title="Drag to reorder"
        aria-label="Drag to reorder"
      >
        <GripVertical className="w-8 h-6" />
      </button>
      {children}
    </div>
  )
}

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
  const [newMatrixDraft, setNewMatrixDraft] = useState({ cat: '', rangeStart: '', rangeEnd: '', description: '' })
  const [editingMatrixId, setEditingMatrixId] = useState<string | null>(null)
  const [editMatrixDraft, setEditMatrixDraft] = useState({ cat: '', rangeStart: '', rangeEnd: '', description: '' })
  const [editingPidId, setEditingPidId] = useState<string | null>(null)
  const [editingPid, setEditingPid] = useState('')
  const [isMatrixExpanded, setIsMatrixExpanded] = useState(true)
  const [showSummaryModal, setShowSummaryModal] = useState(false)
  const [isSuppliersExpanded, setIsSuppliersExpanded] = useState(true)
  const [editingSrcId, setEditingSrcId] = useState<string | null>(null)
  const [supplierModalMode, setSupplierModalMode] = useState<null | 'add' | 'edit'>(null)
  const [supplierModalEditingId, setSupplierModalEditingId] = useState<string | null>(null)
  const [supplierModalTargetItemId, setSupplierModalTargetItemId] = useState<string | null>(null)
  const SUPPLIER_COLORS = [
    { id: 'gray', label: 'Gray', cls: 'bg-gray-500/20 text-gray-300 border-gray-500/40' },
    { id: 'orange', label: 'Orange', cls: 'bg-orange-500/20 text-orange-400 border-orange-500/40' },
    { id: 'blue', label: 'Blue', cls: 'bg-blue-500/20 text-blue-400 border-blue-500/40' },
    { id: 'cyan', label: 'Cyan', cls: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/40' },
    { id: 'green', label: 'Green', cls: 'bg-green-500/20 text-green-400 border-green-500/40' },
    { id: 'emerald', label: 'Emerald', cls: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40' },
    { id: 'yellow', label: 'Yellow', cls: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/40' },
    { id: 'amber', label: 'Amber', cls: 'bg-amber-500/20 text-amber-400 border-amber-500/40' },
    { id: 'red', label: 'Red', cls: 'bg-red-500/20 text-red-400 border-red-500/40' },
    { id: 'pink', label: 'Pink', cls: 'bg-pink-500/20 text-pink-400 border-pink-500/40' },
    { id: 'purple', label: 'Purple', cls: 'bg-purple-500/20 text-purple-400 border-purple-500/40' },
    { id: 'indigo', label: 'Indigo', cls: 'bg-indigo-500/20 text-indigo-400 border-indigo-500/40' },
    { id: 'teal', label: 'Teal', cls: 'bg-teal-500/20 text-teal-400 border-teal-500/40' },
    { id: 'lime', label: 'Lime', cls: 'bg-lime-500/20 text-lime-400 border-lime-500/40' },
  ]

  const [supplierDraft, setSupplierDraft] = useState({ name: '', location: '', contact: '', phone: '', email: '', website: '', taxId: '', paymentTerms: '', notes: '', color: '' })
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

  // Get source badge color — supplier.color takes precedence, falls back to name-based rule
  const getSourceColor = (src: string) => {
    const s = (src || '').toLowerCase().trim()
    if (!s) return 'bg-gray-500/20 text-gray-400 border-gray-500/30'
    const sup = getSuppliers().find((x: any) => (x.name || '').toLowerCase().trim() === s)
    if (sup && sup.color) {
      const match = SUPPLIER_COLORS.find(c => c.id === sup.color)
      if (match) return match.cls
    }
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

  const handleAddItem = (cat: string) => {
    pushState()
    if (!Array.isArray(backup.priceBook)) backup.priceBook = []
    const newId = `manual_${Date.now()}`
    const autoPid = getNextIdInRange(cat)
    const newItem: BackupPriceBookItem = {
      id: newId,
      cat,
      name: '',
      cost: 0,
      src: '',
      unit: 'EA',
      pack: 1,
      waste: 0,
      link: '',
      pidBand: autoPid,
      pidBlock: autoPid,
      legacyId: newId,
      notes: '',
    }
    backup.priceBook = [...(backup.priceBook as any[]), newItem]
    persistPriceBook()
    markChanged('priceBook')
    refreshBackup()
    setExpandedCategories(prev => new Set(prev).add(cat))
    setEditingNameId(newId)
    setEditingName('')
  }

  // ── ID MATRIX HELPERS ─────────────────────────────────────────────────────

  const getIdMatrix = (): any[] => {
    const m = (backup as any).idMatrix
    return Array.isArray(m) ? m : []
  }

  const persistIdMatrix = (updated: any[]) => {
    pushState()
    ;(backup as any).idMatrix = updated
    saveBackupData(backup)
    markChanged('idMatrix')
    refreshBackup()
  }

  const getNextIdInRange = (cat: string): string => {
    const matrix = getIdMatrix()
    const entry = matrix.find((m: any) => (m.cat || '').toLowerCase() === cat.toLowerCase())
    if (!entry) return ''
    const itemsInCat = priceBookItems.filter((i: any) => (i.cat || '').toLowerCase() === cat.toLowerCase())
    const used = new Set(
      itemsInCat
        .map((i: any) => Number(i.pidBlock || i.pidBand))
        .filter((n: number) => Number.isFinite(n))
    )
    for (let n = entry.rangeStart; n <= entry.rangeEnd; n++) {
      if (!used.has(n)) return String(n)
    }
    return ''
  }

  const isPidOutOfRange = (cat: string, pid: string | number): boolean => {
    const n = Number(pid)
    if (!Number.isFinite(n)) return false
    const matrix = getIdMatrix()
    const entry = matrix.find((m: any) => (m.cat || '').toLowerCase() === (cat || '').toLowerCase())
    if (!entry) return false
    return n < entry.rangeStart || n > entry.rangeEnd
  }

  const countOutOfRangeForCat = (cat: string, rangeStart: number, rangeEnd: number): number => {
    return priceBookItems.filter((i: any) => {
      if ((i.cat || '').toLowerCase() !== (cat || '').toLowerCase()) return false
      const n = Number(i.pidBlock || i.pidBand)
      if (!Number.isFinite(n)) return false
      return n < rangeStart || n > rangeEnd
    }).length
  }

  const handleAddMatrixRow = () => {
    const cat = newMatrixDraft.cat.trim()
    const s = Number(newMatrixDraft.rangeStart)
    const e = Number(newMatrixDraft.rangeEnd)
    if (!cat) { alert('Category required'); return }
    if (!Number.isFinite(s) || !Number.isFinite(e) || s > e) { alert('Invalid range: start must be a number ≤ end'); return }
    const matrix = getIdMatrix()
    if (matrix.some((m: any) => (m.cat || '').toLowerCase() === cat.toLowerCase())) { alert(`Range for "${cat}" already exists — edit the existing row`); return }
    const newEntry = { id: `mtx_${Date.now()}`, cat, rangeStart: s, rangeEnd: e, description: newMatrixDraft.description.trim() || '' }
    persistIdMatrix([...matrix, newEntry])
    setNewMatrixDraft({ cat: '', rangeStart: '', rangeEnd: '', description: '' })
  }

  const handleStartEditMatrix = (entry: any) => {
    setEditingMatrixId(entry.id)
    setEditMatrixDraft({
      cat: entry.cat || '',
      rangeStart: String(entry.rangeStart ?? ''),
      rangeEnd: String(entry.rangeEnd ?? ''),
      description: entry.description || '',
    })
  }

  const handleSaveMatrixRow = (id: string) => {
    const cat = editMatrixDraft.cat.trim()
    const s = Number(editMatrixDraft.rangeStart)
    const e = Number(editMatrixDraft.rangeEnd)
    if (!cat) { alert('Category required'); return }
    if (!Number.isFinite(s) || !Number.isFinite(e) || s > e) { alert('Invalid range: start must be a number ≤ end'); return }
    const matrix = getIdMatrix()
    if (matrix.some((m: any) => m.id !== id && (m.cat || '').toLowerCase() === cat.toLowerCase())) { alert(`Range for "${cat}" already exists — edit that row instead`); return }
    const updated = matrix.map((m: any) => m.id === id ? { ...m, cat, rangeStart: s, rangeEnd: e, description: editMatrixDraft.description.trim() || '' } : m)
    persistIdMatrix(updated)
    setEditingMatrixId(null)
  }

  const handleCancelEditMatrix = () => setEditingMatrixId(null)

  const handleDeleteMatrixRow = (id: string) => {
    if (!confirm('Delete this ID range?')) return
    const matrix = getIdMatrix()
    persistIdMatrix(matrix.filter((m: any) => m.id !== id))
  }

  const handleSeedMatrixFromExisting = () => {
    const existing = getIdMatrix()
    const existingCats = new Set(existing.map((m: any) => (m.cat || '').toLowerCase()))
    const byCat: Record<string, number[]> = {}
    for (const item of priceBookItems) {
      const cat = item.cat || 'Uncategorized'
      if (existingCats.has(cat.toLowerCase())) continue
      const pid = Number(item.pidBlock || item.pidBand)
      if (!Number.isFinite(pid)) continue
      if (!byCat[cat]) byCat[cat] = []
      byCat[cat].push(pid)
    }
    const seeded = Object.entries(byCat).map(([cat, pids]) => ({
      id: `mtx_${Date.now()}_${cat.replace(/\s+/g, '_')}`,
      cat,
      rangeStart: Math.min(...pids),
      rangeEnd: Math.max(...pids),
      description: 'Seeded from existing items',
    }))
    if (seeded.length === 0) { alert('No new categories to seed — all already have ranges or no items have numeric Product IDs'); return }
    persistIdMatrix([...existing, ...seeded])
    alert(`Seeded ${seeded.length} ranges. Review and edit as needed.`)
  }

  const handleReseedMatrixRow = (entry: any) => {
    const itemsInCat = priceBookItems.filter((i: any) => (i.cat || '').toLowerCase() === (entry.cat || '').toLowerCase())
    const pids = itemsInCat
      .map((i: any) => Number(i.pidBlock || i.pidBand))
      .filter((n: number) => Number.isFinite(n))
    if (pids.length === 0) {
      alert(`No items in "${entry.cat}" have numeric Product IDs — nothing to reseed from`)
      return
    }
    const newStart = Math.min(...pids)
    const newEnd = Math.max(...pids)
    if (newStart === entry.rangeStart && newEnd === entry.rangeEnd) {
      alert(`Range is already tight — current items span ${newStart}–${newEnd}`)
      return
    }
    if (!confirm(`Retighten "${entry.cat}" range from ${entry.rangeStart}–${entry.rangeEnd} to ${newStart}–${newEnd}?`)) return
    const matrix = getIdMatrix()
    const updated = matrix.map((m: any) => m.id === entry.id ? { ...m, rangeStart: newStart, rangeEnd: newEnd } : m)
    persistIdMatrix(updated)
  }

  // ── METRICS ──────────────────────────────────────────────────────────────

  const isNoSource = (i: any) => {
    const s = (i.src || '').trim()
    return !s || s === 'PDF Import' || s === 'PDF Imported'
  }

  const getBucketMetrics = (cat: string) => {
    const items = priceBookItems.filter((i: any) => resolveCategory(i) === cat)
    const noCost = items.filter((i: any) => !num(i.cost)).length
    const noSource = items.filter(isNoSource).length
    const noName = items.filter((i: any) => !(i.name || '').trim()).length
    const matrix = getIdMatrix()
    const matrixEntry = matrix.find((m: any) => (m.cat || '').toLowerCase() === cat.toLowerCase())
    const range = matrixEntry ? `${matrixEntry.rangeStart}–${matrixEntry.rangeEnd}` : '—'
    return { total: items.length, noCost, noSource, noName, range, hasRange: !!matrixEntry }
  }

  const getTotalMetrics = () => {
    const total = priceBookItems.length
    const noCost = priceBookItems.filter((i: any) => !num(i.cost)).length
    const noSource = priceBookItems.filter(isNoSource).length
    const noName = priceBookItems.filter((i: any) => !(i.name || '').trim()).length
    const bucketsInBook = new Set(priceBookItems.map((i: any) => resolveCategory(i))).size
    const matrix = getIdMatrix()
    const bucketsInMatrixSet = new Set(matrix.map((m: any) => (m.cat || '').toLowerCase()))
    const bucketsWithRange = Array.from(new Set(priceBookItems.map((i: any) => resolveCategory(i).toLowerCase()))).filter(c => bucketsInMatrixSet.has(c)).length
    return {
      total, noCost, noSource, noName,
      bucketsInBook, bucketsWithRange,
      matrixTotal: matrix.length,
      suppliersTotal: getSuppliers().length,
      timestamp: new Date().toLocaleString(),
    }
  }

  // ── SUPPLIERS ────────────────────────────────────────────────────────────

  const getSuppliers = (): any[] => {
    const s = (backup as any).suppliers
    return Array.isArray(s) ? s : []
  }

  const persistSuppliers = (updated: any[]) => {
    pushState()
    ;(backup as any).suppliers = updated
    saveBackupData(backup)
    markChanged('suppliers')
    refreshBackup()
  }

  const openAddSupplierModal = (targetItemId?: string) => {
    setSupplierModalMode('add')
    setSupplierModalEditingId(null)
    setSupplierModalTargetItemId(targetItemId || null)
    setSupplierDraft({ name: '', location: '', contact: '', phone: '', email: '', website: '', taxId: '', paymentTerms: '', notes: '' })
  }

  const openEditSupplierModal = (entry: any) => {
    setSupplierModalMode('edit')
    setSupplierModalEditingId(entry.id)
    setSupplierModalTargetItemId(null)
    setSupplierDraft({
      name: entry.name || '',
      location: entry.location || '',
      contact: entry.contact || '',
      phone: entry.phone || '',
      email: entry.email || '',
      website: entry.website || '',
      taxId: entry.taxId || '',
      paymentTerms: entry.paymentTerms || '',
      notes: entry.notes || '',
      color: entry.color || '',
    })
  }

  const closeSupplierModal = () => {
    setSupplierModalMode(null)
    setSupplierModalEditingId(null)
    setSupplierModalTargetItemId(null)
  }

  const handleSaveSupplier = () => {
    const name = supplierDraft.name.trim()
    const location = supplierDraft.location.trim()
    if (!name) { alert('Name is required'); return }
    if (!location) { alert('Location is required — use "(unspecified)" if not known'); return }
    const suppliers = getSuppliers()
    if (supplierModalMode === 'add') {
      if (suppliers.some((s: any) => (s.name || '').toLowerCase() === name.toLowerCase() && (s.location || '').toLowerCase() === location.toLowerCase())) {
        alert(`Supplier "${name}" at "${location}" already exists`); return
      }
      const newEntry = {
        id: `sup_${Date.now()}`,
        name,
        location,
        contact: supplierDraft.contact.trim(),
        phone: supplierDraft.phone.trim(),
        email: supplierDraft.email.trim(),
        website: supplierDraft.website.trim(),
        taxId: supplierDraft.taxId.trim(),
        paymentTerms: supplierDraft.paymentTerms.trim(),
        notes: supplierDraft.notes.trim(),
        color: supplierDraft.color || '',
        createdAt: new Date().toISOString(),
      }
      const updatedSuppliers = [...suppliers, newEntry]
      ;(backup as any).suppliers = updatedSuppliers
      if (supplierModalTargetItemId) {
        const updatedItems = (backup.priceBook || []).map((pb: any) => pb.id === supplierModalTargetItemId ? { ...pb, src: name } : pb)
        backup.priceBook = updatedItems
      }
      pushState()
      saveBackupData(backup)
      markChanged('suppliers')
      refreshBackup()
    } else if (supplierModalMode === 'edit' && supplierModalEditingId) {
      const updated = suppliers.map((s: any) => s.id === supplierModalEditingId ? {
        ...s,
        name, location,
        contact: supplierDraft.contact.trim(),
        phone: supplierDraft.phone.trim(),
        email: supplierDraft.email.trim(),
        website: supplierDraft.website.trim(),
        taxId: supplierDraft.taxId.trim(),
        paymentTerms: supplierDraft.paymentTerms.trim(),
        notes: supplierDraft.notes.trim(),
        color: supplierDraft.color || '',
      } : s)
      persistSuppliers(updated)
    }
    closeSupplierModal()
  }

  const handleDeleteSupplier = (id: string) => {
    const sup = getSuppliers().find((s: any) => s.id === id)
    if (!sup) return
    const usageCount = priceBookItems.filter((i: any) => (i.src || '').toLowerCase() === (sup.name || '').toLowerCase()).length
    const msg = usageCount > 0
      ? `Delete "${sup.name}"? ${usageCount} item(s) reference this supplier — their Source will stay as plain text "${sup.name}" but won't link to a registered supplier anymore.`
      : `Delete "${sup.name}"?`
    if (!confirm(msg)) return
    persistSuppliers(getSuppliers().filter((s: any) => s.id !== id))
  }

  const handleSeedSuppliersFromExisting = () => {
    const existing = getSuppliers()
    const existingNames = new Set(existing.map((s: any) => (s.name || '').toLowerCase()))
    const found = new Set<string>()
    for (const item of priceBookItems) {
      const raw = (item.src || '').trim()
      if (!raw) continue
      if (raw === 'PDF Import' || raw === 'PDF Imported') continue
      if (existingNames.has(raw.toLowerCase())) continue
      found.add(raw)
    }
    if (found.size === 0) { alert('No new suppliers to seed — all existing src values are already registered or empty'); return }
    const seeded = Array.from(found).map((name, idx) => ({
      id: `sup_${Date.now()}_${idx}`,
      name,
      location: '(unspecified)',
      contact: '', phone: '', email: '', website: '', taxId: '', paymentTerms: '',
      notes: 'Seeded from existing items',
      createdAt: new Date().toISOString(),
    }))
    persistSuppliers([...existing, ...seeded])
    alert(`Seeded ${seeded.length} suppliers. Edit them to add location/contact details.`)
  }

  const handleSetItemSource = (itemId: string, src: string) => {
    const updated = (backup.priceBook || []).map((pb: any) => pb.id === itemId ? { ...pb, src } : pb)
    saveBackupData({ ...backup, priceBook: updated })
    refreshBackup()
    setEditingSrcId(null)
  }

  // ── DRAG-AND-DROP ────────────────────────────────────────────────────────

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const handleItemDragEnd = (cat: string, event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const allItems = [...((backup.priceBook as any[]) || [])]
    const catIndices: number[] = []
    allItems.forEach((item, idx) => { if (resolveCategory(item) === cat) catIndices.push(idx) })
    const catItems = catIndices.map(i => allItems[i])
    const oldIdx = catItems.findIndex((i: any) => i.id === active.id)
    const newIdx = catItems.findIndex((i: any) => i.id === over.id)
    if (oldIdx === -1 || newIdx === -1) return
    const reordered = arrayMove(catItems, oldIdx, newIdx)
    catIndices.forEach((backupIdx, i) => { allItems[backupIdx] = reordered[i] })
    pushState()
    backup.priceBook = allItems
    persistPriceBook()
    markChanged('priceBook')
    refreshBackup()
  }

  const handleMatrixDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const matrix = getIdMatrix()
    const oldIdx = matrix.findIndex((m: any) => m.id === active.id)
    const newIdx = matrix.findIndex((m: any) => m.id === over.id)
    if (oldIdx === -1 || newIdx === -1) return
    const reordered = arrayMove(matrix, oldIdx, newIdx)
    persistIdMatrix(reordered)
  }

  return (
    <div className="space-y-4 p-5 min-h-screen bg-[var(--bg-secondary)]">
      {/* HEADER */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-100 mb-1">Price Book</h1>
          <p className="text-sm text-gray-400">{priceBookItems.length} total items</p>
        </div>
        <button
          onClick={() => setShowSummaryModal(true)}
          className="px-4 py-2 bg-cyan-600 hover:bg-cyan-700 text-white rounded-lg text-sm font-medium flex items-center gap-2 transition"
          title="View overall Price Book health summary"
        >
          <FileText className="w-4 h-4" />
          Summary
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

      {/* SUMMARY MODAL */}
      {showSummaryModal && (() => {
        const m = getTotalMetrics()
        return (
          <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={() => setShowSummaryModal(false)}>
            <div className="bg-[var(--bg-card)] rounded-lg p-6 max-w-lg w-full space-y-4 border border-gray-700" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-xl font-bold text-gray-100">Price Book Summary</h2>
                  <p className="text-xs text-gray-500">Generated {m.timestamp}</p>
                </div>
                <button onClick={() => setShowSummaryModal(false)} className="p-1.5 hover:bg-gray-700 rounded text-gray-400">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="grid grid-cols-2 gap-3 pt-2">
                <div className="bg-[var(--bg-secondary)] rounded p-3">
                  <div className="text-[10px] text-gray-500 uppercase font-semibold">Total Item Entries</div>
                  <div className="text-2xl font-bold text-gray-100 font-mono">{m.total}</div>
                </div>
                <div className="bg-[var(--bg-secondary)] rounded p-3">
                  <div className="text-[10px] text-gray-500 uppercase font-semibold">Buckets in Book</div>
                  <div className="text-2xl font-bold text-gray-100 font-mono">{m.bucketsInBook}</div>
                </div>
                <div className="bg-[var(--bg-secondary)] rounded p-3">
                  <div className="text-[10px] text-gray-500 uppercase font-semibold">Matrix Ranges Defined</div>
                  <div className="text-2xl font-bold text-gray-100 font-mono">{m.matrixTotal}</div>
                  <div className="text-[10px] text-gray-500 mt-1">{m.bucketsWithRange} of {m.bucketsInBook} buckets mapped</div>
                </div>
                <div className="bg-[var(--bg-secondary)] rounded p-3">
                  <div className="text-[10px] text-gray-500 uppercase font-semibold">Health</div>
                  <div className={`text-2xl font-bold font-mono ${(m.noCost + m.noSource + m.noName) === 0 ? 'text-emerald-400' : 'text-yellow-400'}`}>
                    {m.total === 0 ? '—' : `${Math.round(((m.total * 3 - m.noCost - m.noSource - m.noName) / (m.total * 3)) * 100)}%`}
                  </div>
                  <div className="text-[10px] text-gray-500 mt-1">fields populated</div>
                </div>
              </div>

              <div className="pt-2 border-t border-gray-700 space-y-2">
                <div className="text-[10px] text-gray-500 uppercase font-semibold">Missing Fields</div>
                <div className="grid grid-cols-3 gap-3">
                  <div className={`rounded p-2 ${m.noCost > 0 ? 'bg-yellow-500/10 text-yellow-400' : 'bg-[var(--bg-secondary)] text-gray-500'}`}>
                    <div className="text-[10px] uppercase font-semibold">No Cost</div>
                    <div className="text-lg font-mono">{m.noCost}</div>
                  </div>
                  <div className={`rounded p-2 ${m.noSource > 0 ? 'bg-yellow-500/10 text-yellow-400' : 'bg-[var(--bg-secondary)] text-gray-500'}`}>
                    <div className="text-[10px] uppercase font-semibold">No Source</div>
                    <div className="text-lg font-mono">{m.noSource}</div>
                  </div>
                  <div className={`rounded p-2 ${m.noName > 0 ? 'bg-yellow-500/10 text-yellow-400' : 'bg-[var(--bg-secondary)] text-gray-500'}`}>
                    <div className="text-[10px] uppercase font-semibold">No Name</div>
                    <div className="text-lg font-mono">{m.noName}</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )
      })()}

      {/* SUPPLIER MODAL */}
      {supplierModalMode && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={closeSupplierModal}>
          <div className="bg-[var(--bg-card)] rounded-lg p-6 max-w-xl w-full max-h-[90vh] overflow-y-auto border border-gray-700" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-gray-100">{supplierModalMode === 'add' ? 'Add Supplier' : 'Edit Supplier'}</h2>
              <button onClick={closeSupplierModal} className="p-1.5 hover:bg-gray-700 rounded text-gray-400">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="text-[10px] text-gray-400 uppercase font-semibold">Name *</label>
                <input autoFocus value={supplierDraft.name} onChange={(e) => setSupplierDraft({ ...supplierDraft, name: e.target.value })} className="w-full mt-1 px-3 py-2 bg-[var(--bg-secondary)] border border-gray-600 rounded text-sm text-gray-100" placeholder="e.g., CED" />
              </div>
              <div className="col-span-2">
                <label className="text-[10px] text-gray-400 uppercase font-semibold">Location *</label>
                <input value={supplierDraft.location} onChange={(e) => setSupplierDraft({ ...supplierDraft, location: e.target.value })} className="w-full mt-1 px-3 py-2 bg-[var(--bg-secondary)] border border-gray-600 rounded text-sm text-gray-100" placeholder="e.g., Palm Desert" />
              </div>
              <div>
                <label className="text-[10px] text-gray-400 uppercase font-semibold">Contact Person</label>
                <input value={supplierDraft.contact} onChange={(e) => setSupplierDraft({ ...supplierDraft, contact: e.target.value })} className="w-full mt-1 px-3 py-2 bg-[var(--bg-secondary)] border border-gray-600 rounded text-sm text-gray-100" />
              </div>
              <div>
                <label className="text-[10px] text-gray-400 uppercase font-semibold">Phone</label>
                <input value={supplierDraft.phone} onChange={(e) => setSupplierDraft({ ...supplierDraft, phone: e.target.value })} className="w-full mt-1 px-3 py-2 bg-[var(--bg-secondary)] border border-gray-600 rounded text-sm text-gray-100" />
              </div>
              <div>
                <label className="text-[10px] text-gray-400 uppercase font-semibold">Email</label>
                <input value={supplierDraft.email} onChange={(e) => setSupplierDraft({ ...supplierDraft, email: e.target.value })} className="w-full mt-1 px-3 py-2 bg-[var(--bg-secondary)] border border-gray-600 rounded text-sm text-gray-100" />
              </div>
              <div>
                <label className="text-[10px] text-gray-400 uppercase font-semibold">Website</label>
                <input value={supplierDraft.website} onChange={(e) => setSupplierDraft({ ...supplierDraft, website: e.target.value })} className="w-full mt-1 px-3 py-2 bg-[var(--bg-secondary)] border border-gray-600 rounded text-sm text-gray-100" />
              </div>
              <div>
                <label className="text-[10px] text-gray-400 uppercase font-semibold">Tax ID</label>
                <input value={supplierDraft.taxId} onChange={(e) => setSupplierDraft({ ...supplierDraft, taxId: e.target.value })} className="w-full mt-1 px-3 py-2 bg-[var(--bg-secondary)] border border-gray-600 rounded text-sm text-gray-100" placeholder="N/A if not known" />
              </div>
              <div>
                <label className="text-[10px] text-gray-400 uppercase font-semibold">Payment Terms</label>
                <input value={supplierDraft.paymentTerms} onChange={(e) => setSupplierDraft({ ...supplierDraft, paymentTerms: e.target.value })} className="w-full mt-1 px-3 py-2 bg-[var(--bg-secondary)] border border-gray-600 rounded text-sm text-gray-100" placeholder="e.g., Net 30" />
              </div>
              <div className="col-span-2">
                <label className="text-[10px] text-gray-400 uppercase font-semibold">Notes</label>
                <textarea value={supplierDraft.notes} onChange={(e) => setSupplierDraft({ ...supplierDraft, notes: e.target.value })} rows={2} className="w-full mt-1 px-3 py-2 bg-[var(--bg-secondary)] border border-gray-600 rounded text-sm text-gray-100" />
              </div>
              <div className="col-span-2">
                <label className="text-[10px] text-gray-400 uppercase font-semibold">Badge Color</label>
                <div className="flex flex-wrap gap-2 mt-1">
                  <button
                    type="button"
                    onClick={() => setSupplierDraft({ ...supplierDraft, color: '' })}
                    className={`px-2 py-1 rounded text-xs border ${!supplierDraft.color ? 'border-emerald-400 ring-1 ring-emerald-400' : 'border-gray-600'} bg-gray-500/10 text-gray-400`}
                    title="Auto — falls back to name-based rule"
                  >
                    Auto
                  </button>
                  {SUPPLIER_COLORS.map(c => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => setSupplierDraft({ ...supplierDraft, color: c.id })}
                      className={`px-2 py-1 rounded text-xs border ${c.cls} ${supplierDraft.color === c.id ? 'ring-2 ring-white/60' : ''}`}
                      title={c.label}
                    >
                      {supplierDraft.name || c.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 mt-4 pt-4 border-t border-gray-700">
              <button onClick={closeSupplierModal} className="px-4 py-2 hover:bg-gray-700 rounded text-sm text-gray-400">Cancel</button>
              <button onClick={handleSaveSupplier} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 rounded text-sm text-white font-medium flex items-center gap-1">
                <Check className="w-4 h-4" /> Save
              </button>
            </div>
          </div>
        </div>
      )}

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
                    {/* PER-BUCKET METRICS */}
                    {(() => {
                      const m = getBucketMetrics(cat)
                      return (
                        <div className="px-4 py-2 bg-[var(--bg-secondary)]/40 border-b border-gray-700/50 flex items-center gap-4 text-[11px] flex-wrap">
                          <span className="text-gray-400">Range: <span className={m.hasRange ? 'text-gray-200 font-mono' : 'text-gray-600'}>{m.range}</span></span>
                          <span className="text-gray-400">Entries: <span className="text-gray-200 font-mono">{m.total}</span></span>
                          <span className={m.noCost > 0 ? 'text-yellow-400' : 'text-gray-500'}>No cost: <span className="font-mono">{m.noCost}</span></span>
                          <span className={m.noSource > 0 ? 'text-yellow-400' : 'text-gray-500'}>No source: <span className="font-mono">{m.noSource}</span></span>
                          <span className={m.noName > 0 ? 'text-yellow-400' : 'text-gray-500'}>No name: <span className="font-mono">{m.noName}</span></span>
                        </div>
                      )
                    })()}

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
                    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={(e) => handleItemDragEnd(cat, e)}>
                    <SortableContext items={items.map(i => i.id)} strategy={verticalListSortingStrategy}>
                    {items.map((item) => {
                      const clientPrice = getClientPrice(item.cost || 0)
                      const pidDisplay = item.pidBlock || item.pidBand || item.id || '—'
                      const isEditing = editingId === item.id

                      return (
                        <SortableRow key={item.id} id={item.id} className="pl-6 pr-4 py-3 border-t border-gray-700 grid grid-cols-12 gap-3 items-center text-sm hover:bg-[var(--bg-card)] hover:brightness-110 transition">
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
                            {editingSrcId === item.id ? (
                              <select
                                autoFocus
                                value={(!item.src || item.src === 'PDF Import' || item.src === 'PDF Imported') ? '' : item.src}
                                onChange={(e) => {
                                  const v = e.target.value
                                  if (v === '__ADD__') {
                                    openAddSupplierModal(item.id)
                                    setEditingSrcId(null)
                                    return
                                  }
                                  handleSetItemSource(item.id, v)
                                }}
                                onBlur={() => setEditingSrcId(null)}
                                className="w-full px-2 py-1 bg-[var(--bg-secondary)] border border-cyan-500/50 rounded text-xs text-gray-100"
                              >
                                <option value="">— None —</option>
                                {getSuppliers().map((s: any) => (
                                  <option key={s.id} value={s.name}>{s.name}{s.location && s.location !== '(unspecified)' ? ` — ${s.location}` : ''}</option>
                                ))}
                                <option value="__ADD__">+ Add new supplier...</option>
                              </select>
                            ) : (
                              <span
                                onClick={() => setEditingSrcId(item.id)}
                                className={`inline-block px-2 py-1 rounded text-xs font-medium border cursor-pointer hover:brightness-125 transition ${getSourceColor(item.src)}`}
                                title="Click to change source"
                              >
                                {(!item.src || item.src === 'PDF Import' || item.src === 'PDF Imported') ? 'N/A' : item.src}
                              </span>
                            )}
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
                          <div className="col-span-1.5 font-mono text-xs break-all">
                            {editingPidId === item.id ? (
                              <input
                                autoFocus
                                type="text"
                                value={editingPid}
                                onChange={(e) => setEditingPid(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    const trimmed = editingPid.trim()
                                    const updated = (backup.priceBook || []).map(pb => pb.id === item.id ? { ...pb, pidBlock: trimmed, pidBand: trimmed } : pb)
                                    saveBackupData({ ...backup, priceBook: updated })
                                    setEditingPidId(null)
                                    refreshBackup()
                                  }
                                  if (e.key === 'Escape') setEditingPidId(null)
                                }}
                                onBlur={() => {
                                  const trimmed = editingPid.trim()
                                  if (trimmed !== (item.pidBlock || item.pidBand || '')) {
                                    const updated = (backup.priceBook || []).map(pb => pb.id === item.id ? { ...pb, pidBlock: trimmed, pidBand: trimmed } : pb)
                                    saveBackupData({ ...backup, priceBook: updated })
                                    refreshBackup()
                                  }
                                  setEditingPidId(null)
                                }}
                                className="w-full px-2 py-0.5 bg-gray-900 border border-cyan-500/50 rounded text-gray-200 text-xs font-mono"
                              />
                            ) : (
                              <span className="flex items-center gap-1">
                                <span
                                  onClick={() => { setEditingPidId(item.id); setEditingPid(item.pidBlock || item.pidBand || '') }}
                                  className="text-gray-400 cursor-pointer hover:text-emerald-400 transition"
                                  title="Click to edit Product ID"
                                >
                                  {pidDisplay}
                                </span>
                                {isPidOutOfRange(item.cat, item.pidBlock || item.pidBand || '') && (
                                  <AlertCircle className="w-3.5 h-3.5 text-yellow-400 flex-shrink-0" aria-label="Outside matrix range" />
                                )}
                              </span>
                            )}
                          </div>
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
                        </SortableRow>
                      )
                    })}
                    </SortableContext>
                    </DndContext>

                    {/* Per-category Add Item footer */}
                    <div className="px-4 py-3 border-t border-gray-700 flex justify-center">
                      <button
                        onClick={() => handleAddItem(cat)}
                        className="px-3 py-1.5 bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-400 rounded text-xs font-medium flex items-center gap-1.5 transition"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        Add Item to {cat}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>

      {/* SUPPLIERS SECTION */}
      <div className="bg-[var(--bg-card)] rounded-lg p-4 space-y-3">
        <div className="flex items-center justify-between">
          <button
            onClick={() => setIsSuppliersExpanded(!isSuppliersExpanded)}
            className="flex items-center gap-3 flex-1 text-left hover:brightness-110 transition"
          >
            {isSuppliersExpanded ? <ChevronUp className="w-5 h-5 text-gray-400 flex-shrink-0" /> : <ChevronDown className="w-5 h-5 text-gray-400 flex-shrink-0" />}
            <div className="flex-1">
              <h2 className="text-lg font-bold text-gray-100">Suppliers</h2>
              <p className="text-xs text-gray-400">Registered vendor list. Item Source column pulls from here.</p>
            </div>
            <span className="text-xs text-gray-500 whitespace-nowrap">{getSuppliers().length} registered</span>
          </button>
          {isSuppliersExpanded && (
            <>
              <button
                onClick={handleSeedSuppliersFromExisting}
                className="ml-3 px-3 py-1.5 bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 rounded text-xs font-medium flex-shrink-0"
                title="Scan item Source fields and auto-create supplier entries from distinct values"
              >
                Seed from existing items
              </button>
              <button
                onClick={() => openAddSupplierModal()}
                className="ml-2 px-3 py-1.5 bg-emerald-600/30 hover:bg-emerald-600/40 text-emerald-300 rounded text-xs font-medium flex items-center gap-1 flex-shrink-0"
              >
                <Plus className="w-3.5 h-3.5" /> Add Supplier
              </button>
            </>
          )}
        </div>

        {isSuppliersExpanded && (<>
          <div className="px-3 py-2 bg-[var(--bg-secondary)] grid grid-cols-12 gap-3 text-xs font-semibold text-gray-400 uppercase rounded">
            <div className="col-span-3">Name</div>
            <div className="col-span-2">Location</div>
            <div className="col-span-2">Contact</div>
            <div className="col-span-2">Phone</div>
            <div className="col-span-1">Terms</div>
            <div className="col-span-2 text-right">Actions</div>
          </div>

          {getSuppliers().length === 0 ? (
            <div className="px-3 py-4 text-center text-sm text-gray-500">No suppliers registered yet. Add one or click "Seed from existing items".</div>
          ) : (
            getSuppliers().map((s: any) => (
              <div key={s.id} className="px-3 py-2 grid grid-cols-12 gap-3 items-center text-sm border-t border-gray-700">
                <div className="col-span-3">
                  <span className={`inline-block px-2 py-1 rounded text-xs font-medium border ${getSourceColor(s.name)}`}>
                    {s.name}
                  </span>
                </div>
                <div className="col-span-2 text-gray-300 text-xs">{s.location || '—'}</div>
                <div className="col-span-2 text-gray-400 text-xs">{s.contact || '—'}</div>
                <div className="col-span-2 text-gray-400 text-xs font-mono">{s.phone || '—'}</div>
                <div className="col-span-1 text-gray-400 text-xs">{s.paymentTerms || '—'}</div>
                <div className="col-span-2 flex items-center justify-end gap-1">
                  <button onClick={() => openEditSupplierModal(s)} className="p-1.5 hover:bg-[var(--bg-secondary)] rounded text-gray-400 hover:text-gray-300" title="Edit supplier">
                    <Edit2 className="w-4 h-4" />
                  </button>
                  <button onClick={() => handleDeleteSupplier(s.id)} className="p-1.5 hover:bg-red-500/10 rounded text-gray-400 hover:text-red-400" title="Delete supplier">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))
          )}
        </>)}
      </div>

      {/* ID MATRIX SECTION */}
      <div className="bg-[var(--bg-card)] rounded-lg p-4 space-y-3">
        <div className="flex items-center justify-between">
          <button
            onClick={() => setIsMatrixExpanded(!isMatrixExpanded)}
            className="flex items-center gap-3 flex-1 text-left hover:brightness-110 transition"
          >
            {isMatrixExpanded ? <ChevronUp className="w-5 h-5 text-gray-400 flex-shrink-0" /> : <ChevronDown className="w-5 h-5 text-gray-400 flex-shrink-0" />}
            <div className="flex-1">
              <h2 className="text-lg font-bold text-gray-100">ID Matrix</h2>
              <p className="text-xs text-gray-400">Category → Product ID range. Auto-assigns pidBlock when adding items to a mapped category.</p>
            </div>
            <span className="text-xs text-gray-500 whitespace-nowrap">{getIdMatrix().length} ranges</span>
          </button>
          {isMatrixExpanded && (
            <button
              onClick={handleSeedMatrixFromExisting}
              className="ml-3 px-3 py-1.5 bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 rounded text-xs font-medium flex-shrink-0"
              title="Scan price book and create matrix entries from categories with existing numeric Product IDs"
            >
              Seed from existing items
            </button>
          )}
        </div>

        {isMatrixExpanded && (<>

        <div className="px-3 py-2 bg-[var(--bg-secondary)] grid grid-cols-12 gap-3 text-xs font-semibold text-gray-400 uppercase rounded">
          <div className="col-span-3">Category</div>
          <div className="col-span-2">Range Start</div>
          <div className="col-span-2">Range End</div>
          <div className="col-span-3">Description</div>
          <div className="col-span-2 text-right">Actions</div>
        </div>

        {getIdMatrix().length === 0 ? (
          <div className="px-3 py-4 text-center text-sm text-gray-500">No ranges defined yet. Add one below or click "Seed from existing items".</div>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleMatrixDragEnd}>
          <SortableContext items={getIdMatrix().map((m: any) => m.id)} strategy={verticalListSortingStrategy}>
          {getIdMatrix().map((entry: any) => {
            const isEditingRow = editingMatrixId === entry.id
            return (
              <SortableRow key={entry.id} id={entry.id} className="pl-5 pr-3 py-2 grid grid-cols-12 gap-3 items-center text-sm border-t border-gray-700">
                {isEditingRow ? (
                  <>
                    <input autoFocus className="col-span-3 px-2 py-1 bg-[var(--bg-secondary)] border border-gray-600 rounded text-gray-100 text-xs" value={editMatrixDraft.cat} onChange={e => setEditMatrixDraft({ ...editMatrixDraft, cat: e.target.value })} />
                    <input type="number" className="col-span-2 px-2 py-1 bg-[var(--bg-secondary)] border border-gray-600 rounded text-gray-100 text-xs" value={editMatrixDraft.rangeStart} onChange={e => setEditMatrixDraft({ ...editMatrixDraft, rangeStart: e.target.value })} />
                    <input type="number" className="col-span-2 px-2 py-1 bg-[var(--bg-secondary)] border border-gray-600 rounded text-gray-100 text-xs" value={editMatrixDraft.rangeEnd} onChange={e => setEditMatrixDraft({ ...editMatrixDraft, rangeEnd: e.target.value })} />
                    <input className="col-span-3 px-2 py-1 bg-[var(--bg-secondary)] border border-gray-600 rounded text-gray-100 text-xs" value={editMatrixDraft.description} onChange={e => setEditMatrixDraft({ ...editMatrixDraft, description: e.target.value })} placeholder="Optional notes" />
                    <div className="col-span-2 flex items-center justify-end gap-1">
                      <button onClick={() => handleSaveMatrixRow(entry.id)} className="p-1.5 bg-emerald-600/30 hover:bg-emerald-600/40 text-emerald-300 rounded" title="Save">
                        <Check className="w-4 h-4" />
                      </button>
                      <button onClick={handleCancelEditMatrix} className="p-1.5 hover:bg-gray-700 rounded text-gray-400" title="Cancel">
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="col-span-3 text-gray-100 text-xs font-medium">{entry.cat}</div>
                    <div className="col-span-2 text-gray-300 font-mono text-xs">{entry.rangeStart}</div>
                    <div className="col-span-2 text-gray-300 font-mono text-xs">{entry.rangeEnd}</div>
                    <div className="col-span-3 text-gray-400 text-xs flex items-center gap-2">
                      {(() => {
                        const oor = countOutOfRangeForCat(entry.cat, entry.rangeStart, entry.rangeEnd)
                        return oor > 0 ? (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-yellow-500/20 text-yellow-400 rounded text-[10px] font-medium" title="Items in this category with Product IDs outside the declared range">
                            <AlertCircle className="w-3 h-3" /> {oor} out of range
                          </span>
                        ) : null
                      })()}
                      <span>{entry.description || '—'}</span>
                    </div>
                    <div className="col-span-2 flex items-center justify-end gap-1">
                      <button onClick={() => handleReseedMatrixRow(entry)} className="p-1.5 hover:bg-[var(--bg-secondary)] rounded text-gray-400 hover:text-cyan-400" title="Retighten range to current items min/max">
                        <RefreshCw className="w-4 h-4" />
                      </button>
                      <button onClick={() => handleStartEditMatrix(entry)} className="p-1.5 hover:bg-[var(--bg-secondary)] rounded text-gray-400 hover:text-gray-300" title="Edit range">
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button onClick={() => handleDeleteMatrixRow(entry.id)} className="p-1.5 hover:bg-red-500/10 rounded text-gray-400 hover:text-red-400" title="Delete range">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </>
                )}
              </SortableRow>
            )
          })}
          </SortableContext>
          </DndContext>
        )}

        {/* Add new row */}
        <div className="px-3 py-2 grid grid-cols-12 gap-3 items-center text-sm border-t border-gray-700 bg-[var(--bg-secondary)]/30 rounded">
          <input className="col-span-3 px-2 py-1 bg-[var(--bg-secondary)] border border-gray-600 rounded text-gray-100 text-xs" value={newMatrixDraft.cat} onChange={e => setNewMatrixDraft({ ...newMatrixDraft, cat: e.target.value })} placeholder="e.g., Conduit - EMT" />
          <input type="number" className="col-span-2 px-2 py-1 bg-[var(--bg-secondary)] border border-gray-600 rounded text-gray-100 text-xs" value={newMatrixDraft.rangeStart} onChange={e => setNewMatrixDraft({ ...newMatrixDraft, rangeStart: e.target.value })} placeholder="3700" />
          <input type="number" className="col-span-2 px-2 py-1 bg-[var(--bg-secondary)] border border-gray-600 rounded text-gray-100 text-xs" value={newMatrixDraft.rangeEnd} onChange={e => setNewMatrixDraft({ ...newMatrixDraft, rangeEnd: e.target.value })} placeholder="3799" />
          <input className="col-span-3 px-2 py-1 bg-[var(--bg-secondary)] border border-gray-600 rounded text-gray-100 text-xs" value={newMatrixDraft.description} onChange={e => setNewMatrixDraft({ ...newMatrixDraft, description: e.target.value })} placeholder="Optional notes" />
          <div className="col-span-2 flex items-center justify-end">
            <button onClick={handleAddMatrixRow} className="px-3 py-1.5 bg-emerald-600/30 hover:bg-emerald-600/40 text-emerald-300 rounded text-xs flex items-center gap-1">
              <Plus className="w-3.5 h-3.5" /> Add Range
            </button>
          </div>
        </div>
        </>)}
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
