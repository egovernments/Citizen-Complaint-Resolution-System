const config = require('../env-variables');

class ConsoleProvider {
    extractRawMessage(req) {
        return req.body;
    }

    isValid(rawMessage) {
        return !!(rawMessage && rawMessage.message && rawMessage.user);
    }

    getFormattedMessageFromUser(rawMessage) {
        let reformattedMessage = {
            message: {
                type: rawMessage.message.type,
                input: rawMessage.message.input,
                // metadata: rawMessage.message.metadata ? rawMessage.message.metadata : {},
            },
            user: {
                mobileNumber: rawMessage.user.mobileNumber
            },
            extraInfo: {
                whatsAppBusinessNumber: rawMessage.extraInfo.whatsAppBusinessNumber,
                tenantId: config.rootTenantId
            }
        }
        return reformattedMessage;
    }

    sendMessageToUser(user, outputMessages, extraInfo) {
        if(!Array.isArray(outputMessages)) {
            let message = outputMessages;
            outputMessages = [ message ];
            console.warn('Output array had to be constructed. Remove the use of deeprecated function from the code. \ndialog.sendMessage() function should be used to send any message instead of any previously used methods.');
        }

        // console.log(user);
        for(let message of outputMessages) {
            console.log(message);
        }
    }
}

module.exports = new ConsoleProvider();
