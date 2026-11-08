-- Conducted database, version 16.
--
-- terminals.host_kind: which host a terminal runs on (CLOUD-11, D111). A cloud workspace can have
-- a terminal in its sandbox beside one on the Mac in its local mirror, so the host belongs to the
-- terminal, not to the workspace. Rows written before this migration ran on the Mac.

ALTER TABLE terminals ADD COLUMN host_kind TEXT NOT NULL DEFAULT 'local'
  CHECK (host_kind IN ('local','cloud'));
