-- Conducted database, version 10.
--
-- One index for the startup repair scan of session_events (#392). The measurement behind it and
-- the queries it serves are in docs/research/db-scans-2026-11-07.md.
--
-- Startup repair's findInterruptedTurns reads every live turn of every chat. The existing
-- (session_id, turn_id) index finds each chat's events but then reads the table for the type,
-- position and reverted_at it groups by. This index carries those columns, so the query is
-- answered from the index alone.
--
-- The daily cutToolOutputs scan gets no index: the measurement shows one makes it about ten times
-- slower, because the query orders by rowid and an index forces a sort. That scan's cost is the
-- JSON it reads, which an index on these columns cannot avoid. The other filters the audit named
-- (attachments, terminals, workspaces, section_members, backlog_workspaces and
-- workspaces.active_session_id) all scan small tables in about a millisecond at real size.

CREATE INDEX idx_session_events_unreverted_turn
  ON session_events(reverted_at, session_id, turn_id, type, idx);
