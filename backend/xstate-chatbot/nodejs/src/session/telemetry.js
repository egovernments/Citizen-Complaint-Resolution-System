const config = require('../env-variables');
const producer = require('./kafka/kafka-producer');
const uuid = require('uuid');
const { maskMobile } = require('../privacy');

// Telemetry is published to a Kafka topic and whatever indexes it downstream, so it
// must never carry credentials. The inbound request model carries user.authToken —
// the SHARED service-account token, which can call user/_search,
// users/_createnovalidate and _updatenovalidate until it expires. ChatState's
// withoutUserData() strips it only on the Postgres path, not here. Redacting at this
// boundary instead of per call site means a new caller cannot reintroduce the leak.
const SECRET_KEYS = new Set(["authToken", "access_token", "refresh_token", "password"]);

// Mobile numbers identify a person who filed a grievance, often about their own
// government. Masked, not dropped: correlating two events still works.
const MOBILE_KEYS = new Set(["mobileNumber", "whatsAppBusinessNumber", "mobile_number", "From", "To", "from", "to"]);

function redactSecrets(value, seen = new WeakSet()) {
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return undefined; // model graphs can self-reference
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => redactSecrets(item, seen));
  const out = {};
  for (const [key, val] of Object.entries(value)) {
    out[key] = SECRET_KEYS.has(key) ? "[REDACTED]"
      : MOBILE_KEYS.has(key) ? maskMobile(val)
      : redactSecrets(val, seen);
  }
  return out;
}


class Telemetry {
    async log(userId, type, data) {
        let object = {
            id: uuid.v4(),
            date: new Date().getTime(),
            user: userId,
            type: type,
            data: redactSecrets(data)
        }

        // TODO: Put object on a kafka queue

        // console.log('Telemetry: ' + JSON.stringify(object));

        let payloads = [ {
            topic: config.kafka.chatbotTelemetryTopic,
            messages: JSON.stringify(object)
        } ]

        producer.send(payloads, function(err, data) {});
    }
};

const telemetry = new Telemetry();
telemetry.redactSecrets = redactSecrets;   // exposed for tests; not part of the log path

module.exports = telemetry;
