-- ============================================================
-- Migration 008: Field Logs
-- Migrates field_logs and service_logs from the Operations Hub
-- into structured Supabase tables with full audit + RLS ready.
-- ============================================================

-- --------------------------------------------------------
-- 1. FIELD LOGS — daily work entries per project/employee
-- --------------------------------------------------------
CREATE TABLE field_logs (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id      UUID REFERENCES projects(id) ON DELETE SET NULL,
  employee_id     UUID REFERENCES crew_members(id) ON DELETE SET NULL,
  logged_by       UUID REFERENCES profiles(id) ON DELETE SET NULL,

  log_date        DATE NOT NULL DEFAULT CURRENT_DATE,
  phase           TEXT,                          -- project phase at time of log
  hours           NUMERIC(6,2) NOT NULL DEFAULT 0,
  hourly_rate     NUMERIC(8,2),                  -- snapshot rate at time of log

  -- Mileage
  miles_round_trip NUMERIC(8,2) DEFAULT 0,
  mile_cost       NUMERIC(8,2) DEFAULT 0,        -- calculated: miles × per-mile rate

  -- Materials
  material_cost   NUMERIC(10,2) DEFAULT 0,
  material_store  TEXT,                          -- supplier name (Home Depot, Crawford, etc.)

  -- Financials snapshot
  quoted_amount   NUMERIC(12,2),                 -- original quote for this scope
  collected       NUMERIC(12,2) DEFAULT 0,       -- amount collected
  operational_cost NUMERIC(10,2) DEFAULT 0,      -- hours × rate
  profit          NUMERIC(10,2) DEFAULT 0,       -- collected - operational_cost - material_cost - mile_cost

  -- Payment tracking
  pay_status      TEXT DEFAULT 'unpaid'
    CHECK (pay_status IN ('paid','unpaid','partial')),

  -- Notes
  notes           TEXT,
  emergency_mat_info TEXT,                       -- emergency material purchase details
  detail_link     TEXT,                          -- optional external link

  -- Metadata
  metadata        JSONB DEFAULT '{}',            -- extensible (trigger_rules fired, etc.)
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_field_logs_org       ON field_logs(org_id);
CREATE INDEX idx_field_logs_project   ON field_logs(project_id);
CREATE INDEX idx_field_logs_employee  ON field_logs(employee_id);
CREATE INDEX idx_field_logs_date      ON field_logs(log_date);
CREATE INDEX idx_field_logs_pay       ON field_logs(pay_status) WHERE pay_status != 'paid';

-- Auto-update timestamp
CREATE TRIGGER mdt_field_logs
  BEFORE UPDATE ON field_logs
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

-- Audit trail
CREATE TRIGGER audit_field_logs
  AFTER INSERT OR UPDATE OR DELETE ON field_logs
  FOR EACH ROW EXECUTE FUNCTION log_audit_change();

-- --------------------------------------------------------
-- 2. SERVICE LOGS — service call variant with customer info
-- --------------------------------------------------------
CREATE TABLE service_logs (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  field_log_id    UUID REFERENCES field_logs(id) ON DELETE SET NULL,
  project_id      UUID REFERENCES projects(id) ON DELETE SET NULL,
  client_id       UUID REFERENCES clients(id) ON DELETE SET NULL,

  -- Customer info (snapshot — may not have a client record yet)
  customer_name   TEXT,
  customer_address TEXT,
  customer_phone  TEXT,

  -- Job classification
  job_type        TEXT
    CHECK (job_type IN (
      'gfci','panel','troubleshoot','lighting','outlet',
      'switch','fan','ev_charger','generator','service_upgrade',
      'smoke_detector','other'
    )),

  -- Estimate comparison
  estimate_comparison JSONB DEFAULT '{}',        -- {estimated_hrs, estimated_mat, actual_hrs, actual_mat}
  compare_warnings    TEXT[],                    -- array of variance warnings

  -- Inherited from field log or standalone
  log_date        DATE NOT NULL DEFAULT CURRENT_DATE,
  hours           NUMERIC(6,2) DEFAULT 0,
  material_cost   NUMERIC(10,2) DEFAULT 0,
  collected       NUMERIC(12,2) DEFAULT 0,
  notes           TEXT,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_service_logs_org      ON service_logs(org_id);
CREATE INDEX idx_service_logs_project  ON service_logs(project_id);
CREATE INDEX idx_service_logs_client   ON service_logs(client_id);
CREATE INDEX idx_service_logs_type     ON service_logs(job_type);
CREATE INDEX idx_service_logs_date     ON service_logs(log_date);

CREATE TRIGGER mdt_service_logs
  BEFORE UPDATE ON service_logs
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

CREATE TRIGGER audit_service_logs
  AFTER INSERT OR UPDATE OR DELETE ON service_logs
  FOR EACH ROW EXECUTE FUNCTION log_audit_change();
