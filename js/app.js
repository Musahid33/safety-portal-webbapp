/* =============================================================
   SAFETY PORTAL - portal side logic (config -> render)
   Config server ke data/config.json se aata hai. Agar sirf static
   hosting par rakha ho to browser localStorage me chala jata hai.
   ============================================================= */
(function () {
  'use strict';

  var SP = window.SP = {
    config: null,
    server: true,
    query: '',
    hit: hit
  };

  /* ---------------------------------------------------------- colours */
  var BASE = {
    green: '#2e7d32', blue: '#0b5cae', orange: '#e2690b', purple: '#5b34a8', red: '#c62828',
    teal: '#00838f', indigo: '#2f3e9e', maroon: '#8e2b2b', cyan: '#0277bd', brown: '#6d4c41',
    pink: '#ad1457', slate: '#37516b', lime: '#557c14', amber: '#b26a00'
  };
  function hex2rgb(h) { h = h.replace('#', ''); return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]; }
  function mix(h, t, amt) { var a = hex2rgb(h), b = hex2rgb(t); var c = a.map(function (v, i) { return Math.round(v * amt + b[i] * (1 - amt)); }); return 'rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')'; }
  function rgba(h, a) { var c = hex2rgb(h); return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')'; }
  function pal(color) {
    var c = BASE[color] || BASE.slate;
    return {
      c: c, c2: mix(c, '#000000', 0.82), A: rgba(c, .22),
      tint: mix(c, '#ffffff', 0.1), tint2: mix(c, '#ffffff', 0.17), line2: mix(c, '#ffffff', 0.34)
    };
  }
  SP.BASE = BASE; SP.pal = pal;


  /* =======================================================================
     BACKEND layer — 2 mode, ek hi API shape: SP.api(path, method, body)
       'server'   -> Node server.js + data/config.json  (default)
       'supabase' -> Supabase: portal_config table (config) + GoTrue (login)
                     + portal_hits/record_hit (click counter)   -> global, server nahi chahiye
     config.js me window.SP_BACKEND set karke mode chunta hai.
     ======================================================================= */
  var BE = SP.BE = { mode: 'server', url: '', key: '', token: null, refresh: null, exp: 0,
                     email: null, updatedAt: null, hasRow: true, poll: 25 };
  var lastSeen = null;

  (function readBackendCfg() {
    var c = window.SP_BACKEND || {};
    BE.url = String(c.supabaseUrl || '').replace(/\/+$/, '');
    BE.key = String(c.supabaseAnonKey || '');
    BE.poll = Math.max(0, (+c.pollSeconds || 25));
    BE.mode = ['auto', 'supabase', 'server'].indexOf(c.mode) >= 0 ? c.mode : 'auto';
    if (BE.mode === 'supabase' && (!BE.url || !BE.key)) BE.mode = 'auto';
    try {
      BE.token = localStorage.getItem('sp_su_at') || null;
      BE.refresh = localStorage.getItem('sp_su_rt') || null;
      BE.exp = +localStorage.getItem('sp_su_exp') || 0;
      BE.email = localStorage.getItem('sp_su_email') || null;
      /* Cloud tab se project URL/key badli ho to purana token us dusre project ka hai —
         usse har write 401/403 hota hai. Isliye session phenk do, naya login clean rahega. */
      var su = localStorage.getItem('sp_su_url') || '';
      if (BE.token && su && su !== BE.url) { BE.token = null; BE.refresh = null; BE.exp = 0; localStorage.setItem('sp_su_at', ''); localStorage.setItem('sp_su_rt', ''); }
    } catch (e) {}
  })();
  SP.mode = function () { return BE.mode; };
  SP.isSupa = function () { return BE.mode === 'supabase'; };

  /* =======================================================================
     SESSION / RLS layer
     portal_config par write RLS policy "to authenticated" hai -> PostgREST ko
     request me VALID Supabase JWT chahiye. JWT na ho (ya expire ho jaye) to
     request anon role se jaati hai aur Supabase 403 "row-level security" deta
     hai — isliye zyadatar "save nahi hua" cases ka matlab policy kharab hona
     nahi, balki session ka na hona/expire hona hai.
     Neeche wala layer isi ko theek karta hai:
       • write se pehle ensureAuth() — expired JWT ko refresh token se taaza karo
       • refresh fail ho to saaf "login kariye" error (401), RLS ka_bhoot nahi
       • 401/403 aaye to ek baar refresh karke retry (tab khula raha ho to bhi)
       • H() writes ke liye anon key par kabhi silently fallback NAHI karta
     ======================================================================= */
  var FIX_SQL = 'supabase-rls-fix.sql';
  var NO_SESSION_MSG = 'Aap is browser me logged-in nahi ho (ya session expire ho gaya), isliye Supabase ne RLS par write rok diya. ' +
    'Policy me koi badlav karne ki zarurat nahi — bas Admin → Login dobara kariye (draft safe hai).';

  function err(m, code) { var e = new Error(m); e.code = code; return e; }
  function authErr(m) { var e = err(m, 401); e.needLogin = true; return e; }
  function sleep(ms) { return new Promise(function (z) { setTimeout(z, ms); }); }

  /* supabase access token (JWT) ke claims: role / exp / email */
  function jwtOf(t) {
    try {
      var p = String(t || '').split('.')[1]; if (!p) return null;
      p = p.replace(/-/g, '+').replace(/_/g, '/');
      while (p.length % 4) p += '=';
      return JSON.parse(decodeURIComponent(escape(atob(p))));
    } catch (e) { return null; }
  }
  function tok() { return (BE.token && (BE.exp === 0 || BE.exp > Date.now() + 20000)) ? BE.token : null; }
  function haveSession() { return !!(BE.token && (BE.exp === 0 || BE.exp > Date.now() + 5000)); }
  function suStore(j) {
    BE.token = j.access_token || null;
    BE.refresh = j.refresh_token || null;
    BE.exp = j.expires_in ? Date.now() + j.expires_in * 1000 : 0;
    /* expires_in na ho to JWT ke exp claim se expiry nikalo — warna token
       expire hone par bhi code use karta rehta hai aur Supabase 401/403 deta hai */
    if (BE.token && !BE.exp) { var cl = jwtOf(BE.token); if (cl && cl.exp) BE.exp = cl.exp * 1000; }
    if (!BE.token) BE.exp = 0;
    if (j.user && j.user.email) BE.email = j.user.email;
    try {
      localStorage.setItem('sp_su_at', BE.token || '');
      localStorage.setItem('sp_su_rt', BE.refresh || '');
      localStorage.setItem('sp_su_exp', String(BE.exp || 0));
      localStorage.setItem('sp_su_email', BE.email || '');
      localStorage.setItem('sp_su_url', BE.url || '');
    } catch (e) {}
  }
  function suClear() {
    BE.token = null; BE.refresh = null; BE.exp = 0;
    try {
      localStorage.setItem('sp_su_at', ''); localStorage.setItem('sp_su_rt', '');
      localStorage.setItem('sp_su_exp', '0');
    } catch (e) {}
  }
  var _refreshing = null;
  async function suRefresh(force) {
    if (!BE.refresh) return false;
    if (!force && haveSession() && (!BE.exp || BE.exp > Date.now() + 60000)) return true;   // abhi fresh hai
    if (_refreshing) return _refreshing;                                                     // 2 jagah se ek saath -> ek hi request
    _refreshing = (async function () {
      try {
        var r = await fetch(BE.url + '/auth/v1/token?grant_type=refresh_token', {
          method: 'POST', headers: { 'Content-Type': 'application/json', apikey: BE.key },
          body: JSON.stringify({ refresh_token: BE.refresh })
        });
        if (!r.ok) {
          /* refresh token hi reject (revoke/expire) -> session khatam; network/server error par mat todo */
          if (r.status === 400 || r.status === 401 || r.status === 403) suClear();
          return false;
        }
        suStore(await r.json()); return true;
      } catch (e) { return false; }
      finally { setTimeout(function () { _refreshing = null; }, 0); }
    })();
    return _refreshing;
  }
  /* write se pehle zaroori: fresh session. false = login karna padega */
  async function ensureAuth(force) {
    if (!force && tok()) return true;
    if (await suRefresh(!!force)) return haveSession() || !!tok();
    return haveSession();
  }
  function H(extra, needAuth) {
    var t = tok();
    if (needAuth && !t) throw authErr(NO_SESSION_MSG);
    var h = { 'apikey': BE.key, 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + (t || BE.key) };
    return extra ? Object.assign(h, extra) : h;
  }
  async function jread(r) { try { return await r.json(); } catch (e) { return null; } }
  /* ek hi jagah se fetch + text + json parse (error message ke liye txt chahiye) */
  async function supaFetch(path, opts) {
    var r = await fetch(BE.url + path, opts);
    var txt = await r.text().catch(function () { return ''; });
    var j = null; try { j = txt ? JSON.parse(txt) : null; } catch (e) {}
    return { r: r, status: r.status, ok: r.ok, j: j, txt: txt };
  }
  /* session ki halat — Admin → Cloud → "Session check" isi ko dikhata hai */
  SP.session = function () {
    var cl = jwtOf(BE.token);
    return {
      mode: BE.mode, url: BE.url, hasUrl: !!(BE.url && BE.key),
      loggedIn: haveSession(), tokenFresh: !!tok(), email: BE.email,
      role: cl ? (cl.role || '?') : null, jwtExp: cl && cl.exp ? cl.exp * 1000 : null,
      expiresIn: BE.exp ? Math.max(0, Math.round((BE.exp - Date.now()) / 1000)) : null,
      hasRefresh: !!BE.refresh
    };
  };
  function pubErr(status, j, txt) {
    var code = j && (j.code || j.details);
    var blob = String(txt || '') + ' ' + String(code) + ' ' + JSON.stringify(j || {});
    if (status === 404 || code === 'PGRST205' || /Could not find the table/i.test(blob)) {
      return 'Supabase me table public.portal_config nahi mila — SQL Editor me supabase-all.sql ek baar RUN kariye.';
    }
    if (status === 401) {
      return 'Session khatam ho gaya (Supabase ne JWT reject kiya) — Admin → Login dobara kariye, aapka draft safe rahega.';
    }
    if (status === 403) {
      if (/permission denied/i.test(blob)) {
        return 'Supabase ne table par permission denied diya (GRANT missing) — SQL Editor me ' + FIX_SQL + ' RUN kariye, wo grant bhi bana dega.';
      }
      if (!haveSession()) return NO_SESSION_MSG;
      return 'RLS ne rok diya, halanki aap logged-in ho (' + (BE.email || 'authenticated') + '). ' +
        'Is repo ki policy kisi extra "admin role" ki baat nahi karti — jo bhi logged-in Supabase user likh sakta hai — isliye ye 2 hi ho sakta hai: ' +
        '(1) table par authenticated ko GRANT nahi, ya (2) koi sakht/ani policy lag gayi hai (jaise portal_config_write_one ka placeholder UUID). ' +
        'SQL Editor me ' + FIX_SQL + ' ek baar RUN kariye (dono theek kar deta hai), phir Save dabaiye.';
    }
    if (status === 406 || status === 416) {
      return 'Update chala par row wapas nahi aayi — aksar iska matlab RLS ne row chhupa di. ' + FIX_SQL + ' RUN karke dobara Save kariye.';
    }
    if (status === 409) return 'Supabase ne conflict bataya (' + ((j && j.code) || 'PGRST409') + ') — upsert ke liye id primary key chahiye. SQL Editor me supabase-all.sql ek baar RUN karke dobara save kariye.';
    return (j && (j.msg || j.error_description || j.error || j.message)) || (txt && txt.slice(0, 200)) || ('Supabase error ' + status);
  }

  async function supaApi(path, method, body) {
    var r, j;
    if (path === '/api/health') return { ok: true, backend: 'supabase', url: BE.url };

    if (path === '/api/config' && (method === undefined || method === 'GET')) {
      r = await fetch(BE.url + '/rest/v1/portal_config?select=data,updated_at&id=eq.1', { headers: H({ 'Accept': 'application/vnd.pgrst.object+json' }) });
      if (r.status === 406 || r.status === 404) {
        BE.hasRow = false;
        var tNo = r.status === 404 ? await r.text().catch(function () { return ''; }) : '';
        return { ok: true, config: null, noRow: true, missingTable: /PGRST205|Could not find the table/i.test(tNo) };
      }
      if (!r.ok) { var t0 = await r.text(); if (/PGRST205|Could not find the table/i.test(t0)) { BE.hasRow = false; return { ok: true, config: null, noRow: true, missingTable: true }; } throw err('Config load fail: ' + t0.slice(0, 160), r.status); }
      j = await jread(r);
      BE.hasRow = true; BE.updatedAt = j.updated_at;
      return { ok: true, config: j.data, updatedAt: j.updated_at };
    }

    if (path === '/api/hit') {
      try {
        await fetch(BE.url + '/rest/v1/rpc/record_hit', {
          method: 'POST', headers: { 'Content-Type': 'application/json', apikey: BE.key },
          body: JSON.stringify({ p_key: String((body && body.id) || '').slice(0, 60) })
        });
      } catch (e) {}
      return { ok: true };
    }

    if (path === '/api/admin/login') {
      r = await fetch(BE.url + '/auth/v1/token?grant_type=password', {
        method: 'POST', headers: { 'Content-Type': 'application/json', apikey: BE.key },
        body: JSON.stringify({ email: String((body && body.email) || '').trim(), password: String((body && body.password) || '') })
      });
      j = await jread(r);
      if (!r.ok) throw err((j && (j.error_description || j.msg || j.error)) || ('Login fail (' + r.status + '). Supabase → Authentication → Users me user + "Confirm email" OFF check kariye.'), r.status);
      var sess = (j && j.session) || j;
      if (!sess || !sess.access_token) {
        throw err('Login to ho gaya, par Supabase ne session (JWT) nahi bheja — aam taur par iska matlab user ka email verify baaki hai. ' +
          'Supabase → Authentication → Providers → Email me "Confirm email" OFF kariye (ya user par right-click → "Mark email as confirmed"), phir dobara login kariye.', 401);
      }
      suStore(sess);
      /* JWT ka role check: 'authenticated' hi RLS pass karta hai */
      var cl = jwtOf(sess.access_token);
      if (cl && cl.role && cl.role !== 'authenticated') {
        throw err('Supabase session ka role "' + cl.role + '" hai, "authenticated" nahi — isliye RLS likhne nahi dega. Project ka auth setup check kariye.', 403);
      }
      return { ok: true, token: BE.token, mustChange: false, email: BE.email };
    }
    if (path === '/api/admin/logout') { suClear(); try { localStorage.removeItem('sp_token_v1'); } catch (e) {} return { ok: true }; }

    if (path === '/api/admin/me') {
      if (!(await ensureAuth())) throw authErr(NO_SESSION_MSG);
      return { ok: true, mustChange: false, email: BE.email, updatedAt: BE.updatedAt, hasRow: BE.hasRow };
    }

    /* kaun likh raha hai + policy/grants ki halat (Admin → Cloud → Session check).
       sp_whoami() supabase-all.sql / supabase-rls-fix.sql banata hai; na bhi ho to chalega. */
    if (path === '/api/admin/whoami') {
      var w = await supaFetch('/rest/v1/rpc/sp_whoami', { method: 'POST', headers: H(), body: '{}' });
      if (!w.ok) {
        if (/PGRST202|Could not find the function/i.test(w.txt || '')) return { ok: true, missing: true, session: SP.session() };
        throw err('whoami fail (' + w.status + '): ' + String(w.txt || '').slice(0, 160), w.status);
      }
      return { ok: true, who: Array.isArray(w.j) ? w.j[0] : w.j, session: SP.session() };
    }

    if (path === '/api/admin/config' && method === 'PUT') {
      var data = body && body.config ? body.config : body;
      /* Ek hi UPSERT — POST ...?on_conflict=id + Prefer: resolution=merge-duplicates.
         Purana "PATCH, warna POST" 409 (duplicate key) deta tha jab BE.hasRow stale ho:
         row cloud par pehle se thi par local state kehti thi nahi (ya ulta). Ab PostgREST
         khud conflict dekh kar update/insert chunta hai, isliye race hi nahi.
         Write hamesha fresh JWT ke saath jaata hai (ensureAuth) — warna request anon role
         se jaati hai aur RLS use 403 kar deti hai ("save nahi hua"). */
      if (!(await ensureAuth())) throw authErr(NO_SESSION_MSG);
      var whoCol = !!BE.email && !BE.noWhoCol;
      var tryUp = function (withWho) {
        var row = { id: 1, data: data };
        if (withWho) row.updated_by = String(BE.email).slice(0, 120);
        return supaFetch('/rest/v1/portal_config?on_conflict=id', {
          method: 'POST',
          headers: H({ 'Prefer': 'resolution=merge-duplicates,return=representation' }, true),
          body: JSON.stringify(row)
        });
      };
      var res = null;
      for (var attempt = 0; attempt < 4; attempt++) {
        res = await tryUp(whoCol);
        if (res.ok) break;
        /* purana table jisme updated_by column nahi (PGRST204) -> column hatake dobara */
        if (res.status === 400 && whoCol && /updated_by/i.test(res.txt || '')) { whoCol = false; BE.noWhoCol = true; continue; }
        /* 401/403: JWT stale/revoked ho sakta hai -> refresh karke ek try. Nakaam rahe to
           error message hi bata dega ki login chahiye (ya policy/grant theek karo). */
        if ((res.status === 401 || res.status === 403) && (await suRefresh(true))) continue;
        if (res.status === 408 || res.status === 429 || res.status >= 500) { await sleep(700); await suRefresh(true); continue; }
        break;
      }
      if (!res.ok) {
        var we = err(pubErr(res.status, res.j, res.txt), res.status);
        we.noRetry = true; we.needLogin = !haveSession();
        if (res.status === 403) we.fixSql = FIX_SQL;
        throw we;
      }
      j = res.j;
      var row = Array.isArray(j) ? j[0] : j;
      if (!row) throw err('Supabase ne row wapas nahi bheji — 0 row update hua (RLS/read policy ne row chhupa di?). ' + FIX_SQL + ' RUN karke dobara Save kariye.', 406);
      BE.updatedAt = row.updated_at; BE.hasRow = true;
      return { ok: true, config: row.data, savedAt: row.updated_at, savedBy: row.updated_by || BE.email };
    }

    if (path === '/api/admin/stats' && (method === undefined || method === 'GET')) {
      var sr = await supaFetch('/rest/v1/portal_hits?select=key,hits,last_at&order=hits.desc&limit=800', { headers: H() });
      if (!sr.ok) throw err('Stats padhne se mana kiya (' + sr.status + ') — portal_hits ki policy authenticated ke liye chahiye.', sr.status);
      var rows = sr.j || []; var map = {};
      rows.forEach(function (x) { map[x.key] = +x.hits || 0; });
      return { ok: true, stats: map, rows: rows };
    }
    if (path === '/api/admin/stats' && method === 'POST') {
      var rr = await supaFetch('/rest/v1/rpc/reset_hits', { method: 'POST', headers: H(null, true), body: '{}' });
      if (!rr.ok) throw err('Counters reset nahi hue: ' + pubErr(rr.status, rr.j, rr.txt), rr.status);
      return { ok: true };
    }

    if (path === '/api/admin/change-password') {
      if (!(await ensureAuth())) throw authErr('Password badalne ke liye Supabase session chahiye — pehle Admin → Login kariye.');
      var pr = await supaFetch('/auth/v1/user', { method: 'PUT', headers: H(null, true), body: JSON.stringify({ password: String((body && body.next) || '') }) });
      if (!pr.ok) throw err((pr.j && (pr.j.msg || pr.j.error_description)) || ('Password change fail (' + pr.status + '). Supabase Dashboard → Authentication → Users se bhi badal sakta hai.'), pr.status);
      return { ok: true, supabase: true };
    }

    if (path === '/api/admin/export') {
      var c = await supaApi('/api/config', 'GET');
      var st = await supaApi('/api/admin/stats', 'GET').catch(function () { return { stats: {} }; });
      return { ok: true, config: c.config, stats: st.stats, updatedAt: c.updatedAt };
    }

    throw err('Supabase mode me ye action support nahi: ' + path, 400);
  }

  function serverApi(path, method, body) {
    var t = null; try { t = localStorage.getItem('sp_token_v1'); } catch (e) {}
    return fetch(String(path).replace(/^\/+/, ''), {   // relative -> sub-folder hosting me bhi chalega
      method: method || 'GET',
      headers: { 'Content-Type': 'application/json', 'x-auth-token': t || '' },
      body: body ? JSON.stringify(body) : undefined
    }).then(async function (r) {
      var j = await jread(r);
      if (r.status === 401 && path !== '/api/admin/login') throw err('Login required', 401);
      if (!r.ok) throw err((j && j.error) || ('Server error ' + r.status), r.status);
      return j || {};
    });
  }

  /* mode:'auto' -> pehle cloud check; cloud na mile to Node API; wo bhi nahi to local */
  BE.probe = null;
  async function resolveAuto() {
    // 1) Apna Node server jawab de raha hai? -> 'server' (local dev/preview wahi rahe)
    try {
      var rs = await fetch('api/config', { cache: 'no-store' });
      if (rs.ok) { var j = await rs.json(); if (j && j.config) { BE.mode = 'server'; BE.probe = j; return; } }
    } catch (e2) {}
    // 2) Supabase set hai? -> 'supabase' (global). Table na ho to bhi cloud hi choose hoga,
    //    taaki banner sahi salah de sake.
    if (BE.url && BE.key) {
      try {
        var r = await supaApi('/api/config', 'GET');
        if (r && (r.config || r.noRow)) { BE.mode = 'supabase'; BE.probe = r; return; }
      } catch (e) { BE.probeErr = e.message || String(e); }
    }
    // 3) Kuch nahi -> local mode (browser storage)
    BE.mode = 'local';
  }

  /* ek hi entry point — 401/403 par token refresh karke ek baar retry
     (write path khud retry kar chuka hai -> e.noRetry waha set hota hai) */
  SP.api = function (path, method, body) {
    if (BE.mode !== 'supabase') return serverApi(path, method, body);
    return supaApi(path, method, body).catch(async function (e) {
      if (e && (e.code === 401 || e.code === 403) && !e.noRetry && path !== '/api/admin/login' && path !== '/api/admin/whoami') {
        if (await suRefresh(true)) return supaApi(path, method, body);
      }
      throw e;
    });
  };
  SP.reloadBackend = function () { location.reload(); };

  /* ---------------------------------------------------------- helpers */
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (m) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]; }); }
  SP.esc = esc;
  function hl(s) { // search highlight
    s = esc(s);
    var q = SP.query.trim();
    if (!q || q.length < 2) return s;
    var rx = new RegExp('(' + q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'ig');
    return s.replace(rx, '<mark>$1</mark>');
  }
  SP.hl = hl;
  function letterPrefix(i, style) {
    if (style === 'none') return '';
    if (style === 'numbers') return (i + 1) + '.';
    var a = 'abcdefghijklmnopqrstuvwxyz';
    return (i < 26 ? a[i] : a[Math.floor(i / 26) - 1] + a[i % 26]) + '.';
  }
  var toastTimer;
  function toast(msg, icon) {
    var el = document.getElementById('toast');
    el.innerHTML = ICON(icon || 'alert') + '<span>' + esc(msg) + '</span>';
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('show'); }, 2800);
  }
  SP.toast = toast;

  /* ---------------------------------------------------------- open link */
  function hrefOf(url) { return /^https?:\/\//i.test(url) ? url : (url || '#'); }
  function openLink(link) {
    if (!link.url || !link.live) { toast('“' + link.label + '” abhi LIVE nahi hai — admin ko URL set karne dijiye.', 'eyeoff'); return false; }
    hit(link.id);
    if (link.openIn === 'embed') { openEmbed(link.url, link.label); return false; }
    if (link.openIn === 'same') { location.href = hrefOf(link.url); return false; }
    return true; // normal <a target=_blank>
  }
  function hit(id) {
    if (!id || !SP.server) { bumpLocal(id); return; }
    if (SP.isSupa()) SP.api('/api/hit', 'POST', { id: id });           // Supabase rpc (fire & forget)
    else try { fetch('api/hit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: id }) }); } catch (e) {}
  }
  function bumpLocal(id) {
    try {
      var st = JSON.parse(localStorage.getItem('sp_stats') || '{}');
      st[id] = (st[id] || 0) + 1;
      localStorage.setItem('sp_stats', JSON.stringify(st));
    } catch (e) {}
  }
  SP.openEmbed = openEmbed;
  function openEmbed(url, title) {
    var v = document.getElementById('veil-embed');
    document.getElementById('emb-title').textContent = title || 'Link';
    document.getElementById('emb-hint').innerHTML = '<a href="' + esc(hrefOf(url)) + '" target="_blank" rel="noopener">New tab me kholein ↗</a>';
    document.getElementById('emb-frame').src = url;
    showVeil(v);
  }

  /* ---------------------------------------------------------- modals */
  function showVeil(v) { v.classList.add('show'); document.body.style.overflow = 'hidden'; }
  function hideVeil(v) {
    v.classList.remove('show'); document.body.style.overflow = '';
    if (v.id === 'veil-embed') document.getElementById('emb-frame').src = 'about:blank';
  }
  document.addEventListener('click', function (e) {
    var v = e.target.closest('.veil');
    if (v && (e.target === v || e.target.closest('[data-close]'))) hideVeil(v);
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      document.querySelectorAll('.veil.show').forEach(function (v) { if (v.id !== 'veil-admin' || !v.dataset.locked) hideVeil(v); });
    }
    if (e.key === '/' && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') {
      e.preventDefault(); document.getElementById('q').focus();
    }
  });
  SP.showVeil = showVeil; SP.hideVeil = hideVeil;

  /* ---------------------------------------------------------- support modal */
  function renderSupport() {
    var s = (SP.config && SP.config.support) || {};
    var mob = String(s.mobile || '').replace(/[^\d+]/g, '');
    var alt = String(s.altMobile || '').replace(/[^\d+]/g, '');
    var rows = '';
    rows += '<div class="sup-who"><div class="av">' + esc((s.name || 'S').slice(0, 2).toUpperCase()) + '</div><div>' +
      '<div class="nm">' + esc(s.name || 'Support Team') + '</div>' +
      '<div class="rl">Portal support &amp; link management' + (s.developer ? ' · developed by ' + esc(s.developer) : '') + '</div></div>';
    if (s.mobile) rows += '<a class="contact" href="tel:+' + esc(mob.replace(/^\+/, '')) + '"><span class="ci">' + ICON('phone') + '</span>' +
      '<span><span class="cl">Mobile / Call</span><span class="cv">' + esc(s.mobile) + '</span></span></a>';
    if (s.altMobile) rows += '<a class="contact" href="tel:+' + esc(alt.replace(/^\+/, '')) + '"><span class="ci">' + ICON('phone') + '</span>' +
      '<span><span class="cl">Alternate number</span><span class="cv">' + esc(s.altMobile) + '</span></span></a>';
    if (s.mobile) rows += '<a class="contact wa" target="_blank" rel="noopener" href="https://wa.me/' + esc(mob.replace(/[^0-9]/g, '')) + '?text=' + encodeURIComponent('Hi ' + (s.name || 'Musahid') + ', mujhe Safety Portal me help chahiye.') + '">' +
      '<span class="ci">' + ICON('chat') + '</span><span><span class="cl">WhatsApp</span><span class="cv">Chat on WhatsApp</span></span></a>';
    if (s.email) rows += '<a class="contact em" href="mailto:' + esc(s.email) + '"><span class="ci">' + ICON('mail') + '</span>' +
      '<span><span class="cl">Email</span><span class="cv">' + esc(s.email) + '</span></span></a>';
    rows += '<div class="acts">' +
      (s.mobile ? '<a class="btn grn" href="tel:+' + esc(mob.replace(/^\+/, '')) + '">' + ICON('phone') + ' Call now</a>' : '') +
      '<button class="btn gho" data-copy="' + esc(s.mobile || '') + '">' + ICON('clipboard') + ' Copy number</button>' +
      '</div>';
    if (s.note) rows += '<div class="sup-note">' + ICON('alert') + ' ' + esc(s.note) + '</div>';
    document.getElementById('sup-body').innerHTML = rows;
    document.getElementById('sup-title').textContent = (s.heading || 'SUPPORT') + ' — ' + (s.name || '');
  }
  function wireSupport() {
    var open = function () { renderSupport(); showVeil(document.getElementById('veil-support')); };
    ['btn-support', 'btn-support-top'].forEach(function (i) {
      var b = document.getElementById(i); if (b) b.addEventListener('click', open);
    });
    document.addEventListener('click', function (e) {
      var c = e.target.closest('[data-copy]');
      if (!c) return;
      var txt = c.getAttribute('data-copy');
      var done = function () { toast('Number copy ho gaya: ' + txt, 'check'); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(done, fallback);
      else fallback();
      function fallback() {
        var ta = document.createElement('textarea'); ta.value = txt; document.body.appendChild(ta); ta.select();
        try { document.execCommand('copy'); done(); } catch (err) { toast('Copy nahi ho paya: ' + txt); }
        ta.remove();
      }
    });
  }

  /* ---------------------------------------------------------- render */
  function counts() {
    var t = 0, l = 0;
    (SP.config.sections || []).forEach(function (s) {
      if (s.visible === false) return;
      (s.items || []).forEach(function (i) { if (i.visible === false) return; t++; if (i.url && i.live !== false) l++; });
      if (s.type === 'search' && s.search && s.search.urlTemplate) { t++; l++; }
      else if (s.type === 'search') { t++; }
    });
    return { total: t, live: l };
  }

  function itemHTML(item, i, sec, p) {
    var live = !!(item.url && item.live !== false);
    var kids = (item.children || []).filter(function () { return true; });
    var hasKids = kids.length > 0;
    var pre = letterPrefix(i, sec.prefix);
    var note = item.note ? '<span class="sub">' + esc(item.note) + '</span>' : '';
    var tag = hasKids
      ? '<span class="tag how">' + kids.length + ' sub-link' + (kids.length > 1 ? 's' : '') + '</span>'
      : (live ? '<span class="tag live">Live</span>' : '<span class="tag off">Not live</span>');
    var inner =
      '<span class="lico' + (isEmoji(item.icon) ? ' emoji' : '') + '">' + (isEmoji(item.icon) ? esc(item.icon.slice(2)) : ICON(item.icon)) + '</span>' +
      '<span class="ltx"><span class="lbl">' + (pre ? '<span class="pfx">' + pre + '</span>' : '') + hl(item.label) + '</span>' +
      '<span class="sub">' + tag + (note ? '<span>' + esc(item.note) + '</span>' : '') + (live && item.openIn === 'embed' ? '<span class="tag how">In-page</span>' : '') + '</span></span>' +
      '<span class="chev">' + ICON(hasKids ? 'right' : (live ? 'right' : 'minus')) + '</span>';

    var row;
    if (hasKids) {
      row = '<button class="link has-children" type="button" data-toggle="' + esc(item.id) + '">' + inner + '</button>';
    } else if (live) {
      row = '<a class="link" href="' + esc(hrefOf(item.url)) + '" ' + (item.openIn === 'new' ? 'target="_blank" rel="noopener"' : '') +
        ' data-hit="' + esc(item.id) + '" data-open="' + esc(item.openIn || 'new') + '" data-url="' + esc(item.url) + '" data-label="' + esc(item.label) + '">' + inner + '</a>';
    } else {
      row = '<button class="link off" type="button" data-dead="1" data-label="' + esc(item.label) + '">' + inner + '</button>';
    }

    var kidHTML = '';
    if (hasKids) {
      kidHTML = '<div class="kids" data-kids="' + esc(item.id) + '">' +
        (live ? '<a class="k" href="' + esc(hrefOf(item.url)) + '" target="_blank" rel="noopener"><span class="ki">' + ICON('external') + '</span> Open ' + esc(item.label) + '</a>' : '') +
        kids.map(function (k) {
          var klive = !!(k.url);
          return klive
            ? '<a class="k" href="' + esc(hrefOf(k.url)) + '" data-hit="' + esc(k.id) + '" target="_blank" rel="noopener"><span class="ki">' + ICON(k.icon || 'right') + '</span>' + hl(k.label) + '</a>'
            : '<span class="k off"><span class="ki">' + ICON('eyeoff') + '</span>' + hl(k.label) + ' — not configured</span>';
        }).join('') + '</div>';
    }
    return '<div class="kidwrap">' + row + kidHTML + '</div>';
  }
  function isEmoji(ic) { return typeof ic === 'string' && ic.indexOf('e:') === 0; }

  function searchHTML(sec, p) {
    var s = sec.search || {};
    return '<div class="sbox" data-sec="' + esc(sec.id) + '">' +
      '<input type="text" data-q placeholder="' + esc(s.placeholder || 'Search...') + '" aria-label="' + esc(s.placeholder || 'Search') + '" />' +
      '<div class="row"><span class="help">' + ICON('info') + ' ' + esc(s.help || '') + '</span>' +
      '<button class="go" type="button" data-go="' + esc(sec.id) + '">' + ICON(s.icon && !isEmoji(s.icon) ? s.icon : 'search') + (isEmoji(s.icon) ? esc(s.icon.slice(2)) : '') + ' ' + esc(s.buttonLabel || 'SEARCH') + '</button></div>' +
      '<div class="res" data-res></div></div>';
  }

  function sectionHTML(sec, idx) {
    var p = pal(sec.color);
    var items = (sec.items || []).filter(function (i) { return i.visible !== false; });
    var q = SP.query.trim().toLowerCase();
    if (q) {
      items = items.filter(function (i) {
        return (i.label || '').toLowerCase().indexOf(q) >= 0 || (i.note || '').toLowerCase().indexOf(q) >= 0 ||
          (sec.title || '').toLowerCase().indexOf(q) >= 0 ||
          (i.children || []).some(function (k) { return (k.label || '').toLowerCase().indexOf(q) >= 0; });
      });
      if (items.length === 0 && (sec.title || '').toLowerCase().indexOf(q) < 0) return '';
    }
    var body;
    if (sec.type === 'search') body = searchHTML(sec, p);
    else if (!items.length) body = '<div class="empty"><b>' + (q ? 'Is search me kuch nahi mila' : 'Abhi koi link nahi hai') + '</b>' +
      (q ? 'Dusre word try kariye' : 'Admin panel se link + URL add kariye, button turant live ho jayega.') + '</div>';
    else body = items.map(function (i, n) { return itemHTML(i, n, sec, p); }).join('');

    var live = (sec.items || []).filter(function (i) { return i.visible !== false && i.url && i.live !== false; }).length;
    var ttl = (sec.items || []).filter(function (i) { return i.visible !== false; }).length;
    var badge = sec.type === 'search' ? '' : ' <span class="tag ' + (live ? 'live' : 'off') + '">' + live + '/' + ttl + ' live</span>';

    return '<article class="card type-' + esc(sec.type) + '" id="sec-' + esc(sec.id) + '" style="--c:' + p.c + ';--c2:' + p.c2 + ';--cA:' + p.A +
      ';--tint:' + p.tint + ';--tint2:' + p.tint2 + ';--line2:' + p.line2 + '">' +
      '<header class="card-head">' +
      '<span class="hicon' + (isEmoji(sec.icon) ? ' emoji' : '') + '">' + (isEmoji(sec.icon) ? esc(sec.icon.slice(2)) : ICON(sec.icon)) + '</span>' +
      '<h2>' + (sec.n ? '<span class="num">' + esc(String(sec.n)) + '.</span> ' : '') + hl(sec.title) + badge + '</h2>' +
      (sec.url ? '<a class="hlink" href="' + esc(hrefOf(sec.url)) + '" target="_blank" rel="noopener" title="Open section link">' + ICON('external') + '</a>' : '') +
      '</header>' +
      (sec.note ? '<p class="card-note">' + esc(sec.note) + '</p>' : '') +
      '<div class="card-body">' + body + '</div></article>';
  }

  function render() {
    var cfg = SP.config; if (!cfg) return;
    var b = cfg.brand || {}, s = cfg.support || {};
    document.title = (b.title || 'SAFETY PORTAL') + (b.leftName ? ' · ' + b.leftName : '');
    document.getElementById('brand-title').textContent = b.title || 'SAFETY PORTAL';
    document.getElementById('brand-left').textContent = b.leftName || '';
    document.getElementById('brand-right').textContent = b.rightName || '';
    document.getElementById('brand-logo').innerHTML = ICON(b.logoIcon || 'shield');
    document.getElementById('brand-shield').innerHTML = ICON('shield');
    var rt = document.getElementById('brand-tata');
    rt.innerHTML = b.rightIcon ? ICON(b.rightIcon) : '';
    var tg = document.getElementById('brand-tagline');
    tg.textContent = b.tagline || ''; tg.hidden = !b.tagline;

    document.getElementById('dev-name').textContent = s.developer || s.name || 'Musahid';
    var badge = '';
    if (!SP.server) {
      badge = ' &nbsp;·&nbsp; <span class="badge-new">LOCAL MODE</span> changes sirf isi browser me save honge' + (SP.backendNote ? ' <span class="tip">(' + esc(SP.backendNote) + ')</span>' : '');
    } else if (SP.isSupa()) {
      var t = (!SP.needsPublish && SP.config.updatedAt) ? new Date(SP.config.updatedAt).toLocaleString() : '';
      badge = ' &nbsp;·&nbsp; <span class="badge-new">SUPABASE CLOUD</span>' +
        (SP.needsPublish ? ' <span class="tip">table ready nahi — niche dekhiye</span>' : (t ? ' <span class="tip">last publish: ' + esc(t) + '</span>' : ''));
    }
    document.getElementById('foot-note').innerHTML =
      '© ' + new Date().getFullYear() + ' ' + esc(b.leftName || '') + (b.rightName ? ' · ' + esc(b.rightName) : '') + badge;

    var bn = document.getElementById('cloud-banner');
    if (bn) {
      var show = SP.isSupa() && (SP.needsPublish || SP.offlineView);
      bn.className = 'cloud-banner' + (show ? ' show' : '');
      bn.innerHTML = show
        ? (SP.offlineView
            ? ICON('alert') + ' <span>Supabase abhi reachable nahi — <b>pichhli saved copy</b> dikha raha hoon. (Internet/URL check kariye.)</span>'
            : ICON('upload') + ' <span>Cloud se connect ho gaya, par <b>portal_config</b> me abhi koi config nahi' + (SP.missingTable ? ' (table nahi mila — supabase-all.sql chalaiye)' : '') + '.</span><button class="btn sm pri" id="bn-pub">Abhi publish kariye</button>')
        : '';
      var pb = document.getElementById('bn-pub');
      if (pb) pb.addEventListener('click', function () { SP.openAdmin(); setTimeout(function () { if (window.SPAdmin) SPAdmin.gotoCloud(); }, 300); });
    }
    var secs = (cfg.sections || []).filter(function (x) { return x.visible !== false; });
    document.getElementById('grid').innerHTML = secs.map(sectionHTML).join('') ||
      '<div class="empty" style="grid-column:1/-1;padding:44px"><b>Portal khaali hai</b>Admin panel se section banaiye — <button class="btn pri sm" id="empty-admin">Admin kholiye</button></div>';
    var ea = document.getElementById('empty-admin'); if (ea) ea.addEventListener('click', openAdmin);

    document.getElementById('jumpnav').innerHTML = secs.map(function (sec) {
      var p = pal(sec.color);
      var items = (sec.items || []).filter(function (i) { return i.visible !== false; });
      var live = items.filter(function (i) { return i.url && i.live !== false; }).length;
      return '<a href="#sec-' + esc(sec.id) + '" style="--c:' + p.c + '" class="' + (live ? '' : 'is-off') + '"><i></i>' +
        esc((sec.n ? sec.n + '. ' : '') + sec.title) + '</a>';
    }).join('');

    var c = counts();
    document.getElementById('livecount').textContent = c.live + ' / ' + c.total + ' links live';
    wireCards();
  }
  SP.render = render;

  function wireCards() {
    document.querySelectorAll('#grid [data-hit]').forEach(function (a) {
      a.addEventListener('click', function (e) {
        var link = { id: a.dataset.hit, url: a.dataset.url, label: a.dataset.label, live: true, openIn: a.dataset.open };
        if (!openLink(link)) e.preventDefault();
      });
    });
    document.querySelectorAll('#grid [data-dead]').forEach(function (b) {
      b.addEventListener('click', function () { toast('“' + b.dataset.label + '” ka URL abhi set nahi hua — button isliye band hai.', 'eyeoff'); });
    });
    document.querySelectorAll('#grid [data-toggle]').forEach(function (b) {
      b.addEventListener('click', function () {
        var id = b.dataset.toggle, kids = document.querySelector('[data-kids="' + id + '"]');
        var open = kids && kids.classList.toggle('open');
        b.classList.toggle('is-open', !!open);
      });
    });
    document.querySelectorAll('#grid [data-go]').forEach(function (btn) {
      var box = btn.closest('.sbox');
      var sec = (SP.config.sections || []).filter(function (s) { return s.id === btn.dataset.go; })[0];
      var run = function () {
        var v = (box.querySelector('[data-q]').value || '').trim();
        var tpl = (sec && sec.search && sec.search.urlTemplate) || '';
        if (!v) { toast('Pehle Employee ID ya naam likhiye.', 'user-search'); return; }
        if (!tpl) { toast('Employee search ka URL admin panel me set nahi kiya gaya.', 'eyeoff'); return; }
        var url = tpl.replace(/\{q\}/g, encodeURIComponent(v)).replace(/\{Q\}/g, encodeURIComponent(v.toUpperCase())).replace(/\{u\}/g, v);
        hit('search-' + sec.id);
        var res = box.querySelector('[data-res]');
        if (/^#/.test(url) || url.indexOf('mailto:') === 0 || url.indexOf('tel:') === 0) { openEmbed(url, 'Employee search'); return; }
        var w2 = window.open(url, '_blank', 'noopener');
        if (res) res.innerHTML = '<span class="tag live">Opened</span> “' + esc(v) + '” ke liye naya tab khula hai. ' +
          '<a href="' + esc(url) + '" target="_blank" rel="noopener">Dobara kholein ↗</a>';
        if (!w2) toast('Browser ne popup block kar diya — link naye tab me kholein.', 'alert');
      };
      btn.addEventListener('click', run);
      var inp = box.querySelector('[data-q]');
      if (inp) inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); run(); } });
    });
  }

  /* ---------------------------------------------------------- portal search filter */
  function wireTopSearch() {
    var inp = document.getElementById('q'), t;
    inp.addEventListener('input', function () {
      clearTimeout(t);
      t = setTimeout(function () { SP.query = inp.value || ''; render(); }, 130);
    });
    inp.addEventListener('keydown', function (e) { if (e.key === 'Escape') { inp.value = ''; SP.query = ''; render(); inp.blur(); } });
  }

  /* ---------------------------------------------------------- load / save */
  var LS_CFG = 'sp_config_v1', LS_TOK = 'sp_token_v1';
  SP.LS = { cfg: LS_CFG, tok: LS_TOK };

  function seedLocal() {
    return {
      version: 1, updatedAt: new Date().toISOString(),
      brand: { title: 'SAFETY PORTAL', tagline: '', leftName: 'Envess Infraventure Pvt Ltd', rightName: 'TATA STEEL LTD.', logoIcon: 'shield', theme: 'navy' },
      support: { enabled: true, heading: 'SUPPORT', line1: 'Contact for any technical issue', name: 'Musahid', mobile: '9177785011', altMobile: '', email: '', developer: 'Musahid', note: 'Local mode: changes isi browser me save hote hain.' },
      sections: [
        { id: 'sec-a', n: 1, title: 'COMMAND CENTRE', icon: 'monitor', color: 'green', type: 'list', visible: true, prefix: 'letters', url: '', note: '', search: null, items: [{ id: 'i-1', label: 'Real-time Dashboard', url: '', icon: 'chart', openIn: 'new', note: '', visible: true, children: [] }] }
      ]
    };
  }
  async function tryJson(paths) {
    for (var i = 0; i < paths.length; i++) {
      try { var r = await fetch(paths[i], { cache: 'no-store' }); if (r.ok) { var j = await r.json(); return j && (j.config || j); } } catch (e) {}
    }
    return null;
  }
  async function localFallback(reason) {
    SP.server = false; SP.backendNote = reason || '';
    var cfg = null;
    try { var raw = localStorage.getItem(LS_CFG); if (raw) cfg = JSON.parse(raw); } catch (e0) {}
    if (!cfg && window.SP_SEED) cfg = window.SP_SEED;
    if (!cfg) cfg = await tryJson(['./config.json', 'config.json', './default-config.json', 'default-config.json']);   // static hosting ka baked config
    SP.config = cfg || seedLocal();
  }

  /* Supabase mode: dusre admin ne publish kiya ho to 25 sec me page khud update */
  function startPolling() {
    if (!BE.poll || !SP.isSupa()) return;
    setInterval(async function () {
      if (document.hidden || !SP.server) return;
      try {
        var res = await SP.api('/api/config');
        var stamp = (res && (res.updatedAt || (res.config && res.config.updatedAt))) || null;
        if (res && res.config && stamp && lastSeen && stamp !== lastSeen) {
          SP.config = res.config; lastSeen = stamp; SP.render();
          try { localStorage.setItem(LS_CFG, JSON.stringify(res.config)); } catch (e) {}
          toast('Cloud se naya config le liya (kisi aur ne publish kiya).', 'refresh');
        } else if (res && res.config && !lastSeen) { lastSeen = stamp; }
      } catch (e) {}
    }, BE.poll * 1000);
  }

  /* session zinda rakho: panel khula ho aur expiry qareeb ho to JWT aap se refresh
     (1 ghante baad save karna = expired JWT = 403 "RLS ne roka", yahi common trap) */
  function startAuthKeepAlive() {
    if (typeof setInterval !== 'function') return;
    setInterval(function () {
      if (BE.mode !== 'supabase' || !BE.refresh || !BE.token || document.hidden) return;
      if (!BE.exp) { var cl = jwtOf(BE.token); if (cl && cl.exp) BE.exp = cl.exp * 1000; }
      if (BE.exp && BE.exp < Date.now() + 10 * 60 * 1000) suRefresh(true);
    }, 4 * 60 * 1000);
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) return;
      if (BE.mode === 'supabase' && BE.refresh && BE.token && BE.exp && BE.exp < Date.now() + 60000) suRefresh(true);
    });
  }
  SP.keepAuthAlive = startAuthKeepAlive;

  async function boot() {
    document.getElementById('ic-search').innerHTML = ICON('search');
    document.getElementById('ic-lock').innerHTML = ICON('lock');
    document.getElementById('ic-headset').innerHTML = ICON('shield');
    document.getElementById('ic-x1').innerHTML = ICON('x');
    document.getElementById('ic-x2').innerHTML = ICON('x');
    document.getElementById('ic-sup-hd').innerHTML = ICON('chat');
    document.getElementById('ic-emb').innerHTML = ICON('external');

    if (BE.mode === 'auto') await resolveAuto();

    if (BE.mode === 'local') {
      await localFallback(window.SP_SEED ? 'single-file' : 'server/cloud dono nahi mile');
    } else {
      try {
        var res = (BE.probe && (BE.probe.config || BE.probe.noRow)) ? BE.probe : await SP.api('/api/config');
        if (res && res.config) {
          SP.config = res.config; SP.server = true;
          lastSeen = res.updatedAt || (res.config && res.config.updatedAt) || null;
          try { localStorage.setItem(LS_CFG, JSON.stringify(res.config)); } catch (e) {}
        } else if (res && res.noRow) {
          SP.server = true; SP.needsPublish = true;
          SP.missingTable = !!res.missingTable;
          SP.config = window.SP_SEED || (await tryJson(['default-config.json', './default-config.json'])) || seedLocal();
        } else {
          await localFallback('config shape anokha');
        }
      } catch (e) {
        await localFallback((SP.isSupa() ? 'Supabase se connect nahi ho paya' : 'server se connect nahi ho paya') + ': ' + (e.message || e));
      }
    }
    render();
    wireTopSearch();
    wireSupport();
    startPolling();
    startAuthKeepAlive();
    if (SP.isSupa() && BE.refresh && BE.token && (!BE.exp || BE.exp < Date.now() + 5 * 60000)) suRefresh(true);  // khulte hi JWT taaza karo
    document.getElementById('btn-admin').addEventListener('click', openAdmin);
    window.addEventListener('storage', function (ev) { // dusre tab me save kiya ho to refresh
      if (ev.key === LS_CFG && SP.server !== false) { try { SP.config = JSON.parse(ev.newValue); render(); toast('Portal refresh ho gaya (dusre tab se).', 'check'); } catch (e) {} }
      /* dusre tab ne login/refresh kiya ho -> wahi token le lo. 2 tab ke alag-alag
         refresh token ghumane se Supabase session revoke kar deta hai (reuse detection). */
      if (ev.key === 'sp_su_at' || ev.key === 'sp_su_rt' || ev.key === 'sp_su_exp') {
        try {
          var at = localStorage.getItem('sp_su_at'), rt = localStorage.getItem('sp_su_rt'), ex = +localStorage.getItem('sp_su_exp') || 0;
          if (at && at !== BE.token) { BE.token = at; BE.refresh = rt || BE.refresh; BE.exp = ex; }
        } catch (e) {}
      }
    });
    if (SP.needsPublish) toast('Cloud se connect ho gaya, par portal_config khali hai — banner ke button se Admin → Cloud → Publish kariye.', 'upload');
    else if (SP.offlineView) toast('Cloud/server dono reachable nahi — pichhli saved copy dikha raha hoon.', 'alert');
  }
  SP.boot = boot;

  document.addEventListener('DOMContentLoaded', boot);   // (pehle 2 baar juda tha -> 2 poll loops + double listeners)

  function openAdmin() { if (window.SPAdmin) window.SPAdmin.open(); else toast('Admin script load nahi hua.', 'alert'); }
  SP.openAdmin = openAdmin;
})();
