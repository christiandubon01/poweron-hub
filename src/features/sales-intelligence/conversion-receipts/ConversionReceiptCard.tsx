/**
 * SALES-CONVERSION-1 — A single conversion ticket.
 *
 * Reads as a durable transaction receipt, not another editable lead card:
 * no status toggles, no delete, no inline edit. Project conversions carry a
 * green/project accent, Service Call conversions an orange/service accent.
 */

import React from 'react'
import { Briefcase, Wrench, ExternalLink, Clock, User } from 'lucide-react'
import type { ConversionReceipt } from './conversionReceiptTypes'
import { formatSourceLabel } from './conversionReceiptSource'
import { shortReceiptId } from './conversionReceiptService'

/** Custom events AppShell listens for. Reuses the existing nav mechanism. */
export const OPEN_PROJECT_EVENT = 'poweron:open-project'
export const OPEN_SERVICE_CALL_EVENT = 'poweron:open-service-call'

const ACCENT = {
  project: {
    border: 'border-l-emerald-500',
    chip: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
    button: 'bg-emerald-600 hover:bg-emerald-500',
    label: 'Project',
    Icon: Briefcase,
  },
  service_call: {
    border: 'border-l-orange-500',
    chip: 'bg-orange-500/15 text-orange-300 border-orange-500/30',
    button: 'bg-orange-600 hover:bg-orange-500',
    label: 'Service Call',
    Icon: Wrench,
  },
} as const

function formatMoney(value: number): string {
  return `$${Math.round(value).toLocaleString('en-US')}`
}

function formatWhen(iso: string): string {
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) return '—'
  return new Date(ms).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export interface ConversionReceiptCardProps {
  receipt: ConversionReceipt
  /** Overridable for tests; defaults to dispatching the AppShell nav event. */
  onOpenDestination?: (receipt: ConversionReceipt) => void
}

export function openDestinationForReceipt(receipt: ConversionReceipt): void {
  const eventName =
    receipt.destinationType === 'project' ? OPEN_PROJECT_EVENT : OPEN_SERVICE_CALL_EVENT
  window.dispatchEvent(
    new CustomEvent(eventName, {
      detail: {
        destinationId: receipt.destinationId,
        destinationLabel: receipt.destinationLabel,
        receiptId: receipt.id,
      },
    })
  )
}

export const ConversionReceiptCard: React.FC<ConversionReceiptCardProps> = ({
  receipt,
  onOpenDestination,
}) => {
  const accent = ACCENT[receipt.destinationType] ?? ACCENT.project
  const { Icon } = accent
  const handleOpen = () => (onOpenDestination ?? openDestinationForReceipt)(receipt)

  return (
    <div
      data-testid="conversion-receipt-card"
      className={`bg-gray-950 border border-gray-800 border-l-4 ${accent.border} rounded-lg p-4`}
    >
      {/* Ticket header: receipt number + destination type */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <div className="font-mono text-[11px] tracking-wider text-gray-500">
            {shortReceiptId(receipt)}
          </div>
          <h4 className="text-white font-semibold truncate">{receipt.leadName}</h4>
          {receipt.leadCompany && (
            <div className="text-xs text-gray-500 truncate">{receipt.leadCompany}</div>
          )}
        </div>
        <span
          className={`flex items-center gap-1.5 shrink-0 text-[11px] font-bold px-2 py-1 rounded border ${accent.chip}`}
        >
          <Icon size={12} />
          {accent.label}
        </span>
      </div>

      {/* Source: family badge + detail kept visually distinct */}
      <div className="flex flex-wrap items-center gap-1.5 mb-3">
        <span className="text-[11px] font-semibold bg-gray-800 text-gray-300 px-2 py-0.5 rounded">
          {receipt.sourceFamily}
        </span>
        {receipt.sourceDetail && (
          <>
            <span className="text-gray-600 text-[11px]">/</span>
            <span className="text-[11px] bg-gray-800/60 text-gray-400 px-2 py-0.5 rounded">
              {receipt.sourceDetail}
            </span>
          </>
        )}
      </div>

      {/* Ticket body */}
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs mb-3">
        <div className="col-span-2">
          <dt className="text-gray-600">Converted to</dt>
          <dd className="text-gray-200 truncate">
            {receipt.destinationLabel || receipt.destinationId}
          </dd>
        </div>
        <div>
          <dt className="text-gray-600">Converted value</dt>
          <dd className="text-gray-200">
            {receipt.convertedValue !== null ? (
              formatMoney(receipt.convertedValue)
            ) : (
              <span className="text-gray-600">Not quoted</span>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-gray-600">Est. value at conversion</dt>
          <dd className="text-gray-400">
            {receipt.leadEstimatedValue !== null ? formatMoney(receipt.leadEstimatedValue) : '—'}
          </dd>
        </div>
        {receipt.leadScoreAtConversion !== null && (
          <div>
            <dt className="text-gray-600">Score at conversion</dt>
            <dd className="text-gray-400">{receipt.leadScoreAtConversion}</dd>
          </div>
        )}
        {receipt.leadStatusBefore && (
          <div>
            <dt className="text-gray-600">Status before</dt>
            <dd className="text-gray-400">{receipt.leadStatusBefore}</dd>
          </div>
        )}
      </dl>

      {/* Ticket footer: when + who + open */}
      <div className="flex items-center justify-between gap-3 border-t border-gray-800 pt-2.5">
        <div className="text-[11px] text-gray-500 space-y-0.5 min-w-0">
          <div className="flex items-center gap-1.5">
            <Clock size={11} />
            {formatWhen(receipt.convertedAt)}
          </div>
          <div className="flex items-center gap-1.5 truncate">
            <User size={11} />
            {receipt.convertedByName || receipt.convertedBy || 'Unknown'}
          </div>
        </div>
        <button
          type="button"
          onClick={handleOpen}
          className={`shrink-0 flex items-center gap-1.5 text-white text-xs font-semibold px-3 py-1.5 rounded transition ${accent.button}`}
        >
          <ExternalLink size={12} />
          Open {accent.label}
        </button>
      </div>
    </div>
  )
}

export default ConversionReceiptCard
