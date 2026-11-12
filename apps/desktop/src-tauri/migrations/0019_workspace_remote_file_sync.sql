-- Conducted database, version 19.
--
-- workspaces.remote_file_sync_enabled: a cloud workspace's Sync files switch (CLOUD-11, issue
-- #549), under Conductor's own column name. Before this migration the switch lived only in memory,
-- so every cloud workspace showed the Advanced setting "Enable file sync in new cloud workspaces"
-- (auto_sync_files_in_new_cloud_workspaces, true unless stored otherwise) after a restart. Each
-- cloud row written before now keeps that value, which is what it showed. A local workspace has no
-- mirror, so its value is 0, as Conductor writes for one.

ALTER TABLE workspaces ADD COLUMN remote_file_sync_enabled INTEGER NOT NULL DEFAULT 0
  CHECK (remote_file_sync_enabled IN (0,1));

UPDATE workspaces
SET remote_file_sync_enabled = COALESCE(
  (SELECT CASE value WHEN 'true' THEN 1 ELSE 0 END
   FROM settings WHERE key = 'auto_sync_files_in_new_cloud_workspaces'),
  1)
WHERE host_kind = 'cloud';
