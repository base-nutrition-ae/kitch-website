-- KITCH LOCAL-ONLY browser smoke fixture.
-- WARNING: synthetic RPC stubs, NOT production authorization or inventory logic.
-- ONLY run in local Supabase Studio at http://127.0.0.1:54323.
-- Never apply to hosted Supabase, and NEVER deploy these functions.
--
-- This fixture demonstrates that the browser's Team sign-in and empty inventory
-- can talk to the local API. It DOES NOT validate real KITCH workflows.
-- Name = Demo Manager; PIN = 1357 (public synthetic credential)
--
-- Refuse installation if the local-only Postgres cluster database is unexpected.
DO $guard$
BEGIN
 IF current_database() <> 'postgres' THEN
  RAISE EXCEPTION 'Expected local postgres database';
 END IF;
 IF inet_server_port() <> 5432 THEN
  RAISE NOTICE 'Nondefault internal postgres port; confirm local Studio only.';
 END IF;
END $guard$;

CREATE OR REPLACE FUNCTION public.kitch_team_login(p_staff_name text, p_pin text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public
AS $$
 SELECT CASE WHEN lower(trim(p_staff_name)) = 'demo manager' AND p_pin = '1357'
 THEN jsonb_build_object(
 'staff_id','11111111-1111-4111-8111-111111111111',
 'staff_name','Demo Manager','role','kitchen_manager',
 'restaurant_id','22222222-2222-4222-8222-222222222222',
 'branch_id','33333333-3333-4333-8333-333333333333',
 'workspace_code','LOCAL-ONLY',
 'branch_name','Demo Kitchen','restaurant_name','KITCH Local Demo')
 ELSE NULL::jsonb END
$$;

CREATE OR REPLACE FUNCTION public.kitch_team_workspace_info(p_staff_name text, p_pin text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public
AS $$
 SELECT CASE WHEN lower(trim(p_staff_name)) = 'demo manager' AND p_pin = '1357'
 THEN jsonb_build_object('is_business',false,
 'assigned_branch_id','33333333-3333-4333-8333-333333333333',
 'assigned_branch_name','Demo Kitchen','assigned_branch_type','restaurant')
 ELSE NULL::jsonb END
$$;

CREATE OR REPLACE FUNCTION public.kitch_team_inventory_read(p_staff_name text, p_pin text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public
AS $$
 SELECT CASE WHEN lower(trim(p_staff_name)) = 'demo manager' AND p_pin = '1357'
 THEN jsonb_build_object(
 'restaurant_id','22222222-2222-4222-8222-222222222222',
 'branch_id','33333333-3333-4333-8333-333333333333',
 'ingredients',jsonb_build_array(),
 'balances',jsonb_build_array())
 ELSE NULL::jsonb END
$$;

CREATE OR REPLACE FUNCTION public.kitch_team_recipe_sync(p_staff_name text, p_pin text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public
AS $$
 SELECT CASE WHEN lower(trim(p_staff_name)) = 'demo manager' AND p_pin = '1357'
 THEN '[]'::jsonb ELSE NULL::jsonb END
$$;

GRANT EXECUTE ON FUNCTION public.kitch_team_login(text,text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.kitch_team_workspace_info(text,text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.kitch_team_inventory_read(text,text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.kitch_team_recipe_sync(text,text) TO anon, authenticated;
