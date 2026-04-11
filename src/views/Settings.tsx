/**
 * views/Settings.tsx
 * V3-22 — Watermark System
 *
 * App Settings panel. Currently houses the watermark export toggle.
 * Expand with additional app-wide settings as features are built out.
 */

import { Settings2, Droplets, Lock, CheckCircle, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';

// ─── Types ────────────────────────────────────────────────────────────────────

export type UserTier = 'solo' | 'growth' | 'pro' | 'enterprise';

export interface WatermarkSettings {
  /** Whether "PowerOn Hub" branding appears on exports. Always true for Solo/Growth. */
  showOnExports: boolean;
}

interface SettingsViewProps {
  userTier: UserTier;
  watermarkSettings: WatermarkSettings;
  onWatermarkSettingsChange: (s: WatermarkSettings) => void;
}

// ─── Tier Badge ───────────────────────────────────────────────────────────────

const TIER_COLORS: Record<UserTier, { bg: string; text: string; border: string; label: string }> = {
  solo:       { bg: '#1a1d27', text: '#6b7280', border: '#2a3040', label: 'Solo' },
  growth:     { bg: '#0f2a1a', text: '#4ade80', border: '#16a34a33', label: 'Growth' },
  pro:        { bg: '#1a1527', text: '#a78bfa', border: '#7c3aed33', label: 'Pro' },
  enterprise: { bg: '#1a1200', text: '#facc15', border: '#ca8a0433', label: 'Enterprise' },
};

function TierBadge({ tier }: { tier: UserTier }) {
  const c = TIER_COLORS[tier];
  return (
    <span
      className="text-xs font-semibold px-2.5 py-1 rounded-full border"
      style={{ backgroundColor: c.bg, color: c.text, borderColor: c.border }}
    >
      {c.label}
    </span>
  );
}

// ─── Toggle Row ───────────────────────────────────────────────────────────────

function ToggleRow({
  label,
  description,
  checked,
  onChange,
  locked,
  lockedReason,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  locked?: boolean;
  lockedReason?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex flex-col gap-0.5 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-200">{label}</span>
          {locked && (
            <span
              className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full"
              style={{ backgroundColor: '#1a1d27', color: '#6b7280', border: '1px solid #2a3040' }}
            >
              <Lock size={9} />
              {lockedReason ?? 'Upgrade required'}
            </span>
          )}
        </div>
        <p className="text-xs text-gray-500 leading-relaxed">{description}</p>
      </div>
      <button
        onClick={() => !locked && onChange(!checked)}
        disabled={locked}
        aria-checked={checked}
        role="switch"
        className="flex-shrink-0 relative mt-0.5"
        style={{ cursor: locked ? 'not-allowed' : 'pointer' }}
      >
        <div
          className="w-10 h-5 rounded-full transition-all duration-200"
          style={{
            backgroundColor: locked ? '#1a1d27' : checked ? '#16a34a' : '#374151',
            border: `1px solid ${locked ? '#2a3040' : checked ? '#22c55e55' : '#4b5563'}`,
            opacity: locked ? 0.5 : 1,
          }}
        >
          <div
            className="absolute top-0.5 w-4 h-4 rounded-full transition-all duration-200 shadow"
            style={{
              backgroundColor: locked ? '#374151' : checked ? '#86efac' : '#6b7280',
              transform: checked ? 'translateX(21px)' : 'translateX(1px)',
            }}
          />
        </div>
      </button>
    </div>
  );
}

// ─── Settings View ────────────────────────────────────────────────────────────

export default function SettingsView({
  userTier,
  watermarkSettings,
  onWatermarkSettingsChange,
}: SettingsViewProps) {
  const { user } = useAuth();
  const [rerunOnboardingLoading, setRerunOnboardingLoading] = useState(false);
  const canToggleExportWatermark = userTier === 'pro' || userTier === 'enterprise';

  // FIX 1 — Re-run Onboarding button
  const handleRerunOnboarding = async () => {
    if (!user?.id) return;
    setRerunOnboardingLoading(true);
    try {
      // Reset onboarding_completed flag to false, triggering the onboarding flow on next app reload
      await supabase
        .from('user_onboarding' as never)
        .upsert(
          {
            user_id: user.id,
            completed_at: null,
            updated_at: new Date().toISOString(),
          } as never,
          { onConflict: 'user_id' }
        );
      // Reload the app to re-trigger onboarding
      window.location.reload();
    } catch (err) {
      console.error('[Settings] Re-run onboarding failed:', err);
    } finally {
      setRerunOnboardingLoading(false);
    }
  };

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
            <Settings2 size={16} className="text-green-400" />
          </div>
          <div>
            <h1 className="text-base font-semibold text-gray-100">Settings</h1>
            <p className="text-xs text-gray-600">App preferences and export configuration</p>
          </div>
        </div>
        <TierBadge tier={userTier} />
      </div>

      {/* ── Scrollable Content ────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-6 max-w-2xl w-full mx-auto">

        {/* ── Watermark Settings ────────────────────────────────────────────── */}
        <div
          className="rounded-xl border overflow-hidden"
          style={{ borderColor: '#1e2128', backgroundColor: '#0d0e14' }}
        >
          {/* Card header */}
          <div
            className="flex items-center gap-2 px-5 py-3 border-b"
            style={{ borderColor: '#1e2128', backgroundColor: '#11121a' }}
          >
            <Droplets size={14} className="text-green-500" />
            <span className="text-sm font-semibold text-gray-200">Watermark</span>
          </div>

          <div className="px-5 py-5 flex flex-col gap-5">

            {/* Dashboard watermark — always on, informational */}
            <div
              className="flex items-start gap-3 p-3 rounded-lg"
              style={{ backgroundColor: '#0f1018', border: '1px solid #1e2128' }}
            >
              <CheckCircle size={14} className="text-green-500 mt-0.5 flex-shrink-0" />
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-medium text-gray-300">Dashboard watermark</span>
                <p className="text-xs text-gray-500 leading-relaxed">
                  A subtle watermark is always rendered at the bottom-right of every dashboard view.
                  This cannot be disabled — it is part of the PowerOn Hub display layer.
                </p>
              </div>
            </div>

            {/* Export watermark toggle */}
            <ToggleRow
              label="Show PowerOn Hub watermark on exports"
              description={
                canToggleExportWatermark
                  ? 'When enabled, PDF and Excel exports include "PowerOn Hub" branding in the footer or a hidden sheet. When disabled, exports show only your company name.'
                  : 'PDF and Excel exports include "PowerOn Hub" branding. Upgrade to Pro or Enterprise to disable this on exports.'
              }
              checked={watermarkSettings.showOnExports}
              onChange={(v) => onWatermarkSettingsChange({ ...watermarkSettings, showOnExports: v })}
              locked={!canToggleExportWatermark}
              lockedReason={canToggleExportWatermark ? undefined : 'Pro+ required'}
            />

          </div>
        </div>

        {/* ── Tier note ─────────────────────────────────────────────────────── */}
        {!canToggleExportWatermark && (
          <p className="text-xs text-gray-700 text-center">
            Upgrade to <span className="text-purple-500">Pro</span> or{' '}
            <span className="text-yellow-500">Enterprise</span> to remove PowerOn Hub branding from exports.
          </p>
        )}

        {/* ── Onboarding ────────────────────────────────────────────────────── */}
        <div
          className="rounded-xl border overflow-hidden"
          style={{ borderColor: '#1e2128', backgroundColor: '#0d0e14' }}
        >
          {/* Card header */}
          <div
            className="flex items-center gap-2 px-5 py-3 border-b"
            style={{ borderColor: '#1e2128', backgroundColor: '#11121a' }}
          >
            <RotateCcw size={14} className="text-emerald-500" />
            <span className="text-sm font-semibold text-gray-200">Onboarding</span>
          </div>

          <div className="px-5 py-5 flex flex-col gap-5">
            <div className="flex items-start justify-between gap-4">
              <div className="flex flex-col gap-0.5 flex-1">
                <span className="text-sm font-medium text-gray-200">Re-run Setup Wizard</span>
                <p className="text-xs text-gray-500 leading-relaxed">
                  Start the initial setup wizard again. This lets you update your AI name, business type, and job types.
                  The wizard will only show once per login after you complete it.
                </p>
              </div>
              <button
                onClick={handleRerunOnboarding}
                disabled={rerunOnboardingLoading}
                className="flex-shrink-0 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                style={{
                  backgroundColor: rerunOnboardingLoading ? '#2a3040' : '#16a34a',
                  color: rerunOnboardingLoading ? '#6b7280' : '#ffffff',
                  cursor: rerunOnboardingLoading ? 'not-allowed' : 'pointer',
                }}
              >
                {rerunOnboardingLoading ? 'Restarting...' : 'Re-run Setup'}
              </button>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
