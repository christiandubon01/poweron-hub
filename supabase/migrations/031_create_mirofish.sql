-- 031: MiroFish Phase C — extend agent_proposals for human-in-the-loop verification chain
-- Adds deferred status, impact_level text column, reviewed_at/reviewed_by, rejection_reason,
-- step_notes, and a user-scoped index for the ProposalQueue UI.

-- 1. Add 'deferred' to status check constraint
ALTER TABLE agent_proposals DROP CONSTRAINT IF EXISTS agent_proposals_status_check;
ALTER TABLE agent_proposals ADD CONSTRAINT agent_proposals_status_check
  CHECK (status IN ('proposed','reviewing','confirmed','integrating','completed','skipped','rejected','deferred','expired'));

-- 2. Add new columns (IF NOT EXISTS via DO block for idempotency)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='agent_proposals' AND column_name='impact_level') THEN
    ALTER TABLE agent_proposals ADD COLUMN impact_level TEXT CHECK (impact_level IN ('low','medium','high','critical')) DEFAULT 'medium';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='agent_proposals' AND column_name='reviewed_at') THEN
    ALTER TABLE agent_proposals ADD COLUMN reviewed_at TIMESTAMPTZ;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='agent_proposals' AND column_name='reviewed_by') THEN
    ALTER TABLE agent_proposals ADD COLUMN reviewed_by UUID REFERENCES auth.users(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='agent_proposals' AND column_name='rejection_reason') THEN
    ALTER TABLE agent_proposals ADD COLUMN rejection_reason TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='agent_proposals' AND column_name='step_notes') THEN
    ALTER TABLE agent_proposals ADD COLUMN step_notes JSONB DEFAULT '{}';
  END IF;
END$$;

-- 3. Index for ProposalQueue — pending/deferred sorted by impact DESC, created ASC
CREATE INDEX IF NOT EXISTS idx_proposals_queue
  ON agent_proposals(org_id, status, impact_level, created_at ASC)
  WHERE status IN ('proposed','reviewing','deferred');

-- 4. Index for proposal history — approved/rejected recent
CREATE INDEX IF NOT EXISTS idx_proposals_history
  ON agent_proposals(org_id, status, created_at DESC)
  WHERE status IN ('confirmed','completed','rejected');

-- 5. Backfill impact_level from impact_score for existing rows
UPDATE agent_proposals SET impact_level = CASE
  WHEN impact_score >= 0.9 THEN 'critical'
  WHEN impact_score >= 0.6 THEN 'high'
  WHEN impact_score >= 0.35 THEN 'medium'
  ELSE 'low'
END WHERE impact_level IS NULL AND impact_score IS NOT NULL;
