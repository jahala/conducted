-- Conducted database, version 4.
--
-- 1. diff_comments: a review comment's state (REV-12), comments on the pull request itself with no
--    file (REV-13, location 'pull_request' with an empty file_path, as Conductor stores them), and
--    the GitHub author's avatar.
-- 2. attachments: rebuilt to add the kinds 'pdf' and 'review', and comment_id, the review comment
--    an attachment carried (REV-12). SQLite cannot change a CHECK in place, and nothing references
--    this table, so it is rebuilt with its rows.
-- 3. terminals: rebuilt so a terminal can belong to a repository instead of a workspace (RUN-06),
--    with the command typed at start and the saved screen state (PLAT-08). Nothing references
--    this table either.
-- 4. workspaces: the chat tab open last (NAV-02) and the number of files copied during setup
--    (WS-03).
-- 5. New tables: backlog workspaces (WS-11), prompt snippets (COMP-09) and provider keys (SET-09,
--    SET-10).

ALTER TABLE diff_comments ADD COLUMN state TEXT NOT NULL DEFAULT 'pending'
  CHECK (state IN ('draft','pending','ready_for_review','reviewed','hidden','superseded'));
ALTER TABLE diff_comments ADD COLUMN location TEXT NOT NULL DEFAULT 'file'
  CHECK (location IN ('file','pull_request'));
ALTER TABLE diff_comments ADD COLUMN author_avatar_url TEXT;

ALTER TABLE attachments RENAME TO attachments_before_0004;

-- Files attached to messages or drafts. The file itself lives under the app data folder. Rebuilt
-- in 0004 with the pdf and review kinds and the link to a review comment.
-- Lifetime: draft attachments older than 7 days are removed with their files.
CREATE TABLE attachments (
  id             TEXT PRIMARY KEY,
  session_id     TEXT REFERENCES sessions(id) ON DELETE CASCADE,
  message_id     TEXT,
  kind           TEXT NOT NULL CHECK (kind IN ('file','image','pdf','text','review')),
  original_name  TEXT NOT NULL,
  path           TEXT NOT NULL,
  is_draft       INTEGER NOT NULL DEFAULT 1,
  comment_id     TEXT REFERENCES diff_comments(id) ON DELETE SET NULL,
  created_at     INTEGER NOT NULL
);
INSERT INTO attachments (id, session_id, message_id, kind, original_name, path, is_draft, created_at)
  SELECT id, session_id, message_id, kind, original_name, path, is_draft, created_at
  FROM attachments_before_0004;
DROP TABLE attachments_before_0004;
CREATE INDEX idx_attachments_session ON attachments(session_id, is_draft);
CREATE INDEX idx_attachments_comment ON attachments(comment_id);

ALTER TABLE terminals RENAME TO terminals_before_0004;

-- Terminal tabs and script runs of a workspace, and the one terminal of each repository.
-- Scrollback lives in files written by the Rust shell. Rebuilt in 0004 for repository terminals.
-- Lifetime: ended terminals older than 14 days are removed with their scrollback files.
CREATE TABLE terminals (
  id             TEXT PRIMARY KEY,
  workspace_id   TEXT REFERENCES workspaces(id) ON DELETE CASCADE,
  repo_id        TEXT REFERENCES repos(id) ON DELETE CASCADE,
  kind           TEXT NOT NULL CHECK (kind IN ('terminal','setup','run','spotlight')),
  title          TEXT NOT NULL,
  cwd            TEXT NOT NULL,
  cols           INTEGER NOT NULL,
  rows           INTEGER NOT NULL,
  start_command  TEXT,                      -- typed into the shell when it starts
  screen_state   TEXT,                      -- JSON: the PTY's screen snapshot modes, for a restore
  started_at     INTEGER NOT NULL,
  ended_at       INTEGER,
  exit_code      INTEGER,
  CHECK ((workspace_id IS NULL) <> (repo_id IS NULL))
);
INSERT INTO terminals (id, workspace_id, kind, title, cwd, cols, rows, started_at, ended_at, exit_code)
  SELECT id, workspace_id, kind, title, cwd, cols, rows, started_at, ended_at, exit_code
  FROM terminals_before_0004;
DROP TABLE terminals_before_0004;
CREATE INDEX idx_terminals_workspace ON terminals(workspace_id, ended_at);
CREATE INDEX idx_terminals_repo ON terminals(repo_id, ended_at);

ALTER TABLE workspaces ADD COLUMN active_session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL;
ALTER TABLE workspaces ADD COLUMN files_copied INTEGER;

-- A workspace saved to the backlog: the prompt and settings to start it later, with no worktree,
-- branch or port yet. Starting it creates the workspace row with the same id and removes this one.
-- Lifetime: until the user starts or deletes it; removed with its repository.
CREATE TABLE backlog_workspaces (
  id                TEXT PRIMARY KEY,
  repo_id           TEXT NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  display_name      TEXT,
  prompt            TEXT NOT NULL,
  attachment_paths  TEXT NOT NULL DEFAULT '[]',   -- JSON array of staged attachment files
  config            TEXT NOT NULL,                -- JSON SessionConfig for the first chat
  section_id        TEXT REFERENCES sections(id) ON DELETE SET NULL,
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL
);
CREATE INDEX idx_backlog_workspaces_repo ON backlog_workspaces(repo_id, created_at);

-- Prompt snippets, private to this Mac (D025). Lifetime: until the user deletes the snippet.
CREATE TABLE snippets (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  keyword     TEXT UNIQUE,                  -- typed after the snippet trigger; null: picker only
  prompt      TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

-- Provider keys the user gave an agent on the Agents page (D033). The values are stored in the
-- macOS Keychain; this table holds only where each key goes. acp_agent is '' for agents that are
-- not ACP agents. source 'this_mac' means the key is read from the Mac's environment, so no
-- Keychain entry exists.
-- Lifetime: until the user removes the key, which also removes its Keychain entry.
CREATE TABLE provider_keys (
  agent         TEXT NOT NULL CHECK (agent IN ('claude','codex','cursor','acp')),
  acp_agent     TEXT NOT NULL DEFAULT '',
  provider      TEXT NOT NULL,              -- for example 'anthropic', 'bedrock' or an OpenCode provider
  env_var       TEXT NOT NULL,              -- the variable the agent reads, e.g. ANTHROPIC_API_KEY
  source        TEXT NOT NULL CHECK (source IN ('entered','this_mac')),
  keychain_ref  TEXT,                       -- null when source is 'this_mac'
  updated_at    INTEGER NOT NULL,
  PRIMARY KEY (agent, acp_agent, provider, env_var),
  CHECK ((source = 'entered') = (keychain_ref IS NOT NULL))
);
