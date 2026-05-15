/**
 * Supabase cache for blueprint vision API results (classification + extraction).
 */

import { supabase } from '@/lib/supabase'
import type { VisionPageClassification } from './blueprintVisionClient'
import type { BlueprintVisionExtractionResult } from './blueprintVisionClient'

const TABLE = 'blueprint_vision_cache' as any

type CacheType = 'classification' | 'extraction'

interface VisionCacheRow {
  id: string
  file_hash: string
  page_number: number | null
  cache_type: CacheType
  result: unknown
  user_id: string
  file_name: string | null
  created_at: string
}

async function getCurrentUserId(): Promise<string | null> {
  const { data, error } = await supabase.auth.getUser()
  if (error || !data?.user?.id) return null
  return data.user.id
}

export async function getClassification(
  fileHash: string,
): Promise<VisionPageClassification[] | null> {
  const userId = await getCurrentUserId()
  if (!userId) return null

  const { data, error } = await supabase
    .from(TABLE)
    .select('result')
    .eq('cache_type', 'classification')
    .eq('file_hash', fileHash)
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    console.warn('[blueprintVisionCache] getClassification', error.message)
    return null
  }

  const row = data as { result?: VisionPageClassification[] } | null
  if (!row?.result || !Array.isArray(row.result)) return null
  return row.result
}

export async function saveClassification(
  fileHash: string,
  fileName: string,
  result: VisionPageClassification[],
): Promise<void> {
  const userId = await getCurrentUserId()
  if (!userId) return

  const { error } = await supabase.from(TABLE).insert({
    file_hash: fileHash,
    page_number: null,
    cache_type: 'classification',
    result,
    user_id: userId,
    file_name: fileName,
  } as any)

  if (error) {
    console.warn('[blueprintVisionCache] saveClassification', error.message)
  }
}

export async function getExtraction(
  fileHash: string,
  pageNumber: number,
): Promise<BlueprintVisionExtractionResult | null> {
  const userId = await getCurrentUserId()
  if (!userId) return null

  const { data, error } = await supabase
    .from(TABLE)
    .select('result')
    .eq('cache_type', 'extraction')
    .eq('file_hash', fileHash)
    .eq('page_number', pageNumber)
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    console.warn('[blueprintVisionCache] getExtraction', error.message)
    return null
  }

  const row = data as { result?: BlueprintVisionExtractionResult } | null
  if (!row?.result || typeof row.result !== 'object') return null
  return row.result
}

export async function saveExtraction(
  fileHash: string,
  pageNumber: number,
  fileName: string,
  result: BlueprintVisionExtractionResult,
): Promise<void> {
  const userId = await getCurrentUserId()
  if (!userId) return

  const { error } = await supabase.from(TABLE).insert({
    file_hash: fileHash,
    page_number: pageNumber,
    cache_type: 'extraction',
    result,
    user_id: userId,
    file_name: fileName,
  } as any)

  if (error) {
    console.warn('[blueprintVisionCache] saveExtraction', error.message)
  }
}
