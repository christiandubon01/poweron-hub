// @ts-nocheck
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import { readFileSync } from 'node:fs'
export const ORG='10000000-0000-4000-8000-000000000001'
export const TENANT='20000000-0000-4000-8000-000000000001'
export const OWNER='30000000-0000-4000-8000-000000000001'
export const EMPLOYEE='30000000-0000-4000-8000-000000000002'
export const OTHER_OWNER='30000000-0000-4000-8000-000000000003'
export async function database() {
  const db=new PGlite({extensions:{pgcrypto}})
  await db.exec(SQL)
  const legacy=readFileSync('supabase/migrations/111_private_portal_storage.sql','utf8')
  const status=legacy.match(/CREATE OR REPLACE FUNCTION public\.get_portal_request_status[\s\S]*?\$\$;/i)?.[0]
  if(!status)throw new Error('Tracking function fixture missing')
  await db.exec(status)
  await db.exec('GRANT EXECUTE ON FUNCTION public.get_portal_request_status(uuid) TO anon,authenticated')
  await db.exec(readFileSync('supabase/migrations/148_panel_planner_submission_foundation.sql','utf8'))
  await db.exec(readFileSync('supabase/migrations/149_portal_site_integrations.sql','utf8'))
  await db.exec(readFileSync('supabase/migrations/150_panel_planner_site_routing.sql','utf8'))
  await db.exec(readFileSync('supabase/migrations/151_portal_routing_security_boundary.sql','utf8'))
  await db.exec(readFileSync('supabase/migrations/152_panel_planner_photo_retry.sql','utf8'))
  await db.exec("INSERT INTO public.test_profiles VALUES('30000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000001','admin'),('30000000-0000-4000-8000-000000000005','10000000-0000-4000-8000-000000000002','admin')")
  await db.exec(SITES)
  // Local fixture-only substitution; production helper has no clock override.
  await db.exec("CREATE OR REPLACE FUNCTION planner_private.now() RETURNS timestamptz LANGUAGE sql STABLE AS $$ SELECT t FROM public.test_clock $$")
  return db
}
export async function reset(db) {
  await db.exec("RESET ROLE; SET request.jwt.claim.sub=''; TRUNCATE public.portal_requests,public.hunter_leads,storage.objects,public.portal_planner_rate_limits CASCADE; UPDATE public.test_clock SET t='2026-10-06T00:00:00Z'; DELETE FROM public.tenant_settings;")
}
export async function role(db,user=OWNER) {
  await db.exec("SET ROLE authenticated; SET request.jwt.claim.sub='"+user+"'")
}
// Site A = the Power On integration seeded by migration 149 (org A, legacy default).
export const SITE_A='ps_3f9c1e7ab25d4086b1c7e0aa'
export const SITE_A2='ps_a2a2a2a2a2a2a2a2a2a2a2a2'   // second site, same organization A
export const SITE_B='ps_b1b1b1b1b1b1b1b1b1b1b1b1'    // organization B
export const SITE_OFF='ps_0f0f0f0f0f0f0f0f0f0f0f0f'  // disabled, organization B
export const SITE_UNKNOWN='ps_99999999999999999999999999'
export const ORG_B='10000000-0000-4000-8000-000000000002'
export const ORIGIN_A='https://poweronsolutionsllc.com'
export const ORIGIN_B='https://beta-power.example'
const SITES=`
INSERT INTO public.portal_site_integrations(organization_id,public_site_key,label,primary_origin,allowed_origins,notification_email,public_email,tracking_base_url) VALUES
 ('10000000-0000-4000-8000-000000000001','${SITE_A2}','Alpha second site','https://alpha-two.example',ARRAY['https://alpha-two.example'],'owner-a2@example.test',NULL,NULL),
 ('10000000-0000-4000-8000-000000000002','${SITE_B}','Beta Power','https://beta-power.example',ARRAY['https://beta-power.example','https://www.beta-power.example'],'owner-b@example.test','hello@beta-power.example','https://track.beta-power.example');
INSERT INTO public.portal_site_integrations(organization_id,public_site_key,label,primary_origin,allowed_origins,enabled) VALUES
 ('10000000-0000-4000-8000-000000000002','${SITE_OFF}','Beta disabled','https://off.example',ARRAY['https://off.example'],false);
`
const types={p_site_key:'text',p_origin:'text',
  p_payload:'jsonb',p_photo_manifest:'jsonb',p_verified_objects:'jsonb',p_delivery_payload:'jsonb',
  p_idempotency_key:'uuid',p_request_id:'uuid',p_authorization_key:'uuid',p_finalization_key:'uuid',
  p_authorization_id:'uuid',p_id:'uuid',p_claim_token:'uuid',p_photo_ids:'uuid[]',p_close_photos:'boolean'
}
export async function rpc(db,name,args={}) {
  const entries=Object.entries(args)
  const params=entries.map(([k,v])=>types[k]==='jsonb' ? JSON.stringify(v) : v)
  const named=entries.map(([k],i)=>k+' => $'+(i+1)+'::'+(types[k]||'text')).join(',')
  const result=await db.query('SELECT public.'+name+'('+named+') AS value',params)
  return result.rows[0].value
}

const SQL="\nCREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;\nCREATE SCHEMA auth; CREATE SCHEMA extensions; CREATE SCHEMA storage;\nCREATE EXTENSION pgcrypto WITH SCHEMA extensions;\nCREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$\n SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;\nCREATE TABLE public.organizations(id uuid PRIMARY KEY,hunter_tenant_id uuid UNIQUE,name text,settings jsonb NOT NULL DEFAULT '{}');\nCREATE TABLE public.test_profiles(id uuid PRIMARY KEY,org uuid,role text);\nINSERT INTO public.organizations VALUES('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','Org A','{\"identity\":{\"companyName\":\"Alpha Electric\",\"supportPhone\":\"7605550111\",\"supportEmail\":\"private-a@example.test\",\"logoLight\":\"https://cdn.example.test/a.png\"},\"billing\":{\"plan\":\"secret-a\"}}'),\n ('10000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000002','Org B','{\"identity\":{\"companyName\":\"Beta Power\",\"supportPhone\":\"7605550222\",\"supportEmail\":\"private-b@example.test\"},\"billing\":{\"plan\":\"secret-b\"}}');\nINSERT INTO public.test_profiles VALUES\n ('30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','owner'),\n ('30000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','employee'),\n ('30000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000002','owner');\nCREATE FUNCTION public.user_org_id() RETURNS uuid LANGUAGE sql SECURITY DEFINER AS $$\n SELECT org FROM public.test_profiles WHERE id=auth.uid() $$;\nCREATE FUNCTION public.is_org_admin_for(p uuid) RETURNS boolean LANGUAGE sql SECURITY DEFINER AS $$\n SELECT EXISTS(SELECT 1 FROM public.test_profiles WHERE id=auth.uid() AND org=p AND role IN('owner','admin')) $$;\nCREATE TABLE public.user_tenants(user_id uuid,tenant_id uuid);\nINSERT INTO public.user_tenants VALUES('30000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001');\nCREATE TABLE public.tenant_settings(tenant_id uuid,setting_key text,setting_value jsonb);\nCREATE TABLE public.hunter_leads(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid,user_id uuid,\n lead_type text,source text,source_tag text,status text,score integer,score_tier text,contact_name text,\n phone text,email text,address text,city text,description text,notes text,estimated_value numeric,estimated_margin numeric,geocoding_status text);\nCREATE TABLE public.portal_requests(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id uuid NOT NULL REFERENCES organizations(id),\n name text NOT NULL,phone text,email text,address text,city text,request_type text,service_category text,source text,status text,\n description text,notes text,preferred_date date,preferred_time text,created_at timestamptz DEFAULT now(),\n hunter_lead_id uuid REFERENCES hunter_leads(id),attach_token_hash text,source_category text,gclid text,gbraid text,wbraid text,\n utm_source text,utm_medium text,utm_campaign text,utm_term text,utm_content text,page_url text,referrer text,landing_page text);\nALTER TABLE public.portal_requests ENABLE ROW LEVEL SECURITY;\nGRANT SELECT,UPDATE ON public.portal_requests TO authenticated;\nCREATE POLICY owner_request_read ON public.portal_requests FOR SELECT TO authenticated\n USING(organization_id=public.user_org_id() AND public.is_org_admin_for(organization_id));\nCREATE POLICY owner_request_update ON public.portal_requests FOR UPDATE TO authenticated\n USING(organization_id=public.user_org_id() AND public.is_org_admin_for(organization_id))\n WITH CHECK(organization_id=public.user_org_id() AND public.is_org_admin_for(organization_id));\nCREATE TABLE public.referral_claims(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id uuid,portal_request_id uuid,raw_referral_text text);\nCREATE TABLE public.portal_request_configuration(singleton boolean PRIMARY KEY,organization_id uuid);\nINSERT INTO public.portal_request_configuration VALUES(true,'10000000-0000-4000-8000-000000000001');\nCREATE TABLE public.portal_upload_authorizations(id uuid PRIMARY KEY,request_id uuid REFERENCES portal_requests(id),\n paths text[],expires_at timestamptz,consumed_at timestamptz,created_at timestamptz DEFAULT now());\nCREATE TABLE storage.buckets(id text PRIMARY KEY,public boolean);\nINSERT INTO storage.buckets VALUES('portal-uploads',false);\nCREATE TABLE storage.objects(id uuid DEFAULT gen_random_uuid(),bucket_id text,name text,metadata jsonb,\n created_at timestamptz DEFAULT now(),UNIQUE(bucket_id,name));\nGRANT USAGE ON SCHEMA public,auth TO anon,authenticated,service_role;\nGRANT EXECUTE ON FUNCTION auth.uid(),public.user_org_id(),public.is_org_admin_for(uuid) TO anon,authenticated,service_role;\nGRANT ALL ON ALL TABLES IN SCHEMA public,storage TO service_role;\nCREATE TABLE public.test_clock(t timestamptz);\nINSERT INTO public.test_clock VALUES('2026-10-06T00:00:00Z');\n"
