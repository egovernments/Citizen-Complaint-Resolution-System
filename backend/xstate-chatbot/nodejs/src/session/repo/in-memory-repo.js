const uuid = require('uuid');
const ChatState = require('../chat-state');

class StateRepository {

    constructor() {
        this.states = {};
    }

    async insertNewState(userId, active, state, session_id, time_stamp) {
        this.states[userId] = state;
    }

    async updateState(userId, active, state, time_stamp) {
        this.states[userId] = state;
    }

    async getActiveStateForUserId(userId) {
        if(this.states[userId]) {
            let state = JSON.parse(this.states[userId]);
            if(!state.done) {
                return ChatState.create(state);
            }
        }
    }

    async updateSessionId(userId, sessionTime) {
        return;
    }

    async getSessionId(userId) {
        if(this.states[userId]) {
            let state = JSON.parse(this.states[userId]);
            if(!state.done) {
                return uuid.v4();
            }
        }
    }

    // Same contract as the Postgres repo. In-memory sessions die with the process
    // anyway, so this only has to be consistent within one run.
    async setResumePending(userId, timeStamp) {
        this.resumePendingAt = this.resumePendingAt || {};
        this.resumePendingAt[userId] = timeStamp;
    }

    async clearResumePending(userId) {
        if (this.resumePendingAt) delete this.resumePendingAt[userId];
    }

    async getResumePendingAt(userId) {
        return (this.resumePendingAt || {})[userId];
    }


}

module.exports = new StateRepository();