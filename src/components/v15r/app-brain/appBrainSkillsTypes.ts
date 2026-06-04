/**
 * APP BRAIN SKILLS TYPES
 * =====================
 *
 * This module defines the type schema for App Brain Skills v1.
 *
 * CRITICAL DISTINCTION:
 * - SKILLS are learned patterns extracted from observations, code structure, or behavior logs.
 *   They represent learned patterns that agents can apply in new contexts.
 * - RULES are governance laws that control behavior. They are prescriptive constraints.
 *
 * This types file is SKILLS-FOCUSED only.
 * Governance rules are defined separately in the v4.0 law stack.
 */

/**
 * Skill ID type - unique identifier for each skill
 * Format: [domain]-[name]-[hash] or auto-generated UUID
 */
export type SkillId = string & { readonly __brand: "SkillId" };

export function createSkillId(id: string): SkillId {
  return id as SkillId;
}

/**
 * Skill Domain categorizes the area of knowledge
 * Examples: code-patterns, deployment, testing, documentation, architecture, etc.
 */
export type SkillDomain =
  | "code-patterns"
  | "deployment"
  | "testing"
  | "documentation"
  | "architecture"
  | "performance"
  | "security"
  | "accessibility"
  | "error-handling"
  | "ui-patterns"
  | "data-flow"
  | "api-design"
  | "config"
  | "build-system"
  | string; // Allow custom domains

/**
 * Skill Trigger defines under what conditions a skill should be considered or applied
 * Examples: "file-pattern-matches", "error-type-matches", "context-keyword-found"
 */
export type SkillTrigger =
  | "file-pattern-matches"
  | "error-type-matches"
  | "context-keyword-found"
  | "architecture-pattern-detected"
  | "manual-observation"
  | "test-failure-pattern"
  | string; // Allow custom triggers

/**
 * Short Rule: a concise, actionable principle derived from the skill
 * Must fit in ~1 sentence. Examples:
 *   - "Always validate component props before render"
 *   - "Use const for objects that won't be reassigned"
 *   - "Wrap async operations in try-catch blocks"
 */
export type ShortRule = string;

/**
 * Source Session: metadata about where the skill was observed/learned
 * Allows tracing back to the original context
 */
export interface SourceSession {
  sessionName: string; // e.g., "appbrain-w01-a3-skills-schema"
  commitHash: string; // Git commit where this skill was added/refined
  timestamp: string; // ISO 8601 timestamp
  notes?: string; // Optional notes about the learning context
}

/**
 * File applicability: which file patterns this skill applies to
 * Uses glob-like patterns
 */
export interface AppliesToFiles {
  include?: string[]; // Glob patterns: ["src/**/*.tsx", "src/components/**"]
  exclude?: string[]; // Glob patterns: ["*.test.ts", "*.spec.ts"]
}

/**
 * Agent applicability: which agents or roles should consider this skill
 */
export interface AppliesToAgents {
  include?: string[]; // Agent names or roles: ["haiku", "sonnet", "app-brain-agent"]
  exclude?: string[]; // Exclude specific agents if needed
}

/**
 * Core Skill Type
 *
 * A skill represents a learned pattern or best practice that can be:
 * - Applied to new code or problems
 * - Refined through observation
 * - Shared across sessions
 * - Evaluated for confidence level
 */
export interface AppBrainSkill {
  // Identity
  id: SkillId;
  name: string; // Human-readable skill name
  domain: SkillDomain;

  // Learning Context
  trigger: SkillTrigger;
  shortRule: ShortRule; // The actionable principle
  sourceSession: SourceSession;

  // Applicability
  appliesToFiles?: AppliesToFiles;
  appliesToAgents?: AppliesToAgents;

  // Status & Confidence
  active: boolean;
  inactive?: boolean; // Explicitly marked as inactive/deprecated
  confidence: number; // 0.0 to 1.0 - how confident is this skill?

  // Lifecycle
  createdAt: string; // ISO 8601 timestamp
  lastUsedAt?: string; // ISO 8601 timestamp - when was this skill last applied?
  lastUpdatedAt?: string; // ISO 8601 timestamp - when was this skill last refined?

  // Optional Details
  description?: string; // Longer explanation of the skill
  examples?: string[]; // Example applications or code snippets
  relatedSkills?: SkillId[]; // References to related skills
  deprecatedReason?: string; // If marked inactive, why?
}

/**
 * Skills Registry Schema
 *
 * Top-level container for all skills, with metadata about the registry itself
 */
export interface AppBrainSkillsRegistry {
  // Metadata
  version: string; // Registry schema version (e.g., "1.0.0")
  createdAt: string; // ISO 8601 timestamp
  lastUpdatedAt: string; // ISO 8601 timestamp
  sourceSession?: SourceSession; // Where this registry was initialized

  // Content
  skills: AppBrainSkill[]; // Array of all skills, initially empty for v1 seed

  // Metadata about the registry
  totalSkills: number;
  activeSkills: number;
  inactiveSkills: number;

  // Notes
  notes?: string; // Registry-level notes or roadmap
}

/**
 * CRITICAL NOTES FOR APP BRAIN ARCHITECTURE:
 *
 * 1. SKILLS vs RULES (NEVER CONFUSE THESE):
 *    - Skills: Learned patterns, best practices, observations. Flexible, learnable, observable.
 *    - Rules: Governance constraints, execution laws. Fixed, enforceable, top-down.
 *
 * 2. This types file defines SKILLS ONLY.
 *    Governance rules are in the v4.0 law stack files.
 *
 * 3. Skills Registry starts EMPTY (clean v1 seed).
 *    Do not import from old PDF archives or legacy skill dumps.
 *    Each skill is added through explicit sessions and observed learning.
 *
 * 4. All timestamps are ISO 8601 format: "2026-06-04T08:45:00Z"
 *
 * 5. Confidence is a number 0.0 (uncertain) to 1.0 (high certainty).
 *    Skills with low confidence (<0.5) should be considered experimental.
 *
 * 6. Source Session traceability allows full audit trail of where each skill came from.
 */
