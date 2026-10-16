const channelProvider = require("../channel"),
  telemetry = require("./telemetry"),
  system = require("./system"),
  userService = require("./user-service");
const InboundRequestModel = require("../machine/util/inbound-request-model.js");
const config = require("../env-variables");
const SandboxOrgTracker = require("./sandbox-org-tracker");
const SandboxLoginFlow = require("./sandbox-login-flow");
const StandardLoginFlow = require("./standard-login-flow");
const ChatService = require("./chat-service");
const { maskMobile } = require("../privacy");

// Simple in-memory store for tracking email validation requests in sandbox mode
// Format: { mobileNumber: { timestamp: Date, waitingForEmail: boolean } }
const sandboxOrgCodeTracker = {};
const sandboxOrgTracker = new SandboxOrgTracker(sandboxOrgCodeTracker);
// Per-user chain of pending outbound sends - see toUser() below.
const sendQueues = new Map();
// Per-user chain of pending inbound dispatches - see authenticateAndDispatch() below.
const dispatchQueues = new Map();
const dispatchDepth = new Map();   // mobileNumber -> messages queued or in flight



// Prevent memory leak - automatically clean up expired sessions every 5 minutes
const cleanupInterval = setInterval(() => {
  try {
    const now = Date.now();
    const EXPIRY_TIME = 30 * 60 * 1000; // 30 minutes
    let cleanedCount = 0;
    
    Object.keys(sandboxOrgCodeTracker).forEach(mobileNumber => {
      const entry = sandboxOrgCodeTracker[mobileNumber];
      if (entry && (now - entry.timestamp) > EXPIRY_TIME) {
        delete sandboxOrgCodeTracker[mobileNumber];
        cleanedCount++;
      }
    });
    
    if (cleanedCount > 0) {
      console.log(`Session cleanup: Removed ${cleanedCount} expired sessions. Active sessions: ${Object.keys(sandboxOrgCodeTracker).length}`);
    }
  } catch (error) {
    console.error('Session cleanup error:', error);
  }
}, 5 * 60 * 1000); // Run cleanup every 5 minutes

// Don't let the housekeeping timer hold the event loop open; the HTTP server
// keeps the process alive in production, and this makes the module requirable
// from a test without hanging the runner.
if (typeof cleanupInterval.unref === 'function') cleanupInterval.unref();

// Clear interval on process termination to prevent memory leaks
process.on('SIGINT', () => clearInterval(cleanupInterval));
process.on('SIGTERM', () => clearInterval(cleanupInterval));

async function getAuthenticatedSandboxUser(mobileNumber, tenantId) {
  const user = await userService.loginOrCreateUser(mobileNumber, tenantId);
  if (!user || !user.userInfo) {
    throw new Error(`Failed to authenticate or create user in tenant ${tenantId}`);
  }

  // User is already enriched by loginOrCreateUser
  user.userId = user.userInfo.uuid;
  user.mobileNumber = mobileNumber;
  user.name = user.userInfo.name;
  user.locale = user.userInfo.locale;
  return user;
}

class SessionManager {

  constructor() {
    // Non-enumerable: chatService.chatInterface circles back to this instance,
    // and the xstate context embeds this as chatInterface, then gets
    // JSON.stringify'd for persistence - an enumerable chatService would make
    // that serialization walk straight into the cycle.
    Object.defineProperty(this, "chatService", {
      value: new ChatService(this),
    });
  }

  // Serialize a citizen's messages instead of dropping them: a second message
  // sent while the first is still processing is answered after that turn settles,
  // not discarded. Ordering is preserved, and different citizens stay concurrent.
  //
  // The queue is capped: beyond maxQueuedMessagesPerUser we go back to discarding,
  // so a citizen tapping repeatedly cannot build a backlog that replies for the
  // next minute. The webhook rate limiter is a per-instance ceiling, not per user.
  async authenticateAndDispatch(rawRequestModel) {
    const mobileNumber = rawRequestModel.user.mobileNumber;
    const waiting = dispatchDepth.get(mobileNumber) || 0;

    if (waiting >= config.maxQueuedMessagesPerUser) {
      console.log(`Discarding message from ${maskMobile(mobileNumber)}: ${waiting} already queued`);
      return;
    }

    const previous = dispatchQueues.get(mobileNumber) || Promise.resolve();
    dispatchDepth.set(mobileNumber, waiting + 1);

    const current = previous
      .catch(() => {}) // a failed turn must not skip the message behind it
      .then(() => this._authenticateAndDispatch(rawRequestModel))
      .then((userId) => sendQueues.get(userId ?? mobileNumber))
      .then(() => new Promise((resolve) => setTimeout(resolve, config.replyCooldownMs)))
      .finally(() => {
        const remaining = (dispatchDepth.get(mobileNumber) || 1) - 1;
        if (remaining > 0) dispatchDepth.set(mobileNumber, remaining);
        else dispatchDepth.delete(mobileNumber);
        // identity-guarded: a message queued meanwhile is the tail now and must stay
        if (dispatchQueues.get(mobileNumber) === current) dispatchQueues.delete(mobileNumber);
      });

    dispatchQueues.set(mobileNumber, current);
    return current;
  }



  async _authenticateAndDispatch(rawRequestModel) {
    const inboundRequestModel = InboundRequestModel.create(rawRequestModel);
    const loginFlow = config.isSandboxMode
      ? new SandboxLoginFlow(inboundRequestModel, sandboxOrgTracker, getAuthenticatedSandboxUser,
          (user, messages, extraInfo) => this.toUser(user, messages, extraInfo))
      : new StandardLoginFlow(inboundRequestModel);

    const session = await loginFlow.resolveSession();
    if (!session || !session.userId) return;

    await this.chatService.dispatch(session, inboundRequestModel);
    return session.userId;
  }

  // Chain sends per conversation: two unawaited Twilio calls race, so the menu
  // can land before the welcome it followed.
  async toUser(user, outputMessages, extraInfo, { delayMs = 0 } = {}) {

    // Pre-auth prompts have no userId; keyed on undefined they all shared one
    // chain, so each citizen waited behind a stranger's send.
    const queueKey = user.userId ?? user.mobileNumber;
    const previousSend = sendQueues.get(queueKey) || Promise.resolve();

    const thisSend = previousSend
      .catch(() => {}) // a prior send's failure must not skip this one
      // Delayed prompts wait INSIDE the queue. On a setTimeout they enqueued
      // after dispatch had already snapshotted it and moved on.
      .then(() => (delayMs > 0 ? new Promise((resolve) => setTimeout(resolve, delayMs)) : undefined))
      .then(() => channelProvider.sendMessageToUser(user, outputMessages, extraInfo))
      .catch((error) =>
        console.error(`Failed to send message to ${user.userId ?? maskMobile(user.mobileNumber)}:`, error))
      .finally(() => {
        if (sendQueues.get(queueKey) === thisSend) sendQueues.delete(queueKey);
      });

    sendQueues.set(queueKey, thisSend);

    // Published to Kafka: mask the fallback rather than emit the number.
    const telemetryId = user.userId ?? maskMobile(user.mobileNumber);
    for (let message of outputMessages) {
      telemetry.log(telemetryId, "to_user", {
        message: { type: "text", output: message, locale: user.locale },
      });
    }
  }



  // Method to get tenant ID for a mobile number from tracker (for image uploads)
  getSandboxTenantForMobileNumber(mobileNumber) {
    if (config.isSandboxMode && sandboxOrgCodeTracker[mobileNumber]) {
      return sandboxOrgCodeTracker[mobileNumber].orgTenantId || null;
    }
    return null;
  }

  system_error(message) {
    system.error(message);
  }
}

module.exports = new SessionManager();
