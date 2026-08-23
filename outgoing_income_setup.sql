
CREATE TABLE IF NOT EXISTS public.outgoing_income_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  income_type TEXT NOT NULL,
  amount NUMERIC(14,2) NOT NULL,
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- TEAM INCOME
CREATE OR REPLACE FUNCTION log_unallocated_team_income() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status IN ('unallocated', 'skipped') THEN
    INSERT INTO public.outgoing_income_ledger (income_type, amount, reason, created_at)
    VALUES ('Team Income', NEW.commission_amount, 'No eligible recipient: ' || COALESCE(NEW.reason, ''), NEW.created_at);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_unallocated_team ON public.team_income_distributions;
CREATE TRIGGER trg_unallocated_team
AFTER INSERT OR UPDATE OF status ON public.team_income_distributions
FOR EACH ROW EXECUTE FUNCTION log_unallocated_team_income();

-- NON-WORKING INCOME
CREATE OR REPLACE FUNCTION check_non_working_eligibility() RETURNS TRIGGER AS $$
DECLARE
  v_directs INT;
BEGIN
  IF NEW.status = 'claimable' THEN
    v_directs := public.get_user_direct_count(NEW.recipient_user_id);
    IF v_directs < NEW.requires_directs THEN
      NEW.status := 'unallocated';
      INSERT INTO public.outgoing_income_ledger (income_type, amount, reason)
      VALUES ('Non-Working Income', NEW.amount, 'User lacked ' || NEW.requires_directs || ' directs when pool filled');
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_non_working_eligibility ON public.non_working_distributions;
CREATE TRIGGER trg_non_working_eligibility
BEFORE INSERT ON public.non_working_distributions
FOR EACH ROW EXECUTE FUNCTION check_non_working_eligibility();
