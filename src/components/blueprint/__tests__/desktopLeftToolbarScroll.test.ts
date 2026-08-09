import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(
  join(process.cwd(), 'src/components/blueprint/OperationsBlueprintPdfViewer.tsx'),
  'utf8',
)

function countOccurrences(haystack: string, needle: string) {
  return haystack.split(needle).length - 1
}

function desktopToolbarScrollSource() {
  const start = source.indexOf('<DesktopToolbarScrollContent enabled={useDesktopThreePaneLayout}>')
  const end = source.indexOf('</DesktopToolbarScrollContent>', start)
  expect(start).toBeGreaterThan(-1)
  expect(end).toBeGreaterThan(start)
  return source.slice(start, end)
}

describe('desktop left toolbar scroll structure', () => {
  it('keeps the normal desktop grid height definite while preserving fullscreen rows', () => {
    expect(source).toContain('grid grid-rows-[auto_auto_minmax(0,1fr)] p-4')
    expect(source).toContain("minHeight: isFullScreenView && isDesktopBlueprintLayout ? 'calc(100vh - 52px)' : isTabletImmersiveFullscreen ? 'calc(100vh - 40px)' : normalBlueprintViewerMinHeight")
    expect(source).toContain("height: isFullScreenView && isDesktopBlueprintLayout ? 'calc(100vh - 52px)' : isTabletImmersiveFullscreen ? 'calc(100vh - 40px)' : normalBlueprintViewerMinHeight")
    expect(source).toContain("normalBlueprintViewerMinHeight = isDesktopBlueprintLayout")
    expect(source).toContain("'calc(100dvh - 120px)'")
  })

  it('sizes the desktop outer toolbar as the full-height non-scrolling pane', () => {
    expect(source).toContain("'bv-left-toolbar col-start-1 row-start-3 min-h-0 h-full overflow-hidden flex flex-col rounded-xl border border-gray-800 bg-[#10131c] p-4'")
    expect(source).not.toContain('bv-left-toolbar col-start-1 row-start-3 self-start')
    expect(source).toContain("'px-3 sm:px-4 py-1 border-b border-gray-800 space-y-1 flex-shrink-0'")
  })

  it('uses one desktop-only inner scroll owner with preserved toolbar spacing', () => {
    expect(countOccurrences(source, 'data-testid="desktop-left-toolbar-scroll"')).toBe(1)
    expect(source).toContain('if (!enabled) return <>{children}</>')
    expect(source).toContain('className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain space-y-2"')
    expect(source).not.toContain('bv-left-toolbar col-start-1 row-start-3 min-h-0 h-full overflow-hidden flex flex-col rounded-xl border border-gray-800 bg-[#10131c] p-4 space-y-2')
  })

  it('keeps tools and electrical categories inside the scroll owner while floating palettes stay separate', () => {
    const scrollSource = desktopToolbarScrollSource()

    expect(scrollSource).toContain('<Undo2 size={13} /> Undo')
    expect(scrollSource).toContain('<Redo2 size={13} /> Redo')
    expect(scrollSource).toContain('DESKTOP_ELECTRICAL_TOOL_CATEGORIES.map((category)')
    expect(scrollSource).toContain('key={category.id}')
    expect(scrollSource).toContain('category.children.map((childKind)')
    expect(scrollSource).toContain('Floating Palettes')
    expect(scrollSource).toContain('Electrical Symbols')
    expect(scrollSource).not.toContain('quickAccessPresets.map((preset, index)')
  })

  it('keeps the left resize handle outside the scroll wrapper and leaves pane width persistence intact', () => {
    const scrollSource = desktopToolbarScrollSource()

    expect(source.indexOf('col-start-2 row-start-1 row-span-3 flex items-center justify-center cursor-col-resize')).toBeLessThan(
      source.indexOf('<DesktopToolbarScrollContent enabled={useDesktopThreePaneLayout}>'),
    )
    expect(scrollSource).not.toContain('cursor-col-resize')
    expect(source).toContain("localStorage.getItem('blueprint_left_pane_width')")
    expect(source).toContain("localStorage.setItem('blueprint_left_pane_width', String(next))")
    expect(source).toContain('return saved ? Math.max(160, Math.min(480, parseInt(saved, 10))) : 280')
    expect(source).toContain('Math.max(160, Math.min(480, dragStartWidthRef.current + delta))')
  })

  it('does not apply PDF scrolling behavior to the left toolbar or change center/right pane ownership', () => {
    const scrollSource = desktopToolbarScrollSource()

    expect(scrollSource).not.toContain('operations-pdf-scroll')
    expect(source).toContain("className={`${useDesktopThreePaneLayout ? 'col-start-3 row-start-1 row-span-3 min-h-0 min-w-0 bg-[#0d0e14]' : ''} operations-pdf-scroll")
    expect(source).toContain("className={`${useDesktopThreePaneLayout ? 'col-start-5 row-start-1 row-span-3 min-h-0 min-w-0' : ''} operations-pdf-scroll border border-gray-800 rounded-md bg-[#10131c] overflow-auto")
  })
})
