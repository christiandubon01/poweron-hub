import { renderElectricalSymbolSvg, type ElectricalSymbolKind } from '@/components/blueprint/electricalSymbolRegistry'

const DEFAULT_STYLE = {
  borderColor: '#67e8f9',
  borderThickness: 2,
  borderStyle: 'solid' as const,
  fillColor: 'transparent',
  fillOpacity: 0,
  labelsVisible: false,
}

export function ElectricalSymbolGlyph({
  shapeKind,
  size = 28,
}: {
  shapeKind: ElectricalSymbolKind
  size?: number
}) {
  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      className="pointer-events-none inline-block flex-shrink-0 text-cyan-200"
      aria-hidden="true"
      focusable="false"
      data-electrical-symbol-glyph={shapeKind}
    >
      {renderElectricalSymbolSvg(shapeKind as any, {}, DEFAULT_STYLE)}
    </svg>
  )
}
