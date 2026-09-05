-- ============================================================================
-- BITCHAIN PRO X — MASTER DIRECT INCOME (40%) COMMISSION ENGINE
-- Complete Bulletproof Implementation with Cross-Table Auth Sync & Auto-Recovery
-- ============================================================================

-- ----------------------------------------------------------------------------
-- STEP 1: Ensure public.activities Table & Columns Exist with Proper Types
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.activities (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  type TEXT DEFAULT 'income',
  title TEXT DEFAULT 'Activity',
  details TEXT,
  amount NUMERIC(14,2) DEFAULT 0.00,
  category TEXT DEFAULT 'direct',
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

DO $$
BEGIN
  ALTER TABLE public.activities ADD COLUMN IF NOT EXISTS type TEXT DEFAULT 'income';
  ALTER TABLE public.activities ADD COLUMN IF NOT EXISTS title TEXT DEFAULT 'Activity';
  ALTER TABLE public.activities ADD COLUMN IF NOT EXISTS details TEXT;
  ALTER TABLE public.activities ADD COLUMN IF NOT EXISTS amount NUMERIC(14,2) DEFAULT 0.00;
  ALTER TABLE public.activities ADD COLUMN IF NOT EXISTS category TEXT DEFAULT 'direct';

  ALTER TABLE public.activities ALTER COLUMN details TYPE TEXT USING details::text;
  ALTER TABLE public.activities ALTER COLUMN type DROP NOT NULL;
  ALTER TABLE public.activities ALTER COLUMN type SET DEFAULT 'income';
  ALTER TABLE public.activities ALTER COLUMN title DROP NOT NULL;
  ALTER TABLE public.activities ALTER COLUMN category DROP NOT NULL;
  ALTER TABLE public.activities ALTER COLUMN details DROP NOT NULL;
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

ALTER TABLE public.activities ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow authenticated insert activities" ON public.activities;
CREATE POLICY "Allow authenticated insert activities"
  ON public.activities FOR INSERT
  WITH CHECK (true);

DROP POLICY IF EXISTS "Users can read own activities" ON public.activities;
CREATE POLICY "Users can read own activities"
  ON public.activities FOR SELECT
  USING (auth.uid() = user_id OR auth.uid() IS NULL);

-- ----------------------------------------------------------------------------
-- STEP 2: Ensure outgoing_income_ledger Exists
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.outgoing_income_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  income_type TEXT NOT NULL,
  amount NUMERIC(14,2) NOT NULL,
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.outgoing_income_ledger ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow select outgoing ledger" ON public.outgoing_income_ledger;
CREATE POLICY "Allow select outgoing ledger"
  ON public.outgoing_income_ledger FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Allow insert outgoing ledger" ON public.outgoing_income_ledger;
CREATE POLICY "Allow insert outgoing ledger"
  ON public.outgoing_income_ledger FOR INSERT
  WITH CHECK (true);

-- ----------------------------------------------------------------------------
-- STEP 3: Ensure Profiles Table Has Required Income & Referral Columns
-- ----------------------------------------------------------------------------
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS direct_income NUMERIC(14,2) DEFAULT 0.00;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS total_income NUMERIC(14,2) DEFAULT 0.00;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS available_balance NUMERIC(14,2) DEFAULT 0.00;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS today_income NUMERIC(14,2) DEFAULT 0.00;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS sponsor_username TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS upline_id TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS referral_code TEXT;

-- Permanently remove legacy blocker triggers
DROP TRIGGER IF EXISTS trigger_validate_sponsor_rank ON public.profiles;
DROP FUNCTION IF EXISTS public.validate_sponsor_rank();

-- ----------------------------------------------------------------------------
-- STEP 4: CRITICAL SYNC — Sync Referral Codes & Sponsors from auth.users to profiles
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  -- 1. Copy referral_code from auth metadata if missing or mismatched in profiles
  UPDATE public.profiles p
     SET referral_code = COALESCE(u.raw_user_meta_data->>'referral_code', p.referral_code, UPPER(SUBSTRING(MD5(p.id::TEXT) FROM 1 FOR 5)))
    FROM auth.users u
   WHERE p.id = u.id
     AND (p.referral_code IS NULL OR TRIM(p.referral_code) = '' OR (u.raw_user_meta_data->>'referral_code' IS NOT NULL AND p.referral_code <> u.raw_user_meta_data->>'referral_code'));

  -- 2. Copy username from auth metadata if username was set to email or NULL
  UPDATE public.profiles p
     SET username = COALESCE(u.raw_user_meta_data->>'username', p.username, split_part(p.email, '@', 1))
    FROM auth.users u
   WHERE p.id = u.id
     AND (p.username IS NULL OR p.username = p.email OR TRIM(p.username) = '');

  -- 3. Copy sponsor_username from auth metadata if missing in profiles
  UPDATE public.profiles p
     SET sponsor_username = COALESCE(p.sponsor_username, p.upline_id, u.raw_user_meta_data->>'sponsor_username', u.raw_user_meta_data->>'sponsor', u.raw_user_meta_data->>'ref'),
         upline_id        = COALESCE(p.upline_id, p.sponsor_username, u.raw_user_meta_data->>'sponsor_username', u.raw_user_meta_data->>'sponsor', u.raw_user_meta_data->>'ref')
    FROM auth.users u
   WHERE p.id = u.id
     AND (p.sponsor_username IS NULL OR TRIM(p.sponsor_username) = '');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

-- ----------------------------------------------------------------------------
-- STEP 5: Protect Referral Codes on Profile Updates
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_profile_ref_code()
RETURNS trigger AS $$
BEGIN
  IF OLD.referral_code IS NOT NULL AND TRIM(OLD.referral_code) <> '' THEN
    NEW.referral_code := OLD.referral_code;
  ELSIF NEW.referral_code IS NULL OR TRIM(NEW.referral_code) = '' THEN
    NEW.referral_code := UPPER(SUBSTRING(MD5(RANDOM()::TEXT) FROM 1 FOR 5));
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_profile_ref_code ON public.profiles;
CREATE TRIGGER trg_profile_ref_code
  BEFORE INSERT ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_profile_ref_code();

-- ----------------------------------------------------------------------------
-- STEP 6: Drop Old Triggers & Recreate direct_income_log Table Cleanly
-- ----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_direct_income ON public.package_purchases;
DROP TRIGGER IF EXISTS trg_direct_income_commission ON public.package_purchases;

CREATE TABLE IF NOT EXISTS public.direct_income_log (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_id         UUID NOT NULL UNIQUE REFERENCES public.package_purchases(id) ON DELETE CASCADE,
  purchaser_id        UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  purchaser_username  TEXT,
  package_name        TEXT,
  purchase_amount     NUMERIC(14,2) NOT NULL,
  sponsor_id          UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  sponsor_username    TEXT,
  commission_pct      NUMERIC(5,2) NOT NULL DEFAULT 40.00,
  commission_amount   NUMERIC(14,2) NOT NULL,
  status              TEXT NOT NULL DEFAULT 'paid', -- 'paid', 'unallocated'
  reason              TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Relax all NOT NULL constraints on direct_income_log
DO $$
BEGIN
  ALTER TABLE public.direct_income_log ALTER COLUMN sponsor_id DROP NOT NULL;
  ALTER TABLE public.direct_income_log ALTER COLUMN sponsor_username DROP NOT NULL;
  ALTER TABLE public.direct_income_log ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'paid';
  ALTER TABLE public.direct_income_log ADD COLUMN IF NOT EXISTS reason TEXT;
  ALTER TABLE public.direct_income_log ADD COLUMN IF NOT EXISTS commission_pct NUMERIC(5,2) NOT NULL DEFAULT 40.00;
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

ALTER TABLE public.direct_income_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow insert direct income" ON public.direct_income_log;
CREATE POLICY "Allow insert direct income"
  ON public.direct_income_log FOR INSERT
  WITH CHECK (true);

DROP POLICY IF EXISTS "Users can read own direct income log" ON public.direct_income_log;
CREATE POLICY "Users can read own direct income log"
  ON public.direct_income_log FOR SELECT
  USING (auth.uid() = sponsor_id OR auth.uid() = purchaser_id);

DROP POLICY IF EXISTS "Admins can read direct income" ON public.direct_income_log;
CREATE POLICY "Admins can read direct income"
  ON public.direct_income_log FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND (role = 'admin' OR email = 'bitchain3@gmail.com')
    )
    OR (SELECT email FROM auth.users WHERE id = auth.uid()) = 'bitchain3@gmail.com'
  );

CREATE INDEX IF NOT EXISTS idx_direct_income_purchase ON public.direct_income_log(purchase_id);
CREATE INDEX IF NOT EXISTS idx_direct_income_sponsor ON public.direct_income_log(sponsor_id);
CREATE INDEX IF NOT EXISTS idx_direct_income_purchaser ON public.direct_income_log(purchaser_id);

-- ----------------------------------------------------------------------------
-- STEP 7: Reconstructed Direct Income Commission Trigger Function (Cross-Table)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_direct_income_commission()
RETURNS trigger AS $$
DECLARE
  v_purchaser        RECORD;
  v_sponsor          RECORD;
  v_commission       NUMERIC(14,2);
  v_raw_sponsor      TEXT;
  v_purchaser_name   TEXT;
  v_package_name     TEXT;
  v_detail_text      TEXT;
  v_sponsor_search   TEXT;
BEGIN
  -- Only process completed package/rank purchases with positive amount
  IF NEW.status <> 'completed' OR NEW.amount <= 0 THEN
    RETURN NEW;
  END IF;

  -- 1. Fetch Purchaser Profile
  SELECT id, username, full_name, email, sponsor_username, upline_id, referral_code
    INTO v_purchaser
    FROM public.profiles
   WHERE id = NEW.user_id;

  v_purchaser_name := COALESCE(v_purchaser.username, v_purchaser.full_name, 'Member');
  v_package_name   := COALESCE(NEW.package_name, NEW.rank_name, 'Package');
  v_commission     := ROUND((NEW.amount * 0.40)::numeric, 2);

  -- 2. Determine sponsor identifier (profiles -> upline_id -> auth metadata)
  v_sponsor_search := COALESCE(v_purchaser.sponsor_username, v_purchaser.upline_id);

  IF v_sponsor_search IS NULL OR TRIM(v_sponsor_search) = '' THEN
    SELECT raw_user_meta_data->>'sponsor_username'
      INTO v_sponsor_search
      FROM auth.users
     WHERE id = NEW.user_id;
  END IF;

  -- 3. Case: Direct / Unassigned Signup (No Sponsor)
  IF v_sponsor_search IS NULL 
     OR TRIM(v_sponsor_search) = '' 
     OR LOWER(TRIM(v_sponsor_search)) IN ('direct signup', 'direct_signup', 'none', 'null', 'admin') THEN

    INSERT INTO public.direct_income_log (
      purchase_id, purchaser_id, purchaser_username, package_name, purchase_amount,
      sponsor_id, sponsor_username, commission_pct, commission_amount, status, reason, created_at
    ) VALUES (
      NEW.id, NEW.user_id, v_purchaser_name, v_package_name, NEW.amount,
      NULL, 'Direct Signup / Admin', 40.00, v_commission, 'unallocated',
      'Direct Signup: User has no referral sponsor attached', NOW()
    ) ON CONFLICT (purchase_id) DO UPDATE
      SET status = 'unallocated', reason = 'Direct Signup: User has no referral sponsor attached';

    INSERT INTO public.outgoing_income_ledger (
      income_type, amount, reason, created_at
    ) VALUES (
      'Direct Income', v_commission,
      'Direct Signup without sponsor from ' || v_purchaser_name || ' purchasing ' || v_package_name || ' ($' || TO_CHAR(NEW.amount, 'FM999,999,990.00') || ' USDT)',
      NOW()
    );

    RETURN NEW;
  END IF;

  -- Normalize sponsor search string
  v_raw_sponsor := LOWER(TRIM(REPLACE(v_sponsor_search, '@', '')));

  -- 4. Cross-Table Search: Find Direct Sponsor in public.profiles OR auth.users metadata
  SELECT p.id, p.username, p.full_name, p.referral_code, p.available_balance, p.total_income, p.direct_income, p.today_income
    INTO v_sponsor
    FROM public.profiles p
    LEFT JOIN auth.users u ON u.id = p.id
   WHERE (
     LOWER(TRIM(COALESCE(p.referral_code, ''))) = v_raw_sponsor
     OR LOWER(TRIM(COALESCE(u.raw_user_meta_data->>'referral_code', ''))) = v_raw_sponsor
     OR LOWER(TRIM(COALESCE(p.username, ''))) = v_raw_sponsor
     OR LOWER(TRIM(COALESCE(u.raw_user_meta_data->>'username', ''))) = v_raw_sponsor
     OR LOWER(TRIM(COALESCE(p.email, ''))) = v_raw_sponsor
     OR LOWER(TRIM(COALESCE(u.email, ''))) = v_raw_sponsor
     OR LOWER(TRIM(COALESCE(p.full_name, ''))) = v_raw_sponsor
     OR LOWER(TRIM(COALESCE(u.raw_user_meta_data->>'full_name', ''))) = v_raw_sponsor
     OR p.id::text = v_raw_sponsor
   )
   AND p.id <> NEW.user_id
   LIMIT 1;

  -- 5. Case: Sponsor string exists but not found in DB
  IF NOT FOUND OR v_sponsor.id IS NULL THEN
    INSERT INTO public.direct_income_log (
      purchase_id, purchaser_id, purchaser_username, package_name, purchase_amount,
      sponsor_id, sponsor_username, commission_pct, commission_amount, status, reason, created_at
    ) VALUES (
      NEW.id, NEW.user_id, v_purchaser_name, v_package_name, NEW.amount,
      NULL, v_sponsor_search, 40.00, v_commission, 'unallocated',
      'Sponsor (' || v_sponsor_search || ') not found in database', NOW()
    ) ON CONFLICT (purchase_id) DO UPDATE
      SET status = 'unallocated', reason = 'Sponsor (' || v_sponsor_search || ') not found in database';

    INSERT INTO public.outgoing_income_ledger (
      income_type, amount, reason, created_at
    ) VALUES (
      'Direct Income', v_commission,
      'Sponsor (' || v_sponsor_search || ') not found for ' || v_purchaser_name || ' purchasing ' || v_package_name || ' ($' || TO_CHAR(NEW.amount, 'FM999,999,990.00') || ' USDT)',
      NOW()
    );

    RETURN NEW;
  END IF;

  -- 6. ✅ QUALIFIED DIRECT SPONSOR FOUND (NO RANK RESTRICTION)
  -- Insert or update direct_income_log
  INSERT INTO public.direct_income_log (
    purchase_id, purchaser_id, purchaser_username, package_name, purchase_amount,
    sponsor_id, sponsor_username, commission_pct, commission_amount, status, reason, created_at
  ) VALUES (
    NEW.id, NEW.user_id, v_purchaser_name, v_package_name, NEW.amount,
    v_sponsor.id, COALESCE(v_sponsor.username, v_sponsor.referral_code, 'Sponsor'),
    40.00, v_commission, 'paid', 'Direct 40% Commission Paid', NOW()
  ) ON CONFLICT (purchase_id) DO UPDATE
    SET sponsor_id       = v_sponsor.id,
        sponsor_username = COALESCE(v_sponsor.username, v_sponsor.referral_code, 'Sponsor'),
        status           = 'paid',
        reason           = 'Direct 40% Commission Paid';

  -- 7. Insert Recent Activity Record for Direct Sponsor
  v_detail_text := '40% commission from ' || v_purchaser_name || ' purchasing ' || v_package_name || ' — $' || TO_CHAR(NEW.amount, 'FM999,999,990.00') || ' USDT';

  INSERT INTO public.activities (
    user_id, type, title, details, amount, category, created_at
  ) VALUES (
    v_sponsor.id, 'income', 'Direct Income', v_detail_text, v_commission, 'direct', NOW()
  );

  -- 8. Update Sponsor Financial Balances in Profiles Table
  UPDATE public.profiles
     SET available_balance = COALESCE(available_balance, 0) + v_commission,
         total_income      = COALESCE(total_income, 0) + v_commission,
         direct_income     = COALESCE(direct_income, 0) + v_commission,
         today_income      = COALESCE(today_income, 0) + v_commission,
         updated_at        = NOW()
   WHERE id = v_sponsor.id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ----------------------------------------------------------------------------
-- STEP 8: Attach Trigger to package_purchases Table
-- ----------------------------------------------------------------------------
CREATE TRIGGER trg_direct_income_commission
  AFTER INSERT OR UPDATE ON public.package_purchases
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_direct_income_commission();

-- ----------------------------------------------------------------------------
-- STEP 9: RETROACTIVE SYNC & COMPLETE HISTORICAL RECOVERY (ALL COMPLETED PURCHASES)
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  r                  RECORD;
  v_purchaser        RECORD;
  v_sponsor          RECORD;
  v_commission       NUMERIC(14,2);
  v_raw_sponsor      TEXT;
  v_purchaser_name   TEXT;
  v_package_name     TEXT;
  v_detail_text      TEXT;
  v_sponsor_search   TEXT;
  v_existing_log     RECORD;
  v_credited_count   INT := 0;
BEGIN
  FOR r IN SELECT * FROM public.package_purchases WHERE status = 'completed' AND amount > 0 ORDER BY purchased_at ASC LOOP
    
    -- 1. Fetch Purchaser
    SELECT id, username, full_name, email, sponsor_username, upline_id, referral_code
      INTO v_purchaser
      FROM public.profiles
     WHERE id = r.user_id;

    IF FOUND THEN
      v_purchaser_name := COALESCE(v_purchaser.username, v_purchaser.full_name, 'Member');
      v_package_name   := COALESCE(r.package_name, r.rank_name, 'Package');
      v_commission     := ROUND((r.amount * 0.40)::numeric, 2);

      -- 2. Determine sponsor identifier
      v_sponsor_search := COALESCE(v_purchaser.sponsor_username, v_purchaser.upline_id);

      IF v_sponsor_search IS NULL OR TRIM(v_sponsor_search) = '' THEN
        SELECT raw_user_meta_data->>'sponsor_username'
          INTO v_sponsor_search
          FROM auth.users
         WHERE id = r.user_id;
      END IF;

      IF v_sponsor_search IS NOT NULL 
         AND TRIM(v_sponsor_search) <> '' 
         AND LOWER(TRIM(v_sponsor_search)) NOT IN ('direct signup', 'direct_signup', 'none', 'null', 'admin') THEN

        v_raw_sponsor := LOWER(TRIM(REPLACE(v_sponsor_search, '@', '')));

        -- 3. Cross-Table Search
        SELECT p.id, p.username, p.full_name, p.referral_code
          INTO v_sponsor
          FROM public.profiles p
          LEFT JOIN auth.users u ON u.id = p.id
         WHERE (
           LOWER(TRIM(COALESCE(p.referral_code, ''))) = v_raw_sponsor
           OR LOWER(TRIM(COALESCE(u.raw_user_meta_data->>'referral_code', ''))) = v_raw_sponsor
           OR LOWER(TRIM(COALESCE(p.username, ''))) = v_raw_sponsor
           OR LOWER(TRIM(COALESCE(u.raw_user_meta_data->>'username', ''))) = v_raw_sponsor
           OR LOWER(TRIM(COALESCE(p.email, ''))) = v_raw_sponsor
           OR LOWER(TRIM(COALESCE(u.email, ''))) = v_raw_sponsor
           OR LOWER(TRIM(COALESCE(p.full_name, ''))) = v_raw_sponsor
           OR LOWER(TRIM(COALESCE(u.raw_user_meta_data->>'full_name', ''))) = v_raw_sponsor
           OR p.id::text = v_raw_sponsor
         )
         AND p.id <> r.user_id
         LIMIT 1;

        IF FOUND AND v_sponsor.id IS NOT NULL THEN
          -- Check if already recorded and paid
          SELECT * INTO v_existing_log FROM public.direct_income_log WHERE purchase_id = r.id;

          IF NOT FOUND OR v_existing_log.status <> 'paid' OR v_existing_log.sponsor_id IS NULL THEN
            -- Record / update log
            INSERT INTO public.direct_income_log (
              purchase_id, purchaser_id, purchaser_username, package_name, purchase_amount,
              sponsor_id, sponsor_username, commission_pct, commission_amount, status, reason, created_at
            ) VALUES (
              r.id, r.user_id, v_purchaser_name, v_package_name, r.amount,
              v_sponsor.id, COALESCE(v_sponsor.username, v_sponsor.referral_code, 'Sponsor'),
              40.00, v_commission, 'paid', 'Direct 40% Commission Paid', COALESCE(r.purchased_at, NOW())
            ) ON CONFLICT (purchase_id) DO UPDATE
              SET sponsor_id       = v_sponsor.id,
                  sponsor_username = COALESCE(v_sponsor.username, v_sponsor.referral_code, 'Sponsor'),
                  status           = 'paid',
                  reason           = 'Direct 40% Commission Paid';

            -- Add activity record
            v_detail_text := '40% commission from ' || v_purchaser_name || ' purchasing ' || v_package_name || ' — $' || TO_CHAR(r.amount, 'FM999,999,990.00') || ' USDT';

            INSERT INTO public.activities (
              user_id, type, title, details, amount, category, created_at
            ) VALUES (
              v_sponsor.id, 'income', 'Direct Income', v_detail_text, v_commission, 'direct', COALESCE(r.purchased_at, NOW())
            );

            -- Credit sponsor profile balances
            UPDATE public.profiles
               SET available_balance = COALESCE(available_balance, 0) + v_commission,
                   total_income      = COALESCE(total_income, 0) + v_commission,
                   direct_income     = COALESCE(direct_income, 0) + v_commission,
                   today_income      = COALESCE(today_income, 0) + v_commission,
                   updated_at        = NOW()
             WHERE id = v_sponsor.id;

            v_credited_count := v_credited_count + 1;
          END IF;
        ELSE
          -- Unallocated
          INSERT INTO public.direct_income_log (
            purchase_id, purchaser_id, purchaser_username, package_name, purchase_amount,
            sponsor_id, sponsor_username, commission_pct, commission_amount, status, reason, created_at
          ) VALUES (
            r.id, r.user_id, v_purchaser_name, v_package_name, r.amount,
            NULL, v_sponsor_search, 40.00, v_commission, 'unallocated', 'Sponsor not found in database', COALESCE(r.purchased_at, NOW())
          ) ON CONFLICT (purchase_id) DO NOTHING;
        END IF;
      ELSE
        -- Direct signup without sponsor
        INSERT INTO public.direct_income_log (
          purchase_id, purchaser_id, purchaser_username, package_name, purchase_amount,
          sponsor_id, sponsor_username, commission_pct, commission_amount, status, reason, created_at
        ) VALUES (
          r.id, r.user_id, v_purchaser_name, v_package_name, r.amount,
          NULL, 'Direct Signup / Admin', 40.00, v_commission, 'unallocated', 'Direct signup without sponsor', COALESCE(r.purchased_at, NOW())
        ) ON CONFLICT (purchase_id) DO NOTHING;
      END IF;

    END IF;
  END LOOP;

  RAISE NOTICE 'Direct Income Engine backfilled and credited % purchases to direct sponsors.', v_credited_count;
END $$;

SELECT '✅ MASTER Direct Income (40%) Engine installed and all past commissions credited to sponsors!' AS status;



