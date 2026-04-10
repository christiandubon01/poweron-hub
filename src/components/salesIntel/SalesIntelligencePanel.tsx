import React, { Suspense, lazy } from 'react';
import { Zap } from 'lucide-react';
import { SalesIntelTabBar } from './SalesIntelTabBar';
import { useSalesIntelStore } from './SalesIntelStore';

// Lazy load tab content components for performance
const PracticeTab = lazy(() =>
  import('./tabs/PracticeTab').then((mod) => ({ default: mod.PracticeTab }))
);
const LiveCallTab = lazy(() =>
  import('./tabs/LiveCallTab').then((mod) => ({ default: mod.LiveCallTab }))
);
const LeadsTab = lazy(() =>
  import('./tabs/LeadsTab').then((mod) => ({ default: mod.LeadsTab }))
);
const PipelineTab = lazy(() =>
  import('./tabs/PipelineTab').then((mod) => ({ default: mod.PipelineTab }))
);
const CoachTab = lazy(() =>
  import('./tabs/CoachTab').then((mod) => ({ default: mod.CoachTab }))
);

interface SalesIntelligencePanelProps {
  className?: string;
}

export const SalesIntelligencePanel: React.FC<
  SalesIntelligencePanelProps
> = ({ className = '' }) => {
  const activeTab = useSalesIntelStore((state) => state.activeTab);

  const renderTabContent = () => {
    switch (activeTab) {
      case 'practice':
        return <PracticeTab />;
      case 'live_call':
        return <LiveCallTab />;
      case 'leads':
        return <LeadsTab />;
      case 'pipeline':
        return <PipelineTab />;
      case 'coach':
        return <CoachTab />;
      default:
        return <PracticeTab />;
    }
  };

  return (
    <div
      className={`
        flex flex-col gap-4 p-4 md:p-6 
        rounded-xl bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900
        border border-white/10 shadow-2xl
        ${className}
      `}
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-gradient-to-br from-blue-500 to-purple-600">
            <Zap className="w-5 h-5 text-white" />
          </div>
          <div>
            <h2 className="text-xl md:text-2xl font-bold text-white">
              SALES INTELLIGENCE
            </h2>
            <p className="text-xs md:text-sm text-gray-400">
              SPARK + HUNTER Combined Intelligence
            </p>
          </div>
        </div>
      </div>

      {/* Tab Bar */}
      <SalesIntelTabBar />

      {/* Tab Content - Lazy loaded with Suspense */}
      <div className="flex-1 mt-4">
        <Suspense
          fallback={
            <div className="flex items-center justify-center h-64">
              <div className="text-gray-400">Loading...</div>
            </div>
          }
        >
          {renderTabContent()}
        </Suspense>
      </div>
    </div>
  );
};

export default SalesIntelligencePanel;
