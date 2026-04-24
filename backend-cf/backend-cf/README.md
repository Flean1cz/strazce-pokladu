# Babylonská pokladnice — Backend pro týdenní e-mail report

Tento backend přijímá report data z PWA aplikace a každou neděli v 18:05
automaticky odesílá e-mail rodičům.

Jsou zde dvě varianty. Doporučuji začít s **Variantou A (Cloudflare Workers)**
— je zdarma, bez serveru, bez údržby.

---

## VARIANTA A: Cloudflare Workers + D1 + Resend (doporučeno)

### Předpoklady
- Účet na [cloudflare.com](https://cloudflare.com) (zdarma)
- Účet na [resend.com](https://resend.com) (zdarma, 3 000 e-mailů/měsíc)
- Node.js 18+

### 1. Instalace Wrangler CLI
```bash
npm install -g wrangler
wrangler login
```

### 2. Klonování a instalace
```bash
cd backend-cf
npm install
```

### 3. Vytvoření D1 databáze
```bash
wrangler d1 create babylon-pokladnice
```
Zkopírujte výstupní `database_id` do `wrangler.toml` na řádek:
```toml
database_id = "DOPLNTE_PO_VYTVORENI"
```

### 4. Inicializace schématu
```bash
npm run db:init:remote
```

### 5. Nastavení tajných proměnných
```bash
# API klíč z resend.com → API Keys → Create API Key
wrangler secret put RESEND_API_KEY

# Odesílací adresa (musí být ověřená v Resend: Domains → Add Domain)
wrangler secret put FROM_EMAIL
```

### 6. Deploy
```bash
npm run deploy
```
Worker bude dostupný na adrese: `https://babylon-report.VAS-JMENO.workers.dev`

### 7. Nastavení v aplikaci
V souboru `index.html` najděte řádek:
```js
var BACKEND_URL = null;
```
Změňte na:
```js
var BACKEND_URL = 'https://babylon-report.VAS-JMENO.workers.dev';
```

### Ověření
```bash
curl https://babylon-report.VAS-JMENO.workers.dev/health
# → {"ok":true,"version":"1.0.0","active_subscribers":0}
```

### Logy
```bash
npm run logs
```

---

## VARIANTA B: Node.js (Railway / Render / vlastní VPS)

### Předpoklady
- Účet na [railway.app](https://railway.app) nebo [render.com](https://render.com) (zdarma)
- Gmail účet (nebo jiný SMTP)

### 1. Instalace
```bash
cd backend-node
npm install
```

### 2. Konfigurace prostředí
```bash
cp .env.example .env
# Vyplňte hodnoty v .env
```

**Nastavení Gmail App Password:**
1. Google účet → Zabezpečení → Dvoufázové ověření (zapněte)
2. Google účet → Zabezpečení → Hesla aplikací → Vytvořit
3. Zkopírujte vygenerované heslo do `GMAIL_APP_PASSWORD`

### 3. Lokální spuštění
```bash
mkdir -p data
node server.js
# Server běží na http://localhost:3000
```

### 4. Deploy na Railway

1. Pushněte `backend-node/` do GitHub repozitáře
2. Na [railway.app](https://railway.app): New Project → Deploy from GitHub
3. V nastavení přidejte proměnné prostředí (z `.env.example`)
4. Railway automaticky nastaví `PORT`

Po deployi získáte URL typu: `https://babylon-report-xxxx.railway.app`

### 5. Nastavení v aplikaci
Stejně jako u varianty A — nastavte `BACKEND_URL` v `index.html`.

---

## API Reference

### POST /subscribe
Uloží nebo aktualizuje odběratele.

```json
{
  "email": "rodic@example.com",
  "child_name": "Samuel",
  "report_text": "Týdenní report z Babylonské pokladnice\n...",
  "app_version": "2.13.0"
}
```
Odpověď: `{ "ok": true, "message": "Odběr uložen." }`

### DELETE /unsubscribe
Odhlásí e-mail z automatického zasílání.

```json
{ "email": "rodic@example.com" }
```

### GET /health
Kontrola stavu serveru.

---

## Cron plán

| Varianta | Cron výraz | Čas |
|---|---|---|
| CF Workers | `5 16 * * 0` | Neděle 18:05 SELČ (letní čas) |
| CF Workers | `5 17 * * 0` | Neděle 18:05 SEČ (zimní čas) |
| Node.js | automaticky | Neděle 18:05 (timezone: Europe/Prague) |

> **Pozor (CF Workers):** Cloudflare Workers nezná timezone — cron je vždy v UTC.
> V létě (SELČ = UTC+2) nastavte `5 16 * * 0`, v zimě (SEČ = UTC+1) `5 17 * * 0`.
> Node.js varianta timezone řeší automaticky.

---

## Soukromí a bezpečnost

- Backend ukládá pouze: e-mail rodiče, jméno dítěte, text reportu, datum
- **Žádná jiná data z aplikace se na server neposílají**
- Text reportu je generován přímo v aplikaci z localStorage
- Uložené reporty jsou přepisovány při každém uložení (jen poslední stav)
- Uložení selhání nevyvolá žádnou chybu pro uživatele (silent fail)

---

## Testování cron jobu

### Cloudflare Workers
```bash
# Ruční spuštění v Cloudflare Dashboard:
# Workers → babylon-report → Triggers → Cron Triggers → Run
```

### Node.js (lokální test)
```js
// Přidejte dočasně na konec server.js:
sendWeeklyEmails().then(() => console.log('Test hotov'));
```
