// Every citizen-facing string in the onboarding journey and the shell.
//
// `code` is a localisation key looked up live at send time; the locale entries
// below are the fallback used when the platform has no translation. Codes are
// external contracts — they exist nowhere else in this repo, so changing one
// silently stops translations resolving.
//
// Copy for the unreachable organization-code flow lives with that flow, in
// flow/legacy-organization.js.

module.exports = {
  onboarding: {
    localeMenu: {
      code: 'chatbot.pgr.locale.question',
      en_IN: "To select the language simply type and send the number of the preferred option  👇\n\n{{options}}",
      pt_PT: "Para escolher o idioma, envie o número da opção pretendida: \n\n{{options}}",
    },
    onboardingWelcome: {
      code: 'chatbot.pgr.onboarding.welcome',
      en_IN:
        "Dear Citizen,\n\nWelcome to the complaint chatbot on WhatsApp\nNow you can file your complaint via WhatsApp.\n\nTo cancel at any time, type *Cancel*.",
      pt_PT:
        "Estimado(a) Cidadão(ã),\n\nBem-vindo(a) ao chatbot de manifestações no WhatsApp\nJá pode apresentar a sua manifestação através do WhatsApp.\n\nPara cancelar em qualquer momento, escreva *Cancelar*.",
    },
    onboardingName: {
      question: {
        code: 'chatbot.pgr.onboarding.name.question',
        en_IN:
          "As per our records, we have not found any name linked to this mobile number.\n\n👉  Please provide your name to continue.",
        pt_PT:
          "Nos nossos registos não encontrámos nenhum nome associado a este número.\n\n  Escreva o seu nome para continuar:",
      },
    },
    onBoardingUserProfileConfirmation: {
      question: {
        code: 'chatbot.pgr.onboarding.name.confirmProfile',
        en_IN:
          "As per our records, we have found the name  *“{{name}}”* linked with this mobile number.\n\n*1.* Confirm the name.\n*2.* Change the name.",
        pt_PT:
          "Nos nossos registos, este número está associado ao nome  *“{{name}}”*.\n\n*1.* Confirmar o nome.\n*2.* Alterar o nome.",
      },
    },
    changeName: {
      question: {
        code: 'chatbot.pgr.onboarding.name.change',
        en_IN: "Please provide your name to continue.",
        pt_PT: "Indique o seu nome para continuar.",
      },
    },
    onboardingNameConfirmation: {
      code: 'chatbot.pgr.onboarding.name.confirm',
      en_IN:
        "Confirm Name : {{name}}?\n\n👉  Type and send *1* to confirm the name.\n\n👉  Type and send *2* to change the name.",
      pt_PT:
        "Confirmar o nome: {{name}}?\n\n*1.* Confirmar o nome.\n*2.* Alterar o nome.",
    },
    onboardingThankYou: {
      code: 'chatbot.pgr.onboarding.thankYou',
      en_IN:
        "Thanks for providing the confirmation 👍\nWe are happy to serve you 😊",
      pt_PT:
        "Obrigado pela confirmação \nÉ um prazer servi-lo(a)",
    },
    nameInformation: {
      code: 'chatbot.pgr.onboarding.nameInformation',
      en_IN:
        "For a personalized experience, we would like to confirm your name.",
      pt_PT:
        "Para um atendimento personalizado, gostaríamos de confirmar o seu nome.",
    },
  },
    welcome: {
    code: 'chatbot.pgr.welcome',
    en_IN:
      "Dear {{name}},\n\nWelcome to the complaint chatbot on WhatsApp.\n\nYou can now file your complaint via WhatsApp.\n\nTo cancel at any time, type *Cancel*.",
    pt_PT:
      "Estimado(a) {{name}},\n\nBem-vindo(a) ao chatbot de manifestações no WhatsApp.\nJá pode apresentar a sua manifestação através do WhatsApp.\n\nPara cancelar em qualquer momento, escreva *Cancelar*.",
  },
  sessionExpired: {
    question: {
      en_IN: 'Your previous session timed out.\n\n*1.* Resume where you left off.\n*2.* Start a new conversation.',
      pt_PT: 'A sua sessão anterior expirou.\n\n*1.* Continuar de onde terminou.\n*2.* Iniciar uma nova conversa.'
    },
    resumed: {
      en_IN: 'Resuming your previous conversation. Please send your next message.',
      pt_PT: 'A continuar a sua conversa anterior. Envie a sua próxima mensagem.'
    },
    invalid: {
      en_IN: 'Please reply *1* to resume or *2* to start over.',
      pt_PT: 'Responda *1* para continuar ou *2* para começar de novo.'
    }
  },
    notAuthorized: {
    en_IN: "Sorry, this number is not yet authorized to use this service.",
    pt_PT: "Lamentamos, este número ainda não está autorizado a utilizar este serviço.",
  },
  // Sent by error-handler.js when a turn fails. {{digits}} is filled from
  // config.mobileNumberLength; it used to read "10 digits" on every deployment.
  errors: {
    generic: {
      code: 'chatbot.pgr.error.generic',
      en_IN: 'Sorry, there was an error processing your request. Please try again.',
      pt_PT: 'Lamentamos, ocorreu um erro ao processar o seu pedido. Tente novamente.',
    },
    validation: {
      code: 'chatbot.pgr.error.validation',
      en_IN: 'Sorry, we could not process your request. Please check your mobile number ({{digits}} digits) and try again.',
      pt_PT: 'Lamentamos, não foi possível processar o seu pedido. Verifique o seu número de telemóvel ({{digits}} dígitos) e tente novamente.',
    },
    authentication: {
      code: 'chatbot.pgr.error.authentication',
      en_IN: 'Sorry, we could not verify your account. Please try again in a moment.',
      pt_PT: 'Lamentamos, não foi possível verificar a sua conta. Tente novamente dentro de momentos.',
    },
    externalService: {
      code: 'chatbot.pgr.error.externalService',
      en_IN: 'Sorry, our service is temporarily unavailable. Please try again shortly.',
      pt_PT: 'Lamentamos, o serviço está temporariamente indisponível. Tente novamente em breve.',
    },
  },
  submissionStalled: {
    code: 'chatbot.pgr.submissionStalled',
    en_IN: 'Sorry, we could not complete your request. The session has been closed — send a message to start again.',
    pt_PT: 'Lamentamos, não foi possível concluir o seu pedido. A sessão foi terminada — envie uma mensagem para recomeçar.',
  },
};
