-- ============================================================================
-- BITCHAIN PRO X — NON-WORKING POOL: QUALIFIED WINNER QUEUE + ADMIN FALLBACK + CLAIM ENGINE
-- Run this in Supabase SQL Editor
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
       (v_uname IS NOT NULL AND TRIM(v_uname) != '' AND LOWER(TRIM(sponsor_username)) = LOWER(TRIM(v_uname))) OR
       (v_refcode IS NOT NULL AND TRIM(v_refcode) != '' AND LOWER(TRIM(sponsor_username)) = LOWER(TRIM(v_refcode)))
     )
     AND (rank_value IS NOT NULL AND rank_value >= 1);

  RETURN COALESCE(v_count, 0);
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.get_user_direct_count(UUID) TO authenticated, anon, service_role;

-- 3. Helper function to find Admin User ID
CREATE OR REPLACE FUNCTION public.get_admin_user_id()
RETURNS UUID AS $$
DECLARE
  v_id UUID;
BEGIN
  SELECT id INTO v_id 
    FROM public.profiles 
   WHERE role = 'admin' 
      OR LOWER(TRIM(email)) IN ('bitchainpro@gmail.com', 'bitchain3@gmail.com')
   ORDER BY (CASE WHEN LOWER(TRIM(email)) = 'bitchainpro@gmail.com' THEN 0 ELSE 1 END) ASC, created_at ASC
   LIMIT 1;
  RETURN v_id;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.get_admin_user_id() TO authenticated, anon, service_role;

-- 4. Core Processing Function for Non-Working Pool (30%)
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
  v_admin_id            UUID;
  v_already_processed   BOOLEAN;
  v_required_directs    INT;
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
  v_required_directs := CASE WHEN v_level = 1 THEN 1 ELSE 2 END;

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
    INSERT INTO public.non_working_pools (
      level, level_name, pool_num, status, target_recipient_seq,
      recipient_user_id, recipient_username, current_count, total_pool_amount, created_at
    ) VALUES (
      v_level, v_level_name, v_pool_num, 'active', v_pool_num,
      NULL, NULL, 0, 0.00, NOW()
    ) RETURNING * INTO v_pool;
  END IF;

  -- 8. Record Member Entry in 5-slot pool
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

    -- Find the next eligible qualified winner in queue who has NOT yet received a pool prize for this level
    SELECT m.user_id, m.username INTO v_recip_id, v_recip_username
      FROM public.non_working_members m
     WHERE m.level = v_level
       AND public.get_user_direct_count(m.user_id) >= v_required_directs
       AND NOT EXISTS (
         SELECT 1 FROM public.non_working_distributions d
          WHERE d.level = v_level AND d.recipient_user_id = m.user_id
       )
     ORDER BY m.sequence_num ASC
     LIMIT 1;

    -- CASE A: Qualified winner is waiting in line!
    -- Create CLAIMABLE reward ONLY. DO NOT credit user wallet until claimed!
    IF v_recip_id IS NOT NULL THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.non_working_distributions
         WHERE pool_id = v_pool.id AND recipient_user_id = v_recip_id
      ) THEN
        INSERT INTO public.non_working_distributions (
          pool_id, level, pool_num, recipient_user_id, recipient_username,
          amount, status, requires_directs, distributed_at
        ) VALUES (
          v_pool.id, v_level, v_pool_num, v_recip_id, v_recip_username,
          v_pool.total_pool_amount, 'claimable', v_required_directs, NOW()
        );
      END IF;

      -- Mark Pool as Completed with this qualified recipient
      UPDATE public.non_working_pools
         SET status             = 'completed',
             recipient_user_id  = v_recip_id,
             recipient_username = v_recip_username,
             completed_at       = NOW(),
             updated_at         = NOW()
       WHERE id = v_pool.id;

    -- CASE B: NO qualified user in queue at pool completion time -> Route directly to OUTGOING INCOME LEDGER & Admin!
    ELSE
      v_admin_id := public.get_admin_user_id();

      -- 1. Insert into outgoing_income_ledger (Feeds Admin Outgoing Income stat & history modal)
      INSERT INTO public.outgoing_income_ledger (
        income_type, amount, reason, created_at
      ) VALUES (
        'Non-Working Income',
        v_pool.total_pool_amount,
        'Level ' || v_level || ' (' || v_level_name || ') Pool #' || v_pool_num || ' completed without a qualified user in queue',
        NOW()
      );

      IF v_admin_id IS NOT NULL THEN
        -- Credit Admin wallet balance immediately
        UPDATE public.profiles
           SET available_balance  = COALESCE(available_balance, 0) + v_pool.total_pool_amount,
               total_income       = COALESCE(total_income, 0) + v_pool.total_pool_amount,
               non_working_income = COALESCE(non_working_income, 0) + v_pool.total_pool_amount,
               today_income       = COALESCE(today_income, 0) + v_pool.total_pool_amount,
               updated_at         = NOW()
         WHERE id = v_admin_id;

        -- Record distribution as outgoing/unallocated
        INSERT INTO public.non_working_distributions (
          pool_id, level, pool_num, recipient_user_id, recipient_username,
          amount, status, requires_directs, distributed_at
        ) VALUES (
          v_pool.id, v_level, v_pool_num, v_admin_id, 'ADMIN (Outgoing / Unallocated)',
          v_pool.total_pool_amount, 'unallocated', 0, NOW()
        );

        -- Activity log for Admin
        INSERT INTO public.activities (
          user_id, category, type, title, details, amount, created_at
        ) VALUES (
          v_admin_id,
          'non_working',
          'income',
          '🏢 Outgoing Income: Unallocated Pool Retained',
          'Level ' || v_level || ' (' || v_level_name || ') Pool #' || v_pool_num || ' completed without a qualified user in queue. $' || TO_CHAR(v_pool.total_pool_amount, 'FM999,990.00') || ' USDT logged to Outgoing Income.',
          v_pool.total_pool_amount,
          NOW()
        );

        -- Mark Pool as Completed
        UPDATE public.non_working_pools
           SET status             = 'completed',
               recipient_user_id  = v_admin_id,
               recipient_username = 'ADMIN (Outgoing / Unallocated)',
               completed_at       = NOW(),
               updated_at         = NOW()
         WHERE id = v_pool.id;
      ELSE
        -- Fallback if admin ID not found
        UPDATE public.non_working_pools
           SET status             = 'completed',
               recipient_username = 'ADMIN (Outgoing / Unallocated)',
               completed_at       = NOW(),
               updated_at         = NOW()
         WHERE id = v_pool.id;
      END IF;

    END IF;

  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. CLAIM FUNCTION FOR USERS (Idempotent, Atomic Row-Locking & Single-Credit Guarantee)
CREATE OR REPLACE FUNCTION public.claim_non_working_reward(p_distribution_id UUID)
RETURNS JSONB AS $$
DECLARE
  v_user_id UUID;
  v_dist RECORD;
  v_direct_count INT;
  v_needed INT;
  v_level_name TEXT;
  v_updated_rows INT;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  -- 1. Row-level lock to prevent concurrent claims
  SELECT * INTO v_dist
    FROM public.non_working_distributions
   WHERE id = p_distribution_id AND recipient_user_id = v_user_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Reward record not found');
  END IF;

  IF v_dist.status = 'paid' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Reward already claimed');
  END IF;

  IF v_dist.status <> 'claimable' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Reward is not yet claimable');
  END IF;

  -- 2. Verify Direct Referral Requirement
  v_needed := CASE WHEN v_dist.level = 1 THEN 1 ELSE 2 END;
  v_direct_count := public.get_user_direct_count(v_user_id);

  IF v_direct_count < v_needed THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'You need ' || v_needed || ' direct referral(s) to claim. You have ' || v_direct_count || '/' || v_needed
    );
  END IF;

  v_level_name := public.get_level_name(v_dist.level);

  -- 3. Atomic State Transition: claimable -> paid
  UPDATE public.non_working_distributions
     SET status         = 'paid',
         distributed_at = NOW()
   WHERE id = v_dist.id 
     AND status = 'claimable'
     AND recipient_user_id = v_user_id;

  GET DIAGNOSTICS v_updated_rows = ROW_COUNT;
  IF v_updated_rows = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Reward was already processed or is not claimable');
  END IF;

  -- 4. Credit User Balance EXACTLY ONCE
  UPDATE public.profiles
     SET available_balance  = COALESCE(available_balance, 0) + v_dist.amount,
         total_income       = COALESCE(total_income, 0) + v_dist.amount,
         non_working_income = COALESCE(non_working_income, 0) + v_dist.amount,
         today_income       = COALESCE(today_income, 0) + v_dist.amount,
         updated_at         = NOW()
   WHERE id = v_user_id;

  -- 5. Insert ONE Authoritative Financial Activity Record
  INSERT INTO public.activities (
    user_id, category, type, title, details, amount, created_at
  ) VALUES (
    v_user_id,
    'non_working',
    'income',
    'Non-Working Income Claimed ✅',
    'Level ' || v_dist.level || ' (' || v_level_name || ') Pool #' || v_dist.pool_num || ' — $' || TO_CHAR(v_dist.amount, 'FM999,990.00') || ' USDT credited to your wallet',
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

GRANT EXECUTE ON FUNCTION public.claim_non_working_reward(UUID) TO authenticated, anon, service_role;

-- 6. Dynamic Today's Income Function (Calculates only realized income transactions since 00:00:00)
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
     AND type = 'income'
     AND category IN ('direct', 'team', 'non_working', 'reward', 'income')
     AND created_at >= v_today_start;

  RETURN COALESCE(v_today_income, 0.00);
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.get_user_today_income(UUID) TO authenticated, anon, service_role;

-- 7. Ensure outgoing_income_ledger table exists and permissions are granted
CREATE TABLE IF NOT EXISTS public.outgoing_income_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  income_type TEXT NOT NULL,
  amount NUMERIC(14,2) NOT NULL,
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.outgoing_income_ledger ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow select outgoing ledger" ON public.outgoing_income_ledger;
CREATE POLICY "Allow select outgoing ledger" ON public.outgoing_income_ledger FOR SELECT USING (true);
DROP POLICY IF EXISTS "Allow insert outgoing ledger" ON public.outgoing_income_ledger;
CREATE POLICY "Allow insert outgoing ledger" ON public.outgoing_income_ledger FOR INSERT WITH CHECK (true);
GRANT ALL ON public.outgoing_income_ledger TO authenticated, anon, service_role;

-- Clean up any conflicting legacy trigger on non_working_distributions
DROP TRIGGER IF EXISTS trg_non_working_eligibility ON public.non_working_distributions;

-- Re-bind trigger on package_purchases
DROP TRIGGER IF EXISTS trg_package_non_working_income ON public.package_purchases;
CREATE TRIGGER trg_package_non_working_income
  AFTER INSERT ON public.package_purchases
  FOR EACH ROW
  EXECUTE FUNCTION public.process_non_working_income();
