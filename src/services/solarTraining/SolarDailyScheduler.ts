/**
 * src/services/solarTraining/SolarDailyScheduler.ts
 * Solar Daily Scheduler — Feature SOL5
 *
 * Manages the daily solar training schedule:
 * - Morning brief scheduling (3-5 minutes)
 * - Micro-quiz periodic scheduling (30-second popups)
 * - End-of-day review scheduling (5-10 minutes)
 * - Streak tracking queries
 * - Daily progress aggregation
 * - Training due/overdue detection
 */

import { fetchFromSupabase, syncToSupabase } from '../supabaseService';
import type { SolarTrainingSession, SolarTrainingStreak } from './SolarNexusIntegration';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface DailyScheduleConfig {
  morningBriefTime?: string; // HH:MM format, default "07:00"
  microQuizInterval?: number; // minutes, default 120 (every 2 hours)
  eodReviewTime?: string; // HH:MM format, default "17:00"
  enabled: boolean;
}

export interface ScheduledEvent {
  id: string;
  userId: string;
  eventType: 'morning_brief' | 'micro_quiz' | 'eod_review';
  scheduledTime: string; // ISO timestamp
  triggeredAt?: string;
  completed: boolean;
  completedAt?: string;
}

export interface DailyProgress {
  date: string;
  userId: string;
  sessionCount: number;
  quizCount: number;
  quizAverageScore: number;
  conversationCount: number;
  totalMinutes: number;
  briefShown: boolean;
  eodReviewCompleted: boolean;
}

// ── Storage Keys ────────────────────────────────────────────────────────────

const SCHEDULE_CONFIG_KEY = 'poweron_solar_schedule_config';
const DAILY_PROGRESS_KEY = 'poweron_solar_daily_progress';

// ── Default Configuration ──────────────────────────────────────────────────

const DEFAULT_CONFIG: DailyScheduleConfig = {
  morningBriefTime: '07:00',
  microQuizInterval: 120,
  eodReviewTime: '17:00',
  enabled: true,
};

// ── Schedule Management ────────────────────────────────────────────────────

/**
 * Get the current schedule configuration for a user.
 */
export function getScheduleConfig(userId: string): DailyScheduleConfig {
  try {
    const stored = localStorage.getItem(`${SCHEDULE_CONFIG_KEY}_${userId}`);
    if (stored) {
      return { ...DEFAULT_CONFIG, ...JSON.parse(stored) };
    }
  } catch {
    // Fall through to defaults
  }
  return DEFAULT_CONFIG;
}

/**
 * Update schedule configuration for a user.
 */
export function saveScheduleConfig(userId: string, config: Partial<DailyScheduleConfig>): void {
  try {
    const current = getScheduleConfig(userId);
    const updated = { ...current, ...config };
    localStorage.setItem(`${SCHEDULE_CONFIG_KEY}_${userId}`, JSON.stringify(updated));
  } catch (err) {
    console.warn('[SolarDailyScheduler] config save error:', err);
  }
}

// ── Morning Brief Scheduling ───────────────────────────────────────────────

/**
 * Schedule the morning brief for a user.
 * Should be called daily to set up the morning message.
 */
export async function scheduleMorningBrief(userId: string): Promise<ScheduledEvent | null> {
  try {
    const config = getScheduleConfig(userId);
    if (!config.enabled) return null;

    const now = new Date();
    const briefTime = config.morningBriefTime || '07:00';
    const [hours, minutes] = briefTime.split(':').map(Number);

    const scheduledTime = new Date();
    scheduledTime.setHours(hours, minutes, 0, 0);

    // If already past that time today, schedule for tomorrow
    if (scheduledTime <= now) {
      scheduledTime.setDate(scheduledTime.getDate() + 1);
    }

    const event: ScheduledEvent = {
      id: `brief_${Date.now()}`,
      userId,
      eventType: 'morning_brief',
      scheduledTime: scheduledTime.toISOString(),
      completed: false,
    };

    await syncToSupabase({
      table: 'solar_scheduled_events',
      data: {
        user_id: userId,
        event_type: 'morning_brief',
        scheduled_time: event.scheduledTime,
        completed: false,
      },
      operation: 'insert',
    });

    return event;
  } catch (err) {
    console.warn('[SolarDailyScheduler] morning brief schedule error:', err);
    return null;
  }
}

/**
 * Mark morning brief as shown.
 */
export async function markMorningBriefTriggered(userId: string): Promise<void> {
  try {
    const today = new Date().toISOString().split('T')[0];
    localStorage.setItem(`poweron_solar_morning_brief_shown_${today}`, userId);

    // Record in Supabase if morning brief already scheduled
    const events = await fetchFromSupabase<ScheduledEvent>(
      'solar_scheduled_events',
      { user_id: userId, event_type: 'morning_brief' }
    );

    const todayEvent = events.find(e => e.scheduledTime.startsWith(today));
    if (todayEvent) {
      await syncToSupabase({
        table: 'solar_scheduled_events',
        data: {
          id: todayEvent.id,
          triggered_at: new Date().toISOString(),
          completed: true,
          completed_at: new Date().toISOString(),
        },
        operation: 'update',
        matchColumn: 'id',
      });
    }
  } catch (err) {
    console.warn('[SolarDailyScheduler] morning brief trigger error:', err);
  }
}

// ── Micro Quiz Scheduling ──────────────────────────────────────────────────

/**
 * Schedule periodic micro-quiz prompts throughout the day.
 * Creates events at specified intervals.
 */
export async function scheduleMicroQuiz(userId: string, intervalMinutes: number = 120): Promise<ScheduledEvent[]> {
  try {
    const config = getScheduleConfig(userId);
    if (!config.enabled) return [];

    const events: ScheduledEvent[] = [];
    const now = new Date();

    // Schedule 4 quizzes throughout a typical work day (8 AM - 6 PM)
    const quizCount = 4;
    for (let i = 1; i <= quizCount; i++) {
      const scheduledTime = new Date(now);
      scheduledTime.setHours(8 + i * 2, 0, 0, 0); // 10 AM, 12 PM, 2 PM, 4 PM

      if (scheduledTime > now) {
        const event: ScheduledEvent = {
          id: `quiz_${i}_${Date.now()}`,
          userId,
          eventType: 'micro_quiz',
          scheduledTime: scheduledTime.toISOString(),
          completed: false,
        };

        await syncToSupabase({
          table: 'solar_scheduled_events',
          data: {
            user_id: userId,
            event_type: 'micro_quiz',
            scheduled_time: event.scheduledTime,
            completed: false,
          },
          operation: 'insert',
        });

        events.push(event);
      }
    }

    return events;
  } catch (err) {
    console.warn('[SolarDailyScheduler] micro quiz schedule error:', err);
    return [];
  }
}

/**
 * Record a micro-quiz completion.
 */
export async function recordMicroQuizCompletion(userId: string, quizId: string): Promise<void> {
  try {
    await syncToSupabase({
      table: 'solar_scheduled_events',
      data: {
        id: quizId,
        completed: true,
        completed_at: new Date().toISOString(),
      },
      operation: 'update',
      matchColumn: 'id',
    });
  } catch (err) {
    console.warn('[SolarDailyScheduler] quiz completion record error:', err);
  }
}

// ── End-of-Day Review Scheduling ───────────────────────────────────────────

/**
 * Schedule the end-of-day review for a user.
 */
export async function scheduleEODReview(userId: string, time?: string): Promise<ScheduledEvent | null> {
  try {
    const config = getScheduleConfig(userId);
    if (!config.enabled) return null;

    const now = new Date();
    const reviewTime = time || config.eodReviewTime || '17:00';
    const [hours, minutes] = reviewTime.split(':').map(Number);

    const scheduledTime = new Date();
    scheduledTime.setHours(hours, minutes, 0, 0);

    // If already past that time today, schedule for tomorrow
    if (scheduledTime <= now) {
      scheduledTime.setDate(scheduledTime.getDate() + 1);
    }

    const event: ScheduledEvent = {
      id: `eod_${Date.now()}`,
      userId,
      eventType: 'eod_review',
      scheduledTime: scheduledTime.toISOString(),
      completed: false,
    };

    await syncToSupabase({
      table: 'solar_scheduled_events',
      data: {
        user_id: userId,
        event_type: 'eod_review',
        scheduled_time: event.scheduledTime,
        completed: false,
      },
      operation: 'insert',
    });

    return event;
  } catch (err) {
    console.warn('[SolarDailyScheduler] EOD review schedule error:', err);
    return null;
  }
}

/**
 * Mark EOD review as completed.
 */
export async function markEODReviewCompleted(userId: string): Promise<void> {
  try {
    const today = new Date().toISOString().split('T')[0];
    localStorage.setItem(`poweron_solar_eod_review_done_${today}`, userId);
  } catch (err) {
    console.warn('[SolarDailyScheduler] EOD review mark error:', err);
  }
}

// ── Streak & Progress Queries ──────────────────────────────────────────────

/**
 * Get the current consecutive training days streak.
 */
export async function getStreakCount(userId: string): Promise<number> {
  try {
    const records = await fetchFromSupabase<any>(
      'solar_training_streaks',
      { user_id: userId }
    );

    if (records.length > 0) {
      return records[0].current_streak ?? 0;
    }
    return 0;
  } catch (err) {
    console.warn('[SolarDailyScheduler] streak fetch error:', err);
    return 0;
  }
}

/**
 * Get today's training progress summary.
 */
export async function getDailyProgress(userId: string): Promise<DailyProgress> {
  try {
    const today = new Date().toISOString().split('T')[0];

    // Fetch today's sessions
    const sessions = await fetchFromSupabase<SolarTrainingSession>(
      'solar_training_sessions',
      { user_id: userId }
    );
    const todaySessions = sessions.filter(s => s.date === today);

    // Calculate metrics
    const quizSessions = todaySessions.filter(s => s.sessionType === 'micro_quiz');
    const conversationSessions = todaySessions.filter(s => s.sessionType === 'real_conversation');
    const quizScores = quizSessions
      .filter(s => s.score !== undefined)
      .map(s => s.score!);
    const averageScore = quizScores.length > 0
      ? quizScores.reduce((a, b) => a + b, 0) / quizScores.length
      : 0;

    const totalMinutes = todaySessions.reduce((sum, s) => sum + (s.duration / 60), 0);

    // Check if brief/review shown
    const briefKey = `poweron_solar_morning_brief_shown_${today}`;
    const eodKey = `poweron_solar_eod_review_done_${today}`;
    const briefShown = !!localStorage.getItem(briefKey);
    const eodReviewCompleted = !!localStorage.getItem(eodKey);

    return {
      date: today,
      userId,
      sessionCount: todaySessions.length,
      quizCount: quizSessions.length,
      quizAverageScore: averageScore,
      conversationCount: conversationSessions.length,
      totalMinutes,
      briefShown,
      eodReviewCompleted,
    };
  } catch (err) {
    console.warn('[SolarDailyScheduler] daily progress fetch error:', err);
    return {
      date: new Date().toISOString().split('T')[0],
      userId,
      sessionCount: 0,
      quizCount: 0,
      quizAverageScore: 0,
      conversationCount: 0,
      totalMinutes: 0,
      briefShown: false,
      eodReviewCompleted: false,
    };
  }
}

// ── Training Due Detection ─────────────────────────────────────────────────

/**
 * Check if any training is overdue (not completed in N hours).
 * Returns the status and next due time.
 */
export async function isTrainingDue(userId: string, thresholdHours: number = 48): Promise<boolean> {
  try {
    const sessions = await fetchFromSupabase<SolarTrainingSession>(
      'solar_training_sessions',
      { user_id: userId }
    );

    if (sessions.length === 0) {
      return true; // No training ever recorded — it's due
    }

    const lastSession = sessions.sort(
      (a, b) => new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime()
    )[0];

    const hoursSinceLastSession = (Date.now() - new Date(lastSession.completedAt).getTime()) / (1000 * 60 * 60);
    return hoursSinceLastSession >= thresholdHours;
  } catch (err) {
    console.warn('[SolarDailyScheduler] training due check error:', err);
    return false;
  }
}

/**
 * Get the next expected training session based on schedule.
 */
export async function getNextTrainingSession(userId: string): Promise<Date | null> {
  try {
    const config = getScheduleConfig(userId);
    if (!config.enabled) return null;

    const now = new Date();

    // Check morning brief
    const briefTime = config.morningBriefTime || '07:00';
    const [briefHours, briefMinutes] = briefTime.split(':').map(Number);
    const morningBrief = new Date();
    morningBrief.setHours(briefHours, briefMinutes, 0, 0);
    if (morningBrief <= now) {
      morningBrief.setDate(morningBrief.getDate() + 1);
    }

    // Check next micro quiz (in 2 hours)
    const nextQuiz = new Date(now);
    nextQuiz.setHours(now.getHours() + 2, 0, 0, 0);

    // Check EOD review
    const eodTime = config.eodReviewTime || '17:00';
    const [eodHours, eodMinutes] = eodTime.split(':').map(Number);
    const eodReview = new Date();
    eodReview.setHours(eodHours, eodMinutes, 0, 0);
    if (eodReview <= now) {
      eodReview.setDate(eodReview.getDate() + 1);
    }

    // Return the soonest
    return [morningBrief, nextQuiz, eodReview].sort((a, b) => a.getTime() - b.getTime())[0];
  } catch (err) {
    console.warn('[SolarDailyScheduler] next training session error:', err);
    return null;
  }
}

/**
 * Get all pending scheduled events for today.
 */
export async function getTodaysPendingEvents(userId: string): Promise<ScheduledEvent[]> {
  try {
    const today = new Date().toISOString().split('T')[0];
    const allEvents = await fetchFromSupabase<ScheduledEvent>(
      'solar_scheduled_events',
      { user_id: userId }
    );

    return allEvents.filter(
      e => e.scheduledTime.startsWith(today) && !e.completed
    );
  } catch (err) {
    console.warn('[SolarDailyScheduler] pending events fetch error:', err);
    return [];
  }
}

/**
 * Initialize daily schedule for a user (should be called once per app load).
 */
export async function initializeDailySchedule(userId: string): Promise<void> {
  try {
    const config = getScheduleConfig(userId);
    if (!config.enabled) return;

    // Check if already scheduled for today
    const today = new Date().toISOString().split('T')[0];
    const existingEvents = await getTodaysPendingEvents(userId);

    // Schedule if missing
    if (!existingEvents.some(e => e.eventType === 'morning_brief')) {
      await scheduleMorningBrief(userId);
    }

    if (!existingEvents.some(e => e.eventType === 'micro_quiz')) {
      await scheduleMicroQuiz(userId);
    }

    if (!existingEvents.some(e => e.eventType === 'eod_review')) {
      await scheduleEODReview(userId);
    }
  } catch (err) {
    console.warn('[SolarDailyScheduler] initialization error:', err);
  }
}

/**
 * Format a time duration in human-readable form.
 */
export function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;

  if (hours > 0 && mins > 0) {
    return `${hours}h ${mins}m`;
  } else if (hours > 0) {
    return `${hours}h`;
  } else {
    return `${mins}m`;
  }
}
