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

### Obrazovky (`<div id="screen-*" class="screen">`, přepínané `showScreen()`, ř. 5944)

| ID | Řádek | Popis | V `NAV_SCREENS`? |
|---|---|---|---|
| `screen-setup` | 4569 | první spuštění / jméno dítěte | ano |
| `screen-nadvorí` | 4604 | Nádvoří (domovská obrazovka, strom, streak) | ano |
| `screen-pokladnice` | 4742 | Pokladnice (vklady, zůstatky 80/10/10) | ano |
| `screen-pribehy` | 4950 | seznam příběhů | ano |
| `screen-reader` | 4962 | čtečka konkrétního příběhu | ano |
| `screen-tajemstvi` | 4994 | „Tajemství" — rozcestník na mini-hry | ano |
| `screen-minigame` | 5008 | kontejner pro mini-hru (`#minigame-canvas-wrap`) | ano |
| `screen-seals` | 5019 | přehled pečetí | ne (mimo nav) |
| `screen-vitrine` | 5034 | vitrína sbírek | ne (mimo nav) |
| `screen-admin` | 5049 | rodičovský admin panel | ano |

`NAV_SCREENS` (ř. 5943): `['setup','nadvorí','pokladnice','pribehy','reader','tajemstvi','minigame','admin']`.

### Globální stav

- **`state`** (ř. 5727, `let state = DEFAULT_STATE()`) — centrální objekt, tvar
  definován v `DEFAULT_STATE()` (ř. 5652–5726): `user, balances{living_80,dreams_10,
  forever_10}, settings, progression, wishlist, history, wisdom*, streak, rank,
  seals, tree, custom, challenges, collections, report, minigames`.
- **Persistence**: `localStorage['babylon_v3']` (čtení ř. 5739, zápis ř. 5843 přes
  `scheduleSave()`→`saveLocal()`) + volitelný Google Drive sync (`saveToDriveNow()`,
  `DRIVE_FILENAME`, GSI OAuth).
- **Další globály**: `adminUnlocked`, `currentStoryIdx`, `currentScreen`,
  `MINIGAMES[]` (ř. 5619), `SEALS[]` (ř. 8036), `PYRAMID[]`, `clientId`.
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

### Zanořené duplikáty backend-cf/backend-cf a backend-node/backend-node

`backend-cf/backend-cf/*` a `backend-node/backend-node/*` jsou bajtově
identické duplikáty svých rodičovských adresářů — vznikly nechtěným
dvouúrovňovým uploadem přes GitHub web UI (commit `d0c6ecc` „patch 3.2.0"
2026-04-24 přidal jen zanořenou verzi; `03446b0` „3.1.1 bug fix" 2026-04-25
přidal správnou top-level verzi, zanořenou nikdo nesmazal). Jsou to mrtvé
kopie bez reference — needituj je, edituj vždy top-level `backend-cf/src/index.js`
resp. `backend-node/server.js`.
