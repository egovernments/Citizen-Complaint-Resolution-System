// The only file that knows the shape of the emitted machine.
//
// Step tables say what each step IS and which step comes next, by key. This
// file says where each step SITS in the state tree. Keeping them apart is what
// lets a step author append an entry without knowing the tree exists — and what
// lets the emitted paths (which persisted sessions and telemetry both name) stay
// fixed while the flow is edited freely.
//
// `wrappers` — intermediate group nodes, keyed by dotted path, with the `id`
//              other steps target them by.
// `place`    — step key -> the group path it belongs in. Absent means top level.
// `root`     — the journey's own node name, so the entry map can name it.
// `external` — names that resolve to themselves because they are declared
//              outside the generator (hand-written shells and shell states).
//              This list shrinks to nothing as the shell becomes steps.

const { assign } = require('xstate');

module.exports = {
  pgr: {
    root: 'pgr',
    wrappers: {
      'fileComplaint.type': { id: 'pgrType' },
      'fileComplaint.location': { id: 'location' },
      'fileComplaint.other': { id: 'other' }
    },
    place: {
      complaintType2Step: ['fileComplaint', 'type'],
      boundary: ['fileComplaint', 'location'],
      institution: ['fileComplaint', 'other'],
      description: ['fileComplaint', 'other'],
      imageUpload: ['fileComplaint', 'other'],
      consent: ['fileComplaint'],
      consentDeclined: ['fileComplaint'],
      confidentiality: ['fileComplaint'],
      persistComplaint: ['fileComplaint']
    },
    external: ['fileComplaint', 'endstate', 'system_error']
  },

  shell: {
    root: 'citizenService',
    wrappers: {
      onboarding: {
        id: 'onboarding',
        // entering the journey clears its answer bag, the way pgr's root clears
        // slots.pgr — the locale step used to do this in its own entry action
        onEntry: assign((context) => { context.onboarding = {}; })
      },
      welcome: { id: 'welcome' }
    },
    place: {
      onboardingLocale: ['onboarding'],
      onboardingWelcome: ['onboarding'],
      onboardingName: ['onboarding'],
      onBoardingUserProfileConfirmation: ['onboarding'],
      changeName: ['onboarding'],
      onboardingNameConfirmation: ['onboarding'],
      onboardingUpdateUserProfile: ['onboarding'],
      onboardingThankYou: ['onboarding'],
      preCondition: ['welcome'],
      invoke: ['welcome']
    },
    external: ['pgr']
  }
};
