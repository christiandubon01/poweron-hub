-- ══════════════════════════════════════════════════════════════════════════════
-- PowerOn Hub — Migration 015: Update Agent Memory Scopes + Entity Types
-- Extends the agent memory_scope arrays and memory_embeddings entity_type
-- to include all tables added in migrations 008–013.
--
-- NEXUS and SCOUT already have ARRAY['*'] — they see everything.
-- Sub-agents get the new tables that fall within their domain.
--
-- DEPENDS ON: 007 (seed agents), 004 (memory_embeddings, search_memory)
-- ══════════════════════════════════════════════════════════════════════════════


-- ══════════════════════════════════
-- 1. EXPAND entity_type ENUM ON memory_embeddings
-- Add new entity types for the Operations Hub features.
-- The existing CHECK constraint on entity_type needs to be replaced.
-- ══════════════════════════════════

-- Drop the old constraint
ALTER TABLE memory_embeddings DROP CONSTRAINT IF EXISTS memory_embeddings_entity_type_check;

-- Add the expanded constraint
ALTER TABLE memory_embeddings ADD CONSTRAINT memory_embeddings_entity_type_check
  CHECK (entity_type IN (
    -- Original entity types (from 004)
    'project','estimate','invoice','rfi','interaction',
    'proposal','client','lead','compliance','general',
    -- New entity types (from 008–013)
    'field_log','service_log',
    'price_book_item','material_takeoff',
    'weekly_tracker',
    'coordination_item','agenda_task',
    'labor_entry','material_entry','overhead_entry',
    'gc_contact','gc_activity'
  ));


-- ══════════════════════════════════
-- 2. UPDATE AGENT MEMORY SCOPES
-- Add new table access for each domain-relevant agent.
-- Uses ON CONFLICT to safely update existing agent rows.
-- ══════════════════════════════════

-- VAULT (estimating) — now sees price book, material takeoffs, and cost entries
UPDATE agents SET memory_scope = ARRAY[
  'estimates','projects','clients','memory_embeddings',
  'price_book_items','material_takeoffs','material_takeoff_lines',
  'project_labor_entries','project_material_entries','project_overhead_entries'
]
WHERE id = 'vault';

-- PULSE (dashboard) — now sees field logs, weekly tracker, cost entries, GC contacts
UPDATE agents SET memory_scope = ARRAY[
  'projects','invoices','estimates','leads','campaigns','payments',
  'field_logs','service_logs','weekly_tracker',
  'project_labor_entries','project_material_entries','project_overhead_entries',
  'gc_contacts'
]
WHERE id = 'pulse';

-- LEDGER (finance) — now sees field logs (for cost tracking) and weekly tracker
UPDATE agents SET memory_scope = ARRAY[
  'invoices','payments','projects','clients',
  'field_logs','weekly_tracker',
  'project_labor_entries','project_material_entries','project_overhead_entries'
]
WHERE id = 'ledger';

-- SPARK (marketing) — now sees GC contacts (GC pipeline is a marketing/BD function)
UPDATE agents SET memory_scope = ARRAY[
  'leads','campaigns','reviews','clients','projects',
  'gc_contacts','gc_activity_log'
]
WHERE id = 'spark';

-- BLUEPRINT (projects) — now sees coordination items, field logs, MTOs, cost entries
UPDATE agents SET memory_scope = ARRAY[
  'projects','project_phases','project_templates','rfis','change_orders',
  'compliance_checks','clients',
  'field_logs','coordination_items','agenda_sections','agenda_tasks',
  'material_takeoffs','material_takeoff_lines',
  'project_labor_entries','project_material_entries','project_overhead_entries'
]
WHERE id = 'blueprint';

-- OHM (compliance) — now sees field logs (safety incidents) and coordination items
UPDATE agents SET memory_scope = ARRAY[
  'projects','rfis','compliance_checks','memory_embeddings',
  'field_logs','coordination_items'
]
WHERE id = 'ohm';

-- CHRONO (calendar) — now sees field logs (scheduling context) and agenda tasks
UPDATE agents SET memory_scope = ARRAY[
  'calendar_events','crew_members','projects','leads','clients',
  'field_logs','agenda_sections','agenda_tasks'
]
WHERE id = 'chrono';

-- NEXUS and SCOUT already have ARRAY['*'] — no update needed.


-- ══════════════════════════════════
-- 3. ENABLE REALTIME ON KEY NEW TABLES
-- These tables benefit from live subscriptions in the app.
-- (Actual Realtime toggle also needs to be set in Supabase Dashboard.)
-- ══════════════════════════════════
-- Note: Realtime is configured at the Supabase project level.
-- Add these tables to the Realtime publication:
--   field_logs, coordination_items, agenda_tasks, weekly_tracker, gc_contacts
-- The ALTER PUBLICATION command works if Realtime is enabled:
DO $$
BEGIN
  -- Attempt to add new tables to the existing supabase_realtime publication.
  -- This is safe to run — if the publication doesn't exist yet, we skip.
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE
      field_logs,
      coordination_items,
      agenda_tasks,
      weekly_tracker,
      gc_contacts;
  END IF;
END;
$$;


-- ══════════════════════════════════
-- 4. ADD NEW TABLES TO AUDIT ENTITY_TYPE COMMENTS
-- (Documentation only — the audit triggers were already added per-table
--  in migrations 008–013.)
-- ══════════════════════════════════
COMMENT ON TABLE field_logs IS
  'Daily work log entries per project/employee. Tracks hours, mileage, materials, and pay status.';
COMMENT ON TABLE service_logs IS
  'Service call variant of field logs with customer info and job type classification.';
COMMENT ON TABLE price_book_categories IS
  'Material category lookup for the org price book (Wire, Conduit, Devices, etc.).';
COMMENT ON TABLE price_book_items IS
  'Master material catalog — 275+ items with unit pricing, supplier, and waste factors.';
COMMENT ON TABLE material_takeoffs IS
  'Per-project bill of materials header. Contains status tracking and total cost.';
COMMENT ON TABLE material_takeoff_lines IS
  'Individual line items within a material takeoff — qty, cost, phase, waste.';
COMMENT ON TABLE weekly_tracker IS
  '52-week revenue and activity tracker. One row per fiscal week per org.';
COMMENT ON TABLE coordination_items IS
  'Per-project coordination items across categories (light, main, urgent, permit, etc.).';
COMMENT ON TABLE agenda_sections IS
  'Grouped agenda sections (Today, This Week) for daily task management.';
COMMENT ON TABLE agenda_tasks IS
  'Individual tasks within agenda sections — pending, completed, or canceled.';
COMMENT ON TABLE project_labor_entries IS
  'Planned labor line items per project — description, employee, hours, rate.';
COMMENT ON TABLE project_material_entries IS
  'Planned material line items per project — links to price book with cost snapshots.';
COMMENT ON TABLE project_overhead_entries IS
  'Planned overhead line items per project — estimating, pickup, permits, travel.';
COMMENT ON TABLE gc_contacts IS
  'GC relationship database — company info, pipeline status, bid history, payment behavior, fit score.';
COMMENT ON TABLE gc_activity_log IS
  'Activity history for GC contacts — bids, meetings, payments, notes.';
