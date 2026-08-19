-- ============================================================================
-- BITCHAIN PRO X — 24/7 CUSTOMER SUPPORT & REAL-TIME CHAT SETUP
-- Run this script in the Supabase SQL Editor (https://app.supabase.com)
-- ============================================================================

-- 1. Create support_conversations table
CREATE TABLE IF NOT EXISTS public.support_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  subject TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  unread_admin INTEGER DEFAULT 0,
  unread_user INTEGER DEFAULT 0,
  last_message TEXT,
  last_message_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enable RLS on conversations
ALTER TABLE public.support_conversations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own conversations" ON public.support_conversations;
DROP POLICY IF EXISTS "Users can insert own conversations" ON public.support_conversations;
DROP POLICY IF EXISTS "Users can update own conversations" ON public.support_conversations;
DROP POLICY IF EXISTS "Admins can view all conversations" ON public.support_conversations;
DROP POLICY IF EXISTS "Admins can update conversations" ON public.support_conversations;

CREATE POLICY "Users can view own conversations"
  ON public.support_conversations FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own conversations"
  ON public.support_conversations FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own conversations"
  ON public.support_conversations FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Admins can view all conversations"
  ON public.support_conversations FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND (role = 'admin' OR email = 'bitchain3@gmail.com')
    )
    OR (SELECT email FROM auth.users WHERE id = auth.uid()) = 'bitchain3@gmail.com'
  );

CREATE POLICY "Admins can update conversations"
  ON public.support_conversations FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND (role = 'admin' OR email = 'bitchain3@gmail.com')
    )
    OR (SELECT email FROM auth.users WHERE id = auth.uid()) = 'bitchain3@gmail.com'
  );

-- 2. Create support_messages table
CREATE TABLE IF NOT EXISTS public.support_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES public.support_conversations(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  sender_role TEXT NOT NULL DEFAULT 'user',
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enable RLS on messages
ALTER TABLE public.support_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view messages in own conversations" ON public.support_messages;
DROP POLICY IF EXISTS "Users can insert messages in own conversations" ON public.support_messages;
DROP POLICY IF EXISTS "Admins can view all messages" ON public.support_messages;
DROP POLICY IF EXISTS "Admins can insert messages" ON public.support_messages;

CREATE POLICY "Users can view messages in own conversations"
  ON public.support_messages FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.support_conversations
      WHERE id = conversation_id AND user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert messages in own conversations"
  ON public.support_messages FOR INSERT
  WITH CHECK (
    sender_id = auth.uid() AND
    EXISTS (
      SELECT 1 FROM public.support_conversations
      WHERE id = conversation_id AND user_id = auth.uid()
    )
  );

CREATE POLICY "Admins can view all messages"
  ON public.support_messages FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND (role = 'admin' OR email = 'bitchain3@gmail.com')
    )
    OR (SELECT email FROM auth.users WHERE id = auth.uid()) = 'bitchain3@gmail.com'
  );

CREATE POLICY "Admins can insert messages"
  ON public.support_messages FOR INSERT
  WITH CHECK (
    sender_id = auth.uid() AND
    (
      EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = auth.uid() AND (role = 'admin' OR email = 'bitchain3@gmail.com')
      )
      OR (SELECT email FROM auth.users WHERE id = auth.uid()) = 'bitchain3@gmail.com'
    )
  );

-- Indexes for lightning-fast performance
CREATE INDEX IF NOT EXISTS idx_support_conv_user ON public.support_conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_support_msg_conv ON public.support_messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_support_msg_created ON public.support_messages(created_at);

SELECT 'Customer Support Chat tables and policies setup complete!' AS status;
