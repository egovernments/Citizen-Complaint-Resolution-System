import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { config } from "../../src/infrastructure/config.js";
import {
  DigitLoginRejectedError,
  DigitUnavailableError,
  passwordLogin,
} from "../../src/modules/managed-accounts/digit-user-client.js";

// egov-user refuses a password grant with HTTP 400 and a fixed OAuth
// error_description (CustomAuthenticationProvider). Only the reason is kept.
let server: Server;
let reply: { status: number; body: unknown } = { status: 400, body: {} };
const saved = config.digitUserServiceUrl;

beforeAll(async () => {
  const app = express();
  app.post("/user/oauth/token", (_request, response) => response.status(reply.status).json(reply.body));
  server = app.listen(0);
  (config as any).digitUserServiceUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/user`;
});

afterAll(() => {
  server.close();
  (config as any).digitUserServiceUrl = saved;
});

const login = () => passwordLogin({ username: "EMP-1", password: "x", tenantId: "pg", userType: "EMPLOYEE" });

describe("egov-user login refusals", () => {
  it.each([
    ["Account locked", "locked"],
    ["Please activate your account", "inactive"],
    ["Invalid login credentials", "invalid_credentials"],
    ["TenantId is mandatory", "unknown"],
    [undefined, "unknown"],
  ])("%s → %s", async (description, reason) => {
    reply = { status: 400, body: { error: "invalid_request", ...(description && { error_description: description }) } };
    const error = await login().catch((caught) => caught);
    expect(error).toBeInstanceOf(DigitLoginRejectedError);
    expect(error.reason).toBe(reason);
    // The refusal text is never carried in the message.
    expect(error.message).not.toContain(description ?? "\u0000");
  });

  it("keeps other failures as dependency errors", async () => {
    reply = { status: 500, body: {} };
    const error = await login().catch((caught) => caught);
    expect(error).toBeInstanceOf(DigitUnavailableError);
    expect(error).not.toBeInstanceOf(DigitLoginRejectedError);
  });
});
