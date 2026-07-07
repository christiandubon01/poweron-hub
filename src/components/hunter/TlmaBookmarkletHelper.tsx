import React, { useState } from 'react'
import { Bookmark, Copy, Check } from 'lucide-react'
import {
  getTlmaBookmarkletHref,
  getTlmaBookmarkletCode,
  TLMA_BOOKMARKLET_LABEL,
} from '@/services/hunter/tlmaBookmarklet'

export interface TlmaBookmarkletHelperProps {
  onImportFromClipboard?: () => void
  onManualPaste?: () => void
  isImporting?: boolean
  clipboardStatus?: string | null
}

export function TlmaBookmarkletHelper({
  onImportFromClipboard,
  onManualPaste,
  isImporting = false,
  clipboardStatus = null,
}: TlmaBookmarkletHelperProps) {
  const [copied, setCopied] = useState(false)
  const bookmarkletHref = getTlmaBookmarkletHref()
  const bookmarkletCode = getTlmaBookmarkletCode()

  const handleCopyBookmarklet = async () => {
    try {
      await navigator.clipboard.writeText(bookmarkletCode)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2500)
    } catch {
      const input = document.createElement('textarea')
      input.value = bookmarkletCode
      input.style.position = 'fixed'
      input.style.left = '-9999px'
      document.body.appendChild(input)
      input.select()
      try {
        document.execCommand('copy')
        setCopied(true)
        window.setTimeout(() => setCopied(false), 2500)
      } catch {
        window.alert('Could not copy bookmarklet. Select the text field and copy manually.')
      }
      document.body.removeChild(input)
    }
  }

  return (
    <div className="rounded border border-indigo-900/60 bg-indigo-950/30 p-3 space-y-3">
      <div>
        <div className="text-sm font-medium text-indigo-100 flex items-center gap-2">
          <Bookmark size={14} className="text-indigo-300" />
          TLMA Bookmarklet Helper
        </div>
        <p className="text-xs text-gray-400 mt-1">
          Install this browser helper once. When you are on the TLMA results page, click it to copy the
          visible permit table. Then return here and click Import From Clipboard.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <a
          href={bookmarkletHref}
          onClick={(e) => e.preventDefault()}
          className="inline-flex items-center gap-2 px-3 py-2 bg-indigo-700 hover:bg-indigo-600 text-white text-sm rounded cursor-grab active:cursor-grabbing"
          title="Drag this button to your bookmarks bar"
        >
          <Bookmark size={14} />
          {TLMA_BOOKMARKLET_LABEL}
        </a>

        {onImportFromClipboard && (
          <button
            type="button"
            onClick={onImportFromClipboard}
            disabled={isImporting}
            className="inline-flex items-center gap-2 px-3 py-2 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white text-sm rounded"
          >
            {isImporting ? 'Reading clipboard…' : 'Import From Clipboard'}
          </button>
        )}

        {onManualPaste && (
          <button
            type="button"
            onClick={onManualPaste}
            className="text-xs text-gray-400 hover:text-gray-200 underline"
          >
            Manual Paste
          </button>
        )}
      </div>

      <div className="text-xs text-gray-500 space-y-1">
        <p className="font-medium text-gray-400">Chrome install steps</p>
        <ol className="list-decimal list-inside space-y-0.5">
          <li>Drag &quot;{TLMA_BOOKMARKLET_LABEL}&quot; to your bookmarks bar.</li>
          <li>Open TLMA Search from Hunter.</li>
          <li>After results load, click the bookmarklet.</li>
          <li>Return to Hunter.</li>
          <li>Click Import From Clipboard.</li>
        </ol>
      </div>

      <div className="space-y-1">
        <label className="text-xs text-gray-500">Or copy bookmarklet code</label>
        <div className="flex gap-2">
          <input
            readOnly
            value={bookmarkletCode}
            className="flex-1 min-w-0 px-2 py-1.5 bg-gray-950 text-gray-300 text-[11px] font-mono rounded border border-gray-700"
            onFocus={(e) => e.currentTarget.select()}
          />
          <button
            type="button"
            onClick={handleCopyBookmarklet}
            className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-200 text-xs rounded border border-gray-700"
          >
            {copied ? <Check size={12} /> : <Copy size={12} />}
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      </div>

      {clipboardStatus && (
        <p className="text-xs text-gray-300 border border-gray-800 rounded px-2 py-1.5 bg-gray-900/80">
          {clipboardStatus}
        </p>
      )}
    </div>
  )
}

export default TlmaBookmarkletHelper
