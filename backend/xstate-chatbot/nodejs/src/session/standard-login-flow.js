const channelProvider = require("../channel");
const userService = require("./user-service");
const config = require("../env-variables");
const Session = require("./session");

class StandardLoginFlow {
  constructor(inboundRequestModel) {
    this.inboundRequestModel = inboundRequestModel;
    this.mobileNumber = inboundRequestModel.user.mobileNumber;
  }

  async resolveSession() {
      const user = await userService.getUserForMobileNumber(this.mobileNumber, config.rootTenantId);
      this.inboundRequestModel.user = user;
      this.inboundRequestModel.extraInfo.tenantId = config.rootTenantId;
      return Session.create(user);
  }
}

module.exports = StandardLoginFlow;
