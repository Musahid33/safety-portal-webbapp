-- SAFETY PORTAL — optional post-deploy Storage lockdown
--
-- supabase-all.sql now gives deploy permission only to authenticated users whose
-- App Metadata has role=admin. Run this after a deployment if the site files
-- should be immutable from the browser; future deploys can be done from the
-- Supabase Dashboard or by temporarily recreating the admin-only policies.
-- The public portal remains readable, and portal_config is unaffected.

drop policy if exists "portal_deploy_insert" on storage.objects;
drop policy if exists "portal_deploy_update" on storage.objects;
drop policy if exists "portal_deploy_delete" on storage.objects;

-- Only portal_read should remain for this bucket.
select polname from pg_policy
 where polrelid = 'storage.objects'::regclass and polname like 'portal%';
