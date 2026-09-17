// Dev tool: interactive terminal chat against the real session/chat-service
// stack (same code the HTTP /message route calls), skipping the HTTP layer.
// Usage: WHATSAPP_PROVIDER=Console node console-repl.js [mobileNumber]
// If the configured *_HOST points at a server whose TLS chain omits an
// intermediate, set NODE_EXTRA_CA_CERTS to a bundle containing it.
const readline = require('readline');
const sessionManager = require('./src/session/session-manager');

const mobileNumber = process.argv[2] || '9812345678';

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: '> ' });
console.log(`Chatting as ${mobileNumber}. Type a message and press enter.`);
rl.prompt();

rl.on('line', async (line) => {
  const rawRequestModel = {
    message: { type: 'text', input: line },
    user: { mobileNumber },
    extraInfo: { whatsAppBusinessNumber: '258840000001' }
  };
  try {
    await sessionManager.authenticateAndDispatch(rawRequestModel);
  } catch (e) {
    console.error('Error:', e.message);
  }
  rl.prompt();
});
