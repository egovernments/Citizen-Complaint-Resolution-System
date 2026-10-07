const InboundMessage = require("./inbound-message.js");

class InboundRequestModel {
  constructor(raw) {
    this.user = raw.user;
    this.message = raw.message;
    this.extraInfo = raw.extraInfo;
  }

  static create(raw) {
    return new InboundRequestModel(raw);
  }

  getMessage() {
    if (!this._inboundMessage) {
      this._inboundMessage = InboundMessage.create(this.message);
    }
    return this._inboundMessage;
  }
}

module.exports = InboundRequestModel;
