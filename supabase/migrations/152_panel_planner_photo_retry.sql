-- New-key retries allocate fresh create-only paths. No changes to saved requests or prior migrations.
BEGIN;
CREATE OR REPLACE FUNCTION public.authorize_panel_planner_photos(p_request_id uuid,p_recovery_token text,p_authorization_key uuid,
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
    -- A new key supersedes this photo's previous allocation; replay above stays stable.
    path:=p_request_id::text||'/'||gen_random_uuid()::text||CASE m->>'mime_type'
      WHEN 'image/jpeg' THEN '.jpg' WHEN 'image/png' THEN '.png' WHEN 'image/webp' THEN '.webp' END;
    objects:=objects||jsonb_build_object(pid::text,path);

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

CREATE OR REPLACE FUNCTION public.prepare_panel_planner_finalization(p_request_id uuid,p_recovery_token text,p_finalization_key uuid,
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
  -- An obsolete batch cannot close the request using an empty selection either.
  IF cardinality(p_photo_ids)=0 AND EXISTS(SELECT 1 FROM jsonb_array_elements(batch->'files') historical_file
    WHERE d.photo_transport->'objects'->>(historical_file->>'client_photo_id') IS DISTINCT FROM historical_file->>'object_path')
    THEN RAISE EXCEPTION 'PHOTO_OBJECT_INVALID'; END IF;
  FOREACH pid IN ARRAY p_photo_ids LOOP
    SELECT value INTO f FROM jsonb_array_elements(batch->'files') WHERE value->>'client_photo_id'=pid::text;
    -- Rechecked under the finalizer's request lock, including rotation during byte verification.
    IF f IS NULL OR d.photo_transport->'registered' ? pid::text OR
      d.photo_transport->'objects'->>pid::text IS DISTINCT FROM f->>'object_path' THEN RAISE EXCEPTION 'PHOTO_OBJECT_INVALID'; END IF;
    files:=files||jsonb_build_array(f);
  END LOOP;
  RETURN jsonb_build_object('replayed',false,'files',files,'digest',digest_value);
END $$;

CREATE OR REPLACE FUNCTION public.panel_planner_orphan_paths() RETURNS text[]
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public,planner_private AS $$
  SELECT coalesce(array_agg(name),'{}') FROM (
    SELECT o.name FROM storage.objects o JOIN public.portal_request_planner_details d
      ON split_part(o.name,'/',1)=d.request_id::text
    WHERE o.bucket_id='portal-uploads' AND o.created_at<=planner_private.now()-interval '24 hours'
      AND d.write_deadline<planner_private.now()
      AND o.name ~ ('^'||d.request_id::text||'/[0-9a-f-]{36}[.](jpg|png|webp)$')
      -- Keep all allocation history visible when the current mapping rotates.
      AND (EXISTS(SELECT 1 FROM jsonb_each_text(d.photo_transport->'objects') x WHERE x.value=o.name)
        OR EXISTS(SELECT 1 FROM jsonb_each(d.photo_transport->'authorizations') a
          CROSS JOIN LATERAL jsonb_array_elements(a.value->'files') f WHERE f->>'object_path'=o.name))
      AND NOT EXISTS(SELECT 1 FROM jsonb_each(d.photo_transport->'registered') x WHERE x.value->>'object_path'=o.name)
    ORDER BY o.created_at,o.name LIMIT 100
  ) eligible
$$;
-- CREATE OR REPLACE preserves existing service-only ACLs; assert them explicitly.
REVOKE ALL ON FUNCTION public.authorize_panel_planner_photos(uuid,text,uuid,uuid[]),
  public.prepare_panel_planner_finalization(uuid,text,uuid,uuid,uuid[],boolean),
  public.panel_planner_orphan_paths() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.authorize_panel_planner_photos(uuid,text,uuid,uuid[]),
  public.prepare_panel_planner_finalization(uuid,text,uuid,uuid,uuid[],boolean),
  public.panel_planner_orphan_paths() TO service_role;
COMMIT;
