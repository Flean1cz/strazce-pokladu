/**
 * BABYLONSKÁ POKLADNICE — Týdenní e-mail report
 * Node.js + SQLite + node-cron + Nodemailer
 *
 * Deploy: Railway, Render, Fly.io nebo vlastní VPS
 * Port: process.env.PORT nebo 3000
 */

import express from 'express';
import cors from 'cors';
import cron from 'node-cron';
import nodemailer from 'nodemailer';
import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import 'dotenv/config';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Databáze ──────────────────────────────────────────────
const db = new Database(process.env.DB_PATH || join(__dirname, 'data', 'babylon.db'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS subscribers (
    email        TEXT PRIMARY KEY,
    child_name   TEXT    NOT NULL DEFAULT '',
    report_text  TEXT    NOT NULL DEFAULT '',
    app_version  TEXT    NOT NULL DEFAULT '',
    active       INTEGER NOT NULL DEFAULT 1,
    created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at   TEXT    NOT NULL DEFAULT (datetime('now')),
    last_sent    TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_active ON subscribers(active);
`);
console.log('[DB] SQLite připravena.');

// ── Nodemailer ────────────────────────────────────────────
function createTransport() {
  // Varianta 1: Gmail (doporučeno pro začátek)
  if (process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD) {
    return nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_APP_PASSWORD   // Google App Password, ne hlavní heslo!
      }
    });
  }
  // Varianta 2: libovolný SMTP
  return nodemailer.createTransport({
    host:   process.env.SMTP_HOST   || 'smtp.gmail.com',
    port:   parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });
}

// ── Express ───────────────────────────────────────────────
const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '128kb' }));

// Health check
app.get('/health', (req, res) => {
  const count = db.prepare('SELECT COUNT(*) as n FROM subscribers WHERE active = 1').get();
  res.json({ ok: true, version: '1.0.0', active_subscribers: count.n });
});

// POST /subscribe
app.post('/subscribe', (req, res) => {
  const { email, child_name, report_text, app_version } = req.body || {};

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Chybí nebo neplatný e-mail' });
  }
  if (!report_text || typeof report_text !== 'string') {
    return res.status(400).json({ error: 'Chybí text reportu' });
  }

  db.prepare(`
    INSERT INTO subscribers (email, child_name, report_text, app_version, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(email) DO UPDATE SET
      child_name  = excluded.child_name,
      report_text = excluded.report_text,
      app_version = excluded.app_version,
      updated_at  = excluded.updated_at,
      active      = 1
  `).run(
    email.toLowerCase().trim(),
    child_name || '',
    report_text,
    app_version || '',
    new Date().toISOString()
  );

  res.json({ ok: true, message: 'Odběr uložen.' });
});

// DELETE /unsubscribe
app.delete('/unsubscribe', (req, res) => {
  const { email } = req.body || {};
  if (!email) return res.status(400).json({ error: 'Chybí e-mail' });
  db.prepare('UPDATE subscribers SET active = 0 WHERE email = ?')
    .run(email.toLowerCase().trim());
  res.json({ ok: true, message: 'Odhlášeno.' });
});

// ── Odesílání e-mailů ─────────────────────────────────────
async function sendWeeklyEmails() {
  const subscribers = db.prepare(
    'SELECT email, child_name, report_text FROM subscribers WHERE active = 1'
  ).all();

  if (subscribers.length === 0) {
    console.log('[CRON] Žádní aktivní odběratelé.');
    return;
  }

  console.log(`[CRON] Odesílám ${subscribers.length} e-mailů...`);
  const transport = createTransport();
  let sent = 0, errors = 0;

  for (const row of subscribers) {
    const name    = row.child_name || 'vaše dítě';
    const now     = new Date();
    const dateCs  = now.toLocaleDateString('cs-CZ', { day:'numeric', month:'long', year:'numeric' });
    const subject = `Týdenní report Babylonské pokladnice – ${name} – ${dateCs}`;

    try {
      await transport.sendMail({
        from: `"Babylonská pokladnice" <${process.env.FROM_EMAIL || process.env.GMAIL_USER}>`,
        to:      row.email,
        subject,
        text:    row.report_text,
        html:    buildEmailHtml(name, row.report_text, dateCs)
      });

      db.prepare('UPDATE subscribers SET last_sent = ? WHERE email = ?')
        .run(new Date().toISOString(), row.email);
      sent++;
      console.log(`  ✓ ${row.email}`);
    } catch (e) {
      console.error(`  ✗ ${row.email}:`, e.message);
      errors++;
    }
  }
  console.log(`[CRON] Hotovo. Odesláno: ${sent}, Chyby: ${errors}`);
}

// ── Cron: každou neděli v 18:05 ──────────────────────────
// Timezone: Europe/Prague (automaticky řeší letní/zimní čas)
cron.schedule('5 18 * * 0', () => {
  console.log('[CRON] Spouštím týdenní reporty...');
  sendWeeklyEmails().catch(e => console.error('[CRON] Chyba:', e));
}, { timezone: 'Europe/Prague' });

// ── HTML šablona (sdílená s CF variantou) ────────────────
function buildEmailHtml(childName, reportText, dateStr) {
  const lines = reportText.split('\n');
  let body = '';
  for (const line of lines) {
    if (line.startsWith('─')) {
      body += '<hr style="border:none;border-top:1px solid #C8860A;opacity:.3;margin:12px 0"/>';
    } else if (line.startsWith('Týdenní report')) {
      body += `<h2 style="font-family:Georgia,serif;color:#C8860A;font-size:18px;margin:0 0 4px">${esc(line)}</h2>`;
    } else if (line.startsWith('    ')) {
      body += `<div style="padding-left:28px;color:#5a3e1b;font-size:13px;line-height:1.6">${esc(line.trim())}</div>`;
    } else if (line.startsWith('  ')) {
      body += `<div style="padding-left:14px;color:#5a3e1b;font-size:13px;line-height:1.6">${esc(line.trim())}</div>`;
    } else if (line.startsWith('💡')) {
      body += `<div style="background:#FFF8E8;border-left:3px solid #C8860A;padding:8px 12px;margin:8px 0;font-style:italic;color:#5a3e1b;font-size:13px">${esc(line)}</div>`;
    } else if (line.trim() === '') {
      body += '<br>';
    } else {
      body += `<p style="margin:3px 0;color:#3a2a0f;font-size:14px;line-height:1.65">${esc(line)}</p>`;
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
        <div style="font-size:12px;color:rgba(255,215,0,.6);margin-top:3px;letter-spacing:2px">TÝDENNÍ REPORT · ${dateStr}</div>
      </td></tr>
      <tr><td style="padding:20px 24px">${body}</td></tr>
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

function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Start ─────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`[SERVER] Běží na portu ${PORT}`));
