-- Conducted database, version 15.
--
-- The order of a cloud workspace's forwarded ports in the Forward ports popover (CLOUD-10).
-- The user can move a forward up or down, and that order is a fact of the forward, so it lives on
-- its row. Rows from before this migration share position 0 and keep their remote-port order.
--
-- Lifetime: with its port_forwards row, until the workspace is archived or deleted, or the user
-- removes the forward.

ALTER TABLE port_forwards ADD COLUMN position INTEGER NOT NULL DEFAULT 0;

CREATE INDEX idx_port_forwards_position ON port_forwards(workspace_id, position);
