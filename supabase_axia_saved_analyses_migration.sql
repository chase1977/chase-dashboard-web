-- supabase_axia_saved_analyses_migration.sql
-- ============================================================
-- AXIA Saved / Shared Analysis Migration
-- Run in Supabase SQL Editor (Dashboard -> SQL Editor -> New Query)
--
-- Persists AXIA Trade Analysis results so they:
--   1. Survive backend restarts (the in-memory analysis cache does not)
--   2. Can be reopened later without re-uploading the trade log
--   3. Can be shared via a public read-only link (/analysis/shared/:id)
-- ============================================================

CREATE TABLE IF NOT EXISTS axia_saved_analyses (
  id          uuid          DEFAULT gen_random_uuid() PRIMARY KEY,
  trader      text          NOT NULL,
  account     text          NOT NULL,
  label       text,
  date_from   date,
  date_to     date,
  currencies  text[],
  data        jsonb         NOT NULL,
  created_at  timestamptz   DEFAULT now(),
  updated_at  timestamptz   DEFAULT now()
);

-- Reuses the trigger function from supabase_axia_migration.sql if already
-- created; CREATE OR REPLACE makes this file safe to run standalone too.
CREATE OR REPLACE FUNCTION _axia_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS axia_saved_analyses_updated_at ON axia_saved_analyses;
CREATE TRIGGER axia_saved_analyses_updated_at
  BEFORE UPDATE ON axia_saved_analyses
  FOR EACH ROW EXECUTE FUNCTION _axia_set_updated_at();

-- Fast listing, newest first (powers the "Saved Analyses" panel)
CREATE INDEX IF NOT EXISTS idx_axia_saved_analyses_created
  ON axia_saved_analyses(created_at DESC);

-- RLS: only the backend's service_role key may read/write this table.
-- The public share link (/analysis/shared/:id) is served through the FastAPI
-- backend (which uses the service_role key), not direct Supabase access —
-- same security model already used by the rest of this app (no user auth
-- layer; access is gated by knowing the app URL / an unguessable UUID).
ALTER TABLE axia_saved_analyses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role full access" ON axia_saved_analyses;
CREATE POLICY "service_role full access" ON axia_saved_analyses
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ============================================================
-- Done. Table: axia_saved_analyses
-- ============================================================
