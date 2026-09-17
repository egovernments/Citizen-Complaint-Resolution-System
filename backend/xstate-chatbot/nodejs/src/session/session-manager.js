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

// Simple in-memory store for tracking email validation requests in sandbox mode
// Format: { mobileNumber: { timestamp: Date, waitingForEmail: boolean } }
const sandboxOrgCodeTracker = {};
const sandboxOrgTracker = new SandboxOrgTracker(sandboxOrgCodeTracker);
// Per-user chain of pending outbound sends - see toUser() below.
const sendQueues = new Map();
// Per-user chain of pending inbound dispatches - see authenticateAndDispatch() below.
const dispatchQueues = new Map();



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

  // Prevent concurrent requests for the same user from racing against
  // persisted state by processing only the first message in a burst.
  async authenticateAndDispatch(rawRequestModel) {
    const mobileNumber = rawRequestModel.user.mobileNumber;
    if (dispatchQueues.has(mobileNumber)) {
      console.log(`Discarding message from ${mobileNumber}: previous message still processing`);
      return;
    }
    
    const current = this._authenticateAndDispatch(rawRequestModel)
      .then((userId) => sendQueues.get(userId))
      .then(() => new Promise((resolve) => setTimeout(resolve, config.replyCooldownMs)))
      .finally(() => dispatchQueues.delete(mobileNumber));

    dispatchQueues.set(mobileNumber, current);
    return current;
  }


  async _authenticateAndDispatch(rawRequestModel) {
    const inboundRequestModel = InboundRequestModel.create(rawRequestModel);
    const loginFlow = config.isSandboxMode
      ? new SandboxLoginFlow(inboundRequestModel, sandboxOrgTracker, getAuthenticatedSandboxUser)
      : new StandardLoginFlow(inboundRequestModel);

    const session = await loginFlow.resolveSession();
    // TODO: SandboxLoginFlow.resolveSession() legitimately returns null after
    // already notifying the citizen (asking for email/org selection, invalid
    // selection, etc). dispatch() then throws on session.userId, and the
    // generic error handler sends a second, confusing message. Restore an
    // `if (!session) return;` guard here before relying on sandbox mode.
    await this.chatService.dispatch(session, inboundRequestModel);
    return session.userId;
  }




  // toUser can fire multiple times per dispatch (e.g. a welcome message
  // cascading straight into a menu prompt), each an independent, unawaited
  // send - two concurrent Twilio requests race with no ordering guarantee,
  // so the menu can land before the welcome it followed. Chaining each send
  // onto the previous one per user forces them out in the order queued,
  // regardless of how the underlying network calls actually complete.
  async toUser(user, outputMessages, extraInfo) {
    const userId = user.userId;
    const previousSend = sendQueues.get(userId) || Promise.resolve();
    
    const thisSend = previousSend
      .catch(() => {}) // a prior send's failure must not skip this one
      .then(() => channelProvider.sendMessageToUser(user, outputMessages, extraInfo))
      .catch((error) => console.error(`Failed to send message to user ${userId}:`, error));
    sendQueues.set(userId, thisSend);

    for (let message of outputMessages) {
      telemetry.log(user.userId, "to_user", {
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
