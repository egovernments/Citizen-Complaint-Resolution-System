const dialog = require("./dialog.js");
const config = require("../../env-variables.js");

// Every type the channels emit. `button` carries real input (ButtonPayload /
// ListId), so it is an ordinary message; audio, video, stickers and bodyless
// webhooks arrive as unsupported/unknown with a blank input, which the current
// state re-prompts for in the citizen's locale.
const MESSAGE_TYPES = ['text', 'image', 'document', 'location', 'button'];
const UNSUPPORTED_TYPES = ['unsupported', 'unknown'];
const KNOWN_TYPES = [...MESSAGE_TYPES, ...UNSUPPORTED_TYPES];

const RESET_GRAMMAR = [
  {
    intention: "reset",
    recognize: config.resetWords,
  },
];
const CANCEL_GRAMMAR = [{
  intention: "cancel",
  recognize: config.cancelWords,
}];

class InboundMessage {
  constructor(message) {
    this.rawInput = message.input;
    this.input = typeof message.input === 'string' ? message.input : '';
    this.type = message.type;
  }

  static create(message) {
    if (!KNOWN_TYPES.includes(message.type)) {
      // Never throw here: dispatch() calls getMessage() after the chat-state row is
      // inserted, the session updated and the interpreter started, so a throw loses
      // the turn entirely and error-handler.js answers in English. Degrading keeps
      // the machine in charge, and it re-prompts in the citizen's own locale.
      console.warn(`Unrecognized inbound message type '${message.type}'; treating as unsupported`);
      return new InboundMessage({ ...message, type: 'unsupported' });
    }
    return new InboundMessage(message);
  }

  isUnsupported() {
    return UNSUPPORTED_TYPES.includes(this.type);
  }


  isUserMessage() {
    return !!this.input && this.input.trim().length > 0;
  }

  isGreeting() {
    const input = dialog.normalizeUtterance(this.input);
    return config.resetWords.some((word) => dialog.normalizeUtterance(word) === input);
  }

  isReset() {
    return dialog.get_intention(RESET_GRAMMAR, { message: { input: this.input } }, true) === 'reset';
  }

  isCancel() {
    return dialog.get_intention(CANCEL_GRAMMAR, { message: { input: this.input } }, true) === 'cancel';
  }

  getInputMessage() {
    return this.input?.trim();
  }
}

module.exports = InboundMessage;
