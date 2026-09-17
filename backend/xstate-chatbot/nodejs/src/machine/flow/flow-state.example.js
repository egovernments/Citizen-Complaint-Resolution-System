// src/machine/flow/flow-state.example.js
const State = require('./flow-state');
const QuestionState = require('./flow-state-question');
const ProcessingState = require('./flow-state-processing');
const WalkState = require('./flow-state-walk'); 
const AskState = require('./flow-state-ask');
const messages = require('./shell-messages');



const isOnboarded = (context) => context.user.locale;

const start = new State('start');
const welcome = new State('welcome');
const onboarding = new State('onboarding');
const confirmName = new QuestionState('confirmName');
const updateProfile = new State('updateProfile');
const changeName = new AskState('changeName');
const updateProfileCall = new ProcessingState('updateProfileCall');
const thankYou = new State('thankYou');
const errorWelcome = new State('errorWelcome');
const boundary = new WalkState('boundary');
const locality = new State('locality');
const noBoundary = new State('noBoundary');
const boundaryError = new State('boundaryError');

boundary
  .setFetch((context, path) => {
    if (path.length === 0) return Promise.resolve({ options: ['North', 'South'], isLeafLevel: false });
    if (path[0] === 'North' && path.length === 1) return Promise.resolve({ options: ['Alpha', 'Beta'], isLeafLevel: true });
    return Promise.resolve({ options: [], isLeafLevel: false });
  })
  .setOnError(boundaryError)
  .setOnEmpty(noBoundary, (context) => { context.noBoundaryFound = true; })
  .setOnLeaf(locality, (context) => { context.localityConfirmed = true; });


updateProfileCall
  .setProcessing((context) => context.shouldFail ? Promise.reject(new Error('boom')) : Promise.resolve())
  .setOnError(errorWelcome)
  .setNext(thankYou, (context) => { context.updated = true; });


start
  .setConditionalNext(welcome, isOnboarded)
  .setNext(onboarding);

welcome.setPrompt({ code: 'test.welcome', en_IN: 'Welcome!', pt_PT: 'Bem-vindo!' });

confirmName.setPrompt({ code: 'test.confirm', en_IN: 'Do you confirm your name?\n1. Yes\n2. No', pt_PT: 'Confirma o seu nome?\n1. Sim\n2. Não' });
confirmName.setPrompt({ code: 'test.confirm', en_IN: 'Do you confirm your name?\n1. Yes\n2. No', pt_PT: 'Confirma o seu nome?\n1. Sim\n2. Não' });
confirmName
  .setOptions(['Yes', 'No'])
  .setConditionalNext(updateProfile, (context) => context.intention === 'Yes')
  .setNext(changeName);
updateProfile.setPrompt(messages.onboarding.onboardingThankYou);
changeName.setPrompt(messages.onboarding.changeName.question);
changeName
  .setOnValid((context, name) => { context.name = name; })
  .setNext(thankYou);

  
updateProfile.setPrompt(messages.onboarding.onboardingThankYou);
changeName.setPrompt(messages.onboarding.changeName.question);



module.exports = { start, welcome, onboarding, confirmName, updateProfile, changeName, updateProfileCall, thankYou, errorWelcome, boundary, locality, noBoundary, boundaryError };
