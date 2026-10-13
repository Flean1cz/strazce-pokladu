// Test: týdenní statistiky reportu (vklady, hranice týdne v místním čase).
// Spuštění: npm test  (výchozí zdroj: git show HEAD:index.html)
//           SRC_FILE=index.html npm test  (pracovní kopie)
process.env.TZ = 'Europe/Prague'; // pevné časové pásmo, ať test nezávisí na stroji
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

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

const FNS = ['fmt', 'isValidSplit', 'computeSplitAmounts', 'doDeposit',
  '_localDateKey', '_isoDayKey', '_historyDateKey', '_weekStartKey', '_collectWeekStats'];

function makeEnv() {
  const ctx = vm.createContext({ console: { log() {}, error() {} } });
  vm.runInContext(`
    var __NOW = null, __RealDate = Date;
    Date = class extends __RealDate {
      constructor(...a) { if (a.length === 0 && __NOW !== null) super(__NOW); else super(...a); }
      static now() { return __NOW !== null ? __NOW : __RealDate.now(); }
    };
    function toast() {}
    function scheduleSave() {}
    function coinAnimation() {}
    function renderAll() {}
    function addWisdom() {}
    function checkMilestones() {}
    function refreshTrees() {}
  `, ctx);
  vm.runInContext(extractDefaultState(), ctx);
  vm.runInContext('let state = DEFAULT_STATE();', ctx);
  for (const f of FNS) {
    const code = extractFn(f);
    if (code) vm.runInContext(code, ctx);
  }
  return {
    run: (c) => vm.runInContext(c, ctx),
    setNow: (iso) => vm.runInContext('__NOW = ' + new Date(iso).getTime() + ';', ctx),
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

// Pondělí 12. 10. 2026 je začátek týdne, neděle 11. 10. 2026 ještě patří do minulého.
const MON_NOON = '2026-10-12T12:00:00+02:00'; // ve středu/pondělí poledne: spolehlivě „tento týden"

check('1. doDeposit uloží ISO čas (iso) a ponechá lokalizované datum pro zobrazení', () => {
  const bad = [], e = makeEnv();
  e.setNow('2026-10-14T16:20:00+02:00'); // středa
  e.run('state = DEFAULT_STATE(); doDeposit(100);');
  const h = e.run('state.history[0]');
  if (!h || typeof h.iso !== 'string' || isNaN(Date.parse(h.iso))) bad.push('chybí platné pole iso: ' + JSON.stringify(h));
  else eq(bad, 'iso', h.iso, '2026-10-14T14:20:00.000Z');
  eq(bad, 'date (zobrazení)', h && h.date, '14. 10. 2026');
  return bad;
});

check('2. vklad udělaný dnes se v týdenním reportu počítá (dřív vždy 0)', () => {
  const bad = [], e = makeEnv();
  e.setNow('2026-10-14T16:20:00+02:00');
  e.run('state = DEFAULT_STATE(); doDeposit(100); doDeposit(50);');
  const s = e.run('_collectWeekStats()');
  eq(bad, 'deposits', s.deposits, 2);
  eq(bad, 'deposits_total_kc', s.deposits_total_kc, 150);
  return bad;
});

check('3. starší záznamy bez iso: „7. 10. 2026", „14. 10. 2026", „14.10.2026"; cizí/chybná data se ignorují', () => {
  const bad = [], e = makeEnv();
  e.setNow('2026-10-14T16:20:00+02:00'); // týden začíná 12. 10.
  e.run(`state = DEFAULT_STATE(); state.history = [
    { type:'deposit', amount:100, date:'14. 10. 2026' },   // tento týden (tvar z toLocaleDateString)
    { type:'deposit', amount:10,  date:'12.10.2026' },     // pondělí tento týden, bez mezer
    { type:'deposit', amount:70,  date:'7. 10. 2026' },    // minulý týden
    { type:'deposit', amount:5,   date:'blbost' },         // nečitelné
    { type:'deposit', amount:5 },                          // bez data
    { type:'deposit', amount:5,   date:null, iso:null },   // null-safe
    { type:'withdraw', amount:999, date:'14. 10. 2026' }   // není vklad
  ];`);
  const s = e.run('_collectWeekStats()');
  eq(bad, 'deposits', s.deposits, 2);
  eq(bad, 'deposits_total_kc', s.deposits_total_kc, 110);
  return bad;
});

check('4. iso má přednost před date; iso z minulého týdne se nepočítá', () => {
  const bad = [], e = makeEnv();
  e.setNow('2026-10-14T16:20:00+02:00');
  e.run(`state = DEFAULT_STATE(); state.history = [
    { type:'deposit', amount:40, date:'1. 1. 2020', iso:'2026-10-13T08:00:00.000Z' },  // iso rozhoduje → tento týden
    { type:'deposit', amount:60, date:'14. 10. 2026', iso:'2026-10-06T08:00:00.000Z' } // iso rozhoduje → minulý týden
  ];`);
  const s = e.run('_collectWeekStats()');
  eq(bad, 'deposits', s.deposits, 1);
  eq(bad, 'deposits_total_kc', s.deposits_total_kc, 40);
  return bad;
});

check('5. _weekStartKey: pondělí 00:30 místního času už patří do nového týdne (UTC je ještě neděle)', () => {
  const bad = [], e = makeEnv();
  e.setNow('2026-10-12T00:30:00+02:00');
  eq(bad, 'pondělí 00:30', e.run('_weekStartKey()'), '2026-10-12');
  e.setNow('2026-10-11T23:30:00+02:00');
  eq(bad, 'neděle 23:30', e.run('_weekStartKey()'), '2026-10-05');
  e.setNow(MON_NOON);
  eq(bad, 'pondělí poledne', e.run('_weekStartKey()'), '2026-10-12');
  e.setNow('2026-10-14T16:20:00+02:00');
  eq(bad, 'středa', e.run('_weekStartKey()'), '2026-10-12');
  e.setNow('2026-10-18T22:00:00+02:00');
  eq(bad, 'neděle večer', e.run('_weekStartKey()'), '2026-10-12');
  return bad;
});

check('6. hranice týdne: nedělní vklad (23:00) se do nového týdne nepočítá, pondělní 00:10 ano', () => {
  const bad = [], e = makeEnv();
  e.setNow('2026-10-12T09:00:00+02:00');
  e.run(`state = DEFAULT_STATE(); state.history = [
    { type:'deposit', amount:11, iso:'2026-10-11T21:00:00.000Z' },  // ne 23:00 místního → minulý týden
    { type:'deposit', amount:22, iso:'2026-10-11T22:10:00.000Z' }   // po 00:10 místního → nový týden
  ];`);
  const s = e.run('_collectWeekStats()');
  eq(bad, 'deposits', s.deposits, 1);
  eq(bad, 'deposits_total_kc', s.deposits_total_kc, 22);
  return bad;
});

check('7. ostatní statistiky: pečeti, moudrost i dny aktivity používají tutéž hranici týdne', () => {
  const bad = [], e = makeEnv();
  e.setNow('2026-10-12T09:00:00+02:00');
  e.run(`state = DEFAULT_STATE();
    state.seals.unlocked_at = { a:'2026-10-11T22:30:00.000Z', b:'2026-10-11T21:30:00.000Z' }; // a: po 00:30 pondělí, b: neděle 23:30
    state.wisdom_log = [ { amount:5, reason:'x', date:'2026-10-11T22:30:00.000Z' }, { amount:7, reason:'y', date:'2026-10-11T21:30:00.000Z' } ];
    state.wisdom_daily = { '2026-10-12': { open:true, tree_strokes:3 }, '2026-10-11': { open:true, tree_strokes:9 } };`);
  const s = e.run('_collectWeekStats()');
  eq(bad, 'new_seals', s.new_seals, 1);
  eq(bad, 'wisdom_gained', s.wisdom_gained, 5);
  eq(bad, 'days_active', s.days_active, 1);
  eq(bad, 'strokes', s.strokes, 3);
  return bad;
});

check('8. _isoDayKey: ISO → místní den; neplatný vstup → null', () => {
  const bad = [], e = makeEnv();
  eq(bad, 'UTC neděle 22:30', e.run("_isoDayKey('2026-10-11T22:30:00.000Z')"), '2026-10-12');
  eq(bad, 'prázdné', e.run('_isoDayKey(null)'), null);
  eq(bad, 'nesmysl', e.run("_isoDayKey('blbost')"), null);
  return bad;
});

let failed = 0;
for (const [title, bad] of results) {
  if (bad) { failed++; console.log('FAIL ' + title + '\n     ' + bad.join('\n     ')); }
  else console.log('PASS ' + title);
}
console.log(failed ? `\n${failed} z ${results.length} scénářů selhalo` : `\nVšech ${results.length} scénářů prošlo`);
console.log('Zdroj: ' + (process.env.SRC_FILE || 'git HEAD:index.html'));
process.exit(failed ? 1 : 0);
