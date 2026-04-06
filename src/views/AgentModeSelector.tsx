import { useState, useEffect } from 'react';
import {
  Zap,
  HardHat,
  Building2,
  Calculator,
  BarChart2,
  ToggleLeft,
  ToggleRight,
  CheckCircle,
  Cpu,
  MapPin,
  Clock,
} from 'lucide-react';
import { initAgentModeSelectorAgent } from '../agents/agentModeSelector';

// ─── Types ────────────────────────────────────────────────────────────────────

type AgentMode = 'standard' | 'field' | 'office' | 'estimating' | 'executive';

interface ModeDefinition {
  id: AgentMode;
  label: string;
  icon: React.ReactNode;
  tagline: string;
  description: string;
  prioritizedAgents: string[];
  communicationStyle: string;
  accentColor: string;
  borderActive: string;
  bgActive: string;
  iconBg: string;
}

// ─── Mode Definitions ─────────────────────────────────────────────────────────

const MODES: ModeDefinition[] = [
  {
    id: 'standard',
    label: 'Standard',
    icon: <Zap size={20} />,
    tagline: 'Balanced all-purpose mode',
    description:
      'All agents operate at normal priority. Suitable for general in-office or mixed-context work.',
    prioritizedAgents: ['GUARDIAN', 'ATLAS', 'SPARK'],
    communicationStyle: 'Balanced — concise summaries, no jargon bias',
    accentColor: '#4ade80',
    borderActive: '#16a34a',
    bgActive: '#052e16',
    iconBg: '#16a34a22',
  },
  {
    id: 'field',
    label: 'Field Mode',
    icon: <HardHat size={20} />,
    tagline: 'On-site · job site optimised',
    description:
      'Prioritises voice journaling, live call intelligence, and real-time GUARDIAN alerts. Minimal UI noise for gloved-hand use.',
    prioritizedAgents: ['SPARK Live Call', 'Voice Journaling', 'GUARDIAN'],
    communicationStyle: 'Short, action-first — bullet points, no long prose',
    accentColor: '#fb923c',
    borderActive: '#ea580c',
    bgActive: '#431407',
    iconBg: '#ea580c22',
  },
  {
    id: 'office',
    label: 'Office Mode',
    icon: <Building2 size={20} />,
    tagline: 'Back-office · planning focused',
    description:
      'Blueprint AI, crew management, and document workflows take priority. Expanded data views and review tooling.',
    prioritizedAgents: ['Blueprint AI', 'Crew Portal', 'Debt Killer'],
    communicationStyle: 'Detailed — full context, structured reports',
    accentColor: '#60a5fa',
    borderActive: '#2563eb',
    bgActive: '#172554',
    iconBg: '#2563eb22',
  },
  {
    id: 'estimating',
    label: 'Estimating Mode',
    icon: <Calculator size={20} />,
    tagline: 'Takeoffs · pricing · bid prep',
    description:
      'Blueprint AI and material pricing agents are front and centre. Fast access to MTO generation and cost calculations.',
    prioritizedAgents: ['Blueprint AI', 'Material Takeoff', 'Cost Analyser'],
    communicationStyle: 'Numeric-first — tables, quantities, unit costs',
    accentColor: '#a78bfa',
    borderActive: '#7c3aed',
    bgActive: '#2e1065',
    iconBg: '#7c3aed22',
  },
  {
    id: 'executive',
    label: 'Executive Mode',
    icon: <BarChart2 size={20} />,
    tagline: 'KPIs · strategy · big picture',
    description:
      'Summary dashboards, lead trend analysis, and financial KPIs are prioritised. Deep-dive agents run silently in background.',
    prioritizedAgents: ['Lead Rolling Trend', 'Debt Killer', 'GUARDIAN'],
    communicationStyle: 'High-level — executive summaries, trend callouts',
    accentColor: '#f9a8d4',
    borderActive: '#db2777',
    bgActive: '#500724',
    iconBg: '#db277722',
  },
];

// ─── Simulated ATLAS Auto-Detect ──────────────────────────────────────────────

function atlasDetectMode(): AgentMode {
  const hour = new Date().getHours();
  // Early morning / late afternoon → likely on-site
  if (hour >= 6 && hour < 9) return 'field';
  if (hour >= 9 && hour < 12) return 'estimating';
  if (hour >= 12 && hour < 14) return 'office';
  if (hour >= 14 && hour < 17) return 'field';
  // Evening / exec review window
  if (hour >= 17 && hour < 20) return 'executive';
  return 'standard';
}

// ─── Mode Card ────────────────────────────────────────────────────────────────

function ModeCard({
  mode,
  isActive,
  isAtlasControlled,
  onSelect,
}: {
  mode: ModeDefinition;
  isActive: boolean;
  isAtlasControlled: boolean;
  onSelect: () => void;
}) {
  const disabled = isAtlasControlled;

  return (
    <button
      onClick={disabled ? undefined : onSelect}
      className={`relative w-full text-left flex flex-col gap-3 p-4 rounded-xl border transition-all duration-200 ${
        disabled ? 'cursor-default' : 'cursor-pointer hover:brightness-110'
      }`}
      style={{
        borderColor: isActive ? mode.borderActive : '#1e2128',
        backgroundColor: isActive ? mode.bgActive : '#0d0e14',
        boxShadow: isActive
          ? `0 0 0 1px ${mode.borderActive}55, 0 4px 24px ${mode.borderActive}22`
          : 'none',
        opacity: disabled && !isActive ? 0.5 : 1,
      }}
    >
      {/* Active badge */}
      {isActive && (
        <span
          className="absolute top-3 right-3 flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full"
          style={{
            backgroundColor: `${mode.borderActive}33`,
            color: mode.accentColor,
            border: `1px solid ${mode.borderActive}55`,
          }}
        >
          <CheckCircle size={10} />
          Active
        </span>
      )}

      {/* Icon + Mode Name */}
      <div className="flex items-center gap-3">
        <div
          className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{
            backgroundColor: isActive ? `${mode.borderActive}44` : mode.iconBg,
            color: isActive ? mode.accentColor : '#6b7280',
            border: `1px solid ${isActive ? mode.borderActive + '55' : '#1e2128'}`,
          }}
        >
          {mode.icon}
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold" style={{ color: isActive ? mode.accentColor : '#e5e7eb' }}>
            {mode.label}
          </p>
          <p className="text-xs truncate" style={{ color: isActive ? mode.accentColor + 'aa' : '#6b7280' }}>
            {mode.tagline}
          </p>
        </div>
      </div>

      {/* Description */}
      <p className="text-xs leading-relaxed" style={{ color: isActive ? '#d1fae5' : '#6b7280' }}>
        {mode.description}
      </p>

      {/* Meta rows */}
      <div className="flex flex-col gap-1.5 mt-1">
        <div className="flex items-start gap-2">
          <span
            className="text-xs font-medium flex-shrink-0 mt-0.5"
            style={{ color: isActive ? mode.accentColor + 'bb' : '#4b5563' }}
          >
            Agents:
          </span>
          <span className="text-xs" style={{ color: isActive ? '#a3e8c5' : '#4b5563' }}>
            {mode.prioritizedAgents.join(' · ')}
          </span>
        </div>
        <div className="flex items-start gap-2">
          <span
            className="text-xs font-medium flex-shrink-0 mt-0.5"
            style={{ color: isActive ? mode.accentColor + 'bb' : '#4b5563' }}
          >
            Comms:
          </span>
          <span className="text-xs" style={{ color: isActive ? '#a3e8c5' : '#4b5563' }}>
            {mode.communicationStyle}
          </span>
        </div>
      </div>
    </button>
  );
}

// ─── ATLAS Status Bar ─────────────────────────────────────────────────────────

function AtlasStatusBar({ detectedMode }: { detectedMode: AgentMode }) {
  const detected = MODES.find((m) => m.id === detectedMode)!;
  const hour = new Date().getHours();

  return (
    <div
      className="flex items-center gap-3 px-4 py-3 rounded-xl border"
      style={{ borderColor: '#1e2128', backgroundColor: '#0d0e14' }}
    >
      <div
        className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
        style={{ backgroundColor: '#16a34a22', border: '1px solid #16a34a44' }}
      >
        <Cpu size={14} className="text-green-400" />
      </div>
      <div className="flex flex-col gap-0.5 flex-1 min-w-0">
        <p className="text-xs font-semibold text-gray-300">ATLAS Auto-Detect</p>
        <p className="text-xs text-gray-600">
          Suggesting{' '}
          <span style={{ color: detected.accentColor }} className="font-medium">
            {detected.label}
          </span>{' '}
          based on time ({hour}:00)
        </p>
      </div>
      <div className="flex items-center gap-3 flex-shrink-0">
        <div className="flex items-center gap-1.5 text-xs text-gray-600">
          <Clock size={11} />
          <span>{new Date().toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' })}</span>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-gray-600">
          <MapPin size={11} />
          <span>Location TBD</span>
        </div>
      </div>
    </div>
  );
}

// ─── AgentModeSelector View Root ─────────────────────────────────────────────

export default function AgentModeSelector() {
  // Initialise agent shell on mount
  useEffect(() => {
    initAgentModeSelectorAgent();
  }, []);

  const [activeMode, setActiveMode] = useState<AgentMode>('standard');
  const [manualOverride, setManualOverride] = useState(false);

  // ATLAS auto-detect — recalculates when override changes
  const atlasMode = atlasDetectMode();

  // Effective mode: when override is OFF, ATLAS controls selection
  const effectiveMode = manualOverride ? activeMode : atlasMode;

  function handleModeSelect(modeId: AgentMode) {
    if (!manualOverride) return;
    setActiveMode(modeId);
    // Wire to agent bus / Supabase during integration:
    // emit('mode_switch', { from: effectiveMode, to: modeId })
  }

  function toggleOverride() {
    setManualOverride((prev) => {
      if (!prev) {
        // Switching to manual — seed with current ATLAS suggestion
        setActiveMode(atlasMode);
      }
      return !prev;
    });
  }

  const activeModeDef = MODES.find((m) => m.id === effectiveMode)!;

  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ backgroundColor: '#0a0b0f' }}>

      {/* ── Page Header ──────────────────────────────────────────────────────── */}
      <div
        className="flex items-center justify-between px-6 py-4 border-b flex-shrink-0"
        style={{ borderColor: '#1a1c23' }}
      >
        <div className="flex items-center gap-3">
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center"
            style={{ backgroundColor: '#16a34a22', border: '1px solid #16a34a44' }}
          >
            <ToggleRight size={16} className="text-green-400" />
          </div>
          <div>
            <h1 className="text-base font-semibold text-gray-100">Agent Mode Selector</h1>
            <p className="text-xs text-gray-600">
              Switch ATLAS operating context · {manualOverride ? 'Manual override ON' : 'Auto-detect active'}
            </p>
          </div>
        </div>

        {/* Active mode pill */}
        <div
          className="flex items-center gap-2 text-xs font-semibold px-3 py-1.5 rounded-full"
          style={{
            backgroundColor: `${activeModeDef.borderActive}22`,
            color: activeModeDef.accentColor,
            border: `1px solid ${activeModeDef.borderActive}44`,
          }}
        >
          <span
            className="w-1.5 h-1.5 rounded-full animate-pulse"
            style={{ backgroundColor: activeModeDef.accentColor }}
          />
          {activeModeDef.label}
        </div>
      </div>

      {/* ── Scrollable body ──────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-5">

        {/* ── ATLAS Status Bar ─────────────────────────────────────────────── */}
        <AtlasStatusBar detectedMode={atlasMode} />

        {/* ── Manual Override Toggle ────────────────────────────────────────── */}
        <div
          className="flex items-center justify-between px-4 py-3 rounded-xl border"
          style={{ borderColor: '#1e2128', backgroundColor: '#0d0e14' }}
        >
          <div className="flex flex-col gap-0.5">
            <p className="text-sm font-semibold text-gray-200">Manual Override</p>
            <p className="text-xs text-gray-600">
              {manualOverride
                ? 'You are controlling mode manually. ATLAS auto-detect is paused.'
                : 'ATLAS is auto-detecting mode based on time and location.'}
            </p>
          </div>
          <button
            onClick={toggleOverride}
            className="flex-shrink-0 ml-4 transition-colors"
            title={manualOverride ? 'Disable manual override' : 'Enable manual override'}
          >
            {manualOverride ? (
              <ToggleRight size={32} className="text-green-400" />
            ) : (
              <ToggleLeft size={32} className="text-gray-600" />
            )}
          </button>
        </div>

        {/* ── Mode Cards Grid ──────────────────────────────────────────────── */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-semibold uppercase tracking-widest text-gray-600">
              Agent Modes
            </p>
            {!manualOverride && (
              <span className="text-xs text-gray-600 flex items-center gap-1">
                <Cpu size={10} className="text-green-600" />
                ATLAS controlling
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-3">
            {MODES.map((mode) => (
              <ModeCard
                key={mode.id}
                mode={mode}
                isActive={effectiveMode === mode.id}
                isAtlasControlled={!manualOverride}
                onSelect={() => handleModeSelect(mode.id)}
              />
            ))}
          </div>
        </div>

        {/* ── Integration Note ─────────────────────────────────────────────── */}
        <div
          className="flex items-start gap-3 px-4 py-3 rounded-xl border"
          style={{ borderColor: '#1e2128', backgroundColor: '#0d0e1400' }}
        >
          <div className="w-5 h-5 flex-shrink-0 mt-0.5">
            <Cpu size={14} className="text-gray-700" />
          </div>
          <div className="flex flex-col gap-1">
            <p className="text-xs font-semibold text-gray-600">Integration Notes</p>
            <p className="text-xs text-gray-700 leading-relaxed">
              On mode change, emit <span className="font-mono text-gray-600">mode_switch</span> to the agent bus
              and persist to <span className="font-mono text-gray-600">user_preferences.agent_mode</span> in
              Supabase. ATLAS auto-detect should consume GPS coordinates and calendar context when integrated.
            </p>
          </div>
        </div>

      </div>
    </div>
  );
}
