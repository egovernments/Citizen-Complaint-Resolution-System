const dialog = require("./dialog.js");
const config = require("../../env-variables.js");

const MESSAGE_TYPES = ['text', 'image', 'document', 'location'];
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
    this.input = message.input;
    this.type = message.type;
  }

  static create(message) {
    if (!MESSAGE_TYPES.includes(message.type)) {
      throw new Error("InboundMessageHandler: invalid message type");
    }
    return new InboundMessage(message);
  }

  isUserMessage() {
    return !!this.input && this.input.trim().length > 0;
  }

  isGreeting() {
    return config.resetWords.includes(this.input.trim().toLowerCase());
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
