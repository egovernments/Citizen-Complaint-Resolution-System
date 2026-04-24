const { Machine, assign } = require("xstate");
const pgr = require("./pgr");
const userProfileService = require("./service/egov-user-profile");
const dialog = require("./util/dialog.js");

const sevaMachine = Machine({
  id: "mseva",
  initial: "start",
  on: {
    USER_RESET: {
      target: "#welcome",
      // actions: assign( (context, event) => dialog.sendMessage(context, dialog.get_message(messages.reset, context.user.locale), false))
    },
  },
  states: {
    start: {
      on: {
        USER_MESSAGE: [
          {
            cond: (context) => context.user.locale,
            target: "#welcome",
          },
          {
            target: "#onboarding",
          },
        ],
      },
    },
    onboarding: {
      id: "onboarding",
      initial: "onboardingLocale",
      states: {
        onboardingLocale: {
          id: "onboardingLocale",
          initial: "question",
          states: {
            question: {
              onEntry: assign((context, event) => {
                context.onboarding = {};
                let message = messages.onboarding.onboardingLocale.question;
                context.grammer = grammer.locale.question;
                var templateContent = {
                  output: "3797433",
                  type: "template",
                };
                //dialog.sendMessage(context, templateContent, true);
                dialog.sendMessage(context, message, true);
              }),
              on: {
                USER_MESSAGE: "process",
              },
            },
            process: {
              onEntry: assign((context, event) => {
                if (dialog.validateInputType(event, "text"))
                  context.intention = dialog.get_intention(
                    context.grammer,
                    event,
                    true
                  );
                else context.intention = dialog.INTENTION_UNKOWN;
                if (context.intention != dialog.INTENTION_UNKOWN) {
                  context.user.locale = context.intention;
                } else {
                  context.user.locale = "en_IN";
                }
                context.onboarding.locale = context.user.locale;
              }),
              always: "#onboardingWelcome",
            },
          },
        },
        onboardingWelcome: {
          id: "onboardingWelcome",
          onEntry: assign((context, event) => {
            let message = dialog.get_message(
              messages.onboarding.onboardingWelcome,
              context.user.locale
            );
            dialog.sendMessage(context, message);
          }),
          always: "#onboardingName",
        },
        onboardingName: {
          id: "onboardingName",
          initial: "preCondition",
          states: {
            preCondition: {
              always: [
                {
                  target: "#onBoardingUserProfileConfirmation",
                  cond: (context) => context.user.name,
                },
                {
                  target: "question",
                },
              ],
            },
            question: {
              onEntry: assign((context, event) => {
                (async () => {
                  await new Promise((resolve) => setTimeout(resolve, 3000));
                  let nameInformationMessage = dialog.get_message(
                    messages.onboarding.nameInformation,
                    context.user.locale
                  );
                  dialog.sendMessage(context, nameInformationMessage);
                  await new Promise((resolve) => setTimeout(resolve, 1000));
                  let message = dialog.get_message(
                    messages.onboarding.onboardingName.question,
                    context.user.locale
                  );
                  dialog.sendMessage(context, message);
                })();
              }),
              on: {
                USER_MESSAGE: "process",
              },
            },
            process: {
              onEntry: assign((context, event) => {
                if (!dialog.validateInputType(event, "text")) return;
                context.onboarding.name = dialog.get_input(event, false);
              }),
              always: [
                {
                  cond: (context) => context.onboarding.name,
                  target: "#onboardingNameConfirmation",
                },
                {
                  target: "#onboardingUpdateUserProfile",
                },
              ],
            },
          },
        },
        onBoardingUserProfileConfirmation: {
          id: "onBoardingUserProfileConfirmation",
          initial: "question",
          states: {
            question: {
              onEntry: assign((context, event) => {
                (async () => {
                  await new Promise((resolve) => setTimeout(resolve, 3000));
                  let nameInformationMessage = dialog.get_message(
                    messages.onboarding.nameInformation,
                    context.user.locale
                  );
                  dialog.sendMessage(context, nameInformationMessage, false);
                  await new Promise((resolve) => setTimeout(resolve, 1000));
                  let message = dialog.get_message(
                    messages.onboarding.onBoardingUserProfileConfirmation
                      .question,
                    context.user.locale
                  );
                  message = message.replace("{{name}}", context.user.name);
                  dialog.sendMessage(context, message);
                })();
              }),
              on: {
                USER_MESSAGE: "process",
              },
            },
            process: {
              onEntry: assign((context, event) => {
                if (dialog.validateInputType(event, "text"))
                  context.intention = dialog.get_intention(
                    grammer.confirmation.choice,
                    event,
                    true
                  );
                else context.intention = dialog.INTENTION_UNKOWN;
              }),
              always: [
                {
                  target: "#onboardingUpdateUserProfile",
                  cond: (context) => context.intention == "Yes",
                },
                {
                  target: "#changeName",
                  cond: (context) => context.intention == "No",
                },
              ],
            },
          },
        },
        changeName: {
          id: "changeName",
          initial: "invoke",
          states: {
            invoke: {
              onEntry: assign((context, event) => {
                let message = dialog.get_message(
                  messages.onboarding.changeName.question,
                  context.user.locale
                );
                dialog.sendMessage(context, message);
              }),
              on: {
                USER_MESSAGE: "process",
              },
            },
            process: {
              onEntry: assign((context, event) => {
                if (!dialog.validateInputType(event, "text")) return;
                context.onboarding.name = dialog.get_input(event, false);
              }),
              always: {
                target: "#onboardingNameConfirmation",
                cond: (context) => context.onboarding.name,
              },
            },
          },
        },
        onboardingNameConfirmation: {
          id: "onboardingNameConfirmation",
          initial: "question",
          states: {
            question: {
              onEntry: assign((context, event) => {
                (async () => {
                  await new Promise((resolve) => setTimeout(resolve, 1000));
                  let message = dialog.get_message(
                    messages.onboarding.onboardingNameConfirmation,
                    context.user.locale
                  );
                  message = message.replace(
                    "{{name}}",
                    context.onboarding.name
                  );
                  dialog.sendMessage(context, message);
                })();
              }),
              on: {
                USER_MESSAGE: "process",
              },
            },
            process: {
              onEntry: assign((context, event) => {
                if (dialog.validateInputType(event, "text"))
                  context.intention = dialog.get_intention(
                    grammer.confirmation.choice,
                    event,
                    true
                  );
                else context.intention = dialog.INTENTION_UNKOWN;
              }),
              always: [
                {
                  target: "#onboardingUpdateUserProfile",
                  actions: assign((context, event) => {
                    context.user.name = context.onboarding.name;
                  }),
                  cond: (context) => context.intention == "Yes",
                },
                {
                  target: "#changeName",
                  cond: (context) => context.intention == "No",
                },
                {
                  target: "error",
                },
              ],
            },
            error: {
              onEntry: assign((context, event) => {
                let message = dialog.get_message(
                  dialog.global_messages.error.retry,
                  context.user.locale
                );
                dialog.sendMessage(context, message, true);
              }),
              always: "question",
            },
          },
        },
        onboardingUpdateUserProfile: {
          id: "onboardingUpdateUserProfile",
          invoke: {
            id: "updateUserProfile",
            src: (context, event) =>
              userProfileService.updateUser(
                context.user,
                context.onboarding,
                context.extraInfo.tenantId
              ),
            onDone: [
              {
                target: "#onboardingThankYou",
                actions: assign((context, event) => {
                  context.user.name = context.onboarding.name;
                  context.user.locale = context.onboarding.locale;
                  context.onboarding = undefined;
                }),
                cond: (context) => context.onboarding.name,
              },
              {
                target: "#onboardingThankYou",
              },
            ],
            onError: {
              target: "#welcome",
            },
          },
        },
        onboardingThankYou: {
          id: "onboardingThankYou",
          onEntry: assign((context, event) => {
            let message = dialog.get_message(
              messages.onboarding.onboardingThankYou,
              context.user.locale
            );
            dialog.sendMessage(context, message, true);
          }),
          always: "#pgr",
        },
      },
    },
    welcome: {
      id: "welcome",
      initial: "preCondition",
      states: {
        preCondition: {
          always: [
            {
              target: "invoke",
              cond: (context) => context.user.locale,
            },
            {
              target: "#onboarding",
            },
          ],
        },
        invoke: {
          onEntry: assign((context, event) => {
            var message = dialog.get_message(
              messages.welcome,
              context.user.locale
            );
            let name = "Citizen";
            if (context.user.name) {
              message = message.replace("{{name}}", context.user.name);
              name = context.user.name;
            } else {
              message = message.replace("{{name}}", "Citizen");
              name = "Citizen";
            }
            let params = [];
            params.push(name);

            var templateContent = {
              output: "3797437",
              type: "template",
              params: params,
            };
            //dialog.sendMessage(context, templateContent, true);
            dialog.sendMessage(context, message, true);
          }),
          always: "#pgr",
        },
      },
    },
    pgr: pgr,
    endstate: {
      id: "endstate",
      always: "start",
      // type: 'final', //Another approach: Make it a final state so session manager kills this machine and creates a new one when user types again
      // onEntry: assign((context, event) => {
      //   dialog.sendMessage(context, dialog.get_message(messages.endstate, context.user.locale));
      // })
    },
    system_error: {
      id: "system_error",
      always: {
        target: "#welcome",
        actions: assign((context, event) => {
          let message = dialog.get_message(
            dialog.global_messages.system_error,
            context.user.locale
          );
          dialog.sendMessage(context, message, true);
          context.chatInterface.system_error(event.data);
        }),
      },
    },
  }, // states
}); // Machine

let messages = {
  reset: {
    en_IN: "Ok. Let's start over.",
    hi_IN: "ठीक। फिर से शुरू करते हैं।",
  },
  onboarding: {
    onboardingWelcome: {
      en_IN:
        "Dear Citizen,\n\nWelcome to the eGov Whatsapp Chatbot experience 🙏\n\nNow you can file your complaint via WhatsApp.",
      hi_IN:
        "प्रिय नागरिक,\n\neGov पंजाब में आपका स्वागत है 🙏\n\nअब आप व्हाट्सएप के माध्यम से अपनी शिकायत दर्ज कर सकते हैं।",
      pa_IN:
        "ਪਿਆਰੇ ਨਾਗਰਿਕ,\n\neGov ਪੰਜਾਬ ਵਿਚ ਤੁਹਾਡਾ ਸਵਾਗਤ ਹੈ 🙏\n\nਹੁਣ ਤੁਸੀਂ ਵਟਸਐਪ ਰਾਹੀਂ ਆਪਣੀ ਸ਼ਿਕਾਇਤ ਦਰਜ ਕਰ ਸਕਦੇ ਹੋ.",
    },
    onboardingLocale: {
      question:
        "To select the language simply type and send the number of the preferred option  👇\n\n1.   English\n2.   हिन्दी\n3.   ਪੰਜਾਬੀ",
    },
    onboardingName: {
      question: {
        en_IN:
          "As per our records, we have not found any name linked to this mobile number.\n\n👉  Please provide your name to continue.",
        hi_IN:
          "हमारे रिकॉर्ड के अनुसार, हमें इस मोबाइल नंबर से जुड़ा कोई नाम नहीं मिला है।\n\n👉 जारी रखने के लिए कृपया अपना नाम प्रदान करें।",
        pa_IN:
          "ਸਾਡੇ ਰਿਕਾਰਡ ਦੇ ਅਨੁਸਾਰ, ਸਾਨੂੰ ਇਸ ਮੋਬਾਈਲ ਨੰਬਰ ਨਾਲ ਜੁੜਿਆ ਕੋਈ ਨਾਮ ਨਹੀਂ ਮਿਲਿਆ ਹੈ.\n\n👉 ਜਾਰੀ ਰੱਖਣ ਲਈ ਕਿਰਪਾ ਕਰਕੇ ਆਪਣਾ ਨਾਮ ਦੇਣ ਦੀ ਖ਼ੇਚਲ ਕੀਤੀ ਜਾਵੈ",
      },
    },
    onBoardingUserProfileConfirmation: {
      question: {
        en_IN:
          "As per our records, we have found the name  *“{{name}}”* linked with this mobile number.\n\n👉  Type and send *1* to confirm the name.\n\n👉  Type and send *2* to change the name.",
        hi_IN:
          "हमारे रिकॉर्ड के अनुसार, हमें इस मोबाइल नंबर से जुड़ा *“{{name}}”* नाम मिला है।\n\n👉 नाम की पुष्टि करने के लिए 1 टाइप करें और भेजें\n\n👉 नाम बदलने के लिए 2 टाइप करें और भेजें",
        pa_IN:
          "ਸਾਡੇ ਰਿਕਾਰਡ ਦੇ ਅਨੁਸਾਰ, ਸਾਨੂੰ ਇਸ ਮੋਬਾਈਲ ਨੰਬਰ ਨਾਲ ਜੋੜਿਆ *“{{name}}”*ਨਾਮ ਮਿਲਿਆ ਹੈ.\n\n👉  ਨਾਮ ਦੀ ਪੁਸ਼ਟੀ ਕਰਨ ਲਈ 1 ਟਾਈਪ ਕਰੋ ਅਤੇ ਭੇਜੋ\n\n👉 ਨਾਮ ਬਦਲਣ ਲਈ 2 ਟਾਈਪ ਕਰੋ ਅਤੇ ਭੇਜੋ",
      },
    },
    changeName: {
      question: {
        en_IN: "Please provide your name to continue.",
        hi_IN: "जारी रखने के लिए कृपया अपना नाम प्रदान करें।",
        pa_IN: "ਜਾਰੀ ਰੱਖਣ ਲਈ ਕਿਰਪਾ ਕਰਕੇ ਆਪਣਾ ਨਾਮ ਦੇਣ ਦੀ ਖ਼ੇਚਲ ਕੀਤੀ ਜਾਵੈ",
      },
    },
    onboardingNameConfirmation: {
      en_IN:
        "Confirm Name : {{name}}?\n\n👉  Type and send *1* to confirm the name.\n\n👉  Type and send *2* to change the name.",
      hi_IN:
        "पुष्टि नाम: {{name}}?\n\n👉  नाम की पुष्टि करने के लिए 1 टाइप करें और भेजें.\n\n👉  नाम बदलने के लिए 2 टाइप करें और भेजें.",
      pa_IN:
        "ਨਾਮ ਦੀ ਪੁਸ਼ਟੀ ਕਰੋ: {{name}}?\n\n👉  ਨਾਮ ਦੀ ਪੁਸ਼ਟੀ ਕਰਨ ਲਈ 1 ਟਾਈਪ ਕਰੋ ਅਤੇ ਭੇਜੋ.\n\n👉 ਟਾਈਪ ਕਰੋ ਅਤੇ ਨਾਮ ਬਦਲਣ ਲਈ 2 ਭੇਜੋ.",
    },
    onboardingThankYou: {
      en_IN:
        "Thanks for providing the confirmation 👍\nWe are happy to serve you 😊",
      hi_IN:
        "पुष्टि प्रदान करने के लिए धन्यवाद 👍\nहम आपकी सेवा करके खुश हैं 😊",
      pa_IN:
        "ਪੁਸ਼ਟੀ ਪ੍ਰਦਾਨ ਕਰਨ ਲਈ ਧੰਨਵਾਦ 👍\nਅਸੀਂ ਤੁਹਾਡੀ ਸੇਵਾ ਕਰ ਕੇ ਖੁਸ਼ ਹਾਂ 😊",
    },
    nameInformation: {
      en_IN:
        "For a personalized experience, we would like to confirm your name.",
      hi_IN: "एक व्यक्तिगत अनुभव के लिए, हम आपके नाम की पुष्टि करना चाहेंगे।",
      pa_IN: "ਇੱਕ ਨਿੱਜੀ ਤਜਰਬੇ ਲਈ, ਅਸੀਂ ਤੁਹਾਡੇ ਨਾਮ ਦੀ ਪੁਸ਼ਟੀ ਕਰਨਾ ਚਾਹੁੰਦੇ ਹਾਂ.",
    },
  },
  welcome: {
    en_IN:
      "Dear {{name}},\n\nWelcome to eGov WhatsApp chatbot 🙏.\n\nYou can now file your complaint via WhatsApp.\n",
    hi_IN:
      "नमस्ते {{name}},\n\neGov पंजाब में आपका स्वागत है 🙏।\n\nअब आप WhatsApp द्वारा शिकायत दर्ज कर सकते हैं।",
  },
  endstate: {
    en_IN: "Goodbye. Say hi to start another conversation",
    hi_IN: "अलविदा। एक और बातचीत शुरू करने के लिए नमस्ते कहें",
    pa_IN: "ਅਲਵਿਦਾ। ਇੱਕ ਹੋਰ ਗੱਲਬਾਤ ਸ਼ੁਰੂ ਕਰਨ ਲਈ ਹੈਲੋ ਕਹੋ",
  },
};

let grammer = {
  locale: {
    question: [
      { intention: "en_IN", recognize: ["1", "english"] },
      { intention: "hi_IN", recognize: ["2", "hindi"] },
      { intention: "pa_IN", recognize: ["3", "punjabi"] },
    ],
  },
  confirmation: {
    choice: [
      { intention: "Yes", recognize: ["1", "yes", "Yes"] },
      { intention: "No", recognize: ["2", "no", "No"] },
    ],
  },
};

module.exports = sevaMachine;
