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

import { useMemo, useState } from 'react'
import { ChevronDown, ChevronUp, Plus, Search, Edit2, Trash2, AlertCircle, Copy, Sparkles, ExternalLink } from 'lucide-react'
import { getBackupData, saveBackupData, type BackupData, type BackupPriceBookItem } from '@/services/backupDataService'
import { pushState } from '@/services/undoRedoService'

export default function V15rPriceBookPanel() {
  const backup = getBackupData()
  if (!backup) return <NoData />

  // Handle both formats: array (from HTML app backup) or Record (from React app)
  const rawPB = backup.priceBook || {}
  const priceBookItems: BackupPriceBookItem[] = Array.isArray(rawPB) ? rawPB : Object.values(rawPB)
  const settings = backup.settings || {}
  const markup = settings.markup ?? 150 // 150% = 2.5x markup (cost × 1.5 = client price)

  const [searchQuery, setSearchQuery] = useState('')
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set())
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editNotes, setEditNotes] = useState('')
  const [, forceUpdate] = useState({})

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

  // Group filtered items by category
  const groupedItems = useMemo(() => {
    const grouped: Record<string, BackupPriceBookItem[]> = {}
    filteredItems.forEach((item) => {
      const cat = item.cat || 'Uncategorized'
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

  const saveNotes = (id: string) => {
    pushState()
    if (Array.isArray(backup.priceBook)) {
      const idx = (backup.priceBook as any[]).findIndex((item: any) => item.id === id)
      if (idx >= 0) (backup.priceBook as any[])[idx].notes = editNotes
    } else {
      if (!backup.priceBook[id]) return
      backup.priceBook[id].notes = editNotes
    }
    saveBackupData(backup)
    setEditingId(null)
    forceUpdate({})
  }

  const deleteItem = (id: string) => {
    if (!confirm('Delete this item?')) return
    pushState()
    if (Array.isArray(backup.priceBook)) {
      backup.priceBook = (backup.priceBook as any[]).filter((item: any) => item.id !== id)
    } else {
      delete backup.priceBook[id]
    }
    saveBackupData(backup)
    forceUpdate({})
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

      {/* SEARCH + CONTROLS */}
      <div className="bg-[var(--bg-card)] rounded-lg p-4 space-y-3">
        <div className="flex gap-3">
          <div className="flex-1 relative">
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
        </div>
        <p className="text-xs text-gray-400">Showing {filteredItems.length} of {priceBookItems.length} items</p>
      </div>

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
                        alert('AI Suggest: SCOUT will analyze this category and suggest optimizations')
                      }}
                      className="px-2 py-1 bg-cyan-600/30 text-cyan-300 text-xs rounded font-semibold hover:bg-cyan-600/40 flex items-center gap-1"
                    >
                      <Sparkles className="w-3 h-3" />
                      AI Suggest
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
                      <div className="col-span-0.75">Unit</div>
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
                          <div className="col-span-2 text-gray-100 font-medium">{item.name || '—'}</div>
                          <div className="col-span-1.5">
                            <span className={`inline-block px-2 py-1 rounded text-xs font-medium border ${getSourceColor(item.src)}`}>
                              {item.src || 'Unknown'}
                            </span>
                          </div>
                          <div className="col-span-0.75 text-gray-300 text-xs">{item.unit || 'ea'}</div>
                          <div className="col-span-0.75">
                            <div className="text-blue-400 font-medium text-xs">${clientPrice.toFixed(2)}</div>
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
                                autoFocus
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
