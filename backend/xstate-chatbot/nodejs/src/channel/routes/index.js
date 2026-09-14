const express = require("express"),
  router = express.Router(),
  config = require("../../env-variables"),
  sessionManager = require("../../session/session-manager"),
  channelProvider = require("../"),
  twilioSignature = require("../twilio-signature"),
  mobileValidation = require("../../machine/service/mobile-validation-service"),
  remindersService = require("../../machine/service/reminders-service");

/**
 * Authenticate an inbound provider webhook.
 *
 * Only Twilio has a signature scheme wired up here. Other providers fall through as
 * authenticated so their existing behaviour is unchanged -- adding their equivalent
 * (ValueFirst/Kaleyra have their own schemes) is a per-provider task.
 */
function authenticateWebhook(req, res) {
  if (config.whatsAppProvider !== "Twilio") return true;

  const result = twilioSignature.validateRequest(req);
  if (result.valid) return true;

  // Log the reason, return a bare 403. Telling the caller which half of the check failed
  // just helps them iterate towards a valid forgery.
  console.error("Rejected inbound webhook: " + result.reason);
  res.status(403).json({ status: "forbidden" });
  return false;
}

router.post("/message", async (req, res) => {
  if (!authenticateWebhook(req, res)) return;
  try {
    console.log("Request URL: " + req.originalUrl);
    console.log('Request Body Object: ' + JSON.stringify(req.body));
    
    // Check if this is an image upload in sandbox mode
    let tenantIdForUpload = null;
    if (config.enableSandboxMode && req.body && req.body.NumMedia && parseInt(req.body.NumMedia) > 0) {
      // This is an image upload - resolve the tenant the sender is already working in.
      // The session tracker is keyed by national number, so normalise rather than
      // stripping a literal '+91' (which silently mis-keyed every non-India sender).
      let fromNumber = req.body.From;
      if (fromNumber) {
        const mobileConfig = await mobileValidation.getConfig(config.rootTenantId);
        const mobileNumber =
          mobileValidation.toNational(fromNumber, mobileConfig) ||
          mobileValidation.digitsOnly(fromNumber);
        tenantIdForUpload = sessionManager.getTenantForMobileNumber(mobileNumber);
        console.log(`Image upload detected for ${mobileNumber}, using tenant: ${tenantIdForUpload || 'default'}`);
      }
    }
    
    let reformattedMessage = await channelProvider.processMessageFromUser(req, tenantIdForUpload);
    if (reformattedMessage != null) sessionManager.fromUser(reformattedMessage);
  } catch (e) {
    console.log(e);
  }
  res.end();
});

// Handle WhatsApp delivery status webhooks (both GET and POST)
router.all("/status", async (req, res) => {
  if (!authenticateWebhook(req, res)) return;
  try {
    const isDeliveryStatusWebhook = req.method === 'GET' || 
      req.query.MESSAGE_STATUS || 
      req.body.MESSAGE_STATUS ||
      req.query.TO ||
      req.body.TO;
    
    if (isDeliveryStatusWebhook) {
      // This is a delivery status webhook from WhatsApp provider
      const statusData = req.method === 'GET' ? req.query : req.body;
      
      console.log("WhatsApp Delivery Status Webhook:");
      console.log("Method:", req.method);
      console.log("Status Data:", JSON.stringify(statusData, null, 2));
      
      // Log specific delivery status fields
      const { TO, MESSAGE_STATUS, REASON_CODE, MESSAGE_ID, STATUS_ERROR, TIME, DELIVERED_DATE } = statusData;
      console.log(`Delivery Status - TO: ${TO}, Status: ${MESSAGE_STATUS}, MessageID: ${MESSAGE_ID}`);
      
      // Don't process delivery status as user message
      // Just acknowledge receipt to prevent retries
      res.status(200).json({ status: "received", messageId: MESSAGE_ID });
      return;
    }
    
    // Handle actual user status messages (if any)
    let reformattedMessage = await channelProvider.processMessageFromUser(req);
    if (reformattedMessage != null) {
      sessionManager.fromUser(reformattedMessage);
    }
    
    res.status(200).send("OK");
  } catch (e) {
    console.error("Status endpoint error:", e);
    // Always return 200 OK to prevent webhook provider retries
    res.status(200).json({ status: "error", message: "Internal processing error" });
  }
});

// Fans a message out to EVERY active session, so it is an abuse amplifier if left open.
// Requires a shared secret; with REMINDER_AUTH_TOKEN unset the route is disabled outright
// rather than left reachable.
router.post("/reminder", async (req, res) => {
  const expected = config.reminderAuthToken;
  if (!expected) {
    console.error("Rejected /reminder: REMINDER_AUTH_TOKEN is not set, route is disabled");
    return res.status(404).json({ status: "not found" });
  }
  const presented = req.headers["x-reminder-token"];
  if (presented !== expected) {
    console.error("Rejected /reminder: bad or missing X-Reminder-Token");
    return res.status(403).json({ status: "forbidden" });
  }
  await remindersService.triggerReminders();
  res.end();
});

router.get("/health", (req, res) => res.sendStatus(200));

module.exports = router;
