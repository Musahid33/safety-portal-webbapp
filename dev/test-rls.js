'use strict';
/* =============================================================================
   test-rls.js — admin authentication/RLS regression test.
   Koi npm dependency nahi: js/app.js ko chhote DOM stub me load karke nakli
   Supabase (GoTrue + PostgREST) ke against protected operations chalata hai.

   Use: npm run test:rls
   Exit 0 = sab pass. CI me network/credential ki zarurat nahi.
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

/* ------------------------------------------------------------------ mock Supabase */
const S = { row: { id: 1, data: { version: 1, sections: [] }, updated_at: new Date().toISOString(), updated_by: null }, hits: { home: 2 } };
const KNOB = {
  noUpdatePolicy: false, noGrants: false, noWhoCol: false, rejectRefresh: false,
  whoami: true, nonAdmin: false, noStatsPolicy: false, noResetPermission: false
};
const b64u = value => Buffer.from(JSON.stringify(value)).toString('base64url');
function mkJwt(expSec) {
  const iat = Math.floor(Date.now() / 1000);
  const head = b64u({ alg: 'HS256', typ: 'JWT' });
  const body = b64u({ aud: 'authenticated', exp: iat + expSec, iat, iss: URL_ + '/auth/v1', sub: UID, email: EMAIL, role: 'authenticated' });
  const sig = crypto.createHmac('sha256', SECRET).update(head + '.' + body).digest('base64url');
  return head + '.' + body + '.' + sig;
}
function session(expSec) {
  const seconds = expSec == null ? 3600 : expSec;
  return {
    access_token: mkJwt(seconds), token_type: 'bearer', expires_in: seconds,
    refresh_token: 'rt-' + Math.random().toString(36).slice(2, 9),
    user: { id: UID, email: EMAIL, role: 'authenticated', app_metadata: { role: KNOB.nonAdmin ? 'viewer' : 'admin' } }
  };
}
function authOf(req) {
  const m = String(req.headers.authorization || '').match(/^Bearer\s+(.+)$/i);
  if (!m || m[1] === KEY) return { role: 'anon' };
  const parts = m[1].split('.');
  if (parts.length !== 3) return { role: 'invalid' };
  let claims;
  try { claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')); }
  catch (e) { return { role: 'invalid' }; }
  if (claims.exp * 1000 < Date.now()) return { role: 'expired' };
  return { role: claims.role || 'anon' };
}
function send(res, code, value) {
  const body = JSON.stringify(value);
  res.writeHead(code, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}
const mock = http.createServer(async (req, res) => {
  const url = new URL(req.url, URL_);
  let raw = '';
  req.on('data', chunk => { raw += chunk; });
  await new Promise(resolve => req.on('end', resolve));
  const body = JSON.parse(raw || '{}');

  if (url.pathname === '/auth/v1/token') {
    const grant = url.searchParams.get('grant_type');
    if (grant === 'refresh_token') {
      if (KNOB.rejectRefresh) return send(res, 400, { error: 'invalid_grant', error_description: 'Refresh Token has been revoked' });
      return send(res, 200, session());
    }
    if (body.password === 'noconfirm') return send(res, 200, { user: { id: UID, email: body.email }, session: null });
    if (body.password === 'bad') return send(res, 400, { error_description: 'Invalid Login Credentials' });
    return send(res, 200, session());
  }

  if (url.pathname === '/auth/v1/user') {
    const auth = authOf(req);
    if (auth.role !== 'authenticated') return send(res, 401, { error: 'invalid token' });
    if (req.method === 'PUT') return send(res, 200, { id: UID, email: EMAIL });
    return send(res, 200, { id: UID, email: EMAIL, app_metadata: { role: KNOB.nonAdmin ? 'viewer' : 'admin' } });
  }

  if (url.pathname === '/rest/v1/portal_config') {
    const auth = authOf(req);
    if (auth.role === 'expired') return send(res, 401, { code: 'PGRST301', message: 'JWT expired' });
    if (req.method === 'GET') {
      const one = /pgrst\.object/i.test(String(req.headers.accept || ''));
      const row = { data: S.row.data, updated_at: S.row.updated_at, updated_by: S.row.updated_by };
      return send(res, 200, one ? row : [row]);
    }
    if (req.method === 'POST') {
      if (KNOB.noGrants) return send(res, 403, { code: '42501', message: 'permission denied for table portal_config' });
      if (auth.role !== 'authenticated' || KNOB.nonAdmin || KNOB.noUpdatePolicy) {
        return send(res, 403, { code: '42501', message: 'new row violates row-level security policy for table "portal_config"' });
      }
      if (KNOB.noWhoCol && Object.prototype.hasOwnProperty.call(body, 'updated_by')) {
        return send(res, 400, { code: 'PGRST204', message: "Could not find the 'updated_by' column of the relation 'portal_config' in the schema cache" });
      }
      S.row = { id: 1, data: body.data, updated_at: new Date().toISOString(), updated_by: body.updated_by || S.row.updated_by };
      return send(res, 201, [S.row]);
    }
    return send(res, 405, { message: 'method not allowed' });
  }

  if (url.pathname === '/rest/v1/portal_hits') {
    const auth = authOf(req);
    if (auth.role !== 'authenticated' || KNOB.nonAdmin || KNOB.noStatsPolicy) {
      return send(res, 403, { code: '42501', message: 'permission denied for table portal_hits' });
    }
    return send(res, 200, Object.keys(S.hits).map(key => ({ key, hits: S.hits[key], last_at: new Date().toISOString() })));
  }

  if (url.pathname === '/rest/v1/rpc/reset_hits') {
    const auth = authOf(req);
    if (auth.role !== 'authenticated' || KNOB.nonAdmin || KNOB.noResetPermission) {
      return send(res, 403, { code: '42501', message: 'portal admin required' });
    }
    S.hits = {};
    return send(res, 200, null);
  }

  if (url.pathname === '/rest/v1/rpc/sp_whoami') {
    if (!KNOB.whoami) return send(res, 404, { code: 'PGRST202', message: 'Could not find the function public.sp_whoami() in the schema cache' });
    const auth = authOf(req);
    if (auth.role !== 'authenticated') return send(res, 200, [{ jwt_role: 'anon', uid: null, is_admin: false }]);
    if (KNOB.nonAdmin) return send(res, 200, [{ jwt_role: 'authenticated', uid: UID, is_admin: false, note: 'not an admin' }]);
    return send(res, 200, [{ jwt_role: 'authenticated', uid: UID, email: EMAIL, email_confirmed: true, is_admin: true, rls_enabled: true,
      policies: [{ name: 'portal_config_read_all', cmd: 'select', roles: ['anon', 'authenticated'] },
        { name: 'portal_config_write_admin', cmd: 'update', roles: ['authenticated'] },
        { name: 'portal_config_insert_admin', cmd: 'insert', roles: ['authenticated'] }],
      grants: { insert: !KNOB.noGrants, update: !KNOB.noGrants, select_anon: true } }]);
  }
  send(res, 404, { message: 'mock: no route ' + url.pathname });
});

/* ------------------------------------------------------------------ app.js loader */
const APP_SRC = fs.readFileSync(path.join(REPO, 'js', 'app.js'), 'utf8');
const SQL_SRC = fs.readFileSync(path.join(REPO, 'supabase-all.sql'), 'utf8');
const FIX_SQL_SRC = fs.readFileSync(path.join(REPO, 'supabase-rls-fix.sql'), 'utf8');
function loadApp(seed) {
  const store = Object.assign({ sp_backend_override: '' }, seed || {});
  const localStorage = {
    getItem: key => (key in store ? store[key] : null),
    setItem: (key, value) => { store[key] = String(value); },
    removeItem: key => { delete store[key]; }
  };
  const dummy = () => ({
    innerHTML: '', textContent: '', style: {}, dataset: {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    addEventListener() {}, appendChild() {}, insertBefore() {}, querySelector: () => null,
    querySelectorAll: () => [], remove() {}, click() {}
  });
  const document = {
    addEventListener() {}, removeEventListener() {}, hidden: false, body: dummy(), documentElement: dummy(),
    createElement: dummy, querySelector: () => null, querySelectorAll: () => [], getElementById: () => null
  };
  const context = {
    console, setTimeout, clearTimeout, setInterval: () => 0, clearInterval() {}, Math, JSON, Date, Promise, Buffer,
    atob: value => Buffer.from(value, 'base64').toString('binary'), escape: globalThis.escape,
    fetch: (value, options) => fetch(typeof value === 'string' ? value : String(value), options),
    localStorage, location: { reload() {}, href: URL_ + '/index.html' }, navigator: { clipboard: null }, document,
    addEventListener() {}, removeEventListener() {},
    SP_BACKEND: { mode: 'supabase', supabaseUrl: URL_, supabaseAnonKey: KEY, pollSeconds: 0 }
  };
  context.window = context; context.globalThis = context; context.self = context;
  vm.createContext(context);
  vm.runInContext(APP_SRC, context, { filename: 'js/app.js' });
  return { SP: context.SP, store };
}

/* ------------------------------------------------------------------ assertions */
let pass = 0; let fail = 0;
function ok(name, condition, extra) {
  if (condition) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '\n      → ' + String(extra).replace(/\n/g, ' ').slice(0, 280) : '')); }
}
async function saveAs(SP, config) {
  try { return { ok: await SP.api('/api/admin/config', 'PUT', { config }) }; }
  catch (error) { return { err: error }; }
}
const fresh = async () => {
  const s = session();
  return { sp_su_at: s.access_token, sp_su_rt: s.refresh_token, sp_su_exp: String(Date.now() + s.expires_in * 1000), sp_su_email: EMAIL, sp_su_url: URL_ };
};
const expired = async () => { const s = await fresh(); s.sp_su_exp = String(Date.now() - 60000); return s; };

(async () => {
  await new Promise(resolve => mock.listen(PORT, '127.0.0.1', resolve));
  const config = { version: 1, sections: [{ id: 's1', title: 'NEW', items: [] }] };
  Object.keys(KNOB).forEach(key => { KNOB[key] = false; });
  KNOB.whoami = true;

  console.log('\n[1] admin JWT + admin claim -> Save & Publish chalta hai');
  {
    const { SP, store } = loadApp(await fresh());
    const result = await saveAs(SP, config);
    ok('save success', !!(result.ok && result.ok.ok && result.ok.savedAt), result.err && result.err.message);
    ok('row cloud par likhi gayi', S.row.data.sections[0].title === 'NEW', JSON.stringify(S.row.data).slice(0, 90));
    ok('updated_by = login email', S.row.updated_by === EMAIL, S.row.updated_by);
    ok('refresh token localStorage me bacha', !!store.sp_su_rt);
    ok('SP.session() role batata hai', SP.session().role === 'authenticated' && SP.session().loggedIn, JSON.stringify(SP.session()));
  }

  console.log('\n[2] session nahi -> anon key par write fallback nahi');
  {
    const { SP } = loadApp({});
    const result = await saveAs(SP, config);
    ok('save fail hua, 401 + needLogin', !!result.err && result.err.code === 401 && !!result.err.needLogin, result.err && result.err.code);
    ok('message me login ki salah hai', !!result.err && /Login dobara kariye/.test(result.err.message) && !/supabase-rls-fix/.test(result.err.message), result.err && result.err.message);
  }

  console.log('\n[3] expired JWT -> refresh karke save');
  {
    const { SP, store } = loadApp(await expired());
    ok('session expire maana gaya', !SP.session().tokenFresh, JSON.stringify(SP.session()));
    const result = await saveAs(SP, config);
    ok('refresh + retry se save ho gaya', !!(result.ok && result.ok.savedAt), result.err && result.err.message);
    ok('naya JWT store hua', +store.sp_su_exp > Date.now(), store.sp_su_exp);
  }

  console.log('\n[4] revoked refresh token -> session clear');
  {
    KNOB.rejectRefresh = true;
    const { SP, store } = loadApp(await expired());
    const result = await saveAs(SP, config);
    ok('save fail, 401', !!result.err && result.err.code === 401, result.err && result.err.message);
    ok('purana access token store se hata', !store.sp_su_at, JSON.stringify(store.sp_su_at));
    const second = await saveAs(SP, config);
    ok('agle save par bhi login message', !!second.err && /Login dobara kariye/.test(second.err.message), second.err && second.err.message);
    KNOB.rejectRefresh = false;
  }

  console.log('\n[5] policy/GRANT problem -> actionable fix SQL message');
  {
    KNOB.noUpdatePolicy = true;
    const result = await saveAs(loadApp(await fresh()).SP, config);
    ok('policy missing -> fix SQL + logged-in message', !!result.err && /halanki aap logged-in admin ho/.test(result.err.message) && /supabase-rls-fix\.sql/.test(result.err.message), result.err && result.err.message);
    KNOB.noUpdatePolicy = false; KNOB.noGrants = true;
    const result2 = await saveAs(loadApp(await fresh()).SP, config);
    ok('GRANT missing -> GRANT wala message', !!result2.err && /GRANT missing/.test(result2.err.message), result2.err && result2.err.message);
    KNOB.noGrants = false;
  }

  console.log('\n[6] old table without updated_by -> retry without optional column');
  {
    KNOB.noWhoCol = true;
    const result = await saveAs(loadApp(await fresh()).SP, config);
    ok('save phir bhi ho gaya', !!(result.ok && result.ok.savedAt), result.err && result.err.message);
    KNOB.noWhoCol = false;
  }

  console.log('\n[7] email confirmation/session missing -> clear login error');
  {
    const { SP } = loadApp({});
    try { await SP.api('/api/admin/login', 'POST', { email: EMAIL, password: 'noconfirm' }); ok('login fail hona chahiye tha', false); }
    catch (error) { ok('login error me Confirm email salah', /Confirm email/i.test(error.message), error.message); }
  }

  console.log('\n[8] admin-only Session check diagnostics');
  {
    const { SP } = loadApp(await fresh());
    const who = await SP.api('/api/admin/whoami');
    ok('role/admin/policy/grants sab dikhe', who.who.jwt_role === 'authenticated' && who.who.is_admin === true && who.who.grants.update === true && who.who.policies.length === 3, JSON.stringify(who.who).slice(0, 180));
    KNOB.whoami = false;
    const missing = await SP.api('/api/admin/whoami');
    ok('function nahi -> {missing:true}', missing.missing === true, JSON.stringify(missing).slice(0, 140));
    KNOB.whoami = true;
  }

  console.log('\n[9] cross-project token -> drop');
  {
    const seed = await fresh(); seed.sp_su_url = 'https://aur-project.supabase.co';
    const { SP } = loadApp(seed);
    ok('cross-project token use nahi hua', SP.session().loggedIn === false, JSON.stringify(SP.session()));
  }

  console.log('\n[10] public config read remains available');
  {
    const { SP } = loadApp({});
    const result = await SP.api('/api/config');
    ok('anon GET config ok', !!(result && result.config), JSON.stringify(result).slice(0, 120));
  }

  console.log('\n[11] authenticated non-admin cannot use privileged operations');
  {
    KNOB.nonAdmin = true;
    const { SP, store } = loadApp(await fresh());
    const saveResult = await saveAs(SP, config);
    ok('non-admin save blocked', !!saveResult.err && saveResult.err.code === 403 && /admin permission/.test(saveResult.err.message), saveResult.err && saveResult.err.message);
    try { await SP.api('/api/admin/stats'); ok('non-admin stats blocked', false); }
    catch (error) { ok('non-admin stats blocked', error.code === 403); }
    try { await SP.api('/api/admin/stats', 'POST'); ok('non-admin reset blocked', false); }
    catch (error) { ok('non-admin reset blocked', error.code === 403); }
    ok('non-admin session has no admin marker', !store.sp_token_v1, 'admin marker must not be stored');
    KNOB.nonAdmin = false;
  }

  console.log('\n[12] unsafe URL schemes are rejected before navigation');
  ok('app has URL allowlist', /function safeUrl\(raw\)/.test(APP_SRC) && /javascript\|data\|vbscript/.test(APP_SRC), 'safeUrl missing');

  console.log('\n[13] SQL is admin-only at the database boundary');
  ok('shared admin function checks app_metadata role', /is_portal_admin[\s\S]*app_metadata[\s\S]*role.*admin/.test(SQL_SRC), 'admin function missing');
  ok('config policies call shared admin check', /create policy "portal_config_write_admin"[\s\S]*using \(public\.is_portal_admin\(\)\)/.test(SQL_SRC), 'config policy is not admin-only');
  ok('hit reads are admin-only', /create policy "portal_hits_read_admin"[\s\S]*using \(public\.is_portal_admin\(\)\)/.test(SQL_SRC), 'portal_hits policy is not admin-only');
  ok('reset RPC checks admin claim', /reset_hits\(\)[\s\S]*portal admin required/.test(SQL_SRC), 'reset RPC is not guarded');
  ok('Storage deploy policies do not grant anon writes', !/for (?:insert|update|delete) to anon,? authenticated/.test(SQL_SRC), 'anonymous Storage write found');
  ok('repair SQL contains the same admin boundary', /is_portal_admin[\s\S]*app_metadata[\s\S]*role.*admin/.test(FIX_SQL_SRC), 'repair SQL is incomplete');

  console.log('\n[14] login identifier: email / phone accepted, UUID rejected');
  {
    const { SP } = loadApp({});
    /* UUID password login ke liye kabhi valid nahi — network par bhejne se
       pehle hi saaf message milna chahiye. */
    let uuidErr = null;
    try { await SP.api('/api/admin/login', 'POST', { email: UID, password: 'x' }); }
    catch (error) { uuidErr = error; }
    ok('UUID login rejected with UUID/User ID hint',
      !!uuidErr && /User ID \(UUID\)/i.test(uuidErr.message) && !/Invalid Login Credentials/i.test(uuidErr.message),
      uuidErr && uuidErr.message);

    const ident = SP.loginIdentity;
    ok('email aur phone dono pehchane jaate hain',
      ident(EMAIL).kind === 'email' && ident(' ' + EMAIL.toUpperCase() + ' ').email === EMAIL &&
      ident('+91 91777 85011').phone === '+919177785011' && ident('9177785011').phone === '+919177785011' &&
      ident(UID).kind === 'uuid' && ident('').kind === 'empty',
      JSON.stringify([ident('+91 91777 85011'), ident('9177785011'), ident(UID)]));

    const good = await SP.api('/api/admin/login', 'POST', { email: EMAIL, password: 'ok' });
    ok('sahi email se login chalta hai', !!(good && good.ok && good.token), JSON.stringify(good).slice(0, 90));
  }

  console.log('\n──────────────────────────────');
  console.log(pass + ' passed, ' + fail + ' failed   (js/app.js, ' + APP_SRC.split('\n').length + ' lines loaded)');
  mock.close();
  process.exit(fail ? 1 : 0);
})().catch(error => { console.error('HARNESS ERROR:', error); process.exit(2); });
