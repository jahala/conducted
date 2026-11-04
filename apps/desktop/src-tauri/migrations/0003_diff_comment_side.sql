-- Conducted database, version 3.
--
-- diff_comments.side: which side of the diff a comment's line numbers belong to. A comment on a
-- deleted line has no line number on the new side, so the line alone cannot place it.
-- Existing comments were all made on the new side of the diff.

ALTER TABLE diff_comments ADD COLUMN side TEXT NOT NULL DEFAULT 'additions'
  CHECK (side IN ('deletions', 'additions'));
