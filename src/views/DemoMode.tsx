import { useState, useRef, useEffect } from 'react';
import {
  Zap,
  ToggleLeft,
  ToggleRight,
  Link,
  Building2,
  ChevronDown,
  DollarSign,
  User,
  Briefcase,
  Check,
} from 'lucide-react';
import { initDemoModeAgent } from '../agents/demoMode';
import { useDemoStore, INDUSTRY_LABELS } from '../store/demoStore';
import { getTemplate } from '../config/templates/index';

// ─── Types ────────────────────────────────────────────────────────────────────

type IndustryKey = 'electrical' | 'plumbing' | 'gc' | 'medical-billing' | 'mechanic' | 'electrical-supplier';

interface DemoProject {
  name: string;
  client: string;
  value: string;
  status: string;
}

interface DemoModeProps {
  isActive: boolean;
  onToggle: (active: boolean) => void;
}

// ─── Industry options ─────────────────────────────────────────────────────────

const INDUSTRY_OPTIONS: { key: IndustryKey; label: string }[] = [
  { key: 'electrical', label: 'Electrical' },
  { key: 'plumbing', label: 'Plumbing' },
  { key: 'gc', label: 'General Contractor' },
  { key: 'medical-billing', label: 'Medical Billing' },
  { key: 'mechanic', label: 'Mechanic' },
  { key: 'electrical-supplier', label: 'Electrical Supplier' },
];

// ─── Demo Dataset ─────────────────────────────────────────────────────────────

const DEMO_DATA: Record<IndustryKey, DemoProject[]> = {
  electrical: [
    { name: 'Sunrise Commons — Panel Upgrade', client: 'Harborview Properties LLC', value: '$48,200', status: 'In Progress' },
    { name: 'Skyline Office Fit-Out', client: 'Meridian Commercial Group', value: '$124,500', status: 'Estimating' },
    { name: 'Westwood Retail Lighting', client: 'Cascade Retail Partners', value: '$19,750', status: 'Invoiced' },
    { name: 'Bayside Condo EV Charging', client: 'Pacific Coast HOA', value: '$33,100', status: 'Signed' },
  ],
  plumbing: [
    { name: 'Riverfront Apartments — Remodel', client: 'Summit Residential', value: '$62,800', status: 'In Progress' },
    { name: 'Civic Center HVAC Tie-In', client: 'City of Portview', value: '$91,300', status: 'Estimating' },
    { name: 'Coffee House Build-Out', client: 'Roast & Co LLC', value: '$14,200', status: 'Invoiced' },
    { name: 'Medical Office Backflow Prev.', client: 'Valley Medical Center', value: '$8,900', status: 'Signed' },
  ],
  gc: [
    { name: 'Harbor Heights — Phase 2', client: 'Coastal Development Inc', value: '$1,240,000', status: 'In Progress' },
    { name: 'Downtown Loft Conversion', client: 'Urban Revive LLC', value: '$385,000', status: 'Estimating' },
    { name: 'Maplewood Elementary Addition', client: 'School District 47', value: '$2,100,000', status: 'Signed' },
    { name: 'Storage Facility Tilt-Up', client: 'Pacific Self-Storage', value: '$740,000', status: 'Invoiced' },
  ],
  'medical-billing': [
    { name: 'Q1 Claims Batch — Cardiology', client: 'Heartland Cardiology Group', value: '$184,300', status: 'In Progress' },
    { name: 'Denial Review — Orthopedics', client: 'Pacific Orthopedic Associates', value: '$57,200', status: 'Review' },
    { name: 'Annual Audit Prep', client: 'Valley Family Medicine', value: '$22,000', status: 'Signed' },
    { name: 'Credentialing Support', client: 'New Horizons Clinic', value: '$8,500', status: 'Invoiced' },
  ],
  mechanic: [
    { name: 'Fleet Service Contract — Year 2', client: 'Northwest Freight Co.', value: '$96,000', status: 'Active' },
    { name: 'Transmission Overhaul Batch', client: 'City Transit Authority', value: '$41,500', status: 'In Progress' },
    { name: 'Brake System Upgrade — 12 Units', client: 'Cascade Courier LLC', value: '$18,300', status: 'Invoiced' },
    { name: 'Diagnostic Suite Install', client: 'Summit Auto Group', value: '$23,700', status: 'Estimating' },
  ],
  'electrical-supplier': [
    { name: 'Q2 Wire & Conduit Bulk Order', client: 'Pacific Coast Electric LLC', value: '$47,300', status: 'In Progress' },
    { name: 'Panel Inventory — Commercial Restock', client: 'Cascade Electrical Contractors', value: '$31,800', status: 'Estimating' },
    { name: 'Commercial Lighting Kit — 40 Units', client: 'Summit Property Management', value: '$12,500', status: 'Invoiced' },
    { name: 'Industrial Breaker Supply', client: 'Meridian Industrial Group', value: '$22,900', status: 'Signed' },
  ],
};

// ─── Status Badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    'In Progress': 'bg-blue-900/40 text-blue-400 border-blue-800/60',
    'Estimating': 'bg-yellow-900/40 text-yellow-400 border-yellow-800/60',
    'Invoiced': 'bg-purple-900/40 text-purple-400 border-purple-800/60',
    'Signed': 'bg-green-900/40 text-green-400 border-green-800/60',
    'Active': 'bg-green-900/40 text-green-400 border-green-800/60',
    'Review': 'bg-orange-900/40 text-orange-400 border-orange-800/60',
  };
  const cls = colors[status] ?? 'bg-gray-800 text-gray-400 border-gray-700';
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${cls}`}>
      {status}
    </span>
  );
}

// ─── Big Toggle Switch ────────────────────────────────────────────────────────

function BigToggle({ isActive, onToggle }: { isActive: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      className="relative flex items-center justify-center focus:outline-none"
      aria-pressed={isActive}
      aria-label="Toggle demo mode"
    >
      <div
        className="relative w-20 h-10 rounded-full transition-all duration-300 flex items-center"
        style={{
          backgroundColor: isActive ? '#ca8a04' : '#1e2128',
          border: `2px solid ${isActive ? '#eab308' : '#2a3040'}`,
          boxShadow: isActive ? '0 0 16px rgba(234,179,8,0.3)' : 'none',
        }}
      >
        <div
          className="absolute w-7 h-7 rounded-full transition-all duration-300 flex items-center justify-center shadow-md"
          style={{
            backgroundColor: isActive ? '#fef08a' : '#4b5563',
            transform: isActive ? 'translateX(44px)' : 'translateX(2px)',
          }}
        >
          {isActive ? (
            <ToggleRight size={14} style={{ color: '#92400e' }} />
          ) : (
            <ToggleLeft size={14} style={{ color: '#9ca3af' }} />
          )}
        </div>
      </div>
    </button>
  );
}

// ─── Share Demo Link Button ───────────────────────────────────────────────────

function ShareDemoButton({ industryKey }: { industryKey: IndustryKey }) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function buildDemoUrl(): string {
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('demo', 'true');
      url.searchParams.set('industry', industryKey);
      // Remove any panel-specific params to start clean
      url.searchParams.delete('view');
      return url.toString();
    } catch {
      return `${window.location.origin}?demo=true&industry=${industryKey}`;
    }
  }

  function handleClick() {
    const demoUrl = buildDemoUrl();
    try {
      navigator.clipboard.writeText(demoUrl).then(() => {
        setCopied(true);
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => setCopied(false), 2000);
      });
    } catch {
      // Fallback: just show copied state
      setCopied(true);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), 2000);
    }
  }

  return (
    <button
      onClick={handleClick}
      className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all"
      style={{
        backgroundColor: copied ? '#14532d22' : '#1a1d27',
        color: copied ? '#4ade80' : '#6b7280',
        border: `1px solid ${copied ? '#4ade8044' : '#2a3040'}`,
      }}
      title="Copy shareable demo link"
    >
      {copied ? <Check size={14} /> : <Link size={14} />}
      {copied ? 'Copied!' : 'Share Demo Link'}
    </button>
  );
}

// ─── DemoMode View ────────────────────────────────────────────────────────────

export default function DemoMode({ isActive: isActiveProp, onToggle: onToggleProp }: DemoModeProps) {
  // B15 fix: use store as source of truth when props are not provided
  // (AppShell renders <DemoModeView /> without props; Zustand store is always available)
  const { isDemoMode, toggleDemoMode, currentIndustry, setIndustry, getDemoCompanyName } = useDemoStore();
  // Hooks must all be called unconditionally before any conditional logic
  const isActive = isActiveProp ?? isDemoMode;
  const onToggle = onToggleProp ?? toggleDemoMode;
  const industryKey = (currentIndustry as IndustryKey) || 'electrical';

  const [companyName, setCompanyName] = useState(() => {
    try { return getDemoCompanyName() } catch { return 'Demo Company LLC' }
  });

  // Initialize agent shell on mount (stub) — use useEffect, not useState
  useEffect(() => {
    initDemoModeAgent();
  }, []);

  // On mount: read industry from URL param first, then fall back to store
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const urlIndustry = params.get('industry');
    if (urlIndustry && INDUSTRY_OPTIONS.some(o => o.key === urlIndustry)) {
      setIndustry(urlIndustry);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When industry changes in store, update company name from template
  useEffect(() => {
    try { setCompanyName(getDemoCompanyName()) } catch { /* ignore */ }
  }, [currentIndustry]); // eslint-disable-line react-hooks/exhaustive-deps

  const projects = DEMO_DATA[industryKey] ?? DEMO_DATA.electrical;
  const industryLabel = INDUSTRY_LABELS[industryKey] ?? industryKey;

  // Load template data for the current industry (for display / future use)
  const template = industryKey !== 'electrical' ? getTemplate(industryKey) : null;
  const templatePhases = template?.projectPhases ?? null;

  function handleIndustryChange(key: string) {
    setIndustry(key);
    // URL is updated inside setIndustry when demo is active
  }

  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ backgroundColor: '#0a0b0f' }}>

      {/* ── Page Header ────────────────────────────────────────────────────── */}
      <div
        className="flex items-center justify-between px-6 py-4 border-b flex-shrink-0"
        style={{ borderColor: '#1a1c23' }}
      >
        <div className="flex items-center gap-3">
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center"
            style={{
              backgroundColor: isActive ? '#713f1220' : '#16a34a22',
              border: `1px solid ${isActive ? '#ca8a0444' : '#16a34a44'}`,
            }}
          >
            <Zap size={16} style={{ color: isActive ? '#eab308' : '#4ade80' }} />
          </div>
          <div>
            <h1 className="text-base font-semibold text-gray-100">Demo Mode</h1>
            <p className="text-xs text-gray-600">Safe mock data for demos and testing · Display-layer only</p>
          </div>
        </div>
        <div
          className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full"
          style={{
            backgroundColor: isActive ? '#422006' : '#0f1a0f',
            color: isActive ? '#facc15' : '#4ade80',
            border: `1px solid ${isActive ? '#ca8a0440' : '#16a34a33'}`,
          }}
        >
          <span
            className="w-1.5 h-1.5 rounded-full"
            style={{ backgroundColor: isActive ? '#eab308' : '#4ade80' }}
          />
          {isActive ? 'Demo Active' : 'Demo Off · E17'}
        </div>
      </div>

      {/* ── Scrollable Content ─────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-6 max-w-2xl w-full mx-auto">

        {/* ── Master Toggle Panel ──────────────────────────────────────────── */}
        <div
          className="rounded-xl border overflow-hidden"
          style={{
            borderColor: isActive ? '#ca8a0440' : '#1e2128',
            backgroundColor: '#0d0e14',
            boxShadow: isActive ? '0 0 24px rgba(234,179,8,0.06)' : 'none',
          }}
        >
          <div
            className="flex items-center justify-between px-5 py-4 border-b"
            style={{ borderColor: isActive ? '#ca8a0430' : '#1e2128', backgroundColor: '#11121a' }}
          >
            <div className="flex items-center gap-2 text-sm font-semibold text-gray-200">
              <span style={{ color: isActive ? '#eab308' : '#4ade80' }}>
                <Zap size={14} />
              </span>
              Demo Mode
            </div>
            <div
              className="text-xs px-2.5 py-1 rounded-full font-medium"
              style={{
                backgroundColor: isActive ? '#422006' : '#1a1d27',
                color: isActive ? '#fde047' : '#6b7280',
                border: `1px solid ${isActive ? '#ca8a0450' : '#2a3040'}`,
              }}
            >
              {isActive ? 'ACTIVE' : 'INACTIVE'}
            </div>
          </div>

          <div className="px-5 py-6 flex items-center justify-between gap-6">
            <div className="flex flex-col gap-1">
              <p className="text-sm font-medium text-gray-200">
                {isActive ? 'Demo mode is on' : 'Activate Demo Mode'}
              </p>
              <p className="text-xs text-gray-500 leading-relaxed max-w-sm">
                {isActive
                  ? 'All displayed data is replaced with safe mock values. No real project or client information is visible.'
                  : 'Replace all app data with safe mock values for demos, screenshots, or testing.'}
              </p>
              {isActive && (
                <p className="text-xs font-medium mt-1" style={{ color: '#facc15' }}>
                  {companyName} · {industryLabel}
                </p>
              )}
            </div>
            <BigToggle isActive={isActive} onToggle={() => onToggle(!isActive)} />
          </div>
        </div>

        {/* ── Configuration Panel ──────────────────────────────────────────── */}
        <div
          className="rounded-xl border overflow-hidden"
          style={{ borderColor: '#1e2128', backgroundColor: '#0d0e14' }}
        >
          <div
            className="flex items-center gap-2 px-5 py-3 border-b text-sm font-semibold text-gray-200"
            style={{ borderColor: '#1e2128', backgroundColor: '#11121a' }}
          >
            <span className="text-green-500"><Building2 size={14} /></span>
            Configuration
          </div>

          <div className="px-5 py-5 flex flex-col gap-5">
            {/* Industry Selector */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-gray-400 uppercase tracking-wide flex items-center gap-1.5">
                <Briefcase size={11} />
                Industry
              </label>
              <div className="relative">
                <select
                  value={industryKey}
                  onChange={(e) => handleIndustryChange(e.target.value)}
                  className="w-full appearance-none px-3 py-2.5 rounded-lg text-sm text-gray-200 outline-none pr-8 transition-all"
                  style={{
                    backgroundColor: '#1a1d27',
                    border: '1px solid #2a3040',
                  }}
                  onFocus={(e) => (e.currentTarget.style.borderColor = '#4ade80')}
                  onBlur={(e) => (e.currentTarget.style.borderColor = '#2a3040')}
                >
                  {INDUSTRY_OPTIONS.map(({ key, label }) => (
                    <option key={key} value={key}>{label}</option>
                  ))}
                </select>
                <ChevronDown
                  size={13}
                  className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-gray-500"
                />
              </div>
              <p className="text-xs text-gray-600">
                Controls company name, project names, price book, and NEXUS personality.
              </p>
            </div>

            {/* Company Name */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-gray-400 uppercase tracking-wide flex items-center gap-1.5">
                <Building2 size={11} />
                Demo Company Name
              </label>
              <input
                type="text"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                placeholder="Pacific Coast Electric LLC"
                className="w-full px-3 py-2.5 rounded-lg text-sm text-gray-200 placeholder-gray-600 outline-none transition-all"
                style={{
                  backgroundColor: '#1a1d27',
                  border: '1px solid #2a3040',
                }}
                onFocus={(e) => (e.currentTarget.style.borderColor = '#4ade80')}
                onBlur={(e) => (e.currentTarget.style.borderColor = '#2a3040')}
              />
              <p className="text-xs text-gray-600">
                Pre-populated from the selected industry template. Edit to customize.
              </p>
            </div>

            {/* Template Phases preview (when a template is loaded) */}
            {templatePhases && templatePhases.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
                  Project Phases
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {templatePhases.map((phase: { id: string; label: string }) => (
                    <span
                      key={phase.id}
                      className="text-xs px-2 py-1 rounded-md"
                      style={{ backgroundColor: '#1a1d27', color: '#9ca3af', border: '1px solid #2a3040' }}
                    >
                      {phase.label}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── Demo Data Preview ────────────────────────────────────────────── */}
        <div
          className="rounded-xl border overflow-hidden"
          style={{ borderColor: '#1e2128', backgroundColor: '#0d0e14' }}
        >
          <div
            className="flex items-center justify-between px-5 py-3 border-b"
            style={{ borderColor: '#1e2128', backgroundColor: '#11121a' }}
          >
            <div className="flex items-center gap-2 text-sm font-semibold text-gray-200">
              <span className="text-green-500"><Briefcase size={14} /></span>
              Demo Data Preview
            </div>
            <span
              className="text-xs font-medium px-2.5 py-1 rounded-full"
              style={{ backgroundColor: '#1a1d27', color: '#6b7280', border: '1px solid #2a3040' }}
            >
              {industryLabel}
            </span>
          </div>

          <div className="p-4">
            <p className="text-xs text-gray-600 mb-3 px-1">
              When demo mode is active, these sample records replace your real project data across all views.
            </p>
            <div className="flex flex-col gap-2">
              {projects.map((project, i) => (
                <div
                  key={i}
                  className="flex flex-col gap-1.5 p-3 rounded-lg border"
                  style={{ borderColor: '#1e2128', backgroundColor: '#0f1018' }}
                >
                  <div className="flex items-start justify-between gap-2 flex-wrap">
                    <span className="text-sm font-medium text-gray-200 flex-1 min-w-0">{project.name}</span>
                    <StatusBadge status={project.status} />
                  </div>
                  <div className="flex items-center gap-4 flex-wrap">
                    <div className="flex items-center gap-1.5 text-xs text-gray-500">
                      <User size={10} />
                      {project.client}
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-gray-400 font-medium">
                      <DollarSign size={10} className="text-green-600" />
                      {project.value}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── Share & Actions ──────────────────────────────────────────────── */}
        <div
          className="rounded-xl border overflow-hidden"
          style={{ borderColor: '#1e2128', backgroundColor: '#0d0e14' }}
        >
          <div
            className="flex items-center gap-2 px-5 py-3 border-b text-sm font-semibold text-gray-200"
            style={{ borderColor: '#1e2128', backgroundColor: '#11121a' }}
          >
            <span className="text-green-500"><Link size={14} /></span>
            Sharing
          </div>
          <div className="px-5 py-5 flex flex-col gap-3">
            <p className="text-xs text-gray-500 leading-relaxed">
              Generate a shareable link that opens the app in demo mode for the selected industry. Recipients won't see any real data.
            </p>
            <div className="flex items-center gap-3 flex-wrap">
              <ShareDemoButton industryKey={industryKey} />
              <span className="text-xs text-gray-700">
                Generates a <code className="text-gray-600">?demo=true&industry={industryKey}</code> URL
              </span>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
