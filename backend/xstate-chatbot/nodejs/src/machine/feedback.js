const { assign } = require('xstate');
const dialog = require('./util/dialog');
const config = require('../env-variables');
const { pgrService } = require('./service/service-loader');

const feedback = {
  id: 'feedback',
  initial: 'fetchComplaints',
  onEntry: assign((context, event) => {
    context.slots.feedback = { good: [] };
  }),
  states: {

    // Fetch user's CLOSEDAFTERRESOLUTION complaints
    fetchComplaints: {
      id: 'feedbackFetchComplaints',
      invoke: {
        id: 'fetchResolvedComplaints',
        src: (context) => pgrService.fetchResolvedComplaints(context.user),
        onDone: [
          {
            target: 'sendForm',
            cond: (context, event) => event.data && event.data.length > 0,
            actions: assign((context, event) => {
              context.slots.feedback.complaints = event.data;
            })
          },
          {
            target: 'noComplaints'
          }
        ],
        onError: {
          target: 'noComplaints'
        }
      }
    },

    // No resolved complaints found
    noComplaints: {
      id: 'feedbackNoComplaints',
      onEntry: assign((context, event) => {
        dialog.sendMessage(context, dialog.get_message(messages.noComplaints, context.user.locale), true);
      }),
      always: '#endstate'
    },

    // Send the WhatsApp Flow — complaint list passed as {{1}} ContentVariable
    sendForm: {
      id: 'feedbackSendForm',
      onEntry: assign((context, event) => {
        if (config.twilio && config.twilio.feedbackFlowSid) {
          let complaints = context.slots.feedback.complaints;
          let complaintOptions = JSON.stringify(
            complaints.map(c => ({ id: c.serviceRequestId, title: c.serviceCode }))
          );
          dialog.sendMessage(context, {
            type: 'template',
            output: config.twilio.feedbackFlowSid,
            params: [complaintOptions]   // {{1}} = JSON array of complaint options
          }, true);
        } else {
          let complaints = context.slots.feedback.complaints;
          // Text fallback: ask user to type complaint number and rating separately
          let message = dialog.get_message(messages.textFallback, context.user.locale);
          complaints.forEach((c, i) => {
            message += `\n*${i + 1}.* ${c.serviceCode} — ${c.serviceRequestId}`;
          });
          context.slots.feedback.textMode = true;
          context.grammer = grammer.rating;
          dialog.sendMessage(context, message);
        }
      }),
      on: { USER_MESSAGE: 'processForm' }
    },

    // Parse the submitted form response
    processForm: {
      id: 'feedbackProcessForm',
      onEntry: assign((context, event) => {
        let complaints = context.slots.feedback.complaints;

        if (dialog.validateInputType(event, 'button')) {
          try {
            const formData = JSON.parse(event.message.input);
            let selected = complaints.find(c => c.serviceRequestId === formData.complaint_id);
            context.slots.feedback.selectedService = selected || complaints[0];
            context.slots.feedback.rating          = formData.rating      || '';
            context.slots.feedback.good            = formData.good_things || [];
            context.slots.feedback.comments        = formData.comments    || '';
            context.slots.feedback.parsed          = true;
          } catch (e) {
            console.error('Flow response parse error:', e.message);
            context.slots.feedback.parsed = false;
          }
        } else if (dialog.validateInputType(event, 'text') && context.slots.feedback.textMode) {
          let intention = dialog.get_intention(grammer.rating, event, true);
          if (intention !== dialog.INTENTION_UNKOWN) {
            context.slots.feedback.selectedService = complaints[0];
            context.slots.feedback.rating          = intention;
            context.slots.feedback.good            = [];
            context.slots.feedback.comments        = '';
            context.slots.feedback.parsed          = true;
          } else {
            context.slots.feedback.parsed = false;
          }
        } else {
          context.slots.feedback.parsed = false;
        }
      }),
      always: [
        { target: 'submitFeedback', cond: (context) => context.slots.feedback.parsed },
        { target: 'formError' }
      ]
    },

    formError: {
      id: 'feedbackFormError',
      onEntry: assign((context, event) => {
        dialog.sendMessage(context, dialog.get_message(dialog.global_messages.error.retry, context.user.locale), false);
      }),
      always: '#feedbackSendForm'
    },

    submitFeedback: {
      id: 'feedbackSubmit',
      invoke: {
        id: 'submitFeedbackToAPI',
        src: (context) => {
          let serviceObj      = context.slots.feedback.selectedService;
          let rating          = context.slots.feedback.rating;
          let additionalDetail = Array.isArray(context.slots.feedback.good)
            ? context.slots.feedback.good.join(',')
            : '';
          let comments = context.slots.feedback.comments || '';
          return pgrService.submitFeedback(context.user, serviceObj, rating, additionalDetail, comments);
        },
        onDone: {
          target: 'thankYou'
        },
        onError: {
          target: 'submitError'
        }
      }
    },

    thankYou: {
      id: 'feedbackThankYou',
      onEntry: assign((context, event) => {
        dialog.sendMessage(context, dialog.get_message(messages.thankYou, context.user.locale), true);
      }),
      always: '#endstate'
    },

    submitError: {
      id: 'feedbackSubmitError',
      onEntry: assign((context, event) => {
        dialog.sendMessage(context, dialog.get_message(messages.submitError, context.user.locale), true);
      }),
      always: '#endstate'
    }
  }
};

let messages = {
  noComplaints: {
    en_IN: 'No resolved complaints found for your account.\n\nType *egov* to return to the main menu.',
    hi_IN: 'आपके खाते के लिए कोई हल की गई शिकायत नहीं मिली।\n\n*egov* टाइप करके मुख्य मेनू पर लौटें।'
  },
  textFallback: {
    en_IN: 'Please type the rating (1–5) for your complaint:\n\n*1.* ⭐ Very Poor\n*2.* ⭐⭐ Poor\n*3.* ⭐⭐⭐ Average\n*4.* ⭐⭐⭐⭐ Good\n*5.* ⭐⭐⭐⭐⭐ Excellent\n\nYour complaints:\n',
    hi_IN: 'कृपया अपनी शिकायत के लिए रेटिंग (1–5) टाइप करें:\n\n*1.* ⭐ बहुत खराब\n*2.* ⭐⭐ खराब\n*3.* ⭐⭐⭐ औसत\n*4.* ⭐⭐⭐⭐ अच्छा\n*5.* ⭐⭐⭐⭐⭐ उत्कृष्ट\n\nआपकी शिकायतें:\n'
  },
  thankYou: {
    en_IN: 'Thank you for your feedback! 🙏\n\nYour rating has been saved successfully.\n\nType *egov* to return to the main menu.',
    hi_IN: 'आपकी प्रतिक्रिया के लिए धन्यवाद! 🙏\n\nआपकी रेटिंग सफलतापूर्वक सहेजी गई है।\n\n*egov* टाइप करके मुख्य मेनू पर लौटें।'
  },
  submitError: {
    en_IN: 'Sorry, we could not save your feedback. Please try again later.\n\nType *egov* to return to the main menu.',
    hi_IN: 'क्षमा करें, हम आपकी प्रतिक्रिया सहेज नहीं सके। कृपया बाद में पुनः प्रयास करें।\n\n*egov* टाइप करके मुख्य मेनू पर लौटें।'
  }
};

let grammer = {
  rating: [
    { intention: '1', recognize: ['1'] },
    { intention: '2', recognize: ['2'] },
    { intention: '3', recognize: ['3'] },
    { intention: '4', recognize: ['4'] },
    { intention: '5', recognize: ['5'] }
  ]
};

module.exports = feedback;
