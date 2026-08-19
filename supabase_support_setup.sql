-- ============================================================================
-- BITCHAIN PRO X — 24/7 CUSTOMER SUPPORT & REAL-TIME CHAT SETUP
-- Run this script in the Supabase SQL Editor (https://app.supabase.com)
-- This fixes all "permission denied for table users" errors and sets up
-- the live customer support system with image attachments.
-- ============================================================================

-- 1. Create / Ensure support_conversations table exists
CREATE TABLE IF NOT EXISTS public.support_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  subject TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  unread_admin INTEGER DEFAULT 0,
  unread_user INTEGER DEFAULT 0,
  last_message TEXT,
  last_message_at TIMESTAMPTZ DEFAULT NOW(),
  attachment_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add any missing columns to support_conversations
ALTER TABLE public.support_conversations ADD COLUMN IF NOT EXISTS attachment_url TEXT;
ALTER TABLE public.support_conversations ADD COLUMN IF NOT EXISTS unread_admin INTEGER DEFAULT 0;
ALTER TABLE public.support_conversations ADD COLUMN IF NOT EXISTS unread_user INTEGER DEFAULT 0;
ALTER TABLE public.support_conversations ADD COLUMN IF NOT EXISTS last_message TEXT;
ALTER TABLE public.support_conversations ADD COLUMN IF NOT EXISTS last_message_at TIMESTAMPTZ DEFAULT NOW();

-- 2. Create / Ensure support_messages table exists
CREATE TABLE IF NOT EXISTS public.support_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES public.support_conversations(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL,
  sender_role TEXT NOT NULL DEFAULT 'user',
  message TEXT NOT NULL,
  image_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add any missing columns to support_messages
ALTER TABLE public.support_messages ADD COLUMN IF NOT EXISTS image_url TEXT;

-- 3. Enable RLS on both tables
ALTER TABLE public.support_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_messages ENABLE ROW LEVEL SECURITY;

-- 4. Clean up all old policies
DROP POLICY IF EXISTS "Users can view own conversations" ON public.support_conversations;
DROP POLICY IF EXISTS "Users can insert own conversations" ON public.support_conversations;
DROP POLICY IF EXISTS "Users can update own conversations" ON public.support_conversations;
DROP POLICY IF EXISTS "Admins can view all conversations" ON public.support_conversations;
DROP POLICY IF EXISTS "Admins can update conversations" ON public.support_conversations;
DROP POLICY IF EXISTS "Users and admins can select conversations" ON public.support_conversations;
DROP POLICY IF EXISTS "Users and admins can insert conversations" ON public.support_conversations;
DROP POLICY IF EXISTS "Users and admins can update conversations" ON public.support_conversations;

DROP POLICY IF EXISTS "Users can view messages in own conversations" ON public.support_messages;
DROP POLICY IF EXISTS "Users can insert messages in own conversations" ON public.support_messages;
DROP POLICY IF EXISTS "Admins can view all messages" ON public.support_messages;
DROP POLICY IF EXISTS "Admins can insert messages" ON public.support_messages;
DROP POLICY IF EXISTS "Users and admins can view messages" ON public.support_messages;
DROP POLICY IF EXISTS "Users and admins can insert messages" ON public.support_messages;
DROP POLICY IF EXISTS "Users and admins can select messages" ON public.support_messages;

-- 5. Create new clean policies (NO SUBQUERIES TO auth.users)
-- Support Conversations: SELECT
CREATE POLICY "Users and admins can select conversations"
  ON public.support_conversations FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    OR (auth.jwt() ->> 'email') = 'bitchain3@gmail.com'
    OR EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND (role = 'admin' OR email = 'bitchain3@gmail.com')
    )
  );

-- Support Conversations: INSERT
CREATE POLICY "Users and admins can insert conversations"
  ON public.support_conversations FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    OR (auth.jwt() ->> 'email') = 'bitchain3@gmail.com'
    OR EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND (role = 'admin' OR email = 'bitchain3@gmail.com')
    )
  );

-- Support Conversations: UPDATE
CREATE POLICY "Users and admins can update conversations"
  ON public.support_conversations FOR UPDATE
  TO authenticated
  USING (
    user_id = auth.uid()
    OR (auth.jwt() ->> 'email') = 'bitchain3@gmail.com'
    OR EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND (role = 'admin' OR email = 'bitchain3@gmail.com')
    )
  );

-- Support Messages: SELECT
CREATE POLICY "Users and admins can select messages"
  ON public.support_messages FOR SELECT
  TO authenticated
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

-- Support Messages: INSERT
CREATE POLICY "Users and admins can insert messages"
  ON public.support_messages FOR INSERT
  TO authenticated
  WITH CHECK (
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

-- 6. Grant direct table permissions to authenticated role
GRANT ALL ON public.support_conversations TO authenticated, anon, service_role;
GRANT ALL ON public.support_messages TO authenticated, anon, service_role;

-- 7. Atomic RPC Function to Start Support Ticket (SECURITY DEFINER)
-- Bypasses any table-level permission errors and guarantees 100% success
CREATE OR REPLACE FUNCTION public.start_support_ticket(
  p_subject TEXT,
  p_message TEXT,
  p_phone TEXT DEFAULT NULL,
  p_image_url TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_conv_id UUID;
  v_full_msg TEXT;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- 1. Create conversation
  INSERT INTO public.support_conversations (
    user_id,
    subject,
    status,
    unread_admin,
    unread_user,
    last_message,
    last_message_at,
    attachment_url,
    created_at,
    updated_at
  ) VALUES (
    v_user_id,
    p_subject,
    'open',
    1,
    0,
    p_message,
    NOW(),
    p_image_url,
    NOW(),
    NOW()
  ) RETURNING id INTO v_conv_id;

  -- 2. Construct message body
  v_full_msg := p_message;
  IF p_phone IS NOT NULL AND TRIM(p_phone) <> '' THEN
    v_full_msg := v_full_msg || E'\n\n📞 Contact: ' || p_phone;
  END IF;

  -- 3. Insert initial message
  INSERT INTO public.support_messages (
    conversation_id,
    sender_id,
    sender_role,
    message,
    image_url,
    created_at
  ) VALUES (
    v_conv_id,
    v_user_id,
    'user',
    v_full_msg,
    p_image_url,
    NOW()
  );

  RETURN jsonb_build_object(
    'success', true,
    'conversation_id', v_conv_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.start_support_ticket TO authenticated, anon;

-- 8. Performance Indexes
CREATE INDEX IF NOT EXISTS idx_support_conv_user ON public.support_conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_support_conv_status ON public.support_conversations(status);
CREATE INDEX IF NOT EXISTS idx_support_conv_updated ON public.support_conversations(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_support_msg_conv ON public.support_messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_support_msg_created ON public.support_messages(created_at ASC);

-- 9. Realtime Publication
ALTER PUBLICATION supabase_realtime ADD TABLE public.support_conversations;
ALTER PUBLICATION supabase_realtime ADD TABLE public.support_messages;

SELECT 'Support & Live Chat system configured successfully!' AS result;
