const channelProvider = require('../../channel')
const envVariables = require('../../env-variables');
const dialog = require('../util/dialog.js');
const repoProvider = require('../../session/repo');
const fetch = require("node-fetch");

class RemindersService {
  async triggerReminders() {
    console.log('Sending reminders to people');
    let userIdList = await repoProvider.getUserId(true);
    await this.sendMessages(userIdList);
    console.log('Reminders execution end');
  }

  async sendMessages(userIdList) {
    const extraInfo = {
      whatsAppBusinessNumber: envVariables.whatsAppBusinessNumber.slice(2),
    };
    for (let userId of userIdList) {
      let chatState = await repoProvider.getActiveStateForUserId(userId);
      if(chatState.value =='start' || chatState.value.sevamenu == 'question')
        continue;
      else{
        let contact = await this.getContactFromUserId(userId);
        if(contact == null)
          continue;

        let user = {
          mobileNumber: contact.mobileNumber,
          whatsAppAddress: this.reminderAddress(contact, chatState.context.user.whatsAppAddress),
        };
        let message = dialog.get_message(messages.reminder, chatState.context.user.locale);
        channelProvider.sendMessageToUser(user, [message], extraInfo);
      }
    }
  }

  /**
   * The WhatsApp address a reminder goes to, checked against the citizen's current
   * egov-user record:
   *   1. the address saved with the session, while it is still the registered number. It
   *      is the number the citizen actually wrote from, so it beats a stored countryCode,
   *      which egov-user may have filled with the deployment default rather than the
   *      citizen's real country;
   *   2. otherwise the record's own countryCode + mobile number (the number changed, or
   *      no address was saved);
   *   3. otherwise undefined, and the channel applies the tenant's default country code.
   */
  reminderAddress(contact, savedAddress) {
    const digits = (value) => String(value || '').replace(/\D/g, '');
    const national = digits(contact.mobileNumber).replace(/^0+/, '');
    if (!national) return undefined;
    if (savedAddress && digits(savedAddress).endsWith(national)) return savedAddress;
    const countryCode = digits(contact.countryCode);
    if (countryCode) return `whatsapp:+${countryCode}${national}`;
    return undefined;
  }

  /** { mobileNumber, countryCode } from egov-user, or null when there is no mobile number. */
  async getContactFromUserId(userId){
    let url = envVariables.egovServices.egovServicesHost + 'user/_search';

    let requestBody = {
      RequestInfo: null,
      uuid: [userId],
      userType: "CITIZEN"
    };

    let options = {
      method: 'POST',
      origin: '*',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    }

    let response = await fetch(url, options);
    if(response.status == 200){
      let responseBody = await response.json();
      let record = responseBody.user && responseBody.user[0];
      if (record && record.mobileNumber)
        return { mobileNumber: record.mobileNumber, countryCode: record.countryCode };
    }

    return null;
  }
}

let messages = {
  reminder:{
    en_IN: 'You have not selected any option.\n\n👉 To continue, please type and send egov.',
    hi_IN: 'आपने कोई विकल्प नहीं चुना है।\n\n👉 जारी रखने के लिए, कृपया टाइप करें और egov भेजें',
    pa_IN: 'ਤੁਸੀਂ ਕੋਈ ਵਿਕਲਪ ਨਹੀਂ ਚੁਣਿਆ ਹੈ.\n\n👉 ਜਾਰੀ ਰੱਖਣ ਲਈ, ਕਿਰਪਾ ਕਰਕੇ ਟਾਈਪ ਕਰੋ ਅਤੇ egov ਭੇਜੋ'
  }

}

module.exports = new RemindersService();