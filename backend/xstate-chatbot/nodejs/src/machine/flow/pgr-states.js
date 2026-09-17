// What each step of the grievance journey IS: its kind, its prompt, what it
// validates, which slot it fills, which service it calls. Where each step GOES
// lives in pgr-transitions.js. For the field contract per `kind`, see the
// comment above `emitters` in generate.js.

const dialog = require('../util/dialog');
const moment = require('moment-timezone');

module.exports = ({ messages, pgrService, localisationService, config }) => {
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

  const complaintList = (context, event) => {
    const locale = context.user.locale;
    let message = dialog.get_message(messages.trackComplaint.results.preamble, locale);
    for (const complaint of event.data) {
      message += '\n\n' + dialog.get_message(messages.trackComplaint.results.complaintTemplate, locale)
        .replace('{{complaintType}}', complaint.complaintType || 'Complaint')
        .replace('{{complaintNumber}}', complaint.complaintNumber || 'N/A')
        .replace('{{filedDate}}', complaint.filedDate || 'N/A')
        .replace('{{complaintStatus}}', complaint.complaintStatus || 'N/A');
    }
    return message + dialog.get_message(messages.trackComplaint.results.closingStatement, locale);
  };

  // the boundary walk records which city the complaint belongs to, whichever way
  // it finishes
  const recordCity = (context) => {
    context.slots.pgr.city = context.extraInfo.tenantId;
  };

  return [
    {
      key: 'complaintType2Step',
      kind: 'walk',
      pathSlot: 'hierarchyPath',
      stepSlot: 'hierarchyStep',
      invokeId: 'fetchComplaintHierarchyStep',
      fetch: (context, hierarchyPath) =>
        pgrService.fetchComplaintHierarchyStep(context.extraInfo.tenantId, hierarchyPath),
      preamble: messages.fileComplaint.complaintType2Step.level.question.preamble,
      trail: true,
      onLeaf: { slot: 'complaint' }
    },

    {
      key: 'boundary',
      kind: 'walk',
      pathSlot: 'boundaryPath',
      stepSlot: 'boundaryStep',
      invokeId: 'fetchBoundaryStep',
      fetch: (context, boundaryPath) =>
        pgrService.fetchBoundaryStep(context.extraInfo.tenantId, boundaryPath),
      preamble: messages.fileComplaint.boundary.question.preamble,
      onLeaf: { slot: 'locality', set: recordCity },
      onEmpty: { slot: 'locality', set: recordCity }
    },

    {
      key: 'menu',
      id: 'pgrMenu',
      kind: 'choose',
      options: ['fileComplaint', 'trackComplaint'],
      prompt: messages.menu.question
    },

    {
      key: 'institution',
      kind: 'ask',
      accept: 'text',
      prompt: messages.fileComplaint.institution.question,
      fill: { maxLength: config.instituteNameMaxLength },
      slot: 'instituteName',
      validate: (name) =>
        name.length === 0
          ? false
          : name.length > config.instituteNameMaxLength
            ? messages.fileComplaint.institution.tooLong
            : true
    },

    {
      key: 'description',
      kind: 'ask',
      accept: 'text',
      prompt: messages.fileComplaint.description.question,
      fill: { minLength: config.descriptionMinLength },
      slot: 'description',
      validate: (text) =>
        text.length >= config.descriptionMinLength ? true : messages.fileComplaint.description.tooShort
    },

    {
      key: 'imageUpload',
      kind: 'ask',
      accept: ['image', 'document'],
      optional: true,
      prompt: messages.fileComplaint.imageUpload.question,
      slot: 'image'
    },

    {
      key: 'consent',
      kind: 'choose',
      options: ['Yes', 'No'],
      prompt: messages.fileComplaint.consent.question,
      fill: { statements: consentStatements }
    },

    {
      key: 'consentDeclined',
      kind: 'say',
      prompt: messages.fileComplaint.consent.declined
    },

    {
      key: 'confidentiality',
      kind: 'choose',
      options: ['Yes', 'No'],
      prompt: messages.fileComplaint.confidentiality.question,
      fill: {
        label: messages.fileComplaint.confidentiality.label,
        hint: messages.fileComplaint.confidentiality.hint
      },
      slot: 'isConfidential',
      value: (intention) => intention === 'Yes'
    },

    {
      key: 'persistComplaint',
      kind: 'call',
      invokeId: 'persistComplaint',
      src: (context) => pgrService.persistComplaint(context.user, context.slots.pgr, context.extraInfo),
      onDone: {
        filed: {
          message: messages.fileComplaint.persistComplaint,
          fill: {
            1: receiptCategory,
            2: (context, event) => (event.data && event.data.complaintNumber) || '-',
            3: () => moment().tz(config.timeZone).format(config.dateFormat)
          }
        }
      }
    },

    {
      key: 'trackComplaint',
      kind: 'call',
      invokeId: 'fetchOpenComplaints',
      src: (context) => pgrService.fetchOpenComplaints(context.user, context.extraInfo),
      onDone: {
        hasRecords: {
          when: (context, event) => Array.isArray(event.data) && event.data.length > 0,
          message: complaintList
        },
        noRecords: { message: messages.trackComplaint.noRecords }
      }
    }
  ];
};
