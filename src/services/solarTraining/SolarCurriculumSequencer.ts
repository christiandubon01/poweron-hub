/**
 * SolarCurriculumSequencer
 *
 * Strict-sequence solar training curriculum for Power On Solutions, LLC.
 * Lessons cannot be skipped. Each lesson must be confirmed retained at 100%
 * before the next lesson unlocks. Difficulty adapts based on attempt history.
 *
 * 5 Modules · 17 Lessons · Retention gates every lesson
 */

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export type DifficultyLevel = 'beginner' | 'intermediate' | 'advanced';

export type LessonStatus = 'locked' | 'unlocked' | 'in_progress' | 'passed';

export interface QuizQuestion {
  question: string;
  options: [string, string, string, string];
  correct: 'a' | 'b' | 'c' | 'd';
  explanation: string;
}

export interface LessonRecord {
  moduleId: string;
  lessonId: string;
  title: string;
  description: string;
  topics: string[];
  status: LessonStatus;
  attemptsCount: number;
  bestScore: number; // 0–100
  lastAttemptAt: number | null;
  totalTimeSeconds: number;
  missedQuestionIds: string[];
  passedAt: number | null;
}

export interface ModuleRecord {
  moduleId: string;
  title: string;
  description: string;
  lessons: LessonRecord[];
}

export interface CurriculumState {
  userId: string;
  difficultyLevel: DifficultyLevel;
  modules: ModuleRecord[];
  totalPercentComplete: number;
  currentModuleId: string | null;
  currentLessonId: string | null;
  lastActivityAt: number | null;
}

export interface RetentionGateResult {
  passed: boolean;
  score: number; // 0–100
  correctCount: number;
  totalQuestions: number;
  missedQuestions: QuizQuestion[];
  attemptNumber: number;
  nextAction: 'advance' | 'retry_different_approach' | 'repeat_lesson';
  feedbackMessage: string;
}

export interface AdaptiveDifficultySignal {
  currentLevel: DifficultyLevel;
  recommendedLevel: DifficultyLevel;
  reason: string;
  firstAttemptStreakCount: number; // consecutive 100% on first try
  struggleCount: number; // lessons needing 3+ attempts
}

// ============================================================================
// CURRICULUM DEFINITION — STRICT ORDER, CANNOT SKIP
// ============================================================================

/** Static lesson definition (without runtime tracking fields) */
export interface LessonDefinition {
  moduleId: string;
  lessonId: string;
  title: string;
  description: string;
  topics: string[];
}

/** Static module definition (without runtime tracking fields) */
export interface ModuleDefinition {
  moduleId: string;
  title: string;
  description: string;
  lessons: LessonDefinition[];
}

export const SOLAR_CURRICULUM: ModuleDefinition[] = [
  // ------------------------------------------------------------------
  // MODULE 1: Core Calculations + System Sizing
  // ------------------------------------------------------------------
  {
    moduleId: 'M1',
    title: 'Core Calculations + System Sizing',
    description:
      'Master the math behind reading utility bills, panel counts, inverter sizing, and battery storage — the foundation of every solar proposal.',
    lessons: [
      {
        moduleId: 'M1',
        lessonId: 'M1L1',
        title: 'Reading a Utility Bill',
        description:
          'Extract kWh usage, identify rate structure (tiered vs TOU), and pinpoint peak usage windows from a real SCE or IID bill.',
        topics: [
          'kWh extraction from bill detail pages',
          'Rate structure: tiered vs Time-of-Use (TOU)',
          'TOU identification: on-peak, off-peak, super off-peak windows',
          'Baseline allowance and tier thresholds',
          'Seasonal usage patterns and 12-month averaging',
        ],
      },
      {
        moduleId: 'M1',
        lessonId: 'M1L2',
        title: 'Panel Count Calculation',
        description:
          'Size a system correctly using the formula: annual kWh ÷ (panel wattage × sun hours × 365 × derate factor).',
        topics: [
          'Annual kWh from bill averaging',
          'Panel wattage selection (400W–430W range)',
          'Peak sun hours by location (Inland Empire: 5.5–6.0 hrs)',
          'Derate factor: 0.77–0.85 for real-world losses',
          'Rounding and practical panel count decisions',
          'DC system size in kW vs panel count',
        ],
      },
      {
        moduleId: 'M1',
        lessonId: 'M1L3',
        title: 'Inverter Sizing',
        description:
          'Understand DC:AC ratio, when to use microinverters vs string inverters, and Enphase IQ8 specifications for field scenarios.',
        topics: [
          'DC:AC ratio definition (1.1–1.25 typical)',
          'Clipping losses and why slight oversizing is acceptable',
          'Microinverter advantages: shade tolerance, panel-level monitoring',
          'String inverter use cases: unshaded, uniform arrays',
          'Enphase IQ8 specs: 290W output, grid-forming capability, no battery required for backup',
          'Rapid shutdown compliance per NEC 2017+',
        ],
      },
      {
        moduleId: 'M1',
        lessonId: 'M1L4',
        title: 'Battery Sizing',
        description:
          'Analyze backup load requirements, calculate required kWh storage, and apply discharge rate constraints.',
        topics: [
          'Critical load identification: refrigerator, lights, outlets, HVAC',
          'Load analysis in watts and conversion to daily kWh',
          'kWh storage calculation: load × backup hours ÷ usable capacity %',
          'Enphase IQ Battery 5P: 5 kWh, 3.84 kW continuous discharge',
          'Tesla Powerwall 3: 13.5 kWh, 11.5 kW peak',
          'Stacking batteries for larger backup needs',
          'Depth of discharge limits and battery life impact',
        ],
      },
    ],
  },

  // ------------------------------------------------------------------
  // MODULE 2: Design Fundamentals + NEC Compliance
  // ------------------------------------------------------------------
  {
    moduleId: 'M2',
    title: 'Design Fundamentals + NEC Compliance',
    description:
      'Learn roof assessment methodology, electrical design requirements, NEC 690 solar-specific code, and SCE vs IID permitting differences.',
    lessons: [
      {
        moduleId: 'M2',
        lessonId: 'M2L1',
        title: 'Roof Assessment',
        description:
          'Evaluate azimuth, tilt, shading obstructions, and structural capacity before committing to a design.',
        topics: [
          'Azimuth: south-facing (180°) optimal, southwest acceptable (210°–240°)',
          'Tilt angle: 20°–35° ideal for Inland Empire latitude',
          'Shading analysis: trees, chimneys, neighboring structures',
          'TSRF (Total Solar Resource Fraction) and acceptable thresholds',
          'Structural capacity: rafter size, spacing, roof age considerations',
          'Tile vs composition shingle: attachment method differences',
        ],
      },
      {
        moduleId: 'M2',
        lessonId: 'M2L2',
        title: 'Electrical Design',
        description:
          'Design the AC disconnect, combiner box, meter collar (PTO), and grounding system correctly.',
        topics: [
          'AC disconnect location requirements',
          'Utility-side vs load-side interconnection',
          'Meter collar / meter socket adapter for IID and SCE',
          'Combiner box: DC string fusing, wire management',
          'Grounding: equipment grounding conductor sizing, ground rod requirements',
          'Service panel capacity check: bus bar rating vs added solar load',
        ],
      },
      {
        moduleId: 'M2',
        lessonId: 'M2L3',
        title: 'NEC 690 Solar-Specific Code',
        description:
          'Master rapid shutdown requirements, required labeling, wire sizing rules, and inspection-critical code items.',
        topics: [
          'NEC 690.12: Rapid Shutdown System requirements',
          'Module-level rapid shutdown vs array-level',
          'Required labels: DC, AC disconnect, rapid shutdown locations',
          'Wire sizing: ampacity, temperature correction, conduit fill',
          'Backfed breaker sizing: 120% rule for bus bar',
          'Conduit type: EMT vs PVC for roof vs garage runs',
          'String voltage: max system voltage calculation (Voc × temp correction)',
        ],
      },
      {
        moduleId: 'M2',
        lessonId: 'M2L4',
        title: 'Permitting Process',
        description:
          'Navigate permit submission, utility interconnection applications, and inspection flows for SCE and IID territories.',
        topics: [
          'SCE territory: Rule 21 interconnection, NEM application, Powerclerk portal',
          'IID territory: Form 14-931, different timeline and technical review',
          'AHJ (Authority Having Jurisdiction): city vs county permit requirements',
          'Plan set requirements: single-line diagram, site plan, spec sheets',
          'Inspection stages: rough, final, utility inspection',
          'Permission to Operate (PTO): what it means, typical timeline',
          'Difference in tariff rules between SCE and IID post-NEM 3.0',
        ],
      },
    ],
  },

  // ------------------------------------------------------------------
  // MODULE 3: ROI Projections + Savings Scenarios
  // ------------------------------------------------------------------
  {
    moduleId: 'M3',
    title: 'ROI Projections + Savings Scenarios',
    description:
      'Build compelling, accurate financial cases using NEM 2.0 vs NEM 3.0 realities, battery economics, loan structures, and payback period math.',
    lessons: [
      {
        moduleId: 'M3',
        lessonId: 'M3L1',
        title: 'NEM 2.0 vs NEM 3.0',
        description:
          'Understand export rates, TOU impact on solar savings, and the grandfathering window for NEM 2.0 customers.',
        topics: [
          'NEM 2.0: retail-rate export credit, 20-year grandfathering from PTO date',
          'NEM 3.0 (NBT): Avoided Cost Calculator (ACC), dramatically lower export rates',
          'NEM 3.0 self-consumption imperative: battery required for economics',
          'TOU impact: sell solar at off-peak (low) vs buy grid at on-peak (high)',
          'Time-shifting with batteries under NEM 3.0',
          'IID net metering: separate program, currently more favorable export rates',
        ],
      },
      {
        moduleId: 'M3',
        lessonId: 'M3L2',
        title: 'Battery Economics',
        description:
          'Quantify arbitrage savings, peak shaving value, and the hard-to-quantify backup power value proposition.',
        topics: [
          'Arbitrage: charge battery off-peak (~$0.12/kWh) → discharge on-peak (~$0.45/kWh)',
          'Daily arbitrage savings calculation for IQ Battery 5P',
          'Peak shaving for demand-charge customers',
          'Backup value: insurance framing, outage frequency in local area',
          'SGIP incentive: Self-Generation Incentive Program eligibility and amount',
          'Battery-only vs solar+battery economics comparison',
        ],
      },
      {
        moduleId: 'M3',
        lessonId: 'M3L3',
        title: 'Loan Structures',
        description:
          'Explain APR, loan term, monthly payment calculations, and total cost of ownership — and how to present it honestly.',
        topics: [
          'APR vs interest rate: what homeowners confuse',
          'Common solar loan terms: 10, 15, 20, 25 years',
          'Dealer fee / origination fee impact on effective cost',
          'Monthly payment calculation: P × r(1+r)^n / ((1+r)^n - 1)',
          'Total cost of ownership: loan payments vs cash savings',
          'ITC (Investment Tax Credit): 30% federal tax credit mechanics',
          'Year-1 effective cash position: payment minus savings minus ITC benefit',
        ],
      },
      {
        moduleId: 'M3',
        lessonId: 'M3L4',
        title: 'Payback Period Calculation',
        description:
          'Calculate payback period using year-1 savings, utility escalation rate, and break-even year projection.',
        topics: [
          'Year-1 savings: avoided utility cost + export credit',
          'Utility rate escalation: 3%–5% historical SCE annual increase',
          'Simple payback: system cost ÷ year-1 savings',
          'Discounted payback: net present value of future savings',
          'Break-even year projection table',
          'Sensitivity analysis: what if savings are 20% lower?',
          '25-year total savings projection for proposal presentation',
        ],
      },
    ],
  },

  // ------------------------------------------------------------------
  // MODULE 4: Customer Walkthrough + Objection Handling
  // ------------------------------------------------------------------
  {
    moduleId: 'M4',
    title: 'Customer Walkthrough + Objection Handling',
    description:
      'Master the full consultation structure, the 5 hidden objections framework, price defense, and closing technique.',
    lessons: [
      {
        moduleId: 'M4',
        lessonId: 'M4L1',
        title: 'Consultation Structure',
        description:
          'Execute a disciplined 5-stage consultation: intro → discovery → presentation → objection handling → close.',
        topics: [
          'Stage 1 – Intro: build rapport, set agenda, confirm decision-makers present',
          'Stage 2 – Discovery: utility bill review, pain points, goals, timeline',
          'Stage 3 – Presentation: system design, savings model, equipment story',
          'Stage 4 – Objection handling: preempt then respond',
          'Stage 5 – Close: firm next step, deposit, or firm follow-up date',
          'Time management: 60–90 min total, hard stop discipline',
          'Documentation: photos, bill copy, signed agreement checklist',
        ],
      },
      {
        moduleId: 'M4',
        lessonId: 'M4L2',
        title: 'The 5 Hidden Objections Framework',
        description:
          'Identify and resolve the 5 underlying objections that block every solar close — before the customer voices them.',
        topics: [
          'Hidden Objection 1: "I don\'t trust that the savings are real" → proof-first presentation',
          'Hidden Objection 2: "I\'m worried about installation quality and my roof" → warranty + workmanship story',
          'Hidden Objection 3: "I don\'t trust this company will be around in 10 years" → Enphase manufacturer warranty backstop',
          'Hidden Objection 4: "I\'m not sure about the financing" → total cost of ownership clarity',
          'Hidden Objection 5: "I need to think about it" → time cost of delay calculation',
          'Pre-emption vs reactive response: surface the objection before they say it',
          'SPARK training integration: using call score data to identify which objection is active',
        ],
      },
      {
        moduleId: 'M4',
        lessonId: 'M4L3',
        title: 'Price Defense',
        description:
          'Hold premium pricing by communicating value over cost, using the Renova story and quality differentiation.',
        topics: [
          'Value vs cost framing: "This isn\'t a purchase, it\'s a 25-year financial decision"',
          'The Renova cautionary story: cheap installer, roof damage, no warranty support',
          'Enphase IQ8 vs generic microinverter: 25-year warranty vs 10-year, grid-forming capability',
          'Labor quality: licensed electricians vs subcontracted labor',
          'Insurance and license verification as a value differentiator',
          'Never negotiate on quality — offer financing options instead',
          'The "apples to apples" equipment comparison technique',
        ],
      },
      {
        moduleId: 'M4',
        lessonId: 'M4L4',
        title: 'The Close',
        description:
          'Secure a firm next step — deposit, signed agreement, or locked follow-up date — and create legitimate urgency.',
        topics: [
          'The assumptive close: "Let\'s get you scheduled before rates change"',
          'Legitimate urgency: NEM 2.0 grandfathering deadlines, incentive program windows',
          'The soft close: "What would need to happen for you to move forward today?"',
          'Handling "we need to think about it": time-cost-of-delay response',
          'Follow-up commitment: specific date, specific time, specific question to answer',
          'Deposit mechanics: amount, purpose, refundability',
          'CRM follow-up discipline: NEXUS call data logging after every consultation',
        ],
      },
    ],
  },

  // ------------------------------------------------------------------
  // MODULE 5: Adaptive Pitch Script
  // ------------------------------------------------------------------
  {
    moduleId: 'M5',
    title: 'Adaptive Pitch Script',
    description:
      'Build and drill a personalized pitch using NEXUS call data, SPARK training scores, and live consultation simulation.',
    lessons: [
      {
        moduleId: 'M5',
        lessonId: 'M5L1',
        title: 'Pitch Built from NEXUS + SPARK Data',
        description:
          'Analyze your NEXUS call history and SPARK training scores to identify patterns and build a data-driven pitch baseline.',
        topics: [
          'NEXUS call data review: most common objection points in your calls',
          'SPARK training score audit: which modules had lowest first-try pass rates',
          'Pattern identification: where does your pitch lose momentum?',
          'Discovery quality score: are you asking enough questions before presenting?',
          'Close rate analysis: where in the consultation are prospects disengaging?',
          'Building your personal pitch baseline from real performance data',
        ],
      },
      {
        moduleId: 'M5',
        lessonId: 'M5L2',
        title: 'Personalized Script Generation',
        description:
          'Generate a customized pitch script targeting your specific weak spots, using Claude to produce a tailored consultation guide.',
        topics: [
          'Weak spot identification from M1–M4 retention data',
          'Claude-generated script: customized language for your communication style',
          'Technical confidence bridges: shortcut explanations for calculation-heavy topics',
          'Objection response cards: pre-written for your top 3 objection patterns',
          'Discovery question bank: 10+ questions ranked by your consultation profile',
          'Memorization vs internalization: how to own the script without sounding scripted',
        ],
      },
      {
        moduleId: 'M5',
        lessonId: 'M5L3',
        title: 'Live Pitch Drill',
        description:
          'Conduct a full AI-simulated consultation with grading across all 5 consultation stages. Must score passing grade to complete curriculum.',
        topics: [
          'Full 5-stage consultation simulation with AI customer persona',
          'Grading criteria: discovery depth, technical accuracy, objection handling, close quality',
          'Stage-by-stage scoring with specific improvement notes',
          'Technical accuracy check: system sizing, NEM explanation, loan math',
          'Objection handling evaluation: did you pre-empt or react?',
          'Close evaluation: did you get a firm next step?',
          'Final curriculum completion: unlock certification badge',
        ],
      },
    ],
  },
];

// ============================================================================
// RETENTION GATE CONSTANTS
// ============================================================================

/** Score required to advance to the next lesson (strict 100%) */
export const RETENTION_GATE_PASS_SCORE = 100;

/** After this many failed attempts, lesson repeats with new examples */
export const REPEAT_LESSON_THRESHOLD = 2;

/** Number of quiz questions per lesson (3–5 range) */
export const DEFAULT_QUIZ_QUESTION_COUNT = 4;

// ============================================================================
// ADAPTIVE DIFFICULTY THRESHOLDS
// ============================================================================

/** Consecutive first-try perfect scores before upgrading difficulty */
export const UPGRADE_DIFFICULTY_STREAK = 3;

/** Lessons with 3+ attempts before considering difficulty downgrade */
export const STRUGGLE_ATTEMPT_THRESHOLD = 3;

/** Number of struggle lessons before recommending difficulty downgrade */
export const DOWNGRADE_DIFFICULTY_THRESHOLD = 2;

// ============================================================================
// CURRICULUM SEQUENCER CLASS
// ============================================================================

export class SolarCurriculumSequencer {
  private state: CurriculumState;
  private readonly STORAGE_KEY = 'solar_curriculum_state';

  constructor(userId: string) {
    const loaded = this.loadState(userId);
    this.state = loaded ?? this.initializeState(userId);
  }

  // --------------------------------------------------------------------------
  // PUBLIC: NAVIGATION + STATUS
  // --------------------------------------------------------------------------

  /**
   * Returns the full curriculum state for this user.
   */
  getState(): CurriculumState {
    return { ...this.state };
  }

  /**
   * Returns the current active lesson, or null if curriculum is complete.
   */
  getCurrentLesson(): LessonRecord | null {
    for (const mod of this.state.modules) {
      for (const lesson of mod.lessons) {
        if (lesson.status === 'unlocked' || lesson.status === 'in_progress') {
          return { ...lesson };
        }
      }
    }
    return null;
  }

  /**
   * Returns a lesson record by IDs. Returns null if not found.
   */
  getLesson(moduleId: string, lessonId: string): LessonRecord | null {
    const mod = this.state.modules.find((m) => m.moduleId === moduleId);
    if (!mod) return null;
    const lesson = mod.lessons.find((l) => l.lessonId === lessonId);
    return lesson ? { ...lesson } : null;
  }

  /**
   * Returns all lessons for a module with current status.
   */
  getModuleLessons(moduleId: string): LessonRecord[] {
    const mod = this.state.modules.find((m) => m.moduleId === moduleId);
    return mod ? mod.lessons.map((l) => ({ ...l })) : [];
  }

  /**
   * Returns whether a lesson is unlocked (previous lesson passed at 100%).
   * First lesson of first module is always unlocked.
   */
  isLessonUnlocked(moduleId: string, lessonId: string): boolean {
    const lesson = this.getLesson(moduleId, lessonId);
    if (!lesson) return false;
    return lesson.status !== 'locked';
  }

  /**
   * Returns the user's current adaptive difficulty level.
   */
  getDifficultyLevel(): DifficultyLevel {
    return this.state.difficultyLevel;
  }

  /**
   * Computes adaptive difficulty signal based on recent performance.
   */
  getAdaptiveDifficultySignal(): AdaptiveDifficultySignal {
    const allLessons = this.state.modules.flatMap((m) => m.lessons);
    const passedLessons = allLessons.filter((l) => l.status === 'passed');

    // Count consecutive first-try perfect scores (most recent lessons)
    let firstAttemptStreak = 0;
    for (let i = passedLessons.length - 1; i >= 0; i--) {
      if (passedLessons[i].attemptsCount === 1 && passedLessons[i].bestScore === 100) {
        firstAttemptStreak++;
      } else {
        break;
      }
    }

    // Count lessons needing 3+ attempts
    const struggleCount = passedLessons.filter(
      (l) => l.attemptsCount >= STRUGGLE_ATTEMPT_THRESHOLD
    ).length;

    let recommendedLevel: DifficultyLevel = this.state.difficultyLevel;
    let reason = 'Current performance is consistent with difficulty level.';

    if (firstAttemptStreak >= UPGRADE_DIFFICULTY_STREAK) {
      if (this.state.difficultyLevel === 'beginner') {
        recommendedLevel = 'intermediate';
        reason = `Scored 100% on first attempt ${firstAttemptStreak} lessons in a row. Upgrading to intermediate.`;
      } else if (this.state.difficultyLevel === 'intermediate') {
        recommendedLevel = 'advanced';
        reason = `Scored 100% on first attempt ${firstAttemptStreak} lessons in a row. Upgrading to advanced.`;
      }
    } else if (struggleCount >= DOWNGRADE_DIFFICULTY_THRESHOLD) {
      if (this.state.difficultyLevel === 'advanced') {
        recommendedLevel = 'intermediate';
        reason = `${struggleCount} lessons required 3+ attempts. Simplifying to intermediate.`;
      } else if (this.state.difficultyLevel === 'intermediate') {
        recommendedLevel = 'beginner';
        reason = `${struggleCount} lessons required 3+ attempts. Simplifying to beginner.`;
      }
    }

    return {
      currentLevel: this.state.difficultyLevel,
      recommendedLevel,
      reason,
      firstAttemptStreakCount: firstAttemptStreak,
      struggleCount,
    };
  }

  // --------------------------------------------------------------------------
  // PUBLIC: LESSON LIFECYCLE
  // --------------------------------------------------------------------------

  /**
   * Marks a lesson as in-progress. Validates it is currently unlocked.
   * Returns false if the lesson is locked (strict sequence enforced).
   */
  startLesson(moduleId: string, lessonId: string): boolean {
    if (!this.isLessonUnlocked(moduleId, lessonId)) {
      return false;
    }
    this.mutateLessonField(moduleId, lessonId, 'status', 'in_progress');
    this.state.currentModuleId = moduleId;
    this.state.currentLessonId = lessonId;
    this.state.lastActivityAt = Date.now();
    this.saveState();
    return true;
  }

  /**
   * Records time spent on a lesson (in seconds).
   */
  recordTimeSpent(moduleId: string, lessonId: string, seconds: number): void {
    const lesson = this.findLesson(moduleId, lessonId);
    if (lesson) {
      lesson.totalTimeSeconds += seconds;
      this.state.lastActivityAt = Date.now();
      this.saveState();
    }
  }

  /**
   * Processes a quiz attempt result through the retention gate.
   *
   * Rules:
   * - Must score 100% to advance.
   * - Wrong answers trigger re-explanation with a different angle.
   * - After 2 failed attempts: lesson repeats with new examples.
   * - Tracks attempts, time, and questions missed.
   */
  processRetentionGate(
    moduleId: string,
    lessonId: string,
    answeredQuestions: { question: QuizQuestion; selectedOption: 'a' | 'b' | 'c' | 'd' }[]
  ): RetentionGateResult {
    const lesson = this.findLesson(moduleId, lessonId);
    if (!lesson) {
      throw new Error(`Lesson ${moduleId}/${lessonId} not found`);
    }

    // Score the attempt
    const totalQuestions = answeredQuestions.length;
    const missedQuestions: QuizQuestion[] = [];
    let correctCount = 0;

    for (const { question, selectedOption } of answeredQuestions) {
      if (selectedOption === question.correct) {
        correctCount++;
      } else {
        missedQuestions.push(question);
      }
    }

    const score = totalQuestions > 0 ? Math.round((correctCount / totalQuestions) * 100) : 0;
    const passed = score === RETENTION_GATE_PASS_SCORE;

    // Update lesson record
    lesson.attemptsCount += 1;
    lesson.lastAttemptAt = Date.now();
    lesson.missedQuestionIds = missedQuestions.map((q) => q.question.slice(0, 40));

    if (score > lesson.bestScore) {
      lesson.bestScore = score;
    }

    // Determine next action and feedback
    let nextAction: RetentionGateResult['nextAction'];
    let feedbackMessage: string;

    if (passed) {
      lesson.status = 'passed';
      lesson.passedAt = Date.now();
      lesson.bestScore = 100;
      this.unlockNextLesson(moduleId, lessonId);
      this.updateTotalProgress();
      this.applyAdaptiveDifficulty();
      nextAction = 'advance';
      feedbackMessage =
        lesson.attemptsCount === 1
          ? '✅ Perfect score on first attempt! Moving to the next lesson.'
          : `✅ Passed! ${lesson.attemptsCount} attempts total. Moving to the next lesson.`;
    } else if (lesson.attemptsCount >= REPEAT_LESSON_THRESHOLD) {
      lesson.status = 'unlocked'; // Reset to re-attempt with fresh approach
      nextAction = 'repeat_lesson';
      feedbackMessage = `❌ ${missedQuestions.length} question(s) missed after ${lesson.attemptsCount} attempts. The lesson will restart with new examples and a different explanation approach.`;
    } else {
      lesson.status = 'in_progress';
      nextAction = 'retry_different_approach';
      feedbackMessage = `❌ ${missedQuestions.length} question(s) missed. Review the explanation below, then try again. Must score 100% to advance.`;
    }

    this.state.lastActivityAt = Date.now();
    this.saveState();

    return {
      passed,
      score,
      correctCount,
      totalQuestions,
      missedQuestions,
      attemptNumber: lesson.attemptsCount,
      nextAction,
      feedbackMessage,
    };
  }

  // --------------------------------------------------------------------------
  // PUBLIC: PROGRESS
  // --------------------------------------------------------------------------

  /**
   * Returns overall curriculum progress percentage (0–100).
   */
  getTotalProgress(): number {
    return this.state.totalPercentComplete;
  }

  /**
   * Returns a summary of all lessons with most attempts or lowest first-try scores.
   * Used to identify weak areas for Module 5 adaptive pitch.
   */
  getWeakAreas(): LessonRecord[] {
    const allLessons = this.state.modules
      .flatMap((m) => m.lessons)
      .filter((l) => l.status === 'passed' || l.attemptsCount > 0);

    return allLessons
      .filter(
        (l) =>
          l.attemptsCount >= STRUGGLE_ATTEMPT_THRESHOLD ||
          (l.attemptsCount === 1 && l.bestScore < 100)
      )
      .sort((a, b) => b.attemptsCount - a.attemptsCount || a.bestScore - b.bestScore)
      .map((l) => ({ ...l }));
  }

  // --------------------------------------------------------------------------
  // PUBLIC: QUIZ PROMPT BUILDER
  // --------------------------------------------------------------------------

  /**
   * Builds the Claude prompt for generating quiz questions for a lesson.
   * Returns a prompt string ready to send to the Claude API.
   */
  buildQuizPrompt(moduleId: string, lessonId: string): string {
    const lesson = this.getLesson(moduleId, lessonId);
    if (!lesson) throw new Error(`Lesson ${moduleId}/${lessonId} not found`);

    const difficulty = this.state.difficultyLevel;
    const topicList = lesson.topics.join('\n- ');

    return `Generate ${DEFAULT_QUIZ_QUESTION_COUNT} quiz questions for the solar training lesson: "${lesson.title}".

LESSON TOPICS:
- ${topicList}

DIFFICULTY: ${difficulty.toUpperCase()}

STUDENT CONTEXT:
Christian has 3 years of Enphase field experience and holds EES Sales and Design certifications. 
Questions must test APPLICATION, not memorization.

EXAMPLES OF GOOD QUESTIONS (application-based):
✅ "A homeowner has a $280/month SCE bill on TOU-D rate. Their roof faces southwest at 20 degrees. Size their system and calculate panel count."
✅ "A customer wants 12-hour backup for a 4,500W critical load. How many IQ Battery 5P units are required?"
❌ "What does NEM stand for?" (too simple — not allowed)
❌ "Define TOU." (definition only — not allowed)

DIFFICULTY GUIDANCE:
- beginner: single-step calculations, one concept applied, real numbers provided
- intermediate: multi-step calculations, 2+ concepts combined, some ambiguity
- advanced: complex scenarios, competing trade-offs, field judgment required

OUTPUT FORMAT — return ONLY valid JSON, no markdown, no commentary:
[
  {
    "question": "full question text with real numbers",
    "options": ["a) ...", "b) ...", "c) ...", "d) ..."],
    "correct": "a",
    "explanation": "detailed explanation of why the correct answer is right and why distractors are wrong"
  }
]`;
  }

  // --------------------------------------------------------------------------
  // PRIVATE: STATE MANAGEMENT
  // --------------------------------------------------------------------------

  private initializeState(userId: string): CurriculumState {
    const modules: ModuleRecord[] = SOLAR_CURRICULUM.map((modDef, modIndex) => ({
      moduleId: modDef.moduleId,
      title: modDef.title,
      description: modDef.description,
      lessons: modDef.lessons.map((lessonDef, lessonIndex) => ({
        ...lessonDef,
        status: (modIndex === 0 && lessonIndex === 0 ? 'unlocked' : 'locked') as LessonStatus,
        attemptsCount: 0,
        bestScore: 0,
        lastAttemptAt: null,
        totalTimeSeconds: 0,
        missedQuestionIds: [],
        passedAt: null,
      })),
    }));

    return {
      userId,
      difficultyLevel: 'beginner',
      modules,
      totalPercentComplete: 0,
      currentModuleId: 'M1',
      currentLessonId: 'M1L1',
      lastActivityAt: null,
    };
  }

  private findLesson(moduleId: string, lessonId: string): LessonRecord | null {
    const mod = this.state.modules.find((m) => m.moduleId === moduleId);
    if (!mod) return null;
    return mod.lessons.find((l) => l.lessonId === lessonId) ?? null;
  }

  private mutateLessonField<K extends keyof LessonRecord>(
    moduleId: string,
    lessonId: string,
    field: K,
    value: LessonRecord[K]
  ): void {
    const lesson = this.findLesson(moduleId, lessonId);
    if (lesson) {
      lesson[field] = value;
    }
  }

  private unlockNextLesson(moduleId: string, lessonId: string): void {
    let found = false;
    for (const mod of this.state.modules) {
      for (const lesson of mod.lessons) {
        if (found) {
          lesson.status = 'unlocked';
          this.state.currentModuleId = lesson.moduleId;
          this.state.currentLessonId = lesson.lessonId;
          return;
        }
        if (lesson.moduleId === moduleId && lesson.lessonId === lessonId) {
          found = true;
        }
      }
    }
    // If we reach here, this was the last lesson — curriculum complete
    this.state.currentModuleId = null;
    this.state.currentLessonId = null;
  }

  private updateTotalProgress(): void {
    const allLessons = this.state.modules.flatMap((m) => m.lessons);
    const passedCount = allLessons.filter((l) => l.status === 'passed').length;
    this.state.totalPercentComplete =
      allLessons.length > 0 ? Math.round((passedCount / allLessons.length) * 100) : 0;
  }

  private applyAdaptiveDifficulty(): void {
    const signal = this.getAdaptiveDifficultySignal();
    if (signal.recommendedLevel !== signal.currentLevel) {
      this.state.difficultyLevel = signal.recommendedLevel;
    }
  }

  private loadState(userId: string): CurriculumState | null {
    try {
      const key = `${this.STORAGE_KEY}_${userId}`;
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as CurriculumState;
      // Basic validation
      if (!parsed.modules || !Array.isArray(parsed.modules)) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  private saveState(): void {
    try {
      const key = `${this.STORAGE_KEY}_${this.state.userId}`;
      localStorage.setItem(key, JSON.stringify(this.state));
    } catch (error) {
      console.warn('SolarCurriculumSequencer: failed to save state to localStorage', error);
    }
  }
}

// ============================================================================
// SINGLETON FACTORY
// ============================================================================

const instances: Map<string, SolarCurriculumSequencer> = new Map();

export function getSolarCurriculumSequencer(userId: string): SolarCurriculumSequencer {
  if (!instances.has(userId)) {
    instances.set(userId, new SolarCurriculumSequencer(userId));
  }
  return instances.get(userId)!;
}

// ============================================================================
// UTILITY EXPORTS
// ============================================================================

/**
 * Returns a flat ordered list of all 17 lessons in strict sequence.
 */
export function getAllLessonsInOrder(): Array<{
  moduleId: string;
  lessonId: string;
  moduleTitle: string;
  lessonTitle: string;
  position: number;
}> {
  let position = 1;
  const result: ReturnType<typeof getAllLessonsInOrder> = [];
  for (const mod of SOLAR_CURRICULUM) {
    for (const lesson of mod.lessons) {
      result.push({
        moduleId: mod.moduleId,
        lessonId: lesson.lessonId,
        moduleTitle: mod.title,
        lessonTitle: lesson.title,
        position: position++,
      });
    }
  }
  return result;
}

export default {
  SolarCurriculumSequencer,
  getSolarCurriculumSequencer,
  SOLAR_CURRICULUM,
  getAllLessonsInOrder,
  RETENTION_GATE_PASS_SCORE,
  REPEAT_LESSON_THRESHOLD,
  DEFAULT_QUIZ_QUESTION_COUNT,
  UPGRADE_DIFFICULTY_STREAK,
  STRUGGLE_ATTEMPT_THRESHOLD,
  DOWNGRADE_DIFFICULTY_THRESHOLD,
};
