-- Conducted database, version 9.
--
-- workspaces.host_*: where the workspace lives (CLOUD-01, services-map 1.2). 'local' is this Mac;
-- 'cloud' is a sandbox behind the user's own Worker, named by host_url (the Worker) and host_vm_id
-- (the sandbox). Both are null for a local workspace and both are set for a cloud one; the row
-- codec refuses any other mix. Every workspace stored before this migration was made on the Mac,
-- so it is local.

ALTER TABLE workspaces ADD COLUMN host_kind TEXT NOT NULL DEFAULT 'local'
  CHECK (host_kind IN ('local','cloud'));
ALTER TABLE workspaces ADD COLUMN host_url TEXT;
ALTER TABLE workspaces ADD COLUMN host_vm_id TEXT;
