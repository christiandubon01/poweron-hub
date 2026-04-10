/**
 * SolarQuizEngine.ts
 * 
 * Solar Training Quiz Engine with Spaced Repetition
 * - Generates scenario-based questions via Claude API
 * - Implements spaced repetition scheduling
 * - Tracks retention metrics per topic
 * - Manages daily question injection across contexts
 * - Maintains adaptive difficulty based on user performance
 */

export interface QuizQuestion {
  id: string;
  topic: string;
  level: 'beginner' | 'intermediate' | 'advanced';
  question: string;
  scenario_context: string;
  options: QuizOption[];
  explanation: string;
  follow_up_if_wrong: string;
  created_at: number;
  last_tested_at?: number;
  next_test_at?: number;
}

export interface QuizOption {
  text: string;
  correct: boolean;
}

export interface QuizResponse {
  question_id: string;
  correct: boolean;
  attempt: number;
  timestamp: number;
}

export interface RetentionMetrics {
  topic: string;
  first_try_accuracy: number;
  average_attempts: number;
  days_since_last_test: number;
  total_attempts: number;
  correct_attempts: number;
  retention_score: number; // 0-100
  decay_status: 'fresh' | 'fading' | 'overdue';
}

export interface SpacedRepetitionSchedule {
  new_questions: {
    frequency_days: number;
    duration_weeks: number;
  };
  mastered_questions: {
    frequency_days: number;
    duration_weeks: number;
  };
  failed_questions: {
    frequency_days: number;
    retest_angle: boolean; // ask from different angle
  };
}

/**
 * SolarQuizEngine: Main quiz orchestration service
 */
export class SolarQuizEngine {
  private questions: Map<string, QuizQuestion> = new Map();
  private responses: QuizResponse[] = [];
  private metrics: Map<string, RetentionMetrics> = new Map();
  private spacedRepetition: SpacedRepetitionSchedule;
  private userExperience: 'beginner' | 'intermediate' | 'advanced' = 'intermediate';

  constructor() {
    this.spacedRepetition = {
      new_questions: {
        frequency_days: 1,
        duration_weeks: 1,
      },
      mastered_questions: {
        frequency_days: 7,
        duration_weeks: 4,
      },
      failed_questions: {
        frequency_days: 1,
        retest_angle: true,
      },
    };
  }

  /**
   * Generate a quiz question via Claude with application-focused scenario
   * UserContext: Christian has 3 years Enphase field experience
   * Focus: Real scenarios, calculation/decision-making, adaptive difficulty
   */
  async generateQuizQuestion(
    topic: string,
    difficulty: 'beginner' | 'intermediate' | 'advanced'
  ): Promise<QuizQuestion> {
    const systemPrompt = `You are a solar training expert for electrical contractors.
Generate a practical, scenario-based solar training question.
User context: Christian has 3 years Enphase field experience.
Always test APPLICATION and DECISION-MAKING, not just definitions.
Return ONLY valid JSON, no markdown.`;

    const userPrompt = `Generate a solar training quiz question for: ${topic}
Difficulty: ${difficulty}

Return this exact JSON structure (no markdown, no code blocks):
{
  "question": "Clear question statement",
  "scenario_context": "Real-world scenario (2-3 sentences)",
  "options": [
    {"text": "Option A", "correct": true},
    {"text": "Option B", "correct": false},
    {"text": "Option C", "correct": false},
    {"text": "Option D", "correct": false}
  ],
  "explanation": "Why the answer is correct (1-2 sentences)",
  "follow_up_if_wrong": "If wrong, explain the correct approach (2-3 sentences)"
}`;

    try {
      // Mock implementation - in production, call actual Claude API
      const mockResponse = this.generateMockQuestion(topic, difficulty);
      
      const questionId = `q_${Date.now()}_${Math.random().toString(36).substring(7)}`;
      const question: QuizQuestion = {
        id: questionId,
        topic,
        level: difficulty,
        question: mockResponse.question,
        scenario_context: mockResponse.scenario_context,
        options: mockResponse.options,
        explanation: mockResponse.explanation,
        follow_up_if_wrong: mockResponse.follow_up_if_wrong,
        created_at: Date.now(),
      };

      this.questions.set(questionId, question);
      return question;
    } catch (error) {
      console.error('Failed to generate quiz question:', error);
      throw error;
    }
  }

  /**
   * Record a quiz response and update retention metrics
   */
  recordResponse(
    question_id: string,
    correct: boolean,
    attempt: number = 1
  ): void {
    const response: QuizResponse = {
      question_id,
      correct,
      attempt,
      timestamp: Date.now(),
    };

    this.responses.push(response);

    const question = this.questions.get(question_id);
    if (question) {
      question.last_tested_at = Date.now();
      this.updateRetentionMetrics(question);
    }
  }

  /**
   * Calculate retention metrics for a topic
   */
  private updateRetentionMetrics(question: QuizQuestion): void {
    const topicResponses = this.responses.filter(
      r => this.questions.get(r.question_id)?.topic === question.topic
    );

    if (topicResponses.length === 0) return;

    const correctCount = topicResponses.filter(r => r.correct).length;
    const totalCount = topicResponses.length;
    const firstTryCorrect = topicResponses.filter(
      r => r.correct && r.attempt === 1
    ).length;

    const avgAttempts =
      topicResponses.reduce((sum, r) => sum + r.attempt, 0) / totalCount;

    const lastTest = question.last_tested_at || Date.now();
    const daysSinceLastTest = Math.floor((Date.now() - lastTest) / (24 * 60 * 60 * 1000));

    // Retention score: 0-100 based on accuracy and recency
    let retentionScore = (correctCount / totalCount) * 100;
    
    // Apply decay: lose 5% per day without testing
    const decayFactor = Math.max(0, 1 - (daysSinceLastTest * 0.05));
    retentionScore = retentionScore * decayFactor;

    // Determine decay status
    let decay_status: 'fresh' | 'fading' | 'overdue' = 'fresh';
    if (daysSinceLastTest > 14) {
      decay_status = 'overdue';
    } else if (daysSinceLastTest > 7) {
      decay_status = 'fading';
    }

    const metrics: RetentionMetrics = {
      topic: question.topic,
      first_try_accuracy: firstTryCorrect / totalCount,
      average_attempts: avgAttempts,
      days_since_last_test: daysSinceLastTest,
      total_attempts: totalCount,
      correct_attempts: correctCount,
      retention_score: Math.round(retentionScore),
      decay_status,
    };

    this.metrics.set(question.topic, metrics);
  }

  /**
   * Get questions for daily injection
   * Returns: 1 question for morning brief, 1 for between-job micro-quiz, 3-5 for end-of-day
   */
  getDailyQuestions(): {
    morning_brief: QuizQuestion | null;
    between_job_micro: QuizQuestion | null;
    end_of_day_review: QuizQuestion[];
  } {
    const now = Date.now();
    const scheduledQuestions = Array.from(this.questions.values()).filter(
      q => !q.next_test_at || q.next_test_at <= now
    );

    // Sort by priority: failed > fading > fresh
    scheduledQuestions.sort((a, b) => {
      const aMetrics = this.metrics.get(a.topic);
      const bMetrics = this.metrics.get(b.topic);

      const aPriority = this.getQuestionPriority(aMetrics);
      const bPriority = this.getQuestionPriority(bMetrics);

      return bPriority - aPriority;
    });

    return {
      morning_brief: scheduledQuestions[0] || null,
      between_job_micro: scheduledQuestions[1] || null,
      end_of_day_review: scheduledQuestions.slice(2, 7), // Up to 5
    };
  }

  /**
   * Calculate next test time based on response and retention
   */
  scheduleNextTest(question_id: string, correct: boolean): void {
    const question = this.questions.get(question_id);
    if (!question) return;

    const metrics = this.metrics.get(question.topic);
    const now = Date.now();
    let daysUntilNextTest = 1;

    if (correct) {
      // Mastered: test weekly for 4 weeks
      const testCount = this.responses.filter(
        r => this.questions.get(r.question_id)?.topic === question.topic
      ).length;

      if (testCount >= 7) {
        // After 4 weeks of mastery
        daysUntilNextTest = 30; // Monthly
      } else if (metrics && metrics.retention_score >= 90) {
        daysUntilNextTest = 7; // Weekly
      } else {
        daysUntilNextTest = 1; // First week: daily
      }
    } else {
      // Failed: retest next day with different angle
      daysUntilNextTest = 1;
    }

    question.next_test_at = now + daysUntilNextTest * 24 * 60 * 60 * 1000;
  }

  /**
   * Get retention heatmap data
   * Returns metrics grid: topics × time periods
   */
  getRetentionHeatmap(): {
    topics: string[];
    periods: Array<{
      label: string;
      daysAgo: number;
    }>;
    data: Array<Array<RetentionMetrics | null>>;
  } {
    const topics = Array.from(new Set(Array.from(this.questions.values()).map(q => q.topic)));
    
    const periods = [
      { label: 'This week', daysAgo: 0 },
      { label: 'Last week', daysAgo: 7 },
      { label: '2 weeks ago', daysAgo: 14 },
      { label: '1 month ago', daysAgo: 30 },
    ];

    const data: Array<Array<RetentionMetrics | null>> = topics.map(topic => {
      return periods.map(period => {
        const metrics = this.metrics.get(topic);
        
        if (!metrics) return null;

        // Check if metric falls within period window
        const metricsInPeriod =
          metrics.days_since_last_test >= period.daysAgo - 7 &&
          metrics.days_since_last_test <= period.daysAgo;

        return metricsInPeriod ? metrics : null;
      });
    });

    return { topics, periods, data };
  }

  /**
   * Get all retention metrics
   */
  getMetrics(): Map<string, RetentionMetrics> {
    return this.metrics;
  }

  /**
   * Internal: Calculate priority score for question scheduling
   */
  private getQuestionPriority(metrics?: RetentionMetrics): number {
    if (!metrics) return 1; // New questions
    
    if (metrics.decay_status === 'overdue') return 3;
    if (metrics.decay_status === 'fading') return 2;
    return 1;
  }

  /**
   * Mock question generator for development
   */
  private generateMockQuestion(
    topic: string,
    difficulty: 'beginner' | 'intermediate' | 'advanced'
  ) {
    const questions: Record<string, Record<string, any>> = {
      'microinverter_sizing': {
        beginner: {
          question: 'What is the correct cable size for a 20A circuit?',
          scenario_context: 'You are installing a microinverter system on a residential roof. The circuit requires 20A continuous current.',
          options: [
            { text: '12 AWG', correct: true },
            { text: '14 AWG', correct: false },
            { text: '10 AWG', correct: false },
            { text: '8 AWG', correct: false },
          ],
          explanation: 'According to NEC Article 310, a 20A circuit requires 12 AWG minimum.',
          follow_up_if_wrong: 'Always reference NEC tables. The ampacity of 12 AWG is 20A at 60°C ambient.',
        },
        intermediate: {
          question: 'How do you calculate the correct DC-side wire gauge for a 7kW array?',
          scenario_context: 'A customer wants a 7kW Enphase system. You need to size the DC wiring from the array to the combiner.',
          options: [
            { text: '10 AWG with 125% current rule applied', correct: true },
            { text: '12 AWG directly', correct: false },
            { text: '8 AWG always for 7kW', correct: false },
            { text: 'Ampacity tables don\'t apply to DC', correct: false },
          ],
          explanation: 'Apply 125% of array ISC per NEC 690.8(A). With Enphase, each string may have lower current but still apply the rule.',
          follow_up_if_wrong: 'NEC 125% rule is mandatory for solar arrays. Calculate: ISC × 1.25 × 1.25 (temperature) to get minimum ampacity needed.',
        },
        advanced: {
          question: 'Why does Enphase require 6 AWG DC-side wiring on a 4-microinverter string despite calculated lower ampacity?',
          scenario_context: 'You are designing a complex rooftop with 40 microinverters across 4 parallel strings. Calculations show 12 AWG is sufficient.',
          options: [
            { text: 'Enphase over-engineers for margin of safety and future upgrades', correct: true },
            { text: 'Voltage drop requirements force larger gauge', correct: false },
            { text: 'Building codes require oversizing in all solar', correct: false },
            { text: 'The installer made an error', correct: false },
          ],
          explanation: 'Enphase applies safety margin and field experience. Oversizing wire reduces resistive losses and provides upgrade headroom.',
          follow_up_if_wrong: 'Conservative design in solar is not over-engineering—it\'s protection against field conditions, temperature extremes, and future expansion.',
        },
      },
      'enphase_interconnect': {
        beginner: {
          question: 'In Enphase systems, what does the IQ Combiner do?',
          scenario_context: 'You are explaining the system components to a homeowner.',
          options: [
            { text: 'Combines AC output from multiple microinverters into one feed to the main panel', correct: true },
            { text: 'Combines DC voltage from the array', correct: false },
            { text: 'Stores energy temporarily', correct: false },
            { text: 'Monitors only power production', correct: false },
          ],
          explanation: 'The IQ Combiner consolidates AC power from all microinverters on one circuit to the main service panel.',
          follow_up_if_wrong: 'Enphase is an AC architecture. Each microinverter converts DC to AC individually, then combiners bring AC feeds together.',
        },
      },
    };

    const topicData = questions[topic] || questions['microinverter_sizing'];
    return topicData[difficulty] || topicData.beginner;
  }
}

/**
 * Singleton instance
 */
let solarQuizEngineInstance: SolarQuizEngine | null = null;

export function getSolarQuizEngine(): SolarQuizEngine {
  if (!solarQuizEngineInstance) {
    solarQuizEngineInstance = new SolarQuizEngine();
  }
  return solarQuizEngineInstance;
}
