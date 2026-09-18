-- The resume-or-restart prompt used to be tracked in a process-local Map, so a
-- restart between asking and answering lost it: the citizen's "1" was read as a
-- normal message and their expired session was silently discarded. The prompt is
-- part of the conversation's state, so it belongs on the row.
--
-- resume_pending_at doubles as the flag and its own expiry: a prompt nobody ever
-- answered must stop intercepting messages instead of shadowing cancel/reset
-- words forever.

ALTER TABLE eg_chat_state_v2
    ADD COLUMN IF NOT EXISTS resume_pending_at numeric;
