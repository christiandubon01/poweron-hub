/**
 * DemoModeGate.ts
 * V4-OB2 — Demo Mode availability gate and first-time user prompt logic.
 *
 * Rules:
 *   - Demo Mode is ALWAYS available regardless of onboarding state.
 *   - First-time users see a "Try Demo Mode" prompt if no real data exists
 *     after 5 minutes of use.
 *   - Demo data is pre-loaded per business type derived from the onboarding
 *     interview (stored in profiles.business_type).
 *
 * Does NOT modify real data.  All demo state is isolated.
 */

import { supabase } from '@/lib/supabase';

// ── Types ──────────────────────────────────────────────────────────────────────

export type BusinessType =
  | 'residential'
  | 'commercial'
  | 'industrial'
  | 'solar'
  | 'service_only'
  | 'general';

export interface DemoModeState {
  /** Whether demo mode is currently active */
  active: boolean;
  /** The business type used to load demo data */
  businessType: BusinessType;
  /** ISO timestamp when demo mode was last activated */
  activatedAt: string | null;
}

export interface DemoPromptDecision {
  /** Should the "Try Demo Mode" prompt be shown to this user right now? */
  shouldShow: boolean;
  /** Reason for the decision (for logging / debugging) */
  reason: string;
}

// ── Constants ──────────────────────────────────────────────────────────────────

/** Delay before showing the demo prompt to new users (ms). */
export const DEMO_PROMPT_DELAY_MS = 5 * 60 * 1000; // 5 minutes

/** localStorage key used to persist demo mode state client-side. */
const LOCAL_KEY_DEMO_STATE = 'poweron_demo_mode_state';

/** localStorage key used to record when the user first opened the app. */
const LOCAL_KEY_FIRST_SEEN = 'poweron_first_seen_at';

// ── Business-type demo data descriptors ──────────────────────────────────────
// Each entry describes the demo dataset available for a business type.
// Actual data objects live in demoDataService.ts — this map is used for
// labelling and routing only.

export const BUSINESS_TYPE_LABELS: Record<BusinessType, string> = {
  residential: 'Residential Contractor',
  commercial:  'Commercial Contractor',
  industrial:  'Industrial / IBEW',
  solar:       'Solar & Storage',
  service_only:'Service & Repair',
  general:     'General Electrical',
};

// ── Local helpers ──────────────────────────────────────────────────────────────

function readLocalDemoState(): DemoModeState | null {
  try {
    const raw = localStorage.getItem(LOCAL_KEY_DEMO_STATE);
    if (!raw) return null;
    return JSON.parse(raw) as DemoModeState;
  } catch {
    return null;
  }
}

function writeLocalDemoState(state: DemoModeState): void {
  try {
    localStorage.setItem(LOCAL_KEY_DEMO_STATE, JSON.stringify(state));
  } catch {
    // Non-fatal — demo state will reset on reload
  }
}

function getFirstSeenAt(): number {
  try {
    const raw = localStorage.getItem(LOCAL_KEY_FIRST_SEEN);
    if (raw) return parseInt(raw, 10);
    const now = Date.now();
    localStorage.setItem(LOCAL_KEY_FIRST_SEEN, String(now));
    return now;
  } catch {
    return Date.now();
  }
}

// ── Supabase helpers ───────────────────────────────────────────────────────────

async function fetchBusinessType(userId: string): Promise<BusinessType> {
  try {
    // business_type is a V4 profile column — cast to any until types are regenerated
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (supabase as any)
      .from('profiles')
      .select('business_type')
      .eq('id', userId)
      .single();
    const bt = (data as { business_type?: string } | null)?.business_type as BusinessType | undefined;
    return bt && bt in BUSINESS_TYPE_LABELS ? bt : 'general';
  } catch {
    return 'general';
  }
}

/**
 * Returns true if the user has any real project or service data in Supabase.
 * Used to decide whether the "Try Demo Mode" prompt makes sense.
 */
async function userHasRealData(userId: string): Promise<boolean> {
  try {
    const [projectsRes, serviceLogsRes] = await Promise.all([
      supabase
        .from('projects')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId),
      supabase
        .from('service_logs')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId),
    ]);
    const projectCount = projectsRes.count ?? 0;
    const serviceCount = serviceLogsRes.count ?? 0;
    return projectCount > 0 || serviceCount > 0;
  } catch {
    return false;
  }
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Demo Mode is always available — this simply returns the canonical state.
 * Reads from localStorage first; falls back to a disabled default.
 */
export function getDemoModeState(): DemoModeState {
  return (
    readLocalDemoState() ?? {
      active: false,
      businessType: 'general',
      activatedAt: null,
    }
  );
}

/**
 * Activate Demo Mode for a user.
 *
 * @param userId       Supabase auth user id (used to look up business type)
 * @param forceType    Optionally override the business type for demo data
 */
export async function activateDemoMode(
  userId: string,
  forceType?: BusinessType
): Promise<DemoModeState> {
  const businessType = forceType ?? (await fetchBusinessType(userId));

  const state: DemoModeState = {
    active: true,
    businessType,
    activatedAt: new Date().toISOString(),
  };

  writeLocalDemoState(state);
  return state;
}

/**
 * Deactivate Demo Mode and return the app to normal state.
 */
export function deactivateDemoMode(): void {
  const current = readLocalDemoState();
  if (!current) return;

  writeLocalDemoState({
    ...current,
    active: false,
    activatedAt: null,
  });
}

/**
 * Determines whether the "Try Demo Mode" prompt should be shown right now.
 *
 * Rules:
 *   1. Never show if demo mode is already active.
 *   2. Never show if the user already has real data.
 *   3. Never show if the user has dismissed the prompt before.
 *   4. Show if the user has been in the app for ≥ DEMO_PROMPT_DELAY_MS
 *      and still has no real data.
 *
 * @param userId  Supabase auth user id
 */
export async function shouldShowDemoPrompt(userId: string): Promise<DemoPromptDecision> {
  // Rule 1 — already in demo mode
  const current = getDemoModeState();
  if (current.active) {
    return { shouldShow: false, reason: 'demo_already_active' };
  }

  // Rule 3 — check dismissal flag in localStorage
  const dismissedKey = `poweron_demo_prompt_dismissed_${userId}`;
  if (localStorage.getItem(dismissedKey) === '1') {
    return { shouldShow: false, reason: 'prompt_dismissed_by_user' };
  }

  // Rule 4 — check elapsed time
  const firstSeen = getFirstSeenAt();
  const elapsed = Date.now() - firstSeen;
  if (elapsed < DEMO_PROMPT_DELAY_MS) {
    return {
      shouldShow: false,
      reason: `prompt_too_early_${Math.round((DEMO_PROMPT_DELAY_MS - elapsed) / 1000)}s_remaining`,
    };
  }

  // Rule 2 — check for real data (only after time gate to avoid unnecessary queries)
  const hasData = await userHasRealData(userId);
  if (hasData) {
    return { shouldShow: false, reason: 'user_has_real_data' };
  }

  return { shouldShow: true, reason: 'new_user_no_data_after_delay' };
}

/**
 * Permanently dismisses the demo prompt for this user on this device.
 *
 * @param userId  Supabase auth user id
 */
export function dismissDemoPrompt(userId: string): void {
  try {
    localStorage.setItem(`poweron_demo_prompt_dismissed_${userId}`, '1');
  } catch {
    // Non-fatal
  }
}

/**
 * Returns the business type label for display in UI.
 *
 * @param type  BusinessType
 */
export function getBusinessTypeLabel(type: BusinessType): string {
  return BUSINESS_TYPE_LABELS[type] ?? 'General Electrical';
}
