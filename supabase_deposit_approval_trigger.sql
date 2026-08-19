-- ============================================================================
-- BITCHAIN PRO X — AUTOMATIC DEPOSIT APPROVAL & BALANCE CREDITING TRIGGER
-- Runs with SECURITY DEFINER to guarantee instant balance crediting upon approval
-- Run this script in the Supabase SQL Editor (https://app.supabase.com)
-- ============================================================================

-- 1. Create automatic deposit approval trigger function
CREATE OR REPLACE FUNCTION public.handle_deposit_approval()
RETURNS trigger AS $$
DECLARE
  v_current_bal NUMERIC(14,2);
BEGIN
  -- Check if status transitioned to 'approved' or was inserted as 'approved'
  IF (NEW.status = 'approved' OR NEW.status = 'completed') AND (OLD IS NULL OR (OLD.status <> 'approved' AND OLD.status <> 'completed')) THEN
    
    -- 1. Update user profile available balance reliably
    UPDATE public.profiles
       SET available_balance = COALESCE(available_balance, 0) + NEW.amount,
           updated_at        = NOW()
     WHERE id = NEW.user_id;

    -- 2. Log activity if not already logged for this deposit
    IF NOT EXISTS (
      SELECT 1 FROM public.activities
       WHERE user_id = NEW.user_id
         AND category = 'deposit'
         AND (details ILIKE '%' || NEW.id::text || '%' OR (amount = NEW.amount AND created_at >= NOW() - INTERVAL '5 minutes'))
    ) THEN
      INSERT INTO public.activities (
        user_id, type, title, details, amount, category, created_at
      ) VALUES (
        NEW.user_id,
        'deposit',
        'Deposit Approved',
        'BEP-20 USDT Deposit of $' || TO_CHAR(NEW.amount, 'FM999,999,990.00') || ' USDT — Approved & credited to available balance (Ref: ' || NEW.id::text || ')',
        NEW.amount,
        'deposit',
        NOW()
      );
    END IF;

  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. Attach trigger to deposits table
DROP TRIGGER IF EXISTS trg_deposit_approval ON public.deposits;
CREATE TRIGGER trg_deposit_approval
  AFTER INSERT OR UPDATE ON public.deposits
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_deposit_approval();

-- 3. Ensure profiles RLS allows admins to update balances
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

DROP POLICY IF EXISTS "Admins can select all profiles" ON public.profiles;
CREATE POLICY "Admins can select all profiles"
  ON public.profiles FOR SELECT
  USING (
    true
  );

SELECT 'Deposit automatic crediting trigger and admin policies configured successfully!' AS status;
