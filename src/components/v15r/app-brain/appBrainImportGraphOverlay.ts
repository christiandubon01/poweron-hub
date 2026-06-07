/**
 * APP BRAIN IMPORT GRAPH OVERLAY HELPERS
 * ======================================
 *
 * Pure helper functions for building import graph overlay data.
 *
 * These functions take manifest/directory data and produce overlay structures.
 * They are stateless, functional, and designed for composition.
 *
 * No side effects. No live tracking. No UI integration.
 *
 * Last Updated: 2026-06-07
 */

import {
  ImportGraphNode,
  ImportGraphEdge,
  ImportGraphCluster,
  ImportGraphRisk,
  HighTouchFile,
  FileToDomainMapping,
  ImportGraphOverlay,
  ImportGraphOverlaySummary,
  CreateImportGraphOptions,
  SummarizeImportGraphOptions,
  FilePath,
  createFilePath,
} from "./appBrainImportGraphTypes";

/**
 * createImportGraphOverlay
 *
 * Build a complete import graph overlay from manifest data.
 *
 * Input: manifest with files and import counts
 * Output: structured overlay with nodes, edges, clusters, risk assessment
 *
 * @param manifestFiles - File entries from generatedAppBrainManifest
 * @param options - Configuration for overlay creation
 * @returns Complete ImportGraphOverlay structure
 */
export function createImportGraphOverlay(
  manifestFiles: Array<{
    path: string;
    area?: string;
    importCount?: number;
    localImportCount?: number;
    imports?: string[];
  }>,
  options: CreateImportGraphOptions = {}
): ImportGraphOverlay {
  const {
    detectCircularDependencies = false,
    includeTransitiveDependencies = true,
    clusterMinSize = 3,
    fileTypeFilter = undefined,
    excludePatterns = [],
    useDomainMapping = false,
    customRiskScorer = undefined,
  } = options;

  // Filter files
  const filteredFiles = manifestFiles.filter((f) => {
    // Check exclude patterns
    if (excludePatterns.some((pat) => f.path.includes(pat))) {
      return false;
    }
    // Check file type filter
    if (fileTypeFilter && fileTypeFilter.length > 0) {
      const type = inferFileType(f.path);
      if (!fileTypeFilter.includes(type)) {
        return false;
      }
    }
    return true;
  });

  // Build nodes
  const nodes = filteredFiles.map((f) =>
    createImportGraphNode(f, customRiskScorer)
  );

  // Build edges
  const edges = createImportGraphEdges(filteredFiles);

  // Detect circular dependencies if requested
  const circularDeps = detectCircularDependencies
    ? detectCircularImports(edges)
    : [];

  // Update nodes with circular dependency info
  const nodesWithCircularInfo = nodes.map((n) => ({
    ...n,
    hasCircularDependency: circularDeps.some((ring) =>
      ring.includes(n.filePath)
    ),
  }));

  // Build clusters
  const clusters = createImportGraphClusters(
    nodesWithCircularInfo,
    edges,
    clusterMinSize
  );

  // Assess risk
  const risk = inferImportGraphRisk(
    nodesWithCircularInfo,
    edges,
    circularDeps
  );

  // Identify high-touch files
  const highTouchFiles = rankHighTouchFiles(nodesWithCircularInfo, edges);

  // Map files to domains
  const fileToDomainMappings = mapFilesToDomains(
    nodesWithCircularInfo,
    useDomainMapping
  );

  // Build summary
  const summary = buildImportGraphOverlaySummary(
    nodesWithCircularInfo,
    edges,
    clusters,
    risk,
    highTouchFiles,
    fileToDomainMappings
  );

  return {
    version: "import-graph-overlay-v1",
    generatedAt: new Date().toISOString(),
    nodes: nodesWithCircularInfo,
    edges,
    clusters,
    risk,
    highTouchFiles,
    fileToDomainMappings,
    summary,
    notes: `Import graph overlay created from ${filteredFiles.length} files with ${edges.length} edges.`,
  };
}

/**
 * createImportGraphNode
 *
 * Create a node from a manifest file entry.
 *
 * @param file - File from manifest
 * @param customRiskScorer - Optional risk scoring function
 * @returns ImportGraphNode
 */
function createImportGraphNode(
  file: {
    path: string;
    area?: string;
    importCount?: number;
    localImportCount?: number;
    imports?: string[];
  },
  customRiskScorer?: (node: ImportGraphNode) => number
): ImportGraphNode {
  const filePath = createFilePath(file.path);
  const label = extractLabel(file.path);
  const fileType = inferFileType(file.path);

  const importedByCount = file.importCount || 0;
  const importsCount = (file.imports?.length || 0) + (file.localImportCount || 0);

  const baseNode: ImportGraphNode = {
    filePath,
    label,
    importedByCount,
    importsCount,
    importedBy: [],
    imports: file.imports?.map((p) => createFilePath(p)) || [],
    domainId: inferDomainFromPath(file.path),
    fileType,
    riskLevel: "medium",
    isCritical: false,
    hasCircularDependency: false,
  };

  // Calculate risk level
  const riskScore = customRiskScorer
    ? customRiskScorer(baseNode)
    : calculateNodeRisk(baseNode);

  const riskLevel = scoreToRiskLevel(riskScore);

  // Determine if critical
  const isCritical =
    importedByCount > 10 || (importsCount > 15 && riskLevel !== "minimal");

  return {
    ...baseNode,
    riskLevel,
    isCritical,
  };
}

/**
 * createImportGraphEdges
 *
 * Build edges from manifest import data.
 *
 * @param files - Files from manifest
 * @returns ImportGraphEdge[]
 */
function createImportGraphEdges(
  files: Array<{
    path: string;
    imports?: string[];
  }>
): ImportGraphEdge[] {
  const edges: ImportGraphEdge[] = [];

  files.forEach((file) => {
    if (file.imports && file.imports.length > 0) {
      file.imports.forEach((importPath) => {
        edges.push({
          from: createFilePath(file.path),
          to: createFilePath(importPath),
          isCritical: false, // Could be refined based on file type
        });
      });
    }
  });

  return edges;
}

/**
 * detectCircularImports
 *
 * Detect circular dependencies in import graph.
 * Returns rings of files that import each other.
 *
 * @param edges - Import edges
 * @returns Array of circular dependency rings
 */
function detectCircularImports(edges: ImportGraphEdge[]): FilePath[][] {
  const graph: Map<FilePath, FilePath[]> = new Map();

  // Build adjacency list
  edges.forEach((edge) => {
    if (!graph.has(edge.from)) {
      graph.set(edge.from, []);
    }
    graph.get(edge.from)!.push(edge.to);
  });

  const rings: FilePath[][] = [];
  const visited = new Set<FilePath>();
  const recursionStack = new Set<FilePath>();

  const dfs = (node: FilePath, path: FilePath[]): void => {
    visited.add(node);
    recursionStack.add(node);
    path.push(node);

    const neighbors = graph.get(node) || [];
    for (const neighbor of neighbors) {
      if (!visited.has(neighbor)) {
        dfs(neighbor, [...path]);
      } else if (recursionStack.has(neighbor)) {
        // Found a cycle
        const cycleStart = path.indexOf(neighbor);
        if (cycleStart >= 0) {
          rings.push([...path.slice(cycleStart), neighbor]);
        }
      }
    }

    recursionStack.delete(node);
  };

  graph.forEach((_, node) => {
    if (!visited.has(node)) {
      dfs(node, []);
    }
  });

  return rings;
}

/**
 * createImportGraphClusters
 *
 * Group files into clusters based on connectivity and domain.
 *
 * @param nodes - Import graph nodes
 * @param edges - Import graph edges
 * @param minSize - Minimum files per cluster
 * @returns ImportGraphCluster[]
 */
function createImportGraphClusters(
  nodes: ImportGraphNode[],
  edges: ImportGraphEdge[],
  minSize: number
): ImportGraphCluster[] {
  const clusters: ImportGraphCluster[] = [];

  // Group by domain
  const nodesByDomain = new Map<string | undefined, ImportGraphNode[]>();
  nodes.forEach((n) => {
    const domain = n.domainId || "unassigned";
    if (!nodesByDomain.has(domain)) {
      nodesByDomain.set(domain, []);
    }
    nodesByDomain.get(domain)!.push(n);
  });

  let clusterId = 0;

  nodesByDomain.forEach((clusterNodes, domain) => {
    if (clusterNodes.length < minSize) {
      return; // Skip small clusters
    }

    const nodeIds = clusterNodes.map((n) => n.filePath);

    // Count internal/external edges
    let internalEdges = 0;
    let externalIncoming = 0;
    let externalOutgoing = 0;

    edges.forEach((edge) => {
      const fromInCluster = nodeIds.includes(edge.from);
      const toInCluster = nodeIds.includes(edge.to);

      if (fromInCluster && toInCluster) {
        internalEdges++;
      } else if (!fromInCluster && toInCluster) {
        externalIncoming++;
      } else if (fromInCluster && !toInCluster) {
        externalOutgoing++;
      }
    });

    // Calculate metrics
    const totalEdges = internalEdges + externalIncoming + externalOutgoing;
    const cohesion =
      totalEdges > 0 ? internalEdges / (internalEdges + externalIncoming) : 0;
    const coupling =
      internalEdges + externalOutgoing > 0
        ? externalOutgoing / (internalEdges + externalOutgoing)
        : 0;

    // Risk based on cohesion/coupling
    const riskLevel =
      cohesion < 0.3 && coupling > 0.7
        ? "critical"
        : cohesion < 0.5 && coupling > 0.5
          ? "high"
          : cohesion > 0.7 && coupling < 0.3
            ? "minimal"
            : "medium";

    clusters.push({
      id: `cluster-${clusterId}`,
      label: domain === "unassigned" ? "Unassigned Files" : `${domain} Cluster`,
      nodeIds,
      domainId: domain === "unassigned" ? undefined : (domain as string),
      internalEdges,
      externalIncoming,
      externalOutgoing,
      cohesion,
      coupling,
      riskLevel,
    });

    clusterId++;
  });

  return clusters;
}

/**
 * rankHighTouchFiles
 *
 * Identify files that are frequently imported or import many others.
 *
 * @param nodes - Import graph nodes
 * @param edges - Import graph edges
 * @returns HighTouchFile[]
 */
export function rankHighTouchFiles(
  nodes: ImportGraphNode[],
  edges: ImportGraphEdge[]
): HighTouchFile[] {
  const highTouchCandidates: Array<{
    filePath: FilePath;
    reason: "frequently-imported" | "high-fan-out" | "bottleneck" | "critical-path";
    score: number;
    relatedFiles: FilePath[];
  }> = [];

  nodes.forEach((node) => {
    // Frequently imported
    if (node.importedByCount > 5) {
      highTouchCandidates.push({
        filePath: node.filePath,
        reason: "frequently-imported",
        score: node.importedByCount,
        relatedFiles: node.importedBy.slice(0, 5),
      });
    }

    // High fan-out (imports many files)
    if (node.importsCount > 10) {
      highTouchCandidates.push({
        filePath: node.filePath,
        reason: "high-fan-out",
        score: node.importsCount,
        relatedFiles: node.imports.slice(0, 5),
      });
    }

    // Bottleneck (high in + out degree)
    const totalDegree = node.importedByCount + node.importsCount;
    if (totalDegree > 20 && node.importedByCount > 0 && node.importsCount > 0) {
      highTouchCandidates.push({
        filePath: node.filePath,
        reason: "bottleneck",
        score: totalDegree,
        relatedFiles: [...node.importedBy, ...node.imports].slice(0, 5),
      });
    }

    // Critical path
    if (node.isCritical) {
      highTouchCandidates.push({
        filePath: node.filePath,
        reason: "critical-path",
        score: 15,
        relatedFiles: node.importedBy.slice(0, 3),
      });
    }
  });

  // Deduplicate and rank
  const uniqueFiles = new Map<FilePath, typeof highTouchCandidates[0]>();
  highTouchCandidates.forEach((item) => {
    if (!uniqueFiles.has(item.filePath)) {
      uniqueFiles.set(item.filePath, item);
    } else {
      const existing = uniqueFiles.get(item.filePath)!;
      if (item.score > existing.score) {
        uniqueFiles.set(item.filePath, item);
      }
    }
  });

  return Array.from(uniqueFiles.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, 20)
    .map((item, index) => ({
      filePath: item.filePath,
      reason: item.reason,
      rank: index + 1,
      score: item.score,
      relatedFiles: item.relatedFiles,
      recommendation: generateHighTouchRecommendation(
        item.reason,
        item.score
      ),
    }));
}

/**
 * inferImportGraphRisk
 *
 * Assess overall risk in the import graph.
 *
 * @param nodes - Import graph nodes
 * @param edges - Import graph edges
 * @param circularDeps - Circular dependencies found
 * @returns ImportGraphRisk
 */
export function inferImportGraphRisk(
  nodes: ImportGraphNode[],
  edges: ImportGraphEdge[],
  circularDeps: FilePath[][]
): ImportGraphRisk {
  // High import files
  const highImportedFiles = nodes
    .filter((n) => n.importedByCount > 8)
    .sort((a, b) => b.importedByCount - a.importedByCount)
    .slice(0, 10)
    .map((n) => n.filePath);

  // High dependency files
  const highDependencyFiles = nodes
    .filter((n) => n.importsCount > 12)
    .sort((a, b) => b.importsCount - a.importsCount)
    .slice(0, 10)
    .map((n) => n.filePath);

  // Bottleneck files
  const bottleneckFiles = nodes
    .filter(
      (n) =>
        n.importedByCount > 5 &&
        n.importsCount > 5 &&
        n.importedByCount * n.importsCount > 50
    )
    .sort(
      (a, b) =>
        b.importedByCount * b.importsCount -
        a.importedByCount * a.importsCount
    )
    .slice(0, 8)
    .map((n) => n.filePath);

  // Isolated files
  const isolatedFiles = nodes
    .filter((n) => n.importedByCount === 0 && n.importsCount > 0)
    .slice(0, 10)
    .map((n) => n.filePath);

  // Risk score calculation
  const circularRiskFactor = circularDeps.length > 0 ? 0.3 : 0;
  const bottleneckRiskFactor = bottleneckFiles.length > 5 ? 0.2 : 0.1;
  const highDepRiskFactor = highDependencyFiles.length > 5 ? 0.2 : 0.05;
  const isolatedRiskFactor = isolatedFiles.length > 10 ? 0.15 : 0.05;

  const overallRiskScore = Math.min(
    1.0,
    circularRiskFactor +
      bottleneckRiskFactor +
      highDepRiskFactor +
      isolatedRiskFactor
  );

  const recommendations: string[] = [];
  if (circularDeps.length > 0) {
    recommendations.push(
      `${circularDeps.length} circular dependency ring(s) detected. Consider refactoring affected files.`
    );
  }
  if (bottleneckFiles.length > 5) {
    recommendations.push(
      `${bottleneckFiles.length} bottleneck files found. These are high-touch and should be reviewed carefully.`
    );
  }
  if (highDependencyFiles.length > 5) {
    recommendations.push(
      `${highDependencyFiles.length} files have excessive dependencies. Consider extracting utilities.`
    );
  }
  if (overallRiskScore > 0.6) {
    recommendations.push(
      "High overall import graph risk. Consider architectural refactoring."
    );
  }

  return {
    circularDependencies: circularDeps,
    highImportedFiles,
    highDependencyFiles,
    bottleneckFiles,
    isolatedFiles,
    overallRiskScore,
    recommendations,
  };
}

/**
 * mapFilesToDomains
 *
 * Assign files to domains based on path patterns and heuristics.
 *
 * @param nodes - Import graph nodes
 * @param useMappings - Whether to use domain mappings from nodes
 * @returns FileToDomainMapping[]
 */
export function mapFilesToDomains(
  nodes: ImportGraphNode[],
  useMappings: boolean = false
): FileToDomainMapping[] {
  return nodes.map((node) => {
    const inferred = node.domainId || inferDomainFromPath(node.filePath);
    const confidence = computeDomainConfidence(node.filePath, inferred);
    const reason = computeDomainReason(node.filePath, inferred);

    return {
      filePath: node.filePath,
      domainId: inferred,
      confidence,
      reason,
    };
  });
}

/**
 * summarizeImportGraphOverlay
 *
 * Create a concise summary of an import graph overlay.
 *
 * @param overlay - Full ImportGraphOverlay
 * @param options - Summarization options
 * @returns Simplified summary
 */
export function summarizeImportGraphOverlay(
  overlay: ImportGraphOverlay,
  options: SummarizeImportGraphOptions = {}
): {
  totalFiles: number;
  totalEdges: number;
  healthScore: number;
  topHighTouchFiles: HighTouchFile[];
  riskLevel: string;
  recommendations: string[];
} {
  const {
    topHighTouchFileCount = 10,
    includeRecommendations = true,
  } = options;

  const topHighTouch = overlay.highTouchFiles.slice(0, topHighTouchFileCount);

  const riskLevel =
    overlay.risk.overallRiskScore > 0.7
      ? "critical"
      : overlay.risk.overallRiskScore > 0.5
        ? "high"
        : overlay.risk.overallRiskScore > 0.3
          ? "medium"
          : "low";

  return {
    totalFiles: overlay.summary.totalFiles,
    totalEdges: overlay.summary.totalEdges,
    healthScore: overlay.summary.healthScore,
    topHighTouchFiles: topHighTouch,
    riskLevel,
    recommendations: includeRecommendations
      ? overlay.risk.recommendations.slice(0, 5)
      : [],
  };
}

/**
 * HELPER FUNCTIONS
 * ================
 */

function extractLabel(filePath: string): string {
  return filePath.split("/").pop() || filePath;
}

function inferFileType(
  filePath: string
): "component" | "service" | "type" | "hook" | "util" | "style" | "other" {
  if (filePath.includes(".tsx") || filePath.includes(".jsx")) {
    if (filePath.includes("hook")) return "hook";
    return "component";
  }
  if (filePath.includes(".ts") && filePath.includes("type")) return "type";
  if (filePath.includes("service") || filePath.includes("api")) return "service";
  if (filePath.includes("util") || filePath.includes("helper")) return "util";
  if (filePath.includes(".css") || filePath.includes(".scss")) return "style";
  if (filePath.includes(".ts")) return "type";
  return "other";
}

function inferDomainFromPath(filePath: string): string {
  if (filePath.includes("estimate")) return "estimate";
  if (filePath.includes("material-takeoff")) return "material-takeoff";
  if (filePath.includes("field-log")) return "field-logs";
  if (filePath.includes("project")) return "projects";
  if (filePath.includes("money") || filePath.includes("cash-flow"))
    return "money";
  if (filePath.includes("price-book")) return "price-book";
  if (filePath.includes("blueprint")) return "blueprint-pdf";
  if (filePath.includes("app-brain") || filePath.includes("admin"))
    return "admin-app-brain";
  if (filePath.includes("neural-world")) return "graph-dashboard";
  if (filePath.includes("nexus")) return "ai-nexus";
  return "core-shell";
}

function computeDomainConfidence(filePath: string, domain: string): number {
  if (domain === "core-shell") return 0.3; // Low confidence default
  if (filePath.toLowerCase().includes(domain.toLowerCase())) return 0.9;
  return 0.6;
}

function computeDomainReason(filePath: string, domain: string): string {
  if (filePath.toLowerCase().includes(domain.toLowerCase())) {
    return "Path pattern match";
  }
  return "Heuristic inference";
}

function calculateNodeRisk(node: ImportGraphNode): number {
  let risk = 0.3; // Base

  // High in-degree risk
  if (node.importedByCount > 10) risk += 0.2;
  else if (node.importedByCount > 5) risk += 0.1;

  // High out-degree risk
  if (node.importsCount > 15) risk += 0.2;
  else if (node.importsCount > 10) risk += 0.1;

  // File type risk
  if (node.fileType === "component") risk += 0.05;
  else if (node.fileType === "service") risk += 0.1;

  return Math.min(1.0, risk);
}

function scoreToRiskLevel(
  score: number
): "critical" | "high" | "medium" | "low" | "minimal" {
  if (score > 0.8) return "critical";
  if (score > 0.6) return "high";
  if (score > 0.4) return "medium";
  if (score > 0.2) return "low";
  return "minimal";
}

function generateHighTouchRecommendation(
  reason: string,
  score: number
): string {
  if (reason === "frequently-imported") {
    return `This file is imported by ${score} other files. Changes may have wide impact.`;
  }
  if (reason === "high-fan-out") {
    return `This file imports ${score} dependencies. Review coupling and consider splitting.`;
  }
  if (reason === "bottleneck") {
    return `Critical junction file. Test thoroughly before modifications.`;
  }
  return "High-touch file. Exercise caution during changes.";
}

function buildImportGraphOverlaySummary(
  nodes: ImportGraphNode[],
  edges: ImportGraphEdge[],
  clusters: ImportGraphCluster[],
  risk: ImportGraphRisk,
  highTouchFiles: HighTouchFile[],
  mappings: FileToDomainMapping[]
): ImportGraphOverlaySummary {
  const avgImports = nodes.length > 0
    ? nodes.reduce((sum, n) => sum + n.importsCount, 0) / nodes.length
    : 0;

  const avgImportedBy = nodes.length > 0
    ? nodes.reduce((sum, n) => sum + n.importedByCount, 0) / nodes.length
    : 0;

  const circularPercent =
    nodes.length > 0
      ? (nodes.filter((n) => n.hasCircularDependency).length / nodes.length) *
        100
      : 0;

  const filesByDomain: Record<string, FilePath[]> = {};
  mappings.forEach((m) => {
    if (!filesByDomain[m.domainId]) {
      filesByDomain[m.domainId] = [];
    }
    filesByDomain[m.domainId].push(m.filePath);
  });

  const healthScore =
    1.0 -
    (risk.overallRiskScore * 0.5 +
      (circularPercent / 100) * 0.3 +
      (Math.min(1.0, nodes.filter((n) => n.isCritical).length / 10) * 0.2));

  return {
    totalFiles: nodes.length,
    totalEdges: edges.length,
    totalClusters: clusters.length,
    highTouchFiles: highTouchFiles.slice(0, 15),
    filesByDomain,
    healthScore: Math.max(0, healthScore),
    avgImportsPerFile: avgImports,
    avgImportedByPerFile: avgImportedBy,
    circularDependencyPercentage: circularPercent,
    risk,
    generatedAt: new Date().toISOString(),
    notes: `Summary of import graph with ${nodes.length} files and ${edges.length} edges.`,
  };
}

/**
 * EXPORT SUMMARY
 * ==============
 *
 * This module provides pure helper functions:
 * 1. createImportGraphOverlay - Build complete overlay from manifest
 * 2. rankHighTouchFiles - Identify frequently-used/high-dependency files
 * 3. inferImportGraphRisk - Assess technical risk patterns
 * 4. mapFilesToDomains - Assign files to architectural domains
 * 5. summarizeImportGraphOverlay - Create concise summaries
 *
 * All functions are stateless and compose together to analyze the
 * app's import structure without side effects or live tracking.
 */
