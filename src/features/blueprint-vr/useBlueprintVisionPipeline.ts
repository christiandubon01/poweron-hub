/**
 * Vision classify / extract pipeline for Generate VR.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { BlueprintBuildingModel } from './buildingModel'
import {
  buildScanResultFromVisionExtraction,
  convertPlanScanToBuildingModel,
  enumerateFullSourceSetSheets,
  scanBlueprintPlan,
} from './blueprintPlanScanner'
import type { BlueprintPlanScanResult, BlueprintVRSourceSet } from './blueprintPlanScanner'
import {
  classifyAllPagesBatched,
  hashFile,
  loadPdfArrayBuffer,
  openPdfDocument,
  rasterizePdfPageToBase64,
  callExtract,
  type VisionPageClassification,
} from './blueprintVisionClient'
import {
  getClassification,
  saveClassification,
  getExtraction,
  saveExtraction,
} from './blueprintVisionCache'
import type { BlueprintVRCacheIdentity } from './blueprintVRProjectModelCache'
import {
  getCachedProjectModel,
  setCachedProjectModel,
  clearCachedProjectModel,
} from './blueprintVRProjectModelCache'

export function useBlueprintVisionPipeline(params: {
  selectedSourceSet: BlueprintVRSourceSet | null
  projectName?: string
  sourceCacheIdentity: BlueprintVRCacheIdentity
  rescanToken: number
}) {
  const { selectedSourceSet, projectName, sourceCacheIdentity, rescanToken } = params

  const [selectedFloorPlanPage, setSelectedFloorPlanPage] = useState<number | null>(null)
  const [pageClassifications, setPageClassifications] = useState<VisionPageClassification[]>([])
  const [isClassifying, setIsClassifying] = useState(false)
  const [isExtracting, setIsExtracting] = useState(false)
  const [classifyProgress, setClassifyProgress] = useState({ done: 0, total: 0 })
  const [fileHash, setFileHash] = useState<string | null>(null)
  const [visionError, setVisionError] = useState<string | null>(null)
  const [sheetPickerOpen, setSheetPickerOpen] = useState(false)
  const [visionScan, setVisionScan] = useState<BlueprintPlanScanResult | null>(null)
  const [visionModel, setVisionModel] = useState<BlueprintBuildingModel | null>(null)

  const pdfBufferRef = useRef<ArrayBuffer | null>(null)
  const pdfDocRef = useRef<Awaited<ReturnType<typeof openPdfDocument>> | null>(null)

  const enumeratedSheets = useMemo(
    () => (selectedSourceSet ? enumerateFullSourceSetSheets(selectedSourceSet) : []),
    [selectedSourceSet],
  )

  const placeholderScan = useMemo(() => {
    const base = scanBlueprintPlan({
      projectName,
      blueprintTitle: selectedSourceSet?.name,
      fileName: selectedSourceSet?.filePath,
    })
    return {
      ...base,
      warnings: [
        {
          code: 'NO_FLOOR_PLAN_SHEET' as const,
          message: 'Select a floor plan sheet to begin.',
        },
      ],
    }
  }, [projectName, selectedSourceSet?.name, selectedSourceSet?.filePath])

  const placeholderModel = useMemo(
    () => convertPlanScanToBuildingModel(placeholderScan),
    [placeholderScan],
  )

  useEffect(() => {
    let disposed = false

    if (!selectedSourceSet?.filePath) {
      setPageClassifications([])
      setFileHash(null)
      setSelectedFloorPlanPage(null)
      setVisionScan(null)
      setVisionModel(null)
      pdfBufferRef.current = null
      pdfDocRef.current = null
      return
    }

    setSelectedFloorPlanPage(null)
    setVisionScan(null)
    setVisionModel(null)
    setVisionError(null)

    void (async () => {
      setIsClassifying(true)
      setClassifyProgress({ done: 0, total: 0 })
      try {
        const storagePath = selectedSourceSet.filePath!
        const buffer = pdfBufferRef.current ?? (await loadPdfArrayBuffer(storagePath))
        if (disposed) return
        pdfBufferRef.current = buffer

        const hash = await hashFile(buffer)
        if (disposed) return
        setFileHash(hash)

        const cached = await getClassification(hash)
        if (cached?.length) {
          setPageClassifications(cached)
          return
        }

        const pdfDoc = pdfDocRef.current ?? (await openPdfDocument(buffer))
        if (disposed) return
        pdfDocRef.current = pdfDoc

        const total = pdfDoc.numPages
        setClassifyProgress({ done: 0, total })

        const result = await classifyAllPagesBatched(pdfDoc, total, (done, tot) => {
          if (!disposed) setClassifyProgress({ done, total: tot })
        })
        if (disposed) return

        setPageClassifications(result)
        const fileName = selectedSourceSet.filePath || selectedSourceSet.name || 'blueprint.pdf'
        await saveClassification(hash, fileName, result)
      } catch (err: unknown) {
        if (!disposed) {
          setVisionError(err instanceof Error ? err.message : 'Classification failed')
        }
      } finally {
        if (!disposed) setIsClassifying(false)
      }
    })()

    return () => {
      disposed = true
    }
  }, [selectedSourceSet?.id, selectedSourceSet?.filePath, selectedSourceSet?.name, rescanToken])

  const selectFloorPlanPage = useCallback(
    async (pageNumber: number) => {
      if (!selectedSourceSet?.filePath || !fileHash) return

      setSheetPickerOpen(false)
      setSelectedFloorPlanPage(pageNumber)
      setIsExtracting(true)
      setVisionError(null)

      const sheet = enumeratedSheets.find((s) => s.pageNumber === pageNumber)

      try {
        let extraction = await getExtraction(fileHash, pageNumber)

        if (!extraction) {
          const buffer = pdfBufferRef.current
          if (!buffer) throw new Error('PDF buffer not loaded')
          const pdfDoc = pdfDocRef.current ?? (await openPdfDocument(buffer))
          pdfDocRef.current = pdfDoc
          const image = await rasterizePdfPageToBase64(pdfDoc, pageNumber, 200)
          extraction = await callExtract(image, pageNumber)
          const fileName = selectedSourceSet.filePath || selectedSourceSet.name || 'blueprint.pdf'
          await saveExtraction(fileHash, pageNumber, fileName, extraction)
        }

        const scan = buildScanResultFromVisionExtraction(extraction, {
          projectName,
          blueprintTitle: selectedSourceSet.name,
          pageNumber,
          sheetNumber: sheet?.sheetNumber,
          sheetTitle: sheet?.sheetTitle,
        })
        const model = convertPlanScanToBuildingModel(scan)

        setVisionScan(scan)
        setVisionModel(model)

        const identity: BlueprintVRCacheIdentity = {
          ...sourceCacheIdentity,
          selectedFloorPlanPage: pageNumber,
          scannerVersion: 'VISION-1',
        }
        setCachedProjectModel(identity, {
          model,
          scan,
          sourceSetLabel: selectedSourceSet.name,
        })
      } catch (err: unknown) {
        setVisionError(err instanceof Error ? err.message : 'Extraction failed')
        setVisionScan(null)
        setVisionModel(null)
      } finally {
        setIsExtracting(false)
      }
    },
    [
      selectedSourceSet,
      fileHash,
      enumeratedSheets,
      projectName,
      sourceCacheIdentity,
    ],
  )

  const clearSessionModelCache = useCallback(() => {
    clearCachedProjectModel(sourceCacheIdentity)
    setSelectedFloorPlanPage(null)
    setVisionScan(null)
    setVisionModel(null)
    setSheetPickerOpen(false)
  }, [sourceCacheIdentity])

  const { scanResult, buildingModel, fromCache, cacheDebug } = useMemo(() => {
    const emptyDebug = {
      mode: 'bypass' as const,
      key: '',
      keyHash: '',
      sourceIdentity: sourceCacheIdentity,
      rescanCount: 0,
    }

    if (!selectedFloorPlanPage) {
      return {
        scanResult: placeholderScan,
        buildingModel: placeholderModel,
        fromCache: false,
        cacheDebug: emptyDebug,
      }
    }

    const identity: BlueprintVRCacheIdentity = {
      ...sourceCacheIdentity,
      selectedFloorPlanPage,
      scannerVersion: 'VISION-1',
    }
    const cached = getCachedProjectModel(identity)
    if (cached) {
      return {
        scanResult: cached.scan,
        buildingModel: cached.model,
        fromCache: true,
        cacheDebug: {
          mode: 'hit' as const,
          key: cached.key,
          keyHash: cached.keyHash,
          sourceIdentity: cached.sourceIdentity,
          rescanCount: 0,
          scannedAt: cached.generatedAt,
        },
      }
    }

    if (visionScan && visionModel) {
      return {
        scanResult: visionScan,
        buildingModel: visionModel,
        fromCache: false,
        cacheDebug: { ...emptyDebug, mode: 'miss' as const },
      }
    }

    return {
      scanResult: placeholderScan,
      buildingModel: placeholderModel,
      fromCache: false,
      cacheDebug: emptyDebug,
    }
  }, [
    selectedFloorPlanPage,
    placeholderScan,
    placeholderModel,
    sourceCacheIdentity,
    visionScan,
    visionModel,
    rescanToken,
  ])

  const hasVisionGeometry =
    selectedFloorPlanPage != null &&
    visionScan != null &&
    !visionScan.isFallback &&
    visionScan.scanResultKind === 'measured-trace'

  return {
    selectedFloorPlanPage,
    pageClassifications,
    isClassifying,
    isExtracting,
    classifyProgress,
    fileHash,
    visionError,
    sheetPickerOpen,
    setSheetPickerOpen,
    selectFloorPlanPage,
    clearSessionModelCache,
    enumeratedSheets,
    scanResult,
    buildingModel,
    fromCache,
    cacheDebug,
    hasVisionGeometry,
  }
}
