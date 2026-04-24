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

class SessionManager {
  async fromUser(reformattedMessage) {
    let mobileNumber = reformattedMessage.user.mobileNumber;
    let user;
    try {
      user = await userService.getUserForMobileNumber(
        mobileNumber,
        reformattedMessage.extraInfo.tenantId
      );
      reformattedMessage.user = user;
    } catch (error) {
      console.error(`Failed to get/create user for ${mobileNumber}:`, error.message);
      // Send error message to user instead of crashing
      channelProvider.sendMessageToUser(
        { mobileNumber: mobileNumber },
        [`Sorry, there was an error processing your request. Please check your mobile number format (should be 10 digits) and try again. Error: ${error.message}`],
        reformattedMessage.extraInfo
      );
      return; // Exit gracefully instead of crashing
    }
    let userId = user.userId;

    await chatStateRepository.updateSessionId(userId, config.avgSessionTime);
    let chatState = await chatStateRepository.getActiveStateForUserId(userId);
    telemetry.log(userId, "from_user", reformattedMessage);

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
        userId,
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
    } else if (intention == "swachreset") {
      event = "USER_SWACH_RESET";
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
        slots: { pgr: {}, bills: {}, receipts: {}, swach: {} },
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
      recognize: ["Hello", "hello", "Hi", "hi", "egov", "seva", "सेवा"],
    },
    {
      intention: "swachreset",
      recognize: ["swach"],
    },
  ],
};

module.exports = new SessionManager();
