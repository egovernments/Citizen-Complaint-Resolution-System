const assert = require("node:assert/strict");
const http = require("node:http");
const path = require("node:path");
const { spawn } = require("node:child_process");
const test = require("node:test");

const bootstrap = path.join(__dirname, "bootstrap-novu-whatsapp.sh");

function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

function runBootstrap(baseUrl) {
  return new Promise((resolve, reject) => {
    const child = spawn("bash", [bootstrap], {
      env: {
        ...process.env,
        NOVU_ENV_FILE: "/dev/null",
        NOVU_BASE_URL: baseUrl,
        NOVU_API_KEY: "test-novu-key",
        TWILIO_ACCOUNT_SID: "AC00000000000000000000000000000000",
        TWILIO_AUTH_TOKEN: "synthetic-token",
        TWILIO_WHATSAPP_FROM: "whatsapp:+14155238886",
      },
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`bootstrap exited ${code}: ${stderr}\n${stdout}`));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

test("bootstrap reconciles integrations and keeps Novu 2.3 workflow ids stable", async (t) => {
  const state = {
    integration: null,
    integrationCreates: 0,
    integrationUpdates: 0,
    workflowCreates: 0,
    workflows: new Map(),
    triggerCalls: 0,
  };

  const server = http.createServer(async (request, response) => {
    response.setHeader("Content-Type", "application/json");

    if (request.method === "GET" && request.url === "/v1/environments") {
      response.end(JSON.stringify({ data: [{ name: "digit-dev", _id: "env-1" }] }));
      return;
    }

    if (request.method === "GET" && request.url === "/v1/integrations") {
      response.end(JSON.stringify({ data: state.integration ? [state.integration] : [] }));
      return;
    }

    if (request.method === "POST" && request.url === "/v1/integrations") {
      const body = await readJson(request);
      state.integrationCreates += 1;
      state.integration = { ...body, _id: "integration-1" };
      response.end(JSON.stringify({ data: state.integration }));
      return;
    }

    if (request.method === "PUT" && request.url === "/v1/integrations/integration-1") {
      const body = await readJson(request);
      state.integrationUpdates += 1;
      state.integration = {
        ...state.integration,
        ...body,
        _id: "integration-1",
        providerId: "twilio",
        channel: "sms",
      };
      response.end(JSON.stringify({ data: state.integration }));
      return;
    }

    if (request.method === "GET" && request.url.startsWith("/v2/workflows?")) {
      response.end(JSON.stringify({
        data: {
          workflows: [...state.workflows.values()],
          totalCount: state.workflows.size,
        },
      }));
      return;
    }

    if (request.method === "POST" && request.url === "/v2/workflows") {
      const body = await readJson(request);
      // Novu 2.3 derives the workflow id from name, ignoring the requested
      // workflowId. The bootstrap must therefore make name deterministic.
      const workflow = { ...body, workflowId: body.name };
      state.workflowCreates += 1;
      state.workflows.set(workflow.workflowId, workflow);
      response.end(JSON.stringify(workflow));
      return;
    }

    if (request.url === "/v1/events/trigger") {
      state.triggerCalls += 1;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ error: "unexpected request" }));
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  const first = await runBootstrap(baseUrl);
  assert.match(first.stdout, /Created integration id: integration-1/);
  assert.equal(state.integrationCreates, 1);
  assert.equal(state.integrationUpdates, 0);
  assert.equal(state.workflowCreates, 5);
  assert.deepEqual([...state.workflows.keys()].sort(), [
    "complaints-email",
    "complaints-sms",
    "complaints-whatsapp",
    "complaints-workflow-apply",
    "complaints-workflow-assign",
  ]);

  const second = await runBootstrap(baseUrl);
  assert.match(second.stdout, /Reconciled integration id: integration-1/);
  assert.equal(state.integrationCreates, 1);
  assert.equal(state.integrationUpdates, 1);
  assert.equal(state.workflowCreates, 5);
  assert.equal(state.integration.credentials.token, "synthetic-token");
  assert.equal(state.integration.credentials.from, "whatsapp:+14155238886");
  assert.equal(state.triggerCalls, 0);
});
