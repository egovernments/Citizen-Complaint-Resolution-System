const channelProvider = require("../channel");
const chatStateRepository = require("./repo");
const userService = require("./user-service");
const emailTenantService = require("../machine/service/email-tenant-service");
const config = require("../env-variables");
const Session = require("./session");

class SandboxLoginFlow {
  constructor(inboundRequestModel, tracker, authenticateUser) {
    this.inboundRequestModel = inboundRequestModel;
    this.inboundMessage = inboundRequestModel.getMessage();
    this.mobileNumber = inboundRequestModel.user.mobileNumber;
    this.tracker = tracker;
    this.authenticateUser = authenticateUser;
  }

  async resolveSession() {
    this.tracker.expireIfStale(this.mobileNumber);

    if (this.inboundMessage.isGreeting()) {
      return this.resolveGreeting();
    }
    if (this.tracker.isWaitingForEmail(this.mobileNumber)) {
      return this.resolveEmail();
    }
    if (this.tracker.isWaitingForOrgSelection(this.mobileNumber)) {
      return this.resolveOrgSelection();
    }
    return this.resolveReturningUser();
  }

  notifyAndStop(messages) {
    channelProvider.sendMessageToUser(
      { mobileNumber: this.mobileNumber },
      messages,
      this.inboundRequestModel.extraInfo
    );
    return null;
  }

  createSession(user, tenantId, extra = {}) {
    this.inboundRequestModel.user = user;
    this.inboundRequestModel.extraInfo.tenantId = tenantId;
    this.inboundRequestModel.extraInfo.organizationTenantId = tenantId;
    Object.assign(this.inboundRequestModel.extraInfo, extra);
    return Session.create(user);
  }

  async resolveGreeting() {
    const entry = this.tracker.get(this.mobileNumber);

    // Already authenticated - continue the flow instead of asking for email again.
    if (this.tracker.isAuthenticated(this.mobileNumber)) {
      return this.createSession({ userId: entry.userId }, entry.orgTenantId);
    }

    // If the user was previously authenticated but the session expired, clean up the old state.
    const priorUserId = this.tracker.getUserId(this.mobileNumber);
    if (priorUserId) {
      await chatStateRepository.updateState(priorUserId, false, null);
    }

    // New user or session expired - ask for email.
    this.tracker.set(this.mobileNumber, { waitingForEmail: true });
    return this.notifyAndStop([
      "Welcome to Citizen Complaint Service\n\nEnter your registered email address"
    ]);
  }

  async resolveEmail() {
    const email = this.inboundMessage.getInputMessage()?.toLowerCase();
    const result = await emailTenantService.findTenantByEmail(email);

    if (!result) {
      const registrationUrl = `${config.sandboxHost}/sandbox-ui/user/sign-up`;
      return this.notifyAndStop([
        `Email '${email}' not found.\n\nPlease enter a registered email address or register at:\n${registrationUrl}`
      ]);
    }

    if (result.multiple) {
      this.tracker.set(this.mobileNumber, {
        waitingForEmail: false,
        waitingForOrgSelection: true,
        email,
        tenantOptions: result.tenants
      });

      let orgListMessage = `Found ${result.tenants.length} organizations for: ${email}\n\nSelect your organization:\n\n`;
      result.tenants.forEach((tenant, index) => {
        orgListMessage += `${index + 1}. ${tenant.name || tenant.code}\n`;
      });
      orgListMessage += `\nEnter number (1-${result.tenants.length})`;

      return this.notifyAndStop([orgListMessage]);
    }

    return this.authenticateForOrg(result.tenants[0], email);
  }

  async resolveOrgSelection() {
    const entry = this.tracker.get(this.mobileNumber);
    const selectionNum = parseInt(this.inboundMessage.getInputMessage());

    if (isNaN(selectionNum) || selectionNum < 1 || selectionNum > entry.tenantOptions.length) {
      return this.notifyAndStop([
        `Invalid selection. Enter a number between 1 and ${entry.tenantOptions.length}`
      ]);
    }

    return this.authenticateForOrg(
      entry.tenantOptions[selectionNum - 1],
      entry.email,
      'Error in getAuthenticatedSandboxUser (org selection)'
    );
  }

  async resolveReturningUser() {
    const entry = this.tracker.get(this.mobileNumber);

    // No tracker entry (cold start, restart, or expired) - ask to greet again.
    if (!this.tracker.isAuthenticated(this.mobileNumber)) {
      return this.notifyAndStop(["Welcome! Please type 'Hi' to start."]);
    }

    try {
      const user = await userService.getUserForMobileNumber(this.mobileNumber, entry.orgTenantId);
      // Refresh tracker so it doesn't expire mid-conversation; keep userId in sync.
      entry.timestamp = Date.now();
      entry.userId = user.userId;
      return this.createSession(user, entry.orgTenantId);
    } catch (error) {
      return this.notifyAndStop(["Session expired or user not found. Please type 'Hi' to start again."]);
    }
  }

  async authenticateForOrg(orgDetails, email, logContext = 'Error in getAuthenticatedSandboxUser') {
    try {
      const user = await this.authenticateUser(this.mobileNumber, orgDetails.code);

      // Persist mobileNumber -> {orgTenantId, userId} so subsequent messages can
      // resolve the user UUID without re-asking for the org code.
      this.tracker.set(this.mobileNumber, {
        waitingForEmail: false,
        waitingForOrgSelection: false,
        orgTenantId: orgDetails.code,
        userId: user.userId,
        orgEmail: email
      });

      return this.createSession(user, orgDetails.code, { organizationName: orgDetails.name });
    } catch (error) {
      console.error(`${logContext}:`, error);
      this.tracker.delete(this.mobileNumber);

      const registrationUrl = emailTenantService.getSandboxRegistrationUrl(email);
      return this.notifyAndStop([
        `Mobile ${this.mobileNumber} not registered with ${orgDetails.name}.\n\nComplete registration at:\n${registrationUrl}\n\nUse email: ${email}`
      ]);
    }
  }
}

module.exports = SandboxLoginFlow;
