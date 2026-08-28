-- SAFETY PORTAL — repair portal_config RLS
-- Run this in Supabase SQL Editor after assigning the admin user's
-- app_metadata role to "admin" (Dashboard -> Authentication -> Users ->
-- user -> Edit user -> App Metadata), then sign out and sign in again.
-- Never put a service_role key in the browser.

alter table public.portal_config enable row level security;

drop policy if exists "portal_config_write_admin" on public.portal_config;
create policy "portal_config_write_admin" on public.portal_config
  for update to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

drop policy if exists "portal_config_insert_admin" on public.portal_config;
create policy "portal_config_insert_admin" on public.portal_config
  for insert to authenticated
  with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

-- Verify policies and the current JWT role in the SQL editor.
select polname, polcmd::text, polroles, pg_get_expr(polqual, polrelid) as using_clause,
       pg_get_expr(polwithcheck, polrelid) as check_clause
from pg_policy
where polrelid = 'public.portal_config'::regclass
order by polname;

-- The following must be run as the logged-in user through the app, not here:
-- select auth.uid(), auth.role(), auth.jwt() -> 'app_metadata' ->> 'role';
