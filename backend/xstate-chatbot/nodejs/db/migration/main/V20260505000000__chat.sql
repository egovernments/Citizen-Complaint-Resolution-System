CREATE TABLE eg_chat_state_v2 (
    id SERIAL,
    user_id TEXT,
    active BOOLEAN,
    state jsonb,
    session_id VARCHAR,
    time_stamp numeric DEFAULT round(EXTRACT(EPOCH FROM now())::numeric * 1000),
    CONSTRAINT eg_chat_state_v2_user_id_unique UNIQUE (user_id),
    PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS eg_chat_idx_user_id_active_v2 ON eg_chat_state_v2 (user_id, active);
