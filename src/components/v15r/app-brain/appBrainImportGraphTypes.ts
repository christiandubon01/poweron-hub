/**
 * APP BRAIN IMPORT GRAPH OVERLAY TYPES
 * ====================================
 *
 * Type definitions for the import graph overlay data model.
 *
 * This module defines how file imports, dependencies, and relationships
 * are structured to create an overlay atop the domain ecosystem.
 *
 * An import graph overlay:
 * - Shows which files import which other files
 * - Identifies high-touch files (frequently imported or importing)
 * - Detects import risk patterns (circular dependencies, excessive coupling)
 * - Maps files to their domains
 * - Clusters related functionality
 * - Summarizes dependency health and complexity
 *
 * CRITICAL NOTES:
 * - This is a pure data model with no operational/financial values
 * - Risk is technical/architectural only
 * - No live tracking—this is structural analysis metadata
 * - No UI integration—functions return plain data structures
 * - Designed to work with generatedAppBrainManifest and generatedAppBrainDirectory
 *
 * Last Updated: 2026-06-07
 */

/**
 * File path identifier
 */
export type FilePath = string & { readonly __brand: "FilePath" };

export function createFilePath(path: string): FilePath {
  return path as FilePath;
}

/**
 * A node in the import graph representing a single file
 */
export interface ImportGraphNode {
  /** Unique file path */
  filePath: FilePath;

  /** Human-readable label (filename or relative path) */
  label: string;

  /** How many OTHER files import this file */
  importedByCount: number;

  /** How many OTHER files this file imports */
  importsCount: number;

  /** Files that directly import this file */
  importedBy: FilePath[];

  /** Files that this file directly imports */
  imports: FilePath[];

  /** Domain ID this file belongs to (if known) */
  domainId?: string;

  /** File type: 'component', 'service', 'type', 'hook', 'util', 'style', 'other' */
  fileType: string;

  /** Technical risk level based on import graph position */
  riskLevel: "critical" | "high" | "medium" | "low" | "minimal";

  /** Whether this file is in the core/critical path */
  isCritical: boolean;

  /** Number of transitive dependencies (files this file depends on, recursively) */
  transitiveDependencyCount?: number;

  /** Whether this node has detected circular import patterns */
  hasCircularDependency: boolean;
}

/**
 * An edge in the import graph representing a direct import relationship
 */
export interface ImportGraphEdge {
  /** Source file (the one doing the importing) */
  from: FilePath;

  /** Target file (the one being imported) */
  to: FilePath;

  /** Whether this edge is critical (breaking changes in target break source) */
  isCritical: boolean;

  /** Optional: nature of the dependency (type-only, runtime, etc.) */
  dependencyType?: "runtime" | "type-only" | "mixed";
}

/**
 * A cluster of related files grouped by domain or functional area
 */
export interface ImportGraphCluster {
  /** Unique cluster identifier */
  id: string;

  /** Human-readable label */
  label: string;

  /** Nodes in this cluster */
  nodeIds: FilePath[];

  /** Domain this cluster belongs to (if applicable) */
  domainId?: string;

  /** Internal edges (within cluster) */
  internalEdges: number;

  /** External edges (cluster members importing outside) */
  externalIncoming: number;

  /** External edges (outside files importing cluster members) */
  externalOutgoing: number;

  /** Cohesion score: 0-1 (1.0 = fully self-contained) */
  cohesion: number;

  /** Coupling score: 0-1 (0.0 = no external deps) */
  coupling: number;

  /** Risk level of this cluster */
  riskLevel: "critical" | "high" | "medium" | "low" | "minimal";

  /** Notes about this cluster */
  notes?: string;
}

/**
 * Risk assessment for import graph patterns
 */
export interface ImportGraphRisk {
  /** Circular dependency rings detected */
  circularDependencies: FilePath[][];

  /** Files with excessive imports (high in-degree) */
  highImportedFiles: FilePath[];

  /** Files with excessive dependencies (high out-degree) */
  highDependencyFiles: FilePath[];

  /** Files that are import bottlenecks (many things depend on them) */
  bottleneckFiles: FilePath[];

  /** Files with risky isolation (few imports, used nowhere) */
  isolatedFiles: FilePath[];

  /** Overall risk score: 0-1 (1.0 = highest risk) */
  overallRiskScore: number;

  /** Recommendations for risk mitigation */
  recommendations: string[];
}

/**
 * High-touch files are those frequently imported or importing others
 * These are candidates for careful review during changes
 */
export interface HighTouchFile {
  /** File path */
  filePath: FilePath;

  /** Why is this high-touch? (reason/category) */
  reason: "frequently-imported" | "high-fan-out" | "bottleneck" | "critical-path";

  /** Frequency/rank among high-touch files */
  rank: number;

  /** Reason score: how high is the metric? */
  score: number;

  /** Related files (most important imports/importers) */
  relatedFiles: FilePath[];

  /** Recommendation for this file */
  recommendation: string;
}

/**
 * Domain assignment for files
 */
export interface FileToDomainMapping {
  /** File path */
  filePath: FilePath;

  /** Assigned domain ID */
  domainId: string;

  /** Confidence: 0-1 (how certain is the assignment?) */
  confidence: number;

  /** Reason for assignment (pattern match, heuristic, etc.) */
  reason: string;

  /** Alternative domain assignments (if any) */
  alternativeDomains?: { domainId: string; confidence: number }[];
}

/**
 * Summary statistics for the entire import graph overlay
 */
export interface ImportGraphOverlaySummary {
  /** Total files in the graph */
  totalFiles: number;

  /** Total import edges */
  totalEdges: number;

  /** Total clusters identified */
  totalClusters: number;

  /** High-touch files identified */
  highTouchFiles: HighTouchFile[];

  /** Files grouped by domain */
  filesByDomain: Record<string, FilePath[]>;

  /** Overall import graph health: 0-1 (1.0 = healthy/clean) */
  healthScore: number;

  /** Average imports per file */
  avgImportsPerFile: number;

  /** Average imported-by count per file */
  avgImportedByPerFile: number;

  /** Median transitive dependency depth */
  medianTransitiveDependencyDepth?: number;

  /** Percentage of files involved in circular dependencies */
  circularDependencyPercentage: number;

  /** Risk assessment */
  risk: ImportGraphRisk;

  /** Generation timestamp */
  generatedAt: string;

  /** Summary notes */
  notes?: string;
}

/**
 * Complete import graph overlay data structure
 */
export interface ImportGraphOverlay {
  /** Metadata */
  version: string;
  generatedAt: string;

  /** Core graph data */
  nodes: ImportGraphNode[];
  edges: ImportGraphEdge[];
  clusters: ImportGraphCluster[];

  /** Risk and health assessment */
  risk: ImportGraphRisk;

  /** High-touch files for focused review */
  highTouchFiles: HighTouchFile[];

  /** File-to-domain mapping */
  fileToDomainMappings: FileToDomainMapping[];

  /** Summary statistics */
  summary: ImportGraphOverlaySummary;

  /** Implementation notes */
  notes?: string;
}

/**
 * Options for creating import graph overlays
 */
export interface CreateImportGraphOptions {
  /** Include circular dependency detection (can be expensive) */
  detectCircularDependencies?: boolean;

  /** Include transitive dependency counting */
  includeTransitiveDependencies?: boolean;

  /** Minimum edges required to form a cluster */
  clusterMinSize?: number;

  /** Consider only these file types */
  fileTypeFilter?: string[];

  /** Exclude these file patterns from analysis */
  excludePatterns?: string[];

  /** Use existing domain assignments for file-to-domain mapping */
  useDomainMapping?: boolean;

  /** Custom scoring function for risk assessment */
  customRiskScorer?: (node: ImportGraphNode) => number;
}

/**
 * Options for summarizing import graph overlays
 */
export interface SummarizeImportGraphOptions {
  /** Top N high-touch files to include in summary */
  topHighTouchFileCount?: number;

  /** Include risk recommendations */
  includeRecommendations?: boolean;

  /** Minimum confidence for file-to-domain assignments */
  minDomainConfidence?: number;
}

/**
 * EXPORT SUMMARY
 * ==============
 *
 * This module provides type definitions for:
 * 1. Import graph nodes (files with import metrics)
 * 2. Import graph edges (import relationships)
 * 3. Import graph clusters (grouped files)
 * 4. Risk assessment data (circular deps, bottlenecks, etc.)
 * 5. High-touch file identification
 * 6. File-to-domain mapping
 * 7. Summary statistics and overlay composition
 *
 * These types are designed to work with pure helper functions
 * that derive overlay data from generatedAppBrainManifest and
 * generatedAppBrainDirectory without modifying state or running
 * live tracking.
 *
 * Usage:
 * - Import types to define overlay structures
 * - Use helper functions in appBrainImportGraphOverlay.ts to build overlays
 * - Query overlay data for App Brain visualization/analysis
 * - Reference overlay data for refactoring recommendations
 */
