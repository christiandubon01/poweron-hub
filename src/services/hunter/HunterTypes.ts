/**
 * HUNTER Agent Types
 * Lead hunting and pipeline intelligence data models
 */

// =====================================================
// Enums
// =====================================================

export enum ScoreTier {
  ELITE = 'elite',
  STRONG = 'strong',
  QUALIFIED = 'qualified',
  EXPANSION = 'expansion',
  ARCHIVED = 'archived',
}

export enum LeadStatus {
  NEW = 'new',
  CONTACTED = 'contacted',
  QUOTED = 'quoted',
  WON = 'won',
  LOST = 'lost',
  DEFERRED = 'deferred',
  ARCHIVED = 'archived',
}

export enum LeadType {
  RESIDENTIAL = 'residential',
  COMMERCIAL = 'commercial',
  SOLAR = 'solar',
  SERVICE = 'service',
  GC_SUB = 'gc_sub',
}

export enum PitchAngle {
  URGENCY = 'urgency',
  PAIN = 'pain',
  OPPORTUNITY = 'opportunity',
  COMPETITOR_GAP = 'competitor_gap',
  RELATIONSHIP = 'relationship',
  SEASONAL = 'seasonal',
  FINANCIAL = 'financial',
}

export enum RuleType {
  PITCH = 'pitch',
  SUPPRESSION = 'suppression',
  URGENCY = 'urgency',
  OBJECTION = 'objection',
  SOURCE = 'source',
  TIMING = 'timing',
}

export enum DebriefsOutcome {
  WON = 'won',
  LOST = 'lost',
}

export enum StudyQueueStatus {
  PENDING = 'pending',
  COMPLETED = 'completed',
}

export enum RuleStatus {
  ACTIVE = 'active',
  ARCHIVED = 'archived',
}

// =====================================================
// Core Interfaces
// =====================================================

/**
 * HunterLead: Main lead record
 */
export interface HunterLead {
  id: string;
  user_id: string;
  source: string; // facebook, google, referral, web, etc.
  source_tag?: string;
  lead_type: LeadType;
  contact_name?: string;
  company_name?: string;
  phone?: string;
  email?: string;
  address?: string;
  city?: string;
  description?: string;
  estimated_value?: number;
  estimated_margin?: number;
  urgency_level?: number; // 1-5
  urgency_reason?: string;
  score: number; // 0-100
  score_tier: ScoreTier;
  score_factors?: Record<string, number>; // {factor: value, ...}
  pitch_script?: string;
  pitch_angle?: PitchAngle;
  comparable_jobs?: string[]; // array of lead IDs
  status: LeadStatus;
  discovered_at?: string; // ISO timestamp
  last_updated?: string; // ISO timestamp
  notes?: string;
  created_at?: string; // ISO timestamp
}

/**
 * HunterScore: Score history and audit trail
 */
export interface HunterScore {
  id: string;
  lead_id: string;
  score: number; // 0-100
  factors?: Record<string, number>; // {recency: 10, quality: 20, fit: 25, ...}
  scored_at?: string; // ISO timestamp
}

/**
 * HunterRule: Pitch, suppression, urgency, objection, source, timing rules
 */
export interface HunterRule {
  id: string;
  user_id: string;
  rule_type: RuleType;
  rule_text: string;
  source_lead_id?: string; // optional reference lead
  version: number;
  status: RuleStatus;
  created_at?: string; // ISO timestamp
  updated_at?: string; // ISO timestamp
}

/**
 * HunterDebrief: Outcome analysis and lesson capture
 */
export interface HunterDebrief {
  id: string;
  lead_id: string;
  outcome: DebriefsOutcome;
  transcript?: string;
  lessons?: Array<{
    lesson: string;
    applied_date?: string;
  }>;
  approved_rules?: Array<{
    rule_id: string;
    rule_type: RuleType;
    rule_text: string;
  }>;
  debriefed_at?: string; // ISO timestamp
  created_at?: string; // ISO timestamp
}

/**
 * StudyTopic: Individual learning item from debrief
 */
export interface StudyTopic {
  id: string;
  user_id: string;
  debrief_id: string;
  topic: string; // objection, pitch_angle, source_quality, timing, etc.
  status: StudyQueueStatus;
  scheduled_for?: string; // ISO timestamp
  completed_at?: string; // ISO timestamp
  created_at?: string; // ISO timestamp
}

/**
 * PlaybookStep: Individual action step in a playbook
 */
export interface PlaybookStep {
  text: string;
  checked: boolean;
  notes?: string;
}

/**
 * HunterPlaybook: Step-by-step action playbook for a lead
 */
export interface HunterPlaybook {
  id: string;
  lead_id: string;
  steps: PlaybookStep[];
  created_at?: string; // ISO timestamp
  updated_at?: string; // ISO timestamp
}

// =====================================================
// Store State & Actions
// =====================================================

/**
 * Filter criteria for lead list
 */
export interface LeadFilter {
  status?: LeadStatus | LeadStatus[];
  score_tier?: ScoreTier | ScoreTier[];
  lead_type?: LeadType | LeadType[];
  source?: string | string[];
  min_score?: number;
  max_score?: number;
  date_range?: {
    from: string; // ISO date
    to: string; // ISO date
  };
}

/**
 * Sort options for lead list
 */
export enum LeadSortBy {
  SCORE_DESC = 'score_desc',
  SCORE_ASC = 'score_asc',
  URGENCY_DESC = 'urgency_desc',
  DISCOVERED_DESC = 'discovered_desc',
  DISCOVERED_ASC = 'discovered_asc',
  ESTIMATED_VALUE_DESC = 'estimated_value_desc',
}

/**
 * HUNTER Store State
 */
export interface HunterStoreState {
  // Data
  leads: HunterLead[];
  rules: HunterRule[];
  studyQueue: StudyTopic[];
  debriefs: Map<string, HunterDebrief>; // lead_id -> debrief
  playbooks: Map<string, HunterPlaybook>; // lead_id -> playbook

  // UI State
  activeFilters: LeadFilter;
  sortBy: LeadSortBy;
  isScanning: boolean;

  // Computed
  leadsFiltered: HunterLead[];
  topLeads: HunterLead[]; // score >= 75
  expansionLeads: HunterLead[]; // score 40-59

  // Actions
  fetchLeads: () => Promise<void>;
  addLead: (lead: Omit<HunterLead, 'id' | 'created_at' | 'user_id'>) => Promise<HunterLead>;
  updateLeadStatus: (leadId: string, status: LeadStatus) => Promise<void>;
  updateLeadScore: (leadId: string, score: number, factors: Record<string, number>) => Promise<void>;
  addRule: (rule: Omit<HunterRule, 'id' | 'user_id' | 'created_at' | 'updated_at'>) => Promise<HunterRule>;
  archiveRule: (ruleId: string) => Promise<void>;
  fetchStudyQueue: () => Promise<void>;
  setActiveFilters: (filters: LeadFilter) => void;
  setSortBy: (sortBy: LeadSortBy) => void;
  setIsScanning: (isScanning: boolean) => void;

  // Internal computed methods
  applyFiltersAndSort: (
    leads: HunterLead[],
    filters: LeadFilter,
    sortBy: LeadSortBy
  ) => void;
  computeScoreTier: (score: number) => ScoreTier;
}

export default HunterLead;
