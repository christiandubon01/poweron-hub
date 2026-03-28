-- ══════════════════════════════════════════════════════════════════════════════
-- PowerOn Hub — Migration 011: Coordination Items + Agenda Tasks
-- Migrates the project coordination tracker and daily agenda system
-- from the Operations Hub into normalized Supabase tables.
--
-- DEPENDS ON: 002 (organizations, projects, profiles)
-- ══════════════════════════════════════════════════════════════════════════════


-- ══════════════════════════════════
-- 1. COORDINATION ITEMS
-- Per-project items tracked across 6 categories (light, main, urgent, etc.)
-- Replaces the Hub's coord{} nested object per project.
-- ══════════════════════════════════
CREATE TABLE coordination_items (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id        UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id    UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

  category      TEXT NOT NULL CHECK (category IN (
    'light','main','urgent','research','permit','inspect'
  )),
  title         TEXT NOT NULL,
  description   TEXT,                   -- multi-line notes

  status        TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','in_progress','resolved','deferred')),
  priority      INT NOT NULL DEFAULT 0, -- 0=normal, 1=high, 2=critical

  assigned_to   UUID REFERENCES profiles(id) ON DELETE SET NULL,
  due_date      DATE,
  resolved_at   TIMESTAMPTZ,
  resolved_by   UUID REFERENCES profiles(id) ON DELETE SET NULL,

  sort_order    INT DEFAULT 0,
  metadata      JSONB DEFAULT '{}',

  created_by    UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_coord_org       ON coordination_items(org_id);
CREATE INDEX idx_coord_project   ON coordination_items(project_id);
CREATE INDEX idx_coord_category  ON coordination_items(project_id, category);
CREATE INDEX idx_coord_status    ON coordination_items(org_id, status) WHERE status != 'resolved';
CREATE INDEX idx_coord_assigned  ON coordination_items(assigned_to) WHERE status != 'resolved';

CREATE TRIGGER mdt_coordination_items
  BEFORE UPDATE ON coordination_items
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

CREATE TRIGGER audit_coordination_items
  AFTER INSERT OR UPDATE OR DELETE ON coordination_items
  FOR EACH ROW EXECUTE FUNCTION log_audit_change();


-- ══════════════════════════════════
-- 2. AGENDA SECTIONS
-- Groups of tasks (e.g., "Today", "This Week", "Next Week")
-- Replaces the Hub's agendaSections[] array in global state.
-- ══════════════════════════════════
CREATE TABLE agenda_sections (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id        UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  project_id    UUID REFERENCES projects(id) ON DELETE SET NULL,

  title         TEXT NOT NULL DEFAULT 'Today',
  sort_order    INT DEFAULT 0,

  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_agenda_sec_org   ON agenda_sections(org_id);
CREATE INDEX idx_agenda_sec_user  ON agenda_sections(user_id);

CREATE TRIGGER mdt_agenda_sections
  BEFORE UPDATE ON agenda_sections
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);


-- ══════════════════════════════════
-- 3. AGENDA TASKS
-- Individual tasks within an agenda section.
-- Replaces the Hub's tasks[] nested array per agendaSection.
-- ══════════════════════════════════
CREATE TABLE agenda_tasks (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  section_id    UUID NOT NULL REFERENCES agenda_sections(id) ON DELETE CASCADE,
  org_id        UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  text          TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','completed','canceled')),

  assigned_to   UUID REFERENCES profiles(id) ON DELETE SET NULL,
  due_date      DATE,
  completed_at  TIMESTAMPTZ,

  sort_order    INT DEFAULT 0,
  metadata      JSONB DEFAULT '{}',    -- tags, priority flags, related entity refs

  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_agenda_task_section ON agenda_tasks(section_id);
CREATE INDEX idx_agenda_task_org     ON agenda_tasks(org_id);
CREATE INDEX idx_agenda_task_status  ON agenda_tasks(org_id, status) WHERE status = 'pending';
CREATE INDEX idx_agenda_task_user    ON agenda_tasks(assigned_to) WHERE status = 'pending';

CREATE TRIGGER mdt_agenda_tasks
  BEFORE UPDATE ON agenda_tasks
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

CREATE TRIGGER audit_agenda_sections
  AFTER INSERT OR UPDATE OR DELETE ON agenda_sections
  FOR EACH ROW EXECUTE FUNCTION log_audit_change();

CREATE TRIGGER audit_agenda_tasks
  AFTER INSERT OR UPDATE OR DELETE ON agenda_tasks
  FOR EACH ROW EXECUTE FUNCTION log_audit_change();
