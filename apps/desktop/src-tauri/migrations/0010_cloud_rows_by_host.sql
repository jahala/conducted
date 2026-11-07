-- Conducted database, version 10.
--
-- Every row that belongs to a cloud workspace is kept in this database as a local copy, marked
-- with the host of the workspace it belongs to (CLOUD-13, services-map 1.2 and 2.6.2). A query
-- for local data then never returns it, and a cloud host's rows can be removed together.
--
-- Our design choice: Conductor keeps these rows in a second database, cache.db, picked by the
-- host (D103). We keep one database (D038), so each cloud-owned row carries the same three host
-- columns as its workspace instead. host_kind is 'local' or 'cloud'; host_url and host_vm_id are
-- null for local and both set for cloud. Rows stored before this migration belonged to local
-- workspaces, so they are local. The row codecs refuse any other mix instead of reading it as
-- local (workspaces.ts, host-rows.ts).
--
-- The lifetime of each table is unchanged; its own CREATE TABLE comment states it. The copies in
-- this database follow their workspace: they are removed with it, or together with their cloud
-- host (workspaces.ts deleteByHost).

ALTER TABLE sessions ADD COLUMN host_url TEXT;
ALTER TABLE sessions ADD COLUMN host_vm_id TEXT;
ALTER TABLE sessions ADD COLUMN host_kind TEXT NOT NULL DEFAULT 'local'
  CHECK ((host_kind = 'local' AND host_url IS NULL AND host_vm_id IS NULL)
      OR (host_kind = 'cloud' AND host_url IS NOT NULL AND host_url <> ''
          AND host_vm_id IS NOT NULL AND host_vm_id <> ''));
CREATE INDEX sessions_by_host ON sessions (host_kind, host_url, host_vm_id);

ALTER TABLE session_events ADD COLUMN host_url TEXT;
ALTER TABLE session_events ADD COLUMN host_vm_id TEXT;
ALTER TABLE session_events ADD COLUMN host_kind TEXT NOT NULL DEFAULT 'local'
  CHECK ((host_kind = 'local' AND host_url IS NULL AND host_vm_id IS NULL)
      OR (host_kind = 'cloud' AND host_url IS NOT NULL AND host_url <> ''
          AND host_vm_id IS NOT NULL AND host_vm_id <> ''));
CREATE INDEX session_events_by_host ON session_events (host_kind, host_url, host_vm_id);

ALTER TABLE session_live_state ADD COLUMN host_url TEXT;
ALTER TABLE session_live_state ADD COLUMN host_vm_id TEXT;
ALTER TABLE session_live_state ADD COLUMN host_kind TEXT NOT NULL DEFAULT 'local'
  CHECK ((host_kind = 'local' AND host_url IS NULL AND host_vm_id IS NULL)
      OR (host_kind = 'cloud' AND host_url IS NOT NULL AND host_url <> ''
          AND host_vm_id IS NOT NULL AND host_vm_id <> ''));
CREATE INDEX session_live_state_by_host
  ON session_live_state (host_kind, host_url, host_vm_id);

ALTER TABLE diff_comments ADD COLUMN host_url TEXT;
ALTER TABLE diff_comments ADD COLUMN host_vm_id TEXT;
ALTER TABLE diff_comments ADD COLUMN host_kind TEXT NOT NULL DEFAULT 'local'
  CHECK ((host_kind = 'local' AND host_url IS NULL AND host_vm_id IS NULL)
      OR (host_kind = 'cloud' AND host_url IS NOT NULL AND host_url <> ''
          AND host_vm_id IS NOT NULL AND host_vm_id <> ''));
CREATE INDEX diff_comments_by_host ON diff_comments (host_kind, host_url, host_vm_id);

ALTER TABLE terminals ADD COLUMN host_url TEXT;
ALTER TABLE terminals ADD COLUMN host_vm_id TEXT;
ALTER TABLE terminals ADD COLUMN host_kind TEXT NOT NULL DEFAULT 'local'
  CHECK ((host_kind = 'local' AND host_url IS NULL AND host_vm_id IS NULL)
      OR (host_kind = 'cloud' AND host_url IS NOT NULL AND host_url <> ''
          AND host_vm_id IS NOT NULL AND host_vm_id <> ''));
CREATE INDEX terminals_by_host ON terminals (host_kind, host_url, host_vm_id);
