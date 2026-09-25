-- 138_apply_candidate_request_type.sql
-- CT-LIVE-0C0: allow apply_candidate on the existing control-request check.
--
-- Drops and re-adds agent_control_requests_request_type_check only.
-- Existing request types stay allowed. Payload, result, and
-- claim_agent_control_requests are unchanged.
--
-- LOCAL FILE ONLY. Do not apply remotely from this change.

BEGIN;

ALTER TABLE public.agent_control_requests
  DROP CONSTRAINT IF EXISTS agent_control_requests_request_type_check;

ALTER TABLE public.agent_control_requests
  ADD CONSTRAINT agent_control_requests_request_type_check
  CHECK (request_type IN (
    'create_plan',
    'approve_plan',
    'cancel_run',
    'import_scope_pack',
    'apply_candidate'
  ));

COMMENT ON TABLE public.agent_control_requests IS
  'CT-CORE-1 control plane: typed browser→Host requests (create_plan / approve_plan / cancel_run / import_scope_pack / apply_candidate). No shell/command/argv request type can exist — request_type is CHECK-constrained.';

COMMIT;
