# Babylonská pokladnice — Worker pro týdenní report (verze 2)

Cloudflare Worker s databází D1, který přijímá přihlášení rodičů a posílá týdenní
report e-mailem přes Resend. Aplikace odesílání spouští sama, Worker nic neplánuje.

## Tok

1. **Přihlášení** — aplikace pošle `POST /v1/subscribe` s e-mailem rodiče a jménem dítěte.
   Worker pošle potvrzovací e-mail a vrátí `secret` (tajný klíč odběru). Vrací se jen jednou.
2. **Potvrzení** — rodič klikne na odkaz v e-mailu (platný 48 hodin) a potvrdí tlačítkem.
   Odběr se aktivuje. Bez potvrzení se nic neodešle.
3. **Odeslání** — aplikace v neděli pošle `POST /v1/report` s hlavičkou
   `Authorization: Bearer <secret>`. Worker e-mail odešle hned. Obsah reportu neukládá,
   jen si zapamatuje týden (`last_sent_week`), takže opakované volání stejného týdne nic neodešle.
4. **Odhlášení** — odkaz v patičce e-mailu (také `List-Unsubscribe` v hlavičce), nebo
   `DELETE /v1/subscription` s tajným klíčem z aplikace.

| Metoda | Cesta | Autorizace | Účel |
|---|---|---|---|
| GET | `/health` | — | kontrola, že Worker běží |
| POST | `/v1/subscribe` | — (limity) | přihlášení, pošle potvrzovací e-mail |
| GET / POST | `/v1/confirm?token=` | token z e-mailu | potvrzení odběru |
| POST | `/v1/report` | Bearer klíč | odeslání reportu (nebo přílohy se zálohou) |
| DELETE | `/v1/subscription` | Bearer klíč | odhlášení z aplikace |
| GET / POST | `/v1/unsubscribe?token=` | token z e-mailu | odhlášení z e-mailu |

## Bezpečnost

- Tajný klíč, potvrzovací odkaz i čísla pro limity se ukládají jen jako SHA-256 hash.
- Limity: `subscribe` 10× za hodinu z jedné IP, potvrzovací e-mail 3× denně na adresu,
  odeslání reportu 3× denně na odběr.
- CORS povolí jen adresy z `ALLOWED_ORIGINS`.
- Report se do databáze neukládá. Jediný údaj o odběru je e-mail, jméno dítěte a stav.

**Známé omezení:** kdo zná tajný klíč (je jen v zařízení rodiče), může spustit odeslání
až 3× denně a zvolit text. Příjemcem je vždy rodič, který odběr potvrdil. Odhlášení je jedním kliknutím.

## Nasazení (Windows, PowerShell)

Předpoklady: Node.js 22 nebo novější, účet Cloudflare, ověřená doména v Resend, API klíč
Resend se oprávněním Sending access omezeným na tu doménu.

```powershell
cd backend-cf
npm install
npx.cmd wrangler login
npx.cmd wrangler d1 create babylon-pokladnice
```

Výstup `d1 create` obsahuje `database_id`. Zkopírujte ho do `wrangler.toml` místo
`DOPLNTE_PO_VYTVORENI`. Pak:

```powershell
npm run db:init:remote
npx.cmd wrangler secret put RESEND_API_KEY
npm run deploy
```

Po deployi doplňte do `wrangler.toml`:
- `PUBLIC_URL` — adresu Workeru, například `https://babylon-report.VAS-JMENO.workers.dev`
  (bez lomítka na konci). Odkazy v e-mailech se z ní skládají.
- `ALLOWED_ORIGINS` — adresu, na které běží aplikace. Pokud se změní, zopakujte `npm run deploy`.
- `FROM_EMAIL` — odesílatel na ověřené doméně. Výchozí `report@mail.scmsignpost.com`.

Kontrola: `https://<vaše-adresa>/health` vrátí `{"ok":true,...}`.

## Testy

```powershell
npm test
```

Testy běží v simulaci Cloudflare (Miniflare) s reálnou SQLite databází D1. Resend je
nahrazen falešným serverem, takže se žádný e-mail neodešle. Pokrývají celý tok,
limity, idempotenci, výpadek Resendu, validaci a CORS.

## Co dál

- Aplikace (balíček 3) musí umět: poslat `subscribe`, uložit tajný klíč do zařízení,
  ukázat stav „čeká na potvrzení" a v neděli poslat `report` s přílohou zálohy profilu.
- Pokud zařízení v neděli nebude zapnuté, report se odešle při příštím otevření aplikace.
