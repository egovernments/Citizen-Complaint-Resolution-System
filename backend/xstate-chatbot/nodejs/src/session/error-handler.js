const channelProvider = require("../channel");
const config = require("../env-variables");
const dialog = require("../machine/util/dialog");
const messages = require("../machine/flow/shell-messages");
const { ChatbotError } = require("./errors");
const { maskMobile } = require("../privacy");

/**
 * Central handler for any failure while processing an inbound message.
 * Sends a citizen-facing message (tailored when the error is one of our
 * operational ChatbotError subclasses, generic otherwise) and logs the
 * failure. Never throws — this is the last stop before the request ends.
 */
async function handleError(error, inboundRequestModel) {
  const mobileNumber = inboundRequestModel?.user?.mobileNumber;
  const locale = inboundRequestModel?.user?.locale || config.defaultLocale;
  const bundle = error instanceof ChatbotError ? error.bundle : messages.errors.generic;
  const userMessage = String(dialog.get_message(bundle, locale) ?? '')
    .split('{{digits}}').join(String(config.mobileNumberLength));

  try {
    await channelProvider.sendMessageToUser(
      { mobileNumber },
      [userMessage],
      inboundRequestModel?.extraInfo
    );
  } catch (sendError) {
    console.error(`Failed to send error message to ${maskMobile(mobileNumber)}:`, sendError);
  }

  console.error(`Error processing request for mobile number ${maskMobile(mobileNumber)}:`, error);
}

module.exports = { handleError };
