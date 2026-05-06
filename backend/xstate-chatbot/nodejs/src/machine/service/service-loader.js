const config = require('../../env-variables');

// The chatbot now ships only the complaint filing/tracking path backed by PGR v2.
console.log("Using eGov Services");
console.log('Using PGR v2');
module.exports.pgrService = require('./egov-pgr');

if(config.kafka.kafkaConsumerEnabled) {
    module.exports.pgrStatusUpdateEvents = require('./pgr-status-update-events');
}
