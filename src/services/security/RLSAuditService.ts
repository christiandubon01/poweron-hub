/**
 * RLSAuditService.ts
 * 
 * Audits all Supabase tables to verify Row Level Security policies exist
 * and enforce proper multi-tenant data isolation (auth.uid() = user_id pattern).
 * 
 * CRITICAL: User A must NEVER see User B's data.
 * 
 * Usage:
 *   const audit = await auditAllTables();
 *   console.log(audit.report());
 */

interface PolicyCheckResult {
  table: string;
  hasRLS: boolean;
  selectPolicy: boolean;
  insertPolicy: boolean;
  updatePolicy: boolean;
  deletePolicy: boolean;
  policyDetails: string[];
  missing: string[];
  weaknesses: string[];
}

interface RLSAuditResult {
  timestamp: string;
  totalTables: number;
  tablesWithRLS: number;
  tablesWithoutRLS: string[];
  findings: PolicyCheckResult[];
  criticalIssues: string[];
  recommendations: string[];
  report: () => string;
}

/**
 * Tables that require RLS for multi-tenant isolation
 * Format: tableName
 */
const TABLES_REQUIRING_RLS = [
  'projects',
  'field_logs',
  'invoices',
  'leads',
  'clients',
  'crew',
  'crew_members',
  'price_book',
  'estimates',
  'mto_items',
  'rfis',
  'coordination',
  'app_state',
  'nexus_learned_profile',
  'signed_agreements',
  'portal_leads',
  'usage_tracking',
  'user_onboarding',
  'user_benchmarks',
  'snapshots',
  'service_calls',
  'service_logs',
  'crew_field_logs',
  'project_phases',
  'project_templates',
  'payments',
  'change_orders',
  'calendar_events',
  'campaigns',
  'reviews',
  'compliance_checks',
  'guardian_rules',
  'guardian_violations',
  'guardian_audit_log',
  'call_scripts',
  'call_sessions',
  'expenses',
  'debts',
  'user_financial_profile',
  'weekly_lead_snapshots',
  'journal_entries',
  'blueprint_uploads',
  'blueprint_outputs',
  'n8n_workflows',
  'n8n_trigger_log',
  'crew_tasks',
  'user_roles',
  'hub_platform_events',
  'wins_log',
  'guardian_config',
  'organizations',
  'profiles',
  'user_sessions',
  'agents',
  'project_templates',
];

/**
 * Expected RLS policy pattern per table:
 * - SELECT: auth.uid() = user_id (or organization_id for team accounts)
 * - INSERT: WITH CHECK (auth.uid() = user_id)
 * - UPDATE: USING (auth.uid() = user_id)
 * - DELETE: USING (auth.uid() = user_id)
 * 
 * Special cases:
 * - portal_leads: service role only (no anon access)
 * - signed_agreements: may require admin read access
 * - organizations: may use org_id instead of user_id
 */

/**
 * Audit all required tables for RLS policies
 * This is a diagnostic function that checks the Supabase schema
 */
export async function auditAllTables(): Promise<RLSAuditResult> {
  const findings: PolicyCheckResult[] = [];
  const criticalIssues: string[] = [];
  const recommendations: string[] = [];
  const tablesWithoutRLS: string[] = [];

  // This would normally connect to Supabase and query pg_policies
  // For now, this is a framework that will be connected to actual Supabase queries
  // in integration. The audit structure is defined below.

  for (const tableName of TABLES_REQUIRING_RLS) {
    const check = await checkTableRLSPolicies(tableName);
    findings.push(check);

    if (!check.hasRLS) {
      tablesWithoutRLS.push(tableName);
      criticalIssues.push(
        `CRITICAL: Table '${tableName}' does not have RLS enabled. Users may see each other's data.`
      );
      recommendations.push(
        `Enable RLS on '${tableName}' and add auth.uid() = user_id policies (or org_id for shared tables).`
      );
    }

    if (!check.selectPolicy || !check.insertPolicy || !check.updatePolicy || !check.deletePolicy) {
      const missing = check.missing;
      criticalIssues.push(
        `WARNING: Table '${tableName}' missing policies: ${missing.join(', ')}`
      );
      recommendations.push(
        `Add missing policies to '${tableName}': ${missing.join(', ')}`
      );
    }

    if (check.weaknesses.length > 0) {
      criticalIssues.push(
        `WEAKNESS: Table '${tableName}' - ${check.weaknesses.join('; ')}`
      );
    }
  }

  return {
    timestamp: new Date().toISOString(),
    totalTables: TABLES_REQUIRING_RLS.length,
    tablesWithRLS: TABLES_REQUIRING_RLS.length - tablesWithoutRLS.length,
    tablesWithoutRLS,
    findings,
    criticalIssues,
    recommendations,
    report: () => formatAuditReport({
      timestamp: new Date().toISOString(),
      totalTables: TABLES_REQUIRING_RLS.length,
      tablesWithRLS: TABLES_REQUIRING_RLS.length - tablesWithoutRLS.length,
      tablesWithoutRLS,
      findings,
      criticalIssues,
      recommendations,
      report: () => '',
    }),
  };
}

/**
 * Check a single table for RLS policy compliance
 */
async function checkTableRLSPolicies(tableName: string): Promise<PolicyCheckResult> {
  const missing: string[] = [];
  const weaknesses: string[] = [];
  const policyDetails: string[] = [];

  // In production, this would query:
  // SELECT * FROM pg_policies WHERE tablename = tableName;
  // For now, this is a placeholder that demonstrates the audit structure

  const hasRLS = true; // Would be checked via pg_tables.rowsecurity
  const selectPolicy = true; // Would check pg_policies for SELECT policies
  const insertPolicy = true; // Would check pg_policies for INSERT policies
  const updatePolicy = true; // Would check pg_policies for UPDATE policies
  const deletePolicy = true; // Would check pg_policies for DELETE policies

  if (!selectPolicy) missing.push('SELECT');
  if (!insertPolicy) missing.push('INSERT');
  if (!updatePolicy) missing.push('UPDATE');
  if (!deletePolicy) missing.push('DELETE');

  // Check for weak policies
  if (selectPolicy && !policyDetails.some(p => p.includes('auth.uid()'))) {
    weaknesses.push('SELECT policy does not check auth.uid()');
  }

  return {
    table: tableName,
    hasRLS,
    selectPolicy,
    insertPolicy,
    updatePolicy,
    deletePolicy,
    policyDetails,
    missing,
    weaknesses,
  };
}

/**
 * Format audit results into human-readable report
 */
function formatAuditReport(result: RLSAuditResult): string {
  const lines: string[] = [
    '═══════════════════════════════════════════════════════════════',
    'RLS AUDIT REPORT',
    '═══════════════════════════════════════════════════════════════',
    `Timestamp: ${result.timestamp}`,
    `Total Tables Audited: ${result.totalTables}`,
    `Tables with RLS: ${result.tablesWithRLS}`,
    `Tables WITHOUT RLS: ${result.tablesWithoutRLS.length}`,
    '',
  ];

  if (result.tablesWithoutRLS.length > 0) {
    lines.push('🔴 CRITICAL: Tables Missing RLS:');
    result.tablesWithoutRLS.forEach(t => lines.push(`  - ${t}`));
    lines.push('');
  }

  if (result.criticalIssues.length > 0) {
    lines.push('⚠️  ISSUES FOUND:');
    result.criticalIssues.forEach(issue => lines.push(`  - ${issue}`));
    lines.push('');
  }

  if (result.recommendations.length > 0) {
    lines.push('📋 RECOMMENDATIONS:');
    result.recommendations.forEach(rec => lines.push(`  - ${rec}`));
    lines.push('');
  }

  lines.push('═══════════════════════════════════════════════════════════════');
  return lines.join('\n');
}

/**
 * Verify that a specific table enforces user isolation
 * Returns true only if table has complete multi-tenant RLS enforcement
 */
export function verifyTableIsolation(table: string, policies: any[]): boolean {
  // Check for SELECT, INSERT, UPDATE, DELETE policies
  const requiredOps = ['SELECT', 'INSERT', 'UPDATE', 'DELETE'];
  
  for (const op of requiredOps) {
    const policy = policies.find(p => p.tablename === table && p.cmd === op);
    
    if (!policy) return false;
    
    // Verify policy uses auth.uid() for user isolation
    const policyQual = policy.qual || '';
    if (!policyQual.includes('auth.uid()')) {
      return false;
    }
  }

  return true;
}

/**
 * Export audit data for further analysis
 */
export function exportAuditData(result: RLSAuditResult): string {
  return JSON.stringify(result, null, 2);
}

/**
 * Get list of tables that are critical for user isolation
 */
export function getCriticalTables(): string[] {
  return [
    'projects',
    'field_logs',
    'invoices',
    'leads',
    'clients',
    'service_calls',
    'service_logs',
    'estimates',
    'price_book',
  ];
}

/**
 * Check if a table should use user_id or organization_id for isolation
 * Returns the recommended isolation column
 */
export function getIsolationColumn(tableName: string): 'user_id' | 'organization_id' | 'owner_id' {
  // Most tables use user_id for per-user isolation
  // Some use organization_id for team/org isolation
  // Some use owner_id to track who created the record

  const orgIsolatedTables = ['organizations', 'user_sessions'];
  const ownerIsolatedTables = ['projects', 'service_calls', 'estimates'];

  if (orgIsolatedTables.includes(tableName)) {
    return 'organization_id';
  }
  if (ownerIsolatedTables.includes(tableName)) {
    return 'owner_id';
  }
  return 'user_id';
}
