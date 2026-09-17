const fetch = require("node-fetch");
require("url-search-params-polyfill");
const config = require("../env-variables");
var geturl = require("url");
const fs = require("fs");
const FormData = require("form-data");
const path = require("path");

class KaleyraWhatsAppProvider {
  constructor() {
    this.url = config.kaleyra.sendMessageUrl;
    this.url = this.url.replace("{{sid}}", config.kaleyra.sid);
  }

  extractRawMessage(req) {
    return geturl.parse(req.url, true).query;
  }

  isValid(rawMessage) {
    return !!(
      rawMessage &&
      rawMessage.from &&
      rawMessage.wanumber &&
      rawMessage.type
    );
  }

  getFormattedMessageFromUser(rawMessage) {
    try {
      let reformattedMessage = {};
      reformattedMessage.user = {
        mobileNumber: String(rawMessage.from ?? '').slice(2),
      };
      reformattedMessage.extraInfo = {
        whatsAppBusinessNumber: rawMessage.wanumber,
      };

      let type = rawMessage.type;
      if (type == "text") {
        reformattedMessage.message = {
          type: type,
          input: rawMessage.body,
        };
      } else if (type == "location") {
        let geoDetail =
          "(" +
          rawMessage.location.latitude +
          "," +
          rawMessage.location.longitude +
          ")";
        reformattedMessage.message = {
          type: type,
          input: geoDetail,
        };
      } else {
        reformattedMessage.message = {
          type: "unknown",
          input: "",
        };
      }

      return reformattedMessage;
    } catch (err) {
      console.error("Error while processing message from user: " + err);
      return undefined;
    }
  }

  async sendMessageToUser(user, outputMessages, extraInfo) {
    for (let message of outputMessages) {
      let phone = user.mobileNumber;

      let headers = {
        "api-key": config.kaleyra.apikey,
      };

      let form = new FormData();

      form.append("channel", config.kaleyra.channel);
      form.append("from", extraInfo.whatsAppBusinessNumber);
      form.append("to", "91" + phone);

      if (typeof message == "string") {
        form.append("type", "text");
        form.append("body", message);
      } else if (message.type == "media") {
        let buffer;
        buffer = fs.readFileSync(
          path.resolve(__dirname, `../../${message.output}`),
        );
        form.append("caption", message.caption || "");
        form.append("type", "media");
        form.append("media", buffer, {
          contentType: "text/plain",
          name: "file",
          filename: message.output,
        });
      } else if (message.type == "template") {
        //TODO: Handle media template
        form.append("type", message.type);
        form.append("body", message.output);
      } else {
        form.append("type", message.type);
        form.append("body", message.output);
      }

      var request = {
        method: "POST",
        headers: headers,
        body: form,
      };

      const response = await fetch(this.url, request).then((res) => res.json());
      if (
        response &&
        message.type === "media" &&
        message.output.includes("dynamic-media")
      ) {
        fs.unlinkSync(path.resolve(__dirname, `../../${message.output}`));
      }
    }
  }
}

module.exports = new KaleyraWhatsAppProvider();
