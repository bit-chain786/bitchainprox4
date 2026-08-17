-- ============================================================
-- BITCHAIN PRO X — REWARDS SYSTEM SQL SETUP
-- Run in Supabase SQL Editor
-- ============================================================

-- 1. Create 'reward_claims' table for recording claimed milestone bonuses
CREATE TABLE IF NOT EXISTS public.reward_claims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  level INTEGER NOT NULL, -- 1, 2, 3, 4, 5
  target_amount NUMERIC(14,2) NOT NULL, -- 500, 1000, 2000, 4000, 8000
  reward_amount NUMERIC(14,2) NOT NULL, -- 25, 50, 100, 200, 400
  direct_business_at_claim NUMERIC(14,2) NOT NULL,
  cycle_start_date TIMESTAMPTZ NOT NULL,
  cycle_end_date TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'claimed',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enable RLS on reward_claims
ALTER TABLE public.reward_claims ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own reward claims" ON public.reward_claims;
DROP POLICY IF EXISTS "Users can insert own reward claims" ON public.reward_claims;
DROP POLICY IF EXISTS "Admins can view all reward claims" ON public.reward_claims;

CREATE POLICY "Users can view own reward claims" 
  ON public.reward_claims 
  FOR SELECT 
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own reward claims" 
  ON public.reward_claims 
  FOR INSERT 
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Admins can view all reward claims" 
  ON public.reward_claims 
  FOR SELECT 
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND (role = 'admin' OR email = 'bitchain3@gmail.com'))
  );

-- 2. Allow users to read package_purchases of their direct referrals for business calculations
-- (or completed package purchases)
DROP POLICY IF EXISTS "Users can view direct referrals package purchases" ON public.package_purchases;
DROP POLICY IF EXISTS "Public can view completed purchases for reward business" ON public.package_purchases;

CREATE POLICY "Public can view completed purchases for reward business" 
  ON public.package_purchases 
  FOR SELECT 
  USING (
    auth.uid() = user_id
    OR status = 'completed'
  );

SELECT 'BITCHAIN PRO X Rewards table setup complete!' AS status;
