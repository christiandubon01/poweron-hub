import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(
  join(process.cwd(), 'src/components/blueprint/OperationsBlueprintPdfViewer.tsx'),
  'utf8',
)

function drawBucketSource() {
  const start = source.indexOf("{toolbarBucket === 'draw' && (")
  const end = source.indexOf("{toolbarBucket === 'generate' && (", start)
  expect(start).toBeGreaterThan(-1)
  expect(end).toBeGreaterThan(start)
  return source.slice(start, end)
}

function desktopElectricalToolsSource() {
  const drawSource = drawBucketSource()
  const start = drawSource.indexOf('data-testid="desktop-electrical-tools-menu"')
  const end = drawSource.indexOf('paletteId="electrical-symbols"', start)
  expect(start).toBeGreaterThan(-1)
  expect(end).toBeGreaterThan(start)
  return drawSource.slice(start, end)
}

function labelOptionsMenuSource() {
  const menuSource = desktopElectricalToolsSource()
  const start = menuSource.indexOf('data-testid="desktop-label-options-menu"')
  const end = menuSource.indexOf('</div>', menuSource.indexOf('</div>', start) + 1)
  expect(start).toBeGreaterThan(-1)
  expect(end).toBeGreaterThan(start)
  return menuSource.slice(start, end)
}

function labelOptionsPanelSource() {
  const menuSource = desktopElectricalToolsSource()
  const start = menuSource.indexOf('id="desktop-label-options-panel"')
  const end = menuSource.indexOf('</div>', start)
  expect(start).toBeGreaterThan(-1)
  expect(end).toBeGreaterThan(start)
  return menuSource.slice(start, end)
}

function nonDesktopLabelControlsSource() {
  const drawSource = drawBucketSource()
  const firstNonDesktop = drawSource.indexOf('{!useDesktopThreePaneLayout && (')
  const electricalSymbols = drawSource.indexOf('<div className="space-y-1.5">', firstNonDesktop)
  const generateEnd = drawSource.length
  expect(electricalSymbols).toBeGreaterThan(firstNonDesktop)
  return drawSource.slice(electricalSymbols, generateEnd)
}

describe('desktop Label Options disclosure', () => {
  it('renders Label Options inside Electrical Tools immediately after Circuit Labels', () => {
    const menuSource = desktopElectricalToolsSource()
    const circuitLabelsIndex = menuSource.indexOf('Circuit Labels {showCircuitMeasurementLabels')
    const labelOptionsIndex = menuSource.indexOf('data-testid="desktop-label-options-menu"')
    const electricalSymbolsIndex = drawBucketSource().indexOf('<div className="text-[10px] uppercase tracking-wide text-gray-500">Electrical Symbols</div>')

    expect(circuitLabelsIndex).toBeGreaterThan(-1)
    expect(labelOptionsIndex).toBeGreaterThan(circuitLabelsIndex)
    expect(drawBucketSource().indexOf('data-testid="desktop-label-options-menu"')).toBeLessThan(electricalSymbolsIndex)
  })

  it('uses a non-persisted accessible parent disclosure that defaults closed', () => {
    const controlsSource = labelOptionsMenuSource()

    expect(source).toContain('const [desktopLabelOptionsOpen, setDesktopLabelOptionsOpen] = useState(false)')
    expect(controlsSource).toContain('type="button"')
    expect(controlsSource).toContain('aria-expanded={desktopLabelOptionsOpen}')
    expect(controlsSource).toContain('aria-controls="desktop-label-options-panel"')
    expect(controlsSource).toContain('aria-label="Label Options"')
    expect(controlsSource).toContain('<ChevronDown')
    expect(controlsSource).toContain('focus-visible:outline')
    expect(controlsSource).toContain('setDesktopLabelOptionsOpen((open) => !open)')
    expect(controlsSource).not.toContain('writeDesktopElectricalToolsOpen')
  })

  it('renders Hide/Show Labels first and Symbols Size second inside the child panel', () => {
    const panelSource = labelOptionsPanelSource()
    const hideLabelsIndex = panelSource.indexOf("electricalSymbolLabelsVisible ? 'Hide Labels' : 'Show Labels'")
    const symbolsSizeIndex = panelSource.indexOf('Symbols Size ({Math.round(symbolLabelScale * 100)}%)')

    expect(panelSource).toContain('data-testid="desktop-label-options-panel"')
    expect(hideLabelsIndex).toBeGreaterThan(-1)
    expect(symbolsSizeIndex).toBeGreaterThan(hideLabelsIndex)
  })

  it('keeps child interactions scoped and leaves both disclosures open', () => {
    const panelSource = labelOptionsPanelSource()
    const hideButtonStart = panelSource.indexOf('onClick={() => setElectricalSymbolLabelsVisible((v) => !v)}')
    const hideButtonEnd = panelSource.indexOf('</button>', hideButtonStart)
    const sizeButtonStart = panelSource.indexOf('onClick={openSymbolSizePanel}')
    const sizeButtonEnd = panelSource.indexOf('</button>', sizeButtonStart)
    const hideButtonSource = panelSource.slice(hideButtonStart, hideButtonEnd)
    const sizeButtonSource = panelSource.slice(sizeButtonStart, sizeButtonEnd)

    expect(hideButtonStart).toBeGreaterThan(-1)
    expect(sizeButtonStart).toBeGreaterThan(hideButtonStart)
    expect(hideButtonSource).not.toContain('openSymbolSizePanel')
    expect(sizeButtonSource).not.toContain('setElectricalSymbolLabelsVisible')
    expect(panelSource).not.toContain('setDesktopLabelOptionsOpen(false)')
    expect(panelSource).not.toContain('setDesktopElectricalToolsOpen')
    expect(panelSource).not.toContain('writeDesktopElectricalToolsOpen')
  })

  it('uses sibling buttons rather than nested buttons', () => {
    const controlsSource = labelOptionsMenuSource()
    const firstButtonEnd = controlsSource.indexOf('</button>')
    const panelStart = controlsSource.indexOf('id="desktop-label-options-panel"')

    expect(firstButtonEnd).toBeGreaterThan(-1)
    expect(panelStart).toBeGreaterThan(firstButtonEnd)
    expect(controlsSource.slice(controlsSource.indexOf('<button') + '<button'.length, firstButtonEnd)).not.toContain('<button')
    expect(labelOptionsPanelSource().split('<button').length - 1).toBe(2)
  })

  it('removes desktop standalone duplicates outside Electrical Tools', () => {
    const drawSource = drawBucketSource()
    const menuSource = desktopElectricalToolsSource()

    expect(drawSource.split('data-testid="desktop-label-options-menu"').length - 1).toBe(1)
    expect(drawSource).not.toContain('data-testid="desktop-symbol-label-controls"')
    expect(menuSource).toContain("electricalSymbolLabelsVisible ? 'Hide Labels' : 'Show Labels'")
    expect(menuSource).toContain('Symbols Size ({Math.round(symbolLabelScale * 100)}%)')
  })

  it('moves non-desktop standalone label controls into the Electrical Tools floating palette', () => {
    const drawSource = drawBucketSource()
    const menuSource = desktopElectricalToolsSource()

    expect(drawSource).not.toContain('{!useDesktopThreePaneLayout && (')
    expect(menuSource).toContain("electricalSymbolLabelsVisible ? 'Hide Labels' : 'Show Labels'")
    expect(menuSource).toContain('Symbols Size ({Math.round(symbolLabelScale * 100)}%)')
  })

  it('does not add outside-click dismissal', () => {
    const controlsSource = labelOptionsMenuSource()

    expect(controlsSource).not.toContain("addEventListener('mousedown'")
    expect(controlsSource).not.toContain("addEventListener('pointerdown'")
    expect(source).not.toContain('desktopLabelOptionsOpen && document.addEventListener')
  })
})
