// @ts-nocheck
/**
 * ReceiptScanModal — Camera/image capture for receipt OCR scanning
 *
 * Mobile: opens camera via capture="environment"
 * Desktop: file upload for receipt images
 *
 * Flow: capture image → send to Claude Vision → preview parsed items → save
 */

import { useState, useRef } from 'react'
import {
  Camera, Upload, X, Loader2, CheckCircle2, AlertTriangle,
  Trash2, Save, RotateCcw,
} from 'lucide-react'
import { scanReceiptImage, fileToBase64, type OCRResult } from '@/services/receiptOCR'
import { saveReceipt, type ParsedReceipt, type ParsedLineItem } from '@/services/receiptParser'
import { useAuth } from '@/hooks/useAuth'

// ── Types ────────────────────────────────────────────────────────────────────

interface ReceiptScanModalProps {
  orgId: string
  projectId?: string
  phase?: string
  mtoEstimated?: number
  onClose: () => void
  onSaved: () => void
}

type ScanState = 'idle' | 'scanning' | 'preview' | 'saving' | 'done' | 'error'

// ── Component ────────────────────────────────────────────────────────────────

export default function ReceiptScanModal({
  orgId, projectId, phase, mtoEstimated, onClose, onSaved,
}: ReceiptScanModalProps) {
  const { userId } = useAuth()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const cameraInputRef = useRef<HTMLInputElement>(null)

  const [state, setState] = useState<ScanState>('idle')
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const [receipt, setReceipt] = useState<ParsedReceipt | null>(null)
  const [editableItems, setEditableItems] = useState<ParsedLineItem[]>([])
  const [error, setError] = useState<string | null>(null)

  // ── Image Handling ─────────────────────────────────────────────────────

  async function handleImageSelected(file: File) {
    if (!file.type.startsWith('image/')) {
      setError('Please select an image file (JPEG, PNG, or WebP)')
      return
    }

    // Show preview
    const previewUrl = URL.createObjectURL(file)
    setImagePreview(previewUrl)

    // Scan
    setState('scanning')
    setError(null)

    try {
      const base64 = await fileToBase64(file)
      const mimeType = file.type as 'image/jpeg' | 'image/png' | 'image/webp'
      const result: OCRResult = await scanReceiptImage(base64, mimeType)

      if (result.success && result.receipt) {
        setReceipt(result.receipt)
        setEditableItems([...result.receipt.line_items])
        setState('preview')
      } else {
        setError(result.error || 'Could not parse receipt')
        setState('error')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Scan failed')
      setState('error')
    }
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) handleImageSelected(file)
  }

  // ── Line Item Editing ──────────────────────────────────────────────────

  function updateItem(index: number, field: keyof ParsedLineItem, value: string | number) {
    setEditableItems(prev => {
      const next = [...prev]
      next[index] = { ...next[index], [field]: value }
      // Recalculate total
      if (field === 'qty' || field === 'unit_cost') {
        next[index].total = (Number(next[index].qty) || 1) * (Number(next[index].unit_cost) || 0)
      }
      return next
    })
  }

  function removeItem(index: number) {
    setEditableItems(prev => prev.filter((_, i) => i !== index))
  }

  function addItem() {
    setEditableItems(prev => [...prev, {
      name: 'New Item',
      qty: 1,
      unit_cost: 0,
      total: 0,
    }])
  }

  const computedTotal = editableItems.reduce((s, i) => s + (Number(i.total) || 0), 0)
  const computedTax = receipt?.tax || 0

  // ── Save ───────────────────────────────────────────────────────────────

  async function handleSave() {
    if (!receipt || !userId) return
    setState('saving')

    const finalReceipt: ParsedReceipt = {
      ...receipt,
      line_items: editableItems,
      subtotal: computedTotal,
      total: computedTotal + computedTax,
    }

    const result = await saveReceipt({
      orgId,
      projectId,
      uploadedBy: userId,
      receipt: finalReceipt,
      phase,
      mtoEstimated,
    })

    if (result) {
      setState('done')
      setTimeout(() => { onSaved(); onClose() }, 1200)
    } else {
      setError('Failed to save receipt')
      setState('error')
    }
  }

  // ── Reset ──────────────────────────────────────────────────────────────

  function reset() {
    setState('idle')
    setImagePreview(null)
    setReceipt(null)
    setEditableItems([])
    setError(null)
  }

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="w-full max-w-2xl max-h-[90vh] bg-gray-900 rounded-2xl border border-gray-700 shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
          <div className="flex items-center gap-3">
            <Camera className="text-emerald-400" size={20} />
            <h2 className="text-white font-semibold">Scan Receipt</h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white">
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* Idle — Capture Buttons */}
          {state === 'idle' && (
            <div className="space-y-4">
              <p className="text-gray-400 text-sm text-center">
                Take a photo of your receipt or upload an image. AI will extract the line items automatically.
              </p>
              <div className="grid grid-cols-2 gap-4 max-w-sm mx-auto">
                {/* Camera capture (mobile) */}
                <button
                  onClick={() => cameraInputRef.current?.click()}
                  className="flex flex-col items-center gap-2 p-6 rounded-xl bg-emerald-500/10 border border-emerald-500/30 hover:bg-emerald-500/20 transition-colors"
                >
                  <Camera className="text-emerald-400" size={32} />
                  <span className="text-emerald-400 text-sm font-medium">Take Photo</span>
                </button>
                <input
                  ref={cameraInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={handleFileChange}
                  className="hidden"
                />

                {/* File upload (desktop) */}
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="flex flex-col items-center gap-2 p-6 rounded-xl bg-cyan-500/10 border border-cyan-500/30 hover:bg-cyan-500/20 transition-colors"
                >
                  <Upload className="text-cyan-400" size={32} />
                  <span className="text-cyan-400 text-sm font-medium">Upload Image</span>
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={handleFileChange}
                  className="hidden"
                />
              </div>
            </div>
          )}

          {/* Scanning — Loading State */}
          {state === 'scanning' && (
            <div className="flex flex-col items-center gap-4 py-12">
              {imagePreview && (
                <img src={imagePreview} alt="Receipt" className="max-h-40 rounded-lg opacity-50" />
              )}
              <Loader2 className="text-emerald-400 animate-spin" size={36} />
              <p className="text-gray-400 text-sm">Scanning receipt with AI...</p>
            </div>
          )}

          {/* Error */}
          {state === 'error' && (
            <div className="space-y-4">
              <div className="flex items-center gap-3 bg-red-900/20 border border-red-700/50 rounded-lg p-4">
                <AlertTriangle className="text-red-400 flex-shrink-0" size={20} />
                <p className="text-red-300 text-sm">{error}</p>
              </div>
              <div className="flex justify-center">
                <button
                  onClick={reset}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gray-800 text-gray-300 hover:bg-gray-700 text-sm"
                >
                  <RotateCcw size={14} />
                  Try Again
                </button>
              </div>
            </div>
          )}

          {/* Preview — Parsed Items */}
          {state === 'preview' && receipt && (
            <div className="space-y-4">
              {/* Store Info */}
              <div className="flex items-center justify-between bg-gray-800/50 rounded-lg p-3">
                <div>
                  <p className="text-white font-medium text-sm">{receipt.store_name || 'Unknown Store'}</p>
                  <p className="text-gray-500 text-xs">{receipt.receipt_date} • {receipt.store_location || ''}</p>
                </div>
                {imagePreview && (
                  <img src={imagePreview} alt="Receipt" className="h-12 rounded border border-gray-700" />
                )}
              </div>

              {/* Line Items Table */}
              <div className="bg-gray-800/30 rounded-lg border border-gray-700/50 overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-gray-400 text-xs border-b border-gray-700/50">
                      <th className="text-left py-2 px-3">Item</th>
                      <th className="text-right py-2 px-3 w-16">Qty</th>
                      <th className="text-right py-2 px-3 w-24">Unit $</th>
                      <th className="text-right py-2 px-3 w-24">Total</th>
                      <th className="w-8"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-700/30">
                    {editableItems.map((item, i) => (
                      <tr key={i} className="hover:bg-gray-700/20">
                        <td className="py-1.5 px-3">
                          <input
                            type="text"
                            value={item.name}
                            onChange={e => updateItem(i, 'name', e.target.value)}
                            className="w-full bg-transparent text-gray-300 text-sm focus:outline-none focus:text-white"
                          />
                        </td>
                        <td className="py-1.5 px-3">
                          <input
                            type="number"
                            value={item.qty}
                            onChange={e => updateItem(i, 'qty', Number(e.target.value))}
                            className="w-full bg-transparent text-gray-300 text-sm text-right focus:outline-none focus:text-white"
                          />
                        </td>
                        <td className="py-1.5 px-3">
                          <input
                            type="number"
                            step="0.01"
                            value={item.unit_cost}
                            onChange={e => updateItem(i, 'unit_cost', Number(e.target.value))}
                            className="w-full bg-transparent text-gray-300 text-sm text-right focus:outline-none focus:text-white"
                          />
                        </td>
                        <td className="py-1.5 px-3 text-right text-gray-300 font-mono">
                          ${(Number(item.total) || 0).toFixed(2)}
                        </td>
                        <td className="py-1.5 pr-2">
                          <button onClick={() => removeItem(i)} className="text-gray-500 hover:text-red-400">
                            <Trash2 size={12} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                <button
                  onClick={addItem}
                  className="w-full py-2 text-xs text-gray-500 hover:text-emerald-400 hover:bg-gray-700/20 transition-colors"
                >
                  + Add Item
                </button>
              </div>

              {/* Totals */}
              <div className="flex justify-end">
                <div className="text-right space-y-1">
                  <p className="text-gray-400 text-sm">Subtotal: <span className="text-white font-mono">${computedTotal.toFixed(2)}</span></p>
                  <p className="text-gray-400 text-sm">Tax: <span className="text-white font-mono">${computedTax.toFixed(2)}</span></p>
                  <p className="text-gray-300 font-semibold">Total: <span className="text-emerald-400 font-mono">${(computedTotal + computedTax).toFixed(2)}</span></p>
                </div>
              </div>

              {/* Variance Preview */}
              {mtoEstimated != null && mtoEstimated > 0 && (
                <div className={`rounded-lg p-3 border ${
                  computedTotal > mtoEstimated
                    ? 'bg-red-900/20 border-red-700/50'
                    : 'bg-emerald-900/20 border-emerald-700/50'
                }`}>
                  <p className={`text-sm font-medium ${computedTotal > mtoEstimated ? 'text-red-300' : 'text-emerald-300'}`}>
                    {computedTotal > mtoEstimated ? 'Over budget' : 'Under budget'}: ${Math.abs(computedTotal - mtoEstimated).toFixed(2)}
                    {' '}({((computedTotal - mtoEstimated) / mtoEstimated * 100).toFixed(0)}%)
                  </p>
                  <p className="text-gray-500 text-xs mt-1">MTO estimated: ${mtoEstimated.toFixed(2)}</p>
                </div>
              )}
            </div>
          )}

          {/* Done */}
          {state === 'done' && (
            <div className="flex flex-col items-center gap-3 py-12">
              <CheckCircle2 className="text-emerald-400" size={48} />
              <p className="text-emerald-400 font-semibold">Receipt saved!</p>
            </div>
          )}

          {/* Saving */}
          {state === 'saving' && (
            <div className="flex flex-col items-center gap-3 py-12">
              <Loader2 className="text-emerald-400 animate-spin" size={36} />
              <p className="text-gray-400 text-sm">Saving receipt...</p>
            </div>
          )}
        </div>

        {/* Footer */}
        {state === 'preview' && (
          <div className="flex items-center justify-between px-6 py-4 border-t border-gray-800">
            <button
              onClick={reset}
              className="flex items-center gap-2 text-sm px-3 py-2 rounded-lg text-gray-300 hover:bg-gray-800"
            >
              <RotateCcw size={14} />
              Rescan
            </button>
            <button
              onClick={handleSave}
              className="flex items-center gap-2 text-sm px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-medium"
            >
              <Save size={14} />
              Save Receipt ({editableItems.length} items)
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
