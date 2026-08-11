/**
 * RecordServicePaymentModal.tsx — FORENSIC-KPI-2B1.
 *
 * The one compact UI for capturing a real Service payment: how much, and the date the
 * money actually arrived. It exists because a received date cannot be collected by the
 * window.prompt() the payment actions used to use, and because the service/work date,
 * updatedAt and status-event date are all wrong substitutes for it.
 *
 * Shared by the Service Calls panel and the Home Collections Priority card so there is
 * exactly one payment-entry surface. Owner-facing purposes and labels of the buttons
 * that open it are unchanged.
 */

import { useEffect, useState } from 'react'

/**
 * Local calendar day as YYYY-MM-DD. Deliberately local, not the UTC ISO slice used
 * elsewhere in these panels — a received date the owner reads back must be the day
 * they experienced, not a day that can shift by one across a timezone boundary.
 */
export function localTodayKey(day = new Date()): string {
  return [
    day.getFullYear(),
    String(day.getMonth() + 1).padStart(2, '0'),
    String(day.getDate()).padStart(2, '0'),
  ].join('-')
}

export interface RecordServicePaymentRequest {
  logId: string
  customer: string
  /** Full amount due — protected Total Quoted plus valid income adjustments. */
  totalBillable: number
  alreadyCollected: number
  balanceDue: number
  /** Prefilled amount; the owner may change it. */
  suggestedAmount: number
  title: string
}

interface Props {
  request: RecordServicePaymentRequest | null
  /** Local YYYY-MM-DD used as the default received date. */
  today: string
  onCancel: () => void
  onConfirm: (amount: number, receivedAt: string, note: string) => void
}

function fmtMoney(value: number): string {
  return `$${(Number.isFinite(value) ? value : 0).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

export default function RecordServicePaymentModal({ request, today, onCancel, onConfirm }: Props) {
  const [amount, setAmount] = useState('')
  const [receivedAt, setReceivedAt] = useState(today)
  const [note, setNote] = useState('')

  useEffect(() => {
    if (!request) return
    setAmount(request.suggestedAmount > 0 ? String(request.suggestedAmount) : '')
    setReceivedAt(today)
    setNote('')
  }, [request, today])

  if (!request) return null

  const parsed = parseFloat(amount)
  const valid = Number.isFinite(parsed) && parsed > 0
  const remainingAfter = request.balanceDue - (valid ? parsed : 0)

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4">
      <div
        className="w-full max-w-sm rounded-lg border border-gray-700 p-4 space-y-3"
        style={{ backgroundColor: 'var(--bg-card)' }}
      >
        <div>
          <div className="text-sm font-bold text-gray-100">{request.title}</div>
          <div className="text-[10px] text-gray-400 mt-0.5">{request.customer}</div>
        </div>

        <div className="text-[10px] text-gray-400 font-mono leading-relaxed">
          {fmtMoney(request.totalBillable)} total billable
          {' · '}
          {fmtMoney(request.alreadyCollected)} already collected
          {' · '}
          <span className="text-orange-400">{fmtMoney(request.balanceDue)} balance due</span>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[10px] text-gray-400 uppercase font-bold mb-1">Amount received $</label>
            <input
              type="number" step="0.01" autoFocus
              value={amount}
              onChange={e => setAmount(e.target.value)}
              className="w-full rounded-lg px-3 py-2 text-sm text-gray-200 border border-gray-600 focus:border-orange-500 outline-none"
              style={{ backgroundColor: 'var(--bg-input)' }}
            />
          </div>
          <div>
            <label className="block text-[10px] text-gray-400 uppercase font-bold mb-1">Date received</label>
            <input
              type="date"
              value={receivedAt}
              onChange={e => setReceivedAt(e.target.value)}
              className="w-full rounded-lg px-3 py-2 text-sm text-gray-200 border border-gray-600 focus:border-orange-500 outline-none"
              style={{ backgroundColor: 'var(--bg-input)' }}
            />
          </div>
        </div>

        <div>
          <label className="block text-[10px] text-gray-400 uppercase font-bold mb-1">Note (optional)</label>
          <input
            type="text"
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="Check #, cash, transfer…"
            className="w-full rounded-lg px-3 py-2 text-sm text-gray-200 border border-gray-600 focus:border-orange-500 outline-none"
            style={{ backgroundColor: 'var(--bg-input)' }}
          />
        </div>

        {valid && (
          <div className="text-[10px] text-gray-400">
            {remainingAfter > 0.009
              ? <>Balance remaining after this payment: <span className="text-orange-400 font-mono">{fmtMoney(remainingAfter)}</span></>
              : <span className="text-emerald-400">This settles the balance in full.</span>}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 rounded text-[11px] text-gray-300 border border-gray-600"
          >
            Cancel
          </button>
          <button
            disabled={!valid || !receivedAt}
            onClick={() => onConfirm(parsed, receivedAt, note)}
            className="px-3 py-1.5 rounded text-[11px] font-bold text-white bg-emerald-600 disabled:opacity-40"
          >
            Record Payment
          </button>
        </div>
      </div>
    </div>
  )
}
