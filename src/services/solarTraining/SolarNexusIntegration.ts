/**
 * src/services/solarTraining/SolarNexusIntegration.ts
 * Solar Training NEXUS Integration — Feature SOL5
 *
 * Integrates solar training into the NEXUS daily rhythm:
 * - Morning brief additions: cert progress, study queue, training streak, daily quiz
 * - End-of-day review: compile activity, generate review via Claude, deliver via TTS/text
 * - Daily structure enforcement: 3-5 min brief, micro-quizzes, 5-10 min EOD review
 * - Streak tracking: consecutive training days with milestone celebrations
 */

import { callClaude, extractText } from '../claudeProxy';
import { syncToSupabase, fetchFromSupabase } from '../supabaseService';
import type { NexusResponse, DisplayComponent, CaptureItem } from '@/agents/nexusPromptEngine';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SolarCertification {
  id: string;
  name: string;
  progress: number; // 0-100
  status: 'in_progress' | 'completed' | 'not_started';
  startedAt?: string;
  completedAt?: string;
}

export interface SolarStudyDomain {
  id: string;
  domain: string; // e.g., "NABCEP", "Enphase", "SMA"
  status: 'not_started' | 'incomplete' | 'complete';
  lessonsCompleted: number;
  lessonsTotal: number;
  nextTopic?: string;
}

export interface SolarTrainingSession {
  id: string;
  date: string;
  userId: string;
  sessionType: 'micro_quiz' | 'full_study' | 'real_conversation' | 'eod_review';
  duration: number; // seconds
  content: string;
  score?: number; // 0-100
  completedAt: string;
}

export interface SolarDebrief {
  id: string;
  date: string;
  userId: string;
  topic: string;
  conversation: string;
  ruleExtracted?: string;
  ruleConfirmed: boolean;
  confirmedAt?: string;
}

export interface SolarTrainingStreak {
  userId: string;
  currentStreak: number;
  lastTrainingDate: string;
  longestStreak: number;
  milestoneSeven: boolean;
  milestoneFourteen: boolean;
  milestoneThirty: boolean;
  updatedAt: string;
}

export interface MorningBriefAdditions {
  certProgress?: string;
  studyPending?: string;
  trainingDueWarning?: string;
  unconfirmedDebrief?: string;
  dailyQuizQuestion?: string;
  streakMessage?: string;
}

export interface EODReviewContent {
  sessionsSummary: SolarTrainingSession[];
  quizScores: { topic: string; score: number }[];
  realConversations: SolarDebrief[];
  reviewText: string; // Claude-generated review
  voiceReady: boolean; // True if ready for TTS
}

// ── Local Storage Keys ────────────────────────────────────────────────────────

const SOLAR_STREAK_KEY = 'poweron_solar_training_streak';
const SOLAR_LAST_BRIEF_KEY = 'poweron_solar_last_brief_shown';
const SOLAR_EOD_TRIGGERED_KEY = 'poweron_solar_eod_triggered_today';

// ── Morning Brief Integration ────────────────────────────────────────────────

/**
 * Generates NEXUS morning brief solar additions.
 * Called by NEXUS engine to append solar content to the daily brief.
 *
 * Returns additions that should be injected into the morning brief context.
 */
export async function generateMorningBriefAdditions(userId: string): Promise<MorningBriefAdditions> {
  try {
    const additions: MorningBriefAdditions = {};

    // 1. Check for in-progress certifications
    const certs = await fetchFromSupabase<SolarCertification>(
      'solar_certifications',
      { user_id: userId }
    );
    const inProgressCerts = certs.filter(c => c.status === 'in_progress');
    if (inProgressCerts.length > 0) {
      const certList = inProgressCerts
        .map(c => `${c.name} at ${c.progress}%`)
        .join(', ');
      additions.certProgress = `Solar cert in progress: ${certList}. Continue at Enphase University.`;
    }

    // 2. Check study queue for incomplete domains
    const domains = await fetchFromSupabase<SolarStudyDomain>(
      'solar_study_queue',
      { user_id: userId }
    );
    const incompleteDomains = domains.filter(d => d.status === 'incomplete');
    if (incompleteDomains.length > 0) {
      const domain = incompleteDomains[0];
      additions.studyPending = `NABCEP study pending: ${domain.domain}. 15 minutes today.`;
    }

    // 3. Check if no training in 48 hours
    const sessions = await fetchFromSupabase<SolarTrainingSession>(
      'solar_training_sessions',
      { user_id: userId }
    );
    const lastSession = sessions.sort(
      (a, b) => new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime()
    )[0];

    if (lastSession) {
      const hoursSinceLastSession = (Date.now() - new Date(lastSession.completedAt).getTime()) / (1000 * 60 * 60);
      if (hoursSinceLastSession > 48) {
        additions.trainingDueWarning = `No solar training in 48 hours. Run your daily rep — 3 minutes.`;
      }
    } else {
      additions.trainingDueWarning = `Get started with solar training — 3 minutes today.`;
    }

    // 4. Check for unconfirmed debrief rules
    const debriefs = await fetchFromSupabase<SolarDebrief>(
      'solar_debriefs',
      { user_id: userId }
    );
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];

    const unconfirmedFromYesterday = debriefs.filter(
      d => d.date === yesterdayStr && !d.ruleConfirmed
    );
    if (unconfirmedFromYesterday.length > 0) {
      const topic = unconfirmedFromYesterday[0].topic;
      additions.unconfirmedDebrief = `Yesterday's solar debrief has an unconfirmed rule about "${topic}". Review it.`;
    }

    // 5. Daily quiz question from spaced repetition queue
    const quizQuestion = await generateDailyQuizQuestion();
    if (quizQuestion) {
      additions.dailyQuizQuestion = `Daily solar question: ${quizQuestion}`;
    }

    // 6. Streak message
    const streak = await getStreakCount(userId);
    if (streak > 0) {
      additions.streakMessage = `☀️ Solar training streak: ${streak} days!`;
      if (streak % 7 === 0) {
        additions.streakMessage += ` 🎉 ${streak}-day milestone achieved!`;
      }
    }

    return additions;
  } catch (err) {
    console.warn('[SolarNexusIntegration] morning brief error:', err);
    return {};
  }
}

/**
 * Injects solar morning brief into NEXUS context string.
 * Formats additions as part of the morning briefing context.
 */
export async function formatMorningBriefContext(userId: string): Promise<string> {
  const additions = await generateMorningBriefAdditions(userId);

  if (Object.keys(additions).length === 0) {
    return '';
  }

  const lines: string[] = ['═══ SOLAR TRAINING BRIEF ═══'];

  if (additions.certProgress) lines.push(`• ${additions.certProgress}`);
  if (additions.studyPending) lines.push(`• ${additions.studyPending}`);
  if (additions.trainingDueWarning) lines.push(`• ${additions.trainingDueWarning}`);
  if (additions.unconfirmedDebrief) lines.push(`• ${additions.unconfirmedDebrief}`);
  if (additions.dailyQuizQuestion) lines.push(`• ${additions.dailyQuizQuestion}`);
  if (additions.streakMessage) lines.push(`• ${additions.streakMessage}`);

  return lines.join('\n');
}

// ── End-of-Day Review ──────────────────────────────────────────────────────

/**
 * Triggers end-of-day review (called by "NEXUS, let's review solar" or button).
 * Compiles today's solar activity and generates review via Claude.
 */
export async function generateEndOfDayReview(userId: string): Promise<EODReviewContent | null> {
  try {
    const today = new Date().toISOString().split('T')[0];

    // 1. Fetch today's training sessions
    const sessions = await fetchFromSupabase<SolarTrainingSession>(
      'solar_training_sessions',
      { user_id: userId }
    );
    const todaySessions = sessions.filter(s => s.date === today);

    // 2. Extract quiz scores
    const quizScores = todaySessions
      .filter(s => s.sessionType === 'micro_quiz' && s.score !== undefined)
      .map(s => ({ topic: s.content, score: s.score! }));

    // 3. Fetch real conversations (debriefs) from today
    const debriefs = await fetchFromSupabase<SolarDebrief>(
      'solar_debriefs',
      { user_id: userId }
    );
    const todayDebriefs = debriefs.filter(d => d.date === today);

    // 4. Build session summary
    const sessionsSummary = todaySessions;

    // 5. Generate review via Claude
    const reviewPrompt = `Review Christian's solar training day. 
Sessions completed: ${todaySessions.length} (types: ${[...new Set(todaySessions.map(s => s.sessionType))].join(', ')}).
Quiz scores: ${quizScores.length > 0 ? quizScores.map(q => `${q.topic}: ${q.score}%`).join(', ') : 'none'}.
Real solar conversations today: ${todayDebriefs.length > 0 ? todayDebriefs.map(d => d.topic).join(', ') : 'none'}.

Provide: 
(1) What went well today. 
(2) What needs more work. 
(3) Tomorrow's priority.
(4) One specific thing to practice speaking out loud tomorrow.

Keep it under 2 minutes of TTS reading time (roughly 200-250 words).`;

    const reviewText = await callClaude({
      system: 'You are a solar training coach. Provide encouraging, specific feedback on daily training progress.',
      messages: [{ role: 'user', content: reviewPrompt }],
      max_tokens: 300,
    })
      .then(extractText)
      .catch(() => 'Unable to generate review at this time.');

    // Record the EOD review session
    await syncToSupabase({
      table: 'solar_training_sessions',
      data: {
        user_id: userId,
        date: today,
        session_type: 'eod_review',
        duration: 300, // 5 minutes default
        content: reviewText,
        completed_at: new Date().toISOString(),
      },
      operation: 'insert',
    });

    // Update streak
    await updateStreak(userId);

    return {
      sessionsSummary,
      quizScores,
      realConversations: todayDebriefs,
      reviewText,
      voiceReady: true,
    };
  } catch (err) {
    console.warn('[SolarNexusIntegration] EOD review error:', err);
    return null;
  }
}

/**
 * Formats EOD review for delivery via TTS or text.
 * Returns display components for NEXUS response.
 */
export function formatEODReviewForDisplay(content: EODReviewContent): DisplayComponent[] {
  return [
    {
      type: 'alert',
      title: '☀️ Your Solar Training Day Review',
      severity: 'info',
      data: {
        sessionsCompleted: content.sessionsSummary.length,
        quizzesCompleted: content.quizScores.length,
        avgScore: content.quizScores.length > 0
          ? Math.round(content.quizScores.reduce((s, q) => s + q.score, 0) / content.quizScores.length)
          : undefined,
      },
    },
    {
      type: 'action_item',
      title: 'Review Details',
      label: content.reviewText,
    },
  ];
}

// ── Streak Tracking ────────────────────────────────────────────────────────

/**
 * Updates the user's training streak.
 * Called after each training session and after EOD review.
 */
export async function updateStreak(userId: string): Promise<SolarTrainingStreak> {
  try {
    const today = new Date().toISOString().split('T')[0];
    const streak = await getStreakRecord(userId);

    const newStreak: SolarTrainingStreak = {
      userId,
      currentStreak: streak.lastTrainingDate === today ? streak.currentStreak : (streak.lastTrainingDate === getYesterdayStr() ? streak.currentStreak + 1 : 1),
      lastTrainingDate: today,
      longestStreak: Math.max(streak.longestStreak, streak.currentStreak + 1),
      milestoneSeven: (streak.currentStreak + 1) >= 7 || streak.milestoneSeven,
      milestoneFourteen: (streak.currentStreak + 1) >= 14 || streak.milestoneFourteen,
      milestoneThirty: (streak.currentStreak + 1) >= 30 || streak.milestoneThirty,
      updatedAt: new Date().toISOString(),
    };

    await syncToSupabase({
      table: 'solar_training_streaks',
      data: {
        user_id: userId,
        current_streak: newStreak.currentStreak,
        last_training_date: newStreak.lastTrainingDate,
        longest_streak: newStreak.longestStreak,
        milestone_seven: newStreak.milestoneSeven,
        milestone_fourteen: newStreak.milestoneFourteen,
        milestone_thirty: newStreak.milestoneThirty,
        updated_at: newStreak.updatedAt,
      },
      operation: 'upsert',
      matchColumn: 'user_id',
    });

    return newStreak;
  } catch (err) {
    console.warn('[SolarNexusIntegration] streak update error:', err);
    return { userId, currentStreak: 0, lastTrainingDate: '', longestStreak: 0, milestoneSeven: false, milestoneFourteen: false, milestoneThirty: false, updatedAt: '' };
  }
}

/**
 * Get current streak count for a user.
 */
export async function getStreakCount(userId: string): Promise<number> {
  const streak = await getStreakRecord(userId);
  return streak.currentStreak;
}

/**
 * Fetch streak record or return defaults.
 */
async function getStreakRecord(userId: string): Promise<SolarTrainingStreak> {
  const records = await fetchFromSupabase<any>(
    'solar_training_streaks',
    { user_id: userId }
  );

  if (records.length > 0) {
    const r = records[0];
    return {
      userId,
      currentStreak: r.current_streak ?? 0,
      lastTrainingDate: r.last_training_date ?? '',
      longestStreak: r.longest_streak ?? 0,
      milestoneSeven: r.milestone_seven ?? false,
      milestoneFourteen: r.milestone_fourteen ?? false,
      milestoneThirty: r.milestone_thirty ?? false,
      updatedAt: r.updated_at ?? '',
    };
  }

  return {
    userId,
    currentStreak: 0,
    lastTrainingDate: '',
    longestStreak: 0,
    milestoneSeven: false,
    milestoneFourteen: false,
    milestoneThirty: false,
    updatedAt: new Date().toISOString(),
  };
}

// ── Quiz Generation ────────────────────────────────────────────────────────

/**
 * Generates a single daily quiz question using spaced repetition.
 */
async function generateDailyQuizQuestion(): Promise<string | null> {
  try {
    const topics = [
      'NABCEP certification requirements',
      'Enphase inverter specifications',
      'SMA equipment safety ratings',
      'Solar panel wiring standards',
      'Battery storage integration',
      'Grid interconnection rules',
      'NEC requirements for solar',
    ];

    const random = topics[Math.floor(Math.random() * topics.length)];
    const prompt = `Generate one short, practical solar training question about: ${random}. Make it multiple choice with 4 options. Format: Q: [question] A) [opt1] B) [opt2] C) [opt3] D) [opt4]. Answer: [letter].`;

    const question = await callClaude({
      system: 'You are a solar training expert. Generate practical, realistic questions for electricians.',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 150,
    })
      .then(extractText)
      .catch(() => null);

    return question;
  } catch (err) {
    console.warn('[SolarNexusIntegration] quiz generation error:', err);
    return null;
  }
}

/**
 * Records a completed quiz session.
 */
export async function recordQuizSession(
  userId: string,
  topic: string,
  score: number,
  duration: number = 30
): Promise<void> {
  try {
    const today = new Date().toISOString().split('T')[0];
    await syncToSupabase({
      table: 'solar_training_sessions',
      data: {
        user_id: userId,
        date: today,
        session_type: 'micro_quiz',
        duration,
        content: topic,
        score,
        completed_at: new Date().toISOString(),
      },
      operation: 'insert',
    });

    // Update streak
    await updateStreak(userId);
  } catch (err) {
    console.warn('[SolarNexusIntegration] quiz session record error:', err);
  }
}

/**
 * Records a real solar conversation debrief.
 */
export async function recordSolarDebrief(
  userId: string,
  topic: string,
  conversation: string,
  ruleExtracted?: string
): Promise<void> {
  try {
    const today = new Date().toISOString().split('T')[0];
    await syncToSupabase({
      table: 'solar_debriefs',
      data: {
        user_id: userId,
        date: today,
        topic,
        conversation,
        rule_extracted: ruleExtracted,
        rule_confirmed: false,
      },
      operation: 'insert',
    });

    // Record as training session
    await syncToSupabase({
      table: 'solar_training_sessions',
      data: {
        user_id: userId,
        date: today,
        session_type: 'real_conversation',
        duration: 600, // 10 minutes default
        content: conversation,
        completed_at: new Date().toISOString(),
      },
      operation: 'insert',
    });

    // Update streak
    await updateStreak(userId);
  } catch (err) {
    console.warn('[SolarNexusIntegration] debrief record error:', err);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────

function getYesterdayStr(): string {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  return yesterday.toISOString().split('T')[0];
}
