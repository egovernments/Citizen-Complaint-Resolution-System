const sevaStateMachine = require("../machine/seva"),
  channelProvider = require("../channel"),
  chatStateRepository = require("./repo"),
  telemetry = require("./telemetry"),
  system = require("./system"),
  userService = require("./user-service");
const { State, interpret } = require("xstate");
const dialog = require("../machine/util/dialog.js");
const uuid = require("uuid");
const config = require("../env-variables");
const emailTenantService = require("../machine/service/email-tenant-service");

// Simple in-memory store for tracking email validation requests in sandbox mode
// Format: { mobileNumber: { timestamp: Date, waitingForEmail: boolean } }
const sandboxOrgCodeTracker = {};

async function getAuthenticatedSandboxUser(mobileNumber, tenantId) {
  const user = await userService.loginUser(mobileNumber, tenantId);
  if (!user || !user.userInfo) {
    throw new Error(`User is not registered in tenant ${tenantId}`);
  }

  const enrichedUser = await userService.enrichuserDetails(user);
  enrichedUser.userId = enrichedUser.userInfo.uuid;
  enrichedUser.mobileNumber = mobileNumber;
  enrichedUser.name = enrichedUser.userInfo.name;
  enrichedUser.locale = enrichedUser.userInfo.locale;
  return enrichedUser;
}

class SessionManager {
  async fromUser(reformattedMessage) {
    let mobileNumber = reformattedMessage.user.mobileNumber;
    let user;
    let userId;
    let messageInput = reformattedMessage.message.input?.toLowerCase();

    // Check if this is a reset/greeting message
    let isReset = dialog.get_intention(
      grammer.reset,
      reformattedMessage,
      true
    ) === 'reset';

    // In sandbox mode, handle email validation flow without creating sessions
    if (config.enableSandboxMode) {
      const isGreeting = isReset || (messageInput && ['hi', 'hello', 'hey', 'start', 'help', 'seva', 'egov'].includes(messageInput.trim()));

      // Check if we're waiting for email from this number
      const trackerEntry = sandboxOrgCodeTracker[mobileNumber];
      const isWaitingForEmail = trackerEntry && trackerEntry.waitingForEmail;

      // Clean up old entries (older than 30 minutes)
      if (trackerEntry && (Date.now() - trackerEntry.timestamp) > 30 * 60 * 1000) {
        delete sandboxOrgCodeTracker[mobileNumber];
      }

      if (isGreeting) {
        // Check if user is already authenticated
        if (trackerEntry && trackerEntry.userId && trackerEntry.orgTenantId) {
          // User is already authenticated - treat as regular message to continue the flow
          // Don't ask for email again, just continue with the existing session
          user = { userId: trackerEntry.userId };
          userId = trackerEntry.userId;
          reformattedMessage.user = user;
          reformattedMessage.extraInfo.tenantId = trackerEntry.orgTenantId;
          reformattedMessage.extraInfo.organizationTenantId = trackerEntry.orgTenantId;
          // Continue to create/resume session - DON'T RETURN!
        } else {
          // New user or session expired - ask for email
          // If we know the prior user UUID for this mobile, deactivate that session.
          const priorUserId = trackerEntry && trackerEntry.userId;
          if (priorUserId) {
            await chatStateRepository.updateState(priorUserId, false, null);
          }

          sandboxOrgCodeTracker[mobileNumber] = {
            timestamp: Date.now(),
            waitingForEmail: true
          };

          const welcomeMessage = "Welcome to Citizen Complaint Service\n\n" +
            "Enter your registered email address";

          channelProvider.sendMessageToUser(
            { mobileNumber: mobileNumber },
            [welcomeMessage],
            reformattedMessage.extraInfo
          );
          return; // Exit early - no session creation
        }
      } else if (isWaitingForEmail && !isGreeting) {
        // User is providing email - validate it
        const email = reformattedMessage.message.input?.trim().toLowerCase();
        const result = await emailTenantService.findTenantByEmail(email);

        if (!result) {
          // Invalid email - provide registration link
          const registrationUrl = `${config.sandboxHost || 'https://sandbox-demo.digit.org'}/sandbox-ui/user/login`;
          const errorMessage = `Email '${email}' not found.\n\n` +
            `Please enter a registered email address or register at:\n` +
            `${registrationUrl}`;

          channelProvider.sendMessageToUser(
            { mobileNumber: mobileNumber },
            [errorMessage],
            reformattedMessage.extraInfo
          );
          return; // Exit early - no session creation
        }

        // Check if multiple organizations found
        if (result.multiple) {
          // Store the email and tenant options for selection
          sandboxOrgCodeTracker[mobileNumber] = {
            timestamp: Date.now(),
            waitingForEmail: false,
            waitingForOrgSelection: true,
            email: email,
            tenantOptions: result.tenants
          };

          // Create numbered list of organizations
          let orgListMessage = `Found ${result.tenants.length} organizations for: ${email}\n\n`;
          orgListMessage += `Select your organization:\n\n`;

          result.tenants.forEach((tenant, index) => {
            orgListMessage += `${index + 1}. ${tenant.name || tenant.code}\n`;
          });

          orgListMessage += `\nEnter number (1-${result.tenants.length})`;

          channelProvider.sendMessageToUser(
            { mobileNumber: mobileNumber },
            [orgListMessage],
            reformattedMessage.extraInfo
          );
          return; // Exit early - wait for selection
        }

        // Single organization found - proceed directly
        const orgDetails = result.tenants[0];

        // Valid email - only allow already registered users in the organization's tenant
        try {
          user = await getAuthenticatedSandboxUser(
            mobileNumber,
            orgDetails.code
          );
          userId = user.userId;
          reformattedMessage.user = user;
          reformattedMessage.extraInfo.tenantId = orgDetails.code;
          reformattedMessage.extraInfo.organizationTenantId = orgDetails.code;
          reformattedMessage.extraInfo.organizationName = orgDetails.name;

          // Persist mobileNumber -> {orgTenantId, userId} in the tracker so subsequent
          // messages can resolve the user UUID without re-asking for the org code.
          sandboxOrgCodeTracker[mobileNumber] = {
            timestamp: Date.now(),
            waitingForEmail: false,
            orgTenantId: orgDetails.code,
            userId: userId,
            orgEmail: email
          };
          // Now continue to create the session - DON'T RETURN!
        } catch (error) {
          // Validation succeeded but user create/login failed - clear tracker.
          delete sandboxOrgCodeTracker[mobileNumber];

          // User not registered in this organization - show registration URL
          const registrationUrl = emailTenantService.getSandboxRegistrationUrl(email);
          channelProvider.sendMessageToUser(
            { mobileNumber: mobileNumber },
            [`Mobile ${mobileNumber} not registered with ${orgDetails.name}.\n\nComplete registration at:\n${registrationUrl}\n\nUse email: ${email}`],
            reformattedMessage.extraInfo
          );
          return; // Exit early - no session creation
        }
      } else if (trackerEntry && trackerEntry.waitingForOrgSelection) {
        // User is selecting from multiple organizations
        const selection = reformattedMessage.message.input?.trim();
        const selectionNum = parseInt(selection);

        if (isNaN(selectionNum) || selectionNum < 1 || selectionNum > trackerEntry.tenantOptions.length) {
          // Invalid selection
          channelProvider.sendMessageToUser(
            { mobileNumber: mobileNumber },
            [`Invalid selection. Enter a number between 1 and ${trackerEntry.tenantOptions.length}`],
            reformattedMessage.extraInfo
          );
          return;
        }

        // Get selected organization
        const selectedOrg = trackerEntry.tenantOptions[selectionNum - 1];
        const email = trackerEntry.email;

        // Only allow already registered users in the selected tenant
        try {
          user = await getAuthenticatedSandboxUser(
            mobileNumber,
            selectedOrg.code
          );
          userId = user.userId;
          reformattedMessage.user = user;
          reformattedMessage.extraInfo.tenantId = selectedOrg.code;
          reformattedMessage.extraInfo.organizationTenantId = selectedOrg.code;
          reformattedMessage.extraInfo.organizationName = selectedOrg.name;

          // Update tracker with selected org
          sandboxOrgCodeTracker[mobileNumber] = {
            timestamp: Date.now(),
            waitingForEmail: false,
            waitingForOrgSelection: false,
            orgTenantId: selectedOrg.code,
            userId: userId,
            orgEmail: email
          };
          // Continue to create session - DON'T RETURN!
        } catch (error) {
          // User not registered in selected organization
          delete sandboxOrgCodeTracker[mobileNumber];

          const registrationUrl = emailTenantService.getSandboxRegistrationUrl(email);
          channelProvider.sendMessageToUser(
            { mobileNumber: mobileNumber },
            [`Mobile ${mobileNumber} not registered with ${selectedOrg.name}.\n\nComplete registration at:\n${registrationUrl}\n\nUse email: ${email}`],
            reformattedMessage.extraInfo
          );
          return;
        }
      } else if (!isWaitingForEmail && !isGreeting) {
        // Subsequent message after email/org is set: resolve the user via the
        // tracker (mobileNumber -> {orgTenantId, userId}) so the session is
        // keyed by user.userId just like the normal flow.
        if (trackerEntry && trackerEntry.orgTenantId) {
          const orgTenantId = trackerEntry.orgTenantId;
          try {
            user = await userService.getUserForMobileNumber(
              mobileNumber,
              orgTenantId
            );
            userId = user.userId;
            reformattedMessage.user = user;
            reformattedMessage.extraInfo.tenantId = orgTenantId;
            reformattedMessage.extraInfo.organizationTenantId = orgTenantId;
            // Refresh tracker so it doesn't expire mid-conversation; keep userId in sync.
            trackerEntry.timestamp = Date.now();
            trackerEntry.userId = userId;
          } catch (error) {
            channelProvider.sendMessageToUser(
              { mobileNumber: mobileNumber },
              ["Session expired or user not found. Please type 'Hi' to start again."],
              reformattedMessage.extraInfo
            );
            return;
          }
        } else {
          // No tracker entry (cold start, restart, or expired) - ask to greet again.
          channelProvider.sendMessageToUser(
            { mobileNumber: mobileNumber },
            ["Welcome! Please type 'Hi' to start."],
            reformattedMessage.extraInfo
          );
          return;
        }
      }
    } else {
      // Non-sandbox mode: use rootTenantId from config
      try {
        user = await userService.getUserForMobileNumber(
          mobileNumber,
          config.rootTenantId
        );
        userId = user.userId;
        reformattedMessage.user = user;
        reformattedMessage.extraInfo.tenantId = config.rootTenantId;
      } catch (error) {
        channelProvider.sendMessageToUser(
          { mobileNumber: mobileNumber },
          [`Sorry, there was an error processing your request. Please check your mobile number format (should be 10 digits) and try again. Error: ${error.message}`],
          reformattedMessage.extraInfo
        );
        return;
      }
    }

    // At this point, we should have a valid user and userId
    // If not, we can't continue (something went wrong in the flow)
    if (!user || !userId) {
      return;
    }

    // Use user.userId (KeyCloak UUID) as the session storage key in both sandbox
    // and normal mode. This matches the legacy normal flow and keeps onTransition's
    // updateState (which keys by state.context.user.userId) in sync with insertNewState.
    const sessionUserId = userId;

    await chatStateRepository.updateSessionId(sessionUserId, config.avgSessionTime);
    let chatState = await chatStateRepository.getActiveStateForUserId(sessionUserId);
    telemetry.log(sessionUserId, "from_user", reformattedMessage);

    // handle reset case
    let intention = dialog.get_intention(
      grammer.reset,
      reformattedMessage,
      true
    );
    // if (intention == 'reset' && chatState) {
    //     chatStateRepository.updateState(userId, false, JSON.stringify(chatState));
    //     chatState = null; // so downstream code treats this like an inactive state and creates a new machine
    // }

    let service;
    if (!chatState) {
      // come here if virgin dialog, old dialog was inactive, or reset case
      chatState = this.createChatStateFor(user);
      let saveState = JSON.parse(JSON.stringify(chatState));
      saveState = this.removeUserDataFromState(saveState);
      let sessionId = uuid.v4();
      await chatStateRepository.insertNewState(
        sessionUserId,
        true,
        JSON.stringify(saveState),
        sessionId,
        new Date().getTime()
      );
    }
    service = this.getChatServiceFor(chatState, reformattedMessage);

    let event;
    if (intention == "reset") {
      event = "USER_RESET";
    } else {
      event = "USER_MESSAGE";
    }
    // let event = intention == "reset" ? "USER_RESET" : "USER_MESSAGE";
    service.send(event, reformattedMessage);
  }
  async toUser(user, outputMessages, extraInfo) {
    channelProvider.sendMessageToUser(user, outputMessages, extraInfo);
    for (let message of outputMessages) {
      telemetry.log(user.userId, "to_user", {
        message: { type: "text", output: message, locale: user.locale },
      });
    }
  }

  removeUserDataFromState(state) {
    let userId = state.context.user.userId;
    let locale = state.context.user.locale;
    let mobileNumber = state.context.user.mobileNumber;
    state.context.user = undefined;
    state.context.user = { locale: locale, userId: userId, mobileNumber: mobileNumber };
    state.event = {};
    state._event = {};
    if (state.history) state.history.context.user = {};

    return state;
  }

  // Method to get tenant ID for a mobile number from tracker (for image uploads)
  getTenantForMobileNumber(mobileNumber) {
    if (config.enableSandboxMode && sandboxOrgCodeTracker[mobileNumber]) {
      return sandboxOrgCodeTracker[mobileNumber].orgTenantId || null;
    }
    return null;
  }

  getChatServiceFor(chatStateJson, reformattedMessage) {
    const context = chatStateJson.context;
    context.chatInterface = this;
    let locale = context.user.locale;
    let savedMobileNumber = context.user.mobileNumber; // Preserve the saved mobileNumber
    context.user = reformattedMessage.user;
    context.user.locale = locale;
    // Ensure mobileNumber is always present
    if (!context.user.mobileNumber && savedMobileNumber) {
      context.user.mobileNumber = savedMobileNumber;
    }
    context.extraInfo = reformattedMessage.extraInfo;

    const state = State.create(chatStateJson);
    const resolvedState = sevaStateMachine
      .withContext(context)
      .resolveState(state);
    const service = interpret(sevaStateMachine).start(resolvedState);

    service.onTransition((state) => {
      if (state.changed) {
        let userId = state.context.user.userId;
        let stateStrings = state.toStrings();
        let sourceStrings = state.history.toStrings();

        let active = !state.done && !state.forcedClose;
        let saveState = JSON.parse(JSON.stringify(state)); // deep copy
        saveState = this.removeUserDataFromState(saveState);
        let timeStamp = new Date().getTime();
        (async () => {
          await chatStateRepository.updateState(
            userId,
            active,
            JSON.stringify(saveState),
            timeStamp
          );
          let sessionId = await chatStateRepository.getSessionId(userId);
          telemetry.log(userId, "transition", {
            input: reformattedMessage.message.input,
            source: sourceStrings[sourceStrings.length - 1],
            destination: stateStrings[stateStrings.length - 1],
            locale: locale,
            sessionId: sessionId,
            timestamp: timeStamp,
            extraInfo: reformattedMessage.extraInfo,
          });
        })();
      }
    });

    return service;
  }

  createChatStateFor(user) {
    let service = interpret(
      sevaStateMachine.withContext({
        chatInterface: this,
        user: user,
        slots: { pgr: {} },
      })
    );
    service.start();
    return service.state;
  }

  system_error(message) {
    system.error(message);
  }
}

let grammer = {
  reset: [
    {
      intention: "reset",
      recognize: ["Hello", "hello", "Hi", "hi", "egov", "seva", "सेवा", "start", "Start", "help", "Help"],
    },
  ],
};

module.exports = new SessionManager();
