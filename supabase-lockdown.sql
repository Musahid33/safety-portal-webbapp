-- =====================================================================
--  SAFETY PORTAL — Step 3 (ZAROORI): deploy ke baad site ko lock karo
--  supabase-hosting.sql ne anon ko upload/delete karne diya tha (deploy ke
--  liye). Wo khatra hatane ke liye ye file chalaiye — upload complete hone ke BAAD.
--  Supabase Dashboard → SQL Editor → RUN
--
--  ⚠ Ise chalane ke baad SITE FILES (index.html/js/css) badalne ke liye
--     Dashboard → Storage → portal → Upload karna hoga (ya policy dobara on kariye).
--     Portal ka CONFIG (section / button / URL) isse bilkul nahi badalta —
--     wo hamesha Admin panel se hi change hoga, aur sab users ko dikhega.
-- =====================================================================

drop policy if exists "portal_deploy_insert" on storage.objects;
drop policy if exists "portal_deploy_update" on storage.objects;
drop policy if exists "portal_deploy_delete" on storage.objects;

-- bacha hua check: sirf "portal_read" dikhna chahiye
select polname from pg_policy
 where polrelid = 'storage.objects'::regclass and polname like 'portal%';
