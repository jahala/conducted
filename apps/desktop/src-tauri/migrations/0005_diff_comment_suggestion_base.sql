-- Conducted database, version 5.
--
-- diff_comments.suggestion_base_code: the original lines a suggested change replaces (REV-03), as
-- Conductor stores them. With it the comment can show its suggestion as a change from those lines
-- after the file has moved on. Comments stored before this migration have none.

ALTER TABLE diff_comments ADD COLUMN suggestion_base_code TEXT;
