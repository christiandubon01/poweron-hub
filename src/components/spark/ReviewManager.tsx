// @ts-nocheck
'use client'

import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { Loader2, AlertCircle } from 'lucide-react'
import clsx from 'clsx'
import { processSparkRequest } from '@/agents/spark'

interface Review {
  id: string
  org_id: string
  platform: 'google' | 'yelp' | 'facebook'
  reviewer_name: string
  rating: number
  title?: string
  body: string
  response_needed: boolean
  response_text?: string
  review_date: string
}

const PLATFORM_COLORS = {
  google: 'bg-blue-400/10 text-blue-400',
  yelp: 'bg-red-400/10 text-red-400',
  facebook: 'bg-blue-500/10 text-blue-500',
}

const REVIEW_FILTERS = ['all', 'needs_response', 'responded'] as const

export function ReviewManager() {
  const { user, profile } = useAuth()
  const [reviews, setReviews] = useState<Review[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeFilter, setActiveFilter] = useState<typeof REVIEW_FILTERS[number]>('all')
  const [draftingId, setDraftingId] = useState<string | null>(null)
  const [draftResponse, setDraftResponse] = useState<Record<string, string>>({})

  const orgId = profile?.org_id

  useEffect(() => {
    if (!orgId) return
    fetchReviews()
  }, [orgId])

  const fetchReviews = async () => {
    if (!orgId) return
    setLoading(true)
    setError(null)
    try {
      const { data, error: fetchError } = await supabase
        .from('reviews' as never)
        .select('*')
        .eq('org_id', orgId)
        .order('review_date', { ascending: false })

      if (fetchError) throw fetchError
      setReviews(data as Review[] || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch reviews')
    } finally {
      setLoading(false)
    }
  }

  const handleDraftResponse = async (review: Review) => {
    if (!orgId || !user?.id) return

    setDraftingId(review.id)
    try {
      const result = await processSparkRequest({
        action: 'draft_review_response',
        orgId,
        userId: user.id,
        params: {
          reviewId: review.id,
          reviewText: review.body,
          rating: review.rating,
        },
      })

      if (result.success && result.data?.draft) {
        setDraftResponse({
          ...draftResponse,
          [review.id]: result.data.draft,
        })
      } else {
        setError('Failed to draft response')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to draft response')
    } finally {
      setDraftingId(null)
    }
  }

  const filteredReviews = activeFilter === 'all'
    ? reviews
    : activeFilter === 'needs_response'
      ? reviews.filter(r => r.response_needed && !r.response_text)
      : reviews.filter(r => r.response_text)

  const renderStars = (rating: number) => {
    const stars = '★'.repeat(Math.round(rating))
    const emptyStars = '☆'.repeat(5 - Math.round(rating))
    return stars + emptyStars
  }

  const getPlatformLabel = (platform: 'google' | 'yelp' | 'facebook') => {
    return platform.charAt(0).toUpperCase() + platform.slice(1)
  }

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString()
  }

  return (
    <div className="space-y-4">
      {/* Filter Tabs */}
      <div className="flex gap-2 overflow-x-auto pb-2 border-b border-gray-800">
        {REVIEW_FILTERS.map((filter) => (
          <button
            key={filter}
            onClick={() => setActiveFilter(filter)}
            className={clsx(
              'px-3 py-2 rounded-md text-sm font-medium whitespace-nowrap transition-colors',
              activeFilter === filter
                ? 'bg-pink-500/20 text-pink-400'
                : 'text-gray-400 hover:text-gray-300'
            )}
          >
            {filter === 'all' ? 'All' : filter === 'needs_response' ? 'Needs Response' : 'Responded'}
          </button>
        ))}
      </div>

      {/* Loading State */}
      {loading && (
        <div className="flex justify-center items-center py-8">
          <Loader2 className="w-6 h-6 text-cyan-400 animate-spin" />
        </div>
      )}

      {/* Error State */}
      {error && (
        <div className="flex items-center gap-2 p-4 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400">
          <AlertCircle className="w-5 h-5" />
          <span>{error}</span>
        </div>
      )}

      {/* Empty State */}
      {!loading && filteredReviews.length === 0 && (
        <div className="py-12 text-center">
          <div className="text-gray-500 text-sm">No reviews found</div>
        </div>
      )}

      {/* Review Cards */}
      <div className="space-y-4">
        {filteredReviews.map((review) => (
          <div
            key={review.id}
            className="p-4 bg-gray-800/50 border border-gray-700 rounded-lg hover:border-gray-600 transition-colors space-y-3"
          >
            {/* Review Header */}
            <div className="flex justify-between items-start gap-3">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-2">
                  <span className={clsx('px-2 py-1 rounded text-xs font-medium', PLATFORM_COLORS[review.platform])}>
                    {getPlatformLabel(review.platform)}
                  </span>
                  {review.response_needed && !review.response_text && (
                    <span className="w-2 h-2 bg-red-500 rounded-full" />
                  )}
                </div>
                <h4 className="text-gray-100 font-semibold text-sm mb-1">{review.title || 'Untitled'}</h4>
                <p className="text-gray-500 text-xs">
                  {review.reviewer_name} • {formatDate(review.review_date)}
                </p>
              </div>
              <div className="text-right">
                <div className="text-yellow-400 text-sm font-medium">
                  {renderStars(review.rating)}
                </div>
                <span className="text-gray-500 text-xs">{Math.round(review.rating * 2) / 2}/5</span>
              </div>
            </div>

            {/* Review Body */}
            <div className="bg-gray-900/50 rounded p-3">
              <p className="text-gray-300 text-sm">
                {review.body.length > 100 ? review.body.substring(0, 100) + '...' : review.body}
              </p>
            </div>

            {/* Draft Response Section */}
            {review.response_needed && !review.response_text && (
              <button
                onClick={() => handleDraftResponse(review)}
                disabled={draftingId === review.id}
                className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-pink-600/20 text-pink-400 hover:bg-pink-600/30 disabled:opacity-50 rounded-md text-sm font-medium transition-colors"
              >
                {draftingId === review.id ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Drafting Response...
                  </>
                ) : (
                  'Draft Response'
                )}
              </button>
            )}

            {/* Draft Response Display */}
            {draftResponse[review.id] && (
              <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-3 space-y-2">
                <p className="text-emerald-400 text-xs font-medium">AI-Drafted Response:</p>
                <textarea
                  value={draftResponse[review.id]}
                  onChange={(e) => setDraftResponse({ ...draftResponse, [review.id]: e.target.value })}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-gray-100 text-sm resize-none focus:outline-none focus:border-emerald-500"
                  rows={3}
                />
              </div>
            )}

            {/* Existing Response */}
            {review.response_text && (
              <div className="bg-gray-900/50 border border-gray-700 rounded-lg p-3">
                <p className="text-gray-500 text-xs font-medium mb-2">Your Response:</p>
                <p className="text-gray-300 text-sm">{review.response_text}</p>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
