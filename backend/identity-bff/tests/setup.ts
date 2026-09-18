import type { GlobalSetupContext } from "vitest/node";
import { initKeys, createJwksApp, cleanupKeys } from "../mocks/jwks-server.js";
import { createEgovUserMock } from "../mocks/egov-user.js";
import { createKcAdminMock } from "../mocks/kc-admin.js";
import type { AddressInfo } from "node:net";

let servers: any[] = [];

export async function setup(_ctx: GlobalSetupContext) {
  cleanupKeys();
  await initKeys();

  // 1. JWKS server on :9999
  const jwksApp = createJwksApp();
  const jwksSrv = jwksApp.listen(9999);
  servers.push(jwksSrv);

  // 2. Mock egov-user on random port
  const { app: egovApp } = createEgovUserMock();
  const egovSrv = egovApp.listen(0);
  servers.push(egovSrv);
  const egovPort = (egovSrv.address() as AddressInfo).port;

  // 3. Mock KC Admin on random port
  const { app: kcAdminApp } = createKcAdminMock();
  const kcAdminSrv = kcAdminApp.listen(0);
  servers.push(kcAdminSrv);
  const kcAdminPort = (kcAdminSrv.address() as AddressInfo).port;

  // Set env vars for workers
  process.env.KEYCLOAK_JWKS_URI =
    "http://localhost:9999/realms/digit-sandbox/protocol/openid-connect/certs";
  process.env.KEYCLOAK_ISSUER = "http://localhost:9999/realms/digit-sandbox";
  process.env.DIGIT_USER_SERVICE_URL = `http://localhost:${egovPort}/user`;
  process.env.REDIS_HOST = "localhost";
  process.env.REDIS_PORT = "16379";
  process.env.KEYCLOAK_ADMIN_URL = `http://localhost:${kcAdminPort}`;
}

export async function teardown() {
  for (const s of servers) s?.close();
  cleanupKeys();
}
