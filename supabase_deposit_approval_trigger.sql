-- ============================================================================
-- BITCHAIN PRO X — AUTOMATIC DEPOSIT APPROVAL & BALANCE CREDITING ENGINE
-- Runs with SECURITY DEFINER to guarantee 100% reliable balance crediting
-- Run this script in the Supabase SQL Editor (https://app.supabase.com)
-- ============================================================================

-- 1. Direct RPC Function for Admin Deposit Processing (Bypasses RLS)
CREATE OR REPLACE FUNCTION public.admin_process_deposit(
  p_deposit_id UUID,
  p_status TEXT,
  p_notes TEXT DEFAULT ''
)
RETURNS JSONB AS $$
DECLARE
  v_dep RECORD;
  v_new_bal NUMERIC(14,2);
BEGIN
  -- Fetch deposit with lock
  SELECT * INTO v_dep FROM public.deposits WHERE id = p_deposit_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'message', 'Deposit not found');
  END IF;

  IF v_dep.status <> 'pending' AND v_dep.status <> p_status THEN
    RETURN jsonb_build_object('success', false, 'message', 'Deposit is already ' || v_dep.status);
  END IF;

  -- Update deposit status
  UPDATE public.deposits
     SET status = p_status,
         admin_notes = p_notes,
         reviewed_at = NOW(),
         updated_at = NOW()
   WHERE id = p_deposit_id;

  -- If approved, credit user profile available_balance
  IF p_status = 'approved' OR p_status = 'completed' THEN
    UPDATE public.profiles
       SET available_balance = COALESCE(available_balance, 0) + v_dep.amount,
           updated_at = NOW()
     WHERE id = v_dep.user_id
     RETURNING available_balance INTO v_new_bal;

    -- Insert Recent Activity record
    IF NOT EXISTS (
      SELECT 1 FROM public.activities
       WHERE user_id = v_dep.user_id
         AND category = 'deposit'
         AND details ILIKE '%' || p_deposit_id::text || '%'
    ) THEN
      INSERT INTO public.activities (
        user_id, type, title, details, amount, category, created_at
      ) VALUES (
        v_dep.user_id,
        'deposit',
        'Deposit Approved',
        'BEP-20 USDT Deposit of $' || TO_CHAR(v_dep.amount, 'FM999,999,990.00') || ' USDT — Approved & credited to available balance',
        v_dep.amount,
        'deposit',
        NOW()
      );
    END IF;
  END IF;

  RETURN jsonb_build_object('success', true, 'status', p_status, 'amount', v_dep.amount, 'new_balance', v_new_bal);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execution to authenticated users / admins
GRANT EXECUTE ON FUNCTION public.admin_process_deposit(UUID, TEXT, TEXT) TO authenticated, anon;

-- 2. Automatic Deposit Approval Trigger (Fires on any update to deposits table)
CREATE OR REPLACE FUNCTION public.handle_deposit_approval()
RETURNS trigger AS $$
BEGIN
  IF (NEW.status = 'approved' OR NEW.status = 'completed') 
     AND (OLD IS NULL OR (OLD.status <> 'approved' AND OLD.status <> 'completed')) THEN
    
    -- Credit available_balance
    UPDATE public.profiles
       SET available_balance = COALESCE(available_balance, 0) + NEW.amount,
           updated_at        = NOW()
     WHERE id = NEW.user_id;

    -- Activity
    IF NOT EXISTS (
      SELECT 1 FROM public.activities
       WHERE user_id = NEW.user_id
         AND category = 'deposit'
         AND (details ILIKE '%' || NEW.id::text || '%' OR (amount = NEW.amount AND created_at >= NOW() - INTERVAL '2 minutes'))
    ) THEN
      INSERT INTO public.activities (
        user_id, type, title, details, amount, category, created_at
      ) VALUES (
        NEW.user_id,
        'deposit',
        'Deposit Approved',
        'BEP-20 USDT Deposit of $' || TO_CHAR(NEW.amount, 'FM999,999,990.00') || ' USDT — Approved & credited to available balance',
        NEW.amount,
        'deposit',
        NOW()
      );
    END IF;

  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Attach trigger to deposits table
DROP TRIGGER IF EXISTS trg_deposit_approval ON public.deposits;
CREATE TRIGGER trg_deposit_approval
  AFTER INSERT OR UPDATE ON public.deposits
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_deposit_approval();

-- 4. Ensure RLS policies allow admins to update profiles and deposits
DROP POLICY IF EXISTS "Admins can update all profiles" ON public.profiles;
CREATE POLICY "Admins can update all profiles"
  ON public.profiles FOR UPDATE
  USING (
    auth.uid() = id
    OR EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND (role = 'admin' OR email = 'bitchain3@gmail.com')
    )
    OR (SELECT email FROM auth.users WHERE id = auth.uid()) = 'bitchain3@gmail.com'
  );

DROP POLICY IF EXISTS "Admins can update all deposits" ON public.deposits;
CREATE POLICY "Admins can update all deposits"
  ON public.deposits FOR UPDATE
  USING (
    auth.uid() = user_id
    OR EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND (role = 'admin' OR email = 'bitchain3@gmail.com')
    )
    OR (SELECT email FROM auth.users WHERE id = auth.uid()) = 'bitchain3@gmail.com'
  );

SELECT 'Deposit approval RPC function and trigger installed successfully!' AS status;
