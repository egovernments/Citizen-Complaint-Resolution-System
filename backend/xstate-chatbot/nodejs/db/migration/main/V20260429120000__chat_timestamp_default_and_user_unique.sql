ALTER TABLE eg_chat_state_v2
ALTER COLUMN time_stamp SET DEFAULT round(EXTRACT(EPOCH FROM now())::numeric * 1000);

DO $$
BEGIN
    IF EXISTS (
        SELECT user_id
        FROM eg_chat_state_v2
        WHERE user_id IS NOT NULL
        GROUP BY user_id
        HAVING COUNT(*) > 1
    ) THEN
        RAISE EXCEPTION 'Cannot add unique constraint on eg_chat_state_v2.user_id: duplicate user_id values exist';
    END IF;
END $$;

ALTER TABLE eg_chat_state_v2
ADD CONSTRAINT eg_chat_state_v2_user_id_unique UNIQUE (user_id);
