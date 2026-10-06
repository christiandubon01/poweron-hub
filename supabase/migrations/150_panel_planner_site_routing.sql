-- 150: Panel Planner routes through portal_site_integrations (migration 149) instead of the
-- global singleton. Planner migration 148 is NOT edited. Neither is applied to production yet,
-- so the old 6-arg submit / 2-arg recover signatures are dropped (no callers outside this branch).
-- Idempotency uniqueness stays organization-scoped; an existing key is also bound to the
-- originating integration (cross-site reuse inside one org is an IDEMPOTENCY_CONFLICT).
BEGIN;

DROP FUNCTION public.submit_panel_planner_request(jsonb,uuid,text,text,text,jsonb);
DROP FUNCTION public.recover_panel_planner_request(uuid,text);

CREATE FUNCTION public.submit_panel_planner_request(p_payload jsonb,p_idempotency_key uuid,p_recovery_token text,
  p_customer_note text,p_consent_version text,p_photo_manifest jsonb,p_site_key text,p_origin text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,extensions,planner_private AS $$
DECLARE org uuid; site public.portal_site_integrations; d public.portal_request_planner_details; request_uuid uuid; digest_value text; manifest jsonb;
  c jsonb; m jsonb; photo jsonb; email_value text; phone_value text;
BEGIN
  -- Organization comes ONLY from the server-resolved site integration (no singleton, no browser org).
  site:=portal_private.resolve_site(p_site_key,p_origin); org:=site.organization_id;
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
    IF NOT EXISTS(SELECT 1 FROM public.portal_requests r0 WHERE r0.id=d.request_id AND r0.portal_site_integration_id=site.id)
      THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT'; END IF;
    PERFORM planner_private.proof(d,p_recovery_token);
    IF d.payload_digest IS DISTINCT FROM digest_value THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT'; END IF;
    RETURN planner_private.receipt(d,true);
  END IF;
  -- This dedicated RPC is service-only. The public HTTP adapter validates the entire frozen schema.
  -- No browser org/source/status/tenant argument is accepted.
  INSERT INTO public.portal_requests(organization_id,portal_site_integration_id,name,phone,email,address,city,request_type,service_category,
    source,status,description,created_at,gclid,gbraid,wbraid,utm_source,utm_medium,utm_campaign,utm_term,utm_content,page_url)
  VALUES(org,site.id,btrim(c->>'name'),phone_value,email_value,nullif(btrim(c->>'address'),''),nullif(btrim(c->>'city'),''),
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

CREATE FUNCTION public.recover_panel_planner_request(p_idempotency_key uuid,p_recovery_token text,p_site_key text,p_origin text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,planner_private AS $$
DECLARE d public.portal_request_planner_details; site public.portal_site_integrations;
BEGIN
  site:=portal_private.resolve_site(p_site_key,p_origin);
  -- Same organization AND same originating integration: no cross-org or cross-site recovery.
  SELECT d0.* INTO d FROM public.portal_request_planner_details d0 JOIN public.portal_requests r0
    ON r0.id=d0.request_id AND r0.organization_id=d0.organization_id
    WHERE d0.organization_id=site.organization_id AND r0.portal_site_integration_id=site.id
      AND d0.client='panel-planner-web-v1' AND d0.idempotency_key=p_idempotency_key;
  IF NOT FOUND THEN RAISE EXCEPTION 'REQUEST_UNAVAILABLE'; END IF;
  PERFORM planner_private.proof(d,p_recovery_token);
  RETURN planner_private.receipt(d,true);
END $$;

CREATE OR REPLACE FUNCTION planner_private.receipt(d public.portal_request_planner_details,p_replayed boolean) RETURNS jsonb
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
    'tracking_url',coalesce((SELECT i.tracking_base_url FROM public.portal_site_integrations i WHERE i.id=r.portal_site_integration_id),
      'https://app.poweronsolutionsllc.com')||'/portal/track/'||d.request_id,
    'photos',jsonb_build_object('state',photo_state,'write_deadline',d.write_deadline,
      'registered_photo_ids',registered,'remaining_photo_ids',remaining,
      'retry_allowed',photo_state IN('pending','partial')),
    'notifications',jsonb_build_object('owner',coalesce(states->>'owner_new_request','pending'),
      'customer',coalesce(states->>'customer_submission_confirmation','not_requested')));
END $$;

CREATE OR REPLACE FUNCTION public.claim_panel_planner_notifications() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,planner_private AS $$
DECLARE output jsonb:='[]'; e public.portal_planner_notification_events; r public.portal_requests; i public.portal_site_integrations;
BEGIN
  -- Never retry an ambiguous provider call beyond its 24h idempotency retention.
  UPDATE public.portal_planner_notification_events SET state='uncertain',claim_token=NULL
    WHERE state='sending' AND first_attempt_at<=planner_private.now()-interval '23 hours';
  FOR e IN SELECT * FROM public.portal_planner_notification_events
    WHERE state='pending' OR (state='sending' AND claimed_at<planner_private.now()-interval '5 minutes'
      AND first_attempt_at>planner_private.now()-interval '23 hours')
    ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 10 LOOP
    SELECT * INTO r FROM public.portal_requests WHERE id=e.request_id;
    SELECT * INTO i FROM public.portal_site_integrations WHERE id=r.portal_site_integration_id;
    UPDATE public.portal_planner_notification_events SET state='sending',claim_token=gen_random_uuid(),
      claimed_at=planner_private.now(),first_attempt_at=coalesce(first_attempt_at,planner_private.now()),attempts=attempts+1
      WHERE id=e.id RETURNING * INTO e;
    output:=output||jsonb_build_array(jsonb_build_object('id',e.id,'claim_token',e.claim_token,'event_type',e.event_type,
      'delivery_payload',e.delivery_payload,'request_id',r.id,'name',r.name,'phone',r.phone,'email',r.email,
      'address',r.address,'city',r.city,'description',r.description,'created_at',r.created_at,
      -- Trusted per-site routing/branding (server-side only; never browser supplied).
      'owner_email',i.notification_email,'owner_email_fallback_allowed',coalesce(i.legacy_default,false),
      'site_label',i.label,'display_name',(SELECT coalesce(nullif(btrim(o.settings->'identity'->>'companyName'),''),o.name)
        FROM public.organizations o WHERE o.id=r.organization_id),
      'tracking_base_url',coalesce(i.tracking_base_url,'https://app.poweronsolutionsllc.com')));
  END LOOP;
  RETURN output;
END $$;

REVOKE ALL ON FUNCTION public.submit_panel_planner_request(jsonb,uuid,text,text,text,jsonb,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.submit_panel_planner_request(jsonb,uuid,text,text,text,jsonb,text,text) TO service_role;
REVOKE ALL ON FUNCTION public.recover_panel_planner_request(uuid,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.recover_panel_planner_request(uuid,text,text,text) TO service_role;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA planner_private FROM PUBLIC,anon,authenticated;

COMMIT;
