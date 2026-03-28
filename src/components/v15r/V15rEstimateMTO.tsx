// @ts-nocheck
/**
 * V15rEstimateMTO — Material Takeoff / Estimates panel matching v15r
 *
 * Features:
 * - 240-item price book from backup
 * - My Cost vs 150% markup Client Price
 * - Category grouping with expandable sections
 * - Supplier column
 * - Search / filter
 * - Supplier-safe export (hides cost column)
 */

import { useState, useMemo } from 'react'
import { Search, ChevronDown, ChevronUp, FileText, Zap } from 'lucide-react'
import { getBackupData, type BackupPriceBookItem } from '@/services/backupDataService'
import ImportBackupButton from '@/components/ImportBackupButton'

const MARKUP = 1.5

export default function V15rEstimateMTO() {
  const backup = getBackupData()
  if (!backup) return <NoData />

  const items: BackupPriceBookItem[] = useMemo(() => {
    return Object.values((backup?.priceBook || {}))
  }, [backup])

  const [search, setSearch] = useState('')
  const [expandedCats, setExpandedCats] = useState<Record<string, boolean>>({})
  const [showClientPrice, setShowClientPrice] = useState(true)

  // Group by category
  const grouped = useMemo(() => {
    const map: Record<string, BackupPriceBookItem[]> = {};
    (items || []).forEach(item => {
      const cat = item.cat || 'Uncategorized'
      if (!map[cat]) map[cat] = []
      map[cat].push(item)
    })
    // Sort categories alphabetically
    const sorted: [string, BackupPriceBookItem[]][] = Object.entries((map || {})).sort((a, b) => a[0].localeCompare(b[0]))
    return sorted
  }, [items])

  // Filter
  const filteredGrouped = useMemo(() => {
    if (!search.trim()) return (grouped || [])
    const q = search.toLowerCase()
    return (grouped || [])
      .map(([cat, items]) => {
        const filtered = (items || []).filter(
          i => i.name?.toLowerCase().includes(q) ||
               i.cat?.toLowerCase().includes(q) ||
               i.src?.toLowerCase().includes(q) ||
               i.legacyId?.toLowerCase().includes(q)
        )
        return [cat, filtered] as [string, BackupPriceBookItem[]]
      })
      .filter(([, items]) => (items || []).length > 0)
  }, [grouped, search])

  const totalItems = (filteredGrouped || []).reduce((s, [, items]) => s + (items || []).length, 0)

  const toggleCat = (cat: string) => {
    setExpandedCats(prev => ({ ...prev, [cat]: !prev[cat] }))
  }

  const expandAll = () => {
    const all: Record<string, boolean> = {};
    (filteredGrouped || []).forEach(([cat]) => { all[cat] = true })
    setExpandedCats(all)
  }

  const collapseAll = () => setExpandedCats({})

  // Supplier-safe export (no cost column)
  function exportSupplierPDF() {
    // Build a simple HTML table and open print dialog
    const rows = (items || []).map(i => `
      <tr>
        <td style="padding:4px 8px;border-bottom:1px solid #ddd">${i.name || ''}</td>
        <td style="padding:4px 8px;border-bottom:1px solid #ddd">${i.cat || ''}</td>
        <td style="padding:4px 8px;border-bottom:1px solid #ddd">${i.unit || ''}</td>
        <td style="padding:4px 8px;border-bottom:1px solid #ddd;text-align:right">$${((i.cost || 0) * MARKUP).toFixed(2)}</td>
        <td style="padding:4px 8px;border-bottom:1px solid #ddd">${i.pack || ''}</td>
      </tr>
    `).join('')

    const html = `
      <html><head><title>Material Price List — PowerOn</title>
      <style>body{font-family:Arial,sans-serif;font-size:12px;padding:20px}
      h1{font-size:18px;margin-bottom:10px}
      table{border-collapse:collapse;width:100%}
      th{background:#333;color:#fff;padding:6px 8px;text-align:left}
      </style></head><body>
      <h1>Material Price List</h1>
      <p style="color:#666">${(items || []).length} items | Generated ${new Date().toLocaleDateString()}</p>
      <table>
        <thead><tr>
          <th>Item</th><th>Category</th><th>Unit</th><th style="text-align:right">Price</th><th>Pack</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
      </body></html>
    `
    const w = window.open('', '_blank')
    if (w) {
      w.document.write(html)
      w.document.close()
      w.print()
    }
  }

  return (
    <div className="space-y-6 p-5 min-h-screen">
      <ImportBackupButton />

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <h2 className="text-lg font-bold text-gray-200 uppercase tracking-wider">
          Estimates / MTO ({totalItems} items)
        </h2>
        <div className="flex items-center gap-2">
          <button onClick={exportSupplierPDF}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-cyan-600/20 text-cyan-400 border border-cyan-500/30 hover:bg-cyan-600/30 transition-colors">
            <FileText size={14} /> Supplier-Safe PDF
          </button>
          <label className="flex items-center gap-1.5 text-[10px] text-gray-500 cursor-pointer">
            <input
              type="checkbox"
              checked={showClientPrice}
              onChange={e => setShowClientPrice(e.target.checked)}
              className="rounded"
            />
            Show Client Price
          </label>
        </div>
      </div>

      {/* Search + Controls */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search items, categories, suppliers..."
            className="w-full bg-gray-800 border border-gray-700 rounded-lg pl-9 pr-3 py-2 text-xs text-gray-300 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          />
        </div>
        <button onClick={expandAll} className="text-[10px] text-gray-500 hover:text-gray-300">Expand All</button>
        <button onClick={collapseAll} className="text-[10px] text-gray-500 hover:text-gray-300">Collapse All</button>
      </div>

      {/* Category Groups */}
      <div className="space-y-2">
        {(filteredGrouped || []).map(([cat, catItems]) => {
          const isExpanded = expandedCats[cat] || false
          const catTotal = (catItems || []).reduce((s, i) => s + (i.cost || 0), 0)

          return (
            <div key={cat} className="rounded-xl border border-gray-700 bg-gray-800/40 overflow-hidden">
              {/* Category Header */}
              <button
                onClick={() => toggleCat(cat)}
                className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-700/30 transition-colors"
              >
                <div className="flex items-center gap-3">
                  {isExpanded ? <ChevronUp size={14} className="text-gray-500" /> : <ChevronDown size={14} className="text-gray-500" />}
                  <span className="text-xs font-bold text-gray-300 uppercase tracking-wider">{cat}</span>
                  <span className="text-[10px] text-gray-500">({catItems.length} items)</span>
                </div>
                <div className="flex items-center gap-4 text-[10px] font-mono">
                  <span className="text-gray-500">My Cost: <span className="text-orange-400">{fmtCurrency(catTotal)}</span></span>
                  {showClientPrice && (
                    <span className="text-gray-500">Client: <span className="text-emerald-400">{fmtCurrency(catTotal * MARKUP)}</span></span>
                  )}
                </div>
              </button>

              {/* Items Table */}
              {isExpanded && (
                <div className="border-t border-gray-700 overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-gray-700 text-gray-500">
                        <th className="text-left py-2 px-3">Item</th>
                        <th className="text-left py-2 px-3">Supplier</th>
                        <th className="text-left py-2 px-3">Unit</th>
                        <th className="text-right py-2 px-3">Pack</th>
                        <th className="text-right py-2 px-3">Waste %</th>
                        <th className="text-right py-2 px-3">My Cost</th>
                        {showClientPrice && <th className="text-right py-2 px-3">Client Price</th>}
                        <th className="text-center py-2 px-3">Link</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(catItems || []).map(item => (
                        <tr key={item.id || item.legacyId} className="border-b border-gray-800 hover:bg-gray-700/20 transition-colors">
                          <td className="py-2 px-3 text-gray-300">{item.name}</td>
                          <td className="py-2 px-3 text-gray-400">{item.src || '—'}</td>
                          <td className="py-2 px-3 text-gray-400">{item.unit || '—'}</td>
                          <td className="py-2 px-3 text-right font-mono text-gray-400">{item.pack || '—'}</td>
                          <td className="py-2 px-3 text-right font-mono text-gray-400">{item.waste ? `${item.waste}%` : '—'}</td>
                          <td className="py-2 px-3 text-right font-mono text-orange-400">{fmtCurrency(item.cost || 0)}</td>
                          {showClientPrice && (
                            <td className="py-2 px-3 text-right font-mono text-emerald-400">{fmtCurrency((item.cost || 0) * MARKUP)}</td>
                          )}
                          <td className="py-2 px-3 text-center">
                            {item.link ? (
                              <a href={item.link} target="_blank" rel="noopener noreferrer"
                                className="text-cyan-500 hover:text-cyan-400 text-[10px]">View</a>
                            ) : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {(filteredGrouped || []).length === 0 && (
        <div className="text-center text-gray-500 py-10 text-sm">No items match your search.</div>
      )}

      <div className="text-[10px] text-gray-600 flex items-center gap-1">
        <Zap size={10} /> NEXUS AI can generate material estimates from project specs — ask in the chat panel
      </div>
    </div>
  )
}

function NoData() {
  return (
    <div className="p-6 space-y-4">
      <ImportBackupButton />
      <div className="text-center text-gray-500 py-20">
        <p className="text-lg font-semibold mb-2">No price book data</p>
        <p className="text-sm">Import your v15r backup file to see your material takeoff</p>
      </div>
    </div>
  )
}

function fmtCurrency(n: number): string {
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
