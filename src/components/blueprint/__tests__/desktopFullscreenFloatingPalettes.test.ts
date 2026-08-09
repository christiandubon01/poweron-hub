/**
 * BLUEPRINT UI-2 — desktop fullscreen floating palettes.
 *
 * SCOPE NOTE (read before trusting a green run): this is a SOURCE-CONTRACT suite.
 * The repo's blueprint viewer harness does not mount OperationsBlueprintPdfViewer in a
 * real browser, and jsdom implements no Fullscreen API top-layer semantics at all — a
 * node portaled to document.body stays "visible" in jsdom whether or not an element is
 * fullscreen, so a DOM-level test here would pass even with the bug present and would
 * prove nothing. These assertions therefore pin the render contract that decides the
 * outcome (which container each palette portals into, and which conditions gate the
 * toggles). MANUAL VERIFICATION IN A REAL DESKTOP BROWSER FULLSCREEN SESSION IS STILL
 * REQUIRED to confirm the pixels.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(
  join(process.cwd(), 'src/components/blueprint/OperationsBlueprintPdfViewer.tsx'),
  'utf8',
)

const paletteSource = readFileSync(
  join(process.cwd(), 'src/components/blueprint/BlueprintFloatingPalette.tsx'),
  'utf8',
)

function countOccurrences(haystack: string, needle: string) {
  return haystack.split(needle).length - 1
}

function drawBucketSource() {
  const start = source.indexOf("{toolbarBucket === 'draw' && (")
  const end = source.indexOf("{toolbarBucket === 'generate' && (", start)
  expect(start).toBeGreaterThan(-1)
  expect(end).toBeGreaterThan(start)
  return source.slice(start, end)
}

/** The contiguous block holding all three floating-palette portals. */
function palettePortalsSource() {
  const draw = drawBucketSource()
  const start = draw.indexOf('{desktopElectricalToolsOpen && createPortal(')
  const end = draw.indexOf('{useDesktopThreePaneLayout ? (', start)
  expect(start).toBeGreaterThan(-1)
  expect(end).toBeGreaterThan(start)
  return draw.slice(start, end)
}

/** The portal target argument for one palette, i.e. the text after its closing tag. */
function portalTargetFor(paletteId: string) {
  const portals = palettePortalsSource()
  const start = portals.indexOf(`paletteId="${paletteId}"`)
  expect(start).toBeGreaterThan(-1)
  const closeTag = portals.indexOf('</BlueprintFloatingPalette>,', start)
  expect(closeTag).toBeGreaterThan(start)
  const end = portals.indexOf(')}', closeTag)
  expect(end).toBeGreaterThan(closeTag)
  return portals.slice(closeTag + '</BlueprintFloatingPalette>,'.length, end).trim()
}

describe('desktop fullscreen floating palettes', () => {
  it('resolves the shared viewer portal target to the fullscreen root while fullscreen', () => {
    expect(source).toContain('const viewerPortalTarget = (isFullScreenView || isTabletImmersiveFullscreen) && viewerRootRef.current')
    expect(source).toContain('? viewerRootRef.current')
    expect(source).toContain(': document.body')
    // The fullscreen root is the element handed to requestFullscreen, so it is the
    // only container the browser paints while native fullscreen is active.
    expect(source).toContain('ref={viewerRootRef}')
    expect(source).toContain('viewerElement.requestFullscreen()')
  })

  it('mounts the Electrical Tools palette in the fullscreen-safe container', () => {
    expect(portalTargetFor('electrical-tools')).toBe('viewerPortalTarget')
  })

  it('mounts the Electrical Symbols palette in the fullscreen-safe container', () => {
    expect(portalTargetFor('electrical-symbols')).toBe('viewerPortalTarget')
  })

  it('mounts the Quick Access palette in the fullscreen-safe container', () => {
    expect(portalTargetFor('quick-access')).toBe('viewerPortalTarget')
  })

  it('no longer pins any floating palette to document.body', () => {
    // document.body would be outside the fullscreen element, so the palette renders
    // into a detached-from-view subtree and the toggle looks like a no-op.
    expect(palettePortalsSource()).not.toContain('document.body')
  })

  it('exposes the Electrical Tools toggle on the desktop fullscreen render path', () => {
    const draw = drawBucketSource()

    expect(draw).toContain('data-testid="desktop-electrical-tools-menu"')
    expect(draw).toContain('aria-expanded={desktopElectricalToolsOpen}')
    expect(draw).toContain('aria-label="Electrical Tools"')
    // Not gated on fullscreen state in any direction.
    expect(draw).not.toContain('isFullScreenView')
    const menuStart = draw.indexOf('data-testid="desktop-electrical-tools-menu"')
    const menuSource = draw.slice(menuStart, draw.indexOf('{renderTouchElectricalSymbolsButton()}', menuStart))
    expect(menuSource).not.toContain('isTabletImmersiveFullscreen')
  })

  it('exposes the Electrical Symbols toggle on the desktop fullscreen render path', () => {
    const draw = drawBucketSource()

    expect(draw).toContain('aria-pressed={desktopElectricalSymbolsOpen}')
    expect(draw).toContain('setDesktopElectricalSymbolsOpen((v) => !v)')
    expect(draw).toContain('title="Electrical Symbols palette"')
  })

  it('exposes the Quick Access toggle on the desktop fullscreen render path', () => {
    const draw = drawBucketSource()

    expect(draw).toContain('{renderQuickAccessPaletteButton()}')
    expect(source).toContain('const renderQuickAccessPaletteButton = ')
    expect(source).toContain('onClick={() => setQuickAccessPaletteOpen((open) => !open)}')
    expect(source).toContain('aria-label="Quick Access"')
  })

  it('keeps desktop fullscreen on the three-pane layout so no mobile-only branch hides the toggles', () => {
    // Desktop native fullscreen sets isFullScreenView, NOT isTabletImmersiveFullscreen,
    // so useDesktopThreePaneLayout stays true and the desktop toolbar (with the
    // Floating Palettes group) keeps rendering in fullscreen.
    expect(source).toMatch(/const useDesktopThreePaneLayout =\s*isDesktopBlueprintLayout && !isTabletImmersiveFullscreen && !isTabletDevice\(\)/)
    expect(source).not.toContain('isDesktopBlueprintLayout && !isFullScreenView')
  })

  it('shares one palette open-state per palette across normal and fullscreen modes', () => {
    expect(countOccurrences(source, 'const [desktopElectricalToolsOpen, setDesktopElectricalToolsOpen] = useState')).toBe(1)
    expect(countOccurrences(source, 'const [desktopElectricalSymbolsOpen, setDesktopElectricalSymbolsOpen] = useState')).toBe(1)
    expect(countOccurrences(source, 'const [quickAccessPaletteOpen, setQuickAccessPaletteOpen] = useState')).toBe(1)

    // Exactly one mount site per palette — no fullscreen-only duplicate copy.
    expect(countOccurrences(source, 'paletteId="electrical-tools"')).toBe(1)
    expect(countOccurrences(source, 'paletteId="electrical-symbols"')).toBe(1)
    expect(countOccurrences(source, 'paletteId="quick-access"')).toBe(1)
  })

  it('does not introduce any fullscreen-only palette state path', () => {
    for (const forbidden of [
      'fullscreenElectricalToolsOpen',
      'fullscreenElectricalSymbolsOpen',
      'fullscreenQuickAccessOpen',
      'paletteId="electrical-tools-fullscreen"',
      'paletteId="electrical-symbols-fullscreen"',
      'paletteId="quick-access-fullscreen"',
    ]) {
      expect(source).not.toContain(forbidden)
    }
  })

  it('leaves the shared floating-palette geometry persistence untouched', () => {
    expect(paletteSource).toContain("const PALETTES_STORAGE_KEY = 'poweron.bp.palettes'")
    expect(paletteSource).toContain('localStorage.getItem(PALETTES_STORAGE_KEY)')
    expect(paletteSource).toContain('localStorage.setItem(PALETTES_STORAGE_KEY, JSON.stringify(store))')
    // Per-palette geometry stays keyed by paletteId, so moving the mount container
    // cannot reset a sibling palette's stored position.
    expect(paletteSource).toContain('store[paletteId] = geom')
    expect(paletteSource).toContain('const stored = readPaletteStore()[paletteId]')
  })

  it('keeps each palette independently positioned, draggable, and above the canvas', () => {
    const portals = palettePortalsSource()

    expect(portals).toContain('defaultX={60} defaultY={80}')
    expect(portals).toContain('defaultX={360} defaultY={80}')
    expect(portals).toContain('defaultX={660} defaultY={80}')
    expect(paletteSource).toContain("style={{ position: 'fixed', left: geom.x, top: geom.y, width: geom.w, height: geom.h, zIndex: 100050 }}")
    expect(paletteSource).toContain('onPointerDown={handleHeaderPointerDown}')
    expect(paletteSource).toContain('onPointerDown={handleResizePointerDown}')
  })

  it('keeps the Electrical Tools palette contents intact', () => {
    const portals = palettePortalsSource()

    expect(portals).toContain('data-testid="desktop-electrical-tools-wire-profiles"')
    expect(portals).toContain('Circuit Path</button>')
    expect(portals).toContain('Circuit Arc</button>')
    expect(portals).toContain('Circuit Labels {showCircuitMeasurementLabels')
    expect(portals).toContain('renderPackagePickControls()')
    expect(portals).toContain('data-testid="desktop-label-options-menu"')
  })

  it('keeps the Electrical Symbols and Quick Access palette contents intact', () => {
    const portals = palettePortalsSource()

    expect(portals).toContain('DESKTOP_ELECTRICAL_TOOL_CATEGORIES.map((category)')
    expect(portals).toContain('category.children.map((childKind)')
    expect(portals).toContain('{renderQuickAccessPaletteContents()}')
  })
})
