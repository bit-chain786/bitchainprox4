-- ============================================================================
-- BITCHAIN PRO X — SUPABASE DATABASE SETUP & SCHEMA
-- Run this SQL in your Supabase SQL Editor (https://app.supabase.com)
-- ============================================================================

-- 1. Create 'profiles' table extending auth.users
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  full_name TEXT NOT NULL,
  username TEXT UNIQUE NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  sponsor_username TEXT,
  referral_code TEXT UNIQUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Enable Row Level Security (RLS)
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- 2. Create RLS Policies
-- Policy: Allow any authenticated or anonymous user to check if a username/sponsor exists (for referral checks)
CREATE POLICY "Public profiles reading"
  ON public.profiles
  FOR SELECT
  USING (true);

-- Policy: Allow users to insert their own profile during registration
CREATE POLICY "Users can insert own profile"
  ON public.profiles
  FOR INSERT
  WITH CHECK (auth.uid() = id OR auth.uid() IS NULL);

-- Policy: Allow users to update their own profile
CREATE POLICY "Users can update own profile"
  ON public.profiles
  FOR UPDATE
  USING (auth.uid() = id);

-- 3. Automatic Profile Creation Trigger (Optional but recommended)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, username, email, phone, sponsor_username, referral_code)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    COALESCE(NEW.raw_user_meta_data->>'username', split_part(NEW.email, '@', 1)),
    NEW.email,
    NEW.raw_user_meta_data->>'phone',
    NEW.raw_user_meta_data->>'sponsor_username',
    COALESCE(NEW.raw_user_meta_data->>'referral_code', UPPER(split_part(NEW.email, '@', 1)) || floor(random() * 1000)::text)
  )
  ON CONFLICT (id) DO UPDATE SET
    full_name = EXCLUDED.full_name,
    username = EXCLUDED.username,
    email = EXCLUDED.email,
    phone = EXCLUDED.phone,
    sponsor_username = EXCLUDED.sponsor_username,
    updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger binding to auth.users
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 4. Add Financial & Rank Columns to Profiles table (if not exists)
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS rank TEXT DEFAULT 'UNRANKED';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS rank_value INTEGER DEFAULT 0;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS package_name TEXT DEFAULT 'No Package';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS upline_id TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS available_balance NUMERIC(14,2) DEFAULT 0.00;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS total_income NUMERIC(14,2) DEFAULT 0.00;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS today_income NUMERIC(14,2) DEFAULT 0.00;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS total_team INTEGER DEFAULT 0;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS direct_income NUMERIC(14,2) DEFAULT 0.00;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS team_income NUMERIC(14,2) DEFAULT 0.00;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS non_working_income NUMERIC(14,2) DEFAULT 0.00;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS reward_income NUMERIC(14,2) DEFAULT 0.00;

-- 5. Create 'activities' Table for Real Recent Activity Logging
CREATE TABLE IF NOT EXISTS public.activities (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  title TEXT NOT NULL,
  details TEXT,
  amount NUMERIC(14,2) DEFAULT 0.00,
  category TEXT NOT NULL, -- 'direct', 'team', 'non_working', 'reward'
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.activities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own activities"
  ON public.activities
  FOR SELECT
  USING (auth.uid() = user_id);

-- Setup completed notification
SELECT 'BITCHAIN PRO X Supabase database setup complete!' AS status;
