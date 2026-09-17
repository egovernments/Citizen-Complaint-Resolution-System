// The shape of onboarding and of the shell that surrounds every journey.

// The one edge in either journey that carries a write: saying Yes to the name we
// read back is what commits it. It cannot be a step-level write, because that
// would commit on No as well.
const commitName = (context) => {
  context.user.name = context.onboarding.name;
};

const isOnboarded = (context) => context.user.locale;
const hasProfileName = (context) => context.user.name;
const gaveName = (context) => context.onboarding.name;

module.exports = {
  // where each group begins
  entry: {
    citizenService: 'start',
    onboarding: 'onboardingLocale',
    welcome: 'preCondition'
  },

  // where each step goes
  exits: {
    // shell: every session enters at start and returns to it
    start:        [['welcome', isOnboarded], ['onboarding']],
    preCondition: [['invoke', isOnboarded], ['onboarding']],
    invoke:       'pgr',
    endstate:     'start',
    system_error: 'welcome',

    // onboarding
    onboardingLocale:                 { onAny: 'onboardingWelcome', onUnknown: 'onboardingWelcome' },
    onboardingWelcome:                [['onBoardingUserProfileConfirmation', hasProfileName], ['onboardingName']],
    onboardingName:                   [['onboardingNameConfirmation', gaveName], ['onboardingUpdateUserProfile']],
    onBoardingUserProfileConfirmation: { Yes: 'onboardingUpdateUserProfile', No: 'changeName' },
    changeName:                       [['onboardingNameConfirmation', gaveName]],
    onboardingNameConfirmation:       { Yes: { to: 'onboardingUpdateUserProfile', set: commitName }, No: 'changeName' },
    onboardingUpdateUserProfile:      { nameGiven: 'onboardingThankYou', nameSkipped: 'onboardingThankYou', onError: 'welcome' },
    onboardingThankYou:               'pgr'
  }
};
