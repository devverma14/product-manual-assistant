-- ====================================================================
-- Product Manual Assistant — Phase 7 Secure Database Schema
-- Run this script in your Supabase SQL Editor (https://app.supabase.com)
-- ====================================================================

-- 1. Profiles Table (Linked to Supabase Auth)
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT UNIQUE NOT NULL,
    full_name TEXT,
    avatar_url TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Trigger to auto-create profile on new user signup (Secured with SET search_path = '')
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    INSERT INTO public.profiles (id, email, full_name, avatar_url)
    VALUES (
        NEW.id,
        NEW.email,
        COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', pg_catalog.split_part(NEW.email, '@', 1)),
        COALESCE(NEW.raw_user_meta_data->>'avatar_url', NEW.raw_user_meta_data->>'picture', '')
    )
    ON CONFLICT (id) DO UPDATE SET
        email = EXCLUDED.email,
        full_name = COALESCE(EXCLUDED.full_name, public.profiles.full_name),
        avatar_url = COALESCE(EXCLUDED.avatar_url, public.profiles.avatar_url),
        updated_at = pg_catalog.now();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();


-- 2. Documents Table (Multi-document support per user)
CREATE TABLE IF NOT EXISTS public.documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    file_path TEXT,
    file_size INT DEFAULT 0,
    pages INT DEFAULT 0,
    words INT DEFAULT 0,
    chunks_count INT DEFAULT 0,
    status TEXT DEFAULT 'indexed',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_documents_user_id ON public.documents(user_id);


-- 3. Document Chunks Table (Persistent chunk storage)
CREATE TABLE IF NOT EXISTS public.document_chunks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
    chunk_index INT NOT NULL,
    page INT NOT NULL,
    text TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chunks_document_id ON public.document_chunks(document_id);


-- 4. Conversations Table (Persistent multi-turn chat history)
CREATE TABLE IF NOT EXISTS public.conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    document_id UUID REFERENCES public.documents(id) ON DELETE CASCADE, -- Kept for backward compatibility
    title TEXT NOT NULL DEFAULT 'New Conversation',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conversations_user_id ON public.conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_conversations_document_id ON public.conversations(document_id);


-- 5. Conversation Documents Join Table (Multi-document support per conversation)
CREATE TABLE IF NOT EXISTS public.conversation_documents (
    conversation_id UUID REFERENCES public.conversations(id) ON DELETE CASCADE,
    document_id UUID REFERENCES public.documents(id) ON DELETE CASCADE,
    PRIMARY KEY (conversation_id, document_id)
);

CREATE INDEX IF NOT EXISTS idx_conv_docs_conversation ON public.conversation_documents(conversation_id);
CREATE INDEX IF NOT EXISTS idx_conv_docs_document ON public.conversation_documents(document_id);


-- 6. Chat Messages Table
CREATE TABLE IF NOT EXISTS public.chat_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
    sender TEXT NOT NULL CHECK (sender IN ('user', 'assistant')),
    content TEXT NOT NULL,
    mode TEXT DEFAULT 'llm',
    sources_json JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_conversation ON public.chat_messages(conversation_id);


-- 7. Collections Table
CREATE TABLE IF NOT EXISTS public.collections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_collections_user_id ON public.collections(user_id);


-- 8. Document Collections Join Table
CREATE TABLE IF NOT EXISTS public.document_collections (
    document_id UUID REFERENCES public.documents(id) ON DELETE CASCADE,
    collection_id UUID REFERENCES public.collections(id) ON DELETE CASCADE,
    PRIMARY KEY (document_id, collection_id)
);

CREATE INDEX IF NOT EXISTS idx_doc_cols_document ON public.document_collections(document_id);
CREATE INDEX IF NOT EXISTS idx_doc_cols_collection ON public.document_collections(collection_id);


-- ====================================================================
-- Enable Row Level Security (RLS)
-- ====================================================================

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.collections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_collections ENABLE ROW LEVEL SECURITY;


-- ====================================================================
-- Re-runnable RLS Policies (Safe with DROP POLICY IF EXISTS & WITH CHECK)
-- ====================================================================

-- Profiles Policies
DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
CREATE POLICY "Users can view own profile" ON public.profiles
    FOR SELECT USING (auth.uid() = id);

DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile" ON public.profiles
    FOR UPDATE USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

-- Documents Policies
DROP POLICY IF EXISTS "Users can manage own documents" ON public.documents;
CREATE POLICY "Users can manage own documents" ON public.documents
    FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Document Chunks Policies
DROP POLICY IF EXISTS "Users can access chunks via document owner" ON public.document_chunks;
CREATE POLICY "Users can access chunks via document owner" ON public.document_chunks
    FOR ALL
    USING (
        EXISTS (SELECT 1 FROM public.documents WHERE id = document_chunks.document_id AND user_id = auth.uid())
    )
    WITH CHECK (
        EXISTS (SELECT 1 FROM public.documents WHERE id = document_chunks.document_id AND user_id = auth.uid())
    );

-- Conversations Policies
DROP POLICY IF EXISTS "Users can manage own conversations" ON public.conversations;
CREATE POLICY "Users can manage own conversations" ON public.conversations
    FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Conversation Documents Policies (Both conversation and document must belong to auth.uid())
DROP POLICY IF EXISTS "Users can manage own conversation documents" ON public.conversation_documents;
CREATE POLICY "Users can manage own conversation documents" ON public.conversation_documents
    FOR ALL
    USING (
        EXISTS (SELECT 1 FROM public.conversations WHERE id = conversation_documents.conversation_id AND user_id = auth.uid())
        AND
        EXISTS (SELECT 1 FROM public.documents WHERE id = conversation_documents.document_id AND user_id = auth.uid())
    )
    WITH CHECK (
        EXISTS (SELECT 1 FROM public.conversations WHERE id = conversation_documents.conversation_id AND user_id = auth.uid())
        AND
        EXISTS (SELECT 1 FROM public.documents WHERE id = conversation_documents.document_id AND user_id = auth.uid())
    );

-- Chat Messages Policies
DROP POLICY IF EXISTS "Users can access messages via conversation owner" ON public.chat_messages;
CREATE POLICY "Users can access messages via conversation owner" ON public.chat_messages
    FOR ALL
    USING (
        EXISTS (SELECT 1 FROM public.conversations WHERE id = chat_messages.conversation_id AND user_id = auth.uid())
    )
    WITH CHECK (
        EXISTS (SELECT 1 FROM public.conversations WHERE id = chat_messages.conversation_id AND user_id = auth.uid())
    );

-- Collections Policies
DROP POLICY IF EXISTS "Users can manage own collections" ON public.collections;
CREATE POLICY "Users can manage own collections" ON public.collections
    FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Document Collections Policies (Both document and collection must belong to auth.uid())
DROP POLICY IF EXISTS "Users can manage own document collections" ON public.document_collections;
CREATE POLICY "Users can manage own document collections" ON public.document_collections
    FOR ALL
    USING (
        EXISTS (SELECT 1 FROM public.documents WHERE id = document_collections.document_id AND user_id = auth.uid())
        AND
        EXISTS (SELECT 1 FROM public.collections WHERE id = document_collections.collection_id AND user_id = auth.uid())
    )
    WITH CHECK (
        EXISTS (SELECT 1 FROM public.documents WHERE id = document_collections.document_id AND user_id = auth.uid())
        AND
        EXISTS (SELECT 1 FROM public.collections WHERE id = document_collections.collection_id AND user_id = auth.uid())
    );
