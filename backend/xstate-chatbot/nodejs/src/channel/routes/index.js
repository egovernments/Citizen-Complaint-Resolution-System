const express = require("express"),
  router = express.Router(),
  config = require("../../env-variables"),
  sessionManager = require("../../session/session-manager"),
  channelProvider = require("../"),
  remindersService = require("../../machine/service/reminders-service"),
  InboundRequestParser = require("../../session/inbound-message-parser"),
  { resolveUploadTenantId } = require("../../session/upload-tenant"),
   { handleError } = require("../../session/error-handler"),
  rateLimit = require("express-rate-limit");
const { summarizeInbound, maskMobile } = require("../../privacy");

 const webhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 500,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  // Use the sender or recipient as the key for rate limiting, falling back to the IP address if neither is available.
  keyGenerator: (req) =>
    req.body?.From ?? req.body?.To ?? req.query?.From ?? req.query?.To ?? "unattributed",
});

// Reject anything the channel provider cannot vouch for, before it reaches the
// limiter, a parser, or a session.
function verifySignature(req, res, next) {
  if (!channelProvider.verifyRequest(req)) {
    console.warn(`Rejected inbound webhook: verification failed (${req.originalUrl})`);
    return res.sendStatus(403);
  }
  next();
}


// Entry point for inbound messages from the channel provider
router.post("/message", verifySignature, webhookLimiter, async (req, res) => {
  console.log(`Inbound ${req.originalUrl}: ${summarizeInbound(req.body)}`);

  try {
    
    const inboundRequestParser = InboundRequestParser.create(req, channelProvider);
    
    if (config.isSandboxMode) {
      const tenantId = resolveUploadTenantId(req, config);
      inboundRequestParser.setTenatId(tenantId);
    }

    // only valid messages go through
    const isValidMessage = await inboundRequestParser.hasValidMessage();
    if (isValidMessage) {
      const inboundRequestModel = await inboundRequestParser.getRequestModel();
      sessionManager
        .authenticateAndDispatch(inboundRequestModel)
        .catch((error) => handleError(error, inboundRequestModel));
    }      

  } catch (e) {
    console.log(e);
  } finally {
    res.end();
  }

});

// Handle WhatsApp delivery status webhooks (both GET and POST)
router.all("/status", verifySignature, webhookLimiter, async (req, res) => {

  try {
    const isDeliveryStatusWebhook = req.method === 'GET' ||
      req.query.MESSAGE_STATUS ||
      req.body.MESSAGE_STATUS ||
      req.query.TO ||
      req.body.TO;

    if (isDeliveryStatusWebhook) {
      const statusData = req.method === 'GET' ? req.query : req.body;
      const { TO, MESSAGE_STATUS, MESSAGE_ID } = statusData;
      console.log(`Delivery status (${req.method}) for ${maskMobile(TO)}: ${MESSAGE_STATUS ?? 'unknown'} (${MESSAGE_ID ?? 'no id'})`);

      res.status(200).json({ status: "received", messageId: MESSAGE_ID });
      return;
    }
    
    const inboundRequestParser = InboundRequestParser.create(req, channelProvider);

    if (config.isSandboxMode) {
      const tenantId = resolveUploadTenantId(req, config);
      inboundRequestParser.setTenatId(tenantId);
    }

    if (await inboundRequestParser.hasValidMessage()) {
      const inboundRequestModel = await inboundRequestParser.getRequestModel();
      sessionManager
        .authenticateAndDispatch(inboundRequestModel)
        .catch((error) => handleError(error, inboundRequestModel));
    }
    res.status(200).send("OK");
  } catch (e) {
    console.error("Status endpoint error:", e);
    // Always return 200 OK to prevent webhook provider retries
    res.status(200).json({ status: "error", message: "Internal processing error" });
  }
});

router.post("/reminder", webhookLimiter, async (req, res) => {
  await remindersService.triggerReminders();
  res.end();
});

router.get("/health", (req, res) => res.sendStatus(200));

module.exports = router;
