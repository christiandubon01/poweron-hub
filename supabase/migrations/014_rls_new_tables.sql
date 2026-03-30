-- ══════════════════════════════════════════════════════════════════════════════
-- PowerOn Hub — Migration 014: RLS Policies for Tables Added in 008–013
-- Follows the same role matrix defined in 006_rls_policies.sql:
--   owner   — Full access
--   admin   — Full project/financial access (no billing/user management)
--   field   — Assigned project read + limited writes
--   viewer  — Read-only on non-financial data
--
-- DEPENDS ON: 006 (auth.user_org_id(), auth.user_role()),
--             008–013 (all new tables)
-- ══════════════════════════════════════════════════════════════════════════════


-- ══════════════════════════════════
-- ENABLE RLS ON ALL NEW TABLES
-- ══════════════════════════════════
ALTER TABLE field_logs                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_logs               ENABLE ROW LEVEL SECURITY;
ALTER TABLE price_book_categories      ENABLE ROW LEVEL SECURITY;
ALTER TABLE price_book_items           ENABLE ROW LEVEL SECURITY;
ALTER TABLE material_takeoffs          ENABLE ROW LEVEL SECURITY;
ALTER TABLE material_takeoff_lines     ENABLE ROW LEVEL SECURITY;
ALTER TABLE weekly_tracker             ENABLE ROW LEVEL SECURITY;
ALTER TABLE coordination_items         ENABLE ROW LEVEL SECURITY;
ALTER TABLE agenda_sections            ENABLE ROW LEVEL SECURITY;
ALTER TABLE agenda_tasks               ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_labor_entries      ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_material_entries   ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_overhead_entries   ENABLE ROW LEVEL SECURITY;
ALTER TABLE gc_contacts                ENABLE ROW LEVEL SECURITY;
ALTER TABLE gc_activity_log            ENABLE ROW LEVEL SECURITY;


-- ══════════════════════════════════
-- FIELD LOGS
-- All org members read (field workers see their own work context).
-- Owner/admin/field can create. Owner/admin can update/delete.
-- ══════════════════════════════════
CREATE POLICY "field_logs_read" ON field_logs FOR SELECT
  USING (org_id = auth.user_org_id());

CREATE POLICY "field_logs_insert" ON field_logs FOR INSERT
  WITH CHECK (org_id = auth.user_org_id() AND auth.user_role() IN ('owner','admin','field'));

CREATE POLICY "field_logs_update" ON field_logs FOR UPDATE
  USING (org_id = auth.user_org_id() AND auth.user_role() IN ('owner','admin'));

CREATE POLICY "field_logs_delete" ON field_logs FOR DELETE
  USING (org_id = auth.user_org_id() AND auth.user_role() = 'owner');


-- ══════════════════════════════════
-- SERVICE LOGS
-- Same pattern as field logs
-- ══════════════════════════════════
CREATE POLICY "service_logs_read" ON service_logs FOR SELECT
  USING (org_id = auth.user_org_id());

CREATE POLICY "service_logs_insert" ON service_logs FOR INSERT
  WITH CHECK (org_id = auth.user_org_id() AND auth.user_role() IN ('owner','admin','field'));

CREATE POLICY "service_logs_update" ON service_logs FOR UPDATE
  USING (org_id = auth.user_org_id() AND auth.user_role() IN ('owner','admin'));


-- ══════════════════════════════════
-- PRICE BOOK (categories + items)
-- All org members read (field workers need to reference materials).
-- Owner/admin write.
-- ══════════════════════════════════
CREATE POLICY "pbc_read" ON price_book_categories FOR SELECT
  USING (org_id = auth.user_org_id());

CREATE POLICY "pbc_write" ON price_book_categories FOR ALL
  USING (org_id = auth.user_org_id() AND auth.user_role() IN ('owner','admin'));

CREATE POLICY "pbi_read" ON price_book_items FOR SELECT
  USING (org_id = auth.user_org_id());

CREATE POLICY "pbi_write" ON price_book_items FOR INSERT
  WITH CHECK (org_id = auth.user_org_id() AND auth.user_role() IN ('owner','admin'));

CREATE POLICY "pbi_update" ON price_book_items FOR UPDATE
  USING (org_id = auth.user_org_id() AND auth.user_role() IN ('owner','admin'));

CREATE POLICY "pbi_delete" ON price_book_items FOR DELETE
  USING (org_id = auth.user_org_id() AND auth.user_role() = 'owner');


-- ══════════════════════════════════
-- MATERIAL TAKEOFFS (headers + lines)
-- All org members read. Owner/admin/field write (field workers build MTOs on-site).
-- ══════════════════════════════════
CREATE POLICY "mto_read" ON material_takeoffs FOR SELECT
  USING (org_id = auth.user_org_id());

CREATE POLICY "mto_write" ON material_takeoffs FOR ALL
  USING (org_id = auth.user_org_id() AND auth.user_role() IN ('owner','admin','field'));

-- MTO lines inherit access from parent takeoff via FK cascade
CREATE POLICY "mtol_read" ON material_takeoff_lines FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM material_takeoffs mt
      WHERE mt.id = material_takeoff_lines.takeoff_id
        AND mt.org_id = auth.user_org_id()
    )
  );

CREATE POLICY "mtol_write" ON material_takeoff_lines FOR ALL
  USING (
    auth.user_role() IN ('owner','admin','field')
    AND EXISTS (
      SELECT 1 FROM material_takeoffs mt
      WHERE mt.id = material_takeoff_lines.takeoff_id
        AND mt.org_id = auth.user_org_id()
    )
  );


-- ══════════════════════════════════
-- WEEKLY TRACKER
-- Owner/admin only — financial KPI data
-- ══════════════════════════════════
CREATE POLICY "wt_read" ON weekly_tracker FOR SELECT
  USING (org_id = auth.user_org_id() AND auth.user_role() IN ('owner','admin'));

CREATE POLICY "wt_write" ON weekly_tracker FOR INSERT
  WITH CHECK (org_id = auth.user_org_id() AND auth.user_role() IN ('owner','admin'));

CREATE POLICY "wt_update" ON weekly_tracker FOR UPDATE
  USING (org_id = auth.user_org_id() AND auth.user_role() IN ('owner','admin'));


-- ══════════════════════════════════
-- COORDINATION ITEMS
-- All org members read. Owner/admin/field write.
-- ══════════════════════════════════
CREATE POLICY "coord_read" ON coordination_items FOR SELECT
  USING (org_id = auth.user_org_id());

CREATE POLICY "coord_write" ON coordination_items FOR INSERT
  WITH CHECK (org_id = auth.user_org_id() AND auth.user_role() IN ('owner','admin','field'));

CREATE POLICY "coord_update" ON coordination_items FOR UPDATE
  USING (org_id = auth.user_org_id() AND auth.user_role() IN ('owner','admin','field'));

CREATE POLICY "coord_delete" ON coordination_items FOR DELETE
  USING (org_id = auth.user_org_id() AND auth.user_role() IN ('owner','admin'));


-- ══════════════════════════════════
-- AGENDA SECTIONS + TASKS
-- Users see all org agendas (collaborative). Owner/admin/field write.
-- ══════════════════════════════════
CREATE POLICY "agenda_sec_read" ON agenda_sections FOR SELECT
  USING (org_id = auth.user_org_id());

CREATE POLICY "agenda_sec_write" ON agenda_sections FOR ALL
  USING (org_id = auth.user_org_id() AND auth.user_role() IN ('owner','admin','field'));

CREATE POLICY "agenda_task_read" ON agenda_tasks FOR SELECT
  USING (org_id = auth.user_org_id());

CREATE POLICY "agenda_task_write" ON agenda_tasks FOR ALL
  USING (org_id = auth.user_org_id() AND auth.user_role() IN ('owner','admin','field'));


-- ══════════════════════════════════
-- PROJECT COST ENTRIES (labor, material, overhead)
-- Owner/admin only — sensitive financial estimates
-- ══════════════════════════════════
CREATE POLICY "ple_read" ON project_labor_entries FOR SELECT
  USING (org_id = auth.user_org_id() AND auth.user_role() IN ('owner','admin'));

CREATE POLICY "ple_write" ON project_labor_entries FOR ALL
  USING (org_id = auth.user_org_id() AND auth.user_role() IN ('owner','admin'));

CREATE POLICY "pme_read" ON project_material_entries FOR SELECT
  USING (org_id = auth.user_org_id() AND auth.user_role() IN ('owner','admin'));

CREATE POLICY "pme_write" ON project_material_entries FOR ALL
  USING (org_id = auth.user_org_id() AND auth.user_role() IN ('owner','admin'));

CREATE POLICY "poe_read" ON project_overhead_entries FOR SELECT
  USING (org_id = auth.user_org_id() AND auth.user_role() IN ('owner','admin'));

CREATE POLICY "poe_write" ON project_overhead_entries FOR ALL
  USING (org_id = auth.user_org_id() AND auth.user_role() IN ('owner','admin'));


-- ══════════════════════════════════
-- GC CONTACTS + ACTIVITY LOG
-- Owner/admin only — sensitive business intelligence
-- ══════════════════════════════════
CREATE POLICY "gcc_read" ON gc_contacts FOR SELECT
  USING (org_id = auth.user_org_id() AND auth.user_role() IN ('owner','admin'));

CREATE POLICY "gcc_write" ON gc_contacts FOR INSERT
  WITH CHECK (org_id = auth.user_org_id() AND auth.user_role() IN ('owner','admin'));

CREATE POLICY "gcc_update" ON gc_contacts FOR UPDATE
  USING (org_id = auth.user_org_id() AND auth.user_role() IN ('owner','admin'));

CREATE POLICY "gcc_delete" ON gc_contacts FOR DELETE
  USING (org_id = auth.user_org_id() AND auth.user_role() = 'owner');

CREATE POLICY "gcal_read" ON gc_activity_log FOR SELECT
  USING (org_id = auth.user_org_id() AND auth.user_role() IN ('owner','admin'));

CREATE POLICY "gcal_write" ON gc_activity_log FOR INSERT
  WITH CHECK (org_id = auth.user_org_id() AND auth.user_role() IN ('owner','admin'));
