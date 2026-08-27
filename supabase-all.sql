-- =====================================================================
--  SAFETY PORTAL — EK HI FILE, EK HI RUN  (recommended)
--  Isme 2 kaam hain: (A) portal ka DB (portal_config + hits + RLS + seed)
--                     (B) site host karne ke liye public 'portal' bucket + temporary upload policy
--
--  Supabase Dashboard → SQL Editor → New query → POORA paste → RUN
--  Uske baad:  site files upload (main kar dunga, ya aap Dashboard → Storage se)
--          aur  supabase-lockdown.sql  (upload policy band karne ke liye) — zaroor chalaiye.
-- =====================================================================

-- ---------- (A) DATABASE ----------

-- 1) Poora portal config (ek row = poora page) ---------------------------
create table if not exists public.portal_config (
  id          integer primary key default 1,
  data        jsonb        not null,
  updated_at  timestamptz  not null default now(),
  updated_by  text,
  constraint portal_config_one_row check (id = 1)
);

-- updated_at har save par apne aap badhe (live polling isi ko dekhti hai)
create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists portal_config_touch on public.portal_config;
create trigger portal_config_touch before update on public.portal_config
  for each row execute function public.touch_updated_at();

-- 2) Row-level security: sab padh sakte hain, sirf logged-in admin likh sakta hai
alter table public.portal_config enable row level security;

drop policy if exists "portal_config_read_all" on public.portal_config;
create policy "portal_config_read_all" on public.portal_config
  for select using (true);

drop policy if exists "portal_config_write_admin" on public.portal_config;
create policy "portal_config_write_admin" on public.portal_config
  for update to authenticated with check (true);

drop policy if exists "portal_config_insert_admin" on public.portal_config;
create policy "portal_config_insert_admin" on public.portal_config
  for insert to authenticated with check (true);

-- 2b) GRANTS — RLS se PEHLE table ka privilege aata hai. Ye na ho to PostgREST 403
--     deta hai aur browser me error "RLS ne roka" jaisa dikhta hai (do baar ho chuka hai).
grant usage on schema public to anon, authenticated, service_role;
grant select                 on table public.portal_config to anon;
grant select, insert, update on table public.portal_config to authenticated;
grant select                 on table public.portal_hits  to authenticated;
alter table public.portal_config add column if not exists updated_by text;

-- 3) Click counter (kaun sa button kitna click hua) -----------------------
create table if not exists public.portal_hits (
  key      text primary key,
  hits     bigint       not null default 0,
  last_at  timestamptz  not null default now()
);
alter table public.portal_hits enable row level security;

drop policy if exists "portal_hits_read_admin" on public.portal_hits;
create policy "portal_hits_read_admin" on public.portal_hits
  for select to authenticated using (true);

create or replace function public.record_hit(p_key text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_key is null or length(p_key) > 60 then return; end if;
  insert into portal_hits (key, hits, last_at) values (p_key, 1, now())
    on conflict (key) do update set hits = portal_hits.hits + 1, last_at = now();
end $$;

create or replace function public.reset_hits() returns void
language plpgsql security definer set search_path = public as $$
begin delete from portal_hits; end $$;

grant execute on function public.record_hit(text)  to anon, authenticated;
grant execute on function public.reset_hits()      to authenticated;
revoke execute on function public.reset_hits()      from anon;

-- 4) Seed row: aapka 7-section portal (branding + Support = Musahid 9177785011)
insert into public.portal_config (id, data)
values (1, $seed${"version":1,"updatedAt":"2026-08-27T05:11:23.192Z","brand":{"title":"SAFETY PORTAL","tagline":"","leftName":"Envess Infraventure Pvt Ltd","rightName":"TATA STEEL LTD.","logoIcon":"shield","rightIcon":"tata","theme":"navy"},"support":{"enabled":true,"heading":"SUPPORT","line1":"Contact for any technical issue","name":"Musahid","mobile":"9177785011","altMobile":"","email":"","developer":"Musahid","note":"Portal me koi bhi problem ho, ya naya section / link add karana ho — isi number par baat kariye."},"sections":[{"id":"sec-e23fcd6378","n":1,"title":"IMPORTANT LINKS","icon":"link","color":"indigo","type":"list","url":"","visible":true,"prefix":"letters","note":"","search":null,"items":[{"id":"itm-a0caae88fc","label":"Safety Policy & Manual","url":"","icon":"book","openIn":"new","note":"","visible":true,"children":[]}]},{"id":"sec-84c2f90596","n":2,"title":"COMMAND CENTRE","icon":"monitor","color":"green","type":"list","url":"","visible":true,"prefix":"letters","note":"","search":null,"items":[{"id":"itm-40b6819db9","label":"Real-time Dashboard","url":"","icon":"chart","openIn":"new","note":"","visible":true,"children":[]},{"id":"itm-b483a51c96","label":"Command Centre Violation Entry","url":"","icon":"clipboard","openIn":"new","note":"","visible":true,"children":[]}]},{"id":"sec-3def58060f","n":3,"title":"GLOBAL SAFETY OBSERVATION SYSTEM","icon":"eye","color":"blue","type":"list","url":"","visible":true,"prefix":"letters","note":"","search":null,"items":[{"id":"itm-1660672ea8","label":"Violation Entry","url":"","icon":"cone","openIn":"new","note":"","visible":true,"children":[]},{"id":"itm-d9959083f8","label":"Review and Monitoring System","url":"","icon":"search","openIn":"new","note":"","visible":true,"children":[]}]},{"id":"sec-e660e93e45","n":4,"title":"SAFETY MNGT SYSTEM","icon":"helmet","color":"orange","type":"list","url":"","visible":true,"prefix":"letters","note":"","search":null,"items":[{"id":"itm-78ff81d732","label":"Conduct DM","url":"","icon":"gavel","openIn":"new","note":"","visible":true,"children":[]},{"id":"itm-268ff59460","label":"VSPI","url":"","icon":"board","openIn":"new","note":"","visible":true,"children":[]},{"id":"itm-5ea695943a","label":"PPE MNGT System","url":"","icon":"goggles","openIn":"new","note":"","visible":true,"children":[]}]},{"id":"sec-23b36f3f11","n":5,"title":"EMPLOYEE SEARCH","icon":"user-search","color":"purple","type":"search","url":"","visible":true,"prefix":"none","note":"","search":{"placeholder":"Search Employee ID / Name...","urlTemplate":"","buttonLabel":"SEARCH","icon":"search","help":"Employee ID ya naam daaliye, phir ENTER."},"items":[]},{"id":"sec-f2e6e1ef82","n":6,"title":"INCIDENT SHARING AND LEARNING","icon":"alert","color":"red","type":"list","url":"","visible":true,"prefix":"letters","note":"","search":null,"items":[{"id":"itm-807239f178","label":"NEAR MISS INTERNAL","url":"","icon":"impact","openIn":"new","note":"","visible":true,"children":[]},{"id":"itm-507fbc5167","label":"LTI / FATAL and other TSL OR NON TSI Incident","url":"","icon":"report","openIn":"new","note":"","visible":true,"children":[]}]},{"id":"sec-ae8ffd46bf","n":7,"title":"SOP","icon":"book-open","color":"teal","type":"grid","url":"","visible":true,"prefix":"letters","note":"","search":null,"items":[{"id":"itm-e4518a1cd3","label":"TRANSPORT PARK","url":"","icon":"truck","openIn":"new","note":"","visible":true,"children":[]},{"id":"itm-18972ef5aa","label":"Weigh Bridge","url":"","icon":"scale","openIn":"new","note":"","visible":true,"children":[]},{"id":"itm-7dff319bf3","label":"All Weigh bridge","url":"","icon":"scale","openIn":"new","note":"","visible":true,"children":[]},{"id":"itm-e4faa2f79d","label":"All equipment","url":"","icon":"gear","openIn":"new","note":"","visible":true,"children":[]},{"id":"itm-05787f6758","label":"scrap yard","url":"","icon":"recycle","openIn":"new","note":"","visible":true,"children":[]}]}]}$seed$::jsonb)
on conflict (id) do nothing;

-- 4b) OPTIONAL: agar aap chahte hain ki portal bhi sirf logged-in users padhein
--     (company-internal links ko public se bachane ke liye) -> niche wali 2 line uncomment kariye,
--     aur "portal_config_read_all" policy ko drop kar dijiye.
-- drop policy if exists "portal_config_read_all" on public.portal_config;
-- create policy "portal_config_read_login_only" on public.portal_config
--   for select to authenticated using (true);

-- 4c) Sirf EK admin user hi likhe (zyada tight) — EMAIL se kariye, UUID copy karne me
--     galti hoti hai (placeholder 'aaaa-bbbb-...' chhoot gaya to SAB write 403 hote hain):
-- drop policy if exists "portal_config_write_admin" on public.portal_config;
-- create policy "portal_config_write_admin" on public.portal_config
--   for update to authenticated
--   using (auth.uid() = (select id from auth.users where email = 'aapka@email.com'))
--   with check (auth.uid() = (select id from auth.users where email = 'aapka@email.com'));
-- drop policy if exists "portal_config_insert_admin" on public.portal_config;
-- create policy "portal_config_insert_admin" on public.portal_config
--   for insert to authenticated
--   with check (auth.uid() = (select id from auth.users where email = 'aapka@email.com'));

-- 4d) Admin panel → Cloud → "Session check" ke liye (role/policy/grants ek call me):
create or replace function public.sp_whoami() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_claims jsonb := null; v_jwt_role text; v_uid uuid; v_email text; v_confirmed boolean;
  v_policies jsonb; v_rls boolean;
begin
  begin v_claims := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
  exception when others then v_claims := null; end;
  v_jwt_role := coalesce(v_claims->>'role', 'anon');
  if v_jwt_role = 'anon' then
    return jsonb_build_object('jwt_role','anon','uid',null,
      'note','Request me session JWT nahi tha -> role = anon -> portal_config par RLS write rok dega. Admin panel me login kariye.');
  end if;
  begin v_uid := auth.uid(); exception when others then v_uid := null; end;
  if v_uid is not null then
    begin select u.email, (u.email_confirmed_at is not null) into v_email, v_confirmed from auth.users u where u.id = v_uid;
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
  return jsonb_build_object('jwt_role', v_jwt_role, 'uid', v_uid, 'email', v_email,
    'email_confirmed', v_confirmed, 'rls_enabled', v_rls, 'policies', v_policies,
    'grants', jsonb_build_object(
      'insert', has_table_privilege('authenticated', 'public.portal_config', 'insert'),
      'update', has_table_privilege('authenticated', 'public.portal_config', 'update'),
      'select_anon', has_table_privilege('anon', 'public.portal_config', 'select')));
end $$;
revoke execute on function public.sp_whoami() from public;
grant execute on function public.sp_whoami() to anon, authenticated;

-- 5) (optional) Realtime — ek dusre browser me publish turant dikhe
do $$ begin
  alter publication supabase_realtime add table public.portal_config;
exception when duplicate_object then null; when undefined_table then null; end $$;

-- ---------------------------------------------------------------------
-- Check karne ke liye (chalakar dekhiye):
select id, updated_at, (select count(*) from jsonb_array_elements(data->'sections')) as sections
  from public.portal_config where id = 1;
-- Expected: sections = 7

-- Kya-kya bana, check:
select table_name from information_schema.tables where table_schema='public' and table_name in ('portal_config','portal_hits');
select polname, polcmd::text from pg_policy where polrelid = 'public.portal_config'::regclass;
-- Expected: portal_config_read_all (r), portal_config_write_admin (w), portal_config_insert_admin (a)
-- Grants bhi zaroori hain (na mile to 403 "RLS" jaisa hi dikhta hai):
select grantee, privilege_type from information_schema.role_table_grants
 where table_schema='public' and table_name='portal_config' order by 1,2;
-- Expected: anon|select, authenticated|select, authenticated|insert, authenticated|update

-- ⚠ Save 403 kare to: (1) Admin → Cloud → Session check (kaunsa role ja raha hai),
--    (2) supabase-rls-fix.sql RUN kariye. Policy me "admin role" jaisa koi check nahi —
--    jo bhi logged-in Supabase user likh sakta hai; anon (bina login) nahi.


-- =====================================================================
--  (B) SITE HOSTING — Supabase Storage ka public 'portal' bucket
--  ⚠ Neeche wali 3 "deploy" policies temporary hain; files upload hone ke
--    BAAD supabase-lockdown.sql chalaiye.
-- =====================================================================
-- 1) bucket (public) — pehle se ho to sirf public=true kar dega
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('portal', 'portal', true, 5242880, null)
on conflict (id) do update set public = true;

-- 2) sab padh sakein (site public hai hi)
drop policy if exists "portal_read" on storage.objects;
create policy "portal_read" on storage.objects
  for select to anon, authenticated using (bucket_id = 'portal');

-- 3) DEPLOY ke liye (temporary) — upload/overwrite/delete, sirf 'portal' bucket me
drop policy if exists "portal_deploy_insert" on storage.objects;
create policy "portal_deploy_insert" on storage.objects
  for insert to anon, authenticated with check (bucket_id = 'portal');

drop policy if exists "portal_deploy_update" on storage.objects;
create policy "portal_deploy_update" on storage.objects
  for update to anon, authenticated using (bucket_id = 'portal') with check (bucket_id = 'portal');

drop policy if exists "portal_deploy_delete" on storage.objects;
create policy "portal_deploy_delete" on storage.objects
  for delete to anon, authenticated using (bucket_id = 'portal');

-- 4) check
select id, name, public from storage.buckets where id = 'portal';

-- Site link isi ke baad:
--   https://qeuxfyklxtrpvwrszqsr.supabase.co/storage/v1/object/public/portal/index.html
-- (aap dashboard se khud bhi upload kar sakte hain: Storage → portal → Upload files,
--  folder structure: index.html, config.js, default-config.json, css/styles.css, js/*.js)


select id, public from storage.buckets where id = 'portal';
