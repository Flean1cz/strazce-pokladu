/**
 * BABYLONSKÁ POKLADNICE — týdenní report rodičům (Worker v2)
 *
 * Tok:
 *  1. Aplikace   POST /v1/subscribe {email, child_name}
 *                → odběr je „pending", pošle se potvrzovací e-mail, vrátí se tajný klíč (jen jednou).
 *  2. Rodič      GET /v1/confirm?token=…  → stránka s tlačítkem → POST /v1/confirm → odběr „active".
 *  3. Aplikace   POST /v1/report  (Authorization: Bearer <tajný klíč>)
 *                → e-mail se odešle hned. Obsah reportu se neukládá, jen se zapamatuje týden.
 *  4. Odhlášení  GET+POST /v1/unsubscribe?token=…  (odkaz v patičce a List-Unsubscribe)
 *                DELETE /v1/subscription  (Bearer tajný klíč, z aplikace)
 *
 * Bezpečnost: tajný klíč i potvrzovací odkaz se ukládají jen jako SHA-256 hash.
 * Limity: odeslání max. 3× denně na odběr, potvrzení max. 3× denně na e-mail, subscribe 10× za hodinu z jedné IP.
 */

const WEEK_RE = /^\d{4}-W\d{2}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_BODY_CHARS = 1_500_000;        // celé tělo požadavku (včetně přílohy se zálohou)
const MAX_REPORT_CHARS = 50_000;
const MAX_ATTACHMENT_CHARS = 1_000_000;  // base64
const CONFIRM_TTL_MS = 48 * 60 * 60 * 1000;

const LIMITS = {
  subscribeIp:    { name: 'subscribe-ip',    max: 10, windowSec: 3600 },
  subscribeEmail: { name: 'subscribe-email', max: 3,  windowSec: 86400 },
  report:         { name: 'report',          max: 3,  windowSec: 86400 },
  tokenPost:      { name: 'token-post',      max: 60, windowSec: 3600 },
};

export default {
  async fetch(request, env) {
    try {
      return await route(request, env);
    } catch (e) {
      console.error('[worker] neočekávaná chyba:', e && e.message);
      return json({ error: 'Interní chyba' }, 500);
    }
  },
};

async function route(request, env) {
  const url = new URL(request.url);
  const cors = corsHeaders(request, env);
  const { method } = request;
  const path = url.pathname;

  if (method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (path === '/health' && method === 'GET') return json({ ok: true, version: '2.0.0' }, 200, cors);
  if (path === '/v1/subscribe' && method === 'POST') return subscribe(request, env, cors);
  if (path === '/v1/report' && method === 'POST') return sendReport(request, env, cors);
  if (path === '/v1/subscription' && method === 'DELETE') return unsubscribeByKey(request, env, cors);
  if (path === '/v1/confirm' && method === 'GET') return confirmPage(url);
  if (path === '/v1/confirm' && method === 'POST') return confirmAction(request, env);
  if (path === '/v1/unsubscribe' && method === 'GET') return unsubscribePage(url);
  if (path === '/v1/unsubscribe' && method === 'POST') return unsubscribeByLink(request, url, env);
  return json({ error: 'Nenalezeno' }, 404, cors);
}

/* ── 1. PŘIHLÁŠENÍ ─────────────────────────────────────────── */

async function subscribe(request, env, cors) {
  const body = await readJson(request);
  if (!body) return json({ error: 'Neplatný požadavek' }, 400, cors);

  const email = normEmail(body.email);
  if (!email) return json({ error: 'Chybí nebo neplatný e-mail' }, 400, cors);
  const childName = cleanName(body.child_name);
  if (childName === null) return json({ error: 'Neplatné jméno dítěte' }, 400, cors);

  if (!(await allow(env, LIMITS.subscribeIp, clientIp(request)))) return tooMany(cors);
  if (!(await allow(env, LIMITS.subscribeEmail, email))) return tooMany(cors);

  const secret = randomToken();
  const confirmToken = randomToken();
  const unsubToken = randomToken();
  const now = new Date();

  // Aktivní odběr se nepřepisuje (jinak by kdokoli s cizí adresou přebral odběr).
  const res = await env.DB.prepare(`
    INSERT INTO subscriptions
      (email, child_name, status, secret_hash, confirm_hash, confirm_expires_at, unsub_token, created_at, updated_at)
    VALUES (?1, ?2, 'pending', ?3, ?4, ?5, ?6, ?7, ?7)
    ON CONFLICT(email) DO UPDATE SET
      child_name         = excluded.child_name,
      status             = 'pending',
      secret_hash        = excluded.secret_hash,
      confirm_hash       = excluded.confirm_hash,
      confirm_expires_at = excluded.confirm_expires_at,
      unsub_token        = excluded.unsub_token,
      updated_at         = excluded.updated_at
    WHERE subscriptions.status != 'active'
  `).bind(
    email,
    childName,
    await sha256(secret),
    await sha256(confirmToken),
    iso(new Date(now.getTime() + CONFIRM_TTL_MS)),
    unsubToken,
    iso(now)
  ).run();

  if (res.meta.changes === 0) {
    return json({
      error: 'Odběr je už potvrzený. Pro změnu zařízení se nejdřív odhlaste z odkazu v e-mailu.',
      code: 'already_subscribed',
    }, 409, cors);
  }

  try {
    await sendMail(env, {
      to: email,
      subject: 'Potvrďte odběr týdenního reportu – Babylonská pokladnice',
      text: confirmText(childName, confirmUrl(env, confirmToken)),
      html: confirmHtml(childName, confirmUrl(env, confirmToken)),
    });
  } catch (e) {
    return json({ error: 'Potvrzovací e-mail se nepodařilo odeslat, zkuste to později.' }, 502, cors);
  }

  return json({ ok: true, status: 'pending', secret }, 200, cors);
}

async function confirmPage(url) {
  const token = url.searchParams.get('token');
  if (!token) return page('Odkaz není platný', '<p>Chybí potvrzovací kód. Otevřete odkaz z e-mailu znovu.</p>', 400);
  return page('Potvrzení odběru', `
    <p>Potvrďte prosím, že chcete dostávat týdenní report z aplikace Babylonská pokladnice.</p>
    <form method="post" action="/v1/confirm">
      <input type="hidden" name="token" value="${esc(token)}">
      <button type="submit">Potvrdit odběr</button>
    </form>`);
}

async function confirmAction(request, env) {
  if (!(await allow(env, LIMITS.tokenPost, clientIp(request)))) {
    return page('Příliš mnoho pokusů', '<p>Zkuste to prosím později.</p>', 429);
  }
  const form = await request.formData().catch(() => null);
  const token = form && form.get('token');
  if (typeof token !== 'string' || !token) {
    return page('Odkaz není platný', '<p>Chybí potvrzovací kód.</p>', 400);
  }

  const now = iso(new Date());
  const sub = await env.DB.prepare(`
    SELECT email FROM subscriptions
    WHERE confirm_hash = ?1 AND confirm_expires_at > ?2 AND status = 'pending'
  `).bind(await sha256(token), now).first();

  if (!sub) {
    return page('Odkaz vypršel', '<p>Odkaz je neplatný, vypršel, nebo už byl použit. Zadejte e-mail znovu v aplikaci.</p>', 400);
  }

  await env.DB.prepare(`
    UPDATE subscriptions
    SET status = 'active', confirmed_at = ?1, confirm_hash = NULL, confirm_expires_at = NULL, updated_at = ?1
    WHERE email = ?2
  `).bind(now, sub.email).run();

  return page('Odběr potvrzen', '<p>Děkujeme! Od příští neděle vám budou chodit týdenní reporty.</p>');
}

/* ── 2. ODESLÁNÍ REPORTU ───────────────────────────────────── */

async function sendReport(request, env, cors) {
  const secret = bearerToken(request);
  if (!secret) return json({ error: 'Chybí autorizace' }, 401, cors);

  const body = await readJson(request);
  if (!body) return json({ error: 'Neplatný požadavek' }, 400, cors);

  const reportText = body.report_text;
  if (typeof reportText !== 'string' || !reportText.trim() || reportText.length > MAX_REPORT_CHARS) {
    return json({ error: 'Neplatný text reportu' }, 400, cors);
  }
  if (typeof body.week !== 'string' || !WEEK_RE.test(body.week)) {
    return json({ error: 'Chybí nebo neplatný týden (formát YYYY-Www)' }, 400, cors);
  }
  const attachment = parseAttachment(body.attachment);
  if (attachment === false) return json({ error: 'Neplatná příloha' }, 400, cors);

  const secretHash = await sha256(secret);
  const sub = await env.DB.prepare(`
    SELECT email, child_name, status, last_sent_week, unsub_token
    FROM subscriptions WHERE secret_hash = ?1
  `).bind(secretHash).first();

  if (!sub) return json({ error: 'Neplatný klíč odběru' }, 401, cors);
  if (sub.status !== 'active') return json({ error: 'Odběr není potvrzený' }, 403, cors);
  if (sub.last_sent_week === body.week) return json({ ok: true, already_sent: true }, 200, cors);
  if (!(await allow(env, LIMITS.report, secretHash))) return tooMany(cors);

  const now = new Date();
  const unsub = unsubUrl(env, sub.unsub_token);
  try {
    await sendMail(env, {
      to: sub.email,
      subject: reportSubject(sub.child_name, now),
      text: reportText,
      html: buildEmailHtml(sub.child_name, reportText, dateCs(now), unsub),
      headers: {
        'List-Unsubscribe': `<${unsub}>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      },
      attachments: attachment ? [attachment] : undefined,
      idempotencyKey: `report-${secretHash.slice(0, 32)}-${body.week}`,
    });
  } catch (e) {
    return json({ error: 'E-mail se nepodařilo odeslat, zkuste to později.' }, 502, cors);
  }

  await env.DB.prepare(`
    UPDATE subscriptions SET last_sent_week = ?1, last_sent_at = ?2, updated_at = ?2
    WHERE secret_hash = ?3
  `).bind(body.week, iso(now), secretHash).run();

  return json({ ok: true }, 200, cors);
}

/* ── 3. ODHLÁŠENÍ ──────────────────────────────────────────── */

async function unsubscribeByKey(request, env, cors) {
  const secret = bearerToken(request);
  if (!secret) return json({ error: 'Chybí autorizace' }, 401, cors);
  const res = await env.DB.prepare(`
    UPDATE subscriptions SET status = 'unsubscribed', updated_at = ?1 WHERE secret_hash = ?2
  `).bind(iso(new Date()), await sha256(secret)).run();
  if (res.meta.changes === 0) return json({ error: 'Neplatný klíč odběru' }, 401, cors);
  return json({ ok: true, status: 'unsubscribed' }, 200, cors);
}

async function unsubscribePage(url) {
  const token = url.searchParams.get('token');
  if (!token) return page('Odkaz není platný', '<p>Chybí odhlašovací kód.</p>', 400);
  return page('Odhlášení z reportu', `
    <p>Opravdu chcete přestat dostávat týdenní report?</p>
    <form method="post" action="/v1/unsubscribe?token=${esc(encodeURIComponent(token))}">
      <button type="submit">Odhlásit odběr</button>
    </form>`);
}

async function unsubscribeByLink(request, url, env) {
  if (!(await allow(env, LIMITS.tokenPost, clientIp(request)))) {
    return page('Příliš mnoho pokusů', '<p>Zkuste to prosím později.</p>', 429);
  }
  const token = url.searchParams.get('token');
  if (!token) return page('Odkaz není platný', '<p>Chybí odhlašovací kód.</p>', 400);

  const res = await env.DB.prepare(`
    UPDATE subscriptions SET status = 'unsubscribed', updated_at = ?1 WHERE unsub_token = ?2
  `).bind(iso(new Date()), token).run();

  if (res.meta.changes === 0) return page('Odkaz není platný', '<p>Tenhle odběr už neexistuje.</p>', 404);
  return page('Odhlášeno', '<p>Od teď vám nebudou chodit žádné reporty. Děkujeme.</p>');
}

/* ── E-MAILY ───────────────────────────────────────────────── */

async function sendMail(env, { to, subject, text, html, headers, attachments, idempotencyKey }) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
    },
    body: JSON.stringify({ from: env.FROM_EMAIL, to: [to], subject, text, html, headers, attachments }),
  });
  // Tělo odpovědi neloguji: může obsahovat e-mail příjemce.
  if (!res.ok) throw new Error(`Resend ${res.status}`);
}

function reportSubject(childName, date) {
  return `Týdenní report – ${childName || 'vaše dítě'} – ${dateCs(date)}`;
}

function confirmUrl(env, token) {
  return `${env.PUBLIC_URL}/v1/confirm?token=${token}`;
}

function unsubUrl(env, token) {
  return `${env.PUBLIC_URL}/v1/unsubscribe?token=${token}`;
}

function confirmText(childName, url) {
  const kdo = childName ? ` dítěte ${childName}` : '';
  return `Dobrý den,

někdo zadal tuto e-mailovou adresu v aplikaci Babylonská pokladnice pro týdenní report${kdo}.

Pro potvrzení odběru otevřete odkaz (platný 48 hodin):
${url}

Pokud jste o odběr nežádali, tento e-mail ignorujte.`;
}

function confirmHtml(childName, url) {
  const kdo = childName ? ` dítěte ${esc(childName)}` : '';
  return `<!DOCTYPE html><html lang="cs"><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:24px;background:#FDF6E3;font-family:Georgia,serif;color:#3a2a0f">
<div style="max-width:520px;margin:0 auto;background:#FFFDF7;border:1px solid rgba(200,134,10,.2);border-radius:16px;padding:24px">
<h2 style="font-size:18px;color:#C8860A;margin:0 0 12px">Potvrďte odběr týdenního reportu</h2>
<p style="font-size:14px;line-height:1.6">Někdo zadal tuto e-mailovou adresu v aplikaci Babylonská pokladnice pro týdenní report${kdo}.</p>
<p style="margin:20px 0"><a href="${esc(url)}" style="background:#C8860A;color:#fff;text-decoration:none;padding:12px 20px;border-radius:10px;display:inline-block">Potvrdit odběr</a></p>
<p style="font-size:12px;color:#8a6a3a;line-height:1.6">Odkaz je platný 48 hodin. Pokud jste o odběr nežádali, tento e-mail ignorujte.</p>
</div></body></html>`;
}

function buildEmailHtml(childName, reportText, dateStr, unsubscribeUrl) {
  const lines = reportText.split('\n');
  let html = '';
  for (const line of lines) {
    if (line.startsWith('─')) {
      html += '<hr style="border:none;border-top:1px solid #C8860A;opacity:.3;margin:12px 0"/>';
    } else if (line.startsWith('Týdenní report')) {
      html += `<h2 style="font-family:Georgia,serif;color:#C8860A;font-size:18px;margin:0 0 4px">${esc(line)}</h2>`;
    } else if (line.startsWith('  ')) {
      const indent = line.startsWith('    ') ? 28 : 14;
      html += `<div style="padding-left:${indent}px;color:#5a3e1b;font-size:13px;line-height:1.6">${esc(line.trim())}</div>`;
    } else if (line.startsWith('💡')) {
      html += `<div style="background:#FFF8E8;border-left:3px solid #C8860A;padding:8px 12px;margin:8px 0;font-style:italic;color:#5a3e1b;font-size:13px">${esc(line)}</div>`;
    } else if (line.trim() === '') {
      html += '<br>';
    } else {
      html += `<p style="margin:3px 0;color:#3a2a0f;font-size:14px;line-height:1.65">${esc(line)}</p>`;
    }
  }

  return `<!DOCTYPE html>
<html lang="cs">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#FDF6E3;font-family:Georgia,serif">
<table width="100%" cellpadding="0" cellspacing="0">
  <tr><td align="center" style="padding:24px 16px">
    <table width="560" style="max-width:100%;background:#FFFDF7;border-radius:16px;border:1px solid rgba(200,134,10,.2);overflow:hidden">
      <tr><td style="background:linear-gradient(135deg,#1a0e04,#2a1a08);padding:20px 24px;text-align:center">
        <div style="font-size:32px;margin-bottom:6px">🏺</div>
        <div style="font-family:Georgia,serif;font-size:20px;color:#FFD700;font-weight:bold;letter-spacing:1px">Babylonská pokladnice</div>
        <div style="font-size:12px;color:rgba(255,215,0,.6);margin-top:3px;letter-spacing:2px">TÝDENNÍ REPORT · ${esc(dateStr)}</div>
      </td></tr>
      <tr><td style="padding:20px 24px">${html}</td></tr>
      <tr><td style="background:#f5ecd5;padding:14px 24px;text-align:center;border-top:1px solid rgba(200,134,10,.15)">
        <p style="margin:0;font-size:11px;color:#8a6a3a;line-height:1.6">
          Tenhle e-mail dostáváte, protože jste si v aplikaci Babylonská pokladnice zapnuli týdenní report.<br>
          Odhlásit se můžete kdykoli: <a href="${esc(unsubscribeUrl)}" style="color:#8a6a3a">odhlásit odběr</a>.
        </p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
}

/* ── LIMITY A OVĚŘENÍ ──────────────────────────────────────── */

/** Počítadlo v D1 pro dané okno. Vrací true, pokud je požadavek v limitu. */
async function allow(env, limit, identifier) {
  const now = Date.now();
  const windowMs = limit.windowSec * 1000;
  const bucket = Math.floor(now / windowMs);
  const key = `${await sha256(`${limit.name}:${identifier}`)}:${bucket}`;

  await env.DB.prepare('DELETE FROM rate_limits WHERE expires_at < ?1').bind(now).run();
  const row = await env.DB.prepare(`
    INSERT INTO rate_limits (key, count, expires_at) VALUES (?1, 1, ?2)
    ON CONFLICT(key) DO UPDATE SET count = count + 1
    RETURNING count
  `).bind(key, (bucket + 1) * windowMs).first();

  return !!row && row.count <= limit.max;
}

/** Přílohu přijmeme jen jako JSON soubor v base64. Vrací null (bez přílohy), objekt, nebo false (neplatná). */
function parseAttachment(a) {
  if (a === undefined || a === null) return null;
  if (typeof a !== 'object' || typeof a.filename !== 'string' || typeof a.content_base64 !== 'string') return false;
  if (!/^[\w.\- ]{1,120}\.json$/i.test(a.filename)) return false;
  if (a.content_base64.length > MAX_ATTACHMENT_CHARS || !/^[A-Za-z0-9+/=]+$/.test(a.content_base64)) return false;
  return { filename: a.filename, content: a.content_base64 };
}

function normEmail(v) {
  if (typeof v !== 'string') return null;
  const e = v.trim().toLowerCase();
  return e.length <= 254 && EMAIL_RE.test(e) ? e : null;
}

/** Vrací '' pro chybějící jméno, text pro platné jméno, null pro neplatné. */
function cleanName(v) {
  if (v === undefined || v === null) return '';
  if (typeof v !== 'string') return null;
  const t = v.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return t.length > 60 ? null : t;
}

async function readJson(request) {
  let text;
  try { text = await request.text(); } catch { return null; }
  if (text.length > MAX_BODY_CHARS) return null;
  try {
    const v = JSON.parse(text);
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
  } catch { return null; }
}

function bearerToken(request) {
  const m = /^Bearer\s+([A-Za-z0-9_-]{20,})$/.exec(request.headers.get('Authorization') || '');
  return m ? m[1] : null;
}

function clientIp(request) {
  return request.headers.get('CF-Connecting-IP') || 'unknown';
}

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin');
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!origin || !allowed.includes(origin)) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  };
}

/* ── POMOCNÉ FUNKCE ────────────────────────────────────────── */

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...extra, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function tooMany(cors) {
  return json({ error: 'Příliš mnoho požadavků, zkuste to později.' }, 429, cors);
}

function page(title, bodyHtml, status = 200) {
  const html = `<!DOCTYPE html><html lang="cs"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)}</title>
<style>body{font-family:Georgia,serif;background:#FDF6E3;color:#3a2a0f;margin:0;padding:32px 16px;text-align:center}main{max-width:460px;margin:0 auto;background:#FFFDF7;border:1px solid rgba(200,134,10,.2);border-radius:16px;padding:24px}h1{font-size:20px;color:#C8860A}button{background:#C8860A;color:#fff;border:0;border-radius:10px;padding:12px 20px;font-size:16px;cursor:pointer}</style>
</head><body><main><h1>${esc(title)}</h1>${bodyHtml}</main></body></html>`;
  return new Response(html, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'",
      'Cache-Control': 'no-store',
    },
  });
}

/** Náhodný token: 32 bajtů, base64url (43 znaků). */
function randomToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function iso(d) {
  return d.toISOString();
}

function dateCs(d) {
  return d.toLocaleDateString('cs-CZ', { timeZone: 'Europe/Prague', day: 'numeric', month: 'long', year: 'numeric' });
}

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
