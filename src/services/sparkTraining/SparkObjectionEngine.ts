/**
 * SPARK Objection Engine
 *
 * Core objection bank organized by category + selection strategies.
 * Supports custom objections, difficulty scaling, and analytics tracking.
 * Persists to localStorage and Supabase spark_objections table.
 */

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export type ObjectionCategory =
  | 'PRICE'
  | 'TRUST'
  | 'INERTIA'
  | 'STALL'
  | 'COMPETITION'
  | 'BUDGET'
  | 'OTHER';

export interface Objection {
  id: string;
  text: string;
  category: ObjectionCategory;
  difficulty: 'easy' | 'medium' | 'hard';
  source: 'standard' | 'custom' | 'hunter_derived';
  deliveryPattern: 'direct' | 'implied' | 'question' | 'stated';
  responseHint?: string;
  createdAt?: number;
  usedCount?: number;
}

export interface ObjectionSet {
  objections: Objection[];
  characterType: string;
  difficulty: 'easy' | 'medium' | 'hard';
  selectedCount: number;
}

// ============================================================================
// CORE OBJECTION BANK
// ============================================================================

const STANDARD_OBJECTION_BANK: Objection[] = [
  // PRICE CATEGORY
  {
    id: 'obj_001',
    text: "That's too expensive for this kind of work",
    category: 'PRICE',
    difficulty: 'easy',
    source: 'standard',
    deliveryPattern: 'direct',
    responseHint: 'Clarify value delivered, not hourly rate',
  },
  {
    id: 'obj_002',
    text: 'My current guy charges $55/hr',
    category: 'PRICE',
    difficulty: 'medium',
    source: 'standard',
    deliveryPattern: 'direct',
    responseHint: 'Compare scope/quality, not raw rate',
  },
  {
    id: 'obj_003',
    text: "We're getting 3 quotes — what's your best price?",
    category: 'PRICE',
    difficulty: 'hard',
    source: 'standard',
    deliveryPattern: 'question',
    responseHint: 'Resist race to bottom; hold value',
  },
  {
    id: 'obj_004',
    text: 'Can you do it for free as a trial?',
    category: 'PRICE',
    difficulty: 'hard',
    source: 'standard',
    deliveryPattern: 'question',
    responseHint: 'Professional work = paid work',
  },
  {
    id: 'obj_005',
    text: 'Can you match their price?',
    category: 'PRICE',
    difficulty: 'medium',
    source: 'standard',
    deliveryPattern: 'question',
    responseHint: 'Understand scope difference first',
  },

  // TRUST CATEGORY
  {
    id: 'obj_006',
    text: "You're kind of young for this, aren't you?",
    category: 'TRUST',
    difficulty: 'medium',
    source: 'standard',
    deliveryPattern: 'question',
    responseHint: 'Own age, show competence/license/insurance',
  },
  {
    id: 'obj_007',
    text: 'Do you even have your own license?',
    category: 'TRUST',
    difficulty: 'easy',
    source: 'standard',
    deliveryPattern: 'question',
    responseHint: 'Provide license #, insurance, references',
  },
  {
    id: 'obj_008',
    text: "I've been burned by contractors before",
    category: 'TRUST',
    difficulty: 'hard',
    source: 'standard',
    deliveryPattern: 'implied',
    responseHint: 'Listen empathetically; prove reliability',
  },
  {
    id: 'obj_009',
    text: "What references do you have?",
    category: 'TRUST',
    difficulty: 'easy',
    source: 'standard',
    deliveryPattern: 'question',
    responseHint: 'Provide 3+ recent projects with contact info',
  },
  {
    id: 'obj_010',
    text: "How do I know you actually show up?",
    category: 'TRUST',
    difficulty: 'medium',
    source: 'standard',
    deliveryPattern: 'question',
    responseHint: 'Talk about systems: booking, confirmations, reliability',
  },

  // INERTIA CATEGORY
  {
    id: 'obj_011',
    text: "We already have an electrician",
    category: 'INERTIA',
    difficulty: 'medium',
    source: 'standard',
    deliveryPattern: 'stated',
    responseHint: 'Find the pain: Do they always get through? Happy?',
  },
  {
    id: 'obj_012',
    text: "We're fine right now",
    category: 'INERTIA',
    difficulty: 'easy',
    source: 'standard',
    deliveryPattern: 'stated',
    responseHint: 'Agree, but offer preventative value',
  },
  {
    id: 'obj_013',
    text: "We're not actively looking right now",
    category: 'INERTIA',
    difficulty: 'medium',
    source: 'standard',
    deliveryPattern: 'stated',
    responseHint: 'Plant seed, offer to be on-call',
  },
  {
    id: 'obj_014',
    text: "My brother-in-law does electrical work",
    category: 'INERTIA',
    difficulty: 'hard',
    source: 'standard',
    deliveryPattern: 'stated',
    responseHint: 'Licensed? Insured? For complex jobs, professional needed',
  },

  // STALL CATEGORY
  {
    id: 'obj_015',
    text: "We'll think about it and get back to you",
    category: 'STALL',
    difficulty: 'easy',
    source: 'standard',
    deliveryPattern: 'stated',
    responseHint: 'Get commitment: specific date/time to follow up',
  },
  {
    id: 'obj_016',
    text: "Send me your info and I'll review it",
    category: 'STALL',
    difficulty: 'medium',
    source: 'standard',
    deliveryPattern: 'question',
    responseHint: 'Send + calendar specific follow-up in 3 days',
  },
  {
    id: 'obj_017',
    text: 'Call me back in a few months',
    category: 'STALL',
    difficulty: 'hard',
    source: 'standard',
    deliveryPattern: 'stated',
    responseHint: 'Find urgency: upcoming season, code compliance issues?',
  },
  {
    id: 'obj_018',
    text: "I'll need to ask my boss/GC before committing",
    category: 'STALL',
    difficulty: 'medium',
    source: 'standard',
    deliveryPattern: 'stated',
    responseHint: 'Include decision-maker; move conversation up',
  },

  // COMPETITION CATEGORY
  {
    id: 'obj_019',
    text: "Why should I hire you instead of [competitor]?",
    category: 'COMPETITION',
    difficulty: 'hard',
    source: 'standard',
    deliveryPattern: 'question',
    responseHint: 'Unique value: speed, quality, local presence?',
  },
  {
    id: 'obj_020',
    text: "Your website looks unprofessional",
    category: 'COMPETITION',
    difficulty: 'medium',
    source: 'standard',
    deliveryPattern: 'stated',
    responseHint: 'Acknowledge, redirect: work speaks louder than website',
  },

  // BUDGET CATEGORY
  {
    id: 'obj_021',
    text: "We don't have budget for this right now",
    category: 'BUDGET',
    difficulty: 'easy',
    source: 'standard',
    deliveryPattern: 'stated',
    responseHint: 'Understand timeline; offer phased approach',
  },
  {
    id: 'obj_022',
    text: "That's not in the plan this quarter",
    category: 'BUDGET',
    difficulty: 'medium',
    source: 'standard',
    deliveryPattern: 'stated',
    responseHint: 'Get into next quarter budget cycle',
  },
];

// ============================================================================
// OBJECTION ENGINE CLASS
// ============================================================================

export class SparkObjectionEngine {
  private objections: Objection[] = [];
  private customObjections: Objection[] = [];
  private usageAnalytics: Map<string, number> = new Map();

  constructor() {
    this.objections = [...STANDARD_OBJECTION_BANK];
    this.loadCustomObjections();
    this.loadAnalytics();
  }

  /**
   * Select 2-3 objections appropriate for character type and difficulty
   */
  selectObjections(
    characterType: string,
    difficulty: 'easy' | 'medium' | 'hard',
    count: number = 3
  ): ObjectionSet {
    // Adjust selection based on difficulty
    const difficultyMap = {
      easy: ['easy', 'medium'],
      medium: ['easy', 'medium', 'hard'],
      hard: ['medium', 'hard'],
    };

    const allowedDifficulties = difficultyMap[difficulty];
    const filtered = this.objections.filter((obj) =>
      allowedDifficulties.includes(obj.difficulty)
    );

    // Weight by character type hints
    const weighted = this.weightByCharacterType(filtered, characterType);

    // Select and shuffle
    const selected = this.shuffle(weighted).slice(0, Math.max(2, count));

    return {
      objections: selected,
      characterType,
      difficulty,
      selectedCount: selected.length,
    };
  }

  /**
   * Add a custom objection from user experience
   */
  addCustomObjection(
    text: string,
    category: ObjectionCategory,
    difficulty: 'easy' | 'medium' | 'hard' = 'medium'
  ): Objection {
    const customObj: Objection = {
      id: `custom_${Date.now()}`,
      text,
      category,
      difficulty,
      source: 'custom',
      deliveryPattern: 'direct',
      createdAt: Date.now(),
      usedCount: 0,
    };

    this.customObjections.push(customObj);
    this.saveCustomObjections();

    return customObj;
  }

  /**
   * Track objection usage for analytics
   */
  recordObjectionUsed(objectionId: string): void {
    const current = this.usageAnalytics.get(objectionId) || 0;
    this.usageAnalytics.set(objectionId, current + 1);
    this.saveAnalytics();
  }

  /**
   * Get objections by category
   */
  getByCategory(category: ObjectionCategory): Objection[] {
    return [
      ...this.objections,
      ...this.customObjections,
    ].filter((obj) => obj.category === category);
  }

  /**
   * Get all objections (standard + custom)
   */
  getAllObjections(): Objection[] {
    return [...this.objections, ...this.customObjections];
  }

  /**
   * Get custom objections only
   */
  getCustomObjections(): Objection[] {
    return [...this.customObjections];
  }

  /**
   * Delete custom objection
   */
  deleteCustomObjection(objectionId: string): void {
    this.customObjections = this.customObjections.filter(
      (obj) => obj.id !== objectionId
    );
    this.saveCustomObjections();
  }

  /**
   * Get usage analytics
   */
  getAnalytics(): Record<string, number> {
    return Object.fromEntries(this.usageAnalytics);
  }

  /**
   * Get top objections by usage
   */
  getTopObjections(limit: number = 5): Array<{ objection: Objection; count: number }> {
    return this.getAllObjections()
      .map((obj) => ({
        objection: obj,
        count: this.usageAnalytics.get(obj.id) || 0,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);
  }

  // ========================================================================
  // PRIVATE HELPERS
  // ========================================================================

  /**
   * Weight objections based on character type keywords
   */
  private weightByCharacterType(
    objections: Objection[],
    characterType: string
  ): Objection[] {
    const characterWeights: Record<string, ObjectionCategory[]> = {
      FRIENDLY_HOMEOWNER: ['PRICE', 'BUDGET', 'TRUST'],
      SKEPTICAL_GC: ['TRUST', 'PRICE', 'COMPETITION'],
      PROPERTY_MANAGER_HAS_GUY: ['INERTIA', 'PRICE'],
      HARDBALL_NEGOTIATOR: ['PRICE', 'COMPETITION', 'STALL'],
      NEC_TESTER: ['TRUST', 'COMPETITION'],
      GATEKEEPER_GC: ['COMPETITION', 'PRICE', 'INERTIA'],
    };

    const preferredCategories = characterWeights[characterType] || [
      'PRICE',
      'TRUST',
    ];

    // Sort: preferred categories first, then rest
    return objections.sort((a, b) => {
      const aScore = preferredCategories.indexOf(a.category);
      const bScore = preferredCategories.indexOf(b.category);

      const aWeight = aScore >= 0 ? aScore : 999;
      const bWeight = bScore >= 0 ? bScore : 999;

      return aWeight - bWeight;
    });
  }

  /**
   * Fisher-Yates shuffle
   */
  private shuffle<T>(array: T[]): T[] {
    const arr = [...array];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  /**
   * Load custom objections from localStorage
   */
  private loadCustomObjections(): void {
    try {
      const stored = localStorage.getItem('spark_custom_objections');
      if (stored) {
        this.customObjections = JSON.parse(stored);
      }
    } catch (error) {
      console.warn('Failed to load custom objections from localStorage:', error);
    }
  }

  /**
   * Save custom objections to localStorage
   */
  private saveCustomObjections(): void {
    try {
      localStorage.setItem(
        'spark_custom_objections',
        JSON.stringify(this.customObjections)
      );
    } catch (error) {
      console.warn('Failed to save custom objections to localStorage:', error);
    }
  }

  /**
   * Load usage analytics from localStorage
   */
  private loadAnalytics(): void {
    try {
      const stored = localStorage.getItem('spark_objection_analytics');
      if (stored) {
        const data = JSON.parse(stored);
        this.usageAnalytics = new Map(Object.entries(data));
      }
    } catch (error) {
      console.warn('Failed to load analytics from localStorage:', error);
    }
  }

  /**
   * Save usage analytics to localStorage
   */
  private saveAnalytics(): void {
    try {
      localStorage.setItem(
        'spark_objection_analytics',
        JSON.stringify(Object.fromEntries(this.usageAnalytics))
      );
    } catch (error) {
      console.warn('Failed to save analytics to localStorage:', error);
    }
  }

  /**
   * Sync to Supabase (stub for future integration)
   */
  async syncToSupabase(): Promise<void> {
    // TODO: Implement Supabase sync when ready
    // - POST custom_objections to spark_objections table
    // - POST usage analytics to spark_objection_usage table
    console.log('Supabase sync not yet implemented');
  }
}

// ============================================================================
// SINGLETON INSTANCE
// ============================================================================

let engineInstance: SparkObjectionEngine | null = null;

export function getObjectionEngine(): SparkObjectionEngine {
  if (!engineInstance) {
    engineInstance = new SparkObjectionEngine();
  }
  return engineInstance;
}

// ============================================================================
// NAMED EXPORTS
// ============================================================================

export default {
  SparkObjectionEngine,
  getObjectionEngine,
  STANDARD_OBJECTION_BANK,
};
