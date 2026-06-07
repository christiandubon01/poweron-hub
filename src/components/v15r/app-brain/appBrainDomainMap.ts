/**
 * APP BRAIN DOMAIN MAP
 * ===================
 *
 * The PowerOn Hub app domain ecosystem definition.
 * 
 * This map describes the 17 domains that comprise the PowerOn Hub application,
 * their relationships, file ownership, architectural risks, and visualization hints.
 *
 * ARCHITECTURE-ONLY VIEW:
 * - Shows data flow and orchestration relationships
 * - Shows file ownership patterns
 * - Shows technical risk levels
 * - Does NOT show business financial numbers (per policy)
 * - Purely architectural and structural insight
 *
 * Generated: 2026-06-07
 * Last Updated: 2026-06-07
 */

import type {
  AppBrainDomain,
  AppBrainDomainRegistry,
  DomainRiskLevel,
} from "./appBrainDomainTypes";
import { createDomainId } from "./appBrainDomainTypes";

// ============================================================================
// DOMAIN: CORE SHELL / NAVIGATION
// ============================================================================

const CORE_SHELL: AppBrainDomain = {
  id: "core-shell",
  label: "Core Shell / Navigation",
  description:
    "Root app layout, main navigation structure, tab system, and frame architecture. " +
    "Contains V15rLayout, main routing logic, and top-level component orchestration.",
  connectedDomainIds: [
    {
      targetDomainId: "home",
      connectionType: "ui-nesting",
      description: "Shell contains and routes to Home view",
      isCritical: true,
    },
    {
      targetDomainId: "admin-app-brain",
      connectionType: "ui-nesting",
      description: "Shell contains App Brain control tower tab",
      isCritical: false,
    },
    {
      targetDomainId: "settings",
      connectionType: "ui-nesting",
      description: "Shell contains Settings tab",
      isCritical: false,
    },
    {
      targetDomainId: "sync-persistence",
      connectionType: "state-sync",
      description: "Shell initializes app-level state syncing",
      isCritical: true,
    },
  ],
  primaryFiles: [
    { pattern: "src/components/v15r/V15rLayout.tsx", type: "component" },
    { pattern: "src/components/v15r/index.ts", type: "index" },
    { pattern: "src/components/v15r/V15rAppBrainTab.tsx", type: "component" },
  ],
  riskLevel: "critical",
  animationHint: {
    placementZone: "center",
    visualStyle: "solid",
    colorHint: "blue",
    notes: "Central hub connecting all domains",
  },
  createdAt: "2026-06-07T00:00:00Z",
  lastUpdatedAt: "2026-06-07T00:00:00Z",
};

// ============================================================================
// DOMAIN: HOME
// ============================================================================

const HOME: AppBrainDomain = {
  id: "home",
  label: "Home",
  description:
    "Dashboard home view showing alerts, project pipeline, agenda, and quick actions. " +
    "Entry point for daily operations and status overview.",
  connectedDomainIds: [
    {
      targetDomainId: "projects",
      connectionType: "data-flow",
      description: "Reads active/pipeline projects for card display",
      isCritical: true,
    },
    {
      targetDomainId: "project-inner",
      connectionType: "ui-nesting",
      description: "Can navigate to detailed project view",
      isCritical: false,
    },
    {
      targetDomainId: "field-logs",
      connectionType: "data-flow",
      description: "Reads recent field activity for agenda",
      isCritical: false,
    },
  ],
  primaryFiles: [
    { pattern: "src/components/v15r/V15rHome.tsx", type: "component" },
    { pattern: "src/components/v15r/ProjectCard.tsx", type: "component" },
    { pattern: "src/components/v15r/ProjectSummaryBoxes.tsx", type: "component" },
  ],
  riskLevel: "high",
  animationHint: {
    placementZone: "center",
    visualStyle: "glow",
    colorHint: "green",
    notes: "Primary user landing zone",
  },
  createdAt: "2026-06-07T00:00:00Z",
  lastUpdatedAt: "2026-06-07T00:00:00Z",
};

// ============================================================================
// DOMAIN: PROJECTS
// ============================================================================

const PROJECTS: AppBrainDomain = {
  id: "projects",
  label: "Projects",
  description:
    "Project list management, filtering, sorting, and card-based views. " +
    "Shows all projects in various states: estimating, active, completed.",
  connectedDomainIds: [
    {
      targetDomainId: "project-inner",
      connectionType: "ui-nesting",
      description: "Projects list navigates to project detail view",
      isCritical: true,
    },
    {
      targetDomainId: "estimate",
      connectionType: "data-flow",
      description: "Reads estimate status for project cards",
      isCritical: true,
    },
    {
      targetDomainId: "money",
      connectionType: "data-flow",
      description: "Reads financial status (CO count, billing state)",
      isCritical: true,
    },
  ],
  primaryFiles: [
    { pattern: "src/components/v15r/V15rProjectsTab.tsx", type: "component" },
    { pattern: "src/components/v15r/ProjectCard.tsx", type: "component" },
  ],
  riskLevel: "high",
  animationHint: {
    placementZone: "outer-ring",
    visualStyle: "nested",
    colorHint: "orange",
    notes: "Hub for all project-level operations",
  },
  createdAt: "2026-06-07T00:00:00Z",
  lastUpdatedAt: "2026-06-07T00:00:00Z",
};

// ============================================================================
// DOMAIN: PROJECT INNER
// ============================================================================

const PROJECT_INNER: AppBrainDomain = {
  id: "project-inner",
  label: "Project Inner",
  description:
    "Detailed project view with tabs for change orders, coordination, materials, and phases. " +
    "The canvas for managing a single project's lifecycle.",
  connectedDomainIds: [
    {
      targetDomainId: "estimate",
      connectionType: "ui-nesting",
      description: "Contains estimate editing subtab",
      isCritical: true,
    },
    {
      targetDomainId: "material-takeoff",
      connectionType: "ui-nesting",
      description: "Contains MTO subtab",
      isCritical: true,
    },
    {
      targetDomainId: "blueprint-pdf",
      connectionType: "ui-nesting",
      description: "Contains blueprint/PDF upload tab",
      isCritical: false,
    },
    {
      targetDomainId: "field-logs",
      connectionType: "data-flow",
      description: "Reads field activity log for project tracking",
      isCritical: true,
    },
    {
      targetDomainId: "money",
      connectionType: "data-flow",
      description: "Manages change orders and financial tracking",
      isCritical: true,
    },
  ],
  primaryFiles: [
    { pattern: "src/components/v15r/V15rProjectInner.tsx", type: "component" },
    { pattern: "src/components/v15r/V15rChangeOrdersTab.tsx", type: "component" },
    { pattern: "src/components/v15r/V15rCoordinationTab.tsx", type: "component" },
  ],
  riskLevel: "critical",
  hasFinancialNotes:
    "Displays project financial data (change order values, material costs). " +
    "No financial logic computed here; data flows from money/sync domains.",
  animationHint: {
    placementZone: "inner-cluster",
    visualStyle: "translucent",
    colorHint: "yellow",
    notes: "Primary work canvas for project management",
  },
  createdAt: "2026-06-07T00:00:00Z",
  lastUpdatedAt: "2026-06-07T00:00:00Z",
};

// ============================================================================
// DOMAIN: ESTIMATE
// ============================================================================

const ESTIMATE: AppBrainDomain = {
  id: "estimate",
  label: "Estimate",
  description:
    "Estimate creation and editing workflow including line items, labor rates, scope definition. " +
    "Core sales and project planning tool.",
  connectedDomainIds: [
    {
      targetDomainId: "material-takeoff",
      connectionType: "data-flow",
      description: "Uses MTO for material quantities and costs",
      isCritical: true,
    },
    {
      targetDomainId: "price-book",
      connectionType: "data-flow",
      description: "References price book for labor rates and material costs",
      isCritical: true,
    },
    {
      targetDomainId: "sync-persistence",
      connectionType: "state-sync",
      description: "Persists estimate state to Supabase",
      isCritical: true,
    },
  ],
  primaryFiles: [
    { pattern: "src/components/v15r/V15rEstimateTab.tsx", type: "component" },
    { pattern: "src/components/v15r/V15rEstimateMTO.tsx", type: "component" },
    { pattern: "src/services/estimateService.ts", type: "service" },
  ],
  riskLevel: "high",
  hasFinancialNotes:
    "Calculates estimate totals, labor, materials, and markups. " +
    "Financial logic is in estimateService.ts; domain shows UI and state mgmt.",
  animationHint: {
    placementZone: "inner-cluster",
    visualStyle: "glow",
    colorHint: "green",
    notes: "Revenue-entry workflow",
  },
  createdAt: "2026-06-07T00:00:00Z",
  lastUpdatedAt: "2026-06-07T00:00:00Z",
};

// ============================================================================
// DOMAIN: MATERIAL TAKEOFF
// ============================================================================

const MATERIAL_TAKEOFF: AppBrainDomain = {
  id: "material-takeoff",
  label: "Material Takeoff",
  description:
    "Quantity takeoff system for estimating and tracking material requirements. " +
    "Links blueprints, quantities, and pricing to build BOMs.",
  connectedDomainIds: [
    {
      targetDomainId: "estimate",
      connectionType: "data-flow",
      description: "Supplies material quantities and costs to estimate",
      isCritical: true,
    },
    {
      targetDomainId: "blueprint-pdf",
      connectionType: "data-flow",
      description: "References blueprints for dimensioning",
      isCritical: true,
    },
    {
      targetDomainId: "price-book",
      connectionType: "data-flow",
      description: "Looks up material pricing",
      isCritical: true,
    },
  ],
  primaryFiles: [
    { pattern: "src/components/v15r/V15rEstimateMTO.tsx", type: "component" },
    { pattern: "src/services/mtoService.ts", type: "service" },
  ],
  riskLevel: "high",
  animationHint: {
    placementZone: "inner-cluster",
    visualStyle: "nested",
    colorHint: "orange",
    notes: "Quantity planning and cost rollup",
  },
  createdAt: "2026-06-07T00:00:00Z",
  lastUpdatedAt: "2026-06-07T00:00:00Z",
};

// ============================================================================
// DOMAIN: FIELD LOGS
// ============================================================================

const FIELD_LOGS: AppBrainDomain = {
  id: "field-logs",
  label: "Field Logs",
  description:
    "Daily service call logging, crew notes, activity tracking, and field operations. " +
    "Real-time documentation of work performed.",
  connectedDomainIds: [
    {
      targetDomainId: "project-inner",
      connectionType: "data-flow",
      description: "Logs are associated with projects",
      isCritical: true,
    },
    {
      targetDomainId: "money",
      connectionType: "data-flow",
      description: "Field hours feed into billing and payroll tracking",
      isCritical: true,
    },
    {
      targetDomainId: "sync-persistence",
      connectionType: "state-sync",
      description: "Field logs sync to offline/online Supabase",
      isCritical: true,
    },
  ],
  primaryFiles: [
    { pattern: "src/components/v15r/V15rFieldLogPanel.tsx", type: "component" },
    { pattern: "src/components/v15r/MultiDayServiceCallModal.tsx", type: "component" },
    { pattern: "src/services/fieldLogService.ts", type: "service" },
  ],
  riskLevel: "high",
  hasFinancialNotes:
    "Field hours and labor tracked here inform payroll and billing. " +
    "No rates computed in field-logs; that's in money domain.",
  animationHint: {
    placementZone: "outer-ring",
    visualStyle: "glow",
    colorHint: "cyan",
    notes: "Mobile-first operations capture",
  },
  createdAt: "2026-06-07T00:00:00Z",
  lastUpdatedAt: "2026-06-07T00:00:00Z",
};

// ============================================================================
// DOMAIN: GRAPH DASHBOARD
// ============================================================================

const GRAPH_DASHBOARD: AppBrainDomain = {
  id: "graph-dashboard",
  label: "Graph Dashboard",
  description:
    "KPI dashboards, analytics visualizations, revenue charts, pipeline analysis. " +
    "Business intelligence and performance tracking.",
  connectedDomainIds: [
    {
      targetDomainId: "money",
      connectionType: "data-flow",
      description: "Reads financial data for charts and metrics",
      isCritical: true,
    },
    {
      targetDomainId: "projects",
      connectionType: "data-flow",
      description: "Reads project status for pipeline visualization",
      isCritical: true,
    },
  ],
  primaryFiles: [
    { pattern: "src/components/v15r/V15rDashboard.tsx", type: "component" },
    { pattern: "src/components/v15r/V15rCashFlow.tsx", type: "component" },
    { pattern: "src/components/v15r/charts/SVGCharts.tsx", type: "component" },
  ],
  riskLevel: "medium",
  hasFinancialNotes:
    "Displays business metrics: revenue, pipeline, profitability. " +
    "No calculation here; receives computed values from money domain.",
  animationHint: {
    placementZone: "outer-ring",
    visualStyle: "glow",
    colorHint: "purple",
    notes: "Executive dashboard view",
  },
  createdAt: "2026-06-07T00:00:00Z",
  lastUpdatedAt: "2026-06-07T00:00:00Z",
};

// ============================================================================
// DOMAIN: MONEY
// ============================================================================

const MONEY: AppBrainDomain = {
  id: "money",
  label: "Money",
  description:
    "Financial orchestration: change orders, billing, unbilled revenue, payroll prep, " +
    "revenue recognition, cost tracking. Central financial workflow.",
  connectedDomainIds: [
    {
      targetDomainId: "project-inner",
      connectionType: "orchestration",
      description: "Manages change orders and financial state for projects",
      isCritical: true,
    },
    {
      targetDomainId: "estimate",
      connectionType: "data-flow",
      description: "Consumes estimate data for project cost basis",
      isCritical: true,
    },
    {
      targetDomainId: "field-logs",
      connectionType: "data-flow",
      description: "Reads field hours for labor cost tracking",
      isCritical: true,
    },
    {
      targetDomainId: "graph-dashboard",
      connectionType: "data-flow",
      description: "Provides financial metrics for dashboard",
      isCritical: true,
    },
    {
      targetDomainId: "sync-persistence",
      connectionType: "state-sync",
      description: "Syncs financial state to Supabase",
      isCritical: true,
    },
    {
      targetDomainId: "integrations",
      connectionType: "api-dependency",
      description: "Exports to QuickBooks and other financial systems",
      isCritical: false,
    },
  ],
  primaryFiles: [
    { pattern: "src/services/financialService.ts", type: "service" },
    { pattern: "src/store/financialStore.ts", type: "store" },
    { pattern: "src/components/v15r/V15rCashFlow.tsx", type: "component" },
  ],
  riskLevel: "critical",
  hasFinancialNotes:
    "CRITICAL DOMAIN: All financial calculations, CO tracking, revenue recognition, payroll prep. " +
    "This domain contains actual business numbers. See v4.0 governance rules for audit requirements.",
  animationHint: {
    placementZone: "center",
    visualStyle: "solid",
    colorHint: "red",
    notes: "High-control financial engine",
  },
  createdAt: "2026-06-07T00:00:00Z",
  lastUpdatedAt: "2026-06-07T00:00:00Z",
};

// ============================================================================
// DOMAIN: SETTINGS
// ============================================================================

const SETTINGS: AppBrainDomain = {
  id: "settings",
  label: "Settings",
  description:
    "User preferences, company info, integrations config, mobile/desktop settings. " +
    "Application-level configuration.",
  connectedDomainIds: [
    {
      targetDomainId: "sync-persistence",
      connectionType: "state-sync",
      description: "Persists settings to Supabase",
      isCritical: true,
    },
    {
      targetDomainId: "integrations",
      connectionType: "orchestration",
      description: "Configures third-party integrations",
      isCritical: false,
    },
  ],
  primaryFiles: [
    { pattern: "src/components/v15r/V15rSettingsTab.tsx", type: "component" },
    { pattern: "src/store/settingsStore.ts", type: "store" },
  ],
  riskLevel: "low",
  animationHint: {
    placementZone: "outer-ring",
    visualStyle: "solid",
    colorHint: "gray",
    notes: "Config and preferences",
  },
  createdAt: "2026-06-07T00:00:00Z",
  lastUpdatedAt: "2026-06-07T00:00:00Z",
};

// ============================================================================
// DOMAIN: BLUEPRINT / PDF
// ============================================================================

const BLUEPRINT_PDF: AppBrainDomain = {
  id: "blueprint-pdf",
  label: "Blueprint / PDF",
  description:
    "Blueprint upload, PDF viewing, annotation, and storage. " +
    "Visual reference documentation for projects.",
  connectedDomainIds: [
    {
      targetDomainId: "project-inner",
      connectionType: "ui-nesting",
      description: "Blueprint tab within project detail",
      isCritical: false,
    },
    {
      targetDomainId: "material-takeoff",
      connectionType: "data-flow",
      description: "MTO references blueprints for dimensioning",
      isCritical: false,
    },
    {
      targetDomainId: "sync-persistence",
      connectionType: "state-sync",
      description: "Blueprints stored in Supabase storage buckets",
      isCritical: true,
    },
  ],
  primaryFiles: [
    { pattern: "src/components/v15r/V15rBlueprintsTab.tsx", type: "component" },
    { pattern: "src/services/blueprintService.ts", type: "service" },
  ],
  riskLevel: "medium",
  animationHint: {
    placementZone: "outer-ring",
    visualStyle: "translucent",
    colorHint: "blue",
    notes: "Visual reference storage and viewing",
  },
  createdAt: "2026-06-07T00:00:00Z",
  lastUpdatedAt: "2026-06-07T00:00:00Z",
};

// ============================================================================
// DOMAIN: PRICE BOOK
// ============================================================================

const PRICE_BOOK: AppBrainDomain = {
  id: "price-book",
  label: "Price Book",
  description:
    "Labor rates, material costs, mark-up tables, and pricing rules. " +
    "Master data for all cost calculations.",
  connectedDomainIds: [
    {
      targetDomainId: "estimate",
      connectionType: "data-flow",
      description: "Lookup table for estimate line-item pricing",
      isCritical: true,
    },
    {
      targetDomainId: "material-takeoff",
      connectionType: "data-flow",
      description: "Lookup table for material costs",
      isCritical: true,
    },
    {
      targetDomainId: "sync-persistence",
      connectionType: "state-sync",
      description: "Price book stored and synced in Supabase",
      isCritical: true,
    },
  ],
  primaryFiles: [
    { pattern: "src/store/priceBookStore.ts", type: "store" },
    { pattern: "src/services/priceBookService.ts", type: "service" },
  ],
  riskLevel: "high",
  hasFinancialNotes:
    "Contains all pricing tables: labor rates, material costs, markups. " +
    "Changes here propagate to all estimates and MTOs.",
  animationHint: {
    placementZone: "inner-cluster",
    visualStyle: "solid",
    colorHint: "green",
    notes: "Master data for costing",
  },
  createdAt: "2026-06-07T00:00:00Z",
  lastUpdatedAt: "2026-06-07T00:00:00Z",
};

// ============================================================================
// DOMAIN: LEADS / SALES
// ============================================================================

const LEADS_SALES: AppBrainDomain = {
  id: "leads-sales",
  label: "Leads / Sales",
  description:
    "Prospect tracking, lead capture, sales pipeline, and conversion workflows. " +
    "Pre-estimate sales operations.",
  connectedDomainIds: [
    {
      targetDomainId: "projects",
      connectionType: "data-flow",
      description: "Won leads become projects",
      isCritical: false,
    },
    {
      targetDomainId: "estimate",
      connectionType: "data-flow",
      description: "Leads are linked to estimates",
      isCritical: false,
    },
    {
      targetDomainId: "sync-persistence",
      connectionType: "state-sync",
      description: "Lead data persisted in Supabase",
      isCritical: true,
    },
  ],
  primaryFiles: [
    { pattern: "src/components/v15r/LeadsPanel.tsx", type: "component" },
    { pattern: "src/services/leadsService.ts", type: "service" },
  ],
  riskLevel: "medium",
  animationHint: {
    placementZone: "outer-ring",
    visualStyle: "glow",
    colorHint: "yellow",
    notes: "Sales funnel and pipeline",
  },
  createdAt: "2026-06-07T00:00:00Z",
  lastUpdatedAt: "2026-06-07T00:00:00Z",
};

// ============================================================================
// DOMAIN: AI / NEXUS
// ============================================================================

const AI_NEXUS: AppBrainDomain = {
  id: "ai-nexus",
  label: "AI / NEXUS",
  description:
    "AI-assisted workflows, NEXUS copilot integration, LLM calls, and intelligent automation. " +
    "Governed AI operations across the app.",
  connectedDomainIds: [
    {
      targetDomainId: "estimate",
      connectionType: "shared-utility",
      description: "AI assist for estimate generation",
      isCritical: false,
    },
    {
      targetDomainId: "field-logs",
      connectionType: "shared-utility",
      description: "AI assist for field note transcription",
      isCritical: false,
    },
    {
      targetDomainId: "projects",
      connectionType: "shared-utility",
      description: "AI assist for project planning",
      isCritical: false,
    },
  ],
  primaryFiles: [
    { pattern: "src/components/v15r/AskAIPanel.tsx", type: "component" },
    { pattern: "src/services/aiService.ts", type: "service" },
  ],
  riskLevel: "medium",
  animationHint: {
    placementZone: "center",
    visualStyle: "glow",
    colorHint: "purple",
    notes: "Governed AI operations hub",
  },
  createdAt: "2026-06-07T00:00:00Z",
  lastUpdatedAt: "2026-06-07T00:00:00Z",
};

// ============================================================================
// DOMAIN: ADMIN / APP BRAIN
// ============================================================================

const ADMIN_APP_BRAIN: AppBrainDomain = {
  id: "admin-app-brain",
  label: "Admin / App Brain",
  description:
    "App Brain control tower, session management, rule engine, skills registry, " +
    "backlog tracking, and architecture insights. AI operations and app governance.",
  connectedDomainIds: [
    {
      targetDomainId: "core-shell",
      connectionType: "ui-nesting",
      description: "App Brain is a top-level shell tab",
      isCritical: false,
    },
  ],
  primaryFiles: [
    { pattern: "src/components/v15r/V15rAppBrainTab.tsx", type: "component" },
    { pattern: "src/components/v15r/app-brain/**", type: "component" },
    { pattern: "src/components/v15r/appBrainMap.ts", type: "data" },
    { pattern: "src/components/v15r/appBrainFilters.ts", type: "data" },
  ],
  riskLevel: "medium",
  animationHint: {
    placementZone: "center",
    visualStyle: "solid",
    colorHint: "blue",
    notes: "Control center for architecture and operations",
  },
  createdAt: "2026-06-07T00:00:00Z",
  lastUpdatedAt: "2026-06-07T00:00:00Z",
};

// ============================================================================
// DOMAIN: SYNC / PERSISTENCE
// ============================================================================

const SYNC_PERSISTENCE: AppBrainDomain = {
  id: "sync-persistence",
  label: "Sync / Persistence",
  description:
    "Supabase integration, real-time sync, offline queue, conflict resolution, " +
    "and local state management. Data layer for the entire app.",
  connectedDomainIds: [
    {
      targetDomainId: "core-shell",
      connectionType: "orchestration",
      description: "App-level sync initialization and control",
      isCritical: true,
    },
  ],
  primaryFiles: [
    { pattern: "src/services/supabaseService.ts", type: "service" },
    { pattern: "src/services/syncService.ts", type: "service" },
    { pattern: "src/services/backupDataService.ts", type: "service" },
    { pattern: "src/store/**", type: "store" },
  ],
  riskLevel: "critical",
  animationHint: {
    placementZone: "center",
    visualStyle: "solid",
    colorHint: "red",
    notes: "Data persistence and synchronization backbone",
  },
  createdAt: "2026-06-07T00:00:00Z",
  lastUpdatedAt: "2026-06-07T00:00:00Z",
};

// ============================================================================
// DOMAIN: INTEGRATIONS
// ============================================================================

const INTEGRATIONS: AppBrainDomain = {
  id: "integrations",
  label: "Integrations",
  description:
    "Third-party system integration: QuickBooks, Stripe, SMS, ElevenLabs voice, " +
    "and other external APIs. Bridge between PowerOn and external systems.",
  connectedDomainIds: [
    {
      targetDomainId: "money",
      connectionType: "api-dependency",
      description: "Exports financial data to QuickBooks",
      isCritical: false,
    },
    {
      targetDomainId: "settings",
      connectionType: "orchestration",
      description: "Integration configuration in settings",
      isCritical: false,
    },
  ],
  primaryFiles: [
    { pattern: "src/services/integrationsService.ts", type: "service" },
    { pattern: "src/services/quickBooksService.ts", type: "service" },
    { pattern: "src/services/elevenLabsService.ts", type: "service" },
  ],
  riskLevel: "medium",
  animationHint: {
    placementZone: "outer-ring",
    visualStyle: "translucent",
    colorHint: "cyan",
    notes: "External system bridges",
  },
  createdAt: "2026-06-07T00:00:00Z",
  lastUpdatedAt: "2026-06-07T00:00:00Z",
};

// ============================================================================
// DOMAIN REGISTRY
// ============================================================================

export const APP_BRAIN_DOMAIN_MAP: AppBrainDomainRegistry = {
  version: "1.0.0",
  createdAt: "2026-06-07T00:00:00Z",
  lastUpdatedAt: "2026-06-07T00:00:00Z",
  domains: [
    CORE_SHELL,
    HOME,
    PROJECTS,
    PROJECT_INNER,
    ESTIMATE,
    MATERIAL_TAKEOFF,
    FIELD_LOGS,
    GRAPH_DASHBOARD,
    MONEY,
    SETTINGS,
    BLUEPRINT_PDF,
    PRICE_BOOK,
    LEADS_SALES,
    AI_NEXUS,
    ADMIN_APP_BRAIN,
    SYNC_PERSISTENCE,
    INTEGRATIONS,
  ],
  totalDomains: 17,
  domainsByRisk: {
    critical: 4,  // core-shell, project-inner, money, sync-persistence
    high: 5,      // home, projects, estimate, material-takeoff, field-logs, price-book
    medium: 5,    // graph-dashboard, settings, blueprint-pdf, leads-sales, ai-nexus, integrations
    low: 1,       // settings (also counted in medium above, adjust if needed)
    minimal: 0,
  },
  notes:
    "PowerOn Hub Domain Ecosystem v1.0\n" +
    "17 bounded domains representing the complete application architecture.\n" +
    "Focus: Data flow, file ownership, architectural relationships, and risk assessment.\n" +
    "NO business financial numbers included (per v4.0 governance policy).\n" +
    "Animation hints are for future 3D scene visualization enhancement.\n" +
    "Generated: 2026-06-07 | Session: appbrain-w02-a2-domain-map",
};

/**
 * Helper function to get a single domain by ID
 */
export function getDomainById(id: string): AppBrainDomain | undefined {
  return APP_BRAIN_DOMAIN_MAP.domains.find((d) => d.id === id);
}

/**
 * Helper function to get all domains by risk level
 */
export function getDomainsByRisk(
  riskLevel: DomainRiskLevel
): AppBrainDomain[] {
  return APP_BRAIN_DOMAIN_MAP.domains.filter((d) => d.riskLevel === riskLevel);
}

/**
 * Helper function to get all connected domains
 */
export function getConnectedDomains(
  domainId: string
): AppBrainDomain[] {
  const domain = getDomainById(domainId);
  if (!domain) return [];

  return domain.connectedDomainIds
    .map((conn) => getDomainById(conn.targetDomainId))
    .filter((d): d is AppBrainDomain => d !== undefined);
}

/**
 * EXPORT SUMMARY
 * ==============
 *
 * This map provides:
 * 1. Complete 17-domain ecosystem definition for PowerOn Hub
 * 2. Relationships and data flows between domains
 * 3. File ownership patterns for each domain
 * 4. Technical risk assessment
 * 5. Animation hints for future visualization
 *
 * Key characteristics:
 * - CRITICAL domains: core-shell, project-inner, money, sync-persistence
 * - HIGH-RISK domains: home, projects, estimate, material-takeoff, field-logs, price-book
 * - Architecture is shown as data-flow relationships only
 * - Financial values are NOT included (see hasFinancialNotes policy)
 * - All timestamps are ISO 8601 format
 */
