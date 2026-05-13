// @ts-nocheck
import { useEffect, useRef, useState, ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, ChevronUp, Minus, Plus } from 'lucide-react'

// ─── Palette ──────────────────────────────────────────────────────────────────
const PALETTE = ['#facc15', '#38bdf8', '#f97316', '#22c55e', '#a78bfa', '#ef4444', '#ffffff']

// ─── ColorRow ─────────────────────────────────────────────────────────────────
interface ColorRowProps {
  value: string
  onChange: (color: string) => void
  allowTransparent?: boolean
  colors?: string[]
}

export function ColorRow({ value, onChange, allowTransparent = false, colors }: ColorRowProps) {
  const palette = colors ?? PALETTE
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {allowTransparent && (
        <button
          type="button"
          onClick={() => onChange('transparent')}
          title="Transparent"
          style={{
            width: 20,
            height: 20,
            borderRadius: '50%',
            border: value === 'transparent' ? '2px solid #fff' : '1px solid rgba(255,255,255,0.25)',
            background:
              'repeating-conic-gradient(#aaa 0% 25%, #fff 0% 50%) 0 0 / 10px 10px',
            flexShrink: 0,
          }}
        />
      )}
      {palette.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => onChange(c)}
          title={c}
          style={{
            width: 20,
            height: 20,
            borderRadius: '50%',
            backgroundColor: c,
            border: value === c ? '2px solid #fff' : '1px solid rgba(255,255,255,0.2)',
            flexShrink: 0,
          }}
        />
      ))}
    </div>
  )
}

// ─── Stepper ──────────────────────────────────────────────────────────────────
interface StepperProps {
  label: string
  value: number
  onChange: (v: number) => void
  min: number
  max: number
  step: number
  unit?: string
}

export function Stepper({ label, value, onChange, min, max, step, unit = '' }: StepperProps) {
  const decrement = () => {
    const next = Math.round((value - step) * 1000) / 1000
    if (next >= min) onChange(next)
  }
  const increment = () => {
    const next = Math.round((value + step) * 1000) / 1000
    if (next <= max) onChange(next)
  }

  return (
    <div className="flex flex-col gap-1">
      <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)' }}>{label}</span>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={decrement}
          disabled={value <= min}
          style={{
            width: 24,
            height: 24,
            borderRadius: 6,
            border: '1px solid rgba(255,255,255,0.12)',
            background: 'rgba(255,255,255,0.06)',
            color: value <= min ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.8)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: value <= min ? 'not-allowed' : 'pointer',
          }}
        >
          <Minus size={10} />
        </button>
        <span
          style={{
            minWidth: 44,
            textAlign: 'center',
            fontSize: 12,
            color: 'rgba(255,255,255,0.9)',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {unit === '%' ? `${Math.round(value)}%` : `${value}${unit}`}
        </span>
        <button
          type="button"
          onClick={increment}
          disabled={value >= max}
          style={{
            width: 24,
            height: 24,
            borderRadius: 6,
            border: '1px solid rgba(255,255,255,0.12)',
            background: 'rgba(255,255,255,0.06)',
            color: value >= max ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.8)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: value >= max ? 'not-allowed' : 'pointer',
          }}
        >
          <Plus size={10} />
        </button>
      </div>
    </div>
  )
}

// ─── LabeledSelect ────────────────────────────────────────────────────────────
interface LabeledSelectOption {
  label: string
  value: string
}

interface LabeledSelectProps {
  label: string
  value: string
  onChange: (v: string) => void
  options: LabeledSelectOption[]
}

export function LabeledSelect({ label, value, onChange, options }: LabeledSelectProps) {
  return (
    <div className="flex flex-col gap-1">
      <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)' }}>{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          background: 'rgba(255,255,255,0.06)',
          border: '1px solid rgba(255,255,255,0.12)',
          borderRadius: 6,
          color: 'rgba(255,255,255,0.9)',
          fontSize: 12,
          padding: '4px 8px',
        }}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  )
}

// ─── ToggleRow ────────────────────────────────────────────────────────────────
interface ToggleButton {
  label: ReactNode
  active: boolean
  onClick: () => void
}

interface ToggleRowProps {
  buttons: ToggleButton[]
}

export function ToggleRow({ buttons }: ToggleRowProps) {
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {buttons.map((btn, i) => (
        <button
          key={i}
          type="button"
          onClick={btn.onClick}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            padding: '4px 10px',
            borderRadius: 6,
            border: btn.active
              ? '1px solid rgba(96,165,250,0.7)'
              : '1px solid rgba(255,255,255,0.12)',
            background: btn.active ? 'rgba(59,130,246,0.2)' : 'rgba(255,255,255,0.05)',
            color: btn.active ? 'rgba(147,197,253,1)' : 'rgba(255,255,255,0.7)',
            fontSize: 11,
            cursor: 'pointer',
          }}
        >
          {btn.label}
        </button>
      ))}
    </div>
  )
}

// ─── ToolPopover ──────────────────────────────────────────────────────────────
interface ToolPopoverProps {
  open: boolean
  anchorEl: HTMLElement | null
  onClose: () => void
  title: string
  children: ReactNode
  additionalChildren?: ReactNode
}

const POPOVER_WIDTH_DESKTOP = 280
const POPOVER_WIDTH_MOBILE = 240

export function ToolPopover({
  open,
  anchorEl,
  onClose,
  title,
  children,
  additionalChildren,
}: ToolPopoverProps) {
  const popoverRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const [showAdditional, setShowAdditional] = useState(false)

  // Compute position whenever open or anchor changes
  useEffect(() => {
    if (!open || !anchorEl) {
      setPos(null)
      return
    }
    const isMobile = window.innerWidth < 700
    const popoverW = isMobile ? POPOVER_WIDTH_MOBILE : POPOVER_WIDTH_DESKTOP

    const anchorRect = anchorEl.getBoundingClientRect()
    const vh = window.innerHeight
    const vw = window.innerWidth

    // Flip above if anchor is in bottom 40% of viewport
    const isNearBottom = anchorRect.bottom > vh * 0.6
    let top: number
    if (isNearBottom) {
      // Position above anchor; we'll use a placeholder height — real height computed after mount
      top = anchorRect.top - 8 // will be adjusted below once we know popover height
    } else {
      top = anchorRect.bottom + 8
    }

    // Default left-aligned to anchor
    let left = anchorRect.left

    // Flip horizontally if would clip right edge
    if (left + popoverW > vw - 8) {
      left = Math.max(8, vw - popoverW - 8)
    }

    setPos({ top, left })
  }, [open, anchorEl])

  // Adjust vertical if popover clips bottom after render
  useEffect(() => {
    if (!pos || !popoverRef.current || !anchorEl) return
    const isMobile = window.innerWidth < 700
    const popoverW = isMobile ? POPOVER_WIDTH_MOBILE : POPOVER_WIDTH_DESKTOP
    const popoverH = popoverRef.current.offsetHeight
    const vh = window.innerHeight
    const anchorRect = anchorEl.getBoundingClientRect()
    const isNearBottom = anchorRect.bottom > vh * 0.6

    let top = pos.top
    if (isNearBottom) {
      top = anchorRect.top - popoverH - 8
    }
    // Clamp within viewport
    top = Math.max(8, Math.min(vh - popoverH - 8, top))

    let left = pos.left
    if (left + popoverW > window.innerWidth - 8) {
      left = Math.max(8, window.innerWidth - popoverW - 8)
    }

    if (top !== pos.top || left !== pos.left) {
      setPos({ top, left })
    }
  }, [pos, anchorEl])

  // Close on outside click
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        if (!anchorEl || !anchorEl.contains(e.target as Node)) {
          onClose()
        }
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open, onClose, anchorEl])

  // Close on Escape
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    document.addEventListener('keydown', handler, true)
    return () => document.removeEventListener('keydown', handler, true)
  }, [open, onClose])

  if (!open) return null

  const isMobile = typeof window !== 'undefined' && window.innerWidth < 700
  const popoverW = isMobile ? POPOVER_WIDTH_MOBILE : POPOVER_WIDTH_DESKTOP

  const popover = (
    <div
      ref={popoverRef}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      style={{
        position: 'fixed',
        top: pos?.top ?? -9999,
        left: pos?.left ?? -9999,
        width: popoverW,
        maxHeight: '70vh',
        overflowY: 'auto',
        zIndex: 9999,
        background: '#1a1d27',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 12,
        padding: '14px 16px',
        boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 2,
        }}
      >
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: 'rgba(255,255,255,0.5)',
          }}
        >
          {title}
        </span>
        <button
          type="button"
          onClick={onClose}
          style={{
            background: 'none',
            border: 'none',
            color: 'rgba(255,255,255,0.4)',
            cursor: 'pointer',
            fontSize: 16,
            lineHeight: 1,
            padding: '0 2px',
          }}
          title="Close"
        >
          ×
        </button>
      </div>

      {/* Primary content */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {children}
      </div>

      {/* Additional settings disclosure */}
      {additionalChildren && (
        <>
          <button
            type="button"
            onClick={() => setShowAdditional((v) => !v)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              background: 'none',
              border: 'none',
              color: 'rgba(255,255,255,0.45)',
              cursor: 'pointer',
              fontSize: 11,
              padding: 0,
              marginTop: -4,
            }}
          >
            {showAdditional ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            Additional Settings
          </button>
          {showAdditional && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {additionalChildren}
            </div>
          )}
        </>
      )}
    </div>
  )

  return createPortal(popover, document.body)
}
