/**
 * HUNTER Store
 * Zustand state management for HUNTER agent lead pipeline
 */

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { supabase } from '@/lib/supabase';
import {
  HunterLead,
  HunterRule,
  StudyTopic,
  HunterDebrief,
  HunterPlaybook,
  LeadStatus,
  ScoreTier,
  RuleStatus,
  LeadFilter,
  LeadSortBy,
  HunterStoreState,
  RuleType,
} from '@/services/hunter/HunterTypes';

/**
 * Resolves the current user's tenant_id by joining auth to user_tenants.
 * Returns null if user is not authenticated or has no tenant membership.
 * All Hunter CRUD actions scope by this tenant_id.
 */
async function getCurrentTenantId(): Promise<string | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data, error } = await (supabase as any)
    .from('user_tenants')
    .select('tenant_id')
    .eq('user_id', user.id)
    .limit(1)
    .single();
  if (error || !data) return null;
  return data.tenant_id;
}

async function getCurrentUserId(): Promise<string | null> {
  const { data: { user } } = await supabase.auth.getUser();
  return user?.id ?? null;
}

/**
 * Create the HUNTER Zustand store
 */
export const useHunterStore = create<HunterStoreState>()(
  devtools(
    (set, get) => ({
      // ===== Initial State =====
      leads: [],
      rules: [],
      studyQueue: [],
      debriefs: new Map<string, HunterDebrief>(),
      playbooks: new Map<string, HunterPlaybook>(),

      activeFilters: {},
      sortBy: LeadSortBy.SCORE_DESC,
      isScanning: false,

      // CRUD lifecycle state
      isLoading: false,
      lastError: null,

      // Computed selectors (empty initially, updated via actions)
      leadsFiltered: [],
      topLeads: [],
      expansionLeads: [],

      // ===== Actions =====

      /**
       * Fetch leads from Supabase (RLS auto-scopes to current tenant via user_tenants).
       */
      fetchLeads: async () => {
        set({ isLoading: true });
        try {
          const tenantId = await getCurrentTenantId();
          if (!tenantId) {
            set({
              lastError: 'No tenant membership for current user; cannot fetch leads.',
              isLoading: false,
            });
            return;
          }

          const { data, error } = await (supabase as any)
            .from('hunter_leads')
            .select('*')
            .order('discovered_at', { ascending: false });

          if (error) {
            console.error('Failed to fetch leads:', error);
            set({ lastError: error.message, isLoading: false });
            return;
          }

          const leads = (data ?? []) as HunterLead[];
          set({ leads, lastError: null });

          const { activeFilters, sortBy } = get();
          get().applyFiltersAndSort(leads, activeFilters, sortBy);
        } catch (error: any) {
          console.error('Failed to fetch leads:', error);
          set({ lastError: error?.message ?? String(error) });
        } finally {
          set({ isLoading: false });
        }
      },

      /**
       * Add a new lead - INSERT into hunter_leads scoped to current tenant + user.
       * Postgres generates id (UUID) and timestamp defaults.
       */
      addLead: async (leadData) => {
        set({ isLoading: true });
        try {
          const [tenantId, userId] = await Promise.all([
            getCurrentTenantId(),
            getCurrentUserId(),
          ]);
          if (!tenantId || !userId) {
            const msg = 'Not authenticated or no tenant membership; cannot add lead.';
            set({ lastError: msg, isLoading: false });
            throw new Error(msg);
          }

          // Strip any client-provided id / created_at / last_updated / discovered_at
          // so Postgres defaults take over.
          const {
            id: _ignoredId,
            created_at: _ignoredCreated,
            last_updated: _ignoredUpdated,
            discovered_at: _ignoredDiscovered,
            user_id: _ignoredUserId,
            ...cleanData
          } = leadData as any;

          const insertPayload = {
            tenant_id: tenantId,
            user_id: userId,
            ...cleanData,
            score: leadData.score ?? 0,
            score_tier: leadData.score_tier ?? ScoreTier.QUALIFIED,
            status: leadData.status ?? LeadStatus.NEW,
          };

          const { data, error } = await (supabase as any)
            .from('hunter_leads')
            .insert(insertPayload)
            .select()
            .single();

          if (error || !data) {
            const msg = error?.message ?? 'Insert returned no row';
            console.error('Failed to add lead:', error);
            set({ lastError: msg, isLoading: false });
            throw new Error(msg);
          }

          const inserted = data as HunterLead;
          set((state) => ({
            leads: [...state.leads, inserted],
            lastError: null,
          }));

          const { leads, activeFilters, sortBy } = get();
          get().applyFiltersAndSort(leads, activeFilters, sortBy);

          return inserted;
        } finally {
          set({ isLoading: false });
        }
      },

      /**
       * Update lead status - UPDATE hunter_leads (RLS auto-scopes to current tenant).
       * Errors are surfaced via lastError; UI can recover (no throw).
       */
      updateLeadStatus: async (leadId, status) => {
        set({ isLoading: true });
        try {
          const tenantId = await getCurrentTenantId();
          if (!tenantId) {
            set({
              lastError: 'No tenant membership; cannot update lead status.',
              isLoading: false,
            });
            return;
          }

          const { data, error } = await (supabase as any)
            .from('hunter_leads')
            .update({ status, last_updated: new Date().toISOString() })
            .eq('id', leadId)
            .select()
            .single();

          if (error || !data) {
            console.error('Failed to update lead status:', error);
            set({ lastError: error?.message ?? 'Update returned no row' });
            return;
          }

          const updated = data as HunterLead;
          set((state) => ({
            leads: state.leads.map((lead) => (lead.id === leadId ? updated : lead)),
            lastError: null,
          }));

          const { leads, activeFilters, sortBy } = get();
          get().applyFiltersAndSort(leads, activeFilters, sortBy);
        } finally {
          set({ isLoading: false });
        }
      },

      /**
       * Update lead score with factors - UPDATE hunter_leads + INSERT audit row in hunter_scores.
       * Errors set lastError; do not throw (UI can recover).
       */
      updateLeadScore: async (leadId, score, factors) => {
        set({ isLoading: true });
        try {
          const tenantId = await getCurrentTenantId();
          if (!tenantId) {
            set({
              lastError: 'No tenant membership; cannot update lead score.',
              isLoading: false,
            });
            return;
          }

          const scoreTier = get().computeScoreTier(score);

          const { data, error } = await (supabase as any)
            .from('hunter_leads')
            .update({
              score,
              score_tier: scoreTier,
              score_factors: factors,
              last_updated: new Date().toISOString(),
            })
            .eq('id', leadId)
            .select()
            .single();

          if (error || !data) {
            console.error('Failed to update lead score:', error);
            set({ lastError: error?.message ?? 'Update returned no row' });
            return;
          }

          // Audit-trail insert into hunter_scores (best-effort; surface but don't abort).
          const { error: auditError } = await (supabase as any)
            .from('hunter_scores')
            .insert({
              tenant_id: tenantId,
              lead_id: leadId,
              score,
              factors,
            });
          if (auditError) {
            console.error('Failed to write hunter_scores audit row:', auditError);
            set({ lastError: auditError.message });
          }

          const updated = data as HunterLead;
          set((state) => ({
            leads: state.leads.map((lead) => (lead.id === leadId ? updated : lead)),
            lastError: auditError ? auditError.message : null,
          }));

          const { leads, activeFilters, sortBy } = get();
          get().applyFiltersAndSort(leads, activeFilters, sortBy);
        } finally {
          set({ isLoading: false });
        }
      },

      /**
       * Add a new rule (pitch, suppression, urgency, etc.) -
       * INSERT into hunter_rules scoped to current tenant + user.
       */
      addRule: async (ruleData) => {
        set({ isLoading: true });
        try {
          const [tenantId, userId] = await Promise.all([
            getCurrentTenantId(),
            getCurrentUserId(),
          ]);
          if (!tenantId || !userId) {
            const msg = 'Not authenticated or no tenant membership; cannot add rule.';
            set({ lastError: msg, isLoading: false });
            throw new Error(msg);
          }

          const insertPayload = {
            tenant_id: tenantId,
            user_id: userId,
            rule_type: ruleData.rule_type,
            rule_text: ruleData.rule_text,
            source_lead_id: ruleData.source_lead_id ?? null,
            version: ruleData.version ?? 1,
            status: ruleData.status ?? RuleStatus.ACTIVE,
          };

          const { data, error } = await (supabase as any)
            .from('hunter_rules')
            .insert(insertPayload)
            .select()
            .single();

          if (error || !data) {
            const msg = error?.message ?? 'Insert returned no row';
            console.error('Failed to add rule:', error);
            set({ lastError: msg, isLoading: false });
          }

          const inserted = data as HunterRule;
          set((state) => ({
            rules: [...state.rules, inserted],
            lastError: null,
          }));

          return inserted;
        } finally {
          set({ isLoading: false });
        }
      },

      /**
       * Archive a rule - UPDATE hunter_rules SET status='archived' (RLS auto-scopes).
       */
      archiveRule: async (ruleId) => {
        set({ isLoading: true });
        try {
          const tenantId = await getCurrentTenantId();
          if (!tenantId) {
            set({
              lastError: 'No tenant membership; cannot archive rule.',
              isLoading: false,
            });
            return;
          }

          const { data, error } = await (supabase as any)
            .from('hunter_rules')
            .update({
              status: RuleStatus.ARCHIVED,
              updated_at: new Date().toISOString(),
            })
            .eq('id', ruleId)
            .select()
            .single();

          if (error || !data) {
            console.error('Failed to archive rule:', error);
            set({ lastError: error?.message ?? 'Update returned no row' });
            return;
          }

          const updated = data as HunterRule;
          set((state) => ({
            rules: state.rules.map((rule) => (rule.id === ruleId ? updated : rule)),
            lastError: null,
          }));
        } finally {
          set({ isLoading: false });
        }
      },

      /**
       * Fetch study queue items - SELECT pending rows from hunter_study_queue.
       */
      fetchStudyQueue: async () => {
        set({ isLoading: true });
        try {
          const tenantId = await getCurrentTenantId();
          if (!tenantId) {
            set({
              lastError: 'No tenant membership; cannot fetch study queue.',
              isLoading: false,
            });
            return;
          }

          const { data, error } = await (supabase as any)
            .from('hunter_study_queue')
            .select('*')
            .eq('status', 'pending')
            .order('scheduled_for', { ascending: true, nullsFirst: false })
            .order('created_at', { ascending: false });

          if (error) {
            console.error('Failed to fetch study queue:', error);
            set({ lastError: error.message });
            return;
          }

          set({ studyQueue: (data ?? []) as StudyTopic[], lastError: null });
        } finally {
          set({ isLoading: false });
        }
      },

      /**
       * Set active filters
       */
      setActiveFilters: (filters) => {
        set({ activeFilters: filters });

        const { leads, sortBy } = get();
        get().applyFiltersAndSort(leads, filters, sortBy);
      },

      /**
       * Set sort order
       */
      setSortBy: (sortBy) => {
        set({ sortBy });

        const { leads, activeFilters } = get();
        get().applyFiltersAndSort(leads, activeFilters, sortBy);
      },

      /**
       * Set scanning status
       */
      setIsScanning: (isScanning) => {
        set({ isScanning });
      },

      // ===== Internal Computed Methods =====

      /**
       * Apply filters and sort to leads
       * @internal
       */
      applyFiltersAndSort: (leads: HunterLead[], filters: LeadFilter, sortBy: LeadSortBy) => {
        // Apply filters
        let filtered = leads;

        if (filters.status) {
          const statuses = Array.isArray(filters.status) ? filters.status : [filters.status];
          filtered = filtered.filter((lead) => statuses.includes(lead.status));
        }

        if (filters.score_tier) {
          const tiers = Array.isArray(filters.score_tier) ? filters.score_tier : [filters.score_tier];
          filtered = filtered.filter((lead) => tiers.includes(lead.score_tier));
        }

        if (filters.lead_type) {
          const types = Array.isArray(filters.lead_type) ? filters.lead_type : [filters.lead_type];
          filtered = filtered.filter((lead) => types.includes(lead.lead_type));
        }

        if (filters.source) {
          const sources = Array.isArray(filters.source) ? filters.source : [filters.source];
          filtered = filtered.filter((lead) => sources.includes(lead.source));
        }

        if (filters.min_score !== undefined) {
          filtered = filtered.filter((lead) => lead.score >= filters.min_score!);
        }

        if (filters.max_score !== undefined) {
          filtered = filtered.filter((lead) => lead.score <= filters.max_score!);
        }

        if (filters.date_range) {
          const fromMs = new Date(filters.date_range.from).getTime();
          const toMs = new Date(filters.date_range.to).getTime();
          filtered = filtered.filter((lead) => {
            const ts = new Date(lead.discovered_at || 0).getTime();
            return ts >= fromMs && ts <= toMs;
          });
        }

        // Apply sort
        const sorted = [...filtered];
        sorted.sort((a, b) => {
          switch (sortBy) {
            case LeadSortBy.SCORE_DESC:
              return b.score - a.score;
            case LeadSortBy.SCORE_ASC:
              return a.score - b.score;
            case LeadSortBy.URGENCY_DESC:
              return (b.urgency_level || 0) - (a.urgency_level || 0);
            case LeadSortBy.DISCOVERED_DESC:
              return new Date(b.discovered_at || 0).getTime() - new Date(a.discovered_at || 0).getTime();
            case LeadSortBy.DISCOVERED_ASC:
              return new Date(a.discovered_at || 0).getTime() - new Date(b.discovered_at || 0).getTime();
            case LeadSortBy.ESTIMATED_VALUE_DESC:
              return (b.estimated_value || 0) - (a.estimated_value || 0);
            default:
              return 0;
          }
        });

        // Compute special collections
        const topLeads = sorted.filter((lead) => lead.score >= 75);
        const expansionLeads = sorted.filter((lead) => lead.score >= 40 && lead.score < 60);

        set({
          leadsFiltered: sorted,
          topLeads,
          expansionLeads,
        });
      },

      /**
       * Compute score tier from score value
       * @internal
       */
      computeScoreTier: (score: number): ScoreTier => {
        if (score >= 85) return ScoreTier.ELITE;
        if (score >= 75) return ScoreTier.STRONG;
        if (score >= 60) return ScoreTier.QUALIFIED;
        if (score >= 40) return ScoreTier.EXPANSION;
        return ScoreTier.ARCHIVED;
      },
    })
  )
);

export default useHunterStore;
