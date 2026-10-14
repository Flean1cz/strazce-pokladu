-- Babylonská pokladnice — D1 schéma, verze 2 (Worker v2)
-- Spuštění: npm run db:init:remote   (nebo wrangler d1 execute babylon-pokladnice --remote --file=schema.sql)

-- Verze 1 držela text reportu v tabulce subscribers. Backend nikdy nebyl nasazen,
-- takže není co migrovat. Report se do databáze nikdy neukládá.
DROP TABLE IF EXISTS subscribers;

CREATE TABLE IF NOT EXISTS subscriptions (
  email              TEXT PRIMARY KEY,
  child_name         TEXT NOT NULL DEFAULT '',
  status             TEXT NOT NULL DEFAULT 'pending',  -- pending | active | unsubscribed
  secret_hash        TEXT NOT NULL,                    -- SHA-256 tajného klíče z aplikace (klíč sám se neukládá)
  confirm_hash       TEXT,                             -- SHA-256 potvrzovacího odkazu (NULL po potvrzení)
  confirm_expires_at TEXT,                             -- ISO čas, po kterém potvrzení neplatí
  unsub_token        TEXT NOT NULL,                    -- náhodný token v odhlašovacím odkazu
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL,
  confirmed_at       TEXT,
  last_sent_week     TEXT,                             -- "YYYY-Www" posledního odeslaného reportu
  last_sent_at       TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_subscriptions_secret ON subscriptions(secret_hash);
CREATE UNIQUE INDEX IF NOT EXISTS idx_subscriptions_unsub  ON subscriptions(unsub_token);
CREATE INDEX IF NOT EXISTS idx_subscriptions_confirm       ON subscriptions(confirm_hash);

-- Počítadla pro limity požadavků (klíč je hash, takže se v databázi neukládají IP ani e-maily).
CREATE TABLE IF NOT EXISTS rate_limits (
  key        TEXT PRIMARY KEY,
  count      INTEGER NOT NULL,
  expires_at INTEGER NOT NULL                          -- ms epoch, kdy záznam přestane platit
);
CREATE INDEX IF NOT EXISTS idx_rate_limits_expires ON rate_limits(expires_at);
