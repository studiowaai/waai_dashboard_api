-- Migration: Conversations & Messages
-- Description: Core inbox model — conversations with messages and AI suggestions
-- Date: 2026-03-15

BEGIN;

-- ══════════════════════════════════════════════════════════════
-- 1. Conversations
-- ══════════════════════════════════════════════════════════════
CREATE TABLE conversations (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id    UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    channel_id      UUID REFERENCES channels(id) ON DELETE SET NULL,
    contact_id      UUID REFERENCES contacts(id) ON DELETE SET NULL,
    assigned_to     UUID REFERENCES users(id) ON DELETE SET NULL,
    subject         TEXT,
    status          TEXT NOT NULL DEFAULT 'open',
    priority        TEXT NOT NULL DEFAULT 'normal',
    category        TEXT,                          -- AI-classified category
    external_id     TEXT,                          -- Gmail thread ID, etc.
    last_message_at TIMESTAMPTZ,
    snoozed_until   TIMESTAMPTZ,
    resolved_at     TIMESTAMPTZ,
    metadata        JSONB NOT NULL DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT conversations_status_check CHECK (
        status IN ('open', 'assigned', 'snoozed', 'resolved', 'closed')
    ),
    CONSTRAINT conversations_priority_check CHECK (
        priority IN ('urgent', 'high', 'normal', 'low')
    )
);

CREATE INDEX idx_conversations_workspace_status ON conversations(workspace_id, status);
CREATE INDEX idx_conversations_assigned ON conversations(assigned_to) WHERE assigned_to IS NOT NULL;
CREATE INDEX idx_conversations_channel ON conversations(channel_id);
CREATE INDEX idx_conversations_contact ON conversations(contact_id);
CREATE INDEX idx_conversations_external ON conversations(workspace_id, external_id) WHERE external_id IS NOT NULL;
CREATE INDEX idx_conversations_last_message ON conversations(workspace_id, last_message_at DESC);

-- ══════════════════════════════════════════════════════════════
-- 2. Messages
-- ══════════════════════════════════════════════════════════════
CREATE TABLE messages (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    sender_type     TEXT NOT NULL,              -- 'contact', 'agent', 'system', 'ai'
    sender_id       UUID,                       -- user.id for agents, contact.id for contacts
    direction       TEXT NOT NULL DEFAULT 'inbound',
    content_text    TEXT,                        -- plaintext body
    content_html    TEXT,                        -- rich HTML body
    external_id     TEXT,                        -- Gmail message ID, etc.
    metadata        JSONB NOT NULL DEFAULT '{}', -- headers, cc, bcc, etc.
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT messages_sender_type_check CHECK (
        sender_type IN ('contact', 'agent', 'system', 'ai')
    ),
    CONSTRAINT messages_direction_check CHECK (
        direction IN ('inbound', 'outbound')
    )
);

CREATE INDEX idx_messages_conversation ON messages(conversation_id, created_at);
CREATE INDEX idx_messages_external ON messages(external_id) WHERE external_id IS NOT NULL;

-- ══════════════════════════════════════════════════════════════
-- 3. Message attachments
-- ══════════════════════════════════════════════════════════════
CREATE TABLE message_attachments (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id      UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    filename        TEXT NOT NULL,
    mime_type       TEXT,
    size_bytes      INTEGER,
    storage_key     TEXT,                        -- S3/MinIO key
    external_url    TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_message_attachments_message ON message_attachments(message_id);

-- ══════════════════════════════════════════════════════════════
-- 4. AI suggestions (per conversation)
-- ══════════════════════════════════════════════════════════════
CREATE TABLE ai_suggestions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    type            TEXT NOT NULL,              -- 'reply', 'summary', 'classification'
    content         TEXT NOT NULL,              -- the AI-generated text
    confidence      REAL,                       -- 0.0 - 1.0
    model           TEXT,                       -- 'gpt-4o', 'claude-3.5', etc.
    accepted        BOOLEAN,                    -- true = agent used it
    accepted_by     UUID REFERENCES users(id),
    metadata        JSONB NOT NULL DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT ai_suggestions_type_check CHECK (
        type IN ('reply', 'summary', 'classification', 'sentiment')
    )
);

CREATE INDEX idx_ai_suggestions_conversation ON ai_suggestions(conversation_id);

-- ══════════════════════════════════════════════════════════════
-- 5. Conversation events (activity log)
-- ══════════════════════════════════════════════════════════════
CREATE TABLE conversation_events (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    actor_id        UUID REFERENCES users(id),
    event_type      TEXT NOT NULL,
    data            JSONB NOT NULL DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT conversation_events_type_check CHECK (
        event_type IN (
            'created', 'assigned', 'unassigned',
            'status_changed', 'priority_changed',
            'message_sent', 'message_received',
            'ai_suggestion', 'note_added',
            'snoozed', 'resolved', 'reopened'
        )
    )
);

CREATE INDEX idx_conversation_events_conversation ON conversation_events(conversation_id, created_at);

-- ══════════════════════════════════════════════════════════════
-- 6. Triggers
-- ══════════════════════════════════════════════════════════════
CREATE TRIGGER update_conversations_updated_at BEFORE UPDATE ON conversations
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Auto-update last_message_at on new message
CREATE OR REPLACE FUNCTION update_conversation_last_message()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE conversations
    SET last_message_at = NEW.created_at
    WHERE id = NEW.conversation_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_conversation_last_message
    AFTER INSERT ON messages
    FOR EACH ROW EXECUTE FUNCTION update_conversation_last_message();

COMMIT;
