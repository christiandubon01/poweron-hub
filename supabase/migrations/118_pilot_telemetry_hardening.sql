-- 118_pilot_telemetry_hardening.sql
-- Forward-only corrective hardening for COMM-1E telemetry permissions.
-- Applied as a new migration because repository state alone cannot prove whether
-- 117 has already been run in any shared database.

BEGIN;

REVOKE ALL PRIVILEGES ON TABLE public.pilot_telemetry_events FROM PUBLIC;
REVOKE ALL PRIVILEGES ON TABLE public.pilot_telemetry_events FROM anon;
REVOKE ALL PRIVILEGES ON TABLE public.pilot_telemetry_events FROM authenticated;

GRANT SELECT ON TABLE public.pilot_telemetry_events TO authenticated;

COMMIT;
