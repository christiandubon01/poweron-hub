-- Migration 032: CHRONO smart scheduling tables
-- Phase D Part 1 — crew_availability + job_schedule

CREATE TABLE IF NOT EXISTS crew_availability (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  crew_member TEXT NOT NULL,
  date DATE NOT NULL,
  available_from TIME DEFAULT '07:00',
  available_until TIME DEFAULT '17:00',
  is_available BOOLEAN DEFAULT TRUE,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS job_schedule (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id TEXT,
  job_title TEXT NOT NULL,
  crew_assigned TEXT[],
  scheduled_date DATE NOT NULL,
  start_time TIME DEFAULT '08:00',
  estimated_hours NUMERIC(4,1) DEFAULT 8,
  status TEXT CHECK (status IN ('scheduled','in_progress','complete','cancelled')) DEFAULT 'scheduled',
  conflict_flag BOOLEAN DEFAULT FALSE,
  conflict_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_schedule_user_date ON job_schedule(user_id, scheduled_date);
CREATE INDEX idx_availability_user_date ON crew_availability(user_id, date);

ALTER TABLE crew_availability ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_schedule ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users own crew_availability" ON crew_availability
  FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users own job_schedule" ON job_schedule
  FOR ALL USING (auth.uid() = user_id);
