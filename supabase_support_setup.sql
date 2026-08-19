-- ============================================================================
-- BITCHAIN PRO X — 24/7 CUSTOMER SUPPORT & REAL-TIME CHAT SETUP (WITH IMAGE ATTACHMENTS)
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
  attachment_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add column if table already exists
ALTER TABLE public.support_conversations ADD COLUMN IF NOT EXISTS attachment_url TEXT;

-- Enable RLS on conversations
ALTER TABLE public.support_conversations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own conversations" ON public.support_conversations;
DROP POLICY IF EXISTS "Users can insert own conversations" ON public.support_conversations;
DROP POLICY IF EXISTS "Users can update own conversations" ON public.support_conversations;
DROP POLICY IF EXISTS "Admins can view all conversations" ON public.support_conversations;
DROP POLICY IF EXISTS "Admins can update conversations" ON public.support_conversations;

CREATE POLICY "Users can view own conversations"
  ON public.support_conversations FOR SELECT
  USING (
    auth.uid() = user_id
    OR (auth.jwt() ->> 'email') = 'bitchain3@gmail.com'
    OR EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND (role = 'admin' OR email = 'bitchain3@gmail.com')
    )
  );

CREATE POLICY "Users can insert own conversations"
  ON public.support_conversations FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own conversations"
  ON public.support_conversations FOR UPDATE
  USING (
    auth.uid() = user_id
    OR (auth.jwt() ->> 'email') = 'bitchain3@gmail.com'
    OR EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND (role = 'admin' OR email = 'bitchain3@gmail.com')
    )
  );

-- 2. Create support_messages table with image_url
CREATE TABLE IF NOT EXISTS public.support_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES public.support_conversations(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  sender_role TEXT NOT NULL DEFAULT 'user',
  message TEXT NOT NULL,
  image_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add column if table already exists
ALTER TABLE public.support_messages ADD COLUMN IF NOT EXISTS image_url TEXT;

-- Enable RLS on messages
ALTER TABLE public.support_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view messages in own conversations" ON public.support_messages;
DROP POLICY IF EXISTS "Users can insert messages in own conversations" ON public.support_messages;
DROP POLICY IF EXISTS "Admins can view all messages" ON public.support_messages;
DROP POLICY IF EXISTS "Admins can insert messages" ON public.support_messages;

CREATE POLICY "Users and admins can view messages"
  ON public.support_messages FOR SELECT
  USING (
    sender_id = auth.uid()
    OR (auth.jwt() ->> 'email') = 'bitchain3@gmail.com'
    OR EXISTS (
      SELECT 1 FROM public.support_conversations
      WHERE id = conversation_id AND user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND (role = 'admin' OR email = 'bitchain3@gmail.com')
    )
  );

CREATE POLICY "Users and admins can insert messages"
  ON public.support_messages FOR INSERT
  WITH CHECK (
    sender_id = auth.uid()
    OR (auth.jwt() ->> 'email') = 'bitchain3@gmail.com'
    OR EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND (role = 'admin' OR email = 'bitchain3@gmail.com')
    )
  );

-- 3. Indexes for fast chat loading
CREATE INDEX IF NOT EXISTS idx_support_conv_user ON public.support_conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_support_conv_status ON public.support_conversations(status);
CREATE INDEX IF NOT EXISTS idx_support_conv_updated ON public.support_conversations(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_support_msg_conv ON public.support_messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_support_msg_created ON public.support_messages(created_at ASC);

-- 4. Enable Supabase Realtime for instant two-way chat updates
ALTER PUBLICATION supabase_realtime ADD TABLE public.support_conversations;
ALTER PUBLICATION supabase_realtime ADD TABLE public.support_messages;

SELECT 'Support chat setup with image attachments configured successfully!' AS status;
