/**
 * BABYLONSKÁ POKLADNICE — Týdenní e-mail report
 * Cloudflare Workers + D1 + Resend
 *
 * Endpointy:
 *   POST /subscribe   – uložení/aktualizace odběru
 *   DELETE /unsubscribe – odhlášení
 *   GET  /health      – kontrola
 *
 * Cron: každou neděli 18:05 Prague time (UTC+2 = 16:05 UTC)
 *       ⇒ wrangler.toml: crons = ["5 16 * * 0"]
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default {

  /** HTTP handler */
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return json({ ok: true, version: '1.0.0' });
    }

    if (url.pathname === '/subscribe' && request.method === 'POST') {
      return handleSubscribe(request, env);
    }

    if (url.pathname === '/unsubscribe' && request.method === 'DELETE') {
      return handleUnsubscribe(request, env);
    }

    return json({ error: 'Not found' }, 404);
  },

  /** Cron trigger — každou neděli 18:05 Prague */
  async scheduled(event, env, ctx) {
    ctx.waitUntil(sendWeeklyEmails(env));
  }
};

/** ── SUBSCRIBE ───────────────────────────────────────────── */
async function handleSubscribe(request, env) {
  let body;
  try { body = await request.json(); }
  catch { return json({ error: 'Invalid JSON' }, 400); }

  const { email, child_name, report_text, app_version } = body;

  if (!email || !isValidEmail(email)) {
    return json({ error: 'Chybí nebo neplatný e-mail' }, 400);
  }
  if (!report_text || typeof report_text !== 'string') {
    return json({ error: 'Chybí text reportu' }, 400);
  }

  // Upsert do D1
  await env.DB.prepare(`
    INSERT INTO subscribers (email, child_name, report_text, app_version, updated_at)
    VALUES (?1, ?2, ?3, ?4, ?5)
    ON CONFLICT(email) DO UPDATE SET
      child_name   = excluded.child_name,
      report_text  = excluded.report_text,
      app_version  = excluded.app_version,
      updated_at   = excluded.updated_at,
      active       = 1
  `).bind(
    email.toLowerCase().trim(),
    child_name || '',
    report_text,
    app_version || '',
    new Date().toISOString()
  ).run();

  return json({ ok: true, message: 'Odběr uložen.' });
}

/** ── UNSUBSCRIBE ─────────────────────────────────────────── */
async function handleUnsubscribe(request, env) {
  let body;
  try { body = await request.json(); }
  catch { return json({ error: 'Invalid JSON' }, 400); }

  const { email } = body;
  if (!email) return json({ error: 'Chybí e-mail' }, 400);

  await env.DB.prepare(
    'UPDATE subscribers SET active = 0 WHERE email = ?1'
  ).bind(email.toLowerCase().trim()).run();

  return json({ ok: true, message: 'Odhlášeno.' });
}

/** ── CRON: odeslání e-mailů ─────────────────────────────── */
async function sendWeeklyEmails(env) {
  const { results } = await env.DB.prepare(
    "SELECT email, child_name, report_text FROM subscribers WHERE active = 1"
  ).all();

  if (!results || results.length === 0) {
    console.log('[CRON] Žádní aktivní odběratelé.');
    return;
  }

  console.log(`[CRON] Odesílám ${results.length} e-mailů...`);
  let sent = 0, errors = 0;

  for (const row of results) {
    try {
      await sendEmail(env, {
        to: row.email,
        child_name: row.child_name,
        report_text: row.report_text
      });
      sent++;
      // Aktualizujeme last_sent
      await env.DB.prepare(
        'UPDATE subscribers SET last_sent = ?1 WHERE email = ?2'
      ).bind(new Date().toISOString(), row.email).run();
    } catch (e) {
      console.error(`[CRON] Chyba při odesílání na ${row.email}:`, e.message);
      errors++;
    }
  }
  console.log(`[CRON] Hotovo. Odesláno: ${sent}, Chyby: ${errors}`);
}

/** ── RESEND: odeslání jednoho e-mailu ───────────────────── */
async function sendEmail(env, { to, child_name, report_text }) {
  const name   = child_name || 'vaše dítě';
  const now    = new Date();
  const dateCs = now.toLocaleDateString('cs-CZ', { day:'numeric', month:'long', year:'numeric' });
  const subject = `Týdenní report Babylonské pokladnice – ${name} – ${dateCs}`;

  // HTML verze e-mailu
  const html = buildEmailHtml(name, report_text, dateCs);

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: env.FROM_EMAIL || 'pokladnice@babylon.app',
      to: [to],
      subject,
      text: report_text,
      html
    })
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Resend API ${res.status}: ${err}`);
  }
}

/** ── HTML šablona e-mailu ───────────────────────────────── */
function buildEmailHtml(childName, reportText, dateStr) {
  // Konvertujeme plaintext do HTML (zachováme odstavce, tučné nadpisy)
  const lines = reportText.split('\n');
  let html = '';
  for (const line of lines) {
    if (line.startsWith('─') || line.startsWith('─')) {
      html += '<hr style="border:none;border-top:1px solid #C8860A;opacity:.3;margin:12px 0"/>';
    } else if (line.startsWith('Týdenní report')) {
      html += `<h2 style="font-family:Georgia,serif;color:#C8860A;font-size:18px;margin:0 0 4px">${escHtml(line)}</h2>`;
    } else if (line.startsWith('  ') || line.startsWith('    ')) {
      html += `<div style="padding-left:${line.startsWith('    ')?'28':'14'}px;color:#5a3e1b;font-size:13px;line-height:1.6">${escHtml(line.trim())}</div>`;
    } else if (line.startsWith('💡')) {
      html += `<div style="background:#FFF8E8;border-left:3px solid #C8860A;padding:8px 12px;margin:8px 0;font-style:italic;color:#5a3e1b;font-size:13px">${escHtml(line)}</div>`;
    } else if (line.trim() === '') {
      html += '<br>';
    } else {
      html += `<p style="margin:3px 0;color:#3a2a0f;font-size:14px;line-height:1.65">${escHtml(line)}</p>`;
    }
  }

  return `<!DOCTYPE html>
<html lang="cs">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#FDF6E3;font-family:Georgia,serif">
<table width="100%" cellpadding="0" cellspacing="0">
  <tr><td align="center" style="padding:24px 16px">
    <table width="560" style="max-width:100%;background:#FFFDF7;border-radius:16px;border:1px solid rgba(200,134,10,.2);overflow:hidden">
      <!-- Hlavička -->
      <tr><td style="background:linear-gradient(135deg,#1a0e04,#2a1a08);padding:20px 24px;text-align:center">
        <div style="font-size:32px;margin-bottom:6px">🏺</div>
        <div style="font-family:Georgia,serif;font-size:20px;color:#FFD700;font-weight:bold;letter-spacing:1px">Babylonská pokladnice</div>
        <div style="font-size:12px;color:rgba(255,215,0,.6);margin-top:3px;letter-spacing:2px">TÝDENNÍ REPORT · ${dateStr}</div>
      </td></tr>
      <!-- Tělo -->
      <tr><td style="padding:20px 24px">
        ${html}
      </td></tr>
      <!-- Patička -->
      <tr><td style="background:#f5ecd5;padding:14px 24px;text-align:center;border-top:1px solid rgba(200,134,10,.15)">
        <p style="margin:0;font-size:11px;color:#8a6a3a;line-height:1.6">
          Tenhle e-mail dostáváte protože jste nastavili týdenní report v aplikaci Babylonská pokladnice.<br>
          Pro odhlášení otevřete aplikaci → Admin → Nastavení → Týdenní report → Odhlásit.
        </p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
}

/** ── Helpers ─────────────────────────────────────────────── */
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
  });
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
