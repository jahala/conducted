-- Conducted database, version 14.
--
-- settings.key: the General setting that expands every tool call keeps Conductor's stored name,
-- garry_mode (D098, D020). A row written under our earlier name moves with its value, so a user's
-- choice survives the rename.

UPDATE settings SET key = 'garry_mode' WHERE key = 'expand_tool_calls';
