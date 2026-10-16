-- Which inbound path produced each ledger row.
--
-- There is no flag that says whether a deployment routes and renders inside the box or
-- consumes messages a producer already rendered. Deliberately so: a setting can be dropped
-- with a compose overlay and flip behaviour in silence, which is exactly how a live server
-- once lost its notifications. The path is therefore recorded on EVERY row instead —
-- per message, in production, on the Logs screen, filterable.
--
--   PRERENDERED  the producer sent a v1 envelope; the bridge gated and delivered it.
--   RESOLVED     the producer sent a thin domain event; the box routed, recruited,
--                rendered and localized it.
--
-- NOT NULL DEFAULT 'PRERENDERED' backfills every existing row with what it actually was:
-- before this column existed, the pre-rendered envelope was the only way in. The default
-- also keeps the column honest for any writer that forgets it — though the repository
-- writes the value explicitly rather than relying on this, because an explicit NULL bind
-- beats a column default and would fail the NOT NULL instead of silently defaulting.
--
-- NOTE: do NOT edit an applied migration (Flyway checksum); this is additive.

ALTER TABLE nb_dispatch_log
    ADD COLUMN IF NOT EXISTS source_path VARCHAR(32) NOT NULL DEFAULT 'PRERENDERED';

-- The operator question this answers is "show me the rows from the other path", which on a
-- deployment mid-cutover is the small side of a very lopsided split. One tenant-scoped index
-- serves both that and the Logs screen's default tenant filter.
CREATE INDEX IF NOT EXISTS idx_nb_dispatch_tenant_source_path
    ON nb_dispatch_log (tenant_id, source_path);
