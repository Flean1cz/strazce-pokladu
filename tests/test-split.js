// Test: variabilní poměr rozdělení vkladu (state.settings.split).
// Spuštění: npm test  (výchozí zdroj: git show HEAD:index.html)
//           SRC_FILE=index.html npm test  (pracovní kopie)
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

// const DEFAULT_STATE = () => ({ ... });
function extractDefaultState() {
  const start = src.indexOf('const DEFAULT_STATE = ');
  const end = src.indexOf('\n});', start);
  return src.slice(start, end + 4);
}

const FNS = ['fmt', 'isValidSplit', 'normalizeSplit', 'computeSplitAmounts', 'doDeposit', 'loadLocal', 'importData', 'loadFromDrive'];

function makeEnv() {
  const dom = new JSDOM('<body></body>', { url: 'http://localhost/' });
  const ctx = vm.createContext({ localStorage: dom.window.localStorage, console: { log() {}, error() {} } });
  vm.runInContext(`
    var calls = [];
    let currentUserId = 'A', driveFileId = 'F', clientId = null, accessToken = 'T';
    let __drive = null;
    function toast() {}
    function scheduleSave() {}
    function coinAnimation() {}
    function renderAll() {}
    function addWisdom() {}
    function checkMilestones() {}
    function refreshTrees() {}
    function saveToDrive() {}
    async function saveToDriveNow() {}
    function saveLocal() {}
    function setDriveStatus() {}
    function updateDriveSettingsLabel() {}
    async function findFile() { return 'F'; }
    function ensureActiveProfile() {}
    function userStorageKey(id) { return 'k_' + id; }
    async function fetch() { return { ok: true, json: async () => __drive }; }
    class FileReader { readAsText(text) { this.onload({ target: { result: text } }); } }
  `, ctx);
  vm.runInContext(extractDefaultState(), ctx);
  vm.runInContext('let state = DEFAULT_STATE();', ctx);
  for (const f of FNS) {
    const code = extractFn(f);
    if (code) vm.runInContext(code, ctx);
  }
  return { run: (c) => vm.runInContext(c, ctx), dom };
}

const cents = (x) => Math.round(x * 100);
const results = [];
function check(title, fn) {
  try {
    const bad = fn();
    results.push([title, bad && bad.length ? bad : null]);
  } catch (e) {
    results.push([title, ['výjimka: ' + e.message]]);
  }
}
const eq = (bad, label, a, b) => { if (JSON.stringify(a) !== JSON.stringify(b)) bad.push(`${label}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`); };

const D = { ted: 80, potom: 10, navzdy: 10 };

// Nezávislý oracle: podíl v haléřích, zaokrouhlení → rozdíl největšímu (při shodě první z ted, potom, navzdy)
function oracle(c, sp) {
  const keys = ['ted', 'potom', 'navzdy'];
  const out = keys.map((k) => Math.round((c * sp[k]) / 100));
  const diff = c - out.reduce((a, b) => a + b, 0);
  let big = 0;
  keys.forEach((k, i) => { if (sp[k] > sp[keys[big]]) big = i; });
  out[big] += diff;
  return out;
}

// ── 1. DEFAULT_STATE ────────────────────────────────────────────────
check('1. DEFAULT_STATE.settings.split je 80/10/10', () => {
  const e = makeEnv(), bad = [];
  eq(bad, 'split', e.run('DEFAULT_STATE().settings.split'), D);
  return bad;
});

// ── 2. doDeposit: tabulka očekávaných částek (v haléřích) ──────────
const SPLITS = {
  '80/10/10': { ted: 80, potom: 10, navzdy: 10 },
  '70/20/10': { ted: 70, potom: 20, navzdy: 10 },
  '0/0/100': { ted: 0, potom: 0, navzdy: 100 },
  '35/35/30': { ted: 35, potom: 35, navzdy: 30 },
};
const EXPECTED = { // [ted, potom, navzdy] v haléřích, spočteno ručně
  '80/10/10': { 100: [8000, 1000, 1000], 33: [2640, 330, 330], 0.01: [1, 0, 0], 7.77: [621, 78, 78] },
  '70/20/10': { 100: [7000, 2000, 1000], 33: [2310, 660, 330], 0.01: [1, 0, 0], 7.77: [544, 155, 78] },
  '0/0/100': { 100: [0, 0, 10000], 33: [0, 0, 3300], 0.01: [0, 0, 1], 7.77: [0, 0, 777] },
  '35/35/30': { 100: [3500, 3500, 3000], 33: [1155, 1155, 990], 0.01: [1, 0, 0], 7.77: [272, 272, 233] },
};
for (const [name, sp] of Object.entries(SPLITS)) {
  for (const amount of [100, 33, 0.01, 7.77]) {
    check(`2. doDeposit ${name} na ${amount}`, () => {
      const e = makeEnv(), bad = [];
      e.run(`state.settings.split = ${JSON.stringify(sp)}; doDeposit(${amount});`);
      const h = e.run('state.history[0]');
      const b = e.run('state.balances');
      const exp = EXPECTED[name][amount];
      eq(bad, 'history ted/potom/navzdy (haléře)', [cents(h.ted), cents(h.potom), cents(h.navzdy)], exp);
      eq(bad, 'balances (haléře)', [cents(b.living_80), cents(b.dreams_10), cents(b.forever_10)], exp);
      eq(bad, 'součet = vklad', cents(h.ted) + cents(h.potom) + cents(h.navzdy), cents(amount));
      eq(bad, 'history.amount', h.amount, amount);
      eq(bad, 'history.split', h.split, sp);
      return bad;
    });
  }
}

// ── 3. doDeposit: vyčerpávající kontrola všech platných poměrů ─────
const amounts = []; // 405 částek v haléřích
for (let c = 1; c <= 400; c++) amounts.push(c);
amounts.push(999, 1234, 5555, 99999, 123457);
const allSplits = [];
for (let t = 0; t <= 100; t += 5) for (let p = 0; t + p <= 100; p += 5) allSplits.push({ ted: t, potom: p, navzdy: 100 - t - p });

// Provede vklad pro každou dvojici (poměr, částka) a vrátí plochý seznam haléřů [ted, potom, navzdy, ...]
function runDeposits(e, splits, amts) {
  return e.run(`(function () {
    const out = [];
    for (const sp of ${JSON.stringify(splits)}) for (const c of ${JSON.stringify(amts)}) {
      state = DEFAULT_STATE(); state.settings.split = sp; doDeposit(c / 100);
      const h = state.history[0];
      out.push(Math.round(h.ted * 100), Math.round(h.potom * 100), Math.round(h.navzdy * 100));
    }
    return out;
  })()`);
}

check('3. všechny platné poměry × částky: součet, nezápornost, oracle', () => {
  const e = makeEnv(), bad = [];
  const splits = allSplits;
  const flat = runDeposits(e, splits, amounts);
  let i = 0, fails = 0;
  for (const sp of splits) for (const c of amounts) {
    const got = [flat[i++], flat[i++], flat[i++]];
    const exp = oracle(c, sp);
    const ok = got.every((x, k) => x === exp[k]) && got.every((x) => x >= 0) && got[0] + got[1] + got[2] === c;
    if (!ok && fails++ < 5) bad.push(`${JSON.stringify(sp)} c=${c}: ${got} ≠ ${exp}`);
  }
  if (fails) bad.push(`celkem ${fails} chyb z ${splits.length * amounts.length}`);
  return bad;
});

const INVALID = {
  'chybí klíč': { ted: 70, potom: 30 },
  'součet 110': { ted: 80, potom: 20, navzdy: 10 },
  'součet 90': { ted: 70, potom: 10, navzdy: 10 },
  'není násobek 5': { ted: 33, potom: 33, navzdy: 34 },
  'záporná hodnota': { ted: 110, potom: -10, navzdy: 0 },
  'nad 100': { ted: 105, potom: 0, navzdy: -5 },
  'desetinné': { ted: 70.5, potom: 19.5, navzdy: 10 },
  'řetězce': { ted: '70', potom: '20', navzdy: '10' },
  'null': null,
  'pole': [70, 20, 10],
  'číslo': 100,
  'prázdný objekt': {},
};

// ── 3b. history.split je kopie, ne odkaz na state.settings.split ───
check('3b. history[0].split je nezávislý objekt (výměna i mutace na místě)', () => {
  const e = makeEnv(), bad = [];
  e.run('doDeposit(100)');
  e.run('state.settings.split = { ted: 0, potom: 0, navzdy: 100 }');
  eq(bad, 'po výměně split objektu', e.run('state.history[0].split'), D);
  e.run('state.settings.split = { ted: 70, potom: 20, navzdy: 10 }; doDeposit(100); state.settings.split.ted = 5; state.settings.split.navzdy = 85;');
  eq(bad, 'po mutaci na místě', e.run('state.history[0].split'), { ted: 70, potom: 20, navzdy: 10 });
  eq(bad, 'starší záznam nedotčen', e.run('state.history[1].split'), D);
  if (e.run('state.history[0].split === state.settings.split')) bad.push('history.split je odkaz na state.settings.split');
  return bad;
});

// ── 3c. Regrese: 80/10/10 nový výpočet vs. starý vzorec ────────────
// Starý vzorec zkopírován z doDeposit před S1. Rozdíly se jen reportují, test neshazují.
function legacySplit(val) {
  const n10 = Math.round(val * 0.10 * 100) / 100;
  const p10 = Math.round(val * 0.10 * 100) / 100;
  const t80 = Math.round((val - n10 - p10) * 100) / 100;
  return [t80, p10, n10].map(cents);
}
const notes = [];
check('3c. 80/10/10: nový výpočet vs. starý vzorec (' + amounts.length + ' částek, jen report)', () => {
  const e = makeEnv();
  const flat = runDeposits(e, [D], amounts);
  const diffs = [];
  amounts.forEach((c, i) => {
    const neu = [flat[3 * i], flat[3 * i + 1], flat[3 * i + 2]];
    const old = legacySplit(c / 100);
    if (neu.some((x, k) => x !== old[k])) diffs.push('  ' + c / 100 + ' Kč: stará [' + old + '] vs. nová [' + neu + '] (haléře)');
  });
  notes.push(diffs.length
    ? '3c: rozdíly nový vs. starý vzorec u ' + diffs.length + ' z ' + amounts.length + ' částek:\n' + diffs.slice(0, 40).join('\n') + (diffs.length > 40 ? '\n  … a ' + (diffs.length - 40) + ' dalších' : '')
    : '3c: nový výpočet je pro 80/10/10 shodný se starým vzorcem na všech ' + amounts.length + ' částkách.');
  return [];
});

// ── 3d. isValidSplit ────────────────────────────────────────────────
check('3d. isValidSplit: platné true, neplatné false', () => {
  const e = makeEnv(), bad = [];
  const wrong = e.run(`${JSON.stringify(allSplits)}.filter(sp => isValidSplit(sp) !== true).length`);
  if (wrong) bad.push(wrong + ' platných poměrů nevyhodnoceno jako true');
  for (const [n, v] of Object.entries(INVALID)) {
    if (e.run(`isValidSplit(${JSON.stringify(v)})`) !== false) bad.push('neplatný (' + n + ') nevyhodnocen jako false');
  }
  if (e.run('isValidSplit(undefined)') !== false) bad.push('undefined nevyhodnoceno jako false');
  return bad;
});

// ── 4. Migrace: loadLocal / importData / loadFromDrive ─────────────
const VALID = { ted: 70, potom: 20, navzdy: 10 };

const LOADERS = {
  loadLocal: (e, st) => {
    e.dom.window.localStorage.setItem('k_A', JSON.stringify({ state: st, driveFileId: null }));
    e.run('loadLocal()');
  },
  importData: (e, st) => { e.run(`importData(${JSON.stringify(JSON.stringify({ state: st }))})`); },
  loadFromDrive: async (e, st) => { e.run(`__drive = { state: ${JSON.stringify(st)} }`); await e.run('loadFromDrive()'); },
};

const oldSettings = { monthly_interest: 1, admin_pin: '4321', weekly_allowance: 50 };

async function migrationChecks() {
  for (const [lname, load] of Object.entries(LOADERS)) {
    const cases = [
      [`starý profil bez split`, { settings: { ...oldSettings } }, D],
      [`starý profil bez settings`, {}, D],
      [`platný split 70/20/10 zůstane`, { settings: { ...oldSettings, split: VALID } }, VALID],
      ...Object.entries(INVALID).map(([n, v]) => [`neplatný split (${n})`, { settings: { ...oldSettings, split: v } }, D]),
    ];
    for (const [cname, st, exp] of cases) {
      const title = `4. ${lname}: ${cname}`;
      try {
        const e = makeEnv(), bad = [];
        await load(e, { user: { name: 'X' }, ...st });
        eq(bad, 'split', e.run('state.settings.split'), exp);
        if (st.settings) eq(bad, 'admin_pin zachován', e.run('state.settings.admin_pin'), '4321');
        results.push([title, bad.length ? bad : null]);
      } catch (err) {
        results.push([title, ['výjimka: ' + err.message]]);
      }
    }
  }
}

(async () => {
  await migrationChecks();
  console.log('Zdroj:', process.env.SRC_FILE || 'git HEAD:index.html');
  let failed = 0;
  for (const [title, bad] of results) {
    if (bad) failed++;
    console.log((bad ? 'FAIL ' : 'PASS ') + title + (bad ? '  ← ' + bad.slice(0, 3).join(' | ') : ''));
  }
  for (const n of notes) console.log('\nINFO ' + n);
  console.log(failed ? `\n${failed} z ${results.length} scénářů selhalo` : `\nVšech ${results.length} scénářů prošlo`);
  process.exit(failed ? 1 : 0);
})();
