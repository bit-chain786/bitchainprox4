-- ============================================================================
-- BITCHAIN PRO X — NON-WORKING INCOME (30% 8-LEVEL POOL SYSTEM) + 2 DIRECTS REQUIREMENT
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

-- 2. Direct Referrals Count Helper
CREATE OR REPLACE FUNCTION public.get_user_direct_count(p_user_id UUID)
RETURNS INT AS $$
DECLARE
  v_uname TEXT;
  v_refcode TEXT;
  v_count INT;
BEGIN
  SELECT username, referral_code INTO v_uname, v_refcode
    FROM public.profiles WHERE id = p_user_id;

  SELECT COUNT(*) INTO v_count
    FROM public.profiles
   WHERE id != p_user_id
     AND (
       (sponsor_id = p_user_id) OR
       (v_uname IS NOT NULL AND TRIM(v_uname) != '' AND LOWER(TRIM(sponsor_username)) = LOWER(TRIM(v_uname))) OR
       (v_refcode IS NOT NULL AND TRIM(v_refcode) != '' AND LOWER(TRIM(sponsor_username)) = LOWER(TRIM(v_refcode)))
     );

  RETURN COALESCE(v_count, 0);
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.get_user_direct_count(UUID) TO authenticated, anon;

-- 3. Ensure non_working_income column exists in profiles
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS non_working_income NUMERIC(14,2) DEFAULT 0.00;

-- 4. Non-Working Pools Table (8 Levels, non-overlapping blocks of 5)
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

-- 5. Non-Working Members Table (Chronological Sequence Numbers per Level)
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

-- 6. Non-Working Distribution Log
CREATE TABLE IF NOT EXISTS public.non_working_distributions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pool_id               UUID NOT NULL REFERENCES public.non_working_pools(id) ON DELETE CASCADE,
  level                 INT NOT NULL,
  pool_num              INT NOT NULL,
  recipient_user_id     UUID NOT NULL,
  recipient_username    TEXT,
  amount                NUMERIC(14,2) NOT NULL,
  status                TEXT NOT NULL DEFAULT 'paid', -- 'paid' or 'pending_directs'
  requires_directs      INT NOT NULL DEFAULT 2,
  distributed_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 7. Enable RLS on all Non-Working tables
ALTER TABLE public.non_working_pools ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.non_working_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.non_working_distributions ENABLE ROW LEVEL SECURITY;

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

GRANT ALL ON public.non_working_pools TO authenticated, anon, service_role;
GRANT ALL ON public.non_working_members TO authenticated, anon, service_role;
GRANT ALL ON public.non_working_distributions TO authenticated, anon, service_role;

-- 8. CORE PROCESSING FUNCTION (SECURITY DEFINER)
CREATE OR REPLACE FUNCTION public.process_non_working_income()
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
  v_direct_count        INT;
BEGIN
  -- 1. Determine Level from rank / package
  v_level := public.get_rank_level(COALESCE(NEW.rank_name, NEW.package_name, NEW.package_key));
  IF v_level <= 0 OR v_level > 8 THEN
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
  v_pool_num := ((v_seq - 1) / 5) + 1;

  -- 7. Find or Create Pool Record
  SELECT * INTO v_pool
    FROM public.non_working_pools
   WHERE level = v_level AND pool_num = v_pool_num
   FOR UPDATE;

  IF NOT FOUND THEN
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
    SELECT user_id, username INTO v_recip_id, v_recip_username
      FROM public.non_working_members
     WHERE level = v_level AND sequence_num = v_pool.target_recipient_seq;

    IF v_recip_id IS NOT NULL THEN
      -- Determine Direct Referrals Requirement (Starter = 1 direct, Higher ranks = 2 directs)
      v_direct_count := public.get_user_direct_count(v_recip_id);

      IF (v_level = 1 AND v_direct_count >= 1) OR (v_level > 1 AND v_direct_count >= 2) THEN
        -- Eligible: Credit Recipient's Profile Immediately
        UPDATE public.profiles
           SET available_balance  = COALESCE(available_balance, 0) + v_pool.total_pool_amount,
               total_income       = COALESCE(total_income, 0) + v_pool.total_pool_amount,
               non_working_income = COALESCE(non_working_income, 0) + v_pool.total_pool_amount,
               updated_at         = NOW()
         WHERE id = v_recip_id;

        -- Record Activity
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

        -- Record Distribution as Paid
        INSERT INTO public.non_working_distributions (
          pool_id, level, pool_num, recipient_user_id, recipient_username,
          amount, status, requires_directs, distributed_at
        ) VALUES (
          v_pool.id, v_level, v_pool_num, v_recip_id, v_recip_username,
          v_pool.total_pool_amount, 'paid', (CASE WHEN v_level = 1 THEN 1 ELSE 2 END), NOW()
        );
      ELSE
        -- Ineligible (needs 1 direct for L1 or 2 directs for L2+): Record Distribution as Pending Claim
        INSERT INTO public.non_working_distributions (
          pool_id, level, pool_num, recipient_user_id, recipient_username,
          amount, status, requires_directs, distributed_at
        ) VALUES (
          v_pool.id, v_level, v_pool_num, v_recip_id, v_recip_username,
          v_pool.total_pool_amount, 'pending_directs', (CASE WHEN v_level = 1 THEN 1 ELSE 2 END), NOW()
        );
      END IF;

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

-- 9. Trigger on package_purchases
DROP TRIGGER IF EXISTS trg_package_non_working_income ON public.package_purchases;
CREATE TRIGGER trg_package_non_working_income
  AFTER INSERT ON public.package_purchases
  FOR EACH ROW
  EXECUTE FUNCTION public.process_non_working_income();

-- 10. CLAIM FUNCTION FOR USERS (when 1 direct for Starter or 2 directs for higher levels achieved)
CREATE OR REPLACE FUNCTION public.claim_non_working_reward(p_distribution_id UUID)
RETURNS JSONB AS $$
DECLARE
  v_user_id UUID;
  v_dist RECORD;
  v_direct_count INT;
  v_needed INT;
  v_level_name TEXT;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  SELECT * INTO v_dist
    FROM public.non_working_distributions
   WHERE id = p_distribution_id AND recipient_user_id = v_user_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Reward record not found');
  END IF;

  IF v_dist.status = 'paid' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Reward has already been claimed');
  END IF;

  v_needed := CASE WHEN v_dist.level = 1 THEN 1 ELSE 2 END;

  -- Verify Direct Referrals
  v_direct_count := public.get_user_direct_count(v_user_id);
  IF v_direct_count < v_needed THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', v_needed || ' Direct Referral(s) required to claim (You have: ' || v_direct_count || '/' || v_needed || ')'
    );
  END IF;

  v_level_name := public.get_level_name(v_dist.level);

  -- Credit Balance
  UPDATE public.profiles
     SET available_balance  = COALESCE(available_balance, 0) + v_dist.amount,
         total_income       = COALESCE(total_income, 0) + v_dist.amount,
         non_working_income = COALESCE(non_working_income, 0) + v_dist.amount,
         updated_at         = NOW()
   WHERE id = v_user_id;

  -- Mark Paid
  UPDATE public.non_working_distributions
     SET status = 'paid',
         distributed_at = NOW()
   WHERE id = v_dist.id;

  -- Record Activity Log
  INSERT INTO public.activities (
    user_id, category, type, title, details, amount, created_at
  ) VALUES (
    v_user_id,
    'non_working',
    'income',
    'Non-Working Income Claimed',
    'Claimed Level ' || v_dist.level || ' (' || v_level_name || ') Pool #' || v_dist.pool_num || ' Prize — $' || TO_CHAR(v_dist.amount, 'FM999,990.00') || ' USDT (2 Directs Verified)',
    v_dist.amount,
    NOW()
  );

  RETURN jsonb_build_object(
    'success', true,
    'amount', v_dist.amount,
    'level', v_dist.level,
    'pool_num', v_dist.pool_num
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.claim_non_working_reward(UUID) TO authenticated, anon;

-- 11. DYNAMIC TODAY'S INCOME FUNCTION (Calculates only today's income since 00:00:00)
CREATE OR REPLACE FUNCTION public.get_user_today_income(p_user_id UUID)
RETURNS NUMERIC AS $$
DECLARE
  v_today_start TIMESTAMPTZ;
  v_today_income NUMERIC(14,2);
BEGIN
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

-- 12. Performance Indexes
CREATE INDEX IF NOT EXISTS idx_nw_pools_level ON public.non_working_pools(level);
CREATE INDEX IF NOT EXISTS idx_nw_pools_status ON public.non_working_pools(status);
CREATE INDEX IF NOT EXISTS idx_nw_members_level_seq ON public.non_working_members(level, sequence_num);
CREATE INDEX IF NOT EXISTS idx_nw_members_user ON public.non_working_members(user_id);
CREATE INDEX IF NOT EXISTS idx_nw_distrib_user ON public.non_working_distributions(recipient_user_id);

-- 13. Backfill & Sync for existing packages
CREATE OR REPLACE FUNCTION public.sync_existing_purchases_to_non_working()
RETURNS INT AS $$
DECLARE
  v_rec RECORD;
  v_count INT := 0;
  v_user RECORD;
  v_lvl INT;
  v_price NUMERIC;
  v_dummy RECORD;
BEGIN
  -- Sync any completed package_purchases not yet in non_working_members
  FOR v_rec IN 
    SELECT * FROM public.package_purchases 
     WHERE status = 'completed' OR status IS NULL 
     ORDER BY purchased_at ASC
  LOOP
    IF NOT EXISTS (SELECT 1 FROM public.non_working_members WHERE purchase_id = v_rec.id) THEN
-- 13. Backfill & Sync for existing packages with deduplication
CREATE OR REPLACE FUNCTION public.clean_and_deduplicate_non_working_members()
RETURNS INT AS $$
DECLARE
  v_rec RECORD;
  v_seq INT;
  v_pool_num INT;
  v_count INT := 0;
BEGIN
  -- 1. Remove duplicate entries for the same user in the same level (keep earliest)
  DELETE FROM public.non_working_members
   WHERE id NOT IN (
     SELECT DISTINCT ON (user_id, level) id
       FROM public.non_working_members
      ORDER BY user_id, level, created_at ASC
   );

  -- 2. Update real usernames and full names from profiles
  UPDATE public.non_working_members m
     SET username  = COALESCE(p.username, m.username),
         full_name = COALESCE(p.full_name, m.full_name)
    FROM public.profiles p
   WHERE m.user_id = p.id;

  -- 3. Renumber sequence_num sequentially from 1..N per level
  FOR v_rec IN 
    SELECT id, level, ROW_NUMBER() OVER (PARTITION BY level ORDER BY created_at ASC) as new_seq
      FROM public.non_working_members
     ORDER BY level, created_at ASC
  LOOP
    v_pool_num := ((v_rec.new_seq - 1) / 5) + 1;
    UPDATE public.non_working_members
       SET sequence_num = v_rec.new_seq,
           pool_num     = v_pool_num
     WHERE id = v_rec.id;
    v_count := v_count + 1;
  END LOOP;

  -- 4. Rebuild non_working_pools
  DELETE FROM public.non_working_pools;

  FOR v_rec IN 
    SELECT level, pool_num, COUNT(*) as cnt, SUM(contribution_amount) as total_amt
      FROM public.non_working_members
     GROUP BY level, pool_num
     ORDER BY level, pool_num
  LOOP
    INSERT INTO public.non_working_pools (
      level, level_name, pool_num, status, target_recipient_seq,
      recipient_user_id, recipient_username, current_count, total_pool_amount, created_at
    ) VALUES (
      v_rec.level,
      public.get_level_name(v_rec.level),
      v_rec.pool_num,
      CASE WHEN v_rec.cnt >= 5 THEN 'completed' ELSE 'active' END,
      v_rec.pool_num,
      (SELECT user_id FROM public.non_working_members WHERE level = v_rec.level AND sequence_num = v_rec.pool_num),
      (SELECT username FROM public.non_working_members WHERE level = v_rec.level AND sequence_num = v_rec.pool_num),
      v_rec.cnt,
      COALESCE(v_rec.total_amt, 0.00),
      NOW()
    );
  END LOOP;

  RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.clean_and_deduplicate_non_working_members() TO authenticated, anon;

-- Run deduplication & sequence renumbering immediately
SELECT public.clean_and_deduplicate_non_working_members();

SELECT 'Non-Working Deduplication & Clean Sequence Setup Successfully!' AS result;
