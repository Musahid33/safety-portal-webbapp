-- SAFETY PORTAL — one-shot admin security repair
-- Run this in Supabase SQL Editor after setting the admin user's
-- App Metadata to {"role":"admin"}. It is safe to run more than once.
--
-- This repair protects every privileged action, not only Save & Publish:
--   * portal_config writes
--   * usage reads and reset_hits()
--   * Storage site-file upload/update/delete
-- The public anon key may read the public portal and record a hit, but cannot
-- perform any of the actions above.

-- ---------- shared admin check ------------------------------------------
create or replace function public.is_portal_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin', false)
$$;
revoke execute on function public.is_portal_admin() from public;
grant execute on function public.is_portal_admin() to authenticated;

-- ---------- tables, grants, and RLS -------------------------------------
create table if not exists public.portal_config (
  id          integer primary key default 1,
  data        jsonb        not null,
  updated_at  timestamptz  not null default now(),
  updated_by  text,
  constraint portal_config_one_row check (id = 1)
);
alter table public.portal_config add column if not exists updated_by text;

grant usage on schema public to anon, authenticated;
grant select                 on table public.portal_config to anon;
grant select, insert, update on table public.portal_config to authenticated;
alter table public.portal_config enable row level security;

drop policy if exists "portal_config_read_all" on public.portal_config;
drop policy if exists "portal_config_read_login" on public.portal_config;
drop policy if exists "portal_config_read_login_only" on public.portal_config;
drop policy if exists "portal_config_write_admin" on public.portal_config;
drop policy if exists "portal_config_write_authenticated" on public.portal_config;
drop policy if exists "portal_config_write_one" on public.portal_config;
drop policy if exists "portal_config_insert_admin" on public.portal_config;
drop policy if exists "portal_config_insert_authenticated" on public.portal_config;
drop policy if exists "portal_config_delete_admin" on public.portal_config;

create policy "portal_config_read_all" on public.portal_config
  for select to anon, authenticated using (true);
create policy "portal_config_write_admin" on public.portal_config
  for update to authenticated
  using (public.is_portal_admin())
  with check (public.is_portal_admin());
create policy "portal_config_insert_admin" on public.portal_config
  for insert to authenticated
  with check (public.is_portal_admin());

create table if not exists public.portal_hits (
  key      text primary key,
  hits     bigint       not null default 0,
  last_at  timestamptz  not null default now()
);
grant select on table public.portal_hits to authenticated;
alter table public.portal_hits enable row level security;

drop policy if exists "portal_hits_read_admin" on public.portal_hits;
drop policy if exists "portal_hits_read_authenticated" on public.portal_hits;
drop policy if exists "portal_hits_write" on public.portal_hits;
create policy "portal_hits_read_admin" on public.portal_hits
  for select to authenticated using (public.is_portal_admin());

-- ---------- RPCs --------------------------------------------------------
create or replace function public.record_hit(p_key text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_key is null or length(p_key) > 60 then return; end if;
  insert into public.portal_hits (key, hits, last_at) values (p_key, 1, now())
    on conflict (key) do update set hits = public.portal_hits.hits + 1, last_at = now();
end $$;
revoke execute on function public.record_hit(text) from public;
grant execute on function public.record_hit(text) to anon, authenticated;

create or replace function public.reset_hits() returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_portal_admin() then
    raise exception 'portal admin required' using errcode = '42501';
  end if;
  delete from public.portal_hits;
end $$;
revoke execute on function public.reset_hits() from public, anon;
grant execute on function public.reset_hits() to authenticated;

-- ---------- diagnostic RPC ----------------------------------------------
create or replace function public.sp_whoami() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_claims jsonb := null; v_jwt_role text; v_uid uuid; v_email text; v_confirmed boolean;
  v_policies jsonb; v_rls boolean;
begin
  begin v_claims := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
  exception when others then v_claims := null; end;
  v_jwt_role := coalesce(v_claims->>'role', 'anon');
  if v_jwt_role <> 'authenticated' then
    return jsonb_build_object('jwt_role', v_jwt_role, 'uid', null, 'is_admin', false,
      'note', 'Request me valid authenticated JWT nahi tha — Admin panel me login kariye.');
  end if;
  if not public.is_portal_admin() then
    return jsonb_build_object('jwt_role', v_jwt_role, 'uid', auth.uid(), 'is_admin', false,
      'note', 'Is user ke app_metadata me role=admin nahi hai.');
  end if;

  begin v_uid := auth.uid(); exception when others then v_uid := null; end;
  if v_uid is not null then
    begin
      select u.email, (u.email_confirmed_at is not null) into v_email, v_confirmed
        from auth.users u where u.id = v_uid;
    exception when others then v_email := null; v_confirmed := null; end;
  end if;
  select relrowsecurity into v_rls from pg_class where oid = 'public.portal_config'::regclass;
  select coalesce(jsonb_agg(jsonb_build_object(
           'name', p.polname,
           'cmd', case p.polcmd when 'r' then 'select' when 'a' then 'insert' when 'w' then 'update'
                                when 'd' then 'delete' when '*' then 'all' else p.polcmd::text end,
           'roles', coalesce((select jsonb_agg(r.rolname) from pg_roles r where r.oid = any(p.polroles)), '[]'::jsonb)
         )), '[]'::jsonb) into v_policies
    from pg_policy p where p.polrelid = 'public.portal_config'::regclass;
  return jsonb_build_object('jwt_role', v_jwt_role, 'uid', v_uid, 'is_admin', true,
    'email', v_email, 'email_confirmed', v_confirmed, 'rls_enabled', v_rls, 'policies', v_policies,
    'grants', jsonb_build_object(
      'insert', has_table_privilege('authenticated', 'public.portal_config', 'insert'),
      'update', has_table_privilege('authenticated', 'public.portal_config', 'update'),
      'select_anon', has_table_privilege('anon', 'public.portal_config', 'select')));
end $$;
revoke execute on function public.sp_whoami() from public;
grant execute on function public.sp_whoami() to anon, authenticated;

-- ---------- Storage -----------------------------------------------------
-- The bucket remains public-read so the site can be served statically.
-- Only an authenticated user with the admin claim may deploy or overwrite it.
drop policy if exists "portal_read" on storage.objects;
create policy "portal_read" on storage.objects
  for select to anon, authenticated using (bucket_id = 'portal');
drop policy if exists "portal_deploy_insert" on storage.objects;
create policy "portal_deploy_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'portal' and public.is_portal_admin());
drop policy if exists "portal_deploy_update" on storage.objects;
create policy "portal_deploy_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'portal' and public.is_portal_admin())
  with check (bucket_id = 'portal' and public.is_portal_admin());
drop policy if exists "portal_deploy_delete" on storage.objects;
create policy "portal_deploy_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'portal' and public.is_portal_admin());

-- ---------- diagnostics -------------------------------------------------
select polname, polcmd::text
  from pg_policy where polrelid = 'public.portal_config'::regclass order by polname;
select grantee, privilege_type
  from information_schema.role_table_grants
 where table_schema = 'public' and table_name = 'portal_config'
 order by grantee, privilege_type;
select id, updated_at, updated_by
  from public.portal_config where id = 1;
-- Expected: config write policies use is_portal_admin(); portal_hits is readable
-- only by admins; storage deploy policies are authenticated + is_portal_admin().
