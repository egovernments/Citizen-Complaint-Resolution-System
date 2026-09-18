const localisationService = require('./localisation-service');
const config = require('../../env-variables');


const INTENTION_UNKOWN = 'INTENTION_UKNOWN';
const INTENTION_MORE = 'more';
const INTENTION_GOBACK = 'goback';

function get_input(event, scrub = true) {
  const input = event?.message?.input;

  if (typeof input !== 'string') {
      throw new TypeError('Invalid input: event.message.input must be a string.');
    return '';
  }

  return scrub ? input.trim().toLowerCase() : input;
}

function get_message(bundle, locale = config.defaultLocale) {
  locale = locale || config.defaultLocale;
  if (bundle.code) {
    let localised;
    try {
      localised = localisationService.getMessageBundleForCode?.(bundle.code);
    } catch (error) {
      localised = undefined;
    }
    const text = localised && localised[locale];
    if (text && String(text).trim()) return text;
  }
  return (bundle[locale] === undefined) ? bundle[config.defaultLocale] : bundle[locale];
}


function get_intention(g, event, strict = false) {
  const utterance = get_input(event);
  const normalized = normalizeUtterance(utterance);

  // Compare both sides raw and accent-stripped: recognize lists hold accented
  // words ("começar") while displayed labels are matched accent-insensitively, so
  // "SAÚDE" and "saude" must both hit the same option.
  const variants = (entry) =>
    entry.recognize.flatMap((r) => [String(r).trim().toLowerCase(), normalizeUtterance(r)]);

  function exact(e) {
    return variants(e).some((r) => r === utterance || r === normalized);
  }

  function contains(e) {
    return variants(e).some((r) => r && (utterance.includes(r) || normalized.includes(r)));
  }

  let index = strict ? g.findIndex(exact) : g.findIndex((e) => contains(e));
  return (index == -1) ? INTENTION_UNKOWN : g[index].intention;
}


// Recognizes an option by its NUMBER or by the label the citizen was shown, so
// "voltar" steps back a level exactly like picking the numbered Voltar entry.
// Accents and case are stripped: WhatsApp keyboards routinely drop diacritics.
function normalizeUtterance(text) {
  return String(text ?? '').trim().toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');
}

function constructListPromptAndGrammer(keys, message_bundle, locale, more = false, goback = false) {
  var prompt = '';
  var grammer = [];
  if (more) {
    keys = keys.concat([INTENTION_MORE])
    message_bundle = Object.assign({}, message_bundle, {[INTENTION_MORE]: global_messages.more})
  }
  if (goback) {
    keys = keys.concat([INTENTION_GOBACK])
    message_bundle = Object.assign({}, message_bundle, {[INTENTION_GOBACK]: global_messages.goback})
  }

  keys.forEach((element, index) => {
    let value = undefined;
    if(message_bundle[element] !== undefined) {
      value = get_message(message_bundle[element], locale);
    }
    if (value === undefined) {
      value = element;
    }
    var numberAsString = (index+1).toString();
    if(numberAsString.length ===1)
      prompt+= `\n*${index+1}.*  ` + value;
    else
      prompt+= `\n*${index+1}.* ` + value;

    const label = normalizeUtterance(value);
    const recognize = [numberAsString];
    // Only add the label when it cannot be confused with another option's number.
    if (label && !/^\d+$/.test(label)) recognize.push(label);
    grammer.push({intention: element, recognize});
  });
  return {prompt, grammer};
}



function validateInputType(event, type) {
  let inputType = event.message.type;
  return Array.isArray(type) ? type.includes(inputType) : inputType === type;
}

function sendMessage(context, message, immediate = true) {
  if(!context.output) {
    context.output = [];
  }
  context.output.push(message);
  if(immediate) {
    context.chatInterface.toUser(context.user, context.output, context.extraInfo);
    context.output = [];
  }
}

let global_messages = {
  error: {
    retry: {
      code: 'chatbot.pgr.error.retry',
      en_IN: 'Selected option seems to be invalid 😐\n\nPlease select the valid option to proceed further.',
      pt_PT: 'A opção indicada não parece ser válida 😐\n\nEscolha uma opção válida para continuar.'
    }
  },
  system_error: {
    code: 'chatbot.pgr.error.system',
    en_IN: 'I am sorry, our system has a problem and I cannot fulfill your request right now. Could you try again in a few minutes please?',
    pt_PT: 'Lamentamos, o nosso sistema tem um problema e não é possível concluir o seu pedido agora. Pode tentar novamente dentro de alguns minutos.'
  },
  [INTENTION_MORE]: {
    code: 'chatbot.pgr.option.more',
    en_IN: 'See more ...',
    pt_PT: 'Ver mais ...'
  },
  [INTENTION_GOBACK]: {
    code: 'BACK',
    en_IN: 'Go Back',
    pt_PT: 'Voltar'
  },
}

module.exports = { get_input, get_message, get_intention, INTENTION_UNKOWN, INTENTION_MORE, INTENTION_GOBACK, global_messages, constructListPromptAndGrammer, validateInputType, sendMessage };
