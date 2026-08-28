'use strict';
/* =============================================================================
   deploy-to-supabase.js — public/ folder ki files Supabase Storage ke
   'portal' bucket me upload kar deta hai → site global URL par aa jati hai.
   (koi npm package nahi chahiye, sirf Node)

   Use:  node dev/deploy-to-supabase.js
         SUPABASE_URL=https://xxx.supabase.co SUPABASE_KEY=sb_publishable_xxx node dev/deploy-to-supabase.js
         BASE=https://xxx/storage/v1/object/public/portal/index.html   (jo link milega)

   Pehle supabase-all.sql chalana zaroori hai (usme 'portal' bucket + temporary upload
   policy hai); files upload hone ke BAAD supabase-lockdown.sql chalaiye.
   ============================================================================= */
const fs = require('fs');
const path = require('path');

const PUB = process.env.SRC || path.join(__dirname, '..');
const cfgSrc = fs.readFileSync(path.join(__dirname, '..', 'config.js'), 'utf8');
const grab = (k) => { const m = cfgSrc.match(new RegExp(k + ":\\s*'([^']*)'")); return m ? m[1] : ''; };
const URL_ = process.env.SUPABASE_URL || grab('supabaseUrl');
const KEY = process.env.SUPABASE_KEY || grab('supabaseAnonKey');
const BUCKET = process.env.BUCKET || 'portal';
const PREFIX = process.env.PREFIX || '';            // '' = bucket ke root par (link: .../public/portal/index.html)
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

function walk(dir, base) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(d => {
    const f = path.join(dir, d.name), rel = (base ? base + '/' : '') + d.name;
    return d.isDirectory() ? walk(f, rel) : [{ abs: f, rel }];
  });
}

(async () => {
  if (!URL_ || !KEY) { console.log('SUPABASE_URL / SUPABASE_KEY nahi mila (config.js bhar dijiye).'); process.exit(1); }
  const SKIP = /(^|\/)(dev|node_modules|data|shots|test)\//;
  const ALLOW = /\.(html|css|js|json|svg|png|ico)$/;
  const files = walk(PUB, '').filter(f => ALLOW.test(f.rel) && !SKIP.test(f.rel) && f.rel !== 'safety-portal-cloud.html');
  if (PREFIX) files.unshift({ abs: null, rel: null });   // placeholder
  console.log('\n  Bucket : ' + BUCKET + (PREFIX ? ' / ' + PREFIX : '') + '\n  Server : ' + URL_ + '\n  Files  : ' + files.filter(f => f.rel).length + '\n');

  let ok = 0, bad = 0;
  for (const f of files) {
    if (!f.rel) continue;
    const key = (PREFIX ? PREFIX + '/' : '') + f.rel;
    const body = fs.readFileSync(f.abs);
    const r = await fetch(`${URL_}/storage/v1/object/${BUCKET}/${key}`, {
      method: 'POST',
      headers: { apikey: KEY, Authorization: 'Bearer ' + KEY, 'content-type': MIME[path.extname(f.rel)] || 'application/octet-stream', 'x-upsert': 'true', 'content-length': String(body.length) },
      body
    });
    const txt = await r.text();
    const good = r.status < 300 && !/"(error|statusCode)"/i.test(txt.slice(0, 400));
    console.log((good ? '  ✓ ' : '  ✗ ') + key.padEnd(28) + r.status + (good ? '' : '  ' + txt.slice(0, 160)));
    good ? ok++ : bad++;
  }

  const siteUrl = `${URL_}/storage/v1/object/public/${BUCKET}/${PREFIX ? PREFIX + '/' : ''}index.html`;
  if (bad === 0) {
    const chk = await fetch(siteUrl, { headers: { 'Cache-Control': 'no-store' } });
    const html = await chk.text();
    const renders = /<div class="grid" id="grid">/.test(html) && /js\/app\.js/.test(html);
    console.log('\n  Site check : HTTP ' + chk.status + (renders ? ' ✓ portal HTML + assets ke references mile' : ' ⚠ HTML expected se alag lag raha'));
    console.log('  Config row : ' + (await (await fetch(`${URL_}/rest/v1/portal_config?select=updated_at&id=eq.1`, { headers: { apikey: KEY, Authorization: 'Bearer ' + KEY } })).text()).slice(0, 120));
    console.log('\n  🌍 GLOBAL LINK : ' + siteUrl + '\n');
    console.log('  Ab supabase-lockdown.sql chalaiye (upload policy band karne ke liye).\n');
  } else {
    console.log('\n  ✗ ' + bad + ' file upload nahi hui. Zyadatar 2 karan:');
    console.log('    1) supabase-hosting.sql nahi chala (bucket/upload policy nahi) → SQL Editor me chalaiye, phir dobara.');
    console.log('    2) supabase-lockdown.sql pehle hi chal gaya (policy band) → hosting SQL dobara chalaiye, deploy kijiye, phir lockdown.');
    console.log('    Ya simply khud: Dashboard → Storage → ' + BUCKET + (PREFIX ? ' → ' + PREFIX : '') + ' → Upload files (public/ ke andar wali).');
    console.log('\n  Fir link: ' + siteUrl + '\n');
    process.exit(1);
  }
})().catch(e => { console.error('fail:', e.message); process.exit(1); });
