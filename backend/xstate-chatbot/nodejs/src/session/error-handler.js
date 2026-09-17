const channelProvider = require("../channel");
const { ChatbotError } = require("./errors");

/**
 * Central handler for any failure while processing an inbound message.
 * Sends a citizen-facing message (tailored when the error is one of our
 * operational ChatbotError subclasses, generic otherwise) and logs the
 * failure. Never throws — this is the last stop before the request ends.
 */
async function handleError(error, inboundRequestModel) {
  const mobileNumber = inboundRequestModel?.user?.mobileNumber;
  const userMessage = error instanceof ChatbotError
    ? error.userMessage
    : 'Sorry, there was an error processing your request. Please try again.';

  try {
    await channelProvider.sendMessageToUser(
      { mobileNumber },
      [userMessage],
      inboundRequestModel?.extraInfo
    );
  } catch (sendError) {
    console.error(`Failed to send error message to ${mobileNumber}:`, sendError);
  }

  console.error(`Error processing request for mobile number ${mobileNumber}:`, error);
}

module.exports = { handleError };
