/**
 * BLUEPRINT UI-2 — Package Pick has exactly one owner-facing activation control,
 * inside the Electrical Tools palette. The old standalone top-right canvas overlay
 * (trigger + count + Clear) was removed; nothing about the mode, the selection set,
 * or the canvas highlight changed.
 */
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

function packagePickControlsSource() {
  const start = source.indexOf('const renderPackagePickControls = ')
  const end = source.indexOf('const renderQuickAccessPaletteButton = ', start)
  expect(start).toBeGreaterThan(-1)
  expect(end).toBeGreaterThan(start)
  return source.slice(start, end)
}

function electricalToolsPanelSource() {
  const start = source.indexOf('id="desktop-electrical-tools-panel"')
  const end = source.indexOf('paletteId="electrical-symbols"', start)
  expect(start).toBeGreaterThan(-1)
  expect(end).toBeGreaterThan(start)
  return source.slice(start, end)
}

describe('Package Pick single activation path', () => {
  it('keeps Package Pick inside the Electrical Tools palette', () => {
    expect(electricalToolsPanelSource()).toContain('renderPackagePickControls()')
  })

  it('no longer renders the standalone top-right Package Pick overlay', () => {
    expect(source).not.toContain("renderPackagePickControls('touch-overlay')")
    expect(source).not.toContain('touch-overlay')
    expect(source).not.toContain('flex max-w-[calc(100vw-2rem)] flex-wrap items-center justify-end gap-1.5 rounded-lg border border-gray-700 bg-[#10131c]/95')
    expect(source).not.toContain('style={{ right: fsRail.show ? 24 : 8 }}')
  })

  it('renders exactly one Package Pick activation control', () => {
    expect(countOccurrences(source, 'renderPackagePickControls()')).toBe(1)
    expect(countOccurrences(source, 'onClick={togglePackagePickMode}')).toBe(1)
    expect(countOccurrences(source, 'const renderPackagePickControls = ')).toBe(1)
  })

  it('keeps the active-mode indicator visible inside Electrical Tools', () => {
    const controls = packagePickControlsSource()
    const drawStart = source.indexOf('data-testid="desktop-electrical-tools-menu"')
    const triggerSource = source.slice(drawStart, source.indexOf('{renderTouchElectricalSymbolsButton()}', drawStart))

    expect(controls).toContain("isPackagePickMode ? 'border-emerald-400/70 bg-emerald-500/15 text-emerald-200'")
    expect(controls).toContain("{isPackagePickMode ? 'Package Pick: On' : 'Package Pick'}")
    // Electrical Tools trigger keeps its collapsed-state active indicator.
    expect(triggerSource).toContain("isPackagePickMode ? 'border-emerald-400 text-emerald-200 bg-emerald-500/10'")
    expect(triggerSource).toContain('h-2 w-2 shrink-0 rounded-full bg-emerald-400')
  })

  it('keeps the selected count visible', () => {
    const controls = packagePickControlsSource()

    expect(controls).toContain('Package Pick: {selectedPackageCount} selected')
    expect(controls).toContain("selectedPackageCount > 0 ? 'font-semibold text-emerald-300' : 'text-gray-500'")
  })

  it('keeps Clear available whenever there is a selection', () => {
    const controls = packagePickControlsSource()

    expect(controls).toContain('{selectedPackageCount > 0 && (')
    expect(controls).toContain('onClick={clearPackagePickSelection}')
    expect(controls).toContain('title="Clear the package-pick selection"')
    expect(controls).toContain('<X size={10} /> Clear')
  })

  it('keeps the Package Pick mode state and handlers unchanged', () => {
    expect(source).toContain('const [isPackagePickMode, setIsPackagePickMode] = useState(false)')
    expect(source).toMatch(/const togglePackagePickMode = useCallback\(\(\) => \{\s*setIsPackagePickMode\(\(v\) => !v\)\s*\}, \[\]\)/)
    expect(source).toContain('const togglePackagePickId = useCallback((annotationId: string) => {')
    expect(source).toContain('const clearPackagePickSelection = useCallback(() => {')
    // Canvas pointerdown routing into Package Pick is untouched.
    expect(source).toContain('if (isPackagePickMode) {')
    expect(source).toContain('togglePackagePickId(annotationId)')
  })

  it('keeps the Left Control / Escape keyboard behavior', () => {
    expect(source).toContain("if (e.code === 'ControlLeft' && !e.repeat && !typing) {")
    expect(source).toContain('togglePackagePickMode()')
    expect(source).toMatch(/if \(e\.key === 'Escape' && !typing\) \{\s*setIsPackagePickMode\(false\)/)
    expect(packagePickControlsSource()).toContain('Left Ctrl or Esc to exit')
  })

  it('keeps the on-canvas selection highlight logic unchanged', () => {
    expect(source).toContain('{/* ── Package Pick on-canvas highlight ──')
    expect(source).toContain('annotationsVisible && selectedForPackageIds.size > 0 && canvasPageAnnotations.map((a)')
    expect(source).toContain('if (!a?.rect || !selectedForPackageIds.has(a.id)) return null')
    expect(source).toContain('if (isPackagePickMode && !isVisibleForPick) return')
    expect(source).toContain('if (!isAnnotationVisibleOnCanvas(id)) return // Package Pick adds visible annotations only')
  })

  it('keeps work package creation semantics unchanged', () => {
    expect(source).toContain('title="Add items selected with Package Pick to this work package"')
    expect(source).toContain('onClick={openCreateScopeLayerModal}')
    expect(source).toContain('Create Work Package')
  })
})
