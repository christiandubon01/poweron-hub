/**
 * SolarRetentionTracker
 *
 * Tracks lesson completions, enforces the strict unlock sequence,
 * computes module and curriculum progress, identifies weak areas,
 * and builds Claude prompts for adaptive quiz generation.
 *
 * Persists to localStorage (local-first) with Supabase sync stub.
 */

import {
  getSolarCurriculumSequencer,
  type CurriculumState,
  type LessonRecord,
  type QuizQuestion,
  type DifficultyLevel,
  type RetentionGateResult,
  SOLAR_CURRICULUM,
  DEFAULT_QUIZ_QUESTION_COUNT,
  RETENTION_GATE_PASS_SCORE,
} from './SolarCurriculumSequencer';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export interface LessonCompletionLog {
  id: string;
  userId: string;
  moduleId: string;
  lessonId: string;
  score: number;
  attempts: number;
  passedAt: number;
  timeSpentSeconds: number;
  difficulty: DifficultyLevel;
  missedTopics: string[];
  syncedToSupabase: boolean;
}

export interface ModuleProgress {
  moduleId: string;
  moduleTitle: string;
  totalLessons: number;
  completedLessons: number;
  currentLessonId: string | null;
  currentLessonTitle: string | null;
  percentComplete: number;
  allPassed: boolean;
}

export interface CurriculumProgress {
  userId: string;
  modules: ModuleProgress[];
  totalLessons: number;
  totalPassed: number;
  totalPercentComplete: number;
  currentModuleId: string | null;
  currentLessonId: string | null;
  isComplete: boolean;
  difficultyLevel: DifficultyLevel;
}

export interface WeakArea {
  moduleId: string;
  lessonId: string;
  moduleTitle: string;
  lessonTitle: string;
  attemptsCount: number;
  bestScore: number;
  missedQuestionIds: string[];
  weaknessReason: 'high_attempts' | 'low_first_try_score' | 'both';
}

export interface GeneratedQuiz {
  lessonId: string;
  lessonTitle: string;
  moduleId: string;
  difficulty: DifficultyLevel;
  questions: QuizQuestion[];
  generatedAt: number;
  promptUsed: string;
}

// ============================================================================
// RETENTION TRACKER CLASS
// ============================================================================

export class SolarRetentionTracker {
  private readonly userId: string;
  private readonly COMPLETION_LOG_KEY: string;
  private completionLog: LessonCompletionLog[] = [];

  constructor(userId: string) {
    this.userId = userId;
    this.COMPLETION_LOG_KEY = `solar_retention_log_${userId}`;
    this.completionLog = this.loadCompletionLog();
  }

  // --------------------------------------------------------------------------
  // PUBLIC: LESSON TRACKING
  // --------------------------------------------------------------------------

  /**
   * Logs a lesson completion to localStorage and queues for Supabase sync.
   * Called after a passing retention gate result.
   */
  trackLessonCompletion(
    moduleId: string,
    lessonId: string,
    score: number,
    attempts: number,
    timeSpentSeconds: number = 0,
    missedTopics: string[] = []
  ): LessonCompletionLog {
    const sequencer = getSolarCurriculumSequencer(this.userId);
    const difficulty = sequencer.getDifficultyLevel();

    const entry: LessonCompletionLog = {
      id: `solar_completion_${Date.now()}_${lessonId}`,
      userId: this.userId,
      moduleId,
      lessonId,
      score,
      attempts,
      passedAt: Date.now(),
      timeSpentSeconds,
      difficulty,
      missedTopics,
      syncedToSupabase: false,
    };

    // Replace or append
    const existingIdx = this.completionLog.findIndex(
      (e) => e.moduleId === moduleId && e.lessonId === lessonId
    );
    if (existingIdx >= 0) {
      this.completionLog[existingIdx] = entry;
    } else {
      this.completionLog.push(entry);
    }

    this.saveCompletionLog();
    this.syncToSupabase(entry).catch((err) =>
      console.warn('SolarRetentionTracker: Supabase sync failed', err)
    );

    return entry;
  }

  /**
   * Processes a full quiz attempt through the sequencer's retention gate.
   * If passed, automatically logs the completion.
   */
  submitQuizAttempt(
    moduleId: string,
    lessonId: string,
    answeredQuestions: { question: QuizQuestion; selectedOption: 'a' | 'b' | 'c' | 'd' }[],
    timeSpentSeconds: number = 0
  ): RetentionGateResult {
    const sequencer = getSolarCurriculumSequencer(this.userId);
    const result = sequencer.processRetentionGate(moduleId, lessonId, answeredQuestions);

    if (result.passed) {
      const missedTopics = result.missedQuestions.map((q) => q.question.slice(0, 60));
      this.trackLessonCompletion(
        moduleId,
        lessonId,
        result.score,
        result.attemptNumber,
        timeSpentSeconds,
        missedTopics
      );
    }

    return result;
  }

  // --------------------------------------------------------------------------
  // PUBLIC: LOCK/UNLOCK STATUS
  // --------------------------------------------------------------------------

  /**
   * Returns whether a lesson is unlocked for this user.
   * Enforces strict sequence: previous lesson must be passed at 100%.
   */
  isLessonUnlocked(moduleId: string, lessonId: string): boolean {
    return getSolarCurriculumSequencer(this.userId).isLessonUnlocked(moduleId, lessonId);
  }

  /**
   * Returns whether a specific lesson has been completed (passed at 100%).
   */
  isLessonCompleted(moduleId: string, lessonId: string): boolean {
    const lesson = getSolarCurriculumSequencer(this.userId).getLesson(moduleId, lessonId);
    return lesson?.status === 'passed';
  }

  // --------------------------------------------------------------------------
  // PUBLIC: PROGRESS
  // --------------------------------------------------------------------------

  /**
   * Returns progress for a single module.
   */
  getModuleProgress(moduleId: string): ModuleProgress {
    const sequencer = getSolarCurriculumSequencer(this.userId);
    const state = sequencer.getState();
    const mod = state.modules.find((m) => m.moduleId === moduleId);

    if (!mod) {
      return {
        moduleId,
        moduleTitle: 'Unknown Module',
        totalLessons: 0,
        completedLessons: 0,
        currentLessonId: null,
        currentLessonTitle: null,
        percentComplete: 0,
        allPassed: false,
      };
    }

    const completedLessons = mod.lessons.filter((l) => l.status === 'passed').length;
    const totalLessons = mod.lessons.length;

    // Find current active lesson within this module
    const currentLesson =
      mod.lessons.find((l) => l.status === 'unlocked' || l.status === 'in_progress') ?? null;

    return {
      moduleId,
      moduleTitle: mod.title,
      totalLessons,
      completedLessons,
      currentLessonId: currentLesson?.lessonId ?? null,
      currentLessonTitle: currentLesson?.title ?? null,
      percentComplete:
        totalLessons > 0 ? Math.round((completedLessons / totalLessons) * 100) : 0,
      allPassed: completedLessons === totalLessons,
    };
  }

  /**
   * Returns full curriculum progress for all modules.
   */
  getCurriculumProgress(): CurriculumProgress {
    const sequencer = getSolarCurriculumSequencer(this.userId);
    const state = sequencer.getState();

    const modules: ModuleProgress[] = state.modules.map((mod) =>
      this.getModuleProgress(mod.moduleId)
    );

    const totalLessons = modules.reduce((sum, m) => sum + m.totalLessons, 0);
    const totalPassed = modules.reduce((sum, m) => sum + m.completedLessons, 0);

    return {
      userId: this.userId,
      modules,
      totalLessons,
      totalPassed,
      totalPercentComplete:
        totalLessons > 0 ? Math.round((totalPassed / totalLessons) * 100) : 0,
      currentModuleId: state.currentModuleId,
      currentLessonId: state.currentLessonId,
      isComplete: totalPassed === totalLessons && totalLessons > 0,
      difficultyLevel: state.difficultyLevel,
    };
  }

  /**
   * Returns lessons with most attempts or lowest first-try scores.
   * Used by Module 5 to build the personalized pitch script.
   */
  getWeakAreas(): WeakArea[] {
    const sequencer = getSolarCurriculumSequencer(this.userId);
    const rawWeakLessons = sequencer.getWeakAreas();

    return rawWeakLessons.map((lesson) => {
      const modDef = SOLAR_CURRICULUM.find((m) => m.moduleId === lesson.moduleId);
      const lessonDef = modDef?.lessons.find((l) => l.lessonId === lesson.lessonId);

      let weaknessReason: WeakArea['weaknessReason'];
      if (lesson.attemptsCount >= 3 && lesson.bestScore < 100) {
        weaknessReason = 'both';
      } else if (lesson.attemptsCount >= 3) {
        weaknessReason = 'high_attempts';
      } else {
        weaknessReason = 'low_first_try_score';
      }

      return {
        moduleId: lesson.moduleId,
        lessonId: lesson.lessonId,
        moduleTitle: modDef?.title ?? 'Unknown Module',
        lessonTitle: lessonDef?.title ?? lesson.title,
        attemptsCount: lesson.attemptsCount,
        bestScore: lesson.bestScore,
        missedQuestionIds: lesson.missedQuestionIds,
        weaknessReason,
      };
    });
  }

  /**
   * Returns completion log entries for a specific lesson.
   */
  getLessonHistory(moduleId: string, lessonId: string): LessonCompletionLog[] {
    return this.completionLog.filter(
      (e) => e.moduleId === moduleId && e.lessonId === lessonId
    );
  }

  /**
   * Returns all completion log entries sorted by passedAt descending.
   */
  getFullCompletionLog(): LessonCompletionLog[] {
    return [...this.completionLog].sort((a, b) => b.passedAt - a.passedAt);
  }

  // --------------------------------------------------------------------------
  // PUBLIC: QUIZ GENERATION
  // --------------------------------------------------------------------------

  /**
   * Builds a Claude API prompt for generating quiz questions for a lesson.
   *
   * Prompt contract:
   * - Application-based questions, not memorization
   * - Uses real scenario numbers (SCE bills, system sizes, loan amounts)
   * - Output: JSON array [{question, options:[a,b,c,d], correct, explanation}]
   * - Christian's background is injected for context calibration
   */
  generateQuiz(lessonId: string, difficulty?: DifficultyLevel): GeneratedQuiz {
    const sequencer = getSolarCurriculumSequencer(this.userId);
    const state = sequencer.getState();
    const effectiveDifficulty = difficulty ?? state.difficultyLevel;

    // Find lesson across all modules
    let foundLesson: LessonRecord | null = null;
    let foundModuleId = '';
    let foundModuleTitle = '';

    for (const mod of state.modules) {
      const lesson = mod.lessons.find((l) => l.lessonId === lessonId);
      if (lesson) {
        foundLesson = lesson;
        foundModuleId = mod.moduleId;
        foundModuleTitle = mod.title;
        break;
      }
    }

    if (!foundLesson) {
      throw new Error(`Lesson ${lessonId} not found in curriculum`);
    }

    const modDef = SOLAR_CURRICULUM.find((m) => m.moduleId === foundModuleId);
    const lessonDef = modDef?.lessons.find((l) => l.lessonId === lessonId);
    const topics = lessonDef?.topics ?? foundLesson.topics;

    const prompt = this.buildQuizPrompt(
      foundLesson.title,
      foundModuleTitle,
      topics,
      effectiveDifficulty
    );

    return {
      lessonId,
      lessonTitle: foundLesson.title,
      moduleId: foundModuleId,
      difficulty: effectiveDifficulty,
      questions: [], // Populated after Claude API call
      generatedAt: Date.now(),
      promptUsed: prompt,
    };
  }

  /**
   * Builds the exact Claude prompt string for quiz generation.
   * Follows the Channel B / SPARK spec pattern.
   */
  buildQuizPrompt(
    lessonTitle: string,
    moduleTitle: string,
    topics: string[],
    difficulty: DifficultyLevel
  ): string {
    const topicList = topics.map((t) => `- ${t}`).join('\n');

    return `Generate ${DEFAULT_QUIZ_QUESTION_COUNT} quiz questions for the solar training lesson: "${lessonTitle}" (Module: ${moduleTitle}).

LESSON TOPICS:
${topicList}

DIFFICULTY: ${difficulty.toUpperCase()}

STUDENT BACKGROUND:
Christian has 3 years of Enphase field experience and holds EES Sales and Design certifications.
Questions must test APPLICATION, not memorization.

QUESTION REQUIREMENTS:
- Use real scenario numbers (actual bill amounts, system sizes, battery capacities)
- Require calculation or judgment, not just recall
- For ${difficulty} level: ${this.getDifficultyGuidance(difficulty)}

GOOD EXAMPLE:
"A homeowner has a $280/month SCE bill on TOU-D-PRIME rate. Their 2,100 sq ft home averages 950 kWh/month. \
Their roof faces southwest at 22 degrees. Using 415W panels and 5.8 peak sun hours, how many panels are needed? \
Use a 0.80 derate factor."

BAD EXAMPLE (do NOT use):
"What does NEM stand for?" or "Define Time-of-Use."

OUTPUT — return ONLY valid JSON array, no markdown fences, no commentary:
[
  {
    "question": "full scenario-based question with real numbers",
    "options": ["a) specific answer", "b) specific answer", "c) specific answer", "d) specific answer"],
    "correct": "a",
    "explanation": "step-by-step explanation of the correct answer and why each distractor is wrong"
  }
]

Return exactly ${DEFAULT_QUIZ_QUESTION_COUNT} questions. Ensure 'correct' matches the actual correct option.
Passing score is ${RETENTION_GATE_PASS_SCORE}% — questions must be clear and unambiguous.`;
  }

  // --------------------------------------------------------------------------
  // PUBLIC: STATE OPERATIONS
  // --------------------------------------------------------------------------

  /**
   * Returns the raw curriculum state for the user.
   */
  getCurriculumState(): CurriculumState {
    return getSolarCurriculumSequencer(this.userId).getState();
  }

  /**
   * Starts a lesson session and records it as in-progress.
   * Returns false if lesson is locked (sequence enforced).
   */
  startLesson(moduleId: string, lessonId: string): boolean {
    return getSolarCurriculumSequencer(this.userId).startLesson(moduleId, lessonId);
  }

  /**
   * Records time spent on a lesson.
   */
  recordTimeSpent(moduleId: string, lessonId: string, seconds: number): void {
    getSolarCurriculumSequencer(this.userId).recordTimeSpent(moduleId, lessonId, seconds);
  }

  /**
   * Returns stats for a specific lesson.
   */
  getLessonStats(
    moduleId: string,
    lessonId: string
  ): {
    status: string;
    attemptsCount: number;
    bestScore: number;
    totalTimeSeconds: number;
    passedAt: number | null;
  } | null {
    const lesson = getSolarCurriculumSequencer(this.userId).getLesson(moduleId, lessonId);
    if (!lesson) return null;
    return {
      status: lesson.status,
      attemptsCount: lesson.attemptsCount,
      bestScore: lesson.bestScore,
      totalTimeSeconds: lesson.totalTimeSeconds,
      passedAt: lesson.passedAt,
    };
  }

  // --------------------------------------------------------------------------
  // PRIVATE: STORAGE
  // --------------------------------------------------------------------------

  private loadCompletionLog(): LessonCompletionLog[] {
    try {
      const raw = localStorage.getItem(this.COMPLETION_LOG_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed as LessonCompletionLog[];
    } catch {
      return [];
    }
  }

  private saveCompletionLog(): void {
    try {
      localStorage.setItem(this.COMPLETION_LOG_KEY, JSON.stringify(this.completionLog));
    } catch (error) {
      console.warn('SolarRetentionTracker: failed to save completion log', error);
    }
  }

  // --------------------------------------------------------------------------
  // PRIVATE: SUPABASE SYNC (STUB — wire to supabaseService.ts on integration)
  // --------------------------------------------------------------------------

  /**
   * Sync completion entry to Supabase `solar_lesson_completions` table.
   * Stub: logs intent, marks syncedToSupabase on success.
   *
   * Integration steps:
   * 1. Import supabaseClient from 'src/services/supabaseService.ts'
   * 2. upsert to table 'solar_lesson_completions' keyed on (user_id, lesson_id)
   * 3. Mark entry.syncedToSupabase = true and saveCompletionLog()
   */
  private async syncToSupabase(entry: LessonCompletionLog): Promise<void> {
    // TODO: Replace stub with real Supabase upsert
    // Example:
    // const { error } = await supabase
    //   .from('solar_lesson_completions')
    //   .upsert({
    //     id: entry.id,
    //     user_id: entry.userId,
    //     module_id: entry.moduleId,
    //     lesson_id: entry.lessonId,
    //     score: entry.score,
    //     attempts: entry.attempts,
    //     passed_at: new Date(entry.passedAt).toISOString(),
    //     time_spent_seconds: entry.timeSpentSeconds,
    //     difficulty: entry.difficulty,
    //     missed_topics: entry.missedTopics,
    //   });
    // if (!error) {
    //   entry.syncedToSupabase = true;
    //   this.saveCompletionLog();
    // }
    console.log(
      `SolarRetentionTracker: queued Supabase sync for ${entry.moduleId}/${entry.lessonId} — stub not yet wired`
    );
  }

  // --------------------------------------------------------------------------
  // PRIVATE: HELPERS
  // --------------------------------------------------------------------------

  private getDifficultyGuidance(difficulty: DifficultyLevel): string {
    const guidance: Record<DifficultyLevel, string> = {
      beginner:
        'single-step calculations with all values provided. One concept applied. Clear right/wrong answers.',
      intermediate:
        'multi-step calculations combining 2–3 concepts. Some values require inference. Mild ambiguity is acceptable.',
      advanced:
        'complex field scenarios requiring judgment across multiple concepts. Competing trade-offs. Edge cases and exceptions tested.',
    };
    return guidance[difficulty];
  }
}

// ============================================================================
// SINGLETON FACTORY
// ============================================================================

const trackerInstances: Map<string, SolarRetentionTracker> = new Map();

export function getSolarRetentionTracker(userId: string): SolarRetentionTracker {
  if (!trackerInstances.has(userId)) {
    trackerInstances.set(userId, new SolarRetentionTracker(userId));
  }
  return trackerInstances.get(userId)!;
}

// ============================================================================
// STANDALONE UTILITY: isLessonUnlocked (matches spec signature)
// ============================================================================

/**
 * Stateless utility wrapper — checks if a lesson is unlocked for a user
 * without needing to instantiate the full tracker.
 */
export function isLessonUnlocked(
  userId: string,
  moduleId: string,
  lessonId: string
): boolean {
  return getSolarRetentionTracker(userId).isLessonUnlocked(moduleId, lessonId);
}

// ============================================================================
// STANDALONE UTILITY: trackLessonCompletion (matches spec signature)
// ============================================================================

/**
 * Stateless utility wrapper — logs a lesson completion to localStorage
 * and queues Supabase sync.
 */
export function trackLessonCompletion(
  userId: string,
  moduleId: string,
  lessonId: string,
  score: number,
  attempts: number
): LessonCompletionLog {
  return getSolarRetentionTracker(userId).trackLessonCompletion(
    moduleId,
    lessonId,
    score,
    attempts
  );
}

// ============================================================================
// STANDALONE UTILITY: generateQuiz (matches spec signature)
// ============================================================================

/**
 * Stateless utility wrapper — generates a quiz prompt for a lesson.
 * Returns a GeneratedQuiz with `promptUsed` ready for Claude API call.
 */
export function generateQuiz(
  userId: string,
  lessonId: string,
  difficulty?: DifficultyLevel
): GeneratedQuiz {
  return getSolarRetentionTracker(userId).generateQuiz(lessonId, difficulty);
}

export default {
  SolarRetentionTracker,
  getSolarRetentionTracker,
  isLessonUnlocked,
  trackLessonCompletion,
  generateQuiz,
};
