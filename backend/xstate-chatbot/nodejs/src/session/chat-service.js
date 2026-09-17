const stateMachine = require("../machine/state-machine");
const { State, interpret } = require("xstate");
const chatStateRepository = require("./repo");
const ChatState = require("./chat-state");
const telemetry = require("./telemetry");
const uuid = require("uuid");
const config = require("../env-variables");
const dialog = require("../machine/util/dialog");
const messages = require("../machine/flow/shell-messages");

// Users awaiting a resume-or-restart choice after their session expired -
// keyed by sessionUserId, holding the expired ChatState to restore if they
// choose to resume.
const resumeChoicePending = new Map();

class ChatService {
  constructor(sessionManager) {
    this.sessionManager = sessionManager;
  }

  // Use user.userId (KeyCloak UUID) as the session storage key in both sandbox
  // and normal mode. This matches the legacy normal flow and keeps onTransition's
  // updateState (which keys by state.context.user.userId) in sync with insertNewState.
  async dispatch(session, inboundRequestModel) {
    const sessionUserId = session.userId;

    if (resumeChoicePending.has(sessionUserId)) {
      return this.resolveResumeChoice(session, inboundRequestModel);
    }

    const chatState = await this.getOrCreateChatState(sessionUserId, session.user, inboundRequestModel);
    if (!chatState) return; // awaiting the citizen's resume/restart choice

    await chatStateRepository.updateSessionId(sessionUserId, config.avgSessionTime);
    telemetry.log(sessionUserId, "from_user", inboundRequestModel);

    const stateMachineService = this.getStateMachineServiceFor(chatState, inboundRequestModel);

    const message = inboundRequestModel.getMessage();
    const event = message.isCancel() ? "USER_CANCEL" : message.isReset() ? "USER_RESET" : "USER_MESSAGE";

    stateMachineService.send(event, inboundRequestModel);
  }


  /**
   * Retrieves the active chat state for the given user. If no active state exists,
   * a new chat state is created, persisted, and returned.
   */
  async getOrCreateChatState(sessionUserId, user, inboundRequestModel) {
    const existingState = await chatStateRepository.getActiveStateForUserId(sessionUserId);
    const isExpiredSession = await this.isSessionExpired(sessionUserId);

    if (existingState && !isExpiredSession) {
      return existingState;
    }

    if (existingState && isExpiredSession) {
      resumeChoicePending.set(sessionUserId, existingState);
      this.sessionManager.toUser(user, [dialog.get_message(messages.sessionExpired.question, user.locale)], inboundRequestModel.extraInfo);
      return null;
    }

    // virgin dialog - no existing state at all
    const chatState = this.createChatStateFor(user);
    const timeStamp = new Date().getTime();
    const sessionId = uuid.v4();
    await chatStateRepository.insertNewState(sessionUserId, true, chatState.toPersistableState().state, sessionId, timeStamp);
    return chatState;
  }
  
  // Handles the citizen's reply to the resume-or-restart prompt: "1" resumes
  // the expired state as-is (their next message continues it normally), "2"
  // discards it and restarts via the same USER_RESET path "voltar" uses.
  async resolveResumeChoice(session, inboundRequestModel) {
    const sessionUserId = session.userId;
    const answer = inboundRequestModel.getMessage().getInputMessage();

    if (answer === '1') {
      const existingState = resumeChoicePending.get(sessionUserId);
      resumeChoicePending.delete(sessionUserId);
      await chatStateRepository.updateState(sessionUserId, true, existingState.toPersistableState().state, new Date().getTime());
      const lastPrompt = existingState.context.lastPrompt;
      this.sessionManager.toUser(session.user, [lastPrompt || dialog.get_message(messages.sessionExpired.resumed, session.user.locale)], inboundRequestModel.extraInfo);
      return;
    }


    if (answer === '2') {
      resumeChoicePending.delete(sessionUserId);
      const chatState = this.createChatStateFor(session.user);
      await chatStateRepository.updateState(sessionUserId, true, chatState.toPersistableState().state, new Date().getTime());
      await chatStateRepository.updateSessionId(sessionUserId, config.avgSessionTime);
      const stateMachineService = this.getStateMachineServiceFor(chatState, inboundRequestModel);
      stateMachineService.send("USER_RESET", inboundRequestModel);
      return;
    }

    this.sessionManager.toUser(session.user, [dialog.get_message(messages.sessionExpired.invalid, session.user.locale)], inboundRequestModel.extraInfo);
  }


  // Postgres tracks last-activity time_stamp; InMemory doesn't need this
  // feature, so it simply has no getLastActivityTimestamp to call.
  async isSessionExpired(sessionUserId) {
    if (typeof chatStateRepository.getLastActivityTimestamp !== "function") return false;
    const lastActivity = await chatStateRepository.getLastActivityTimestamp(sessionUserId);
    if (!lastActivity) return false;
    return (Date.now() - lastActivity) / 1000 / 60 > config.avgSessionTime;
  }


  /**
   * Retrieves the state machine service for the given chat state and reformatted message.
   */
  getStateMachineServiceFor(chatState, reformattedMessage) {
    const context = this.refreshContext(chatState.context, reformattedMessage);
    const locale = context.user.locale;
    const resolvedState = this.resolvePersistedState(chatState, context);

    const stateMachineService = this.startService(resolvedState, context);
    this.addTransitionPersistanceHandler(stateMachineService, reformattedMessage, locale);

    return stateMachineService;
  }

  startService(resolvedState, context) {
    return interpret(stateMachine).start(resolvedState)
  }

  // On every state change, persist the sanitized state and log the transition.
  // Fire-and-forget: the caller already has the stateMachineService and must not block on this.
  addTransitionPersistanceHandler(stateMachineService, reformattedMessage, locale) {
    stateMachineService.onTransition((state) => {
      if (!state.changed) return;

      const userId = state.context.user.userId;
      const stateStrings = state.toStrings();
      const sourceStrings = state.history.toStrings();
      const active = !state.done && !state.forcedClose;
      const persistableState = ChatState.create(state).toPersistableState();
      const timeStamp = new Date().getTime();

      (async () => {
        await chatStateRepository.updateState(
          userId,
          active,
          persistableState.state,
          timeStamp
        );
        const sessionId = await chatStateRepository.getSessionId(userId);
        
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
    });
  }

  // Merges the inbound message's user/extraInfo into a persisted context,
  // preserving locale and falling back to the saved mobileNumber if the new
  // message didn't carry one.
  refreshContext(context, reformattedMessage) {
    
    const savedMobileNumber = context.user.mobileNumber;
    const savedLocale = context.user.locale;
    
    context.chatInterface = this.sessionManager;
    context.user = reformattedMessage.user;
    context.user.locale = reformattedMessage.user.locale || savedLocale;

    if (!context.user.mobileNumber && savedMobileNumber)
      context.user.mobileNumber = savedMobileNumber;
    
    context.extraInfo = reformattedMessage.extraInfo;

    return context;
  }


  // A persisted state.value naming a state the machine no longer has makes
  // resolveState throw, and it throws BEFORE service.send — so not even
  // USER_RESET can recover the session and the row stays active forever.
  // Discard the position (and the stale scratch context that described it)
  // and start over at `start`, which routes the incoming message to #welcome.
  resolvePersistedState(chatState, context) {
    try {
      return stateMachine
        .withContext(context)
        .resolveState(State.create(chatState.raw));
    } catch (error) {
      console.error(
        `Discarding unresolvable chat state for user ${context.user.userId}: ${error.message}`
      );
      return stateMachine.withContext({
        chatInterface: this.sessionManager,
        user: context.user,
        extraInfo: context.extraInfo,
        slots: { pgr: {} },
      }).initialState;
    }
  }

  createChatStateFor(user) {
    let stateMachineService = interpret(
      stateMachine.withContext({
        chatInterface: this.sessionManager,
        user: user,
        slots: { pgr: {} },
      })
    );
    stateMachineService.start();
    return ChatState.create(stateMachineService.state);
  }
}

module.exports = ChatService;
