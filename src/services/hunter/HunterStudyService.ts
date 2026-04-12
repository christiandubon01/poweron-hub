/**
 * src/services/hunter/HunterStudyService.ts
 * HUNTER Study Queue Service — HT9
 *
 * Manages deferred study topics from debriefs.
 * Allows grouping of topics into bundled study sessions for NEXUS-guided review.
 *
 * PUBLIC API:
 *   fetchStudyQueue(userId)              → Promise<StudyTopic[]>
 *   deferLesson(debriefId, topic, priority) → Promise<StudyTopic>
 *   completeStudyTopic(topicId)          → Promise<void>
 *   bundleStudySession(topicIds)         → Promise<StudyBundle>
 *   getStudyStats(userId)                → Promise<StudyStats>
 *   getPendingCount(userId)              → Promise<number>
 *   getStudyTopicWithContext(topicId)    → Promise<StudyTopicDetail>
 *
 * Supabase tables:
 *   hunter_study_queue      — deferred study topics
 *   hunter_debriefs         — original debrief context
 *   hunter_leads            — source lead info
 */

import { supabase } from '@/lib/supabase';
import { StudyTopic, StudyQueueStatus, HunterDebrief, HunterLead } from './HunterTypes';

// ─── Types ─────────────────────────────────────────────────────────────────────

export enum StudyPriority {
  HIGH = 'high',
  MEDIUM = 'medium',
  LOW = 'low',
}

export interface StudyTopicDetail extends StudyTopic {
  debrief?: HunterDebrief;
  lead?: HunterLead;
  priority?: StudyPriority;
  fullContext?: string;
}

export interface StudyBundle {
  id: string;
  topicIds: string[];
  createdAt: string;
  topicCount: number;
  estimatedDuration: number; // minutes
  status: 'pending_review' | 'in_progress' | 'completed';
}

export interface StudyStats {
  pendingCount: number;
  completedThisWeek: number;
  totalCompleted: number;
  currentStreak: number; // consecutive days with study activity
  lastReviewedAt?: string;
}

// ─── Service ───────────────────────────────────────────────────────────────────

/**
 * Fetch all study topics for a user, optionally filtered by status
 */
export async function fetchStudyQueue(
  userId: string,
  status?: StudyQueueStatus
): Promise<StudyTopic[]> {
  try {
    let query: any = (supabase
      .from('hunter_study_queue') as any)
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (status) {
      query = query.eq('status', status);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Failed to fetch study queue:', error);
      return [];
    }

    return (data as StudyTopic[]) || [];
  } catch (err) {
    console.error('Error in fetchStudyQueue:', err);
    return [];
  }
}

/**
 * Add a lesson to the study queue (deferred from a debrief)
 */
export async function deferLesson(
  userId: string,
  debriefId: string,
  topic: string,
  priority: StudyPriority = StudyPriority.MEDIUM
): Promise<StudyTopic | null> {
  try {
    const { data, error } = await (supabase
      .from('hunter_study_queue') as any)
      .insert([
        {
          user_id: userId,
          debrief_id: debriefId,
          topic,
          priority,
          status: StudyQueueStatus.PENDING,
          created_at: new Date().toISOString(),
        },
      ])
      .select()
      .single();

    if (error) {
      console.error('Failed to defer lesson:', error);
      return null;
    }

    return data as StudyTopic;
  } catch (err) {
    console.error('Error in deferLesson:', err);
    return null;
  }
}

/**
 * Mark a study topic as completed
 */
export async function completeStudyTopic(topicId: string): Promise<void> {
  try {
    const { error } = await (supabase
      .from('hunter_study_queue') as any)
      .update({
        status: StudyQueueStatus.COMPLETED,
        completed_at: new Date().toISOString(),
      })
      .eq('id', topicId);

    if (error) {
      console.error('Failed to complete study topic:', error);
    }
  } catch (err) {
    console.error('Error in completeStudyTopic:', err);
  }
}

/**
 * Create a bundled study session from multiple topics
 * Recommended bundle size: 3-5 topics
 */
export async function bundleStudySession(topicIds: string[]): Promise<StudyBundle> {
  const bundle: StudyBundle = {
    id: `bundle_${Date.now()}`,
    topicIds,
    createdAt: new Date().toISOString(),
    topicCount: topicIds.length,
    estimatedDuration: topicIds.length * 5, // 5 minutes per topic
    status: 'pending_review',
  };

  // In a real implementation, this could be persisted to a study_bundles table
  // For now, return the bundle structure for UI composition
  return bundle;
}

/**
 * Get study statistics for a user
 */
export async function getStudyStats(userId: string): Promise<StudyStats> {
  try {
    // Fetch all study topics
    const { data: allTopics, error: allError } = await (supabase
      .from('hunter_study_queue') as any)
      .select('*')
      .eq('user_id', userId);

    if (allError) {
      console.error('Failed to fetch study stats:', allError);
      return {
        pendingCount: 0,
        completedThisWeek: 0,
        totalCompleted: 0,
        currentStreak: 0,
      };
    }

    const topics = (allTopics || []) as StudyTopic[];

    // Calculate pending count
    const pendingCount = topics.filter(
      (t) => t.status === StudyQueueStatus.PENDING
    ).length;

    // Calculate completed this week
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    const completedThisWeek = topics.filter((t) => {
      if (t.status !== StudyQueueStatus.COMPLETED || !t.completed_at) return false;
      return new Date(t.completed_at) >= weekAgo;
    }).length;

    // Total completed
    const totalCompleted = topics.filter(
      (t) => t.status === StudyQueueStatus.COMPLETED
    ).length;

    // Calculate streak (simplified: days with at least one completion)
    const completedDates = new Set<string>();
    topics.forEach((t) => {
      if (t.status === StudyQueueStatus.COMPLETED && t.completed_at) {
        const date = new Date(t.completed_at).toISOString().split('T')[0];
        completedDates.add(date);
      }
    });

    let currentStreak = 0;
    let checkDate = new Date();
    while (true) {
      const dateStr = checkDate.toISOString().split('T')[0];
      if (completedDates.has(dateStr)) {
        currentStreak++;
      } else if (currentStreak > 0) {
        break; // Streak broken
      }
      checkDate.setDate(checkDate.getDate() - 1);
    }

    const lastReviewedAt = topics
      .filter((t) => t.completed_at)
      .sort((a, b) =>
        new Date(b.completed_at || 0).getTime() -
        new Date(a.completed_at || 0).getTime()
      )[0]?.completed_at;

    return {
      pendingCount,
      completedThisWeek,
      totalCompleted,
      currentStreak,
      lastReviewedAt,
    };
  } catch (err) {
    console.error('Error in getStudyStats:', err);
    return {
      pendingCount: 0,
      completedThisWeek: 0,
      totalCompleted: 0,
      currentStreak: 0,
    };
  }
}

/**
 * Get count of pending study topics for a user
 * Used for counter badge on HUNTER panel
 */
export async function getPendingCount(userId: string): Promise<number> {
  try {
    const { count, error } = await (supabase
      .from('hunter_study_queue') as any)
      .select('*', { count: 'exact' })
      .eq('user_id', userId)
      .eq('status', StudyQueueStatus.PENDING);

    if (error) {
      console.error('Failed to get pending count:', error);
      return 0;
    }

    return count || 0;
  } catch (err) {
    console.error('Error in getPendingCount:', err);
    return 0;
  }
}

/**
 * Get detailed study topic with full context
 * Includes debrief and lead information
 */
export async function getStudyTopicWithContext(
  topicId: string
): Promise<StudyTopicDetail | null> {
  try {
    // Fetch study topic
    const { data: topicData, error: topicError } = await (supabase
      .from('hunter_study_queue') as any)
      .select('*')
      .eq('id', topicId)
      .single();

    if (topicError || !topicData) {
      console.error('Failed to fetch study topic:', topicError);
      return null;
    }

    const topic = topicData as StudyTopic;

    // Fetch related debrief
    let debrief: HunterDebrief | undefined;
    if (topic.debrief_id) {
      const { data: debriefData, error: debriefError } = await (supabase
        .from('hunter_debriefs') as any)
        .select('*')
        .eq('id', topic.debrief_id)
        .single();

      if (!debriefError && debriefData) {
        debrief = debriefData as HunterDebrief;
      }
    }

    // Fetch related lead
    let lead: HunterLead | undefined;
    if (debrief?.lead_id) {
      const { data: leadData, error: leadError } = await (supabase
        .from('hunter_leads') as any)
        .select('*')
        .eq('id', debrief.lead_id)
        .single();

      if (!leadError && leadData) {
        lead = leadData as HunterLead;
      }
    }

    // Build full context text
    const fullContext = buildStudyContext(topic, debrief, lead);

    return {
      ...topic,
      debrief,
      lead,
      fullContext,
    } as StudyTopicDetail;
  } catch (err) {
    console.error('Error in getStudyTopicWithContext:', err);
    return null;
  }
}

/**
 * Helper: Build full context text for a study topic
 */
function buildStudyContext(
  topic: StudyTopic,
  debrief?: HunterDebrief,
  lead?: HunterLead
): string {
  const parts: string[] = [];

  if (lead?.contact_name || lead?.company_name) {
    parts.push(
      `Lead: ${lead.contact_name || 'Unknown'}${lead.company_name ? ` (${lead.company_name})` : ''}`
    );
  }

  if (topic.topic) {
    parts.push(`Topic: ${topic.topic}`);
  }

  if (debrief?.transcript) {
    parts.push(`Transcript: ${debrief.transcript}`);
  }

  if (debrief?.outcome) {
    parts.push(`Outcome: ${debrief.outcome}`);
  }

  return parts.join('\n\n');
}

/**
 * Get study topics sorted and filtered
 */
export async function getStudyTopicsFiltered(
  userId: string,
  filters: {
    status?: StudyQueueStatus;
    priority?: StudyPriority;
    sortBy?: 'priority' | 'date' | 'source';
  } = {}
): Promise<StudyTopicDetail[]> {
  try {
    let query: any = (supabase
      .from('hunter_study_queue') as any)
      .select(
        `
        *,
        hunter_debriefs (*),
        hunter_leads (*)
      `
      )
      .eq('user_id', userId);

    if (filters.status) {
      query = query.eq('status', filters.status);
    }

    if (filters.priority) {
      query = query.eq('priority', filters.priority);
    }

    // Apply sorting
    const sortColumn = filters.sortBy === 'priority' ? 'priority' : 'created_at';
    const ascending = filters.sortBy === 'date';
    query = query.order(sortColumn, { ascending });

    const { data, error } = await query;

    if (error) {
      console.error('Failed to fetch filtered study topics:', error);
      return [];
    }

    return ((data as any[]) || []).map((row) => ({
      ...row,
      fullContext: row.hunter_debriefs?.[0]?.transcript || '',
    })) as StudyTopicDetail[];
  } catch (err) {
    console.error('Error in getStudyTopicsFiltered:', err);
    return [];
  }
}
