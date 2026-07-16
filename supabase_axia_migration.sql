-- ============================================================
-- AXIA Daily Equity Migration
-- Run in Supabase SQL Editor (Dashboard → SQL Editor → New Query)
-- ============================================================

-- 1. Client / Account registry
CREATE TABLE IF NOT EXISTS axia_clients (
  id          uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  client      text        NOT NULL,
  account     text        NOT NULL,
  label       text,
  created_at  timestamptz DEFAULT now(),
  UNIQUE(client, account)
);

-- Seed default client
INSERT INTO axia_clients (client, account, label)
VALUES ('4751R', '47511', 'Chase Capital – AXIA Markets Pro')
ON CONFLICT DO NOTHING;

-- 2. Daily NLV equity log
CREATE TABLE IF NOT EXISTS axia_daily_equity (
  id          uuid         DEFAULT gen_random_uuid() PRIMARY KEY,
  client      text         NOT NULL,
  account     text         NOT NULL,
  trade_date  date         NOT NULL,
  currency    text         NOT NULL DEFAULT 'GBP',
  equity      numeric(18,2) NOT NULL,
  chg_nlv     numeric(18,2),
  notes       text,
  created_at  timestamptz  DEFAULT now(),
  updated_at  timestamptz  DEFAULT now(),
  UNIQUE(client, account, trade_date, currency)
);

-- 3. Auto-update updated_at on edit
CREATE OR REPLACE FUNCTION _axia_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS axia_daily_equity_updated_at ON axia_daily_equity;
CREATE TRIGGER axia_daily_equity_updated_at
  BEFORE UPDATE ON axia_daily_equity
  FOR EACH ROW EXECUTE FUNCTION _axia_set_updated_at();

-- 4. Index for fast prev-day lookups
CREATE INDEX IF NOT EXISTS idx_axia_equity_lookup
  ON axia_daily_equity(client, account, currency, trade_date DESC);

-- 5. Enable Row Level Security (open for service_role key used by backend)
ALTER TABLE axia_clients     ENABLE ROW LEVEL SECURITY;
ALTER TABLE axia_daily_equity ENABLE ROW LEVEL SECURITY;

-- Allow full access via service_role (backend uses this key)
DROP POLICY IF EXISTS "service_role full access" ON axia_clients;
CREATE POLICY "service_role full access" ON axia_clients
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_role full access" ON axia_daily_equity;
CREATE POLICY "service_role full access" ON axia_daily_equity
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ============================================================
-- Done. Tables: axia_clients, axia_daily_equity
-- ============================================================
