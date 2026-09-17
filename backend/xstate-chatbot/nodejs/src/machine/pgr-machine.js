// Migration port of pgr-states.js/pgr-transitions.js (the complaint-filing
// journey) to the class-based flow authoring in flow/flow-state*.js. Live:
// required by citizen-service-machine.js, which state-machine.js requires.
// `endstate`/`system_error` below are reference-only placeholders - used so
// setNext/setOnError can target '#endstate'/'#system_error' by key, but never
// compiled into pgr's own subtree (see the compile() call below), so those
// absolute targets resolve to shell-machine.js's real chassis states instead
// of colliding with a same-id node nested inside `pgr`.
const { assign } = require('xstate');
const dialog = require('./util/dialog');
const moment = require('moment-timezone');

const State = require('./flow/flow-state');
const QuestionState = require('./flow/flow-state-question');
const AskState = require('./flow/flow-state-ask');
const ProcessingState = require('./flow/flow-state-processing');
const WalkState = require('./flow/flow-state-walk');
const Group = require('./flow/flow-state-group');
const compile = require('./flow/flow-state-compiler');

const config = require('../env-variables');
const messages = require('./flow/pgr-messages');
const localisationService = require('./util/localisation-service');
const { pgrService } = require('./service/service-loader');

const consentStatements = (context) =>
  [messages.fileComplaint.consent.dataProcessing, messages.fileComplaint.consent.truthfulness]
    .map((bundle) => dialog.get_message(bundle, context.user.locale))
    .filter(Boolean)
    .map((statement) => `• ${statement}`)
    .join('\n');

const receiptCategory = (context) => {
  const code = (context.slots.pgr.hierarchyPath || [])[0] || context.slots.pgr.complaint;
  const bundle = code
    ? localisationService.getMessageBundleForCode('COMPLAINT_HIERARCHY.' + String(code).toUpperCase())
    : undefined;
  return (bundle && dialog.get_message(bundle, context.user.locale)) || code || '-';
};

// the boundary walk records which city the complaint belongs to, whichever way it finishes
const recordCity = (context) => { context.slots.pgr.city = context.extraInfo.tenantId; };

const labelForCode = (context, code, prefix = '') => {
  if (!code) return undefined;
  const bundle = localisationService.getMessageBundleForCode(prefix + String(code));
  return (bundle && dialog.get_message(bundle, context.user.locale)) || code;
};

// the final review shown before the complaint is submitted. Hierarchy levels
// come from the walked path (deeper hierarchies simply add no extra lines),
// so this stays correct whether the citizen walked two levels or three.
const confirmationSummary = (context) => {
  const fields = messages.fileComplaint.confirmSubmission;
  const text = (bundle) => dialog.get_message(bundle, context.user.locale);
  const path = context[walkComplaintTypes.pathSlot] || [];
  const hierarchy = (code) => labelForCode(context, code && String(code).toUpperCase(), 'COMPLAINT_HIERARCHY.');

  return [
    [fields.type, hierarchy(path[0])],
    [fields.category, hierarchy(path[1])],
    [fields.subject, hierarchy(path[2])],
    [fields.location, labelForCode(context, context.slots.pgr.locality)],
    [fields.institution, context.slots.pgr.instituteName],
    [fields.description, context.slots.pgr.description],
    [fields.confidentiality, text(context.slots.pgr.isConfidential ? fields.yes : fields.no)]
  ]
    .filter(([, value]) => value)
    .map(([bundle, value]) => `*${text(bundle)}:* ${value}`)
    .join('\n');
};

// -- steps ----------------------------------------------------------------

const menu = new QuestionState('menu');
const walkComplaintTypes = new WalkState('complaintType2Step');
const walkBoundaries = new WalkState('boundary');
const askIntitution = new AskState('institution');
const askDescription = new AskState('description');
const askForAttachments = new AskState('imageUpload');
const askConsent = new QuestionState('consent');
const consentDeclined = new State('consentDeclined');
const cancelSession = new State('cancelSession');
const askConfidentiality = new QuestionState('confidentiality');
const confirmSubmission = new QuestionState('confirmSubmission');
const persistComplaint = new ProcessingState('persistComplaint');

// chassis placeholders - real states live in shell-machine.js
const endstate = new State('endstate');
const system_error = new State('system_error');

// -- groups (fileComplaint.type/location/other, matching layout.js) -------

const typeGroup = new Group('type').setStates([walkComplaintTypes]).setStart('complaintType2Step');
const locationGroup = new Group('location').setStates([walkBoundaries]).setStart('boundary');
const otherGroup = new Group('other').setStates([askIntitution, askDescription, askForAttachments]).setStart('institution');

const fileComplaintGroup = new Group('fileComplaint')
  .setStates([typeGroup, locationGroup, otherGroup, askConsent, consentDeclined, askConfidentiality, confirmSubmission, persistComplaint])
  .setStart('type');

// -- wiring -----------------------------------------------------------

menu
  .setPrompt(messages.menu.singleOptionQuestion)
  .setOptions(['fileComplaint', 'cancel'])
  .setConditionalNext(fileComplaintGroup, (context) => context.intention === 'fileComplaint')
  .setConditionalNext(cancelSession, (context) => context.intention === 'cancel');

walkComplaintTypes
  .setPreamble(messages.fileComplaint.complaintType2Step.level.question.preamble)
  .setTrail(true)
  .setFetch((context, path) => pgrService.fetchComplaintHierarchyStep(context.extraInfo.tenantId, path))
  .setOnError(system_error)
  .setOnLeaf(locationGroup, { slot: 'complaint' });

walkBoundaries
  .setPreamble(messages.fileComplaint.boundary.question.preamble)
  .setFetch((context, path) => pgrService.fetchBoundaryStep(context.extraInfo.tenantId, path))
  .setOnError(system_error)
  .setOnLeaf(otherGroup, { slot: 'locality', set: recordCity })
  .setOnEmpty(otherGroup, { slot: 'locality', set: recordCity });

askIntitution
  .setPrompt(messages.fileComplaint.institution.question)
  .setFill({ maxLength: config.instituteNameMaxLength })
  .setValidate((name) =>
    name.length === 0
      ? false
      : name.length > config.instituteNameMaxLength
        ? messages.fileComplaint.institution.tooLong
        : true)
  .setOnValid((context, name) => { context.slots.pgr.instituteName = name; })
  .setNext(askDescription);

askDescription
  .setPrompt(messages.fileComplaint.description.question)
  .setFill({ minLength: config.descriptionMinLength })
  .setValidate((text) => text.length >= config.descriptionMinLength ? true : messages.fileComplaint.description.tooShort)
  .setOnValid((context, text) => { context.slots.pgr.description = text; })
  .setNext(askForAttachments);

askForAttachments
  .setPrompt(messages.fileComplaint.imageUpload.question)
  .setAccept(['image', 'document'])
  .setOptional(true)
  .setValidate((input) => input === 'FILE_TOO_LARGE' ? messages.fileComplaint.imageUpload.tooLarge : true)
  .setOnValid((context, input) => {
    // channel-level media processing (download/upload) failed - the channel
    // returns a blank placeholder rather than throwing. Don't forward that as
    // a fake filestoreId; tell the citizen and carry on without an attachment.
    if (!String(input).trim()) {
      dialog.sendMessage(context, dialog.get_message(messages.fileComplaint.imageUpload.failed, context.user.locale));
      return;
    }
    context.slots.pgr.image = input;
  })
  .setNext(askConsent);


askConsent
  .setPrompt(messages.fileComplaint.consent.question)
  .setFill({ statements: consentStatements })
  .setOptions(['Yes', 'No'])
  .setConditionalNext(askConfidentiality, (context) => context.intention === 'Yes')
  .setNext(consentDeclined);

consentDeclined
  .setPrompt(messages.fileComplaint.consent.declined)
  .setNext(endstate);

cancelSession
  .setPrompt(messages.menu.cancelled)
  .setNext(endstate);

askConfidentiality
  .setPrompt(messages.fileComplaint.confidentiality.question)
  .setFill({ label: messages.fileComplaint.confidentiality.label, hint: messages.fileComplaint.confidentiality.hint })
  .setOptions(['Yes', 'No'])
  .setConditionalNext(confirmSubmission, (context) => context.intention === 'Yes', (context) => { context.slots.pgr.isConfidential = true; })
  .setNext(confirmSubmission, (context) => { context.slots.pgr.isConfidential = false; });

confirmSubmission
  .setPrompt(messages.fileComplaint.confirmSubmission.question)
  .setFill({ summary: confirmationSummary })
  .setOptions(['Yes', 'No'])
  .setConditionalNext(persistComplaint, (context) => context.intention === 'Yes')
  .setNext(cancelSession);

persistComplaint
  .setProcessing((context) => pgrService.persistComplaint(context.user, context.slots.pgr, context.extraInfo))
  .setNext(endstate)
  .setOutcomeMessage(messages.fileComplaint.persistComplaint, {
    1: receiptCategory,
    2: (context, event) => (event.data && event.data.complaintNumber) || '-',
    3: () => moment().tz(config.timeZone).format(config.dateFormat)
  });

const pgrConfig = {
  id: 'pgr',
  entry: assign((context) => {
  context.slots.pgr = {};
  context.pgr = { slots: {} };
  for (const walk of [walkComplaintTypes, walkBoundaries]) {
    delete context[walk.pathSlot];
    delete context[walk.stepSlot];
    delete context[walk.grammerSlot];
  }
}),

  ...compile([menu, fileComplaintGroup, cancelSession], 'menu')
};

module.exports = {
  config: pgrConfig,
  states: { menu, complaintType2Step: walkComplaintTypes, boundary: walkBoundaries, institution: askIntitution, description: askDescription, imageUpload: askForAttachments,
    consent: askConsent, consentDeclined, confidentiality: askConfidentiality, confirmSubmission, persistComplaint, cancelSession,
    endstate, system_error, fileComplaintGroup, typeGroup, locationGroup, otherGroup }
};
