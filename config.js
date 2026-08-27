/* =============================================================
   SAFETY PORTAL — backend config   [ Supabase mode: LIVE ]
   =============================================================
   Supabase (qeuxfyklxtrpvwrszqsr) connected hai -> ek baar supabase-setup.sql chala lijiye,
   uske baad Admin panel ka har badlav SAB users ko dikhega (global, koi server nahi).
   mode:'auto' = cloud mile to Supabase, na mile to Node server (data/config.json).
   ============================================================= */
window.SP_BACKEND = {
  mode: 'auto',           // 'auto' = cloud (Supabase) ho to wahi, warna Node server. Sirf-cloud chahiye to 'supabase' likh dijiye.
  supabaseUrl: 'https://qeuxfyklxtrpvwrszqsr.supabase.co',
  supabaseAnonKey: 'sb_publishable_tIIhqk22d8gXYTRDREW4Uw_Bp0NaKko',
  pollSeconds: 20        // kisi aur admin ne publish kiya ho to itne second me page khud update
};

/* Admin panel → Cloud tab se "Test" dabane par localStorage ka override yahan lagta hai,
   taaki file edit karne se pehle try kar sakein. */
try {
  var _ov = JSON.parse(localStorage.getItem('sp_backend_override') || 'null');
  if (_ov) { for (var _k in _ov) window.SP_BACKEND[_k] = _ov[_k]; }
} catch (e) {}

/* Single-file / offline build me ye hota hai (normal use me khali chhodiye) */
// window.SP_SEED = { ... };
