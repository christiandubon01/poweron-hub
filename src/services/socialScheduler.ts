// @ts-nocheck
/**
 * Social Media Post Scheduler — Schedule posts for Facebook, Instagram, LinkedIn
 *
 * Post types:
 * - COMPLETED_JOB: "Just finished a [job type] in [city]. [brief description]"
 * - SEASONAL: Spring/Summer/Fall/Winter electrical safety tips
 * - PROMOTION: Service specials, new capabilities
 * - EDUCATIONAL: NEC code updates, safety tips from OHM
 *
 * SPARK generates content using Claude with Power On Solutions branding.
 * All posts go through MiroFish before scheduling.
 * Scheduled posts stored in backup.campaigns array.
 * Publishes SOCIAL_POST_SCHEDULED to agentEventBus.
 */

import { publish } from './agentEventBus'
import { submitProposal, runAutomatedReview } from './miroFish'

// ── Types ───────────────────────────────────────────────────────────────────

export type SocialPlatform = 'facebook' | 'instagram' | 'linkedin'
export type PostType = 'completed_job' | 'seasonal' | 'promotion' | 'educational'

export interface ScheduledPost {
  id: string
  platforms: SocialPlatform[]
  postType: PostType
  content: string
  imageUrl?: string
  scheduledAt: string          // ISO timestamp for when to post
  status: 'draft' | 'pending_approval' | 'approved' | 'posted' | 'failed'
  mirofishProposalId?: string
  createdAt: string
  postedAt?: string
  metadata?: Record<string, unknown>
}

export interface PostGenerationInput {
  postType: PostType
  platforms: SocialPlatform[]
  scheduledAt: string
  context?: {
    jobType?: string
    city?: string
    description?: string
    season?: string
    topic?: string
  }
}

// ── State ───────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'poweron_social_posts'

function loadPosts(): ScheduledPost[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function savePosts(posts: ScheduledPost[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(posts))
  } catch {
    // silently continue
  }
}

// ── Post Content Generation ─────────────────────────────────────────────────

const SOCIAL_SYSTEM_PROMPT = `You are SPARK, the marketing agent for Power On Solutions LLC — a licensed C-10 electrical contractor serving the Coachella Valley (Desert Hot Springs, Palm Springs, Palm Desert, etc.).

Generate a social media post with these rules:
- Professional yet approachable tone
- Include relevant hashtags (3-5 max)
- Keep under 280 characters for Twitter-compatible posts, or ~500 chars for LinkedIn
- Reference Power On Solutions branding naturally
- End with a call-to-action when appropriate
- Never include phone numbers or addresses in the post body`

const POST_TEMPLATES: Record<PostType, string> = {
  completed_job: `Write a social media post celebrating a completed electrical job.
Job type: {jobType}
City: {city}
Description: {description}
Format: "Just finished a [job type] in [city]. [brief description]. [CTA]"`,

  seasonal: `Write a seasonal electrical safety tip post.
Season: {season}
Make it helpful, educational, and position Power On Solutions as the expert.`,

  promotion: `Write a promotional social media post.
Topic: {topic}
Highlight the service special or new capability. Keep it genuine, not salesy.`,

  educational: `Write an educational post about electrical safety or code compliance.
Topic: {topic}
Reference NEC/CEC code if relevant. Make it accessible to homeowners and businesses.`,
}

/**
 * Generate social media post content using Claude.
 */
export async function generatePostContent(input: PostGenerationInput): Promise<string> {
  const ANTHROPIC_API_KEY = import.meta.env.VITE_ANTHROPIC_API_KEY as string

  let template = POST_TEMPLATES[input.postType]
  const ctx = input.context || {}
  template = template
    .replace('{jobType}', ctx.jobType || 'electrical work')
    .replace('{city}', ctx.city || 'the Coachella Valley')
    .replace('{description}', ctx.description || '')
    .replace('{season}', ctx.season || getCurrentSeason())
    .replace('{topic}', ctx.topic || '')

  const platformNote = input.platforms.includes('linkedin')
    ? 'Optimize for LinkedIn (professional, slightly longer).'
    : 'Keep it concise for Facebook/Instagram.'

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
      max_tokens: 300,
      system: SOCIAL_SYSTEM_PROMPT,
      messages: [{
        role: 'user',
        content: `${template}\n\nPlatforms: ${input.platforms.join(', ')}. ${platformNote}`,
      }],
    }),
  })

  if (!response.ok) throw new Error(`Claude API error: ${response.statusText}`)

  const result = (await response.json()) as { content?: Array<{ type: string; text: string }> }
  return result.content?.find(c => c.type === 'text')?.text ?? ''
}

// ── Post Scheduling ─────────────────────────────────────────────────────────

/**
 * Create and schedule a social media post.
 * Content goes through MiroFish before being scheduled.
 */
export async function schedulePost(
  input: PostGenerationInput,
  content: string,
  orgId: string
): Promise<ScheduledPost> {
  const postId = `sp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const now = new Date().toISOString()

  const post: ScheduledPost = {
    id: postId,
    platforms: input.platforms,
    postType: input.postType,
    content,
    scheduledAt: input.scheduledAt,
    status: 'pending_approval',
    createdAt: now,
    metadata: input.context,
  }

  // Submit through MiroFish
  const proposal = await submitProposal({
    orgId,
    proposingAgent: 'spark',
    title: `Schedule social post: ${input.postType}`,
    description: `Post to ${input.platforms.join(', ')}: "${content.substring(0, 80)}..."`,
    category: 'operations',
    impactLevel: 'medium',
    actionType: 'schedule_social_post',
    actionPayload: {
      postId,
      platforms: input.platforms,
      postType: input.postType,
      content,
      scheduledAt: input.scheduledAt,
    },
  })

  post.mirofishProposalId = proposal.id

  // Run automated review
  await runAutomatedReview(proposal.id!)

  // Save post
  const posts = loadPosts()
  posts.push(post)
  savePosts(posts)

  // Publish event
  publish(
    'SOCIAL_POST_SCHEDULED' as any,
    'spark',
    {
      postId,
      platforms: input.platforms,
      postType: input.postType,
      scheduledAt: input.scheduledAt,
    },
    `Social post scheduled for ${input.platforms.join(', ')} on ${new Date(input.scheduledAt).toLocaleDateString()}`
  )

  return post
}

/**
 * Mark a post as approved (after MiroFish confirmation).
 */
export function approvePost(postId: string): void {
  const posts = loadPosts()
  const idx = posts.findIndex(p => p.id === postId)
  if (idx >= 0) {
    posts[idx].status = 'approved'
    savePosts(posts)
  }
}

/**
 * Mark a post as posted.
 */
export function markPosted(postId: string): void {
  const posts = loadPosts()
  const idx = posts.findIndex(p => p.id === postId)
  if (idx >= 0) {
    posts[idx].status = 'posted'
    posts[idx].postedAt = new Date().toISOString()
    savePosts(posts)
  }
}

// ── Queries ─────────────────────────────────────────────────────────────────

/**
 * Get all scheduled posts, optionally filtered.
 */
export function getScheduledPosts(filter?: {
  status?: ScheduledPost['status']
  platform?: SocialPlatform
  postType?: PostType
}): ScheduledPost[] {
  let posts = loadPosts()

  if (filter?.status) posts = posts.filter(p => p.status === filter.status)
  if (filter?.platform) posts = posts.filter(p => p.platforms.includes(filter.platform!))
  if (filter?.postType) posts = posts.filter(p => p.postType === filter.postType)

  return posts.sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime())
}

/**
 * Get posts for a specific month (for calendar view).
 */
export function getPostsForMonth(year: number, month: number): ScheduledPost[] {
  const posts = loadPosts()
  return posts.filter(p => {
    const d = new Date(p.scheduledAt)
    return d.getFullYear() === year && d.getMonth() === month
  })
}

/**
 * Get upcoming posts (next 7 days).
 */
export function getUpcomingPosts(): ScheduledPost[] {
  const now = Date.now()
  const weekLater = now + 7 * 24 * 60 * 60 * 1000
  return loadPosts().filter(p => {
    const t = new Date(p.scheduledAt).getTime()
    return t >= now && t <= weekLater && (p.status === 'approved' || p.status === 'pending_approval')
  })
}

/**
 * Delete a scheduled post (only if not yet posted).
 */
export function deletePost(postId: string): boolean {
  const posts = loadPosts()
  const idx = posts.findIndex(p => p.id === postId)
  if (idx < 0) return false
  if (posts[idx].status === 'posted') return false // Cannot delete posted
  posts.splice(idx, 1)
  savePosts(posts)
  return true
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function getCurrentSeason(): string {
  const month = new Date().getMonth()
  if (month >= 2 && month <= 4) return 'Spring'
  if (month >= 5 && month <= 7) return 'Summer'
  if (month >= 8 && month <= 10) return 'Fall'
  return 'Winter'
}
