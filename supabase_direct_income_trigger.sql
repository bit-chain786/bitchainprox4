-- ============================================================================
-- BITCHAIN PRO X — RECONSTRUCTED DIRECT INCOME (40%) COMMISSION ENGINE
-- Complete From-Scratch Implementation (Strict 1-Level Direct Attribution)
-- 
-- System Rules & Architecture:
-- 1. 40% Commission calculated directly from the rank/package purchase amount.
-- 2. Strict 1-Level Direct Sponsor attribution (Downline B -> Sponsor A).
-- 3. NO Rank Barrier: Direct sponsor receives 40% regardless of their own rank.
-- 4. Indirect referrals (Levels 2..8) NEVER receive Direct Income (only Team Income).
-- 5. Unassigned / direct signups (no sponsor) route 40% to outgoing_income_ledger (Admin).
-- 6. Idempotent execution with direct_income_log UNIQUE (purchase_id).
-- 7. Automated profile balance update & recent activities insertion.
-- 8. Complete historical backfill for past completed purchases.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- STEP 1: Ensure public.activities Table & Columns Exist
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
-- STEP 2: Ensure outgoing_income_ledger Exists (for Unallocated / Admin Routing)
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
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS referral_code TEXT;

-- Permanently remove any legacy blocker triggers that stripped sponsor_username
DROP TRIGGER IF EXISTS trigger_validate_sponsor_rank ON public.profiles;
DROP FUNCTION IF EXISTS public.validate_sponsor_rank();

-- ----------------------------------------------------------------------------
-- STEP 4: Drop Old Triggers & Recreate direct_income_log Table Cleanly
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

-- Ensure columns exist if table was previously created
DO $$
BEGIN
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
-- STEP 5: Reconstructed Direct Income Commission Trigger Function
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
BEGIN
  -- Only process completed package/rank purchases with positive amount
  IF NEW.status <> 'completed' OR NEW.amount <= 0 THEN
    RETURN NEW;
  END IF;

  -- Enforce strict idempotency: prevent duplicate commission for the same purchase
  IF EXISTS (SELECT 1 FROM public.direct_income_log WHERE purchase_id = NEW.id) THEN
    RETURN NEW;
  END IF;

  -- 1. Fetch Purchaser Profile
  SELECT id, username, full_name, email, sponsor_username, referral_code
    INTO v_purchaser
    FROM public.profiles
   WHERE id = NEW.user_id;

  v_purchaser_name := COALESCE(v_purchaser.username, v_purchaser.full_name, 'Member');
  v_package_name   := COALESCE(NEW.package_name, NEW.rank_name, 'Package');
  v_commission     := ROUND((NEW.amount * 0.40)::numeric, 2);

  -- 2. Check if user has NO sponsor (Direct / Unassigned Signup)
  IF NOT FOUND 
     OR v_purchaser.sponsor_username IS NULL 
     OR TRIM(v_purchaser.sponsor_username) = '' 
     OR LOWER(TRIM(v_purchaser.sponsor_username)) = 'direct signup' THEN

    -- Log unallocated 40% commission to direct_income_log
    INSERT INTO public.direct_income_log (
      purchase_id,
      purchaser_id,
      purchaser_username,
      package_name,
      purchase_amount,
      sponsor_id,
      sponsor_username,
      commission_pct,
      commission_amount,
      status,
      reason,
      created_at
    ) VALUES (
      NEW.id,
      NEW.user_id,
      v_purchaser_name,
      v_package_name,
      NEW.amount,
      NULL,
      'Direct Signup / Admin',
      40.00,
      v_commission,
      'unallocated',
      'Direct Signup: User has no referral sponsor attached',
      NOW()
    ) ON CONFLICT (purchase_id) DO NOTHING;

    -- Route unallocated 40% to Admin Outgoing Income Ledger
    INSERT INTO public.outgoing_income_ledger (
      income_type,
      amount,
      reason,
      created_at
    ) VALUES (
      'Direct Income',
      v_commission,
      'Direct Signup without sponsor from ' || v_purchaser_name || ' purchasing ' || v_package_name || ' ($' || TO_CHAR(NEW.amount, 'FM999,999,990.00') || ' USDT)',
      NOW()
    );

    RETURN NEW;
  END IF;

  v_raw_sponsor := LOWER(TRIM(v_purchaser.sponsor_username));

  -- 3. Look up Direct Sponsor by referral_code, username, or email (case-insensitive)
  SELECT id, username, full_name, referral_code, available_balance, total_income, direct_income, today_income
    INTO v_sponsor
    FROM public.profiles
   WHERE (
     LOWER(TRIM(COALESCE(referral_code, ''))) = v_raw_sponsor
     OR LOWER(TRIM(COALESCE(username, ''))) = v_raw_sponsor
     OR LOWER(TRIM(COALESCE(email, ''))) = v_raw_sponsor
   )
   AND id <> NEW.user_id
   LIMIT 1;

  -- 4. Case: Sponsor string exists but not found in database
  IF NOT FOUND OR v_sponsor.id IS NULL THEN
    INSERT INTO public.direct_income_log (
      purchase_id,
      purchaser_id,
      purchaser_username,
      package_name,
      purchase_amount,
      sponsor_id,
      sponsor_username,
      commission_pct,
      commission_amount,
      status,
      reason,
      created_at
    ) VALUES (
      NEW.id,
      NEW.user_id,
      v_purchaser_name,
      v_package_name,
      NEW.amount,
      NULL,
      v_purchaser.sponsor_username,
      40.00,
      v_commission,
      'unallocated',
      'Sponsor (' || v_purchaser.sponsor_username || ') not found in database',
      NOW()
    ) ON CONFLICT (purchase_id) DO NOTHING;

    INSERT INTO public.outgoing_income_ledger (
      income_type,
      amount,
      reason,
      created_at
    ) VALUES (
      'Direct Income',
      v_commission,
      'Sponsor (' || v_purchaser.sponsor_username || ') not found for ' || v_purchaser_name || ' purchasing ' || v_package_name || ' ($' || TO_CHAR(NEW.amount, 'FM999,999,990.00') || ' USDT)',
      NOW()
    );

    RETURN NEW;
  END IF;

  -- 5. ✅ QUALIFIED DIRECT SPONSOR FOUND (NO RANK RESTRICTION)
  -- Insert into direct_income_log
  INSERT INTO public.direct_income_log (
    purchase_id,
    purchaser_id,
    purchaser_username,
    package_name,
    purchase_amount,
    sponsor_id,
    sponsor_username,
    commission_pct,
    commission_amount,
    status,
    reason,
    created_at
  ) VALUES (
    NEW.id,
    NEW.user_id,
    v_purchaser_name,
    v_package_name,
    NEW.amount,
    v_sponsor.id,
    COALESCE(v_sponsor.username, v_sponsor.referral_code, 'Sponsor'),
    40.00,
    v_commission,
    'paid',
    'Direct 40% Commission Paid',
    NOW()
  ) ON CONFLICT (purchase_id) DO NOTHING;

  -- 6. Insert Recent Activity Record for Direct Sponsor
  v_detail_text := '40% commission from ' || v_purchaser_name || ' purchasing ' || v_package_name || ' — $' || TO_CHAR(NEW.amount, 'FM999,999,990.00') || ' USDT';

  INSERT INTO public.activities (
    user_id,
    type,
    title,
    details,
    amount,
    category,
    created_at
  ) VALUES (
    v_sponsor.id,
    'income',
    'Direct Income',
    v_detail_text,
    v_commission,
    'direct',
    NOW()
  );

  -- 7. Update Sponsor Financial Balances in Profiles Table
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
-- STEP 6: Attach Trigger to package_purchases Table
-- ----------------------------------------------------------------------------
CREATE TRIGGER trg_direct_income_commission
  AFTER INSERT OR UPDATE ON public.package_purchases
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_direct_income_commission();

-- ----------------------------------------------------------------------------
-- STEP 7: RETROACTIVE SYNC / BACKFILL FOR EXISTING COMPLETED PURCHASES
-- Scans all past purchases and awards 40% commission if not yet logged
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
  v_processed_count  INT := 0;
BEGIN
  FOR r IN SELECT * FROM public.package_purchases WHERE status = 'completed' AND amount > 0 ORDER BY purchased_at ASC LOOP
    -- Only process purchases not yet in direct_income_log
    IF NOT EXISTS (SELECT 1 FROM public.direct_income_log WHERE purchase_id = r.id) THEN
      
      SELECT id, username, full_name, email, sponsor_username, referral_code
        INTO v_purchaser
        FROM public.profiles
       WHERE id = r.user_id;

      IF FOUND THEN
        v_purchaser_name := COALESCE(v_purchaser.username, v_purchaser.full_name, 'Member');
        v_package_name   := COALESCE(r.package_name, r.rank_name, 'Package');
        v_commission     := ROUND((r.amount * 0.40)::numeric, 2);

        IF v_purchaser.sponsor_username IS NOT NULL AND TRIM(v_purchaser.sponsor_username) <> '' AND LOWER(TRIM(v_purchaser.sponsor_username)) <> 'direct signup' THEN
          v_raw_sponsor := LOWER(TRIM(v_purchaser.sponsor_username));

          SELECT id, username, full_name, referral_code
            INTO v_sponsor
            FROM public.profiles
           WHERE (
             LOWER(TRIM(COALESCE(referral_code, ''))) = v_raw_sponsor
             OR LOWER(TRIM(COALESCE(username, ''))) = v_raw_sponsor
             OR LOWER(TRIM(COALESCE(email, ''))) = v_raw_sponsor
           )
           AND id <> r.user_id
           LIMIT 1;

          IF FOUND AND v_sponsor.id IS NOT NULL THEN
            -- Record in direct_income_log
            INSERT INTO public.direct_income_log (
              purchase_id, purchaser_id, purchaser_username, package_name, purchase_amount,
              sponsor_id, sponsor_username, commission_pct, commission_amount, status, reason, created_at
            ) VALUES (
              r.id, r.user_id, v_purchaser_name, v_package_name, r.amount,
              v_sponsor.id, COALESCE(v_sponsor.username, v_sponsor.referral_code, 'Sponsor'),
              40.00, v_commission, 'paid', 'Direct 40% Commission Paid', COALESCE(r.purchased_at, NOW())
            ) ON CONFLICT (purchase_id) DO NOTHING;

            -- Record in activities
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

            v_processed_count := v_processed_count + 1;
          ELSE
            -- Unallocated (sponsor not found)
            INSERT INTO public.direct_income_log (
              purchase_id, purchaser_id, purchaser_username, package_name, purchase_amount,
              sponsor_id, sponsor_username, commission_pct, commission_amount, status, reason, created_at
            ) VALUES (
              r.id, r.user_id, v_purchaser_name, v_package_name, r.amount,
              NULL, v_purchaser.sponsor_username, 40.00, v_commission, 'unallocated', 'Sponsor not found in database', COALESCE(r.purchased_at, NOW())
            ) ON CONFLICT (purchase_id) DO NOTHING;

            INSERT INTO public.outgoing_income_ledger (
              income_type, amount, reason, created_at
            ) VALUES (
              'Direct Income', v_commission, 'Sponsor (' || v_purchaser.sponsor_username || ') not found for ' || v_purchaser_name, COALESCE(r.purchased_at, NOW())
            );
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

          INSERT INTO public.outgoing_income_ledger (
            income_type, amount, reason, created_at
          ) VALUES (
            'Direct Income', v_commission, 'Direct signup from ' || v_purchaser_name, COALESCE(r.purchased_at, NOW())
          );
        END IF;

      END IF;
    END IF;
  END LOOP;

  RAISE NOTICE 'Backfilled % historical direct income commissions.', v_processed_count;
END $$;

SELECT '✅ Reconstructed Direct Income (40%) Commission Engine installed and synced successfully!' AS status;

