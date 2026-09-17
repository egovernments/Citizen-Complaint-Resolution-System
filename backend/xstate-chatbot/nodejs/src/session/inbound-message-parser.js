/**
 * Turns one inbound HTTP request into the neutral "reformatted message" the
 * session layer consumes, delegating the provider-specific work to the channel
 * adapter it is given.
 *
 * Deliberately dependency-free: the adapter and the upload tenant are both
 * supplied by the caller, so this class knows nothing about session state, user
 * identity or configuration. A `null` message is a normal outcome rather than an
 * error — it means the payload was not a user message, a delivery receipt for
 * instance.
 */
const config = require('../env-variables');
const { ValidationError } = require('./errors');


const InboundMessage = require("../machine/util/inbound-message.js");

class InboundRequestParser {
  constructor(req, provider, tenantId = null) {
    this.req = req;
    this.provider = provider;
    this.tenantId = tenantId;
    this.inboundMessageModel = null;
  }

  static create(req, provider) {
    if (!provider)
      throw new ValidationError("InboundRequestParser: a channel provider is required.");

    const instance = new InboundRequestParser(req, provider);
    instance.parseRequestBody();
    instance.resolveTenantId();

    return instance;
  }

  async hasValidMessage() { 
    return await this.provider.isValid(this.requestBody);
  }

  async getRequestModel() { 
    return await this.provider.getFormattedMessageFromUser(
      this.requestBody,
      this.tenantId
    );
  }

  resolveTenantId() {
    // Use provided tenant ID, or fall back to query parameter, or use default
    const tenantId = this.tenantId || this.req.query.tenantId || config.rootTenantId;
    this.tenantId = tenantId;
  }
  
  parseRequestBody() {
    this.requestBody = this.provider.extractRawMessage(this.req) || {};
  }

  getInboundMessage() {
    return InboundMessage.create(this.inboundMessageModel.message);
  }

  getUser() {
    return this.inboundMessageModel.user;
  }

  getExtraInfo() {
    return this.inboundMessageModel.extraInfo;
  }

  setTenatId(tenantId) { 
    this.tenantId = tenantId;
  }

}

module.exports = InboundRequestParser;
