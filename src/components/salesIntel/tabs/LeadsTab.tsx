import React from 'react';
import { HunterPanel } from '@/components/hunter';

// HUNTER-B1-NAV-ENTRY-APR23-2026-1 — canonical HUNTER entry point.
// Renders HunterPanel with no props; component uses its own defaults
// (includes SAMPLE_LEADS mock data — removed in B3 when Panel subscribes to store).
export const LeadsTab: React.FC = () => {
  return <HunterPanel />;
};