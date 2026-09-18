import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { closeCache, initCache } from "../../src/infrastructure/redis.js";
import { config } from "../../src/infrastructure/config.js";
import { createIdentityApp } from "../../src/app/create-app.js";
import { initJwks } from "../../src/modules/authentication/token-verifier.js";

let server: Server;
let appPort: number;

export async function startIdentityTestApp(): Promise<number> {
  (config as any).redisHost = process.env.REDIS_HOST || "localhost";
  (config as any).redisPort = Number(process.env.REDIS_PORT || "16379");
  initJwks(process.env.KEYCLOAK_JWKS_URI);
  initCache(`redis://${config.redisHost}:${config.redisPort}`);
  server = createIdentityApp().listen(0);
  appPort = (server.address() as AddressInfo).port;
  return appPort;
}

export async function stopIdentityTestApp(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
  await closeCache();
}

export function getIdentityAppPort(): number {
  return appPort;
}
