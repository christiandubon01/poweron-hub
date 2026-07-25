import { X } from 'lucide-react'

export function WireProfileConfirmDialog({
  title,
  body,
  confirmLabel,
  danger = false,
  busy = false,
  onCancel,
  onConfirm,
}: {
  title: string
  body: string
  confirmLabel: string
  danger?: boolean
  busy?: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <div
      className="absolute inset-0 z-[100080] flex items-center justify-center bg-black/70 p-4"
      onMouseDown={(event) => {
        event.stopPropagation()
        if (!busy && event.target === event.currentTarget) onCancel()
      }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="w-full max-w-md rounded-lg border border-gray-700 bg-[#111827] shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 border-b border-gray-800 px-4 py-3">
          <h4 className="text-sm font-semibold text-gray-100">{title}</h4>
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-gray-700 text-gray-400 hover:border-gray-500 hover:text-white disabled:opacity-50"
            aria-label="Cancel confirmation"
          >
            <X size={15} />
          </button>
        </div>
        <div className="px-4 py-4 text-sm leading-6 text-gray-300">{body}</div>
        <div className="flex items-center justify-end gap-2 border-t border-gray-800 px-4 py-3">
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="inline-flex min-h-11 items-center rounded-md border border-gray-700 px-4 text-sm text-gray-300 hover:border-gray-500 hover:text-white disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onConfirm}
            className={`inline-flex min-h-11 items-center rounded-md px-4 text-sm font-semibold text-white disabled:opacity-50 ${danger ? 'bg-red-600 hover:bg-red-500' : 'bg-blue-600 hover:bg-blue-500'}`}
          >
            {busy ? 'Working...' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
