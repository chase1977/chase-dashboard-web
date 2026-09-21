-- supabase_capital_flow_migration.sql
-- Run once in Supabase SQL editor (Nish — per standing rule, Claude never
-- runs SQL directly). Additive only — adds two nullable columns to every
-- daily-cadence equity table (existing + already-registered Data Feeds).
--
-- What this enables: flagging a daily-equity row as "Initial Investment" or
-- "Add-On" in the AXIA / IG / any Data Feed entry form (Data & Reports tab),
-- so that day's CHG NLV is recorded as new capital in (via an auto-created
-- capital_transfers ledger row) instead of being counted as trading P&L.
-- See README §10.2 and AxiaEquityEntry.jsx / supabase_service.py's
-- sync_capital_flow_transfer for the full mechanism.

-- 1. Legacy AXIA / IG tables (not in the data_feeds registry)
ALTER TABLE axia_daily_equity ADD COLUMN IF NOT EXISTS capital_flow_type text;
ALTER TABLE axia_daily_equity ADD COLUMN IF NOT EXISTS capital_transfer_id bigint;
ALTER TABLE axia_daily_equity DROP CONSTRAINT IF EXISTS axia_daily_equity_capital_flow_type_check;
ALTER TABLE axia_daily_equity ADD CONSTRAINT axia_daily_equity_capital_flow_type_check
  CHECK (capital_flow_type IS NULL OR capital_flow_type IN ('initial','addon'));

ALTER TABLE ig_daily_equity ADD COLUMN IF NOT EXISTS capital_flow_type text;
ALTER TABLE ig_daily_equity ADD COLUMN IF NOT EXISTS capital_transfer_id bigint;
ALTER TABLE ig_daily_equity DROP CONSTRAINT IF EXISTS ig_daily_equity_capital_flow_type_check;
ALTER TABLE ig_daily_equity ADD CONSTRAINT ig_daily_equity_capital_flow_type_check
  CHECK (capital_flow_type IS NULL OR capital_flow_type IN ('initial','addon'));

-- 2. Every already-registered daily-cadence Data Feed (any feed you create
--    from now on gets these columns automatically — the "Generate SQL"
--    template in Data & Reports -> Data Feeds already includes them).
DO $$
DECLARE
  feed RECORD;
BEGIN
  FOR feed IN SELECT equity_table FROM data_feeds WHERE cadence = 'daily' LOOP
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS capital_flow_type text', feed.equity_table);
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS capital_transfer_id bigint', feed.equity_table);
    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I', feed.equity_table, feed.equity_table || '_capital_flow_type_check');
    EXECUTE format(
      'ALTER TABLE %I ADD CONSTRAINT %I CHECK (capital_flow_type IS NULL OR capital_flow_type IN (''initial'',''addon''))',
      feed.equity_table, feed.equity_table || '_capital_flow_type_check'
    );
  END LOOP;
END $$;

-- Note: capital_transfer_id is an application-level link back to
-- capital_transfers.id (bigint identity) — deliberately NOT a hard FK
-- constraint, so this migration can't fail if a row's linked transfer was
-- since deleted by hand. The backend keeps it in sync on create/edit/delete
-- of a flagged equity row.
