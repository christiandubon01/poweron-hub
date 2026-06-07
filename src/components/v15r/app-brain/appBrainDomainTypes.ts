/**
 * APP BRAIN DOMAIN TYPES
 * ======================
 *
 * Type definitions for the PowerOn Hub app domain ecosystem.
 * 
 * A domain is a bounded area of functionality within the app.
 * This module defines the structure, relationships, and metadata for all domains.
 *
 * CRITICAL NOTES:
 * - Domains represent ARCHITECTURE/DATA-FLOW relationships ONLY.
 * - No business financial values (revenue, costs, numbers) are included in domain definitions.
 * - Risk levels are technical/architectural, not financial.
 * - Domain metadata serves the App Brain control tower for navigation and insights.
 *
 * Last Updated: 2026-06-07
 */

/**
 * Unique identifier for a domain
 * Format: kebab-case, e.g., "core-shell", "estimate", "money"
 */
export type DomainId = string & { readonly __brand: "DomainId" };

export function createDomainId(id: string): DomainId {
  return id as DomainId;
}

/**
 * All domain identifiers in the PowerOn Hub ecosystem
 */
export type AppDomain =
  | "core-shell"
  | "navigation"
  | "home"
  | "projects"
  | "project-inner"
  | "estimate"
  | "material-takeoff"
  | "field-logs"
  | "graph-dashboard"
  | "money"
  | "settings"
  | "blueprint-pdf"
  | "price-book"
  | "leads-sales"
  | "ai-nexus"
  | "admin-app-brain"
  | "sync-persistence"
  | "integrations";

/**
 * Risk level for a domain based on architectural complexity and criticality
 */
export type DomainRiskLevel = "critical" | "high" | "medium" | "low" | "minimal";

/**
 * Connection type between domains
 */
export type ConnectionType =
  | "data-flow"        // Domain A reads/writes data used by Domain B
  | "orchestration"    // Domain A controls or coordinates Domain B
  | "ui-nesting"       // Domain A contains or embeds Domain B in UI
  | "state-sync"       // Domain A and B share state updates
  | "api-dependency"   // Domain A calls Domain B services
  | "shared-utility"   // Domain A and B use shared utilities
  | "event-driven";    // Domain A emits events consumed by Domain B

/**
 * Domain connection representing a relationship between two domains
 */
export interface DomainConnection {
  /** ID of the connected domain */
  targetDomainId: AppDomain;

  /** Type of relationship */
  connectionType: ConnectionType;

  /** Optional details about the connection */
  description?: string;

  /** Whether this connection is critical (breaking changes impact target) */
  isCritical?: boolean;
}

/**
 * File pattern reference showing which files belong to this domain
 */
export interface DomainFilePattern {
  /** Glob pattern: e.g., "src/components/v15r/*Estimate*" */
  pattern: string;

  /** Type of files: 'component', 'service', 'type', 'hook', 'util', 'style' */
  type: string;

  /** Optional description of what these files do */
  description?: string;
}

/**
 * Animation/visual hint for future 3D scene representation
 * (no actual animation code here — design hint only)
 */
export interface AnimationHint {
  /** Suggested visual placement in 3D space: 'center', 'outer-ring', 'inner-cluster', etc. */
  placementZone?: string;

  /** Suggested visual style: 'solid', 'translucent', 'glow', 'nested', etc. */
  visualStyle?: string;

  /** Suggested color scheme for visual representation */
  colorHint?: string;

  /** Notes for future 3D visualization design */
  notes?: string;
}

/**
 * Core domain definition
 */
export interface AppBrainDomain {
  // Identity
  id: AppDomain;
  label: string;
  description: string;

  // Architecture
  /** IDs of domains this domain connects to */
  connectedDomainIds: DomainConnection[];

  // File ownership
  /** Primary files and patterns that implement this domain */
  primaryFiles: DomainFilePattern[];

  // Risk & Health
  /** Technical risk level (based on complexity, criticality, dependencies) */
  riskLevel: DomainRiskLevel;

  /** Notes if domain touches financial/business metrics (see policy below) */
  hasFinancialNotes?: string;

  // Lifecycle
  /** ISO 8601 timestamp when domain was defined */
  createdAt: string;

  /** ISO 8601 timestamp of last update */
  lastUpdatedAt: string;

  // Future visualization
  /** Design hints for 3D scene visualization in a future enhancement */
  animationHint?: AnimationHint;
}

/**
 * CRITICAL POLICY ON FINANCIAL VALUES
 * ====================================
 *
 * App Brain domain definitions show ARCHITECTURE and DATA-FLOW relationships ONLY.
 *
 * DO NOT INCLUDE in domain definitions:
 * - Revenue figures
 * - Cost values
 * - Profit margins
 * - Actual business financial numbers
 *
 * IF a domain TOUCHES financial data:
 * - Set hasFinancialNotes to a descriptive string like:
 *   "This domain reads/writes monetary values from Supabase.
 *    See V15rCashFlow.tsx for financial logic.
 *    No values are hardcoded here."
 *
 * This keeps the architectural map clean while preserving traceability.
 */

/**
 * Domain ecosystem registry
 */
export interface AppBrainDomainRegistry {
  // Metadata
  version: string;
  createdAt: string;
  lastUpdatedAt: string;

  // Content
  domains: AppBrainDomain[];

  // Statistics
  totalDomains: number;
  domainsByRisk: Record<DomainRiskLevel, number>;

  // Notes
  notes?: string;
}

/**
 * Helper function to create a domain with defaults
 */
export function createAppBrainDomain(
  id: AppDomain,
  label: string,
  description: string,
  options?: Partial<AppBrainDomain>
): AppBrainDomain {
  const now = new Date().toISOString();

  return {
    id,
    label,
    description,
    connectedDomainIds: [],
    primaryFiles: [],
    riskLevel: "medium",
    createdAt: now,
    lastUpdatedAt: now,
    ...options,
  };
}

/**
 * EXPORT SUMMARY
 * ==============
 *
 * This module provides:
 * 1. Type definitions for domains and their relationships
 * 2. A structured way to represent the app's architecture
 * 3. File ownership tracking via patterns
 * 4. Connection/dependency mapping between domains
 * 5. Risk assessment for architectural decisions
 * 6. Animation/visualization hints for future 3D representation
 *
 * Usage:
 * - Import types to define domain structure
 * - Use domain registry to query app architecture
 * - Reference appBrainDomainMap.ts for actual domain data
 */
