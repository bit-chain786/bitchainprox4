-- ============================================================================
-- BITCHAIN PRO X — NON-WORKING INCOME (30% 8-LEVEL POOL SYSTEM) + TODAY INCOME ENGINE
-- Run this script in the Supabase SQL Editor (https://app.supabase.com)
-- ============================================================================

-- 1. Helper function for Rank Levels (1..8)
CREATE OR REPLACE FUNCTION public.get_rank_level(p_rank TEXT)
RETURNS INT AS $$
BEGIN
  IF p_rank IS NULL OR TRIM(p_rank) = '' THEN
    RETURN 0;
  END IF;
  CASE LOWER(TRIM(p_rank))
    WHEN 'starter'   THEN RETURN 1;
    WHEN 'basic'     THEN RETURN 2;
    WHEN 'silver'    THEN RETURN 3;
    WHEN 'gold'      THEN RETURN 4;
    WHEN 'diamond'   THEN RETURN 5;
    WHEN 'elite'     THEN RETURN 6;
    WHEN 'executive' THEN RETURN 7;
    WHEN 'royal'     THEN RETURN 8;
    ELSE RETURN 0;
  END CASE;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE OR REPLACE FUNCTION public.get_level_name(p_level INT)
RETURNS TEXT AS $$
BEGIN
  CASE p_level
    WHEN 1 THEN RETURN 'Starter';
    WHEN 2 THEN RETURN 'Basic';
    WHEN 3 THEN RETURN 'Silver';
    WHEN 4 THEN RETURN 'Gold';
    WHEN 5 THEN RETURN 'Diamond';
    WHEN 6 THEN RETURN 'Elite';
    WHEN 7 THEN RETURN 'Executive';
    WHEN 8 THEN RETURN 'Royal';
    ELSE RETURN 'Unknown';
  END CASE;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- 2. Ensure non_working_income column exists in profiles
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS non_working_income NUMERIC(14,2) DEFAULT 0.00;

-- 3. Non-Working Pools Table (8 Levels, non-overlapping blocks of 5)
CREATE TABLE IF NOT EXISTS public.non_working_pools (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  level                 INT NOT NULL, -- 1..8
  level_name            TEXT NOT NULL,
  pool_num              INT NOT NULL, -- 1, 2, 3...
  status                TEXT NOT NULL DEFAULT 'active', -- 'active', 'completed'
  target_recipient_seq  INT NOT NULL, -- The sequence number of the winner (same as pool_num)
  recipient_user_id     UUID,
  recipient_username    TEXT,
  current_count         INT NOT NULL DEFAULT 0, -- 0..5
  total_pool_amount     NUMERIC(14,2) NOT NULL DEFAULT 0.00,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at          TIMESTAMPTZ,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_non_working_pool UNIQUE (level, pool_num)
);

-- 4. Non-Working Members Table (Chronological Sequence Numbers per Level)
CREATE TABLE IF NOT EXISTS public.non_working_members (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  level                 INT NOT NULL, -- 1..8
  user_id               UUID NOT NULL,
  username              TEXT,
  full_name             TEXT,
  rank_name             TEXT,
  package_price         NUMERIC(14,2) NOT NULL,
  contribution_amount   NUMERIC(14,2) NOT NULL, -- 30% of package_price
  purchase_id           UUID UNIQUE NOT NULL, -- Duplicate Protection!
  sequence_num          INT NOT NULL, -- 1, 2, 3... per level
  pool_id               UUID REFERENCES public.non_working_pools(id) ON DELETE SET NULL,
  pool_num              INT NOT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_non_working_seq UNIQUE (level, sequence_num)
);

-- 5. Non-Working Distribution Log
CREATE TABLE IF NOT EXISTS public.non_working_distributions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pool_id               UUID NOT NULL REFERENCES public.non_working_pools(id) ON DELETE CASCADE,
  level                 INT NOT NULL,
  pool_num              INT NOT NULL,
  recipient_user_id     UUID NOT NULL,
  recipient_username    TEXT,
  amount                NUMERIC(14,2) NOT NULL,
  status                TEXT NOT NULL DEFAULT 'paid',
  distributed_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 6. Enable RLS on all Non-Working tables
ALTER TABLE public.non_working_pools ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.non_working_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.non_working_distributions ENABLE ROW LEVEL SECURITY;

-- RLS Policies
DROP POLICY IF EXISTS "Public can view non_working_pools" ON public.non_working_pools;
CREATE POLICY "Public can view non_working_pools"
  ON public.non_working_pools FOR SELECT
  TO authenticated, anon
  USING (true);

DROP POLICY IF EXISTS "Public can view non_working_members" ON public.non_working_members;
CREATE POLICY "Public can view non_working_members"
  ON public.non_working_members FOR SELECT
  TO authenticated, anon
  USING (true);

DROP POLICY IF EXISTS "Public can view non_working_distributions" ON public.non_working_distributions;
CREATE POLICY "Public can view non_working_distributions"
  ON public.non_working_distributions FOR SELECT
  TO authenticated, anon
  USING (true);

-- Grant permissions
GRANT ALL ON public.non_working_pools TO authenticated, anon, service_role;
GRANT ALL ON public.non_working_members TO authenticated, anon, service_role;
GRANT ALL ON public.non_working_distributions TO authenticated, anon, service_role;

-- 7. CORE PROCESSING FUNCTION (SECURITY DEFINER)
CREATE OR REPLACE FUNCTION public.process_non_working_purchase()
RETURNS TRIGGER AS $$
DECLARE
  v_level               INT;
  v_level_name          TEXT;
  v_contribution        NUMERIC(14,2);
  v_seq                 INT;
  v_pool_num            INT;
  v_pool                RECORD;
  v_user_profile        RECORD;
  v_recip_id            UUID;
  v_recip_username      TEXT;
  v_already_processed   BOOLEAN;
BEGIN
  -- 1. Determine Level from rank / package
  v_level := public.get_rank_level(COALESCE(NEW.rank_name, NEW.package_name, NEW.package_key));
  IF v_level <= 0 OR v_level > 8 THEN
    -- Fallback by purchase amount
    IF NEW.amount >= 640 THEN v_level := 8;
    ELSIF NEW.amount >= 320 THEN v_level := 7;
    ELSIF NEW.amount >= 160 THEN v_level := 6;
    ELSIF NEW.amount >= 80  THEN v_level := 5;
    ELSIF NEW.amount >= 40  THEN v_level := 4;
    ELSIF NEW.amount >= 20  THEN v_level := 3;
    ELSIF NEW.amount >= 10  THEN v_level := 2;
    ELSE v_level := 1;
    END IF;
  END IF;

  v_level_name := public.get_level_name(v_level);

  -- 2. Duplicate Protection Check
  SELECT EXISTS(
    SELECT 1 FROM public.non_working_members WHERE purchase_id = NEW.id
  ) INTO v_already_processed;

  IF v_already_processed THEN
    RETURN NEW;
  END IF;

  -- 3. Calculate 30% Contribution
  v_contribution := ROUND((NEW.amount * 0.30), 2);
  IF v_contribution <= 0 THEN
    RETURN NEW;
  END IF;

  -- 4. Get Purchaser Profile Information
  SELECT id, username, full_name INTO v_user_profile
    FROM public.profiles
   WHERE id = NEW.user_id;

  -- 5. Determine Chronological Sequence Number for this Level
  SELECT COALESCE(MAX(sequence_num), 0) + 1 INTO v_seq
    FROM public.non_working_members
   WHERE level = v_level;

  -- 6. Determine Non-Overlapping Pool Number (Blocks of 5)
  -- User 1..5 -> Pool 1 (Winner: User 1)
  -- User 6..10 -> Pool 2 (Winner: User 2)
  -- User 11..15 -> Pool 3 (Winner: User 3)
  v_pool_num := ((v_seq - 1) / 5) + 1;

  -- 7. Find or Create Pool Record
  SELECT * INTO v_pool
    FROM public.non_working_pools
   WHERE level = v_level AND pool_num = v_pool_num
   FOR UPDATE;

  IF NOT FOUND THEN
    -- Look up designated winner for this pool (User with sequence_num = v_pool_num in this level)
    SELECT user_id, username INTO v_recip_id, v_recip_username
      FROM public.non_working_members
     WHERE level = v_level AND sequence_num = v_pool_num;

    INSERT INTO public.non_working_pools (
      level, level_name, pool_num, status, target_recipient_seq,
      recipient_user_id, recipient_username, current_count, total_pool_amount, created_at
    ) VALUES (
      v_level, v_level_name, v_pool_num, 'active', v_pool_num,
      v_recip_id, v_recip_username, 0, 0.00, NOW()
    ) RETURNING * INTO v_pool;
  END IF;

  -- 8. Record Member Entry
  INSERT INTO public.non_working_members (
    level, user_id, username, full_name, rank_name,
    package_price, contribution_amount, purchase_id,
    sequence_num, pool_id, pool_num, created_at
  ) VALUES (
    v_level, NEW.user_id,
    COALESCE(v_user_profile.username, 'user_' || SUBSTRING(NEW.user_id::text, 1, 8)),
    COALESCE(v_user_profile.full_name, 'Member #' || v_seq),
    v_level_name,
    NEW.amount, v_contribution, NEW.id,
    v_seq, v_pool.id, v_pool_num, NOW()
  );

  -- 9. Update Pool Accumulation
  UPDATE public.non_working_pools
     SET current_count = current_count + 1,
         total_pool_amount = total_pool_amount + v_contribution,
         updated_at = NOW()
   WHERE id = v_pool.id
   RETURNING * INTO v_pool;

  -- 10. Check if 5-Member Block is Complete
  IF v_pool.current_count >= 5 AND v_pool.status = 'active' THEN
    -- Look up recipient (User with sequence_num = v_pool_num in this level)
    SELECT user_id, username INTO v_recip_id, v_recip_username
      FROM public.non_working_members
     WHERE level = v_level AND sequence_num = v_pool.target_recipient_seq;

    IF v_recip_id IS NOT NULL THEN
      -- Credit Recipient's Profile
      UPDATE public.profiles
         SET available_balance  = COALESCE(available_balance, 0) + v_pool.total_pool_amount,
             total_income       = COALESCE(total_income, 0) + v_pool.total_pool_amount,
             non_working_income = COALESCE(non_working_income, 0) + v_pool.total_pool_amount,
             updated_at         = NOW()
       WHERE id = v_recip_id;

      -- Record in activities table
      INSERT INTO public.activities (
        user_id, category, type, title, details, amount, created_at
      ) VALUES (
        v_recip_id,
        'non_working',
        'income',
        'Non-Working Income Received',
        'Level ' || v_level || ' (' || v_level_name || ') Pool #' || v_pool_num || ' Prize Completed — $' || TO_CHAR(v_pool.total_pool_amount, 'FM999,990.00') || ' USDT (5 Members)',
        v_pool.total_pool_amount,
        NOW()
      );

      -- Record Distribution
      INSERT INTO public.non_working_distributions (
        pool_id, level, pool_num, recipient_user_id, recipient_username,
        amount, status, distributed_at
      ) VALUES (
        v_pool.id, v_level, v_pool_num, v_recip_id, v_recip_username,
        v_pool.total_pool_amount, 'paid', NOW()
      );

      -- Mark Pool as Completed
      UPDATE public.non_working_pools
         SET status = 'completed',
             recipient_user_id = v_recip_id,
             recipient_username = v_recip_username,
             completed_at = NOW(),
             updated_at = NOW()
       WHERE id = v_pool.id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 8. Bind Trigger to package_purchases
DROP TRIGGER IF EXISTS trg_package_non_working_income ON public.package_purchases;
CREATE TRIGGER trg_package_non_working_income
  AFTER INSERT ON public.package_purchases
  FOR EACH ROW
  EXECUTE FUNCTION public.process_non_working_income();

-- 9. DYNAMIC TODAY'S INCOME FUNCTION (Calculates only today's income since 00:00:00)
CREATE OR REPLACE FUNCTION public.get_user_today_income(p_user_id UUID)
RETURNS NUMERIC AS $$
DECLARE
  v_today_start TIMESTAMPTZ;
  v_today_income NUMERIC(14,2);
BEGIN
  -- 12:00 AM Midnight boundary of today
  v_today_start := DATE_TRUNC('day', NOW());

  SELECT COALESCE(SUM(amount), 0.00)
    INTO v_today_income
    FROM public.activities
   WHERE user_id = p_user_id
     AND amount > 0
     AND category IN ('direct', 'team', 'non_working', 'reward', 'income')
     AND created_at >= v_today_start;

  RETURN COALESCE(v_today_income, 0.00);
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.get_user_today_income(UUID) TO authenticated, anon;

-- 10. Performance Indexes
CREATE INDEX IF NOT EXISTS idx_nw_pools_level ON public.non_working_pools(level);
CREATE INDEX IF NOT EXISTS idx_nw_pools_status ON public.non_working_pools(status);
CREATE INDEX IF NOT EXISTS idx_nw_members_level_seq ON public.non_working_members(level, sequence_num);
CREATE INDEX IF NOT EXISTS idx_nw_members_user ON public.non_working_members(user_id);
CREATE INDEX IF NOT EXISTS idx_nw_distrib_user ON public.non_working_distributions(recipient_user_id);

-- 11. Realtime Publication
ALTER PUBLICATION supabase_realtime ADD TABLE public.non_working_pools;
ALTER PUBLICATION supabase_realtime ADD TABLE public.non_working_members;
ALTER PUBLICATION supabase_realtime ADD TABLE public.non_working_distributions;

SELECT 'Non-Working Income 30% 8-Level Pool Engine Installed Successfully!' AS result;
