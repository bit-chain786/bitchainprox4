-- ============================================================
-- BITCHAIN PRO X — ADMIN PANEL SQL SETUP
-- Run in Supabase SQL Editor
-- ============================================================

-- 1. Add role + status columns to profiles
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'user';
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active';
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS current_package TEXT DEFAULT NULL;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS current_rank TEXT DEFAULT 'Starter';
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS avatar_url TEXT DEFAULT NULL;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS available_balance NUMERIC(14,2) DEFAULT 0.00;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS total_income NUMERIC(14,2) DEFAULT 0.00;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS today_income NUMERIC(14,2) DEFAULT 0.00;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS direct_income NUMERIC(14,2) DEFAULT 0.00;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS team_income NUMERIC(14,2) DEFAULT 0.00;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS non_working_income NUMERIC(14,2) DEFAULT 0.00;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS reward_income NUMERIC(14,2) DEFAULT 0.00;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS total_team INTEGER DEFAULT 0;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS direct_referrals INTEGER DEFAULT 0;

-- 2. Package purchases table
CREATE TABLE IF NOT EXISTS package_purchases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  package_key TEXT NOT NULL,
  package_name TEXT NOT NULL,
  rank_name TEXT NOT NULL,
  amount NUMERIC(10,2) NOT NULL,
  status TEXT NOT NULL DEFAULT 'completed',
  purchased_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE package_purchases ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view own purchases" ON package_purchases;
DROP POLICY IF EXISTS "Users can insert own purchases" ON package_purchases;
DROP POLICY IF EXISTS "Admins can view all purchases" ON package_purchases;
CREATE POLICY "Users can view own purchases" ON package_purchases FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own purchases" ON package_purchases FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Admins can view all purchases" ON package_purchases FOR SELECT USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
);

-- 3. Deposits table
CREATE TABLE IF NOT EXISTS deposits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  amount NUMERIC(14,2) NOT NULL,
  payment_method TEXT NOT NULL DEFAULT 'USDT',
  transaction_id TEXT,
  proof_url TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  admin_notes TEXT,
  reviewed_by UUID REFERENCES auth.users(id),
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE deposits ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view own deposits" ON deposits;
DROP POLICY IF EXISTS "Users can insert own deposits" ON deposits;
DROP POLICY IF EXISTS "Admins can view all deposits" ON deposits;
DROP POLICY IF EXISTS "Admins can update deposits" ON deposits;
CREATE POLICY "Users can view own deposits" ON deposits FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own deposits" ON deposits FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Admins can view all deposits" ON deposits FOR SELECT USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
);
CREATE POLICY "Admins can update deposits" ON deposits FOR UPDATE USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
);

-- 4. Withdrawals table
CREATE TABLE IF NOT EXISTS withdrawals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  amount NUMERIC(14,2) NOT NULL,
  withdrawal_method TEXT NOT NULL DEFAULT 'USDT',
  destination TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  admin_notes TEXT,
  rejection_reason TEXT,
  reviewed_by UUID REFERENCES auth.users(id),
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE withdrawals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view own withdrawals" ON withdrawals;
DROP POLICY IF EXISTS "Users can insert own withdrawals" ON withdrawals;
DROP POLICY IF EXISTS "Admins can view all withdrawals" ON withdrawals;
DROP POLICY IF EXISTS "Admins can update withdrawals" ON withdrawals;
CREATE POLICY "Users can view own withdrawals" ON withdrawals FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own withdrawals" ON withdrawals FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Admins can view all withdrawals" ON withdrawals FOR SELECT USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
);
CREATE POLICY "Admins can update withdrawals" ON withdrawals FOR UPDATE USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
);

-- 5. Support conversations
CREATE TABLE IF NOT EXISTS support_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  subject TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  unread_admin INTEGER DEFAULT 0,
  unread_user INTEGER DEFAULT 0,
  last_message TEXT,
  last_message_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE support_conversations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view own conversations" ON support_conversations;
DROP POLICY IF EXISTS "Users can insert own conversations" ON support_conversations;
DROP POLICY IF EXISTS "Users can update own conversations" ON support_conversations;
DROP POLICY IF EXISTS "Admins can view all conversations" ON support_conversations;
DROP POLICY IF EXISTS "Admins can update conversations" ON support_conversations;
CREATE POLICY "Users can view own conversations" ON support_conversations FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own conversations" ON support_conversations FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own conversations" ON support_conversations FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Admins can view all conversations" ON support_conversations FOR SELECT USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
);
CREATE POLICY "Admins can update conversations" ON support_conversations FOR UPDATE USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
);

-- 6. Support messages
CREATE TABLE IF NOT EXISTS support_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES support_conversations(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  sender_role TEXT NOT NULL DEFAULT 'user',
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE support_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view messages in own conversations" ON support_messages;
DROP POLICY IF EXISTS "Users can insert messages in own conversations" ON support_messages;
DROP POLICY IF EXISTS "Admins can view all messages" ON support_messages;
DROP POLICY IF EXISTS "Admins can insert messages" ON support_messages;
CREATE POLICY "Users can view messages in own conversations" ON support_messages FOR SELECT USING (
  EXISTS (SELECT 1 FROM support_conversations WHERE id = conversation_id AND user_id = auth.uid())
);
CREATE POLICY "Users can insert messages in own conversations" ON support_messages FOR INSERT WITH CHECK (
  sender_id = auth.uid() AND
  EXISTS (SELECT 1 FROM support_conversations WHERE id = conversation_id AND user_id = auth.uid())
);
CREATE POLICY "Admins can view all messages" ON support_messages FOR SELECT USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
);
CREATE POLICY "Admins can insert messages" ON support_messages FOR INSERT WITH CHECK (
  sender_id = auth.uid() AND
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
);

-- 7. Audit logs
CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id UUID NOT NULL REFERENCES auth.users(id),
  action TEXT NOT NULL,
  target_user_id UUID REFERENCES auth.users(id),
  target_table TEXT,
  target_id UUID,
  details JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins can view audit logs" ON audit_logs;
DROP POLICY IF EXISTS "Admins can insert audit logs" ON audit_logs;
CREATE POLICY "Admins can view audit logs" ON audit_logs FOR SELECT USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
);
CREATE POLICY "Admins can insert audit logs" ON audit_logs FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
);

-- 8. Avatars storage bucket
INSERT INTO storage.buckets (id, name, public)
  VALUES ('avatars', 'avatars', TRUE)
  ON CONFLICT (id) DO UPDATE SET public = TRUE;

DROP POLICY IF EXISTS "Avatar upload" ON storage.objects;
DROP POLICY IF EXISTS "Avatar update" ON storage.objects;
DROP POLICY IF EXISTS "Avatar delete" ON storage.objects;
DROP POLICY IF EXISTS "Avatar public read" ON storage.objects;

CREATE POLICY "Avatar upload" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'avatars' AND auth.uid()::text = (string_to_array(name, '/'))[1]);
CREATE POLICY "Avatar update" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'avatars' AND auth.uid()::text = (string_to_array(name, '/'))[1]);
CREATE POLICY "Avatar delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'avatars' AND auth.uid()::text = (string_to_array(name, '/'))[1]);
CREATE POLICY "Avatar public read" ON storage.objects FOR SELECT TO public
  USING (bucket_id = 'avatars');

-- ============================================================
-- TO MAKE YOURSELF ADMIN — run this separately:
-- UPDATE profiles SET role = 'admin' WHERE email = 'your@email.com';
-- ============================================================

-- 9. System Settings Table
CREATE TABLE IF NOT EXISTS system_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  description TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE system_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public can read settings" ON system_settings;
DROP POLICY IF EXISTS "Admins can update settings" ON system_settings;
CREATE POLICY "Public can read settings" ON system_settings FOR SELECT USING (true);
CREATE POLICY "Admins can update settings" ON system_settings FOR ALL USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
);

-- Insert default settings
INSERT INTO system_settings (key, value, description) VALUES
  ('wallet_settings', '{"bep20_deposit_address": "TDsJx7GfR3mbX9jYkLBQwz6h1Kp8uN8z3c", "min_deposit": 10.00, "min_withdrawal": 10.00, "withdrawal_fee": 1.00}', 'Wallet configuration settings')
ON CONFLICT (key) DO NOTHING;

-- 10. Deposit Proofs storage bucket
INSERT INTO storage.buckets (id, name, public)
  VALUES ('deposit-proofs', 'deposit-proofs', TRUE)
  ON CONFLICT (id) DO UPDATE SET public = TRUE;

DROP POLICY IF EXISTS "Deposit proof upload" ON storage.objects;
DROP POLICY IF EXISTS "Deposit proof update" ON storage.objects;
DROP POLICY IF EXISTS "Deposit proof delete" ON storage.objects;
DROP POLICY IF EXISTS "Deposit proof public read" ON storage.objects;

CREATE POLICY "Deposit proof upload" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'deposit-proofs' AND auth.uid()::text = (string_to_array(name, '/'))[1]);
CREATE POLICY "Deposit proof update" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'deposit-proofs' AND auth.uid()::text = (string_to_array(name, '/'))[1]);
CREATE POLICY "Deposit proof delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'deposit-proofs' AND auth.uid()::text = (string_to_array(name, '/'))[1]);
CREATE POLICY "Deposit proof public read" ON storage.objects FOR SELECT TO public
  USING (bucket_id = 'deposit-proofs');
