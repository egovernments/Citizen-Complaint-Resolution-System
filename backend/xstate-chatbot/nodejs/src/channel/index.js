const config = require('../env-variables');
const consoleProvider = require('./console');
const valueFirstWhatsAppProvider = require('./value-first');

if(config.whatsAppProvider == 'ValueFirst') {
    console.log('Using ValueFirst as the channel')
    module.exports = valueFirstWhatsAppProvider;
} else if(config.whatsAppProvider == 'Kaleyra') {
    console.log('Using Kaleyra as the channel');
    module.exports = require('./kaleyra');
} else if(config.whatsAppProvider == 'Twilio') {
    console.log('Using Twilio as the channel');
    module.exports = require('./twilio');
} else {
    console.warn('Using console as the output channel - webhook verification is NOT enforced');
    module.exports = consoleProvider;
}

if (typeof module.exports.verifyRequest !== 'function') {
    throw new Error(
        `Channel provider '${config.whatsAppProvider}' does not implement verifyRequest. ` +
        'Every provider must answer for request authenticity; a missing one used to mean no check at all.'
    );
}

