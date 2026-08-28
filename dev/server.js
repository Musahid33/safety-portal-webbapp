#!/usr/bin/env node
'use strict';
/* Local preview + data/config.json store. GitHub Pages does not run this file;
   production/static deployments use Supabase and its RLS policies. */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'data');
const CFG = path.join(DATA, 'config.json');
const PORT = Number(process.env.PORT || 3000);
const MAX_BODY = 1024 * 1024;
const MIN_PASSWORD_LENGTH = 12;
const TOKEN_TTL = 12 * 60 * 60 * 1000;
const LOGIN_WINDOW = 15 * 60 * 1000;
const LOGIN_LIMIT = 5;
const ALLOW_INSECURE_DEFAULT = process.env.ALLOW_INSECURE_DEFAULT === '1';
const BLOCK = [/^data(\/|$)/, /^dev(\/|$)/, /^\.git/, /^\.\./, /\.sql$/];
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8'
};

const hashPw = p => {
  const salt = crypto.randomBytes(16).toString('hex');
  return 'scrypt$' + salt + '$' + crypto.scryptSync(String(p), salt, 64).toString('hex');
};
const checkPw = (p, st) => {
  try {
    const [algorithm, salt, hex] = String(st || '').split('$');
    if (algorithm !== 'scrypt' || !salt || !hex) return false;
    const calc = crypto.scryptSync(String(p), salt, 64);
    const want = Buffer.from(hex, 'hex');
    return want.length === calc.length && crypto.timingSafeEqual(want, calc);
  } catch (e) { return false; }
};
const read = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return d; } };
const write = (f, o) => {
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const tmp = f + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(o, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, f);
};

function newSecurity() {
  const supplied = process.env.ADMIN_PASSWORD;
  if (supplied && supplied.length >= MIN_PASSWORD_LENGTH) return { passwordHash: hashPw(supplied), mustChange: false };
  if (ALLOW_INSECURE_DEFAULT) return { passwordHash: hashPw('admin@123'), mustChange: true };
  return { passwordHash: null, mustChange: true, setupRequired: true };
}
function cfg() {
  let c = read(CFG, null);
  if (!c || !Array.isArray(c.sections)) {
    c = read(path.join(ROOT, 'default-config.json'), { sections: [] });
    c.security = newSecurity();
    write(CFG, c);
  }
  if (!c.security) { c.security = newSecurity(); write(CFG, c); }
  if (!c.security.passwordHash && process.env.ADMIN_PASSWORD) {
    c.security = newSecurity();
    write(CFG, c);
  }
  return c;
}
const pub = c => { const x = JSON.parse(JSON.stringify(c)); delete x.security; return x; };

function cleanCfg(input) {
  input = input && typeof input === 'object' ? input : {};
  const s = (value, max = 200) => String(value == null ? '' : value)
    .replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, max);
  const u = value => {
    const v = String(value == null ? '' : value).trim();
    if (/^(?:javascript|data|vbscript):/i.test(v) || /^\/\//.test(v)) return '';
    return /^(?:https?:\/\/|mailto:|tel:|\/(?!\/)|#)/i.test(v) ? v.slice(0, 900) : '';
  };
  const template = value => {
    const v = String(value == null ? '' : value).trim().slice(0, 900);
    if (/^(?:javascript|data|vbscript):/i.test(v) || /^\/\//.test(v)) return '';
    return /^(?:https?:\/\/|mailto:|tel:|\/(?!\/)|#)/i.test(v) ? v : '';
  };
  const b = input.brand || {};
  const support = input.support || {};
  return {
    brand: {
      title: s(b.title) || 'SAFETY PORTAL', tagline: s(b.tagline),
      leftName: s(b.leftName), rightName: s(b.rightName),
      logoIcon: s(b.logoIcon) || 'shield', rightIcon: s(b.rightIcon)
    },
    support: {
      enabled: support.enabled !== false, heading: s(support.heading) || 'SUPPORT',
      line1: s(support.line1), name: s(support.name) || 'Support',
      mobile: s(support.mobile, 40), altMobile: s(support.altMobile, 40),
      email: s(support.email, 160), developer: s(support.developer), note: s(support.note)
    },
    sections: (Array.isArray(input.sections) ? input.sections : []).slice(0, 60).map(x => ({
      id: s(x.id, 40) || 'sec-' + Math.random().toString(36).slice(2, 7),
      n: +x.n || 0, title: s(x.title) || 'NEW SECTION', icon: s(x.icon) || 'link',
      color: s(x.color) || 'slate', type: ['list', 'grid', 'search'].includes(x.type) ? x.type : 'list',
      url: u(x.url), visible: x.visible !== false,
      prefix: ['letters', 'numbers', 'none'].includes(x.prefix) ? x.prefix : 'letters',
      note: s(x.note),
      search: {
        placeholder: s((x.search || {}).placeholder) || 'Search...',
        urlTemplate: template((x.search || {}).urlTemplate),
        buttonLabel: s((x.search || {}).buttonLabel) || 'SEARCH',
        icon: s((x.search || {}).icon) || 'search', help: s((x.search || {}).help)
      },
      items: (Array.isArray(x.items) ? x.items : []).slice(0, 60).map(it => ({
        id: s(it.id, 40) || 'itm-' + Math.random().toString(36).slice(2, 7),
        label: s(it.label) || 'Untitled', url: u(it.url), icon: s(it.icon) || 'link',
        openIn: ['new', 'same', 'embed'].includes(it.openIn) ? it.openIn : 'new',
        note: s(it.note), visible: it.visible !== false,
        live: typeof it.live === 'boolean' ? it.live : !!u(it.url),
        children: (Array.isArray(it.children) ? it.children : []).slice(0, 40).map(c2 => ({
          id: s(c2.id, 40) || 'sub-' + Math.random().toString(36).slice(2, 7),
          label: s(c2.label) || 'Untitled', url: u(c2.url), icon: s(c2.icon) || 'link',
          note: s(c2.note), openIn: 'new'
        }))
      }))
    }))
  };
}

const TOKENS = new Map();
const LOGIN_ATTEMPTS = new Map();
function clientKey(req) { return req.socket.remoteAddress || 'unknown'; }
function loginBlocked(req) {
  const state = LOGIN_ATTEMPTS.get(clientKey(req));
  if (!state) return 0;
  if (state.resetAt <= Date.now()) { LOGIN_ATTEMPTS.delete(clientKey(req)); return 0; }
  return state.count >= LOGIN_LIMIT ? Math.ceil((state.resetAt - Date.now()) / 1000) : 0;
}
function failedLogin(req) {
  const key = clientKey(req);
  const state = LOGIN_ATTEMPTS.get(key);
  const next = state && state.resetAt > Date.now()
    ? { count: state.count + 1, resetAt: state.resetAt }
    : { count: 1, resetAt: Date.now() + LOGIN_WINDOW };
  LOGIN_ATTEMPTS.set(key, next);
}
function successfulLogin(req) { LOGIN_ATTEMPTS.delete(clientKey(req)); }
function validToken(req) {
  const token = String(req.headers['x-auth-token'] || '').trim();
  const expires = TOKENS.get(token);
  if (!token || !expires) return false;
  if (expires <= Date.now()) { TOKENS.delete(token); return false; }
  return true;
}
function securityHeaders(extra) {
  return Object.assign({
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer'
  }, extra || {});
}
function sendJson(res, code, value, extra) {
  const body = Buffer.from(typeof value === 'string' ? value : JSON.stringify(value));
  res.writeHead(code, securityHeaders(Object.assign({
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store'
  }, extra || {})));
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = ''; let size = 0; let tooLarge = false;
    req.on('data', chunk => {
      size += chunk.length;
      if (size <= MAX_BODY) body += chunk;
      else tooLarge = true;
    });
    req.on('end', () => {
      if (tooLarge) { const e = new Error('request body too large'); e.status = 413; return reject(e); }
      resolve(body);
    });
    req.on('error', reject);
  });
}

http.createServer(async (req, res) => {
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, 'http://local').pathname); }
  catch (e) { return sendJson(res, 400, { ok: false, error: 'bad path' }); }
  let p = pathname.replace(/^\/+/, '');
  if (BLOCK.some(rx => rx.test(p))) return sendJson(res, 404, { ok: false, error: 'Not found' });

  if (p.startsWith('api/')) {
    const route = '/' + p.slice(4);
    let body = {};
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      try { body = JSON.parse((await readBody(req)) || '{}'); }
      catch (e) { return sendJson(res, e.status || 400, { ok: false, error: e.status === 413 ? e.message : 'bad json' }); }
    }
    const auth = validToken(req);

    if (route === '/config' && req.method === 'GET') return sendJson(res, 200, { ok: true, config: pub(cfg()) });
    if (route === '/health' && req.method === 'GET') return sendJson(res, 200, { ok: true, mode: 'local-dev' });
    if (route === '/hit' && req.method === 'POST') {
      const st = read(path.join(DATA, 'stats.json'), {});
      if (body.id) { st[String(body.id).slice(0, 60)] = (st[String(body.id).slice(0, 60)] || 0) + 1; write(path.join(DATA, 'stats.json'), st); }
      return sendJson(res, 200, { ok: true });
    }
    if (route === '/admin/login' && req.method === 'POST') {
      const retryAfter = loginBlocked(req);
      if (retryAfter) return sendJson(res, 429, { ok: false, error: 'Too many login attempts. Try again later.' }, { 'Retry-After': String(retryAfter) });
      const c = cfg();
      if (!c.security.passwordHash) return sendJson(res, 503, { ok: false, error: 'Admin password is not configured. Set ADMIN_PASSWORD before starting the server.' });
      if (checkPw(String(body.password || ''), c.security.passwordHash)) {
        successfulLogin(req);
        const token = crypto.randomBytes(32).toString('hex');
        TOKENS.set(token, Date.now() + TOKEN_TTL);
        return sendJson(res, 200, { ok: true, token, mustChange: !!c.security.mustChange });
      }
      failedLogin(req);
      return sendJson(res, 401, { ok: false, error: 'Password galat hai.' });
    }
    if (!auth) return sendJson(res, 401, { ok: false, error: 'Login required' });
    if (route === '/admin/me' && req.method === 'GET') return sendJson(res, 200, { ok: true, mustChange: !!cfg().security.mustChange });
    if (route === '/admin/logout' && req.method === 'POST') {
      TOKENS.delete(String(req.headers['x-auth-token'] || '').trim());
      return sendJson(res, 200, { ok: true });
    }
    if (route === '/admin/config' && req.method === 'PUT') {
      const c = cfg(); const next = cleanCfg(body.config || body);
      next.security = c.security; next.updatedAt = new Date().toISOString(); write(CFG, next);
      return sendJson(res, 200, { ok: true, config: pub(next), savedAt: next.updatedAt });
    }
    if (route === '/admin/change-password' && req.method === 'POST') {
      const c = cfg(); const next = String(body.next || '');
      if (!checkPw(String(body.current || ''), c.security.passwordHash)) return sendJson(res, 400, { ok: false, error: 'Current password galat.' });
      if (next.length < MIN_PASSWORD_LENGTH) return sendJson(res, 400, { ok: false, error: 'Naya password kam se kam ' + MIN_PASSWORD_LENGTH + ' characters ka ho.' });
      c.security = { passwordHash: hashPw(next), mustChange: false }; write(CFG, c);
      return sendJson(res, 200, { ok: true });
    }
    if (route === '/admin/stats' && req.method === 'GET') return sendJson(res, 200, { ok: true, stats: read(path.join(DATA, 'stats.json'), {}) });
    if (route === '/admin/stats' && req.method === 'POST') {
      write(path.join(DATA, 'stats.json'), {}); return sendJson(res, 200, { ok: true });
    }
    return sendJson(res, 404, { ok: false, error: 'Not found' });
  }

  if (!p) p = 'index.html';
  const f = path.resolve(ROOT, path.normalize(p));
  if (f !== ROOT && !f.startsWith(ROOT + path.sep) || !fs.existsSync(f) || !fs.statSync(f).isFile()) {
    const fallback = path.join(ROOT, 'index.html');
    if (fs.existsSync(fallback)) {
      const html = fs.createReadStream(fallback);
      res.writeHead(200, securityHeaders({ 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' }));
      return html.pipe(res);
    }
    return sendJson(res, 404, 'not found');
  }
  res.writeHead(200, securityHeaders({ 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-cache' }));
  fs.createReadStream(f).pipe(res);
}).listen(PORT, '0.0.0.0', () => {
  console.log('\n  Safety Portal (local preview) → http://localhost:' + PORT);
  console.log('  config: ' + CFG);
  if (ALLOW_INSECURE_DEFAULT) console.warn('  WARNING: insecure default admin password is enabled for local development only.');
  else if (!process.env.ADMIN_PASSWORD) console.log('  Set ADMIN_PASSWORD before first admin login.');
  console.log('');
});
