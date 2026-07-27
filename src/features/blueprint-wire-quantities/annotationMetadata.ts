import type { BlueprintAnnotation } from '@/services/blueprintLibraryService'

export function parseAnnotationTimestampMs(value: unknown): number {
  const ms = Date.parse(String(value || ''))
  return Number.isFinite(ms) ? ms : 0
}

export function nextAnnotationUpdatedAt(previous?: string): string {
  const previousMs = parseAnnotationTimestampMs(previous)
  return new Date(Math.max(Date.now(), previousMs + 1)).toISOString()
}

export function readAnnotationMeta<T extends Record<string, unknown>>(annotation: Pick<BlueprintAnnotation, 'meta' | 'metadata'>): T {
  return ((annotation.meta || annotation.metadata || {}) as T)
}

export function annotationMetadataEquals(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? {}) === JSON.stringify(b ?? {})
}

export function writeAnnotationMetaIfChanged<TMeta extends Record<string, unknown>>(
  annotation: BlueprintAnnotation,
  nextMeta: TMeta,
): BlueprintAnnotation {
  const currentMeta = readAnnotationMeta(annotation)
  if (annotationMetadataEquals(currentMeta, nextMeta)) return annotation
  return {
    ...annotation,
    meta: nextMeta,
    metadata: nextMeta,
    updatedAt: nextAnnotationUpdatedAt(annotation.updatedAt),
  }
}
