// Combines shell-machine.js (onboarding + chassis) and pgr-machine.js
// (complaint filing) into one machine, splicing pgr.config into the shell's
// `pgr` slot. Live: required directly by state-machine.js.
const shell = require('./shell-machine');
const pgr = require('./pgr-machine');

const config = {
  id: 'citizenService',
  // Mirrors start's own whitelist guard: USER_RESET (a greeting/reset keyword
  // like "ola" or "reiniciar") is handled at the root, before any child state's
  on: {
    USER_RESET: [
      { target: '#notAuthorized', cond: (context) => !shell.isWhitelisted(context) },
      { target: '#welcome' }
    ],
    USER_CANCEL: [
      { target: '#notAuthorized', cond: (context) => !shell.isWhitelisted(context) },
      { target: '#cancelSession' }
    ]
  },

  ...shell.config,
  states: { ...shell.config.states, pgr: pgr.config }
};

module.exports = { config };
