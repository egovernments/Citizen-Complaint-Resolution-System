import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { identityErrorHandler } from "../../src/app/create-app.js";
import { DigitUnavailableError } from "../../src/modules/managed-accounts/digit-user-client.js";

// Dhruv: a DigitUnavailableError no route mapped fell through to Express's
// default handler, so the client got an HTML page instead of a contract code.
describe("identityErrorHandler", () => {
  let server: Server;
  let base = "";
  beforeAll(async () => {
    const app = express();
    app.get("/digit-down", () => { throw new DigitUnavailableError("MDMS search failed", 400); });
    app.use(identityErrorHandler);
    server = app.listen(0);
    await new Promise(resolve => server.once("listening", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise(resolve => server.close(resolve)));

  it("answers an unmapped DIGIT outage with the JSON 503 contract error", async () => {
    const response = await fetch(`${base}/digit-down`);
    expect(response.status).toBe(503);
    expect(response.headers.get("content-type")).toMatch(/application\/json/);
    expect(await response.json()).toMatchObject({ code: "DIGIT_UNAVAILABLE" });
  });
});
