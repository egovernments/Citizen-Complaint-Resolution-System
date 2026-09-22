const sessionManager = require("./session-manager");
const userService = require("./user-service");
const { ValidationError } = require("./errors");
const { maskMobile } = require("../privacy");


/**
 * Which tenant an inbound attachment should be stored against.
 *
 * Sandbox deployments store it against the tenant the citizen is registered
 * with; everywhere else this returns null and the channel adapter falls back to
 * the root tenant. Kept out of InboundMessageParser so that parsing stays free
 * of session and user-identity dependencies.
 */
async function resolveUploadTenantId(req, config, provider) {
  // Determine the payload to inspect for media uploads. This may come from the
  // provider's raw message extraction or directly from the request body.
  const payload = (provider && provider.extractRawMessage(req)) || (req && req.body) || {};

  return isMediaUpload(payload) ? await resolveTenantForUpload(payload) : null;
}

function isMediaUpload(body) {
  return !!(body.NumMedia && parseInt(body.NumMedia, 10) > 0);
}

async function resolveTenantForUpload(body) {
  const mobileNumber = await extractAndValidateMobileNumber(body);
  const tenantId = sessionManager.getSandboxTenantForMobileNumber(mobileNumber);

  logUploadTenantResolution(mobileNumber, tenantId);
  return tenantId;
}

async function extractAndValidateMobileNumber(body) {
  // No tenant yet — that is what this resolves; the sanitizer falls back to the root.
  const mobileNumber = await userService.sanitizeMobileNumber(body.From);

  if (!mobileNumber) 
    throw new ValidationError("Unable to resolve mobile number from upload request");


  return mobileNumber;
}

function logUploadTenantResolution(mobileNumber, tenantId) {
  if (!tenantId) {
    console.warn(`No sandbox tenant found for mobile number ${maskMobile(mobileNumber)}, defaulting to root tenant`);
  }
  console.log(`Image upload detected for ${maskMobile(mobileNumber)}, using tenant: ${tenantId || 'default'}`);
}

module.exports = { resolveUploadTenantId };
