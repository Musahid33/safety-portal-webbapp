#!/usr/bin/env node
'use strict';
/* Local preview + data/config.json store (GitHub Pages par ye nahi chalta — Pages par
   seedha Supabase use hota hai). Chalane ke liye:  node dev/server.js   -> http://localhost:3000
   Note: repo root hi web root hai, taaki Pages aur local ek hi structure rahe. */
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'data');
const CFG = path.join(DATA, 'config.json');
const PORT = Number(process.env.PORT || 3000);
const BLOCK = [/^data(\/|$)/, /^dev(\/|$)/, /^\.git/, /^\.\./, /\.sql$/];   // config/backup/khaka SQL web par na dikhe
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8' };
const hashPw = p => { const s = crypto.randomBytes(16).toString('hex'); return 'scrypt$' + s + '$' + crypto.scryptSync(String(p), s, 64).toString('hex'); };
const checkPw = (p, st) => { try { const [a, s, h] = String(st).split('$'); if (a !== 'scrypt' || !h) return false; const calc = crypto.scryptSync(String(p), s, 64); const want = Buffer.from(h, 'hex'); return want.length === calc.length && crypto.timingSafeEqual(want, calc); } catch (e) { return false; } };
const read = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return d; } };
const write = (f, o) => { fs.mkdirSync(path.dirname(f), { recursive: true }); const t = f + '.tmp'; fs.writeFileSync(t, JSON.stringify(o, null, 2)); fs.renameSync(t, f); };
const TOK = new Map();
function cfg() {
  let c = read(CFG, null);
  if (!c || !Array.isArray(c.sections)) { c = read(path.join(ROOT, 'default-config.json'), { sections: [] }); c.security = { passwordHash: hashPw(process.env.ADMIN_PASSWORD || 'admin@123'), mustChange: !process.env.ADMIN_PASSWORD }; write(CFG, c); }
  if (!c.security || !c.security.passwordHash) { c.security = { passwordHash: hashPw('admin@123'), mustChange: true }; write(CFG, c); }
  return c;
}
const pub = c => { const x = JSON.parse(JSON.stringify(c)); delete x.security; return x; };
function cleanCfg(i) {
  const s = v => String(v == null ? '' : v).replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 200);
  const u = v => { v = String(v == null ? '' : v).trim(); return (/^(https?:\/\/|mailto:|tel:|\/|#)/i.test(v) && !/^(javascript|data|vbscript):/i.test(v.replace(/^\/\//, 'https://'))) ? v : ''; };
  return { brand: { title: s((i.brand || {}).title) || 'SAFETY PORTAL', tagline: s((i.brand || {}).tagline), leftName: s((i.brand || {}).leftName), rightName: s((i.brand || {}).rightName), logoIcon: s((i.brand || {}).logoIcon) || 'shield', rightIcon: s((i.brand || {}).rightIcon) },
    support: Object.assign({ name: 'Support', mobile: '', heading: 'SUPPORT', line1: '', email: '', developer: '', altMobile: '', note: '', enabled: true }, i.support || {}),
    sections: (Array.isArray(i.sections) ? i.sections : []).slice(0, 60).map(x => ({ id: s(x.id, 40) || 'sec-' + Math.random().toString(36).slice(2, 7), n: +x.n || 0, title: s(x.title) || 'NEW SECTION', icon: s(x.icon) || 'link', color: s(x.color) || 'slate', type: ['list', 'grid', 'search'].includes(x.type) ? x.type : 'list', url: u(x.url), visible: x.visible !== false, prefix: ['letters', 'numbers', 'none'].includes(x.prefix) ? x.prefix : 'letters', note: s(x.note),
      search: { placeholder: s((x.search || {}).placeholder) || 'Search...', urlTemplate: String((x.search || {}).urlTemplate || '').slice(0, 900), buttonLabel: s((x.search || {}).buttonLabel) || 'SEARCH', icon: s((x.search || {}).icon) || 'search', help: s((x.search || {}).help) },
      items: (Array.isArray(x.items) ? x.items : []).slice(0, 60).map(it => ({ id: s(it.id, 40) || 'itm-' + Math.random().toString(36).slice(2, 7), label: s(it.label) || 'Untitled', url: u(it.url), icon: s(it.icon) || 'link', openIn: ['new', 'same', 'embed'].includes(it.openIn) ? it.openIn : 'new', note: s(it.note), visible: it.visible !== false, live: typeof it.live === 'boolean' ? it.live : !!u(it.url), children: (Array.isArray(it.children) ? it.children : []).slice(0, 40).map(c2 => ({ id: s(c2.id, 40) || 'sub-' + Math.random().toString(36).slice(2, 7), label: s(c2.label) || 'Untitled', url: u(c2.url), icon: s(c2.icon) || 'link', note: s(c2.note), openIn: 'new' })) })) })) };
}
http.createServer(async (req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://l').pathname).replace(/^\/+/, '');
  const j = (code, o, h) => { const b = Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)); res.writeHead(code, Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': b.length, 'Cache-Control': 'no-store' }, h || {})); res.end(b); };
  if (BLOCK.some(rx => rx.test(p))) return j(404, { ok: false, error: 'Not found' });
  if (p.startsWith('api/')) {
    const path2 = '/' + p.slice(4);
    let body = {}; try { if (req.method !== 'GET') body = JSON.parse((await new Promise(r2 => { let s = ''; req.on('data', c => s += c); req.on('end', () => r2(s)); })) || '{}'); } catch (e) { return j(400, { ok: false, error: 'bad json' }); }
    const auth = TOK.get((req.headers['x-auth-token'] || '').trim()) > Date.now();
    if (path2 === '/config' && req.method === 'GET') return j(200, { ok: true, config: pub(cfg()) });
    if (path2 === '/health') return j(200, { ok: true, mode: 'local-dev' });
    if (path2 === '/hit') { const st = read(path.join(DATA, 'stats.json'), {}); if (body.id) { st[body.id] = (st[body.id] || 0) + 1; write(path.join(DATA, 'stats.json'), st); } return j(200, { ok: true }); }
    if (path2 === '/admin/login') { const c = cfg(); if (checkPw(String(body.password || ''), c.security.passwordHash)) { const t = crypto.randomBytes(20).toString('hex'); TOK.set(t, Date.now() + 432e5); return j(200, { ok: true, token: t, mustChange: !!c.security.mustChange }); } return j(401, { ok: false, error: 'Password galat hai.' }); }
    if (!auth) return j(401, { ok: false, error: 'Login required' });
    if (path2 === '/admin/me') return j(200, { ok: true, mustChange: !!cfg().security.mustChange });
    if (path2 === '/admin/logout') { TOK.delete((req.headers['x-auth-token'] || '').trim()); return j(200, { ok: true }); }
    if (path2 === '/admin/config') { const c = cfg(); const nc = cleanCfg(body.config || body); nc.security = c.security; nc.updatedAt = new Date().toISOString(); write(CFG, nc); return j(200, { ok: true, config: pub(nc), savedAt: nc.updatedAt }); }
    if (path2 === '/admin/change-password') { const c = cfg(); if (!checkPw(String(body.current || ''), c.security.passwordHash)) return j(400, { ok: false, error: 'Current password galat.' }); if (String(body.next || '').length < 6) return j(400, { ok: false, error: 'Naya password kam se kam 6 character ka ho.' }); c.security = { passwordHash: hashPw(body.next), mustChange: false }; write(CFG, c); return j(200, { ok: true }); }
    if (path2 === '/admin/stats') return req.method === 'POST' ? (write(path.join(DATA, 'stats.json'), {}), j(200, { ok: true })) : j(200, { ok: true, stats: read(path.join(DATA, 'stats.json'), {}) });
    return j(404, { ok: false, error: 'Not found' });
  }
  if (!p) p = 'index.html';
  const f = path.join(ROOT, path.normalize(p));
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || !fs.statSync(f).isFile()) {
    const i2 = path.join(ROOT, 'index.html');
    return fs.existsSync(i2) ? (res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }), fs.createReadStream(i2).pipe(res)) : j(404, 'not found');
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(f).pipe(res);
}).listen(PORT, '0.0.0.0', () => console.log('\n  Safety Portal (local preview) → http://localhost:' + PORT + '\n  config: ' + CFG + '   (admin password: ' + (process.env.ADMIN_PASSWORD || 'admin@123') + ')\n'));
