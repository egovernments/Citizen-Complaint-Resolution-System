const { Machine } = require("xstate");
const { config } = require("./citizen-service-machine");

// Cutover from the states-table + generate.js authoring (still available in
// shell-states.js/pgr-states.js and pgr.js) to the class-based flow-state*
// authoring in citizen-service-machine.js. Export shape is unchanged - a
// Machine instance - so chat-service.js needs no changes.
//
// legacyOrganizationStates (email/multi-tenant onboarding) is not carried
// over: it was already unreachable dead code before this cutover (see
// flow/legacy-organization.js's own header comment).
const stateMachine = Machine(config);

module.exports = stateMachine;
