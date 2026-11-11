-- Conducted database, version 18.
--
-- terminals.placement: where a terminal's tab belongs (issue #482). A terminal made from the
-- centre's "+" is a centre tab; one made from the right panel's "New terminal" is a panel tab. Each
-- strip lists only its own terminals and the shell draws where its tab is. Rows written before this
-- migration have no place of their own and were centre tabs, so they default to 'centre'.

ALTER TABLE terminals ADD COLUMN placement TEXT NOT NULL DEFAULT 'centre'
  CHECK (placement IN ('centre','panel'));
