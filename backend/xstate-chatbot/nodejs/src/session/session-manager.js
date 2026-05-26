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
const organizationService = require("../machine/service/organization-service");

// Simple in-memory store for tracking org code requests in sandbox mode
// Format: { mobileNumber: { timestamp: Date, waitingForOrgCode: boolean } }
const sandboxOrgCodeTracker = {};

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
    
    // In sandbox mode, handle org code flow without creating sessions
    if (config.enableSandboxMode) {
      const isGreeting = isReset || (messageInput && ['hi', 'hello', 'hey', 'start', 'help', 'seva', 'egov'].includes(messageInput.trim()));
      
      // Check if we're waiting for org code from this number
      const trackerEntry = sandboxOrgCodeTracker[mobileNumber];
      const isWaitingForOrgCode = trackerEntry && trackerEntry.waitingForOrgCode;
      
      // Clean up old entries (older than 30 minutes)
      if (trackerEntry && (Date.now() - trackerEntry.timestamp) > 30 * 60 * 1000) {
        delete sandboxOrgCodeTracker[mobileNumber];
      }
      
      if (isGreeting) {
        // Every greeting starts fresh - always ask for org code
        // Clear any existing session to ensure fresh start
        await chatStateRepository.updateState(mobileNumber, false, null);
        
        sandboxOrgCodeTracker[mobileNumber] = {
          timestamp: Date.now(),
          waitingForOrgCode: true
        };
        
        channelProvider.sendMessageToUser(
          { mobileNumber: mobileNumber },
          ["Welcome to the Sandbox WhatsApp Service! 🏛️\n\nPlease enter your organization code to continue."],
          reformattedMessage.extraInfo
        );
        return; // Exit early - no session creation
      } else if (isWaitingForOrgCode && !isGreeting) {
        // User is providing org code - validate it
        const orgCode = reformattedMessage.message.input?.trim();
        const orgDetails = await organizationService.validateOrganizationCode(orgCode);
        
        if (!orgDetails) {
          // Invalid org code - ask again
          channelProvider.sendMessageToUser(
            { mobileNumber: mobileNumber },
            [`Invalid organization code '${orgCode}'.\n\nPlease enter a valid organization code or type 'Hi' to restart.`],
            reformattedMessage.extraInfo
          );
          return; // Exit early - no session creation
        }
        
        // Valid org code - clear tracker and proceed with user creation
        delete sandboxOrgCodeTracker[mobileNumber];
        
        // Try to get/create user in the organization's tenant
        try {
          user = await userService.getUserForMobileNumber(
            mobileNumber,
            orgDetails.code
          );
          userId = user.userId;
          reformattedMessage.user = user;
          reformattedMessage.extraInfo.tenantId = orgDetails.code;
          reformattedMessage.extraInfo.organizationTenantId = orgDetails.code;
          reformattedMessage.extraInfo.organizationName = orgDetails.name;
          // Store org code in context for use throughout the flow
        } catch (error) {
          console.error(`Failed to get/create user for ${mobileNumber} in tenant ${orgDetails.code}:`, error.message);
          
          // User not registered in this organization - show registration URL
          const registrationUrl = organizationService.getSandboxRegistrationUrl(orgDetails.code);
          channelProvider.sendMessageToUser(
            { mobileNumber: mobileNumber },
            [`You are not registered with organization '${orgDetails.name}'.\n\nPlease register at:\n${registrationUrl}\n\nOnce registered, type 'Hi' to start again.`],
            reformattedMessage.extraInfo
          );
          return; // Exit early - no session creation
        }
      } else if (!isWaitingForOrgCode && !isGreeting) {
        // Check if user has an existing session with org code
        let existingState = await chatStateRepository.getActiveStateForUserId(mobileNumber);
        
        if (existingState && existingState.context?.extraInfo?.organizationTenantId) {
          // User has existing session with org code - use it for continued conversation
          const orgTenantId = existingState.context.extraInfo.organizationTenantId;
          try {
            user = await userService.getUserForMobileNumber(
              mobileNumber,
              orgTenantId
            );
            userId = user.userId;
            reformattedMessage.user = user;
            reformattedMessage.extraInfo.tenantId = orgTenantId;
            reformattedMessage.extraInfo.organizationTenantId = orgTenantId;
          } catch (error) {
            console.error(`Failed to get user for ${mobileNumber} in tenant ${orgTenantId}:`, error.message);
            // Session exists but user not found - ask to restart
            channelProvider.sendMessageToUser(
              { mobileNumber: mobileNumber },
              ["Session expired or user not found. Please type 'Hi' to start again."],
              reformattedMessage.extraInfo
            );
            return;
          }
        } else {
          // No existing session and not a greeting - ask to start with Hi
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
        console.error(`Failed to get/create user for ${mobileNumber}:`, error.message);
        channelProvider.sendMessageToUser(
          { mobileNumber: mobileNumber },
          [`Sorry, there was an error processing your request. Please check your mobile number format (should be 10 digits) and try again. Error: ${error.message}`],
          reformattedMessage.extraInfo
        );
        return;
      }
    }
    
    // At this point, we have a valid user and userId
    // Now we can create or update the session
    
    // Use mobileNumber as userId for session storage in sandbox mode
    // This ensures consistency across the flow
    const sessionUserId = config.enableSandboxMode ? mobileNumber : userId;
    
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
    state.context.user = undefined;
    state.context.user = { locale: locale, userId: userId };
    state.event = {};
    state._event = {};
    if (state.history) state.history.context.user = {};

    return state;
  }

  getChatServiceFor(chatStateJson, reformattedMessage) {
    const context = chatStateJson.context;
    context.chatInterface = this;
    let locale = context.user.locale;
    context.user = reformattedMessage.user;
    context.user.locale = locale;
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
