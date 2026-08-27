# Safety Portal — Envess Infraventure × Tata Steel

**Ek hi page, pura portal admin panel se manage hota hai** — naya section, naya button, uska URL —
code chhede bina. Data + login **Supabase** me rehta hai, isliye site kahin bhi (GitHub Pages / Netlify /
Supabase Storage) host karo, aur **Admin → Save & Publish** karte hi badlav **sab users** ko dikh jata hai.

```
index.html              ← site (GitHub Pages root)
config.js               ← Supabase Project URL + anon/publishable key  (yahi 1 file configure karni hai)
default-config.json     ← fallback: cloud par abhi koi config na ho to ye 7-section portal dikhega
css/styles.css
js/icons.js, js/app.js, js/admin.js
supabase-all.sql         ← ek baar Supabase SQL Editor me RUN (table + RLS + grants + click counter + bucket + seed)
supabase-rls-fix.sql     ← "Save nahi hua (RLS/403)" aaye to ye RUN kariye (grants + policy + sp_whoami)
supabase-lockdown.sql    ← files upload ke baad run (public upload policy band kare)
safety-portal-cloud.html ← (optional) same portal, ek hi file me — aapke Supabase se wired
dev/server.js            ← (optional) local preview + data/config.json store; Pages par iski zarurat nahi
dev/deploy-to-supabase.js← (optional) site files ko Supabase Storage 'portal' bucket me upload karta hai
dev/build-single.js      ← (optional) index.html + css/ + js/ se safety-portal-cloud.html dobara banata hai
```

## 1. Pehla din (5 minute)
1. **Supabase** → SQL Editor → New query → `supabase-all.sql` ka pura content → **RUN**
   (ban jayega: `portal_config` 1-row table + RLS + `portal_hits`/`record_hit()` + public `portal` bucket + aapka 7-section seed)
2. **Supabase** → Authentication → Users → **Add user** (email + password) → **yahi aapka admin login hai**
   Providers → Email → **Confirm email OFF** (warna pehla login atak jayega)
3. `config.js` me apni values (repo me aapke project ki values daal di gayi hain):
   ```js
   window.SP_BACKEND = {
     mode: 'auto',                                   // cloud mile to Supabase, na mile to local dev server
     supabaseUrl: 'https://<aapka-ref>.supabase.co',
     supabaseAnonKey: '<anon ya sb_publishable_...>',
     pollSeconds: 20
   };
   ```
4. **GitHub Pages chalu**: is repo me ye files commit kariye → Settings → Pages → Source: **Deploy from a branch** → `main` / **`/(root)`** → Save.
   Site 1-2 minute me: `https://musahid33.github.io/safety-portal-webbapp/`

## 2. Roz ka kaam (admin)
- Page par **Admin** (ya footer ka *Admin login*) → Supabase email + password
- **Links & Sections** → `+ Naya section` / `+ Button` → label + **URL** → **Save & Publish**
- Jis button me URL hoga wahi **LIVE**; khali URL = `NOT LIVE` (click par “abhi configured nahi” msg)
- **Cloud / Supabase** tab → *Connection check* (health + row + token), *Abhi ka config cloud par publish*
- **Usage** tab → kaun sa button kitni baar click hua · **Backup** tab → JSON export/import, Excel rows bulk import
- **Security** tab → password (Supabase mode me Supabase user ka password yahin se change hota hai)
- Kisi aur admin ne publish kiya ho → page ~20 second me khud update (publish karne wale ko 1 sec)

## 3. Security (2 baat zaroor)
- `supabase-lockdown.sql` chalana mat bhooliye — `supabase-all.sql` bucket me **temporary public upload** policy deta hai
  (taaki files deploy ho saken). Use band na kiye to koi bhi aapki site files badal sakta hai. **Portal ke config/data par iska asar nahi** — wo RLS se surakshit hai.
- `config.js` me **anon/publishable** key hi daaliye (wo public hone ke liye hi hai). **`service_role` key kabhi na** — repo public hai.
- Write access = sirf logged-in Supabase user (RLS `to authenticated`). Site visitors padh sakte hain, badal nahi.

## 3b. “Save nahi hua: Supabase ne likhne se roka (RLS policy)” — poora hal

Ye error **do alag cheezon** se aata hai, aur app ab dono ko alag-alag naam se bolta hai:

| Message ka shuru | Asli matlab | Kaam |
|---|---|---|
| “Aap is browser me logged-in nahi ho / session expire ho gaya” | request bina JWT ke gayi → PostgREST ne use `anon` samjha → `portal_config_write_admin` (`to authenticated`) ne rok diya | Admin → **Login** (Supabase user se). Panel ab session zinda hai to dobara password nahi maangta, aur 1 ghante baad bhi JWT khud refresh kar leta hai |
| “RLS ne rok diya, halanki aap logged-in ho” | aap session ke saath ho — tab `GRANT` missing hai, ya policy drop/replace ho gayi hai | SQL Editor → **`supabase-rls-fix.sql`** RUN kariye → phir Save |

Do baatein clear kar dein:

1. **Is portal me “admin role” jaisi koi cheez nahi hai.** Policy sirf kehti hai *logged-in Supabase user*
   (`authenticated`) likh sakta hai. Dashboard → Authentication → Users me user ka koi “admin” flag
   on karna zaroori **nahi** — user ka hona + login kaafi hai.
2. **`service_role` key ki zarurat bilkul nahi** save karne ke liye — wo key browser me jaana hi nahi chahiye
   (repo public hai). Save hamesha aapke logged-in JWT se hota hai.

**2 minute ka check (Admin → Cloud tab):**
- **Session check** dabaiye → `DB role` (authenticated?), token ki bachat, `Update policy`, `GRANT (authenticated)` —
  jo line `off` dikhe wahi kaam hai. `sp_whoami()` na mila (note) → `supabase-all.sql` ya `supabase-rls-fix.sql` ek baar RUN kariye.
- **Login / re-login** → **Save & Publish**.
- Fix se bachne ke liye `supabase-rls-fix.sql` ke neeche diye diagnostics bhi chala sakte hain
  (policies, grants, `auth.users` me email confirmed hai ya nahi).

**Aksar hone wale 3 karan:**
- **Email confirm ON chhoot gaya** → GoTrue login par session hi nahi deta → app `anon` ban jaata hai.
  Supabase → Authentication → Providers → Email → **Confirm email OFF** (ya user par “Mark email as confirmed”).
  *(Ab app ye haalat me saaf message dikhata hai, RLS ka bhramjak error nahi.)*
- **Table par `GRANT` nahi** (doosre role/project se bani table) → 403 “permission denied”, jo RLS jaisa dikhta hai.
  `supabase-all.sql` me ab grants explicitly hain; purane project ke liye `supabase-rls-fix.sql` chala dein.
- **Koi sakht policy lag gayi** — jaise `portal_config_write_one` me placeholder UUID `aaaaaaaa-bbbb-...`
  (ab repo me wo option email-based hai, copy-paste-galti nahi hoti).

Terminal se test karna ho to (anon ko write 403 milna **chahiye**):
```bash
K=$(grep -o "sb_publishable_[A-Za-z0-9_-]*" config.js | head -1)
U=$(grep -o "https://[a-z0-9]*.supabase.co" config.js | head -1)
curl -s -o /dev/null -w "anon write -> HTTP %{http_code} (403 = surakshit)\n" \
  -X POST "$U/rest/v1/portal_config?on_conflict=id" -H "apikey: $K" -H "Authorization: Bearer $K" \
  -H "Content-Type: application/json" -H "Prefer: resolution=merge-duplicates" -d '{"id":1,"data":{}}'
```

## 4. Local par chalana (optional)
```bash
node dev/server.js          # http://localhost:3000  (data/config.json store, admin password: admin@123)
node dev/build-single.js    # safety-portal-cloud.html dobara banao (js/ ya css/ me badlav ke baad)
```
`mode:'auto'` ki wajah se local dev server milte hi wahi use hota hai; static host (Pages) par apne aap Supabase.

## 5. Test / build (repo ke andar, koi npm install nahi)
```bash
node dev/test-rls.js        # 21 checks: session expire, RLS 403, GRANT missing, upsert, whoami…
node dev/build-single.js    # safety-portal-cloud.html dobara banao (js/ ya css/ badla ho to)
node dev/build-single.js --check   # CI: single-file build sources se in-sync hai ya nahi
```
`dev/test-rls.js` `js/app.js` ko ek chhote DOM stub me load karke **nakli Supabase**
(GoTrue + PostgREST + RLS rules) ke against asli save flow chalata hai — koi `npm install`,
koi network, koi credential nahi chahiye. CI me daalna ho to `.github/workflows/checks.yml`:

```yaml
name: Checks
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: node dev/test-rls.js
      - run: node dev/build-single.js --check
```

## 6. Custom domain (agar chahiye)
Supabase Storage se serve karna ho: `node dev/deploy-to-supabase.js` → link
`https://<ref>.supabase.co/storage/v1/object/public/portal/index.html`
Pages par `safety.envess.co.in` jaisa domain lagane ke liye repo me `CNAME` file banaiye + DNS me CNAME.
