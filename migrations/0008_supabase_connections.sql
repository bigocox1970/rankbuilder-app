-- Migration: Supabase OAuth connections
-- Each row represents a user's connected Supabase account.
-- Tokens are encrypted at rest using CF_OAUTH_ENCRYPTION_KEY.
-- project_* fields are null until the user selects a project after OAuth.

CREATE TABLE IF NOT EXISTS supabase_connections (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- OAuth tokens (encrypted via AES-GCM, CF_OAUTH_ENCRYPTION_KEY)
    encrypted_access_token TEXT NOT NULL,
    encrypted_refresh_token TEXT,
    token_expires_at INTEGER,

    -- Linked Supabase project (set after user picks a project)
    project_ref TEXT,
    project_name TEXT,
    project_url TEXT,
    anon_key TEXT,
    encrypted_service_role_key TEXT,

    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_supabase_connections_user_id
    ON supabase_connections(user_id);
