-- Conducted database, version 6.
--
-- model_context_windows: the context window size each agent last reported for a model (CHAT-14),
-- as Conductor keeps its context windows per model. The context meter uses it for a chat whose own
-- agent has not reported a size yet. No sizes are shipped: every row comes from an agent's report.

-- The context window an agent last reported for one model. agent is the agent kind, or
-- 'acp:<agent>' for an ACP agent; model is the model id the chat was started with.
-- Lifetime: one row per agent and model, replaced by the next report for that model; the table
-- grows only with the number of models used.
CREATE TABLE model_context_windows (
  agent          TEXT NOT NULL,
  model          TEXT NOT NULL,
  window_tokens  INTEGER NOT NULL CHECK (window_tokens > 0),
  updated_at     INTEGER NOT NULL,
  PRIMARY KEY (agent, model)
);
