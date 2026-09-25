-- 137_create_plan_payload_envelope.sql
-- CT-LIVE-0A: storage ceiling for create_plan payloads.
--
-- 196608 = 192 KiB. This is the same agent_control_requests.payload ceiling
-- already used for import_scope_pack. It is a transport/storage safety
-- envelope, not a provider context window.
--
-- The browser and Host reject compact JSON at CREATE_PLAN_MAX_PAYLOAD_BYTES
-- (196608 - 256) so Postgres jsonb spacing cannot push an accepted payload
-- over this ceiling.
--
-- LOCAL FILE ONLY. Do not apply remotely from this change.

BEGIN;

CREATE OR REPLACE FUNCTION public.enforce_create_plan_payload_envelope()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  IF NEW.request_type IS DISTINCT FROM 'create_plan' THEN
    RETURN NEW;
  END IF;

  IF NEW.payload IS NULL OR jsonb_typeof(NEW.payload) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'CREATE_PLAN_PAYLOAD_REJECTED' USING ERRCODE = '23514';
  END IF;

  IF octet_length(NEW.payload::text) > 196608 THEN
    RAISE EXCEPTION 'CREATE_PLAN_PAYLOAD_REJECTED' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$fn$;

COMMENT ON FUNCTION public.enforce_create_plan_payload_envelope() IS
  'Rejects create_plan rows whose payload is not a JSON object or whose jsonb text exceeds 196608 bytes. Other request types are ignored.';

DROP TRIGGER IF EXISTS trg_agent_control_requests_create_plan_payload ON public.agent_control_requests;
CREATE TRIGGER trg_agent_control_requests_create_plan_payload
  BEFORE INSERT OR UPDATE OF payload, request_type
  ON public.agent_control_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_create_plan_payload_envelope();

COMMIT;
