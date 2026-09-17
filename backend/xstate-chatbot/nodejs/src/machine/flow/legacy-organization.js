// Unreachable: onboarding.initial is 'onboardingLocale' and nothing targets
// #organizationCode. Kept verbatim (dedented only) so the multi-tenant
// onboarding flow can be revived.
const { assign } = require("xstate");
const dialog = require("../util/dialog.js");

const email = {
    question: {
      en_IN: "Please enter your registered email address:",
      hi_IN: "कृपया अपना पंजीकृत ईमेल पता दर्ज करें:",
      pa_IN: "ਕਿਰਪਾ ਕਰਕੇ ਆਪਣਾ ਰਜਿਸਟਰਡ ਈਮੇਲ ਪਤਾ ਦਰਜ ਕਰੋ:"
    },
    invalidEmail: {
      en_IN: "❌ Email not found. Please check your email and try again.",
      hi_IN: "❌ ईमेल नहीं मिला। कृपया अपना ईमेल जांचें और पुनः प्रयास करें।",
      pa_IN: "❌ ਈਮੇਲ ਨਹੀਂ ਮਿਲਿਆ। ਕਿਰਪਾ ਕਰਕੇ ਆਪਣਾ ਈਮੇਲ ਜਾਂਚੋ ਅਤੇ ਦੁਬਾਰਾ ਕੋਸ਼ਿਸ਼ ਕਰੋ।"
    },
    userFound: {
      en_IN: "✅ Welcome back! How can I help you today?",
      hi_IN: "✅ स्वागत है! मैं आज आपकी कैसे मदद कर सकता हूं?",
      pa_IN: "✅ ਵਾਪਸੀ ਦਾ ਸਵਾਗਤ! ਮੈਂ ਅੱਜ ਤੁਹਾਡੀ ਕਿਵੇਂ ਮਦਦ ਕਰ ਸਕਦਾ ਹਾਂ?"
    },
    notRegistered: {
      en_IN: "❌ Your number is not registered with *{{organizationName}}*.\n\n👉 Complete your registration:\n{{registrationUrl}}\n\nAfter registration, type *Hi* to continue.",
      hi_IN: "❌ आपका नंबर *{{organizationName}}* के साथ पंजीकृत नहीं है।\n\n👉 अपना पंजीकरण पूरा करें:\n{{registrationUrl}}\n\nपंजीकरण के बाद, जारी रखने के लिए *Hi* टाइप करें।",
      pa_IN: "❌ ਤੁਹਾਡਾ ਨੰਬਰ *{{organizationName}}* ਨਾਲ ਰਜਿਸਟਰਡ ਨਹੀਂ ਹੈ।\n\n👉 ਆਪਣੀ ਰਜਿਸਟ੍ਰੇਸ਼ਨ ਪੂਰੀ ਕਰੋ:\n{{registrationUrl}}\n\nਰਜਿਸਟ੍ਰੇਸ਼ਨ ਤੋਂ ਬਾਅਦ, ਜਾਰੀ ਰੱਖਣ ਲਈ *Hi* ਟਾਈਪ ਕਰੋ।"
    }
  };

module.exports = ({ emailTenantService }) => ({
  organizationCode: {
    id: "organizationCode",
    initial: "question",
    states: {
      question: {
        onEntry: assign((context, event) => {
          let message = dialog.get_message(
            email.question,
            context.user.locale
          );
          dialog.sendMessage(context, message);
        }),
        on: {
          USER_MESSAGE: "process"
        }
      },
      process: {
        invoke: {
          id: 'validateEmail',
          src: (context, event) => {
            const email = event.message.input.trim().toLowerCase();
            context.onboarding.email = email;
            return emailTenantService.findTenantByEmail(email);
          },
          onDone: [
            {
              target: 'selectOrganization',
              cond: (context, event) => event.data !== null && event.data.multiple === true,
              actions: assign((context, event) => {
                context.onboarding.availableTenants = event.data.tenants;
                context.onboarding.email = context.onboarding.email;
              })
            },
            {
              target: 'checkUserRegistration',
              cond: (context, event) => event.data !== null && event.data.multiple === false,
              actions: assign((context, event) => {
                const tenant = event.data.tenants[0];
                context.onboarding.organizationCode = tenant.code;
                context.onboarding.organizationName = tenant.name;
                context.onboarding.organizationEmail = tenant.email;
                context.extraInfo.tenantId = tenant.code;
              })
            },
            {
              target: 'error'
            }
          ],
          onError: 'error'
        }
      },
      selectOrganization: {
        id: "selectOrganization",
        initial: "question",
        states: {
          question: {
            onEntry: assign((context, event) => {
              let tenantList = context.onboarding.availableTenants
                .map((tenant, index) => `${index + 1}. ${tenant.name} (${tenant.code})`)
                .join('\n');

              let message = `Multiple organizations found for email ${context.onboarding.email}:\n\n${tenantList}\n\nPlease enter the number of the organization you want to use:`;
              dialog.sendMessage(context, message);
            }),
            on: {
              USER_MESSAGE: 'process'
            }
          },
          process: {
            onEntry: assign((context, event) => {
              const input = event.message.input.trim();
              const selectedIndex = parseInt(input) - 1;

              if (selectedIndex >= 0 && selectedIndex < context.onboarding.availableTenants.length) {
                const selectedTenant = context.onboarding.availableTenants[selectedIndex];
                context.onboarding.organizationCode = selectedTenant.code;
                context.onboarding.organizationName = selectedTenant.name;
                context.onboarding.organizationEmail = selectedTenant.email;
                context.extraInfo.tenantId = selectedTenant.code;
                context.onboarding.validSelection = true;
              } else {
                context.onboarding.validSelection = false;
              }
            }),
            always: [
              {
                target: '#checkUserRegistration',
                cond: (context) => context.onboarding.validSelection === true
              },
              {
                target: 'invalidSelection'
              }
            ]
          },
          invalidSelection: {
            onEntry: assign((context, event) => {
              let message = `Invalid selection. Please enter a number between 1 and ${context.onboarding.availableTenants.length}.`;
              dialog.sendMessage(context, message);
            }),
            always: 'question'
          }
        }
      },
      checkUserRegistration: {
        id: 'checkUserRegistration',
        invoke: {
          id: 'checkUserRegistrationService',
          src: (context, event) => {
            // Now we have tenant from email, check if user exists in this tenant
            return emailTenantService.authenticateUser(
              context.user.mobileNumber,
              context.onboarding.organizationCode
            );
          },
          onDone: [
            {
              target: 'userFound',
              cond: (context, event) => event.data && event.data.exists === true,
              actions: assign((context, event) => {
                context.onboarding.userExistsInOrg = true;
                context.onboarding.userInfo = event.data;
              })
            },
            {
              target: 'notRegistered'
            }
          ],
          onError: 'error'
        }
      },
      userFound: {
        onEntry: assign((context, event) => {
          // User exists and is validated - proceed to welcome
          let message = dialog.get_message(
            email.userFound || "Email verified successfully!",
            context.user.locale
          );
          dialog.sendMessage(context, message);

          // Store org tenant for the session - use tenantId which PGR service expects
          context.extraInfo.tenantId = context.onboarding.organizationCode;
          context.extraInfo.organizationTenantId = context.onboarding.organizationCode;

          // Store user auth info if available
          if (context.onboarding.userInfo) {
            context.user.authToken = context.onboarding.userInfo.authToken;
            context.user.refreshToken = context.onboarding.userInfo.refreshToken;
            if (context.onboarding.userInfo.userInfo) {
              context.user.userInfo = context.onboarding.userInfo.userInfo;
            }
          }
        }),
        always: '#onboardingWelcome'
      },
      notRegistered: {
        onEntry: assign((context, event) => {
          const registrationUrl = emailTenantService.getSandboxRegistrationUrl(
            context.onboarding.organizationEmail
          );
          let message = dialog.get_message(
            email.notRegistered,
            context.user.locale
          ) || `You are not registered with {{organizationName}}. Please register first at:\n{{registrationUrl}}`;
          message = message.replace('{{registrationUrl}}', registrationUrl);
          message = message.replace('{{organizationName}}', context.onboarding.organizationName || context.onboarding.organizationCode);
          dialog.sendMessage(context, message);

          // Store org code for future attempts
          context.extraInfo.organizationTenantId = context.onboarding.organizationCode;
        }),
        always: '#endstate'
      },
      error: {
        onEntry: assign((context, event) => {
          let message = dialog.get_message(
            email.invalidEmail,
            context.user.locale
          );
          dialog.sendMessage(context, message, false);
        }),
        always: 'question'
      }
    }
  }
});
