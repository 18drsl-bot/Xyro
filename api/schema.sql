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

-- The blacklist, kept here so it can be edited WITHOUT a database credential.
--
-- The staff node lives in Firebase, and that database refuses anonymous writes,
-- so blocking someone used to need a service-account secret on the Worker. But
-- the script reads the blacklist through this Worker anyway (GET /staff.json),
-- so the Worker can hold its own entries and merge them into that read - "who is
-- blocked" stops depending on a credential nobody has set yet. Entries written
-- in the Firebase console are still honoured; these are merged on top, and
-- mirrored back when a credential does exist.

CREATE TABLE IF NOT EXISTS blacklist (
	who      TEXT PRIMARY KEY,
	reason   TEXT    NOT NULL DEFAULT '',
	added_at INTEGER NOT NULL DEFAULT 0
);
