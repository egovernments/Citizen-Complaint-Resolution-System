import { config } from "../../infrastructure/config.js";

/**
 * Thin client for the existing egov-user contract. Error messages carry only
 * status codes: request bodies can contain one-time passwords and responses
 * can contain personal data, so neither is ever logged or rethrown.
 */
export class DigitUnavailableError extends Error {
  constructor(message: string, readonly status = 503) {
    super(message);
  }
}

export class DigitUnauthorizedError extends DigitUnavailableError {
  constructor(message: string) {
    super(message, 401);
  }
}

export interface DigitRole {
  code: string;
  name?: string;
  tenantId: string;
}

export interface DigitAccount {
  id?: number;
  uuid: string;
  userName: string;
  name: string;
  mobileNumber?: string | null;
  countryCode?: string | null;
  emailId?: string | null;
  tenantId: string;
  type: string;
  active: boolean;
  identificationMark?: string | null;
  roles: DigitRole[];
}

export interface DigitAccountInput extends Omit<DigitAccount, "uuid" | "roles"> {
  uuid?: string;
  roles: DigitRole[];
  password?: string;
}

export interface DigitLogin {
  accessToken: string;
  expiresAt: number;
  user: Record<string, unknown>;
}

function endpoint(path: string): string {
  const base = config.digitUserServiceUrl.replace(/\/$/, "");
  if (!base) throw new DigitUnavailableError("DIGIT user service is not configured");
  return `${base}${path}`;
}

async function send(path: string, init: RequestInit, operation: string): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(endpoint(path), {
      ...init,
      signal: AbortSignal.timeout(config.digitTimeoutMs),
    });
  } catch {
    throw new DigitUnavailableError(`DIGIT ${operation} request failed`);
  }
  if (response.status === 401) {
    await response.body?.cancel();
    throw new DigitUnauthorizedError(`DIGIT ${operation} was not authorized`);
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new DigitUnavailableError(
      `DIGIT ${operation} returned ${response.status}`,
      response.status,
    );
  }
  return response;
}

async function json(response: Response, operation: string): Promise<Record<string, unknown>> {
  try {
    return await response.json() as Record<string, unknown>;
  } catch {
    throw new DigitUnavailableError(`DIGIT ${operation} returned invalid JSON`);
  }
}

function requestInfo(authToken?: string) {
  return { apiId: "digit-identity-bff", ver: "1.0", ts: Date.now(), ...(authToken && { authToken }) };
}

const USER_REQUEST_FIELDS = [
  "id", "uuid", "userName", "name", "mobileNumber", "countryCode", "emailId", "locale", "type",
  "roles", "active", "tenantId", "permanentCity",
] as const;

/** Only the documented login-profile fields are kept, cached or returned. */
function loginProfile(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(USER_REQUEST_FIELDS.flatMap((field) =>
    field in value ? [[field, value[field]]] : []));
}

export async function passwordLogin(input: {
  username: string;
  password: string;
  tenantId: string;
  userType: string;
}): Promise<DigitLogin> {
  const response = await send("/oauth/token", {
    method: "POST",
    headers: {
      Authorization: config.digitOauthClientAuthorization,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "password",
      scope: "read",
      username: input.username,
      password: input.password,
      tenantId: input.tenantId,
      userType: input.userType,
    }).toString(),
  }, "login");
  const body = await json(response, "login");
  if (typeof body.access_token !== "string" || !body.access_token ||
      typeof body.expires_in !== "number" || body.expires_in <= 0 ||
      !body.UserRequest || typeof body.UserRequest !== "object") {
    throw new DigitUnavailableError("DIGIT login returned an invalid token response");
  }
  return {
    accessToken: body.access_token,
    expiresAt: Date.now() + body.expires_in * 1000,
    user: loginProfile(body.UserRequest as Record<string, unknown>),
  };
}

export async function searchAccounts(
  authToken: string,
  criteria: { userName: string; tenantId: string; userType: string; active: boolean },
): Promise<DigitAccount[]> {
  const response = await send("/_search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ RequestInfo: requestInfo(authToken), ...criteria }),
  }, "user search");
  const body = await json(response, "user search");
  if (!Array.isArray(body.user)) {
    throw new DigitUnavailableError("DIGIT user search returned an invalid response");
  }
  return body.user as DigitAccount[];
}

async function writeAccount(
  path: string,
  authToken: string,
  user: DigitAccountInput,
  operation: string,
): Promise<DigitAccount> {
  const response = await send(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ RequestInfo: requestInfo(authToken), user }),
  }, operation);
  const body = await json(response, operation);
  const account = Array.isArray(body.user) ? body.user[0] as DigitAccount : undefined;
  if (!account?.uuid) {
    throw new DigitUnavailableError(`DIGIT ${operation} returned no user`);
  }
  return account;
}

export function createAccount(authToken: string, user: DigitAccountInput): Promise<DigitAccount> {
  return writeAccount("/users/_createnovalidate", authToken, user, "user create");
}

export function updateAccount(authToken: string, user: DigitAccountInput): Promise<DigitAccount> {
  return writeAccount("/users/_updatenovalidate", authToken, user, "user update");
}

/** Revokes a DIGIT access token. Already-invalid tokens are treated as revoked. */
export async function revokeToken(accessToken: string): Promise<void> {
  const url = config.digitUserLogoutUrl || endpoint("/_logout");
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // egov-user reads TokenWrapper.access_token; RequestInfo keeps the call
      // valid when it is routed through Kong instead.
      body: JSON.stringify({ access_token: accessToken, RequestInfo: requestInfo(accessToken) }),
      signal: AbortSignal.timeout(config.digitTimeoutMs),
    });
  } catch {
    throw new DigitUnavailableError("DIGIT logout request failed");
  }
  await response.body?.cancel();
  // egov-user answers 400 "Logout failed" for a token it no longer knows.
  if (response.ok || response.status === 401 || response.status === 400) return;
  throw new DigitUnavailableError(`DIGIT logout returned ${response.status}`);
}
