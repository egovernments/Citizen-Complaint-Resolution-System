const { assign } = require('xstate');
const { pgrService } = require('./service/service-loader');
const localisationService = require('./util/localisation-service');
const config = require('../env-variables');
const { generate, mergeStates } = require('./flow/generate');
const { join } = require('./flow/join');
const buildStates = require('./flow/pgr-states');
const transitions = require('./flow/pgr-transitions');
const layout = require('./flow/layout');
const legacyLocationStates = require('./flow/legacy-location');
let event;
const pgr =  {
  id: 'pgr',
  onEntry: assign((context, event) => {
    context.slots.pgr = {}
    context.pgr = {slots: {}};
  }),
  states: {
    fileComplaint: {
      id: 'fileComplaint',
      states: {
      }, // fileComplaint.states
    },  // fileComplaint
  } // pgr.states
}; // pgr

const messages = require('./flow/pgr-messages');

let grammer = {
  menu: {
    choice: [
      { intention: 'fileComplaint', recognize: ['1'] },
      { intention: 'trackComplaint', recognize: ['2'] }
    ]
  },
  confirmation: {
    choice: [
      {intention: 'Yes', recognize: ['1',]},
      {intention: 'No', recognize: ['2']}
    ]
  }
};
const flow = join(
  buildStates({ messages, pgrService, localisationService, config }),
  transitions,
  layout.pgr
);
pgr.initial = flow.layout.initial[layout.pgr.root];
mergeStates(pgr.states, generate(flow.steps, flow.layout));
mergeStates(
  pgr.states.fileComplaint.states.location.states,
  legacyLocationStates({ messages, grammer, pgrService, config })
);

module.exports = pgr;
