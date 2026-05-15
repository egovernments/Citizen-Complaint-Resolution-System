ALTER TABLE nb_dispatch_log ADD COLUMN IF NOT EXISTS reference_number VARCHAR(256);

CREATE INDEX IF NOT EXISTS idx_nb_dispatch_reference_number ON nb_dispatch_log (reference_number);
