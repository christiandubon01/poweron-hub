// @ts-nocheck
/**
 * Social Media Post Scheduling — SPARK automation
 *
 * Generates branded social media posts for Power On Solutions LLC.
 * All posts go through MiroFish before scheduling/publishing.
 */

import { callClaude, extractText } from './claudeProxy'
import { getBackupData, saveBackupData } from './backupDataService'

// ── Types ──────────────────────────────────────────────────────────────────

export type PostType = 'COMPLETED_JOB' | 'SEASONAL' | 'PROMOTION' | 'EDUCATIONAL'

export interface ScheduledPost {
  id: string
  type: PostType
  content: string
  platform: 'facebook' | 'instagram' | 'google' | 'all'
  scheduledDate: string
  status: 'draft' | 'approved' | 'scheduled' | 'published'
  projectData?: Record<string, unknown>
  createdAt: string
  approvedBy?: string
  publishedAt?: string
}

// ── Constants ──────────────────────────────────────────────────────────────

const BRAND_CONTEXT = `Power On Solutions LLC, C-10 electrical contractor, Coachella Valley, CA.
Services: residential/commercial electrical, panel upgrades, EV chargers, solar, lighting.
Tone: professional, approachable, community-focused. Use relevant hashtags.`

const POST_TYPE_PROMPTS: Record<PostType, string> = {
  COMPLETED_JOB: `Write a social media post celebrating a completed electrical project. Highlight the quality of work and customer satisfaction. Include a call to action for potential clients.`,
  SEASONAL: `Write a seasonal electrical safety/maintenance tip post. Relevant to the Coachella Valley climate (hot summers, mild winters). Include a helpful tip and a subtle mention of our services.`,
  PROMOTION: `Write a promotional post for our electrical services. Highlight our C-10 license, free estimates, and quality craftsmanship. Include a strong call to action.`,
  EDUCATIONAL: `Write an educational post about electrical safety or home improvement tips. Position Power On Solutions as the trusted expert. Keep it informative and engaging.`,
}

// ── Implementation ─────────────────────────────────────────────────────────

/**
 * Generate social media post content using Claude AI.
 */
export async function generatePostContent(
  type: PostType,
  projectData?: Record<string, unknown>
): Promise<string> {
  const typePrompt = POST_TYPE_PROMPTS[type]
  const projectContext = projectData
    ? `\n\nProject details: ${JSON.stringify(projectData)}`
    : ''

  try {
    const result = await callClaude({
      system: `You write engaging social media posts for ${BRAND_CONTEXT}\nKeep posts under 280 characters for Twitter compatibility. Include 2-3 relevant hashtags.`,
      messages: [{
        role: 'user',
        content: `${typePrompt}${projectContext}`,
      }],
      max_tokens: 300,
    })
    return extractText(result)
  } catch (err) {
    console.error('[SocialScheduler] Content generation error:', err)
    return ''
  }
}

/**
 * Schedule posts for publishing. Stores in backup.campaigns array.
 */
export function schedulePosts(posts: Omit<ScheduledPost, 'id' | 'createdAt'>[]): ScheduledPost[] {
  const backup = getBackupData()
  if (!backup) return []

  const newPosts: ScheduledPost[] = posts.map(p => ({
    ...p,
    id: `post_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    createdAt: new Date().toISOString(),
  }))

  // Store in backup — use a dedicated scheduledPosts array
  const existing = (backup as any).scheduledPosts || []
  ;(backup as any).scheduledPosts = [...existing, ...newPosts]
  saveBackupData(backup)

  console.log(`[SocialScheduler] Scheduled ${newPosts.length} posts`)
  return newPosts
}

/**
 * Get all scheduled posts, optionally filtered by status.
 */
export function getScheduledPosts(status?: ScheduledPost['status']): ScheduledPost[] {
  const backup = getBackupData()
  if (!backup) return []

  const posts: ScheduledPost[] = (backup as any).scheduledPosts || []

  if (status) return posts.filter(p => p.status === status)
  return posts.sort((a, b) => new Date(b.scheduledDate).getTime() - new Date(a.scheduledDate).getTime())
}

/**
 * Update a post's status (e.g., after MiroFish approval).
 */
export function updatePostStatus(
  postId: string,
  status: ScheduledPost['status'],
  approvedBy?: string
): ScheduledPost | null {
  const backup = getBackupData()
  if (!backup) return null

  const posts: ScheduledPost[] = (backup as any).scheduledPosts || []
  const idx = posts.findIndex(p => p.id === postId)
  if (idx === -1) return null

  posts[idx] = {
    ...posts[idx],
    status,
    ...(approvedBy ? { approvedBy } : {}),
    ...(status === 'published' ? { publishedAt: new Date().toISOString() } : {}),
  }

  ;(backup as any).scheduledPosts = posts
  saveBackupData(backup)

  return posts[idx]
}
