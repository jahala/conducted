-- Conducted database, version 11.
--
-- 1. workspaces.notes: no screen reads or writes workspace notes. Conductor keeps the column from
--    an older schema but its frontend never reads it either, so this app does not store the value.
-- 2. terminals.cols and terminals.rows: the PTY size lives in the shell and the saved screen state;
--    the database columns were written at insert and never read.
-- 3. session_events.compacted_at is the one home of "this event was compacted". Rows the older
--    archived-chat compaction marked with the JSON flag `$.compacted` move their time into the
--    column and lose the flag.

ALTER TABLE workspaces DROP COLUMN notes;
ALTER TABLE terminals DROP COLUMN cols;
ALTER TABLE terminals DROP COLUMN rows;

UPDATE session_events
SET compacted_at = COALESCE(compacted_at, received_at),
    content = json_remove(content, '$.compacted')
WHERE type = 'turn_ended'
  AND json_valid(content)
  AND json_extract(content, '$.compacted') IS NOT NULL;
