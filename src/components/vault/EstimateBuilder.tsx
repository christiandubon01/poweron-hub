/**
 * EstimateBuilder — Form component for creating new estimates.
 *
 * Features:
 * - Textarea for project description
 * - Client selector dropdown
 * - Line item input (materials and labor)
 * - Calls processVaultRequest with action 'create'
 * - Loading state and error handling
 * - Dark themed
 */

import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { processVaultRequest } from '@/agents/vault'
import { AlertCircle, X, Plus } from 'lucide-react'
import { clsx } from 'clsx'

// ── Types ───────────────────────────────────────────────────────────────────

interface Client {
  id: string
  name: string
  company?: string
}

interface LineItemInput {
  id: string
  description: string
  sku?: string
  qty: number
  unit: string
  unit_price?: number
}

export interface EstimateBuilderProps {
  orgId: string
  userId?: string
  onClose?: () => void
  onSuccess?: (estimateId: string) => void
}

// ── Component ───────────────────────────────────────────────────────────────

export function EstimateBuilder({
  orgId,
  userId,
  onClose,
  onSuccess,
}: EstimateBuilderProps) {
  const [projectDescription, setProjectDescription] = useState('')
  const [selectedClientId, setSelectedClientId] = useState('')
  const [clients, setClients] = useState<Client[]>([])
  const [lineItems, setLineItems] = useState<LineItemInput[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [clientsLoading, setClientsLoading] = useState(true)

  // Load clients on mount
  useEffect(() => {
    loadClients()
  }, [orgId])

  async function loadClients() {
    try {
      setClientsLoading(true)
      const { data, error: err } = await supabase
        .from('clients')
        .select('id, name, company')
        .eq('org_id', orgId)
        .order('name', { ascending: true })
        .limit(100)

      if (err) throw err
      setClients((data ?? []) as Client[])
    } catch (err) {
      console.error('[EstimateBuilder] Load clients error:', err)
    } finally {
      setClientsLoading(false)
    }
  }

  // Add new line item
  function addLineItem() {
    const newItem: LineItemInput = {
      id: `li-${Date.now()}`,
      description: '',
      qty: 1,
      unit: 'ea',
    }
    setLineItems([...lineItems, newItem])
  }

  // Update line item
  function updateLineItem(id: string, updates: Partial<LineItemInput>) {
    setLineItems(
      lineItems.map(item => (item.id === id ? { ...item, ...updates } : item))
    )
  }

  // Remove line item
  function removeLineItem(id: string) {
    setLineItems(lineItems.filter(item => item.id !== id))
  }

  // Submit and create estimate
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (!projectDescription.trim()) {
      setError('Project description is required')
      return
    }

    if (lineItems.length === 0) {
      setError('Add at least one line item')
      return
    }

    if (!selectedClientId) {
      setError('Please select a client')
      return
    }

    try {
      setLoading(true)

      const response = await processVaultRequest({
        action: 'create',
        orgId,
        userId,
        projectDescription,
        clientId: selectedClientId,
        lineItems: lineItems.map(({ id, ...rest }) => rest),
      })

      if (!response.success) {
        setError(response.message)
        return
      }

      // Success
      onSuccess?.(response.estimateId || '')
      onClose?.()
    } catch (err) {
      console.error('[EstimateBuilder] Submit error:', err)
      setError(`Error creating estimate: ${String(err).slice(0, 100)}`)
    } finally {
      setLoading(false)
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full bg-gray-900 rounded-lg border border-gray-800">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-gray-800">
        <h2 className="text-lg font-bold text-gray-100">Create New Estimate</h2>
        <button
          onClick={onClose}
          className="p-1 rounded hover:bg-gray-800 text-gray-400 hover:text-gray-300 transition-colors"
        >
          <X size={20} />
        </button>
      </div>

      {/* Form */}
      <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto flex flex-col">
        <div className="p-4 space-y-4">
          {/* Error message */}
          {error && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-red-900/30 border border-red-800 text-red-300 text-sm">
              <AlertCircle size={16} className="shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {/* Project Description */}
          <div>
            <label className="block text-sm font-semibold text-gray-300 mb-2">
              Project Description *
            </label>
            <textarea
              value={projectDescription}
              onChange={e => setProjectDescription(e.target.value)}
              placeholder="e.g., 200A service upgrade, 3-story residential, Manhattan, NY"
              className={clsx(
                'w-full h-24 px-3 py-2 rounded-lg',
                'bg-gray-800 border border-gray-700 text-gray-100 placeholder-gray-500',
                'focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:border-transparent',
                'font-sm'
              )}
              disabled={loading}
            />
          </div>

          {/* Client Selector */}
          <div>
            <label className="block text-sm font-semibold text-gray-300 mb-2">
              Client *
            </label>
            <select
              value={selectedClientId}
              onChange={e => setSelectedClientId(e.target.value)}
              className={clsx(
                'w-full px-3 py-2 rounded-lg',
                'bg-gray-800 border border-gray-700 text-gray-100',
                'focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:border-transparent',
                'text-sm'
              )}
              disabled={loading || clientsLoading}
            >
              <option value="">
                {clientsLoading ? 'Loading clients...' : 'Select a client'}
              </option>
              {clients.map(client => (
                <option key={client.id} value={client.id}>
                  {client.name} {client.company ? `(${client.company})` : ''}
                </option>
              ))}
            </select>
          </div>

          {/* Line Items */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-sm font-semibold text-gray-300">
                Line Items *
              </label>
              <button
                type="button"
                onClick={addLineItem}
                className="flex items-center gap-1 px-2 py-1 rounded text-xs font-semibold text-emerald-400 hover:text-emerald-300 transition-colors"
                disabled={loading}
              >
                <Plus size={14} />
                Add Item
              </button>
            </div>

            {lineItems.length === 0 && (
              <div className="p-3 rounded-lg bg-gray-800 border border-gray-700 text-gray-400 text-sm text-center">
                No items yet. Click "Add Item" to get started.
              </div>
            )}

            {lineItems.map((item, idx) => (
              <div
                key={item.id}
                className="mb-3 p-3 rounded-lg bg-gray-800 border border-gray-700 space-y-2"
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-mono text-gray-400">Item {idx + 1}</span>
                  <button
                    type="button"
                    onClick={() => removeLineItem(item.id)}
                    className="p-1 rounded hover:bg-red-900/50 text-gray-400 hover:text-red-400 transition-colors"
                    disabled={loading}
                  >
                    <X size={14} />
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  {/* Description */}
                  <input
                    type="text"
                    placeholder="Description (e.g., 2/6 Romex)"
                    value={item.description}
                    onChange={e =>
                      updateLineItem(item.id, { description: e.target.value })
                    }
                    className={clsx(
                      'col-span-2 px-2 py-1 rounded text-sm',
                      'bg-gray-700 border border-gray-600 text-gray-100 placeholder-gray-500',
                      'focus:outline-none focus:ring-1 focus:ring-emerald-600'
                    )}
                    disabled={loading}
                  />

                  {/* SKU */}
                  <input
                    type="text"
                    placeholder="SKU (optional)"
                    value={item.sku ?? ''}
                    onChange={e => updateLineItem(item.id, { sku: e.target.value })}
                    className={clsx(
                      'px-2 py-1 rounded text-sm',
                      'bg-gray-700 border border-gray-600 text-gray-100 placeholder-gray-500',
                      'focus:outline-none focus:ring-1 focus:ring-emerald-600'
                    )}
                    disabled={loading}
                  />

                  {/* Qty */}
                  <input
                    type="number"
                    min="0"
                    step="0.1"
                    placeholder="Qty"
                    value={item.qty}
                    onChange={e =>
                      updateLineItem(item.id, { qty: parseFloat(e.target.value) || 0 })
                    }
                    className={clsx(
                      'px-2 py-1 rounded text-sm',
                      'bg-gray-700 border border-gray-600 text-gray-100 placeholder-gray-500',
                      'focus:outline-none focus:ring-1 focus:ring-emerald-600'
                    )}
                    disabled={loading}
                  />

                  {/* Unit */}
                  <select
                    value={item.unit}
                    onChange={e => updateLineItem(item.id, { unit: e.target.value })}
                    className={clsx(
                      'px-2 py-1 rounded text-sm',
                      'bg-gray-700 border border-gray-600 text-gray-100',
                      'focus:outline-none focus:ring-1 focus:ring-emerald-600'
                    )}
                    disabled={loading}
                  >
                    <option>ea</option>
                    <option>ft</option>
                    <option>hr</option>
                    <option>box</option>
                    <option>lb</option>
                  </select>

                  {/* Unit Price */}
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="Unit Price (optional)"
                    value={item.unit_price ?? ''}
                    onChange={e =>
                      updateLineItem(item.id, {
                        unit_price: e.target.value ? parseFloat(e.target.value) : undefined,
                      })
                    }
                    className={clsx(
                      'px-2 py-1 rounded text-sm',
                      'bg-gray-700 border border-gray-600 text-gray-100 placeholder-gray-500',
                      'focus:outline-none focus:ring-1 focus:ring-emerald-600'
                    )}
                    disabled={loading}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Footer / Buttons */}
        <div className="p-4 border-t border-gray-800 space-y-2">
          <button
            type="submit"
            disabled={loading || !projectDescription || lineItems.length === 0 || !selectedClientId}
            className={clsx(
              'w-full px-4 py-2 rounded-lg font-semibold transition-colors',
              loading
                ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
                : 'bg-emerald-600 text-white hover:bg-emerald-700'
            )}
          >
            {loading ? 'Creating estimate...' : 'Create Estimate'}
          </button>
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="w-full px-4 py-2 rounded-lg bg-gray-800 text-gray-300 font-semibold hover:bg-gray-700 transition-colors"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  )
}
