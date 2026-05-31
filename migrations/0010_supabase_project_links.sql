-- Migration: per-app (per-agent) Supabase project links
-- The OAuth account/token stays per-user in supabase_connections; the SELECTED PROJECT
-- moves here, keyed by agent_id (the chat/DO id), so linking a DB to one app does NOT
-- show as linked on every other app.
-- NOTE: prod migration bookkeeping is broken at 0007 — this was applied via
-- `wrangler d1 execute --remote --file ...`, not `migrations apply`.

CREATE TABLE IF NOT EXISTS supabase_project_links (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    agent_id TEXT NOT NULL,

    project_ref TEXT NOT NULL,
    project_name TEXT,
    project_url TEXT,
    anon_key TEXT,
    encrypted_service_role_key TEXT,

    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_supabase_project_links_agent
    ON supabase_project_links(agent_id);
