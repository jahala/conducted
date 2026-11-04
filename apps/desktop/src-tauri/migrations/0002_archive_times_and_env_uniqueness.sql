-- Conducted database, version 2.
--
-- 1. env_vars: SQLite treats NULL repo_id values as distinct in the primary key, so two global
--    variables with the same name were possible. One row per name, scope and repo is enforced here.
-- 2. workspaces.archived_at: when the workspace was archived. The 30-day pruning of turn snapshots
--    (DATA-06) and the 90-day chat compaction (DATA-02) count from this, not from updated_at.
-- 3. session_events.compacted_at: when the data-lifetime job cut this event's large tool output.

CREATE UNIQUE INDEX idx_env_vars_one_per_scope ON env_vars(name, scope, COALESCE(repo_id, ''));

ALTER TABLE workspaces ADD COLUMN archived_at INTEGER;

ALTER TABLE session_events ADD COLUMN compacted_at INTEGER;
