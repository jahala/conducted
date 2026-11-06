-- Conducted database, version 7.
--
-- sessions.fork_resume_native_message_id: for a chat forked from a turn (CHAT-16), the agent's own
-- id of the last message the fork keeps. The fork's first send resumes the origin's agent session
-- at that message, so it has to survive a restart. Recording the fork's first user message clears
-- it. Chats stored before this migration have none.

ALTER TABLE sessions ADD COLUMN fork_resume_native_message_id TEXT;
