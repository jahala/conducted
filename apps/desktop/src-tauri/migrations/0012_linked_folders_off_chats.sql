-- Conducted database, version 12.
--
-- Linked folders have one home: workspaces.linked_paths (WS-07). A chat's stored config used to
-- copy them into additionalDirectories, kept in step only for chats loaded in memory, so a chat
-- whose tab was closed could run with old folders. The sessions service now attaches the
-- workspace's folders to every config it sends the sidecar. This migration clears the copy from
-- stored chat configs; the key stays because it is part of SessionConfig.
--
-- A backlog workspace's config is made before its workspace exists, so it never named linked
-- folders; clearing it too keeps every stored config true to the one home.

UPDATE sessions
SET config = json_set(config, '$.additionalDirectories', json('[]'))
WHERE json_valid(config)
  AND json_type(config, '$.additionalDirectories') = 'array';

UPDATE backlog_workspaces
SET config = json_set(config, '$.additionalDirectories', json('[]'))
WHERE json_valid(config)
  AND json_type(config, '$.additionalDirectories') = 'array';
