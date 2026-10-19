import { initKeys } from "../mocks/jwks-server.js";

// This runs in each vitest worker thread.
// Keys must be initialized here since globalSetup runs in a separate process.
await initKeys();
