const sessionManager = require("./session-manager");
const userService = require("./user-service");
const { ValidationError } = require("./errors");


/**
 * Which tenant an inbound attachment should be stored against.
 *
 * Sandbox deployments store it against the tenant the citizen is registered
 * with; everywhere else this returns null and the channel adapter falls back to
 * the root tenant. Kept out of InboundMessageParser so that parsing stays free
 * of session and user-identity dependencies.
 */
function resolveUploadTenantId(req, config) {
  const body = (req && req.body) || {};
  const isUpload = isMediaUpload(body);

  if (isUpload) {
    return resolveTenantForUpload(body);
  }

  return null;
}

function isMediaUpload(body) {
  return !!(body.NumMedia && parseInt(body.NumMedia, 10) > 0);
}

function resolveTenantForUpload(body) {
  const mobileNumber = extractAndValidateMobileNumber(body);
  const tenantId = sessionManager.getSandboxTenantForMobileNumber(mobileNumber);

  logUploadTenantResolution(mobileNumber, tenantId);
  return tenantId;
}

function extractAndValidateMobileNumber(body) {
  const mobileNumber = userService.sanitizeMobileNumber(body.From);

  if (!mobileNumber) 
    throw new ValidationError("Unable to resolve mobile number from upload request");


  return mobileNumber;
}

function logUploadTenantResolution(mobileNumber, tenantId) {
  if (!tenantId) {
    console.warn(`No sandbox tenant found for mobile number ${mobileNumber}, defaulting to root tenant`);
  }
  console.log(`Image upload detected for ${mobileNumber}, using tenant: ${tenantId || 'default'}`);
}

module.exports = { resolveUploadTenantId };
