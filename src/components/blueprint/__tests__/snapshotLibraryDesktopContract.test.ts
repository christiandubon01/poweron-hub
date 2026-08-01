import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const viewer = readFileSync(
  join(process.cwd(), 'src/components/blueprint/OperationsBlueprintPdfViewer.tsx'),
  'utf8'
)

// ── Section extraction helpers ────────────────────────────────────────────────

// Desktop three-pane top-right panel — Row 2 (zoom/fit/lock/fullscreen only)
const row2Marker  = 'Row 2: zoom, fit, lock, and fullscreen only.'
const row2Start   = viewer.lastIndexOf(row2Marker)
const row2End     = viewer.indexOf('isLoading || isRendering', row2Start)
const row2Section = viewer.slice(row2Start, row2End)

// Desktop three-pane left toolbar — Snapshots & History section
const lowerStart   = viewer.indexOf('Snapshots &amp; History')
const lowerEnd     = viewer.indexOf('Row 1: page navigation, visual page index', lowerStart)
const lowerSection = viewer.slice(lowerStart, lowerEnd > lowerStart ? lowerEnd : undefined)

// iPad immersive fullscreen toolbar
const tabletStart   = viewer.indexOf('isTabletImmersiveFullscreen && !isDesktopBlueprintLayout')
const tabletEnd     = viewer.indexOf('Snapshots &amp; History', tabletStart)
const tabletSection = viewer.slice(tabletStart, tabletEnd)

// ── 1. Desktop Row 2 panel — snapshot buttons removed ────────────────────────

describe('desktop three-pane Row 2 panel — snapshot buttons removed', () => {
  it('does not contain Snapshot Area button (aria-label="Capture Area")', () => {
    expect(row2Section).not.toContain('aria-label="Capture Area"')
  })

  it('does not contain Snapshot Full button (aria-label="Capture Full Page")', () => {
    expect(row2Section).not.toContain('aria-label="Capture Full Page"')
  })

  it('does not contain Snapshot Library button (aria-label="Open Snapshot Library")', () => {
    expect(row2Section).not.toContain('aria-label="Open Snapshot Library"')
  })

  it('still contains the normal Viewer fullscreen toggle (Enter/Exit fullscreen)', () => {
    expect(row2Section).toContain('Enter fullscreen')
    expect(row2Section).toContain('Exit fullscreen')
    expect(row2Section).toContain('handleFullscreenToggle(')
  })

  it('snapshotCaptureButtonRef ref= is not used in the desktop Row 2 panel', () => {
    expect(row2Section).not.toContain('ref={snapshotCaptureButtonRef}')
  })
})

// ── 2. Lower "Snapshots & History" section — controls preserved ───────────────

describe('lower Snapshots & History section — all controls intact', () => {
  it('Snapshots & History label appears exactly once in the viewer', () => {
    expect((viewer.match(/Snapshots &amp; History/g) || []).length).toBe(1)
  })

  it('Capture Area button (aria-label="Capture Area") is present in the lower section', () => {
    expect(lowerSection).toContain('aria-label="Capture Area"')
  })

  it('Capture Full Page button (aria-label="Capture Full Page") is present in the lower section', () => {
    expect(lowerSection).toContain('aria-label="Capture Full Page"')
  })

  it('Open Snapshot Library button (aria-label="Open Snapshot Library") is present in the lower section', () => {
    expect(lowerSection).toContain('aria-label="Open Snapshot Library"')
  })

  it('beginSnapshotAreaSelection is called from the lower section', () => {
    expect(lowerSection).toContain('beginSnapshotAreaSelection')
  })

  it('handleCaptureSnapshot(null) is called from the lower section', () => {
    expect(lowerSection).toContain('handleCaptureSnapshot(null)')
  })

  it('snapshotCaptureButtonRef is attached to the lower Area button', () => {
    expect(lowerSection).toContain('ref={snapshotCaptureButtonRef}')
  })

  it('Undo and Redo history controls are intact', () => {
    expect(lowerSection).toContain("applyAnnotationHistory('undo')")
    expect(lowerSection).toContain("applyAnnotationHistory('redo')")
  })

  it('Library button only mutates Snapshot Library dialog state', () => {
    const libTitlePos = lowerSection.indexOf('title="Open Snapshot Library"')
    const libBtnStart = lowerSection.lastIndexOf('<button', libTitlePos)
    const libBtnEnd   = lowerSection.indexOf('</button>', libTitlePos)
    const libBtnBody  = lowerSection.slice(libBtnStart, libBtnEnd)

    expect(libBtnBody).toContain('setIsSnapshotLibraryOpen(true)')
    expect(libBtnBody).not.toContain('setCurrentPage')
    expect(libBtnBody).not.toContain('setRelativeZoom')
    expect(libBtnBody).not.toContain('setRotation')
    expect(libBtnBody).not.toContain('loadPdf')
  })
})

// ── 3. iPad immersive fullscreen toolbar — snapshot buttons unchanged ─────────

describe('iPad immersive fullscreen toolbar — snapshot buttons preserved', () => {
  it('Capture Area button is still in the tablet toolbar', () => {
    expect(tabletSection).toContain('aria-label="Capture Area"')
  })

  it('Capture Full Page button is still in the tablet toolbar', () => {
    expect(tabletSection).toContain('aria-label="Capture Full Page"')
  })

  it('Open Snapshot Library button is still in the tablet toolbar', () => {
    expect(tabletSection).toContain('aria-label="Open Snapshot Library"')
  })
})

// ── 4. Global ref count — desktop Row 2 ref removed ──────────────────────────

describe('snapshotCaptureButtonRef placement after Row 2 cleanup', () => {
  it('ref={snapshotCaptureButtonRef} appears in exactly two places: tablet toolbar and lower section', () => {
    const count = (viewer.match(/ref=\{snapshotCaptureButtonRef\}/g) || []).length
    expect(count).toBe(2)
  })
})
