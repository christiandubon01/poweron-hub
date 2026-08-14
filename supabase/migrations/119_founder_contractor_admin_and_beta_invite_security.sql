-- COMM-PROD-4: founder contractor administration + secure beta invite lifecycle.
-- Forward-only migration. Existing migrations remain unchanged.

ALTER TABLE public.beta_invites
  ADD COLUMN IF NOT EXISTS accepted_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES public.organizations(id) ON DELETE SET NULL;

ALTER TABLE public.beta_invites DROP CONSTRAINT IF EXISTS beta_invites_status_check;
ALTER TABLE public.beta_invites
  ADD CONSTRAINT beta_invites_status_check
  CHECK (status IN ('pending', 'accepted', 'expired', 'revoked'));

CREATE INDEX IF NOT EXISTS beta_invites_accepted_user_idx
  ON public.beta_invites (accepted_user_id);
CREATE INDEX IF NOT EXISTS beta_invites_organization_idx
  ON public.beta_invites (organization_id);

-- The legacy anon policy was `USING (true)`, which allowed enumeration of every
-- invitation. Public validation is now token-scoped through a SECURITY DEFINER
-- function that returns only the fields needed by the activation screen.
DROP POLICY IF EXISTS "anon_token_lookup" ON public.beta_invites;

CREATE OR REPLACE FUNCTION public.validate_beta_invite(p_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_invite public.beta_invites%ROWTYPE;
  v_status TEXT;
BEGIN
  IF p_token IS NULL OR length(trim(p_token)) < 10 THEN
    RETURN jsonb_build_object('valid', false, 'reason', 'invalid_token');
  END IF;

  SELECT * INTO v_invite
  FROM public.beta_invites
  WHERE invite_token = p_token
  LIMIT 1;

  IF v_invite.id IS NULL THEN
    RETURN jsonb_build_object('valid', false, 'reason', 'not_found');
  END IF;

  v_status := v_invite.status;
  IF v_status = 'pending' AND v_invite.expires_at <= now() THEN
    v_status := 'expired';
  END IF;

  IF v_status <> 'pending' THEN
    RETURN jsonb_build_object(
      'valid', false,
      'reason', CASE WHEN v_status = 'accepted' THEN 'already_accepted' ELSE v_status END,
      'invite', jsonb_build_object(
        'id', v_invite.id,
        'email', v_invite.email,
        'industry', v_invite.industry,
        'status', v_status,
        'invited_at', v_invite.invited_at,
        'accepted_at', v_invite.accepted_at,
        'expires_at', v_invite.expires_at
      )
    );
  END IF;

  RETURN jsonb_build_object(
    'valid', true,
    'invite', jsonb_build_object(
      'id', v_invite.id,
      'email', v_invite.email,
      'industry', v_invite.industry,
      'status', v_status,
      'invited_at', v_invite.invited_at,
      'accepted_at', v_invite.accepted_at,
      'expires_at', v_invite.expires_at
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.validate_beta_invite(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.validate_beta_invite(TEXT) TO anon, authenticated;

-- Acceptance is authenticated, email-bound, and records the resulting user/org
-- link on the invitation itself. Browser clients never receive cross-org access.
CREATE OR REPLACE FUNCTION public.accept_beta_invite(p_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_email TEXT;
  v_invite public.beta_invites%ROWTYPE;
  v_org_id UUID;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'not_authenticated');
  END IF;

  SELECT email INTO v_email FROM auth.users WHERE id = v_uid;
  SELECT * INTO v_invite
  FROM public.beta_invites
  WHERE invite_token = p_token
  FOR UPDATE;

  IF v_invite.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'not_found');
  END IF;
  IF v_invite.status = 'accepted' AND v_invite.accepted_user_id = v_uid THEN
    RETURN jsonb_build_object('success', true, 'invite_id', v_invite.id, 'organization_id', v_invite.organization_id);
  END IF;
  IF v_invite.status <> 'pending' OR v_invite.expires_at <= now() THEN
    RETURN jsonb_build_object('success', false, 'reason', CASE WHEN v_invite.status = 'accepted' THEN 'already_accepted' ELSE 'inactive' END);
  END IF;
  IF lower(trim(v_invite.email)) <> lower(trim(coalesce(v_email, ''))) THEN
    RETURN jsonb_build_object('success', false, 'reason', 'email_mismatch');
  END IF;

  SELECT org_id INTO v_org_id FROM public.profiles WHERE id = v_uid;

  UPDATE public.beta_invites
  SET status = 'accepted',
      accepted_at = now(),
      accepted_user_id = v_uid,
      organization_id = v_org_id
  WHERE id = v_invite.id;

  RETURN jsonb_build_object(
    'success', true,
    'invite_id', v_invite.id,
    'accepted_user_id', v_uid,
    'organization_id', v_org_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.accept_beta_invite(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.accept_beta_invite(TEXT) TO authenticated;
