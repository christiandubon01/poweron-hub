import { create } from 'zustand';

export type SalesIntelTab = 'practice' | 'live_call' | 'leads' | 'pipeline' | 'coach';

export interface SalesIntelState {
  activeTab: SalesIntelTab;
  practiceMode: boolean;
  liveCallActive: boolean;
  pipelineFilters: {
    stage?: string;
    daysOverdue?: number;
  };
  // Tab-specific data
  practiceDifficultyLevel?: string;
  newLeadCount: number;
  dueFollowUps: number;
  unreviewedSessions: number;
  // Actions
  setActiveTab: (tab: SalesIntelTab) => void;
  setPracticeMode: (active: boolean) => void;
  setLiveCallActive: (active: boolean) => void;
  setPipelineFilters: (filters: SalesIntelState['pipelineFilters']) => void;
  setPracticeDifficultyLevel: (level: string) => void;
  setNewLeadCount: (count: number) => void;
  setDueFollowUps: (count: number) => void;
  setUnreviewedSessions: (count: number) => void;
  navigateToLeadPractice: (leadId: string) => void;
}

export const useSalesIntelStore = create<SalesIntelState>((set) => {
  // Load active tab from localStorage
  const savedTab = typeof window !== 'undefined' 
    ? localStorage.getItem('si_activeTab') as SalesIntelTab | null
    : null;

  return {
    activeTab: savedTab || 'practice',
    practiceMode: false,
    liveCallActive: false,
    pipelineFilters: {},
    practiceDifficultyLevel: 'intermediate',
    newLeadCount: 0,
    dueFollowUps: 0,
    unreviewedSessions: 0,

    setActiveTab: (tab: SalesIntelTab) => {
      if (typeof window !== 'undefined') {
        localStorage.setItem('si_activeTab', tab);
      }
      set({ activeTab: tab });
    },

    setPracticeMode: (active: boolean) => set({ practiceMode: active }),
    setLiveCallActive: (active: boolean) => set({ liveCallActive: active }),

    setPipelineFilters: (filters: SalesIntelState['pipelineFilters']) =>
      set({ pipelineFilters: filters }),

    setPracticeDifficultyLevel: (level: string) =>
      set({ practiceDifficultyLevel: level }),

    setNewLeadCount: (count: number) => set({ newLeadCount: count }),
    setDueFollowUps: (count: number) => set({ dueFollowUps: count }),
    setUnreviewedSessions: (count: number) =>
      set({ unreviewedSessions: count }),

    navigateToLeadPractice: (leadId: string) => {
      // Cross-tab action: navigate to Practice tab with lead context
      set({
        activeTab: 'practice',
        practiceMode: true,
      });
      // Store leadId in sessionStorage for the Practice tab to pick up
      if (typeof window !== 'undefined') {
        sessionStorage.setItem('si_practiceLead', leadId);
      }
    },
  };
});
