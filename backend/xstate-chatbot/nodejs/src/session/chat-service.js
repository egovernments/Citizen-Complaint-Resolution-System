const stateMachine = require("../machine/state-machine");
const { State, interpret } = require("xstate");
const chatStateRepository = require("./repo");
const ChatState = require("./chat-state");
const telemetry = require("./telemetry");
const uuid = require("uuid");
const config = require("../env-variables");
const dialog = require("../machine/util/dialog");
const messages = require("../machine/flow/shell-messages");
const { hasActiveInvoke, waitUntilSettled } = require("./invoke-state");
const { enqueuePersist, pendingPersist } = require("./persist-queue");


class ChatService {
  constructor(sessionManager) {
    this.sessionManager = sessionManager;
  }

  // Use user.userId (KeyCloak UUID) as the session storage key in both sandbox
  // and normal mode. This matches the legacy normal flow and keeps onTransition's
  // updateState (which keys by state.context.user.userId) in sync with insertNewState.
  async dispatch(session, inboundRequestModel) {
    const sessionUserId = session.userId;
    
    const verdict = await this.resumePromptVerdict(sessionUserId, inboundRequestModel);

    if (verdict === "answer") return this.resolveResumeChoice(session, inboundRequestModel);

    // The user has issued a cancel or reset command, so we override the pending resume prompt.
    if (verdict === "override") {
      const message = inboundRequestModel.getMessage();
      await chatStateRepository.clearResumePending(sessionUserId);
      return this.restartSession(session, inboundRequestModel, message.isCancel() ? "USER_CANCEL" : "USER_RESET");
    }

    // The pending resume prompt has been abandoned due to session expiration.
    if (verdict === "abandoned") {
      await chatStateRepository.clearResumePending(sessionUserId);
    }

    const chatState = await this.getOrCreateChatState(sessionUserId, session.user, inboundRequestModel);
    if (!chatState) return; // awaiting the citizen's resume/restart choice

    await chatStateRepository.updateSessionId(sessionUserId, config.avgSessionTime);
    telemetry.log(sessionUserId, "from_user", inboundRequestModel);

    const stateMachineService = this.getStateMachineServiceFor(chatState, inboundRequestModel);

    const message = inboundRequestModel.getMessage();
    const event = message.isCancel() ? "USER_CANCEL" : message.isReset() ? "USER_RESET" : "USER_MESSAGE";

    stateMachineService.send(event, inboundRequestModel);

    const settled = await waitUntilSettled(stateMachineService);
    if (!settled) this.abandonStalledSession(session, inboundRequestModel);
    return pendingPersist(sessionUserId);
  }

  /**
   * Handles the scenario where a session has stalled due to an active state machine invocation not completing.
   * Persists the current state and notifies the user that their submission could not be processed.
   */
  abandonStalledSession(session, inboundRequestModel) {
    const persistableState = this.createChatStateFor(session.user).toPersistableState().state;

    enqueuePersist(session.userId, () =>
      chatStateRepository.updateState(session.userId, false, persistableState, new Date().getTime())
    );

    this.sessionManager.toUser(
      session.user,
      [dialog.get_message(messages.submissionStalled, session.user.locale)],
      inboundRequestModel.extraInfo
    );
  }


  /**
   * How a pending resume prompt should be treated for this message:
   *   'answer'    — the citizen is answering it (1 or 2)
   *   'override'  — a cancel or reset word: not an answer, so honour the word
   *   'abandoned' — nobody answered within a session, so re-prompt
   *   null        — no prompt pending
   *
   * Read from the row, not a process-local Map: a restart between asking and
   * answering used to lose the prompt entirely.
   */
  async resumePromptVerdict(sessionUserId, inboundRequestModel) {
    if (typeof chatStateRepository.getResumePendingAt !== "function") return null;

    const pendingAt = await chatStateRepository.getResumePendingAt(sessionUserId);
    if (!pendingAt) return null;

    const message = inboundRequestModel.getMessage();
    if (message.isCancel() || message.isReset()) return "override";
    if ((Date.now() - pendingAt) / 1000 / 60 > config.avgSessionTime) return "abandoned";
    return "answer";
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
      // The expired blob stays in the row untouched; only the "awaiting an answer"
      // marker is new, so a restart resumes the prompt rather than losing it.
      if (typeof chatStateRepository.setResumePending === "function") {
        await chatStateRepository.setResumePending(sessionUserId, Date.now());
      }
      
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
  // discards it and restarts via the same USER_RESET path "reiniciar" uses.
  async resolveResumeChoice(session, inboundRequestModel) {
    const sessionUserId = session.userId;
    const answer = inboundRequestModel.getMessage().getInputMessage();

    if (answer === '1') {
      // The expired state was never removed from the row, so it is read back here
      // rather than carried in memory between two webhook calls.
      const existingState = await chatStateRepository.getActiveStateForUserId(sessionUserId);
      await chatStateRepository.clearResumePending(sessionUserId);

      // Nothing left to resume (row cleared meanwhile): start clean rather than
      // throwing on a missing state.
      if (!existingState) return this.restartSession(session, inboundRequestModel);

      await chatStateRepository.updateState(sessionUserId, true, existingState.toPersistableState().state, new Date().getTime());
      const lastPrompt = existingState.context.lastPrompt;
      this.sessionManager.toUser(session.user, [lastPrompt || dialog.get_message(messages.sessionExpired.resumed, session.user.locale)], inboundRequestModel.extraInfo);
      return;
    }

    if (answer === '2') {
      await chatStateRepository.clearResumePending(sessionUserId);
      return this.restartSession(session, inboundRequestModel);
    }

    this.sessionManager.toUser(session.user, [dialog.get_message(messages.sessionExpired.invalid, session.user.locale)], inboundRequestModel.extraInfo);
  }

  // decides where it lands: USER_RESET goes to the menu, USER_CANCEL ends the
  // session — the citizen's own word chooses, not this method.
  async restartSession(session, inboundRequestModel, event = "USER_RESET") {
    const chatState = this.createChatStateFor(session.user);
    await chatStateRepository.updateState(session.userId, true, chatState.toPersistableState().state, new Date().getTime());
    await chatStateRepository.updateSessionId(session.userId, config.avgSessionTime);
    
    const stateMachineService = this.getStateMachineServiceFor(chatState, inboundRequestModel);
    stateMachineService.send(event, inboundRequestModel);
    return pendingPersist(session.userId);
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

      // Skip persisting the state if it has an active invocation.
      if (hasActiveInvoke(state)) return;


      const userId = state.context.user.userId;
      const stateStrings = state.toStrings();
      const sourceStrings = state.history.toStrings();
      const active = !state.done && !state.forcedClose;
      const persistableState = ChatState.create(state).toPersistableState();
      const timeStamp = new Date().getTime();

      enqueuePersist(userId, async () => {
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
      });
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
