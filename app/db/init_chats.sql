-- init_chats.sql — PostgreSQL + pgvector para historial y memoria
-- USER → CHAT → MESSAGE + MEMORY

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS vector;

-- USERS (para validar usuario)
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) UNIQUE,
    name VARCHAR(128),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- CHATS (chat_id)
CREATE TABLE IF NOT EXISTS chats (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    title VARCHAR(200) NOT NULL DEFAULT 'Nuevo chat',
    is_archived BOOLEAN DEFAULT FALSE,
    provider VARCHAR(32),
    model VARCHAR(128),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    meta JSONB
);
CREATE INDEX IF NOT EXISTS ix_chats_user_updated ON chats(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS ix_chats_archived ON chats(is_archived);

-- MESSAGES (message 001, 002...)
CREATE TABLE IF NOT EXISTS messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    chat_id UUID NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    role VARCHAR(16) NOT NULL CHECK (role IN ('user','assistant','system')),
    content TEXT NOT NULL,
    tokens INT,
    meta JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ix_messages_chat_created ON messages(chat_id, created_at ASC);

-- CHAT_MEMORIES (memory por CHAT)
CREATE TABLE IF NOT EXISTS chat_memories (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    chat_id UUID UNIQUE NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    summary TEXT,
    vector_ids JSONB,
    extra JSONB,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Función trigger para updated_at
CREATE OR REPLACE FUNCTION update_updated_at() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_chats_updated ON chats;
CREATE TRIGGER trg_chats_updated BEFORE UPDATE ON chats FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_messages_updated ON messages;
CREATE TRIGGER trg_messages_updated BEFORE UPDATE ON messages FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Datos de prueba (USER → CHAT 001,002,003)
INSERT INTO users (id, email, name) VALUES ('00000000-0000-0000-0000-000000000001', 'demo@local', 'Demo User') ON CONFLICT DO NOTHING;

INSERT INTO chats (id, user_id, title) VALUES
('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'CHAT 001'),
('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'CHAT 002'),
('10000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001', 'CHAT 003')
ON CONFLICT DO NOTHING;

INSERT INTO messages (chat_id, role, content) VALUES
('10000000-0000-0000-0000-000000000001', 'user', 'message 001 - CHAT 001'),
('10000000-0000-0000-0000-000000000001', 'assistant', 'message 002 - CHAT 001'),
('10000000-0000-0000-0000-000000000001', 'user', 'message 003 - CHAT 001'),
('10000000-0000-0000-0000-000000000002', 'user', 'message 001 - CHAT 002'),
('10000000-0000-0000-0000-000000000002', 'assistant', 'message 002 - CHAT 002')
ON CONFLICT DO NOTHING;

INSERT INTO chat_memories (chat_id, summary) VALUES
('10000000-0000-0000-0000-000000000001', 'memory CHAT 001'),
('10000000-0000-0000-0000-000000000002', 'memory CHAT 002'),
('10000000-0000-0000-0000-000000000003', 'memory CHAT 003')
ON CONFLICT DO NOTHING;
