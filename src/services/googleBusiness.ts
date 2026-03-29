// @ts-nocheck
/**
 * Google Business Service — Monitor reviews, draft responses, track metrics
 *
 * Integrates with Google Business Profile API to:
 * - Monitor listing for new reviews
 * - Fetch review data (reviewer name, rating, text, date)
 * - Draft professional responses using Claude
 * - Route drafts through MiroFish before posting
 * - Track: average rating, response rate, review velocity
 * - Publish REVIEW_RECEIVED to agentEventBus
 *
 * Auth: VITE_GOOGLE_CLIENT_ID
 */

import { publish } from './agentEventBus'
import { submitProposal, runAutomatedReview } from './miroFish'

// ── Types ───────────────────────────────────────────────────────────────────

export interface GoogleReview {
  reviewId: string
  reviewerName: string
  rating: number
  text: string
  date: string
  isNew: boolean
  responseStatus: 'pending' | 'drafted' | 'approved' | 'posted'
  draftedResponse?: string
}

export interface GoogleBusinessMetrics {
  averageRating: number
  totalReviews: number
  responseRate: number
  reviewVelocity: number  // reviews per month
  ratingDistribution: Record<number, number>  // 1-5 → count
}

interface GoogleBusinessState {
  reviews: GoogleReview[]
  metrics: GoogleBusinessMetrics
  lastPolled: number
  accessToken: string | null
}

// ── State ───────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'poweron_google_business'
const POLL_INTERVAL_MS = 15 * 60 * 1000 // 15 minutes

let _state: GoogleBusinessState = {
  reviews: [],
  metrics: { averageRating: 0, totalReviews: 0, responseRate: 0, reviewVelocity: 0, ratingDistribution: {} },
  lastPolled: 0,
  accessToken: null,
}

let _pollTimer: ReturnType<typeof setInterval> | null = null

// ── Persistence ─────────────────────────────────────────────────────────────

function loadState(): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as GoogleBusinessState
      _state = { ..._state, ...parsed }
    }
  } catch {
    // Continue with defaults
  }
}

function saveState(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(_state))
  } catch {
    // localStorage full — silently continue
  }
}

// ── Google OAuth ────────────────────────────────────────────────────────────

/**
 * Initialize Google Business service. Call once on app startup.
 */
export function initGoogleBusiness(): void {
  loadState()
  console.log(`[GoogleBusiness] Initialized with ${_state.reviews.length} cached reviews`)
}

/**
 * Get the Google Client ID from env
 */
function getClientId(): string {
  return (import.meta.env.VITE_GOOGLE_CLIENT_ID as string) || ''
}

/**
 * Check if Google Business integration is configured
 */
export function isGoogleBusinessConfigured(): boolean {
  return !!getClientId()
}

/**
 * Authenticate with Google Business Profile API.
 * Uses OAuth2 implicit flow for browser-based access.
 */
export async function authenticateGoogle(): Promise<boolean> {
  const clientId = getClientId()
  if (!clientId) {
    console.warn('[GoogleBusiness] VITE_GOOGLE_CLIENT_ID not configured')
    return false
  }

  try {
    // Use Google Identity Services if available
    const google = (window as any).google
    if (!google?.accounts?.oauth2) {
      console.warn('[GoogleBusiness] Google Identity Services not loaded')
      return false
    }

    return new Promise<boolean>((resolve) => {
      const client = google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: 'https://www.googleapis.com/auth/business.manage',
        callback: (response: any) => {
          if (response.access_token) {
            _state.accessToken = response.access_token
            saveState()
            resolve(true)
          } else {
            resolve(false)
          }
        },
      })
      client.requestAccessToken()
    })
  } catch (error) {
    console.error('[GoogleBusiness] Auth error:', error)
    return false
  }
}

// ── Review Fetching ─────────────────────────────────────────────────────────

/**
 * Fetch reviews from Google Business Profile API.
 * Detects new reviews and publishes REVIEW_RECEIVED events.
 */
export async function fetchReviews(): Promise<GoogleReview[]> {
  if (!_state.accessToken) {
    console.warn('[GoogleBusiness] Not authenticated — returning cached reviews')
    return _state.reviews
  }

  try {
    // Fetch account info
    const accountsRes = await fetch(
      'https://mybusinessaccountmanagement.googleapis.com/v1/accounts',
      { headers: { Authorization: `Bearer ${_state.accessToken}` } }
    )

    if (!accountsRes.ok) {
      throw new Error(`Accounts API error: ${accountsRes.status}`)
    }

    const accountsData = await accountsRes.json()
    const accountName = accountsData.accounts?.[0]?.name
    if (!accountName) {
      console.warn('[GoogleBusiness] No accounts found')
      return _state.reviews
    }

    // Fetch locations
    const locationsRes = await fetch(
      `https://mybusinessbusinessinformation.googleapis.com/v1/${accountName}/locations`,
      { headers: { Authorization: `Bearer ${_state.accessToken}` } }
    )

    if (!locationsRes.ok) {
      throw new Error(`Locations API error: ${locationsRes.status}`)
    }

    const locationsData = await locationsRes.json()
    const locationName = locationsData.locations?.[0]?.name
    if (!locationName) {
      console.warn('[GoogleBusiness] No locations found')
      return _state.reviews
    }

    // Fetch reviews
    const reviewsRes = await fetch(
      `https://mybusiness.googleapis.com/v4/${locationName}/reviews`,
      { headers: { Authorization: `Bearer ${_state.accessToken}` } }
    )

    if (!reviewsRes.ok) {
      throw new Error(`Reviews API error: ${reviewsRes.status}`)
    }

    const reviewsData = await reviewsRes.json()
    const apiReviews = reviewsData.reviews || []

    // Map API reviews to our format
    const existingIds = new Set(_state.reviews.map(r => r.reviewId))
    const newReviews: GoogleReview[] = []

    const mappedReviews: GoogleReview[] = apiReviews.map((r: any) => {
      const reviewId = r.reviewId || r.name?.split('/').pop() || `gbr_${Date.now()}`
      const isNew = !existingIds.has(reviewId)

      // Preserve existing response status
      const existing = _state.reviews.find(er => er.reviewId === reviewId)

      const review: GoogleReview = {
        reviewId,
        reviewerName: r.reviewer?.displayName || 'Anonymous',
        rating: ratingToNumber(r.starRating),
        text: r.comment || '',
        date: r.createTime || new Date().toISOString(),
        isNew,
        responseStatus: existing?.responseStatus || 'pending',
        draftedResponse: existing?.draftedResponse,
      }

      if (isNew) newReviews.push(review)
      return review
    })

    // Update state
    _state.reviews = mappedReviews
    _state.lastPolled = Date.now()
    recalculateMetrics()
    saveState()

    // Publish events for new reviews
    for (const review of newReviews) {
      publish(
        'REVIEW_RECEIVED' as any,
        'spark',
        {
          reviewId: review.reviewId,
          reviewerName: review.reviewerName,
          rating: review.rating,
          platform: 'google',
        },
        `New Google review from ${review.reviewerName}: ${review.rating}/5 stars`
      )
    }

    return mappedReviews
  } catch (error) {
    console.error('[GoogleBusiness] fetchReviews error:', error)
    return _state.reviews
  }
}

// ── Response Drafting ───────────────────────────────────────────────────────

const REVIEW_RESPONSE_SYSTEM = `You are drafting a professional response for Power On Solutions LLC, a C-10 electrical contractor. Response must be warm, professional, reference the specific work done if mentioned, and invite future business. Max 3 sentences.`

/**
 * Draft a professional response to a review using Claude.
 * Returns the draft text. Does NOT post — goes through MiroFish.
 */
export async function draftReviewResponse(reviewId: string): Promise<string> {
  const review = _state.reviews.find(r => r.reviewId === reviewId)
  if (!review) throw new Error(`Review ${reviewId} not found`)

  const ANTHROPIC_API_KEY = import.meta.env.VITE_ANTHROPIC_API_KEY as string

  const response = await fetch('/api/anthropic/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 200,
      system: REVIEW_RESPONSE_SYSTEM,
      messages: [{
        role: 'user',
        content: `Review from ${review.reviewerName} (${review.rating}/5 stars):\n"${review.text}"\n\nDraft a professional response.`,
      }],
    }),
  })

  if (!response.ok) throw new Error(`Claude API error: ${response.statusText}`)

  const result = (await response.json()) as { content?: Array<{ type: string; text: string }> }
  const draftText = result.content?.find(c => c.type === 'text')?.text ?? ''

  // Save draft
  const idx = _state.reviews.findIndex(r => r.reviewId === reviewId)
  if (idx >= 0) {
    _state.reviews[idx].draftedResponse = draftText
    _state.reviews[idx].responseStatus = 'drafted'
    saveState()
  }

  return draftText
}

/**
 * Submit a review response for MiroFish approval, then post if approved.
 */
export async function submitReviewResponse(
  reviewId: string,
  responseText: string,
  orgId: string
): Promise<string> {
  const review = _state.reviews.find(r => r.reviewId === reviewId)
  if (!review) throw new Error(`Review ${reviewId} not found`)

  // Submit through MiroFish
  const proposal = await submitProposal({
    orgId,
    proposingAgent: 'spark',
    title: `Post review response to ${review.reviewerName}`,
    description: `Respond to ${review.rating}-star review: "${responseText.substring(0, 100)}..."`,
    category: 'operations',
    impactLevel: 'medium',
    actionType: 'post_review_response',
    actionPayload: {
      reviewId,
      responseText,
      platform: 'google',
      reviewerName: review.reviewerName,
      rating: review.rating,
    },
  })

  // Run automated review steps
  await runAutomatedReview(proposal.id!)

  return proposal.id!
}

/**
 * Post the approved response to Google Business.
 * Called after MiroFish approval (step 5).
 */
export async function postReviewResponse(reviewId: string, responseText: string): Promise<boolean> {
  if (!_state.accessToken) {
    console.error('[GoogleBusiness] Cannot post — not authenticated')
    return false
  }

  try {
    const review = _state.reviews.find(r => r.reviewId === reviewId)
    if (!review) return false

    // Post response via Google Business API
    const res = await fetch(
      `https://mybusiness.googleapis.com/v4/accounts/-/locations/-/reviews/${reviewId}/reply`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${_state.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ comment: responseText }),
      }
    )

    if (!res.ok) {
      console.error('[GoogleBusiness] Post response failed:', res.status)
      return false
    }

    // Update state
    const idx = _state.reviews.findIndex(r => r.reviewId === reviewId)
    if (idx >= 0) {
      _state.reviews[idx].responseStatus = 'posted'
      saveState()
    }

    return true
  } catch (error) {
    console.error('[GoogleBusiness] postReviewResponse error:', error)
    return false
  }
}

// ── Polling ─────────────────────────────────────────────────────────────────

/**
 * Start periodic review polling.
 */
export function startPolling(): void {
  if (_pollTimer) return
  _pollTimer = setInterval(() => {
    fetchReviews().catch(err => console.error('[GoogleBusiness] Poll error:', err))
  }, POLL_INTERVAL_MS)

  // Also do an immediate fetch
  fetchReviews().catch(err => console.error('[GoogleBusiness] Initial poll error:', err))
  console.log('[GoogleBusiness] Polling started (every 15m)')
}

/**
 * Stop periodic polling.
 */
export function stopPolling(): void {
  if (_pollTimer) {
    clearInterval(_pollTimer)
    _pollTimer = null
  }
}

// ── Metrics ─────────────────────────────────────────────────────────────────

/**
 * Recalculate business metrics from current review data.
 */
function recalculateMetrics(): void {
  const reviews = _state.reviews
  if (reviews.length === 0) {
    _state.metrics = { averageRating: 0, totalReviews: 0, responseRate: 0, reviewVelocity: 0, ratingDistribution: {} }
    return
  }

  const totalRating = reviews.reduce((sum, r) => sum + r.rating, 0)
  const responded = reviews.filter(r => r.responseStatus === 'posted' || r.responseStatus === 'approved').length
  const distribution: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
  reviews.forEach(r => {
    const bucket = Math.min(5, Math.max(1, Math.round(r.rating)))
    distribution[bucket] = (distribution[bucket] || 0) + 1
  })

  // Review velocity: reviews per 30 days
  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000
  const recentCount = reviews.filter(r => new Date(r.date).getTime() > thirtyDaysAgo).length

  _state.metrics = {
    averageRating: parseFloat((totalRating / reviews.length).toFixed(1)),
    totalReviews: reviews.length,
    responseRate: parseFloat(((responded / reviews.length) * 100).toFixed(1)),
    reviewVelocity: recentCount,
    ratingDistribution: distribution,
  }
}

/**
 * Get current metrics snapshot.
 */
export function getMetrics(): GoogleBusinessMetrics {
  return { ..._state.metrics }
}

/**
 * Get all cached reviews.
 */
export function getReviews(): GoogleReview[] {
  return [..._state.reviews]
}

/**
 * Get reviews needing response.
 */
export function getPendingReviews(): GoogleReview[] {
  return _state.reviews.filter(r => r.responseStatus === 'pending')
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function ratingToNumber(starRating: string | undefined): number {
  const map: Record<string, number> = {
    ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5,
  }
  return map[starRating || ''] || 0
}
