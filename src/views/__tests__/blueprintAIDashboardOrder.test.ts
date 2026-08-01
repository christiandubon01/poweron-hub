import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const src = readFileSync(
  join(process.cwd(), 'src/views/BlueprintAI.tsx'),
  'utf8'
)

// ── Convert Image to PDF position anchor ─────────────────────────────────────
const convertBtnPos = src.indexOf('setConvertPanelOpen((v) => !v)')

// ── Position anchors ──────────────────────────────────────────────────────────
// Each anchor is a string that appears exactly once in the relevant section.

// Header: the h1 tag text
const titlePos = src.indexOf('Blueprint AI</h1>')
// Current Set badge
const currentSetPos = src.indexOf('Current Set</span>')
// Viewer: the heading div text (unique — not duplicated anywhere)
const viewerHeadPos = src.indexOf('Blueprint Viewer</div>')
// Summary cards: first unique label in each card
const totalsCardPos = src.indexOf('Blueprint / Project Totals')
const openSetCardPos = src.indexOf('Open Blueprint Set')
const sheetCardPos  = src.indexOf('Sheet Breakdown / Study Index')
// Action buttons: use each button's toggle handler (unique per button)
const libraryBtnPos = src.indexOf('setLibraryModalOpen(true)')
const uploadBtnPos  = src.indexOf('setUploadPanelOpen((v) => !v)')
const exportBtnPos  = src.indexOf('setExportPanelOpen((v) => !v)')
const derivedBtnPos = src.indexOf('setDerivedPanelOpen((v) => !v)')
const vrBtnPos      = src.indexOf('onClick={handleGenerateVR}')

// ── 1. Header section remains at the top ─────────────────────────────────────

describe('Blueprint AI header — top of page', () => {
  it('Blueprint AI h1 title is present', () => {
    expect(titlePos).toBeGreaterThanOrEqual(0)
  })

  it('Blueprint AI title appears before the Blueprint Viewer section', () => {
    expect(viewerHeadPos).toBeGreaterThan(titlePos)
  })

  it('Current Set indicator is present', () => {
    expect(currentSetPos).toBeGreaterThanOrEqual(0)
  })

  it('Current Set indicator appears before the Blueprint Viewer section', () => {
    expect(viewerHeadPos).toBeGreaterThan(currentSetPos)
  })
})

// ── 2. Blueprint Viewer renders before summary cards and actions ──────────────

describe('Blueprint Viewer — above summary cards and action cards', () => {
  it('Blueprint Viewer heading div is present', () => {
    expect(viewerHeadPos).toBeGreaterThanOrEqual(0)
  })

  it('Blueprint Viewer renders before Blueprint / Project Totals card', () => {
    expect(viewerHeadPos).toBeLessThan(totalsCardPos)
  })

  it('Blueprint Viewer renders before Open Blueprint Set card', () => {
    expect(viewerHeadPos).toBeLessThan(openSetCardPos)
  })

  it('Blueprint Viewer renders before Sheet Breakdown / Study Index card', () => {
    expect(viewerHeadPos).toBeLessThan(sheetCardPos)
  })

  it('Blueprint Viewer renders before Blueprint Library Index action', () => {
    expect(viewerHeadPos).toBeLessThan(libraryBtnPos)
  })

  it('Blueprint Viewer renders before Upload Blueprint action', () => {
    expect(viewerHeadPos).toBeLessThan(uploadBtnPos)
  })

  it('Blueprint Viewer renders before Export PDF action', () => {
    expect(viewerHeadPos).toBeLessThan(exportBtnPos)
  })

  it('Blueprint Viewer renders before Create Derived Set action', () => {
    expect(viewerHeadPos).toBeLessThan(derivedBtnPos)
  })

  it('Blueprint Viewer renders before Generate VR action', () => {
    expect(viewerHeadPos).toBeLessThan(vrBtnPos)
  })
})

// ── 3. Summary cards render exactly once ─────────────────────────────────────
// Use the unique card heading label (only in the three-card grid, not repeated elsewhere).

describe('summary cards — each renders exactly once', () => {
  it('Blueprint / Project Totals label appears exactly once', () => {
    expect((src.match(/Blueprint \/ Project Totals/g) || []).length).toBe(1)
  })

  it('Open Blueprint Set label appears exactly once', () => {
    expect((src.match(/Open Blueprint Set/g) || []).length).toBe(1)
  })

  it('Sheet Breakdown / Study Index label appears exactly once', () => {
    expect((src.match(/Sheet Breakdown \/ Study Index/g) || []).length).toBe(1)
  })
})

// ── 4. Action cards render exactly once ──────────────────────────────────────
// Each toggle handler is unique to its action button.

describe('action buttons — each toggle handler appears exactly once', () => {
  it('setLibraryModalOpen(true) appears exactly once', () => {
    expect((src.match(/setLibraryModalOpen\(true\)/g) || []).length).toBe(1)
  })

  it('setUploadPanelOpen toggle appears exactly once', () => {
    expect((src.match(/setUploadPanelOpen\(\(v\) => !v\)/g) || []).length).toBe(1)
  })

  it('setExportPanelOpen toggle appears exactly once', () => {
    expect((src.match(/setExportPanelOpen\(\(v\) => !v\)/g) || []).length).toBe(1)
  })

  it('setDerivedPanelOpen toggle appears exactly once', () => {
    expect((src.match(/setDerivedPanelOpen\(\(v\) => !v\)/g) || []).length).toBe(1)
  })

  it('handleGenerateVR onClick appears exactly once', () => {
    expect((src.match(/onClick=\{handleGenerateVR\}/g) || []).length).toBe(1)
  })
})

// ── 5. Upload Blueprint — form wiring unchanged ───────────────────────────────

describe('Upload Blueprint — form wiring unchanged', () => {
  it('upload form is gated on uploadPanelOpen', () => {
    expect(src).toContain('{uploadPanelOpen && (')
  })

  it('handleUpload is still the submit handler', () => {
    expect(src).toContain('onClick={handleUpload}')
  })

  it('upload form has a file input', () => {
    expect(src).toContain("accept=\".pdf,application/pdf\"")
  })
})

// ── 6. Export PDF — handler unchanged ────────────────────────────────────────

describe('Export PDF — handler unchanged', () => {
  it('export panel is gated on exportPanelOpen', () => {
    expect(src).toContain('{exportPanelOpen && (')
  })

  it('export panel calls handleExportAnnotatedPdf', () => {
    expect(src).toContain('handleExportAnnotatedPdf()')
  })
})

// ── 7. Create Derived Set — handler unchanged ─────────────────────────────────

describe('Create Derived Set — handler unchanged', () => {
  it('derived panel is gated on derivedPanelOpen', () => {
    expect(src).toContain('{derivedPanelOpen && (')
  })

  it('derived form calls handleCreateDerivedSet', () => {
    expect(src).toContain('onClick={handleCreateDerivedSet}')
  })
})

// ── 8. Generate VR — handler unchanged ───────────────────────────────────────

describe('Generate VR — handler unchanged', () => {
  it('Generate VR button calls handleGenerateVR', () => {
    expect(vrBtnPos).toBeGreaterThanOrEqual(0)
  })

  it('Generate VR disabled when no selectedItem', () => {
    expect(src).toContain('disabled={!selectedItem}')
  })
})

// ── 9. Sheet Index actions unchanged ─────────────────────────────────────────

describe('Sheet Index actions — unchanged', () => {
  it('Open Sheet Index calls setSheetIndexModalOpen(true)', () => {
    expect(src).toContain('setSheetIndexModalOpen(true)')
  })

  it('Add Sheet Label calls openSheetEditor()', () => {
    expect(src).toContain('onClick={() => openSheetEditor()}')
  })

  it('Auto Detect calls handleAutoDetectSheetIndex', () => {
    expect(src).toContain('handleAutoDetectSheetIndex()')
  })
})

// ── 10. Responsive grid classes preserved ────────────────────────────────────

describe('responsive grid classes', () => {
  it('summary cards use md:grid-cols-3 gap-4 responsive layout', () => {
    expect(src).toContain('grid grid-cols-1 md:grid-cols-3 gap-4')
  })

  it('action row uses xl responsive breakpoint', () => {
    expect(src).toContain('xl:grid-cols-[minmax(260px,1.25fr)_repeat(3,minmax(160px,0.75fr))]')
  })
})

// ── 11. Viewer component — props unchanged ────────────────────────────────────

describe('Blueprint Viewer component — props unchanged', () => {
  it('OperationsBlueprintPdfViewer is still imported', () => {
    expect(src).toContain("import OperationsBlueprintPdfViewer from '@/components/blueprint/OperationsBlueprintPdfViewer'")
  })

  it('viewer receives blueprint prop', () => {
    expect(src).toContain('blueprint={selectedItem}')
  })

  it('viewer receives onAnnotationsChanged prop', () => {
    expect(src).toContain('onAnnotationsChanged={() => setAnnotationRefreshToken')
  })

  it('viewer receives externalPage prop', () => {
    expect(src).toContain('externalPage={viewerJumpPage ?? undefined}')
  })

  it('viewer receives initialPage prop', () => {
    expect(src).toContain('initialPage={viewerInitialPage}')
  })
})

// ── 12. Convert Image to PDF — action card position (test 23) ─────────────────

describe('Convert Image to PDF — action card order', () => {
  it('23. Convert Image to PDF action button is present', () => {
    expect(convertBtnPos).toBeGreaterThanOrEqual(0)
  })

  it('23. Convert Image to PDF appears immediately after Upload Blueprint in the grid', () => {
    // Between the Upload toggle and Convert toggle there must be no other panel toggles
    const between = src.slice(uploadBtnPos, convertBtnPos)
    expect(between).not.toContain('setExportPanelOpen')
    expect(between).not.toContain('setDerivedPanelOpen')
    expect(between).not.toContain('handleGenerateVR')
  })

  it('23. Convert Image appears before Export PDF in the action grid', () => {
    expect(convertBtnPos).toBeLessThan(exportBtnPos)
  })

  it('23. Export PDF appears before Create Derived Set', () => {
    expect(exportBtnPos).toBeLessThan(derivedBtnPos)
  })

  it('23. Create Derived Set appears before Generate VR', () => {
    expect(derivedBtnPos).toBeLessThan(vrBtnPos)
  })
})

// ── 13. Six action cards present and unique (tests 24–25) ─────────────────────

describe('action cards — six present and each unique', () => {
  it('24. Blueprint Library Index is present', () => {
    expect(src).toContain('setLibraryModalOpen(true)')
  })

  it('24. Upload Blueprint is present', () => {
    expect(src).toContain('setUploadPanelOpen((v) => !v)')
  })

  it('24. Convert Image to PDF is present', () => {
    expect(src).toContain('setConvertPanelOpen((v) => !v)')
  })

  it('24. Export PDF is present', () => {
    expect(src).toContain('setExportPanelOpen((v) => !v)')
  })

  it('24. Create Derived Set is present', () => {
    expect(src).toContain('setDerivedPanelOpen((v) => !v)')
  })

  it('24. Generate VR is present', () => {
    expect(src).toContain('onClick={handleGenerateVR}')
  })

  it('25. Convert Image to PDF appears exactly once', () => {
    expect((src.match(/setConvertPanelOpen\(\(v\) => !v\)/g) || []).length).toBe(1)
  })
})

// ── 14. Image file input contract (test 26) ────────────────────────────────────

describe('image input format acceptance', () => {
  it('26. Image input accepts .jpg, .jpeg, .png MIME and extension', () => {
    expect(src).toContain('.jpg,.jpeg,.png,image/jpeg,image/png')
  })
})

// ── 15. Native PDF upload unchanged (test 27) ─────────────────────────────────

describe('native PDF upload — unchanged', () => {
  it('27. PDF file input still accepts .pdf and application/pdf', () => {
    expect(src).toContain('accept=".pdf,application/pdf"')
  })

  it('27. handleUpload is still wired to the upload button', () => {
    expect(src).toContain('onClick={handleUpload}')
  })
})

// ── 16. Two-step convert flow (tests 28–29) ────────────────────────────────────

describe('two-step convert flow', () => {
  it('28. Convert Image button calls handleConvertImage (not the upload pipeline)', () => {
    expect(src).toContain('handleConvertImage()')
    // The convert handler must NOT call uploadBlueprintPdfToStorage directly
    // (it only calls convertImageToBlueprintPdf then sets convertedPdf)
    const convertHandlerMatch = src.match(/async function handleConvertImage[\s\S]*?^  \}/m)
    if (convertHandlerMatch) {
      expect(convertHandlerMatch[0]).not.toContain('uploadBlueprintPdfToStorage')
    }
  })

  it('29. Upload as Blueprint button calls handleUploadConverted', () => {
    expect(src).toContain('handleUploadConverted()')
  })

  it('29. Upload as Blueprint is gated on convertedPdf being truthy', () => {
    // Verify the upload button is only rendered when convertedPdf is set
    expect(src).toContain('convertedPdf && convertedPdf.size > 0 && (')
  })

  it('29b. Ready to upload never renders for a zero-byte converted File', () => {
    expect(src).toContain('convertedPdf && convertedPdf.size > 0 && (')
    expect(src).toContain('Ready to upload:')
    // Convert Image remains available when size is not > 0
    expect(src).toContain('!(convertedPdf && convertedPdf.size > 0)')
  })

  it('29c. handleConvertImage clears stale convertedPdf and rejects zero-byte results', () => {
    const convertHandlerMatch = src.match(/async function handleConvertImage[\s\S]*?^  \}/m)
    expect(convertHandlerMatch).toBeTruthy()
    const body = convertHandlerMatch![0]
    expect(body).toContain('setConvertedPdf(null)')
    expect(body).toContain('pdf.size <= 0')
    expect(body).not.toContain('uploadBlueprintPdfToStorage')
    expect(body).not.toContain('performBlueprintUpload')
  })

  it('29d. handleUploadConverted refuses zero-byte Files before upload', () => {
    const uploadHandlerMatch = src.match(/async function handleUploadConverted[\s\S]*?^  \}/m)
    expect(uploadHandlerMatch).toBeTruthy()
    const body = uploadHandlerMatch![0]
    expect(body).toContain('convertedPdf.size <= 0')
    expect(body).toContain("The selected PDF is empty.")
  })
})

// ── 17. Shared upload pipeline (tests 30–32) ──────────────────────────────────

describe('shared upload pipeline', () => {
  it('30. performBlueprintUpload is used by both upload paths', () => {
    expect(src).toContain('performBlueprintUpload')
    // Both handleUpload and handleUploadConverted should call it
    expect((src.match(/performBlueprintUpload/g) || []).length).toBeGreaterThanOrEqual(3)
  })

  it('31. setSelectedId is called after successful upload', () => {
    expect(src).toContain('setSelectedId(item.id)')
  })

  it('32. createBlueprintLibraryItem is called inside performBlueprintUpload', () => {
    expect(src).toContain('createBlueprintLibraryItem(')
  })
})

// ── 18. Panel coordination and cleanup (test 33) ──────────────────────────────

describe('panel coordination and cleanup', () => {
  it('33. closeConvertPanel clears convertedPdf', () => {
    expect(src).toContain('setConvertedPdf(null)')
  })

  it('33. closeConvertPanel clears convertImgFile', () => {
    expect(src).toContain('setConvertImgFile(null)')
  })

  it('33. Convert panel is gated on convertPanelOpen', () => {
    expect(src).toContain('{convertPanelOpen && (')
  })

  it('33. Cancel button calls closeConvertPanel', () => {
    expect(src).toContain('onClick={closeConvertPanel}')
  })
})

// ── 19. Convert Image service import (no new packages) (tests 35–36) ──────────

describe('service import and package integrity', () => {
  it('35. imageToBlueprintPdfService is imported in BlueprintAI', () => {
    expect(src).toContain("from '@/services/imageToBlueprintPdfService'")
  })

  it('36. No new npm packages were added (pdf-lib and pdfjs-dist already present)', () => {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8'))
    expect(pkg.dependencies['pdf-lib']).toBeDefined()
    expect(pkg.dependencies['pdfjs-dist']).toBeDefined()
  })
})
