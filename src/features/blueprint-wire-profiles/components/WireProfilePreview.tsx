import { getPreviewStrokeDasharray, getWireProfilePreviewLabel } from '../wireProfileManagerState'
import type { WireDisplayStyle } from '../types'

export function WireProfilePreview({
  color,
  width,
  style,
  className = '',
}: {
  color: string
  width: number
  style: WireDisplayStyle | string
  className?: string
}) {
  return (
    <svg
      viewBox="0 0 120 24"
      className={`h-6 w-24 shrink-0 ${className}`}
      role="img"
      aria-label={getWireProfilePreviewLabel({ color, width, style: String(style) })}
      focusable="false"
      style={{ pointerEvents: 'none' }}
    >
      <line
        x1="8"
        y1="12"
        x2="112"
        y2="12"
        stroke={color || '#facc15'}
        strokeWidth={Math.max(1, Number(width) || 1)}
        strokeLinecap="round"
        strokeDasharray={getPreviewStrokeDasharray(String(style), Number(width) || 1)}
      />
    </svg>
  )
}
