/**
 * HUNTER Store
 * Zustand state management for HUNTER agent lead pipeline
 */

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
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

      // Computed selectors (empty initially, updated via actions)
      leadsFiltered: [],
      topLeads: [],
      expansionLeads: [],

      // ===== Actions =====

      /**
       * Fetch leads from Supabase
       */
      fetchLeads: async () => {
        try {
          // Placeholder for actual Supabase fetch
          // In integration, this will call supabase client
          console.log('HunterStore: fetching leads...');
          
          // For now, just update computed selectors
          const { leads, activeFilters, sortBy } = get();
          get().applyFiltersAndSort(leads, activeFilters, sortBy);
        } catch (error) {
          console.error('Failed to fetch leads:', error);
        }
      },

      /**
       * Add a new lead
       */
      addLead: async (leadData) => {
        try {
          // Placeholder: in integration, POST to Supabase
          const newLead: HunterLead = {
            id: `lead_${Date.now()}`,
            user_id: '', // Will be set on integration
            created_at: new Date().toISOString(),
            last_updated: new Date().toISOString(),
            discovered_at: new Date().toISOString(),
            ...leadData,
            score: leadData.score || 0,
            score_tier: leadData.score_tier || ScoreTier.QUALIFIED,
            status: leadData.status || LeadStatus.NEW,
          };

          set((state) => ({
            leads: [...state.leads, newLead],
          }));

          // Recompute filtered leads
          const { leads, activeFilters, sortBy } = get();
          get().applyFiltersAndSort(leads, activeFilters, sortBy);

          return newLead;
        } catch (error) {
          console.error('Failed to add lead:', error);
          throw error;
        }
      },

      /**
       * Update lead status
       */
      updateLeadStatus: async (leadId, status) => {
        try {
          // Placeholder: PATCH to Supabase
          set((state) => ({
            leads: state.leads.map((lead) =>
              lead.id === leadId
                ? { ...lead, status, last_updated: new Date().toISOString() }
                : lead
            ),
          }));

          const { leads, activeFilters, sortBy } = get();
          get().applyFiltersAndSort(leads, activeFilters, sortBy);
        } catch (error) {
          console.error('Failed to update lead status:', error);
          throw error;
        }
      },

      /**
       * Update lead score with factors
       */
      updateLeadScore: async (leadId, score, factors) => {
        try {
          // Placeholder: PATCH to Supabase
          const scoreTier = get().computeScoreTier(score);

          set((state) => ({
            leads: state.leads.map((lead) =>
              lead.id === leadId
                ? {
                    ...lead,
                    score,
                    score_tier: scoreTier,
                    score_factors: factors,
                    last_updated: new Date().toISOString(),
                  }
                : lead
            ),
          }));

          const { leads, activeFilters, sortBy } = get();
          get().applyFiltersAndSort(leads, activeFilters, sortBy);
        } catch (error) {
          console.error('Failed to update lead score:', error);
          throw error;
        }
      },

      /**
       * Add a new rule (pitch, suppression, urgency, etc.)
       */
      addRule: async (ruleData) => {
        try {
          // Placeholder: POST to Supabase
          const newRule: HunterRule = {
            id: `rule_${Date.now()}`,
            user_id: '', // Set on integration
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            ...ruleData,
            version: ruleData.version || 1,
            status: ruleData.status || RuleStatus.ACTIVE,
          };

          set((state) => ({
            rules: [...state.rules, newRule],
          }));

          return newRule;
        } catch (error) {
          console.error('Failed to add rule:', error);
          throw error;
        }
      },

      /**
       * Archive a rule
       */
      archiveRule: async (ruleId) => {
        try {
          // Placeholder: PATCH to Supabase
          set((state) => ({
            rules: state.rules.map((rule) =>
              rule.id === ruleId
                ? { ...rule, status: RuleStatus.ARCHIVED, updated_at: new Date().toISOString() }
                : rule
            ),
          }));
        } catch (error) {
          console.error('Failed to archive rule:', error);
          throw error;
        }
      },

      /**
       * Fetch study queue items
       */
      fetchStudyQueue: async () => {
        try {
          // Placeholder: GET from Supabase
          console.log('HunterStore: fetching study queue...');
        } catch (error) {
          console.error('Failed to fetch study queue:', error);
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
