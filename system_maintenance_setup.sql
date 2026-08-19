-- ============================================================
-- BITCHAIN PRO X — System Maintenance Table
-- Run in Supabase SQL Editor
-- ============================================================

CREATE TABLE IF NOT EXISTS public.system_maintenance (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  user_name        TEXT NOT NULL,
  package_name     TEXT NOT NULL,
  rank_name        TEXT,
  purchase_amount  NUMERIC(14,2) NOT NULL,
  maintenance_pct  NUMERIC(5,2)  NOT NULL DEFAULT 10,
  maintenance_amount NUMERIC(14,2) NOT NULL,
  purchase_id      UUID NOT NULL UNIQUE,
  status           TEXT NOT NULL DEFAULT ''completed'',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.system_maintenance ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS Admins can read maintenance ON public.system_maintenance;
DROP POLICY IF EXISTS System can insert maintenance ON public.system_maintenance;
DROP POLICY IF EXISTS Public read maintenance for sum ON public.system_maintenance;

CREATE POLICY System can insert maintenance
  ON public.system_maintenance FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY Public read maintenance for sum
  ON public.system_maintenance FOR SELECT
  USING (true);

CREATE INDEX IF NOT EXISTS idx_system_maintenance_purchase_id ON public.system_maintenance(purchase_id);

SELECT ''system_maintenance table created!'' AS status;
