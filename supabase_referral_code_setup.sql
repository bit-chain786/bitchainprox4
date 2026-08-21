-- ============================================================================
-- BITCHAIN PRO X — RANDOM 5-CHAR REFERRAL CODE & RANK GATE SETUP
-- Run this script in your Supabase SQL Editor (https://app.supabase.com)
-- ============================================================================

-- 1. Helper function to generate unique 5-character uppercase alphanumeric referral code (e.g. X8K2M)
CREATE OR REPLACE FUNCTION public.generate_unique_5char_ref_code()
RETURNS TEXT AS $$
DECLARE
  v_chars TEXT := '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  v_code  TEXT := '';
  v_i     INT;
  v_exists BOOLEAN;
BEGIN
  LOOP
    v_code := '';
    FOR v_i IN 1..5 LOOP
      v_code := v_code || SUBSTRING(v_chars FROM FLOOR(RANDOM() * LENGTH(v_chars) + 1)::INT FOR 1);
    END FOR;

    SELECT EXISTS (
      SELECT 1 FROM public.profiles WHERE UPPER(referral_code) = v_code
    ) INTO v_exists;

    EXIT WHEN NOT v_exists;
  END LOOP;

  RETURN v_code;
END;
$$ LANGUAGE plpgsql VOLATILE;

-- 2. Trigger on profiles to automatically assign a 5-char code on insert or update if code is missing/invalid
CREATE OR REPLACE FUNCTION public.handle_profile_ref_code()
RETURNS trigger AS $$
BEGIN
  IF NEW.referral_code IS NULL OR TRIM(NEW.referral_code) = '' OR LENGTH(TRIM(NEW.referral_code)) != 5 THEN
    NEW.referral_code := public.generate_unique_5char_ref_code();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_profile_ref_code ON public.profiles;
CREATE TRIGGER trg_profile_ref_code
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_profile_ref_code();

-- 3. Update existing profiles in database so every user gets a unique 5-character referral code
DO $$
DECLARE
  v_rec RECORD;
BEGIN
  FOR v_rec IN 
    SELECT id FROM public.profiles 
     WHERE referral_code IS NULL OR LENGTH(TRIM(referral_code)) != 5
  LOOP
    UPDATE public.profiles 
       SET referral_code = public.generate_unique_5char_ref_code()
     WHERE id = v_rec.id;
  END LOOP;
END;
$$;

SELECT '✅ 5-Character Referral Code Generator & Trigger Installed Successfully!' AS result;
