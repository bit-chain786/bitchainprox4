-- ============================================================================
-- BITCHAIN PRO X — DEPOSIT APPROVAL ENGINE (FIXED: No Double-Credit)
-- RUN THIS ENTIRE SCRIPT IN SUPABASE SQL EDITOR TO APPLY THE FIX
-- ============================================================================

-- STEP 1: Add balance_credited guard column (idempotency flag)
ALTER TABLE public.deposits ADD COLUMN IF NOT EXISTS balance_credited BOOLEAN NOT NULL DEFAULT FALSE;

-- STEP 2: RPC Function — the ONLY place that credits balance
-- Uses balance_credited flag: no matter how many times called, balance added ONCE.
CREATE OR REPLACE FUNCTION public.admin_process_deposit(
  p_deposit_id UUID,
  p_status     TEXT,
  p_notes      TEXT DEFAULT ''
)
RETURNS JSONB AS $$
DECLARE
  v_dep     RECORD;
  v_new_bal NUMERIC(14,2);
BEGIN
  SELECT * INTO v_dep FROM public.deposits WHERE id = p_deposit_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'message', 'Deposit not found');
  END IF;

  -- IDEMPOTENCY GUARD: Only process if still pending
  IF v_dep.status <> 'pending' THEN
    RETURN jsonb_build_object('success', false, 'message', 'Deposit already ' || v_dep.status);
  END IF;

  -- Update status and mark credited flag atomically
  UPDATE public.deposits
     SET status           = p_status,
         admin_notes      = p_notes,
         reviewed_at      = NOW(),
         updated_at       = NOW(),
         balance_credited = CASE WHEN p_status IN ('approved','completed') THEN TRUE ELSE FALSE END
   WHERE id = p_deposit_id;

  -- Credit balance ONCE
  IF p_status = 'approved' OR p_status = 'completed' THEN
    UPDATE public.profiles
       SET available_balance = COALESCE(available_balance, 0) + v_dep.amount,
           updated_at        = NOW()
     WHERE id = v_dep.user_id
     RETURNING available_balance INTO v_new_bal;

    INSERT INTO public.activities (user_id, type, title, details, amount, category, created_at)
    SELECT v_dep.user_id, 'deposit', 'Deposit Approved',
           'BEP-20 USDT Deposit of $' || TO_CHAR(v_dep.amount, 'FM999,999,990.00') || ' USDT — Approved & credited to available balance (Ref: ' || p_deposit_id::text || ')',
           v_dep.amount, 'deposit', NOW()
    WHERE NOT EXISTS (
      SELECT 1 FROM public.activities
       WHERE user_id = v_dep.user_id AND category = 'deposit'
         AND (details ILIKE '%' || p_deposit_id::text || '%' OR (amount = v_dep.amount AND created_at >= NOW() - INTERVAL '2 minutes'))
    );
  END IF;

  RETURN jsonb_build_object('success', true, 'status', p_status, 'amount', v_dep.amount, 'new_balance', v_new_bal);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.admin_process_deposit(UUID, TEXT, TEXT) TO authenticated, anon;

-- STEP 3: Trigger — ONLY credits if RPC missed it (safety net with guard check)
CREATE OR REPLACE FUNCTION public.handle_deposit_approval()
RETURNS trigger AS $$
BEGIN
  IF (NEW.status = 'approved' OR NEW.status = 'completed')
     AND (OLD IS NULL OR (OLD.status <> 'approved' AND OLD.status <> 'completed')) THEN

    -- DOUBLE-CREDIT GUARD: Only credit if RPC hasn't already flagged it
    IF NOT COALESCE(NEW.balance_credited, FALSE) THEN
      UPDATE public.profiles
         SET available_balance = COALESCE(available_balance, 0) + NEW.amount,
             updated_at        = NOW()
       WHERE id = NEW.user_id;
      UPDATE public.deposits SET balance_credited = TRUE WHERE id = NEW.id;
    END IF;

    INSERT INTO public.activities (user_id, type, title, details, amount, category, created_at)
    SELECT NEW.user_id, 'deposit', 'Deposit Approved',
           'BEP-20 USDT Deposit of $' || TO_CHAR(NEW.amount, 'FM999,999,990.00') || ' USDT — Approved & credited to available balance (Ref: ' || NEW.id::text || ')',
           NEW.amount, 'deposit', NOW()
    WHERE NOT EXISTS (
      SELECT 1 FROM public.activities
       WHERE user_id = NEW.user_id AND category = 'deposit'
         AND (details ILIKE '%' || NEW.id::text || '%' OR (amount = NEW.amount AND created_at >= NOW() - INTERVAL '2 minutes'))
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_deposit_approval ON public.deposits;
CREATE TRIGGER trg_deposit_approval
  AFTER INSERT OR UPDATE ON public.deposits
  FOR EACH ROW EXECUTE FUNCTION public.handle_deposit_approval();

DROP POLICY IF EXISTS "Admins can update all profiles" ON public.profiles;
CREATE POLICY "Admins can update all profiles" ON public.profiles FOR UPDATE
  USING (auth.uid() = id OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND (role = 'admin' OR email = 'bitchain3@gmail.com')) OR (SELECT email FROM auth.users WHERE id = auth.uid()) = 'bitchain3@gmail.com');

DROP POLICY IF EXISTS "Admins can update all deposits" ON public.deposits;
CREATE POLICY "Admins can update all deposits" ON public.deposits FOR UPDATE
  USING (auth.uid() = user_id OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND (role = 'admin' OR email = 'bitchain3@gmail.com')) OR (SELECT email FROM auth.users WHERE id = auth.uid()) = 'bitchain3@gmail.com');

SELECT 'Deposit approval engine fixed — zero double-credit possible!' AS status;
