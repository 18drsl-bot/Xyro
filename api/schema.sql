-- The published tag rules, as one row.
--
-- One row, not a history: the point of this table is that a publish needs no
-- repo token, and `rev` is what makes that safe. A write is a compare-and-set -
-- `... WHERE rev = <the rev the editor read>` - so a tab holding a stale copy
-- changes nothing and is told so (409), exactly like the git blob sha did. The
-- statement either lands or does not; two people publishing in the same second
-- cannot both win.
--
-- Apply it with:
--   npx wrangler d1 execute xyro-tags --remote --file schema.sql

CREATE TABLE IF NOT EXISTS rules (
	id         INTEGER PRIMARY KEY CHECK (id = 1),
	body       TEXT    NOT NULL,
	rev        INTEGER NOT NULL DEFAULT 1,
	updated_at INTEGER NOT NULL DEFAULT 0
);
