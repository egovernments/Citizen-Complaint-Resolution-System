const pool = require('./postgres-config');
const ChatState = require('../chat-state');

class StateRepository {

    // Upsert: user_id is unique, and a citizen whose session was closed
    // (stalled, cancelled) comes back here with their row still present.
    async insertNewState(userId, active, state, session_id, time_stamp) {
        const query = `INSERT INTO eg_chat_state_v2 (user_id, active, state, session_id, time_stamp)
                       VALUES ($1, $2, $3, $4, $5)
                       ON CONFLICT (user_id) DO UPDATE
                         SET active = EXCLUDED.active,
                             state = EXCLUDED.state,
                             session_id = EXCLUDED.session_id,
                             time_stamp = EXCLUDED.time_stamp`;
        let result = await pool.query(query, [userId, active, state, session_id, time_stamp]);
        return result;
    }

    // FLAG: last writer wins. No version column, no row lock, and persist-queue
    // serialises per citizen within ONE process — two replicas can interleave
    // read-modify-write here and drop a transition. Safe at replicas: 1.
    async updateState(userId, active, state, time_stamp) {
        const query = 'UPDATE eg_chat_state_v2 SET active = $2, state = $3, time_stamp = $4 WHERE user_id = $1';
        let result = await pool.query(query, [userId, active, state, time_stamp]);
        return result;
    }

    async getActiveStateForUserId(userId) {
        const query = 'SELECT (state) FROM eg_chat_state_v2 WHERE user_id = $1 AND active = true';
        let result = await pool.query(query, [userId]);
        if(result.rowCount >= 1) { 
            let state = result.rows[0].state;
            return ChatState.create(state);
        }
    }

    async getUserId(active){
        const query = 'SELECT DISTINCT user_id FROM eg_chat_state_v2 WHERE active = $1';
        let result = await pool.query(query, [active]);
        let userIdList = [];
        if(result.rowCount >= 1) {
            for(let row of result.rows){
                userIdList.push(row.user_id)
            }
        }
        return userIdList;
    }

    
    // Rotates the session_id and bumps time_stamp only if the user has been
    // idle for more than sessionTime minutes; a no-op otherwise, so a burst of
    // messages inside one session doesn't spawn a new session_id per message.
    async updateSessionId(userId, sessionTime) {
        const query = 'UPDATE eg_chat_state_v2 as chat SET session_id = md5(random()::text || clock_timestamp()::text)::uuid, time_stamp = round(EXTRACT (EPOCH FROM now())::float*1000) WHERE user_id = $1 AND ((round(EXTRACT (EPOCH FROM now())::float*1000) - chat.time_stamp)/1000/60) > $2';
        let result = await pool.query(query, [userId, sessionTime]);
        return result;
    }

    async getSessionId(userId) {
        const query = 'SELECT session_id FROM eg_chat_state_v2 WHERE user_id = $1 AND active = true';
        let result = await pool.query(query, [userId]);
        if(result.rowCount >= 1) {
            let session_id = result.rows[0].session_id;
            return session_id;
        }
    }

    async getLastActivityTimestamp(userId) {
        const query = 'SELECT time_stamp FROM eg_chat_state_v2 WHERE user_id = $1 AND active = true';
        let result = await pool.query(query, [userId]);
        if (result.rowCount >= 1) {
            return Number(result.rows[0].time_stamp);
        }
    }

    // The resume-or-restart prompt is conversation state, so it lives on the row:
    // a restart between asking and answering must not swallow the citizen's reply.
    async setResumePending(userId, timeStamp) {
        const query = 'UPDATE eg_chat_state_v2 SET resume_pending_at = $2 WHERE user_id = $1';
        return await pool.query(query, [userId, timeStamp]);
    }

    async clearResumePending(userId) {
        const query = 'UPDATE eg_chat_state_v2 SET resume_pending_at = NULL WHERE user_id = $1';
        return await pool.query(query, [userId]);
    }

    async getResumePendingAt(userId) {
        const query = 'SELECT resume_pending_at FROM eg_chat_state_v2 WHERE user_id = $1 AND active = true';
        let result = await pool.query(query, [userId]);
        if (result.rowCount >= 1 && result.rows[0].resume_pending_at != null) {
            return Number(result.rows[0].resume_pending_at);
        }
    }



}

module.exports = new StateRepository();