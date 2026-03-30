-- ══════════════════════════════════════════════════════════════════════════════
-- PowerOn Hub — Migration 007: Seed Data
-- Phase 01 Foundation
--
-- Seeds:
--   1. All 11 agents (SIGNAL + FRAME kept as legacy for audit trail continuity)
--   2. Starter project templates for the most common Power On Solutions job types
--
-- NOTE: This migration is idempotent — it uses ON CONFLICT DO UPDATE so it is
--       safe to re-run if the agents table is wiped and re-seeded.
-- ══════════════════════════════════════════════════════════════════════════════


-- ══════════════════════════════════
-- 1. SEED ALL 11 AGENTS
--
-- memory_scope controls which tables each agent is allowed to read in its
-- semantic search queries. '*' grants full scope (NEXUS and SCOUT only).
--
-- BLUEPRINT absorbs the domains of SIGNAL (RFI) and FRAME (Projects) in v2.
-- SIGNAL and FRAME remain in the registry as 'maintenance' status so that:
--   a) Existing audit log entries referencing them remain valid (FK integrity)
--   b) Legacy memory embeddings created by these agents are still queryable
--   c) Any Phase 01 → Phase 02 migration scripts can reference them safely
-- ══════════════════════════════════
INSERT INTO agents (id, name, display_name, domain, status, memory_scope, config)
VALUES

  -- ── Core Agents ──────────────────────────────────────────────────────────

  (
    'nexus',
    'NEXUS',
    'NEXUS — Manager Agent',
    'command',
    'active',
    ARRAY['*'],
    '{
      "description": "Top-level orchestrator. Receives all user requests, delegates to sub-agents, and synthesizes reports.",
      "voice_enabled": true,
      "delegation_timeout_sec": 30,
      "report_schedule": "0 7 * * 1-5"
    }'::jsonb
  ),

  (
    'vault',
    'VAULT',
    'VAULT — Estimating Agent',
    'estimating',
    'active',
    ARRAY['estimates','projects','clients','memory_embeddings'],
    '{
      "description": "Builds and analyzes estimates. Tracks margins, compares to historical jobs, and flags risk.",
      "confidence_threshold": 0.75,
      "default_margin_target_pct": 30,
      "low_margin_alert_threshold_pct": 15
    }'::jsonb
  ),

  (
    'pulse',
    'PULSE',
    'PULSE — Dashboard Agent',
    'dashboard',
    'active',
    ARRAY['projects','invoices','estimates','leads','campaigns','payments'],
    '{
      "description": "Generates KPI snapshots, trend charts, and executive summaries for the dashboard.",
      "refresh_interval_min": 15,
      "kpi_targets": {
        "monthly_revenue": null,
        "gross_margin_pct": 30,
        "ar_days_target": 30,
        "lead_conversion_target_pct": 25
      }
    }'::jsonb
  ),

  (
    'ledger',
    'LEDGER',
    'LEDGER — Money Agent',
    'finance',
    'active',
    ARRAY['invoices','payments','projects','clients'],
    '{
      "description": "Manages AR, sends payment reminders, tracks cash flow, flags overdue invoices.",
      "reminder_day_1": 1,
      "reminder_day_2": 7,
      "reminder_day_3": 14,
      "overdue_escalation_days": 30,
      "auto_reminder_enabled": true
    }'::jsonb
  ),

  (
    'spark',
    'SPARK',
    'SPARK — Marketing Agent',
    'marketing',
    'active',
    ARRAY['leads','campaigns','reviews','clients','projects'],
    '{
      "description": "Manages leads, drafts review responses, builds seasonal campaigns.",
      "review_response_tone": "professional_friendly",
      "lead_follow_up_days": [1, 3, 7],
      "auto_draft_responses": true
    }'::jsonb
  ),

  (
    'blueprint',
    'BLUEPRINT',
    'BLUEPRINT — Project Framework Agent',
    'projects',
    'active',
    ARRAY['projects','project_phases','project_templates','rfis','change_orders','compliance_checks','clients'],
    '{
      "description": "Owns the full project lifecycle. Manages phases, templates, RFIs, change orders, permits, and closeout scoring. Merged domain of legacy SIGNAL and FRAME agents.",
      "merged_from": ["signal","frame"],
      "closeout_score_weights": {
        "punch_list_completed": 0.25,
        "permit_closed": 0.20,
        "final_inspection_passed": 0.20,
        "invoice_paid": 0.20,
        "review_received": 0.15
      },
      "rfi_overdue_alert_days": 3
    }'::jsonb
  ),

  (
    'ohm',
    'OHM',
    'OHM — Electrical Coach Agent',
    'compliance',
    'active',
    ARRAY['projects','rfis','compliance_checks','memory_embeddings'],
    '{
      "description": "NEC/OSHA compliance scanning, code reference lookup, safety findings, training proposals.",
      "nec_version": "2023",
      "auto_scan_on_project_create": true,
      "severity_alert_threshold": "warning"
    }'::jsonb
  ),

  (
    'chrono',
    'CHRONO',
    'CHRONO — Calendar Agent',
    'calendar',
    'active',
    ARRAY['calendar_events','crew_members','projects','leads','clients'],
    '{
      "description": "Manages job scheduling, crew dispatch, client reminders, and Google Calendar sync.",
      "reminder_hours_before": 24,
      "google_calendar_sync_enabled": false,
      "business_hours": {"start": "06:00", "end": "18:00", "timezone": "America/Los_Angeles"},
      "dispatch_buffer_min": 30
    }'::jsonb
  ),

  (
    'scout',
    'SCOUT',
    'SCOUT — System Analyzer Agent',
    'analysis',
    'active',
    ARRAY['*'],
    '{
      "description": "Cross-system pattern detection, MiroFish proposal verification, and strategic recommendations.",
      "mirofish_enabled": true,
      "proposal_scan_interval_hours": 24,
      "min_data_points_for_pattern": 3
    }'::jsonb
  ),

  -- ── Legacy Agents (v1 — merged into BLUEPRINT in v2) ──────────────────────
  -- Status: maintenance — prevents new messages/proposals but preserves all
  -- historical references in audit_log and memory_embeddings

  (
    'signal',
    'SIGNAL',
    'SIGNAL — RFI Agent (Legacy / Merged into BLUEPRINT)',
    'rfi',
    'maintenance',
    ARRAY['rfis','projects'],
    '{
      "description": "Legacy RFI agent from v1. All RFI functionality has been merged into BLUEPRINT as of v2.0. This record is preserved for audit trail integrity.",
      "legacy": true,
      "merged_into": "blueprint",
      "migration_date": "2024-01-01"
    }'::jsonb
  ),

  (
    'frame',
    'FRAME',
    'FRAME — Project Agent (Legacy / Merged into BLUEPRINT)',
    'projects',
    'maintenance',
    ARRAY['projects','project_phases'],
    '{
      "description": "Legacy project agent from v1. All project lifecycle functionality has been merged into BLUEPRINT as of v2.0. This record is preserved for audit trail integrity.",
      "legacy": true,
      "merged_into": "blueprint",
      "migration_date": "2024-01-01"
    }'::jsonb
  )

ON CONFLICT (id) DO UPDATE SET
  display_name   = EXCLUDED.display_name,
  domain         = EXCLUDED.domain,
  status         = EXCLUDED.status,
  memory_scope   = EXCLUDED.memory_scope,
  config         = EXCLUDED.config;


-- ══════════════════════════════════
-- 2. SEED STARTER PROJECT TEMPLATES
--
-- Templates are org-scoped, but we create a global "system" org-independent
-- set using a placeholder NULL org_id trick isn't possible due to the NOT NULL
-- constraint. Instead, these templates will be inserted programmatically per
-- org at signup via the onboarding Edge Function.
--
-- Here we create the TEMPLATE DEFINITIONS as a reference SQL block that the
-- onboarding function will use. The actual inserts happen in the Edge Function
-- when an org is created.
--
-- This seed inserts ONE demo template using a special bootstrap approach.
-- The onboarding function should duplicate these for each new org.
-- ══════════════════════════════════

-- Helper: create templates for a given org
-- Called by the onboarding Edge Function with the new org's ID
CREATE OR REPLACE FUNCTION seed_project_templates_for_org(p_org_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN

  -- ── Template 1: Residential Service Call ─────────────────────────────────
  INSERT INTO project_templates (org_id, name, type, phases, default_tasks, compliance_reqs, is_active)
  VALUES (
    p_org_id,
    'Residential Service Call',
    'residential_service',
    '[
      {"name": "Diagnosis & Quote",    "order_index": 1, "estimated_days": 1,
       "checklist": ["Site assessment complete","Problem diagnosed","Quote approved by client"]},
      {"name": "Parts & Prep",         "order_index": 2, "estimated_days": 1,
       "checklist": ["Materials ordered","Tools prepped","Permit check complete"]},
      {"name": "On-Site Work",         "order_index": 3, "estimated_days": 1,
       "checklist": ["Work performed to scope","All circuits tested","Area cleaned up"]},
      {"name": "Closeout",             "order_index": 4, "estimated_days": 1,
       "checklist": ["Client walkthrough done","Invoice sent","Review requested"]}
    ]'::jsonb,
    '{"default_nec_version": "2023", "permit_typically_required": false}'::jsonb,
    '{"permit_required": false, "inspection_required": false}'::jsonb,
    true
  ) ON CONFLICT DO NOTHING;


  -- ── Template 2: Panel Upgrade ─────────────────────────────────────────────
  INSERT INTO project_templates (org_id, name, type, phases, default_tasks, compliance_reqs, is_active)
  VALUES (
    p_org_id,
    'Panel Upgrade (200A)',
    'panel_upgrade',
    '[
      {"name": "Estimate & Permit Application", "order_index": 1, "estimated_days": 3,
       "checklist": ["Load calculation complete","Permit submitted to AHJ","Utility notification sent","Client contract signed"]},
      {"name": "Pre-Work & Material Drop",      "order_index": 2, "estimated_days": 2,
       "checklist": ["Permit approved","New panel ordered","Breakers & materials on site","Utility shutoff scheduled"]},
      {"name": "Panel Installation",            "order_index": 3, "estimated_days": 1,
       "checklist": ["Old panel removed","New panel mounted & wired","Circuits labeled","AFCI/GFCI installed per NEC 2023"]},
      {"name": "Inspection & Sign-off",         "order_index": 4, "estimated_days": 2,
       "checklist": ["Rough inspection passed","Final inspection passed","Utility reconnection complete","Arc fault test complete"]},
      {"name": "Closeout",                      "order_index": 5, "estimated_days": 1,
       "checklist": ["As-built label installed","Client walkthrough done","Invoice sent","Permit closed","Review requested"]}
    ]'::jsonb,
    '{"default_nec_version": "2023", "permit_typically_required": true}'::jsonb,
    '{"permit_required": true, "inspection_required": true, "inspection_stages": ["rough","final"]}'::jsonb,
    true
  ) ON CONFLICT DO NOTHING;


  -- ── Template 3: Commercial Tenant Improvement ──────────────────────────────
  INSERT INTO project_templates (org_id, name, type, phases, default_tasks, compliance_reqs, is_active)
  VALUES (
    p_org_id,
    'Commercial Tenant Improvement',
    'commercial_ti',
    '[
      {"name": "Bid & Contract",        "order_index": 1, "estimated_days": 7,
       "checklist": ["Plans reviewed","Estimate submitted","Contract signed","Insurance COI provided"]},
      {"name": "Submittals & Permits",  "order_index": 2, "estimated_days": 14,
       "checklist": ["Permit drawings submitted","AHJ approval received","GC coordination meeting held","Material lead times confirmed"]},
      {"name": "Rough-In",              "order_index": 3, "estimated_days": 10,
       "checklist": ["Conduit rough-in complete","Wire pulled","Panel stub-ups complete","Rough inspection passed"]},
      {"name": "Finish Work",           "order_index": 4, "estimated_days": 7,
       "checklist": ["Devices installed","Panels trimmed out","Lighting installed","Emergency/exit lighting tested"]},
      {"name": "Commissioning",         "order_index": 5, "estimated_days": 3,
       "checklist": ["All circuits tested","Load balancing verified","BMS/controls tested","Final inspection passed"]},
      {"name": "Closeout & Punch List", "order_index": 6, "estimated_days": 5,
       "checklist": ["Punch list items complete","As-built drawings delivered","O&M manuals submitted","Certificate of occupancy received","Final invoice sent"]}
    ]'::jsonb,
    '{"default_nec_version": "2023", "permit_typically_required": true}'::jsonb,
    '{"permit_required": true, "inspection_required": true, "inspection_stages": ["rough","finish","final"], "title24_required": true}'::jsonb,
    true
  ) ON CONFLICT DO NOTHING;


  -- ── Template 4: EV Charger Installation ───────────────────────────────────
  INSERT INTO project_templates (org_id, name, type, phases, default_tasks, compliance_reqs, is_active)
  VALUES (
    p_org_id,
    'EV Charger Installation (Level 2)',
    'ev_charger',
    '[
      {"name": "Site Survey & Quote",  "order_index": 1, "estimated_days": 1,
       "checklist": ["Panel capacity verified","Dedicated 40A/50A circuit feasible","Charger location agreed","Quote approved"]},
      {"name": "Permit & Materials",   "order_index": 2, "estimated_days": 3,
       "checklist": ["Permit submitted (if required)","Charger & hardware ordered","Conduit & wire sized per NEC 625"]},
      {"name": "Installation",         "order_index": 3, "estimated_days": 1,
       "checklist": ["Circuit run from panel","EVSE mounted & wired","Ground fault protection installed","Load test complete"]},
      {"name": "Closeout",             "order_index": 4, "estimated_days": 1,
       "checklist": ["Inspection passed (if required)","Client tested charger","Invoice sent","Review requested"]}
    ]'::jsonb,
    '{"default_nec_version": "2023", "nec_article": "625"}'::jsonb,
    '{"permit_required": true, "inspection_required": true}'::jsonb,
    true
  ) ON CONFLICT DO NOTHING;


  -- ── Template 5: Solar + Battery Storage ───────────────────────────────────
  INSERT INTO project_templates (org_id, name, type, phases, default_tasks, compliance_reqs, is_active)
  VALUES (
    p_org_id,
    'Solar PV + Battery Storage',
    'solar',
    '[
      {"name": "Design & Engineering",   "order_index": 1, "estimated_days": 7,
       "checklist": ["Site assessment complete","Shading analysis done","System designed (kW/kWh)","Single-line diagram created","Structural review complete"]},
      {"name": "Permits & Interconnect", "order_index": 2, "estimated_days": 14,
       "checklist": ["Building permit submitted","Utility interconnect application submitted","HOA approval (if needed)","SGIP/incentive application filed"]},
      {"name": "Installation",           "order_index": 3, "estimated_days": 3,
       "checklist": ["Racking installed","Panels mounted","Inverter & battery wired","Electrical disconnect installed","Monitoring system installed"]},
      {"name": "Inspection & PTO",       "order_index": 4, "estimated_days": 7,
       "checklist": ["City inspection passed","Utility meter upgrade (if needed)","Permission to Operate (PTO) received","System commissioned & tested"]},
      {"name": "Closeout",               "order_index": 5, "estimated_days": 2,
       "checklist": ["Client training on app/monitoring","As-built submitted","Incentive documentation submitted","Final invoice sent","Review requested"]}
    ]'::jsonb,
    '{"default_nec_version": "2023", "nec_articles": ["690","706"]}'::jsonb,
    '{"permit_required": true, "inspection_required": true, "utility_approval_required": true, "inspection_stages": ["rough","final","utility"]}'::jsonb,
    true
  ) ON CONFLICT DO NOTHING;

END;
$$;

COMMENT ON FUNCTION seed_project_templates_for_org IS
  'Seeds the 5 standard Power On Solutions project templates for a new organization. '
  'Call this from the onboarding Edge Function immediately after org creation.';
