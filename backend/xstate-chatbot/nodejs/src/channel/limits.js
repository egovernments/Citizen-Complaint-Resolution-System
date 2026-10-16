// The longest text body each channel accepts in one message; a provider not listed has
// no known limit. Kept apart from the providers so the dialog can page to the active
// channel's limit without loading one.
const MAX_BODY_LENGTH = {
  Twilio: 1600, // longer bodies are rejected with error 21617
};

function maxBodyLength(provider) {
  return MAX_BODY_LENGTH[provider] ?? Infinity;
}

module.exports = { MAX_BODY_LENGTH, maxBodyLength };
