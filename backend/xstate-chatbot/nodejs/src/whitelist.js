const config = require('./env-variables');

/**
 * May this number use the bot? An EMPTY list allows EVERYONE.
 *
 * ALLOWED_MOBILE_NUMBERS is a comma-separated list. Both StandardLoginFlow and
 * shell-machine gate on this.
 */
function isWhitelisted(mobileNumber) {
  const allowed = config.allowedMobileNumbers.split(',').map((n) => n.trim()).filter(Boolean);
  return allowed.length === 0 || allowed.includes(mobileNumber);
}

module.exports = { isWhitelisted };
