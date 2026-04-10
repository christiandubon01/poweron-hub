import React from 'react';
import {
  Phone,
  Mic,
  Target,
  Filter,
  BarChart3,
} from 'lucide-react';
import { SalesIntelTab, useSalesIntelStore } from './SalesIntelStore';

interface TabDefinition {
  id: SalesIntelTab;
  label: string;
  icon: React.ReactNode;
  badgeKey?: 'newLeadCount' | 'dueFollowUps' | 'unreviewedSessions';
}

const TAB_DEFINITIONS: TabDefinition[] = [
  {
    id: 'practice',
    label: 'PRACTICE',
    icon: <Phone className="w-4 h-4" />,
  },
  {
    id: 'live_call',
    label: 'LIVE CALL',
    icon: <Mic className="w-4 h-4" />,
  },
  {
    id: 'leads',
    label: 'LEADS',
    icon: <Target className="w-4 h-4" />,
    badgeKey: 'newLeadCount',
  },
  {
    id: 'pipeline',
    label: 'PIPELINE',
    icon: <Filter className="w-4 h-4" />,
    badgeKey: 'dueFollowUps',
  },
  {
    id: 'coach',
    label: 'COACH',
    icon: <BarChart3 className="w-4 h-4" />,
    badgeKey: 'unreviewedSessions',
  },
];

interface SalesIntelTabBarProps {
  className?: string;
}

export const SalesIntelTabBar: React.FC<SalesIntelTabBarProps> = ({
  className = '',
}) => {
  const activeTab = useSalesIntelStore((state) => state.activeTab);
  const setActiveTab = useSalesIntelStore((state) => state.setActiveTab);
  const newLeadCount = useSalesIntelStore((state) => state.newLeadCount);
  const dueFollowUps = useSalesIntelStore((state) => state.dueFollowUps);
  const unreviewedSessions = useSalesIntelStore(
    (state) => state.unreviewedSessions
  );

  const badgeValues = {
    newLeadCount,
    dueFollowUps,
    unreviewedSessions,
  };

  const getBadgeValue = (badgeKey?: string): number | undefined => {
    if (!badgeKey) return undefined;
    return badgeValues[badgeKey as keyof typeof badgeValues];
  };

  return (
    <div
      className={`flex gap-2 md:gap-4 lg:gap-6 border-b border-white/10 px-4 md:px-6 py-3 backdrop-blur-sm bg-white/5 rounded-lg ${className}`}
    >
      {TAB_DEFINITIONS.map((tab) => {
        const isActive = activeTab === tab.id;
        const badgeValue = getBadgeValue(tab.badgeKey);
        const showBadge = badgeValue && badgeValue > 0;

        return (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`
              flex items-center gap-2 px-3 py-2 rounded-md transition-all duration-200 relative whitespace-nowrap
              ${
                isActive
                  ? 'text-green-400 border-b-2 border-green-400'
                  : 'text-gray-400 hover:text-gray-300'
              }
            `}
          >
            <div className="flex items-center gap-2">
              {tab.icon}
              <span className="text-xs md:text-sm font-medium">{tab.label}</span>
            </div>

            {showBadge && (
              <span
                className={`
                  flex items-center justify-center min-w-5 px-1.5 py-0.5 rounded-full text-xs font-bold
                  ${
                    isActive
                      ? 'bg-green-400/30 text-green-300'
                      : 'bg-white/10 text-white/70'
                  }
                `}
              >
                {badgeValue}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
};

export default SalesIntelTabBar;
