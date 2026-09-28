// Test: popisky v UI podle aktuálního state.settings.split (Fáze S3).
// Spuštění: npm test  (výchozí zdroj: git show HEAD:index.html)
//           SRC_FILE=index.html npm test  (pracovní kopie)
//
// Kontrakt, který test předpokládá:
//   funkce   renderSplitLabels()  – volaná z renderAll() a po saveSplit(), jen textContent
//   DOM      .golden-rule (banner), .jar-card.{ted,potom,navzdy} .jar-sublabel (Pokladnice),
//            #adm-{ted,potom,navzdy} → .admin-bal-label, #admin-deposit-btn (admin → Nastavení),
//            #weekly-split-info (tab Úkoly, pod týdenním kapesným)
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
const FNS = ['fmt', 'renderAll', 'doDeposit', 'renderAdminPanel', 'updatePinDots', 'checkPin', 'resetAdminView',
  'lockAdmin', 'switchToProfile', ...splitFnNames];
const DRAFT_DECLS = src.match(/^let splitDraft[^\n]*$/gm) || [];

// Skutečný markup dotčených částí z index.html (parsování bez spuštění skriptů)
const fullDoc = new JSDOM(src).window.document;
const pick = (sel) => { const el = fullDoc.querySelector(sel); return el ? el.outerHTML : ''; };
const MARKUP = pick('.golden-rule') + pick('.jars-grid') +
  '<div id="admin-pin-view"></div><div id="admin-panel-view" style="display:none">' +
  pick('#admin-tab-settings') + pick('#admin-tab-tasks') + '</div>' +
  '<div id="pin-error"></div><input id="name-input">';

const norm = (s) => s.replace(/ /g, ' ');
const SP_A = { ted: 80, potom: 10, navzdy: 10 };
const SP_B = { ted: 70, potom: 20, navzdy: 10 };

function makeEnv(splitA = SP_A, splitB = SP_B) {
  const dom = new JSDOM(`<body>${MARKUP}</body>`, { url: 'http://localhost/' });
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
    function checkWeeklyTaskEvaluation() {}
    function renderNadvorí() {}
    function renderPokladnice() {}
    function renderStories() {}
    function renderSecrets() {}
    function renderTaskChecklist() {}
    function renderTaskTemplate() {}
    function renderTaskExceptions() {}
    function updateTataBanka() {}
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
  ls.setItem('k_A', JSON.stringify({ state: seed(splitA) }));
  ls.setItem('k_B', JSON.stringify({ state: seed(splitB) }));
  ls.setItem('babylon_v3_last_user', 'A');
  vm.runInContext('loadLocal(); calls.length = 0;', ctx);
  vm.runInContext('if (typeof bindSplitEditor === "function") bindSplitEditor();', ctx);
  const t = (sel) => { const el = doc.querySelector(sel); return el ? norm(el.textContent) : '(chybí ' + sel + ')'; };
  const env = {
    doc, ls, run: (c) => vm.runInContext(c, ctx),
    click: (id) => doc.getElementById(id).click(),
    // všechna místa s poměrem, jak je právě vidí uživatel
    labels: () => ({
      banner: t('.golden-rule'),
      jars: ['ted', 'potom', 'navzdy'].map((k) => t('.jar-card.' + k + ' .jar-sublabel')),
      admin: ['ted', 'potom', 'navzdy'].map((k) => {
        const lab = doc.getElementById('adm-' + k)?.closest('.admin-bal')?.querySelector('.admin-bal-label');
        return lab ? norm(lab.textContent) : '(chybí popisek ' + k + ')';
      }),
      button: t('#admin-deposit-btn'),
      info: t('#weekly-split-info'),
    }),
  };
  return env;
}

// očekávané texty pro daný poměr (zdroj pravdy testu, napsaný natvrdo podle zadání)
function expected(sp) {
  const golden = sp.ted === 80 && sp.potom === 10 && sp.navzdy === 10;
  return {
    banner: `⚖️ ${golden ? 'Zlaté pravidlo' : 'Naše pravidlo'} · ${sp.ted} % TEĎ · ${sp.potom} % POTOM · ${sp.navzdy} % NAVŽDY`,
    jars: [`ÚTRATA ${sp.ted} %`, `SPOŘENÍ ${sp.potom} %`, `POKLAD ${sp.navzdy} %`],
    admin: [`TEĎ (${sp.ted} %)`, `POTOM (${sp.potom} %)`, `NAVŽDY (${sp.navzdy} %)`],
    button: `➕ Vložit a rozdělit (${sp.ted}/${sp.potom}/${sp.navzdy})`,
    info: `Kapesné se rozdělí ${sp.ted} / ${sp.potom} / ${sp.navzdy} (změníš v Nastavení).`,
  };
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
const eqAll = (bad, prefix, got, exp) => { for (const k of Object.keys(exp)) eq(bad, prefix + k, got[k], exp[k]); };

// ── 1. Struktura ───────────────────────────────────────────────────
check('1. existují všechna místa; věta o kapesném je šedá (report-desc) pod týdenním kapesným', () => {
  const bad = [];
  ok(bad, 'funkce renderSplitLabels existuje', splitFnNames.includes('renderSplitLabels'));
  ok(bad, '.golden-rule', !!fullDoc.querySelector('.golden-rule'));
  for (const k of ['ted', 'potom', 'navzdy']) {
    ok(bad, `.jar-card.${k} .jar-sublabel`, !!fullDoc.querySelector(`.jar-card.${k} .jar-sublabel`));
    ok(bad, `#adm-${k} v .admin-bal s popiskem`, !!fullDoc.getElementById('adm-' + k)?.closest('.admin-bal')?.querySelector('.admin-bal-label'));
  }
  ok(bad, '#admin-deposit-btn', !!fullDoc.getElementById('admin-deposit-btn'));
  const info = fullDoc.getElementById('weekly-split-info');
  ok(bad, '#weekly-split-info existuje', !!info);
  if (info) {
    ok(bad, 'má třídu report-desc (šedý popisek)', info.classList.contains('report-desc'));
    const card = fullDoc.getElementById('weekly-allowance-inp').closest('.admin-card');
    ok(bad, 'je v kartě týdenního kapesného, za políčkem částky',
      info.closest('.admin-card') === card &&
      !!(fullDoc.getElementById('weekly-allowance-inp').compareDocumentPosition(info) & 4));
    ok(bad, 'je uvnitř #admin-tab-tasks', !!info.closest('#admin-tab-tasks'));
  }
  return bad;
});

check('2. kód používá jen textContent (žádné innerHTML v renderSplitLabels)', () => {
  const code = extractFn('renderSplitLabels');
  if (!code) return ['renderSplitLabels chybí'];
  return /innerHTML|insertAdjacentHTML|outerHTML/.test(code) ? ['renderSplitLabels používá HTML API'] : [];
});

// ── 3. 80/10/10 vs. jiný poměr ─────────────────────────────────────
check('3. 80/10/10 → „Zlaté pravidlo" a všechna místa přesně podle zadání', () => {
  const e = makeEnv(), bad = [];
  e.run('renderAll()');
  const got = e.labels();
  eq(bad, 'banner doslova', got.banner, '⚖️ Zlaté pravidlo · 80 % TEĎ · 10 % POTOM · 10 % NAVŽDY');
  eqAll(bad, '', got, expected(SP_A));
  return bad;
});

check('4. 70/20/10 → „Naše pravidlo" a všechna místa přesně podle zadání', () => {
  const e = makeEnv(SP_B, SP_A), bad = [];
  e.run('renderAll()');
  const got = e.labels();
  eq(bad, 'banner doslova', got.banner, '⚖️ Naše pravidlo · 70 % TEĎ · 20 % POTOM · 10 % NAVŽDY');
  eq(bad, 'sublabely', got.jars, ['ÚTRATA 70 %', 'SPOŘENÍ 20 %', 'POKLAD 10 %']);
  eq(bad, 'admin zůstatky', got.admin, ['TEĎ (70 %)', 'POTOM (20 %)', 'NAVŽDY (10 %)']);
  eq(bad, 'tlačítko', got.button, '➕ Vložit a rozdělit (70/20/10)');
  eq(bad, 'věta v tabu Úkoly', got.info, 'Kapesné se rozdělí 70 / 20 / 10 (změníš v Nastavení).');
  ok(bad, 'nezůstalo „Zlaté pravidlo"', !got.banner.includes('Zlaté'));
  return bad;
});

check('5. různé poměry (i 0 % a 100 %) – všechna místa spolu souhlasí', () => {
  const bad = [];
  const cases = [{ ted: 60, potom: 30, navzdy: 10 }, { ted: 90, potom: 10, navzdy: 0 }, { ted: 0, potom: 0, navzdy: 100 },
    { ted: 50, potom: 25, navzdy: 25 }, { ted: 10, potom: 10, navzdy: 80 }];
  for (const sp of cases) {
    const e = makeEnv(sp);
    e.run('renderAll()');
    eqAll(bad, `${sp.ted}/${sp.potom}/${sp.navzdy} `, e.labels(), expected(sp));
  }
  return bad;
});

// ── 6. Profily, načtení, import ────────────────────────────────────
check('6. dva profily s různým splitem – přepnutí A→B→A přepíše popisky', () => {
  const e = makeEnv(SP_A, SP_B), bad = [];
  e.run('renderAll()');
  eqAll(bad, 'A: ', e.labels(), expected(SP_A));
  e.run("switchToProfile('B')");
  eqAll(bad, 'po přepnutí na B: ', e.labels(), expected(SP_B));
  e.run("switchToProfile('A')");
  eqAll(bad, 'po návratu na A: ', e.labels(), expected(SP_A));
  return bad;
});

check('7. F5 (nové načtení profilu s uloženým splitem) a import (nový state) → popisky sedí', () => {
  const bad = [];
  // F5: čerstvé prostředí, poslední profil je B
  const f5 = makeEnv(SP_A, SP_B);
  f5.ls.setItem('babylon_v3_last_user', 'B');
  f5.run('loadLocal(); renderAll();');
  eqAll(bad, 'F5 profil B: ', f5.labels(), expected(SP_B));
  // import: state se vymění za importovaný a zavolá se renderAll (jako importData)
  const imp = makeEnv(SP_A, SP_B);
  imp.run('renderAll()');
  imp.run(`state = Object.assign({}, state, { settings: Object.assign({}, state.settings, { split: { ted: 40, potom: 40, navzdy: 20 } }) }); renderAll();`);
  eqAll(bad, 'po importu: ', imp.labels(), expected({ ted: 40, potom: 40, navzdy: 20 }));
  return bad;
});

// ── 8. Editor ──────────────────────────────────────────────────────
check('8. po Uložit v editoru se popisky změní hned (a před Uložit ne)', () => {
  const e = makeEnv(), bad = [];
  e.run('renderAll(); adminUnlocked = true; renderAdminPanel();');
  eqAll(bad, 'start: ', e.labels(), expected(SP_A));
  e.click('split-dec-ted'); e.click('split-dec-ted'); // 70
  e.click('split-inc-potom'); e.click('split-inc-potom'); // 20
  eqAll(bad, 'rozpracováno (neuloženo): ', e.labels(), expected(SP_A));
  e.click('split-save-btn');
  eq(bad, 'uložený split', e.run('JSON.parse(JSON.stringify(state.settings.split))'), SP_B);
  eqAll(bad, 'hned po Uložit: ', e.labels(), expected(SP_B));
  // zpět na 80/10/10 přes editor → banner zase „Zlaté pravidlo"
  e.click('split-default-btn');
  e.click('split-save-btn');
  eqAll(bad, 'po návratu na výchozí: ', e.labels(), expected(SP_A));
  return bad;
});

check('9. neplatný split neshodí vykreslení ani nepřepíše popisky', () => {
  const e = makeEnv(), bad = [];
  e.run('renderAll()');
  const before = JSON.stringify(e.labels());
  e.run('state.settings.split = { ted: 33, potom: 33, navzdy: 33 }');
  e.run('renderSplitLabels()');
  eq(bad, 'popisky beze změny', JSON.stringify(e.labels()), before);
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
