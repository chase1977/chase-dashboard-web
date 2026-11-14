-- sql/2026-11-14_portfolio_kpi_snapshots.sql
-- Additive-only. Already run 14-11-2026 (Nish), kept for the record.
-- Daily KPI snapshot per DATA date — see README §17.7.

create table if not exists public.portfolio_kpi_snapshots (
  id                      bigserial primary key,
  snapshot_date           date        not null,
  level                   text        not null check (level in ('portfolio','pod','strategy')),
  entity_id               bigint      not null default 0,
  entity_name             text,
  pod_name                text,
  status                  text,
  initial_investment      numeric(18,2),
  active_capital_invested numeric(18,2),
  capital_allocated       numeric(18,2),
  current_equity          numeric(18,2),
  total_pnl               numeric(18,2),
  banked_profit           numeric(18,2),
  banked_profit_true      numeric(18,2),
  performance             numeric(14,6),
  pct_1d                  numeric(14,6),
  pct_7d                  numeric(14,6),
  pct_30d                 numeric(14,6),
  kpis_json               jsonb,
  source                  text        not null default 'nightly' check (source in ('nightly','manual','backfill')),
  computed_at             timestamptz not null default now(),
  unique (snapshot_date, level, entity_id)
);

alter table public.portfolio_kpi_snapshots enable row level security;   -- service key bypasses

-- Verify:
-- select column_name, data_type from information_schema.columns
--  where table_schema = 'public' and table_name = 'portfolio_kpi_snapshots' order by ordinal_position;  -- 21 rows
-- select relname, relrowsecurity from pg_class where relname = 'portfolio_kpi_snapshots';                -- true
