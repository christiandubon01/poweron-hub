-- Phase 4C: additive backend foundation. Do not apply until backend review.
-- Rollback procedure and deployment gates: docs/panel-planner-backend.md.
BEGIN;
CREATE SCHEMA IF NOT EXISTS planner_private;
REVOKE ALL ON SCHEMA planner_private FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION planner_private.now() RETURNS timestamptz
LANGUAGE sql STABLE SET search_path = pg_catalog AS $$ SELECT statement_timestamp() $$;

ALTER TABLE public.portal_requests ADD CONSTRAINT portal_requests_id_org_unique UNIQUE(id,organization_id);

CREATE TABLE public.portal_request_planner_details (
  request_id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  client text NOT NULL CHECK(client='panel-planner-web-v1'),
  schema_version smallint NOT NULL CHECK(schema_version=1),
  snapshot jsonb NOT NULL CHECK(jsonb_typeof(snapshot)='object' AND snapshot->>'schema_version'='1'
    AND octet_length(snapshot::text)<=131072),
  customer_note text CHECK(char_length(customer_note)<=5000),
  preferred_contact text CHECK(preferred_contact IN('phone','text','email')),
  consent_granted boolean NOT NULL CHECK(consent_granted),
  consent_version text NOT NULL CHECK(consent_version='panel_planner_contact_v1'),
  consent_recorded_at timestamptz NOT NULL DEFAULT planner_private.now(),
  idempotency_key uuid NOT NULL,
  payload_digest text CHECK(payload_digest ~ '^[0-9a-f]{64}$'),
  recovery_token_hash text CHECK(recovery_token_hash ~ '^[0-9a-f]{64}$'),
  photo_manifest jsonb NOT NULL CHECK(jsonb_typeof(photo_manifest)='array' AND jsonb_array_length(photo_manifest)<=10
    AND octet_length(photo_manifest::text)<=16384),
  photo_transport jsonb NOT NULL DEFAULT '{"objects":{},"authorizations":{},"finalizations":{},"registered":{},"closed":false}'
    CHECK(jsonb_typeof(photo_transport)='object' AND octet_length(photo_transport::text)<=131072),
  notification_state jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(notification_state)='object'),
  created_at timestamptz NOT NULL DEFAULT planner_private.now(),
  write_deadline timestamptz NOT NULL DEFAULT planner_private.now()+interval '30 minutes',
  recovery_expires_at timestamptz NOT NULL DEFAULT planner_private.now()+interval '24 hours',
  dedupe_expires_at timestamptz NOT NULL DEFAULT planner_private.now()+interval '90 days',
  UNIQUE(organization_id,client,idempotency_key),
  FOREIGN KEY(request_id,organization_id) REFERENCES public.portal_requests(id,organization_id) ON DELETE RESTRICT
);
ALTER TABLE public.portal_request_planner_details ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.portal_request_planner_details FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.portal_request_planner_details TO service_role;
CREATE POLICY planner_details_owner_read ON public.portal_request_planner_details FOR SELECT TO authenticated
  USING(organization_id=public.user_org_id() AND public.is_org_admin_for(organization_id));
-- No table SELECT grant: use the safe owner projection below, excluding hashes/transport.
CREATE FUNCTION planner_private.immutable_details() RETURNS trigger LANGUAGE plpgsql
SET search_path=pg_catalog AS $$
BEGIN
  IF (to_jsonb(NEW)-ARRAY['photo_transport','notification_state','payload_digest','recovery_token_hash'])
     IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['photo_transport','notification_state','payload_digest','recovery_token_hash']) THEN
    RAISE EXCEPTION 'INVALID_PAYLOAD';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER planner_details_immutable BEFORE UPDATE ON public.portal_request_planner_details
  FOR EACH ROW EXECUTE FUNCTION planner_private.immutable_details();

CREATE TABLE public.portal_planner_notification_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.portal_request_planner_details(request_id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK(event_type IN('owner_new_request','customer_submission_confirmation')),
  state text NOT NULL DEFAULT 'pending' CHECK(state IN('pending','sending','sent','failed','uncertain')),
  delivery_payload jsonb, -- frozen server-built provider payload; never browser-supplied
  attempts integer NOT NULL DEFAULT 0,
  claim_token uuid,
  claimed_at timestamptz,
  first_attempt_at timestamptz,
  provider_message_id text,
  created_at timestamptz NOT NULL DEFAULT planner_private.now(),
  UNIQUE(request_id,event_type)
);
ALTER TABLE public.portal_planner_notification_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.portal_planner_notification_events FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.portal_planner_notification_events TO service_role;

CREATE TABLE public.portal_planner_rate_limits(
  bucket_hash text PRIMARY KEY CHECK(bucket_hash ~ '^[0-9a-f]{64}$'),
  window_start timestamptz NOT NULL DEFAULT planner_private.now(),
  hits integer NOT NULL DEFAULT 0
);
ALTER TABLE public.portal_planner_rate_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.portal_planner_rate_limits FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.portal_planner_rate_limits TO service_role;

CREATE FUNCTION public.panel_planner_rate_limit(p_bucket_hash text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,planner_private AS $$
DECLARE r public.portal_planner_rate_limits;
BEGIN
  INSERT INTO public.portal_planner_rate_limits(bucket_hash,hits) VALUES(p_bucket_hash,0) ON CONFLICT DO NOTHING;
  SELECT * INTO r FROM public.portal_planner_rate_limits WHERE bucket_hash=p_bucket_hash FOR UPDATE;
  IF r.window_start <= planner_private.now()-interval '10 minutes' THEN
    UPDATE public.portal_planner_rate_limits SET window_start=planner_private.now(),hits=1 WHERE bucket_hash=p_bucket_hash;
    RETURN true;
  END IF;
  IF r.hits>=60 THEN RETURN false; END IF;
  UPDATE public.portal_planner_rate_limits SET hits=hits+1 WHERE bucket_hash=p_bucket_hash;
  RETURN true;
END $$;

CREATE FUNCTION planner_private.proof(d public.portal_request_planner_details,p_secret text) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog,public,extensions,planner_private AS $$
BEGIN
  IF p_secret IS NULL OR p_secret !~ '^[0-9a-f]{64}$' OR
    d.recovery_token_hash IS DISTINCT FROM encode(digest(p_secret,'sha256'),'hex') THEN
    RAISE EXCEPTION 'CAPABILITY_INVALID';
  END IF;
  IF planner_private.now()>=d.recovery_expires_at THEN RAISE EXCEPTION 'RECOVERY_EXPIRED'; END IF;
END $$;

CREATE FUNCTION planner_private.writable(d public.portal_request_planner_details,r public.portal_requests) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog,planner_private AS $$
BEGIN
  IF planner_private.now()>=d.write_deadline THEN RAISE EXCEPTION 'PHOTO_WINDOW_EXPIRED'; END IF;
  IF r.status<>'new' OR r.hunter_lead_id IS NOT NULL OR (d.photo_transport->>'closed')::boolean THEN
    RAISE EXCEPTION 'PHOTO_REQUEST_CLOSED';
  END IF;
END $$;

CREATE FUNCTION planner_private.receipt(d public.portal_request_planner_details,p_replayed boolean) RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog,public,planner_private AS $$
DECLARE r public.portal_requests; photo_state text; registered jsonb; remaining jsonb; states jsonb; total integer; done integer;
BEGIN
  SELECT * INTO r FROM public.portal_requests WHERE id=d.request_id;
  SELECT coalesce(jsonb_agg(m->>'client_photo_id'),'[]') INTO registered
    FROM jsonb_array_elements(d.photo_manifest)m WHERE d.photo_transport->'registered' ? (m->>'client_photo_id');
  SELECT coalesce(jsonb_agg(m->>'client_photo_id'),'[]') INTO remaining
    FROM jsonb_array_elements(d.photo_manifest)m WHERE NOT(d.photo_transport->'registered' ? (m->>'client_photo_id'));
  total:=jsonb_array_length(d.photo_manifest); done:=jsonb_array_length(registered);
  photo_state:=CASE WHEN total=0 THEN 'not_requested' WHEN done=total THEN 'complete'
    WHEN (d.photo_transport->>'closed')::boolean THEN 'closed_without_all_photos'
    WHEN r.status<>'new' OR r.hunter_lead_id IS NOT NULL THEN 'unavailable_after_acceptance'
    WHEN planner_private.now()>=d.write_deadline THEN 'expired'
    WHEN done>0 THEN 'partial' ELSE 'pending' END;
  SELECT coalesce(jsonb_object_agg(event_type,state),'{}') INTO states
    FROM public.portal_planner_notification_events WHERE request_id=d.request_id;
  RETURN jsonb_build_object('contract_version',1,'request_id',d.request_id,'request_state','saved','replayed',p_replayed,
    'tracking_url','https://app.poweronsolutionsllc.com/portal/track/'||d.request_id,
    'photos',jsonb_build_object('state',photo_state,'write_deadline',d.write_deadline,
      'registered_photo_ids',registered,'remaining_photo_ids',remaining,
      'retry_allowed',photo_state IN('pending','partial')),
    'notifications',jsonb_build_object('owner',coalesce(states->>'owner_new_request','pending'),
      'customer',coalesce(states->>'customer_submission_confirmation','not_requested')));
END $$;

CREATE FUNCTION public.submit_panel_planner_request(p_payload jsonb,p_idempotency_key uuid,p_recovery_token text,
  p_customer_note text,p_consent_version text,p_photo_manifest jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,extensions,planner_private AS $$
DECLARE org uuid; d public.portal_request_planner_details; request_uuid uuid; digest_value text; manifest jsonb;
  c jsonb; m jsonb; photo jsonb; email_value text; phone_value text;
BEGIN
  SELECT organization_id INTO org FROM public.portal_request_configuration WHERE singleton=true;
  IF org IS NULL THEN RAISE EXCEPTION 'TEMPORARILY_UNAVAILABLE'; END IF;
  IF p_payload->>'schema_version'<>'1' OR p_payload->>'client'<>'panel-planner-web-v1' OR
    p_payload->>'lead_type'<>'panel_planner' THEN RAISE EXCEPTION 'UNSUPPORTED_SCHEMA'; END IF;
  IF octet_length(p_payload::text)>131072 THEN RAISE EXCEPTION 'SNAPSHOT_TOO_LARGE'; END IF;
  IF p_payload#>>'{submission,consent}' IS DISTINCT FROM 'true' OR
    p_consent_version IS DISTINCT FROM 'panel_planner_contact_v1' THEN RAISE EXCEPTION 'CONSENT_REQUIRED'; END IF;
  IF p_recovery_token IS NULL OR p_recovery_token !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'CAPABILITY_INVALID'; END IF;
  IF p_idempotency_key IS NULL OR p_idempotency_key::text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    OR p_payload#>>'{submission,idempotency_key}' IS DISTINCT FROM p_idempotency_key::text THEN RAISE EXCEPTION 'INVALID_PAYLOAD'; END IF;
  c:=p_payload->'customer'; email_value:=nullif(btrim(c->>'email'),''); phone_value:=nullif(btrim(c->>'phone'),'');
  IF nullif(btrim(c->>'name'),'') IS NULL OR (email_value IS NULL AND phone_value IS NULL) THEN RAISE EXCEPTION 'CONTACT_REQUIRED'; END IF;
  IF char_length(c->>'name')>200 OR char_length(phone_value)>30 OR char_length(email_value)>200 OR
    (email_value IS NOT NULL AND email_value !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') OR
    (phone_value IS NOT NULL AND (phone_value !~ '^[+() .0-9-]+$' OR
      char_length(regexp_replace(phone_value,'[^0-9]','','g')) NOT BETWEEN 7 AND 15)) THEN RAISE EXCEPTION 'INVALID_CONTACT'; END IF;
  IF (c->>'preferred_contact' IN('phone','text') AND phone_value IS NULL) OR
    (c->>'preferred_contact'='email' AND email_value IS NULL) THEN RAISE EXCEPTION 'INVALID_CONTACT'; END IF;
  IF jsonb_typeof(p_photo_manifest) IS DISTINCT FROM 'array' OR jsonb_typeof(p_payload->'photos') IS DISTINCT FROM 'array'
    THEN RAISE EXCEPTION 'INVALID_PAYLOAD'; END IF;
  IF jsonb_array_length(p_photo_manifest)>10 THEN RAISE EXCEPTION 'PHOTO_COUNT_EXCEEDED'; END IF;
  IF jsonb_array_length(p_photo_manifest)<>jsonb_array_length(p_payload->'photos') THEN RAISE EXCEPTION 'INVALID_PAYLOAD'; END IF;
  manifest:='[]';
  FOR m IN SELECT value FROM jsonb_array_elements(p_photo_manifest) LOOP
    photo:=p_payload->'photos'->(m->>'payload_photo_index')::integer;
    IF photo IS NULL OR m->>'client_photo_id' IS NULL OR (m->>'client_photo_id')::uuid::text <> m->>'client_photo_id'
      THEN RAISE EXCEPTION 'INVALID_PAYLOAD'; END IF;
    IF photo->>'mime_type' NOT IN('image/jpeg','image/png','image/webp') THEN RAISE EXCEPTION 'PHOTO_TYPE_INVALID'; END IF;
    IF (photo->>'size_bytes')::bigint NOT BETWEEN 1 AND 10485760 THEN RAISE EXCEPTION 'PHOTO_TOO_LARGE'; END IF;
    IF EXISTS(SELECT 1 FROM jsonb_array_elements(manifest)x WHERE x->>'client_photo_id'=m->>'client_photo_id'
      OR x->>'payload_photo_index'=m->>'payload_photo_index') THEN RAISE EXCEPTION 'INVALID_PAYLOAD'; END IF;
    manifest:=manifest||jsonb_build_array(m||photo);
  END LOOP;
  digest_value:=encode(digest(jsonb_build_object('payload',p_payload,'note',p_customer_note,
    'consent_version',p_consent_version,'manifest',p_photo_manifest)::text,'sha256'),'hex');
  -- Serialize a key before inserting either row; uniqueness remains a second defense.
  PERFORM pg_advisory_xact_lock(hashtextextended(org::text||':panel-planner-web-v1:'||p_idempotency_key::text,0));
  SELECT * INTO d FROM public.portal_request_planner_details
    WHERE organization_id=org AND client='panel-planner-web-v1' AND idempotency_key=p_idempotency_key;
  IF FOUND THEN
    IF planner_private.now()>=d.dedupe_expires_at THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT'; END IF;
    PERFORM planner_private.proof(d,p_recovery_token);
    IF d.payload_digest IS DISTINCT FROM digest_value THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT'; END IF;
    RETURN planner_private.receipt(d,true);
  END IF;
  -- This dedicated RPC is service-only. The public HTTP adapter validates the entire frozen schema.
  -- No browser org/source/status/tenant argument is accepted.
  INSERT INTO public.portal_requests(organization_id,name,phone,email,address,city,request_type,service_category,
    source,status,description,created_at,gclid,gbraid,wbraid,utm_source,utm_medium,utm_campaign,utm_term,utm_content,page_url)
  VALUES(org,btrim(c->>'name'),phone_value,email_value,nullif(btrim(c->>'address'),''),nullif(btrim(c->>'city'),''),
    'homeowner','panel_upgrade','customer_portal','new','Panel Planner service request — professional review requested.',
    planner_private.now(),p_payload#>>'{attribution,gclid}',p_payload#>>'{attribution,gbraid}',p_payload#>>'{attribution,wbraid}',
    p_payload#>>'{attribution,utm_source}',p_payload#>>'{attribution,utm_medium}',p_payload#>>'{attribution,utm_campaign}',
    p_payload#>>'{attribution,utm_term}',p_payload#>>'{attribution,utm_content}',p_payload#>>'{submission,page_url}')
  RETURNING id INTO request_uuid;
  INSERT INTO public.portal_request_planner_details(request_id,organization_id,client,schema_version,snapshot,customer_note,
    preferred_contact,consent_granted,consent_version,idempotency_key,payload_digest,recovery_token_hash,photo_manifest)
  VALUES(request_uuid,org,'panel-planner-web-v1',1,p_payload,p_customer_note,c->>'preferred_contact',true,
    p_consent_version,p_idempotency_key,digest_value,encode(digest(p_recovery_token,'sha256'),'hex'),manifest)
  RETURNING * INTO d;
  INSERT INTO public.portal_planner_notification_events(request_id,event_type) VALUES(request_uuid,'owner_new_request');
  IF email_value IS NOT NULL THEN
    INSERT INTO public.portal_planner_notification_events(request_id,event_type) VALUES(request_uuid,'customer_submission_confirmation');
  END IF;
  RETURN planner_private.receipt(d,false);
END $$;

CREATE FUNCTION public.recover_panel_planner_request(p_idempotency_key uuid,p_recovery_token text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,planner_private AS $$
DECLARE d public.portal_request_planner_details;
BEGIN
  SELECT d0.* INTO d FROM public.portal_request_planner_details d0 JOIN public.portal_request_configuration c
    ON c.organization_id=d0.organization_id AND c.singleton WHERE d0.idempotency_key=p_idempotency_key;
  IF NOT FOUND THEN RAISE EXCEPTION 'REQUEST_UNAVAILABLE'; END IF;
  PERFORM planner_private.proof(d,p_recovery_token);
  RETURN planner_private.receipt(d,true);
END $$;

CREATE FUNCTION public.authorize_panel_planner_photos(p_request_id uuid,p_recovery_token text,p_authorization_key uuid,
  p_photo_ids uuid[]) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,planner_private AS $$
DECLARE d public.portal_request_planner_details; r public.portal_requests; batch jsonb; files jsonb:='[]';
  objects jsonb; m jsonb; pid uuid; path text; authorization_uuid uuid; fingerprint text;
BEGIN
  SELECT * INTO r FROM public.portal_requests WHERE id=p_request_id FOR UPDATE;
  SELECT * INTO d FROM public.portal_request_planner_details WHERE request_id=p_request_id FOR UPDATE;
  IF d.request_id IS NULL THEN RAISE EXCEPTION 'REQUEST_UNAVAILABLE'; END IF;
  PERFORM planner_private.proof(d,p_recovery_token); PERFORM planner_private.writable(d,r);
  IF p_authorization_key IS NULL OR coalesce(cardinality(p_photo_ids),0) NOT BETWEEN 1 AND 10 OR
    cardinality(p_photo_ids)<>(SELECT count(DISTINCT x) FROM unnest(p_photo_ids)x) THEN RAISE EXCEPTION 'INVALID_PAYLOAD'; END IF;
  IF EXISTS(SELECT 1 FROM unnest(p_photo_ids)x WHERE d.photo_transport->'registered' ? x::text) THEN RAISE EXCEPTION 'PHOTO_OBJECT_INVALID'; END IF;
  fingerprint:=(SELECT string_agg(x::text,',' ORDER BY x) FROM unnest(p_photo_ids)x);
  batch:=d.photo_transport->'authorizations'->p_authorization_key::text;
  IF batch IS NOT NULL THEN
    IF batch->>'fingerprint'<>fingerprint THEN RAISE EXCEPTION 'FINALIZATION_CONFLICT'; END IF;
    RETURN batch||jsonb_build_object('replayed',true);
  END IF;
  IF (SELECT count(*) FROM jsonb_object_keys(d.photo_transport->'authorizations'))>=60 THEN RAISE EXCEPTION 'RATE_LIMITED'; END IF;
  objects:=d.photo_transport->'objects';
  FOREACH pid IN ARRAY p_photo_ids LOOP
    SELECT value INTO m FROM jsonb_array_elements(d.photo_manifest) WHERE value->>'client_photo_id'=pid::text;
    IF m IS NULL OR d.photo_transport->'registered' ? pid::text THEN RAISE EXCEPTION 'PHOTO_OBJECT_INVALID'; END IF;
    path:=objects->>pid::text;
    IF path IS NULL THEN
      path:=p_request_id::text||'/'||gen_random_uuid()::text||CASE m->>'mime_type'
        WHEN 'image/jpeg' THEN '.jpg' WHEN 'image/png' THEN '.png' WHEN 'image/webp' THEN '.webp' END;
      objects:=objects||jsonb_build_object(pid::text,path);
    END IF;
    files:=files||jsonb_build_array(jsonb_build_object('client_photo_id',pid,'object_path',path,
      'mime_type',m->>'mime_type','size_bytes',(m->>'size_bytes')::bigint));
  END LOOP;
  authorization_uuid:=gen_random_uuid();
  batch:=jsonb_build_object('authorization_id',authorization_uuid,'fingerprint',fingerprint,'request_id',p_request_id,
    'registration_deadline',d.write_deadline,'files',files,'replayed',false);
  INSERT INTO public.portal_upload_authorizations(id,request_id,paths,expires_at)
    VALUES(authorization_uuid,p_request_id,ARRAY(SELECT value->>'object_path' FROM jsonb_array_elements(files)),d.write_deadline);
  UPDATE public.portal_request_planner_details SET photo_transport=
    jsonb_set(jsonb_set(d.photo_transport,'{objects}',objects),ARRAY['authorizations',p_authorization_key::text],batch)
    WHERE request_id=p_request_id;
  RETURN batch;
END $$;

CREATE FUNCTION public.prepare_panel_planner_finalization(p_request_id uuid,p_recovery_token text,p_finalization_key uuid,
  p_authorization_id uuid,p_photo_ids uuid[],p_close_photos boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,extensions,planner_private AS $$
DECLARE d public.portal_request_planner_details; r public.portal_requests; old jsonb; batch jsonb;
  digest_value text; files jsonb:='[]'; pid uuid; f jsonb;
BEGIN
  SELECT * INTO r FROM public.portal_requests WHERE id=p_request_id;
  SELECT * INTO d FROM public.portal_request_planner_details WHERE request_id=p_request_id;
  IF d.request_id IS NULL THEN RAISE EXCEPTION 'REQUEST_UNAVAILABLE'; END IF;
  PERFORM planner_private.proof(d,p_recovery_token);
  IF p_finalization_key IS NULL OR p_authorization_id IS NULL OR p_close_photos IS NULL OR
    p_photo_ids IS NULL OR (cardinality(p_photo_ids)=0 AND NOT p_close_photos) OR cardinality(p_photo_ids)>10 OR
    cardinality(p_photo_ids)<>(SELECT count(DISTINCT x) FROM unnest(p_photo_ids)x) THEN RAISE EXCEPTION 'INVALID_PAYLOAD'; END IF;
  digest_value:=encode(digest(jsonb_build_object('authorization_uuid',p_authorization_id,
    'ids',(SELECT coalesce(jsonb_agg(x ORDER BY x),'[]') FROM unnest(p_photo_ids)x),'close',p_close_photos)::text,'sha256'),'hex');
  old:=d.photo_transport->'finalizations'->p_finalization_key::text;
  IF old IS NOT NULL THEN
    IF old->>'digest'<>digest_value THEN RAISE EXCEPTION 'FINALIZATION_CONFLICT'; END IF;
    RETURN jsonb_build_object('replayed',true,'receipt',old->'receipt');
  END IF;
  PERFORM planner_private.writable(d,r);
  IF (SELECT count(*) FROM jsonb_object_keys(d.photo_transport->'finalizations'))>=60 THEN RAISE EXCEPTION 'RATE_LIMITED'; END IF;
  SELECT value INTO batch FROM jsonb_each(d.photo_transport->'authorizations') WHERE value->>'authorization_id'=p_authorization_id::text;
  IF batch IS NULL THEN RAISE EXCEPTION 'PHOTO_OBJECT_INVALID'; END IF;
  FOREACH pid IN ARRAY p_photo_ids LOOP
    SELECT value INTO f FROM jsonb_array_elements(batch->'files') WHERE value->>'client_photo_id'=pid::text;
    IF f IS NULL OR d.photo_transport->'registered' ? pid::text THEN RAISE EXCEPTION 'PHOTO_OBJECT_INVALID'; END IF;
    files:=files||jsonb_build_array(f);
  END LOOP;
  RETURN jsonb_build_object('replayed',false,'files',files,'digest',digest_value);
END $$;

CREATE FUNCTION public.finalize_panel_planner_photos(p_request_id uuid,p_recovery_token text,p_finalization_key uuid,
  p_authorization_id uuid,p_photo_ids uuid[],p_close_photos boolean,p_verified_objects jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,planner_private AS $$
DECLARE d public.portal_request_planner_details; r public.portal_requests; prepared jsonb; f jsonb; verified jsonb;
  registered jsonb; meta jsonb; receipt_value jsonb; paths text[]; notes_value text;
BEGIN
  SELECT * INTO r FROM public.portal_requests WHERE id=p_request_id FOR UPDATE;
  SELECT * INTO d FROM public.portal_request_planner_details WHERE request_id=p_request_id FOR UPDATE;
  prepared:=public.prepare_panel_planner_finalization(p_request_id,p_recovery_token,p_finalization_key,
    p_authorization_id,p_photo_ids,p_close_photos);
  IF (prepared->>'replayed')::boolean THEN RETURN (prepared->'receipt')||jsonb_build_object('replayed',true); END IF;
  IF jsonb_typeof(p_verified_objects) IS DISTINCT FROM 'array' OR
    jsonb_array_length(p_verified_objects)<>cardinality(p_photo_ids) THEN RAISE EXCEPTION 'PHOTO_OBJECT_INVALID'; END IF;
  registered:=d.photo_transport->'registered';
  FOR f IN SELECT value FROM jsonb_array_elements(prepared->'files') LOOP
    SELECT value INTO verified FROM jsonb_array_elements(p_verified_objects)
      WHERE value->>'client_photo_id'=f->>'client_photo_id';
    IF verified IS NULL OR verified->>'object_path' IS DISTINCT FROM f->>'object_path' OR
      verified->>'mime_type' IS DISTINCT FROM f->>'mime_type' OR verified->>'signature_verified' IS DISTINCT FROM 'true'
      OR (verified->>'size_bytes')::bigint IS DISTINCT FROM (f->>'size_bytes')::bigint
      THEN RAISE EXCEPTION 'PHOTO_OBJECT_INVALID'; END IF;
    IF f->>'object_path' !~ ('^'||p_request_id::text||'/[0-9a-f-]{36}\.(jpg|png|webp)$')
      THEN RAISE EXCEPTION 'PHOTO_OBJECT_INVALID'; END IF;
    SELECT metadata INTO meta FROM storage.objects WHERE bucket_id='portal-uploads' AND name=f->>'object_path';
    IF NOT FOUND OR meta->>'size' IS NULL OR (meta->>'size')::bigint NOT BETWEEN 1 AND 10485760 OR
      (meta->>'size')::bigint IS DISTINCT FROM (f->>'size_bytes')::bigint OR
      meta->>'mimetype' IS DISTINCT FROM f->>'mime_type' THEN RAISE EXCEPTION 'PHOTO_OBJECT_INVALID'; END IF;
    registered:=registered||jsonb_build_object(f->>'client_photo_id',f||jsonb_build_object('registered_at',planner_private.now()));
  END LOOP;
  UPDATE public.portal_upload_authorizations SET consumed_at=planner_private.now()
    WHERE id=p_authorization_id AND request_id=p_request_id AND consumed_at IS NULL AND expires_at>planner_private.now();
  IF NOT FOUND THEN RAISE EXCEPTION 'PHOTO_OBJECT_INVALID'; END IF;
  UPDATE public.portal_request_planner_details SET photo_transport=jsonb_set(jsonb_set(d.photo_transport,
    '{registered}',registered),'{closed}',to_jsonb(p_close_photos)) WHERE request_id=p_request_id RETURNING * INTO d;
  -- One canonical projection for the existing owner attachment service.
  SELECT array_agg(value->>'object_path' ORDER BY key) INTO paths FROM jsonb_each(registered);
  notes_value:=regexp_replace(coalesce(r.notes,''),'(\s*\|\s*)?FilePaths:\s*[^|]*','','g');
  IF cardinality(paths)>0 THEN
    notes_value:=concat_ws(' | ',nullif(btrim(notes_value),''),'FilePaths: '||array_to_string(paths,','));
  END IF;
  UPDATE public.portal_requests SET notes=nullif(notes_value,''),attach_token_hash=NULL WHERE id=p_request_id;
  receipt_value:=planner_private.receipt(d,false);
  UPDATE public.portal_request_planner_details SET photo_transport=jsonb_set(d.photo_transport,
    ARRAY['finalizations',p_finalization_key::text],jsonb_build_object('digest',prepared->>'digest','receipt',receipt_value))
    WHERE request_id=p_request_id;
  RETURN receipt_value;
END $$;

CREATE FUNCTION public.get_panel_planner_customer_photos(p_request_id uuid,p_recovery_token text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,planner_private AS $$
DECLARE d public.portal_request_planner_details;
BEGIN
  SELECT * INTO d FROM public.portal_request_planner_details WHERE request_id=p_request_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'REQUEST_UNAVAILABLE'; END IF;
  PERFORM planner_private.proof(d,p_recovery_token);
  RETURN coalesce((SELECT jsonb_agg(value) FROM jsonb_each(d.photo_transport->'registered')),'[]');
END $$;

CREATE FUNCTION public.get_panel_planner_owner_details(p_request_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,planner_private AS $$
DECLARE d public.portal_request_planner_details;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'REQUEST_UNAVAILABLE'; END IF;
  SELECT * INTO d FROM public.portal_request_planner_details WHERE request_id=p_request_id
    AND organization_id=public.user_org_id() AND public.is_org_admin_for(organization_id);
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN jsonb_build_object('request_id',d.request_id,'schema_version',d.schema_version,'snapshot',d.snapshot #- '{submission,idempotency_key}',
    'customer_note',d.customer_note,'preferred_contact',d.preferred_contact,'consent_granted',d.consent_granted,
    'consent_version',d.consent_version,'consent_recorded_at',d.consent_recorded_at,
    'photos',(SELECT coalesce(jsonb_agg(m||jsonb_build_object('registered',
      d.photo_transport->'registered' ? (m->>'client_photo_id'))),'[]') FROM jsonb_array_elements(d.photo_manifest)m),
    'created_at',d.created_at);
END $$;

CREATE FUNCTION public.accept_portal_request_to_hunter(p_request_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,planner_private AS $$
DECLARE r public.portal_requests; org uuid; tenant uuid; lead_id uuid; value_amount numeric;
BEGIN
  org:=public.user_org_id();
  IF auth.uid() IS NULL OR org IS NULL OR NOT public.is_org_admin_for(org) THEN RAISE EXCEPTION 'REQUEST_UNAVAILABLE'; END IF;
  SELECT * INTO r FROM public.portal_requests WHERE id=p_request_id AND organization_id=org FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'REQUEST_UNAVAILABLE'; END IF;
  SELECT hunter_tenant_id INTO tenant FROM public.organizations WHERE id=org;
  IF tenant IS NULL THEN RAISE EXCEPTION 'hunter_tenant_unmapped'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.user_tenants WHERE user_id=auth.uid() AND tenant_id=tenant) THEN
    RAISE EXCEPTION 'hunter_tenant_membership_missing'; END IF;
  IF r.hunter_lead_id IS NOT NULL THEN
    IF NOT EXISTS(SELECT 1 FROM public.hunter_leads WHERE id=r.hunter_lead_id AND tenant_id=tenant)
      THEN RAISE EXCEPTION 'REQUEST_UNAVAILABLE'; END IF;
    RETURN jsonb_build_object('lead_id',r.hunter_lead_id,'replayed',true);
  END IF;
  IF r.status<>'new' THEN RAISE EXCEPTION 'PHOTO_REQUEST_CLOSED'; END IF;
  SELECT round(((p->>'minValue')::numeric+(p->>'maxValue')::numeric)/2) INTO value_amount
    FROM public.tenant_settings ts CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(ts.setting_value->'profiles')='array' THEN ts.setting_value->'profiles' ELSE '[]'::jsonb END)p
    WHERE ts.tenant_id=tenant AND ts.setting_key='lead_value_profiles_v1'
      AND lower(btrim(p->>'serviceCategory'))=lower(btrim(r.service_category))
      AND nullif(btrim(p->>'id'),'') IS NOT NULL AND nullif(btrim(p->>'name'),'') IS NOT NULL
      AND jsonb_typeof(p->'minValue')='number' AND jsonb_typeof(p->'maxValue')='number' LIMIT 1;
  INSERT INTO public.hunter_leads(tenant_id,user_id,lead_type,source,source_tag,status,score,score_tier,contact_name,
    phone,email,address,city,description,notes,estimated_value,estimated_margin,geocoding_status)
  VALUES(tenant,auth.uid(),CASE WHEN r.service_category IN('residential','commercial','solar','maintenance','panel_upgrade','ev_charger')
      THEN r.service_category ELSE 'electrical' END,
    CASE WHEN lower(btrim(r.source_category)) IN('paid_search','ai_assistant','gbp','referral_site','social','organic_search','direct','other')
      THEN lower(btrim(r.source_category)) ELSE 'customer_portal' END,'customer_portal','new',82,'strong',r.name,r.phone,r.email,r.address,r.city,
    nullif(concat_ws(E'\n',r.description,CASE WHEN r.preferred_date IS NOT NULL THEN 'Preferred date: '||r.preferred_date END,
      CASE WHEN r.preferred_time IS NOT NULL THEN 'Preferred time: '||r.preferred_time END,r.notes),''),
    'Portal submission — '||r.request_type||' request',value_amount,35,'pending') RETURNING id INTO lead_id;
  UPDATE public.portal_requests SET status='accepted',hunter_lead_id=lead_id WHERE id=r.id AND organization_id=org;
  RETURN jsonb_build_object('lead_id',lead_id,'replayed',false);
END $$;

CREATE FUNCTION public.panel_planner_orphan_paths() RETURNS text[]
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public,planner_private AS $$
  SELECT coalesce(array_agg(name),'{}') FROM (
    SELECT o.name FROM storage.objects o JOIN public.portal_request_planner_details d
      ON split_part(o.name,'/',1)=d.request_id::text
    WHERE o.bucket_id='portal-uploads' AND o.created_at<=planner_private.now()-interval '24 hours'
      AND o.name ~ ('^'||d.request_id::text||'/[0-9a-f-]{36}\.(jpg|png|webp)$')
      AND EXISTS(SELECT 1 FROM jsonb_each_text(d.photo_transport->'objects') x WHERE x.value=o.name)
      AND NOT EXISTS(SELECT 1 FROM jsonb_each(d.photo_transport->'registered')x WHERE x.value->>'object_path'=o.name)
    ORDER BY o.created_at LIMIT 100
  ) eligible
$$;
CREATE FUNCTION public.panel_planner_expire_technical_data() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,planner_private AS $$
DECLARE changed integer;
BEGIN
  -- Retain a rejection tombstone (key/request), not an expiring cache that permits duplicate creation.
  UPDATE public.portal_request_planner_details SET payload_digest=NULL,recovery_token_hash=NULL
    WHERE dedupe_expires_at<=planner_private.now() AND (payload_digest IS NOT NULL OR recovery_token_hash IS NOT NULL);
  GET DIAGNOSTICS changed=ROW_COUNT;
  DELETE FROM public.portal_planner_rate_limits WHERE window_start<planner_private.now()-interval '24 hours';
  RETURN changed;
END $$;

CREATE FUNCTION public.claim_panel_planner_notifications() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,planner_private AS $$
DECLARE output jsonb:='[]'; e public.portal_planner_notification_events; r public.portal_requests;
BEGIN
  -- Never retry an ambiguous provider call beyond its 24h idempotency retention.
  UPDATE public.portal_planner_notification_events SET state='uncertain',claim_token=NULL
    WHERE state='sending' AND first_attempt_at<=planner_private.now()-interval '23 hours';
  FOR e IN SELECT * FROM public.portal_planner_notification_events
    WHERE state='pending' OR (state='sending' AND claimed_at<planner_private.now()-interval '5 minutes'
      AND first_attempt_at>planner_private.now()-interval '23 hours')
    ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 10 LOOP
    SELECT * INTO r FROM public.portal_requests WHERE id=e.request_id;
    UPDATE public.portal_planner_notification_events SET state='sending',claim_token=gen_random_uuid(),
      claimed_at=planner_private.now(),first_attempt_at=coalesce(first_attempt_at,planner_private.now()),attempts=attempts+1
      WHERE id=e.id RETURNING * INTO e;
    output:=output||jsonb_build_array(jsonb_build_object('id',e.id,'claim_token',e.claim_token,'event_type',e.event_type,
      'delivery_payload',e.delivery_payload,'request_id',r.id,'name',r.name,'phone',r.phone,'email',r.email,
      'address',r.address,'city',r.city,'description',r.description,'created_at',r.created_at));
  END LOOP;
  RETURN output;
END $$;
CREATE FUNCTION public.prepare_panel_planner_notification(p_id uuid,p_claim_token uuid,p_delivery_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE payload jsonb;
BEGIN
  UPDATE public.portal_planner_notification_events SET delivery_payload=coalesce(delivery_payload,p_delivery_payload)
    WHERE id=p_id AND claim_token=p_claim_token AND state='sending' RETURNING delivery_payload INTO payload;
  IF NOT FOUND THEN RAISE EXCEPTION 'TEMPORARILY_UNAVAILABLE'; END IF;
  RETURN payload;
END $$;
CREATE FUNCTION public.complete_panel_planner_notification(p_id uuid,p_claim_token uuid,p_state text,p_message_id text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  IF p_state NOT IN('sent','failed','uncertain') THEN RAISE EXCEPTION 'INVALID_PAYLOAD'; END IF;
  UPDATE public.portal_planner_notification_events SET state=p_state,provider_message_id=p_message_id,claim_token=NULL
    WHERE id=p_id AND claim_token=p_claim_token AND state='sending';
  RETURN FOUND;
END $$;


-- Persist an event-state projection alongside private planner details.
CREATE FUNCTION planner_private.notification_projection() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  UPDATE public.portal_request_planner_details SET notification_state=jsonb_set(notification_state,
    ARRAY[NEW.event_type],to_jsonb(NEW.state)) WHERE request_id=NEW.request_id;
  RETURN NEW;
END $$;
CREATE TRIGGER planner_notification_projection AFTER INSERT OR UPDATE OF state
  ON public.portal_planner_notification_events FOR EACH ROW
  EXECUTE FUNCTION planner_private.notification_projection();

-- Explicit ACLs: no PUBLIC execute, no anonymous access to privileged RPCs.
DO $$
DECLARE f record;
BEGIN
  FOR f IN SELECT p.oid::regprocedure AS signature FROM pg_proc p
    WHERE p.pronamespace='public'::regnamespace AND p.proname IN(
      'panel_planner_rate_limit','submit_panel_planner_request','recover_panel_planner_request',
      'authorize_panel_planner_photos','prepare_panel_planner_finalization','finalize_panel_planner_photos',
      'get_panel_planner_customer_photos','panel_planner_orphan_paths','panel_planner_expire_technical_data',
      'claim_panel_planner_notifications','prepare_panel_planner_notification','complete_panel_planner_notification') LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',f.signature);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',f.signature);
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.get_panel_planner_owner_details(uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.accept_portal_request_to_hunter(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_panel_planner_owner_details(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.accept_portal_request_to_hunter(uuid) TO authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA planner_private FROM PUBLIC,anon,authenticated;
COMMIT;
