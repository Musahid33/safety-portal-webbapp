/* =============================================================
   ADMIN PANEL — section / button / URL manager
   Yahi panel wo "login + section banana" wala hissa hai:
   login karke naya section ya button add kariye, URL daliye, Save dabaiye
   -> portal par button turant LIVE ho jayega. Code chhedne ki zarurat nahi.
   ============================================================= */
(function () {
  'use strict';

  var SP = window.SP, ICON = window.ICON, NAMES = window.ICON_NAMES;
  var T = { links: 'Links & Sections', brand: 'Header / Branding', support: 'Support', cloud: 'Cloud / Supabase', stats: 'Usage', sec: 'Security', bak: 'Backup' };
  var D = null, dirty = false, tab = 'links', token = null, mustChange = false;
  var OPEN = new Set(); // kaun-ka Options box khula tha (re-render me bana rahe)
  var esc, toast;

  function init() {
    esc = SP.esc; toast = SP.toast;
    token = localStorage.getItem(SP.LS.tok) || null;
  }

  /* ---------------------------------------------------------- api (backend-agnostic) */
  function api(path, method, body) {
    if (!SP.server) return Promise.resolve({ ok: true, local: true });
    return SP.api(path, method, body).catch(function (e) {
      if (e && e.code === 401 && path !== '/api/admin/login') {
        token = null;
        try { localStorage.removeItem(SP.LS.tok); } catch (e2) {}
        throw new Error('Session khatam — dobara login kariye.');
      }
      throw e;
    });
  }

  /* ---------------------------------------------------------- open / close */
  function open() {
    init();
    D = JSON.parse(JSON.stringify(SP.config || { sections: [] }));
    var v = document.getElementById('veil-admin');
    v.dataset.locked = '1';
    // local (static) mode me bhi pehle password set/login zaroori — warna koi bhi visitor panel khol lega
    var localReady = !SP.server && token && localStorage.getItem('sp_pw_local');
    v.innerHTML = (token && (SP.server || localReady)) ? panelHTML() : loginHTML();
    SP.showVeil(v);
    v.addEventListener('click', onPanelClick, true);
    v.addEventListener('input', onPanelInput, true);
    v.addEventListener('change', onPanelInput, true);
    v.addEventListener('toggle', function (e) { var k = e.target.dataset.key; if (!k) return; if (e.target.open) OPEN.add(k); else OPEN.delete(k); }, true);
    v.addEventListener('keydown', function (e) { if (e.key === 'Enter' && e.target.id === 'adm-pw') { e.preventDefault(); doLogin(); } });
    if (token && SP.server) api('/api/admin/me').then(function (r) { mustChange = !!r.mustChange; renderTab(); }).catch(function () { v.innerHTML = loginHTML(); });
    else renderTab();
    document.addEventListener('keydown', hotkey);
  }
  function close() {
    var v = document.getElementById('veil-admin');
    v.innerHTML = ''; delete v.dataset.locked; v.classList.remove('show'); document.body.style.overflow = '';
    document.removeEventListener('keydown', hotkey);
  }
  function hotkey(e) {
    if (e.key === 'Escape') { if (dirty && !e.target.closest('.yes-sure')) { toast('Pehle Save kariye (ya 2 baar ESC dabaiye)', 'alert'); e.target.closest('.veil').dataset.twice = '1'; return; } close(); }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(); }
  }

  /* ---------------------------------------------------------- login view */
  function loginHTML() {
    var local = !SP.server, su = SP.isSupa && SP.isSupa();
    // Sirf username + password — baaki koi note/link/hint nahi
    return '<div class="sheet" style="width:min(430px,100%)"><div class="sheet-hd">' +
      '<span class="ic">' + ICON('lock') + '</span><h3>Admin login</h3>' +
      '<button class="x" data-act="close">' + ICON('x') + '</button></div>' +
      '<div class="sheet-bd login">' +
      '<div class="fld"><label>' + (su ? 'Username / Email' : 'Username') + '</label><input type="' + (su ? 'email' : 'text') + '" id="' + (su ? 'adm-email' : 'adm-user') + '" autocomplete="username" placeholder="Username" value="' + (su ? esc((SP.BE && SP.BE.email) || '') : '') + '" /></div>' +
      '<div class="fld"><label>' + (local && !localStorage.getItem('sp_pw_local') ? 'Naya password banaiye (6+)' : 'Password') + '</label><input type="password" id="adm-pw" autocomplete="current-password" placeholder="••••••••" /></div>' +
      '<p class="err" id="adm-err"></p>' +
      '<div class="acts" style="margin-top:16px"><button class="btn pri blk" data-act="login">' + ICON('lock') + ' Login</button></div>' +
      '</div></div>';
  }

  function doLogin() {
    var pw = document.getElementById('adm-pw').value;
    var em = document.getElementById('adm-email');
    var err = document.getElementById('adm-err');
    err.classList.remove('show');
    if (!pw) { err.textContent = 'Password khali hai.'; err.classList.add('show'); return; }
    if (SP.isSupa() && !(em && em.value.trim())) { err.textContent = 'Email daaliye (Supabase user wala).'; err.classList.add('show'); return; }
    if (!SP.server) { // local mode: pehli baar password set
      var saved = localStorage.getItem('sp_pw_local');
      if (!saved) {
        if (pw.length < 6) { err.textContent = 'Kam se kam 6 character.'; err.classList.add('show'); return; }
        localStorage.setItem('sp_pw_local', pw); toast('Local admin password set ho gaya.', 'check');
      } else if (saved !== pw) { err.textContent = 'Password galat hai.'; err.classList.add('show'); return; }
      token = 'local'; localStorage.setItem(SP.LS.tok, token);
      document.getElementById('veil-admin').innerHTML = panelHTML(); renderTab(); return;
    }
    api('/api/admin/login', 'POST', { password: pw, email: em ? em.value.trim() : '' }).then(function (r) {
      token = r.token || 'supabase'; mustChange = !!r.mustChange;
      localStorage.setItem(SP.LS.tok, token);
      document.getElementById('veil-admin').innerHTML = panelHTML();
      renderTab();
      if (mustChange) toast('Zyada zaroori: Security tab jakar default password badaliye.', 'lock');
      else toast('Welcome back!', 'check');
    }).catch(function (e) { err.textContent = e.message; err.classList.add('show'); });
  }
  function doLogout() {
    api('/api/admin/logout', 'POST').catch(function () {});
    token = null; localStorage.removeItem(SP.LS.tok);
    document.getElementById('veil-admin').innerHTML = loginHTML();
  }

  /* ---------------------------------------------------------- panel shell */
  function panelHTML() {
    return '<div class="sheet adminsheet">' +
      '<div class="sheet-hd"><span class="ic">' + ICON('sliders') + '</span>' +
      '<h3>Admin panel <span class="badge-new">' + (SP.server ? 'SERVER' : 'LOCAL') + '</span></h3>' +
      '<div style="margin-left:auto;display:flex;gap:8px">' +
      '<button class="btn sm gho" data-act="preview">' + ICON('eye') + ' Portal dekho</button>' +
      '<button class="btn sm gho" data-act="logout">' + ICON('logout') + ' Logout</button>' +
      '<button class="x" data-act="close">' + ICON('x') + '</button></div></div>' +
      '<div class="adm-tabs">' + Object.keys(T).map(function (k) {
        return '<button data-tab="' + k + '" class="' + (k === tab ? 'on' : '') + '">' + ICON(k === 'links' ? 'layers' : k === 'brand' ? 'shield' : k === 'support' ? 'chat' : k === 'stats' ? 'chart' : k === 'sec' ? 'lock' : 'download') + ' ' + T[k] + '</button>';
      }).join('') + '</div>' +
      '<div class="adm-body" id="adm-body">' + Object.keys(T).map(function (k) { return '<section data-pane="' + k + '"></section>'; }).join('') + '</div>' +
      '</div>';
  }

  function renderTab() {
    var body = document.getElementById('adm-body'); if (!body) return;
    Object.keys(T).forEach(function (k) {
      var pane = body.querySelector('[data-pane="' + k + '"]');
      pane.classList.toggle('on', k === tab);
      var btn = document.querySelector('[data-tab="' + k + '"]'); if (btn) btn.classList.toggle('on', k === tab);
    });
    var pane = body.querySelector('[data-pane="' + tab + '"]');
    pane.innerHTML = ({ links: paneLinks, brand: paneBrand, support: paneSupport, cloud: paneCloud, stats: paneStats, sec: paneSec, bak: paneBak })[tab]();
    if (tab === 'links' || tab === 'brand' || tab === 'support' || tab === 'sec' || tab === 'bak') renderSaveBar(pane);
  }

  function renderSaveBar(pane) {
    var old = document.getElementById('savebar'); if (old) old.remove();
    if (tab === 'stats') return;
    var bar = document.createElement('div');
    bar.className = 'bar-save' + (dirty ? ' dirty' : ''); bar.id = 'savebar';
    bar.innerHTML = '<span class="st">' + (dirty ? '● Badlav save nahi hua' : '✓ Sab saved hai') +
      (mustChange ? ' &nbsp;·&nbsp; <b style="color:#b3222a">Default password abhi bhi chal raha hai!</b>' : '') + '</span>' +
      '<button class="btn gho sm" data-act="reload">' + ICON('refresh') + ' Discard</button>' +
      '<button class="btn grn sm" data-act="save">' + ICON('check') + ' Save &amp; Publish</button>';
    pane.appendChild(bar);
  }
  function mark() { dirty = true; renderSaveBar(document.querySelector('[data-pane="' + tab + '"]')); }
  function save() {
    // clean empty urls
    (D.sections || []).forEach(function (s) {
      (s.items || []).forEach(function (i) { if (!i.url) i.live = false; else if (i.live === undefined) i.live = true; });
    });
    if (!SP.server) {
      try { localStorage.setItem(SP.LS.cfg, JSON.stringify(D)); } catch (e) { return toast('Save fail: ' + e.message, 'alert'); }
      SP.config = JSON.parse(JSON.stringify(D)); SP.render(); dirty = false; renderTab();
      toast('Local mode me save ho gaya (sirf isi browser me).', 'check'); return;
    }
    api('/api/admin/config', 'PUT', { config: D }).then(function (r) {
      SP.config = r.config; D = JSON.parse(JSON.stringify(r.config)); SP.render(); dirty = false; renderTab();
      toast('Publish ho gaya — portal live update ho gaya. (' + new Date().toLocaleTimeString() + ')', 'check');
    }).catch(function (e) { toast('Save nahi hua: ' + e.message, 'alert'); });
  }

  /* ---------------------------------------------------------- LINKS pane */
  function paneLinks() {
    var secs = D.sections || (D.sections = []);
    return '<div class="hint"><b>Kaise chalta hai:</b> 1) section banaiye → 2) button ka label likhiye → 3) uska URL daaliye → 4) <b>Save &amp; Publish</b> dabaiye. ' +
      'Jis button me URL hoga wahi portal par <b>live</b> dikhega; bina URL wala “Not live” badge ke saath band rahega. ' +
      'Poora page ek hi page hai — koi code change nahi karna padega.</div>' +
      '<div class="sec-tools"><h4>' + secs.length + ' section' + (secs.length === 1 ? '' : 's') + '</h4><span style="flex:1"></span>' +
      '<button class="btn sm gho" data-act="sec-toggle-all" data-on="1">' + ICON('eye') + ' Sab visible</button>' +
      '<button class="btn sm gho" data-act="sec-toggle-all" data-on="0">' + ICON('eyeoff') + ' Sab hide</button>' +
      '<button class="btn sm pri" data-act="sec-add">' + ICON('plus') + ' Naya section</button></div>' +
      secs.map(function (s, si) { return secCard(s, si); }).join('') +
      '<div class="hint" style="margin-top:14px"><b>Tip:</b> kisi bhi button par “⧉” icon se icon badal sakte hain, “🔗” se direct URL. ' +
      'Sub-menu chahiye (jaise SOP me) to <i>Options → Sub-link</i> me child daaliye — button click par khulega.</div>';
  }

  function secCard(s, si) {
    var p = SP.pal(s.color);
    var items = s.items || [];
    return '<div class="acard" data-s="' + si + '">' +
      '<div class="ah">' +
      '<span class="swatch" style="background:linear-gradient(135deg,' + p.c + ',' + p.c2 + ')">' + (isEm(s.icon) ? esc(s.icon.slice(2)) : ICON(s.icon)) + '</span>' +
      '<div style="min-width:0"><div class="t">' + (s.n ? esc(s.n) + '. ' : '') + esc(s.title) + '</div>' +
      '<div class="m">' + items.length + ' button · ' + items.filter(function (i) { return i.url; }).length + ' live · type: ' + esc(s.type || 'list') + '</div></div>' +
      '<div class="icn">' +
      '<button class="iconbtn" data-act="sec-vis" title="Hide / show on portal">' + ICON(s.visible === false ? 'eyeoff' : 'eye') + '</button>' +
      '<button class="iconbtn" data-act="sec-up" title="Move up">' + ICON('up') + '</button>' +
      '<button class="iconbtn" data-act="sec-down" title="Move down">' + ICON('down') + '</button>' +
      '<button class="iconbtn" data-act="sec-copy" title="Duplicate">' + ICON('layers') + '</button>' +
      '<button class="iconbtn dan" data-act="sec-del" title="Delete section">' + ICON('trash') + '</button>' +
      '</div></div>' +
      '<details class="more"' + (OPEN.has('s' + si) ? ' open' : '') + ' data-key="s' + si + '"><summary>Section settings</summary>' +
      '<div class="grid3" style="margin-top:10px">' +
      fld('Number', '<input type="text" data-f="n" value="' + esc(s.n == null ? '' : s.n) + '" maxlength="3" />') +
      fld('Title', '<input type="text" data-f="title" value="' + esc(s.title) + '" />') +
      fld('Type', sel(['list', 'grid', 'search'].map(function (v) { return [v, v === 'list' ? 'list (bade rows)' : v === 'grid' ? 'grid (SOP jaise chips)' : 'search (employee search box)']; }), s.type, 'data-f="type"')) +
      fld('Label numbering', sel([['letters', 'a. b. c.'], ['numbers', '1. 2. 3.'], ['none', 'koi nahi']], s.prefix, 'data-f="prefix"')) +
      fld('Section heading URL (optional)', '<input type="text" data-f="url" value="' + esc(s.url || '') + '" placeholder="https://..." />') +
      fld('Note (optional)', '<input type="text" data-f="note" value="' + esc(s.note || '') + '" placeholder="portal par heading ke niche dikhega" />') +
      '</div>' +
      '<div class="grid3">' +
      '<div class="fld"><label>Colour</label>' + swatchPick(s.color) + '</div>' +
      '<div class="fld"><label>Icon</label>' + iconPick(s.icon, 'sec') + '</div>' +
      '<div class="fld"><label>Emoji / custom icon</label><input type="text" data-f="icon" value="' + esc(s.icon || '') + '" placeholder="e.g. e:🔥" /><span class="tip">“e:” lagakar emoji bhi de sakte hain</span></div>' +
      '</div>' +
      (s.type === 'search' ? searchSettings(s) : '') +
      '</details>' +
      '<div class="rows">' +
      items.map(function (it, ii) { return itemRow(it, si, ii, s); }).join('') +
      (items.length === 0 ? '<p class="tip" style="margin:4px 6px">Abhi koi button nahi. Neeche “+ Button” dabaiye.</p>' : '') +
      '</div>' +
      '<div class="sec-tools" style="margin:10px 0 0">' +
      '<button class="btn sm gho" data-act="it-add">' + ICON('plus') + ' Button</button>' +
      '<button class="btn sm gho" data-act="it-add-sub">' + ICON('plus') + ' Grid me 2 buttons</button>' +
      '<span style="flex:1"></span>' +
      '<span class="tip mono">' + esc(s.id) + '</span></div>' +
      '</div>';
  }
  function searchSettings(s) {
    var q = s.search || {};
    return '<div class="grid2" style="margin-top:10px">' +
      fld('Search box placeholder', '<input type="text" data-sf="placeholder" value="' + esc(q.placeholder || '') + '" />') +
      fld('Button label', '<input type="text" data-sf="buttonLabel" value="' + esc(q.buttonLabel || '') + '" />') +
      fld('Search URL template', '<input type="text" data-sf="urlTemplate" value="' + esc(q.urlTemplate || '') + '" placeholder="https://erp.company.com/emp?q={q}" />',
        '{q} ki jagah user ka likha hua aayega. Aapki ERP/search URL yahin daaliye — uske baad ye box live ho jayega.') +
      fld('Help line', '<input type="text" data-sf="help" value="' + esc(q.help || '') + '" />') +
      '</div>';
  }

  function itemRow(it, si, ii, s) {
    var live = !!it.url && it.live !== false;
    return '<div class="kidwrap" data-i="' + ii + '"><div class="row">' +
      '<div class="k">' + (s.prefix === 'none' ? '•' : (s.prefix === 'numbers' ? (ii + 1) + '.' : letterOf(ii))) + '</div>' +
      '<input type="text" data-if="label" value="' + esc(it.label) + '" placeholder="Button ka naam" />' +
      '<input type="text" class="url" data-if="url" value="' + esc(it.url || '') + '" placeholder="https:// — khali chhoda to button NOT LIVE rahega" />' +
      '<button class="mini ' + (live ? 'on' : '') + '" data-act="it-live" title="Live on/off">' + (live ? 'LIVE' : 'OFF') + '</button>' +
      '<div class="icn">' +
      (it.url ? '<a class="iconbtn" href="' + esc(/^https?:/i.test(it.url) ? it.url : '#') + '" target="_blank" rel="noopener" title="URL test karo">' + ICON('external') + '</a>' : '') +
      '<button class="iconbtn" data-act="it-up" title="Up">' + ICON('up') + '</button>' +
      '<button class="iconbtn" data-act="it-down" title="Down">' + ICON('down') + '</button>' +
      '<button class="iconbtn dan" data-act="it-del" title="Delete">' + ICON('trash') + '</button></div>' +
      '</div>' +
      '<details class="more"' + (OPEN.has('i' + si + '-' + ii) ? ' open' : '') + ' data-key="i' + si + '-' + ii + '"><summary>Options · icon ' + ((it.children || []).length ? '· sub-links (' + it.children.length + ')' : '') + '</summary>' +
      '<div class="grid3" style="margin-top:8px">' +
      '<div class="fld"><label>Icon</label>' + iconPick(it.icon, 'item') + '</div>' +
      '<div class="fld"><label>Open kaise ho</label>' + sel([['new', 'naye tab me'], ['same', 'isi tab me'], ['embed', 'portal ke andar (popup)']], it.openIn, 'data-if="openIn"') + '</div>' +
      '<div class="fld"><label>Chhota note (optional)</label><input type="text" data-if="note" value="' + esc(it.note || '') + '" placeholder="e.g. only for supervisors" /></div>' +
      '<div class="fld"><label>Custom icon text</label><input type="text" data-if="icon" value="' + esc(it.icon || '') + '" placeholder="e:" /></div>' +
      '<div class="fld"><label>Visible?</label><label class="switch"><input type="checkbox" data-if="visible" ' + (it.visible === false ? '' : 'checked') + ' /> portal par dikhega</label></div>' +
      '<div class="fld"><label>Live status</label><label class="switch"><input type="checkbox" data-if="live" ' + (live ? 'checked' : '') + ' /> clickable (URL hone par hi)</label></div>' +
      '</div>' +
      '<div style="margin-top:8px"><div class="subrows">' +
      (it.children || []).map(function (k, ci) {
        return '<div class="row" data-c="' + ci + '"><div class="k">›</div>' +
          '<input type="text" data-cf="label" value="' + esc(k.label) + '" placeholder="Sub-link ka naam" />' +
          '<input type="text" class="url" data-cf="url" value="' + esc(k.url || '') + '" placeholder="https://..." />' +
          '<button class="iconbtn" data-act="ch-up">' + ICON('up') + '</button>' +
          '<button class="iconbtn" data-act="ch-down">' + ICON('down') + '</button>' +
          '<button class="iconbtn dan" data-act="ch-del">' + ICON('trash') + '</button></div>';
      }).join('') +
      '</div><button class="btn sm gho" data-act="ch-add" style="margin-top:6px">' + ICON('plus') + ' Sub-link</button>' +
      '<span class="tip" style="margin-left:8px">Sub-link wala button portal par click karne par khulta hai (accordion) — SOP / dropdown style ke liye.</span></div>' +
      '</details></div>';
  }
  function letterOf(i) { return 'abcdefghijklmnopqrstuvwxyz'[i] || '?'; }
  function isEm(ic) { return typeof ic === 'string' && ic.indexOf('e:') === 0; }

  /* ---------------------------------------------------------- small widgets */
  function fld(label, ctrl, tip) {
    return '<div class="fld"><label>' + label + '</label>' + ctrl + (tip ? '<span class="tip">' + tip + '</span>' : '') + '</div>';
  }
  function sel(opts, val, attrs) {
    return '<select ' + (attrs || '') + '>' + opts.map(function (o) {
      return '<option value="' + o[0] + '"' + (String(val) === String(o[0]) ? ' selected' : '') + '>' + esc(o[1] || o[0]) + '</option>';
    }).join('') + '</select>';
  }
  function swatchPick(cur) {
    var colors = Object.keys(SP.BASE);
    return '<div class="pick sw" data-iconfor="color">' + colors.map(function (c) {
      return '<button title="' + c + '" style="background:' + SP.BASE[c] + '" class="' + (c === cur ? 'on' : '') + '" data-color="' + c + '"></button>';
    }).join('') + '</div>';
  }
  function iconPick(cur, forWhat) {
    return '<div class="pick2"><div class="pick" data-iconfor="' + (forWhat || 'sec') + '">' + NAMES.map(function (n) {
      return '<button title="' + n + '" class="' + (n === cur ? 'on' : '') + '" data-icon="' + n + '">' + ICON(n) + '</button>';
    }).join('') + '</div></div>';
  }

  /* ---------------------------------------------------------- brand pane */
  function paneBrand() {
    var b = D.brand || (D.brand = {});
    return '<div class="hint">Ye sab header (upar ki patti) ke naam, title aur logo ke liye hai.</div>' +
      '<div class="grid3">' +
      fld('Portal title', '<input type="text" data-bf="title" value="' + esc(b.title || '') + '" />') +
      fld('Tagline (optional)', '<input type="text" data-bf="tagline" value="' + esc(b.tagline || '') + '" placeholder="Safety first, always" />') +
      fld('Left company name', '<input type="text" data-bf="leftName" value="' + esc(b.leftName || '') + '" />') +
      fld('Right company name', '<input type="text" data-bf="rightName" value="' + esc(b.rightName || '') + '" />') +
      '<div class="fld"><label>Left logo icon</label>' + iconPick(b.logoIcon, 'brand') + '</div>' +
      '<div class="fld"><label>Left logo icon name / emoji</label><input type="text" data-bf="logoIcon" value="' + esc(b.logoIcon || '') + '" placeholder="shield ya e:🏭" /></div>' +
      '<div class="fld"><label>Right logo icon (khali chhoda to sirf naam dikhega)</label><input type="text" data-bf="rightIcon" value="' + esc(b.rightIcon || '') + '" placeholder="tata" /></div>' +
      '</div>' +
      '<div class="acard" style="margin-top:14px"><div class="m" style="font-weight:800;color:var(--ink);font-size:13px">Live preview</div>' +
      '<div class="topbar" style="position:static;margin-top:10px;border-radius:14px;overflow:hidden"><div class="topbar-inner" style="grid-template-columns:1fr auto 1fr;padding:12px">' +
      '<div class="brand"><span class="logo">' + ICON(b.logoIcon || 'shield') + '</span><span class="nm">' + esc(b.leftName || '') + '</span></div>' +
      '<div class="portal-title"><span class="shield">' + ICON('shield') + '</span><h1 style="font-size:22px">' + esc(b.title || '') + '</h1></div>' +
      '<div class="brand right"><span class="nm">' + esc(b.rightName || '') + '</span>' + (b.rightIcon ? '<span class="logo">' + ICON(b.rightIcon) + '</span>' : '') + '</div>' +
      '</div></div></div>';
  }

  /* ---------------------------------------------------------- support pane */
  function paneSupport() {
    var s = D.support || (D.support = {});
    return '<div class="hint">Footer ka <b>SUPPORT</b> section — user is par click karega to aapka naam aur mobile number popup me dikhega ' +
      '(Call / WhatsApp / Copy buttons ke saath). Neeche wala box portal jaisa hi dikhega.</div>' +
      '<div class="grid3">' +
      fld('Footer me dikhana hai?', '<label class="switch"><input type="checkbox" data-suf="enabled" ' + (s.enabled === false ? '' : 'checked') + ' /> Support block</label>') +
      fld('Heading', '<input type="text" data-suf="heading" value="' + esc(s.heading || '') + '" />') +
      fld('Line 1', '<input type="text" data-suf="line1" value="' + esc(s.line1 || '') + '" />') +
      fld('Aapka naam', '<input type="text" data-suf="name" value="' + esc(s.name || '') + '" />') +
      fld('Mobile number', '<input type="text" data-suf="mobile" value="' + esc(s.mobile || '') + '" placeholder="9177785011" />') +
      fld('Alternate number', '<input type="text" data-suf="altMobile" value="' + esc(s.altMobile || '') + '" />') +
      fld('Email (optional)', '<input type="text" data-suf="email" value="' + esc(s.email || '') + '" placeholder="name@company.com" />') +
      fld('Developer name (footer left)', '<input type="text" data-suf="developer" value="' + esc(s.developer || '') + '" />') +
      fld('Popup me extra note', '<input type="text" data-suf="note" value="' + esc(s.note || '') + '" />') +
      '</div>' +
      '<div class="footer" style="border-radius:16px;overflow:hidden;margin-top:14px"><div class="footer-inner" style="grid-template-columns:1fr"><div class="dev">Design and development by <span class="hl">' + esc(s.developer || s.name || '—') + '</span></div>' +
      '<div class="sup"><div class="support-btn" style="cursor:default"><span class="sh">' + ICON('chat') + '</span><span>' +
      '<span class="hd">' + esc(s.heading || 'SUPPORT') + '</span><p>' + esc(s.line1 || '') + '</p>' +
      '<p>Contact person : <b class="hl">' + esc(s.name || '—') + '</b> &nbsp;|&nbsp; Mob : <b>' + esc(s.mobile || '—') + '</b></p></span></div></div></div></div>';
  }


  /* ---------------------------------------------------------- cloud / supabase pane */
  function cfgJs(u, k, poll) {
    return '/* Safety Portal - backend config. Supabase ke 2 value bharne ke baad ye file\n' +
      '   index.html ke saath hi host kariye. (Admin panel -> Cloud tab se bani hai) */\n' +
      "window.SP_BACKEND = {\n" +
      "  mode: 'supabase',\n" +
      "  supabaseUrl: '" + String(u || '').replace(/'/g, '') + "',\n" +
      "  supabaseAnonKey: '" + String(k || '').replace(/'/g, '') + "',\n" +
      "  pollSeconds: " + (Number(poll) || 25) + "\n" +
      "};\n" +
      "try {\n" +
      "  var _ov = JSON.parse(localStorage.getItem('sp_backend_override') || 'null');\n" +
      "  if (_ov) { for (var _k in _ov) window.SP_BACKEND[_k] = _ov[_k]; }\n" +
      "} catch (e) {}\n";
  }
  function paneCloud() {
    var BE = SP.BE || {}, m = SP.mode();
    var pill = m === 'supabase'
      ? (SP.server ? '<span class="tag live">SUPABASE — connected</span>' : '<span class="tag off">SUPABASE — offline/cached</span>')
      : (SP.server ? '<span class="tag live">NODE SERVER</span>' : '<span class="tag off">LOCAL MODE (sirf ye browser)</span>');
    var kv = BE.url || '', av = BE.key || '', pv = BE.poll || 25;
    return '<div class="hint">Do tarike: <b>A) Supabase (recommended, global)</b> — database + login Supabase me, page kisi bhi static host par chalta hai (Supabase Storage / Netlify / Cloudflare Pages), koi server nahi. ' +
      '<b>B) Node server</b> — <span class="mono">node server.js</span> + <span class="mono">data/config.json</span>. ' +
      '<b>mode:\'auto\'</b> ka matlab: Node server mile to wahi, na mile (static host) to Supabase. Hamesha cloud chahiye to config.js me <span class="mono">mode: \'supabase\'</span> likh dijiye.</div>' +
      '<div class="sec-tools" style="margin-bottom:12px"><h4>Abhi ka status</h4>' + pill +
      '<span class="tip">' + (BE.url ? 'URL: <span class="mono">' + esc(BE.url) + '</span>' : 'URL set nahi kiya') +
      (BE.email ? ' · user: <span class="mono">' + esc(BE.email) + '</span>' : '') +
      (BE.updatedAt ? ' · last publish: <b>' + esc(new Date(BE.updatedAt).toLocaleString()) + '</b>' : ' · row: ' + (BE.hasRow === false ? 'abhi nahi bani' : '?')) + '</span></div>' +
      '<div id="cloud-st"></div>' +
      '<div class="grid3">' +
      fld('Supabase Project URL', '<input type="text" id="cu" value="' + esc(kv) + '" placeholder="https://abcdefghijklmno.supabase.co" />') +
      fld('anon / publishable key', '<input type="text" id="ck" value="' + esc(av) + '" placeholder="eyJhbGciOi..." />', 'Sirf public key — service_role key KABHI na daaliye.') +
      fld('Poll (second, 0 = off)', '<input type="text" id="cp" value="' + esc(pv) + '" maxlength="4" />', 'Dusre admin ne publish kiya ho to itne second me page khud refresh.') +
      '</div>' +
      '<div class="acts" style="margin-top:14px">' +
      '<button class="btn pri" data-act="cloud-test">' + ICON('refresh') + ' Save &amp; test (isi browser me)</button>' +
      '<button class="btn gho" data-act="cloud-check">' + ICON('eye') + ' Connection check</button>' +
      '<button class="btn grn" data-act="cloud-dl">' + ICON('download') + ' config.js download</button>' +
      '<button class="btn gho" data-act="cloud-publish">' + ICON('upload') + ' Abhi ka config cloud par publish</button>' +
      '<button class="btn dan" data-act="cloud-clear">' + ICON('x') + ' Browser override hatao</button>' +
      '</div>' +
      '<div class="acard" style="margin-top:16px"><div class="t" style="font-size:13.5px">Supabase setup — 4 step</div><ol class="tip" style="margin:8px 0 0 18px;line-height:1.9">' +
      '<li><b>SQL:</b> Supabase Dashboard → SQL Editor → New query → <span class="mono">supabase-setup.sql</span> ka poora content paste karke RUN (table + RLS + click counter + 7-section seed).</li>' +
      '<li><b>User:</b> Authentication → Users → <i>Add user</i> (email + password) — aur <i>Providers → Email</i> me <b>Confirm email OFF</b> rakhiye (warna login pehle verify maangega).</li>' +
      '<li><b>Key:</b> Project Settings → API → <span class="mono">Project URL</span> + <span class="mono">anon public</span> key upar daaliye → <i>Save &amp; test</i> → sab sahi to <i>config.js download</i>.</li>' +
      '<li><b>Host:</b> <span class="mono">index.html</span>, <span class="mono">config.js</span>, <span class="mono">css/</span>, <span class="mono">js/</span> ko Supabase Storage (public bucket <span class="mono">portal</span>) ya Netlify/Cloudflare Pages par daal dijiye — bas, global link ready.</li>' +
      '</ol><p class="tip" style="margin-top:8px">⚠ Anon key public hai isliye <b>RLS policy</b> hi security hai: sab padh sakte hain, likhna sirf logged-in admin. Seedha <span class="mono">curl</span> se bhi wahi policy lagegi.</p></div>' +
      '<div class="acard" style="margin-top:12px"><div class="t" style="font-size:13.5px">Ek aur option: single-file</div>' +
      '<p class="tip" style="margin-top:6px">Agar pura folder host nahi karna, to <span class="mono">safety-portal-demo.html</span> (ek file) use kariye. Supabase values usme inline kar dunga — bata dijiye.</p></div>';
  }

  /* ---------------------------------------------------------- stats pane */
  function paneStats() {
    var rows = [];
    (D.sections || []).forEach(function (s) {
      (s.items || []).forEach(function (i) { rows.push({ sec: s.title, label: i.label, url: i.url, id: i.id }); });
    });
    return '<div class="hint">Kaun sa button kitni baar click hua — portal ke click counter se. (Iframe-ke-andar wale pages ke apne counts nahi aate.)</div>' +
      '<div id="stats-box"><p class="tip">Load ho raha hai…</p></div>';
  }
  function loadStats() {
    var box = document.getElementById('stats-box'); if (!box) return;
    var get = SP.server ? api('/api/admin/stats') : Promise.resolve({ stats: JSON.parse(localStorage.getItem('sp_stats') || '{}') });
    get.then(function (r) {
      var st = r.stats || {};
      var rows = [];
      (D.sections || []).forEach(function (s) {
        (s.items || []).forEach(function (i) {
          rows.push({ n: st[i.id] || 0, sec: s.title, label: i.label, live: !!(i.url && i.live !== false) });
        });
        if (s.type === 'search') rows.push({ n: st['search-' + s.id] || 0, sec: s.title, label: '(search box)', live: !!(s.search && s.search.urlTemplate) });
      });
      rows.sort(function (a, b) { return b.n - a.n; });
      var totalLive = rows.filter(function (x) { return x.live; }).length;
      box.innerHTML = '<div class="stats" style="margin-bottom:14px">' +
        stat(rows.reduce(function (a, b) { return a + b.n; }, 0), 'Total clicks') +
        stat(totalLive, 'Live links') + stat(rows.length - totalLive, 'Not configured') + stat((D.sections || []).length, 'Sections') + '</div>' +
        '<div class="acard"><table class="tbl"><tr><th>Clicks</th><th>Section</th><th>Button</th><th>Status</th></tr>' +
        rows.map(function (x) { return '<tr><td class="mono">' + x.n + '</td><td>' + esc(x.sec) + '</td><td>' + esc(x.label) + '</td><td><span class="tag ' + (x.live ? 'live' : 'off') + '">' + (x.live ? 'live' : 'off') + '</span></td></tr>'; }).join('') +
        '</table></div>' +
        '<div class="sec-tools" style="margin-top:12px"><button class="btn sm dan" data-act="stats-reset">' + ICON('trash') + ' Counters reset</button></div>';
    }).catch(function (e) { box.innerHTML = '<p class="err show">' + esc(e.message) + '</p>'; });
  }
  function stat(n, l) { return '<div class="stat"><div class="n">' + n + '</div><div class="l">' + l + '</div></div>'; }

  /* ---------------------------------------------------------- security pane */
  function paneSec() {
    if (SP.isSupa()) {
      var be = SP.BE || {};
      return '<div class="hint">Supabase mode me login aapke <b>Supabase user</b> se hota hai (Authentication → Users). Neeche se password turant badal sakto ho; ya Dashboard se bhi. ' +
        'Zyada security ke liye Supabase → Authentication → Providers me <b>email confirmation ON</b> aur rate limits dekh lijiye.</div>' +
        '<div class="acard" style="margin-bottom:12px"><div class="m">Logged in as</div><div class="t" style="font-size:15px">' + esc(be.email || '(email nahi mila — dobara login kariye)') + '</div>' +
        '<div class="m" style="margin-top:4px">Project: <span class="mono">' + esc(be.url || '—') + '</span></div></div>' +
        '<div class="grid2">' +
        fld('Naya password', '<input type="password" id="pw-new" autocomplete="new-password" placeholder="kam se kam 6 character" />') +
        fld('Naya password dobara', '<input type="password" id="pw-new2" autocomplete="new-password" />') +
        '</div>' +
        '<div class="acts" style="margin-top:14px"><button class="btn pri" data-act="pw-change">' + ICON('lock') + ' Password badlein</button><span class="tip" id="pw-msg"></span></div>' +
        '<div class="hint" style="margin-top:16px">Note: <b>Current password ki zarurat nahi</b> — Supabase logged-in session se hi update hota hai. Agar kisi aur ko admin banana ho to Supabase Dashboard me ek aur user banaiye; RLS policy <span class="mono">authenticated</span> role ko likhne deti hai.</div>';
    }
    return '<div class="hint">Admin panel ka password. Isko default (<span class="mono">admin@123</span>) se zaroor badal dijiye — panel se poora portal control hota hai.</div>' +
      (mustChange ? '<div class="sup-note" style="margin-bottom:12px">⚠ Aap abhi bhi default password use kar rahe hain.</div>' : '') +
      '<div class="grid3">' +
      fld('Current password', '<input type="password" id="pw-cur" autocomplete="current-password" />') +
      fld('Naya password', '<input type="password" id="pw-new" autocomplete="new-password" placeholder="kam se kam 6 character" />') +
      fld('Naya password dobara', '<input type="password" id="pw-new2" autocomplete="new-password" />') +
      '</div>' +
      '<div class="acts" style="margin-top:14px"><button class="btn pri" data-act="pw-change">' + ICON('lock') + ' Password badlein</button>' +
      '<span class="tip" id="pw-msg"></span></div>' +
      '<div class="acard" style="margin-top:16px"><div class="t" style="font-size:13.5px">Server side settings (optional)</div>' +
      '<p class="tip" style="margin-top:6px">Password server par <span class="mono">data/config.json</span> me hash hoke save hota hai — plain text me kahin nahi. ' +
      'Reset karne ke liye: server band kariye, fir <span class="mono">ADMIN_PASSWORD=NayaPass node server.js</span> chalayein.</p></div>';
  }

  /* ---------------------------------------------------------- backup pane */
  function paneBak() {
    return '<div class="hint">Poora portal config ek JSON file hai (<span class="mono">data/config.json</span>). Naye server par le jaane ke liye export/import, ya backup rakhiye.</div>' +
      '<div class="acts">' +
      '<button class="btn pri" data-act="export">' + ICON('download') + ' Backup download (.json)</button>' +
      '<button class="btn gho" data-act="copy">' + ICON('clipboard') + ' JSON copy</button>' +
      '<button class="btn gho" data-act="dl-json">' + ICON('file') + ' config.json dekho</button>' +
      '</div>' +
      '<div class="grid2" style="margin-top:14px">' +
      '<div class="fld"><label>JSON paste karke import</label><textarea id="imp-ta" rows="10" placeholder=\'{"brand":...,"sections":[...]}\'></textarea>' +
      '<span class="tip">Purana backup yahin paste karke “Import” dabaiye.</span></div>' +
      '<div class="fld"><label>File se import</label><input type="file" id="imp-file" accept=".json,application/json" />' +
      '<div class="acts" style="margin-top:10px"><button class="btn dan" data-act="import">' + ICON('upload') + ' Import karo</button>' +
      '<button class="btn gho" data-act="demo-reset">' + ICON('refresh') + ' Demo sample reset</button></div>' +
      '<span class="tip" style="display:block;margin-top:8px">⚠ Import se abhi ka config replace ho jayega.</span></div></div>' +
      '<div class="acard" style="margin-top:16px"><div class="t" style="font-size:13.5px">Excel se data lana</div>' +
      '<p class="tip" style="margin-top:6px">Excel me 2 column banaiye — <b>Button name</b> aur <b>URL</b> — dono copy karke neeche paste kariye, automatic rows ban jayenge ' +
      '(ek line = ek button, format: <span class="mono">Section | Button | URL</span>).</p>' +
      '<textarea id="bulk-ta" rows="7" placeholder="Command Centre | Real-time Dashboard | https://...\nCommand Centre | Violation Entry | https://...\nSOP | Weigh Bridge | https://..."></textarea>' +
      '<div class="acts" style="margin-top:10px"><button class="btn grn" data-act="bulk">' + ICON('plus') + ' Import these rows</button></div></div>';
  }

  /* ---------------------------------------------------------- events */
  function onPanelClick(e) {
    var tb = e.target.closest('[data-tab]');
    if (tb) { tab = tb.dataset.tab; renderTab(); if (tab === 'stats') loadStats(); return; }
    if (e.target.closest('[data-act="tab-cloud"]')) { e.target.closest('.x') || 0; document.getElementById('veil-admin').innerHTML = panelHTML(); tab = 'cloud'; renderTab(); return; }

    var col = e.target.closest('[data-color]');
    if (col) {
      var card0 = col.closest('[data-s]'); var sec0 = D.sections[+card0.dataset.s];
      sec0.color = col.dataset.color;
      col.parentNode.querySelectorAll('[data-color]').forEach(function (b) { b.classList.toggle('on', b === col); });
      var sw = card0.querySelector('.swatch');
      if (sw) { var p2 = SP.pal(sec0.color); sw.style.background = 'linear-gradient(135deg,' + p2.c + ',' + p2.c2 + ')'; }
      var cd0 = card0.closest('.acard'); if (cd0) { var ps = SP.pal(sec0.color); cd0.setAttribute('style', ''); }
      SP.render(); mark(); return;
    }
    var ic = e.target.closest('[data-icon]');
    if (ic) {
      var host = ic.closest('[data-iconfor]');
      var kind = host ? host.getAttribute('data-iconfor') : 'sec';
      if (kind === 'brand' || kind === 'brand2') {
        D.brand[kind === 'brand' ? 'logoIcon' : 'rightIcon'] = ic.dataset.icon;
        host.querySelectorAll('[data-icon]').forEach(function (b) { b.classList.toggle('on', b === ic); });
        var inp = ic.closest('.acard, .adm-body') ;
        var fldInp = host.closest('.adm-body').querySelector('[data-bf="' + (kind === 'brand' ? 'logoIcon' : 'rightIcon') + '"]');
        if (fldInp) fldInp.value = ic.dataset.icon;
        mark(); renderTab(); SP.render(); return;
      }
      var card = ic.closest('[data-s]'); var sec = D.sections[+card.dataset.s];
      var itRow = ic.closest('[data-i]');
      var target = itRow ? sec.items[+itRow.dataset.i] : sec;
      target.icon = ic.dataset.icon;
      host.querySelectorAll('[data-icon]').forEach(function (b) { b.classList.toggle('on', b === ic); });
      if (!itRow) { var sw2 = card.querySelector('.ah > .swatch'); if (sw2) sw2.innerHTML = ICON(target.icon); }
      var txt = host.closest('.more') && host.closest('.more').querySelector('[data-if="icon"],[data-f="icon"]');
      if (txt) txt.value = target.icon;
      mark(); SP.render(); return;
    }

    var act = e.target.closest('[data-act]');
    if (!act) return;
    var a = act.dataset.act;
    var host = act.closest('[data-s]');
    var si = host ? +host.dataset.s : -1;
    var itemHost = act.closest('[data-i]');
    var ii = itemHost ? +itemHost.dataset.i : -1;
    var chHost = act.closest('[data-c]');
    var ci = chHost ? +chHost.dataset.c : -1;

    switch (a) {
      case 'close': close(); break;
      case 'login': doLogin(); break;
      case 'logout': doLogout(); break;
      case 'preview': close(); window.scrollTo({ top: 0, behavior: 'smooth' }); break;
      case 'save': save(); break;
      case 'reload': D = JSON.parse(JSON.stringify(SP.config || { sections: [] })); dirty = false; renderTab(); toast('Unsaved change discard ho gaye.', 'refresh'); break;
      case 'sec-add':
        D.sections.push({ id: 'sec-' + Math.random().toString(36).slice(2, 8), n: D.sections.length + 1, title: 'NEW SECTION', icon: 'link', color: 'slate', type: 'list', url: '', visible: true, prefix: 'letters', note: '', search: { placeholder: 'Search...', urlTemplate: '', buttonLabel: 'SEARCH', icon: 'search', help: '' }, items: [] });
        mark(); renderTab(); setTimeout(function () {
          var c = document.querySelectorAll('.acard'), el = c.length && c[c.length - 1];
          if (el) { if (el.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
        }, 60);
        break;
      case 'sec-del':
        if (!confirm('Ye section aur uske saare button delete ho jayenge. Aage badhayein?')) return;
        D.sections.splice(si, 1); renum(); mark(); renderTab(); break;
      case 'sec-up': swap(si, si - 1, 'section'); break;
      case 'sec-down': swap(si, si + 1, 'section'); break;
      case 'sec-copy':
        var cp = JSON.parse(JSON.stringify(D.sections[si])); cp.id = 'sec-' + Math.random().toString(36).slice(2, 8); cp.title = cp.title + ' (copy)';
        cp.items.forEach(function (x) { x.id = 'i' + Math.random().toString(36).slice(2, 8); });
        D.sections.splice(si + 1, 0, cp); renum(); mark(); renderTab(); break;
      case 'sec-vis': D.sections[si].visible = D.sections[si].visible === false; mark(); renderTab(); break;
      case 'sec-toggle-all': D.sections.forEach(function (x) { x.visible = act.dataset.on === '1'; }); mark(); renderTab(); break;
      case 'it-add':
        (D.sections[si].items = D.sections[si].items || []).push({ id: 'i' + Math.random().toString(36).slice(2, 8), label: 'New button', url: '', icon: 'link', openIn: 'new', note: '', visible: true, children: [] });
        mark(); renderTab(); break;
      case 'it-add-sub':
        var arr = D.sections[si].items = D.sections[si].items || [];
        arr.push({ id: 'i' + Math.random().toString(36).slice(2, 8), label: 'New', url: '', icon: 'link', openIn: 'new', note: '', visible: true, children: [] });
        arr.push({ id: 'i' + Math.random().toString(36).slice(2, 8), label: 'New 2', url: '', icon: 'link', openIn: 'new', note: '', visible: true, children: [] });
        mark(); renderTab(); break;
      case 'it-del': D.sections[si].items.splice(ii, 1); mark(); renderTab(); break;
      case 'it-up': swap(ii, ii - 1, 'item', si); break;
      case 'it-down': swap(ii, ii + 1, 'item', si); break;
      case 'it-live':
        var it = D.sections[si].items[ii];
        if (!it.url) { toast('Pehle URL bhariye — tabhi live hoga.', 'link'); break; }
        it.live = it.live === false; mark(); renderTab(); break;
      case 'ch-add': (D.sections[si].items[ii].children = D.sections[si].items[ii].children || []).push({ id: 'c' + Math.random().toString(36).slice(2, 7), label: 'Sub link', url: '', icon: 'right', openIn: 'new' }); mark(); renderTab(); break;
      case 'ch-del': D.sections[si].items[ii].children.splice(ci, 1); mark(); renderTab(); break;
      case 'ch-up': swapChild(ii, ci, ci - 1, si); break;
      case 'ch-down': swapChild(ii, ci, ci + 1, si); break;
      case 'pw-change': changePw(act); break;
      case 'cloud-test':
        var uu = (document.getElementById('cu').value || '').trim().replace(/\/+$/, ''), kk = (document.getElementById('ck').value || '').trim(), pp = (document.getElementById('cp').value || '25').trim();
        if (!/^https:\/\/[a-z0-9.-]+\.supabase\.(co|in|net)$/i.test(uu) && !/^https:\/\//i.test(uu)) { toast('URL https://...xyz.supabase.co jaisa hona chahiye.', 'alert'); break; }
        if (kk.length < 30) { toast('anon key chhota lag raha hai — Project Settings → API se poori copy kariye.', 'alert'); break; }
        try {
          localStorage.setItem('sp_backend_override', JSON.stringify({ mode: 'supabase', supabaseUrl: uu, supabaseAnonKey: kk, pollSeconds: Number(pp) || 25 }));
          toast('Override save ho gaya — page reload kar raha hoon…', 'refresh');
          setTimeout(function () { location.reload(); }, 700);
        } catch (e) { toast('Save fail: ' + e.message, 'alert'); }
        break;
      case 'cloud-clear':
        try { localStorage.removeItem('sp_backend_override'); toast('Override hata diya — reload…', 'refresh'); setTimeout(function () { location.reload(); }, 600); } catch (e) {}
        break;
      case 'cloud-dl':
        var u2 = (document.getElementById('cu').value || '').trim(), k2 = (document.getElementById('ck').value || '').trim(), p2 = (document.getElementById('cp').value || '25').trim();
        var blob = new Blob([cfgJs(u2, k2, p2)], { type: 'text/javascript' });
        var a3 = document.createElement('a'); a3.href = URL.createObjectURL(blob); a3.download = 'config.js'; document.body.appendChild(a3); a3.click();
        setTimeout(function () { URL.revokeObjectURL(a3.href); a3.remove(); }, 1500);
        toast('config.js download ho gaya — index.html ke saath host kariye.', 'check');
        break;
      case 'cloud-publish':
        SP.api('/api/admin/config', 'PUT', { config: D }).then(function (r) {
          SP.config = r.config; D = JSON.parse(JSON.stringify(r.config)); SP.render(); dirty = false; renderTab();
          toast(r.savedAt ? ('Cloud par publish ho gaya (' + new Date(r.savedAt).toLocaleTimeString() + ')') : 'Cloud par publish ho gaya.', 'check');
        }).catch(function (e) { toast('Publish fail: ' + e.message, 'alert'); });
        break;
      case 'cloud-check': cloudCheck(); break;
      case 'stats-reset':
        if (!confirm('Saare click counters 0 kar dein?')) return;
        api('/api/admin/stats', 'POST').then(function () { toast('Counters reset.', 'check'); loadStats(); }); break;
      case 'export':
        if (SP.isSupa() || !SP.server) {
          SP.api('/api/admin/export').then(function (res) {
            var blob = new Blob([JSON.stringify({ config: res.config || D, stats: res.stats || {}, exportedAt: new Date().toISOString() }, null, 2)], { type: 'application/json' });
            var a2 = document.createElement('a'); a2.href = URL.createObjectURL(blob); a2.download = 'safety-portal-backup.json';
            document.body.appendChild(a2); a2.click(); setTimeout(function () { URL.revokeObjectURL(a2.href); a2.remove(); }, 1500);
            toast('Backup download ho gaya.', 'check');
          }).catch(function (e) { toast('Export fail: ' + e.message, 'alert'); });
        } else window.open('api/admin/export', '_blank');
        break;
      case 'dl-json': navigator.clipboard && navigator.clipboard.writeText(JSON.stringify(D, null, 2)).then(function () { toast('Config JSON clipboard par copy ho gaya.', 'check'); }); break;
      case 'copy': navigator.clipboard.writeText(JSON.stringify(D, null, 2)).then(function () { toast('Copied.', 'check'); }, function () { toast('Copy fail — textarea use kariye.', 'alert'); }); break;
      case 'import': doImport(); break;
      case 'bulk': doBulk(); break;
      case 'demo-reset':
        if (!confirm('Sample/demo config par wapas jayein? Abhi ka draft override ho jayega (Save dabane tak publish nahi hoga).')) return;
        D.sections = seedSections(); renum(); mark(); renderTab(); break;
    }
  }
  function renum() { D.sections.forEach(function (s, i) { s.n = i + 1; }); }
  function swap(from, to, kind, si) {
    if (kind === 'section') {
      if (to < 0 || to >= D.sections.length) return;
      var t = D.sections[from]; D.sections[from] = D.sections[to]; D.sections[to] = t; renum();
    } else {
      var arr = D.sections[si].items; if (to < 0 || to >= arr.length) return;
      var t2 = arr[from]; arr[from] = arr[to]; arr[to] = t2;
    }
    mark(); renderTab();
  }
  function swapChild(ii, ci, to, si) {
    var arr = D.sections[si].items[ii].children; if (to < 0 || to >= arr.length) return;
    var t = arr[ci]; arr[ci] = arr[to]; arr[to] = t; mark(); renderTab();
  }

  /* input / change (typing) */
  function onPanelInput(e) {
    var t = e.target;
    if (t.id === 'adm-pw' && e.type === 'keydown' && e.key === 'Enter') { doLogin(); return; }
    if (t.tagName === 'INPUT' && t.type === 'password') return;
    var sCard = t.closest('[data-s]');
    if (sCard) {
      var si = +sCard.dataset.s, sec = D.sections[si];
      var iRow = t.closest('[data-i]'), cRow = t.closest('[data-c]');
      if (iRow && t.dataset.if) {
        var ii = +iRow.dataset.i, it = sec.items[ii], f = t.dataset.if;
        if (f === 'visible' || f === 'live') it[f] = t.checked;
        else it[f] = t.value;
        if (f === 'url') it.live = !!t.value.trim();
        dirty = true;
        // live badge update without full re-render
        var rowEl = t.closest('.row');
        var badge = rowEl && rowEl.querySelector('[data-act="it-live"]');
        if (badge && (f === 'url' || f === 'live')) {
          var live2 = !!it.url && it.live !== false;
          badge.textContent = live2 ? 'LIVE' : 'OFF'; badge.classList.toggle('on', live2);
        }
        updateSaveState(); return;
      }
      if (cRow && t.dataset.cf) {
        var ch = sec.items[+iRow.dataset.i].children[+cRow.dataset.c];
        ch[t.dataset.cf] = t.value; dirty = true; updateSaveState(); return;
      }
      if (t.dataset.f) { sec[t.dataset.f] = t.value; dirty = true; updateSaveState(); return; }
      if (t.dataset.sf) { (sec.search = sec.search || {})[t.dataset.sf] = t.value; dirty = true; updateSaveState(); return; }
    }
    if (t.dataset.bf) { (D.brand = D.brand || {})[t.dataset.bf] = t.value; dirty = true; updateSaveState(); return; }
    if (t.dataset.suf) {
      (D.support = D.support || {});
      D.support[t.dataset.suf] = t.type === 'checkbox' ? t.checked : t.value;
      dirty = true; updateSaveState(); return;
    }
  }
  function updateSaveState() {
    var bar = document.getElementById('savebar'); if (!bar) return;
    bar.classList.add('dirty');
    bar.querySelector('.st').innerHTML = '● Badlav save nahi hua';
  }

  /* password */
  function changePw(btn) {
    var msg = document.getElementById('pw-msg');
    var curEl = document.getElementById('pw-cur');
    var cur = curEl ? curEl.value : '', n1 = document.getElementById('pw-new').value, n2 = document.getElementById('pw-new2').value;
    msg.textContent = '';
    if (n1 !== n2) { msg.textContent = 'Naya password dono jagah same nahi hai.'; return; }
    if (n1.length < 6) { msg.textContent = 'Kam se kam 6 character.'; return; }
    if (!SP.server) { localStorage.setItem('sp_pw_local', n1); mustChange = false; msg.textContent = 'Local password badal gaya ✓'; toast('Password update.', 'check'); return; }
    btn.disabled = true;
    api('/api/admin/change-password', 'POST', { current: cur, next: n1 }).then(function () {
      mustChange = false; msg.textContent = 'Password badal gaya ✓';
      if (!SP.isSupa()) renderTab(); else { ['pw-new', 'pw-new2'].forEach(function (i) { var e = document.getElementById(i); if (e) e.value = ''; }); }
      toast('Password update ho gaya.', 'check');
    }).catch(function (e) { msg.textContent = e.message; }).then(function () { btn.disabled = false; });
  }

  /* import / bulk */
  function doImport() {
    var ta = document.getElementById('imp-ta');
    var raw = ta.value.trim();
    if (!raw) { toast('Pehle JSON paste kariye ya file chuniye.', 'alert'); return; }
    var obj;
    try { obj = JSON.parse(raw); } catch (e) { toast('JSON me galti: ' + e.message, 'alert'); return; }
    var cfg = obj.config || obj;
    if (!cfg.sections) { toast('Is file me "sections" nahi mila.', 'alert'); return; }
    D = cfg; dirty = true; renderTab();
    toast('Import ho gaya — ab Save & Publish dabaiye.', 'upload');
  }
  function doBulk() {
    var txt = document.getElementById('bulk-ta').value.trim();
    if (!txt) { toast('Textarea khali hai.', 'alert'); return; }
    var lines = txt.split(/\r?\n/).filter(function (l) { return l.trim() && !/^[A-Za-z ]*(button|name)[\t| ]+url/i.test(l); });
    D.sections = D.sections || [];
    var added = 0;
    lines.forEach(function (ln) {
      var parts = ln.split(/\t|\s*\|\s*/).map(function (x) { return x.trim(); });
      if (parts.length < 2) return;
      var secName, label, url;
      if (parts.length >= 3) { secName = parts[0]; label = parts[1]; url = parts[2]; }
      else { label = parts[0]; url = parts[1]; secName = 'IMPORTED'; }
      var sec = D.sections.filter(function (s) { return s.title.toLowerCase() === secName.toLowerCase(); })[0];
      if (!sec) { sec = { id: 'sec-' + Math.random().toString(36).slice(2, 8), n: D.sections.length + 1, title: secName, icon: 'link', color: 'slate', type: 'list', url: '', visible: true, prefix: 'letters', note: '', search: null, items: [] }; D.sections.push(sec); }
      sec.items.push({ id: 'i' + Math.random().toString(36).slice(2, 8), label: label, url: /^https?:\/\//i.test(url) ? url : '', icon: 'link', openIn: 'new', note: '', visible: true, children: [], live: !!url });
      added++;
    });
    renum(); mark(); renderTab();
    toast(added + ' rows import ho gaye (' + D.sections.length + ' sections). Save kariye.', added ? 'check' : 'alert');
  }
  function seedSections() {
    function mk(label, icon) { return { id: 'i' + Math.random().toString(36).slice(2, 7), label: label, url: '', icon: icon, openIn: 'new', note: '', visible: true, children: [], live: false }; }
    return [
      { id: 's1', n: 1, title: 'IMPORTANT LINKS', icon: 'link', color: 'indigo', type: 'list', url: '', visible: true, prefix: 'letters', note: '', search: null, items: [mk('Safety Policy & Manual', 'book')] },
      { id: 's2', n: 2, title: 'COMMAND CENTRE', icon: 'monitor', color: 'green', type: 'list', url: '', visible: true, prefix: 'letters', note: '', search: null, items: [mk('Real-time Dashboard', 'chart'), mk('Command Centre Violation Entry', 'clipboard')] },
      { id: 's3', n: 3, title: 'GLOBAL SAFETY OBSERVATION SYSTEM', icon: 'eye', color: 'blue', type: 'list', url: '', visible: true, prefix: 'letters', note: '', search: null, items: [mk('Violation Entry', 'cone'), mk('Review and Monitoring System', 'search')] },
      { id: 's4', n: 4, title: 'SAFETY MNGT SYSTEM', icon: 'helmet', color: 'orange', type: 'list', url: '', visible: true, prefix: 'letters', note: '', search: null, items: [mk('Conduct DM', 'gavel'), mk('VSPI', 'board'), mk('PPE MNGT System', 'goggles')] },
      { id: 's5', n: 5, title: 'EMPLOYEE SEARCH', icon: 'user-search', color: 'purple', type: 'search', url: '', visible: true, prefix: 'none', note: '', items: [], search: { placeholder: 'Search Employee ID / Name...', urlTemplate: '', buttonLabel: 'SEARCH', icon: 'search', help: 'Employee ID ya naam daaliye, phir ENTER.' } },
      { id: 's6', n: 6, title: 'INCIDENT SHARING AND LEARNING', icon: 'alert', color: 'red', type: 'list', url: '', visible: true, prefix: 'letters', note: '', search: null, items: [mk('NEAR MISS INTERNAL', 'impact'), mk('LTI / FATAL and other TSL OR NON TSI Incident', 'report')] },
      { id: 's7', n: 7, title: 'SOP', icon: 'book-open', color: 'teal', type: 'grid', url: '', visible: true, prefix: 'letters', note: '', search: null, items: [mk('TRANSPORT PARK', 'truck'), mk('Weigh Bridge', 'scale'), mk('All Weigh bridge', 'scale'), mk('All equipment', 'gear'), mk('scrap yard', 'recycle')] }
    ];
  }

  /* file input -> textarea */
  document.addEventListener('change', function (e) {
    if (e.target.id === 'imp-file' && e.target.files && e.target.files[0]) {
      var fr = new FileReader();
      fr.onload = function () { document.getElementById('imp-ta').value = fr.result; toast('File padh li — ab “Import karo” dabaiye.', 'file'); };
      fr.readAsText(e.target.files[0]);
    }
  });

  async function cloudCheck() {
    var box = document.getElementById('cloud-st'); if (!box) return;
    box.innerHTML = '<div class="sup-note">Test chal raha hai…</div>';
    var out = [], okAll = true;
    try {
      var h = await SP.api('/api/health'); out.push(['Health', 'ok', h && h.backend ? h.backend : 'server']);
    } catch (e) { okAll = false; out.push(['Health', 'fail', e.message]); }
    try {
      var c = await SP.api('/api/config');
      if (c && c.config) out.push(['portal_config row', 'ok', (c.config.sections || []).length + ' section, updated ' + new Date(c.updatedAt || c.config.updatedAt || Date.now()).toLocaleString()]);
      else if (c && c.noRow) { okAll = false; out.push(['portal_config row', 'empty', 'abhi koi row nahi — neeche "publish" dabaiye ya SQL script chalaiye']); }
      else { okAll = false; out.push(['portal_config row', 'fail', 'kuch nahi mila']); }
    } catch (e) { okAll = false; out.push(['portal_config read', 'fail', e.message]); }
    try {
      var m = await SP.api('/api/admin/me'); out.push(['Login/token', 'ok', m.email || 'valid']);
    } catch (e) { out.push(['Login/token', 'note', e.message + ' (admin panel kholne ke liye login kariye)']); }
    box.innerHTML = '<div class="acard"><table class="tbl"><tr><th>Check</th><th>Status</th><th>Detail</th></tr>' +
      out.map(function (r) { return '<tr><td>' + esc(r[0]) + '</td><td><span class="tag ' + (r[1] === 'ok' ? 'live' : r[1] === 'note' ? 'how' : 'off') + '">' + esc(r[1]) + '</span></td><td class="tip">' + esc(String(r[2] || '')) + '</td></tr>'; }).join('') +
      '</table></div>' + (okAll ? '<p class="tip" style="margin-top:8px;color:#1f7a3d">✓ Sab theek — ab config.js download karke host kariye.</p>' : '<p class="tip" style="margin-top:8px;color:#b3222a">✗ Upar wali line(s) thik kariye — RLS/SQL script ya key check kariye.</p>');
  }

  window.SPAdmin = { open: open, save: save, cloudCheck: cloudCheck, gotoCloud: function () { var v = document.getElementById('veil-admin'); if (!v.classList.contains('show')) open(); tab = 'cloud'; if (v.querySelector('.adm-tabs')) renderTab(); } };
})();
