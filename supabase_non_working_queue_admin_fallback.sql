-- ============================================================================
-- BITCHAIN PRO X — NON-WORKING POOL: QUALIFIED WINNER QUEUE + ADMIN FALLBACK
-- Run this in Supabase SQL Editor
-- ============================================================================

-- 1. Helper function to find Admin User ID
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

-- 2. Core Processing Function for Non-Working Pool (30%)
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

        -- Notify winner
        INSERT INTO public.activities (
          user_id, category, type, title, details, amount, created_at
        ) VALUES (
          v_recip_id,
          'non_working',
          'claimable',
          '🎉 Non-Working Prize Ready to Claim!',
          'Level ' || v_level || ' (' || v_level_name || ') Pool #' || v_pool_num || ' is complete! Your prize of $' || TO_CHAR(v_pool.total_pool_amount, 'FM999,990.00') || ' USDT is ready. Go to Non-Working page to claim it.',
          v_pool.total_pool_amount,
          NOW()
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

    -- CASE B: NO qualified user in queue at pool completion time -> Route directly to ADMIN!
    ELSE
      v_admin_id := public.get_admin_user_id();

      IF v_admin_id IS NOT NULL THEN
        -- Credit Admin wallet balance immediately
        UPDATE public.profiles
           SET available_balance  = COALESCE(available_balance, 0) + v_pool.total_pool_amount,
               total_income       = COALESCE(total_income, 0) + v_pool.total_pool_amount,
               non_working_income = COALESCE(non_working_income, 0) + v_pool.total_pool_amount,
               updated_at         = NOW()
         WHERE id = v_admin_id;

        -- Record distribution as paid to admin (Company Retained)
        INSERT INTO public.non_working_distributions (
          pool_id, level, pool_num, recipient_user_id, recipient_username,
          amount, status, requires_directs, distributed_at
        ) VALUES (
          v_pool.id, v_level, v_pool_num, v_admin_id, 'ADMIN (Company Retained)',
          v_pool.total_pool_amount, 'paid', 0, NOW()
        );

        -- Activity log for Admin
        INSERT INTO public.activities (
          user_id, category, type, title, details, amount, created_at
        ) VALUES (
          v_admin_id,
          'non_working',
          'income',
          '🏢 Company Pool Retained (No Qualified User)',
          'Level ' || v_level || ' (' || v_level_name || ') Pool #' || v_pool_num || ' completed without a qualified user in queue. $' || TO_CHAR(v_pool.total_pool_amount, 'FM999,990.00') || ' USDT credited to Admin.',
          v_pool.total_pool_amount,
          NOW()
        );

        -- Mark Pool as Completed by Admin
        UPDATE public.non_working_pools
           SET status             = 'completed',
               recipient_user_id  = v_admin_id,
               recipient_username = 'ADMIN (Company Retained)',
               completed_at       = NOW(),
               updated_at         = NOW()
         WHERE id = v_pool.id;
      ELSE
        -- Fallback if admin ID not found
        UPDATE public.non_working_pools
           SET status             = 'completed',
               recipient_username = 'ADMIN (Company Retained)',
               completed_at       = NOW(),
               updated_at         = NOW()
         WHERE id = v_pool.id;
      END IF;

    END IF;

  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Re-bind trigger on package_purchases
DROP TRIGGER IF EXISTS trg_package_non_working_income ON public.package_purchases;
CREATE TRIGGER trg_package_non_working_income
  AFTER INSERT ON public.package_purchases
  FOR EACH ROW
  EXECUTE FUNCTION public.process_non_working_income();
