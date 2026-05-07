# Patch — Hra 2 „Rostoucí hromada" (KROK 14.18)

Verze: `v2.19.0`
Status testů: **36/36 passed** (Node + JSDOM, simulace plného user flow)

---

## Přehled změn

| Soubor | Akce | Velikost změny |
|---|---|---|
| `index.html` ř. 3470 | Úprava `MINIGAMES[2]` | 1 řádek |
| `index.html` ř. 2476 | Vložit CSS blok | ~290 řádků |
| `index.html` ř. 9663 | Vložit JS blok | ~510 řádků |
| `sw.js` | Nahradit celý soubor | bump na v2.19.0 |

Žádné nové externí assety. Žádná migrace stavu. Backward-kompatibilní (existující `state.minigames` stačí).

---

## Patch 1 — Úprava MINIGAMES[2] (ř. 3470)

**Najdi v `index.html` řádek 3470:**

```js
  { id: 2, title: "Rostoucí hromada",   icon: "📈", short: "Sleduj kouzlo úročení",     max_wisdom: 25, implemented: false },
```

**Nahraď za:**

```js
  { id: 2, title: "Rostoucí hromada",   icon: "📈", short: "3 kola — kouzlo úročení",  max_wisdom: 90, implemented: true  },
```

**Změny:** `short` text, `max_wisdom: 25 → 90`, `implemented: false → true`.

---

## Patch 2 — Vložit CSS blok (před ř. 2477)

V `index.html` najdi blok:

```css
.mg1-scorebar{
  font-family:'Cinzel',serif;
  font-size:0.9rem;
  color:var(--gold);
  text-align:center;
  letter-spacing:0.04em;
  margin-top:0.25rem;
}
                            ← SEM (mezi prázdné řádky 2476)
/* ═══════════════════════════════════
   FÁZE 5 – ADMIN EXPORT/DRIVE CSS
═══════════════════════════════════ */
```

Mezi konec `.mg1-scorebar { ... }` (ř. 2475) a komentář `FÁZE 5 — ADMIN EXPORT/DRIVE CSS` (ř. 2477) **vlož celý obsah souboru `mg2_styles.css`**.

---

## Patch 3 — Vložit JS render funkci (mezi ř. 9663 a 9664)

V `index.html` najdi konec `renderMinigame_1`:

```js
  // Start
  showIntro();
};                              ← konec renderMinigame_1 (ř. 9663)
                                ← SEM
/* ═══════════════════════════════════════════════════════
   KONEC HRY 1
═══════════════════════════════════════════════════════ */
</script>
```

Za zavírací `};` (ř. 9663) a před komentář `KONEC HRY 1` **vlož celý obsah souboru `mg2_render.js`**.

---

## Patch 4 — Nahradit `sw.js`

Nahraď celý soubor `sw.js` přiloženou verzí. Změna je jen na řádku 6:

```diff
- const VERSION = 'v2.18.0'; // ← KROK 14.17: Hra 1 — Potřeba × přání, 3 kola, skóre 0-90
+ const VERSION = 'v2.19.0'; // ← KROK 14.18: Hra 2 — Rostoucí hromada, hybrid 3 kola, skóre 0-90
```

---

## Po nasazení — kontrolní seznam

1. ☐ Otevři aplikaci, zkontroluj v konzoli `[SW] Activate v2.19.0`
2. ☐ Přečti příběh 3 (jestli ještě není odemčený), tím se odemkne Hra 2
3. ☐ Otevři Hru 2 z obrazovky 7 tajemství
4. ☐ Kolo 1: tlač „▶ Pošli další měsíc" — sleduj růst pravé amfory (100 → 113)
5. ☐ Kolo 1: tlač „⏩ Rychle dopředu" — odsimuluje zbylé měsíce za ~3 s
6. ☐ Kolo 2: zvol 182 → simulace 60 měsíců → výsledek 182 mincí
7. ☐ Kolo 2 (alternativa): zvol 160 → simulace → vysvětlení lineární pasti
8. ☐ Kolo 3: zvol B → paralelní animace → B vyhrává (A=180, B=182)
9. ☐ Pří perfekci 90/90 se objeví Arkádův modal s gratulací
10. ☐ Po hře v admin → state je zapsaný v `state.minigames.scores[2] = 90`
11. ☐ V mobilu zkontroluj responsivitu (paths se zalomí pod sebe pod 480 px)

---

## Známá rizika a edge-cases

- **Anti-grind funguje:** druhé hraní téhož dne nepřidá Moudrost (existující `canEarnWisdomToday` v `finishMinigame`).
- **Cleanup je idempotentní:** přechod na jinou obrazovku během animace zastaví `setInterval` přes `window._minigame_cleanup`.
- **Klik-spam ochrana v Kole 1:** mezi klepy je 350 ms zámek, takže rychlé spamování netluče animaci.
- **SVG `<defs>` IDs:** unikátní per-amfora (`L1`, `R1`, `SIM`, `A3`, `B3`), takže nedojde ke kolizi v DOMu.
- **Žádné `localStorage` ani `IndexedDB` zápisy** — vše jde přes existující `state.minigames` a `scheduleSave()` v `finishMinigame`.

---

## Další krok (až bude tato hra v provozu)

Pečeť C **„Moudrý investor"** — odložená. Implementace bude:

1. Přidat do pole `SEALS` (najdeš ho v `index.html` poblíž `var SEALS = [`):
   ```js
   { id: 'wise_investor', cat: 'C', icon: '💰', title: 'Moudrý investor', desc: 'Plné skóre 90/90 v Rostoucí hromadě', wisdom: 100 }
   ```
2. Přidat trigger do `checkAllSeals()` (nebo do `_onWisdomChanged` hooku):
   ```js
   if (state.minigames.scores[2] >= 90 && !state.seals.unlocked.includes('wise_investor')) {
     grantSeal('wise_investor');
   }
   ```

Doporučuji udělat to jako **samostatný KROK 14.18.1** v dalším release (v2.19.1) — drží to changelog čistý.
