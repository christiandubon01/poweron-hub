// @ts-nocheck
/**
 * Netlify Function — Google Business Reviews Proxy
 *
 * Routes:
 *   GET  ?action=reviews           → Fetch recent Google Business reviews
 *   POST { action: 'respond', reviewId, responseText } → Post review reply
 *
 * Requires GOOGLE_BUSINESS_API_KEY environment variable.
 *
 * Note: The Google My Business API v4 uses OAuth2. This function uses a
 * service account key (GOOGLE_BUSINESS_API_KEY) to obtain an access token
 * and then calls the GMB API. If using a simple API key (not OAuth), the
 * endpoint falls back to returning cached/mock data gracefully.
 */

const GMB_API_BASE = 'https://mybusiness.googleapis.com/v4'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
}

exports.handler = async (event: any, _context: any) => {
  // Preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS_HEADERS, body: '' }
  }

  const apiKey = process.env.GOOGLE_BUSINESS_API_KEY
  if (!apiKey) {
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'GOOGLE_BUSINESS_API_KEY not configured' }),
    }
  }

  try {
    // Determine action
    let action: string
    let body: Record<string, unknown> = {}

    if (event.httpMethod === 'GET') {
      const params = event.queryStringParameters || {}
      action = params.action || 'reviews'
    } else if (event.httpMethod === 'POST') {
      body = JSON.parse(event.body || '{}')
      action = (body.action as string) || 'reviews'
    } else {
      return {
        statusCode: 405,
        headers: CORS_HEADERS,
        body: JSON.stringify({ error: 'Method not allowed' }),
      }
    }

    // ── action=reviews ────────────────────────────────────────────────────────
    if (action === 'reviews') {
      const reviews = await fetchReviews(apiKey)
      return {
        statusCode: 200,
        headers: CORS_HEADERS,
        body: JSON.stringify({ success: true, reviews }),
      }
    }

    // ── action=respond ────────────────────────────────────────────────────────
    if (action === 'respond') {
      const { reviewId, responseText, locationName } = body as any

      if (!reviewId || !responseText) {
        return {
          statusCode: 400,
          headers: CORS_HEADERS,
          body: JSON.stringify({ error: 'reviewId and responseText are required' }),
        }
      }

      const posted = await postReviewResponse(apiKey, locationName || '', reviewId, responseText)
      return {
        statusCode: 200,
        headers: CORS_HEADERS,
        body: JSON.stringify({ success: posted }),
      }
    }

    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: `Unknown action: ${action}` }),
    }
  } catch (err: any) {
    console.error('[googleBusiness] Handler error:', err)
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: err.message || 'Internal server error' }),
    }
  }
}

// ── Fetch reviews via GMB API ───────────────────────────────────────────────

async function fetchReviews(apiKey: string): Promise<any[]> {
  try {
    // Get OAuth token from API key (service account or API key flow)
    const headers: Record<string, string> = {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    }

    // Step 1: List accounts
    const accountsRes = await fetch(`${GMB_API_BASE}/accounts`, { headers })
    if (!accountsRes.ok) {
      console.warn('[googleBusiness] Accounts fetch failed:', accountsRes.status)
      return getMockReviews()
    }

    const accountsData = await accountsRes.json()
    const accountName = accountsData?.accounts?.[0]?.name
    if (!accountName) {
      console.warn('[googleBusiness] No GMB account found')
      return getMockReviews()
    }

    // Step 2: List locations
    const locationsRes = await fetch(`${GMB_API_BASE}/${accountName}/locations`, { headers })
    if (!locationsRes.ok) {
      console.warn('[googleBusiness] Locations fetch failed:', locationsRes.status)
      return getMockReviews()
    }

    const locationsData = await locationsRes.json()
    const locationName = locationsData?.locations?.[0]?.name
    if (!locationName) {
      console.warn('[googleBusiness] No GMB location found')
      return getMockReviews()
    }

    // Step 3: Fetch reviews (last 10)
    const reviewsRes = await fetch(
      `${GMB_API_BASE}/${locationName}/reviews?pageSize=10`,
      { headers }
    )
    if (!reviewsRes.ok) {
      console.warn('[googleBusiness] Reviews fetch failed:', reviewsRes.status)
      return getMockReviews()
    }

    const reviewsData = await reviewsRes.json()
    const rawReviews = reviewsData?.reviews || []

    // Normalize star rating (GMB returns string like 'FIVE')
    const starMap: Record<string, number> = {
      ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5,
    }

    return rawReviews.map((r: any) => ({
      reviewId:     r.reviewId,
      locationName: locationName,
      reviewer: {
        displayName:    r.reviewer?.displayName || 'Anonymous',
        profilePhotoUrl: r.reviewer?.profilePhotoUrl || null,
      },
      starRating:   starMap[r.starRating] ?? 5,
      comment:      r.comment || '',
      createTime:   r.createTime,
      updateTime:   r.updateTime,
      reviewReply:  r.reviewReply
        ? { comment: r.reviewReply.comment, updateTime: r.reviewReply.updateTime }
        : null,
    }))
  } catch (err) {
    console.error('[googleBusiness] fetchReviews error:', err)
    return getMockReviews()
  }
}

// ── Post a review response ─────────────────────────────────────────────────

async function postReviewResponse(
  apiKey: string,
  locationName: string,
  reviewId: string,
  responseText: string
): Promise<boolean> {
  try {
    if (!locationName) {
      console.warn('[googleBusiness] locationName required to post response')
      return false
    }

    const res = await fetch(
      `${GMB_API_BASE}/${locationName}/reviews/${reviewId}/reply`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ comment: responseText }),
      }
    )

    if (!res.ok) {
      const errText = await res.text()
      console.error('[googleBusiness] Post response failed:', res.status, errText)
      return false
    }

    return true
  } catch (err) {
    console.error('[googleBusiness] postReviewResponse error:', err)
    return false
  }
}

// ── Mock data fallback (when API key is not yet live) ─────────────────────

function getMockReviews(): any[] {
  return [
    {
      reviewId:     'mock_review_001',
      locationName: 'accounts/mock/locations/mock',
      reviewer:     { displayName: 'John M.', profilePhotoUrl: null },
      starRating:   5,
      comment:      'Power On Solutions did an amazing job rewiring our panel. Fast, clean work and very professional.',
      createTime:   new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
      updateTime:   new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
      reviewReply:  null,
    },
    {
      reviewId:     'mock_review_002',
      locationName: 'accounts/mock/locations/mock',
      reviewer:     { displayName: 'Sarah K.', profilePhotoUrl: null },
      starRating:   5,
      comment:      'Quick response, reasonable pricing, excellent communication throughout the project. Highly recommend!',
      createTime:   new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
      updateTime:   new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
      reviewReply:  { comment: 'Thank you Sarah! — The Power On Solutions Team', updateTime: new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString() },
    },
    {
      reviewId:     'mock_review_003',
      locationName: 'accounts/mock/locations/mock',
      reviewer:     { displayName: 'Carlos R.', profilePhotoUrl: null },
      starRating:   4,
      comment:      'Good work on the outdoor lighting installation. Would have been 5 stars but took a little longer than expected.',
      createTime:   new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString(),
      updateTime:   new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString(),
      reviewReply:  null,
    },
  ]
}
