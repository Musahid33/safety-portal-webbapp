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
    } catch (e) {}
  })();
  SP.mode = function () { return BE.mode; };
  SP.isSupa = function () { return BE.mode === 'supabase'; };

  function err(m, code) { var e = new Error(m); e.code = code; return e; }
  function tok() { return (BE.token && (BE.exp === 0 || BE.exp > Date.now() + 20000)) ? BE.token : null; }
  function suStore(j) {
    BE.token = j.access_token || null;
    BE.refresh = j.refresh_token || null;
    BE.exp = j.expires_in ? Date.now() + j.expires_in * 1000 : 0;
    if (j.user && j.user.email) BE.email = j.user.email;
    try {
      localStorage.setItem('sp_su_at', BE.token || '');
      localStorage.setItem('sp_su_rt', BE.refresh || '');
      localStorage.setItem('sp_su_exp', String(BE.exp || 0));
      localStorage.setItem('sp_su_email', BE.email || '');
    } catch (e) {}
  }
  async function suRefresh() {
    if (!BE.refresh) return false;
    try {
      var r = await fetch(BE.url + '/auth/v1/token?grant_type=refresh_token', {
        method: 'POST', headers: { 'Content-Type': 'application/json', apikey: BE.key },
        body: JSON.stringify({ refresh_token: BE.refresh })
      });
      if (!r.ok) return false;
      suStore(await r.json()); return true;
    } catch (e) { return false; }
  }
  function H(extra) {
    var h = { 'apikey': BE.key, 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + (tok() || BE.key) };
    return extra ? Object.assign(h, extra) : h;
  }
  async function jread(r) { try { return await r.json(); } catch (e) { return null; } }
  function pubErr(status, j) {
    var code = j && (j.code || j.details);
    if (status === 404 || code === 'PGRST205' || /Could not find the table/i.test(String(code) + ' ' + JSON.stringify(j || {}))) {
      return 'Supabase me table public.portal_config nahi mila — SQL Editor me supabase-setup.sql ek baar RUN kariye.';
    }
    if (status === 401) return 'Session khatam ya login nahi — Admin → Cloud → Login kariye (Supabase user se). Anon key se likha nahi ja sakta (RLS).';
    if (status === 403) return 'Supabase ne likhne se roka (RLS policy) — admin user ke App Metadata me {"role":"admin"} set karke sign out/in kariye. portal_config_write_admin policy authenticated admin ko hi INSERT/UPDATE deti hai.';
    if (status === 409) return 'Supabase ne conflict bataya (' + ((j && j.code) || 'PGRST409') + ') — upsert ke liye id primary key chahiye. SQL Editor me supabase-all.sql ek baar RUN karke dobara save kariye.';
    return (j && (j.msg || j.error_description || j.error || j.message)) || ('Supabase error ' + status);
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
      suStore(j);
      return { ok: true, token: BE.token, mustChange: false, email: BE.email };
    }
    if (path === '/api/admin/logout') { suStore({ access_token: null, refresh_token: null }); try { localStorage.removeItem('sp_token_v1'); } catch (e) {} return { ok: true }; }

    async function requireAdminSession() {
      if (!tok() && !(await suRefresh())) throw err('Login required — pehle Supabase admin se login kariye.', 401);
      var ur = await fetch(BE.url + '/auth/v1/user', { headers: H() });
      var user = await jread(ur);
      if (!ur.ok || !user || !user.id) throw err('Session valid nahi hai — dobara Supabase admin login kariye.', 401);
      var appRole = user.app_metadata && user.app_metadata.role;
      if (appRole !== 'admin') throw err('Is Supabase user ko admin permission nahi hai. Authentication → Users me App Metadata {"role":"admin"} set karke dobara login kariye.', 403);
      BE.email = user.email || BE.email;
      return user;
    }

    if (path === '/api/admin/me') {
      await requireAdminSession();
      return { ok: true, mustChange: false, email: BE.email, updatedAt: BE.updatedAt, hasRow: BE.hasRow };
    }

    if (path === '/api/admin/config' && method === 'PUT') {
      var data = body && body.config ? body.config : body;
      /* Do not attempt a write with the public anon key. Verify both the
         Supabase session and its admin app_metadata before the upsert. */
      await requireAdminSession();
      /* Ek hi UPSERT — POST ...?on_conflict=id + Prefer: resolution=merge-duplicates.
         Purana "PATCH, warna POST" 409 (duplicate key) deta tha jab BE.hasRow stale ho:
         row cloud par pehle se thi par local state kehti thi nahi (ya ulta). Ab PostgREST
         khud conflict dekh kar update/insert chunta hai, isliye race hi nahi. */
      await suRefresh();                              // write se pehle fresh JWT (expired token = 401/403)
      var up = function () {
        return fetch(BE.url + '/rest/v1/portal_config?on_conflict=id', {
          method: 'POST',
          headers: H({ 'Prefer': 'resolution=merge-duplicates,return=representation' }),
          body: JSON.stringify({ id: 1, data: data })
        });
      };
      r = await up();
      if (r.status === 408 || r.status === 429 || r.status >= 500) {   // timeout / rate-limit / server blip -> ek retry
        await new Promise(function (z) { setTimeout(z, 700); });
        await suRefresh();
        r = await up();
      }
      j = await jread(r);
      if (!r.ok) throw err(pubErr(r.status, j), r.status);
      var row = Array.isArray(j) ? j[0] : j;
      if (!row) throw err('Supabase ne saved row wapas nahi bheji — dobara Save & Publish kariye.', 502);
      BE.updatedAt = row.updated_at; BE.hasRow = true;
      return { ok: true, config: row.data, savedAt: row.updated_at };
    }

    if (path === '/api/admin/stats' && (method === undefined || method === 'GET')) {
      r = await fetch(BE.url + '/rest/v1/portal_hits?select=key,hits,last_at&order=hits.desc&limit=800', { headers: H() });
      if (!r.ok) throw err('Stats padhne se mana kiya (' + r.status + ') — authenticated policy chahiye.', r.status);
      var rows = await jread(r) || []; var map = {};
      rows.forEach(function (x) { map[x.key] = +x.hits || 0; });
      return { ok: true, stats: map, rows: rows };
    }
    if (path === '/api/admin/stats' && method === 'POST') {
      r = await fetch(BE.url + '/rest/v1/rpc/reset_hits', { method: 'POST', headers: H(), body: '{}' });
      if (!r.ok) throw err('Counters reset nahi hue (' + r.status + ') — reset_hits sirf logged-in admin ke liye hai.', r.status);
      return { ok: true };
    }

    if (path === '/api/admin/change-password') {
      r = await fetch(BE.url + '/auth/v1/user', { method: 'PUT', headers: H(), body: JSON.stringify({ password: String((body && body.next) || '') }) });
      if (!r.ok) { var ej2 = await jread(r); throw err((ej2 && (ej2.msg || ej2.error_description)) || ('Password change fail (' + r.status + '). Supabase Dashboard → Authentication → Users se bhi badal sakta hai.'), r.status); }
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

  /* ek hi entry point — 401 aane par token refresh karke ek baar retry */
  SP.api = function (path, method, body) {
    if (BE.mode !== 'supabase') return serverApi(path, method, body);
    return supaApi(path, method, body).catch(async function (e) {
      if (e && e.code === 401 && path !== '/api/admin/login') {
        if (await suRefresh()) return supaApi(path, method, body);
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
    var rows = '';
    rows += '<div class="sup-who"><div class="av">' + esc((s.name || 'S').slice(0, 2).toUpperCase()) + '</div><div>' +
      '<div class="nm">' + esc(s.name || 'Support Team') + '</div>' +
      '<div class="rl">Portal support &amp; link management' + (s.developer ? ' · developed by ' + esc(s.developer) : '') + '</div></div>';
    // Header Support is intentionally WhatsApp-only. Do not render phone,
    // alternate number, email, Call now, or Copy number actions here.
    if (s.mobile) rows += '<a class="contact wa" target="_blank" rel="noopener" href="https://wa.me/' + esc(mob.replace(/[^0-9]/g, '')) + '?text=' + encodeURIComponent('Hi ' + (s.name || 'Musahid') + ', mujhe Safety Portal me help chahiye.') + '">' +
      '<span class="ci">' + ICON('chat') + '</span><span><span class="cl">WhatsApp</span><span class="cv">Chat on WhatsApp</span></span></a>';
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
            : ICON('upload') + ' <span>Cloud se connect ho gaya, par <b>portal_config</b> me abhi koi config nahi' + (SP.missingTable ? ' (table nahi mila — supabase-setup.sql chalaiye)' : '') + '.</span><button class="btn sm pri" id="bn-pub">Abhi publish kariye</button>')
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
    document.getElementById('btn-admin').addEventListener('click', openAdmin);
    window.addEventListener('storage', function (ev) { // dusre tab me save kiya ho to refresh
      if (ev.key === LS_CFG && SP.server !== false) { try { SP.config = JSON.parse(ev.newValue); render(); toast('Portal refresh ho gaya (dusre tab se).', 'check'); } catch (e) {} }
    });
    if (SP.needsPublish) toast('Cloud se connect ho gaya, par portal_config khali hai — banner ke button se Admin → Cloud → Publish kariye.', 'upload');
    else if (SP.offlineView) toast('Cloud/server dono reachable nahi — pichhli saved copy dikha raha hoon.', 'alert');
  }
  SP.boot = boot;

  document.addEventListener('DOMContentLoaded', boot);  document.addEventListener('DOMContentLoaded', boot);

  function openAdmin() { if (window.SPAdmin) window.SPAdmin.open(); else toast('Admin script load nahi hua.', 'alert'); }
  SP.openAdmin = openAdmin;
})();
