import { supabase } from '@/lib/supabase'

export interface Review {
  id: string
  org_id: string
  platform: string
  review_id?: string
  reviewer_name?: string
  rating: number
  title?: string
  body?: string
  review_date: string
  sentiment?: string
  themes?: Record<string, unknown>
  response_needed: boolean
  escalated: boolean
  created_at: string
}

export interface ReviewResponse {
  id: string
  org_id: string
  review_id: string
  draft_response?: string
  published_response?: string
  drafted_by?: string
  approved_by?: string
  published_at?: string
  status: 'draft' | 'approved' | 'published'
}

export async function getReviews(orgId: string, filters?: { platform?: string; needsResponse?: boolean }): Promise<Review[]> {
  let query = supabase
    .from('reviews' as never)
    .select('*')
    .eq('org_id', orgId)
    .order('review_date', { ascending: false })

  if (filters?.platform) query = query.eq('platform', filters.platform)
  if (filters?.needsResponse) query = query.eq('response_needed', true)

  const { data, error } = await query
  if (error) throw error
  return (data ?? []) as unknown as Review[]
}

export async function draftReviewResponse(
  orgId: string,
  reviewId: string,
  reviewText: string,
  rating: number,
  draftedBy?: string
): Promise<ReviewResponse> {
  // Generate draft via Claude

  const response = await fetch('/.netlify/functions/claude', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 300,
      system: `You draft professional, empathetic responses to customer reviews for Power On Solutions, an electrical contracting company. Keep responses under 150 words. Address specific feedback. For negative reviews, acknowledge concerns and offer resolution. For positive reviews, thank and reinforce.`,
      messages: [{ role: 'user', content: `Review (${rating}/5 stars): "${reviewText}"\n\nDraft a professional response.` }],
    }),
  })

  const result = (await response.json()) as { content?: Array<{ type: string; text: string }> }
  const draftText = result.content?.find(c => c.type === 'text')?.text ?? ''

  // Save draft
  const { data, error } = await supabase
    .from('review_responses' as never)
    .insert({
      org_id: orgId,
      review_id: reviewId,
      draft_response: draftText,
      drafted_by: draftedBy || null,
      status: 'draft',
    } as never)
    .select()
    .single()

  if (error) throw error
  return data as unknown as ReviewResponse
}

export async function getReviewSummary(orgId: string): Promise<{
  total: number
  avgRating: number
  needsResponse: number
  byPlatform: Record<string, { count: number; avgRating: number }>
}> {
  const { data, error } = await supabase
    .from('reviews' as never)
    .select('platform, rating, response_needed')
    .eq('org_id', orgId)

  if (error) throw error
  const reviews = (data ?? []) as unknown as Array<{ platform: string; rating: number; response_needed: boolean }>

  const byPlatform: Record<string, { count: number; totalRating: number }> = {}
  let needsResponse = 0

  reviews.forEach(r => {
    if (!byPlatform[r.platform]) byPlatform[r.platform] = { count: 0, totalRating: 0 }
    byPlatform[r.platform].count += 1
    byPlatform[r.platform].totalRating += r.rating
    if (r.response_needed) needsResponse += 1
  })

  const totalRating = reviews.reduce((sum, r) => sum + r.rating, 0)

  return {
    total: reviews.length,
    avgRating: reviews.length > 0 ? parseFloat((totalRating / reviews.length).toFixed(1)) : 0,
    needsResponse,
    byPlatform: Object.fromEntries(
      Object.entries(byPlatform).map(([k, v]) => [k, { count: v.count, avgRating: parseFloat((v.totalRating / v.count).toFixed(1)) }])
    ),
  }
}
