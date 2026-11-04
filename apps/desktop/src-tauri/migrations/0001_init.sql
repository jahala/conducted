-- Conducted database, version 1.
-- Applied by tauri-plugin-sql at startup (see src/db.rs). Never edit an applied migration:
-- every change is a new numbered file.
--
-- Research: docs/research/conductor/structure-map.md section 4 (Conductor's 25 tables).
-- Our design choices: one event log per chat (no second message table), the follow-up queue as
-- its own table, secrets kept in the macOS Keychain (only references here), and a stated
-- lifetime for every table that grows. Pruning runs in the UI's data-lifetime job (DATA-02).
--
-- Conventions: ids are UUID text; times are integer milliseconds since the epoch; JSON columns
-- hold data validated by the schemas in packages/protocol.

PRAGMA foreign_keys = ON;

-- A git repository the user added. Lifetime: until the user removes it.
CREATE TABLE repos (
  id               TEXT PRIMARY KEY,
  name             TEXT NOT NULL,
  root_path        TEXT NOT NULL UNIQUE,      -- the main clone; agents never write here
  remote_url       TEXT,
  default_branch   TEXT NOT NULL,             -- e.g. "main"
  icon             TEXT,                      -- emoji or path to an uploaded image
  display_order    INTEGER NOT NULL DEFAULT 0,
  hidden           INTEGER NOT NULL DEFAULT 0,
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL
);

-- One git worktree with its own branch. Lifetime: archived rows are kept (they are small)
-- until the user deletes them; their worktree folder is removed on archive.
CREATE TABLE workspaces (
  id                 TEXT PRIMARY KEY,
  repo_id            TEXT NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  directory_name     TEXT NOT NULL,           -- a generated place name, unique per repo
  path               TEXT NOT NULL UNIQUE,
  branch             TEXT NOT NULL,
  branch_is_placeholder INTEGER NOT NULL DEFAULT 1,
  display_name       TEXT,                    -- set by the user; otherwise PR title or branch
  target_branch      TEXT NOT NULL,           -- e.g. "origin/main"
  state              TEXT NOT NULL CHECK (state IN ('initializing','ready','failed','archiving','archived')),
  kanban_status      TEXT NOT NULL DEFAULT 'in_progress'
                     CHECK (kanban_status IN ('backlog','in_progress','in_review','done','canceled')),
  port               INTEGER NOT NULL,        -- exported as CONDUCTED_PORT
  pinned_at          INTEGER,
  notes              TEXT,
  linked_paths       TEXT NOT NULL DEFAULT '[]',  -- JSON array of extra folders for agents
  pr_number          INTEGER,
  pr_title           TEXT,
  pr_description     TEXT,
  archive_commit     TEXT,                    -- HEAD saved under refs/conducted/archive/<id>
  setup_log_path     TEXT,
  last_activity_at   INTEGER NOT NULL,
  created_at         INTEGER NOT NULL,
  updated_at         INTEGER NOT NULL,
  UNIQUE (repo_id, directory_name)
);
CREATE INDEX idx_workspaces_repo ON workspaces(repo_id, state);

-- One chat. Lifetime: deleted with its workspace, or by the user.
CREATE TABLE sessions (
  id                    TEXT PRIMARY KEY,
  workspace_id          TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  title                 TEXT,
  config                TEXT NOT NULL,        -- JSON SessionConfig
  agent_session_id      TEXT,                 -- the agent's own id, used for resume
  unread_count          INTEGER NOT NULL DEFAULT 0,
  context_used_tokens   INTEGER,
  context_window_tokens INTEGER,
  queue_paused_at       INTEGER,
  closed_at             INTEGER,              -- tab closed; still in chat history
  last_user_message_at  INTEGER,
  created_at            INTEGER NOT NULL,
  updated_at            INTEGER NOT NULL
);
CREATE INDEX idx_sessions_workspace ON sessions(workspace_id, closed_at);

-- The chat's durable event log (packages/protocol events.ts). Append-only, idempotent on
-- event_id. Lifetime: tool outputs larger than the retention limit are cut after 30 days, and
-- events of archived workspaces are compacted after 90 days (DATA-02). Both limits are settings.
CREATE TABLE session_events (
  session_id   TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  idx          INTEGER NOT NULL,              -- position in the chat, from 0
  event_id     TEXT NOT NULL,
  type         TEXT NOT NULL CHECK (type IN ('user_message','agent','checkpoint','turn_ended')),
  turn_id      TEXT NOT NULL,
  content      TEXT NOT NULL,                 -- JSON SessionEvent
  received_at  INTEGER NOT NULL,
  reverted_at  INTEGER,                       -- set when the user reverts to an earlier turn
  PRIMARY KEY (session_id, idx),
  UNIQUE (session_id, event_id)
);
CREATE INDEX idx_session_events_turn ON session_events(session_id, turn_id);

-- Last known live state per chat, so a restart can show it before the sidecar answers.
-- Lifetime: one row per session.
CREATE TABLE session_live_state (
  session_id  TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
  live_state  TEXT NOT NULL,                  -- JSON LiveState
  updated_at  INTEGER NOT NULL
);

-- Follow-up messages typed while the agent works. Lifetime: sent and cancelled rows are
-- removed once their user_message event is stored.
CREATE TABLE queued_messages (
  id                TEXT PRIMARY KEY,
  session_id        TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  text              TEXT NOT NULL,
  attachment_paths  TEXT NOT NULL DEFAULT '[]',
  delivery          TEXT NOT NULL CHECK (delivery IN ('queue','steer')),
  position          INTEGER NOT NULL,
  state             TEXT NOT NULL CHECK (state IN ('waiting','sending','failed')),
  last_error        TEXT,
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL
);
CREATE INDEX idx_queued_messages_session ON queued_messages(session_id, position);

-- Review comments on the workspace diff, from the user, an agent, or GitHub.
-- Lifetime: deleted with the workspace.
CREATE TABLE diff_comments (
  id               TEXT PRIMARY KEY,
  workspace_id     TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  file_path        TEXT NOT NULL,
  line             INTEGER,                   -- null: a comment on the whole file
  end_line         INTEGER,
  body             TEXT NOT NULL,
  author_kind      TEXT NOT NULL CHECK (author_kind IN ('user','agent','github')),
  author_name      TEXT,
  thread_id        TEXT,
  reply_to_id      TEXT,
  suggestion       TEXT,                      -- suggested replacement code
  remote_url       TEXT,                      -- GitHub comment URL when synced
  resolved         INTEGER NOT NULL DEFAULT 0,
  outdated         INTEGER NOT NULL DEFAULT 0,
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL
);
CREATE INDEX idx_diff_comments_workspace ON diff_comments(workspace_id, file_path);

-- Files attached to messages or drafts. The file itself lives under the app data folder.
-- Lifetime: draft attachments older than 7 days are removed with their files.
CREATE TABLE attachments (
  id             TEXT PRIMARY KEY,
  session_id     TEXT REFERENCES sessions(id) ON DELETE CASCADE,
  message_id     TEXT,
  kind           TEXT NOT NULL CHECK (kind IN ('file','image','text')),
  original_name  TEXT NOT NULL,
  path           TEXT NOT NULL,
  is_draft       INTEGER NOT NULL DEFAULT 1,
  created_at     INTEGER NOT NULL
);

-- Terminal tabs and script runs. Scrollback lives in files written by the Rust shell.
-- Lifetime: ended terminals older than 14 days are removed with their scrollback files.
CREATE TABLE terminals (
  id            TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL CHECK (kind IN ('terminal','setup','run','spotlight')),
  title         TEXT NOT NULL,
  cwd           TEXT NOT NULL,
  cols          INTEGER NOT NULL,
  rows          INTEGER NOT NULL,
  started_at    INTEGER NOT NULL,
  ended_at      INTEGER,
  exit_code     INTEGER
);

-- Sidebar sections. Lifetime: until the user deletes them.
CREATE TABLE sections (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  emoji       TEXT,
  position    INTEGER NOT NULL,
  collapsed   INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
);

-- Which workspaces sit in which section. Lifetime: removed with the section or the workspace.
CREATE TABLE section_members (
  section_id    TEXT NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
  workspace_id  TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  position      INTEGER NOT NULL,
  PRIMARY KEY (section_id, workspace_id)
);

-- Saved model choices for the model picker. Lifetime: until removed.
CREATE TABLE favorite_models (
  id        TEXT PRIMARY KEY,
  config    TEXT NOT NULL,                    -- JSON: agent, acpAgent, model, effort, fastMode
  position  INTEGER NOT NULL
);

-- App settings, keyed by the settings registry (apps/desktop/src/core/registries/settings.ts).
-- Repo-scoped values use the key "repo:<repoId>:<key>". Lifetime: fixed set of keys.
CREATE TABLE settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,                  -- JSON
  updated_at  INTEGER NOT NULL
);

-- Environment variables passed to agents and scripts. Values are stored in the macOS
-- Keychain; this table holds only the names and where they apply. Lifetime: until the user
-- removes the variable, which also removes its Keychain entry (SET-04).
CREATE TABLE env_vars (
  name          TEXT NOT NULL,
  scope         TEXT NOT NULL CHECK (scope IN ('global','repo')),
  repo_id       TEXT REFERENCES repos(id) ON DELETE CASCADE,
  keychain_ref  TEXT NOT NULL,
  PRIMARY KEY (name, scope, repo_id)
);
