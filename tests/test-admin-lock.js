// Test: zamknutí admin sekce při přepnutí/založení profilu.
// Spuštění: npm test  (výchozí zdroj: git show HEAD:index.html)
//           SRC_FILE=index.html npm test  (pracovní kopie)
const { execSync } = require('child_process');
const fs = require('fs');
const vm = require('vm');
const { JSDOM } = require('jsdom');

const path = require('path');
const REPO = path.resolve(__dirname, '..');
const src = process.env.SRC_FILE
  ? fs.readFileSync(path.resolve(REPO, process.env.SRC_FILE), 'utf8')
  : execSync('git show HEAD:index.html', { cwd: REPO, maxBuffer: 1 << 28 }).toString('utf8');

function extractFn(name) {
  const start = src.indexOf('function ' + name + '(');
  if (start < 0) return null;
  let i = src.indexOf('{', start), depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) break;
  }
  return src.slice(start, i + 1);
}

const FNS = ['updatePinDots', 'resetAdminView', 'lockAdmin', 'switchToProfile', 'createProfile'];

function makeEnv() {
  const dom = new JSDOM(`<body>
    <div id="admin-pin-view" style="display:none"></div>
    <div id="admin-panel-view"></div>
    <div id="pd0"></div><div id="pd1"></div><div id="pd2"></div><div id="pd3"></div>
    <div id="pin-error"></div>
    <div id="pin-change-wrap" class="pin-change-wrap"></div>
    <input id="new-pin-1"><input id="new-pin-2">
    <div id="adm-reset-confirm" class="admin-reset-confirm"></div>
    <input id="name-input">
  </body>`, { url: 'http://localhost/' });
  const ctx = vm.createContext({
    document: dom.window.document,
    localStorage: dom.window.localStorage,
    console,
  });
  const stubs = `
    var calls = [];
    let adminUnlocked = false;
    let pinBuffer = '';
    let currentUserId = 'A';
    let state = { user: { name: 'Dítě' } };
    function switchAdminTab(t) { calls.push('switchAdminTab:' + t); }
    function closeProfileMenu() {}
    function loadLocal() { currentUserId = localStorage.getItem('babylon_v3_last_user'); state = { user: { name: 'X' } }; }
    function renderProfileMenu() {}
    function showScreen(s) { calls.push('showScreen:' + s); }
    function renderAll() {}
    function checkWeeklyTaskEvaluation() {}
    function toast() {}
    function listProfiles() { return []; }
    function saveProfiles() {}
    function generateUserId() { return 'NEW'; }
    function userStorageKey(id) { return 'k_' + id; }
    function DEFAULT_STATE() { return { user: {} }; }
  `;
  vm.runInContext(stubs, ctx);
  for (const f of FNS) {
    const code = extractFn(f);
    if (code) vm.runInContext(code, ctx);
  }
  return { ctx, doc: dom.window.document, run: (c) => vm.runInContext(c, ctx) };
}

// Přivede prostředí do stavu "rodič odemčený, rozdělaná akce" na profilu A
function dirtyState(env) {
  const { doc, run } = env;
  run(`adminUnlocked = true; pinBuffer = '12';`);
  doc.getElementById('admin-pin-view').style.display = 'none';
  doc.getElementById('admin-panel-view').style.display = '';
  doc.getElementById('pd0').classList.add('filled');
  doc.getElementById('pd1').classList.add('filled');
  doc.getElementById('new-pin-1').value = '1234';
  doc.getElementById('new-pin-2').value = '12';
  doc.getElementById('pin-change-wrap').classList.add('visible');
  doc.getElementById('adm-reset-confirm').classList.add('show');
}

const locked = (env) => {
  const { doc, run } = env;
  return {
    'adminUnlocked === false': run('adminUnlocked') === false,
    'pin view zobrazen': doc.getElementById('admin-pin-view').style.display === '',
    'panel view skryt': doc.getElementById('admin-panel-view').style.display === 'none',
    "pinBuffer === ''": run('pinBuffer') === '',
    'PIN tečky zhasnuty': !doc.querySelectorAll('[id^=pd].filled').length,
    'new-pin-1 prázdné': doc.getElementById('new-pin-1').value === '',
    'new-pin-2 prázdné': doc.getElementById('new-pin-2').value === '',
    'pin-change-wrap zavřený': !doc.getElementById('pin-change-wrap').classList.contains('visible'),
    'adm-reset-confirm bez .show': !doc.getElementById('adm-reset-confirm').classList.contains('show'),
  };
};

const untouched = (env) => {
  const { doc, run } = env;
  return {
    'adminUnlocked === true': run('adminUnlocked') === true,
    "pinBuffer === '12'": run('pinBuffer') === '12',
    'panel view zůstal': doc.getElementById('admin-panel-view').style.display === '',
    'new-pin-1 zůstalo': doc.getElementById('new-pin-1').value === '1234',
    'pin-change-wrap zůstal otevřený': doc.getElementById('pin-change-wrap').classList.contains('visible'),
    'adm-reset-confirm .show zůstalo': doc.getElementById('adm-reset-confirm').classList.contains('show'),
  };
};

const scenarios = [
  ['1. přepnutí A→B po odemčení', (e) => { e.doc.getElementById('pin-error'); e.run(`adminUnlocked = true;`);
      e.doc.getElementById('admin-pin-view').style.display = 'none';
      e.doc.getElementById('admin-panel-view').style.display = '';
      e.run(`switchToProfile('B')`); }, locked, ['adminUnlocked === false', 'pin view zobrazen', 'panel view skryt']],
  ['2. rozepsaný PIN', (e) => { e.run(`pinBuffer = '12'`);
      e.doc.getElementById('pd0').classList.add('filled'); e.doc.getElementById('pd1').classList.add('filled');
      e.run(`switchToProfile('B')`); }, locked, ["pinBuffer === ''", 'PIN tečky zhasnuty']],
  ['3. vyplněná pole změny PINu', (e) => { e.doc.getElementById('new-pin-1').value = '1234';
      e.doc.getElementById('new-pin-2').value = '12';
      e.doc.getElementById('pin-change-wrap').classList.add('visible'); e.run(`switchToProfile('B')`); }, locked, ['new-pin-1 prázdné', 'new-pin-2 prázdné', 'pin-change-wrap zavřený']],
  ['4. otevřené potvrzení smazání', (e) => { e.doc.getElementById('adm-reset-confirm').classList.add('show');
      e.run(`switchToProfile('B')`); }, locked, ['adm-reset-confirm bez .show']],
  ['5. založení nového profilu (vše dohromady)', (e) => { dirtyState(e); e.run(`createProfile('Nový')`); }, locked, null],
  ['6. klik na AKTIVNÍ profil nezamyká', (e) => { dirtyState(e); e.run(`switchToProfile('A')`); }, untouched, null],
];

let failed = 0;
console.log('Zdroj:', process.env.SRC_FILE || 'git HEAD:index.html');
for (const [title, act, check, only] of scenarios) {
  const env = makeEnv();
  // 'A' je aktivní profil; localStorage last_user nastaví přepnutí samo
  act(env);
  let res = check(env);
  if (only) res = Object.fromEntries(only.map((k) => [k, res[k]]));
  const bad = Object.entries(res).filter(([, ok]) => !ok).map(([k]) => k);
  if (bad.length) failed++;
  console.log((bad.length ? 'FAIL ' : 'PASS ') + title + (bad.length ? '  ← ' + bad.join('; ') : ''));
}
console.log(failed ? `\n${failed} scénářů selhalo` : '\nVše prošlo');
process.exit(failed ? 1 : 0);
