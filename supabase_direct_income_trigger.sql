-- ============================================================================
-- BITCHAIN PRO X — DIRECT INCOME (40%) AUTOMATIC COMMISSION ENGINE
-- Run this script in the Supabase SQL Editor (https://app.supabase.com)
-- ============================================================================

-- 1. Drop existing trigger to avoid dependencies while altering
DROP TRIGGER IF EXISTS trg_direct_income ON public.package_purchases;
DROP TRIGGER IF EXISTS trg_direct_income_commission ON public.package_purchases;

-- 2. Drop and recreate direct_income_log table cleanly
DROP TABLE IF EXISTS public.direct_income_log CASCADE;

CREATE TABLE public.direct_income_log (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_id         UUID NOT NULL UNIQUE,
  purchaser_id        UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  purchaser_username  TEXT,
  package_name        TEXT,
  purchase_amount     NUMERIC(14,2) NOT NULL,
  sponsor_id          UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  sponsor_username    TEXT,
  commission_pct      NUMERIC(5,2) NOT NULL DEFAULT 40.00,
  commission_amount   NUMERIC(14,2) NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.direct_income_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY Allow insert direct income
  ON public.direct_income_log FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY Users can read own direct income log
  ON public.direct_income_log FOR SELECT
  USING (auth.uid() = sponsor_id OR auth.uid() = purchaser_id);

CREATE POLICY Admins can read direct income
  ON public.direct_income_log FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND (role = ''admin'' OR email = ''bitchain3@gmail.com'')
    )
    OR (SELECT email FROM auth.users WHERE id = auth.uid()) = ''bitchain3@gmail.com''
  );

-- Ensure RLS on activities table permits authenticated insert and public/user select
ALTER TABLE public.activities ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS Allow authenticated insert activities ON public.activities;
CREATE POLICY Allow authenticated insert activities
  ON public.activities FOR INSERT
  WITH CHECK (true);

DROP POLICY IF EXISTS Users can read own activities ON public.activities;
CREATE POLICY Users can read own activities
  ON public.activities FOR SELECT
  USING (auth.uid() = user_id OR auth.uid() IS NULL);

-- 3. Trigger function that executes on PostgreSQL backend with SECURITY DEFINER
CREATE OR REPLACE FUNCTION public.handle_direct_income_commission()
RETURNS trigger AS 
DECLARE
  v_purchaser RECORD;
  v_sponsor   RECORD;
  v_commission NUMERIC(14,2);
  v_raw_sponsor TEXT;
BEGIN
  -- Only process completed rank/package purchases
  IF NEW.status <> ''completed'' OR NEW.amount <= 0 THEN
    RETURN NEW;
  END IF;

  -- Prevent duplicate commission for the same purchase
  IF EXISTS (SELECT 1 FROM public.direct_income_log WHERE purchase_id = NEW.id) THEN
    RETURN NEW;
  END IF;

  -- 1. Fetch purchaser profile
  SELECT id, username, full_name, email, sponsor_username, referral_code
    INTO v_purchaser
    FROM public.profiles
   WHERE id = NEW.user_id;

  IF NOT FOUND OR v_purchaser.sponsor_username IS NULL OR TRIM(v_purchaser.sponsor_username) = '''' THEN
    RETURN NEW;
  END IF;

  v_raw_sponsor := LOWER(TRIM(v_purchaser.sponsor_username));

  -- 2. Find sponsor by referral_code, username, or email (case-insensitive)
  SELECT id, username, full_name, referral_code, available_balance, total_income, direct_income, today_income
    INTO v_sponsor
    FROM public.profiles
   WHERE (
     LOWER(TRIM(COALESCE(referral_code, ''''))) = v_raw_sponsor
     OR LOWER(TRIM(COALESCE(username, ''''))) = v_raw_sponsor
     OR LOWER(TRIM(COALESCE(email, ''''))) = v_raw_sponsor
   )
   AND id <> NEW.user_id
   LIMIT 1;

  -- If sponsor not found, exit
  IF NOT FOUND OR v_sponsor.id IS NULL THEN
    RETURN NEW;
  END IF;

  -- 3. Calculate 40% Direct Commission
  v_commission := ROUND((NEW.amount * 0.40)::numeric, 2);

  -- 4. Record in direct_income_log
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
    created_at
  ) VALUES (
    NEW.id,
    NEW.user_id,
    COALESCE(v_purchaser.username, v_purchaser.full_name, ''Member''),
    COALESCE(NEW.package_name, NEW.rank_name, ''Package''),
    NEW.amount,
    v_sponsor.id,
    COALESCE(v_sponsor.username, v_sponsor.referral_code, ''Sponsor''),
    40.00,
    v_commission,
    NOW()
  ) ON CONFLICT (purchase_id) DO NOTHING;

  -- 5. Insert activity record for the sponsor so it shows in Recent Activity
  INSERT INTO public.activities (
    user_id,
    title,
    details,
    amount,
    category,
    created_at
  ) VALUES (
    v_sponsor.id,
    ''Direct Income'',
    ''40% commission from '' || COALESCE(v_purchaser.username, v_purchaser.full_name, ''Direct Referral'') || '' purchasing '' || COALESCE(NEW.package_name, NEW.rank_name, ''Package'') || '' — $'' || TO_CHAR(NEW.amount, ''FM999,999,990.00'') || '' USDT'',
    v_commission,
    ''direct'',
    NOW()
  );

  -- 6. Update sponsor financial balances in profiles table
  UPDATE public.profiles
     SET available_balance = COALESCE(available_balance, 0) + v_commission,
         total_income      = COALESCE(total_income, 0) + v_commission,
         direct_income     = COALESCE(direct_income, 0) + v_commission,
         today_income      = COALESCE(today_income, 0) + v_commission,
         updated_at        = NOW()
   WHERE id = v_sponsor.id;

  RETURN NEW;
END;
 LANGUAGE plpgsql SECURITY DEFINER;

-- 4. Attach trigger to package_purchases table
CREATE TRIGGER trg_direct_income_commission
  AFTER INSERT OR UPDATE ON public.package_purchases
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_direct_income_commission();

-- 5. RETROACTIVE SYNC / BACKFILL FOR EXISTING PURCHASES
-- This automatically credits 40% direct income for past completed purchases
DO 
DECLARE
  r RECORD;
  v_purchaser RECORD;
  v_sponsor RECORD;
  v_commission NUMERIC(14,2);
  v_raw_sponsor TEXT;
BEGIN
  FOR r IN SELECT * FROM public.package_purchases WHERE status = ''completed'' AND amount > 0 LOOP
    IF NOT EXISTS (SELECT 1 FROM public.direct_income_log WHERE purchase_id = r.id) THEN
      SELECT id, username, full_name, email, sponsor_username, referral_code
        INTO v_purchaser
        FROM public.profiles
       WHERE id = r.user_id;

      IF FOUND AND v_purchaser.sponsor_username IS NOT NULL AND TRIM(v_purchaser.sponsor_username) <> '''' THEN
        v_raw_sponsor := LOWER(TRIM(v_purchaser.sponsor_username));

        SELECT id, username, full_name, referral_code
          INTO v_sponsor
          FROM public.profiles
         WHERE (
           LOWER(TRIM(COALESCE(referral_code, ''''))) = v_raw_sponsor
           OR LOWER(TRIM(COALESCE(username, ''''))) = v_raw_sponsor
           OR LOWER(TRIM(COALESCE(email, ''''))) = v_raw_sponsor
         )
         AND id <> r.user_id
         LIMIT 1;

        IF FOUND AND v_sponsor.id IS NOT NULL THEN
          v_commission := ROUND((r.amount * 0.40)::numeric, 2);

          INSERT INTO public.direct_income_log (
            purchase_id, purchaser_id, purchaser_username, package_name, purchase_amount,
            sponsor_id, sponsor_username, commission_pct, commission_amount, created_at
          ) VALUES (
            r.id, r.user_id, COALESCE(v_purchaser.username, v_purchaser.full_name, ''Member''),
            COALESCE(r.package_name, r.rank_name, ''Package''), r.amount,
            v_sponsor.id, COALESCE(v_sponsor.username, v_sponsor.referral_code, ''Sponsor''),
            40.00, v_commission, r.purchased_at
          ) ON CONFLICT (purchase_id) DO NOTHING;

          INSERT INTO public.activities (user_id, title, details, amount, category, created_at)
          VALUES (
            v_sponsor.id,
            ''Direct Income'',
            ''40% commission from '' || COALESCE(v_purchaser.username, v_purchaser.full_name, ''Direct Referral'') || '' purchasing '' || COALESCE(r.package_name, r.rank_name, ''Package'') || '' — $'' || TO_CHAR(r.amount, ''FM999,999,990.00'') || '' USDT'',
            v_commission,
            ''direct'',
            r.purchased_at
          );

          UPDATE public.profiles
             SET available_balance = COALESCE(available_balance, 0) + v_commission,
                 total_income      = COALESCE(total_income, 0) + v_commission,
                 direct_income     = COALESCE(direct_income, 0) + v_commission,
                 today_income      = COALESCE(today_income, 0) + v_commission,
                 updated_at        = NOW()
           WHERE id = v_sponsor.id;
        END IF;
      END IF;
    END IF;
  END LOOP;
END;
;

SELECT ''Direct Income 40% Commission engine installed and synced successfully!'' AS status;
