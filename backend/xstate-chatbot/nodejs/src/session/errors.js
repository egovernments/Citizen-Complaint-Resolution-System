const messages = require('../machine/flow/shell-messages');

/**
 * Base class for expected, operational errors — thrown deliberately to
 * signal a specific failure mode, as opposed to a programmer bug. Carries
 * a citizen-safe message separate from the technical one logged internally.
 */
class ChatbotError extends Error {
  constructor(message, bundle) {
    super(message);
    this.name = this.constructor.name;
    // A locale bundle, not a string: error-handler.js resolves it against the
    // citizen's locale. These were English on every deployment.
    this.bundle = bundle || messages.errors.generic;
  }
}

class ValidationError extends ChatbotError {
  constructor(message) {
    super(message, messages.errors.validation);
  }
}

class AuthenticationError extends ChatbotError {
  constructor(message) {
    super(message, messages.errors.authentication);
  }
}

class ExternalServiceError extends ChatbotError {
  constructor(message) {
    super(message, messages.errors.externalService);
  }
}

module.exports = { ChatbotError, ValidationError, AuthenticationError, ExternalServiceError };

