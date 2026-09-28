// Test: editor poměru rozdělení v rodičovské sekci (Fáze S2).
// Spuštění: npm test  (výchozí zdroj: git show HEAD:index.html)
//           SRC_FILE=index.html npm test  (pracovní kopie)
//
// Kontrakt, který test předpokládá (funkce se hledají podle názvu obsahujícího "Split"):
//   globály  splitDraft, splitDraftBase        – rozpracovaná kopie a poměr, ze kterého vznikla
//   funkce   computeSplitAmounts(val, split)   – čistý výpočet → { ted, potom, navzdy } v Kč
//            renderSplitEditor(), stepSplit(key, delta), restoreDefaultSplit(), saveSplit(),
//            discardSplitDraft(), bindSplitEditor()
//   DOM      karta #admin-split-card; #split-{dec,inc}-{ted,potom,navzdy}, #split-val-{...},
//            #split-sum, #split-sum-err, #split-preview, #split-note, #split-save-btn, #split-default-btn
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

const splitFnNames = [...new Set([...src.matchAll(/function (\w*[sS]plit\w*)\(/g)].map((m) => m[1]))];
const FNS = ['fmt', 'doDeposit', 'renderAdminPanel', 'updatePinDots', 'checkPin', 'resetAdminView',
  'lockAdmin', 'switchToProfile', ...splitFnNames];
const DRAFT_DECLS = src.match(/^let splitDraft[^\n]*$/gm) || [];

// Skutečný markup karty editoru z index.html (parsování bez spuštění skriptů)
const fullDoc = new JSDOM(src).window.document;
const cardEl = fullDoc.getElementById('admin-split-card');
const CARD_HTML = cardEl ? cardEl.outerHTML : '';

function makeEnv() {
  const dom = new JSDOM(`<body>
    <div id="admin-pin-view"></div>
    <div id="admin-panel-view" style="display:none">${CARD_HTML}</div>
    <div id="pin-error"></div><input id="name-input">
  </body>`, { url: 'http://localhost/' });
  const doc = dom.window.document;
  const ctx = vm.createContext({ document: doc, localStorage: dom.window.localStorage, console });
  vm.runInContext(`
    var calls = [];
    let adminUnlocked = false, pinBuffer = '', currentUserId = 'A', state = null;
    function toast(m) { calls.push(['toast', m]); }
    function scheduleSave() { calls.push(['save']); localStorage.setItem('k_' + currentUserId, JSON.stringify({ state })); }
    function userStorageKey(id) { return 'k_' + id; }
    function loadLocal() {
      currentUserId = localStorage.getItem('babylon_v3_last_user');
      state = JSON.parse(localStorage.getItem('k_' + currentUserId)).state;
    }
    function switchAdminTab() {}
    function closeProfileMenu() {}
    function renderProfileMenu() {}
    function showScreen() {}
    function renderAll() { renderAdminPanel(); }
    function checkWeeklyTaskEvaluation() {}
    function renderTaskTemplate() {}
    function renderTaskExceptions() {}
    function renderPokladnice() {}
    function coinAnimation() {}
    function addWisdom() {}
    function checkMilestones() {}
    function refreshTrees() {}
  `, ctx);
  for (const d of DRAFT_DECLS) vm.runInContext(d, ctx);
  for (const f of FNS) {
    const code = extractFn(f);
    if (code) vm.runInContext(code, ctx);
  }
  const ls = dom.window.localStorage;
  const seed = (split) => ({
    user: { name: 'Dítě' }, balances: { living_80: 0, dreams_10: 0, forever_10: 0 }, history: [],
    settings: { monthly_interest: 1, admin_pin: '1234', weekly_allowance: 0, split },
  });
  ls.setItem('k_A', JSON.stringify({ state: seed({ ted: 80, potom: 10, navzdy: 10 }) }));
  ls.setItem('k_B', JSON.stringify({ state: seed({ ted: 35, potom: 35, navzdy: 30 }) }));
  ls.setItem('babylon_v3_last_user', 'A');
  vm.runInContext('loadLocal(); calls.length = 0;', ctx);
  vm.runInContext('if (typeof bindSplitEditor === "function") bindSplitEditor();', ctx);
  const env = {
    doc, ls, run: (c) => vm.runInContext(c, ctx),
    open: () => env.run(`adminUnlocked = false; pinBuffer = '1234'; checkPin();`),
    click: (id) => doc.getElementById(id).click(),
    txt: (id) => doc.getElementById(id).textContent,
    disabled: (id) => doc.getElementById(id).disabled,
    hidden: (id) => doc.getElementById(id).hidden,
    // hodnoty tří řádků z DOM jako čísla
    vals: () => ['ted', 'potom', 'navzdy'].map((k) => parseInt(doc.getElementById('split-val-' + k).textContent, 10)),
    split: () => env.run('JSON.parse(JSON.stringify(state.settings.split))'),
    stored: (id) => JSON.parse(ls.getItem('k_' + id)).state.settings.split,
    saves: () => env.run('calls.filter(c => c[0] === "save").length'),
    toasts: () => env.run('calls.filter(c => c[0] === "toast").map(c => c[1])'),
  };
  return env;
}

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
const ok = (bad, label, cond) => { if (!cond) bad.push(label); };
const D = { ted: 80, potom: 10, navzdy: 10 };
const clickN = (e, id, n) => { for (let i = 0; i < n; i++) e.click(id); };

// ── 1. Struktura karty a umístění ──────────────────────────────────
check('1. karta v tabu Nastavení hned pod „Vklad / Výběr", s popiskem a třemi řádky', () => {
  const bad = [];
  ok(bad, 'karta #admin-split-card existuje', !!cardEl);
  if (!cardEl) return bad;
  const dep = fullDoc.getElementById('admin-deposit-btn').closest('.admin-card');
  ok(bad, 'karta bezprostředně následuje kartu se vkladem', dep.nextElementSibling === cardEl);
  ok(bad, 'karta je v #admin-tab-settings', cardEl.parentElement.id === 'admin-tab-settings');
  ok(bad, 'popisek „Platí pro ruční vklad i týdenní kapesné."', cardEl.textContent.includes('Platí pro ruční vklad i týdenní kapesné.'));
  for (const k of ['ted', 'potom', 'navzdy']) {
    for (const id of ['split-dec-', 'split-inc-', 'split-val-']) ok(bad, `chybí #${id}${k}`, !!cardEl.querySelector('#' + id + k));
  }
  for (const id of ['split-sum', 'split-sum-err', 'split-preview', 'split-note', 'split-save-btn', 'split-default-btn']) {
    ok(bad, `chybí #${id}`, !!cardEl.querySelector('#' + id));
  }
  return bad;
});

check('1b. tlačítka − / + mají dotykový cíl ≥ 44 px (jako Fáze 4b)', () => {
  const bad = [];
  const m = src.match(/\.split-step-btn\s*\{([^}]*)\}/);
  if (!m) return ['chybí CSS pravidlo .split-step-btn'];
  const w = /(?:^|;|\s)width:\s*(\d+)px/.exec(m[1]), h = /(?:^|;|\s)height:\s*(\d+)px/.exec(m[1]);
  ok(bad, 'explicitní width ≥ 44px', w && +w[1] >= 44);
  ok(bad, 'explicitní height ≥ 44px', h && +h[1] >= 44);
  for (const k of ['ted', 'potom', 'navzdy']) for (const d of ['dec', 'inc']) {
    const b = cardEl && cardEl.querySelector('#split-' + d + '-' + k);
    ok(bad, `#split-${d}-${k} má třídu split-step-btn`, b && b.classList.contains('split-step-btn'));
  }
  return bad;
});

check('1c. texty vkládány přes textContent (žádné innerHTML v kódu editoru), texty pro S3 nezměněny', () => {
  const bad = [];
  ok(bad, 'existují funkce editoru', splitFnNames.includes('renderSplitEditor') && splitFnNames.includes('saveSplit'));
  for (const f of splitFnNames) {
    const code = extractFn(f) || '';
    if (/innerHTML|insertAdjacentHTML|outerHTML/.test(code)) bad.push(f + ' používá HTML API');
  }
  ok(bad, 'zůstalo „TEĎ (80%)"', src.includes('TEĎ (80%)'));
  ok(bad, 'zůstalo „Vložit a rozdělit (80/10/10)"', src.includes('Vložit a rozdělit (80/10/10)'));
  return bad;
});

// ── 2. Počáteční stav a kroky ±5, hranice 0/100 ────────────────────
check('2. po otevření adminu editor ukazuje uložený poměr profilu', () => {
  const e = makeEnv(), bad = [];
  e.open();
  eq(bad, 'hodnoty', e.vals(), [80, 10, 10]);
  eq(bad, 'text hodnoty', e.txt('split-val-ted'), '80 %');
  ok(bad, 'Uložit aktivní', e.disabled('split-save-btn') === false);
  return bad;
});

check('3. kroky ±5 a hranice 0 / 100 na každém řádku', () => {
  const e = makeEnv(), bad = [];
  e.open();
  for (const k of ['ted', 'potom', 'navzdy']) {
    const idx = ['ted', 'potom', 'navzdy'].indexOf(k);
    e.run('restoreDefaultSplit()');
    const start = e.vals()[idx];
    e.click('split-inc-' + k);
    eq(bad, `${k}: +5`, e.vals()[idx], start + 5);
    e.click('split-dec-' + k);
    eq(bad, `${k}: −5`, e.vals()[idx], start);
    clickN(e, 'split-inc-' + k, 30);
    eq(bad, `${k}: strop 100`, e.vals()[idx], 100);
    clickN(e, 'split-dec-' + k, 30);
    eq(bad, `${k}: spodek 0`, e.vals()[idx], 0);
    eq(bad, `${k}: text 0 %`, e.txt('split-val-' + k), '0 %');
    // ostatní řádky se krokem nemění
    const others = e.vals().filter((_, i) => i !== idx);
    eq(bad, `${k}: ostatní řádky nedotčeny`, others, [80, 10, 10].filter((_, i) => i !== idx));
  }
  eq(bad, 'state se editací nemění', e.split(), D);
  eq(bad, 'žádné uložení při editaci', e.saves(), 0);
  return bad;
});

// ── 4. Součet a blokace Uložit (výhradně přes isValidSplit) ────────
check('4. součet ≠ 100: červená hláška, Uložit neaktivní, saveSplit() nezapisuje', () => {
  const e = makeEnv(), bad = [];
  e.open();
  ok(bad, 'při 100 % hláška skrytá', e.hidden('split-sum-err'));
  eq(bad, 'součet při 100', e.txt('split-sum'), 'Součet: 100 %');
  e.click('split-inc-ted'); // 85/10/10 = 105
  eq(bad, 'součet 105', e.txt('split-sum'), 'Součet: 105 %');
  ok(bad, 'hláška viditelná', e.hidden('split-sum-err') === false);
  eq(bad, 'text hlášky', e.txt('split-sum-err'), 'Součet musí být 100 %');
  ok(bad, 'Uložit neaktivní', e.disabled('split-save-btn') === true);
  ok(bad, 'součet označen třídou invalid', e.doc.getElementById('split-sum').classList.contains('invalid'));
  e.run('saveSplit()');
  eq(bad, 'state po saveSplit() beze změny', e.split(), D);
  eq(bad, 'žádné scheduleSave', e.saves(), 0);
  clickN(e, 'split-dec-ted', 3); // 70/10/10 = 90
  eq(bad, 'součet 90', e.txt('split-sum'), 'Součet: 90 %');
  ok(bad, 'Uložit neaktivní i při 90', e.disabled('split-save-btn') === true);
  e.click('split-inc-potom'); e.click('split-inc-potom'); // 70/20/10 = 100
  ok(bad, 'hláška zmizela', e.hidden('split-sum-err'));
  ok(bad, 'Uložit aktivní', e.disabled('split-save-btn') === false);
  ok(bad, 'třída invalid pryč', !e.doc.getElementById('split-sum').classList.contains('invalid'));
  return bad;
});

check('4b. pravidlo platnosti je výhradně isValidSplit() (podvržená funkce řídí UI)', () => {
  const e = makeEnv(), bad = [];
  e.open();
  e.run('isValidSplit = () => false'); e.run('renderSplitEditor()');
  ok(bad, 'isValidSplit→false: Uložit neaktivní i pro 80/10/10', e.disabled('split-save-btn') === true);
  ok(bad, 'isValidSplit→false: hláška zobrazena', e.hidden('split-sum-err') === false);
  e.run('isValidSplit = () => true');
  e.click('split-inc-ted'); // 85/10/10 – součet 105
  ok(bad, 'isValidSplit→true: Uložit aktivní i pro součet 105', e.disabled('split-save-btn') === false);
  ok(bad, 'isValidSplit→true: hláška skrytá', e.hidden('split-sum-err'));
  return bad;
});

// ── 5. Uložení ─────────────────────────────────────────────────────
check('5. Uložit: kopie do state.settings.split, scheduleSave(), toast; ostatní nastavení i druhý profil nedotčeny', () => {
  const e = makeEnv(), bad = [];
  const bBefore = e.ls.getItem('k_B');
  e.open();
  clickN(e, 'split-dec-ted', 2); clickN(e, 'split-inc-potom', 2); // 70/20/10
  eq(bad, 'před Uložit je state beze změny', e.split(), D);
  e.click('split-save-btn');
  eq(bad, 'state.settings.split', e.split(), { ted: 70, potom: 20, navzdy: 10 });
  eq(bad, 'scheduleSave voláno jednou', e.saves(), 1);
  eq(bad, 'toast voláno jednou', e.toasts().length, 1);
  eq(bad, 'uloženo do k_A', e.stored('A'), { ted: 70, potom: 20, navzdy: 10 });
  eq(bad, 'profil B nedotčen (řetězec v localStorage)', e.ls.getItem('k_B'), bBefore);
  eq(bad, 'admin_pin zachován', e.run('state.settings.admin_pin'), '1234');
  ok(bad, 'state.settings.split není odkaz na rozpracovanou kopii', e.run('state.settings.split !== splitDraft'));
  e.click('split-inc-ted'); // další úprava rozpracované kopie
  eq(bad, 'úprava po uložení nemění state', e.split(), { ted: 70, potom: 20, navzdy: 10 });
  eq(bad, 'úprava po uložení nespouští uložení', e.saves(), 1);
  // uložený poměr používá i doDeposit
  e.run('doDeposit(100)');
  eq(bad, 'doDeposit použije uložený poměr', e.run('[state.history[0].ted, state.history[0].potom, state.history[0].navzdy]'), [70, 20, 10]);
  return bad;
});

// ── 6. Neuložená změna zmizí ───────────────────────────────────────
check('6. zamknutí adminu (lockAdmin i resetAdminView) zahodí neuloženou změnu', () => {
  for (const [name, lock] of [['lockAdmin()', 'lockAdmin()'], ['resetAdminView()', 'adminUnlocked = false; resetAdminView()']]) {
    const e = makeEnv(), bad = [];
    e.open();
    clickN(e, 'split-dec-ted', 3); // 65/10/10, neuloženo
    eq(bad, name + ': editace se projevila', e.vals(), [65, 10, 10]);
    e.run(lock);
    e.open();
    eq(bad, name + ': po znovuotevření hodnoty z profilu', e.vals(), [80, 10, 10]);
    ok(bad, name + ': Uložit aktivní', e.disabled('split-save-btn') === false);
    eq(bad, name + ': state beze změny', e.split(), D);
    eq(bad, name + ': žádné uložení', e.saves(), 0);
    if (bad.length) return bad;
  }
  return [];
});

check('6b. přepnutí profilu zahodí neuloženou změnu; editor ukáže hodnoty nového i původního profilu', () => {
  const e = makeEnv(), bad = [];
  const aBefore = e.ls.getItem('k_A'), bBefore = e.ls.getItem('k_B');
  e.open();
  clickN(e, 'split-inc-navzdy', 4); // rozpracováno na A: 80/10/30
  e.run(`switchToProfile('B')`);
  eq(bad, 'aktivní profil B', e.run('currentUserId'), 'B');
  e.open();
  eq(bad, 'B: editor ukazuje poměr profilu B', e.vals(), [35, 35, 30]);
  ok(bad, 'B: Uložit aktivní (nepřenesl se neplatný součet)', e.disabled('split-save-btn') === false);
  e.run(`switchToProfile('A')`);
  e.open();
  eq(bad, 'zpět na A: uložený poměr, ne rozpracovaný', e.vals(), [80, 10, 10]);
  eq(bad, 'A v localStorage beze změny', e.ls.getItem('k_A'), aBefore);
  eq(bad, 'B v localStorage beze změny', e.ls.getItem('k_B'), bBefore);
  eq(bad, 'žádné uložení', e.saves(), 0);
  return bad;
});

check('6c. uložení na A nezmění B po přepnutí', () => {
  const e = makeEnv(), bad = [];
  e.open();
  clickN(e, 'split-dec-ted', 2); clickN(e, 'split-inc-navzdy', 2); // 70/10/20
  e.click('split-save-btn');
  e.run(`switchToProfile('B')`);
  eq(bad, 'B: state.settings.split', e.split(), { ted: 35, potom: 35, navzdy: 30 });
  e.open();
  eq(bad, 'B: editor', e.vals(), [35, 35, 30]);
  eq(bad, 'A uložen', e.stored('A'), { ted: 70, potom: 10, navzdy: 20 });
  eq(bad, 'B uložen původní', e.stored('B'), { ted: 35, potom: 35, navzdy: 30 });
  return bad;
});

check('6d. rozpracovaná změna přežije překreslení panelu; po výměně state (import/reset) se zahodí', () => {
  const e = makeEnv(), bad = [];
  e.open();
  clickN(e, 'split-dec-ted', 2); // 70/10/10
  e.run('renderAdminPanel()');
  eq(bad, 'po překreslení (např. po vkladu) zůstává rozpracováno', e.vals(), [70, 10, 10]);
  e.run(`state = { ...state, settings: { ...state.settings, split: { ted: 0, potom: 0, navzdy: 100 } } }; renderAdminPanel();`);
  eq(bad, 'po výměně state se načte poměr z nového state', e.vals(), [0, 0, 100]);
  return bad;
});

// ── 7. Obnovit 80/10/10 ────────────────────────────────────────────
check('7. Obnovit 80/10/10 mění jen rozpracovanou hodnotu; uloží se až Uložit', () => {
  const e = makeEnv(), bad = [];
  e.run(`state.settings.split = { ted: 70, potom: 20, navzdy: 10 }; localStorage.setItem('k_A', JSON.stringify({ state })); calls.length = 0;`);
  const aBefore = e.ls.getItem('k_A');
  e.open();
  eq(bad, 'start: uložený poměr', e.vals(), [70, 20, 10]);
  e.click('split-default-btn');
  eq(bad, 'editor ukazuje 80/10/10', e.vals(), [80, 10, 10]);
  eq(bad, 'state beze změny', e.split(), { ted: 70, potom: 20, navzdy: 10 });
  eq(bad, 'localStorage beze změny', e.ls.getItem('k_A'), aBefore);
  eq(bad, 'žádné scheduleSave', e.saves(), 0);
  eq(bad, 'žádný toast', e.toasts().length, 0);
  // z neplatného součtu se Obnovit vrátí do platného stavu
  e.click('split-inc-ted');
  ok(bad, 'neplatný součet blokuje Uložit', e.disabled('split-save-btn') === true);
  e.click('split-default-btn');
  ok(bad, 'po Obnovit je Uložit aktivní', e.disabled('split-save-btn') === false);
  e.click('split-save-btn');
  eq(bad, 'až Uložit zapíše', e.split(), D);
  eq(bad, 'scheduleSave po Uložit', e.saves(), 1);
  // po zahození (zamknutí) se Obnovit bez Uložit nevrací
  e.run(`state.settings.split = { ted: 70, potom: 20, navzdy: 10 }; calls.length = 0;`);
  e.run('lockAdmin()'); e.open();
  eq(bad, 'po uložení 70/20/10 a zamknutí editor ukazuje uložené', e.vals(), [70, 20, 10]);
  e.click('split-default-btn'); e.run('lockAdmin()'); e.open();
  eq(bad, 'Obnovit + zamknutí bez Uložit: hodnota z profilu', e.vals(), [70, 20, 10]);
  return bad;
});

// ── 8. Náhled a computeSplitAmounts ────────────────────────────────
const cents = (x) => Math.round(x * 100);
function oracle(c, sp) {
  const keys = ['ted', 'potom', 'navzdy'];
  const out = keys.map((k) => Math.round((c * sp[k]) / 100));
  const diff = c - out.reduce((a, b) => a + b, 0);
  let big = 0;
  keys.forEach((k, i) => { if (sp[k] > sp[keys[big]]) big = i; });
  out[big] += diff;
  return out;
}

check('8. computeSplitAmounts: čistá funkce shodná s oraclem pro všechny platné poměry × částky', () => {
  const e = makeEnv(), bad = [];
  ok(bad, 'computeSplitAmounts existuje', e.run('typeof computeSplitAmounts') === 'function');
  const splits = [];
  for (let t = 0; t <= 100; t += 5) for (let p = 0; t + p <= 100; p += 5) splits.push({ ted: t, potom: p, navzdy: 100 - t - p });
  const amts = [1, 2, 3, 7, 33, 99, 100, 777, 1234, 5555, 123457];
  const got = e.run(`(function () {
    const out = [];
    for (const sp of ${JSON.stringify(splits)}) for (const c of ${JSON.stringify(amts)}) {
      const before = JSON.stringify(sp), r = computeSplitAmounts(c / 100, sp);
      out.push([Math.round(r.ted * 100), Math.round(r.potom * 100), Math.round(r.navzdy * 100), JSON.stringify(sp) === before]);
    }
    return out;
  })()`);
  let i = 0, fails = 0;
  for (const sp of splits) for (const c of amts) {
    const g = got[i++], exp = oracle(c, sp);
    if (!(g[0] === exp[0] && g[1] === exp[1] && g[2] === exp[2] && g[3] === true) && fails++ < 5) bad.push(`${JSON.stringify(sp)} c=${c}: ${g} ≠ ${exp}`);
  }
  if (fails) bad.push(`celkem ${fails} chyb`);
  return bad;
});

check('8b. doDeposit počítá přes computeSplitAmounts() a chování se nemění', () => {
  const e = makeEnv(), bad = [];
  e.run('doDeposit(33)');
  eq(bad, 'history 80/10/10 z 33 Kč (haléře)', e.run('[state.history[0].ted, state.history[0].potom, state.history[0].navzdy]').map(cents), [2640, 330, 330]);
  e.run('computeSplitAmounts = () => ({ ted: 1, potom: 2, navzdy: 3 })');
  e.run('doDeposit(100)');
  eq(bad, 'doDeposit použil (podvrženou) computeSplitAmounts', e.run('[state.history[0].ted, state.history[0].potom, state.history[0].navzdy]'), [1, 2, 3]);
  return bad;
});

check('9. náhled „Ze 100 Kč půjde X Kč TEĎ · Y Kč POTOM · Z Kč NAVŽDY" odpovídá computeSplitAmounts()', () => {
  const e = makeEnv(), bad = [];
  const want = () => {
    const r = e.run('computeSplitAmounts(100, splitDraft)');
    return `Ze 100 Kč půjde ${r.ted} Kč TEĎ · ${r.potom} Kč POTOM · ${r.navzdy} Kč NAVŽDY`;
  };
  e.open();
  eq(bad, 'výchozí 80/10/10', e.txt('split-preview'), 'Ze 100 Kč půjde 80 Kč TEĎ · 10 Kč POTOM · 10 Kč NAVŽDY');
  eq(bad, 'výchozí = computeSplitAmounts', e.txt('split-preview'), want());
  clickN(e, 'split-dec-ted', 2); clickN(e, 'split-inc-potom', 2); // 70/20/10
  eq(bad, '70/20/10', e.txt('split-preview'), 'Ze 100 Kč půjde 70 Kč TEĎ · 20 Kč POTOM · 10 Kč NAVŽDY');
  eq(bad, '70/20/10 = computeSplitAmounts', e.txt('split-preview'), want());
  clickN(e, 'split-inc-navzdy', 4); clickN(e, 'split-dec-ted', 4); // 50/20/30
  eq(bad, '50/20/30 = computeSplitAmounts', e.txt('split-preview'), want());
  // náhled skutečně vychází z computeSplitAmounts (podvržená funkce se projeví)
  e.run('computeSplitAmounts = () => ({ ted: 1, potom: 2, navzdy: 3 })'); e.run('renderSplitEditor()');
  eq(bad, 'podvržená computeSplitAmounts', e.txt('split-preview'), 'Ze 100 Kč půjde 1 Kč TEĎ · 2 Kč POTOM · 3 Kč NAVŽDY');
  return bad;
});

check('9b. při neplatném součtu je náhled šedý hint místo částek (nezavádí součtem ≠ 100)', () => {
  const e = makeEnv(), bad = [];
  const pv = () => e.doc.getElementById('split-preview');
  e.open();
  ok(bad, 'při 100 % náhled není šedý', !pv().classList.contains('muted'));
  e.click('split-inc-ted');
  eq(bad, 'hint při 105 %', e.txt('split-preview'), 'Náhled se ukáže, až bude součet 100 %.');
  ok(bad, 'hint je šedý (.muted)', pv().classList.contains('muted'));
  clickN(e, 'split-dec-ted', 3); // 70/10/10 = 90
  eq(bad, 'hint při 90 %', e.txt('split-preview'), 'Náhled se ukáže, až bude součet 100 %.');
  e.click('split-inc-ted'); e.click('split-inc-ted'); // 80/10/10
  ok(bad, 'náhled se vrátí při 100 %', e.txt('split-preview').startsWith('Ze 100 Kč půjde'));
  ok(bad, 'šedá třída pryč', !pv().classList.contains('muted'));
  return bad;
});

// ── 10. Poznámka při NAVŽDY = 0 % ──────────────────────────────────
check('10. NAVŽDY = 0 %: poznámka o milnících 1000 a 2000 Kč; Uložení neblokuje', () => {
  const e = makeEnv(), bad = [];
  e.open();
  ok(bad, 'při NAVŽDY 10 % poznámka skrytá', e.hidden('split-note'));
  clickN(e, 'split-dec-navzdy', 2); // 80/10/0 – neplatný součet, ale poznámka už platí
  ok(bad, 'při NAVŽDY 0 % poznámka viditelná', e.hidden('split-note') === false);
  ok(bad, 'poznámka zmiňuje 1000', e.txt('split-note').includes('1000'));
  ok(bad, 'poznámka zmiňuje 2000', e.txt('split-note').includes('2000'));
  clickN(e, 'split-inc-ted', 2); // 90/10/0 – platné
  ok(bad, 'poznámka stále viditelná', e.hidden('split-note') === false);
  ok(bad, 'Uložit aktivní', e.disabled('split-save-btn') === false);
  e.click('split-save-btn');
  eq(bad, 'uloženo i s NAVŽDY 0 %', e.split(), { ted: 90, potom: 10, navzdy: 0 });
  eq(bad, 'scheduleSave voláno', e.saves(), 1);
  e.click('split-inc-navzdy');
  ok(bad, 'po zvýšení NAVŽDY poznámka zmizí', e.hidden('split-note'));
  return bad;
});

console.log('Zdroj:', process.env.SRC_FILE || 'git HEAD:index.html');
let failed = 0;
for (const [title, bad] of results) {
  if (bad) failed++;
  console.log((bad ? 'FAIL ' : 'PASS ') + title + (bad ? '  ← ' + bad.slice(0, 3).join(' | ') : ''));
}
console.log(failed ? `\n${failed} z ${results.length} scénářů selhalo` : `\nVšech ${results.length} scénářů prošlo`);
process.exit(failed ? 1 : 0);
