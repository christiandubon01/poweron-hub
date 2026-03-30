-- ============================================================================
-- Migration 024: Field Log Upsert — Add legacy_id + phase columns, upsert 7
-- backup logs from PowerOn_Backup_2026-03-27_20-28-16.json, and update
-- project_phases percentages for Beauty Salon (p3) and Surgery Center (p2).
-- ============================================================================

-- ── Step 1: Add missing columns if not present ──────────────────────────────

ALTER TABLE field_logs ADD COLUMN IF NOT EXISTS legacy_id   TEXT;
ALTER TABLE field_logs ADD COLUMN IF NOT EXISTS phase       TEXT;
ALTER TABLE field_logs ADD COLUMN IF NOT EXISTS detail_link TEXT;
ALTER TABLE field_logs ADD COLUMN IF NOT EXISTS emergency_mat_info TEXT;
ALTER TABLE field_logs ADD COLUMN IF NOT EXISTS employee_id UUID REFERENCES crew_members(id) ON DELETE SET NULL;
ALTER TABLE field_logs ADD COLUMN IF NOT EXISTS mile_cost   NUMERIC(8,2) DEFAULT 0;
ALTER TABLE field_logs ADD COLUMN IF NOT EXISTS hourly_rate NUMERIC(8,2);
ALTER TABLE field_logs ADD COLUMN IF NOT EXISTS operational_cost NUMERIC(10,2) DEFAULT 0;

-- Unique constraint on legacy_id for upsert conflict resolution
CREATE UNIQUE INDEX IF NOT EXISTS idx_field_logs_legacy_id
  ON field_logs(legacy_id) WHERE legacy_id IS NOT NULL;

-- Index on phase for filtering
CREATE INDEX IF NOT EXISTS idx_field_logs_phase ON field_logs(phase);


-- ── Step 2: Resolve org_id, project UUIDs, and profile UUID ─────────────────
-- Uses the profile for Christian Dubon (6a5c2d43-cf37-45ff-9f22-d4d315683cf8)

DO $$
DECLARE
  v_org_id     UUID;
  v_profile_id UUID := '6a5c2d43-cf37-45ff-9f22-d4d315683cf8';
  v_p3_id      UUID;  -- Beauty Salon
  v_p2_id      UUID;  -- Surgery Center
BEGIN
  -- Get org_id from profile
  SELECT org_id INTO v_org_id FROM profiles WHERE id = v_profile_id;
  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'Profile % not found or has no org_id', v_profile_id;
  END IF;

  -- Resolve project UUIDs via legacy_id or name
  SELECT id INTO v_p3_id FROM projects
    WHERE org_id = v_org_id AND (legacy_id = 'p3' OR name ILIKE '%Beauty Salon%')
    LIMIT 1;

  SELECT id INTO v_p2_id FROM projects
    WHERE org_id = v_org_id AND (legacy_id = 'p2' OR name ILIKE '%Surgery Center%')
    LIMIT 1;

  IF v_p3_id IS NULL THEN RAISE WARNING 'Project p3 (Beauty Salon) not found — logs will have NULL project_id'; END IF;
  IF v_p2_id IS NULL THEN RAISE WARNING 'Project p2 (Surgery Center) not found — logs will have NULL project_id'; END IF;

  -- ── Step 3: Upsert 7 field logs ────────────────────────────────────────────
  -- ON CONFLICT (legacy_id) → update all fields except id and created_at

  -- Log 1: Beauty Salon — Demo — 2026-03-19
  INSERT INTO field_logs (
    org_id, project_id, logged_by, legacy_id, log_date, phase, hours,
    material_cost, miles_round_trip, notes, quoted_amount, collected, profit,
    material_store, detail_link, emergency_mat_info, metadata
  ) VALUES (
    v_org_id, v_p3_id, v_profile_id, 'mn46tzv1yiur',
    '2026-03-19', 'Demo', 5,
    0, 44, '1st Phase of Demo - 60% Done',
    18000, 0, 17756.57,
    '', '', '',
    '{"empId":"me","emp":"Owner / Me","projName":"Beauty Salon","projectQuote":18000}'::jsonb
  )
  ON CONFLICT (legacy_id) WHERE legacy_id IS NOT NULL
  DO UPDATE SET
    project_id       = EXCLUDED.project_id,
    log_date         = EXCLUDED.log_date,
    phase            = EXCLUDED.phase,
    hours            = EXCLUDED.hours,
    material_cost    = EXCLUDED.material_cost,
    miles_round_trip = EXCLUDED.miles_round_trip,
    notes            = EXCLUDED.notes,
    quoted_amount    = EXCLUDED.quoted_amount,
    collected        = EXCLUDED.collected,
    profit           = EXCLUDED.profit,
    material_store   = EXCLUDED.material_store,
    detail_link      = EXCLUDED.detail_link,
    emergency_mat_info = EXCLUDED.emergency_mat_info,
    metadata         = EXCLUDED.metadata,
    updated_at       = NOW();

  -- Log 2: Beauty Salon — Demo — 2026-03-20
  INSERT INTO field_logs (
    org_id, project_id, logged_by, legacy_id, log_date, phase, hours,
    material_cost, miles_round_trip, notes, quoted_amount, collected, profit,
    material_store, detail_link, emergency_mat_info, metadata
  ) VALUES (
    v_org_id, v_p3_id, v_profile_id, 'log1774333845362',
    '2026-03-20', 'Demo', 6,
    0, 44, '2nd Phase of Demo. 90% Completed. Started Drywall Cut Channels for new Box Layout and Wiring',
    18000, 5000, 17713.69,
    '', '', '',
    '{"empId":"me","emp":"Owner / Me","projName":"Beauty Salon","projectQuote":18000}'::jsonb
  )
  ON CONFLICT (legacy_id) WHERE legacy_id IS NOT NULL
  DO UPDATE SET
    project_id = EXCLUDED.project_id, log_date = EXCLUDED.log_date, phase = EXCLUDED.phase,
    hours = EXCLUDED.hours, material_cost = EXCLUDED.material_cost, miles_round_trip = EXCLUDED.miles_round_trip,
    notes = EXCLUDED.notes, quoted_amount = EXCLUDED.quoted_amount, collected = EXCLUDED.collected,
    profit = EXCLUDED.profit, material_store = EXCLUDED.material_store, detail_link = EXCLUDED.detail_link,
    emergency_mat_info = EXCLUDED.emergency_mat_info, metadata = EXCLUDED.metadata, updated_at = NOW();

  -- Log 3: Beauty Salon — Planning — 2026-03-21
  INSERT INTO field_logs (
    org_id, project_id, logged_by, legacy_id, log_date, phase, hours,
    material_cost, miles_round_trip, notes, quoted_amount, collected, profit,
    material_store, detail_link, emergency_mat_info, metadata
  ) VALUES (
    v_org_id, v_p3_id, v_profile_id, 'log1774333894216',
    '2026-03-21', 'Planning', 4.5,
    0, 44, 'Started marking some of the hair station receptacle boxing layout',
    18000, 0, 17778.01,
    '', '', '',
    '{"empId":"me","emp":"Owner / Me","projName":"Beauty Salon","projectQuote":18000}'::jsonb
  )
  ON CONFLICT (legacy_id) WHERE legacy_id IS NOT NULL
  DO UPDATE SET
    project_id = EXCLUDED.project_id, log_date = EXCLUDED.log_date, phase = EXCLUDED.phase,
    hours = EXCLUDED.hours, material_cost = EXCLUDED.material_cost, miles_round_trip = EXCLUDED.miles_round_trip,
    notes = EXCLUDED.notes, quoted_amount = EXCLUDED.quoted_amount, collected = EXCLUDED.collected,
    profit = EXCLUDED.profit, material_store = EXCLUDED.material_store, detail_link = EXCLUDED.detail_link,
    emergency_mat_info = EXCLUDED.emergency_mat_info, metadata = EXCLUDED.metadata, updated_at = NOW();

  -- Log 4: Beauty Salon — Rough-in — 2026-03-23 (with Home Depot receipt link)
  INSERT INTO field_logs (
    org_id, project_id, logged_by, legacy_id, log_date, phase, hours,
    material_cost, miles_round_trip, notes, quoted_amount, collected, profit,
    material_store, detail_link, emergency_mat_info, metadata
  ) VALUES (
    v_org_id, v_p3_id, v_profile_id, 'log1774334041278',
    '2026-03-23', 'Rough-in', 5,
    277.55, 50, 'Started installing receptacle boxing layout and attic emt raceway box layout',
    18000, 0, 17475.06,
    '', 'https://www.homedepot.com/myaccount/order-details?orderNumber=00002-86591&salesDate=2026-03-23&storeNumber=667&transactionId=86591&registerNumber=2&transactionType=S&orderOrigin=%2523667%2C%20Rancho%20Mirage&index=0', '',
    '{"empId":"me","emp":"Owner / Me","projName":"Beauty Salon","projectQuote":18000}'::jsonb
  )
  ON CONFLICT (legacy_id) WHERE legacy_id IS NOT NULL
  DO UPDATE SET
    project_id = EXCLUDED.project_id, log_date = EXCLUDED.log_date, phase = EXCLUDED.phase,
    hours = EXCLUDED.hours, material_cost = EXCLUDED.material_cost, miles_round_trip = EXCLUDED.miles_round_trip,
    notes = EXCLUDED.notes, quoted_amount = EXCLUDED.quoted_amount, collected = EXCLUDED.collected,
    profit = EXCLUDED.profit, material_store = EXCLUDED.material_store, detail_link = EXCLUDED.detail_link,
    emergency_mat_info = EXCLUDED.emergency_mat_info, metadata = EXCLUDED.metadata, updated_at = NOW();

  -- Log 5: Beauty Salon — Material Run — 2026-03-26 (with Home Depot receipt link)
  INSERT INTO field_logs (
    org_id, project_id, logged_by, legacy_id, log_date, phase, hours,
    material_cost, miles_round_trip, notes, quoted_amount, collected, profit,
    material_store, detail_link, emergency_mat_info, metadata
  ) VALUES (
    v_org_id, v_p3_id, v_profile_id, 'log1774497251305',
    '2026-03-26', 'Material Run', 1.25,
    561.14, 35, 'Picking Up Material',
    18000, 0, 17362.16,
    'Home Depot', 'https://www.homedepot.com/myaccount/order-details?orderNumber=00052-78148&salesDate=2026-03-25&storeNumber=667&transactionId=78148&registerNumber=52&transactionType=S&orderOrigin=%2523667%2C%20Rancho%20Mirage&index=0', 'Starting Raceway Layout Material',
    '{"empId":"me","emp":"Owner / Me","projName":"Beauty Salon","projectQuote":18000}'::jsonb
  )
  ON CONFLICT (legacy_id) WHERE legacy_id IS NOT NULL
  DO UPDATE SET
    project_id = EXCLUDED.project_id, log_date = EXCLUDED.log_date, phase = EXCLUDED.phase,
    hours = EXCLUDED.hours, material_cost = EXCLUDED.material_cost, miles_round_trip = EXCLUDED.miles_round_trip,
    notes = EXCLUDED.notes, quoted_amount = EXCLUDED.quoted_amount, collected = EXCLUDED.collected,
    profit = EXCLUDED.profit, material_store = EXCLUDED.material_store, detail_link = EXCLUDED.detail_link,
    emergency_mat_info = EXCLUDED.emergency_mat_info, metadata = EXCLUDED.metadata, updated_at = NOW();

  -- Log 6: Surgery Center — Rough-in — 2026-03-26 (summary log)
  INSERT INTO field_logs (
    org_id, project_id, logged_by, legacy_id, log_date, phase, hours,
    material_cost, miles_round_trip, notes, quoted_amount, collected, profit,
    material_store, detail_link, emergency_mat_info, metadata
  ) VALUES (
    v_org_id, v_p2_id, v_profile_id, 'log1774520069223',
    '2026-03-26', 'Rough-in', 54,
    20, 966, 'This log is the summary of all previous work logs. Active logging will start from here.',
    20000, 5988, 17027.02,
    '', '', 'All materials is funded by Contractor''s PRO Account',
    '{"empId":"me","emp":"Owner / Me","projName":"Surgery Center","projectQuote":20000}'::jsonb
  )
  ON CONFLICT (legacy_id) WHERE legacy_id IS NOT NULL
  DO UPDATE SET
    project_id = EXCLUDED.project_id, log_date = EXCLUDED.log_date, phase = EXCLUDED.phase,
    hours = EXCLUDED.hours, material_cost = EXCLUDED.material_cost, miles_round_trip = EXCLUDED.miles_round_trip,
    notes = EXCLUDED.notes, quoted_amount = EXCLUDED.quoted_amount, collected = EXCLUDED.collected,
    profit = EXCLUDED.profit, material_store = EXCLUDED.material_store, detail_link = EXCLUDED.detail_link,
    emergency_mat_info = EXCLUDED.emergency_mat_info, metadata = EXCLUDED.metadata, updated_at = NOW();

  -- Log 7: Beauty Salon — Rough-in — 2026-03-26
  INSERT INTO field_logs (
    org_id, project_id, logged_by, legacy_id, log_date, phase, hours,
    material_cost, miles_round_trip, notes, quoted_amount, collected, profit,
    material_store, detail_link, emergency_mat_info, metadata
  ) VALUES (
    v_org_id, v_p3_id, v_profile_id, 'log1774583818627',
    '2026-03-26', 'Rough-in', 5,
    0, 44, 'Started main EMT raceway layout, installed 100 feet of conduit and finish 2 out of 5 junction boxes',
    18000, 0, 17756.57,
    '', '', '',
    '{"empId":"me","emp":"Owner / Me","projName":"Beauty Salon","projectQuote":18000}'::jsonb
  )
  ON CONFLICT (legacy_id) WHERE legacy_id IS NOT NULL
  DO UPDATE SET
    project_id = EXCLUDED.project_id, log_date = EXCLUDED.log_date, phase = EXCLUDED.phase,
    hours = EXCLUDED.hours, material_cost = EXCLUDED.material_cost, miles_round_trip = EXCLUDED.miles_round_trip,
    notes = EXCLUDED.notes, quoted_amount = EXCLUDED.quoted_amount, collected = EXCLUDED.collected,
    profit = EXCLUDED.profit, material_store = EXCLUDED.material_store, detail_link = EXCLUDED.detail_link,
    emergency_mat_info = EXCLUDED.emergency_mat_info, metadata = EXCLUDED.metadata, updated_at = NOW();

  RAISE NOTICE '✅ Upserted 7 field logs (% p3 Beauty Salon, 1 p2 Surgery Center)', 6;


  -- ── Step 4: Update project_phases percentages ───────────────────────────────
  -- p3 Beauty Salon: Demo 90%, Planning 100% (log shows planning done), Rough-in in_progress
  -- p2 Surgery Center: from backup — Estimating 100%, Planning 100%, Site Prep 100%, Rough-in 34%

  IF v_p3_id IS NOT NULL THEN
    -- Update existing phases or insert them
    UPDATE project_phases SET percent_complete = 90,  status = 'in_progress', updated_at = NOW()
      WHERE project_id = v_p3_id AND name = 'Demo';
    UPDATE project_phases SET percent_complete = 100, status = 'completed',   updated_at = NOW()
      WHERE project_id = v_p3_id AND name = 'Planning';
    UPDATE project_phases SET percent_complete = 15,  status = 'in_progress', updated_at = NOW()
      WHERE project_id = v_p3_id AND name = 'Rough-in';

    -- Insert phases if they don't exist yet
    INSERT INTO project_phases (project_id, name, status, percent_complete, order_index)
      SELECT v_p3_id, 'Demo', 'in_progress', 90, 0
      WHERE NOT EXISTS (SELECT 1 FROM project_phases WHERE project_id = v_p3_id AND name = 'Demo');

    INSERT INTO project_phases (project_id, name, status, percent_complete, order_index)
      SELECT v_p3_id, 'Planning', 'completed', 100, 1
      WHERE NOT EXISTS (SELECT 1 FROM project_phases WHERE project_id = v_p3_id AND name = 'Planning');

    INSERT INTO project_phases (project_id, name, status, percent_complete, order_index)
      SELECT v_p3_id, 'Rough-in', 'in_progress', 15, 3
      WHERE NOT EXISTS (SELECT 1 FROM project_phases WHERE project_id = v_p3_id AND name = 'Rough-in');

    INSERT INTO project_phases (project_id, name, status, percent_complete, order_index)
      SELECT v_p3_id, 'Site Prep', 'pending', 0, 2
      WHERE NOT EXISTS (SELECT 1 FROM project_phases WHERE project_id = v_p3_id AND name = 'Site Prep');

    INSERT INTO project_phases (project_id, name, status, percent_complete, order_index)
      SELECT v_p3_id, 'Trim', 'pending', 0, 4
      WHERE NOT EXISTS (SELECT 1 FROM project_phases WHERE project_id = v_p3_id AND name = 'Trim');

    INSERT INTO project_phases (project_id, name, status, percent_complete, order_index)
      SELECT v_p3_id, 'Finish', 'pending', 0, 5
      WHERE NOT EXISTS (SELECT 1 FROM project_phases WHERE project_id = v_p3_id AND name = 'Finish');

    RAISE NOTICE '✅ Updated p3 Beauty Salon phases: Demo 90%%, Planning 100%%, Rough-in 15%%';
  END IF;

  IF v_p2_id IS NOT NULL THEN
    UPDATE project_phases SET percent_complete = 100, status = 'completed',   updated_at = NOW()
      WHERE project_id = v_p2_id AND name = 'Estimating';
    UPDATE project_phases SET percent_complete = 100, status = 'completed',   updated_at = NOW()
      WHERE project_id = v_p2_id AND name = 'Planning';
    UPDATE project_phases SET percent_complete = 100, status = 'completed',   updated_at = NOW()
      WHERE project_id = v_p2_id AND name = 'Site Prep';
    UPDATE project_phases SET percent_complete = 34,  status = 'in_progress', updated_at = NOW()
      WHERE project_id = v_p2_id AND name = 'Rough-in';

    -- Insert phases if they don't exist yet
    INSERT INTO project_phases (project_id, name, status, percent_complete, order_index)
      SELECT v_p2_id, 'Estimating', 'completed', 100, 0
      WHERE NOT EXISTS (SELECT 1 FROM project_phases WHERE project_id = v_p2_id AND name = 'Estimating');

    INSERT INTO project_phases (project_id, name, status, percent_complete, order_index)
      SELECT v_p2_id, 'Planning', 'completed', 100, 1
      WHERE NOT EXISTS (SELECT 1 FROM project_phases WHERE project_id = v_p2_id AND name = 'Planning');

    INSERT INTO project_phases (project_id, name, status, percent_complete, order_index)
      SELECT v_p2_id, 'Site Prep', 'completed', 100, 2
      WHERE NOT EXISTS (SELECT 1 FROM project_phases WHERE project_id = v_p2_id AND name = 'Site Prep');

    INSERT INTO project_phases (project_id, name, status, percent_complete, order_index)
      SELECT v_p2_id, 'Rough-in', 'in_progress', 34, 3
      WHERE NOT EXISTS (SELECT 1 FROM project_phases WHERE project_id = v_p2_id AND name = 'Rough-in');

    INSERT INTO project_phases (project_id, name, status, percent_complete, order_index)
      SELECT v_p2_id, 'Trim', 'pending', 0, 4
      WHERE NOT EXISTS (SELECT 1 FROM project_phases WHERE project_id = v_p2_id AND name = 'Trim');

    INSERT INTO project_phases (project_id, name, status, percent_complete, order_index)
      SELECT v_p2_id, 'Finish', 'pending', 0, 5
      WHERE NOT EXISTS (SELECT 1 FROM project_phases WHERE project_id = v_p2_id AND name = 'Finish');

    RAISE NOTICE '✅ Updated p2 Surgery Center phases: Estimating 100%%, Planning 100%%, Site Prep 100%%, Rough-in 34%%';
  END IF;

END $$;


-- ── Step 5: Verify ──────────────────────────────────────────────────────────

-- Count total field_logs
SELECT 'field_logs total' AS label, COUNT(*) AS count FROM field_logs
UNION ALL
SELECT 'field_logs with legacy_id', COUNT(*) FROM field_logs WHERE legacy_id IS NOT NULL
UNION ALL
SELECT 'project_phases total', COUNT(*) FROM project_phases;

-- Reload PostgREST schema cache (picks up new columns)
NOTIFY pgrst, 'reload schema';
