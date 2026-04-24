-- Babylonská pokladnice — D1 schema
-- Spustit: wrangler d1 execute babylon-pokladnice --file=schema.sql

CREATE TABLE IF NOT EXISTS subscribers (
  email        TEXT PRIMARY KEY,
  child_name   TEXT    NOT NULL DEFAULT '',
  report_text  TEXT    NOT NULL DEFAULT '',
  app_version  TEXT    NOT NULL DEFAULT '',
  active       INTEGER NOT NULL DEFAULT 1,   -- 1 = aktivní, 0 = odhlášen
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  last_sent    TEXT                           -- ISO datum posledního úspěšného odeslání
);

-- Index pro dotaz "všichni aktivní"
CREATE INDEX IF NOT EXISTS idx_subscribers_active ON subscribers(active);
