-- ============================================================================
-- BITCHAIN PRO X — TEAM INCOME (15% 5-UPLINE LEADERSHIP COMMISSION ENGINE)
-- 5 Qualified Uplines: 5% -> 4% -> 3% -> 2% -> 1% (Total 15%)
-- Pass-up Skip Logic: Upline Rank >= Purchaser Rank Required
-- Run this script in the Supabase SQL Editor (https://app.supabase.com)
-- ============================================================================

-- 1. Helper function to map rank name/key to numeric hierarchy level (1..8)
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

-- 2. Ensure team_income column exists in profiles table
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS team_income NUMERIC(14,2) DEFAULT 0.00;

-- 3. Create table to log every 5-upline Team Income transaction
CREATE TABLE IF NOT EXISTS public.team_income_log (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_id           UUID NOT NULL REFERENCES public.package_purchases(id) ON DELETE CASCADE,
  purchaser_id          UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  purchaser_username    TEXT,
  package_name          TEXT,
  purchase_amount       NUMERIC(14,2) NOT NULL,
  purchaser_rank        TEXT,
  purchaser_rank_level  INT NOT NULL,
  recipient_id          UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  recipient_username    TEXT,
  recipient_rank        TEXT,
  recipient_rank_level  INT,
  upline_position       INT NOT NULL, -- 1..5
  commission_pct        NUMERIC(5,2) NOT NULL, -- 5.00, 4.00, 3.00, 2.00, 1.00
  commission_amount     NUMERIC(14,2) NOT NULL,
  status                TEXT NOT NULL, -- 'paid', 'skipped', 'unallocated'
  reason                TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.team_income_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow insert team income log" ON public.team_income_log;
DROP POLICY IF EXISTS "Users can read own team income log" ON public.team_income_log;
DROP POLICY IF EXISTS "Admins can read team income log" ON public.team_income_log;

CREATE POLICY "Allow insert team income log"
  ON public.team_income_log FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Users can read own team income log"
  ON public.team_income_log FOR SELECT
  USING (auth.uid() = recipient_id OR auth.uid() = purchaser_id);

CREATE POLICY "Admins can read team income log"
  ON public.team_income_log FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND (role = 'admin' OR email = 'bitchain3@gmail.com')
    )
    OR (SELECT email FROM auth.users WHERE id = auth.uid()) = 'bitchain3@gmail.com'
  );

-- Indexes for lightning fast queries
CREATE INDEX IF NOT EXISTS idx_team_income_purchase ON public.team_income_log(purchase_id);
CREATE INDEX IF NOT EXISTS idx_team_income_recipient ON public.team_income_log(recipient_id);
CREATE INDEX IF NOT EXISTS idx_team_income_purchaser ON public.team_income_log(purchaser_id);
CREATE INDEX IF NOT EXISTS idx_team_income_status ON public.team_income_log(status);
CREATE INDEX IF NOT EXISTS idx_team_income_created ON public.team_income_log(created_at);

-- 4. Main PostgreSQL Trigger Function with SECURITY DEFINER
CREATE OR REPLACE FUNCTION public.handle_team_income_distribution()
RETURNS trigger AS $$
DECLARE
  v_purchaser           RECORD;
  v_purchaser_rank_lvl  INT;
  v_purchaser_rank_name TEXT;
  v_current_user_id     UUID;
  v_sponsor_str         TEXT;
  v_raw_sponsor         TEXT;
  v_upline_profile      RECORD;
  v_upline_rank_lvl     INT;
  v_qualified_count     INT := 0;
  v_percentages         NUMERIC(5,2)[] := ARRAY[5.00, 4.00, 3.00, 2.00, 1.00];
  v_pct                 NUMERIC(5,2);
  v_commission          NUMERIC(14,2);
  v_visited_ids         UUID[] := ARRAY[]::UUID[];
  v_loop_safety         INT := 0;
BEGIN
  -- Only process completed rank/package purchases with amount > 0
  IF NEW.status <> 'completed' OR NEW.amount <= 0 THEN
    RETURN NEW;
  END IF;

  -- Prevent duplicate Team Income distribution for the same purchase
  IF EXISTS (SELECT 1 FROM public.team_income_log WHERE purchase_id = NEW.id) THEN
    RETURN NEW;
  END IF;

  -- 1. Fetch purchaser details
  SELECT id, username, full_name, email, sponsor_username, current_rank, current_package
    INTO v_purchaser
    FROM public.profiles
   WHERE id = NEW.user_id;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  v_purchaser_rank_name := COALESCE(NEW.rank_name, NEW.package_name, v_purchaser.current_rank, 'Starter');
  v_purchaser_rank_lvl  := public.get_rank_level(v_purchaser_rank_name);
  IF v_purchaser_rank_lvl = 0 THEN
    v_purchaser_rank_lvl := 1; -- Fallback to Starter level
  END IF;

  v_current_user_id := NEW.user_id;
  v_visited_ids     := ARRAY[NEW.user_id];

  -- 2. Traverse Upline Chain Upward
  WHILE v_qualified_count < 5 AND v_loop_safety < 100 LOOP
    v_loop_safety := v_loop_safety + 1;

    -- Look up sponsor string of current user
    SELECT sponsor_username INTO v_sponsor_str
      FROM public.profiles
     WHERE id = v_current_user_id;

    IF v_sponsor_str IS NULL OR TRIM(v_sponsor_str) = '' THEN
      EXIT; -- Reached root/top of tree
    END IF;

    v_raw_sponsor := LOWER(TRIM(v_sponsor_str));

    -- Find upline profile by referral_code, username, or email
    SELECT id, username, full_name, referral_code, email, sponsor_username,
           current_rank, current_package, available_balance, total_income, team_income, today_income
      INTO v_upline_profile
      FROM public.profiles
     WHERE (
       LOWER(TRIM(COALESCE(referral_code, ''))) = v_raw_sponsor
       OR LOWER(TRIM(COALESCE(username, ''))) = v_raw_sponsor
       OR LOWER(TRIM(COALESCE(email, ''))) = v_raw_sponsor
     )
     AND id <> ALL(v_visited_ids)
     LIMIT 1;

    IF NOT FOUND OR v_upline_profile.id IS NULL THEN
      EXIT; -- No valid upline found or cycle detected
    END IF;

    -- Add to visited
    v_visited_ids     := array_append(v_visited_ids, v_upline_profile.id);
    v_current_user_id := v_upline_profile.id;

    -- Check upline rank qualification (Upline Rank >= Purchaser Rank)
    v_upline_rank_lvl := public.get_rank_level(COALESCE(v_upline_profile.current_rank, v_upline_profile.current_package, ''));

    IF v_upline_rank_lvl >= v_purchaser_rank_lvl THEN
      -- ✅ QUALIFIED UPLINE FOUND!
      v_qualified_count := v_qualified_count + 1;
      v_pct             := v_percentages[v_qualified_count];
      v_commission      := ROUND((NEW.amount * v_pct / 100.0)::numeric, 2);

      -- Record in team_income_log
      INSERT INTO public.team_income_log (
        purchase_id, purchaser_id, purchaser_username, package_name, purchase_amount,
        purchaser_rank, purchaser_rank_level, recipient_id, recipient_username,
        recipient_rank, recipient_rank_level, upline_position, commission_pct,
        commission_amount, status, reason, created_at
      ) VALUES (
        NEW.id, NEW.user_id, COALESCE(v_purchaser.username, v_purchaser.full_name, 'Member'),
        COALESCE(NEW.package_name, NEW.rank_name, 'Package'), NEW.amount,
        v_purchaser_rank_name, v_purchaser_rank_lvl,
        v_upline_profile.id, COALESCE(v_upline_profile.username, v_upline_profile.full_name, 'Upline'),
        COALESCE(v_upline_profile.current_rank, v_upline_profile.current_package, 'Starter'), v_upline_rank_lvl,
        v_qualified_count, v_pct, v_commission, 'paid',
        'Qualified: Upline rank (' || COALESCE(v_upline_profile.current_rank, 'Rank') || ') >= Purchaser rank (' || v_purchaser_rank_name || ')',
        NOW()
      );

      -- Log Recent Activity for recipient
      INSERT INTO public.activities (
        user_id, type, title, details, amount, category, created_at
      ) VALUES (
        v_upline_profile.id, 'income', 'Team Income Received',
        v_pct::text || '% Team Income ($' || TO_CHAR(v_commission, 'FM999,999,990.00') || ' USDT) received from ' || COALESCE(v_purchaser.username, v_purchaser.full_name, 'Downline') || ' purchasing ' || COALESCE(NEW.package_name, NEW.rank_name, 'Package') || ' (Qualified Position #' || v_qualified_count::text || ')',
        v_commission, 'team', NOW()
      );

      -- Update recipient balances in profiles table
      UPDATE public.profiles
         SET available_balance = COALESCE(available_balance, 0) + v_commission,
             total_income      = COALESCE(total_income, 0) + v_commission,
             team_income       = COALESCE(team_income, 0) + v_commission,
             today_income      = COALESCE(today_income, 0) + v_commission,
             updated_at        = NOW()
       WHERE id = v_upline_profile.id;

    ELSE
      -- ❌ UNQUALIFIED UPLINE (Upline Rank < Purchaser Rank) -> SKIP
      INSERT INTO public.team_income_log (
        purchase_id, purchaser_id, purchaser_username, package_name, purchase_amount,
        purchaser_rank, purchaser_rank_level, recipient_id, recipient_username,
        recipient_rank, recipient_rank_level, upline_position, commission_pct,
        commission_amount, status, reason, created_at
      ) VALUES (
        NEW.id, NEW.user_id, COALESCE(v_purchaser.username, v_purchaser.full_name, 'Member'),
        COALESCE(NEW.package_name, NEW.rank_name, 'Package'), NEW.amount,
        v_purchaser_rank_name, v_purchaser_rank_lvl,
        v_upline_profile.id, COALESCE(v_upline_profile.username, v_upline_profile.full_name, 'Upline'),
        COALESCE(v_upline_profile.current_rank, 'None'), v_upline_rank_lvl,
        v_qualified_count + 1, v_percentages[v_qualified_count + 1], 0.00, 'skipped',
        'Skipped: Current rank (' || COALESCE(v_upline_profile.current_rank, 'None') || ') is below purchaser rank (' || v_purchaser_rank_name || ')',
        NOW()
      );

      -- Log Recent Activity explaining why this upline was skipped
      INSERT INTO public.activities (
        user_id, type, title, details, amount, category, created_at
      ) VALUES (
        v_upline_profile.id, 'info', 'Team Income Skipped',
        'Team Income skipped — your current rank (' || COALESCE(v_upline_profile.current_rank, 'None') || ') does not meet the required rank (' || v_purchaser_rank_name || ') for the purchase by ' || COALESCE(v_purchaser.username, v_purchaser.full_name, 'Downline') || '. This position was passed up to the next eligible upline.',
        0.00, 'team', NOW()
      );
    END IF;
  END LOOP;

  -- 3. Handle remaining unallocated positions if tree ended before 5 qualified uplines found
  WHILE v_qualified_count < 5 LOOP
    v_qualified_count := v_qualified_count + 1;
    v_pct             := v_percentages[v_qualified_count];
    v_commission      := ROUND((NEW.amount * v_pct / 100.0)::numeric, 2);

    INSERT INTO public.team_income_log (
      purchase_id, purchaser_id, purchaser_username, package_name, purchase_amount,
      purchaser_rank, purchaser_rank_level, recipient_id, recipient_username,
      recipient_rank, recipient_rank_level, upline_position, commission_pct,
      commission_amount, status, reason, created_at
    ) VALUES (
      NEW.id, NEW.user_id, COALESCE(v_purchaser.username, v_purchaser.full_name, 'Member'),
      COALESCE(NEW.package_name, NEW.rank_name, 'Package'), NEW.amount,
      v_purchaser_rank_name, v_purchaser_rank_lvl,
      NULL, 'Unallocated Pool', 'None', 0,
      v_qualified_count, v_pct, v_commission, 'unallocated',
      'Unallocated: Upline tree ended before 5 qualified uplines were found',
      NOW()
    );
  END LOOP;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. Attach trigger to package_purchases table
DROP TRIGGER IF EXISTS trg_team_income_distribution ON public.package_purchases;
CREATE TRIGGER trg_team_income_distribution
  AFTER INSERT OR UPDATE ON public.package_purchases
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_team_income_distribution();

-- 6. RETROACTIVE SYNC / BACKFILL FOR EXISTING PURCHASES
-- Processes any past completed purchases that have not yet had Team Income logged
DO $$
DECLARE
  r RECORD;
  v_purchaser           RECORD;
  v_purchaser_rank_lvl  INT;
  v_purchaser_rank_name TEXT;
  v_current_user_id     UUID;
  v_sponsor_str         TEXT;
  v_raw_sponsor         TEXT;
  v_upline_profile      RECORD;
  v_upline_rank_lvl     INT;
  v_qualified_count     INT;
  v_percentages         NUMERIC(5,2)[] := ARRAY[5.00, 4.00, 3.00, 2.00, 1.00];
  v_pct                 NUMERIC(5,2);
  v_commission          NUMERIC(14,2);
  v_visited_ids         UUID[];
  v_loop_safety         INT;
BEGIN
  FOR r IN SELECT * FROM public.package_purchases WHERE status = 'completed' AND amount > 0 ORDER BY purchased_at ASC LOOP
    IF NOT EXISTS (SELECT 1 FROM public.team_income_log WHERE purchase_id = r.id) THEN
      SELECT id, username, full_name, email, sponsor_username, current_rank, current_package
        INTO v_purchaser
        FROM public.profiles
       WHERE id = r.user_id;

      IF FOUND THEN
        v_purchaser_rank_name := COALESCE(r.rank_name, r.package_name, v_purchaser.current_rank, 'Starter');
        v_purchaser_rank_lvl  := public.get_rank_level(v_purchaser_rank_name);
        IF v_purchaser_rank_lvl = 0 THEN v_purchaser_rank_lvl := 1; END IF;

        v_current_user_id := r.user_id;
        v_visited_ids     := ARRAY[r.user_id];
        v_qualified_count := 0;
        v_loop_safety     := 0;

        WHILE v_qualified_count < 5 AND v_loop_safety < 100 LOOP
          v_loop_safety := v_loop_safety + 1;

          SELECT sponsor_username INTO v_sponsor_str
            FROM public.profiles
           WHERE id = v_current_user_id;

          IF v_sponsor_str IS NULL OR TRIM(v_sponsor_str) = '' THEN
            EXIT;
          END IF;

          v_raw_sponsor := LOWER(TRIM(v_sponsor_str));

          SELECT id, username, full_name, referral_code, email, sponsor_username,
                 current_rank, current_package, available_balance, total_income, team_income, today_income
            INTO v_upline_profile
            FROM public.profiles
           WHERE (
             LOWER(TRIM(COALESCE(referral_code, ''))) = v_raw_sponsor
             OR LOWER(TRIM(COALESCE(username, ''))) = v_raw_sponsor
             OR LOWER(TRIM(COALESCE(email, ''))) = v_raw_sponsor
           )
           AND id <> ALL(v_visited_ids)
           LIMIT 1;

          IF NOT FOUND OR v_upline_profile.id IS NULL THEN
            EXIT;
          END IF;

          v_visited_ids     := array_append(v_visited_ids, v_upline_profile.id);
          v_current_user_id := v_upline_profile.id;
          v_upline_rank_lvl := public.get_rank_level(COALESCE(v_upline_profile.current_rank, v_upline_profile.current_package, ''));

          IF v_upline_rank_lvl >= v_purchaser_rank_lvl THEN
            v_qualified_count := v_qualified_count + 1;
            v_pct             := v_percentages[v_qualified_count];
            v_commission      := ROUND((r.amount * v_pct / 100.0)::numeric, 2);

            INSERT INTO public.team_income_log (
              purchase_id, purchaser_id, purchaser_username, package_name, purchase_amount,
              purchaser_rank, purchaser_rank_level, recipient_id, recipient_username,
              recipient_rank, recipient_rank_level, upline_position, commission_pct,
              commission_amount, status, reason, created_at
            ) VALUES (
              r.id, r.user_id, COALESCE(v_purchaser.username, v_purchaser.full_name, 'Member'),
              COALESCE(r.package_name, r.rank_name, 'Package'), r.amount,
              v_purchaser_rank_name, v_purchaser_rank_lvl,
              v_upline_profile.id, COALESCE(v_upline_profile.username, v_upline_profile.full_name, 'Upline'),
              COALESCE(v_upline_profile.current_rank, v_upline_profile.current_package, 'Starter'), v_upline_rank_lvl,
              v_qualified_count, v_pct, v_commission, 'paid',
              'Qualified: Upline rank >= purchaser rank', r.purchased_at
            );

            INSERT INTO public.activities (
              user_id, type, title, details, amount, category, created_at
            ) VALUES (
              v_upline_profile.id, 'income', 'Team Income Received',
              v_pct::text || '% Team Income ($' || TO_CHAR(v_commission, 'FM999,999,990.00') || ' USDT) received from ' || COALESCE(v_purchaser.username, v_purchaser.full_name, 'Downline') || ' purchasing ' || COALESCE(r.package_name, r.rank_name, 'Package') || ' (Qualified Position #' || v_qualified_count::text || ')',
              v_commission, 'team', r.purchased_at
            );

            UPDATE public.profiles
               SET available_balance = COALESCE(available_balance, 0) + v_commission,
                   total_income      = COALESCE(total_income, 0) + v_commission,
                   team_income       = COALESCE(team_income, 0) + v_commission,
                   today_income      = COALESCE(today_income, 0) + v_commission,
                   updated_at        = NOW()
             WHERE id = v_upline_profile.id;
          ELSE
            INSERT INTO public.team_income_log (
              purchase_id, purchaser_id, purchaser_username, package_name, purchase_amount,
              purchaser_rank, purchaser_rank_level, recipient_id, recipient_username,
              recipient_rank, recipient_rank_level, upline_position, commission_pct,
              commission_amount, status, reason, created_at
            ) VALUES (
              r.id, r.user_id, COALESCE(v_purchaser.username, v_purchaser.full_name, 'Member'),
              COALESCE(r.package_name, r.rank_name, 'Package'), r.amount,
              v_purchaser_rank_name, v_purchaser_rank_lvl,
              v_upline_profile.id, COALESCE(v_upline_profile.username, v_upline_profile.full_name, 'Upline'),
              COALESCE(v_upline_profile.current_rank, 'None'), v_upline_rank_lvl,
              v_qualified_count + 1, v_percentages[v_qualified_count + 1], 0.00, 'skipped',
              'Skipped: Current rank is below purchaser rank', r.purchased_at
            );

            INSERT INTO public.activities (
              user_id, type, title, details, amount, category, created_at
            ) VALUES (
              v_upline_profile.id, 'info', 'Team Income Skipped',
              'Team Income skipped — your current rank (' || COALESCE(v_upline_profile.current_rank, 'None') || ') does not meet the required rank (' || v_purchaser_rank_name || ') for the purchase by ' || COALESCE(v_purchaser.username, v_purchaser.full_name, 'Downline') || '. This position was passed up to the next eligible upline.',
              0.00, 'team', r.purchased_at
            );
          END IF;
        END LOOP;

        WHILE v_qualified_count < 5 LOOP
          v_qualified_count := v_qualified_count + 1;
          v_pct             := v_percentages[v_qualified_count];
          v_commission      := ROUND((r.amount * v_pct / 100.0)::numeric, 2);

          INSERT INTO public.team_income_log (
            purchase_id, purchaser_id, purchaser_username, package_name, purchase_amount,
            purchaser_rank, purchaser_rank_level, recipient_id, recipient_username,
            recipient_rank, recipient_rank_level, upline_position, commission_pct,
            commission_amount, status, reason, created_at
          ) VALUES (
            r.id, r.user_id, COALESCE(v_purchaser.username, v_purchaser.full_name, 'Member'),
            COALESCE(r.package_name, r.rank_name, 'Package'), r.amount,
            v_purchaser_rank_name, v_purchaser_rank_lvl,
            NULL, 'Unallocated Pool', 'None', 0,
            v_qualified_count, v_pct, v_commission, 'unallocated',
            'Unallocated: Upline tree ended before 5 qualified uplines were found', r.purchased_at
          );
        END LOOP;
      END IF;
    END IF;
  END LOOP;
END;
$$;

SELECT 'Team Income (15% 5-Upline Distribution Engine) installed and synced successfully!' AS status;
