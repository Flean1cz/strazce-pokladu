// Testy Workeru v2 proti lokální simulaci Cloudflare (Miniflare + D1). Spuštění: npm test
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Miniflare } from 'miniflare';

const WORKER = fileURLToPath(new URL('../src/index.js', import.meta.url));
const SCHEMA = readFileSync(new URL('../schema.sql', import.meta.url), 'utf8');
const BASE = 'https://worker.test';
const APP = 'https://app.test';
const FORM = { 'Content-Type': 'application/x-www-form-urlencoded' };

let mf, db;
let sentMails = [];
let failNextSend = false;

before(async () => {
  mf = new Miniflare({
    modules: true,
    scriptPath: WORKER,
    compatibilityDate: '2024-09-23',
    d1Databases: ['DB'],
    bindings: {
      RESEND_API_KEY: 'test-key-not-real-12345',
      FROM_EMAIL: 'Babylonská pokladnice <report@mail.example.test>',
      PUBLIC_URL: BASE,
      ALLOWED_ORIGINS: APP,
    },
    outboundService: async (req) => {
      if (!req.url.startsWith('https://api.resend.com/emails')) {
        return new Response('not allowed', { status: 404 });
      }
      const body = await req.json();
      if (failNextSend) { failNextSend = false; return new Response('upstream', { status: 500 }); }
      sentMails.push({ body, headers: Object.fromEntries(req.headers) });
      return Response.json({ id: `msg_${sentMails.length}` });
    },
  });
  db = await mf.getD1Database('DB');
  // D1 v testech nepřijme blok, který začíná komentářem, proto schéma rozdělíme na příkazy.
  for (const stmt of SCHEMA.replace(/--[^\n]*/g, '').split(';').map(x => x.trim()).filter(Boolean)) {
    await db.prepare(stmt).run();
  }
});

after(async () => { await mf.dispose(); });

beforeEach(async () => {
  sentMails = [];
  failNextSend = false;
  await db.exec('DELETE FROM subscriptions; DELETE FROM rate_limits;');
});

/* ── pomocné funkce ── */
const call = (path, init = {}) => mf.dispatchFetch(BASE + path, init);
const postJson = (path, body, headers = {}) => call(path, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...headers },
  body: JSON.stringify(body),
});
const confirm = (token) => call('/v1/confirm', { method: 'POST', headers: FORM, body: `token=${token}` });

async function subscribeAndGetTokens(email, childName = 'Tomáš') {
  const data = await (await postJson('/v1/subscribe', { email, child_name: childName })).json();
  const mail = sentMails.at(-1);
  const token = /token=([A-Za-z0-9_-]+)/.exec(mail.body.text)[1];
  return { secret: data.secret, token };
}

async function activeSecret(email = 'rodic@example.cz') {
  const { secret, token } = await subscribeAndGetTokens(email);
  const r = await confirm(token);
  assert.equal(r.status, 200);
  return secret;
}

const report = (secret, extra = {}) => postJson('/v1/report', {
  report_text: 'Týdenní report\n\n  Vklady: 2',
  week: '2026-W42',
  ...extra,
}, { Authorization: `Bearer ${secret}` });

const row = (email) => db.prepare('SELECT * FROM subscriptions WHERE email = ?1').bind(email).first();

/* ── testy ── */

test('zdraví a neznámá cesta', async () => {
  const h = await call('/health');
  assert.equal(h.status, 200);
  assert.equal((await h.json()).ok, true);
  assert.equal((await call('/v1/neexistuje')).status, 404);
});

test('subscribe: pending, tajný klíč jen v odpovědi, v DB jen hashe, potvrzovací mail s odkazem', async () => {
  const res = await postJson('/v1/subscribe', { email: 'Rodic@Example.cz', child_name: 'Tomáš' });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.status, 'pending');
  assert.match(data.secret, /^[A-Za-z0-9_-]{43}$/);

  assert.equal(sentMails.length, 1);
  assert.deepEqual(sentMails[0].body.to, ['rodic@example.cz']);
  assert.match(sentMails[0].body.text, /https:\/\/worker\.test\/v1\/confirm\?token=/);

  const r = await row('rodic@example.cz');
  assert.equal(r.status, 'pending');
  assert.equal(r.child_name, 'Tomáš');
  assert.notEqual(r.secret_hash, data.secret);
  assert.ok(!JSON.stringify(r).includes(data.secret), 'tajný klíč nesmí být v databázi');
});

test('report před potvrzením se neodešle (403)', async () => {
  const data = await (await postJson('/v1/subscribe', { email: 'rodic@example.cz' })).json();
  const res = await report(data.secret);
  assert.equal(res.status, 403);
  assert.equal(sentMails.length, 1, 'jen potvrzovací mail, žádný report');
});

test('potvrzení: GET ukáže tlačítko, POST aktivuje, odkaz jde použít jen jednou', async () => {
  const { token } = await subscribeAndGetTokens('rodic@example.cz');

  const page = await call(`/v1/confirm?token=${token}`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /action="\/v1\/confirm"/);

  assert.equal((await confirm('nesmysl')).status, 400);
  assert.equal((await confirm(token)).status, 200);
  assert.equal((await row('rodic@example.cz')).status, 'active');
  assert.equal((await confirm(token)).status, 400, 'druhé použití odkazu selže');
});

test('potvrzení: vypršelý odkaz neplatí', async () => {
  const { token } = await subscribeAndGetTokens('rodic@example.cz');
  await db.prepare("UPDATE subscriptions SET confirm_expires_at = '2000-01-01T00:00:00.000Z'").run();
  assert.equal((await confirm(token)).status, 400);
  assert.equal((await row('rodic@example.cz')).status, 'pending');
});

test('report: po potvrzení se odešle hned, s odhlašovacími hlavičkami a přílohou', async () => {
  const secret = await activeSecret();
  const before = sentMails.length;
  const att = { filename: 'babylon-zaloha-test.json', content_base64: Buffer.from('{"a":1}').toString('base64') };
  const res = await report(secret, { attachment: att });
  assert.equal(res.status, 200);
  assert.equal(sentMails.length, before + 1);

  const m = sentMails.at(-1);
  assert.deepEqual(m.body.to, ['rodic@example.cz']);
  assert.match(m.body.subject, /^Týdenní report – Tomáš – /);
  assert.match(m.body.html, /unsubscribe\?token=/);
  assert.match(m.body.headers['List-Unsubscribe'], /^<https:\/\/worker\.test\/v1\/unsubscribe\?token=[A-Za-z0-9_-]+>$/);
  assert.equal(m.body.headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
  assert.equal(m.body.attachments[0].filename, 'babylon-zaloha-test.json');
  assert.equal(m.body.attachments[0].content, att.content_base64);
  assert.match(m.headers['idempotency-key'], /^report-[0-9a-f]{32}-2026-W42$/);
  assert.equal((await row('rodic@example.cz')).last_sent_week, '2026-W42');
});

test('report: stejný týden podruhé nic neodešle', async () => {
  const secret = await activeSecret();
  await report(secret);
  const again = await report(secret);
  assert.equal(again.status, 200);
  assert.equal((await again.json()).already_sent, true);
  assert.equal(sentMails.length, 2, 'potvrzení + jeden report');
});

test('report: špatný nebo chybějící klíč (401)', async () => {
  await activeSecret();
  assert.equal((await report('x'.repeat(43))).status, 401);
  const noAuth = await postJson('/v1/report', { report_text: 'a', week: '2026-W42' });
  assert.equal(noAuth.status, 401);
});

test('report: limit 3 odeslání denně na odběr', async () => {
  const secret = await activeSecret();
  const weeks = ['2026-W40', '2026-W41', '2026-W42'];
  for (const week of weeks) assert.equal((await report(secret, { week })).status, 200);
  assert.equal((await report(secret, { week: '2026-W43' })).status, 429);
});

test('report: výpadek Resendu vrátí 502 a týden se nezapamatuje, takže jde zkusit znovu', async () => {
  const secret = await activeSecret();
  failNextSend = true;
  assert.equal((await report(secret)).status, 502);
  assert.equal((await row('rodic@example.cz')).last_sent_week, null);
  assert.equal((await report(secret)).status, 200);
});

test('report: validace (prázdný text, špatný týden, cizí typ přílohy)', async () => {
  const secret = await activeSecret();
  assert.equal((await report(secret, { report_text: '   ' })).status, 400);
  assert.equal((await report(secret, { week: '12. 10. 2026' })).status, 400);
  assert.equal((await report(secret, { attachment: { filename: 'x.exe', content_base64: 'AAAA' } })).status, 400);
  assert.equal((await report(secret, { attachment: { filename: 'ok.json', content_base64: 'neni base64!' } })).status, 400);
});

test('subscribe: validace e-mailu a jména', async () => {
  assert.equal((await postJson('/v1/subscribe', { email: 'ne-email' })).status, 400);
  assert.equal((await postJson('/v1/subscribe', { email: 'a@b.cz', child_name: 'x'.repeat(61) })).status, 400);
  assert.equal((await postJson('/v1/subscribe', { email: 'a@b.cz', child_name: 42 })).status, 400);
  assert.equal((await postJson('/v1/subscribe', [1, 2])).status, 400);
});

test('subscribe: aktivní odběr se nepřepíše (409) a nic se neposílá', async () => {
  await activeSecret('rodic@example.cz');
  const before = sentMails.length;
  const res = await postJson('/v1/subscribe', { email: 'rodic@example.cz' });
  assert.equal(res.status, 409);
  assert.equal((await res.json()).code, 'already_subscribed');
  assert.equal(sentMails.length, before);
  assert.equal((await row('rodic@example.cz')).status, 'active');
});

test('subscribe: limit 3 potvrzovacích e-mailů denně na adresu', async () => {
  for (let i = 0; i < 3; i++) assert.equal((await postJson('/v1/subscribe', { email: 'rodic@example.cz' })).status, 200);
  assert.equal((await postJson('/v1/subscribe', { email: 'rodic@example.cz' })).status, 429);
});

test('odhlášení odkazem (GET stránka, POST jako List-Unsubscribe) zastaví reporty', async () => {
  const secret = await activeSecret();
  const token = (await row('rodic@example.cz')).unsub_token;

  const page = await call(`/v1/unsubscribe?token=${token}`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Odhlásit odběr/);

  const res = await call(`/v1/unsubscribe?token=${token}`, { method: 'POST', headers: FORM, body: 'List-Unsubscribe=One-Click' });
  assert.equal(res.status, 200);
  assert.equal((await row('rodic@example.cz')).status, 'unsubscribed');
  assert.equal((await report(secret)).status, 403);
});

test('odhlášení z aplikace (DELETE s klíčem) zastaví reporty', async () => {
  const secret = await activeSecret();
  const res = await call('/v1/subscription', { method: 'DELETE', headers: { Authorization: `Bearer ${secret}` } });
  assert.equal(res.status, 200);
  assert.equal((await report(secret)).status, 403);
  const again = await call('/v1/subscription', { method: 'DELETE', headers: { Authorization: `Bearer ${secret}` } });
  assert.equal(again.status, 200, 'opakované odhlášení nevadí');
});

test('odhlášený e-mail se může znovu přihlásit (nový potvrzovací proces)', async () => {
  const secret = await activeSecret();
  await call('/v1/subscription', { method: 'DELETE', headers: { Authorization: `Bearer ${secret}` } });
  const res = await postJson('/v1/subscribe', { email: 'rodic@example.cz' });
  assert.equal(res.status, 200);
  assert.equal((await row('rodic@example.cz')).status, 'pending');
});

test('CORS: povolený původ dostane hlavičku, cizí ne', async () => {
  const ok = await call('/v1/report', { method: 'OPTIONS', headers: { Origin: APP } });
  assert.equal(ok.status, 204);
  assert.equal(ok.headers.get('Access-Control-Allow-Origin'), APP);
  assert.match(ok.headers.get('Access-Control-Allow-Headers'), /Authorization/);

  const bad = await call('/v1/report', { method: 'OPTIONS', headers: { Origin: 'https://evil.test' } });
  assert.equal(bad.headers.get('Access-Control-Allow-Origin'), null);
});
