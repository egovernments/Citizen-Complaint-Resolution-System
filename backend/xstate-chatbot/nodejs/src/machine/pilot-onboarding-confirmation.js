// Pilot: reimplements the real onBoardingUserProfileConfirmation step (shell-states.js)
// with the new classes, to compare against the current production behavior
// before deciding whether to migrate further. Not wired into the running system.
const QuestionState = require('./flow/flow-state-question');
const State = require('./flow/flow-state');
const messages = require('./flow/shell-messages');


const onboardingUpdateUserProfile = new State('onboardingUpdateUserProfile');
const changeName = new State('changeName');
const onBoardingUserProfileConfirmation = new QuestionState('onBoardingUserProfileConfirmation');

onBoardingUserProfileConfirmation
  .setPrompt(messages.onboarding.onBoardingUserProfileConfirmation.question)
  .setFill({ name: (context) => context.user.name })
  .setOptions(['Yes', 'No'])
  .setConditionalNext(onboardingUpdateUserProfile, (context) => context.intention === 'Yes')
  .setNext(changeName);

module.exports = { onBoardingUserProfileConfirmation, onboardingUpdateUserProfile, changeName };
