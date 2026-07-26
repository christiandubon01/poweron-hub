import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import OperationsBlueprintPdfViewer from '../OperationsBlueprintPdfViewer'

describe('OperationsBlueprintPdfViewer smoke', () => {
  it('initializes a loaded blueprint without wire segment picker callback TDZ errors', () => {
    const blueprint = {
      id: 'blueprint-set-tdz-smoke',
      projectId: 'project-tdz-smoke',
      projectName: 'TDZ Smoke Project',
      title: 'TDZ Smoke Blueprint',
      type: 'Electrical Only',
      status: 'active',
      source: 'operations_blueprint_ai',
      storagePath: 'tdz-smoke.pdf',
      fileName: 'tdz-smoke.pdf',
      fileSize: 1024,
      pageCount: 1,
      pagesWithNotes: 0,
      sheetIndex: [],
      annotationsSummary: '',
      createdAt: '2026-07-26T00:00:00.000Z',
      updatedAt: '2026-07-26T00:00:00.000Z',
      archivedAt: null,
    } as any

    expect(() => renderToStaticMarkup(createElement(OperationsBlueprintPdfViewer, {
      blueprint,
    }))).not.toThrow(/Cannot access .* before initialization/)
  })
})
