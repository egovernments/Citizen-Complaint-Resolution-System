module.exports = {
  menu: {
    // used by the original pgr.js (still has both fileComplaint/trackComplaint)
    question: {
      code: 'chatbot.pgr.menu.question',
      en_IN: 'Please type and send the number for your option 👇\n\n*1.* File a new complaint\n*2.* Track existing complaints\n\n👉 To start over, type and send *reiniciar*.',
      pt_PT: 'Envie o número da sua opção: \n\n*1.* Apresentar uma nova manifestação\n*2.* Consultar reclamações existentes\n\n  Para começar de novo, escreva e envie *reiniciar*.'
    },
    // used by pgr-machine.js, which dropped trackComplaint - no `code`, since
    // the real localization service still has an old translation stored
    // under chatbot.pgr.menu.question (get_message would check that first)
    singleOptionQuestion: {
      en_IN: 'Please type and send *1* to file a new complaint, or *2* to cancel.',
      pt_PT: '*Menu* \n\n*1.* Apresentar uma manifestação\n*2.* Cancelar'
    },
    cancelled: {
      en_IN: 'Your session has been cancelled.',
      pt_PT: 'A sua sessão foi cancelada.'
    }

  },
  fileComplaint: {
    complaintType2Step: {
      level: {
        question: {
          preamble: {
            // no `code` - the real localization service has an old translation
            // stored under chatbot.pgr.hierarchy.preamble (get_message would
            // check that first, shadowing any wording change made here)
            en_IN : 'Please type and send the number to select a {{level}} from the list below 👇\n',
            pt_PT : '*{{level}}*\nEnvie o número da opção desejada: \n'
          }
        }
      },
    }, // complaintType2Step
    boundary: {
      question: {
        preamble: {
          // no `code` - same reason as complaintType2Step's preamble above
          en_IN: 'Please type and send the number to select the {{level}} for your grievance 👇\n',
          pt_PT: '*{{level}}*\nEnvie o número correspondente ao local da sua manifestação: \n'
        }
      }
    },
    geoLocation: {
      question: {
        en_IN :'Please share your location if you are at the grievance site.\n\n👉  Refer the image below to understand steps for sharing the location.\n\n👉  To continue without sharing the location, type and send  *1*.',
        hi_IN : 'यदि आप शिकायत स्थल पर हैं तो कृपया अपना स्थान साझा करें।\n\n👉 स्थान साझा करने के चरणों को समझने के लिए नीचे दी गई छवि देखें।\n\n👉 स्थान साझा किए बिना जारी रखने के लिए, टाइप करें और 1 भेजें।',
        pa_IN : 'ਜੇ ਤੁਸੀਂ ਸ਼ਿਕਾਇਤ ਵਾਲੀ ਥਾਂ ਤੇ ਹੋ ਤਾਂ ਕਿਰਪਾ ਕਰਕੇ ਆਪਣਾ ਸਥਾਨ ਸਾਂਝਾ ਕਰੋ.\n\n👉 ਸਥਾਨ ਨੂੰ ਸਾਂਝਾ ਕਰਨ ਦੇ ਕਦਮਾਂ ਨੂੰ ਸਮਝਣ ਲਈ ਹੇਠ ਦਿੱਤੇ ਚਿੱਤਰ ਨੂੰ ਵੇਖੋ.\n\n👉 ਨਿਰਧਾਰਤ ਸਥਾਨ ਸਾਂਝਾ ਕੀਤੇ ਬਗੈਰ ਜਾਰੀ ਰੱਖਣ ਲਈ, 1 ਲਿਖੋ ਅਤੇ ਭੇਜੋ.'
      }
    }, // geoLocation
    confirmLocation: {
      confirmCityAndLocality: {
        en_IN: 'Is this the correct location of the complaint?\nCity: {{city}}\nLocality: {{locality}}\n\nType and send *1* if it is incorrect\nElse, type and send *2* to confirm and proceed',
        hi_IN: 'क्या यह शिकायत का सही स्थान है?\शहर: {{city}}\स्थान: {{locality}}\n\nटाइप करें और 1 भेजें यदि यह गलत है\nअन्यथा, पुष्टि करने और आगे बढ़ने के लिए 2 टाइप करें और भेजें',
        pa_IN: 'ਕੀ ਇਹ ਸ਼ਿਕਾਇਤ ਦਾ ਸਹੀ ਸਥਾਨ ਹੈ?\ਸ਼ਹਿਰ: {{city}}\ਸਥਾਨ: {{locality}}\n\nਟਾਈਪ ਕਰੋ ਅਤੇ 1 ਭੇਜੋ ਜੇ ਇਹ ਗਲਤ ਹੈ\nਹੋਰ, ਪੁਸ਼ਟੀ ਕਰਨ ਅਤੇ ਅੱਗੇ ਵਧਣ ਲਈ ਟਾਈਪ ਕਰੋ ਅਤੇ 2 ਭੇਜੋ'
      },
      confirmCity: {
        en_IN: 'Is this the correct location of the complaint?\nCity: {{city}}\n\nType and send *1* if it is incorrect\nElse, type and send *2* to confirm and proceed',
        hi_IN: 'क्या यह शिकायत का सही स्थान है? \nशहर: {{city}}\n अगर यह गलत है तो कृपया "No" भेजें।\nअन्यथा किसी भी चरित्र को टाइप करें और आगे बढ़ने के लिए भेजें।'
      }
    },
    city: {
      question: {
        preamble: {
          en_IN: 'Please type and send the number to select your city from the list below 👇\n',
          hi_IN: 'नीचे दी गई सूची से अपने शहर का चयन करने के लिए विकल्प संख्या टाइप करें और भेजें 👇\n'
        }
      }
    }, // city
    locality: {
      question: {
        preamble: {
          en_IN: 'Please type and send the number to select your locality from the list below 👇\n',
          hi_IN: 'नीचे दी गई सूची से अपने इलाके का चयन करने के लिए विकल्प संख्या टाइप करें और भेजें 👇\n'
        }
      }
    }, // locality
    consent: {
      dataProcessing: {
        code: 'PGR_CONSENT_DATA_PROCESSING_LABEL',
        en_IN: 'I consent to my data being processed to handle this complaint.',
        pt_PT: 'Autorizo o tratamento dos meus dados pessoais para a tramitação desta manifestação.'
      },
      truthfulness: {
        code: 'PGR_CONSENT_TRUTHFULNESS_LABEL',
        en_IN: 'I declare that the information provided is true and accurate.',
        pt_PT: 'Declaro que as informações prestadas são verdadeiras e exactas.'
      },
      question: {
        code: 'chatbot.pgr.consent.question',
        en_IN: 'Before your grievance is filed, please confirm the following:\n\n{{statements}}\n\n👉 Type and send *1* to accept.\n👉 Type and send *2* to decline.',
        pt_PT: 'Antes de registarmos a sua manifestação, confirme o seguinte:\n\n{{statements}}\n\n*1.* Aceitar.\n*2.* Rejeitar'
      },
      declined: {
        code: 'chatbot.pgr.consent.declined',
        en_IN: 'Your grievance has not been filed, as consent is required to process it.\n\nType *reiniciar* whenever you would like to start again.',
        pt_PT: 'A sua manifestação não foi registada, pois o consentimento é necessário para o seu tratamento.\n\nEscreva *reiniciar* quando quiser começar de novo.'
      }
    },
    confidentiality: {
      label: {
        code: 'PGR_EXT_IS_CONFIDENTIAL_LABEL',
        en_IN: 'Keep details confidential.',
        pt_PT: '*Confidencialidade*'
      },
      hint: {
        code: 'PGR_EXT_IS_CONFIDENTIAL_HINT',
        en_IN: 'Visibility is enforced once secure handling is enabled; for now this flags the complaint for staff awareness.',
        pt_PT: 'A visibilidade é garantida assim que o processamento seguro é ativado; por enquanto, isso sinaliza a manifestação para que a equipe esteja ciente.'
      },
      question: {
        code: 'chatbot.pgr.confidentiality.question',
        en_IN: '{{label}}\n\n{{hint}}\n\n👉 Type and send *1* to keep your details confidential.\n👉 Type and send *2* to continue without confidentiality.',
        pt_PT: '{{label}}\n\n{{hint}}\n\n*1.* Manter os meus dados confidenciais.\n*2.* Continuar sem confidencialidade.'
      }
    },
    institution: {
      question: {
        code: 'chatbot.pgr.institution.question',
        en_IN: 'Which institution is your grievance about?\n\nPlease type and send its name.',
        pt_PT: 'A que instituição se refere a sua manifestação?\n\nEscreva e envie o nome da instituição.'
      },
      tooLong: {
        code: 'chatbot.pgr.institution.tooLong',
        en_IN: 'That name is too long. Please send the institution name using at most {{maxLength}} characters.',
        pt_PT: 'Esse nome é demasiado longo. Envie o nome da instituição com um máximo de {{maxLength}} caracteres.'
      }
    },
    description: {
      question: {
        code: 'chatbot.pgr.description.question',
        en_IN: 'Please describe your grievance in one message, using at least {{minLength}} characters.',
        pt_PT: 'Descreva a sua manifestação numa única mensagem, com pelo menos {{minLength}} caracteres.'
      },
      tooShort: {
        code: 'chatbot.pgr.description.tooShort',
        en_IN: 'That description is too short. Please describe your grievance in at least {{minLength}} characters, in a single message.',
        pt_PT: 'Essa descrição é demasiado curta. Descreva a sua manifestação com pelo menos {{minLength}} caracteres, numa única mensagem.'
      }
    },
    imageUpload: {
      question: {
        code: 'chatbot.pgr.attachment.question',
        en_IN: 'If possible, attach a photo or document of your grievance.\n\nTo continue without attaching, type and send *1*',
        pt_PT: 'Se possível, anexe uma fotografia ou um documento relativo à sua manifestação.\n\n*1.* Continuar sem anexar.'
      },
      failed: {
        en_IN: "Sorry, we couldn't process your attachment. Continuing without it.",
        pt_PT: 'Lamentamos, não foi possível processar o seu anexo. A continuar sem ele.'
      },
      tooLarge: {
        en_IN: 'That file is too large. Please send a file under 5MB.',
        pt_PT: 'Esse ficheiro é demasiado grande. Envie um ficheiro com menos de 5MB.'
      }
    },
    confirmSubmission: {
      question: {
        en_IN: 'Please confirm the details:\n\n{{summary}}\n\n*1.* Submit.\n*2.* Cancel.',
        pt_PT: 'Confirme os dados:\n\n{{summary}}\n\n*1.* Submeter.\n*2.* Cancelar.'
      },
      type: { en_IN: 'Type', pt_PT: 'Tipo' },
      category: { en_IN: 'Category', pt_PT: 'Categoria' },
      subject: { en_IN: 'Subject', pt_PT: 'Assunto' },
      location: { en_IN: 'Location', pt_PT: 'Local' },
      institution: { en_IN: 'Institution', pt_PT: 'Instituição' },
      description: { en_IN: 'Description', pt_PT: 'Descrição' },
      confidentiality: { en_IN: 'Confidentiality', pt_PT: 'Confidencialidade' },
      yes: { en_IN: 'Yes', pt_PT: 'Sim' },
      no: { en_IN: 'No', pt_PT: 'Não' }
    },
    persistComplaint: {
      code: 'chatbot.pgr.confirmation',
      en_IN: 'Your complaint has been registered successfully.\n\nCategory: {{1}}\nReference: {{2}}\nDate: {{3}}\n\nYour complaint will be reviewed by the responsible institution.\nYou can follow its progress on the citizen portal or in the mobile app.\nThank you for helping improve public services.',
      pt_PT: 'Manifestação registada com sucesso.\n\nCategoria: {{1}}\nReferência: {{2}}\nData: {{3}}\n\nA sua manifestação será analisada pela instituição responsável.\nPode acompanhar o estado no portal do cidadão ou na aplicação móvel.\nObrigado por contribuir para a melhoria dos serviços públicos.'
    },
    cityFuzzySearch: {
      question: {
        en_IN: "Enter the name of your city.\n\n(For example - CityA)",
        hi_IN: "अपने शहर का नाम दर्ज करें। (उदाहरण के लिए - CityA)",
        pa_IN: "ਆਪਣੇ ਸ਼ਹਿਰ ਦਾ ਨਾਮ ਦਰਜ ਕਰੋ. (ਉਦਾਹਰਣ ਵਜੋਂ - CityA)"
      },
      confirmation: {
        en_IN: "Did you mean *“{{city}}”* ?\n\n👉  Type and send *1* to confirm.\n\n👉  Type and send *2* to write again.",
        hi_IN: "क्या आपका मतलब *“{{city}}”* से था ?\n\n👉 टाइप करें और पुष्टि करने के लिए 1 भेजें।\n\n👉 टाइप करें और फिर से लिखने के लिए 2 भेजें।",
        pa_IN: "ਕੀ ਤੁਹਾਡਾ ਮਤਲਬ *“{{city}}”* ਹੈ ?\n\n👉 ਪੁਸ਼ਟੀ ਕਰਨ ਲਈ 1 ਲਿਖੋ ਅਤੇ ਭੇਜੋ.\n\n👉 ਟਾਈਪ ਕਰੋ ਅਤੇ ਦੁਬਾਰਾ ਲਿਖਣ ਲਈ 2 ਭੇਜੋ."
      },
      noRecord:{
        en_IN: 'Provided city is miss-spelled or not present in our system record.\nPlease enter the details again.',
        hi_IN: 'आपके द्वारा दर्ज किया गया शहर गलत वर्तनी वाला है या हमारे सिस्टम रिकॉर्ड में मौजूद नहीं है।\nकृपया फिर से विवरण दर्ज करें।'
      }
    },
    localityFuzzySearch: {
      question: {
        en_IN: "Enter the name of your locality.\n\n(For example - Evergreen Park)",
        hi_IN: "अपने इलाके का नाम दर्ज करें। (उदाहरण के लिए - Evergreen Park)",
        pa_IN: "ਆਪਣੇ ਸਥਾਨ ਦਾ ਨਾਮ ਦਰਜ ਕਰੋ. (ਉਦਾਹਰਣ ਵਜੋਂ - Evergreen Park)"
      },
      confirmation: {
        en_IN: "Did you mean *“{{locality}}”* ?\n\n👉  Type and send *1* to confirm.\n\n👉  Type and send *2* to write again.",
        hi_IN: "क्या आपका मतलब *“{{locality}}”* से था ?\n\n👉 टाइप करें और पुष्टि करने के लिए 1 भेजें।\n\n👉 टाइप करें और फिर से लिखने के लिए 2 भेजें।",
        pa_IN: "ਕੀ ਤੁਹਾਡਾ ਮਤਲਬ *“{{locality}}”* ਹੈ ?\n\n👉 ਪੁਸ਼ਟੀ ਕਰਨ ਲਈ 1 ਲਿਖੋ ਅਤੇ ਭੇਜੋ.\n\n👉 ਟਾਈਪ ਕਰੋ ਅਤੇ ਦੁਬਾਰਾ ਲਿਖਣ ਲਈ 2 ਭੇਜੋ."
      },
      noRecord:{
        en_IN: 'Provided locality is miss-spelled or not present in our system record.\nPlease enter the details again.',
        hi_IN: 'आपके द्वारा दर्ज किया गया स्थान गलत वर्तनी वाला है या हमारे सिस्टम रिकॉर्ड में मौजूद नहीं है।\nकृपया फिर से विवरण दर्ज करें।'
      }
    }
  },
  trackComplaint: {
    results: {
      preamble: {
        en_IN: 'Here are your recent complaints 👇',
        hi_IN: 'यहां आपकी हाल की शिकायतें हैं 👇'
      },
      complaintTemplate: {
        en_IN: '*{{complaintType}}*\n\nComplaint No: {{complaintNumber}}\nFiled Date: {{filedDate}}\nStatus: *{{complaintStatus}}*',
        hi_IN: '*{{complaintType}}*\n\nशिकायत संख्या: {{complaintNumber}}\nदायर तिथि: {{filedDate}}\nस्थिति: *{{complaintStatus}}*'
      },
      closingStatement: {
        en_IN: '\n\n👉 To start over, type and send *reiniciar*.',
        hi_IN: '\n\n👉 फिर से शुरू करने के लिए, टाइप करें और भेजें *reiniciar*।'
      }
    },
    noRecords: {
      en_IN: 'No complaint records were found for your account.\n\n👉 To start over, type and send *reiniciar*.',
      hi_IN: 'आपके खाते के लिए कोई शिकायत रिकॉर्ड नहीं मिला।\n\n👉 फिर से शुरू करने के लिए, टाइप करें और भेजें *reiniciar*।'
    }
  }
};
