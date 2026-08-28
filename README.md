# Safety Portal — Envess Infraventure × Tata Steel

**Ek hi page, pura portal admin panel se manage hota hai** — naya section, naya button, uska URL —
code chhede bina. Data + login **Supabase** me rehta hai, isliye site kahin bhi (GitHub Pages / Netlify /
Supabase Storage) host karo, aur **Admin → Save & Publish** karte hi badlav **sab users** ko dikh jata hai.

```
index.html                 ← site (GitHub Pages root)
config.js                  ← Supabase URL + anon/publishable key (public by design)
default-config.json        ← fallback: cloud row na mile to 7-section portal
css/styles.css
js/icons.js, js/app.js, js/admin.js
supabase-all.sql           ← tables, admin-only RLS, RPCs, public-read Storage bucket
supabase-rls-fix.sql       ← existing project ko admin-only policy/grant repair
supabase-lockdown.sql      ← optional: Storage deploy policies hata kar read-only mode
safety-portal-cloud.html   ← optional single-file build with the same admin checks
dev/server.js              ← optional local preview + hashed-password API
dev/deploy-to-supabase.js ← admin JWT se Storage deployment
dev/build-single.js        ← index.html + config + css + js ko single HTML banata hai
```

## 1. Pehla din (5 minute)

1. **Supabase** → SQL Editor → New query → `supabase-all.sql` ka poora content → **RUN**.
   Isse `portal_config`, `portal_hits`, admin-only RLS/RPC checks, aur public-read `portal` bucket banta hai.
2. **Authentication → Users → Add user** (email + password). User ke **App Metadata** me ye set kariye:
   `{"role":"admin"}`. Sirf isi claim wale users config, stats, password aur Storage deployment manage kar sakte hain.
3. Providers → Email me **Confirm email** ko apne deployment ke hisaab se configure kariye. Agar confirmation
   on hai to user ko confirm karke login karna hoga.
4. `config.js` me apni public values daaliye:
   ```js
   window.SP_BACKEND = {
     mode: 'auto',
     supabaseUrl: 'https://<aapka-ref>.supabase.co',
     supabaseAnonKey: '<anon ya sb_publishable_...>',
     pollSeconds: 20
   };
   ```
   **`service_role` key kabhi browser ya repository me na daaliye.**
5. GitHub Pages: Settings → Pages → Source: **Deploy from a branch** → `main` / **`/(root)`**.

Agar existing Supabase project pehle ke permissive SQL se bana hai, `supabase-rls-fix.sql` ek baar run karke
policies/RPCs/grants repair kariye. Admin user ka App Metadata update karne ke baad sign out/in kariye, taaki naya JWT mile.

## 2. Roz ka admin kaam

- Page par **Admin** → Supabase email + password.
- **Links & Sections** → section/button/URL edit kariye → **Save & Publish**.
- **Cloud / Supabase** → connection and session checks.
- **Usage** → click counts; **Backup** → JSON export/import.
- **Security** → logged-in Supabase admin ka password badliye.
- Kisi aur admin ne publish kiya ho to page polling ke baad automatically update hota hai.

## 3. Security model

- Browser me anon/publishable key hona normal hai; wo admin credential nahi hai.
- Admin API flow valid, fresh Supabase JWT ko `/auth/v1/user` se verify karta hai aur `app_metadata.role = admin`
  check karta hai. Expired JWT ko refresh token se refresh kiya jata hai; revoked session clear hota hai.
- Database RLS final authority hai: `portal_config` writes, usage reads, `reset_hits()` aur Storage deploy
  operations admin claim ke bina fail hote hain. UI me button hide hona security boundary nahi hai.
- `record_hit()` public hai taaki portal clicks count kar sake; arbitrary admin data read/write nahi milta.
- Storage site public-read hai, lekin upload/update/delete **admin JWT-only** hai. Deployment ke liye:
  ```bash
  SUPABASE_ADMIN_JWT='<logged-in admin access token>' \
    node dev/deploy-to-supabase.js
  ```
  `SUPABASE_ACCESS_TOKEN` bhi accepted alias hai. `SUPABASE_KEY` sirf anon/publishable key hai; use bearer token
  ki jagah mat dijiye. Deploy ke baad immutable site chahiye to `supabase-lockdown.sql` run kariye.
- `config.js` me localStorage backend override ek browser-local troubleshooting feature hai; ise production
  configuration ka substitute na samjhein.

## 3b. “Save nahi hua” / RLS troubleshooting

| Message ka shuru | Asli matlab | Kaam |
|---|---|---|
| “logged-in nahi / session expire” | request me valid JWT nahi gaya | Admin → **Login / re-login**; app token refresh bhi try karta hai |
| “admin permission nahi hai” | user authenticated hai par App Metadata claim nahi | Dashboard → Authentication → Users → App Metadata me `{"role":"admin"}`, phir sign out/in |
| “GRANT missing” ya policy error | existing project ka SQL/policy setup purana hai | SQL Editor me **`supabase-rls-fix.sql`** run karke phir Save kariye |
| Storage upload 401/403 | deploy command me admin JWT nahi, expired JWT, ya role missing | `SUPABASE_ADMIN_JWT` fresh dijiye aur admin claim check kariye |

**Admin → Cloud → Session check** se JWT role, admin claim, policies aur grants dekhiye. `sp_whoami()` sirf
admin ko detailed diagnostics deta hai; anonymous/non-admin callers ko sensitive user/policy detail nahi milti.

Anon ko config write par 403 milna expected hai:

```bash
K=$(grep -o "sb_publishable_[A-Za-z0-9_-]*" config.js | head -1)
U=$(grep -o "https://[a-z0-9.-]*.supabase.co" config.js | head -1)
curl -s -o /dev/null -w "anon write -> HTTP %{http_code} (403 = surakshit)\n" \
  -X POST "$U/rest/v1/portal_config?on_conflict=id" \
  -H "apikey: $K" -H "Authorization: Bearer $K" \
  -H "Content-Type: application/json" -H "Prefer: resolution=merge-duplicates" \
  -d '{"id":1,"data":{}}'
```

## 4. Local par chalana (optional)

Local Node server me password environment se set kariye; server known default credential se start nahi hota:

```bash
ADMIN_PASSWORD='a-long-local-password' node dev/server.js
```

Sirf throwaway local development ke liye insecure compatibility mode explicitly enable kiya ja sakta hai:

```bash
ALLOW_INSECURE_DEFAULT=1 node dev/server.js
```

Is mode me default `admin@123` hai; ise shared/production server par kabhi enable na karein. Login attempts
rate-limited hain, passwords scrypt-hashed form me `data/config.json` me rehte hain, aur server logs password
print nahi karte.

## 5. Test / build

```bash
npm run test:rls
node dev/build-single.js --check
node --check js/app.js
node --check js/admin.js
node --check dev/server.js
```

`dev/test-rls.js` zero-dependency mock Supabase/GoTrue/PostgREST ke against session expiry, refresh-token
revocation, admin authorization, RLS/GRANT failures, upsert, cross-project sessions aur public reads test karta hai.

## 6. Custom domain

Supabase Storage se serve karna ho:

```bash
SUPABASE_ADMIN_JWT='<logged-in admin access token>' node dev/deploy-to-supabase.js
```

Pages par `safety.envess.co.in` jaisa domain lagane ke liye repo me `CNAME` file banaiye + DNS me CNAME.
