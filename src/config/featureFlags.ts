/**
 * src/config/featureFlags.ts
 * V3-31 — Feature Flags
 * V3-33 — Added katsuroHandoff flag
 *
 * Central registry for feature flags used across PowerOn Hub.
 * All flags default to OFF unless explicitly enabled.
 * Toggle flags here or wire to a remote config source (e.g. Supabase, LaunchDarkly).
 */

export interface FeatureFlags {
  /** V3-31: Session conclusion extraction + NEXUS cold-open prevention */
  sessionConclusions: boolean;

  /**
   * V3-33: Owner-only handoff context injection at session open.
   * Gates ALL reads from the katsuro_handoff table.
   * Default OFF. Enable ONLY for the org owner account with DaSparkyHub active.
   * Non-owner users are unaffected regardless of this flag's value —
   * the isOwnerWithDaSparkyHub() security check in katsuroHandoffService.ts
   * provides a second, independent guard layer.
   */
  katsuroHandoff: boolean;
}

export const featureFlags: FeatureFlags = {
  sessionConclusions: false,
  katsuroHandoff: false,
};
