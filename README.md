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
supabase-all.sql         ← ek baar Supabase SQL Editor me RUN (table + RLS + click counter + bucket + seed)
supabase-lockdown.sql    ← files upload ke baad run (public upload policy band kare)
safety-portal-cloud.html ← (optional) same portal, ek hi file me — aapke Supabase se wired
dev/server.js            ← (optional) local preview + data/config.json store; Pages par iski zarurat nahi
dev/deploy-to-supabase.js← (optional) site files ko Supabase Storage 'portal' bucket me upload karta hai
```

## 1. Pehla din (5 minute)
1. **Supabase** → SQL Editor → New query → `supabase-all.sql` ka pura content → **RUN**
   (ban jayega: `portal_config` 1-row table + RLS + `portal_hits`/`record_hit()` + public `portal` bucket + aapka 7-section seed)
2. **Supabase** → Authentication → Users → **Add user** (email + password). User ko select karke **App Metadata** me ye set kariye: `{"role":"admin"}`. Isi role wale authenticated users config likh sakte hain.
   Providers → Email → **Confirm email OFF** (warna pehla login atak jayega). Role badalne ke baad sign out karke dobara login kariye, taaki naya JWT mile.
3. Agar pehle SQL chala chuke hain, `supabase-rls-fix.sql` SQL Editor me run kariye. Ye `portal_config_write_admin` ko sahi `USING` + `WITH CHECK` clauses ke saath INSERT/UPDATE ke liye repair karta hai.
4. `config.js` me apni values (repo me aapke project ki values daal di gayi hain):
   ```js
   window.SP_BACKEND = {
     mode: 'auto',                                   // cloud mile to Supabase, na mile to local dev server
     supabaseUrl: 'https://<aapka-ref>.supabase.co',
     supabaseAnonKey: '<anon ya sb_publishable_...>',
     pollSeconds: 20
   };
   ```
5. **GitHub Pages chalu**: is repo me ye files commit kariye → Settings → Pages → Source: **Deploy from a branch** → `main` / **`/(root)`** → Save.
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

## 4. Local par chalana (optional)
```bash
node dev/server.js          # http://localhost:3000  (data/config.json store, admin password: admin@123)
```
`mode:'auto'` ki wajah se local dev server milte hi wahi use hota hai; static host (Pages) par apne aap Supabase.

## 5. Custom domain (agar chahiye)
Supabase Storage se serve karna ho: `node dev/deploy-to-supabase.js` → link
`https://<ref>.supabase.co/storage/v1/object/public/portal/index.html`
Pages par `safety.envess.co.in` jaisa domain lagane ke liye repo me `CNAME` file banaiye + DNS me CNAME.
