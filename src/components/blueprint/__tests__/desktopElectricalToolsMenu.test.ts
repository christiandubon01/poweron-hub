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

function drawBucketSource() {
  const start = source.indexOf("{toolbarBucket === 'draw' && (")
  const end = source.indexOf('<div className="space-y-1.5">', start)
  expect(start).toBeGreaterThan(-1)
  expect(end).toBeGreaterThan(start)
  return source.slice(start, end)
}

function desktopElectricalToolsSource() {
  const drawSource = drawBucketSource()
  const start = drawSource.indexOf('data-testid="desktop-electrical-tools-menu"')
  const end = drawSource.indexOf('{!useDesktopThreePaneLayout && (', start)
  expect(start).toBeGreaterThan(-1)
  expect(end).toBeGreaterThan(start)
  return drawSource.slice(start, end)
}

function quickAccessHeaderSource() {
  const start = source.indexOf('<div className="text-xs font-semibold text-gray-100">Quick Access</div>')
  const end = source.indexOf('<div className="grid grid-cols-2 gap-1.5">', start)
  expect(start).toBeGreaterThan(-1)
  expect(end).toBeGreaterThan(start)
  return source.slice(start, end)
}

describe('desktop Electrical Tools menu structure', () => {
  it('renders Electrical Tools only in the desktop three-pane branch', () => {
    const menuSource = desktopElectricalToolsSource()

    expect(drawBucketSource()).toContain('{useDesktopThreePaneLayout && (')
    expect(menuSource).toContain('Electrical Tools')
    expect(menuSource).toContain('data-testid="desktop-electrical-tools-menu"')
    expect(menuSource).toContain('aria-label="Electrical Tools"')
    expect(menuSource).not.toContain('!useDesktopThreePaneLayout')
  })

  it('uses a controlled accessible disclosure parent', () => {
    const menuSource = desktopElectricalToolsSource()

    expect(menuSource).toContain('type="button"')
    expect(menuSource).toContain('aria-expanded={desktopElectricalToolsOpen}')
    expect(menuSource).toContain('aria-controls="desktop-electrical-tools-panel"')
    expect(menuSource).toContain('id="desktop-electrical-tools-panel"')
    expect(menuSource).toContain('<ChevronDown')
    expect(menuSource).toContain('focus-visible:outline')
  })

  it('orders Wire Profiles utility before Circuit Path and Circuit Arc', () => {
    const menuSource = desktopElectricalToolsSource()
    const wireProfilesIndex = menuSource.indexOf('data-testid="desktop-electrical-tools-wire-profiles"')
    const circuitPathIndex = menuSource.indexOf('Circuit Path</button>')
    const circuitArcIndex = menuSource.indexOf('Circuit Arc</button>')

    expect(wireProfilesIndex).toBeGreaterThan(-1)
    expect(circuitPathIndex).toBeGreaterThan(wireProfilesIndex)
    expect(circuitArcIndex).toBeGreaterThan(circuitPathIndex)
  })

  it('keeps Circuit Labels outside the Electrical Tools disclosure', () => {
    const menuSource = desktopElectricalToolsSource()
    const drawSource = drawBucketSource()
    const labelsIndex = drawSource.indexOf('Circuit Labels {showCircuitMeasurementLabels')

    expect(menuSource).not.toContain('Circuit Labels {showCircuitMeasurementLabels')
    expect(labelsIndex).toBeGreaterThan(drawSource.indexOf('desktop-electrical-tools-menu'))
  })

  it('removes old desktop flat Circuit Path and Circuit Arc while preserving non-desktop copies', () => {
    const drawSource = drawBucketSource()
    const nonDesktopStart = drawSource.indexOf('{!useDesktopThreePaneLayout && (')
    const nonDesktopSource = drawSource.slice(nonDesktopStart)

    expect(nonDesktopStart).toBeGreaterThan(-1)
    expect(nonDesktopSource).toContain('Circuit Path</button>')
    expect(nonDesktopSource).toContain('Circuit Arc</button>')
    expect(desktopElectricalToolsSource()).toContain('Circuit Path</button>')
    expect(desktopElectricalToolsSource()).toContain('Circuit Arc</button>')
  })

  it('removes the desktop Quick Access header Wire Profiles button', () => {
    expect(quickAccessHeaderSource()).not.toContain('Manage wire profiles')
    expect(quickAccessHeaderSource()).not.toContain('Wire Profiles')
    expect(countOccurrences(desktopElectricalToolsSource(), 'aria-label="Manage wire profiles"')).toBe(1)
  })

  it('keeps disclosure state independent of desktop electrical symbol category state', () => {
    const menuSource = desktopElectricalToolsSource()
    const categoryStart = source.indexOf('DESKTOP_ELECTRICAL_TOOL_CATEGORIES.map((category)')
    const categoryEnd = source.indexOf('(useDesktopThreePaneLayout ? desktopElectricalSymbolOptions', categoryStart)
    const categorySource = source.slice(categoryStart, categoryEnd)

    expect(source).toContain('const [desktopElectricalToolsOpen, setDesktopElectricalToolsOpen] = useState(readDesktopElectricalToolsOpen)')
    expect(menuSource).toContain('setDesktopElectricalToolsOpen(next)')
    expect(menuSource).toContain('writeDesktopElectricalToolsOpen(next)')
    expect(menuSource).not.toContain('setOpenDesktopElectricalCategory')
    expect(categorySource).not.toContain('setDesktopElectricalToolsOpen')
    expect(categorySource).not.toContain('writeDesktopElectricalToolsOpen')
  })

  it('keeps child activation callbacks open and reuses existing tool state wiring', () => {
    const menuSource = desktopElectricalToolsSource()
    const pathIndex = menuSource.indexOf("setShapeKind('circuit-path')")
    const arcIndex = menuSource.indexOf("setShapeKind('circuit-arc')")

    expect(menuSource).toContain('clearActiveQuickAccessSession()')
    expect(menuSource).toContain("setToolMode('shape')")
    expect(pathIndex).toBeGreaterThan(-1)
    expect(arcIndex).toBeGreaterThan(pathIndex)
    expect(menuSource).not.toContain('setDesktopElectricalToolsOpen(false)')
  })

  it('wires Escape to close and persist after higher priority Wire Profile and segment handlers', () => {
    const escapeStart = source.indexOf('const onKeyDown = (e: KeyboardEvent) => {')
    const escapeSource = source.slice(escapeStart, source.indexOf('// Stop paste mode first', escapeStart))

    expect(escapeSource.indexOf('if (isWireProfileManagerOpen)')).toBeLessThan(escapeSource.indexOf('if (desktopElectricalToolsOpen)'))
    expect(escapeSource.indexOf('if (wireSegmentPickSession)')).toBeLessThan(escapeSource.indexOf('if (desktopElectricalToolsOpen)'))
    expect(escapeSource).toContain('setDesktopElectricalToolsOpen(false)')
    expect(escapeSource).toContain('writeDesktopElectricalToolsOpen(false)')
  })

  it('does not introduce outside-click dismissal or Quick Access preference mutation', () => {
    const quickAccessStart = source.indexOf('const applyQuickAccessPreset =')
    const quickAccessApplySource = source.slice(quickAccessStart, source.indexOf('const quickAccessIcon =', quickAccessStart))
    const menuSource = desktopElectricalToolsSource()

    expect(menuSource).not.toContain("addEventListener('mousedown'")
    expect(menuSource).not.toContain("addEventListener('pointerdown'")
    expect(quickAccessApplySource).not.toContain('setDesktopElectricalToolsOpen')
    expect(quickAccessApplySource).not.toContain('writeDesktopElectricalToolsOpen')
  })

  it('arms the parent only for Circuit Path or Circuit Arc tool state', () => {
    const menuSource = desktopElectricalToolsSource()

    expect(menuSource).toContain("toolMode === 'shape' && (shapeKind === 'circuit-path' || shapeKind === 'circuit-arc')")
    expect(menuSource).not.toContain("desktopElectricalToolsOpen ? 'border-cyan-500")
    expect(menuSource).not.toContain('isWireProfileManagerOpen ?')
  })
})
