const channelProvider = require("../channel");
const userService = require("./user-service");
const config = require("../env-variables");
const Session = require("./session");
const dialog = require("../machine/util/dialog");
const messages = require("../machine/flow/shell-messages");
const { maskMobile } = require("../privacy");
const { isWhitelisted: isNumberAllowed } = require("../whitelist");

class StandardLoginFlow {
  constructor(inboundRequestModel) {
    this.inboundRequestModel = inboundRequestModel;
    this.mobileNumber = inboundRequestModel.user.mobileNumber;
  }

  isWhitelisted() {
    return isNumberAllowed(this.mobileNumber);
  }

  async resolveSession() {
    if (!this.isWhitelisted()) {
      console.log(`Rejecting message from non-whitelisted number: ${maskMobile(this.mobileNumber)}`);
      
      // Reply from the raw number, not a user record — nothing has been created.
      // Awaited: unawaited, a ValueFirst transport error here is an unhandled
      // rejection, and the caller returns null before the reply is even sent.
      await channelProvider.sendMessageToUser(
        { mobileNumber: this.mobileNumber, locale: config.defaultLocale },
        [dialog.get_message(messages.notAuthorized, config.defaultLocale)],
        this.inboundRequestModel.extraInfo
      );

      return null;
    }

    const user = await userService.getUserForMobileNumber(this.mobileNumber, config.rootTenantId);
    this.inboundRequestModel.user = user;
    this.inboundRequestModel.extraInfo.tenantId = config.rootTenantId;
    return Session.create(user);
  }
}

module.exports = StandardLoginFlow;
