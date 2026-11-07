-- Conducted database, version 14.
--
-- Port forwarding from a cloud workspace to the Mac (CLOUD-10, services-map 5A.3.3). A forward is
-- one remote port in a cloud workspace carried to one local port on this Mac. Rows are removed
-- when the workspace is archived (the sandbox sleeps), when it is deleted, and on startup for
-- workspaces that no longer exist. Lifetime: until the workspace is archived or deleted, or the
-- user removes the forward.
--
-- workspaces.port_forwarding_enabled is the workspace's forwarding switch, and
-- auto_forward_enabled says whether newly detected remote ports are forwarded automatically. Both
-- are off for a workspace that has never forwarded. They live on workspaces as Conductor keeps
-- them, because the switch belongs to the workspace, not to one forward.
--
-- local_port is unique across the whole machine: one Mac port can carry one forward at a time.
-- (workspace_id, remote_port) is unique because a workspace cannot forward one remote port twice.

ALTER TABLE workspaces ADD COLUMN port_forwarding_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE workspaces ADD COLUMN auto_forward_enabled INTEGER NOT NULL DEFAULT 0;

-- One remote port in a cloud workspace carried to one local port on this Mac.
-- Lifetime: until the workspace is archived or deleted, or the user removes the forward.
CREATE TABLE port_forwards (
  id            TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  remote_port   INTEGER NOT NULL,
  local_port    INTEGER NOT NULL,
  protocol      TEXT NOT NULL DEFAULT 'tcp',
  label         TEXT,
  auto_detected INTEGER NOT NULL DEFAULT 0,
  enabled       INTEGER NOT NULL DEFAULT 1,
  created_at    INTEGER NOT NULL
);

CREATE UNIQUE INDEX idx_port_forwards_local_port ON port_forwards(local_port);
CREATE UNIQUE INDEX idx_port_forwards_workspace_remote
  ON port_forwards(workspace_id, remote_port);
CREATE INDEX idx_port_forwards_workspace ON port_forwards(workspace_id);
