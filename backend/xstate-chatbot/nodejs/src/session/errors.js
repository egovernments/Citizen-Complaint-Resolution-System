/**
 * Base class for expected, operational errors — thrown deliberately to
 * signal a specific failure mode, as opposed to a programmer bug. Carries
 * a citizen-safe message separate from the technical one logged internally.
 */
class ChatbotError extends Error {
  constructor(message, userMessage) {
    super(message);
    this.name = this.constructor.name;
    this.userMessage = userMessage || 'Sorry, there was an error processing your request. Please try again.';
  }
}

class ValidationError extends ChatbotError {
  constructor(message) {
    super(message, 'Sorry, we could not process your request. Please check your mobile number format (should be 10 digits) and try again.');
  }
}

class AuthenticationError extends ChatbotError {
  constructor(message) {
    super(message, 'Sorry, we could not verify your account. Please try again in a moment.');
  }
}

class ExternalServiceError extends ChatbotError {
  constructor(message) {
    super(message, 'Sorry, our service is temporarily unavailable. Please try again shortly.');
  }
}

module.exports = { ChatbotError, ValidationError, AuthenticationError, ExternalServiceError };
