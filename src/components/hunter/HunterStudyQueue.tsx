// @ts-nocheck
/**
 * HunterStudyQueue — Study Queue Sub-Panel for HUNTER
 *
 * Features:
 * - List of deferred study topics from hunter_study_queue Supabase table
 * - Each topic card: lesson text, source lead name, debrief date, priority badge (high/medium/low)
 * - Status: pending or completed
 * - "Review Now" button: opens the lesson with full context (original lead, outcome, extracted lesson)
 * - "Mark Complete" button: updates status in Supabase
 * - "Bundle Study Session" button: groups 3-5 pending topics into one review session
 * - Bundled session: NEXUS walks through each topic via voice or text, asks user to reflect
 * - Sort options: by priority, date, source lead
 * - Filters: pending only, completed only, all
 * - Empty state: "No study topics queued. Complete a debrief to add lessons here."
 * - Counter badge on HUNTER panel showing pending study count
 */

import React, { useState, useEffect } from 'react'
import {
  ChevronRight,
  CheckCircle2,
  Clock,
  AlertCircle,
  BookOpen,
  Play,
  Bundle,
  Filter,
  MoreVertical,
} from 'lucide-react'
import clsx from 'clsx'

import {
  fetchStudyQueue,
  completeStudyTopic,
  getStudyStats,
  bundleStudySession,
  getStudyTopicWithContext,
  getPendingCount,
  getStudyTopicsFiltered,
  type StudyStats,
  StudyPriority,
} from '@/services/hunter/HunterStudyService'
import { StudyQueueStatus } from '@/services/hunter/HunterTypes'

export interface HunterStudyQueueProps {
  userId: string
  onClose?: () => void
  onBundleCreated?: (bundleId: string) => void
  onTopicReview?: (topicId: string) => void
}

type SortOption = 'priority' | 'date' | 'source'
type FilterOption = 'all' | 'pending' | 'completed'

interface StudyTopic {
  id: string
  topic: string
  status: StudyQueueStatus
  created_at: string
  priority?: StudyPriority
  debrief_id?: string
}

export const HunterStudyQueue: React.FC<HunterStudyQueueProps> = ({
  userId,
  onClose,
  onBundleCreated,
  onTopicReview,
}) => {
  const [topics, setTopics] = useState<StudyTopic[]>([])
  const [selectedTopics, setSelectedTopics] = useState<Set<string>>(new Set())
  const [stats, setStats] = useState<StudyStats | null>(null)
  const [sortBy, setSortBy] = useState<SortOption>('priority')
  const [filterBy, setFilterBy] = useState<FilterOption>('pending')
  const [isLoading, setIsLoading] = useState(true)
  const [reviewingTopicId, setReviewingTopicId] = useState<string | null>(null)
  const [reviewDetail, setReviewDetail] = useState<any>(null)

  // Load study queue on mount
  useEffect(() => {
    loadStudyQueue()
  }, [userId, filterBy])

  // Load stats on mount
  useEffect(() => {
    loadStats()
  }, [userId])

  const loadStudyQueue = async () => {
    setIsLoading(true)
    try {
      let status: StudyQueueStatus | undefined
      if (filterBy === 'pending') {
        status = StudyQueueStatus.PENDING
      } else if (filterBy === 'completed') {
        status = StudyQueueStatus.COMPLETED
      }

      const data = await fetchStudyQueue(userId, status)
      setTopics(data || [])
    } catch (error) {
      console.error('Failed to load study queue:', error)
      setTopics([])
    } finally {
      setIsLoading(false)
    }
  }

  const loadStats = async () => {
    try {
      const data = await getStudyStats(userId)
      setStats(data)
    } catch (error) {
      console.error('Failed to load stats:', error)
    }
  }

  const handleCompleteTopicClick = async (topicId: string) => {
    try {
      await completeStudyTopic(topicId)
      // Refresh the queue
      await loadStudyQueue()
      await loadStats()
    } catch (error) {
      console.error('Failed to complete topic:', error)
    }
  }

  const handleReviewClick = async (topicId: string) => {
    setReviewingTopicId(topicId)
    try {
      const detail = await getStudyTopicWithContext(topicId)
      setReviewDetail(detail)
      onTopicReview?.(topicId)
    } catch (error) {
      console.error('Failed to load review detail:', error)
    }
  }

  const handleSelectTopic = (topicId: string) => {
    const newSelected = new Set(selectedTopics)
    if (newSelected.has(topicId)) {
      newSelected.delete(topicId)
    } else {
      newSelected.add(topicId)
    }
    setSelectedTopics(newSelected)
  }

  const handleBundleSession = async () => {
    if (selectedTopics.size < 3 || selectedTopics.size > 5) {
      alert('Please select 3-5 topics to bundle')
      return
    }

    try {
      const bundle = await bundleStudySession(Array.from(selectedTopics))
      setSelectedTopics(new Set())
      onBundleCreated?.(bundle.id)
      // Optionally refresh and show bundle details
    } catch (error) {
      console.error('Failed to create bundle:', error)
    }
  }

  const getPriorityColor = (priority?: StudyPriority) => {
    switch (priority) {
      case StudyPriority.HIGH:
        return 'bg-red-900 text-red-100'
      case StudyPriority.MEDIUM:
        return 'bg-amber-900 text-amber-100'
      case StudyPriority.LOW:
        return 'bg-blue-900 text-blue-100'
      default:
        return 'bg-gray-900 text-gray-100'
    }
  }

  const getPriorityLabel = (priority?: StudyPriority) => {
    return priority ? priority.charAt(0).toUpperCase() + priority.slice(1) : 'Normal'
  }

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr)
    const now = new Date()
    const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24))

    if (diffDays === 0) return 'Today'
    if (diffDays === 1) return 'Yesterday'
    if (diffDays < 7) return `${diffDays} days ago`
    if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`
    return date.toLocaleDateString()
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-400">Loading study queue...</div>
      </div>
    )
  }

  if (topics.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 bg-gray-900 rounded-lg border border-gray-800 p-6">
        <BookOpen className="w-12 h-12 text-gray-600 mb-4" />
        <h3 className="text-lg font-semibold text-gray-200 mb-2">No study topics queued</h3>
        <p className="text-gray-400 text-center max-w-sm">
          Complete a debrief to add lessons here. These topics help you refine your approach over time.
        </p>
      </div>
    )
  }

  return (
    <div className="w-full max-w-4xl mx-auto p-6">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-2xl font-bold text-white">Study Queue</h2>
          {stats && (
            <div className="flex gap-4">
              <div className="bg-gray-900 rounded-lg px-4 py-2">
                <div className="text-xs text-gray-400">Pending</div>
                <div className="text-xl font-bold text-white">{stats.pendingCount}</div>
              </div>
              <div className="bg-gray-900 rounded-lg px-4 py-2">
                <div className="text-xs text-gray-400">This Week</div>
                <div className="text-xl font-bold text-green-400">{stats.completedThisWeek}</div>
              </div>
              <div className="bg-gray-900 rounded-lg px-4 py-2">
                <div className="text-xs text-gray-400">Streak</div>
                <div className="text-xl font-bold text-amber-400">{stats.currentStreak}</div>
              </div>
            </div>
          )}
        </div>

        {/* Controls */}
        <div className="flex gap-3 flex-wrap">
          {/* Filter */}
          <div className="flex items-center gap-2 bg-gray-900 rounded-lg px-3 py-2">
            <Filter className="w-4 h-4 text-gray-400" />
            <select
              value={filterBy}
              onChange={(e) => setFilterBy(e.target.value as FilterOption)}
              className="bg-transparent text-sm text-white outline-none cursor-pointer"
            >
              <option value="all">All Topics</option>
              <option value="pending">Pending Only</option>
              <option value="completed">Completed Only</option>
            </select>
          </div>

          {/* Sort */}
          <div className="flex items-center gap-2 bg-gray-900 rounded-lg px-3 py-2">
            <Filter className="w-4 h-4 text-gray-400" />
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortOption)}
              className="bg-transparent text-sm text-white outline-none cursor-pointer"
            >
              <option value="priority">Sort by Priority</option>
              <option value="date">Sort by Date</option>
              <option value="source">Sort by Source</option>
            </select>
          </div>

          {/* Bundle Button */}
          {selectedTopics.size > 0 && (
            <button
              onClick={handleBundleSession}
              disabled={selectedTopics.size < 3 || selectedTopics.size > 5}
              className={clsx(
                'flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors',
                selectedTopics.size >= 3 && selectedTopics.size <= 5
                  ? 'bg-blue-600 text-white hover:bg-blue-700'
                  : 'bg-gray-800 text-gray-400 cursor-not-allowed'
              )}
            >
              <Bundle className="w-4 h-4" />
              Bundle {selectedTopics.size} Topics
            </button>
          )}
        </div>
      </div>

      {/* Topics List */}
      <div className="space-y-3">
        {topics.map((topic) => (
          <div
            key={topic.id}
            className="bg-gray-900 border border-gray-800 rounded-lg p-4 hover:border-gray-700 transition-colors group"
          >
            {/* Topic Card Row */}
            <div className="flex items-start gap-4">
              {/* Checkbox (only for pending topics) */}
              {topic.status === StudyQueueStatus.PENDING && (
                <input
                  type="checkbox"
                  checked={selectedTopics.has(topic.id)}
                  onChange={() => handleSelectTopic(topic.id)}
                  className="w-5 h-5 mt-1 accent-blue-500 cursor-pointer"
                />
              )}

              {/* Status Indicator */}
              <div className="pt-1">
                {topic.status === StudyQueueStatus.COMPLETED ? (
                  <CheckCircle2 className="w-5 h-5 text-green-500" />
                ) : (
                  <Clock className="w-5 h-5 text-amber-500" />
                )}
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <h3 className="font-semibold text-white truncate flex-1">
                    {topic.topic}
                  </h3>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {topic.priority && (
                      <span
                        className={clsx(
                          'px-2 py-1 rounded text-xs font-medium',
                          getPriorityColor(topic.priority)
                        )}
                      >
                        {getPriorityLabel(topic.priority)}
                      </span>
                    )}
                  </div>
                </div>

                <p className="text-sm text-gray-400 mb-2">
                  Queued {formatDate(topic.created_at)}
                </p>

                {/* Action Buttons */}
                <div className="flex gap-2">
                  <button
                    onClick={() => handleReviewClick(topic.id)}
                    className="flex items-center gap-2 px-3 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 transition-colors"
                  >
                    <Play className="w-3 h-3" />
                    Review Now
                  </button>

                  {topic.status === StudyQueueStatus.PENDING && (
                    <button
                      onClick={() => handleCompleteTopicClick(topic.id)}
                      className="flex items-center gap-2 px-3 py-1.5 bg-green-600 text-white text-sm rounded hover:bg-green-700 transition-colors"
                    >
                      <CheckCircle2 className="w-3 h-3" />
                      Mark Complete
                    </button>
                  )}
                </div>
              </div>

              {/* Menu Button */}
              <button className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-800 rounded opacity-0 group-hover:opacity-100 transition-all">
                <MoreVertical className="w-4 h-4" />
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Review Modal */}
      {reviewingTopicId && reviewDetail && (
        <StudyTopicReviewModal
          topic={reviewDetail}
          onClose={() => {
            setReviewingTopicId(null)
            setReviewDetail(null)
          }}
          onMarkComplete={() => {
            handleCompleteTopicClick(reviewingTopicId)
            setReviewingTopicId(null)
            setReviewDetail(null)
          }}
        />
      )}
    </div>
  )
}

/**
 * Review modal for a single study topic
 */
interface StudyTopicReviewModalProps {
  topic: any
  onClose: () => void
  onMarkComplete: () => void
}

const StudyTopicReviewModal: React.FC<StudyTopicReviewModalProps> = ({
  topic,
  onClose,
  onMarkComplete,
}) => {
  const [hasReflected, setHasReflected] = useState(false)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
      <div className="bg-gray-950 border border-gray-800 rounded-lg max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-gray-950 border-b border-gray-800 px-6 py-4 flex items-center justify-between">
          <h2 className="text-xl font-bold text-white">Study Topic Review</h2>
          <button
            onClick={onClose}
            className="p-1 text-gray-400 hover:text-white hover:bg-gray-800 rounded"
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {/* Topic */}
          <div>
            <h3 className="text-sm font-semibold text-gray-400 uppercase mb-2">
              Topic
            </h3>
            <p className="text-lg font-semibold text-white">{topic.topic}</p>
          </div>

          {/* Context */}
          {topic.fullContext && (
            <div>
              <h3 className="text-sm font-semibold text-gray-400 uppercase mb-2">
                Full Context
              </h3>
              <div className="bg-gray-900 rounded-lg p-4 text-gray-300 text-sm whitespace-pre-wrap max-h-48 overflow-y-auto">
                {topic.fullContext}
              </div>
            </div>
          )}

          {/* Lead Info */}
          {topic.lead && (
            <div className="border border-gray-800 rounded-lg p-4">
              <h3 className="text-sm font-semibold text-gray-400 uppercase mb-3">
                Source Lead
              </h3>
              <div className="space-y-2 text-sm">
                {topic.lead.contact_name && (
                  <div>
                    <span className="text-gray-400">Contact:</span>
                    <span className="text-white ml-2">{topic.lead.contact_name}</span>
                  </div>
                )}
                {topic.lead.company_name && (
                  <div>
                    <span className="text-gray-400">Company:</span>
                    <span className="text-white ml-2">{topic.lead.company_name}</span>
                  </div>
                )}
                {topic.lead.estimated_value && (
                  <div>
                    <span className="text-gray-400">Est. Value:</span>
                    <span className="text-white ml-2">${topic.lead.estimated_value}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Reflection Prompt */}
          <div>
            <h3 className="text-sm font-semibold text-gray-400 uppercase mb-3">
              Your Reflection
            </h3>
            <textarea
              placeholder="How will you apply this lesson in your next interaction? What will you do differently?"
              defaultValue=""
              onChange={(e) => setHasReflected(e.target.value.length > 0)}
              className="w-full bg-gray-900 border border-gray-800 rounded-lg p-3 text-white text-sm placeholder-gray-500 focus:border-blue-500 focus:outline-none h-24"
            />
          </div>

          {/* Actions */}
          <div className="flex gap-3 justify-end">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-lg border border-gray-800 text-gray-300 hover:text-white hover:bg-gray-800 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={onMarkComplete}
              disabled={!hasReflected}
              className={clsx(
                'flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors',
                hasReflected
                  ? 'bg-green-600 text-white hover:bg-green-700'
                  : 'bg-gray-800 text-gray-400 cursor-not-allowed'
              )}
            >
              <CheckCircle2 className="w-4 h-4" />
              Mark Complete
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default HunterStudyQueue
