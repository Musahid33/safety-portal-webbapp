-- =====================================================================
--  SAFETY PORTAL — “Save nahi hua: Supabase ne RLS se roka (403)” ka ONE-SHOT FIX
--
--  Kab chalayen: Admin → Save & Publish par aaye —
--     "Save nahi hua: Supabase ne likhne se roka (RLS policy) ..."
--
--  Kaise: Supabase Dashboard → SQL Editor → New query → POORA paste → RUN
--  (har line idempotent hai — 2 baar chalane se kuch nahi bigadta)
--
--  Ye 403 ke 3 possible karan hain, aur teeno yahi theek karta hai:
--    (A) session hi nahi / JWT expire   -> request anon role se jaati hai -> RLS rokta hai
--        (iska ilaaj SQL nahi, LOGIN hai. js/app.js ab khud refresh karke retry karta hai,
--         aur ab aap ko saaf "login kariye" bola jayega, RLS ka_bhoot nahi.)
--    (B) table par authenticated ko GRANT nahi (default privileges na milen)  <- niche (2)
--    (C) policy delete ho gayi / koi sakht policy lag gayi (e.g. placeholder-UUID wali
--        portal_config_write_one, ya service_role wali)                        <- niche (3)
--
--  NOTE: is portal ki policy me koi extra "admin role" check NAHI hai —
--        portal_config_write_admin = "to authenticated" = jo bhi logged-in Supabase user
--        likh sakta hai. Isliye "user ke paas admin role nahi hai" wali baat yahan
--        laagu nahi hoti; haan, sirf EK user likhe uske liye (5) wala block dekhiye.
--  ⚠ Isme service_role key ki zarurat NAHI hai —Dashboard ke SQL Editor se hi ho jata hai.
-- =====================================================================

-- ---------- 0) table + columns (purane setup me updated_by na ho to add ho jayega) ----
create table if not exists public.portal_config (
  id          integer primary key default 1,
  data        jsonb        not null,
  updated_at  timestamptz  not null default now(),
  updated_by  text,
  constraint portal_config_one_row check (id = 1)
);
alter table public.portal_config add column if not exists updated_by text;

-- ---------- 1) schema usage (ye missing ho to error "permission denied for schema public") --
grant usage on schema public to anon, authenticated, service_role;

-- ---------- 2) GRANTS — sabse common "RLS" samajh jaane wala masla ---------------------
-- anon: sirf read (public portal). authenticated: read + insert + update (upsert ke liye dono).
grant select                     on table public.portal_config to anon;
grant select, insert, update     on table public.portal_config to authenticated;
-- click counter
grant select                     on table public.portal_hits to authenticated;
-- security definer functions (grant execute without RLS bypass nahi karta, par chahiye)
grant execute on function public.record_hit(text) to anon, authenticated;
grant execute on function public.reset_hits()     to authenticated;

-- ---------- 3) POLICIES — hataa ke dobara (taaki koi purani/ani policy bache nahi) ------
alter table public.portal_config enable row level security;

drop policy if exists "portal_config_read_all"      on public.portal_config;
drop policy if exists "portal_config_read_login"    on public.portal_config;
drop policy if exists "portal_config_read_login_only" on public.portal_config;
drop policy if exists "portal_config_write_admin"   on public.portal_config;
drop policy if exists "portal_config_insert_admin"  on public.portal_config;
drop policy if exists "portal_config_delete_admin"  on public.portal_config;
-- purana placeholder-UUID wala experiment (aaaaaaaa-bbbb-...) — yahi 403 ka karan ban jaata tha
drop policy if exists "portal_config_write_one"     on public.portal_config;

-- sab padh sakte hain (public site)
create policy "portal_config_read_all" on public.portal_config
  for select to anon, authenticated using (true);

-- sirf logged-in user likh sake (role check explicitly, taaki anon kabhi pass na ho)
create policy "portal_config_write_admin" on public.portal_config
  for update to authenticated
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

create policy "portal_config_insert_admin" on public.portal_config
  for insert to authenticated with check (auth.role() = 'authenticated');

-- ---------- 4) app ka "Session check" isi function ko bulata hai -----------------------
--     Admin panel → Cloud → Session check. Kuch bhi badalta nahi, sirf batata hai:
--     aap kaun hain, RLS on hai ya nahi, policy/grants theek hain ya nahi.
create or replace function public.sp_whoami() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_claims jsonb := null;
  v_jwt_role text;
  v_uid uuid;
  v_email text;
  v_confirmed boolean;
  v_policies jsonb;
  v_rls boolean;
begin
  begin
    v_claims := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
  exception when others then v_claims := null; end;
  v_jwt_role := coalesce(v_claims->>'role', 'anon');

  -- anon caller ko detail dikhane ki zarurat nahi (thodi si info-leak se bachne ke liye)
  if v_jwt_role = 'anon' then
    return jsonb_build_object(
      'jwt_role', 'anon', 'uid', null, 'note',
      'Session nahi bheja gaya request me -> PostgREST anon role hai -> portal_config par RLS write rok dega. Admin panel me login kariye.');
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
         )), '[]'::jsonb)
    into v_policies
    from pg_policy p where p.polrelid = 'public.portal_config'::regclass;

  return jsonb_build_object(
    'jwt_role', v_jwt_role,
    'uid', v_uid,
    'email', v_email,
    'email_confirmed', v_confirmed,
    'rls_enabled', v_rls,
    'policies', v_policies,
    'grants', jsonb_build_object(
      'insert', has_table_privilege('authenticated', 'public.portal_config', 'insert'),
      'update', has_table_privilege('authenticated', 'public.portal_config', 'update'),
      'select_anon', has_table_privilege('anon', 'public.portal_config', 'select')
    )
  );
end $$;

revoke execute on function public.sp_whoami() from public;
grant execute on function public.sp_whoami() to anon, authenticated;

-- ---------- 5) (optional) sirf EK user likhe — placeholder UUID se bachiyega! ----------
--     Poora block uncomment kariye aur apna email daal dijiye. UUID copy karne me galti
--     hoti thi — isliye purani file me 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' chala gaya
--     tha aur SAB write 403 ho gaye the. Email se safe hai.
-- drop policy if exists "portal_config_write_admin" on public.portal_config;
-- create policy "portal_config_write_admin" on public.portal_config
--   for update to authenticated
--   using (auth.uid() = (select id from auth.users where email = 'aapka@email.com'))
--   with check (auth.uid() = (select id from auth.users where email = 'aapka@email.com'));
-- drop policy if exists "portal_config_insert_admin" on public.portal_config;
-- create policy "portal_config_insert_admin" on public.portal_config
--   for insert to authenticated
--   with check (auth.uid() = (select id from auth.users where email = 'aapka@email.com'));

-- =====================================================================
--  DIAGNOSTICS — RUN ke baad ye results padhiye (Expected niche likha hai)
-- =====================================================================

-- (a) policy: 3 row aani chahiye — read_all(select), write_admin(update), insert_admin(insert)
select p.polname,
       case p.polcmd when 'r' then 'select' when 'a' then 'insert' when 'w' then 'update'
                     when 'd' then 'delete' when '*' then 'all' else p.polcmd::text end as cmd,
       coalesce((select string_agg(r.rolname, ', ') from pg_roles r where r.oid = any(p.polroles)), 'all roles') as to_roles,
       pg_get_expr(p.polqual, p.polrelid)      as using_expr,
       pg_get_expr(p.polwithcheck, p.polrelid) as check_expr
  from pg_policy p
 where p.polrelid = 'public.portal_config'::regclass
 order by 1;

-- (b) grants: anon->select; authenticated->select,insert,update (ye khali = 403 ka asli karan)
select grantee, privilege_type
  from information_schema.role_table_grants
 where table_schema = 'public' and table_name = 'portal_config'
 order by 1, 2;

-- (c) RLS on hai? (relrowsecurity = true chahiye) + row ka state
select relrowsecurity from pg_class where oid = 'public.portal_config'::regclass;
select id, updated_at, updated_by, jsonb_array_length(data->'sections') as sections
  from public.portal_config where id = 1;

-- (d) login user kaun hai + email confirmed hai ya nahi (confirmed = true chahiye,
--     warna GoTrue session deta hi nahi aur app anon ban jaati hai)
select id, email, (email_confirmed_at is not null) as confirmed, last_sign_in_at
  from auth.users order by created_at desc limit 10;

-- (e) asani ke liye: dashboard se hi test kijiye — niche wala SELECT "authenticated" role
--     ke taur par chalaakar dekh sakta hai ki policy pass hoti hai ya nahi:
--       set local role authenticated;
--       set local request.jwt.claims = '{"role":"authenticated","sub":"<uid-here>"}';
--       select 1 from public.portal_config where id = 1 for update;   -- 1 row aaye = theek
--       reset role;
--     (SQL Editor service_role se chalta hai, isliye ye block optional/simulated hai.)
