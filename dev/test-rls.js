'use strict';
/* =============================================================================
   test-rls.js — "Save nahi hua: Supabase ne RLS se roka (403)" fix ka regression
   test. Koi npm dependency nahi (jsdom bhi nahi): js/app.js ko ek chhote DOM
   stub me chala kar, ek local nakli Supabase (GoTrue + PostgREST + RLS rules)
   ke against asli save flow chalata hai.

   Use:  node dev/test-rls.js          (ya: npm run test:rls)
   Exit 0 = sab pass. CI me bhi chal sakta hai (koi npm install / network nahi chahiye).
   ============================================================================= */
const http = require('http');
const vm = require('vm');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const REPO = path.join(__dirname, '..');
const PORT = 9911;
const URL_ = 'http://127.0.0.1:' + PORT;
const KEY = 'sb_publishable_TESTKEY_testkey';
const SECRET = 'test-jwt-secret';
const UID = '11111111-2222-3333-4444-555555555555';
const EMAIL = 'admin@envess.co.in';

/* ------------------------------------------------------------------ nakli Supabase */
const S = { row: { id: 1, data: { version: 1, sections: [] }, updated_at: new Date().toISOString(), updated_by: null } };
const KNOB = { noUpdatePolicy: false, noGrants: false, noWhoCol: false, rejectRefresh: false, whoami: true };
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
function mkJwt(expSec) {
  const iat = Math.floor(Date.now() / 1000);
  const head = b64u({ alg: 'HS256', typ: 'JWT' });
  const body = b64u({ aud: 'authenticated', exp: iat + expSec, iat, iss: URL_ + '/auth/v1', sub: UID, email: EMAIL, role: 'authenticated' });
  const sig = crypto.createHmac('sha256', SECRET).update(head + '.' + body).digest('base64url');
  return head + '.' + body + '.' + sig;
}
function session(expSec) {
  return { access_token: mkJwt(expSec == null ? 3600 : expSec), token_type: 'bearer', expires_in: expSec == null ? 3600 : expSec,
    refresh_token: 'rt-' + Math.random().toString(36).slice(2, 9), user: { id: UID, email: EMAIL, role: 'authenticated' } };
}
function roleOf(req) {                                    // PostgREST: Bearer <anon key> = anon, Bearer <JWT> = claims.role
  const m = String(req.headers.authorization || '').match(/^Bearer\s+(.+)$/i);
  if (!m || m[1] === KEY) return { role: 'anon' };
  const parts = m[1].split('.');
  if (parts.length !== 3) return { role: 'anon' };
  let cl = null;
  try { cl = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')); } catch (e) { return { role: 'invalid' }; }
  if (cl.exp * 1000 < Date.now()) return { role: 'expired' };
  return { role: cl.role || 'anon' };
}
function send(res, code, obj) { const s = JSON.stringify(obj); res.writeHead(code, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(s) }); res.end(s); }
const mock = http.createServer(async (req, res) => {
  const u = new URL(req.url, URL_);
  let body = ''; req.on('data', c => body += c);
  await new Promise(r => req.on('end', r));
  if (u.pathname === '/auth/v1/token') {
    const grant = u.searchParams.get('grant_type');
    if (grant === 'refresh_token') {
      if (KNOB.rejectRefresh) return send(res, 400, { error: 'invalid_grant', error_description: 'Refresh Token has been revoked' });
      return send(res, 200, session());
    }
    const b = JSON.parse(body || '{}');
    if (b.password === 'noconfirm') return send(res, 200, { user: { id: UID, email: b.email }, session: null });  // email confirm ON
    if (b.password === 'bad') return send(res, 400, { error_description: 'Invalid Login Credentials' });
    return send(res, 200, session());
  }
  if (u.pathname === '/rest/v1/portal_config') {
    const s = roleOf(req);
    if (s.role === 'expired') return send(res, 401, { code: 'PGRST301', message: 'JWT expired' });
    if (req.method === 'GET') {
      const one = /pgrst\.object/i.test(String(req.headers.accept || ''));
      const p = { data: S.row.data, updated_at: S.row.updated_at, updated_by: S.row.updated_by };
      return send(res, 200, one ? p : [p]);
    }
    if (req.method === 'POST') {
      if (KNOB.noGrants) return send(res, 403, { code: '42501', message: 'permission denied for table portal_config' });
      if (s.role !== 'authenticated') return send(res, 403, { code: '42501', message: 'new row violates row-level security policy for table "portal_config"' });
      if (KNOB.noUpdatePolicy) return send(res, 403, { code: '42501', message: 'new row violates row-level security policy for table "portal_config"' });
      const row = JSON.parse(body || '{}');
      if (KNOB.noWhoCol && 'updated_by' in row) return send(res, 400, { code: 'PGRST204', message: "Could not find the 'updated_by' column of the relation 'portal_config' in the schema cache" });
      S.row = { id: 1, data: row.data, updated_at: new Date().toISOString(), updated_by: ('updated_by' in row) ? row.updated_by : S.row.updated_by };
      return send(res, 201, [S.row]);
    }
    return send(res, 405, { message: 'nope' });
  }
  if (u.pathname === '/rest/v1/rpc/sp_whoami') {
    if (!KNOB.whoami) return send(res, 404, { code: 'PGRST202', message: 'Could not find the function public.sp_whoami() in the schema cache' });
    const s = roleOf(req);
    if (s.role !== 'authenticated') return send(res, 200, [{ jwt_role: 'anon', uid: null }]);
    return send(res, 200, [{ jwt_role: 'authenticated', uid: UID, email: EMAIL, email_confirmed: true, rls_enabled: true,
      policies: [{ name: 'portal_config_read_all', cmd: 'select', roles: ['anon', 'authenticated'] },
        { name: 'portal_config_write_admin', cmd: 'update', roles: KNOB.noUpdatePolicy ? [] : ['authenticated'] },
        { name: 'portal_config_insert_admin', cmd: 'insert', roles: ['authenticated'] }],
      grants: { insert: !KNOB.noGrants, update: !KNOB.noGrants, select_anon: true } }]);
  }
  send(res, 404, { message: 'mock: no route ' + u.pathname });
});

/* ------------------------------------------------------------------ app.js ko stub DOM me loader */
const APP_SRC = fs.readFileSync(path.join(REPO, 'js', 'app.js'), 'utf8');
function loadApp(seed) {
  const store = Object.assign({ sp_backend_override: '' }, seed || {});
  const ls = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; }
  };
  const dummy = () => ({ innerHTML: '', textContent: '', style: {}, dataset: {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false }, addEventListener() {}, appendChild() {}, insertBefore() {}, querySelector: () => null, querySelectorAll: () => [], remove() {}, click() {} });
  const doc = { addEventListener() {}, removeEventListener() {}, hidden: false, body: dummy(), documentElement: dummy(),
    createElement: dummy, querySelector: () => null, querySelectorAll: () => [], getElementById: () => null };
  const ctx = {
    console, setTimeout, clearTimeout, setInterval: () => 0, clearInterval() {},
    Math, JSON, Date, Promise, Buffer, atob: (s) => Buffer.from(s, 'base64').toString('binary'), escape: globalThis.escape,
    fetch: (u2, o) => fetch(typeof u2 === 'string' ? u2 : String(u2), o),
    localStorage: ls, location: { reload() {}, href: URL_ + '/index.html' }, navigator: { clipboard: null },
    document: doc, addEventListener() {}, removeEventListener() {},
    SP_BACKEND: { mode: 'supabase', supabaseUrl: URL_, supabaseAnonKey: KEY, pollSeconds: 0 }
  };
  ctx.window = ctx; ctx.globalThis = ctx; ctx.self = ctx;
  vm.createContext(ctx);
  vm.runInContext(APP_SRC, ctx, { filename: 'js/app.js' });
  return { SP: ctx.SP, store };
}

/* ------------------------------------------------------------------ tests */
let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '\n      → ' + String(extra).replace(/\n/g, ' ').slice(0, 260) : '')); }
};
const setTokenRow = (seedTok) => seedTok;
async function saveAs(SP, cfg) { try { return { ok: await SP.api('/api/admin/config', 'PUT', { config: cfg }) }; } catch (e) { return { err: e }; } }
const fresh = async () => { const s = session(); return { sp_su_at: s.access_token, sp_su_rt: s.refresh_token, sp_su_exp: String(Date.now() + s.expires_in * 1000), sp_su_email: EMAIL, sp_su_url: URL_ }; };
const expired = async () => { const s = await fresh(); s.sp_su_exp = String(Date.now() - 60000); return s; };

(async () => {
  await new Promise(r => mock.listen(PORT, '127.0.0.1', r));
  const C = { version: 1, sections: [{ id: 's1', title: 'NEW', items: [] }] };
  Object.keys(KNOB).forEach(k => KNOB[k] = (k === 'whoami'));

  console.log('\n[1] logged-in admin -> Save & Publish chalta hai');
  {
    const { SP, store } = loadApp(await fresh());
    const r = await saveAs(SP, C);
    ok('save success', !!(r.ok && r.ok.ok && r.ok.savedAt), r.err && r.err.message);
    ok('row cloud par likhi gayi', S.row.data.sections[0].title === 'NEW', JSON.stringify(S.row.data).slice(0, 90));
    ok('updated_by = login email (kaun ne save kiya)', S.row.updated_by === EMAIL, S.row.updated_by);
    ok('refresh token localStorage me bacha', !!store.sp_su_rt);
    ok('SP.session() role batata hai', SP.session().role === 'authenticated' && SP.session().loggedIn, JSON.stringify(SP.session()));
  }

  console.log('\n[2] session nahi -> ab "login kariye", confusing RLS message nahi');
  {
    const { SP } = loadApp({});
    const r = await saveAs(SP, C);
    ok('save fail hua, 401 + needLogin', !!r.err && r.err.code === 401 && !!r.err.needLogin, r.err && r.err.code);
    ok('message me sirf login ki salah hai', !!r.err && /Login dobara kariye/.test(r.err.message) && !/supabase-rls-fix/.test(r.err.message), r.err && r.err.message);
  }

  console.log('\n[3] JWT expire (Supabase 1 ghante me karta hai) -> khud refresh, save chala jata hai');
  {
    const { SP, store } = loadApp(await expired());
    ok('session expire maana gaya', !SP.session().tokenFresh, JSON.stringify(SP.session()));
    const r = await saveAs(SP, C);
    ok('refresh + retry se save ho gaya', !!(r.ok && r.ok.savedAt), r.err && r.err.message);
    ok('naya JWT store hua (exp future)', +store.sp_su_exp > Date.now(), store.sp_su_exp);
  }

  console.log('\n[4] refresh token bhi revoke -> session clear + saaf message (bar-bar chup 403 nahi)');
  {
    KNOB.rejectRefresh = true;
    const { SP, store } = loadApp(await expired());
    const r = await saveAs(SP, C);
    ok('save fail, 401', !!r.err && r.err.code === 401, r.err && (r.err.code + ':' + r.err.message));
    ok('purana token store se hata diya', !store.sp_su_at, JSON.stringify(store.sp_su_at));
    const r2 = await saveAs(SP, C);
    ok('agle save par bhi wahi saaf message', !!r2.err && /Login dobara kariye/.test(r2.err.message), r2.err && r2.err.message);
    KNOB.rejectRefresh = false;
  }

  console.log('\n[5] sacme policy/GRANT kharab ho -> tabhi fix SQL ki salah');
  {
    KNOB.noUpdatePolicy = true;
    const { SP } = loadApp(await fresh());
    const r = await saveAs(SP, C);
    ok('policy missing -> fix SQL + "aap logged-in ho"', !!r.err && /halanki aap logged-in ho/.test(r.err.message) && /supabase-rls-fix\.sql/.test(r.err.message), r.err && r.err.message);
    KNOB.noUpdatePolicy = false; KNOB.noGrants = true;
    const r2 = await saveAs(loadApp(await fresh()).SP, C);
    ok('GRANT missing -> GRANT wala message', !!r2.err && /GRANT missing/.test(r2.err.message), r2.err && r2.err.message);
    KNOB.noGrants = false;
  }

  console.log('\n[6] updated_by column na ho (purana table) -> khud column hata ke retry');
  {
    KNOB.noWhoCol = true;
    const { SP } = loadApp(await fresh());
    const r = await saveAs(SP, C);
    ok('save phir bhi ho gaya', !!(r.ok && r.ok.savedAt), r.err && r.err.message);
    KNOB.noWhoCol = false;
  }

  console.log('\n[7] email-confirm ON -> GoTrue session nahi deta: ab clear error, "RLS" nahi');
  {
    const { SP } = loadApp({});
    try { await SP.api('/api/admin/login', 'POST', { email: EMAIL, password: 'noconfirm' }); ok('login fail hona chahiye tha', false); }
    catch (e) { ok('login error me Confirm email salah', /Confirm email/i.test(e.message), e.message); }
  }

  console.log('\n[8] Session check: sp_whoami() + (na ho to) error nahi');
  {
    const { SP } = loadApp(await fresh());
    const w = await SP.api('/api/admin/whoami');
    ok('role/policy/grants sab dikhe', w.who.jwt_role === 'authenticated' && w.who.grants.update === true && w.who.policies.length === 3, JSON.stringify(w.who).slice(0, 160));
    KNOB.whoami = false;
    const w2 = await SP.api('/api/admin/whoami');
    ok('function nahi -> {missing:true} (SQL chalane ko bole, crash nahi)', w2.missing === true, JSON.stringify(w2).slice(0, 120));
    KNOB.whoami = true;
  }

  console.log('\n[9] dusre project ka purana session -> drop (warna hamesha 403)');
  {
    const seed = await fresh(); seed.sp_su_url = 'https://aur-project.supabase.co';
    const { SP } = loadApp(seed);
    ok('cross-project token use nahi hua', SP.session().loggedIn === false, JSON.stringify(SP.session()));
  }

  console.log('\n[10] reads public hain (visitors ko portal dikhta rahe)');
  {
    const { SP } = loadApp({});
    const c = await SP.api('/api/config');
    ok('anon GET config ok', !!(c && c.config), JSON.stringify(c).slice(0, 120));
  }

  console.log('\n————————————————————————————');
  console.log(pass + ' passed, ' + fail + ' failed   (js/app.js, ' + APP_SRC.split('\n').length + ' lines loaded)');
  mock.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR:', e); process.exit(2); });
