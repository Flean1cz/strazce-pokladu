# CLAUDE.md — Strážce pokladu

Poznámky pro práci s tímto repem. Aplikace: PWA pro finanční gramotnost dětí,
babylonský motiv, pravidlo 80/10/10.

## ⚠️ index.html — nikdy nečíst Read toolem

`index.html` (14 431 řádků) má deny pravidlo v `.claude/settings.local.json`
(`Read(index.html)`). Toto pravidlo blokuje na úrovni sandboxu **i Grep, i Bash/
PowerShell** při jakémkoli přímém přístupu k souboru (přímý `Read`, `grep index.html`,
`cp index.html ...`, `Get-Content`/`Select-String` na cestu k souboru) — nejde jen
o `Read` tool.

**Funkční obchvat:** `git show HEAD:index.html` čte obsah z git object store, ne
z pracovní kopie, takže sandbox ho nezachytí. Vždy takto:

```bash
git show HEAD:index.html | grep -n 'vzor' | head -50
git show HEAD:index.html | sed -n '5600,5660p'
```

Nikdy nenačítat celý soubor do kontextu najednou — vždy cílit grepem/sed na
konkrétní rozsah řádků.

## Struktura index.html

Jeden monolitický soubor: `<style>` blok (ř. 19–4539), pak HTML obrazovky
(ř. 4569–5049+), pak **jediný `<script>` blok** (ř. 5394–14429) — veškerá JS logika
appky je inline, žádné externí JS soubory se nenačítají za běhu.

### Obrazovky (`<div id="screen-*" class="screen">`, přepínané `showScreen()`, ř. 6238)

| ID | Řádek | Popis | V `NAV_SCREENS`? |
|---|---|---|---|
| `screen-setup` | 4650 | první spuštění / jméno dítěte | ano |
| `screen-nadvorí` | 4685 | Nádvoří (domovská obrazovka, strom, streak) | ano |
| `screen-pokladnice` | 4823 | Pokladnice (vklady, zůstatky 80/10/10) | ano |
| `screen-pribehy` | 5031 | seznam příběhů | ano |
| `screen-reader` | 5043 | čtečka konkrétního příběhu | ano |
| `screen-tajemstvi` | 5075 | „Tajemství" — rozcestník na mini-hry | ano |
| `screen-minigame` | 5089 | kontejner pro mini-hru (`#minigame-canvas-wrap`) | ano |
| `screen-seals` | 5100 | přehled pečetí | ne (mimo nav) |
| `screen-vitrine` | 5115 | vitrína sbírek | ne (mimo nav) |
| `screen-ukoly` | 5130 | Úkoly tento týden (týdenní mřížka, od Fáze 3c) | ano |
| `screen-admin` | 5144 | rodičovský admin panel | ano |

`NAV_SCREENS` (ř. 6237): `['setup','nadvorí','pokladnice','pribehy','reader','tajemstvi','ukoly','minigame','admin']`.

### Globální stav

- **`state`** (ř. 5727, `let state = DEFAULT_STATE()`) — centrální objekt, tvar
  definován v `DEFAULT_STATE()` (ř. 5652–5726): `user, balances{living_80,dreams_10,
  forever_10}, settings, progression, wishlist, tasks, history, wisdom*, streak,
  rank, seals, tree, custom, challenges, collections, report, minigames`.
- **`state.tasks.template`** (od Fáze 3a) — pole `{id, nazev, dny}` (šablona
  týdenních úkolů, `dny` = podmnožina `['po','ut','st','ct','pa','so','ne']`),
  plus `state.settings.weekly_allowance` (Kč, max. týdenní kapesné). Obojí
  nastavuje rodič v 3. tabu adminu (`data-admin-tab="tasks"`,
  `renderTaskTemplate()`, `addTaskToTemplate()`, `removeTaskFromTemplate()`,
  `saveWeeklyAllowance()` — KROK 17). Plně per-profil, stejně jako `wishlist`.
- **`state.tasks.exceptions`** (od Fáze 3b) — `{ [weekKey]: { [taskId]: dny[] } }`,
  kde `weekKey` je formát `"YYYY-Www"` (shodný s výstupem `_getWeekKey()` i
  s hodnotou `<input type="week">`) a `dny` jsou dny VYPNUTÉ pro daný úkol
  v daném týdnu (šablona zůstává nedotčená, výjimka jen odečítá). Editor
  v adminu (`renderTaskExceptions()`, `toggleTaskException()` — KROK 18)
  s date-pickerem `#task-exc-week-inp`. Plně per-profil.
- **`state.tasks.done`** (od Fáze 3c) — `{ [dateKey]: [taskId, ...] }`
  (`dateKey` = `"YYYY-MM-DD"`), co dítě který den zaškrtlo. Nová obrazovka
  `screen-ukoly` (📋 „Úkoly tento týden", 5. tlačítko v `#bottom-nav`, v
  `NAV_SCREENS`) zobrazuje **týdenní mřížku** (CSS Grid, řádky = úkoly,
  sloupce = Po–Ne s daty aktuálního týdne, přes celou šířku obrazovky):
  `isTaskActiveOnDay(task, dayCode, weekKey)` řeší, jestli je úkol daný den
  aktivní (šablona ∩ den, minus výjimka), `getCurrentWeekDates()` vrátí 7
  dat aktuálního týdne, `renderTaskChecklist()` vykreslí mřížku,
  `toggleTaskDone(taskId, dateKey)` zaškrtává KTERÝKOLI den v týdnu
  (minulý i budoucí, ne jen dnešek) — KROK 19. `showScreen()` re-renderuje
  mřížku při každém vstupu na obrazovku, aby se okamžitě projevila
  případná úprava šablony/výjimek v adminu. Plně per-profil.
  **Landscape gate (od Fáze 4a)**: čisté CSS, žádný JS — `@media
  (min-width: 768px) and (orientation: portrait)` (KROK 21) schová
  `.task-checklist-wrap` a zobrazí `.task-rotate-overlay` („Otoč tablet
  na šířku") místo mřížky. `min-width` schválně omezuje efekt jen na
  tabletové šířky — telefon v portraitu (šířka pod 768px) mřížku
  zobrazuje normálně (ověřeno na reálném telefonu ve Fázi 3c/3d, gate se
  ho netýká).
- **`state.tasks.history`** a **`state.tasks.last_evaluated_week`** (od
  Fáze 3d) — `history` je pole `{weekKey, done, total, payout, evaluated_at}`
  (nejnovější první, cap 52), `last_evaluated_week` je `"YYYY-Www"`
  posledního vyhodnoceného týdne. `checkWeeklyTaskEvaluation()` (ř. 6663,
  volaná z boot sekvence, `switchToProfile()` a `createProfile()` — vždy
  hned po `renderAll()`) porovná aktuální týden s `last_evaluated_week`;
  při přechodu vyhodnotí KAŽDÝ přeskočený týden zvlášť přes `evaluateWeek()`
  (ř. 6643, počítá splněno/celkem z efektivní šablony toho týdne a spouští
  `doDeposit()` s poměrnou částí `weekly_allowance`). `getDatesForWeekKey()`
  (ř. 6619) je obecná inverze `_getWeekKey()` (týden→7 dat), sdílená mřížkou
  i vyhodnocením. Při prvním setkání s funkcí (starý profil bez
  `last_evaluated_week`) se nevyplácí nic zpětně, jen se nastaví baseline.
  Plně per-profil.
- **Persistence (multi-user, od Fáze 1; UI přepínání od Fáze 2)**: `state` se
  ukládá per-profil pod `localStorage['babylon_v3_user_' + currentUserId]`
  (čtení v `loadLocal()`, zápis v `saveLocal()` přes `scheduleSave()`→`saveLocal()`)
  + volitelný Google Drive sync (`saveToDriveNow()`, `DRIVE_FILENAME`, GSI OAuth).
  Seznam profilů `[{ id, jmeno, vytvoreno }]` je zvlášť v
  `localStorage['babylon_v3_profiles']`, spravuje ho `ensureActiveProfile()`
  (volaná na začátku `loadLocal()`) — při bootu vybere profil podle
  `localStorage['babylon_v3_last_user']`, pokud existuje a odpovídá reálnému
  profilu, jinak spadne na `profiles[0]`. Uživatel přepíná mezi profily a
  vytváří nové přes rolovací menu `#profile-menu` (vlevo nahoře, skryté jen
  na `screen-setup`) — KROK 16 blok funkcí `listProfiles()`, `saveProfiles()`,
  `syncProfileName()` (volaná ze `saveLocal()`, drží `profile.jmeno` v
  `babylon_v3_profiles` sesynchronizované se `state.user.name`),
  `switchToProfile(id)`, `createProfile(jmeno)`, `renderProfileMenu()`,
  `openProfileMenu()`/`closeProfileMenu()`. `driveFileId` je součástí
  per-profilového blobu (tedy taky per-profil); `clientId`/OAuth token
  zůstávají globální/sdílené napříč profily. Starý jednotný klíč
  `localStorage['babylon_v3']` zůstává na disku jako netknutá legacy záloha
  (appka ho po jednorázové migraci existujících dat už nečte ani nezapisuje).
- **`currentUserId`** (ř. ~5731, `let currentUserId = null;`) — globál stejného
  stylu jako `currentScreen`; nastavuje ho `ensureActiveProfile()` na id
  aktivního profilu.
- **Další globály**: `adminUnlocked`, `currentStoryIdx`, `currentScreen`,
  `currentUserId`, `MINIGAMES[]` (ř. 5619), `SEALS[]` (ř. 8036), `PYRAMID[]`,
  `clientId`.
- **Hlavní mutační místa**: `doDeposit()` ř. 6353 (rozděluje vklad 80/10/10),
  úrok ř. 7039–7041, `addWisdom()` ř. 7568, `checkAllSeals()` ř. 8261,
  `finishMinigame()` ř. 6297 (zapisuje `state.minigames.*`), reset na
  `DEFAULT_STATE()` ř. 7010.

## Vazby mezi soubory

| Vazba | Mechanismus |
|---|---|
| `index.html` → `manifest.json` | `<link rel="manifest">` (ř. 11), standardní PWA manifest |
| `index.html` → `sw.js` | `navigator.serviceWorker.register('sw.js')` (ř. 7067) |
| `sw.js` → `index.html` | `CORE_ASSETS` v `sw.js` precachuje `./index.html` a `./manifest.json` atomicky |

### ⚠️ `mg2_render.js` a `mg2_styles.css` jsou patch-fragmenty, ne live soubory

**Nejsou to externě načítané skripty.** Jsou to zdrojové fragmenty, jejichž celý
obsah se ručně vloží do jediného `<script>`/`<style>` bloku v `index.html`
(postup viz `PATCH.md`). Aktuální stav v repu odpovídá už *aplikovanému* patchi:
`window.renderMinigame_2` je inline na ř. 11826 v `index.html` a obsahově
odpovídá `mg2_render.js`. Soubory `mg2_render.js` / `mg2_styles.css` v repu jsou
tedy záloha/zdroj pro budoucí patchování, ne součást runtime — needituj je
s očekáváním, že se změna projeví v appce; edituj rovnou příslušný rozsah v
`index.html` (přes `git show HEAD:index.html | ...`).

Analogicky existují `renderMinigame_0` až `renderMinigame_6` inline v
`index.html` (ř. 10514–13991) pro her 0–6.

## backend-cf vs backend-node

Oba implementují identické endpointy (`/health`, `POST /subscribe`,
`DELETE /unsubscribe`) nad stejnou tabulkou `subscribers` a stejnou e-mailovou
šablonou pro týdenní report rodičům — liší se jen infrastrukturou.

| | backend-cf | backend-node |
|---|---|---|
| Runtime | Cloudflare Workers | Node.js/Express |
| DB | D1 (`database_id` v `wrangler.toml` je stále placeholder `DOPLNTE_PO_VYTVORENI`) | SQLite (`better-sqlite3`) |
| Mail | Resend API | Nodemailer (Gmail/SMTP) |
| Cron | `wrangler.toml` crons (UTC, ručně přepínat léto/zima) | `node-cron` s `timezone: Europe/Prague` |
| Deploy | doporučená varianta v `backend-cf/README.md` | alternativa (Railway/Render/VPS) |

### ⚠️ BACKEND_URL je null — backend integrace je vypnutá

`index.html` ř. 10672: `var BACKEND_URL = null;` — nikdy nebyla nastavena na
reálnou URL v žádném commitu. `subscribeToBackend()` / `unsubscribeFromBackend()`
mají guard `if (!BACKEND_URL) return;`, takže funkce týdenního e-mail reportu
je v appce zabudovaná, ale tiše vypnutá (silent fail, záměrně dle README).
**Žádný z backendů (`backend-cf` ani `backend-node`) tedy aktuálně neběží
napojený na appku.** Pokud práce vyžaduje ho zapojit, je potřeba nastavit
`BACKEND_URL` na skutečně nasazenou URL.

## Plánované změny

1. **Android tablet, orientace na šířku** — ✅ HOTOVO. Upřesněný rozsah
   (po diskuzi): zbytek appky (Nádvoří, Pokladnice, Příběhy, Admin)
   zůstává beze změny, jen portrait — žádný redesign. Rozděleno na
   2 podkroky, oba hotové:
   - **4a — landscape gate na obrazovce Úkoly**. Viz „Globální stav"
     výše (`.task-rotate-overlay`, KROK 21).
   - **4b — tablet touch-target review napříč celou appkou**. 23 CSS
     úprav (padding/font-size/explicitní width-height) napříč appkou —
     bottom-nav, back-btn, wishlist tlačítka, audio tlačítka, profile
     menu, Úkoly mřížka, a napříč adminem (taby, tlačítka, editor
     úkolů/výjimek, data/zálohy, report). Žádná nová HTML struktura ani
     JS, jen zvětšení existujících dotykových cílů na tabletovou míru.
     Vedlejší zjištění (neopravováno, mimo rozsah 4b — možný budoucí
     drobný úkol): několik modálů (`modal-secret`, `modal-seal`,
     `modal-artifact`, `modal-customize`, `modal-arkad`, `modal-tree-name`,
     `modal-week-eval`) nemá klik-na-pozadí-zavře handler, na rozdíl od
     `modal-wish`/`modal-add-profile`/`modal-add-task`, které ho mají —
     nekonzistence v chování, ne ve velikosti dotykového cíle.

2. **Přepínání účtů (děti)** — čistě lokální na zařízení, přes `localStorage`.
   Žádná cloud synchronizace mezi zařízeními, žádný server účet rodiče. Dnešní
   model má jediný globální `state` (viz „Globální stav" výše) — přechod na
   víc účtů znamená víc instancí tohoto stavu vedle sebe + mechanismus, který
   přepíná, který z nich je „aktivní" a ukládá se pod který klíč v `localStorage`
   (dnes jediný pevný klíč `babylon_v3`).

3. **Nová domovská obrazovka: týdenní přehled úkolů** — ✅ HOTOVO (Fáze
   3a–3d, viz „Globální stav" výše pro aktuální implementaci).
   - **Šablona úkolů**: rodič nastaví jednou v adminu; každý úkol má seznam dní
     v týdnu, kdy je normálně aktivní.
   - **Týdenní výjimky**: rodič může po odemčení pro konkrétní týden vypnout
     konkrétní úkol na konkrétní den (např. „jít do školy" během prázdnin).
     Toto se neukládá do šablony, ale zvlášť per týden (šablona zůstává
     nedotčená, výjimky jsou vedlejší časově vázaná struktura).
   - Dítě zaškrtává splněné úkoly v týdenní mřížce (libovolný den v týdnu,
     ne jen dnešek).
   - Týdenní vyhodnocení počítá ze šablony minus aktivní výjimky pro daný
     týden; výsledek spouští `doDeposit()` pro rozdělení kapesného 80/10/10.

4. **Pořadí implementace**: 1) multi-user state model → 2) UI přepínání účtů
   → 3) týdenní úkoly → 4) Android/landscape. **Všechny 4 fáze jsou hotové
   — celý původní plán je tímto dokončen.** Případné další změny už budou
   nová samostatná zadání, ne pokračování tohoto seznamu.
