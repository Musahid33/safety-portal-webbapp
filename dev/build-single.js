'use strict';
/* =============================================================================
   build-single.js — index.html + css/ + js/ + config.js ko ek hi file me jod
   deta hai: safety-portal-cloud.html (koi host nahi chahiye — file kholiye, chal
   jayega; Supabase values + seed config inline honge).

   Use:  node dev/build-single.js
         node dev/build-single.js --check     (diff dikhaaye, likhe nahi)

   ⚠ Ye script replace() me function-use karta hai (String '...' me $&, $1 jaise
     patterns expand ho jaate hain — pichhli build me isliye js/app.js ka
     '\\$&'  '\\</body>'  ban gaya tha, aur single-file ka search highlight toota hua tha).
   ============================================================================= */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'safety-portal-cloud.html');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

/* inline hone ke baad </script> text se HTML toot jaata hai -> escape karke join */
function safeJs(src) {
  return src.replace(/<\/script/gi, '<\\/script');
}

function build() {
  let html = read('index.html');

  // 1) CSS
  html = html.replace(/<link[^>]*href="(?:\.\/)?css\/styles\.css"[^>]*>\s*/i,
    () => '<style>\n' + read('css/styles.css').trim() + '\n</style>\n');

  // 2) config.js + seed (default-config.json) -> ek inline script
  const seed = read('default-config.json').trim();
  const cfgSrc = read('config.js')
    .replace(/^\s*window\.SP_SEED\s*=\s*[\s\S]*?;\s*$/m, '')     // placeholder line (agar ho)
    .replace(/\/\* Single-file[^]*?\*\/\s*(\/\/\s*window\.SP_SEED[^\n]*\n)?/g, '')
    .trim();
  html = html.replace(/<script[^>]*src="(?:\.\/)?config\.js"[^>]*>\s*<\/script>\s*/i,
    () => '<script>\n' + safeJs(cfgSrc) +
      '\n\n/* Single-file build: portal ka config yahin inline hai (cloud row na mile to ye chalega) */\n' +
      'window.SP_SEED = ' + seed + ';\n</script>\n');

  // 3) js files
  for (const f of ['icons.js', 'app.js', 'admin.js']) {
    html = html.replace(new RegExp('<script[^>]*src="(?:\\./)?js/' + f + '"[^>]*>\\s*</script>\\s*', 'i'),
      () => '<script>\n' + safeJs(read('js/' + f).trim()) + '\n</script>\n');
  }

  // 4) single file me apne-aap ko load karne wale tags bekaar hain
  html = html.replace(/<meta[^>]*name="repo"[^>]*>\s*/i, '');
  html = '<!doctype html>\n' + html.replace(/^<!doctype html>\s*/i, '').replace(/^<!doctype html>\s*/i, '');
  html = html.replace(/<html([^>]*)>/i, '<html$1>\n<!-- AUTO-BUILT FILE — source: index.html + css/ + js/ + config.js (dev/build-single.js se dobara banaiye) -->');
  return html;
}

const out = build();
if (process.argv.includes('--check')) {
  const cur = fs.existsSync(OUT) ? read('safety-portal-cloud.html') : '';
  if (cur === out) { console.log('✓ safety-portal-cloud.html sources se in-sync hai.'); process.exit(0); }
  console.log('✗ single-file build purana hai — node dev/build-single.js chalaiye');
  console.log('  (lines) current:', cur.split('\n').length, ' new:', out.split('\n').length);
  process.exit(1);
}
fs.writeFileSync(OUT, out);
console.log('✓ safety-portal-cloud.html ban gaya — ' + (out.length / 1024).toFixed(1) + ' KB, ' + out.split('\n').length + ' lines');
