-- ============================================================================
-- BITCHAIN PRO X — REAL-TIME DATABASE-BACKED OTP SYSTEM
-- Run this SQL in your Supabase SQL Editor (https://app.supabase.com)
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1. Create table for password reset OTPs
CREATE TABLE IF NOT EXISTS public.password_reset_otps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  otp_code TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  is_used BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for fast lookup by email and code
CREATE INDEX IF NOT EXISTS idx_password_reset_otps_email_code 
  ON public.password_reset_otps (LOWER(email), otp_code, is_used, expires_at);

-- Enable RLS
ALTER TABLE public.password_reset_otps ENABLE ROW LEVEL SECURITY;

-- Allow public to query / insert via RPC functions (RLS enabled)
DROP POLICY IF EXISTS "Public OTP Access via RPC" ON public.password_reset_otps;
CREATE POLICY "Public OTP Access via RPC" ON public.password_reset_otps
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- 2. RPC: Request & generate a new 6-digit OTP code
CREATE OR REPLACE FUNCTION public.request_password_reset_otp(p_email TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_clean_email TEXT;
  v_user_exists BOOLEAN := FALSE;
  v_otp TEXT;
  v_expires_at TIMESTAMPTZ;
BEGIN
  v_clean_email := LOWER(TRIM(p_email));

  IF v_clean_email IS NULL OR v_clean_email = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Email address is required.');
  END IF;

  -- Check if user exists in auth.users or profiles
  SELECT TRUE INTO v_user_exists
  FROM auth.users
  WHERE LOWER(email) = v_clean_email
  LIMIT 1;

  IF NOT COALESCE(v_user_exists, FALSE) THEN
    -- Check profiles table as fallback
    SELECT TRUE INTO v_user_exists
    FROM public.profiles
    WHERE LOWER(email) = v_clean_email
    LIMIT 1;
  END IF;

  IF NOT COALESCE(v_user_exists, FALSE) THEN
    RETURN jsonb_build_object('success', false, 'error', 'No account found with this email address.');
  END IF;

  -- Invalidate any existing unused OTPs for this email
  UPDATE public.password_reset_otps
  SET is_used = TRUE
  WHERE LOWER(email) = v_clean_email AND is_used = FALSE;

  -- Generate 6-digit numeric OTP code (e.g. 100000 to 999999)
  v_otp := LPAD(FLOOR(100000 + RANDOM() * 900000)::INT::TEXT, 6, '0');
  v_expires_at := NOW() + INTERVAL '10 minutes';

  -- Insert new OTP
  INSERT INTO public.password_reset_otps (email, otp_code, expires_at, is_used, created_at)
  VALUES (v_clean_email, v_otp, v_expires_at, FALSE, NOW());

  RETURN jsonb_build_object(
    'success', true,
    'email', v_clean_email,
    'otp_code', v_otp,
    'expires_in_seconds', 600,
    'message', 'OTP generated successfully.'
  );
END;
$$;

-- 3. RPC: Verify OTP code
CREATE OR REPLACE FUNCTION public.verify_password_reset_otp(p_email TEXT, p_otp TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_clean_email TEXT;
  v_clean_otp TEXT;
  v_record_id UUID;
BEGIN
  v_clean_email := LOWER(TRIM(p_email));
  v_clean_otp := TRIM(p_otp);

  SELECT id INTO v_record_id
  FROM public.password_reset_otps
  WHERE LOWER(email) = v_clean_email
    AND otp_code = v_clean_otp
    AND is_used = FALSE
    AND expires_at > NOW()
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_record_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid or expired OTP code.');
  END IF;

  RETURN jsonb_build_object('success', true, 'valid', true, 'message', 'OTP verified successfully.');
END;
$$;

-- 4. RPC: Verify OTP and reset password in auth.users
CREATE OR REPLACE FUNCTION public.verify_and_update_password(
  p_email TEXT,
  p_otp TEXT,
  p_new_password TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_clean_email TEXT;
  v_clean_otp TEXT;
  v_record_id UUID;
  v_auth_user_id UUID;
BEGIN
  v_clean_email := LOWER(TRIM(p_email));
  v_clean_otp := TRIM(p_otp);

  IF p_new_password IS NULL OR LENGTH(TRIM(p_new_password)) < 6 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Password must be at least 6 characters.');
  END IF;

  -- 1. Check OTP validity
  SELECT id INTO v_record_id
  FROM public.password_reset_otps
  WHERE LOWER(email) = v_clean_email
    AND otp_code = v_clean_otp
    AND is_used = FALSE
    AND expires_at > NOW()
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_record_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid or expired OTP code.');
  END IF;

  -- 2. Find User in auth.users
  SELECT id INTO v_auth_user_id
  FROM auth.users
  WHERE LOWER(email) = v_clean_email
  LIMIT 1;

  IF v_auth_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'User account not found.');
  END IF;

  -- 3. Mark OTP as used
  UPDATE public.password_reset_otps
  SET is_used = TRUE
  WHERE id = v_record_id;

  -- 4. Update encrypted password directly in auth.users
  UPDATE auth.users
  SET encrypted_password = crypt(p_new_password, gen_salt('bf')),
      updated_at = NOW()
  WHERE id = v_auth_user_id;

  -- 5. If mirror table public.users exists, update it as well
  BEGIN
    IF EXISTS (
      SELECT 1 FROM information_schema.tables 
      WHERE table_schema = 'public' AND table_name = 'users'
    ) THEN
      UPDATE public.users
      SET updated_at = NOW()
      WHERE id = v_auth_user_id OR LOWER(email) = v_clean_email;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    -- Ignore if public.users is not present
  END;

  RETURN jsonb_build_object('success', true, 'message', 'Password updated successfully! You can now sign in.');
END;
$$;

-- Grant execution permissions
GRANT EXECUTE ON FUNCTION public.request_password_reset_otp(TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.verify_password_reset_otp(TEXT, TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.verify_and_update_password(TEXT, TEXT, TEXT) TO anon, authenticated, service_role;
