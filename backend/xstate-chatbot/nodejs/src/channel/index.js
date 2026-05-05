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
    console.log('Using console as the output channel');
    module.exports = consoleProvider;
}
