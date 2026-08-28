'use strict';
/* deploy-to-supabase.js — upload the public site files to the Supabase
   Storage bucket. The bucket is public-read, but deployment is admin-only.

   Use:
     SUPABASE_ADMIN_JWT=<logged-in admin access token> node dev/deploy-to-supabase.js
     SUPABASE_URL=https://xxx.supabase.co SUPABASE_KEY=sb_publishable_xxx \
       SUPABASE_ADMIN_JWT=<jwt> node dev/deploy-to-supabase.js

   SUPABASE_KEY is only the public anon/publishable key. Never put a service_role
   key in config.js or commit an admin JWT. The JWT is read from the environment
   for this one deployment and is not written to the repository.
*/
const fs = require('fs');
const path = require('path');

const PUB = process.env.SRC || path.join(__dirname, '..');
const cfgSrc = fs.readFileSync(path.join(__dirname, '..', 'config.js'), 'utf8');
const grab = key => { const m = cfgSrc.match(new RegExp(key + ":\\s*'([^']*)'")); return m ? m[1] : ''; };
const URL_ = process.env.SUPABASE_URL || grab('supabaseUrl');
const KEY = process.env.SUPABASE_KEY || grab('supabaseAnonKey');
const ADMIN_JWT = process.env.SUPABASE_ADMIN_JWT || process.env.SUPABASE_ACCESS_TOKEN || '';
const BUCKET = process.env.BUCKET || 'portal';
const PREFIX = process.env.PREFIX || '';
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon'
};

function walk(dir, base) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(dir, entry.name);
    const rel = (base ? base + '/' : '') + entry.name;
    return entry.isDirectory() ? walk(file, rel) : [{ abs: file, rel }];
  });
}
function authHeaders(extra) {
  return Object.assign({ apikey: KEY, Authorization: 'Bearer ' + ADMIN_JWT }, extra || {});
}
function fail(message) { console.error('\n  ✗ ' + message + '\n'); process.exit(1); }

(async () => {
  if (!URL_ || !KEY) fail('SUPABASE_URL / SUPABASE_KEY nahi mila (config.js bhar dijiye).');
  if (!ADMIN_JWT) fail('SUPABASE_ADMIN_JWT nahi mila. Supabase me logged-in admin ka access token environment me dijiye.');
  if (ADMIN_JWT === KEY || /^(?:sb_(?:publishable|secret|anon)|service_role)/i.test(ADMIN_JWT)) {
    fail('SUPABASE_ADMIN_JWT me anon/publishable/service_role key nahi — logged-in admin ka JWT chahiye.');
  }

  const SKIP = /(^|\/)(dev|node_modules|data|shots|test)\//;
  const ALLOW = /\.(html|css|js|json|svg|png|ico)$/i;
  const files = walk(PUB, '').filter(file => ALLOW.test(file.rel) && !SKIP.test(file.rel) && file.rel !== 'safety-portal-cloud.html');
  console.log('\n  Bucket : ' + BUCKET + (PREFIX ? ' / ' + PREFIX : ''));
  console.log('  Server : ' + URL_);
  console.log('  Files  : ' + files.length + '\n');

  let ok = 0; let bad = 0;
  for (const file of files) {
    const key = (PREFIX ? PREFIX + '/' : '') + file.rel;
    const data = fs.readFileSync(file.abs);
    const response = await fetch(`${URL_}/storage/v1/object/${BUCKET}/${key}`, {
      method: 'POST',
      headers: authHeaders({
        'content-type': MIME[path.extname(file.rel).toLowerCase()] || 'application/octet-stream',
        'x-upsert': 'true', 'content-length': String(data.length)
      }),
      body: data
    });
    const text = await response.text();
    const good = response.status < 300 && !/"(?:error|statusCode)"/i.test(text.slice(0, 400));
    console.log((good ? '  ✓ ' : '  ✗ ') + key.padEnd(32) + response.status + (good ? '' : '  ' + text.slice(0, 160)));
    if (good) ok++; else bad++;
  }

  const siteUrl = `${URL_}/storage/v1/object/public/${BUCKET}/${PREFIX ? PREFIX + '/' : ''}index.html`;
  if (bad === 0) {
    const check = await fetch(siteUrl, { headers: { 'Cache-Control': 'no-store' } });
    const html = await check.text();
    const renders = /<div class="grid" id="grid">/.test(html) && /js\/app\.js/.test(html);
    console.log('\n  Site check : HTTP ' + check.status + (renders ? ' ✓ portal HTML + asset references mile' : ' ⚠ HTML expected se alag lag raha'));
    const row = await fetch(`${URL_}/rest/v1/portal_config?select=updated_at&id=eq.1`, { headers: authHeaders() });
    console.log('  Config row : ' + (await row.text()).slice(0, 120));
    console.log('\n  🌍 GLOBAL LINK : ' + siteUrl + '\n');
  } else {
    console.log('\n  ✗ ' + bad + ' file upload nahi hui. Check kariye:');
    console.log('    1) Supabase SQL me supabase-all.sql ya supabase-rls-fix.sql run hua ho.');
    console.log('    2) Admin JWT wale user ke App Metadata me {"role":"admin"} ho.');
    console.log('    3) JWT expire/revoke na hua ho — zarurat par naya token dijiye.');
    console.log('\n  Fir link: ' + siteUrl + '\n');
    process.exit(1);
  }
})().catch(error => fail(error.message));
