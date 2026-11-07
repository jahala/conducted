-- Conducted database, version 13.
--
-- sessions.context_window_tokens: a copy of the window size the chat's agent last reported. That
-- fact has one home, model_context_windows, keyed by agent and model (CHAT-14), which the context
-- wheel reads through ContextWindowService. The copy could disagree after a model change and had
-- no reader of its own. sessions.context_used_tokens stays: it is the chat's last used count, a
-- cache of the newest usage event kept in step by the event ingest.

ALTER TABLE sessions DROP COLUMN context_window_tokens;
