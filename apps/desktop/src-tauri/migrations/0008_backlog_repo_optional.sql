-- Conducted database, version 8.
--
-- backlog_workspaces is rebuilt so a saved draft outlives its repository (WS-11): repo_id may be
-- null, and removing a repository sets it to null instead of deleting the draft. The user picks a
-- repository on the backlog row before starting it. SQLite cannot change a NOT NULL or a foreign
-- key in place, and nothing references this table, so it is rebuilt with its rows.

ALTER TABLE backlog_workspaces RENAME TO backlog_workspaces_before_0008;

-- A workspace saved to the backlog: the prompt and settings to start it later, with no worktree,
-- branch or port yet. Starting it creates the workspace row with the same id and removes this one.
-- Rebuilt in 0008 so a draft whose repository was removed stays, with no repository.
-- Lifetime: until the user starts or deletes it.
CREATE TABLE backlog_workspaces (
  id                TEXT PRIMARY KEY,
  repo_id           TEXT REFERENCES repos(id) ON DELETE SET NULL,  -- null: pick one before starting
  display_name      TEXT,
  prompt            TEXT NOT NULL,
  attachment_paths  TEXT NOT NULL DEFAULT '[]',   -- JSON array of staged attachment files
  config            TEXT NOT NULL,                -- JSON SessionConfig for the first chat
  section_id        TEXT REFERENCES sections(id) ON DELETE SET NULL,
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL
);
INSERT INTO backlog_workspaces (id, repo_id, display_name, prompt, attachment_paths, config,
    section_id, created_at, updated_at)
  SELECT id, repo_id, display_name, prompt, attachment_paths, config, section_id, created_at,
    updated_at
  FROM backlog_workspaces_before_0008;
DROP TABLE backlog_workspaces_before_0008;
CREATE INDEX idx_backlog_workspaces_repo ON backlog_workspaces(repo_id, created_at);
