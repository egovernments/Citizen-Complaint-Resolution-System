const express = require("express"),
  router = express.Router(),
  config = require("../../env-variables"),
  sessionManager = require("../../session/session-manager"),
  channelProvider = require("../");
remindersService = require("../../machine/service/reminders-service");

router.post("/message", async (req, res) => {
  try {
    console.log("Request URL: " + req.originalUrl);
    console.log('Request Body Object: ' + JSON.stringify(req.body));
    let reformattedMessage = await channelProvider.processMessageFromUser(req);
    if (reformattedMessage != null) sessionManager.fromUser(reformattedMessage);
  } catch (e) {
    console.log(e);
  }
  res.end();
});

// Handle WhatsApp delivery status webhooks (both GET and POST)
router.all("/status", async (req, res) => {
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

router.post("/reminder", async (req, res) => {
  await remindersService.triggerReminders();
  res.end();
});

router.get("/health", (req, res) => res.sendStatus(200));

module.exports = router;
