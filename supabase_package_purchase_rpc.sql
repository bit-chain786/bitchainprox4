-- ============================================================================
-- BITCHAIN PRO X — ATOMIC PACKAGE PURCHASE RPC & COMPLETE RLS PERMISSIONS FIX
-- Run this script in the Supabase SQL Editor (https://app.supabase.com)
-- ============================================================================

-- 1. Atomic Package Purchase Function (Runs with SECURITY DEFINER to bypass RLS)
CREATE OR REPLACE FUNCTION public.purchase_package(
  p_package_key   TEXT,
  p_package_name  TEXT,
  p_rank_name     TEXT,
  p_amount        NUMERIC,
  p_rank_value    INT DEFAULT 1
)
RETURNS JSONB AS $$
DECLARE
  v_user_id       UUID;
  v_profile       RECORD;
  v_new_balance   NUMERIC(14,2);
  v_purchase_id   UUID;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Authentication required. Please log in.');
  END IF;

  -- 1. Fetch user profile with row lock
  SELECT * INTO v_profile FROM public.profiles WHERE id = v_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'message', 'User profile not found.');
  END IF;

  -- 2. Verify balance
  IF COALESCE(v_profile.available_balance, 0) < p_amount THEN
    RETURN jsonb_build_object(
      'success', false,
      'message', 'Insufficient balance ($' || TO_CHAR(COALESCE(v_profile.available_balance, 0), 'FM999,990.00') || ' available, $' || TO_CHAR(p_amount, 'FM999,990.00') || ' required).'
    );
  END IF;

  v_new_balance := v_profile.available_balance - p_amount;

  -- 3. Deduct balance and update user package/rank
  UPDATE public.profiles
     SET available_balance = v_new_balance,
         current_package   = p_package_key,
         current_rank      = p_rank_name,
         rank              = p_rank_name,
         rank_value        = p_rank_value,
         updated_at        = NOW()
   WHERE id = v_user_id;

  -- 4. Record package purchase transaction (this automatically triggers Direct Income & Team Income!)
  INSERT INTO public.package_purchases (
    user_id, package_key, package_name, rank_name, amount, status, purchased_at
  ) VALUES (
    v_user_id, p_package_key, p_package_name, p_rank_name, p_amount, 'completed', NOW()
  )
  RETURNING id INTO v_purchase_id;

  -- 5. Record activity log for the purchaser
  INSERT INTO public.activities (
    user_id, category, type, title, details, amount, created_at
  ) VALUES (
    v_user_id,
    'package',
    'purchase',
    'Upgraded to ' || p_package_name,
    'Package upgrade to ' || p_package_name || ' (-$' || TO_CHAR(p_amount, 'FM999,990.00') || ' USDT)',
    -p_amount,
    NOW()
  );

  RETURN jsonb_build_object(
    'success', true,
    'purchase_id', v_purchase_id,
    'new_balance', v_new_balance,
    'package_name', p_package_name,
    'rank_name', p_rank_name,
    'rank_value', p_rank_value
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execution to authenticated users
GRANT EXECUTE ON FUNCTION public.purchase_package(TEXT, TEXT, TEXT, NUMERIC, INT) TO authenticated, anon;

-- ============================================================================
-- 2. FIX ALL RLS POLICIES ACROSS ALL TABLES (ELIMINATE "permission denied for table users")
-- Uses auth.jwt() ->> 'email' and profile role instead of reading auth.users
-- ============================================================================

-- PROFILES TABLE
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public profiles are viewable by everyone" ON public.profiles;
DROP POLICY IF EXISTS "Users can insert their own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
DROP POLICY IF EXISTS "Admins can update all profiles" ON public.profiles;
DROP POLICY IF EXISTS "Admins can select all profiles" ON public.profiles;

CREATE POLICY "Allow select on profiles"
  ON public.profiles FOR SELECT
  USING (true);

CREATE POLICY "Allow insert on profiles"
  ON public.profiles FOR INSERT
  WITH CHECK (auth.uid() = id);

CREATE POLICY "Allow update on profiles"
  ON public.profiles FOR UPDATE
  USING (
    auth.uid() = id
    OR (auth.jwt() ->> 'email') = 'bitchain3@gmail.com'
    OR EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND (role = 'admin' OR email = 'bitchain3@gmail.com')
    )
  );

-- DEPOSITS TABLE
ALTER TABLE public.deposits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own deposits" ON public.deposits;
DROP POLICY IF EXISTS "Users can insert own deposits" ON public.deposits;
DROP POLICY IF EXISTS "Admins can view all deposits" ON public.deposits;
DROP POLICY IF EXISTS "Admins can update deposits" ON public.deposits;
DROP POLICY IF EXISTS "Admins can update all deposits" ON public.deposits;

CREATE POLICY "Users and admins can view deposits"
  ON public.deposits FOR SELECT
  USING (
    auth.uid() = user_id
    OR (auth.jwt() ->> 'email') = 'bitchain3@gmail.com'
    OR EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND (role = 'admin' OR email = 'bitchain3@gmail.com')
    )
  );

CREATE POLICY "Users can insert deposits"
  ON public.deposits FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Admins and users can update deposits"
  ON public.deposits FOR UPDATE
  USING (
    auth.uid() = user_id
    OR (auth.jwt() ->> 'email') = 'bitchain3@gmail.com'
    OR EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND (role = 'admin' OR email = 'bitchain3@gmail.com')
    )
  );

-- WITHDRAWALS TABLE
ALTER TABLE public.withdrawals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own withdrawals" ON public.withdrawals;
DROP POLICY IF EXISTS "Users can insert own withdrawals" ON public.withdrawals;
DROP POLICY IF EXISTS "Admins can view all withdrawals" ON public.withdrawals;
DROP POLICY IF EXISTS "Admins can update withdrawals" ON public.withdrawals;

CREATE POLICY "Users and admins can view withdrawals"
  ON public.withdrawals FOR SELECT
  USING (
    auth.uid() = user_id
    OR (auth.jwt() ->> 'email') = 'bitchain3@gmail.com'
    OR EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND (role = 'admin' OR email = 'bitchain3@gmail.com')
    )
  );

CREATE POLICY "Users can insert withdrawals"
  ON public.withdrawals FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Admins can update withdrawals"
  ON public.withdrawals FOR UPDATE
  USING (
    auth.uid() = user_id
    OR (auth.jwt() ->> 'email') = 'bitchain3@gmail.com'
    OR EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND (role = 'admin' OR email = 'bitchain3@gmail.com')
    )
  );

-- PACKAGE PURCHASES TABLE
ALTER TABLE public.package_purchases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own package purchases" ON public.package_purchases;
DROP POLICY IF EXISTS "Users can insert own package purchases" ON public.package_purchases;
DROP POLICY IF EXISTS "Admins can view all package purchases" ON public.package_purchases;

CREATE POLICY "Allow select on package purchases"
  ON public.package_purchases FOR SELECT
  USING (
    auth.uid() = user_id
    OR (auth.jwt() ->> 'email') = 'bitchain3@gmail.com'
    OR EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND (role = 'admin' OR email = 'bitchain3@gmail.com')
    )
  );

CREATE POLICY "Allow insert on package purchases"
  ON public.package_purchases FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- ACTIVITIES TABLE
ALTER TABLE public.activities ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own activities" ON public.activities;
DROP POLICY IF EXISTS "Users can insert own activities" ON public.activities;
DROP POLICY IF EXISTS "Admins can view all activities" ON public.activities;

CREATE POLICY "Allow select on activities"
  ON public.activities FOR SELECT
  USING (
    auth.uid() = user_id
    OR (auth.jwt() ->> 'email') = 'bitchain3@gmail.com'
    OR EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND (role = 'admin' OR email = 'bitchain3@gmail.com')
    )
  );

CREATE POLICY "Allow insert on activities"
  ON public.activities FOR INSERT
  WITH CHECK (true);

-- TEAM INCOME LOG TABLE
ALTER TABLE public.team_income_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow insert team income log" ON public.team_income_log;
DROP POLICY IF EXISTS "Users can read own team income log" ON public.team_income_log;
DROP POLICY IF EXISTS "Admins can read team income log" ON public.team_income_log;

CREATE POLICY "Allow insert team income log"
  ON public.team_income_log FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Allow select team income log"
  ON public.team_income_log FOR SELECT
  USING (
    auth.uid() = recipient_id
    OR auth.uid() = purchaser_id
    OR (auth.jwt() ->> 'email') = 'bitchain3@gmail.com'
    OR EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND (role = 'admin' OR email = 'bitchain3@gmail.com')
    )
  );

SELECT 'Package purchase RPC & RLS permissions clean fix applied successfully!' AS status;
