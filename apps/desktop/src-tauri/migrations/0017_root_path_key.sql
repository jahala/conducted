-- Conducted database, version 17.
--
-- settings.key: the folder that holds repositories and workspaces keeps Conductor's stored name,
-- conductor_root_path (D098, D020). A row written under our earlier name moves with its value, so
-- a user's chosen folder survives the rename. The value itself may keep our own word for the
-- folder (D012, D037).

UPDATE settings SET key = 'conductor_root_path' WHERE key = 'conducted_root_path';
