// @ts-nocheck
/**
 * Google Business Review Monitoring — SPARK automation
 *
 * Fetches reviews from Google My Business API, drafts AI responses,
 * and tracks review metrics. All customer-facing responses go through MiroFish.
 */

import { callClaude, extractText } from './claudeProxy'
import { publish } from './agentEventBus'

// ── Types ──────────────────────────────────────────────────────────────────

export interface GoogleReview {
  reviewId: string
  reviewer: { displayName: string; profilePhotoUrl?: string }
  starRating: number
  comment: string
  createTime: string
  updateTime: string
  reviewReply?: { comment: string; updateTime: string }
}

export interface ReviewMetrics {
  avgRating: number
  totalReviews: number
  responseRate: number
  reviewVelocity: number // reviews per month
  ratingDistribution: Record<number, number>
}

// ── Constants ──────────────────────────────────────────────────────────────

const GMB_API_BASE = 'https://mybusiness.googleapis.com/v4'

const REVIEW_RESPONSE_SYSTEM = `You are drafting a warm professional response for Power On Solutions LLC, a C-10 electrical contractor in the Coachella Valley, CA.
Max 3 sentences. Reference specific work if mentioned in the review.
Tone: friendly, professional, grateful. Sign off with "— The Power On Solutions Team"`

// ── Implementation ─────────────────────────────────────────────────────────

/**
 * Fetch Google Business reviews using the Google My Business API.
 * Requires VITE_GOOGLE_CLIENT_ID and an OAuth token.
 */
export async function getBusinessReviews(accessToken?: string): Promise<GoogleReview[]> {
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID
  if (!clientId) {
    console.warn('[GoogleBusiness] VITE_GOOGLE_CLIENT_ID not configured')
    return []
  }

  if (!accessToken) {
    console.warn('[GoogleBusiness] No access token provided — using cached reviews')
    return getCachedReviews()
  }

  try {
    // Discover the account and location
    const accountsRes = await fetch(`${GMB_API_BASE}/accounts`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!accountsRes.ok) throw new Error(`GMB accounts error: ${accountsRes.status}`)
    const accounts = await accountsRes.json()
    const accountName = accounts?.accounts?.[0]?.name

    if (!accountName) {
      console.warn('[GoogleBusiness] No GMB account found')
      return []
    }

    // Get locations
    const locationsRes = await fetch(`${GMB_API_BASE}/${accountName}/locations`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!locationsRes.ok) throw new Error(`GMB locations error: ${locationsRes.status}`)
    const locations = await locationsRes.json()
    const locationName = locations?.locations?.[0]?.name

    if (!locationName) {
      console.warn('[GoogleBusiness] No GMB location found')
      return []
    }

    // Fetch reviews
    const reviewsRes = await fetch(`${GMB_API_BASE}/${locationName}/reviews`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!reviewsRes.ok) throw new Error(`GMB reviews error: ${reviewsRes.status}`)
    const reviewsData = await reviewsRes.json()
    const reviews: GoogleReview[] = (reviewsData?.reviews || []).map((r: any) => ({
      reviewId: r.reviewId,
      reviewer: {
        displayName: r.reviewer?.displayName || 'Anonymous',
        profilePhotoUrl: r.reviewer?.profilePhotoUrl,
      },
      starRating: r.starRating === 'FIVE' ? 5 : r.starRating === 'FOUR' ? 4 : r.starRating === 'THREE' ? 3 : r.starRating === 'TWO' ? 2 : 1,
      comment: r.comment || '',
      createTime: r.createTime,
      updateTime: r.updateTime,
      reviewReply: r.reviewReply ? { comment: r.reviewReply.comment, updateTime: r.reviewReply.updateTime } : undefined,
    }))

    // Cache reviews
    cacheReviews(reviews)

    // Publish events for new reviews
    const cached = getCachedReviewIds()
    reviews.forEach(r => {
      if (!cached.has(r.reviewId)) {
        publish(
          'REVIEW_RECEIVED' as any,
          'spark',
          { reviewId: r.reviewId, rating: r.starRating, reviewer: r.reviewer.displayName },
          `New ${r.starRating}-star review from ${r.reviewer.displayName}`
        )
      }
    })

    console.log(`[GoogleBusiness] Fetched ${reviews.length} reviews`)
    return reviews
  } catch (err) {
    console.error('[GoogleBusiness] Error fetching reviews:', err)
    return getCachedReviews()
  }
}

/**
 * Draft a professional AI response for a review.
 * Response goes through MiroFish before posting.
 */
export async function draftReviewResponse(review: GoogleReview): Promise<string> {
  try {
    const result = await callClaude({
      system: REVIEW_RESPONSE_SYSTEM,
      messages: [{
        role: 'user',
        content: `Customer "${review.reviewer.displayName}" left a ${review.starRating}-star review:\n\n"${review.comment}"\n\nDraft a professional response.`,
      }],
      max_tokens: 300,
    })
    return extractText(result)
  } catch (err) {
    console.error('[GoogleBusiness] Draft response error:', err)
    return ''
  }
}

/**
 * Post a review response (after MiroFish approval).
 */
export async function postReviewResponse(
  locationName: string,
  reviewId: string,
  responseText: string,
  accessToken: string
): Promise<boolean> {
  try {
    const res = await fetch(
      `${GMB_API_BASE}/${locationName}/reviews/${reviewId}/reply`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ comment: responseText }),
      }
    )
    return res.ok
  } catch (err) {
    console.error('[GoogleBusiness] Post response error:', err)
    return false
  }
}

/**
 * Calculate review metrics from the reviews list.
 */
export function calculateReviewMetrics(reviews: GoogleReview[]): ReviewMetrics {
  if (reviews.length === 0) {
    return { avgRating: 0, totalReviews: 0, responseRate: 0, reviewVelocity: 0, ratingDistribution: {} }
  }

  const totalRating = reviews.reduce((sum, r) => sum + r.starRating, 0)
  const responded = reviews.filter(r => r.reviewReply).length

  // Calculate velocity (reviews per month over last 90 days)
  const ninetyDaysAgo = Date.now() - 90 * 24 * 60 * 60 * 1000
  const recentReviews = reviews.filter(r => new Date(r.createTime).getTime() > ninetyDaysAgo)
  const reviewVelocity = parseFloat(((recentReviews.length / 3)).toFixed(1))

  // Rating distribution
  const ratingDistribution: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
  reviews.forEach(r => { ratingDistribution[r.starRating] = (ratingDistribution[r.starRating] || 0) + 1 })

  return {
    avgRating: parseFloat((totalRating / reviews.length).toFixed(1)),
    totalReviews: reviews.length,
    responseRate: parseFloat(((responded / reviews.length) * 100).toFixed(0)),
    reviewVelocity,
    ratingDistribution,
  }
}

// ── Cache helpers ──────────────────────────────────────────────────────────

function cacheReviews(reviews: GoogleReview[]): void {
  try {
    localStorage.setItem('spark_google_reviews', JSON.stringify(reviews))
  } catch { /* ignore */ }
}

function getCachedReviews(): GoogleReview[] {
  try {
    const raw = localStorage.getItem('spark_google_reviews')
    return raw ? JSON.parse(raw) : []
  } catch { return [] }
}

function getCachedReviewIds(): Set<string> {
  return new Set(getCachedReviews().map(r => r.reviewId))
}
