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
        let mobileNumber = await this.getMobileNumberFromUserId(userId);
        if(mobileNumber == null)
          continue;

        // The saved session keeps the address the citizen wrote from; egov-user's national
        // number alone would be re-prefixed with the tenant's default country code.
        let user = { mobileNumber: mobileNumber, whatsAppAddress: chatState.context.user.whatsAppAddress };
        let message = dialog.get_message(messages.reminder, chatState.context.user.locale);
        channelProvider.sendMessageToUser(user, [message], extraInfo);
      }
    }
  }

  async getMobileNumberFromUserId(userId){
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

      let mobileNumber = null;
      if(responseBody.user.length > 0 && responseBody.user[0].mobileNumber)
        mobileNumber = responseBody.user[0].mobileNumber;
        
      return mobileNumber;
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