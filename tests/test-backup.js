// Test: záloha (KROK 22) — obálka s ID profilu, bod obnovy, bezpečný import, týdenní snapshoty.
// Spuštění: npm test  (výchozí zdroj: git show HEAD:index.html)
//           SRC_FILE=index.html npm test  (pracovní kopie)
process.env.TZ = 'Europe/Prague';
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');

const REPO = path.resolve(__dirname, '..');
const src = process.env.SRC_FILE
  ? fs.readFileSync(path.resolve(REPO, process.env.SRC_FILE), 'utf8')
  : execSync('git show HEAD:index.html', { cwd: REPO, maxBuffer: 1 << 28 }).toString('utf8');

function extractFn(name) {
  let start = src.indexOf('function ' + name + '(');
  if (start < 0) return null;
  if (src.slice(start - 6, start) === 'async ') start -= 6;
  let i = src.indexOf('{', start), depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) break;
  }
  return src.slice(start, i + 1);
}
function extractDefaultState() {
  const start = src.indexOf('const DEFAULT_STATE = ');
  const end = src.indexOf('\n});', start);
  return src.slice(start, end + 4);
}
function extractVar(name) { // "var NAME = ...;" na jednom řádku
  const m = src.match(new RegExp('^var ' + name + ' = [^\\n]*;', 'm'));
  return m ? m[0] : null;
}

const VARS = ['BACKUP_FORMAT', 'BACKUP_SCHEMA', 'SNAP_MAX_WEEKLY', 'SNAP_MAX_RESTORE'];
const FNS = ['userStorageKey', 'listProfiles', 'saveProfiles', 'isValidSplit', 'normalizeSplit', 'ensureActiveProfile',
  'loadLocal', '_getWeekKey', 'slugName', 'getProfileStateForBackup', 'buildProfileBackup', 'buildAllBackup',
  'isPlausibleState', 'parseBackupFile', 'snapshotKey', 'listSnapshots', 'writeSnapshots', 'takeSnapshot',
  'ensureWeeklySnapshot', 'isPristineState', 'confirmRestore', 'applyRestore', 'importData', 'restoreSnapshot',
  'requestPersistentStorage', 'snapshotLabel', 'renderSnapshotList', '_localDateKey', 'exportData', 'exportAllData'];

function makeEnv(opts = {}) {
  const dom = new JSDOM(`<body>
    <input id="name-input">
    <div id="adm-snap-list"></div>
  </body>`, { url: 'http://localhost/' });
  const real = dom.window.localStorage;
  const fail = { snap: false, keys: new Set(), maxLen: Infinity };
  const storage = {
    getItem: (k) => real.getItem(k),
    removeItem: (k) => real.removeItem(k),
    setItem: (k, v) => {
      if (fail.snap && k.startsWith('babylon_v3_snap_')) throw new Error('QuotaExceededError');
      if (fail.keys.has(k)) throw new Error('QuotaExceededError');
      if (String(v).length > fail.maxLen && k.startsWith('babylon_v3_snap_')) throw new Error('QuotaExceededError');
      real.setItem(k, v);
    },
  };
  const log = { toasts: [], confirms: [], calls: [] };
  const ctx = vm.createContext({
    localStorage: storage, document: dom.window.document, console: { log() {}, error() {} },
    navigator: opts.navigator || {},
    __log: log, __confirmAnswer: true,
    confirm: (m) => { log.confirms.push(m); return ctx.__confirmAnswer; },
  });
  vm.runInContext(`
    var __NOW = null, __RealDate = Date;
    Date = class extends __RealDate {
      constructor(...a) { if (a.length === 0 && __NOW !== null) super(__NOW); else super(...a); }
      static now() { return __NOW !== null ? __NOW : __RealDate.now(); }
    };
    let currentUserId = null, driveFileId = null, clientId = null, adminUnlocked = false;
    function toast(m) { __log.toasts.push(m); }
    function renderAll() { __log.calls.push('renderAll'); }
    function renderProfileMenu() { __log.calls.push('renderProfileMenu'); }
    function showScreen(s) { __log.calls.push('showScreen:' + s); }
    function lockAdmin() { __log.calls.push('lockAdmin'); }
    function checkWeeklyTaskEvaluation() { __log.calls.push('checkWeeklyTaskEvaluation'); }
    function saveToDrive() { __log.calls.push('saveToDrive'); }
    let currentScreen = 'nadvorí';
    function downloadJson(obj, name) { __log.downloads = (__log.downloads || []).concat([{ obj: obj, name: name }]); }
    function generateUserId() { return 'u_gen' + (++__gen); }
    var __gen = 0;
    class FileReader { readAsText(text) { this.onload({ target: { result: text } }); } }
  `, ctx);
  vm.runInContext(extractDefaultState(), ctx);
  vm.runInContext('let state = DEFAULT_STATE();', ctx);
  for (const v of VARS) { const c = extractVar(v); if (c) vm.runInContext(c, ctx); }
  for (const f of FNS) { const c = extractFn(f); if (c) vm.runInContext(c, ctx); }
  const run = (c) => vm.runInContext(c, ctx);
  const env = {
    run, fail, log, dom, ctx,
    setNow: (iso) => run('__NOW = ' + new Date(iso).getTime() + ';'),
    confirmAnswer: (v) => { ctx.__confirmAnswer = v; },
    // uložený blob profilu
    stored: (id) => { const r = real.getItem('babylon_v3_user_' + id); return r ? JSON.parse(r) : null; },
    profiles: () => JSON.parse(real.getItem('babylon_v3_profiles') || '[]'),
    lastUser: () => real.getItem('babylon_v3_last_user'),
    snaps: (id) => JSON.parse(real.getItem('babylon_v3_snap_' + id) || '[]'),
    // založí zařízení s profily: [{id, name, patch}] a aktivním profilem
    seed(list, active) {
      const profs = list.map(p => ({ id: p.id, jmeno: p.name, vytvoreno: '2026-09-01T10:00:00.000Z' }));
      real.setItem('babylon_v3_profiles', JSON.stringify(profs));
      for (const p of list) {
        const st = run('DEFAULT_STATE()');
        st.user.name = p.name; st.user.created_at = '2026-09-01T10:00:00.000Z';
        Object.assign(st.balances, p.balances || {});
        if (p.patch) p.patch(st);
        real.setItem('babylon_v3_user_' + p.id, JSON.stringify({ state: st, driveFileId: p.driveFileId || null }));
      }
      real.setItem('babylon_v3_last_user', active);
      run('loadLocal()');
    },
    wipe: () => real.clear(),
    importText: (text) => run('importData(' + JSON.stringify(text) + ')'),
  };
  return env;
}

const results = [];
const pending = [];
function check(title, fn) {
  try {
    const r = fn();
    if (r && typeof r.then === 'function') { // asynchronní scénář
      const idx = results.push([title, null]) - 1;
      pending.push(r.then(
        (bad) => { results[idx][1] = bad && bad.length ? bad : null; },
        (e) => { results[idx][1] = ['výjimka: ' + e.message]; }));
    } else results.push([title, r && r.length ? r : null]);
  } catch (e) {
    results.push([title, ['výjimka: ' + e.message]]);
  }
}
const eq = (bad, label, a, b) => { if (JSON.stringify(a) !== JSON.stringify(b)) bad.push(`${label}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`); };
const ok = (bad, label, cond) => { if (!cond) bad.push(label); };

const KIDS = [
  { id: 'uA', name: 'Anička', balances: { living_80: 80, dreams_10: 10, forever_10: 10 } },
  { id: 'uB', name: 'Bořek', balances: { living_80: 160, dreams_10: 20, forever_10: 20 }, driveFileId: 'DRV_B' },
];
const D1 = (iso) => iso;

// ── Formát ───────────────────────────────────────────────────────
check('1. buildProfileBackup: obálka (format, schemaVersion, kind, profil s ID); state i savedAt nahoře kvůli starším verzím appky', () => {
  const bad = [], e = makeEnv();
  e.setNow('2026-10-14T16:20:00+02:00');
  e.seed(KIDS, 'uA');
  const b = e.run("buildProfileBackup('uB')");
  eq(bad, 'format', b.format, 'strazce-pokladu-backup');
  eq(bad, 'schemaVersion', b.schemaVersion, 1);
  eq(bad, 'kind', b.kind, 'profile');
  eq(bad, 'profile.id', b.profile.id, 'uB');
  eq(bad, 'profile.jmeno', b.profile.jmeno, 'Bořek');
  eq(bad, 'createdAt', b.createdAt, '2026-10-14T14:20:00.000Z');
  eq(bad, 'savedAt', b.savedAt, '2026-10-14T14:20:00.000Z');
  eq(bad, 'state.balances', b.state.balances.living_80, 160);
  eq(bad, 'neexistující profil', e.run("buildProfileBackup('nope')"), null);
  ok(bad, 'driveFileId nesmí být v záloze', !JSON.stringify(b).includes('DRV_B'));
  return bad;
});

check('2. aktivní profil se zálohuje z živého state (i neuložená změna), ostatní z uložených dat', () => {
  const bad = [], e = makeEnv();
  e.seed(KIDS, 'uA');
  e.run('state.balances.living_80 = 999;'); // bez saveLocal
  eq(bad, 'aktivní = živý state', e.run("buildProfileBackup('uA')").state.balances.living_80, 999);
  eq(bad, 'neaktivní = uložený', e.run("buildProfileBackup('uB')").state.balances.living_80, 160);
  return bad;
});

check('3. buildAllBackup: všechny profily a lastUser; profil bez uložených dat se přeskočí', () => {
  const bad = [], e = makeEnv();
  e.seed(KIDS, 'uB');
  e.run(`saveProfiles(listProfiles().concat([{ id:'uC', jmeno:'Bez dat', vytvoreno:null }]))`);
  const b = e.run('buildAllBackup()');
  eq(bad, 'kind', b.kind, 'all');
  eq(bad, 'lastUser', b.lastUser, 'uB');
  eq(bad, 'ids', b.profiles.map(p => p.id), ['uA', 'uB']);
  eq(bad, 'schemaVersion', b.schemaVersion, 1);
  return bad;
});

check('4. slugName: bez diakritiky a mezer, prázdné → „profil"', () => {
  const bad = [], e = makeEnv();
  eq(bad, 'Anička Nováková', e.run("slugName('Anička Nováková')"), 'anicka-novakova');
  eq(bad, 'prázdné', e.run("slugName('')"), 'profil');
  eq(bad, 'samé symboly', e.run("slugName('***')"), 'profil');
  eq(bad, 'undefined', e.run('slugName(undefined)'), 'profil');
  return bad;
});

// ── Rozpoznání souboru ───────────────────────────────────────────
check('5. parseBackupFile: starý tvar {state}, profil i „all" se rozpoznají', () => {
  const bad = [], e = makeEnv();
  e.seed(KIDS, 'uA');
  const legacy = e.run(`parseBackupFile({ state:{ user:{name:'X'}, balances:{living_80:1,dreams_10:2,forever_10:3} }, savedAt:'2026-09-01T00:00:00Z' })`);
  eq(bad, 'legacy.ok', legacy.ok, true); eq(bad, 'legacy.kind', legacy.kind, 'legacy');
  eq(bad, 'legacy.items[0].id', legacy.items[0].id, null);
  const prof = e.run(`parseBackupFile(buildProfileBackup('uB'))`);
  eq(bad, 'profile.kind', prof.kind, 'profile'); eq(bad, 'profile.id', prof.items[0].id, 'uB');
  const all = e.run(`parseBackupFile(buildAllBackup())`);
  eq(bad, 'all.kind', all.kind, 'all'); eq(bad, 'all.count', all.items.length, 2); eq(bad, 'all.lastUser', all.lastUser, 'uA');
  return bad;
});

check('6. parseBackupFile: odmítá nesmysly a soubory z novější verze; starý profil bez balances zůstává povolený', () => {
  const bad = [], e = makeEnv();
  const cases = {
    'null': 'null', 'pole': '[]', 'řetězec': '"x"', 'prázdný objekt': '{}', 'prázdný state': '{"state":{}}',
    'state je pole': '{"state":[]}', 'balances s textem': '{"state":{"balances":{"living_80":"abc"}}}',
    'balances s null (z NaN)': '{"state":{"balances":{"living_80":null}}}',
    'cizí format': '{"format":"jina-appka","state":{"user":{}}}',
    'novější schema': '{"format":"strazce-pokladu-backup","schemaVersion":99,"kind":"profile","profile":{"id":"x"},"state":{"user":{}}}',
    'all bez profilů': '{"format":"strazce-pokladu-backup","schemaVersion":1,"kind":"all","profiles":[]}',
    'all s poškozeným profilem': '{"format":"strazce-pokladu-backup","schemaVersion":1,"kind":"all","profiles":[{"id":"a","state":{"user":{}}},{"id":"b","state":42}]}',
  };
  for (const [n, json] of Object.entries(cases)) {
    const r = e.run(`parseBackupFile(JSON.parse(${JSON.stringify(json)}))`);
    if (r.ok !== false) bad.push('neodmítnuto: ' + n);
    else if (!r.error) bad.push('chybí text chyby: ' + n);
  }
  eq(bad, 'starý profil bez balances', e.run(`parseBackupFile({ state:{ user:{name:'X'} } }).ok`), true);
  return bad;
});

// ── Snapshoty ────────────────────────────────────────────────────
check('7. takeSnapshot: nejnovější první, hluboká kopie, důvod a týden', () => {
  const bad = [], e = makeEnv();
  e.seed(KIDS, 'uA');
  e.setNow('2026-10-14T16:20:00+02:00');
  ok(bad, 'vrací true', e.run("takeSnapshot('uA','weekly', state, '2026-W42')") === true);
  e.run('state.balances.living_80 = 5;'); // pozdější změna nesmí zasáhnout snapshot
  e.setNow('2026-10-15T10:00:00+02:00');
  e.run("takeSnapshot('uA','pre_restore', state)");
  const s = e.snaps('uA');
  eq(bad, 'pořadí důvodů', s.map(x => x.reason), ['pre_restore', 'weekly']);
  eq(bad, 'weekly.state.living_80 (kopie)', s[1].state.balances.living_80, 80);
  eq(bad, 'weekly.week', s[1].week, '2026-W42');
  eq(bad, 'weekly.at', s[1].at, '2026-10-14T14:20:00.000Z');
  return bad;
});

check('8. limity: 3 týdenní a 2 body obnovy se počítají zvlášť; zahazuje se nejstarší', () => {
  const bad = [], e = makeEnv();
  e.seed(KIDS, 'uA');
  for (let i = 1; i <= 5; i++) {
    e.setNow('2026-10-0' + i + 'T10:00:00+02:00');
    e.run(`takeSnapshot('uA','weekly', state, 'W${i}')`);
  }
  for (let i = 1; i <= 3; i++) {
    e.setNow('2026-10-1' + i + 'T10:00:00+02:00');
    e.run(`takeSnapshot('uA','pre_restore', state)`);
  }
  const s = e.snaps('uA');
  eq(bad, 'weekly týdny', s.filter(x => x.reason === 'weekly').map(x => x.week), ['W5', 'W4', 'W3']);
  eq(bad, 'pre_restore počet', s.filter(x => x.reason === 'pre_restore').length, 2);
  eq(bad, 'nejnovější bod obnovy', s.filter(x => x.reason === 'pre_restore')[0].at, '2026-10-13T08:00:00.000Z');
  return bad;
});

check('9. ensureWeeklySnapshot: jednou za týden; nový týden = nový; profil bez jména se nezálohuje', () => {
  const bad = [], e = makeEnv();
  e.seed(KIDS, 'uA');
  e.setNow('2026-10-12T08:00:00+02:00');
  ok(bad, 'první volání vytvoří', e.run('ensureWeeklySnapshot()') === true);
  e.setNow('2026-10-14T08:00:00+02:00');
  ok(bad, 'stejný týden nevytvoří', e.run('ensureWeeklySnapshot()') === false);
  eq(bad, 'počet po stejném týdnu', e.snaps('uA').length, 1);
  eq(bad, 'týden', e.snaps('uA')[0].week, '2026-W42');
  e.setNow('2026-10-19T08:00:00+02:00');
  ok(bad, 'nový týden vytvoří', e.run('ensureWeeklySnapshot()') === true);
  eq(bad, 'týdny', e.snaps('uA').map(x => x.week), ['2026-W43', '2026-W42']);
  const e2 = makeEnv();
  e2.seed([{ id: 'uN', name: '' }], 'uN');
  ok(bad, 'bez jména nevytvoří', e2.run('ensureWeeklySnapshot()') === false);
  return bad;
});

check('10. snapshot je best-effort: kvóta nikdy nevyhodí výjimku, starší snapshoty zůstanou, při tlaku se zahodí nejstarší', () => {
  const bad = [], e = makeEnv();
  e.seed(KIDS, 'uA');
  e.run("takeSnapshot('uA','weekly', state, 'W1')");
  e.fail.snap = true;
  ok(bad, 'selhání vrací false', e.run("takeSnapshot('uA','weekly', state, 'W2')") === false);
  eq(bad, 'starý snapshot zůstal', e.snaps('uA').map(x => x.week), ['W1']);
  e.fail.snap = false;
  e.run("takeSnapshot('uA','weekly', state, 'W2'); takeSnapshot('uA','weekly', state, 'W3');");
  const one = JSON.stringify(e.snaps('uA')[0]).length;
  e.fail.maxLen = one * 2 + 50; // vejdou se jen 2 snapshoty
  ok(bad, 'při tlaku uloží nový', e.run("takeSnapshot('uA','weekly', state, 'W4')") === true);
  eq(bad, 'nejstarší zahozen', e.snaps('uA').map(x => x.week), ['W4', 'W3']);
  return bad;
});

check('11. requestPersistentStorage: bez navigator.storage nic nevyhodí; s ním zavolá persist()', () => {
  const bad = [];
  const e1 = makeEnv({ navigator: {} });
  e1.run('requestPersistentStorage()');
  let called = 0;
  const e2 = makeEnv({ navigator: { storage: { persisted: () => Promise.resolve(false), persist: () => { called++; return Promise.resolve(true); } } } });
  e2.run('requestPersistentStorage()');
  return new Promise(r => setTimeout(() => { if (called !== 1) bad.push('persist() zavoláno ' + called + '×'); r(bad); }, 20));
});

// ── Import / obnova ──────────────────────────────────────────────
const legacyFile = (name, extra = {}) => JSON.stringify({
  state: { user: { name }, balances: { living_80: 7, dreams_10: 1, forever_10: 1 }, settings: { split: { ted: 70, potom: 20, navzdy: 10 } }, ...extra },
  savedAt: '2026-09-20T10:00:00.000Z',
});

check('12. starý import {state}: potvrzení se jménem profilu, bod obnovy původního stavu, obnova přes loadLocal', () => {
  const bad = [], e = makeEnv();
  e.seed(KIDS, 'uA');
  e.importText(legacyFile('Z_cizí_zálohy'));
  ok(bad, 'ptal se na potvrzení', e.log.confirms.length === 1);
  ok(bad, 'potvrzení jmenuje profil „Anička"', /Anička/.test(e.log.confirms[0] || ''));
  eq(bad, 'state.balances.living_80', e.run('state.balances.living_80'), 7);
  eq(bad, 'jméno profilu zachováno', e.run('state.user.name'), 'Z_cizí_zálohy'); // legacy neidentifikuje dítě → přebírá obsah
  const s = e.snaps('uA');
  eq(bad, 'bod obnovy', s.map(x => x.reason), ['pre_restore']);
  eq(bad, 'bod obnovy = původní stav', s[0].state.balances.living_80, 80);
  eq(bad, 'uložený blob', e.stored('uA').state.balances.living_80, 7);
  eq(bad, 'split přes loadLocal', e.run('state.settings.split'), { ted: 70, potom: 20, navzdy: 10 });
  ok(bad, 'doplněné výchozí hodnoty (deep merge přes loadLocal)', e.run('Array.isArray(state.wisdom_log) && state.streak && state.minigames && !!state.report'));
  eq(bad, 'druhé dítě nedotčeno', e.stored('uB').state.balances.living_80, 160);
  return bad;
});

check('13. odmítnuté potvrzení: nic se nezmění, žádný bod obnovy', () => {
  const bad = [], e = makeEnv();
  e.seed(KIDS, 'uA');
  e.confirmAnswer(false);
  e.importText(legacyFile('X'));
  eq(bad, 'state', e.run('state.balances.living_80'), 80);
  eq(bad, 'blob', e.stored('uA').state.balances.living_80, 80);
  eq(bad, 'snapshoty', e.snaps('uA').length, 0);
  return bad;
});

check('14. profilová záloha cizího dítěte přepíše jen to dítě (ne aktivní) a aktivní profil se nepřepne', () => {
  const bad = [], e = makeEnv();
  e.seed(KIDS, 'uA');
  const file = JSON.stringify({
    format: 'strazce-pokladu-backup', schemaVersion: 1, kind: 'profile', createdAt: '2026-10-10T10:00:00.000Z',
    profile: { id: 'uB', jmeno: 'Bořek' },
    state: { user: { name: 'Bořek' }, balances: { living_80: 1, dreams_10: 1, forever_10: 1 } },
  });
  e.importText(file);
  eq(bad, 'Bořek přepsán', e.stored('uB').state.balances.living_80, 1);
  eq(bad, 'driveFileId Bořka zachován', e.stored('uB').driveFileId, 'DRV_B');
  eq(bad, 'Anička nedotčena', e.stored('uA').state.balances.living_80, 80);
  eq(bad, 'aktivní zůstal', e.run('currentUserId'), 'uA');
  eq(bad, 'state aktivního', e.run('state.balances.living_80'), 80);
  eq(bad, 'bod obnovy pro Bořka', e.snaps('uB').map(x => x.reason), ['pre_restore']);
  eq(bad, 'bez bodu obnovy pro Aničku', e.snaps('uA').length, 0);
  ok(bad, 'potvrzení jmenuje Bořka', /Bořek/.test(e.log.confirms[0] || ''));
  return bad;
});

check('15. profilová záloha na čistém zařízení: prázdný profil se nahradí, obnovený se stane aktivním', () => {
  const bad = [], e = makeEnv();
  e.seed([{ id: 'u_empty', name: '' }], 'u_empty');
  const file = JSON.stringify({
    format: 'strazce-pokladu-backup', schemaVersion: 1, kind: 'profile', createdAt: '2026-10-10T10:00:00.000Z',
    profile: { id: 'uB', jmeno: 'Bořek' },
    state: { user: { name: 'Bořek' }, balances: { living_80: 33, dreams_10: 1, forever_10: 1 } },
  });
  e.importText(file);
  eq(bad, 'profily', e.profiles().map(p => p.id), ['uB']);
  eq(bad, 'prázdný blob smazán', e.stored('u_empty'), null);
  eq(bad, 'last_user', e.lastUser(), 'uB');
  eq(bad, 'aktivní', e.run('currentUserId'), 'uB');
  eq(bad, 'state', e.run('state.balances.living_80'), 33);
  ok(bad, 'admin zamčen, nádvoří', e.log.calls.includes('lockAdmin') && e.log.calls.includes('showScreen:nadvorí'));
  return bad;
});

check('16. profilová záloha neznámého dítěte při rozehraném profilu: dítě se přidá, aktivní zůstane', () => {
  const bad = [], e = makeEnv();
  e.seed([KIDS[0]], 'uA');
  const file = JSON.stringify({
    format: 'strazce-pokladu-backup', schemaVersion: 1, kind: 'profile', createdAt: '2026-10-10T10:00:00.000Z',
    profile: { id: 'uC', jmeno: 'Cyril' }, state: { user: { name: 'Cyril' }, balances: { living_80: 5, dreams_10: 0, forever_10: 0 } },
  });
  e.importText(file);
  eq(bad, 'profily', e.profiles().map(p => [p.id, p.jmeno]), [['uA', 'Anička'], ['uC', 'Cyril']]);
  eq(bad, 'aktivní', e.run('currentUserId'), 'uA');
  eq(bad, 'Anička nedotčena', e.stored('uA').state.balances.living_80, 80);
  eq(bad, 'Cyril uložen', e.stored('uC').state.balances.living_80, 5);
  return bad;
});

check('17. „všechny profily" na čistém zařízení: obnoví všechny, žádný prázdný profil nezbude, aktivní podle lastUser', () => {
  const bad = [];
  const src1 = makeEnv();
  src1.seed(KIDS, 'uB');
  const file = JSON.stringify(src1.run('buildAllBackup()'));
  const e = makeEnv();
  e.seed([{ id: 'u_empty', name: '' }], 'u_empty');
  e.importText(file);
  eq(bad, 'profily', e.profiles().map(p => p.id).sort(), ['uA', 'uB']);
  eq(bad, 'prázdný smazán', e.stored('u_empty'), null);
  eq(bad, 'last_user', e.lastUser(), 'uB');
  eq(bad, 'aktivní state', e.run('state.user.name'), 'Bořek');
  eq(bad, 'Anička věrně', e.stored('uA').state, src1.stored('uA').state);
  eq(bad, 'Bořek věrně', e.stored('uB').state, src1.stored('uB').state);
  return bad;
});

check('18. „všechny profily" na zařízení s daty: přepíše shodná ID s bodem obnovy, cizí profily nechá', () => {
  const bad = [], e = makeEnv();
  const srcEnv = makeEnv();
  srcEnv.seed([{ id: 'uA', name: 'Anička', balances: { living_80: 1000 } }, { id: 'uZ', name: 'Zdenka', balances: { living_80: 5 } }], 'uA');
  const file = JSON.stringify(srcEnv.run('buildAllBackup()'));
  e.seed(KIDS, 'uB');
  e.importText(file);
  eq(bad, 'profily', e.profiles().map(p => p.id).sort(), ['uA', 'uB', 'uZ']);
  eq(bad, 'Anička přepsána', e.stored('uA').state.balances.living_80, 1000);
  eq(bad, 'bod obnovy Aničky', e.snaps('uA').map(x => x.reason), ['pre_restore']);
  eq(bad, 'bod obnovy má starý stav', e.snaps('uA')[0].state.balances.living_80, 80);
  eq(bad, 'Bořek nedotčen', e.stored('uB').state.balances.living_80, 160);
  eq(bad, 'aktivní zůstal Bořek', e.run('currentUserId'), 'uB');
  ok(bad, 'potvrzení zmiňuje přepsání', /přep/i.test(e.log.confirms[0] || ''));
  return bad;
});

check('19. neplatný soubor nebo rozbitý JSON: upozornění, nic se nezmění', () => {
  const bad = [], e = makeEnv();
  e.seed(KIDS, 'uA');
  e.importText('{ tohle není json');
  e.importText('{"state":{}}');
  e.importText('{"format":"strazce-pokladu-backup","schemaVersion":99,"kind":"profile","profile":{"id":"x"},"state":{"user":{}}}');
  eq(bad, 'upozornění', e.log.toasts.length, 3);
  ok(bad, 'všechna s ⚠️', e.log.toasts.every(t => String(t).includes('⚠️')));
  eq(bad, 'bez potvrzení', e.log.confirms.length, 0);
  eq(bad, 'state', e.run('state.balances.living_80'), 80);
  eq(bad, 'snapshoty', e.snaps('uA').length + e.snaps('uB').length, 0);
  return bad;
});

check('20. selhání bodu obnovy ZRUŠÍ obnovu (data se nepřepíšou bez záchranné kopie)', () => {
  const bad = [], e = makeEnv();
  e.seed(KIDS, 'uA');
  e.fail.snap = true;
  e.importText(legacyFile('X'));
  eq(bad, 'state', e.run('state.balances.living_80'), 80);
  eq(bad, 'blob', e.stored('uA').state.balances.living_80, 80);
  ok(bad, 'upozornění', e.log.toasts.some(t => String(t).includes('⚠️')));
  return bad;
});

check('21. selhání zápisu v půlce „all": vše se vrátí do původního stavu (rollback)', () => {
  const bad = [];
  const srcEnv = makeEnv();
  srcEnv.seed([{ id: 'uA', name: 'Anička', balances: { living_80: 1000 } }, { id: 'uZ', name: 'Zdenka' }], 'uA');
  const file = JSON.stringify(srcEnv.run('buildAllBackup()'));
  const e = makeEnv();
  e.seed(KIDS, 'uB');
  const before = JSON.stringify([e.stored('uA'), e.stored('uB'), e.profiles(), e.lastUser()]);
  e.fail.keys.add('babylon_v3_user_uZ'); // uA se zapíše, uZ selže
  e.importText(file);
  eq(bad, 'úložiště po selhání', JSON.stringify([e.stored('uA'), e.stored('uB'), e.profiles(), e.lastUser()]), before);
  eq(bad, 'uZ neexistuje', e.stored('uZ'), null);
  ok(bad, 'upozornění', e.log.toasts.some(t => String(t).includes('⚠️')));
  eq(bad, 'state', e.run('state.user.name'), 'Bořek');
  return bad;
});

check('22. restoreSnapshot: vrátí starý stav, uloží bod obnovy aktuálního; bez potvrzení nic', () => {
  const bad = [], e = makeEnv();
  e.seed(KIDS, 'uA');
  e.setNow('2026-10-12T08:00:00+02:00');
  e.run('ensureWeeklySnapshot()');                   // snapshot se 80
  e.run('state.balances.living_80 = 500;');
  e.run("localStorage.setItem('babylon_v3_user_uA', JSON.stringify({ state, driveFileId:null }))");
  e.confirmAnswer(false);
  e.run("restoreSnapshot('uA', 0)");
  eq(bad, 'bez potvrzení', e.run('state.balances.living_80'), 500);
  e.confirmAnswer(true);
  e.run("restoreSnapshot('uA', 0)");
  eq(bad, 'po obnově', e.run('state.balances.living_80'), 80);
  eq(bad, 'blob', e.stored('uA').state.balances.living_80, 80);
  const pre = e.snaps('uA').filter(s => s.reason === 'pre_restore');
  eq(bad, 'bod obnovy aktuálního stavu', pre.length === 1 && pre[0].state.balances.living_80, 500);
  e.run("restoreSnapshot('uA', 99)"); // neplatný index nic nerozbije
  eq(bad, 'neplatný index', e.run('state.balances.living_80'), 80);
  return bad;
});

check('23. koloběh: zálohovat „all", smazat zařízení, obnovit → data všech dětí se shodují', () => {
  const bad = [], e = makeEnv();
  e.seed(KIDS, 'uA');
  e.run("state.tasks.template = [{id:'t1', nazev:'Úkol', dny:['po']}]; localStorage.setItem('babylon_v3_user_uA', JSON.stringify({ state, driveFileId:null }))");
  const file = JSON.stringify(e.run('buildAllBackup()'));
  const orig = { A: e.stored('uA').state, B: e.stored('uB').state };
  e.wipe();
  e.run('state = DEFAULT_STATE(); currentUserId = null;');
  e.run('ensureActiveProfile()'); // čistá instalace si vyrobí prázdný profil
  e.importText(file);
  eq(bad, 'A', e.stored('uA').state, orig.A);
  eq(bad, 'B', e.stored('uB').state, orig.B);
  eq(bad, 'počet profilů', e.profiles().length, 2);
  return bad;
});

// ── Zdrojový kód a admin ─────────────────────────────────────────
check('24. admin: tlačítka Export všech profilů a Body obnovy existují a jsou napojená', () => {
  const bad = [];
  for (const id of ['adm-export-btn', 'adm-export-all-btn', 'adm-snap-btn', 'adm-snap-list']) {
    if (!new RegExp('id="' + id + '"').test(src)) bad.push('chybí element #' + id);
  }
  for (const id of ['adm-export-all-btn', 'adm-snap-btn']) {
    if (!new RegExp("getElementById\\('" + id + "'\\)\\.addEventListener").test(src)) bad.push('chybí listener #' + id);
  }
  return bad;
});

check('25. seznam bodů obnovy: řádek na snapshot, tlačítko Obnovit, jen textContent (žádné innerHTML)', () => {
  const bad = [], e = makeEnv();
  e.seed(KIDS, 'uA');
  e.setNow('2026-10-12T08:05:00+02:00');
  e.run("takeSnapshot('uA','weekly', state, '2026-W42')");
  e.setNow('2026-10-13T09:00:00+02:00');
  e.run("takeSnapshot('uA','pre_restore', state)");
  e.run('renderSnapshotList()');
  const rows = e.dom.window.document.querySelectorAll('#adm-snap-list .admin-drive-row');
  eq(bad, 'počet řádků', rows.length, 2);
  ok(bad, 'každý řádek má tlačítko', [...rows].every(r => r.querySelector('button')));
  ok(bad, 'první řádek = nejnovější (bod obnovy)', /obnov/i.test(rows[0] ? rows[0].textContent : ''));
  ok(bad, 'druhý řádek zmiňuje týden', /týden|W42|12\. 10\./i.test(rows[1] ? rows[1].textContent : ''));
  ok(bad, 'renderSnapshotList bez innerHTML', !/innerHTML/.test(extractFn('renderSnapshotList') || 'innerHTML'));
  e.run('state = DEFAULT_STATE(); currentUserId = "uB"');
  e.run('renderSnapshotList()');
  eq(bad, 'jiný profil bez snapshotů → prázdný stav', e.dom.window.document.querySelectorAll('#adm-snap-list .admin-drive-row').length, 1);
  return bad;
});

check('26. boot a přepnutí profilu: týdenní snapshot se bere PŘED týdenním vyhodnocením (výplatou)', () => {
  const bad = [];
  const boot = src.slice(src.indexOf('/* ═══ BOOT ═══ */'), src.indexOf('// GIS init'));
  const iSnap = boot.indexOf('ensureWeeklySnapshot()'), iEval = boot.indexOf('checkWeeklyTaskEvaluation()');
  if (iSnap < 0) bad.push('boot nevolá ensureWeeklySnapshot()');
  else if (iEval >= 0 && iSnap > iEval) bad.push('boot: snapshot až po vyhodnocení týdne');
  if (!/requestPersistentStorage\(\)/.test(boot)) bad.push('boot nevolá requestPersistentStorage()');
  const sw = extractFn('switchToProfile') || '';
  const jSnap = sw.indexOf('ensureWeeklySnapshot()'), jEval = sw.indexOf('checkWeeklyTaskEvaluation()');
  if (jSnap < 0) bad.push('switchToProfile nevolá ensureWeeklySnapshot()');
  else if (jEval >= 0 && jSnap > jEval) bad.push('switchToProfile: snapshot až po vyhodnocení týdne');
  return bad;
});

check('27. obnova starého souboru na úvodní obrazovce (čisté zařízení): přejde na nádvoří, bez zbytečného bodu obnovy', () => {
  const bad = [], e = makeEnv();
  e.seed([{ id: 'u_empty', name: '' }], 'u_empty');
  e.run("currentScreen = 'setup'");
  e.importText(legacyFile('Dorota'));
  eq(bad, 'jméno', e.run('state.user.name'), 'Dorota');
  ok(bad, 'showScreen nádvoří + vyhodnocení týdne', e.log.calls.includes('showScreen:nadvorí') && e.log.calls.includes('checkWeeklyTaskEvaluation'));
  eq(bad, 'prázdný profil se nezálohuje', e.snaps('u_empty').length, 0);
  eq(bad, 'jediný profil zůstal', e.profiles().map(p => p.id), ['u_empty']);
  return bad;
});

check('28. exportData / exportAllData: obsah i název souboru (jméno bez diakritiky, místní datum)', () => {
  const bad = [], e = makeEnv();
  e.setNow('2026-10-14T23:50:00+02:00');
  e.seed(KIDS, 'uA');
  e.run('exportData(); exportAllData();');
  const d = e.log.downloads || [];
  eq(bad, 'počet stažení', d.length, 2);
  if (d.length === 2) {
    eq(bad, 'název profilu', d[0].name, 'babylon_anicka_2026-10-14.json');
    eq(bad, 'kind profilu', d[0].obj.kind, 'profile');
    eq(bad, 'id profilu', d[0].obj.profile.id, 'uA');
    eq(bad, 'název všech', d[1].name, 'babylon_vsechny-profily_2026-10-14.json');
    eq(bad, 'kind všech', d[1].obj.kind, 'all');
    eq(bad, 'počet profilů', d[1].obj.profiles.length, 2);
  }
  return bad;
});

(async () => {
  await Promise.all(pending);
  let failed = 0;
  for (const [title, bad] of results) {
    if (bad) { failed++; console.log('FAIL ' + title + '\n     ' + bad.slice(0, 6).join('\n     ')); }
    else console.log('PASS ' + title);
  }
  console.log(failed ? `\n${failed} z ${results.length} scénářů selhalo` : `\nVšech ${results.length} scénářů prošlo`);
  console.log('Zdroj: ' + (process.env.SRC_FILE || 'git HEAD:index.html'));
  process.exit(failed ? 1 : 0);
})();
